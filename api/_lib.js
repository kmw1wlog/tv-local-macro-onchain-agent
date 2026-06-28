const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const registryPath = path.join(root, "public", "data", "registry.json");
const schedulePath = path.join(root, "public", "data", "schedule.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function nowIso() {
  return new Date().toISOString();
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "tv-local-macro-onchain/0.1" },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "tv-local-macro-onchain/0.1" },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift().split(",");
  return lines.map((line) => {
    const cols = line.split(",");
    const row = {};
    header.forEach((key, index) => {
      row[key] = cols[index];
    });
    return row;
  });
}

async function binanceKlines(symbol = "BTCUSDT", interval = "1h", limit = 240) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const rows = await fetchJson(url);
  return {
    id: `binance_${symbol.toLowerCase()}_${interval}`,
    label: `${symbol} ${interval}`,
    kind: "candles",
    source: "Binance public REST",
    url,
    bars: rows.map((row) => ({
      time: Math.floor(Number(row[0]) / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5])
    }))
  };
}

async function fredSeries(seriesId, label, limit = 420) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
  const rows = parseCsv(await fetchText(url))
    .filter((row) => row[seriesId] && row[seriesId] !== ".")
    .map((row) => ({
      time: Math.floor(new Date(`${row.observation_date}T00:00:00Z`).getTime() / 1000),
      value: Number(row[seriesId])
    }))
    .filter((row) => Number.isFinite(row.value));
  return {
    id: `fred_${seriesId.toLowerCase()}`,
    label,
    kind: "line",
    source: "FRED public CSV",
    url: `https://fred.stlouisfed.org/series/${seriesId}`,
    points: rows.slice(-limit)
  };
}

async function buildSeries() {
  const fetchers = [
    () => binanceKlines("BTCUSDT", "1h", 240),
    () => fredSeries("VIXCLS", "VIX"),
    () => fredSeries("DFF", "Effective Fed Funds Rate"),
    () => fredSeries("DGS10", "US 10Y Treasury Yield"),
    () => fredSeries("CPIAUCSL", "CPI All Items"),
    () => fredSeries("CPILFESL", "Core CPI"),
    () => fredSeries("PAYEMS", "Nonfarm Payrolls"),
    () => fredSeries("CES0500000003", "Average Hourly Earnings"),
    () => fredSeries("DTWEXBGS", "Trade Weighted Broad Dollar Index"),
    () => fredSeries("WTISPLC", "WTI Spot Price")
  ];
  const results = await Promise.allSettled(fetchers.map((fetcher) => fetcher()));
  const datasets = results.filter((item) => item.status === "fulfilled").map((item) => item.value);
  const errors = results.filter((item) => item.status === "rejected").map((item) => String(item.reason?.message || item.reason));
  const latest_values = {};
  for (const dataset of datasets) {
    const rows = dataset.bars || dataset.points || [];
    const last = rows[rows.length - 1];
    if (!last) continue;
    latest_values[dataset.id] = {
      time: last.time,
      value: last.close ?? last.value,
      label: dataset.label
    };
  }
  return { generated_at: nowIso(), datasets, latest_values, errors };
}

function dataset(series, id) {
  return series.datasets.find((item) => item.id === id);
}

function latest(series, id) {
  const item = series.latest_values[id];
  return item ? Number(item.value) : null;
}

function change(points, lookback) {
  if (!points || points.length <= lookback) return null;
  return Number(points[points.length - 1].value) - Number(points[points.length - lookback - 1].value);
}

function roundLevel(value) {
  const step = value >= 100000 ? 1000 : value >= 20000 ? 500 : 250;
  return Math.round(value / step) * step;
}

function volumeProfileLevels(bars, binSize = 500) {
  const buckets = new Map();
  for (const bar of bars) {
    const bucket = Math.round(Number(bar.close) / binSize) * binSize;
    buckets.set(bucket, (buckets.get(bucket) || 0) + Number(bar.volume || 0));
  }
  const total = [...buckets.values()].reduce((sum, value) => sum + value, 0) || 1;
  return [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([price, volume]) => ({
      price,
      volume_share: volume / total,
      evidence: `최근 10일 1시간봉 거래량 프로파일 상위권 매물대, 점유율 ${(volume / total * 100).toFixed(1)}%`
    }));
}

