    // =========================
    // Core Globals
    // =========================
    let simChart = null;
    let sPlaneChart = null;

    let sys = { order: 2, tau: 1.0, wn: 5.0, zeta: 0.5, p3: 10.0 };
    let pid = { sp: 50, kp: 5.0, ki: 1.0, kd: 2.0 };
    let design = { wn: 6.0, zeta: 0.7 };

    let state = { pv: 0, vel: 0, acc: 0, integ: 0, lastErr: 0 };

    const MAX_HISTORY = 600;
    const DT_FRAME = 0.02;

    // store time-series like Code #1
    let tSeries = [];
    let spSeries = [];
    let pvSeries = [];
    let simTime = 0;

    let controlMode = 'manual';
    let lastStable = true;

    // Chart update throttling
    let lastChartUpdate = 0;
    const CHART_UPDATE_MS = 80; // smooth + efficient

    init();

    function init() {
      // wheel on Time chart = adjust SP
      // Removed: SP now controlled by slider

      bindInputs();
      makeCharts();
      updateUI();

      // Reveal
      const revealEls = document.querySelectorAll(".reveal");
      const io = new IntersectionObserver((entries) => {
        for(const e of entries){
          if(e.isIntersecting){
            e.target.classList.add("isVisible");
            io.unobserve(e.target);
          }
        }
      }, {threshold: 0.12});
      revealEls.forEach(el => io.observe(el));

      requestAnimationFrame(loop);
    }

    // =========================
    // Chart.js setup (like Code #1)
    // =========================
    function makeCharts() {
      // 1) Time response chart
      const simCtx = document.getElementById('simCanvas').getContext('2d');
      simChart = new Chart(simCtx, {
        type: 'line',
        data: {
          labels: tSeries, // time in seconds
          datasets: [
            {
              label: 'Setpoint (SP)',
              data: spSeries,
              borderWidth: 2,
              pointRadius: 0,
              borderDash: [6, 6],
              tension: 0.05,
              borderColor: '#08b58d'
            },
            {
              label: 'Process Variable (PV)',
              data: pvSeries,
              borderWidth: 3,
              pointRadius: 0,
              tension: 0.1,
              borderColor: '#3f6fff'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: true },
            tooltip: { enabled: true }
          },
          scales: {
            x: {
              type: 'linear',
              title: { display: true, text: 'Time (s)' },
              afterBuildTicks: function(scale) {
                const ticks = [];
                const start = Math.ceil(scale.min);
                const end = Math.floor(scale.max);

                for (let v = start; v <= end; v++) {
                  ticks.push({ value: v });
                }

                scale.ticks = ticks;
              }
            },
            y: {
              title: { display: true, text: 'Value' },
              suggestedMin: -20,
              suggestedMax: 140
            }
          }
        }
      });

      // 2) S-plane scatter chart
      const sCtx = document.getElementById('sPlaneCanvas').getContext('2d');
      sPlaneChart = new Chart(sCtx, {
        type: 'scatter',
        data: {
          datasets: [
            {
              label: 'Poles',
              data: [],
              pointRadius: 6,
              pointHoverRadius: 7
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const x = ctx.raw.x ?? 0;
                  const y = ctx.raw.y ?? 0;
                  return `s = ${x.toFixed(2)} ${y >= 0 ? '+' : '-'} j${Math.abs(y).toFixed(2)}`;
                }
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: 'Re(s)' },
              grid: { drawBorder: true },
              suggestedMin: -20,
              suggestedMax: 10
            },
            y: {
              title: { display: true, text: 'Im(s)' },
              suggestedMin: -15,
              suggestedMax: 15
            }
          }
        }
      });
    }

    function pushHistory(sp, pv) {
      simTime += DT_FRAME;

      tSeries.push(simTime.toFixed(2));
      spSeries.push(sp);
      pvSeries.push(pv);

      if (tSeries.length > MAX_HISTORY) {
        tSeries.shift();
        spSeries.shift();
        pvSeries.shift();
      }
    }

    function updateChartsMaybe() {
      const now = performance.now();
      if (now - lastChartUpdate < CHART_UPDATE_MS) return;
      lastChartUpdate = now;

      // update time chart
      let minX, maxX;
      if (simTime <= 10) {
        minX = 0;
        maxX = 10;
      } else {
        minX = simTime - 10;
        maxX = simTime;
      }
      simChart.options.scales.x.min = minX;
      simChart.options.scales.x.max = maxX;

      simChart.update('none');
    }

    function updateSPlaneChart(roots) {
      // map roots -> scatter points (x=re, y=im)
      const pts = roots.map(r => ({ x: r.re, y: r.im }));

      // make points look like red "X" visually: use rotated square (close enough) via pointStyle
      sPlaneChart.data.datasets[0].data = pts;
      sPlaneChart.data.datasets[0].pointStyle = 'crossRot';
      sPlaneChart.data.datasets[0].borderColor = '#d32f2f';
      sPlaneChart.data.datasets[0].backgroundColor = '#d32f2f';

      // auto-range a bit
      const reVals = pts.map(p => p.x);
      const imVals = pts.map(p => p.y);
      if (reVals.length) {
        const minX = Math.min(...reVals) - 2;
        const maxX = Math.max(...reVals) + 2;
        const maxAbsY = Math.max(2, ...imVals.map(v => Math.abs(v))) + 2;

        sPlaneChart.options.scales.x.suggestedMin = Math.min(-20, minX);
        sPlaneChart.options.scales.x.suggestedMax = Math.max(10, maxX);
        sPlaneChart.options.scales.y.suggestedMin = -maxAbsY;
        sPlaneChart.options.scales.y.suggestedMax = maxAbsY;
      }

      sPlaneChart.update('none');
    }

    // =========================
    // UI Logic
    // =========================
    function setMode(mode) {
      controlMode = mode;

      document.getElementById('mode-manual').className = mode === 'manual' ? 'modeBtn active' : 'modeBtn';
      document.getElementById('mode-design').className = mode === 'design' ? 'modeBtn active' : 'modeBtn';

      document.getElementById('ctrl-manual').style.display = mode === 'manual' ? 'block' : 'none';
      document.getElementById('ctrl-design').style.display = mode === 'design' ? 'block' : 'none';

      if (mode === 'design') runAutoTune();
      analyze();
    }

    function bindInputs() {
      const bind = (id, obj, key) => {
        const el = document.getElementById(id);
        el.addEventListener('input', e => {
          obj[key] = parseFloat(e.target.value);
          const valEl = document.getElementById(id.replace('inp', 'val'));
          if(valEl) valEl.innerText = obj[key];
          if (controlMode === 'design') runAutoTune();
          analyze();
        });
      };

      bind('inp-tau', sys, 'tau');
      bind('inp-wn', sys, 'wn');
      bind('inp-zeta', sys, 'zeta');
      bind('inp-p3', sys, 'p3');

      bind('inp-sp', pid, 'sp');
      bind('inp-kp', pid, 'kp');
      bind('inp-ki', pid, 'ki');
      bind('inp-kd', pid, 'kd');

      bind('inp-twn', design, 'wn');
      bind('inp-tzeta', design, 'zeta');
    }

    function updateUI() {
      sys.order = parseInt(document.getElementById('sys-order').value);

      document.querySelectorAll('.param-1st').forEach(e => e.style.display = sys.order === 1 ? 'block' : 'none');
      document.querySelectorAll('.param-2nd').forEach(e => e.style.display = (sys.order === 2 || sys.order === 3) ? 'block' : 'none');
      document.querySelectorAll('.param-3rd').forEach(e => e.style.display = sys.order === 3 ? 'block' : 'none');

      resetSim();

      if (controlMode === 'design') runAutoTune();
      analyze();
    }

    function runAutoTune() {
      if (sys.order === 2) {
        const ws2 = sys.wn * sys.wn;
        const target_w2 = design.wn * design.wn;
        const target_mid = 2 * design.zeta * design.wn;

        const req_Kp = (target_w2 / ws2) - 1;
        const req_Kd = (target_mid - (2 * sys.zeta * sys.wn)) / ws2;

        pid.kp = Math.max(0, req_Kp);
        pid.kd = Math.max(0, req_Kd);
        pid.ki = 0.5;

        document.getElementById('res-kp').innerText = pid.kp.toFixed(2);
        document.getElementById('res-kd').innerText = pid.kd.toFixed(2);

        document.getElementById('inp-kp').value = pid.kp;
        document.getElementById('val-kp').innerText = pid.kp.toFixed(2);

        document.getElementById('inp-kd').value = pid.kd;
        document.getElementById('val-kd').innerText = pid.kd.toFixed(2);

        document.getElementById('inp-ki').value = pid.ki;
        document.getElementById('val-ki').innerText = pid.ki.toFixed(2);
      } else {
        document.getElementById('res-kp').innerText = "N/A";
        document.getElementById('res-kd').innerText = "N/A";
      }
    }

    function resetSim() {
      state = { pv: 0, vel: 0, acc: 0, integ: 0, lastErr: 0 };

      // reset series
      tSeries.length = 0;
      spSeries.length = 0;
      pvSeries.length = 0;
      simTime = 0;

      // seed with zeros so chart is not empty
      for (let i = 0; i < 10; i++) {
        tSeries.push((i * DT_FRAME).toFixed(2));
        spSeries.push(pid.sp);
        pvSeries.push(0);
      }

      document.getElementById('sim-warning').style.display = 'none';
      simChart.update('none');
    }

    function triggerStep() {
      pid.sp = (pid.sp === 50) ? 80 : 50;
      document.getElementById('inp-sp').value = pid.sp;
      document.getElementById('val-sp').innerText = pid.sp;
    }

    // =========================
    // Physics
    // =========================
    function updatePhysics() {
      const SUB = 20;
      const DT = 0.02 / SUB;

      for (let i = 0; i < SUB; i++) {
        const err = pid.sp - state.pv;
        state.integ += err * DT;

        const u =
          (pid.kp * err) +
          (pid.ki * state.integ) +
          (pid.kd * (err - state.lastErr) / DT);

        if (isNaN(u) || Math.abs(u) > 1e6) {
          handleCrash();
          return;
        }

        if (sys.order === 1) {
          state.pv += ((u - state.pv) / sys.tau) * DT;
        } else if (sys.order === 2) {
          const w2 = sys.wn * sys.wn;
          const force = (w2 * u) - (2 * sys.zeta * sys.wn * state.vel) - (w2 * state.pv);
          state.vel += force * DT;
          state.pv += state.vel * DT;
        } else if (sys.order === 3) {
          const w2 = sys.wn * sys.wn;
          const force = (w2 * u) - (2 * sys.zeta * sys.wn * state.vel) - (w2 * state.acc);
          state.vel += force * DT;
          state.acc += state.vel * DT; // x
          const y_dot = sys.p3 * (state.acc - state.pv);
          state.pv += y_dot * DT;
        }

        state.lastErr = err;

        if (Math.abs(state.pv) > 1e4) {
          handleCrash();
          return;
        }
      }

      // push one sample per frame (like scope trace)
      pushHistory(pid.sp, state.pv);
      updateChartsMaybe();
    }

    function handleCrash() {
      document.getElementById('sim-warning').style.display = 'flex';
      setTimeout(() => resetSim(), 1500);
    }

    // =========================
    // Analysis (Roots)
    // =========================
    function analyze() {
      let roots = [];
      let eqHTML = "";

      if (sys.order === 1) {
        const A = sys.tau + pid.kd;
        const B = 1 + pid.kp;
        const C = pid.ki;
        eqHTML = `${A.toFixed(1)}s² + ${B.toFixed(1)}s + ${C.toFixed(1)} = 0`;
        roots = solveQuad(A, B, C);
      } else if (sys.order === 2) {
        const w2 = sys.wn * sys.wn;
        const B = 2 * sys.zeta * sys.wn + w2 * pid.kd;
        const C = w2 + w2 * pid.kp;
        const D = w2 * pid.ki;
        eqHTML = `s³ + ${B.toFixed(1)}s² + ${C.toFixed(1)}s + ${D.toFixed(1)} = 0`;
        roots = solveCubic(B, C, D);
      } else {
        eqHTML = "Order 4 (Analysis Approx)";
        roots = [
          { re: -sys.p3, im: 0 },
          { re: -sys.zeta * sys.wn, im: sys.wn * Math.sqrt(Math.abs(1 - sys.zeta * sys.zeta)) },
          { re: -sys.zeta * sys.wn, im: -sys.wn * Math.sqrt(Math.abs(1 - sys.zeta * sys.zeta)) }
        ];
      }

      document.getElementById('math-char-eq').innerText = eqHTML;

      let stable = true;
      let txt = "";

      roots.forEach(r => {
        if (r.re > 0.001) stable = false;

        const imAbs = Math.abs(r.im);
        const imTxt = imAbs < 0.001 ? "" : `± j${imAbs.toFixed(1)}`;
        txt += `s = ${r.re.toFixed(1)} ${imTxt}<br>`;
      });

      document.getElementById('math-roots').innerHTML = txt;

      const badge = document.getElementById('status-badge');
      badge.innerText = stable ? "Stable" : "Unstable";
      badge.className = "badgeStatus " + (stable ? "stable" : "unstable");

      if (stable !== lastStable) {
        badge.classList.add('bump');
        setTimeout(() => badge.classList.remove('bump'), 180);
        lastStable = stable;
      }

      updateSPlaneChart(roots);
    }

    function solveQuad(a, b, c) {
      if (Math.abs(a) < 1e-5) return [{ re: -c / b, im: 0 }];

      const d = b * b - 4 * a * c;
      if (d >= 0) {
        return [
          { re: (-b + Math.sqrt(d)) / (2 * a), im: 0 },
          { re: (-b - Math.sqrt(d)) / (2 * a), im: 0 }
        ];
      }
      return [
        { re: -b / (2 * a), im: Math.sqrt(-d) / (2 * a) },
        { re: -b / (2 * a), im: -Math.sqrt(-d) / (2 * a) }
      ];
    }

    function solveCubic(a, b, c) {
      const p = b - a * a / 3;
      const q = 2 * a * a * a / 27 - a * b / 3 + c;
      const d = q * q / 4 + p * p * p / 27;

      let roots = [];
      if (d > 0) {
        const u = Math.cbrt(-q / 2 + Math.sqrt(d));
        const v = Math.cbrt(-q / 2 - Math.sqrt(d));
        roots.push({ re: u + v - a / 3, im: 0 });
        roots.push({ re: -(u + v) / 2 - a / 3, im: (u - v) * Math.sqrt(3) / 2 });
        roots.push({ re: -(u + v) / 2 - a / 3, im: -(u - v) * Math.sqrt(3) / 2 });
      } else {
        const k = 2 * Math.sqrt(-p / 3);
        const t = Math.acos(3 * q / (2 * p * k));
        roots.push({ re: k * Math.cos(t / 3) - a / 3, im: 0 });
        roots.push({ re: k * Math.cos((t + 2 * Math.PI) / 3) - a / 3, im: 0 });
        roots.push({ re: k * Math.cos((t + 4 * Math.PI) / 3) - a / 3, im: 0 });
      }
      return roots;
    }

    // =========================
    // Loop (no manual drawing now)
    // =========================
    function loop() {
      updatePhysics();
      requestAnimationFrame(loop);
    }


