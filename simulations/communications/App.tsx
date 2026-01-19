
import React, { useState, useEffect, useMemo } from 'react';
import { 
  Chart as ChartJS, 
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
  Title, 
  Tooltip, 
  Legend, 
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Activity, Info, RefreshCcw, Zap, BarChart3, Binary, ArrowRight } from 'lucide-react';
import { EncodingType, EncodingParams, SimulationResult } from './types';
import { encodeSignal } from './utils/encodingLogic';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

/**
 * Custom Chart.js plugin to draw bit values above the waveform
 * and dashed vertical separators for each bit interval.
 */
const bitLabelPlugin = {
  id: 'bitLabelPlugin',
  afterDraw: (chart: any) => {
    const { ctx, chartArea, scales } = chart;
    const { top, bottom, left, right } = chartArea;
    const x = scales.x;
    const y = scales.y;

    // We assume labels are bit indices (0, 1, 2...)
    const totalTicks = x.max;
    
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = 'bold 14px Inter';
    ctx.fillStyle = '#4c5d88';

    // 1. Draw dashed vertical dividers
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(9, 16, 42, 0.2)';
    ctx.lineWidth = 1;

    for (let i = 0; i <= totalTicks; i++) {
      const xPos = x.getPixelForValue(i);
      if (xPos >= left && xPos <= right) {
        ctx.beginPath();
        ctx.moveTo(xPos, top);
        ctx.lineTo(xPos, bottom);
        ctx.stroke();
      }
    }

    // 2. Draw bit labels (0 or 1)
    const bits = chart.config.options.plugins.bitLabelPlugin.bits || '';
    ctx.setLineDash([]); // Reset dash for text
    
    // Calculate display bits (some encodings use 2 bits per symbol)
    // We iterate through bit intervals and find the center
    for (let i = 0; i < bits.length; i++) {
      const bitVal = bits[i];
      // Center the label in the bit period (i + 0.5)
      const xPos = x.getPixelForValue(i + 0.5);
      if (xPos >= left && xPos <= right) {
        ctx.fillText(bitVal, xPos, top - 10);
      }
    }

    ctx.restore();
  }
};

ChartJS.register(bitLabelPlugin);