function priceContext(series) {
  const btc = dataset(series, "binance_btcusdt_1h");
  const bars = btc ? btc.bars : [];
  if (!bars.length) return { error: "BTCUSDT 1시간봉이 없습니다." };
  const last = bars[bars.length - 1];
  const slice = (n) => bars.slice(Math.max(0, bars.length - n));
  const range = (rows) => ({
    high: Math.max(...rows.map((bar) => Number(bar.high))),
    low: Math.min(...rows.map((bar) => Number(bar.low)))
  });
  const one = range(slice(24));
  const three = range(slice(72));
  const ten = range(slice(240));
  const tr = slice(72).map((bar) => Number(bar.high) - Number(bar.low));
  const profile = volumeProfileLevels(slice(240));
  return {
    current: Number(last.close),
    last_time: last.time,
    ranges: {
      "24h_high": one.high,
      "24h_low": one.low,
      "72h_high": three.high,
      "72h_low": three.low,
      "10d_high": ten.high,
      "10d_low": ten.low
    },
    atr_1h_proxy: tr.slice(-24).reduce((sum, value) => sum + value, 0) / Math.max(1, tr.slice(-24).length),
    volume_profile: profile,
    nearest_volume_nodes: [...profile].sort((a, b) => Math.abs(a.price - Number(last.close)) - Math.abs(b.price - Number(last.close))).slice(0, 4)
  };
}

function macroContext(series) {
  const vix = latest(series, "fred_vixcls");
  const dff = latest(series, "fred_dff");
  const dgs10 = latest(series, "fred_dgs10");
  const dollar = latest(series, "fred_dtwexbgs");
  const vix5 = change((dataset(series, "fred_vixcls") || {}).points, 5);
  const dgs105 = change((dataset(series, "fred_dgs10") || {}).points, 5);
  const dollar5 = change((dataset(series, "fred_dtwexbgs") || {}).points, 5);
  let pressure = 0;
  if (vix !== null && vix >= 20) pressure += 1;
  if (vix5 !== null && vix5 > 1) pressure += 1;
  if (dgs105 !== null && dgs105 > 0.08) pressure += 1;
  if (dollar5 !== null && dollar5 > 0.5) pressure += 1;
  return {
    label: pressure >= 3 ? "위험회피 압력 우위" : pressure === 2 ? "중립보다 약간 압박" : "단기 위험선호 회복 여지",
    pressure_score: pressure,
    values: {
      VIX: vix,
      VIX_5d_change: vix5,
      FedFunds: dff,
      US10Y: dgs10,
      US10Y_5d_change: dgs105,
      BroadDollar: dollar,
      BroadDollar_5d_change: dollar5,
      CPI: latest(series, "fred_cpiaucsl"),
      CoreCPI: latest(series, "fred_cpilfesl"),
      NFP: latest(series, "fred_payems"),
      AverageHourlyEarnings: latest(series, "fred_ces0500000003")
    },
    read: "PCx6Yyz2/SOZBShSh/SZgxmcm8 기준으로 DXY·금리·VIX가 올라가면 온체인 지지가 있어도 조기 롱 신뢰도를 낮춘다."
  };
}

function indicatorTraversal(registry) {
  return registry.groups.map((group) => {
    const local = group.items.filter((item) => item.local_status === "local_series").length;
    const builtin = group.items.filter((item) => item.local_status === "implemented_or_builtin").length;
    return {
      group: group.name,
      total: group.items.length,
      local_series: local,
      implemented_or_builtin: builtin,
      external_chart: group.items.length - local - builtin
    };
  });
}

function priceLevels(price, macro) {
  if (price.error) return [];
  const current = price.current;
  const ranges = price.ranges;
  const levels = [
    { price: roundLevel(ranges["10d_low"]), kind: "support", label: "10일 저점, 실패 시 추세 가속 후보", evidence: "최근 가격 구조 기반. URPD/Realized Price 확인 전까지 단기 지지 후보." },
    ...price.nearest_volume_nodes.map((node) => ({
      price: node.price,
      kind: node.price < current ? "support" : "resistance",
      label: "거래량 프로파일 매물대",
      evidence: node.evidence
    })),
    { price: roundLevel(ranges["72h_high"]), kind: "resistance", label: "72시간 고점 저항", evidence: "STH Realized Price와 URPD 상단 매물대 확인 시 신뢰도 상승." },
    { price: roundLevel(ranges["10d_high"]), kind: "resistance", label: "10일 고점, 회복 시 구조 전환 확인", evidence: "중기 박스 상단 후보." }
  ];
  if (macro.pressure_score >= 3) {
    levels.push({ price: roundLevel(current - Math.max(price.atr_1h_proxy * 8, current * 0.03)), kind: "support", label: "매크로 압박 시 꼬리 리스크 하단", evidence: "VIX/금리/달러 압력 강세 시 ATR 기반 임시 하단." });
  }
  const seen = new Map();
  for (const level of levels) {
    seen.set(`${level.kind}:${level.price}`, { confidence: "medium", ...level });
  }
  return [...seen.values()].sort((a, b) => a.price - b.price);
}

