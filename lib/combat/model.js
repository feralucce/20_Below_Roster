// The 20 Below combat engine: roles, Initiative, Action Brackets, turn
// order, and the Health/Poise/Sanity/Ki tracks.
//
// Deliberately free of DOM, storage and platform APIs. Every function takes
// state and returns or mutates it, so the same engine runs behind the
// Owlbear panel, the standalone web tracker, the desktop shell, and (if it
// ever happens) a Roll20 mod script, whose sandbox has no browser at all.
// Persisting and re-rendering are the caller's job.
//
// Rules math is imported rather than reimplemented, so this can't drift
// from the character creator on what Dead or Shattered actually mean.
import {
  computeFiguredCharacteristics,
  healthStatus,
  poiseStatus,
  sanityStatus,
} from '../state.js';
import { rollD10 } from '../roller/core.js';

export { computeFiguredCharacteristics };

export const ROLES = ['PC', 'Ally', 'NPC'];
export const BRACKETS = ['Slow', 'Normal', 'Fast'];

// A "character" here is whatever the host app holds - it only needs an `id`
// and a `state` (a character creator JSON export). Combat state is kept
// separately, keyed by that id, so a host can add combat to an existing
// roster without touching how it already stores characters.
export function createCombat() {
  return {
    started: false,
    round: 0,
    turnIndex: -1, // -1 = declare phase; >= 0 = index into resolutionOrder
    resolutionOrder: null,
    entries: {}, // characterId -> per-character combat state
  };
}

// Created lazily, so a character added mid-fight just works. Defaults to
// NPC because nothing in an export file distinguishes a PC from an enemy -
// that's the GM's call.
export function entryFor(combat, character) {
  let e = combat.entries[character.id];
  if (!e) {
    const f = computeFiguredCharacteristics(character.state);
    e = combat.entries[character.id] = {
      role: 'NPC',
      initiative: null,
      bracket: null,
      kiSpentThisRound: 0,
      currentHealth: character.state.currentHealth ?? f['Health Levels'],
      currentPoise: character.state.currentPoise ?? f.Poise,
      currentSanity: character.state.currentSanity ?? f.Sanity,
      currentKi: character.state.currentKi ?? f.Ki,
      tokenId: null,
      tokenName: null,
    };
  }
  return e;
}

export function cycleRole(combat, character) {
  const e = entryFor(combat, character);
  e.role = ROLES[(ROLES.indexOf(e.role) + 1) % ROLES.length];
  return e.role;
}

export function setInitiative(combat, character, value) {
  entryFor(combat, character).initiative =
    value === '' || value == null ? null : Number(value);
}

// Allies and NPCs roll 1d10 plus their Initiative sub-stat. PCs report what
// they rolled at the table, so those are entered by hand instead.
export function rollInitiative(combat, character) {
  const e = entryFor(combat, character);
  const sub = (character.state.subStats && character.state.subStats.Initiative) || 0;
  e.initiative = rollD10() + sub;
  return e.initiative;
}

export function rollAllNonPC(combat, characters) {
  characters.forEach((c) => {
    if (entryFor(combat, c).role !== 'PC') rollInitiative(combat, c);
  });
}

export function allInitiativeSet(combat, characters) {
  return characters.length > 0
    && characters.every((c) => entryFor(combat, c).initiative != null);
}

export function allBracketsDeclared(combat, characters) {
  return characters.length > 0
    && characters.every((c) => entryFor(combat, c).bracket != null);
}

// Initiative is rolled once at the start of a fight and never re-rolled,
// per rules.md#combat-order.
export function beginCombat(combat, characters) {
  combat.started = true;
  combat.round = 1;
  combat.turnIndex = -1;
  combat.resolutionOrder = null;
  characters.forEach((c) => {
    const e = entryFor(combat, c);
    e.bracket = null;
    e.kiSpentThisRound = 0;
  });
}

export function setBracket(combat, character, bracket) {
  entryFor(combat, character).bracket = bracket;
}

// 1 Ki per step, Slow -> Normal -> Fast. No-ops past Fast or with no Ki
// left, rather than letting either run off the end.
export function bumpBracket(combat, character) {
  const e = entryFor(combat, character);
  if (!e.bracket || e.currentKi <= 0) return false;
  const i = BRACKETS.indexOf(e.bracket);
  if (i >= BRACKETS.length - 1) return false;
  e.bracket = BRACKETS[i + 1];
  e.currentKi -= 1;
  e.kiSpentThisRound += 1;
  return true;
}

export function canBump(combat, character) {
  const e = entryFor(combat, character);
  return Boolean(e.bracket) && e.currentKi > 0 && e.bracket !== 'Fast';
}

// All Fast act, then all Normal, then all Slow; Initiative breaks ties
// within a bracket.
export function resolveRound(combat, characters) {
  const rank = { Fast: 0, Normal: 1, Slow: 2 };
  combat.resolutionOrder = characters
    .slice()
    .sort((a, b) => {
      const ea = entryFor(combat, a);
      const eb = entryFor(combat, b);
      return rank[ea.bracket] - rank[eb.bracket] || eb.initiative - ea.initiative;
    })
    .map((c) => c.id);
  combat.turnIndex = 0;
}

