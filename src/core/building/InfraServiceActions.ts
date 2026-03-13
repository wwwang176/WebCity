import { type InfraType, getInfraBuildingId } from './InfraConfig';
import { findAtPosition } from '../grid/GridHelpers';

/**
 * Minimal interfaces for the services needed by infra place/remove actions.
 * Uses DIP — depends on abstractions, not concrete service classes.
 */
export interface InfraServiceContext {
  power: { addPlant(p: { x: number; y: number; output: number; pollution: number; type: string }): void; removePlant(x: number, y: number): void };
  water: { addPlant(p: { x: number; y: number; output: number }): void; removePlant(x: number, y: number): void };
  police: { addStation(x: number, y: number): void; removeStation(id: string): void; getStations(): readonly { id: string; x: number; y: number }[] };
  fire: { addStation(x: number, y: number): void; removeStation(id: string): void; getStations(): readonly { id: string; x: number; y: number }[] };
  health: { addHospital(x: number, y: number): void; removeHospital(id: string): void; getHospitals(): readonly { id: string; x: number; y: number }[] };
  education: { addSchool(x: number, y: number, level: string): void; removeSchool(id: string): void; getSchools(): readonly { id: string; x: number; y: number }[] };
  parks: { addPark(x: number, y: number): void; removePark(id: string): void; getParks(): readonly { id: string; x: number; y: number }[] };
  garbage: { addFacility(x: number, y: number): void; removeFacility(id: string): void; getFacilities(): readonly { id: string; x: number; y: number }[] };
  sewage: { addTreatmentPlant(x: number, y: number): void; removeTreatmentPlant(id: string): void; getTreatmentPlants(): readonly { id: string; x: number; y: number }[] };
  deathCare: { addCemetery(x: number, y: number): void; removeCemetery(id: string): void; getCemeteries(): readonly { id: string; x: number; y: number }[] };
  bus: { addStop(x: number, y: number): void; removeStop(id: number): void; getStops(): readonly { id: number; x: number; y: number }[] };
  metro: { addStation(x: number, y: number): void; removeStation(id: number): void; getStations(): readonly { id: number; x: number; y: number }[] };
  rail: { buildStation(x: number, y: number): void; removeStation(id: number): void; getStations(): readonly { id: number; x: number; y: number }[] };
  ferry: { addDock(x: number, y: number): void; removeDock(id: number): void; getDocks(): readonly { id: number; x: number; y: number }[] };
  airport: { demolishAtCell(x: number, y: number, clearCell: (cx: number, cy: number) => void): boolean };
  grid: { getCell(x: number, y: number): { buildingId: number } | null; setCell(x: number, y: number, data: { buildingId: number; reserved?: number }): void };
}

export interface InfraServiceAction {
  place(ctx: InfraServiceContext, cx: number, cy: number): void;
  remove(ctx: InfraServiceContext, cx: number, cy: number): void;
}

/** Helper: find and remove an entity by coordinates from a service's collection. */
function findAndRemove<Id extends string | number>(
  getList: () => readonly { id: Id; x: number; y: number }[],
  removeFn: (id: Id) => void,
  cx: number,
  cy: number,
): void {
  const item = findAtPosition(getList(), cx, cy);
  if (item) removeFn(item.id);
}

/**
 * Data-driven mapping from InfraType → service place/remove actions.
 * Adding a new infrastructure type only requires adding an entry here (OCP).
 */