function scenarios(price, macro, levels) {
  const current = price.current || 0;
  const supports = levels.filter((level) => level.kind === "support");
  const resistances = levels.filter((level) => level.kind === "resistance");
  const firstSupport = Math.max(...supports.filter((level) => level.price <= current).map((level) => level.price), roundLevel(current * 0.97));
  const firstResistance = Math.min(...resistances.filter((level) => level.price >= current).map((level) => level.price), roundLevel(current * 1.03));
  const deepSupport = Math.min(...supports.map((level) => level.price), roundLevel(current * 0.94));
  const highResistance = Math.max(...resistances.map((level) => level.price), roundLevel(current * 1.06));
  return [
    {
      name: "기본: 손실권 단기 반등 검증",
      probability: "45%",
      trigger: `${firstSupport.toLocaleString()} 부근 방어 후 ${firstResistance.toLocaleString()} 회복 시도`,
      support: firstSupport.toLocaleString(),
      resistance: firstResistance.toLocaleString(),
      response: "분할 접근. 반등이 STH 비용기준/URPD 상단 매물대에 막히는지 확인하고, 거래소 순유입 증가 시 롱 비중을 줄인다."
    },
    {
      name: "상방: 매크로 진정 + 매집 확인",
      probability: "30%",
      trigger: `VIX·금리·달러 압력 완화와 함께 ${firstResistance.toLocaleString()} 돌파`,
      support: `${firstResistance.toLocaleString()} 돌파 후 지지 전환`,
      resistance: highResistance.toLocaleString(),
      response: "돌파 추격보다 재테스트 확인. ATS/거래소 순유출/LTH 공급 증가가 동반되면 레버리지 허용폭을 키운다."
    },
    {
      name: "하방: 지지 공백 재가격화",
      probability: "25%",
      trigger: `${firstSupport.toLocaleString()} 이탈 + VIX/금리/달러 압력 재상승`,
      support: deepSupport.toLocaleString(),
      resistance: `${firstSupport.toLocaleString()} 이탈 후 저항 전환`,
      response: "롱 대기. URPD상 아래 공급 공백, STH 손실 확대, 고래 거래소 순입금이 확인되면 다음 비용기준 지지까지 열어둔다."
    }
  ];
}

function briefingSections(price, macro, traversal, levels) {
  const levelText = levels.slice(0, 8).map((level) => `${level.label} ${Number(level.price).toLocaleString()}`).join(", ");
  return [
    { heading: "1. 매크로 관문", body: `${macro.label}. VIX, 금리, 달러지수 대체값을 우선 확인한다. ${macro.read}` },
    { heading: "2. 가격·매물대", body: `현재가는 ${Number(price.current).toLocaleString()} 부근이다. 최근 1시간봉 고저점과 거래량 프로파일 기준 주요 가격대는 ${levelText}이다.` },
    { heading: "3. 온체인 비용기준·바닥 모델", body: "Realized Price, STH/LTH Realized Price, Balanced Price, CVDD, Difficulty 계열은 외부 무료 차트에서 최신값을 순회한다. 가격이 STH 비용기준 아래면 반등은 본전 매물 검증이고, Realized/LTH/CVDD 쪽은 깊은 지지 후보가 된다." },
    { heading: "4. 수급·코인 나이", body: "ATS, 고래 거래소 순유입, Liveliness, LTH Supply, HODL Waves, CDD, Revived Supply를 순회해 분산인지 흡수인지 판단한다. 오래된 코인이 움직이지 않고 거래소 순유출이면 하락 중 흡수로 분류한다." },
    { heading: "5. 차트 오버레이 계획", body: "BTC 차트 위에는 RP/STH RP/LTH RP/CVDD/Balanced Price를 수평 가격선으로, URPD 고밀도·공백 구간은 배경 밴드로, 고래 거래소 순유입·ATS 악화는 상단 경고 마커로 표시한다. 축은 BTC 가격축에 맞는 가격 모델과 별도 축이 필요한 비율·Z-score 지표를 분리한다." },
    { heading: "6. 전수 순회 상태", body: traversal.map((row) => `${row.group}: ${row.total}개`).join(" / ") }
  ];
}