export function currentTurnId(combat) {
  const { resolutionOrder, turnIndex } = combat;
  if (!resolutionOrder || turnIndex < 0 || turnIndex >= resolutionOrder.length) return null;
  return resolutionOrder[turnIndex];
}

export function isResolving(combat) {
  return Boolean(combat.started && combat.turnIndex >= 0 && combat.resolutionOrder);
}

export function hasActed(combat, id) {
  if (!isResolving(combat)) return false;
  const i = combat.resolutionOrder.indexOf(id);
  return i !== -1 && i < combat.turnIndex;
}

// The turn order rotated to start at whoever is up: current combatant
// first, everyone still to act behind them, and those who have already
// gone at the end in the order they went. Hosts use this to order their
// list so the active character stays on screen without scrolling.
export function rotatedOrder(combat) {
  if (!isResolving(combat)) return null;
  const o = combat.resolutionOrder;
  return o.slice(combat.turnIndex).concat(o.slice(0, combat.turnIndex));
}

// Once the order is exhausted the round advances and brackets clear -
// they're re-declared every round.
export function advanceTurn(combat, characters) {
  if (!combat.resolutionOrder) return;
  if (combat.turnIndex + 1 < combat.resolutionOrder.length) {
    combat.turnIndex += 1;
    return;
  }
  combat.round += 1;
  combat.turnIndex = -1;
  combat.resolutionOrder = null;
  characters.forEach((c) => {
    const e = entryFor(combat, c);
    e.bracket = null;
    e.kiSpentThisRound = 0;
  });
}

// Clears Initiative and brackets. Damage is deliberately left alone -
// it doesn't heal just because the fight ended.
export function endCombat(combat) {
  combat.started = false;
  combat.round = 0;
  combat.turnIndex = -1;
  combat.resolutionOrder = null;
  Object.values(combat.entries).forEach((e) => {
    e.initiative = null;
    e.bracket = null;
    e.kiSpentThisRound = 0;
  });
}

// Health, Poise and Sanity go below zero on purpose - Dead, Humiliated and
// Shattered are real states in the rules, so only Ki floors at 0. The lower
// bound is a sanity bound, not a rule.
export function adjustTrack(combat, character, track, delta) {
  const e = entryFor(combat, character);
  const f = computeFiguredCharacteristics(character.state);
  const max = track === 'Health' ? f['Health Levels'] : f[track];
  const key = 'current' + track;
  const floor = track === 'Ki' ? 0 : -99;
  e[key] = Math.max(floor, Math.min(max, e[key] + delta));
  return e[key];
}

export function trackStatus(track, value, character) {
  if (track === 'Health') {
    return healthStatus(value, (character.state.subStats && character.state.subStats.Health) || 0);
  }
  if (track === 'Poise') return poiseStatus(value);
  if (track === 'Sanity') return sanityStatus(value);
  return null;
}

// Pulls a character out of combat, including a turn order that may already
// be running, so removing a downed NPC mid-fight is safe.
export function removeCombatant(combat, id) {
  delete combat.entries[id];
  if (!combat.resolutionOrder) return;
  const was = combat.resolutionOrder.indexOf(id);
  combat.resolutionOrder = combat.resolutionOrder.filter((x) => x !== id);
  if (was !== -1 && was <= combat.turnIndex) combat.turnIndex -= 1;
  if (combat.resolutionOrder.length === 0) {
    combat.turnIndex = -1;
    combat.resolutionOrder = null;
  } else if (combat.turnIndex < 0) {
    combat.turnIndex = 0;
  }
}

// Restores loaded combat state against the characters actually present.
// Anything referring to a character that is no longer loaded is dropped
// rather than left dangling in the turn order.
export function reconcile(combat, ids) {
  const live = new Set(ids);
  Object.keys(combat.entries).forEach((id) => {
    if (!live.has(id)) delete combat.entries[id];
  });
  if (!combat.resolutionOrder) return combat;
  combat.resolutionOrder = combat.resolutionOrder.filter((id) => live.has(id));
  if (combat.resolutionOrder.length === 0) {
    combat.turnIndex = -1;
    combat.resolutionOrder = null;
  } else if (combat.turnIndex >= combat.resolutionOrder.length) {
    combat.turnIndex = combat.resolutionOrder.length - 1;
  }
  return combat;
}

// Clears any token link whose scene item has gone away.
export function pruneTokens(combat, liveTokenIds) {
  const live = new Set(liveTokenIds);
  let changed = false;
  Object.values(combat.entries).forEach((e) => {
    if (e.tokenId && !live.has(e.tokenId)) {
      e.tokenId = null;
      e.tokenName = null;
      changed = true;
    }
  });
  return changed;
}
