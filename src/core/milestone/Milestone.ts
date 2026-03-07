export interface Milestone {
  id: string;
  name: string;
  populationRequired: number;
  unlocks: string[];
}

export const MILESTONES: Milestone[] = [
  {
    id: 'tiny_town',
    name: 'Tiny Town',
    populationRequired: 500,
    unlocks: ['fire_service', 'police', 'bus'],
  },
  {
    id: 'small_city',
    name: 'Small City',
    populationRequired: 1000,
    unlocks: ['high_density', 'metro'],
  },
  {
    id: 'growing_city',
    name: 'Growing City',
    populationRequired: 2500,
    unlocks: ['industrial_specialization', 'tram'],
  },
  {
    id: 'big_city',
    name: 'Big City',
    populationRequired: 5000,
    unlocks: ['city_specialization', 'rail'],
  },
  {
    id: 'metropolis',
    name: 'Metropolis',
    populationRequired: 10000,
    unlocks: ['airport', 'great_works'],
  },
  {
    id: 'megalopolis',
    name: 'Megalopolis',
    populationRequired: 25000,
    unlocks: ['all_unlocked'],
  },
];

/**
 * Returns the highest milestone achieved for the given population,
 * or null if no milestone has been reached.
 */
export function getMilestone(population: number): Milestone | null {
  let highest: Milestone | null = null;
  for (const m of MILESTONES) {
    if (population >= m.populationRequired) {
      if (highest === null || m.populationRequired > highest.populationRequired) {
        highest = m;
      }
    }
  }
  return highest;
}

/**
 * Check if a specific feature is unlocked at the given population.
 */
export function isUnlocked(feature: string, population: number): boolean {
  for (const m of MILESTONES) {
    if (population >= m.populationRequired && m.unlocks.includes(feature)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns the next milestone to achieve, or null if all milestones are reached.
 */
export function getNextMilestone(population: number): Milestone | null {
  const sorted = [...MILESTONES].sort(
    (a, b) => a.populationRequired - b.populationRequired,
  );
  for (const m of sorted) {
    if (population < m.populationRequired) {
      return m;
    }
  }
  return null;
}
