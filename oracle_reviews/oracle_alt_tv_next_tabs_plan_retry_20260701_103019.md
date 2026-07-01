**판정: NEEDS_CHANGE**

방향은 맞습니다. 기존 5% 급등 전수 UI를 유지하고, 탭을 “관찰 유니버스 preset”으로 추가한다는 구조는 적절합니다. 다만 현재 문서 그대로 구현하면 **신규상장 탭의 데이터 의미가 흔들리고**, 현재 `alt_24h.js`의 이벤트 중심 렌더러와 API 계약이 맞지 않아 깨질 가능성이 큽니다.

## P0. 반드시 바꿔야 할 부분

### 1. `event_time_utc` 중심 구조를 `anchor_time_utc` 중심으로 바꿔야 함

현재 프론트는 모든 카드를 “급등 이벤트”로 가정합니다.

```js
event.event_time_utc
event.event_gain_pct
event.trigger_detected
event.event15_time_utc
event.trigger_time_utc
```

그런데 신규상장 탭은 급등 이벤트가 아니라 **관찰 대상 목록**입니다. 따라서 신규상장 카드에 억지로 `event_time_utc`를 넣으면 빨간 세로선, 급등 직전 1h/3h/6h 강조, `DETECTED/MISSED` 배지가 의미를 잃습니다.

수정 필요:

```json
{
  "symbol": "NEWTUSDT",
  "tab": "new_listings",
  "card_kind": "watch_universe",
  "anchor_time_utc": "2026-07-01T00:00:00Z",
  "anchor_type": "latest",
  "listing_date_utc": "2026-06-15T00:00:00Z",
  "badges": ["D+16", "not-yet-pumped", "volume-rising"],
  "metrics": {}
}
```

기존 급등 탭만:

```json
{
  "card_kind": "spike_event",
  "event_time_utc": "...",
  "trigger_time_utc": "...",
  "event_gain_pct": 5.8
}
```

즉, `/api/alt-tv/events`는 탭별로 원본 의미는 다르더라도 프론트가 읽을 수 있는 **공통 카드 계약**을 가져야 합니다.

---

### 2. 신규상장 `not_yet_pumped_flag` 정의가 아직 위험함

현재 문서의 필드 방향은 좋지만, `max_gain_since_listing_pct`를 단순히 “상장 후 저점 대비 최대 상승률”로 잡으면 신규상장 직후 첫 캔들의 비정상 wick 때문에 거의 모든 종목이 “이미 펌핑됨” 또는 “왜곡됨”으로 잡힐 수 있습니다.

필수 보강:

```text
listing_noise_window = 상장 후 첫 24h 또는 첫 288개 5m candle
base_price = listing_noise_window 이후 첫 안정 구간 VWAP 또는 median close
post_noise_high_gain_pct = base_price 대비 noise 이후 최고 상승률
current_gain_from_base_pct = base_price 대비 현재 상승률
range_position_post_noise = noise 이후 저점~고점 범위 내 현재 위치
```

그리고 `not_yet_pumped_flag`는 단일 Boolean만 두지 말고 최소 이렇게 나눠야 합니다.

```json
{
  "not_yet_pumped_flag": true,
  "not_yet_pumped_score": 72,
  "pump_status": "pre_major_pump_candidate",
  "pump_reason": [
    "post_noise_high_gain_pct_below_threshold",
    "current_range_position_mid_low",
    "volume_rising_without_parabolic_move"
  ]
}
```

권장 판정 기준:

```text
not-yet-pumped 후보:
- days_since_listing <= 120
- listing_noise_window 이후 기준
- post_noise_high_gain_pct가 과도하지 않음
- 현재가가 상장 후 고점 부근이 아님
- 24h 거래대금이 증가 중
- volume_z 또는 거래대금 상승은 있으나 1D/4H 단기 폭등은 아직 아님
```

---

### 3. 상장일 provenance를 분리해야 함

문서에 provenance 분리 언급은 있지만, 완료 기준에 강제되어 있지 않습니다. 이건 P0에 가깝습니다.

신규상장 탭은 “4개월 이내 상장”이 핵심이므로 상장일 출처가 섞이면 탭 목적이 무너집니다.

필수 필드:

```json
{
  "listing_date_utc": "2026-06-12T00:00:00Z",
  "listing_date_source": "binance_first_kline",
  "first_local_trade_time": "...",
  "coingecko_added_date": "...",
  "listing_date_confidence": "high",
  "market_type": "spot|perp",
  "symbol_provenance": "binance_usdt_perp"
}
```

특히 spot 상장일과 futures/perp 상장일은 다를 수 있으므로 `market_type`을 분리해야 합니다.

---

### 4. `/api/alt-tv/window`가 신규상장 탭을 처리할 수 있게 해야 함

현재 `window.js`는 `event_time`으로 이벤트를 찾고, 그 이벤트의 `window_file`을 읽습니다.

```js
findEvent(index.events || [], req.query.symbol, req.query.event_time)
```

신규상장 탭은 `event_time`이 없습니다. 따라서 새 API는 다음 중 하나가 필요합니다.

권장:

```http
GET /api/alt-tv/window?symbol=NEWTUSDT&tab=new_listings&anchor_time=latest&hours=24
```

또는 이벤트 카드가 직접:

```json
{
  "symbol": "NEWTUSDT",
  "window_file": "/data/alt_tv/windows/NEWTUSDT_latest_24h.json"
}
```

를 들고 있어야 합니다.

