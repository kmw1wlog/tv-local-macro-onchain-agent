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
    renderPriceLines();
    chart.timeScale().fitContent();
  }

  function renderPriceLines() {
    if (!state.btcSeries || !state.briefing || !Array.isArray(state.briefing.price_levels)) {
      return;
    }
    for (const level of state.briefing.price_levels) {
      state.btcSeries.createPriceLine({
        price: Number(level.price),
        color: level.kind === "support" ? colors.green : colors.red,
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${level.kind === "support" ? "S" : "R"} ${level.label || ""}`.slice(0, 28),
      });
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

  function renderRiskChart() {
    const chart = makeChart(els.riskChart);
    addLine(chart, dataset("fred_vixcls"), colors.red);
    addLine(chart, dataset("fred_dff"), colors.yellow);
    addLine(chart, dataset("fred_dgs10"), colors.blue);
    chart.timeScale().fitContent();
  }

  function renderMacroChart() {
    const chart = makeChart(els.macroChart);
    addLine(chart, dataset("fred_cpiaucsl"), colors.yellow);
    addLine(chart, dataset("fred_cpilfesl"), colors.red);
    addLine(chart, dataset("fred_payems"), colors.green);
    addLine(chart, dataset("fred_dtwexbgs"), colors.blue);
    chart.timeScale().fitContent();
  }

  function formatValue(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
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
        card.innerHTML = `<h3>${section.heading}</h3><p>${section.body}</p>`;
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
        ].join("");
        return card;
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
    els.sourceImages.replaceChildren(
      ...images.map(([id, label]) => {
        const card = document.createElement("article");
        card.className = "source-image-card";
        const src = `/source-images/${id}_montage.jpg`;
        card.innerHTML = `<a href="${src}" target="_blank" rel="noreferrer">${id} · ${label}</a><img src="${src}" alt="${label}" loading="lazy" />`;
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
