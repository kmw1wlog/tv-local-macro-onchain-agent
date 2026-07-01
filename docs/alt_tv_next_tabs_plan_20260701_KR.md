# alt_tv 다음 버전 탭 구조 기획

작성일: 2026-07-01

## 1. 목표

현재 `alt_tv`는 최근 24시간 5% 이상 상승 알트 205개를 5분봉 차트로 전수 확인하는 화면이다. 다음 버전은 기존 UI와 차트 구성은 유지하고, 상단 탭으로 관찰 유니버스를 바꿔 볼 수 있게 한다.

핵심 목표는 단순 급등률 확인이 아니라, `익절 가능성이 있는 알트`와 `아직 거대한 상승이 오기 전인 신규상장 알트`를 빠르게 분리해 보는 것이다.

## 2. 유지할 기존 UI 원칙

- 기존 카드형 그리드, 가격 캔들, MA 25/50/200/400, VWAP, VWMA100, RSI, MACD, 거래량 + volume z-score는 유지한다.
- 빨간 세로선은 급등 이벤트, 파란 세로선은 트리거 감지 시점으로 유지한다.
- 급등 직전 1h/3h/6h 구간 강조도 유지한다.
- `?symbols=` 직접 필터는 유지한다. 탭은 이 필터의 상위 preset으로 동작한다.
- 탭을 바꿔도 각 카드의 렌더 방식은 동일해야 한다.

## 3. 탭 정의

| 탭 | 이름 | 목적 | 데이터 기준 |
|---|---|---|---|
| 0 | 기존 | 최근 24시간 5% 이상 상승 전수 | `alt_5pct_tradability_replay_latest.json` 기반 205개 |
| 1 | 타협 목록 | 사용자/Codex/Oracle이 합의한 익절 가능성 목록 | HUMA, TSLAB, AR, VELODROME, CGPT, PENDLE, POLYX, AAVE 등 고정 watchlist |
| 2 | 메이저 변동성 | 변동성이 크면서 거래 가능한 메이저 알트 | 거래대금, ATR%, 실현변동성, BTC/TOTAL3 대비 상대강도 |
| 3 | 최근 신규상장 | 4개월 이내 상장, 최신순 정렬 | 상장일, 상장 후 최대 상승률, 현재 위치, 거래대금, 변동성, 상대강도 |

## 4. 탭 1: 타협 목록

초기 고정 목록:

`HUMAUSDT, TSLABUSDT, ARUSDT, VELODROMEUSDT, CGPTUSDT, PENDLEUSDT, POLYXUSDT, AAVEUSDT, WIFUSDT, KMNOUSDT, DOGSUSDT, FLOWUSDT, NEWTUSDT`

분류:

- 최상 후보: `HUMAUSDT`, `TSLABUSDT`, `CGPTUSDT`, `PENDLEUSDT`, `POLYXUSDT`, `AAVEUSDT`
- 차상 후보: `ARUSDT`, `VELODROMEUSDT`, `WIFUSDT`, `KMNOUSDT`, `DOGSUSDT`, `FLOWUSDT`, `NEWTUSDT`

탭 1의 역할은 “설명력 있는 차트 모양”을 계속 눈으로 확인하는 기준 표본이다. 향후 트리거 precision 개선의 positive archetype으로 사용한다.

## 5. 탭 2: 메이저 변동성

목적:

- DOGE, SUI, ONDO, SOL, XRP, BNB, AVAX, LINK 같은 메이저/준메이저 중 변동성이 큰 종목을 찾는다.
- 낮은 유동성 잡알트가 아니라 실제 주문 실행 가능성이 있는 종목을 우선한다.

초기 산식:

- `quote_volume_24h`: Binance/거래소 24h USDT 거래대금
- `atr_pct_5m_24h`: 5분봉 기준 최근 24시간 ATR / 현재가
- `rv_pct_5m_24h`: 5분 로그수익률 실현변동성의 24시간 환산 또는 24시간 realized vol proxy
- `rs_btc_24h`, `rs_btc_6h`: BTC 대비 상대강도
- `rs_total3_proxy`: TOTAL3ES 직접 API가 없으면 `ALT basket / BTC` 또는 상위 알트 equal-weight proxy로 임시 계산
- `major_score`: 거래대금, 시총/상장기간 proxy, CEX 깊이 proxy를 결합한 메이저성 점수

정렬:

1. `major_score >= threshold`
2. `quote_volume_24h` 상위
3. `atr_pct_5m_24h`와 `rv_pct_5m_24h` 혼합 점수

## 6. 탭 3: 최근 신규상장

이 탭이 다음 구현의 최우선이다.

목적:

