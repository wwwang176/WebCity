import type { ConnectionPoint, LaneEdge, Direction } from '../../src/core/traffic/LaneGraph';

/**
 * Complete, valid lane-graph fixtures.
 *
 * Several suites built their own partial edges — `{ from: { cellKey, lane } }`,
 * or `nodeId` from before the field was renamed to `id`. They compiled only
 * because nothing typechecked the test tree, and they quietly asserted against
 * a shape the graph never produces: an edge with no `tangent` cannot be
 * interpolated, and an edge with no `cellKey` belongs to no cell.
 *
 * Anything a case actually cares about is passed in; everything else gets a
 * consistent default, so a fixture is never accidentally missing a field the
 * code under test reads.
 */
export function makeConnectionPoint(
  overrides: Partial<ConnectionPoint> & Pick<ConnectionPoint, 'id'>,
): ConnectionPoint {
  const position = overrides.position ?? { x: 0, y: 0 };
  const cellKey = overrides.cellKey ?? `${Math.round(position.x)},${Math.round(position.y)}`;
  return {
    id: overrides.id,
    position,
    tangent: overrides.tangent ?? { tx: 1, ty: 0 },
    cellKey,
    lane: overrides.lane ?? 0,
    direction: overrides.direction ?? 'east',
    type: overrides.type ?? 'exit',
  };
}

/** A straight edge between two points, with the tangent implied by its direction. */
export function makeStraightEdge(
  from: { x: number; y: number },
  to: { x: number; y: number },
  overrides: Partial<LaneEdge> = {},
): LaneEdge {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const tangent = length > 0 ? { tx: dx / length, ty: dy / length } : { tx: 1, ty: 0 };
  const dir: Direction = Math.abs(dx) >= Math.abs(dy)
    ? (dx >= 0 ? 'east' : 'west')
    : (dy >= 0 ? 'south' : 'north');

  return {
    id: overrides.id ?? `${from.x},${from.y}->${to.x},${to.y}`,
    from: overrides.from ?? makeConnectionPoint({ id: 'a', position: from, tangent, direction: dir, type: 'exit' }),
    to: overrides.to ?? makeConnectionPoint({ id: 'b', position: to, tangent, direction: dir, type: 'entry' }),
    length: overrides.length ?? length,
    type: overrides.type ?? 'straight',
    ...(overrides.bezierControl ? { bezierControl: overrides.bezierControl } : {}),
    ...(overrides.viaCellKey ? { viaCellKey: overrides.viaCellKey } : {}),
  };
}

/** A lane-graph edge between two cells, identified by cell key and lane. */
export function makeCellEdge(
  fromCell: string, toCell: string, lane = 0, overrides: Partial<LaneEdge> = {},
): LaneEdge {
  const [fx, fy] = fromCell.split(',').map(Number);
  const [tx, ty] = toCell.split(',').map(Number);
  return makeStraightEdge(
    { x: fx ?? 0, y: fy ?? 0 },
    { x: tx ?? 0, y: ty ?? 0 },
    {
      id: `${fromCell}->${toCell}:${lane}`,
      from: makeConnectionPoint({ id: `${fromCell}:${lane}:exit`, cellKey: fromCell, lane, position: { x: fx ?? 0, y: fy ?? 0 }, type: 'exit' }),
      to: makeConnectionPoint({ id: `${toCell}:${lane}:entry`, cellKey: toCell, lane, position: { x: tx ?? 0, y: ty ?? 0 }, type: 'entry' }),
      ...overrides,
    },
  );
}
