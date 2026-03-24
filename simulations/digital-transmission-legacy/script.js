document.addEventListener("DOMContentLoaded", () => {
    // --- Logic ---
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
        TWO_B_ONE_Q: '2b1q',
        MLT_3: 'mlt_3',
        FOUR_D_PAM5: '4d_pam5'
    };

    function encodeSignal(bitsStr, voltage, type) {
        const bits = bitsStr.split('').map(b => parseInt(b));
        const data = [];
        let transitions = 0;
        
        let currentLevel = voltage;
        let lastNonZero = -voltage; // For AMI
        
        // Initial state setup
        if (type === 'nrz-i') currentLevel = voltage; // Assume start High
        if (type === 'diff_manchester') currentLevel = voltage;

        for (let i = 0; i < bits.length; i++) {
            const bit = bits[i];
            const t = i;
            
            switch (type) {
                case 'unipolar':
                    data.push({x: t, y: bit ? voltage : 0});
                    break;
                case 'nrz-l':
                    // 0 -> +V, 1 -> -V
                    data.push({x: t, y: bit === 0 ? voltage : -voltage});
                    break;
                case 'nrz-i':
                    // 1 -> Invert, 0 -> No change
                    if (bit === 1) currentLevel = -currentLevel;
                    data.push({x: t, y: currentLevel});
                    break;
                case 'polar_nrz':
                    // 1 -> +V, 0 -> -V
                    data.push({x: t, y: bit === 1 ? voltage : -voltage});
                    break;
                case 'ami':
                case 'b8zs': // Simplified AMI for now
                case 'hdb3': // Simplified AMI for now
                    // 0 -> 0, 1 -> Alternating
                    if (bit === 0) {
                        data.push({x: t, y: 0});
                    } else {
                        lastNonZero = -lastNonZero;
                        data.push({x: t, y: lastNonZero});
                    }
                    break;
                case 'manchester':
                    // 0: High->Low, 1: Low->High
                    data.push({x: t, y: bit === 0 ? voltage : -voltage});
                    data.push({x: t + 0.5, y: bit === 0 ? -voltage : voltage});
                    break;
                case 'diff-manchester':
                    // 0 -> Transition at start, 1 -> No transition
                    if (bit === 0) currentLevel = -currentLevel;
                    data.push({x: t, y: currentLevel});
                    currentLevel = -currentLevel; // Always transition at mid
                    data.push({x: t + 0.5, y: currentLevel});
                    break;
                default:
                    data.push({x: t, y: bit ? voltage : 0});
            }
        }
        
        // Final point to extend the last level
        if (data.length > 0) {
            data.push({x: bits.length, y: data[data.length - 1].y});
        }

        // Count transitions
        for (let i = 1; i < data.length; i++) {
            if (data[i].y !== data[i-1].y) transitions++;
        }

        return { labels: [], signal: data, processedBits: bitsStr, transitions };
    }

    // Chart.js Plugin for Textbook Style
    const textbookPlugin = {
      id: 'textbookPlugin',
      afterDraw: (chart) => {
        const { ctx, chartArea, scales } = chart;
        const x = scales.x;
        const y = scales.y;
        const bits = chart.config.options.plugins.textbookPlugin.bits || '';
        
        ctx.save();
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);

        // Draw vertical grid lines for bits
        for (let i = 0; i <= bits.length; i++) {
          const xPos = x.getPixelForValue(i);
          if (xPos >= chartArea.left && xPos <= chartArea.right) {
            ctx.beginPath();
            ctx.moveTo(xPos, chartArea.top - 20);
            ctx.lineTo(xPos, chartArea.bottom);
            ctx.stroke();
          }
        }

        // Draw Bit Labels
        ctx.setLineDash([]);
        ctx.fillStyle = '#64748b';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        for (let i = 0; i < bits.length; i++) {
          const xPos = x.getPixelForValue(i + 0.5);
          if (xPos >= chartArea.left && xPos <= chartArea.right) {
            ctx.fillText(bits[i], xPos, chartArea.top - 10);
          }
        }

        // Draw Axes Arrows
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        
        // Y-axis arrow
        ctx.beginPath();
        ctx.moveTo(chartArea.left, chartArea.bottom + 10);
        ctx.lineTo(chartArea.left, chartArea.top - 30);
        ctx.stroke();
        // Arrowhead Y
        ctx.beginPath();
        ctx.moveTo(chartArea.left - 5, chartArea.top - 25);
        ctx.lineTo(chartArea.left, chartArea.top - 35);
        ctx.lineTo(chartArea.left + 5, chartArea.top - 25);
        ctx.stroke();

        // X-axis arrow
        const yZero = y.getPixelForValue(0) || chartArea.bottom;
        ctx.beginPath();
        ctx.moveTo(chartArea.left - 10, yZero);
        ctx.lineTo(chartArea.right + 20, yZero);
        ctx.stroke();
        // Arrowhead X
        ctx.beginPath();
        ctx.moveTo(chartArea.right + 15, yZero - 5);
        ctx.lineTo(chartArea.right + 25, yZero);
        ctx.lineTo(chartArea.right + 15, yZero + 5);
        ctx.stroke();

        ctx.restore();
      }
    };

    // --- App State & Render ---
    let chartInstance = null;
    const voltage = 5;

    function updateSimulation() {
        const bitsInput = document.getElementById('bitsInput');
        const encodingSelect = document.getElementById('encodingSelect');
        
        // Clean input
        const rawBits = bitsInput.value.replace(/[^01]/g, '');
        if (bitsInput.value !== rawBits) bitsInput.value = rawBits;
        
        const bits = rawBits || '0'; // Fallback
        const type = encodingSelect.value;

        // Run Simulation
        const result = encodeSignal(bits, voltage, type);

        // Update Stats
        document.getElementById('transitionCount').textContent = result.transitions;
        
        // DC Component Estimate
        const sum = result.signal.reduce((a, b) => a + b.y, 0);
        const avg = sum / result.signal.length;
        document.getElementById('dcComp').textContent = Math.abs(avg) < 0.1 ? "Zero" : (avg > 0 ? "+ Positive" : "- Negative");

        // Update Levels Text
        let levels = 2;
        if (type === '2b1q') levels = 4;
        else if (type === '4d_pam5') levels = 5;
        else if (['ami', 'b8zs', 'hdb3', 'mlt_3'].includes(type)) levels = 3;
        document.getElementById('levelsCount').textContent = `${levels} States`;

        // Render Chart
        const ctx = document.getElementById('waveformChart').getContext('2d');
        
        if (chartInstance) {
            chartInstance.destroy();
        }

        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    data: result.signal,
                    borderColor: '#0083cc',
                    borderWidth: 3,
                    pointRadius: 0,
                    stepped: 'before',
                    tension: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 40, right: 40, left: 20, bottom: 20 } },
                scales: {
                    x: {
                        type: 'linear',
                        min: 0,
                        max: bits.length,
                        grid: { display: false },
                        ticks: { display: false },
                        border: { display: false }
                    },
                    y: {
                        min: -voltage - 1.5,
                        max: voltage + 1.5,
                        grid: { display: false },
                        border: { display: false },
                        ticks: {
                            callback: function(val) {
                                if (Math.abs(val - voltage) < 0.1) return '+V';
                                if (Math.abs(val) < 0.1) return '0V';
                                if (Math.abs(val + voltage) < 0.1) return '-V';
                                return '';
                            },
                            font: { weight: 'bold', size: 12 },
                            color: '#64748b',
                            padding: 10
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false },
                    textbookPlugin: { bits: result.processedBits }
                },
                animation: { duration: 0 }
            },
            plugins: [textbookPlugin]
        });
    }

    // Helpers
    window.setParams = function(bits, type) {
        if (bits !== undefined) document.getElementById('bitsInput').value = bits;
        if (type !== undefined) document.getElementById('encodingSelect').value = type;
        updateSimulation();
    };

    // Event Listeners
    document.getElementById('bitsInput').addEventListener('input', updateSimulation);
    document.getElementById('encodingSelect').addEventListener('change', updateSimulation);
    document.getElementById('refreshBtn').addEventListener('click', updateSimulation);

    // Init
    updateSimulation();
});
