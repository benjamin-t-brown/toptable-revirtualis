import type { ClientOp } from './protocol.js';
import { placeFields } from './protocol.js';
import type { Role, RoomState } from './types.js';

export interface Actor {
  role: Role;
  name: string;
}

const PLAYER_MOVE_FIELDS = new Set(['x', 'y', 'rotation']);

export function controlsPlacement(actor: Actor, owners: readonly string[]): boolean {
  return actor.role === 'dm' || owners.includes(actor.name);
}

export function canPerform(actor: Actor, state: RoomState, op: ClientOp): boolean {
  if (op.type !== 'place.update') return actor.role === 'dm';
  const placement = state.placements.find((item) => item.id === op.placementId);
  if (!placement) return false;
  const fields = placeFields(op);
  const setsLabel = op.label !== undefined;
  if (fields.length === 0 && !setsLabel) return false;
  if (actor.role === 'dm') return true;
  if (!placement.owners.includes(actor.name)) return false;
  return fields.every((field) => PLAYER_MOVE_FIELDS.has(field));
}
