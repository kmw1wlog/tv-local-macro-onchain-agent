(function () {
  const { createChart, CrosshairMode, LineStyle } = LightweightCharts;
  const grid = document.getElementById("alt24Grid");
  const status = document.getElementById("alt24Status");

  const colors = {
    up: "#22ab94",
    down: "#f23645",
    text: "#d7dce2",
    grid: "rgba(255,255,255,0.07)",
    ma25: "#ff9800",
    ma50: "#4caf50",
    ma200: "#ff2f4b",
    ma400: "#8bdcff",
    vwap100: "#f4f4f4",
    vwma100: "#a78bfa",
    rsi: "#8b5cf6",
    macd: "#3b82f6",
    signal: "#ff9800",
    z: "#f43f5e",
  };

  const labelText = {
    tradable_spike: "TRADABLE",
    pump_dump: "PUMP-DUMP",
    ambiguous_spike: "AMBIG",
    censored_spike: "CENSORED",
  };

  function setStatus(text) {
    status.textContent = text;
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
    return response.json();
  }

  function fmt(value, digits = 2) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
    return Number(value).toLocaleString("en-US", { maximumFractionDigits: digits });
  }

  function timeShort(iso) {
    return String(iso || "").replace("T", " ").replace("+00:00", "Z").slice(5, 17);
  }

  function chartOptions(height) {
    return {
      autoSize: true,
      height,
      layout: {
        background: { color: "#0f0f10" },
        textColor: colors.text,
        fontFamily: "Inter, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: colors.grid, style: LineStyle.Solid },
        horzLines: { color: colors.grid, style: LineStyle.Solid },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#2a2d33" },
      timeScale: {
        borderColor: "#2a2d33",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 4,
      },
      localization: { locale: "en-US" },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    };
  }

  function lineOptions(color, width = 2) {
    return {
      color,
      lineWidth: width,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    };
  }

  function notNullLine(rows, key) {
    return rows.filter((row) => row[key] !== null).map((row) => ({ time: row.time, value: row[key] }));
  }

  function drawOverlay(chart, panel, event) {
    const overlay = panel.querySelector(".alt24-overlay");
    overlay.replaceChildren();
    const range = chart.timeScale().getVisibleRange();
    if (!range) return;

    function xOf(epoch) {
      const x = chart.timeScale().timeToCoordinate(epoch);
      if (x !== null) return x;
      const span = Number(range.to) - Number(range.from);
      return span ? ((epoch - Number(range.from)) / span) * panel.clientWidth : null;
    }

    function addBand(from, to, klass) {
      const x1 = xOf(from);
      const x2 = xOf(to);
      if (x1 === null || x2 === null) return;
      const left = Math.max(0, Math.min(x1, x2));
      const right = Math.min(panel.clientWidth, Math.max(x1, x2));
      if (right <= 0 || left >= panel.clientWidth || right - left < 1) return;
      const el = document.createElement("div");
      el.className = `alt24-band ${klass}`;
      el.style.left = `${left}px`;
      el.style.width = `${right - left}px`;
      overlay.appendChild(el);
    }

    function addLine(epoch, klass) {
      if (!epoch) return;
      const x = xOf(epoch);
      if (x === null || x < -2 || x > panel.clientWidth + 2) return;
      const el = document.createElement("div");
      el.className = `alt24-vline ${klass}`;
      el.style.left = `${x}px`;
      overlay.appendChild(el);
    }

    const eventEpoch = Math.round(new Date(event.event_time_utc).getTime() / 1000);
    addBand(eventEpoch - 6 * 3600, eventEpoch - 3 * 3600, "pre6h");
    addBand(eventEpoch - 3 * 3600, eventEpoch - 3600, "pre3h");
    addBand(eventEpoch - 3600, eventEpoch, "pre1h");
    addLine(eventEpoch, "event");
    if (event.event15_time_utc) {
      addLine(Math.round(new Date(event.event15_time_utc).getTime() / 1000), "event15");
    }
    if (event.trigger_time_utc) {
      addLine(Math.round(new Date(event.trigger_time_utc).getTime() / 1000), "trigger");
    }
  }

  function syncRange(charts, range) {
    if (!range) return;
    for (const chart of charts) chart.timeScale().setVisibleRange(range);
  }

  function attachOverlays(charts, panels, event) {
    let syncing = false;
    for (const chart of charts) {
      chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
        if (syncing || !range) return;
        syncing = true;
        syncRange(charts.filter((item) => item !== chart), range);
        syncing = false;
        requestAnimationFrame(() => panels.forEach((panel, idx) => drawOverlay(charts[idx], panel, event)));
      });
    }
    requestAnimationFrame(() => panels.forEach((panel, idx) => drawOverlay(charts[idx], panel, event)));
    window.addEventListener("resize", () => {
      requestAnimationFrame(() => panels.forEach((panel, idx) => drawOverlay(charts[idx], panel, event)));
    });
  }

  function addPanel(stack, name) {
    const panel = document.createElement("div");
    panel.className = `alt24-chart-panel ${name}`;
    const chartEl = document.createElement("div");
    chartEl.className = "alt24-chart";
    const overlay = document.createElement("div");
    overlay.className = "alt24-overlay";
    panel.append(chartEl, overlay);
    stack.appendChild(panel);
    return { panel, chartEl };
  }

  async function renderEvent(event) {
    const card = document.createElement("article");
    card.className = `alt24-card ${event.trigger_detected ? "detected" : "missed"} ${event.label || ""}`;
    card.innerHTML = `
      <div class="alt24-card-header">
        <div class="alt24-title">
          <span class="alt24-rank">#${event.rank}</span>
          <span>${event.symbol}</span>
          <span class="alt24-gain">+${fmt(event.event_gain_pct)}%</span>
          <span class="alt24-label ${event.label || ""}">${labelText[event.label] || event.label || "RAW"}</span>
          <span class="alt24-trigger-badge ${event.trigger_detected ? "detected" : "missed"}">${event.trigger_detected ? "DETECTED" : "MISSED"}</span>
        </div>
        <div class="alt24-meta">${timeShort(event.event_time_utc)} · score ${fmt(event.pre_event_score, 0)} · loading</div>
      </div>
    `;
    const meta = card.querySelector(".alt24-meta");
    const stack = document.createElement("div");
    stack.className = "alt24-chart-stack";
    card.appendChild(stack);
    grid.appendChild(card);

    let payload;
    try {
      const url = `/api/alt-24h/window?symbol=${encodeURIComponent(event.symbol)}&event_time=${encodeURIComponent(event.event_time_utc)}&hours=24`;
      payload = await fetchJson(url);
    } catch (error) {
      const div = document.createElement("div");
      div.className = "alt24-card-error";
      div.textContent = `차트 데이터 로드 실패: ${error.message}`;
      stack.replaceChildren(div);
      return;
    }
    const quality = `ret30 ${fmt(event.retention_30m, 2)} · retr30 ${fmt(event.retrace_30m, 2)} · onebar ${fmt(event.one_bar_share_of_event, 2)}`;
    const trigger = event.trigger_time_utc ? `trigger ${timeShort(event.trigger_time_utc)}` : "trigger none";
    const event15 = event.event15_time_utc ? ` · +15 ${timeShort(event.event15_time_utc)}` : "";
    meta.textContent = `${timeShort(event.event_time_utc)} · ${trigger}${event15} · score ${fmt(event.pre_event_score, 0)} · ${quality} · ${payload.source}`;

    const rows = payload.bars || [];
    if (!rows.length) return;
    const panels = [addPanel(stack, "price"), addPanel(stack, "rsi"), addPanel(stack, "macd"), addPanel(stack, "volume")];
    const priceChart = createChart(panels[0].chartEl, chartOptions(270));
    const rsiChart = createChart(panels[1].chartEl, chartOptions(88));
    const macdChart = createChart(panels[2].chartEl, chartOptions(88));
    const volumeChart = createChart(panels[3].chartEl, chartOptions(96));
    const charts = [priceChart, rsiChart, macdChart, volumeChart];

    const candles = priceChart.addCandlestickSeries({
      upColor: colors.up,
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
      priceLineColor: "#d64c5b",
    });
    candles.setData(rows.map((row) => ({ time: row.time, open: row.open, high: row.high, low: row.low, close: row.close })));
    priceChart.addLineSeries(lineOptions(colors.ma25)).setData(notNullLine(rows, "sma25"));
    priceChart.addLineSeries(lineOptions(colors.ma50)).setData(notNullLine(rows, "sma50"));
    priceChart.addLineSeries(lineOptions(colors.ma200, 2)).setData(notNullLine(rows, "sma200"));
    priceChart.addLineSeries(lineOptions(colors.ma400, 2)).setData(notNullLine(rows, "sma400"));
    priceChart.addLineSeries(lineOptions(colors.vwap100, 2)).setData(notNullLine(rows, "vwap100"));
    priceChart.addLineSeries(lineOptions(colors.vwma100, 2)).setData(notNullLine(rows, "vwma100"));

    const rsi = rsiChart.addLineSeries(lineOptions(colors.rsi, 2));
    rsi.setData(notNullLine(rows, "rsi14"));
    rsi.createPriceLine({ price: 70, color: "rgba(242,54,69,0.6)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "70" });
    rsi.createPriceLine({ price: 30, color: "rgba(34,171,148,0.6)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "30" });

    macdChart.addLineSeries(lineOptions(colors.macd, 2)).setData(notNullLine(rows, "macd"));
    macdChart.addLineSeries(lineOptions(colors.signal, 2)).setData(notNullLine(rows, "macd_signal"));
    macdChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false }).setData(
      rows
        .filter((row) => row.macd_hist !== null)
        .map((row) => ({ time: row.time, value: row.macd_hist, color: row.macd_hist >= 0 ? "rgba(34,171,148,0.6)" : "rgba(242,54,69,0.6)" }))
    );

    volumeChart.addHistogramSeries({ priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }).setData(
      rows.map((row) => ({ time: row.time, value: row.volume, color: row.close >= row.open ? "rgba(34,171,148,0.45)" : "rgba(242,54,69,0.45)" }))
    );
    volumeChart.addLineSeries({ ...lineOptions(colors.z, 1), priceScaleId: "z" }).setData(notNullLine(rows, "volume_z48"));

    const eventEpoch = Math.round(new Date(event.event_time_utc).getTime() / 1000);
    const range = { from: eventEpoch - 18 * 3600, to: eventEpoch + 6 * 3600 };
    syncRange(charts, range);
    attachOverlays(charts, panels.map((item) => item.panel), event);
  }

  async function main() {
    try {
      const payload = await fetchJson("/api/alt-24h/events");
      let events = payload.events || [];
      const params = new URLSearchParams(window.location.search);
      const symbols = String(params.get("symbols") || "")
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean);
      if (symbols.length) {
        const bySymbol = new Map(events.map((event) => [event.symbol, event]));
        events = symbols.map((symbol) => bySymbol.get(symbol)).filter(Boolean);
      }
      const limit = Number(params.get("limit") || 0);
      if (Number.isFinite(limit) && limit > 0) {
        events = events.slice(0, limit);
      }
      setStatus(`0/${events.length}`);
      let completed = 0;
      let next = 0;
      const workers = Array.from({ length: Math.min(4, events.length) }, async () => {
        while (next < events.length) {
          const event = events[next];
          next += 1;
          await renderEvent(event);
          completed += 1;
          setStatus(`${completed}/${events.length}`);
        }
      });
      await Promise.all(workers);
      const detected = events.filter((event) => event.trigger_detected).length;
      setStatus(`완료 · ${events.length} charts · detected ${detected} · missed ${events.length - detected}`);
    } catch (error) {
      setStatus(`Failed: ${error.message}`);
    }
  }

  main();
})();
