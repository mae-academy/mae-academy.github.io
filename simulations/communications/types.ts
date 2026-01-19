
export enum EncodingType {
  UNIPOLAR = 'unipolar',
  NRZ_L = 'nrz_l',
  NRZ_I = 'nrz_i',
  POLAR_NRZ = 'polar_nrz',
  BIPOLAR_AMI = 'ami',
  MANCHESTER = 'manchester',
  DIFF_MANCHESTER = 'diff_manchester',
  TWO_B_ONE_Q = '2b1q',
  MLT_3 = 'mlt_3',
  B8ZS = 'b8zs',
  HDB3 = 'hdb3',
  FOUR_B_FIVE_B = '4b5b',
  EIGHT_B_TEN_B = '8b10b',
  EIGHT_B_SIX_T = '8b6t',
  FOUR_D_PAM5 = '4dpam5'
}

export interface SimulationResult {
  labels: number[];
  signal: number[];
  clock: number[];
  processedBits?: string;
  metrics: {
    avgDC: number;
    transitions: number;
    bandwidthRating: string;
    description: string;
  };
}

export interface EncodingParams {
  bits: string;
  voltage: number;
  frequency: number;
  encoding: EncodingType;
}
