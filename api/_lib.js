const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const registryPath = path.join(root, "public", "data", "registry.json");
const schedulePath = path.join(root, "public", "data", "schedule.json");
const seriesFallbackPath = path.join(root, "public", "data", "series-fallback.json");
const sourceImageMappingPath = path.join(root, "public", "data", "source_image_mapping.json");
const manualSnapshotsPath = path.join(root, "public", "data", "manual_snapshots.json");
const cronHistoryPath = path.join("/tmp", "tv_local_macro_onchain_cron_history.jsonl");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function nowIso() {
  return new Date().toISOString();
}

function dateFromSeconds(seconds) {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function staleDays(asOf) {
  const time = new Date(`${asOf}T00:00:00Z`).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
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

async function coinbaseKlines(limit = 240) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - limit * 3600;
  const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`;
  const rows = await fetchJson(url);
  const bars = rows
    .map((row) => ({
      time: Number(row[0]),
      low: Number(row[1]),
      high: Number(row[2]),
      open: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5])
    }))
    .sort((a, b) => a.time - b.time)
    .slice(-limit);
  return {
    id: "binance_btcusdt_1h",
    label: "BTCUSD 1h",
    kind: "candles",
    source: "Coinbase public REST fallback",
    url,
    bars
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
    async () => {
      try {
        return await binanceKlines("BTCUSDT", "1h", 240);
      } catch (error) {
        return coinbaseKlines(240);
      }
    },
    () => fredSeries("VIXCLS", "VIX"),
    () => fredSeries("DFF", "Effective Fed Funds Rate"),
    () => fredSeries("DGS10", "US 10Y Treasury Yield"),
    () => fredSeries("CPIAUCSL", "CPI All Items"),
    () => fredSeries("CPILFESL", "Core CPI"),
    () => fredSeries("CPIUFDSL", "Food CPI"),
    () => fredSeries("CUSR0000SAH1", "Shelter CPI"),
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
  if (datasets.length === 0 && fs.existsSync(seriesFallbackPath)) {
    const fallback = readJson(seriesFallbackPath);
    return {
      ...fallback,
      generated_at: nowIso(),
      fallback: true,
      fallback_reason: "All live serverless fetches failed in deployment runtime",
      errors
    };
  }
  if (fs.existsSync(seriesFallbackPath)) {
    const fallback = readJson(seriesFallbackPath);
    const present = new Set(datasets.map((item) => item.id));
    for (const fallbackDataset of fallback.datasets || []) {
      if (present.has(fallbackDataset.id)) continue;
      const rows = fallbackDataset.bars || fallbackDataset.points || [];
      const last = rows[rows.length - 1];
      if (!last) continue;
      datasets.push({ ...fallbackDataset, source: `${fallbackDataset.source} fallback` });
      latest_values[fallbackDataset.id] = {
        time: last.time,
        value: last.close ?? last.value,
        label: fallbackDataset.label
      };
    }
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

function latestPoint(series, id) {
  const data = dataset(series, id);
  const rows = data ? data.bars || data.points || [] : [];
  const last = rows[rows.length - 1];
  if (!last) return null;
  return {
    value: Number(last.close ?? last.value),
    time: last.time,
    as_of: dateFromSeconds(last.time),
    source: data.source,
    source_url: data.url
  };
}

function rsi14(bars) {
  if (!bars || bars.length < 15) return null;
  let gains = 0;
  let losses = 0;
  const slice = bars.slice(-15);
  for (let index = 1; index < slice.length; index += 1) {
    const diff = Number(slice[index].close) - Number(slice[index - 1].close);
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function pvtValue(bars) {
  if (!bars || bars.length < 2) return null;
  let pvt = 0;
  for (let index = 1; index < bars.length; index += 1) {
    const prev = Number(bars[index - 1].close);
    if (!prev) continue;
    pvt += ((Number(bars[index].close) - prev) / prev) * Number(bars[index].volume || 0);
  }
  return pvt;
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
      FoodCPI: latest(series, "fred_cpiufdsl"),
      ShelterCPI: latest(series, "fred_cusr0000sah1"),
      NFP: latest(series, "fred_payems"),
      AverageHourlyEarnings: latest(series, "fred_ces0500000003")
    },
    read: "PCx6Yyz2/SOZBShSh/SZgxmcm8 기준으로 DXY·금리·VIX가 올라가면 온체인 지지가 있어도 조기 롱 신뢰도를 낮춘다."
  };
}

function evidenceCatalog() {
  return {
    series_btc_1h: {
      type: "live_series",
      label: "BTC 1시간봉",
      use: "현재가, 고저점, 거래량 프로파일, RSI/PVT 산출"
    },
    series_vix_dff_dgs10: {
      type: "live_series",
      label: "VIX/Fed Funds/10Y/FRED 매크로 묶음",
      use: "위험회피 압력과 금리 민감도 판정"
    },
    indicator_traversal_records: {
      type: "agent_state",
      label: "지표 전수 순회 records",
      use: "55개 registry 항목별 값/출처/차트 역할/상태 확인"
    },
    ats_whale_external: {
      type: "external_chart",
      label: "ATS/고래 거래소 흐름",
      use: "계정 차트에서 매집/분산 여부 갱신"
    },
    doc_pc_supply: {
      type: "source_document",
      label: "PCx6Yyz2 수급·비용기준 분석",
      use: "고래 분산, LTH 흡수, STH 손실권, RP/난이도 바닥 모델"
    },
    doc_soz_detox: {
      type: "source_document",
      label: "SOZBShSh 디톡스·URPD 분석",
      use: "신규 유입, 수수료, CDD/SVAB/URPD/STH 손익"
    },
    doc_004_macro: {
      type: "source_document",
      label: "004 매크로 차트",
      use: "CPI/유가/RSI/PVT와 위험자산 압력"
    },
    doc_005_holder: {
      type: "source_document",
      label: "005 HODL/RHODL/LTH-STH 공급",
      use: "장기 보유자 흡수와 휴면 공급 판정"
    }
  };
}

function sourceImageMapping() {
  if (!fs.existsSync(sourceImageMappingPath)) return {};
  return readJson(sourceImageMappingPath);
}

function manualSnapshots() {
  if (!fs.existsSync(manualSnapshotsPath)) return { metrics: [] };
  return readJson(manualSnapshotsPath);
}

function snapshotById(snapshots, id) {
  return (snapshots.metrics || []).find((item) => item.id === id) || {};
}

function onchainArtifacts(price) {
  const current = Number(price.current || 0);
  const snapshotAsOf = "2026-06-25";
  const snapshots = manualSnapshots();
  const snap = (id) => snapshotById(snapshots, id);
  const models = [
    {
      id: "onchain_rp",
      label: "Realized Price",
      value_usd: snap("onchain_rp").value ?? 53800,
      as_of: snap("onchain_rp").as_of || snapshotAsOf,
      source: snap("onchain_rp").source || "Bitbo/MacroMicro 공개 차트 수동 스냅샷",
      source_url: snap("onchain_rp").source_url || "https://charts.bitbo.io/realized-price/",
      confidence: snap("onchain_rp").confidence || "medium",
      chart_role: "horizontal_price_line",
      metric_status: snap("onchain_rp").metric_status || "manual_snapshot",
      interpretation: "현물 가격이 이탈하면 전체 시장 평균 취득가 부근의 깊은 지지 검증으로 본다."
    },
    {
      id: "onchain_sth_rp",
      label: "STH Realized Price",
      value_usd: snap("onchain_sth_rp").value ?? 70300,
      as_of: snap("onchain_sth_rp").as_of || snapshotAsOf,
      source: snap("onchain_sth_rp").source || "MacroMicro/Bitbo 공개 차트 수동 스냅샷",
      source_url: snap("onchain_sth_rp").source_url || "https://charts.bitbo.io/sth-realized-price/",
      confidence: snap("onchain_sth_rp").confidence || "medium",
      chart_role: "horizontal_price_line",
      metric_status: snap("onchain_sth_rp").metric_status || "manual_snapshot",
      interpretation: "최근 매수자 본전 매물 저항이다. 회복 전 반등은 손실권 반등으로 분류한다."
    },
    {
      id: "onchain_lth_rp",
      label: "LTH Realized Price",
      value_usd: snap("onchain_lth_rp").value ?? 49800,
      as_of: snap("onchain_lth_rp").as_of || snapshotAsOf,
      source: snap("onchain_lth_rp").source || "MacroMicro/Bitbo 공개 차트 수동 스냅샷",
      source_url: snap("onchain_lth_rp").source_url || "https://charts.bitbo.io/lth-realized-price/",
      confidence: snap("onchain_lth_rp").confidence || "medium",
      chart_role: "horizontal_price_line",
      metric_status: snap("onchain_lth_rp").metric_status || "manual_snapshot",
      interpretation: "깊은 하락 시 장기 보유자 비용기준 지지 후보로 사용한다."
    },
    {
      id: "onchain_balanced",
      label: "Balanced Price",
      value_usd: snap("onchain_balanced").value ?? Math.round((current || 60000) * 0.67 / 100) * 100,
      as_of: snap("onchain_balanced").as_of || null,
      source: snap("onchain_balanced").source || "Bitbo/BGeometrics 모델 차트 기반 임시 산출",
      source_url: snap("onchain_balanced").source_url || "https://charts.bitbo.io/balanced-price/",
      confidence: snap("onchain_balanced").confidence || "low",
      chart_role: "horizontal_price_line",
      metric_status: snap("onchain_balanced").metric_status || "proxy",
      interpretation: "Capitulation 동반 시 극단 하단 모델로만 사용하고 단독 매수 근거로 쓰지 않는다."
    },
    {
      id: "onchain_cvdd",
      label: "CVDD",
      value_usd: snap("onchain_cvdd").value ?? Math.round((current || 60000) * 0.65 / 100) * 100,
      as_of: snap("onchain_cvdd").as_of || null,
      source: snap("onchain_cvdd").source || "Bitbo/BGeometrics CVDD 공개 차트 기반 임시 산출",
      source_url: snap("onchain_cvdd").source_url || "https://charts.bitbo.io/cvdd/",
      confidence: snap("onchain_cvdd").confidence || "low",
      chart_role: "horizontal_price_line",
      metric_status: snap("onchain_cvdd").metric_status || "proxy",
      interpretation: "역사적 바닥권에서만 의미가 커지는 꼬리 리스크 하단이다."
    },
    {
      id: "onchain_difficulty_regression",
      label: "Difficulty Regression",
      value_usd: snap("onchain_difficulty_regression").value ?? Math.round((current || 60000) * 0.74 / 100) * 100,
      as_of: snap("onchain_difficulty_regression").as_of || null,
      source: snap("onchain_difficulty_regression").source || "Bitbo difficulty estimate 공개 차트 기반 임시 산출",
      source_url: snap("onchain_difficulty_regression").source_url || "https://charts.bitbo.io/difficulty-estimate/",
      confidence: snap("onchain_difficulty_regression").confidence || "low",
      chart_role: "horizontal_price_line",
      metric_status: snap("onchain_difficulty_regression").metric_status || "proxy",
      interpretation: "채굴 생산비용 계열 지지 후보이며 RP와 가까워질수록 바닥 신뢰도가 오른다."
    }
  ].map((model) => ({
    ...model,
    stale_days: model.as_of ? staleDays(model.as_of) : null,
    status: model.metric_status === "manual_snapshot" ? "public_snapshot" : "model_estimate_needs_account_refresh"
  }));

  const bands = [
    {
      id: "proxy_sth_cost_resistance",
      label: "STH 비용기준/본전 매물대",
      low: 67000,
      high: 70300,
      band_type: "cost_basis_proxy",
      metric_status: "proxy",
      role: "resistance",
      density: "high",
      evidence_id: "onchain_sth_rp",
      status: "cost_basis_proxy",
      interpretation: "회복 전까지 최근 매수자 본전 매도 압력이 나오기 쉬운 구간이다."
    },
    {
      id: "proxy_near_price_defense",
      label: "현재가 인근 단기 방어 밴드",
      low: Math.round((current * 0.985) / 100) * 100,
      high: Math.round((current * 1.01) / 100) * 100,
      band_type: "volume_profile_proxy",
      metric_status: "proxy",
      role: "support",
      density: "medium",
      evidence_id: "series_btc_1h",
      status: "volume_profile_proxy",
      interpretation: "최근 10일 거래량 프로파일과 현재가 인근 방어선이다."
    },
    {
      id: "proxy_realized_price_support",
      label: "Realized Price 지지 밴드",
      low: 53600,
      high: 54000,
      band_type: "cost_basis_proxy",
      metric_status: "proxy",
      role: "support",
      density: "high",
      evidence_id: "onchain_rp",
      status: "cost_basis_proxy",
      interpretation: "60K 이탈 시 전체 시장 평균 취득가 지지 검증 구간이다."
    },
    {
      id: "proxy_lth_cost_support",
      label: "LTH 비용기준 지지 밴드",
      low: 49000,
      high: 50000,
      band_type: "cost_basis_proxy",
      metric_status: "proxy",
      role: "support",
      density: "high",
      evidence_id: "onchain_lth_rp",
      status: "cost_basis_proxy",
      interpretation: "장기 보유자 비용기준으로, 구조적 하락 시 마지막 방어 후보 중 하나다."
    }
  ];

  const markers = [
    {
      id: "event_macro_pressure",
      time: price.last_time,
      position: "aboveBar",
      color: "#f85149",
      shape: "arrowDown",
      text: "Macro check",
      evidence_id: "series_vix_dff_dgs10",
      metric_status: "live_value",
      status: "derived_from_fred"
    },
    {
      id: "event_ats_whale_check",
      time: price.last_time,
      position: "belowBar",
      color: "#d29922",
      shape: "circle",
      text: "ATS/Whale refresh",
      evidence_id: "ats_whale_external",
      metric_status: "missing",
      status: "external_chart_required"
    }
  ];

  const lowerPanels = [
    { id: "panel_liveliness", label: "Liveliness", status: "external_chart_required", metric_status: snap("liveliness").metric_status || "missing", chart_role: "lower_panel", source_url: snap("liveliness").source_url || "https://checkonchain.com/", briefing_use: "휴면 공급이 깨어나는 분산인지 확인" },
    { id: "panel_cdd", label: "CDD-90 / Revived Supply", status: "external_chart_required", metric_status: snap("cdd_90").metric_status || "missing", chart_role: "lower_panel", source_url: snap("cdd_90").source_url || "https://checkonchain.com/", briefing_use: "오래된 코인 이동 증가 시 하락 리스크 가중" },
    { id: "panel_rhodl", label: "RHODL / HODL Waves", status: "external_chart_required", metric_status: snap("rhodl").metric_status || "missing", chart_role: "lower_panel", source_url: snap("rhodl").source_url || "https://charts.bitbo.io/2y-hodl-wave/", briefing_use: "사이클 과열/저평가와 장기 보유자 흡수 확인" },
    { id: "panel_ats", label: "ATS / Wallet Cohorts", status: "external_chart_required", metric_status: snap("ats").metric_status || "missing", chart_role: "status_badge", source_url: snap("ats").source_url || "https://studio.glassnode.com/charts/indicators.AccumulationTrendScore", briefing_use: "고래·새우·상어 코호트별 매집/분산 판정" }
  ];
  return { onchain_price_models: models, price_bands: bands, event_markers: markers, lower_panels: lowerPanels, manual_snapshots: snapshots };
}

function localMetricRecord(item, groupName, series, price) {
  const byIndicator = new Map([
    ["BTC 현물 OHLC", "binance_btcusdt_1h"],
    ["달러지수 대체 Broad Dollar Index", "fred_dtwexbgs"],
    ["VIX", "fred_vixcls"],
    ["WTI/Brent 원유", "fred_wtisplc"],
    ["CPI headline", "fred_cpiaucsl"],
    ["Core CPI", "fred_cpilfesl"],
    ["식료품 CPI", "fred_cpiufdsl"],
    ["주거 CPI", "fred_cusr0000sah1"],
    ["고용 NFP", "fred_payems"],
    ["시간당 임금", "fred_ces0500000003"],
    ["Fed Funds/정책금리", "fred_dff"],
    ["10년물 금리", "fred_dgs10"]
  ]);
  const id = byIndicator.get(item.indicator);
  if (id) {
    const point = latestPoint(series, id);
    return {
      indicator: item.indicator,
      group: groupName,
      status: point ? "ok" : "missing",
      metric_status: point ? "live_value" : "missing",
      value: point ? point.value : null,
      unit: item.indicator.includes("BTC") ? "USD" : "index/rate",
      as_of: point ? point.as_of : null,
      source: point ? point.source : item.provider,
      source_url: point ? point.source_url : item.url,
      scale_type: item.indicator.includes("BTC") ? "price" : "separate_or_zscore",
      chart_role: item.indicator.includes("BTC") ? "main_price_chart" : "macro_panel_zscore",
      interpretation: "공개 데이터로 자동 수집되어 장 시작 브리핑에 직접 사용된다.",
      briefing_use: "현재값, 변화율, 위험선호/위험회피 압력 판정"
    };
  }
  const btc = dataset(series, "binance_btcusdt_1h");
  const bars = btc ? btc.bars : [];
  if (item.indicator === "RSI(14)") {
    return {
      indicator: item.indicator,
      group: groupName,
      status: "ok",
      metric_status: "live_value",
      value: Number(rsi14(bars)?.toFixed(2)),
      unit: "0-100",
      as_of: dateFromSeconds(price.last_time),
      source: "tv_local derived from BTC 1H",
      source_url: "https://www.tradingview.com/chart/?symbol=BINANCE:BTCUSDT",
      scale_type: "oscillator",
      chart_role: "lower_panel",
      interpretation: "004 문서처럼 매크로 압력 구간의 과매도/반등 탄력을 확인한다.",
      briefing_use: "단기 추격 금지/반등 확인 보조"
    };
  }
  if (item.indicator === "PVT") {
    return {
      indicator: item.indicator,
      group: groupName,
      status: "ok",
      metric_status: "live_value",
      value: Number(pvtValue(bars)?.toFixed(3)),
      unit: "derived",
      as_of: dateFromSeconds(price.last_time),
      source: "tv_local derived from BTC 1H",
      source_url: "https://www.tradingview.com/chart/?symbol=BINANCE:BTCUSDT",
      scale_type: "separate_axis",
      chart_role: "lower_panel",
      interpretation: "가격 대비 거래량 누적 흐름으로 반등의 질을 보조 판정한다.",
      briefing_use: "거래량이 동반된 회복인지 확인"
    };
  }
  return null;
}

function artifactRecord(item, groupName, artifacts) {
  const indicator = item.indicator.toLowerCase();
  let target = null;
  if (indicator.includes("urpd")) target = artifacts.price_bands.find((entry) => entry.id === "proxy_sth_cost_resistance");
  if (indicator.includes("accumulation trend") || indicator.includes("ats")) target = artifacts.lower_panels.find((entry) => entry.id === "panel_ats");
  if (indicator.includes("liveliness")) target = artifacts.lower_panels.find((entry) => entry.id === "panel_liveliness");
  if (indicator.includes("cdd") || indicator.includes("revived")) target = artifacts.lower_panels.find((entry) => entry.id === "panel_cdd");
  if (indicator.includes("hodl") || indicator.includes("rhodl")) target = artifacts.lower_panels.find((entry) => entry.id === "panel_rhodl");
  target ||= [...artifacts.onchain_price_models, ...artifacts.price_bands, ...artifacts.lower_panels].find((entry) => {
    const name = `${entry.label || ""} ${entry.id || ""}`.toLowerCase();
    return name.includes(indicator.replace(/\[[^\]]+\]/g, "").split(" ")[0]);
  });
  if (!target) return null;
  return {
    indicator: item.indicator,
    group: groupName,
    status: target.status || "mapped",
    metric_status: target.metric_status || (target.value_usd ? "manual_snapshot" : "proxy"),
    value: target.value_usd ?? `${target.low || ""}-${target.high || ""}`,
    unit: target.value_usd ? "USD" : "band/status",
    as_of: target.as_of || null,
    source: target.source || item.provider,
    source_url: target.source_url || item.url,
    scale_type: target.value_usd ? "price" : "status_or_band",
    chart_role: target.chart_role || "dashboard_status",
    interpretation: target.interpretation || target.briefing_use,
    briefing_use: target.interpretation || target.briefing_use
  };
}

function indicatorTraversal(registry, series, price, artifacts) {
  const records = [];
  for (const group of registry.groups || []) {
    for (const item of group.items || []) {
      const local = localMetricRecord(item, group.name, series, price);
      const artifact = local || artifactRecord(item, group.name, artifacts);
      records.push(artifact || {
        indicator: item.indicator,
        group: group.name,
        status: item.local_status === "external_chart" ? "external_chart_required" : "mapped_no_value",
        metric_status: "missing",
        value: null,
        unit: null,
        as_of: null,
        source: item.provider,
        source_url: item.url,
        scale_type: item.local_status === "external_chart" ? "external_or_account" : "separate_axis",
        chart_role: item.local_status === "external_chart" ? "source_link_and_manual_refresh" : "dashboard_status",
        interpretation: "현재 Vercel 자동 수집에는 없으나 공급처 링크와 차트 역할이 registry에 고정되어 있다.",
        briefing_use: "계정/무료 웹 차트 확인 후 브리핑 신뢰도와 시나리오 확률을 갱신"
      });
    }
  }
  const groups = {};
  for (const record of records) {
    groups[record.group] ||= { total: 0, ok: 0, external: 0, estimated: 0, missing: 0 };
    groups[record.group].total += 1;
    if (record.metric_status === "live_value" || record.metric_status === "manual_snapshot") groups[record.group].ok += 1;
    else if (record.metric_status === "proxy") groups[record.group].estimated += 1;
    else if (record.metric_status === "missing") groups[record.group].external += 1;
    else groups[record.group].missing += 1;
  }
  return {
    summary: Object.entries(groups).map(([group, counts]) => ({ group, ...counts })),
    records
  };
}

function priceLevels(price, macro, artifacts) {
  if (price.error) return [];
  const current = price.current;
  const ranges = price.ranges;
  const levels = [
    { price: roundLevel(ranges["10d_low"]), kind: "support", label: "10일 저점, 실패 시 추세 가속 후보", evidence: "최근 가격 구조 기반. actual URPD는 missing이므로 Realized Price와 가격 구조만 단기 지지 후보로 쓴다.", evidence_ids: ["series_btc_1h"] },
    ...price.nearest_volume_nodes.map((node) => ({
      price: node.price,
      kind: node.price < current ? "support" : "resistance",
      label: "거래량 프로파일 매물대",
      evidence: node.evidence,
      evidence_ids: ["series_btc_1h"]
    })),
    { price: roundLevel(ranges["72h_high"]), kind: "resistance", label: "72시간 고점 저항", evidence: "STH Realized Price와 actual URPD 상단 매물대가 같이 확인될 때만 신뢰도를 올린다.", evidence_ids: ["series_btc_1h", "onchain_sth_rp"] },
    { price: roundLevel(ranges["10d_high"]), kind: "resistance", label: "10일 고점, 회복 시 구조 전환 확인", evidence: "중기 박스 상단 후보.", evidence_ids: ["series_btc_1h"] }
  ];
  for (const model of artifacts.onchain_price_models || []) {
    levels.push({
      price: model.value_usd,
      kind: model.value_usd < current ? "support" : "resistance",
      label: model.label,
      evidence: model.interpretation,
      evidence_ids: [model.id],
      confidence: model.confidence,
      as_of: model.as_of,
      chart_role: model.chart_role,
      metric_status: model.metric_status
    });
  }
  if (macro.pressure_score >= 3) {
    levels.push({ price: roundLevel(current - Math.max(price.atr_1h_proxy * 8, current * 0.03)), kind: "support", label: "매크로 압박 시 꼬리 리스크 하단", evidence: "VIX/금리/달러 압력 강세 시 ATR 기반 임시 하단.", evidence_ids: ["series_vix_dff_dgs10"] });
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
      response: "분할 접근. 반등이 STH 비용기준에 막히는지 확인하되, actual URPD와 거래소 순유입은 missing이므로 확인 전까지 비중을 제한한다."
      , evidence_ids: ["series_btc_1h", "onchain_sth_rp", "proxy_sth_cost_resistance"]
    },
    {
      name: "상방: 매크로 진정 + 매집 확인",
      probability: "30%",
      trigger: `VIX·금리·달러 압력 완화와 함께 ${firstResistance.toLocaleString()} 돌파`,
      support: `${firstResistance.toLocaleString()} 돌파 후 지지 전환`,
      resistance: highResistance.toLocaleString(),
      response: "돌파 추격보다 재테스트 확인. ATS/거래소 순유출/LTH 공급 증가가 동반되면 레버리지 허용폭을 키운다."
      , evidence_ids: ["series_vix_dff_dgs10", "panel_ats", "doc_pc_supply"]
    },
    {
      name: "하방: 지지 공백 재가격화",
      probability: "25%",
      trigger: `${firstSupport.toLocaleString()} 이탈 + VIX/금리/달러 압력 재상승`,
      support: deepSupport.toLocaleString(),
      resistance: `${firstSupport.toLocaleString()} 이탈 후 저항 전환`,
      response: "롱 대기. actual URPD 공백, STH 손실 확대, 고래 거래소 순입금은 현재 missing이므로 확인 전까지 다음 비용기준 지지 후보만 열어둔다."
      , evidence_ids: ["proxy_realized_price_support", "onchain_rp", "ats_whale_external"]
    }
  ];
}

function horizons(price, macro, levels) {
  const supports = levels.filter((level) => level.kind === "support" && level.price <= price.current).sort((a, b) => b.price - a.price);
  const resistances = levels.filter((level) => level.kind === "resistance" && level.price >= price.current).sort((a, b) => a.price - b.price);
  const support = supports[0]?.price || roundLevel(price.current * 0.97);
  const resistance = resistances[0]?.price || roundLevel(price.current * 1.03);
  return [
    {
      horizon: "H0 4H",
      bias: macro.pressure_score >= 3 ? "방어 우위" : "단기 반등 검증",
      support,
      resistance,
      invalidation: support,
      required_confirmations: ["1시간봉 종가 방어", "VIX 급등 부재", "PVT/거래량 동반"],
      data_staleness: "BTC/FRED live, 일부 온체인 공개 스냅샷",
      confidence: "medium",
      evidence_ids: ["series_btc_1h", "series_vix_dff_dgs10"]
      , used_metrics: ["BTC 1H live", "VIX live", "Fed Funds live", "10Y live", "RSI/PVT derived"]
      , missing_metrics: ["ATS", "Exchange Net Position Change", "actual URPD"]
      , confidence_reason: "단기 가격·매크로는 live_value이나 수급 온체인은 missing이어서 medium으로 제한"
    },
    {
      horizon: "H1 24H",
      bias: "STH 비용기준 아래 손실권 반등 여부 확인",
      support,
      resistance: Math.max(resistance, 67000),
      invalidation: support * 0.985,
      required_confirmations: ["actual URPD 현재가 아래 공백 여부", "거래소 순유입 감소", "STH RP 회복 여부"],
      data_staleness: "URPD/ATS는 계정 차트 갱신 필요",
      confidence: "medium-low",
      evidence_ids: ["onchain_sth_rp", "proxy_sth_cost_resistance", "ats_whale_external"]
      , used_metrics: ["STH RP manual_snapshot", "BTC 1H live", "cost basis proxy band"]
      , missing_metrics: ["actual entity-adjusted URPD", "ATS wallet cohort", "whale exchange netflow"]
      , confidence_reason: "STH RP는 manual_snapshot, URPD/ATS는 missing/proxy라 medium-low"
    },
    {
      horizon: "H2 3D",
      bias: "RP 지지 재검증 가능성 열어둠",
      support: 53800,
      resistance: 70300,
      invalidation: 53600,
      required_confirmations: ["Realized Price 접근 시 반응", "CDD/Revived Supply 급증 부재", "달러/금리 안정"],
      data_staleness: "RP/LTH RP 공개 스냅샷 수동 갱신 필요",
      confidence: "medium-low",
      evidence_ids: ["onchain_rp", "panel_cdd", "series_vix_dff_dgs10"]
      , used_metrics: ["Realized Price manual_snapshot", "VIX/Fed/10Y live"]
      , missing_metrics: ["CDD-90", "Revived Supply", "SVAB 6M+"]
      , confidence_reason: "RP는 수동 스냅샷이고 코인 나이 지표가 missing이라 medium-low"
    },
    {
      horizon: "H3 7D~next week",
      bias: "깊은 조정 시 LTH 비용기준과 CVDD/Balanced 꼬리 리스크",
      support: 49800,
      resistance: 70300,
      invalidation: 49000,
      required_confirmations: ["LTH RP 이탈 여부", "CVDD/Balanced 접근 여부", "ATS 코호트 매집 전환"],
      data_staleness: "극단 모델은 현재 수동/모델 추정",
      confidence: "low",
      evidence_ids: ["onchain_lth_rp", "onchain_cvdd", "onchain_balanced", "panel_ats"]
      , used_metrics: ["LTH RP manual_snapshot", "CVDD proxy", "Balanced proxy"]
      , missing_metrics: ["Difficulty actual", "ATS", "HODL Waves/RHODL actual"]
      , confidence_reason: "극단 하단 모델 대부분이 proxy라 low"
    }
  ];
}

function briefingSections(price, macro, traversal, levels) {
  const levelText = levels.slice(0, 8).map((level) => `${level.label} ${Number(level.price).toLocaleString()}`).join(", ");
  return [
    { heading: "1. 매크로 관문", body: `${macro.label}. VIX, 금리, 달러지수 대체값을 우선 확인한다. ${macro.read}`, evidence_ids: ["series_vix_dff_dgs10", "doc_004_macro"] },
    { heading: "2. 가격·매물대", body: `현재가는 ${Number(price.current).toLocaleString()} 부근이다. 최근 1시간봉 고저점과 거래량 프로파일 기준 주요 가격대는 ${levelText}이다.`, evidence_ids: ["series_btc_1h"] },
    { heading: "3. 온체인 비용기준·바닥 모델", body: "Realized Price, STH/LTH Realized Price는 manual_snapshot으로만 브리핑 근거에 사용한다. Balanced/CVDD/Difficulty는 proxy라 실제 바닥 확정 근거가 아니라 꼬리 리스크 참고선으로만 표시한다.", evidence_ids: ["onchain_rp", "onchain_sth_rp", "onchain_lth_rp", "onchain_cvdd", "onchain_balanced", "doc_pc_supply"] },
    { heading: "4. 수급·코인 나이", body: "ATS, 고래 거래소 순유입, Liveliness, HODL Waves, CDD, Revived Supply는 현재 missing이다. 005/036 문서 논리는 유지하되, 값이 들어오기 전까지 시나리오 확률 산식에서는 확인 필요 리스크로만 처리한다.", evidence_ids: ["panel_ats", "panel_cdd", "panel_liveliness", "doc_005_holder"] },
    { heading: "5. 차트 오버레이", body: "BTC 차트 위에는 RP/STH RP/LTH RP/CVDD/Balanced Price를 수평 가격선으로 표시한다. 실제 URPD는 missing이며, 현재 배경 밴드는 cost_basis_proxy와 volume_profile_proxy로 분리 표기한다.", evidence_ids: ["proxy_sth_cost_resistance", "proxy_realized_price_support"] },
    { heading: "6. 전수 순회 상태", body: traversal.summary.map((row) => `${row.group}: ${row.total}개 중 자동/스냅샷 ${row.ok}개, 추정 ${row.estimated}개, 외부확인 ${row.external}개`).join(" / "), evidence_ids: ["indicator_traversal_records"] }
  ];
}

function oneLiner(price, macro, levels) {
  const supports = levels.filter((level) => level.kind === "support" && level.price <= price.current).map((level) => level.price);
  const resistances = levels.filter((level) => level.kind === "resistance" && level.price >= price.current).map((level) => level.price);
  const support = supports.length ? Math.max(...supports) : null;
  const resistance = resistances.length ? Math.min(...resistances) : null;
  const supportText = support === null ? "확인 필요" : Number(support).toLocaleString();
  const resistanceText = resistance === null ? "확인 필요" : Number(resistance).toLocaleString();
  return `BTC는 ${Number(price.current).toLocaleString()} 부근, 매크로 판정은 \`${macro.label}\`. 가까운 지지는 ${supportText}. 가까운 저항은 ${resistanceText}. 비용기준은 manual_snapshot, actual URPD·고래 거래소 순유입은 missing으로 분리해 신뢰도를 제한한다.`;
}

function deterministicBriefing(registry, series, session = "vercel_live") {
  const price = priceContext(series);
  const macro = macroContext(series);
  const artifacts = onchainArtifacts(price);
  const traversal = indicatorTraversal(registry, series, price, artifacts);
  const levels = priceLevels(price, macro, artifacts);
  let bias = "중립";
  if (macro.pressure_score >= 3) bias = "위험회피/방어 우위";
  else if (levels.length) bias = "하단 지지 근접";
  return {
    generated_at: nowIso(),
    session,
    template_version: "yonsei_4doc_macro_onchain_v1_vercel",
    agent_chain: {
      deterministic_pass: "completed",
      qwen: { mode: "local_qwen_only", configured: false, status: "skipped_in_vercel", reason: "Vercel 배포본은 외부 Qwen API를 호출하지 않는다. 로컬 루프에서 127.0.0.1:9223 라우터를 사용한다." },
      oracle: { requested: false, status: "external_review_loop" }
    },
    summary: {
      title: `${session} 장 시작 온체인·매크로 브리핑`,
      bias,
      one_liner: oneLiner(price, macro, levels)
    },
    evidence_catalog: evidenceCatalog(),
    source_image_mapping: sourceImageMapping(),
    contexts: { price, macro, indicator_traversal: traversal },
    ...artifacts,
    price_levels: levels,
    horizons: horizons(price, macro, levels),
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

async function qwenEnhance(briefing) {
  briefing.agent_chain.qwen = {
    mode: "local_qwen_only",
    configured: false,
    status: "skipped_in_vercel",
    reason: "외부 Qwen API는 사용하지 않는다. Qwen 보강은 로컬 loop_research_agents 방식의 127.0.0.1:9223 라우터에서만 실행한다."
  };
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

function appendCronRun(run) {
  try {
    fs.appendFileSync(cronHistoryPath, `${JSON.stringify(run)}\n`, "utf8");
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
  return { ok: true };
}

function readCronRuns(limit = 12) {
  try {
    if (!fs.existsSync(cronHistoryPath)) return fallbackCronRuns();
    const rows = fs.readFileSync(cronHistoryPath, "utf8").trim().split(/\n/).filter(Boolean).slice(-limit).map((line) => JSON.parse(line));
    return rows.length ? rows : fallbackCronRuns();
  } catch {
    return fallbackCronRuns();
  }
}

function fallbackCronRuns() {
  return [
    {
      ran_at: nowIso(),
      session: "history_runtime_fallback",
      status: "no_shared_tmp_history",
      note: "Vercel 함수 인스턴스가 분리되면 /api/cron의 /tmp 기록을 /api/history가 읽지 못할 수 있다. 영구 히스토리는 다음 단계에서 KV/Postgres로 이전한다."
    }
  ];
}

module.exports = {
  appendCronRun,
  buildBriefing,
  buildSeries,
  readCronRuns,
  readJson,
  registryPath,
  schedulePath,
  seriesFallbackPath,
  sendJson
};
