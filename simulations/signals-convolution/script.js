document.addEventListener("DOMContentLoaded", () => {
  (() => {
    /* ========= Helpers ========= */
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;

    function niceStep(range) {
      if (range <= 0) return 1;
      const p = Math.pow(10, Math.floor(Math.log10(range)));
      const n = range / p;
      if (n < 1.5) return 0.2 * p;
      if (n < 3) return 0.5 * p;
      if (n < 7) return 1.0 * p;
      return 2.0 * p;
    }

    function decimalsForStep(step) {
      const a = Math.abs(step);
      if (a >= 10) return 0;
      if (a >= 1) return 1;
      if (a >= 0.1) return 2;
      if (a >= 0.01) return 3;
      return 4;
    }

    function fmt(v, stepHint) {
      const d = decimalsForStep(stepHint || 1);
      return Number(v).toFixed(d);
    }

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
        // integer samples only; convolution sum window handled separately
        return { nT: 0, nTau: 0, approxDt: 1 };
      }

      // continuous: choose smooth plots + stable integration
      // target ~ 60 pts/unit with caps
      const nT = clamp(Math.round(range * 60), 360, 900);   // plot density
      const nTau = clamp(Math.round(nT * 3.2), 900, 3800);  // integration density
      const approxDt = range / Math.max(120, nTau);

      return { nT, nTau, approxDt };
    }

    /* ========= Convolution ========= */
    function convContinuous(xFun, hFun, tVec, tauMin, tauMax, nTau) {
      const tau = linspace(tauMin, tauMax, nTau);
      const dTau = (tauMax - tauMin) / (nTau - 1);

      // precompute x(tau)
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

    /* ========= Plotting ========= */
    function plotAxesAndGrid(ctx, W, H, pad, xMin, xMax, yMin, yMax) {
      const w = W - pad.l - pad.r;
      const h = H - pad.t - pad.b;

      const X = (x) => pad.l + (x - xMin) / (xMax - xMin) * w;
      const Y = (y) => pad.t + (1 - (y - yMin) / (yMax - yMin)) * h;

      const gx = niceStep((xMax - xMin) / 6);
      const gy = niceStep((yMax - yMin) / 5);

      // clearer
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(9,16,42,0.10)";

      for (let x = Math.ceil(xMin / gx) * gx; x <= xMax + 1e-9; x += gx) {
        const px = X(x);
        ctx.beginPath(); ctx.moveTo(px, pad.t); ctx.lineTo(px, pad.t + h); ctx.stroke();
      }
      for (let y = Math.ceil(yMin / gy) * gy; y <= yMax + 1e-9; y += gy) {
        const py = Y(y);
        ctx.beginPath(); ctx.moveTo(pad.l, py); ctx.lineTo(pad.l + w, py); ctx.stroke();
      }

      // axes
      ctx.strokeStyle = "rgba(9,16,42,0.30)";
      if (0 >= xMin && 0 <= xMax) {
        const px = X(0);
        ctx.beginPath(); ctx.moveTo(px, pad.t); ctx.lineTo(px, pad.t + h); ctx.stroke();
      }
      if (0 >= yMin && 0 <= yMax) {
        const py = Y(0);
        ctx.beginPath(); ctx.moveTo(pad.l, py); ctx.lineTo(pad.l + w, py); ctx.stroke();
      }

      // labels bigger + darker
      ctx.fillStyle = "rgba(9,16,42,0.80)";
      ctx.font = "900 12px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let x = Math.ceil(xMin / gx) * gx; x <= xMax + 1e-9; x += gx) {
        ctx.fillText(fmt(x, gx), X(x), pad.t + h + 8);
      }
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let y = Math.ceil(yMin / gy) * gy; y <= yMax + 1e-9; y += gy) {
        ctx.fillText(fmt(y, gy), pad.l - 8, Y(y));
      }

      return { X, Y, gx, gy };
    }

    function getBounds(xs, ys) {
      const xMin = Math.min(...xs), xMax = Math.max(...xs);
      let yMin = Math.min(...ys), yMax = Math.max(...ys);
      if (!isFinite(yMin) || !isFinite(yMax)) { yMin = -1; yMax = 1; }
      if (Math.abs(yMax - yMin) < 1e-12) { yMax = yMin + 1; }
      const r = yMax - yMin;
      yMin -= r * 0.08; yMax += r * 0.08;
      return { xMin, xMax, yMin, yMax };
    }

    function plotContinuous(canvas, xs, ys, opts) {
      const ctx = canvas.getContext("2d");
      const W = canvas.width, H = canvas.height;
      const pad = { l: 52, r: 16, t: 18, b: 36 }; // bigger left for clearer numbers

      ctx.clearRect(0, 0, W, H);

      const b = getBounds(xs, ys);
      const xMin = (opts && opts.xMin != null) ? opts.xMin : b.xMin;
      const xMax = (opts && opts.xMax != null) ? opts.xMax : b.xMax;
      const yMin = (opts && opts.yMin != null) ? opts.yMin : b.yMin;
      const yMax = (opts && opts.yMax != null) ? opts.yMax : b.yMax;

      const { X, Y } = plotAxesAndGrid(ctx, W, H, pad, xMin, xMax, yMin, yMax);

      // shaded area
      if (opts && opts.shade) {
        const sx = opts.shade.xs, sy = opts.shade.ys;
        ctx.fillStyle = "rgba(8,181,141,0.16)";
        ctx.beginPath();
        ctx.moveTo(X(sx[0]), Y(0));
        for (let i = 0; i < sx.length; i++) ctx.lineTo(X(sx[i]), Y(sy[i]));
        ctx.lineTo(X(sx[sx.length - 1]), Y(0));
        ctx.closePath();
        ctx.fill();
      }

      // line
      ctx.strokeStyle = "rgba(63,111,255,0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < xs.length; i++) {
        const px = X(xs[i]), py = Y(ys[i]);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // vline + point
      if (opts && opts.vline != null) {
        const px = X(opts.vline);
        ctx.strokeStyle = "rgba(8,181,141,0.95)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px, pad.t); ctx.lineTo(px, H - pad.b); ctx.stroke();
      }
      if (opts && opts.point) {
        const px = X(opts.point.x), py = Y(opts.point.y);
        ctx.fillStyle = "rgba(8,181,141,0.95)";
        ctx.beginPath(); ctx.arc(px, py, 4.2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, 6.2, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // Discrete: stems + points (requested)
    function plotDiscrete(canvas, xs, ys, opts) {
      const ctx = canvas.getContext("2d");
      const W = canvas.width, H = canvas.height;
      const pad = { l: 52, r: 16, t: 18, b: 36 };

      ctx.clearRect(0, 0, W, H);

      const b = getBounds(xs, ys);
      const xMin = (opts && opts.xMin != null) ? opts.xMin : b.xMin;
      const xMax = (opts && opts.xMax != null) ? opts.xMax : b.xMax;
      const yMin = (opts && opts.yMin != null) ? opts.yMin : b.yMin;
      const yMax = (opts && opts.yMax != null) ? opts.yMin : b.yMin; // (typo safe)
      // fix yMax/yMin if provided
      const yyMin = (opts && opts.yMin != null) ? opts.yMin : b.yMin;
      const yyMax = (opts && opts.yMax != null) ? opts.yMax : b.yMax;

      const { X, Y } = plotAxesAndGrid(ctx, W, H, pad, xMin, xMax, yyMin, yyMax);

      // stems + points
      ctx.lineWidth = 2;
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i], y = ys[i];
        const px = X(x);
        // stem
        ctx.strokeStyle = "rgba(63,111,255,0.80)";
        ctx.beginPath();
        ctx.moveTo(px, Y(0));
        ctx.lineTo(px, Y(y));
        ctx.stroke();

        // point
        ctx.fillStyle = "rgba(63,111,255,0.95)";
        ctx.beginPath();
        ctx.arc(px, Y(y), 3.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(px, Y(y), 5.2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 2;
      }

      // marker line + marker point
      if (opts && opts.vline != null) {
        const px = X(opts.vline);
        ctx.strokeStyle = "rgba(8,181,141,0.95)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px, pad.t); ctx.lineTo(px, H - pad.b); ctx.stroke();
      }
      if (opts && opts.point) {
        const px = X(opts.point.x), py = Y(opts.point.y);
        ctx.fillStyle = "rgba(8,181,141,0.95)";
        ctx.beginPath(); ctx.arc(px, py, 4.2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, 6.2, 0, Math.PI * 2); ctx.stroke();
      }
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
      els.modeCont.classList.toggle("on", state.mode === "continuous");
      els.modeDisc.classList.toggle("on", state.mode === "discrete");
    }

    function setMode(m) {
      state.mode = m;
      updateModeButtons();
      recompute(true);
    }

    function setSliderFromT(t, tMin, tMax) {
      const u = (t - tMin) / (tMax - tMin);
      els.tSlider.value = String(Math.round(clamp(u, 0, 1) * 1000));
    }
    function getTFromSlider(tMin, tMax) {
      const u = parseInt(els.tSlider.value, 10) / 1000;
      return lerp(tMin, tMax, u);
    }

    function describe(type, A, shift, scale, mode) {
      const sh = (mode === "discrete") ? Math.round(shift) : shift;
      return `${type} · A=${Number(A).toFixed(2)} · shift=${Number(sh).toFixed(2)} · scale=${Number(scale).toFixed(2)}`;
    }

    function readControls() {
      const mode = state.mode;
      const tMin = parseFloat(els.tMin.value);
      const tMax = parseFloat(els.tMax.value);

      const xType = els.xType.value;
      const hType = els.hType.value;

      const xA = parseFloat(els.xA.value);
      const xShift = parseFloat(els.xShift.value);
      const xScale = parseFloat(els.xScale.value);

      const hA = parseFloat(els.hA.value);
      const hShift = parseFloat(els.hShift.value);
      const hScale = parseFloat(els.hScale.value);

      const { nT, nTau, approxDt } = autoResolution(mode, tMin, tMax);

      const xFun = buildSignal(xType, xA, xShift, xScale, mode, approxDt);
      const hFun = buildSignal(hType, hA, hShift, hScale, mode, approxDt);

      return { mode, tMin, tMax, nT, nTau, approxDt, xType, hType, xA, xShift, xScale, hA, hShift, hScale, xFun, hFun };
    }

    function drawIntegrand(C, tMarker, yNow) {
      if (C.mode === "continuous") {
        const tau = state.tauOrK;
        const integrand = tau.map(tt => C.xFun(tt) * C.hFun(tMarker - tt));
        plotContinuous(els.cint, tau, integrand, {
          shade: { xs: tau, ys: integrand }
        });
        els.intDesc.textContent = `t=${tMarker.toFixed(2)} · ∫ ≈ ${yNow.toFixed(3)}`;
      } else {
        const ks = state.tauOrK;
        const integrand = ks.map(k => C.xFun(k) * C.hFun(tMarker - k));
        plotDiscrete(els.cint, ks, integrand, {});
        els.intDesc.textContent = `n=${tMarker} · Σ ≈ ${yNow.toFixed(3)}`;
      }
    }

    function recompute(force = false) {
      const C = readControls();
      if (!(C.tMax > C.tMin + 1e-9)) {
        els.tMax.value = String(C.tMin + 1);
        return recompute(true);
      }

      // t/n vector
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

      // Descriptions
      els.xDesc.textContent = describe(C.xType, C.xA, C.xShift, C.xScale, C.mode);
      els.hDesc.textContent = describe(C.hType, C.hA, C.hShift, C.hScale, C.mode);
      els.yDesc.textContent = (C.mode === "continuous")
        ? "y(t)=∫ x(τ)h(t−τ)dτ"
        : "y[n]=Σ x[k]h[n−k]";

      // Plot x(t), h(t)
      const xVals = tVec.map(C.xFun);
      const hVals = tVec.map(C.hFun);

      if (C.mode === "continuous") {
        plotContinuous(els.cx, tVec, xVals, { xMin: C.tMin, xMax: C.tMax });
        plotContinuous(els.ch, tVec, hVals, { xMin: C.tMin, xMax: C.tMax });
      } else {
        plotDiscrete(els.cx, tVec, xVals, { xMin: tVec[0], xMax: tVec[tVec.length - 1] });
        plotDiscrete(els.ch, tVec, hVals, { xMin: tVec[0], xMax: tVec[tVec.length - 1] });
      }

      // Compute key
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

      // marker t
      const tNow = getTFromSlider(C.tMin, C.tMax);
      const tMarker = (C.mode === "continuous") ? tNow : Math.round(tNow);
      const yNow = sampleAt(state.tVec, state.yVec, tMarker, (C.mode === "continuous"));

      // Plot y(t): continuous line OR discrete stems
      if (C.mode === "continuous") {
        plotContinuous(els.cy, state.tVec, state.yVec, {
          xMin: C.tMin, xMax: C.tMax,
          vline: tMarker,
          point: { x: tMarker, y: yNow }
        });
      } else {
        plotDiscrete(els.cy, state.tVec, state.yVec, {
          xMin: state.tVec[0],
          xMax: state.tVec[state.tVec.length - 1],
          vline: tMarker,
          point: { x: tMarker, y: yNow }
        });
      }

      // Integrand plot
      drawIntegrand(C, tMarker, yNow);

      // readouts
      els.tNow.textContent = (C.mode === "continuous") ? tMarker.toFixed(2) : String(tMarker);
      els.yNow.textContent = yNow.toFixed(3);
    }

    /* ========= Events ========= */
    const inputs = [
      els.tMin, els.tMax,
      els.xType, els.hType,
      els.xA, els.xShift, els.xScale,
      els.hA, els.hShift, els.hScale
    ];

    inputs.forEach(el => {
      el.addEventListener("input", () => state.auto ? recompute(true) : recompute(false));
      el.addEventListener("change", () => state.auto ? recompute(true) : recompute(false));
    });

    els.tSlider.addEventListener("input", () => recompute(false));

    els.modeCont.addEventListener("click", () => setMode("continuous"));
    els.modeDisc.addEventListener("click", () => setMode("discrete"));

    els.btnRecalc?.addEventListener("click", () => recompute(true));

    els.btnReset?.addEventListener("click", () => {
      state.mode = "continuous";
      updateModeButtons();

      els.tMin.value = "-6";
      els.tMax.value = "6";

      els.xType.value = "u";
      els.hType.value = "rect";

      els.xA.value = "1";
      els.xShift.value = "0";
      els.xScale.value = "1";

      els.hA.value = "1";
      els.hShift.value = "0";
      els.hScale.value = "1";

      setSliderFromT(0, parseFloat(els.tMin.value), parseFloat(els.tMax.value));
      recompute(true);
    });

    els.btnAuto?.addEventListener("click", () => {
      state.auto = !state.auto;
      els.autoState.textContent = state.auto ? "ON" : "OFF";
      els.btnAuto.classList.toggle("primary", !state.auto);
    });

    els.btnExport?.addEventListener("click", () => {
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
      if (e.key.toLowerCase() === "r") { e.preventDefault(); els.btnReset.click(); return; }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const step = e.shiftKey ? 12 : 3;
        const v = parseInt(els.tSlider.value, 10);
        els.tSlider.value = String(clamp(v + (e.key === "ArrowRight" ? step : -step), 0, 1000));
        recompute(false);
      }
    });

    // init
    updateModeButtons();
    setSliderFromT(0, parseFloat(els.tMin.value), parseFloat(els.tMax.value));
    recompute(true);
  })();
});
