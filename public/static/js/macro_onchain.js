(function () {
  const api = {
    registry: "/api/registry",
    series: "/api/series",
    briefing: "/api/briefing",
    schedule: "/api/schedule",
  };

  const colors = {
    bg: "#161b22",
    grid: "rgba(255,255,255,0.07)",
    text: "#d7dce2",
    up: "#22ab94",
    down: "#f23645",
    blue: "#58a6ff",
    yellow: "#d29922",
    green: "#3fb950",
    red: "#f85149",
    purple: "#bc8cff",
  };

  const state = {
    registry: null,
    series: null,
    briefing: null,
    schedule: null,
    activeGroup: 0,
    charts: [],
    btcSeries: null,
    btcChartApi: null,
  };

  const els = {
    status: document.getElementById("status"),
    snapshotGrid: document.getElementById("snapshotGrid"),
    groupButtons: document.getElementById("groupButtons"),
    sourceTitle: document.getElementById("sourceTitle"),
    sourceTable: document.getElementById("sourceTable"),
    btcChart: document.getElementById("btcChart"),
    riskChart: document.getElementById("riskChart"),
    macroChart: document.getElementById("macroChart"),
    briefingMeta: document.getElementById("briefingMeta"),
    briefingSummary: document.getElementById("briefingSummary"),
    briefingSections: document.getElementById("briefingSections"),
    scenarioList: document.getElementById("scenarioList"),
    scheduleMeta: document.getElementById("scheduleMeta"),
    sourceImages: document.getElementById("sourceImages"),
    onchainModels: document.getElementById("onchainModels"),
    lowerPanels: document.getElementById("lowerPanels"),
    horizonList: document.getElementById("horizonList"),
    traversalTable: document.getElementById("traversalTable"),
  };

  function makeChart(container) {
    const chart = LightweightCharts.createChart(container, {
      autoSize: true,
      layout: {
        background: { color: colors.bg },
        textColor: colors.text,
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.18)",
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.18)",
        timeVisible: true,
      },
    });
    state.charts.push(chart);
    return chart;
  }

  function dataset(id) {
    return (state.series.datasets || []).find((item) => item.id === id);
  }

  function renderBtcChart() {
    const data = dataset("binance_btcusdt_1h");
    const chart = makeChart(els.btcChart);
    state.btcChartApi = chart;
    if (!data || !data.bars || !data.bars.length) {
      return;
    }
    const candles = chart.addCandlestickSeries({
      upColor: colors.up,
      downColor: colors.down,
      borderVisible: false,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
    });
    state.btcSeries = candles;
    candles.setData(data.bars);
    renderEventMarkers(candles);
    renderPriceLines();
    chart.timeScale().fitContent();
    setTimeout(renderPriceBands, 80);
  }

  function renderPriceLines() {
    if (!state.btcSeries || !state.briefing || !Array.isArray(state.briefing.price_levels)) {
      return;
    }
    for (const level of state.briefing.price_levels) {
      state.btcSeries.createPriceLine({
        price: Number(level.price),
        color: level.chart_role === "horizontal_price_line" ? colors.purple : level.kind === "support" ? colors.green : colors.red,
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${level.kind === "support" ? "S" : "R"} ${level.label || ""}`.slice(0, 28),
      });
    }
  }

  function renderEventMarkers(candles) {
    const markers = ((state.briefing && state.briefing.event_markers) || [])
      .filter((item) => item.time)
      .map((item) => ({
        time: item.time,
        position: item.position || "aboveBar",
        color: item.color || colors.yellow,
        shape: item.shape || "circle",
        text: item.text || item.id,
      }));
    if (markers.length && typeof candles.setMarkers === "function") {
      candles.setMarkers(markers);
    }
  }

  function renderPriceBands() {
    if (!state.btcSeries || !state.briefing || !Array.isArray(state.briefing.price_bands)) {
      return;
    }
    let overlay = els.btcChart.querySelector(".price-band-layer");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "price-band-layer";
      els.btcChart.appendChild(overlay);
    }
    overlay.replaceChildren();
    for (const band of state.briefing.price_bands) {
      const high = state.btcSeries.priceToCoordinate(Number(band.high));
      const low = state.btcSeries.priceToCoordinate(Number(band.low));
      if (high === null || low === null) {
        continue;
      }
      const top = Math.min(high, low);
      const height = Math.max(8, Math.abs(low - high));
      const node = document.createElement("div");
      node.className = `price-band ${band.role || "neutral"}`;
      node.style.top = `${top}px`;
      node.style.height = `${height}px`;
      node.innerHTML = `<span>${band.label}</span>`;
      overlay.appendChild(node);
    }
  }

  function addLine(chart, data, color) {
    if (!data || !data.points || !data.points.length) {
      return null;
    }
    const line = chart.addLineSeries({
      color,
      lineWidth: 2,
      priceLineVisible: false,
    });
    line.setData(data.points);
    return line;
  }

  function zscoreDataset(data) {
    if (!data || !data.points || data.points.length < 3) {
      return data;
    }
    const values = data.points.map((point) => Number(point.value)).filter((value) => Number.isFinite(value));
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const sd = Math.sqrt(variance) || 1;
    return {
      ...data,
      label: `${data.label} z-score`,
      points: data.points.map((point) => ({
        time: point.time,
        value: (Number(point.value) - mean) / sd,
      })),
    };
  }

  function renderRiskChart() {
    const chart = makeChart(els.riskChart);
    addLine(chart, zscoreDataset(dataset("fred_vixcls")), colors.red);
    addLine(chart, zscoreDataset(dataset("fred_dff")), colors.yellow);
    addLine(chart, zscoreDataset(dataset("fred_dgs10")), colors.blue);
    chart.timeScale().fitContent();
  }

  function renderMacroChart() {
    const chart = makeChart(els.macroChart);
    addLine(chart, zscoreDataset(dataset("fred_cpiaucsl")), colors.yellow);
    addLine(chart, zscoreDataset(dataset("fred_cpilfesl")), colors.red);
    addLine(chart, zscoreDataset(dataset("fred_cpiufdsl")), colors.purple);
    addLine(chart, zscoreDataset(dataset("fred_cusr0000sah1")), "#ff7b72");
    addLine(chart, zscoreDataset(dataset("fred_payems")), colors.green);
    addLine(chart, zscoreDataset(dataset("fred_dtwexbgs")), colors.blue);
    chart.timeScale().fitContent();
  }

  function formatValue(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      if (typeof value === "string" && value.trim()) {
        return value;
      }
      return "-";
    }
    const number = Number(value);
    if (Math.abs(number) >= 1000) {
      return number.toLocaleString("en-US", { maximumFractionDigits: 2 });
    }
    return number.toLocaleString("en-US", { maximumFractionDigits: 3 });
  }

  function formatDate(seconds) {
    if (!seconds) {
      return "";
    }
    return new Date(seconds * 1000).toISOString().slice(0, 10);
  }

  function renderSnapshots() {
    const ids = [
      "binance_btcusdt_1h",
      "fred_vixcls",
      "fred_dff",
      "fred_dgs10",
      "fred_dtwexbgs",
      "fred_cpiaucsl",
      "fred_cpilfesl",
      "fred_cpiufdsl",
      "fred_cusr0000sah1",
      "fred_payems",
      "fred_ces0500000003",
      "fred_wtisplc",
    ];
    els.snapshotGrid.replaceChildren(
      ...ids.map((id) => {
        const latest = state.series.latest_values[id];
        const card = document.createElement("article");
        card.className = "snapshot-card";
        if (!latest) {
          card.innerHTML = `<div class="snapshot-label">${id}</div><div class="snapshot-value">-</div>`;
          return card;
        }
        card.innerHTML = [
          `<div class="snapshot-label">${latest.label}</div>`,
          `<div class="snapshot-value">${formatValue(latest.value)}</div>`,
          `<div class="snapshot-time">${formatDate(latest.time)}</div>`,
        ].join("");
        return card;
      })
    );
  }

  function renderGroups() {
    const groups = state.registry.groups || [];
    els.groupButtons.replaceChildren(
      ...groups.map((group, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `group-button${index === state.activeGroup ? " active" : ""}`;
        button.textContent = `${group.name} (${group.items.length})`;
        button.addEventListener("click", () => {
          state.activeGroup = index;
          renderGroups();
          renderSourceTable();
        });
        return button;
      })
    );
  }

  function statusLabel(status) {
    if (status === "local_series") {
      return "로컬 차트";
    }
    if (status === "implemented_or_builtin") {
      return "구현/내장";
    }
    return "외부 무료 차트";
  }

  function renderSourceTable() {
    const group = (state.registry.groups || [])[state.activeGroup];
    if (!group) {
      els.sourceTable.innerHTML = `<div class="empty">공급처 매핑이 없습니다.</div>`;
      return;
    }
    els.sourceTitle.textContent = group.name;
    els.sourceTable.replaceChildren(
      ...group.items.map((item) => {
        const row = document.createElement("article");
        row.className = "source-row";
        row.innerHTML = [
          `<div><div class="source-name">${item.indicator}</div><div class="source-meta">${item.access}</div></div>`,
          `<div class="source-provider">${item.provider}</div>`,
          `<div><span class="status-pill ${item.local_status}">${statusLabel(item.local_status)}</span></div>`,
          `<a href="${item.url}" target="_blank" rel="noreferrer">열기</a>`,
        ].join("");
        return row;
      })
    );
  }

  function renderBriefing() {
    if (!state.briefing || !state.briefing.summary) {
      els.briefingMeta.textContent = "브리핑 없음";
      els.briefingSummary.innerHTML = `<div class="empty">브리핑 JSON이 아직 없습니다. 스케줄러를 한 번 실행하세요.</div>`;
      return;
    }
    const chain = state.briefing.agent_chain || {};
    const qwen = chain.qwen ? chain.qwen.status : "unknown";
    const oracle = chain.oracle ? chain.oracle.status : "unknown";
    els.briefingMeta.textContent = `${state.briefing.session} · ${state.briefing.generated_at} · qwen ${qwen} · oracle ${oracle}`;
    els.briefingSummary.innerHTML = [
      `<div class="briefing-bias">${state.briefing.summary.bias}</div>`,
      `<div class="briefing-line">${state.briefing.summary.one_liner}</div>`,
    ].join("");
    els.briefingSections.replaceChildren(
      ...(state.briefing.briefing_sections || []).map((section) => {
        const card = document.createElement("article");
        card.className = "briefing-section";
        const evidence = (section.evidence_ids || []).map((id) => `<span>${id}</span>`).join("");
        card.innerHTML = `<h3>${section.heading}</h3><p>${section.body}</p><div class="evidence-list">${evidence}</div>`;
        return card;
      })
    );
    els.scenarioList.replaceChildren(
      ...(state.briefing.scenarios || []).map((scenario) => {
        const card = document.createElement("article");
        card.className = "scenario-card";
        card.innerHTML = [
          `<h3>${scenario.name}</h3>`,
          `<div class="scenario-probability">${scenario.probability}</div>`,
          `<p>트리거: ${scenario.trigger}</p>`,
          `<p>지지: ${scenario.support} · 저항: ${scenario.resistance}</p>`,
          `<p>대응: ${scenario.response}</p>`,
          `<div class="evidence-list">${(scenario.evidence_ids || []).map((id) => `<span>${id}</span>`).join("")}</div>`,
        ].join("");
        return card;
      })
    );
  }

  function renderOnchainPanels() {
    if (!els.onchainModels || !state.briefing) {
      return;
    }
    const models = state.briefing.onchain_price_models || [];
    const bands = state.briefing.price_bands || [];
    const badges = state.briefing.lower_panels || [];
    els.onchainModels.replaceChildren(
      ...[...models, ...bands].map((item) => {
        const card = document.createElement("article");
        card.className = "model-card";
        const value = item.value_usd ? `$${formatValue(item.value_usd)}` : `$${formatValue(item.low)}-$${formatValue(item.high)}`;
        card.innerHTML = [
          `<div class="model-label">${item.label}</div>`,
          `<div class="model-value">${value}</div>`,
          `<div class="source-meta">${item.metric_status || ""} · ${item.status || ""} · ${item.band_type || item.confidence || item.density || ""}</div>`,
        ].join("");
        return card;
      })
    );
    els.lowerPanels.replaceChildren(
      ...badges.map((item) => {
        const badge = document.createElement("a");
        badge.className = "panel-badge";
        badge.href = item.source_url;
        badge.target = "_blank";
        badge.rel = "noreferrer";
        badge.innerHTML = `<strong>${item.label}</strong><span>${item.chart_role} · ${item.metric_status || item.status}</span>`;
        return badge;
      })
    );
  }

  function renderHorizons() {
    if (!els.horizonList || !state.briefing) {
      return;
    }
    els.horizonList.replaceChildren(
      ...(state.briefing.horizons || []).map((item) => {
        const card = document.createElement("article");
        card.className = "horizon-card";
        card.innerHTML = [
          `<h3>${item.horizon} · ${item.bias}</h3>`,
          `<p>지지 ${formatValue(item.support)} · 저항 ${formatValue(item.resistance)} · 무효화 ${formatValue(item.invalidation)}</p>`,
          `<p>${(item.required_confirmations || []).join(" / ")}</p>`,
          `<p>사용: ${(item.used_metrics || []).join(" / ")}</p>`,
          `<p>누락: ${(item.missing_metrics || []).join(" / ")}</p>`,
          `<p>${item.confidence_reason || ""}</p>`,
          `<div class="source-meta">${item.data_staleness} · confidence ${item.confidence}</div>`,
          `<div class="evidence-list">${(item.evidence_ids || []).map((id) => `<span>${id}</span>`).join("")}</div>`,
        ].join("");
        return card;
      })
    );
  }

  function renderTraversal() {
    if (!els.traversalTable || !state.briefing) {
      return;
    }
    const records = (((state.briefing.contexts || {}).indicator_traversal || {}).records || []);
    els.traversalTable.replaceChildren(
      ...records.map((item) => {
        const row = document.createElement("article");
        row.className = "traversal-row";
        row.innerHTML = [
          `<div><strong>${item.indicator}</strong><span>${item.group}</span></div>`,
          `<div>${formatValue(item.value)}</div>`,
          `<div>${item.as_of || "-"}</div>`,
          `<div><span class="status-pill ${item.metric_status || item.status}">${item.metric_status || item.status}</span><span>${item.status}</span></div>`,
          `<div>${item.chart_role}</div>`,
          `<a href="${item.source_url}" target="_blank" rel="noreferrer">${item.source}</a>`,
        ].join("");
        return row;
      })
    );
  }

  function renderSchedule() {
    const schedule = state.schedule && state.schedule.schedule;
    if (!schedule || !Array.isArray(schedule.sessions)) {
      els.scheduleMeta.textContent = "스케줄 없음";
      return;
    }
    const text = schedule.sessions.map((item) => `${item.label} ${item.time}`).join(" · ");
    els.scheduleMeta.textContent = `${schedule.timezone || "Asia/Seoul"} · ${text}`;
  }

  function renderSourceImages() {
    if (!els.sourceImages) {
      return;
    }
    const images = [
      ["004", "매크로 CPI/유가/RSI/PVT"],
      ["005", "HODL Waves/RHODL/LTH-STH 공급"],
      ["021", "ATS/고래/LTH/URPD/바닥모델"],
      ["036", "신규 유입/수수료/CDD/URPD/STH 손익"],
    ];
    const mapping = state.briefing ? state.briefing.source_image_mapping || {} : {};
    els.sourceImages.replaceChildren(
      ...images.map(([id, label]) => {
        const card = document.createElement("article");
        card.className = "source-image-card";
        const src = `/source-images/${id}_montage.jpg`;
        const map = mapping[`${id}_montage.jpg`] || {};
        const missing = (map.missing || []).slice(0, 3).join(" / ");
        card.innerHTML = [
          `<a href="${src}" target="_blank" rel="noreferrer">${id} · ${label}</a>`,
          `<img src="${src}" alt="${label}" loading="lazy" />`,
          `<div class="image-map"><strong>${map.status || "mapping"}</strong><span>반영: ${(map.implemented_as || []).join(" / ") || "-"}</span><span>누락: ${missing || "-"}</span></div>`,
        ].join("");
        return card;
      })
    );
  }

  function syncCharts() {
    for (const chart of state.charts) {
      chart.subscribeCrosshairMove((param) => {
        if (!param || !param.time) {
          return;
        }
        for (const other of state.charts) {
          if (other === chart || typeof other.setCrosshairPosition !== "function") {
            continue;
          }
          other.setCrosshairPosition(0, param.time, null);
        }
      });
    }
  }

  async function boot() {
    try {
      const [registryResponse, seriesResponse, briefingResponse, scheduleResponse] = await Promise.all([
        fetch(api.registry),
        fetch(api.series),
        fetch(api.briefing),
        fetch(api.schedule),
      ]);
      if (!registryResponse.ok || !seriesResponse.ok) {
        throw new Error("대시보드 JSON을 읽지 못했습니다.");
      }
      state.registry = await registryResponse.json();
      state.series = await seriesResponse.json();
      state.briefing = briefingResponse.ok ? await briefingResponse.json() : null;
      state.schedule = scheduleResponse.ok ? await scheduleResponse.json() : null;
      renderSnapshots();
      renderBtcChart();
      renderRiskChart();
      renderMacroChart();
      syncCharts();
      renderBriefing();
      renderOnchainPanels();
      renderHorizons();
      renderTraversal();
      renderSchedule();
      renderSourceImages();
      renderGroups();
      renderSourceTable();
      els.status.textContent = `갱신: ${state.series.generated_at}`;
    } catch (error) {
      els.status.textContent = error.message || String(error);
      els.sourceTable.innerHTML = `<div class="empty">데이터 생성 스크립트를 먼저 실행하세요.</div>`;
    }
  }

  boot();
})();
