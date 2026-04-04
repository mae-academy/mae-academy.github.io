document.addEventListener("DOMContentLoaded", () => {
    let myChart = null;

    function renderChart(labels, vIn, vOut, iOut) {
      const ctx = document.getElementById('mainChart').getContext('2d');
      if (myChart) myChart.destroy();

      // MAE palette
      const MAE_GREEN = "#08b58d";
      const MAE_BLUE  = "#3f6fff";
      const MAE_IN    = "rgba(76, 93, 136, 0.95)";   // muted
      const GRID      = "rgba(9,16,42,0.10)";
      const TICKS     = "rgba(9,16,42,0.70)";

      myChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Input Voltage (Phase A)',
              data: vIn,
              borderColor: MAE_IN,
              backgroundColor: "rgba(76,93,136,0.12)",
              borderWidth: 2,
              pointRadius: 0,
              borderDash: [6, 6],
              tension: 0.25,
              yAxisID: 'y'
            },
            {
              label: 'Output Voltage',
              data: vOut,
              borderColor: MAE_BLUE,
              backgroundColor: "rgba(63,111,255,0.15)",
              borderWidth: 3,
              pointRadius: 0,
              tension: 0.25,
              yAxisID: 'y'
            },
            {
              label: 'Output Current',
              data: iOut,
              borderColor: MAE_GREEN,
              backgroundColor: "rgba(8,181,141,0.14)",
              borderWidth: 3,
              pointRadius: 0,
              tension: 0.25,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },

          plugins: {
            legend: {
              labels: {
                color: TICKS,
                font: { family: "Inter", weight: "800" },
                usePointStyle: true,
                boxWidth: 10
              }
            },
            tooltip: {
              backgroundColor: "rgba(255,255,255,0.96)",
              titleColor: "rgba(9,16,42,0.95)",
              bodyColor: "rgba(9,16,42,0.85)",
              borderColor: "rgba(9,16,42,0.12)",
              borderWidth: 1
            }
          },

          scales: {
            x: {
              grid: { color: GRID },
              ticks: { color: TICKS, maxTicksLimit: 10 },
              title: { display: true, text: 'Time (s)', color: TICKS, font: { weight: "900" } }
            },
            y: {
              type: 'linear',
              position: 'left',
              grid: { color: GRID },
              ticks: { color: TICKS },
              title: { display: true, text: 'Voltage (V)', color: TICKS, font: { weight: "900" } }
            },
            y1: {
              type: 'linear',
              position: 'right',
              grid: { drawOnChartArea: false },
              ticks: { color: TICKS },
              title: { display: true, text: 'Current (A)', color: TICKS, font: { weight: "900" } }
            }
          }
        }
      });
    }

    function toggleInputs() {
      const type = document.getElementById('loadType').value;
      document.getElementById('input-L').style.display = (type === 'RL') ? 'block' : 'none';
      document.getElementById('input-C').style.display = (type === 'RC') ? 'block' : 'none';
    }

    function resetDefaults(){
      document.getElementById('phase').value = "1";
      document.getElementById('rectType').value = "half";
      document.getElementById('loadType').value = "R";
      document.getElementById('fwd').value = "no";
      document.getElementById('vType').value = "rms";
      document.getElementById('vin_val').value = 220;
      document.getElementById('freq').value = 50;
      document.getElementById('r_val').value = 10;
      document.getElementById('l_val').value = 0.1;
      document.getElementById('c_val').value = 1000;
      toggleInputs();
      runSimulation();
    }

    /* ── Diagram Rendering Engine ──────────────────────── */

    function getDiagramPath(phase, rectType, loadType, useFWD) {
      var p = (phase === 1 || phase === '1') ? '1P' : '3P';
      var r = (rectType === 'half') ? 'HW' : 'FW';
      var l = loadType.toUpperCase();          // R | RL | RC
      var fwd = useFWD ? '+FWD' : '';

      // R and R+FWD folders use clean naming:  <phase>-<rect>-<load><fwd>.svg
      // RL / RC (± FWD) folders nest inside Schematic_mae-academy_2026-01-03/
      // and use a different naming scheme

      var folder, fileName;

      if (l === 'R') {
        folder = useFWD ? 'R+FWD' : 'R';
        fileName = p + '-' + r + '-R' + fwd + '.svg';
        return './diagrams/' + folder + '/' + fileName;
      }

      // RL / RC loads (with and without FWD)
      folder = l + fwd;                                       // e.g. "RL" or "RC+FWD"
      var subDir = 'Schematic_mae-academy_2026-01-03';

      // Inside these folders the convention is:
      // HW  → <phase>HWCR<fwd>.svg
      // FW  → <phase>FWCR<fwd>.svg   (some have trailing timestamps, try without first)
      var base = p + (r === 'HW' ? 'HW' : 'FW') + 'CR';
      // 3-phase + FWD files carry "+FWD" in the name even inside FWD folders
      if (useFWD && p === '3P') base += '+FWD';
      fileName = base + '.svg';

      return './diagrams/' + folder + '/' + subDir + '/' + fileName;
    }

    function renderDiagram(phase, rectType, loadType, useFWD) {
      var container = document.getElementById('diagramContainer');
      if (!container) return;

      var path = getDiagramPath(phase, rectType, loadType, useFWD);
      var isSvg = path.toLowerCase().endsWith('.svg');

      if (isSvg) {
        fetch(path)
          .then(function (res) {
            if (!res.ok) throw new Error(res.status);
            return res.text();
          })
          .then(function (svgText) {
            container.innerHTML = '';
            container.innerHTML = svgText;
            var svgEl = container.querySelector('svg');
            if (svgEl) {
              svgEl.removeAttribute('width');
              svgEl.removeAttribute('height');
            }
          })
          .catch(function () {
            container.innerHTML = "<span>Diagram not available</span>";
          });
      } else {
        var img = document.createElement('img');
        img.onload = function() {
          container.innerHTML = '';
          container.appendChild(img);
        };
        img.onerror = function() {
          container.innerHTML = "<span>Diagram not available</span>";
        };
        img.src = path;
      }
    }

    /* ── End Diagram Engine ──────────────────────────── */

    function runSimulation() {
      const phase = parseInt(document.getElementById('phase').value);
      const rectType = document.getElementById('rectType').value;
      const loadType = document.getElementById('loadType').value;
      const useFWD = document.getElementById('fwd').value === 'yes';

      let vInVal = parseFloat(document.getElementById('vin_val').value);
      const vType = document.getElementById('vType').value;
      const freq = parseFloat(document.getElementById('freq').value);

      const R = Math.max(0.0001, parseFloat(document.getElementById('r_val').value));
      const L = (loadType === 'RL') ? Math.max(0.000001, parseFloat(document.getElementById('l_val').value)) : 0;
      const C = (loadType === 'RC') ? Math.max(0.000000001, parseFloat(document.getElementById('c_val').value)) * 1e-6 : 0;

      let Vm = (vType === 'rms') ? vInVal * Math.sqrt(2) : vInVal;

      const cycles = 3;
      const period = 1 / freq;
      const samplesPerCycle = 360;
      const totalSamples = samplesPerCycle * cycles;
      const dt = period / samplesPerCycle;
      const omega = 2 * Math.PI * freq;

      let timeArr = [];
      let vInArr = [];
      let vOutArr = [];
      let iOutArr = [];

      let i_curr = 0;
      let v_cap = 0;

      document.getElementById('circuitLabel').innerText =
        `${phase}-Phase ${rectType}-Wave ${loadType}-Load ${useFWD ? '(With FWD)' : ''}`;

      renderDiagram(phase, rectType, loadType, useFWD);

      for (let n = 0; n < totalSamples; n++) {
        let t = n * dt;
        let theta = omega * t;

        let Va = Vm * Math.sin(theta);
        let Vb = Vm * Math.sin(theta - (2*Math.PI/3));
        let Vc = Vm * Math.sin(theta + (2*Math.PI/3));

        let v_supply_instant = 0;

        if (phase === 1) {
          if (rectType === 'half') v_supply_instant = (Va > 0) ? Va : 0;
          else v_supply_instant = Math.abs(Va);
        } else {
          if (rectType === 'half') {
            v_supply_instant = Math.max(Va, Vb, Vc);
            if (v_supply_instant < 0) v_supply_instant = 0;
          } else {
            let maxV = Math.max(Va, Vb, Vc);
            let minV = Math.min(Va, Vb, Vc);
            v_supply_instant = maxV - minV;
          }
        }

        let v_load = 0;
        let i_load = 0;

        if (loadType === 'R') {
          v_load = v_supply_instant;
          i_load = v_load / R;

        } else if (loadType === 'RL') {
          let v_forcing = 0;

          if (phase === 1 && rectType === 'half') {
            if (useFWD) v_forcing = (Va > 0) ? Va : 0;
            else v_forcing = Va;
          } else {
            v_forcing = v_supply_instant;
          }

          let di = (v_forcing - R * i_curr) * (dt / L);
          let i_next = i_curr + di;
          if (i_next < 0) i_next = 0;

          v_load = (i_next > 0) ? v_forcing : Math.max(0, v_forcing);

          i_curr = i_next;
          i_load = i_curr;

        } else if (loadType === 'RC') {
          if (v_supply_instant > v_cap) v_cap = v_supply_instant;
          else v_cap = v_cap * Math.exp(-dt / (R * C));

          v_load = v_cap;
          i_load = v_load / R;
        }

        if (n > samplesPerCycle) {
          timeArr.push(Number(t.toFixed(4)));
          vInArr.push(Va);
          vOutArr.push(v_load);
          iOutArr.push(i_load);
        }
      }

      let sumV = 0, sumV2 = 0;
      let sumI = 0, sumI2 = 0;
      let sumP = 0;
      const N = vOutArr.length || 1;

      for (let k = 0; k < N; k++) {
        let v = vOutArr[k];
        let i = iOutArr[k];
        sumV += v;
        sumV2 += v*v;
        sumI += i;
        sumI2 += i*i;
        sumP += (v*i);
      }

      const Vdc = sumV / N;
      const Vrms = Math.sqrt(sumV2 / N);
      const Idc = sumI / N;
      const Irms = Math.sqrt(sumI2 / N);

      const Pdc = Vdc * Idc;
      const Pac_active = sumP / N;

      const Vac_ripple = Math.sqrt(Math.max(0, Vrms*Vrms - Vdc*Vdc));
      const FF = (Vdc !== 0) ? (Vrms / Vdc) : 0;
      const RF = (Vdc !== 0) ? (Vac_ripple / Vdc) : 0;
      const EF = (Pac_active !== 0) ? (Pdc / Pac_active) * 100 : 0;

      let pulseCount = 0;
      if (phase === 1 && rectType === 'half') pulseCount = 1;
      else if (phase === 1 && rectType === 'full') pulseCount = 2;
      else if (phase === 3 && rectType === 'half') pulseCount = 3;
      else if (phase === 3 && rectType === 'full') pulseCount = 6;
      const fOut = freq * pulseCount;

      document.getElementById('out_Vrms').innerText = Vrms.toFixed(6) + " V";
      document.getElementById('out_Vdc').innerText = Vdc.toFixed(6) + " V";
      document.getElementById('out_Irms').innerText = Irms.toFixed(6) + " A";
      document.getElementById('out_Idc').innerText = Idc.toFixed(6) + " A";
      document.getElementById('out_Pdc').innerText = Pdc.toFixed(6) + " W";
      document.getElementById('out_Pac').innerText = Pac_active.toFixed(6) + "W";
      document.getElementById('out_fo').innerText = fOut.toFixed(0) + " Hz";
      document.getElementById('out_Vac').innerText = Vac_ripple.toFixed(6);
      document.getElementById('out_FF').innerText = FF.toFixed(6); 
      document.getElementById('out_RF').innerText = RF.toFixed(6); 
      document.getElementById('out_EF').innerText = EF.toFixed(2) + " %";

      renderChart(timeArr, vInArr, vOutArr, iOutArr);
    }

    (function setupReveal(){
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
    })();

    document.getElementById('loadType').addEventListener('change', () => { toggleInputs(); runSimulation(); });
    ['phase','rectType','fwd','vType','vin_val','freq','r_val','l_val','c_val'].forEach(id=>{
      const el = document.getElementById(id);
      if(!el) return;
      el.addEventListener('change', runSimulation);
    });

    document.getElementById('simulateBtn').addEventListener('click', runSimulation);
    document.getElementById('resetBtn').addEventListener('click', resetDefaults);

    toggleInputs();
    runSimulation();
});
