// =========================
// Intersection Observer (Reveal)
// =========================
window.addEventListener('load', () => {
  const revealEls = document.querySelectorAll('.reveal');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('isVisible');
        io.unobserve(e.target);
      }
    }
  }, { threshold: 0.12 });
  revealEls.forEach(el => io.observe(el));
});

// Dynamic year
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// =========================
// Encoding Types
// =========================
const EncodingType = {
  NRZ_L: 'nrz_l',
  NRZ_I: 'nrz_i',
  UNIPOLAR: 'unipolar',
  POLAR_NRZ: 'polar_nrz',
  AMI: 'ami',
  MANCHESTER: 'manchester',
  DIFF_MANCHESTER: 'diff_manchester',
  B8ZS: 'b8zs',
  HDB3: 'hdb3',
};

// =========================
// Signal Encoder
// =========================
function encodeSignal(bitsStr, voltage, type) {
  const bits = bitsStr.split('').map(b => parseInt(b, 10));
  const data = [];
  let transitions = 0;
  let currentLevel = voltage;
  let lastNonZero = -voltage;
  let hdb3PulseCount = 0;

  const pushSegment = (x, y) => data.push({ x, y });

  for (let i = 0; i < bits.length; i++) {
    const bit = bits[i];
    const t = i;

    // B8ZS: replace 8 consecutive zeros
    if (type === EncodingType.B8ZS && bit === 0 && bits.slice(i, i + 8).join('') === '00000000') {
      const previous = lastNonZero;
      const v1 = previous;
      const b1 = -previous;
      const v2 = b1;
      const b2 = -b1;

      pushSegment(t, 0);
      pushSegment(t + 1, 0);
      pushSegment(t + 2, 0);
      pushSegment(t + 3, v1);
      pushSegment(t + 4, b1);
      pushSegment(t + 5, 0);
      pushSegment(t + 6, v2);
      pushSegment(t + 7, b2);

      lastNonZero = b2;
      i += 7;
      continue;
    }

    // HDB3: replace 4 consecutive zeros
    if (type === EncodingType.HDB3 && bit === 0 && bits.slice(i, i + 4).join('') === '0000') {
      if (hdb3PulseCount % 2 !== 0) {
        pushSegment(t, 0);
        pushSegment(t + 1, 0);
        pushSegment(t + 2, 0);
        const v = lastNonZero;
        pushSegment(t + 3, v);
        lastNonZero = v;
      } else {
        const b = -lastNonZero;
        pushSegment(t, b);
        pushSegment(t + 1, 0);
        pushSegment(t + 2, 0);
        pushSegment(t + 3, b);
        lastNonZero = b;
      }
      hdb3PulseCount = 0;
      i += 3;
      continue;
    }

    switch (type) {
      case EncodingType.UNIPOLAR:
        pushSegment(t, bit ? voltage : 0);
        break;
      case EncodingType.NRZ_L:
        pushSegment(t, bit === 0 ? voltage : -voltage);
        break;
      case EncodingType.NRZ_I:
        if (bit === 1) currentLevel = -currentLevel;
        pushSegment(t, currentLevel);
        break;
      case EncodingType.POLAR_NRZ:
        pushSegment(t, bit === 1 ? voltage : -voltage);
        break;
      case EncodingType.AMI:
      case EncodingType.B8ZS:
      case EncodingType.HDB3:
        if (bit === 0) {
          pushSegment(t, 0);
        } else {
          lastNonZero = -lastNonZero;
          pushSegment(t, lastNonZero);
          hdb3PulseCount++;
        }
        break;
      case EncodingType.MANCHESTER:
        pushSegment(t, bit === 0 ? voltage : -voltage);
        pushSegment(t + 0.5, bit === 0 ? -voltage : voltage);
        break;
      case EncodingType.DIFF_MANCHESTER:
        if (bit === 0) currentLevel = -currentLevel;
        pushSegment(t, currentLevel);
        currentLevel = -currentLevel;
        pushSegment(t + 0.5, currentLevel);
        break;
      default:
        pushSegment(t, bit ? voltage : 0);
    }
  }

  // Add trailing point to close the waveform
  if (data.length > 0) {
    data.push({ x: bits.length, y: data[data.length - 1].y });
  }

  // Count transitions
  for (let i = 1; i < data.length; i++) {
    if (data[i].y !== data[i - 1].y) transitions++;
  }

  return { signal: data, processedBits: bitsStr, transitions };
}

