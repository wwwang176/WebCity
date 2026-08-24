import type { InfraType } from '../../../core/building/InfraConfig';
import type { CivicPlan } from './types';
import { CIVIC_MODELS } from './models';

/**
 * The `InfraType` to `CivicPlan` lookup.
 *
 * Deliberately holds no mutable state: the values live in the static table in
 * `models/index.ts`. A mutable Map plus `registerCivicPlan`, with each model file registering
 * itself at load, fails silently — nothing imports that file, and that building type simply does
 * not exist.
 */

/** This civic building type's plan. Types not yet converted return `undefined` and stay on the hand-written path. */
export function getCivicPlan(type: InfraType): CivicPlan | undefined {
  return CIVIC_MODELS[type];
}

/**
 * The types that have been converted.
 *
 * The showcase's dropdown and the table-driven tests both read it: with a second hand-written
 * list, finishing a type and forgetting to add it to the menu means it is done and invisible.
 */
export function civicTypesDone(): InfraType[] {
  return Object.keys(CIVIC_MODELS) as InfraType[];
}
