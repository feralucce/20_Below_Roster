// Encounter weighing: is what the GM just put on the table a bad afternoon
// or a funeral?
//
// The whole thing rests on two facts about how this system fights.
//
// Soak is a threshold, not a subtraction. Every damage die is checked
// against it alone, and a die that doesn't beat it does nothing at all - so
// Soak deletes a fixed share of every attack forever, and (10 - Soak) is
// literally the fraction of dice that land.
//
// A creature's danger is how hard it hits multiplied by how long it lasts,
// because it keeps hitting for as long as it's up. Both halves scale with
// the size of the pack, so danger climbs with the SQUARE of the count.
// Four wolves are a fight; eight are not that fight twice.
//
// Calibrated against round-by-round simulation of real parties under the
// real at-zero rules (a single attack can never carry someone past 0, and
// an attack on someone already at 0 removes one Level however many dice
// connect). Bands agree with that simulation to +0.94.
//
// Everything here is pure - hand it character states, get numbers back.

import { computeFiguredCharacteristics } from '../state.js';

// A creature's natural weapons live in its entry prose rather than in
// structured fields, in the same shape the bestiary prints them:
// "**Bite**: 5, Melee". Character exports carry that text in finishingNotes.
const NATURAL_WEAPON = /^\*\*([A-Z][^*]*)\*\*:\s*(\d+),/gm;

// Fallback when nothing else can be worked out. Fists and feet are 1 die
// in weapons.md, and someone carrying nothing really is swinging at that -
// guessing higher would quietly inflate every party's Budget.
export const DEFAULT_DICE = 1;

export const BANDS = [
  { limit: 0.35, name: 'trivial', says: 'nobody goes down' },
  { limit: 0.75, name: 'standard', says: 'about one character drops' },
  { limit: 1.4, name: 'hard', says: 'two or three drop' },
  { limit: 3.0, name: 'deadly', says: 'most of the party ends up on the floor' },
  { limit: Infinity, name: 'overwhelming', says: 'all of them' },
];

export function bandFor(ratio) {
  return BANDS.find((b) => ratio < b.limit) || BANDS[BANDS.length - 1];
}

// The biggest natural weapon printed in a creature's own text. Creatures
// with several attacks use the worst one: the GM is asking what this thing
// can do to someone, not what it does on average.
export function naturalDice(state) {
  const text = (state && state.finishingNotes) || '';
  // Only read this as a creature block. A player's notes are free prose and
  // can happen to start a line with a bold word and a number, which would
  // otherwise be taken as a bite.
  if (!text.includes('**Soak**')) return null;
  const found = [...text.matchAll(NATURAL_WEAPON)]
    .map((m) => Number(m[2]))
    .filter((n) => Number.isFinite(n) && n > 0);
  return found.length ? Math.max(...found) : null;
}

// A player character's dice come from what they are carrying, which needs
// weapons.md to price. `weaponDice` is a name -> dice lookup the caller
// supplies (null when the rules could not be fetched); anything unmatched
// falls through to the natural-weapon text, then to the default.
export function diceFor(state, weaponDice) {
  if (state && Number.isFinite(state.encounterDice) && state.encounterDice > 0) {
    return state.encounterDice; // an explicit override always wins
  }
  if (weaponDice) {
    const carried = (state.gearPurchases || [])
      .map((g) => weaponDice[g.name])
      .filter((n) => Number.isFinite(n) && n > 0);
    if (carried.length) return Math.max(...carried);
  }
  return naturalDice(state) || DEFAULT_DICE;
}

function statsOf(state) {
  const f = computeFiguredCharacteristics(state);
  return {
    soak: (state.subStats && state.subStats.Soak) || 0,
    health: f['Health Levels'],
  };
}

// dice x Health Levels / (10 - Soak), then squared by the count.
//
// Soak 10 negates ordinary weapons completely, so the division would blow
// up. That is not a number problem, it is the answer: nothing the party
// swings can touch it, and the caller is told so rather than shown
// Infinity.
export function threatOf(state, count = 1, weaponDice = null) {
  const { soak, health } = statsOf(state);
  const dice = diceFor(state, weaponDice);
  if (soak >= 10) return { value: Infinity, untouchable: true, dice, soak, health };
  const each = (dice * health) / (10 - soak);
  return { value: each * count * count, untouchable: false, each, dice, soak, health };
}

// 0.7 is the party's average chance to connect - to-hit is Attribute
// against the target's Defense, and across the creatures in the book that
// lands near seven rolls in ten. It is the one term not read off a sheet.
export const HIT_RATE = 0.7;

export function budgetOf(states, weaponDice = null) {
  const live = states.filter(Boolean);
  if (!live.length) return { value: 0, dice: 0, health: 0, soak: 0 };
  let dice = 0;
  let health = 0;
  let soakTotal = 0;
  live.forEach((s) => {
    const { soak, health: hp } = statsOf(s);
    dice += diceFor(s, weaponDice);
    health += hp;
    soakTotal += soak;
  });
  const soak = soakTotal / live.length;
  return { value: HIT_RATE * dice * health / (10 - soak), dice, health, soak };
}

// The whole verdict for a table full of creatures against a party.
// `opposition` is [{ state, count }].
export function weigh(party, opposition, weaponDice = null) {
  const budget = budgetOf(party, weaponDice);
  const parts = opposition
    .filter((o) => o.state && o.count > 0)
    .map((o) => ({ ...o, threat: threatOf(o.state, o.count, weaponDice) }));

  if (parts.some((p) => p.threat.untouchable)) {
    return { budget, parts, total: Infinity, ratio: Infinity, untouchable: true };
  }
  const total = parts.reduce((n, p) => n + p.threat.value, 0);
  if (!budget.value || !total) {
    return { budget, parts, total, ratio: 0, band: BANDS[0] };
  }
  const ratio = total / budget.value;
  return { budget, parts, total, ratio, band: bandFor(ratio) };
}