- 상장 4개월 이내 종목을 최신순으로 보여준다.
- 이미 거대한 상승이 끝난 코인보다, 상장 후 아직 큰 상승이 발생하기 전이고 거래대금이 붙기 시작한 코인을 모니터링한다.

필수 속성:

| 속성 | 의미 |
|---|---|
| `listing_date_utc` | 거래소 상장일 또는 최초 거래일 |
| `days_since_listing` | 상장 후 경과일 |
| `quote_volume_24h` | 현재 거래대금 |
| `max_gain_since_listing_pct` | 상장 후 저점 대비 최대 상승률 |
| `current_drawdown_from_listing_high_pct` | 상장 후 고점 대비 현재 위치 |
| `range_position_since_listing` | 상장 후 전체 범위 안 현재 위치 |
| `atr_pct_24h`, `rv_pct_24h` | 실무 변동성 |
| `rs_btc_24h`, `rs_btc_7d` | BTC 대비 상대강도 |
| `ma_stack_state` | 25/50/200/400 배열 상태 |
| `volume_z48_latest` | 최근 거래량 팽창 여부 |
| `not_yet_pumped_flag` | 상장 후 이미 과도한 급등이 없었는지 |

초기 데이터 소스:

- Binance spot/futures 상장 심볼: `exchangeInfo`, klines 최초 거래 가능 시점 탐색.
- CoinGecko 또는 exchange metadata: 상장일/market data 보조. 단, 거래소별 실제 상장일과 CoinGecko 등록일은 다를 수 있으므로 provenance를 분리한다.
- 로컬 1m/5m 데이터: 최초 존재 timestamp를 `first_local_trade_time`으로 사용한다.

현실적 구현:

1. Binance `exchangeInfo`에서 USDT spot/perp 심볼 목록을 가져온다.
2. 각 심볼의 1d 또는 1h klines 첫 candle을 탐색해 `first_trade_time`을 얻는다.
3. `now - first_trade_time <= 120 days`인 종목만 탭 3 후보로 둔다.
4. 후보별 5m 최근 24h, 1h/4h/1d 요약을 계산한다.
5. “상장 최신순”이 기본 정렬이고, 보조 정렬로 `not_yet_pumped_score`를 제공한다.

주의:

- 신규상장 탭은 급등 탐지가 아니라 “관찰 유니버스”다.
- 첫 상장 직후 극단 변동 구간은 별도 라벨 `listing_noise`로 표시한다.
- 거래대금이 너무 낮으면 탭에는 보이되 `low_execution_quality` 라벨을 붙인다.

## 7. API 설계

현재 배포 버전:

- `GET /api/alt-24h/events`
- `GET /api/alt-24h/window?symbol=...&event_time=...&hours=24`

다음 버전 추가:

- `GET /api/alt-tv/tabs`
  - 탭 목록, 설명, count, default sort 반환.
- `GET /api/alt-tv/events?tab=spikes|compromise|major_volatility|new_listings`
  - 각 탭의 카드 목록 반환.
- `GET /api/alt-tv/window?symbol=...&tab=...&anchor_time=...&hours=24`
  - 기존 `window`와 동일한 enriched bars 반환.

기존 `/api/alt-24h/*`는 호환성 유지용 alias로 남긴다.

Oracle 자문 반영 후 공통 카드 계약은 `event_time_utc` 중심이 아니라 `card_kind`와 `anchor_time_utc` 중심으로 고정한다. 기존 급등 탭만 `event_time_utc`, `event_gain_pct`, `trigger_time_utc`를 사용한다. 신규상장, 메이저 변동성, 타협 목록은 급등 이벤트가 아닌 관찰 유니버스이므로 빨간 급등선과 `DETECTED/MISSED`를 강제하지 않는다.

공통 카드 예시:

```json
{
  "rank": 1,
  "symbol": "NEWTUSDT",
  "tab": "new_listings",
  "card_kind": "watch_universe",
  "anchor_time_utc": "2026-07-01T00:00:00Z",
  "anchor_type": "latest",
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
```

급등 이벤트 카드만 다음 필드를 추가로 가진다.

```json
{
  "card_kind": "spike_event",
  "event_time_utc": "2026-06-29T10:50:00Z",
  "event_gain_pct": 8.4,
  "trigger_time_utc": "2026-06-29T09:15:00Z"
}
```

## 8. 프론트엔드 설계

상단 header 아래에 compact segmented tabs를 추가한다.

- `기존`
- `타협`
- `메이저 변동성`
- `신규상장`

탭 선택 시:

- URL query `?tab=new_listings`로 상태를 보존한다.
- `?symbols=`가 있으면 탭보다 우선한다.
- 프론트는 `/api/alt-tv/events?tab=...`를 우선 호출하고, 기존 탭은 `/api/alt-24h/events` alias를 유지한다.
- 카드 렌더링은 `card_kind`로 분기한다.
  - `spike_event`: 기존 급등선, trigger line, 1h/3h/6h 강조, `DETECTED/MISSED` 표시.
  - `watch_universe`: 기준 시점 `anchor_time_utc`만 표시하고 급등 이벤트처럼 보이는 UI는 숨김.
