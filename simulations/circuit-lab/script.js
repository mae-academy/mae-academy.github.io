let simChart = null;

let params = { type: 'DC', V: 10, freq: 0.5, R: 10, L: 2.0, C: 100, probe: 'VC' };
let state = { q: 0, i: 0 }; // q = charge (Coulombs), i = current (Amps)

const MAX_HISTORY = 600;
const DT_FRAME = 0.02; 

let tSeries = [];
let vSrcSeries = [];
let probeSeries = [];
let simTime = 0;

let lastChartUpdate = 0;
const CHART_UPDATE_MS = 80;

init();

function init() {
  bindInputs();
  makeCharts();
  updateUI();

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

function makeCharts() {
  const simCtx = document.getElementById('simCanvas').getContext('2d');
  simChart = new Chart(simCtx, {
    type: 'line',
    data: {
      labels: tSeries,
      datasets: [
        {
          label: 'CH1: V_Source',
          data: vSrcSeries,
          borderWidth: 2,
          pointRadius: 0,
          borderDash: [6, 6],
          tension: 0.1,
          borderColor: '#08b58d'
        },
        {
          label: 'CH2: Probe',
          data: probeSeries,
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
      plugins: { legend: { display: true } },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Time (s)' },
        },
        y: {
          title: { display: true, text: 'Amplitude' },
          suggestedMin: -20,
          suggestedMax: 20
        }
      }
    }
  });
}

function bindInputs() {
  const bindVal = (id, key) => {
    const el = document.getElementById(id);
    if(!el) return;
    el.addEventListener('input', e => {
      params[key] = parseFloat(e.target.value);
      const valEl = document.getElementById(id.replace('inp', 'val'));
      if(valEl) valEl.innerText = params[key];
    });
  };

  bindVal('inp-v', 'V');
  bindVal('inp-freq', 'freq');
  bindVal('inp-r', 'R');
  bindVal('inp-l', 'L');
  bindVal('inp-c', 'C');

  document.getElementById('inp-type').addEventListener('change', e => {
    params.type = e.target.value;
    updateUI();
  });
  document.getElementById('inp-probe').addEventListener('change', e => {
    params.probe = e.target.value;
    simChart.data.datasets[1].label = `CH2: ${e.target.options[e.target.selectedIndex].text}`;
  });
}

function updateUI() {
  const isAC = params.type === 'AC';
  document.querySelectorAll('.param-ac').forEach(e => e.style.display = isAC ? 'block' : 'none');
  resetSim();
}

function resetSim() {
  state = { q: 0, i: 0 };
  tSeries.length = 0;
  vSrcSeries.length = 0;
  probeSeries.length = 0;
  simTime = 0;
  document.getElementById('sim-warning').style.display = 'none';
  simChart.update('none');
}

function triggerPulse() {
  // Briefly injects voltage offset
  state.q += (5 * (params.C / 1000)); 
}

function updatePhysics() {
  const SUB = 40; 
  const DT = DT_FRAME / SUB;
  let v_src = 0, v_c = 0, v_r = 0, v_l = 0;

  for (let step = 0; step < SUB; step++) {
    if (params.type === 'DC') {
      v_src = params.V;
    } else {
      v_src = params.V * Math.sin(2 * Math.PI * params.freq * simTime);
    }

    // Convert C to Farads (from mF)
    const C_farads = params.C / 1000.0;
    
    v_c = state.q / C_farads;
    v_r = state.i * params.R;
    
    // L * di/dt = V_src - V_R - V_C
    v_l = v_src - v_r - v_c;
    const di_dt = v_l / params.L;

    state.i += di_dt * DT;
    state.q += state.i * DT;
    simTime += DT;

    if (Math.abs(state.i) > 100) {
      handleCrash();
      return;
    }
  }

  // Determine what CH2 shows
  let probeVal = 0;
  if (params.probe === 'I') probeVal = state.i;
  else if (params.probe === 'VR') probeVal = v_r;
  else if (params.probe === 'VC') probeVal = v_c;
  else if (params.probe === 'VL') probeVal = v_l;

  updateDMM(v_src, state.i, v_r, v_c, v_l);
  pushHistory(v_src, probeVal);
  updateChartsMaybe();
}

function updateDMM(vSrc, i, vr, vc, vl) {
  document.getElementById('dmm-vsrc').innerText = vSrc.toFixed(2) + ' V';
  document.getElementById('dmm-i').innerText = i.toFixed(3) + ' A';
  document.getElementById('dmm-vr').innerText = vr.toFixed(2) + ' V';
  document.getElementById('dmm-vc').innerText = vc.toFixed(2) + ' V';
  document.getElementById('dmm-vl').innerText = vl.toFixed(2) + ' V';
}

function pushHistory(ch1, ch2) {
  tSeries.push(simTime.toFixed(2));
  vSrcSeries.push(ch1);
  probeSeries.push(ch2);

  if (tSeries.length > MAX_HISTORY) {
    tSeries.shift();
    vSrcSeries.shift();
    probeSeries.shift();
  }
}

function updateChartsMaybe() {
  const now = performance.now();
  if (now - lastChartUpdate < CHART_UPDATE_MS) return;
  lastChartUpdate = now;

  let minX = (simTime <= 10) ? 0 : simTime - 10;
  simChart.options.scales.x.min = minX;
  simChart.options.scales.x.max = minX + 10;
  simChart.update('none');
}

function handleCrash() {
  document.getElementById('sim-warning').style.display = 'flex';
  setTimeout(() => resetSim(), 1500);
}

function loop() {
  updatePhysics();
  requestAnimationFrame(loop);
}