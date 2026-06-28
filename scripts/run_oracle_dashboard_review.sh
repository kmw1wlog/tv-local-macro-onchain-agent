#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <vercel-url>" >&2
  exit 2
fi

DEPLOY_URL="$1"
OUT_DIR="oracle_reviews"
STAMP="$(date -u +%Y%m%d_%H%M%S)"
OUT_FILE="${OUT_DIR}/oracle_dashboard_review_${STAMP}.md"
mkdir -p "$OUT_DIR"

PROMPT=$(cat <<PROMPT_EOF
아래 Vercel 배포 대시보드를 검수하라.

배포 URL: ${DEPLOY_URL}
GitHub repo: https://github.com/kmw1wlog/tv-local-macro-onchain-agent

검수 조건:
1. 대시보드 목표가 "오늘~다음주 BTC 예측"에 맞는지 검수.
2. 에이전트가 온체인+매크로 지표/데이터를 전수 순회하도록 구현됐는지 검수.
3. 브리핑 템플릿이 4개 Yonsei_dent 문서와 온체인+매크로 전수 지표/데이터에 실제로 근거하는지 검수.
4. 비트코인 차트 위에 온체인+매크로 수급을 표시하는 방법을 구체적으로 제안:
   - RP/STH RP/LTH RP/CVDD/Balanced Price/Difficulty 계열은 BTC 가격축 수평선.
   - URPD 고밀도/공백 구간은 차트 배경 밴드.
   - ATS/고래 거래소 순유입/Exchange Net Position Change는 상단 마커 또는 경고 레이어.
   - Liveliness/CDD/Revived Supply/RHODL/HODL Waves는 하단 보조패널 또는 상태 배지.
5. 데이터 차트 축 스케일 문제 검수:
   - 가격 모델은 BTC 가격축.
   - 비율, Z-score, 공급량, 금리/달러/VIX는 별도 축 또는 정규화 축.
   - 같은 패널에 겹치면 오해가 생기는 항목을 지적.
6. 원문 이미지 4개 묶음의 차트 쓰임새를 반드시 확인하고, 현재 대시보드가 어떤 영감을 반영했고 무엇이 부족한지 평가:
   - /source-images/004_montage.jpg
   - /source-images/005_montage.jpg
   - /source-images/021_montage.jpg
   - /source-images/036_montage.jpg
7. 앞으로 구현자가 답해야 할 질문을 우선순위로 제시.

출력은 한글로 작성하라. 칭찬보다 결함, 누락, 다음 구현 지시를 먼저 써라.
PROMPT_EOF
)

PATH="$HOME/.local/bin:$PATH" npx -y @steipete/oracle \
  --engine browser \
  --browser-cookie-path "${ORACLE_BROWSER_COOKIE_PATH:-/home/hang010412/.config/google-chrome/Default}" \
  --browser-chrome-path "${ORACLE_BROWSER_CHROME_PATH:-/usr/bin/google-chrome}" \
  --browser-model-strategy "${ORACLE_BROWSER_MODEL_STRATEGY:-ignore}" \
  --write-output "$OUT_FILE" \
  -p "$PROMPT" \
  --file README.md vercel.json api/_lib.js public/index.html public/static/js/macro_onchain.js public/static/css/macro_onchain.css public/data/registry.json

echo "$OUT_FILE"
