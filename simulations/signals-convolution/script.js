document.addEventListener("DOMContentLoaded", () => {
  (() => {
    /* ========= Helpers ========= */
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;

    function linspace(a, b, n) {
      const xs = new Array(n);
      if (n === 1) { xs[0] = a; return xs; }
      const s = (b - a) / (n - 1);
      for (let i = 0; i < n; i++) xs[i] = a + s * i;
      return xs;
    }

    /* ========= Signals ========= */
    function baseSignal(type, t, approxDt) {
      const eps = 1e-12;
      switch (type) {
        case "delta": {
          const sigma = Math.max(approxDt * 1.2, 0.03);
          const norm = 1 / (sigma * Math.sqrt(2 * Math.PI));
          return norm * Math.exp(-(t * t) / (2 * sigma * sigma));
        }
        case "u": return (t >= 0) ? 1 : 0;
        case "r": return (t >= 0) ? t : 0;
        case "sin": return Math.sin(t);
        case "cos": return Math.cos(t);
        case "rect": return (Math.abs(t) <= 0.5) ? 1 : 0;
        case "tri": {
          const a = Math.abs(t);
          return (a <= 1) ? (1 - a) : 0;
        }
        case "sinc": {
          const x = Math.PI * t;
          return (Math.abs(x) < eps) ? 1 : Math.sin(x) / x;
        }
        case "sa": return (Math.abs(t) < eps) ? 1 : Math.sin(t) / t;
        default: return 0;
      }
    }

    function buildSignal(type, A, shift, scale, mode, approxDt) {
      const s = Math.max(0.1, Math.abs(scale || 1));
      const sh = shift || 0;
      const shDisc = (mode === "discrete") ? Math.round(sh) : sh;
      return (t) => {
        const tt = (t - shDisc) / s;
        return (A || 0) * baseSignal(type, tt, approxDt);
      };
    }

    /* ========= Auto resolution (perfect always) ========= */
    function autoResolution(mode, tMin, tMax) {
      const range = Math.max(1e-9, tMax - tMin);

      if (mode === "discrete") {
        return { nT: 0, nTau: 0, approxDt: 1 };
      }

      const nT = clamp(Math.round(range * 60), 360, 900);   
      const nTau = clamp(Math.round(nT * 3.2), 900, 3800);  
      const approxDt = range / Math.max(120, nTau);

      return { nT, nTau, approxDt };
    }

    /* ========= Convolution ========= */
    function convContinuous(xFun, hFun, tVec, tauMin, tauMax, nTau) {
      const tau = linspace(tauMin, tauMax, nTau);
      const dTau = (tauMax - tauMin) / (nTau - 1);

      const xTau = tau.map(xFun);

      const y = new Array(tVec.length).fill(0);
      for (let i = 0; i < tVec.length; i++) {
        const t = tVec[i];
        let acc = 0;
        for (let k = 0; k < tau.length; k++) {
          acc += xTau[k] * hFun(t - tau[k]);
        }
        y[i] = acc * dTau;
      }
      return { tau, y };
    }

    function convDiscrete(xFun, hFun, nVec, kMin, kMax) {
      const ks = [];
      for (let k = kMin; k <= kMax; k++) ks.push(k);

      const xk = ks.map(xFun);
      const y = new Array(nVec.length).fill(0);

      for (let i = 0; i < nVec.length; i++) {
        const n = nVec[i];
        let acc = 0;
        for (let idx = 0; idx < ks.length; idx++) {
          const k = ks[idx];
          acc += xk[idx] * hFun(n - k);
        }
        y[i] = acc;
      }
      return { ks, y };
    }

    function sampleAt(xs, ys, x, continuous) {
      if (!xs.length) return 0;
      if (!continuous) {
        const idx = xs.indexOf(x);
        return (idx >= 0) ? ys[idx] : 0;
      }
      if (x <= xs[0]) return ys[0];
      if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
      let lo = 0, hi = xs.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] <= x) lo = mid; else hi = mid;
      }
      const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
      return lerp(ys[lo], ys[hi], t);
    }

    /* ========= Chart.js Plotting ========= */
    let chartsState = {};

    function createChart(canvasId, data, opts = {}) {
      opts = opts || {};
      
      const customPluginOpts = {
        vlineX: opts.vline,
        pointMarker: opts.point
      };

      // FIX: Update existing charts instead of destroying them to fix canvas creep and lagging.
      if (chartsState[canvasId]) {
        const chart = chartsState[canvasId];
        chart.data = data;
        chart.config.options.customPluginOpts = customPluginOpts;
        chart.update('none'); // Instant update without animation
        return chart;
      }
      
      const ctx = document.getElementById(canvasId).getContext('2d');
      const GRID = "rgba(9,16,42,0.10)";
      const TICKS = "rgba(9,16,42,0.70)";

      const chart = new Chart(ctx, {
        type: 'line',
        data: data,
        options: {
          customPluginOpts: customPluginOpts,
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          layout: {
            padding: 0
          },
          plugins: {
            legend: {
              labels: {
                color: TICKS,
                font: { family: "Inter", weight: "900", size: 13 },
                usePointStyle: true,
                boxWidth: 12,
                padding: 15
              }
            },
            tooltip: {
              backgroundColor: "rgba(255,255,255,0.96)",
              titleColor: "rgba(9,16,42,0.95)",
              bodyColor: "rgba(9,16,42,0.85)",
              borderColor: "rgba(9,16,42,0.12)",
              borderWidth: 1,
              displayColors: false
            },
            filler: {
              propagate: true
            }
          },
          scales: {
            x: {
              type: 'linear',
              grid: { color: GRID, drawBorder: false },
              ticks: { 
                color: TICKS, 
                maxTicksLimit: 8,
                font: { weight: "900", size: 13 },
                padding: 8
              },
              title: { 
                display: true, 
                text: 'Time', 
                color: TICKS, 
                font: { weight: "900", size: 15 },
                padding: 12
              }
            },
            y: {
              type: 'linear',
              grid: { color: GRID, drawBorder: false },
              ticks: { 
                color: TICKS, 
                maxTicksLimit: 8,
                font: { weight: "900", size: 13 },
                padding: 8
              },
              title: { 
                display: true, 
                text: 'Amplitude', 
                color: TICKS, 
                font: { weight: "900", size: 15 },
                padding: 12
              }
            }
          }
        },
        plugins: [{
          id: 'vlinePlugin',
          afterDatasetsDraw(chart) {
            const currentOpts = chart.config.options.customPluginOpts;
            const vlineX = currentOpts.vlineX;
            const pointMarker = currentOpts.pointMarker;

            if (vlineX != null) {
              const xScale = chart.scales.x;
              const yScale = chart.scales.y;
              const ctx = chart.ctx;
              
              const xPix = xScale.getPixelForValue(vlineX);
              const topPix = yScale.getPixelForValue(yScale.max);
              const bottomPix = yScale.getPixelForValue(yScale.min);
              
              ctx.save();
              ctx.strokeStyle = "rgba(8,181,141,0.95)";
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(xPix, topPix);
              ctx.lineTo(xPix, bottomPix);
              ctx.stroke();
              ctx.restore();
            }
            
            if (pointMarker) {
              const xScale = chart.scales.x;
              const yScale = chart.scales.y;
              const ctx = chart.ctx;
              
              const xPix = xScale.getPixelForValue(pointMarker.x);
              const yPix = yScale.getPixelForValue(pointMarker.y);
              
              ctx.save();
              ctx.strokeStyle = "rgba(255,255,255,0.95)";
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(xPix, yPix, 6.2, 0, Math.PI * 2);
              ctx.stroke();
              
              ctx.fillStyle = "rgba(8,181,141,0.95)";
              ctx.beginPath();
              ctx.arc(xPix, yPix, 4.2, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
          }
        }]
      });

      chartsState[canvasId] = chart;
      return chart;
    }

    function plotContinuous(canvas, xs, ys, opts, label = 'y(t)') {
      const canvasId = canvas.id;
      opts = opts || {};

      const points = xs.map((x, i) => ({ x: x, y: ys[i] }));
      const data = {
        datasets: [
          {
            label: label,
            data: points,
            borderColor: '#3f6fff',
            backgroundColor: opts.shade ? 'rgba(8,181,141,0.16)' : 'rgba(63,111,255,0.15)',
            borderWidth: 2.5,
            pointRadius: 0,
            fill: opts.shade ? true : false,
            tension: 0.25
          }
        ]
      };

      createChart(canvasId, data, opts);
    }

    function plotDiscrete(canvas, xs, ys, opts, label = 'y[n]') {
      const canvasId = canvas.id;
      opts = opts || {};

      const points = xs.map((x, i) => ({ x: x, y: ys[i] }));
      const data = {
        datasets: [
          {
            label: label,
            data: points,
            borderColor: 'rgba(63,111,255,0.80)',
            backgroundColor: '#3f6fff',
            borderWidth: 2,
            pointRadius: 4.5,
            pointStyle: 'circle',
            showLine: false
          }
        ]
      };

      createChart(canvasId, data, opts);
    }

    /* ========= DOM ========= */
    const els = {
      modeCont: document.getElementById("modeCont"),
      modeDisc: document.getElementById("modeDisc"),
      tMin: document.getElementById("tMin"),
      tMax: document.getElementById("tMax"),
      xType: document.getElementById("xType"),
      hType: document.getElementById("hType"),
      xA: document.getElementById("xA"),
      xShift: document.getElementById("xShift"),
      xScale: document.getElementById("xScale"),
      hA: document.getElementById("hA"),
      hShift: document.getElementById("hShift"),
      hScale: document.getElementById("hScale"),
      tSlider: document.getElementById("tSlider"),
      tNow: document.getElementById("tNow"),
      yNow: document.getElementById("yNow"),
      btnReset: document.getElementById("btnReset"),
      btnRecalc: document.getElementById("btnRecalc"),
      btnExport: document.getElementById("btnExport"),
      btnAuto: document.getElementById("btnAuto"),
      autoState: document.getElementById("autoState"),

      cx: document.getElementById("cx"),
      ch: document.getElementById("ch"),
      cint: document.getElementById("cint"),
      cy: document.getElementById("cy"),

      xDesc: document.getElementById("xDesc"),
      hDesc: document.getElementById("hDesc"),
      intDesc: document.getElementById("intDesc"),
      yDesc: document.getElementById("yDesc"),
    };

    const state = {
      mode: "continuous",
      auto: true,
      lastKey: "",
      tVec: [],
      yVec: [],
      tauOrK: [],
    };

    function updateModeButtons() {
      if(els.modeCont) els.modeCont.classList.toggle("on", state.mode === "continuous");
      if(els.modeDisc) els.modeDisc.classList.toggle("on", state.mode === "discrete");
    }

    function setMode(m) {
      state.mode = m;
      updateModeButtons();
      recompute(true);
    }

    function setSliderFromT(t, tMin, tMax) {
      if(!els.tSlider) return;
      const u = (t - tMin) / (tMax - tMin);
      els.tSlider.value = String(Math.round(clamp(u, 0, 1) * 1000));
    }
    function getTFromSlider(tMin, tMax) {
      if(!els.tSlider) return 0;
      const u = parseInt(els.tSlider.value, 10) / 1000;
      return lerp(tMin, tMax, u);
    }

    function describe(type, A, shift, scale, mode) {
      const sh = (mode === "discrete") ? Math.round(shift) : shift;
      return `${type} · A=${Number(A).toFixed(2)} · shift=${Number(sh).toFixed(2)} · scale=${Number(scale).toFixed(2)}`;
    }

    function readControls() {
      const mode = state.mode;
      const tMin = els.tMin ? parseFloat(els.tMin.value) : -6;
      const tMax = els.tMax ? parseFloat(els.tMax.value) : 6;

      const xType = els.xType ? els.xType.value : "u";
      const hType = els.hType ? els.hType.value : "rect";

      const xA = els.xA ? parseFloat(els.xA.value) : 1;
      const xShift = els.xShift ? parseFloat(els.xShift.value) : 0;
      const xScale = els.xScale ? parseFloat(els.xScale.value) : 1;

      const hA = els.hA ? parseFloat(els.hA.value) : 1;
      const hShift = els.hShift ? parseFloat(els.hShift.value) : 0;
      const hScale = els.hScale ? parseFloat(els.hScale.value) : 1;

      const { nT, nTau, approxDt } = autoResolution(mode, tMin, tMax);

      const xFun = buildSignal(xType, xA, xShift, xScale, mode, approxDt);
      const hFun = buildSignal(hType, hA, hShift, hScale, mode, approxDt);

      return { mode, tMin, tMax, nT, nTau, approxDt, xType, hType, xA, xShift, xScale, hA, hShift, hScale, xFun, hFun };
    }

    function drawIntegrand(C, tMarker, yNow) {
      if(!els.cint) return;
      if (C.mode === "continuous") {
        const tau = state.tauOrK;
        const integrand = tau.map(tt => C.xFun(tt) * C.hFun(tMarker - tt));
        plotContinuous(els.cint, tau, integrand, {
          shade: { xs: tau, ys: integrand }
        }, 'x*h(t)');
        if(els.intDesc) els.intDesc.textContent = `t=${tMarker.toFixed(2)} · ∫ ≈ ${yNow.toFixed(3)}`;
      } else {
        const ks = state.tauOrK;
        const integrand = ks.map(k => C.xFun(k) * C.hFun(tMarker - k));
        plotDiscrete(els.cint, ks, integrand, {}, 'x*h[n]');
        if(els.intDesc) els.intDesc.textContent = `n=${tMarker} · Σ ≈ ${yNow.toFixed(3)}`;
      }
    }

    function recompute(force = false) {
      const C = readControls();
      if (!(C.tMax > C.tMin + 1e-9)) {
        if(els.tMax) els.tMax.value = String(C.tMin + 1);
        return recompute(true);
      }

      let tVec;
      if (C.mode === "continuous") {
        tVec = linspace(C.tMin, C.tMax, C.nT);
      } else {
        const nMin = Math.ceil(C.tMin);
        const nMax = Math.floor(C.tMax);
        const len = Math.max(2, nMax - nMin + 1);
        tVec = new Array(len);
        for (let i = 0; i < len; i++) tVec[i] = nMin + i;
      }

      if(els.xDesc) els.xDesc.textContent = describe(C.xType, C.xA, C.xShift, C.xScale, C.mode);
      if(els.hDesc) els.hDesc.textContent = describe(C.hType, C.hA, C.hShift, C.hScale, C.mode);
      if(els.yDesc) els.yDesc.textContent = (C.mode === "continuous")
        ? "y(t)=∫ x(τ)h(t−τ)dτ"
        : "y[n]=Σ x[k]h[n−k]";

      const xVals = tVec.map(C.xFun);
      const hVals = tVec.map(C.hFun);

      if(els.cx && els.ch) {
          if (C.mode === "continuous") {
            plotContinuous(els.cx, tVec, xVals, { xMin: C.tMin, xMax: C.tMax }, 'x(t)');
            plotContinuous(els.ch, tVec, hVals, { xMin: C.tMin, xMax: C.tMax }, 'h(t)');
          } else {
            plotDiscrete(els.cx, tVec, xVals, { xMin: tVec[0], xMax: tVec[tVec.length - 1] }, 'x[n]');
            plotDiscrete(els.ch, tVec, hVals, { xMin: tVec[0], xMax: tVec[tVec.length - 1] }, 'h[n]');
          }
      }

      const key = JSON.stringify({
        mode: C.mode, tMin: C.tMin, tMax: C.tMax, nT: C.nT, nTau: C.nTau,
        x: C.xType, xA: C.xA, xShift: (C.mode === "discrete" ? Math.round(C.xShift) : C.xShift), xScale: C.xScale,
        h: C.hType, hA: C.hA, hShift: (C.mode === "discrete" ? Math.round(C.hShift) : C.hShift), hScale: C.hScale
      });
      const need = force || (key !== state.lastKey);

      if (need) {
        state.lastKey = key;

        if (C.mode === "continuous") {
          const range = C.tMax - C.tMin;
          const pad = 0.35 * range;
          const tauMin = C.tMin - pad;
          const tauMax = C.tMax + pad;
          const out = convContinuous(C.xFun, C.hFun, tVec, tauMin, tauMax, C.nTau);
          state.tVec = tVec;
          state.yVec = out.y;
          state.tauOrK = out.tau;
        } else {
          const range = (Math.floor(C.tMax) - Math.ceil(C.tMin)) + 1;
          const pad = Math.max(8, Math.round(0.45 * Math.max(6, range)));
          const kMin = Math.ceil(C.tMin) - pad;
          const kMax = Math.floor(C.tMax) + pad;
          const out = convDiscrete(C.xFun, C.hFun, tVec, kMin, kMax);
          state.tVec = tVec;
          state.yVec = out.y;
          state.tauOrK = out.ks;
        }
      }

      const tNow = getTFromSlider(C.tMin, C.tMax);
      const tMarker = (C.mode === "continuous") ? tNow : Math.round(tNow);
      const yNow = sampleAt(state.tVec, state.yVec, tMarker, (C.mode === "continuous"));

      if(els.cy) {
          if (C.mode === "continuous") {
            plotContinuous(els.cy, state.tVec, state.yVec, {
              xMin: C.tMin, xMax: C.tMax,
              vline: tMarker,
              point: { x: tMarker, y: yNow }
            }, 'y(t)');
          } else {
            plotDiscrete(els.cy, state.tVec, state.yVec, {
              xMin: state.tVec[0],
              xMax: state.tVec[state.tVec.length - 1],
              vline: tMarker,
              point: { x: tMarker, y: yNow }
            }, 'y[n]');
          }
      }

      drawIntegrand(C, tMarker, yNow);

      if(els.tNow) els.tNow.textContent = (C.mode === "continuous") ? tMarker.toFixed(2) : String(tMarker);
      if(els.yNow) els.yNow.textContent = yNow.toFixed(3);
    }

    const inputs = [
      els.tMin, els.tMax,
      els.xType, els.hType,
      els.xA, els.xShift, els.xScale,
      els.hA, els.hShift, els.hScale
    ];

    inputs.forEach(el => {
      if(el) {
          el.addEventListener("input", () => state.auto ? recompute(true) : recompute(false));
          el.addEventListener("change", () => state.auto ? recompute(true) : recompute(false));
      }
    });

    if(els.tSlider) els.tSlider.addEventListener("input", () => recompute(false));

    if(els.modeCont) els.modeCont.addEventListener("click", () => setMode("continuous"));
    if(els.modeDisc) els.modeDisc.addEventListener("click", () => setMode("discrete"));

    if(els.btnRecalc) els.btnRecalc.addEventListener("click", () => recompute(true));

    if(els.btnReset) els.btnReset.addEventListener("click", () => {
      state.mode = "continuous";
      updateModeButtons();

      if(els.tMin) els.tMin.value = "-6";
      if(els.tMax) els.tMax.value = "6";

      if(els.xType) els.xType.value = "u";
      if(els.hType) els.hType.value = "rect";

      if(els.xA) els.xA.value = "1";
      if(els.xShift) els.xShift.value = "0";
      if(els.xScale) els.xScale.value = "1";

      if(els.hA) els.hA.value = "1";
      if(els.hShift) els.hShift.value = "0";
      if(els.hScale) els.hScale.value = "1";

      if(els.tMin && els.tMax) {
          setSliderFromT(0, parseFloat(els.tMin.value), parseFloat(els.tMax.value));
      }
      recompute(true);
    });

    if(els.btnAuto) els.btnAuto.addEventListener("click", () => {
      state.auto = !state.auto;
      if(els.autoState) els.autoState.textContent = state.auto ? "ON" : "OFF";
      els.btnAuto.classList.toggle("primary", !state.auto);
    });

    if(els.btnExport) els.btnExport.addEventListener("click", () => {
      if (!state.tVec.length) return;
      const rows = [["t", "y"]];
      for (let i = 0; i < state.tVec.length; i++) rows.push([state.tVec[i], state.yVec[i]]);
      const csv = rows.map(r => r.join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mae_convolution_y.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); recompute(true); return; }
      if (e.key.toLowerCase() === "r") { e.preventDefault(); if(els.btnReset) els.btnReset.click(); return; }
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && els.tSlider) {
        const step = e.shiftKey ? 12 : 3;
        const v = parseInt(els.tSlider.value, 10);
        els.tSlider.value = String(clamp(v + (e.key === "ArrowRight" ? step : -step), 0, 1000));
        recompute(false);
      }
    });

    // init
    updateModeButtons();
    if(els.tMin && els.tMax) {
        setSliderFromT(0, parseFloat(els.tMin.value), parseFloat(els.tMax.value));
    }
    recompute(true);
  })();
});