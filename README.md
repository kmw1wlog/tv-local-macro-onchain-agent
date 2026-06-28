# BTC Macro Onchain Agent Dashboard

Yonsei_dent 4개 문서 기반 BTC 온체인·매크로 장 시작 브리핑 대시보드입니다.

## 목적

- 오늘~다음주 BTC 장세를 온체인+매크로 전수 지표 루프로 브리핑한다.
- BTC 차트 위에 주요 지지/저항 가격선을 표시한다.
- RP/STH RP/LTH RP/CVDD/Balanced Price/URPD/ATS/거래소 흐름 등은 공급처 registry에서 순회하되, `live_value`, `manual_snapshot`, `proxy`, `missing` 상태를 분리한다.
- Vercel Cron이 아시아/런던/미장 시작 시간에 `/api/cron`을 호출한다.

## API

- `/api/series`: Binance/FRED 공개 데이터 동적 수집
- `/api/briefing`: deterministic pass. Vercel에서는 외부 Qwen API를 호출하지 않는다
- `/api/registry`: 온체인/매크로 공급처 55개 매핑
- `/api/schedule`: KST 기준 장 시작 스케줄
- `/api/cron`: Vercel Cron entry point. 실행 결과를 `/tmp` 히스토리에 저장한다
- `/api/history`: 최근 cron 실행 히스토리 확인
- `public/data/manual_snapshots.json`: 온체인 수동 스냅샷/프록시/누락 주입 포맷
- `public/data/source_image_mapping.json`: 원문 이미지 패널별 구현/누락 매핑

## Metric status

- `live_value`: BTC/FRED/로컬 산출처럼 자동 최신값이 있는 항목
- `manual_snapshot`: 공개 차트에서 수동 확인한 값. 브리핑 근거로 쓰되 `as_of`와 `stale_days`를 표시한다
- `proxy`: 실제 지표가 아니라 비용기준/거래량 프로파일 등으로 대체한 항목. 확정 근거가 아니라 참고선이다
- `missing`: 공급처는 있으나 자동값이 없는 항목. 브리핑 확률 산식에서는 확인 필요 리스크로만 취급한다

브리핑의 강한 근거는 `live_value`와 `manual_snapshot`만 허용한다. `proxy`와 `missing`은 화면에 표시하되 시나리오 신뢰도를 낮추는 항목으로만 쓴다.

## Qwen 원칙

Qwen은 외부 API가 아니라 로컬 `loop_research_agents` 방식만 사용한다.

- 로컬 Qwen 서버: `http://127.0.0.1:8080/v1`
- 로컬 Qwen 라우터: `http://127.0.0.1:9223/v1/messages`
- Vercel 런타임은 로컬 포트에 접근할 수 없으므로 `qwen=1` 요청도 `skipped_in_vercel`로 기록한다.
- Vercel 환경변수에 Qwen API 키가 있어도 이 앱은 읽거나 호출하지 않는다.
- 배포 화면의 장 시작 브리핑은 규칙 기반 브리핑이며, Qwen 보강 결과는 로컬 루프에서 생성 후 별도로 주입하는 구조다.

## Deploy

```bash
npx -y vercel@latest deploy --yes --prod
```

CLI가 device login을 요구하면 브라우저에서 인증을 끝낸 뒤 같은 명령을 재실행한다.

## Oracle Review

```bash
./scripts/run_oracle_dashboard_review.sh https://your-vercel-deployment-url.vercel.app
```

반복 검수 절차는 [Oracle 검수 루프 사용법](docs/oracle_review_loop_usage_20260628_KR.md)을 따른다.
