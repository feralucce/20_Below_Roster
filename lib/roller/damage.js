// Weapon/Gift damage dice pools and the Passive Wall Triad's per-die
// resolution (see rules.md#the-passive-wall-triad---soak-presence-psyche,
// rules.md#ki-infusion, rules.md#health-levels). Pure logic, no DOM.

import { rollD10 } from './core.js';

// Roll the pool. Ki Infusion is decided AFTER this, with the dice on the
// table (rules.md#ki-infusion) - so rolling and boosting are two steps,
// and this one knows nothing about Ki. Die > wall connects; a wall of 10
// guarantees 0% connect on an unboosted die, true full negation.
//
// A critical decides dice rather than adding them (rules.md#critical-hits):
// half the pool, rounded up, connects with no roll and no wall to beat, and
// the rest each add Klotho. That second part is amplification, not an attack -
// the to-hit was already made with an Element - so Moira's rule against
// attacking is untouched, the same way Ki Infusion's Ferocity doesn't make
// Fire the attacker.
//
// The fated dice are still rolled so there is a face to show, but `fated`
// decides whether they connect, not the number on them.
export function rollDamagePool({ diceCount, wall, critical = false, klotho = 0 }) {
  const free = critical ? Math.ceil(diceCount / 2) : 0;
  const bonus = critical ? klotho : 0;
  const dice = [];
  for (let i = 0; i < diceCount; i++) {
    const raw = rollD10();
    const fated = i < free;
    const result = fated ? raw : raw + bonus;
    dice.push({ raw, fated, boosted: false, result, connects: fated || result > wall });
  }
  return {
    dice, wall, critical, klotho: bonus, freeDice: free, diceRolled: diceCount,
    connectCount: dice.filter((d) => d.connects).length,
  };
}

// Apply Ki Infusion to an already-rolled pool. `boostedDice` holds the
// 0-based indices the player chose after seeing the roll; `boostAmount` is
// their matching sub-stat (Ferocity/Presence/Psyche). Returns a new pool -
// the original is left alone so a choice can be taken back before it is paid
// for. One Ki per boosted die.
export function applyBoosts(pool, boostedDice, boostAmount) {
  const boosted = new Set(boostedDice);
  const dice = pool.dice.map((d, i) => {
    const isBoosted = boosted.has(i);
    // d.result already carries the critical's Klotho, if there was one.
    const result = isBoosted ? d.result + boostAmount : d.result;
    return { ...d, boosted: isBoosted, result, connects: d.fated || result > pool.wall };
  });
  return { ...pool, dice, connectCount: dice.filter((d) => d.connects).length, kiSpent: boosted.size };
}

// Which dice are worth spending a Ki on: the ones that failed but that the
// sub-stat can carry over the wall. Boosting anything else is wasted, which
// is the whole point of choosing after the roll.
export function worthBoosting(pool, boostAmount) {
  return pool.dice
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => !d.connects && d.result + boostAmount > pool.wall)
    .map(({ i }) => i);
}

// Applies connecting dice to a Health Level or Sanity Level track, honoring
// the crossing-zero throttle (rules.md#health-levels): a single attack can
// never carry the track straight past 0 from positive - excess connecting
// dice beyond what it takes to reach exactly 0 are discarded. Once the
// track is already at or below 0, any further connecting attack removes
// only 1 more Level total, regardless of how many dice connected.
export function applyThrottledDamage(current, connectCount) {
  if (connectCount <= 0) return current;
  if (current > 0) {
    return Math.max(0, current - connectCount);
  }
  return current - 1;
}

// Poise has no negative range at all (rules.md#poise): it floors hard at
// 0, and once there, further connecting Social dice have no effect -
// unlike Health/Sanity, which still lose 1 more Level per further attack
// once already at or below 0.
export function applyPoiseDamage(current, connectCount) {
  if (current <= 0) return current;
  return Math.max(0, current - connectCount);
}