export const INFRA_SERVICE_ACTIONS: Partial<Record<InfraType, InfraServiceAction>> = {
  power: {
    place: (ctx, cx, cy) => ctx.power.addPlant({ x: cx, y: cy, output: 500, pollution: 10, type: 'coal' }),
    remove: (ctx, cx, cy) => ctx.power.removePlant(cx, cy),
  },
  water: {
    place: (ctx, cx, cy) => ctx.water.addPlant({ x: cx, y: cy, output: 500 }),
    remove: (ctx, cx, cy) => ctx.water.removePlant(cx, cy),
  },
  police: {
    place: (ctx, cx, cy) => ctx.police.addStation(cx, cy),
    remove: (ctx, cx, cy) => findAndRemove(() => ctx.police.getStations(), id => ctx.police.removeStation(id), cx, cy),
  },
  fire: {
    place: (ctx, cx, cy) => ctx.fire.addStation(cx, cy),
    remove: (ctx, cx, cy) => findAndRemove(() => ctx.fire.getStations(), id => ctx.fire.removeStation(id), cx, cy),
  },
  hospital: {
    place: (ctx, cx, cy) => ctx.health.addHospital(cx, cy),
    remove: (ctx, cx, cy) => findAndRemove(() => ctx.health.getHospitals(), id => ctx.health.removeHospital(id), cx, cy),
  },
  school: {
    place: (ctx, cx, cy) => ctx.education.addSchool(cx, cy, 'elementary'),
    remove: (ctx, cx, cy) => findAndRemove(() => ctx.education.getSchools(), id => ctx.education.removeSchool(id), cx, cy),
  },
  school_high: {
    place: (ctx, cx, cy) => ctx.education.addSchool(cx, cy, 'highschool'),
    remove: (ctx, cx, cy) => findAndRemove(() => ctx.education.getSchools(), id => ctx.education.removeSchool(id), cx, cy),
  },
  school_univ: {
    place: (ctx, cx, cy) => ctx.education.addSchool(cx, cy, 'university'),
    remove: (ctx, cx, cy) => findAndRemove(() => ctx.education.getSchools(), id => ctx.education.removeSchool(id), cx, cy),
  },
  park: {
    place: (ctx, cx, cy) => ctx.parks.addPark(cx, cy),
    remove: (ctx, cx, cy) => findAndRemove(() => ctx.parks.getParks(), id => ctx.parks.removePark(id), cx, cy),
  },
  garbage: {
    place: (ctx, cx, cy) => ctx.garbage.addFacility(cx, cy),
    remove: (ctx, cx, cy) => findAndRemove(() => ctx.garbage.getFacilities(), id => ctx.garbage.removeFacility(id), cx, cy),
  },
  sewage: {
    place: (ctx, cx, cy) => ctx.sewage.addTreatmentPlant(cx, cy),
    remove: (ctx, cx, cy) => findAndRemove(() => ctx.sewage.getTreatmentPlants(), id => ctx.sewage.removeTreatmentPlant(id), cx, cy),
  },
  cemetery: {
    place: (ctx, cx, cy) => ctx.deathCare.addCemetery(cx, cy),
    remove: (ctx, cx, cy) => findAndRemove(() => ctx.deathCare.getCemeteries(), id => ctx.deathCare.removeCemetery(id), cx, cy),
  },
  bus_stop: {
    place: (ctx, cx, cy) => ctx.bus.addStop(cx, cy),
    remove: (ctx, cx, cy) => findAndRemove(() => ctx.bus.getStops(), id => ctx.bus.removeStop(id), cx, cy),
  },
  metro_station: {
    place: (ctx, cx, cy) => ctx.metro.addStation(cx, cy),
    remove: (ctx, cx, cy) => findAndRemove(() => ctx.metro.getStations(), id => ctx.metro.removeStation(id), cx, cy),
  },
  train_station: {
    place: (ctx, cx, cy) => ctx.rail.buildStation(cx, cy),
    remove: (ctx, cx, cy) => findAndRemove(() => ctx.rail.getStations(), id => ctx.rail.removeStation(id), cx, cy),
  },
  ferry_dock: {
    place: (ctx, cx, cy) => ctx.ferry.addDock(cx, cy),
    remove: (ctx, cx, cy) => findAndRemove(() => ctx.ferry.getDocks(), id => ctx.ferry.removeDock(id), cx, cy),
  },
  airport: {
    place: () => { /* airport placement handled by placeAirport (custom footprint) */ },
    remove: (ctx, cx, cy) => {
      const airportBid = getInfraBuildingId('airport');
      ctx.airport.demolishAtCell(cx, cy, (cellX, cellY) => {
        const c = ctx.grid.getCell(cellX, cellY);
        if (c && c.buildingId === airportBid) {
          ctx.grid.setCell(cellX, cellY, { buildingId: 0, reserved: 0 });
        }
      });
    },
  },
};