- 각 카드에는 탭별 보조 속성 badge를 표시한다.
  - 기존: `TRADABLE`, `PUMP-DUMP`, `DETECTED`
  - 타협: `최상`, `차상`
  - 메이저: `ATR`, `RV`, `VOL`, `RS`
  - 신규상장: `D+N`, `not-yet-pumped`, `listing-noise`, `volume-rising`

`not_yet_pumped`는 상장 직후 비정상 wick을 제거한 뒤 계산한다.

- `listing_noise_window`: 상장 후 첫 24시간 또는 첫 288개 5분봉.
- `base_price`: noise window 이후 안정 구간 VWAP 또는 median close.
- `post_noise_high_gain_pct`: `base_price` 대비 noise 이후 최고 상승률.
- `current_gain_from_base_pct`: `base_price` 대비 현재 상승률.
- `range_position_post_noise`: noise 이후 저점~고점 범위 내 현재 위치.
- `not_yet_pumped_score`: 아직 큰 상승 전인지, 거래대금이 붙기 시작했는지, 현재가가 고점부근이 아닌지를 결합한 0-100 점수.

상장일 provenance는 필수다.

- `listing_date_utc`
- `listing_date_source`
- `first_local_trade_time`
- `coingecko_added_date`
- `listing_date_confidence`
- `market_type`: `spot`, `perp`
- `symbol_provenance`: 예: `binance_usdt_perp`

## 9. 구현 순서

1. 현재 `alt_tv` 배포 안정화.
2. `card_kind`, `anchor_time_utc`, `window_file`, `metrics`, `provenance` 공통 스키마를 먼저 고정.
3. `/api/alt-tv/tabs`, `/api/alt-tv/events`, `/api/alt-tv/window`를 추가.
4. 기존 급등 탭을 새 API alias로 먼저 통과.
5. 프론트엔드 탭 UI와 `card_kind`별 표시 분기를 추가.
6. `tab=compromise` 고정 목록 연결.
7. `tab=new_listings`는 Binance klines 최초 시점 탐색을 최소 20개 표본으로 구현.
8. 신규상장 탭에서 listing noise 제거 후 `not_yet_pumped_score`를 계산.
9. `tab=major_volatility`를 거래대금, ATR/RV, BTC/TOTAL3 proxy 상대강도로 확장.
10. Oracle 검수:
   - 기존 UI 보존 여부
   - 신규상장 탭이 “상장 최신순 + 큰 상승 전 모니터링” 목적에 맞는지
   - 속성값이 과장 없이 provenance를 표시하는지

## 10. 다음 버전 완료 기준

- `/alt-24h?tab=new_listings`가 열리고 최신 상장 후보가 카드로 나온다.
- 각 카드에 최소 `listing age`, `volume`, `ATR/RV`, `BTC 상대강도`, `not-yet-pumped`가 표시된다.
- 신규상장 카드에는 `card_kind=watch_universe`, `anchor_time_utc`, `listing_date_source`, `market_type`, `listing_date_confidence`가 있다.
- 상장 직후 첫 24시간 noise를 제거한 `post_noise_high_gain_pct`, `range_position_post_noise`, `not_yet_pumped_score`가 있다.
- 기존 205개 급등 차트와 `?symbols=` 필터가 깨지지 않는다.
- 로컬 Chromium 캡처에서 2개 이상 카드가 정상 렌더된다.
- Oracle 검수에서 “신규상장 탭 목적과 데이터 provenance가 충분하다” 판정을 받는다.

## 11. Oracle 자문 결과

Oracle 1차 자문 파일:

- `oracle_reviews/oracle_alt_tv_next_tabs_plan_retry_20260701_103019.md`

판정은 `NEEDS_CHANGE`였다. 주요 지적은 다음 네 가지다.

- 신규상장 탭은 급등 이벤트가 아니므로 `event_time_utc` 중심 모델이 아니라 `anchor_time_utc/card_kind` 모델이 필요하다.
- `not_yet_pumped`는 상장 직후 noise와 wick을 제거한 뒤 계산해야 한다.
- 상장일 provenance, spot/perp 구분, confidence를 필수 필드로 둬야 한다.
- `/api/alt-tv/window`는 이벤트 없는 관찰 탭도 처리해야 한다.

위 지적은 이 문서의 7-10장에 반영했다. 다음 구현 전 Oracle 재검수 대상은 이 보강 문서와 새 `/api/alt-tv/*` 스키마 초안이다.
