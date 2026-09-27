// The Gift Check (see gifts.md#resolution): a resource-risk roll, 2d10
// against CURRENT Ki, roll-under. Success is free; failure costs 1 Ki.
// Reading the pool that is left rather than the maximum is the point -
// Gifts are dependable while fresh and unreliable once the day is spent.
// Deliberately its own distinct roll type - no critical success/failure,
// no Lucky Number (both core-roll-only, not extended to the Gift Check).

import { rollPlain } from './core.js';

export function performGiftCheck({ ki }) {
  const target = ki;
  const roll = rollPlain();
  const outcome = roll.sum <= target ? 'success' : 'failure';
  return { target, roll, outcome, kiCost: outcome === 'failure' ? 1 : 0 };
}
