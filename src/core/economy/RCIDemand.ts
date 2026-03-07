export interface RCIState {
  residentialSupply: number;
  commercialSupply: number;
  industrialSupply: number;
  population: number;
  jobOpenings: number;
  exportDemand: number;
}

export interface RCIDemandValues {
  residential: number;
  commercial: number;
  industrial: number;
}

export function calculateRCIDemand(state: RCIState): RCIDemandValues {
  const rDemand = Math.min(100, Math.max(-100,
    (state.jobOpenings * 2 + 30) - state.residentialSupply
  ));
  const cDemand = Math.min(100, Math.max(-100,
    (state.population * 0.5) - state.commercialSupply
  ));
  const iDemand = Math.min(100, Math.max(-100,
    (state.commercialSupply * 0.8 + state.exportDemand) - state.industrialSupply
  ));

  return { residential: rDemand, commercial: cDemand, industrial: iDemand };
}
