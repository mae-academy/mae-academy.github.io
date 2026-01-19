
import { EncodingType, SimulationResult } from '../types';

const MAP_4B5B: Record<string, string> = {
  '0000': '11110', '0001': '01001', '0010': '10100', '0011': '10101',
  '0100': '01010', '0101': '01011', '0110': '01110', '0111': '01111',
  '1000': '10010', '1001': '10011', '1010': '10110', '1011': '10111',
  '1100': '11010', '1101': '11011', '1110': '11100', '1111': '11101'
};

const MAP_8B10B_SUBSET: Record<string, string> = {
  '00000000': '1001110100', '11111111': '1010110001', '10101010': '0101010101',
};

export const encodeSignal = (
  bitsStr: string,
  voltage: number,
  freq: number,
  type: EncodingType
): SimulationResult => {
  let workingBits = bitsStr;
  let displayBits = bitsStr;

  // Pre-processing for block codes
  if (type === EncodingType.FOUR_B_FIVE_B) {
    let result = '';
    for (let i = 0; i < workingBits.length; i += 4) {
      const chunk = workingBits.substring(i, i + 4).padEnd(4, '0');
      result += MAP_4B5B[chunk] || '00000';
    }
    workingBits = result;
    displayBits = result;
  } else if (type === EncodingType.EIGHT_B_TEN_B) {
    let result = '';
    for (let i = 0; i < workingBits.length; i += 8) {
      const chunk = workingBits.substring(i, i + 8).padEnd(8, '0');
      result += MAP_8B10B_SUBSET[chunk] || chunk.split('').map(b => b === '1' ? '10' : '01').join('').substring(0, 10);
    }
    workingBits = result;
    displayBits = result;
  }

  const bits = workingBits.split('').map(b => parseInt(b));
  const samplesPerBit = 100;
  const signal: number[] = [];
  const clock: number[] = [];
  const labels: number[] = [];

  let transitions = 0;
  let prevSignalValue = 0;
  let amiLastPolarity = -1; 
  let nrzILastState = voltage;
  let diffManchesterLastState = -voltage;
  
  const mlt3States = [0, voltage, 0, -voltage];
  let mlt3Index = 0;
  let pulsesSinceLastViolation = 0;

  let i = 0;
  while (i < bits.length) {
    const bit = bits[i];
    let symbolVal: number[] = [];

    switch (type) {
      case EncodingType.TWO_B_ONE_Q: {
        const nextBit = bits[i + 1] ?? 0;
        const val = (bit === 1) 
          ? (nextBit === 0 ? voltage : voltage/3) 
          : (nextBit === 0 ? -voltage : -voltage/3);
        symbolVal = Array(samplesPerBit * 2).fill(val);
        i += 2;
        break;
      }
      case EncodingType.FOUR_D_PAM5: {
        const nextBit = bits[i + 1] ?? 0;
        const pair = `${bit}${nextBit}`;
        const levels: Record<string, number> = { '00': -voltage, '01': -voltage/2, '10': voltage/2, '11': voltage };
        symbolVal = Array(samplesPerBit * 2).fill(levels[pair]);
        i += 2;
        break;
      }
      case EncodingType.MLT_3:
        if (bit === 1) mlt3Index = (mlt3Index + 1) % 4;
        symbolVal = Array(samplesPerBit).fill(mlt3States[mlt3Index]);
        i++;
        break;
      case EncodingType.B8ZS: {
        const chunk = bits.slice(i, i + 8);
        if (chunk.length === 8 && chunk.every(b => b === 0)) {
          const v = voltage * amiLastPolarity;
          const pattern = [0, 0, 0, -v, v, 0, v, -v];
          pattern.forEach(p => symbolVal.push(...Array(samplesPerBit).fill(p)));
          amiLastPolarity = -v / voltage;
          i += 8;
        } else {
          const val = bit === 0 ? 0 : (amiLastPolarity = -amiLastPolarity) * voltage;
          symbolVal = Array(samplesPerBit).fill(val);
          i++;
        }
        break;
      }
      case EncodingType.HDB3: {
        const chunk = bits.slice(i, i + 4);
        if (chunk.length === 4 && chunk.every(b => b === 0)) {
          const isEven = pulsesSinceLastViolation % 2 === 0;
          let pattern: number[];
          if (isEven) {
             const B = (amiLastPolarity = -amiLastPolarity) * voltage;
             const V = B; 
             pattern = [B, 0, 0, V];
          } else {
             const V = amiLastPolarity * voltage;
             pattern = [0, 0, 0, V];
          }
          pattern.forEach(p => symbolVal.push(...Array(samplesPerBit).fill(p)));
          pulsesSinceLastViolation = 0;
          i += 4;
        } else {
          const val = bit === 0 ? 0 : (amiLastPolarity = -amiLastPolarity) * voltage;
          if (bit === 1) pulsesSinceLastViolation++;
          symbolVal = Array(samplesPerBit).fill(val);
          i++;
        }
        break;
      }
      case EncodingType.EIGHT_B_SIX_T: {
        const chunk = bits.slice(i, i + 4);
        const sum = chunk.reduce((a,b) => a+b, 0);
        const pattern = [sum > 1 ? voltage : -voltage, chunk[0] ? 0 : -voltage, chunk[1] ? voltage : 0];
        pattern.forEach(p => symbolVal.push(...Array(samplesPerBit).fill(p)));
        i += 4;
        break;
      }
      case EncodingType.UNIPOLAR:
        symbolVal = Array(samplesPerBit).fill(bit === 1 ? voltage : 0);
        i++;
        break;
      case EncodingType.NRZ_L:
        symbolVal = Array(samplesPerBit).fill(bit === 1 ? -voltage : voltage);
        i++;
        break;
      case EncodingType.NRZ_I:
      case EncodingType.FOUR_B_FIVE_B:
        if (bit === 1) nrzILastState = -nrzILastState;
        symbolVal = Array(samplesPerBit).fill(nrzILastState);
        i++;
        break;
      case EncodingType.POLAR_NRZ:
      case EncodingType.EIGHT_B_TEN_B:
        symbolVal = Array(samplesPerBit).fill(bit === 1 ? voltage : -voltage);
        i++;
        break;
      case EncodingType.BIPOLAR_AMI:
        symbolVal = Array(samplesPerBit).fill(bit === 0 ? 0 : (amiLastPolarity = -amiLastPolarity) * voltage);
        i++;
        break;
      case EncodingType.MANCHESTER:
        for(let s=0; s<samplesPerBit; s++) symbolVal.push(bit === 1 ? (s < samplesPerBit/2 ? voltage : -voltage) : (s < samplesPerBit/2 ? -voltage : voltage));
        i++;
        break;
      case EncodingType.DIFF_MANCHESTER:
        for(let s=0; s<samplesPerBit; s++) {
          if (s === 0 && bit === 0) diffManchesterLastState = -diffManchesterLastState;
          else if (s === samplesPerBit/2) diffManchesterLastState = -diffManchesterLastState;
          symbolVal.push(diffManchesterLastState);
        }
        i++;
        break;
      default:
        symbolVal = Array(samplesPerBit).fill(0);
        i++;
    }

    symbolVal.forEach((v) => {
      const t = labels.length / samplesPerBit;
      labels.push(t);
      clock.push((labels.length % samplesPerBit) < samplesPerBit/2 ? voltage : 0);
      if (v !== prevSignalValue) transitions++;
      prevSignalValue = v;
      signal.push(v);
    });
  }

  const avgDC = signal.reduce((a, b) => a + b, 0) / (signal.length || 1);
  
  const descriptions: Record<EncodingType, string> = {
    [EncodingType.UNIPOLAR]: "High voltage for 1, zero for 0.",
    [EncodingType.NRZ_L]: "Bit 1 maps to -V, Bit 0 maps to +V.",
    [EncodingType.NRZ_I]: "Transitions occur only on bit '1'.",
    [EncodingType.POLAR_NRZ]: "Uses positive and negative voltage levels.",
    [EncodingType.BIPOLAR_AMI]: "Alternate polarities for logic '1' pulses.",
    [EncodingType.MANCHESTER]: "Every bit period has a central transition.",
    [EncodingType.DIFF_MANCHESTER]: "Combines differential logic with mid-bit transitions.",
    [EncodingType.TWO_B_ONE_Q]: "2 bits per quaternary symbol.",
    [EncodingType.MLT_3]: "Multi-Level Transmit 3 levels.",
    [EncodingType.B8ZS]: "Fixes AMI zero sync issues using substitutions.",
    [EncodingType.HDB3]: "High-Density Bipolar substituting long zero strings.",
    [EncodingType.FOUR_B_FIVE_B]: "4 bits mapped to 5 for transition density.",
    [EncodingType.EIGHT_B_TEN_B]: "DC-balanced encoding for high-speed data.",
    [EncodingType.EIGHT_B_SIX_T]: "8 bits mapped to 6 ternary levels.",
    [EncodingType.FOUR_D_PAM5]: "5-level amplitude modulation."
  };

  return {
    labels,
    signal,
    clock,
    processedBits: displayBits,
    metrics: {
      avgDC,
      transitions,
      bandwidthRating: "N/2 to N Hz",
      description: descriptions[type]
    }
  };
};