function oneLiner(price, macro, levels) {
  const support = Math.max(...levels.filter((level) => level.kind === "support" && level.price <= price.current).map((level) => level.price), NaN);
  const resistance = Math.min(...levels.filter((level) => level.kind === "resistance" && level.price >= price.current).map((level) => level.price), NaN);
  return `BTC는 ${Number(price.current).toLocaleString()} 부근, 매크로 판정은 \`${macro.label}\`. 가까운 지지는 ${Number(support).toLocaleString()}. 가까운 저항은 ${Number(resistance).toLocaleString()}. 온체인 비용기준·URPD·고래 거래소 순유입은 외부 차트 확인 후 신뢰도를 갱신한다.`;
}

function deterministicBriefing(registry, series, session = "vercel_live") {
  const price = priceContext(series);
  const macro = macroContext(series);
  const traversal = indicatorTraversal(registry);
  const levels = priceLevels(price, macro);
  let bias = "중립";
  if (macro.pressure_score >= 3) bias = "위험회피/방어 우위";
  else if (levels.length) bias = "하단 지지 근접";
  return {
    generated_at: nowIso(),
    session,
    template_version: "yonsei_4doc_macro_onchain_v1_vercel",
    agent_chain: {
      deterministic_pass: "completed",
      qwen: { configured: Boolean(process.env.QWEN_API_KEY), status: "not_run" },
      oracle: { requested: false, status: "external_review_loop" }
    },
    summary: {
      title: `${session} 장 시작 온체인·매크로 브리핑`,
      bias,
      one_liner: oneLiner(price, macro, levels)
    },
    contexts: { price, macro, indicator_traversal: traversal },
    price_levels: levels,
    scenarios: scenarios(price, macro, levels),
    briefing_sections: briefingSections(price, macro, traversal, levels),
    source_documents: [
      "PCx6Yyz2_supply_analysis_template_20260628_KR.md",
      "SOZBShSh_detox_analysis_template_20260628_KR.md",
      "004_SZgxmcm8.md",
      "005_02Axw6S0.md"
    ],
    source_image_montages: ["/source-images/004_montage.jpg", "/source-images/005_montage.jpg", "/source-images/021_montage.jpg", "/source-images/036_montage.jpg"]
  };
}

async function qwenEnhance(briefing, registry, series) {
  if (!process.env.QWEN_API_KEY) {
    briefing.agent_chain.qwen = { configured: false, status: "skipped", reason: "QWEN_API_KEY is not set" };
    return briefing;
  }
  const base = (process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, "");
  const model = process.env.QWEN_MODEL || "qwen-plus";
  const prompt = `아래 BTC 온체인+매크로 브리핑 JSON을 한글로 보강하라. price_levels와 scenarios는 유지하고, 4개 원문 이미지의 쓰임새를 참고한 차트 오버레이 개선 질문을 qwen_notes에 포함하라. JSON object만 반환하라.\n\n${JSON.stringify({ briefing, registry_groups: registry.groups, latest_values: series.latest_values })}`;
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.QWEN_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.1 })
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const payload = await res.json();
    let text = payload.choices?.[0]?.message?.content || "";
    text = text.trim().replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/\s*```$/, "");
    const result = JSON.parse(text);
    for (const key of ["summary", "briefing_sections", "price_levels", "scenarios"]) {
      if (result[key]) briefing[key] = result[key];
    }
    if (result.qwen_notes) briefing.qwen_notes = result.qwen_notes;
    briefing.agent_chain.qwen = { configured: true, status: "completed", model };
  } catch (error) {
    briefing.agent_chain.qwen = { configured: true, status: "failed", model, error: String(error.message || error) };
  }
  return briefing;
}

async function buildBriefing(session = "vercel_live", withQwen = true) {
  const registry = readJson(registryPath);
  const series = await buildSeries();
  const briefing = deterministicBriefing(registry, series, session);
  return withQwen ? qwenEnhance(briefing, registry, series) : briefing;
}

function sendJson(res, data) {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "s-maxage=60, stale-while-revalidate=300");
  res.status(200).send(JSON.stringify(data));
}

module.exports = {
  buildBriefing,
  buildSeries,
  readJson,
  registryPath,
  schedulePath,
  sendJson
};
