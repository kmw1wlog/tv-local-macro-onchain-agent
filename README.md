# BTC Macro Onchain Agent Dashboard

Yonsei_dent 4개 문서 기반 BTC 온체인·매크로 장 시작 브리핑 대시보드입니다.

## 목적

- 오늘~다음주 BTC 장세를 온체인+매크로 전수 지표 루프로 브리핑한다.
- BTC 차트 위에 주요 지지/저항 가격선을 표시한다.
- RP/STH RP/LTH RP/CVDD/Balanced Price/URPD/ATS/거래소 흐름 등은 공급처 registry에서 순회한다.
- Vercel Cron이 아시아/런던/미장 시작 시간에 `/api/cron`을 호출한다.

## API

- `/api/series`: Binance/FRED 공개 데이터 동적 수집
- `/api/briefing`: deterministic pass + optional Qwen enhancement
- `/api/registry`: 온체인/매크로 공급처 55개 매핑
- `/api/schedule`: KST 기준 장 시작 스케줄
- `/api/cron`: Vercel Cron entry point

## Required secrets

Vercel 환경변수로만 설정한다. 저장소에는 절대 커밋하지 않는다.

- `QWEN_API_KEY`
- `QWEN_BASE_URL`
- `QWEN_MODEL`

## Deploy

```bash
npx -y vercel@latest deploy --yes --prod
```

CLI가 device login을 요구하면 브라우저에서 인증을 끝낸 뒤 같은 명령을 재실행한다.

## Oracle Review

```bash
./scripts/run_oracle_dashboard_review.sh https://your-vercel-deployment-url.vercel.app
```