---

## P1. 바꾸는 게 좋은 부분

### 1. 탭별 정렬 기준을 더 고정해야 함

현재 신규상장 탭은 “최신순 기본 + not_yet_pumped 보조”라고 되어 있는데, 사용 목적상 둘 다 필요합니다.

권장 정렬:

```text
기본 정렬:
1. listing_date_utc 최신순
2. low_execution_quality 제외 또는 하단 배치
3. not_yet_pumped_score 높은 순
4. quote_volume_24h 높은 순
```

옵션 정렬:

```text
latest
not_yet_pumped_score
volume_rising
rs_btc_24h
atr_pct_24h
```

---

### 2. 타협 목록은 “익절 가능성”이라는 이름과 고정 watchlist의 근거가 분리되어야 함

탭 1 방향은 좋지만, 단순 고정 목록이면 “익절 가능성 목록”이라는 표현이 과장될 수 있습니다.

추천 명칭:

```text
타협 목록 → 익절 후보 관찰 목록
```

필드:

```json
{
  "watchlist_tier": "top|secondary",
  "reason": "user_codex_oracle_compromise",
  "last_reviewed_at": "2026-07-01T..."
}
```

---

### 3. 메이저 변동성의 `major_score`는 최소 구성요소를 고정해야 함

현재 `major_score`가 추상적입니다. 적어도 아래는 고정해야 합니다.

```text
major_score =
- quote_volume_24h rank
- symbol_age_days
- spread/depth proxy
- top exchange availability
- BTC/ETH/SOL/BNB/XRP 등 base major allowlist 가중치
```

잡알트가 거래대금만 일시적으로 커져서 메이저 탭에 들어오는 것을 막아야 합니다.

---

## API 설계 검수

제안된 API 방향은 좋습니다.

```http
GET /api/alt-tv/tabs
GET /api/alt-tv/events?tab=...
GET /api/alt-tv/window?symbol=...&anchor_time=...&hours=24
```

다만 현재 코드와 연결하려면 이벤트 응답 스키마를 명확히 고정해야 합니다.

권장 공통 스키마:

```json
{
  "source": "alt_tv_tabs_static",
  "generated_at": "2026-07-01T...",
  "tab": "new_listings",
  "count": 20,
  "default_sort": "listing_date_desc",
  "events": [
    {
      "rank": 1,
      "symbol": "NEWTUSDT",
      "card_kind": "watch_universe",
      "anchor_time_utc": "2026-07-01T00:00:00Z",
      "window_file": "/data/alt_tv/windows/NEWTUSDT_latest_24h.json",
      "badges": ["D+16", "not-yet-pumped", "volume-rising"],
      "metrics": {
        "days_since_listing": 16,
        "quote_volume_24h": 12345678,
        "atr_pct_24h": 4.2,
        "rv_pct_24h": 5.1,
        "rs_btc_24h": 2.3,
        "post_noise_high_gain_pct": 64.5,
        "range_position_post_noise": 0.38,
        "not_yet_pumped_score": 72
      },
      "provenance": {
        "listing_date_source": "binance_first_kline",
        "market_type": "perp",
        "listing_date_confidence": "high"
      }
    }
  ]
}
```

---

## 프론트엔드 검수

현재 `alt_24h.js`는 그대로는 탭 구조를 받을 수 없습니다.

필수 수정:

1. `?tab=` 읽기
2. `?symbols=`가 있으면 탭보다 우선
3. `/api/alt-tv/events?tab=...` 호출
4. 카드 렌더에서 `card_kind`별 표시 분기
5. 신규상장/메이저/타협 탭에서는 `DETECTED/MISSED`, `event_gain_pct`, 빨간 급등선 강제 표시 금지
6. 기존 `/api/alt-24h/*`는 alias로 유지

특히 “기존 UI 유지”는 **차트 패널 유지**이지, 모든 탭에 급등 이벤트 오버레이를 억지로 유지하라는 뜻은 아닙니다.

---

## 우선순위 검수

문서의 구현 순서는 대체로 맞지만, 순서를 조금 바꾸는 게 안전합니다.

권장 순서:

1. `/api/alt-tv/tabs`, `/api/alt-tv/events` 공통 스키마 먼저 확정
2. 기존 급등 탭을 새 API alias로 먼저 통과
3. 프론트 탭 UI 추가
4. `compromise` 고정 목록 연결
5. `new_listings` 최소 20개 표본 연결
6. `not_yet_pumped_score`와 provenance 검수
7. `major_volatility` 확장

즉, 신규상장 탭이 최우선인 건 맞지만, 그 전에 **공통 카드 스키마**를 먼저 고정해야 합니다.

---

## 최종 결론

**NEEDS_CHANGE**

기획 방향은 맞고 탭 구성도 적절합니다. 다만 현재 상태로는 신규상장 탭을 기존 급등 이벤트 모델에 억지로 끼워 넣는 구조라서 데이터 의미가 깨질 수 있습니다.

반드시 고쳐야 할 핵심은 4개입니다.

1. `event_time_utc` 대신 공통 `anchor_time_utc/card_kind` 도입
2. 신규상장 `not_yet_pumped`를 listing noise 제거 후 계산
3. 상장일 provenance와 spot/perp 구분 강제
4. `/api/alt-tv/window`가 이벤트 없는 관찰 탭도 처리하도록 변경

이 4개를 반영하면 다음 버전 기획은 PASS로 볼 수 있습니다.