const App: React.FC = () => {
  const [params, setParams] = useState<EncodingParams>({
    bits: '01011011',
    voltage: 5,
    frequency: 1,
    encoding: EncodingType.NRZ_L
  });

  const [simulation, setSimulation] = useState<SimulationResult | null>(null);

  const runSimulation = () => {
    const sanitizedBits = params.bits.replace(/[^01]/g, '') || '0';
    const result = encodeSignal(sanitizedBits, params.voltage, params.frequency, params.encoding);
    setSimulation(result);
  };

  useEffect(() => {
    runSimulation();
  }, [params.encoding, params.voltage, params.bits]);

  const chartData = useMemo(() => {
    if (!simulation) return { labels: [], datasets: [] };
    
    return {
      labels: simulation.labels,
      datasets: [
        {
          label: 'Transmitted Signal',
          data: simulation.signal,
          borderColor: '#0083cc', // Matching the blue in the template image
          backgroundColor: 'rgba(0, 131, 204, 0.05)',
          borderWidth: 3,
          pointRadius: 0,
          tension: 0,
          fill: false,
          stepped: 'before' as const,
        }
      ],
    };
  }, [simulation]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: {
        top: 30 // Leave room for bit labels
      }
    },
    scales: {
      x: {
        type: 'linear' as const,
        title: { display: true, text: 'Time', font: { weight: 'bold', size: 14 }, align: 'end' as const },
        grid: { display: false },
        min: 0,
        max: (simulation?.processedBits || params.bits).length,
        ticks: { display: false } // We'll handle dividers ourselves
      },
      y: {
        title: { display: false },
        grid: { color: 'rgba(9, 16, 42, 0.05)' },
        suggestedMin: -params.voltage - 1,
        suggestedMax: params.voltage + 1,
        ticks: {
          callback: (value: any) => {
            if (value === params.voltage) return '+ V';
            if (value === 0) return '0V';
            if (value === -params.voltage) return '- V';
            return '';
          },
          font: { weight: 'bold' }
        }
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: true },
      bitLabelPlugin: {
        bits: simulation?.processedBits || params.bits
      }
    }
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 bg-[#eaf2ff]/85 backdrop-blur-md border-b border-[rgba(9,16,42,0.14)]">
        <div className="max-w-[1200px] mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#0083cc] flex items-center justify-center shadow-lg shadow-[#0083cc]/20">
              <Zap className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-[15px] font-black leading-tight">MAE Academy</h1>
              <p className="text-[12px] text-[#4c5d88] font-semibold">Digital Signal Laboratory</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setParams(p => ({...p, bits: '01011011'}))} className="px-4 py-2 text-sm font-black border border-[rgba(9,16,42,0.14)] rounded-2xl bg-white/70 hover:bg-white transition-all shadow-sm">
              Typical Case
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-4 py-10">
        <div className="mb-10 text-center">
          <h2 className="text-4xl lg:text-5xl font-black tracking-tight mb-3">Waveform Simulation</h2>
          <div className="inline-flex items-center gap-2 bg-[#0083cc]/10 px-4 py-1.5 rounded-full text-[#0083cc] font-bold text-sm">
            Current: {params.encoding.replace('_', '-').toUpperCase()}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-9 flex flex-col gap-8">
            {/* The actual Waveform display matching the template */}
            <div className="glass-panel p-8 bg-white/95">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-2">
                  <Activity className="text-[#0083cc] w-5 h-5" />
                  <span className="font-black text-xs uppercase tracking-[0.2em] text-[#4c5d88]">Typical Case Signal</span>
                </div>
              </div>
              
              <div className="h-[380px] w-full relative">
                <Line data={chartData} options={chartOptions as any} />
                
                {/* Visual indicator for Y-Axis Labels to ensure they look like the requested image */}
                <div className="absolute left-0 h-full flex flex-col justify-between py-[4.5rem] pointer-events-none opacity-20">
                  <div className="w-4 h-[2px] bg-black" />
                  <div className="w-4 h-[2px] bg-black" />
                  <div className="w-4 h-[2px] bg-black" />
                </div>
              </div>

              <div className="mt-8 pt-8 border-t border-dashed border-[rgba(9,16,42,0.1)] flex items-start gap-4">
                 <div className="w-10 h-10 rounded-full bg-[#0083cc]/10 flex items-center justify-center shrink-0">
                   <Info className="w-5 h-5 text-[#0083cc]" />
                 </div>
                 <div>
                    <h4 className="font-black text-sm mb-1">Encoding Logic Insight</h4>
                    <p className="text-xs font-semibold text-[#4c5d88] leading-relaxed">
                      {simulation?.metrics.description} Transition density and DC offset are key factors in selecting the appropriate line code for specific transmission channels.
                    </p>
                 </div>
              </div>
            </div>

            {/* Config Panel */}
            <div className="glass-panel p-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <div className="flex flex-col gap-4">
                    <label className="text-[13px] font-black uppercase tracking-wider text-[#4c5d88]">Sequence</label>
                    <div className="relative">
                      <Binary className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4c5d88]" />
                      <input 
                        type="text" 
                        value={params.bits}
                        onChange={(e) => setParams(prev => ({ ...prev, bits: e.target.value.replace(/[^01]/g, '') }))}
                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-[rgba(9,16,42,0.16)] bg-white font-black outline-none focus:ring-4 focus:ring-[#0083cc]/10 focus:border-[#0083cc]/40 transition-all text-lg tracking-widest"
                        placeholder="010110"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-4">
                    <label className="text-[13px] font-black uppercase tracking-wider text-[#4c5d88]">Encoding Type</label>
                    <select 
                      value={params.encoding}
                      onChange={(e) => setParams(prev => ({ ...prev, encoding: e.target.value as EncodingType }))}
                      className="w-full px-4 py-3 rounded-xl border border-[rgba(9,16,42,0.16)] bg-white font-black outline-none focus:ring-4 focus:ring-[#0083cc]/10 transition-all appearance-none cursor-pointer"
                    >
                      <optgroup label="Core Techniques">
                        <option value={EncodingType.UNIPOLAR}>Unipolar</option>
                        <option value={EncodingType.NRZ_L}>NRZ-L</option>
                        <option value={EncodingType.NRZ_I}>NRZ-I</option>
                        <option value={EncodingType.POLAR_NRZ}>Polar NRZ</option>
                        <option value={EncodingType.BIPOLAR_AMI}>AMI</option>
                        <option value={EncodingType.MANCHESTER}>Manchester</option>
                        <option value={EncodingType.DIFF_MANCHESTER}>Diff. Manchester</option>
                      </optgroup>
                      <optgroup label="Advanced (ISDN/Ethernet)">
                        <option value={EncodingType.TWO_B_ONE_Q}>2B1Q</option>
                        <option value={EncodingType.MLT_3}>MLT-3</option>
                        <option value={EncodingType.FOUR_D_PAM5}>4D-PAM5</option>
                        <option value={EncodingType.B8ZS}>B8ZS (AMI Scrambled)</option>
                        <option value={EncodingType.HDB3}>HDB3 (AMI Scrambled)</option>
                      </optgroup>
                      <optgroup label="Block Codes">
                        <option value={EncodingType.FOUR_B_FIVE_B}>4B/5B</option>
                        <option value={EncodingType.EIGHT_B_TEN_B}>8B/10B</option>
                        <option value={EncodingType.EIGHT_B_SIX_T}>8B6T</option>
                      </optgroup>
                    </select>
                  </div>

                  <div className="flex items-end">
                    <button 
                      onClick={runSimulation}
                      className="w-full py-3.5 bg-[#09102a] text-white font-black rounded-xl hover:translate-y-[-2px] transition-all flex items-center justify-center gap-3 shadow-lg shadow-[#09102a]/20"
                    >
                      <RefreshCcw className="w-5 h-5" /> Run Simulator
                    </button>
                  </div>
                </div>
            </div>
          </div>

          {/* Sidebar Info */}
          <div className="lg:col-span-3 flex flex-col gap-6">
            <div className="glass-panel p-6 bg-gradient-to-br from-[#09102a] to-[#1b254a] text-white">
              <div className="flex items-center gap-2 mb-6">
                <BarChart3 className="text-[#0083cc] w-5 h-5" />
                <span className="font-black text-xs uppercase tracking-widest opacity-70">Live Metrics</span>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-white/10 rounded-2xl border border-white/5">
                  <div className="text-2xl font-black mb-1">{simulation?.metrics.avgDC.toFixed(2)}V</div>
                  <div className="text-[10px] font-black uppercase opacity-60">Avg DC Component</div>
                </div>
                <div className="p-4 bg-white/10 rounded-2xl border border-white/5">
                  <div className="text-2xl font-black mb-1">{simulation?.metrics.transitions || 0}</div>
                  <div className="text-[10px] font-black uppercase opacity-60">Signal Transitions</div>
                </div>
              </div>
            </div>

            <div className="glass-panel p-6">
              <h4 className="font-black text-xs uppercase tracking-widest text-[#4c5d88] mb-4">Preset Patterns</h4>
              <div className="flex flex-col gap-2">
                {[
                  { l: 'Long Zeros', v: '00000000' },
                  { l: 'Long Ones', v: '11111111' },
                  { l: 'Alternating', v: '10101010' },
                  { l: 'Burst Data', v: '11100010' }
                ].map(p => (
                  <button 
                    key={p.v}
                    onClick={() => setParams(prev => ({...prev, bits: p.v}))}
                    className="w-full p-3 rounded-xl border border-[rgba(9,16,42,0.06)] bg-[#f8fbff] text-left hover:border-[#0083cc] transition-all group"
                  >
                    <div className="text-[11px] font-black text-[#4c5d88] mb-1">{p.l}</div>
                    <div className="text-xs font-black group-hover:text-[#0083cc]">{p.v}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
      
      <footer className="py-10 text-center opacity-40">
        <p className="text-[11px] font-bold">MAE ACADEMY • COMMUNICATIONS LAB V2.5</p>
      </footer>
    </div>
  );
};

export default App;