// =========================
// DOM Elements
// =========================
const bitsInput = document.getElementById('bitsInput');
const encodingSelect = document.getElementById('encodingSelect');
const refreshBtn = document.getElementById('refreshBtn');
const transitionCount = document.getElementById('transitionCount');
const levelsCount = document.getElementById('levelsCount');
const dcComp = document.getElementById('dcComp');

// =========================
// Chart.js
// =========================
let chartInstance = null;

function updateWaveform() {
  const rawBits = (bitsInput.value || '0').replace(/[^01]/g, '') || '0';
  const encoding = encodingSelect.value;
  const voltage = 5;

  const result = encodeSignal(rawBits, voltage, encoding);

  // Update stats
  let levels = 2;
  if ([EncodingType.AMI, EncodingType.B8ZS, EncodingType.HDB3].includes(encoding)) levels = 3;

  const sum = result.signal.reduce((a, b) => a + b.y, 0);
  const avg = result.signal.length ? sum / result.signal.length : 0;
  const dcText = Math.abs(avg) < 0.1 ? 'Zero' : (avg > 0 ? '+ Positive' : '- Negative');

  transitionCount.textContent = result.transitions;
  levelsCount.textContent = levels;
  dcComp.textContent = dcText;

  // Color the DC component badge
  dcComp.className = 'stat-val' + (dcText === 'Zero' ? ' good' : ' warn');

  // Destroy old chart
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  // Textbook plugin — draws grid lines and bit labels
  const textbookPlugin = {
    id: 'textbookPlugin',
    afterDraw: (chart) => {
      const { ctx, chartArea, scales } = chart;
      const x = scales.x;
      const bitsArr = result.processedBits;

      ctx.save();
      ctx.strokeStyle = 'rgba(9,16,42,0.1)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);

      for (let i = 0; i <= bitsArr.length; i++) {
        const xPos = x.getPixelForValue(i);
        if (xPos >= chartArea.left && xPos <= chartArea.right) {
          ctx.beginPath();
          ctx.moveTo(xPos, chartArea.top - 20);
          ctx.lineTo(xPos, chartArea.bottom);
          ctx.stroke();
        }
      }

      ctx.setLineDash([]);
      ctx.fillStyle = '#4c5d88';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (let i = 0; i < bitsArr.length; i++) {
        const xPos = x.getPixelForValue(i + 0.5);
        if (xPos >= chartArea.left && xPos <= chartArea.right) {
          ctx.fillText(bitsArr[i], xPos, chartArea.top - 10);
        }
      }
      ctx.restore();
    }
  };

  // Create chart
  const canvas = document.getElementById('waveformChart');
  chartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [{
        data: result.signal,
        borderColor: '#3f6fff',
        borderWidth: 3,
        pointRadius: 0,
        stepped: 'before',
        tension: 0,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 40, right: 20, left: 10, bottom: 10 } },
      scales: {
        x: {
          type: 'linear',
          min: 0,
          max: rawBits.length,
          grid: { display: false },
          ticks: { display: false },
          border: { display: false },
        },
        y: {
          min: -voltage - 1.5,
          max: voltage + 1.5,
          grid: { display: false },
          border: { display: false },
          ticks: {
            callback: function (val) {
              if (Math.abs(val - voltage) < 0.1) return '+V';
              if (Math.abs(val) < 0.1) return '0V';
              if (Math.abs(val + voltage) < 0.1) return '-V';
              return '';
            },
            font: { weight: 'bold', size: 12 },
            color: '#4c5d88',
            padding: 10,
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
      animation: { duration: 0 },
    },
    plugins: [textbookPlugin],
  });
}

// =========================
// Event Listeners
// =========================
bitsInput.addEventListener('input', updateWaveform);
encodingSelect.addEventListener('change', updateWaveform);
refreshBtn.addEventListener('click', updateWaveform);

// Presets
document.querySelectorAll('.presetBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    bitsInput.value = btn.dataset.bits;
    updateWaveform();
  });
});

// =========================
// Initial Render
// =========================
updateWaveform();
