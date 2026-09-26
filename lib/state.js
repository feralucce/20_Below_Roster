// Owns the character build state, all pool math, validation, and the
// Figured Characteristics formulas from character-creation.md step 13.
// Every pool size/rate/cost used here comes from the parsed rules data
// (see main.js), nothing is hardcoded twice.

export function createInitialState(data) {
  const attributes = {};
  data.attributes.forEach((a) => {
    attributes[a.name] = data.attributeFloor;
  });

  const subStats = {};
  data.subStats.forEach((s) => {
    subStats[s.name] = 0;
  });

  const descriptors = {}; // subStatName -> string[]
  data.subStats.forEach((s) => {
    descriptors[s.name] = [];
  });

  const skills = {}; // skillName -> tier (0-5). Everyman skills start at tier 2.
  data.skillCatalog.forEach((s) => {
    skills[s.name] = data.everymanSkills.includes(s.name) ? 2 : 0;
  });

  const resources = {};
  data.resources.forEach((r) => {
    resources[r.name] = 0;
  });

  const resourcePenalties = {}; // resourceName -> Levels temporarily lost to a failed Resource Check
  data.resources.forEach((r) => {
    resourcePenalties[r.name] = 0;
  });

  const resourceZeroed = {}; // resourceName -> true if a "reaching beyond your means" Resource Check zeroed it out for the Month
  data.resources.forEach((r) => {
    resourceZeroed[r.name] = false;
  });

  return {
    name: '',
    concept: '',
    nature: { picked: null, custom: null }, // picked = name from starter list; custom = { label, drive, trigger }
    attributes,
    subStats,
    descriptors,
    skills,
    boons: [], // [{ name, points, tier }] - Special Movement (repeatable) can appear more than once
    resources,
    resourcePenalties,
    resourceZeroed,
    gifts: [], // [{ name, level, adders: string[], limiters: string[] }]
    flaws: [], // [{ name, level }]
    // Wealth-at-Creation gear shopping (see resources.md#wealth-at-character-creation)
    // - temporary bookkeeping only, never touches the purchased Wealth Resource
    // Level above. [{ id, category, name, wealth, loss }], loss = 0 for a free
    // or successfully-checked item.
    gearPurchases: [],
    creationWealthLoss: 0,
    // Starting Packages (weapons.md#starting-packages) - step one of
    // creation shopping, not an alternative to it. Level -> { level, name,
    // contents }: one package from every Level up to creation-Wealth, so a
    // Wealth 3 character holds three of them and a Wealth 1 character one.
    everymanGearPackages: {},
    // Gear the catalog will never list - a cardboard box, a dead man's watch.
    // Free, unlimited, no Wealth Level and no mechanical effect, so it needs
    // no bookkeeping beyond existing on the sheet. Plain strings.
    flavorItems: [],
    // Pool-points'-worth of extra capacity bought via Discretionary, added
    // on top of each target's base pool total. Gifts is tracked separately
    // (see giftsDiscretionaryContribution) since its per-unit cost varies
    // with Limiters chosen after purchase.
    discretionaryExtra: {
      Resources: 0,
      Skills: 0,
      'Fate Tokens': 0,
      Boons: 0,
      Attributes: 0,
    },
    // Points the GM hands out before anything is spent, on top of every
    // pool's book total. A table starting above the standard build sets
    // these once at the first step and then builds normally - nothing
    // downstream knows the difference, it just has more to spend.
    // Set when creation ends with Finish as NPC: whatever each pool still
    // held at that moment, taken off it for good (see markNpc).
    npc: null,
    bonusPoints: {
      Attributes: 0,
      Skills: 0,
      Boons: 0,
      Resources: 0,
      Gifts: 0,
    },
    discretionaryCap: null, // GM-set cap on Flaw-earned Discretionary points, null = uncapped
    // Tracks how many pool-points'-worth of each scalar target (Attributes/
    // Skills/Resources/Gifts) were funded specifically through the Discretionary Points step's
    // Discretionary pickers, keyed by item name. Lets the Discretionary Points step offer real
    // +/- controls on the actual items (not just an abstract pool bump)
    // while still letting the item's own step show/adjust the same value.
    discretionaryPurchases: { Attributes: {}, Skills: {}, Resources: {}, Gifts: {}, GiftAdders: {} },
    finishingNotes: '',
    // Free text for the sheet. Nothing computes from any of it - it is
    // there because a player needs it at the table.
    age: '',
    height: '',
    appearance: '',
    backstory: '',

    // ---- Advancement (post-creation XP spend, see rules/costs.md) ----
    xpEarned: 0,
    // Same shape/role as discretionaryPurchases - tracks how much of each
    // scalar target's current value was funded via Advancement XP rather
    // than creation pools or Discretionary, so it can be refunded and its
    // XP cost recomputed live. Boons funded via Advancement are tagged with
    // source 'advancement' on the existing state.boons list instead, same
    // as Discretionary-funded Boons already are.
    advancementPurchases: { Attributes: {}, Skills: {}, Resources: {}, Gifts: {}, Ki: 0 },
    // [{ id, physical: bool, title, description }] - freeform Battle Scar
    // log, see rules.md#battle-scars. Purely narrative, no mechanical field.
    scars: [],
  };
}

// Merges a loaded/saved character (from the auto-persisted draft, Import, or
// Load) over a fresh initial state built from the current rules data. A
// plain shallow spread lets an old save's dictionary-shaped fields
// (resources, skills, etc.) fully replace the fresh ones - silently
// dropping any catalog entry added to the rules since the character was
// saved, which then multiplies to NaN/null in pool math the moment that
// field is summed (confirmed live: a character predating a Resources
// expansion broke this way on import). Deep-merges those specific
// dictionary fields key-by-key instead so a new catalog entry defaults in
// cleanly, while every other field (scalars, arrays like gifts/flaws/boons,
// nested objects like discretionaryPurchases) is taken from the loaded save
// as-is, same as before.
const CATALOG_DICT_FIELDS = [
  'attributes',
  'subStats',
  'descriptors',
  'skills',
  'resources',
  'resourcePenalties',
  'resourceZeroed',
];

/* Boons that no longer exist under the name a save recorded.
 *
 * Nothing crashes without this - the Boons step renders
 * `boonData ? ... : ''`, so a name with no catalog entry behind it just
 * shows with an empty rules detail, and its points stay spent because
 * the pool sums the saved `points`, not the catalog's. That is the
 * problem: the character goes on paying for a Boon the book no longer
 * describes, and nothing says so.
 *
 * `to` renames it. `to: null` means it is gone and the points go back.
 * Either way the player is told - this returns a list for the loader to
 * surface, because a save that quietly rewrites itself is worse than
 * one that explains what it did.
 */
const RETIRED_BOONS = {
  // Renamed outright. Same costs, so the purchase carries over whole.
  Features: { to: 'Distinctive Features' },
  // Folded into another Boon at the same price.
  'Speed Reading': { to: 'Quick Study', mergedInto: true },
  'Never Winded': { to: 'Weathered', mergedInto: true },
  // Left the chapter entirely: it is the Oathbinder Gift now, a
  // different pool and a different purchase. Refund and let them decide.
  Oathbound: { to: null, becameGift: 'Oathbinder' },
};

export function migrateBoons(state) {
  const notices = [];
  if (!Array.isArray(state.boons)) return notices;
  const kept = [];
  state.boons.forEach((boon) => {
    const rule = RETIRED_BOONS[boon?.name];
    if (!rule) {
      kept.push(boon);
      return;
    }
    // removeBoon's discretionary bookkeeping, by hand - this rebuilds
    // the list rather than splicing it.
    const refund = () => {
      if (boon.source === 'discretionary') {
        state.discretionaryExtra.Boons -= boon.points;
      }
    };
    if (rule.to === null) {
      refund();
      notices.push(`${boon.name} is no longer a Boon - it is now the `
        + `${rule.becameGift} Gift. Its ${boon.points} points have gone back `
        + 'to your Boons pool.');
      return;
    }
    // They may hold both halves of what is now a single Boon, in either
    // order, so check what has already been kept and what is still to come.
    if (kept.some((b) => b.name === rule.to)
        || state.boons.some((b) => b !== boon && b?.name === rule.to)) {
      refund();
      notices.push(`${boon.name} has been folded into ${rule.to}, which you `
        + `already have. Its ${boon.points} points have gone back to your `
        + 'Boons pool.');
      return;
    }
    kept.push({ ...boon, name: rule.to });
    notices.push(rule.mergedInto
      ? `${boon.name} has been folded into ${rule.to}, which now covers both.`
      : `${boon.name} has been renamed to ${rule.to}.`);
  });
  state.boons = kept;
  return notices;
}

export function mergeCharacterState(data, loaded) {
  const fresh = createInitialState(data);
  const merged = { ...fresh, ...loaded };
  CATALOG_DICT_FIELDS.forEach((field) => {
    merged[field] = { ...fresh[field], ...(loaded[field] || {}) };
  });
  // Saves made before the GM bonus step have no such object at all.
  merged.bonusPoints = { ...fresh.bonusPoints, ...(loaded.bonusPoints || {}) };
  merged.migrationNotices = migrateBoons(merged);
  // Forcefield used to ask for its Form and its look in one line. The Form
  // is its own pick now, so an old answer that is not a Form moves down to
  // the look line - nothing the player wrote is lost.
  const ff = (merged.gifts || []).find((g) => g.name === 'Forcefield');
  const forms = forcefieldForms(data);
  if (ff && Array.isArray(ff.notes) && ff.notes[0] && forms.length
      && !forms.includes(ff.notes[0]) && !ff.notes[1]) {
    ff.notes = ['', ff.notes[0], ...ff.notes.slice(2)];
  }
  // Packages used to be a single pick for the whole character. Move an old
  // save's one package into the Level slot it was taken from.
  if (merged.everymanGearPackage && !Object.keys(merged.everymanGearPackages || {}).length) {
    const old = merged.everymanGearPackage;
    merged.everymanGearPackages = { [old.level]: old };
    delete merged.everymanGearPackage;
  }
  if (!merged.everymanGearPackages) merged.everymanGearPackages = {};
  // Exports saved before the holding cap existed can carry more Fate Tokens
  // than the character is now allowed to hold, in the build and in play both.
  clampFateTokenPurchases(merged, data);
  if (merged.currentFateTokens != null) {
    merged.currentFateTokens = Math.min(merged.currentFateTokens, fateTokenCap(merged, data));
  }
  return merged;
}

// ---- Pools ----

// What was bought with XP after creation was paid in XP, not from a
// creation pool, so every pool below counts only the part of a stat that
// Advancement didn't buy. Without this an XP purchase is charged twice and
// the pool goes negative.
function advBought(state, kind, name) {
  return state.advancementPurchases?.[kind]?.[name] ?? 0;
}

export function attributePointsSpent(state, data) {
  let spent = 0;
  data.attributes.forEach((a) => {
    spent += state.attributes[a.name] - advBought(state, 'Attributes', a.name) - data.attributeFloor;
  });
  return spent;
}

// Whatever the GM added to a pool at the first step. Absent on any save
// written before that step existed, so it answers 0 rather than NaN.
export function bonusFor(state, pool) {
  return Number(state.bonusPoints?.[pool]) || 0;
}

// What an NPC gave up at the end of creation. Zero for a PC.
export function forfeitFor(state, pool) {
  return Number(state.npc?.forfeit?.[pool]) || 0;
}

export function attributePoolRemaining(state, data) {
  const total = data.attributePoolTotal + state.discretionaryExtra.Attributes
    + bonusFor(state, 'Attributes') - forfeitFor(state, 'Attributes');
  return total - attributePointsSpent(state, data);
}

// Each raised Attribute generates a sub-stat pool equal to its own rating,
// split between its two sub-stats however the player likes.
export function subStatPoolRemaining(state, data, attributeName) {
  const attr = data.attributes.find((a) => a.name === attributeName);
  const [subA, subB] = attr.splitsInto;
  const spent = state.subStats[subA] + state.subStats[subB];
  return state.attributes[attributeName] - spent
    - (Number(state.npc?.forfeit?.SubStats?.[attributeName]) || 0);
}

export function skillPointCost(data, tier, baselineTier) {
  return Math.max(0, (tier - baselineTier) * data.skillTierPointCost);
}

export function skillsPointsSpent(state, data) {
  let spent = 0;
  data.skillCatalog.forEach((s) => {
    const baseline = data.everymanSkills.includes(s.name) ? 2 : 0;
    spent += skillPointCost(data, state.skills[s.name] - advBought(state, 'Skills', s.name), baseline);
  });
  return spent;
}

export function skillsPoolRemaining(state, data) {
  // Jack of all Trades Tier 1 (5 points) already grants Trained in every
  // Skill for free and caps every Skill at Trained - so the Skills Pool has
  // nothing useful left to buy. Blocking it here (rather than just letting a
  // player decline to spend it) stops those points from being freed up for
  // anything else, which would make an already-strong Boon overpowered.
  // Tier 2 (7 points) lifts the cap, so the pool works normally again.
  const jackOfAllTrades = state.boons.find((b) => b.name === 'Jack of all Trades');
  if (jackOfAllTrades && jackOfAllTrades.points === 5) {
    return 0 - skillsPointsSpent(state, data);
  }
  const total = data.skillsPoolTotal + state.discretionaryExtra.Skills
    + bonusFor(state, 'Skills') - forfeitFor(state, 'Skills');
  return total - skillsPointsSpent(state, data);
}

export function boonsPointsSpent(state) {
  return state.boons.reduce((sum, b) => sum + b.points, 0);
}

export function boonsPoolRemaining(state, data) {
  const total = data.boonsPoolTotal + state.discretionaryExtra.Boons
    + bonusFor(state, 'Boons') - forfeitFor(state, 'Boons');
  return total - boonsPointsSpent(state);
}

export function resourcesPointsSpent(state, data) {
  let spent = 0;
  data.resources.forEach((r) => {
    spent += (state.resources[r.name] - advBought(state, 'Resources', r.name)) * data.resourceLevelCost;
  });
  return spent;
}

export function resourcesPoolRemaining(state, data) {
  const total = data.resourcesPoolTotal + state.discretionaryExtra.Resources
    + bonusFor(state, 'Resources') - forfeitFor(state, 'Resources');
  return total - resourcesPointsSpent(state, data);
}

// ---- Resource Checks (see resources.md#pushing-a-resource) ----
// A failed check drops a Resource's *effective* Level by 1, a critical
// failure by 2, and the drops stack all the way down to 0 - at which
// point the Resource is spent and can't be drawn on at all. It stays
// spent until the app's user clears it once a Month has passed in
// fiction; there's no in-game calendar here to auto-expire it against.
// "Reaching beyond your means" skips the walk down and zeroes the
// Resource outright, tracked in its own resourceZeroed map so clearing a
// penalty and clearing a zero-out are the same gesture. Both are tracked
// separately from the purchased Level itself so point-cost accounting
// (resourcesPointsSpent above) is never affected.

export function effectiveResourceLevel(state, resourceName) {
  if (state.resourceZeroed[resourceName]) return 0;
  const level = state.resources[resourceName] ?? 0;
  const penalty = state.resourcePenalties[resourceName] ?? 0;
  // No floor at 1. A Resource failed down to 0 is spent for the Month.
  return Math.max(0, level - penalty);
}

export function applyResourceCheckFailure(state, resourceName, levels = 1) {
  const level = state.resources[resourceName] ?? 0;
  const current = state.resourcePenalties[resourceName] ?? 0;
  // Cumulative, and it can reach the purchased Level - a Resource at 0 is
  // spent, not merely reduced.
  state.resourcePenalties[resourceName] = Math.min(level, current + levels);
}

export function applyResourceCheckZeroOut(state, resourceName) {
  state.resourceZeroed[resourceName] = true;
}

export function clearResourcePenalty(state, resourceName) {
  state.resourcePenalties[resourceName] = 0;
  state.resourceZeroed[resourceName] = false;
}

// creation-Wealth starts at 2, unless Wealth was actually purchased from the
// Resources Pool, in which case that purchased Level is used instead (not
// the higher of the two - see resources.md#wealth-at-character-creation).
// Destitute (flaws.md#destitute) overrides both of those to a flat 0 at
// every Level it's taken - that's the whole point of the Flaw, per its own
// rules text ("Creation-Wealth is 0 instead of the default 2"). Checked here
// rather than in currentCreationWealth so both the Wealth Check shop's gap
// math and the Everyman
// Gear Package picker's eligibility (weapons.md#everyman-gear-packages,
// which needs the real unfloored 0 to gate Level 0 exclusively) read the
// same starting number.
// Is Destitute actually taken? state.flaws carries an entry for EVERY Flaw
// once the Flaws step has been opened, level 0 meaning "not taken", so the
// name alone proves nothing and the level has to be checked. Without this,
// merely visiting the Flaws step made every character Destitute.
export function isDestitute(state) {
  // Creation-only, both callers: a Destitute bought off with XP later
  // was still Destitute when the character was made.
  const destitute = state.flaws.find((f) => f.name === 'Destitute');
  return Boolean(destitute && flawCreationLevel(destitute) > 0);
}

export function creationWealthBase(state) {
  // Destitute wins at creation, outright: "Creation-Wealth is 0 instead of
  // the default 2" (flaws.md#destitute). It is not a lower starting point
  // that points can climb out of - a Destitute character shops at 0 and
  // takes a Level 0 Everyman package. Wealth cannot be bought at creation
  // while it is held either; see canBuyWealthAtCreation below.
  if (isDestitute(state)) return 0;
  return state.resources.Wealth > 0 ? state.resources.Wealth : 2;
}

// Destitute and purchased Wealth cannot be held at once during creation -
// the Flaw has to be bought off first. Blocked in both directions, because
// either one can be picked up first, and blocking is better than quietly
// undoing a choice the player already made.
export function canBuyWealthAtCreation(state) {
  return !isDestitute(state);
}

export function canTakeDestitute(state) {
  return !(state.resources.Wealth > 0);
}

export function currentCreationWealth(state) {
  // Clamped at 0, not at 1. "Floored at a minimum of 1" in
  // resources.md#wealth-at-character-creation is the FAILED ROLL'S COST -
  // "even an inexpensive item with no real gap still costs at least 1 Level
  // on a failed roll" - and wealthCheck.js already applies it there, as
  // Math.max(1, gap). Applying it a second time to the result meant
  // creation-Wealth could never fall below 1, so an item of Wealth 1 or 2
  // stayed affordable no matter how many failed checks came before it. The
  // same rule's closing line - "once no remaining item is affordable, gear
  // shopping is over for this character creation" - could never fire. It
  // fires now: no item in the catalog is Wealth 0, so a creation-Wealth of 0
  // ends the shopping pass.
  return Math.max(0, creationWealthBase(state) - state.creationWealthLoss);
}

export function setEverymanGearPackage(state, pkg) {
  if (!state.everymanGearPackages) state.everymanGearPackages = {};
  // null clears every Level. It used to clear the character's single pick;
  // when packages became one per Level this returned early instead, which
  // turned the Clear Pick button into a button that did nothing at all.
  if (pkg == null) {
    state.everymanGearPackages = {};
    return;
  }
  const held = state.everymanGearPackages[pkg.level];
  if (held && held.name === pkg.name) {
    // Clicking the held package again clears that Level's pick.
    delete state.everymanGearPackages[pkg.level];
    return;
  }
  state.everymanGearPackages[pkg.level] = pkg;
}

function nextGearPurchaseId(state) {
  return state.gearPurchases.reduce((max, p) => Math.max(max, p.id), 0) + 1;
}

// `free` records that this came out of a creation free band rather than a
// Wealth Check. The shop counts the limited band's picks off it, so it has
// to survive a save and reload - a character who reopened the creator would
// otherwise get their free picks back.
export function addGearPurchase(state, { category, name, wealth, loss = 0, free = false }) {
  const id = nextGearPurchaseId(state);
  state.gearPurchases.push({ id, category, name, wealth, loss, free });
  state.creationWealthLoss += loss;
}

export function addFlavorItem(state, text) {
  const clean = String(text).trim();
  if (clean) state.flavorItems.push(clean);
}

export function removeFlavorItem(state, index) {
  state.flavorItems.splice(index, 1);
}

export function removeGearPurchase(state, id) {
  const purchase = state.gearPurchases.find((p) => p.id === id);
  if (!purchase) return;
  state.creationWealthLoss = Math.max(0, state.creationWealthLoss - purchase.loss);
  state.gearPurchases = state.gearPurchases.filter((p) => p.id !== id);
}

// Clears every Wealth Check purchase and its accumulated loss, returning
// currentCreationWealth() to creationWealthBase() - the page's own starting
// state (2, or the bought Wealth Resource Level, or 0 if Destitute).
export function resetGearPurchases(state) {
  state.gearPurchases = [];
  state.creationWealthLoss = 0;
}

// A Limiter drops the cost of every Level of its Gift, floored at a
// minimum, stacking with no ceiling on how many can be taken. Discount
// and floor both come from rules/costs.md (see rules/gifts.md#points).
export function giftLevelCost(data, limiterCount) {
  return Math.max(data.giftLimiterFloor, data.giftLevelCost - limiterCount * data.giftLimiterDiscount);
}

// A repeatable Adder (Roll Call) appears once in a Gift's `adders` list per
// purchase, so undoing one purchase takes out one entry, never all of them.
export function removeOneAdder(gift, adderName) {
  const i = gift.adders.lastIndexOf(adderName);
  if (i !== -1) gift.adders.splice(i, 1);
}

// Why an Adder or Limiter can't be taken right now, or null if it can: it
// contradicts something already chosen on this Gift, or it needs a Level or
// another Adder the character doesn't have yet. Only ever blocks adding.
export function optionBlock(gState, option) {
  const chosen = new Set([...(gState?.adders ?? []), ...(gState?.limiters ?? [])]);
  const clash = (option.conflicts ?? []).find((n) => chosen.has(n));
  if (clash) return `can't be taken with ${clash}`;
  if (option.requiresLevel && (gState?.level ?? 0) < option.requiresLevel) return `needs Level ${option.requiresLevel}`;
  if (option.requiresAdder && !chosen.has(option.requiresAdder)) return `needs ${option.requiresAdder}`;
  return null;
}

export function adderCount(gift, adderName) {
  return (gift?.adders ?? []).filter((a) => a === adderName).length;
}

// "Roll Call ×2" rather than the name twice, wherever Adders are listed.
export function adderLabels(names) {
  const counts = new Map();
  (names ?? []).forEach((n) => counts.set(n, (counts.get(n) ?? 0) + 1));
  return [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n));
}

export function giftPointsSpent(gift, data) {
  const perLevel = giftLevelCost(data, gift.limiters.length);
  const levelCost = gift.level * perLevel;
  const adderCost = gift.adders.reduce((sum, adderName) => {
    const giftData = data.gifts.find((g) => g.name === gift.name);
    const adder = giftData.adders.find((a) => a.name === adderName);
    return sum + (adder ? adder.points : 0);
  }, 0);
  return levelCost + adderCost;
}

// The Gift as it stood at creation: Levels and Adders bought with XP taken
// back out, one entry per purchase.
function giftAtCreation(state, g) {
  const adders = [...g.adders];
  (state.advancementPurchases?.GiftAdders?.[g.name] ?? []).forEach((name) => {
    const i = adders.lastIndexOf(name);
    if (i !== -1) adders.splice(i, 1);
  });
  return { ...g, level: g.level - advBought(state, 'Gifts', g.name), adders };
}

export function giftsPointsSpent(state, data) {
  return state.gifts.reduce((sum, g) => sum + giftPointsSpent(giftAtCreation(state, g), data), 0);
}

export function giftsPoolRemaining(state, data) {
  const total = data.giftsPoolTotal + giftsDiscretionaryContribution(state, data)
    + bonusFor(state, 'Gifts') - forfeitFor(state, 'Gifts');
  return total - giftsPointsSpent(state, data);
}

// ---- Gift build-menu purchases ----
// A Gift using the custom Pool/Build-menu structure (Alternate Form,
// Cybernetics, or any future Gift built the same way - see parseGiftMenu in
// parse/gifts.js) has its own separate points pool, sized by the Gift's
// current Level, spent on menu options rather than the flat per-Level cost.
// Each purchase is its own entry (not a count per option) since the same
// option can be bought more than once for different sub-choices (e.g. two
// separate Sub-stat boosts) - each entry's `note` records which.

export function giftMenuPool(gift, giftData) {
  const row = giftData.menu.poolByLevel.find((r) => r.level === gift.level);
  return row ? row.pool : 0;
}

// Two Gifts can buy a second build with an Adder - Alternate Form's
// Second Form, Cybernetics' Battle Configuration. Each build gets the
// whole pool for the Gift's Level (ruling, 2026-09-26): the Adder buys a
// second build, not a split of the first one. A purchase with no `build`
// belongs to the first.
const SECOND_BUILD = {
  'Alternate Form': { adder: 'Second Form', names: ['First form', 'Second form'] },
  'Cybernetics': { adder: 'Battle Configuration', names: ['First loadout', 'Second loadout'] },
};

export function giftMenuBuilds(gift) {
  const spec = SECOND_BUILD[gift?.name];
  const two = spec && (gift.adders || []).includes(spec.adder);
  return two ? [1, 2] : [1];
}

export function giftMenuBuildName(gift, build) {
  return SECOND_BUILD[gift?.name]?.names[build - 1] ?? 'Build';
}

export function giftMenuPurchases(gift, build = 1) {
  return (gift.buildPurchases ?? []).filter((p) => (p.build || 1) === build);
}

export function giftMenuSpent(gift, build = 1) {
  return giftMenuPurchases(gift, build).reduce((sum, p) => sum + p.cost, 0);
}

export function giftMenuRemaining(gift, giftData, build = 1) {
  return giftMenuPool(gift, giftData) - giftMenuSpent(gift, build);
}

function nextBuildPurchaseId(gift) {
  return (gift.buildPurchases ?? []).reduce((max, p) => Math.max(max, p.id), 0) + 1;
}

export function addGiftMenuPurchase(state, giftName, { option, cost, note = '', build = 1 }) {
  const g = state.gifts.find((x) => x.name === giftName);
  const id = nextBuildPurchaseId(g);
  const entry = { id, option, cost, note };
  if (build !== 1) entry.build = build;
  (g.buildPurchases ??= []).push(entry);
}

export function updateGiftMenuPurchaseNote(state, giftName, purchaseId, note) {
  const g = state.gifts.find((x) => x.name === giftName);
  const purchase = g?.buildPurchases?.find((p) => p.id === purchaseId);
  if (purchase) purchase.note = note;
}

export function removeGiftMenuPurchase(state, giftName, purchaseId) {
  const g = state.gifts.find((x) => x.name === giftName);
  if (!g?.buildPurchases) return;
  g.buildPurchases = g.buildPurchases.filter((p) => p.id !== purchaseId);
}

// ---- Discretionary purchases of real items (the Discretionary Points step) ----
// Attributes/Skills/Resources use a flat per-unit cost, so their
// discretionaryExtra counters can just be incremented/decremented directly
// alongside the real state change. Gifts are the exception - a Gift's
// per-Level cost depends on how many Limiters it has, which can change
// after the purchase - so Gifts track levels-bought-here per Gift and
// recompute their pool contribution live instead of a static increment.

export function buyAttributePoint(state, attrName) {
  state.attributes[attrName] += 1;
  state.discretionaryPurchases.Attributes[attrName] =
    (state.discretionaryPurchases.Attributes[attrName] ?? 0) + 1;
  state.discretionaryExtra.Attributes += 1;
}

export function refundAttributePoint(state, attrName) {
  const bought = state.discretionaryPurchases.Attributes[attrName] ?? 0;
  if (bought <= 0) return;
  state.attributes[attrName] -= 1;
  state.discretionaryPurchases.Attributes[attrName] = bought - 1;
  state.discretionaryExtra.Attributes -= 1;
}

export function buySkillTier(state, skillName) {
  state.skills[skillName] += 1;
  state.discretionaryPurchases.Skills[skillName] =
    (state.discretionaryPurchases.Skills[skillName] ?? 0) + 1;
  state.discretionaryExtra.Skills += 1;
}

export function refundSkillTier(state, skillName) {
  const bought = state.discretionaryPurchases.Skills[skillName] ?? 0;
  if (bought <= 0) return;
  state.skills[skillName] -= 1;
  state.discretionaryPurchases.Skills[skillName] = bought - 1;
  state.discretionaryExtra.Skills -= 1;
}

export function buyResourceLevel(state, data, resourceName) {
  if (resourceName === 'Wealth' && !canBuyWealthAtCreation(state)) return;
  state.resources[resourceName] += 1;
  state.discretionaryPurchases.Resources[resourceName] =
    (state.discretionaryPurchases.Resources[resourceName] ?? 0) + 1;
  state.discretionaryExtra.Resources += data.resourceLevelCost;
}

export function refundResourceLevel(state, data, resourceName) {
  const bought = state.discretionaryPurchases.Resources[resourceName] ?? 0;
  if (bought <= 0) return;
  state.resources[resourceName] -= 1;
  state.discretionaryPurchases.Resources[resourceName] = bought - 1;
  state.discretionaryExtra.Resources -= data.resourceLevelCost;
}

// Signature Move is the one Gift that is built rather than picked: the
// player chooses which sub-stat powers it and which wall it resolves
// against, and the two need not match (rules/gifts.md, Signature Move).
// A Presence-sourced Move against Soak is a legal, and interesting,
// build - so these are two independent lists, not three fixed pairs.
export const SIGNATURE_MOVE = 'Signature Move';
export const ATTACK_SOURCES = ['Ferocity', 'Presence', 'Psyche'];
export const ATTACK_WALLS = ['Soak', 'Presence', 'Psyche'];

function blankMove() {
  return { name: '', level: 1, source: '', wall: '', description: '' };
}

// Every Move a character holds. Saves predating multiple Moves carry a
// single `signature` object and the Gift's own level; those migrate into a
// one-Move list here rather than on load, so an untouched character is
// never rewritten just by being opened.
export function signatureMoves(gift) {
  if (!gift) return [];
  if (Array.isArray(gift.moves)) return gift.moves;
  const s = gift.signature;
  if (s || gift.level > 0) {
    return [{
      name: (s && s.name) || '',
      level: gift.level || 1,
      source: (s && s.source) || '',
      wall: (s && s.wall) || '',
      description: (s && s.description) || '',
    }];
  }
  return [];
}

function movesOf(state) {
  const g = state.gifts.find((x) => x.name === SIGNATURE_MOVE);
  if (!g) return null;
  if (!Array.isArray(g.moves)) g.moves = signatureMoves(g);
  return g;
}

export function addSignatureMove(state) {
  const g = movesOf(state);
  if (!g) return;
  g.moves.push(blankMove());
  g.level = g.moves.reduce((n, m) => n + m.level, 0);
}

export function removeSignatureMove(state, index) {
  const g = movesOf(state);
  if (!g || !g.moves[index]) return;
  g.moves.splice(index, 1);
  g.level = g.moves.reduce((n, m) => n + m.level, 0);
}

export function setSignatureField(state, index, field, value) {
  const g = movesOf(state);
  if (!g || !g.moves[index]) return;
  g.moves[index] = { ...g.moves[index], [field]: value };
  // The Gift's own level is the sum of its Moves' levels, which is what
  // the points pool charges for - each Move is bought separately.
  g.level = g.moves.reduce((n, m) => n + m.level, 0);
}
export function buyGiftLevel(state, giftName) {
  let g = state.gifts.find((x) => x.name === giftName);
  if (!g) {
    g = { name: giftName, level: 0, adders: [], limiters: [] };
    state.gifts.push(g);
  }
  g.level += 1;
  state.discretionaryPurchases.Gifts[giftName] = (state.discretionaryPurchases.Gifts[giftName] ?? 0) + 1;
}

export function refundGiftLevel(state, giftName) {
  const bought = state.discretionaryPurchases.Gifts[giftName] ?? 0;
  if (bought <= 0) return;
  const g = state.gifts.find((x) => x.name === giftName);
  g.level -= 1;
  state.discretionaryPurchases.Gifts[giftName] = bought - 1;
}

// Adders bought via Discretionary are tracked separately from a Gift's own
// `adders` array entry (which just needs the name for display/effect
// text), same pattern as Advancement's buyAdvancementGiftAdder.
export function buyDiscretionaryGiftAdder(state, giftName, adderName, repeatable = false) {
  const g = state.gifts.find((x) => x.name === giftName);
  if (g && (repeatable || !g.adders.includes(adderName))) g.adders.push(adderName);
  const list = (state.discretionaryPurchases.GiftAdders[giftName] ??= []);
  list.push(adderName);
}

export function refundDiscretionaryGiftAdder(state, giftName, adderName) {
  const list = state.discretionaryPurchases.GiftAdders[giftName] ?? [];
  const idx = list.lastIndexOf(adderName);
  if (idx === -1) return;
  list.splice(idx, 1);
  const g = state.gifts.find((x) => x.name === giftName);
  if (g) removeOneAdder(g, adderName);
}

export function giftsDiscretionaryContribution(state, data) {
  let total = 0;
  Object.entries(state.discretionaryPurchases.Gifts).forEach(([name, levels]) => {
    if (!levels) return;
    const g = state.gifts.find((x) => x.name === name);
    total += levels * giftLevelCost(data, g ? g.limiters.length : 0);
  });
  Object.entries(state.discretionaryPurchases.GiftAdders).forEach(([giftName, adderNames]) => {
    const giftData = data.gifts.find((x) => x.name === giftName);
    adderNames.forEach((adderName) => {
      const adder = giftData?.adders.find((a) => a.name === adderName);
      if (adder) total += adder.points;
    });
  });
  return total;
}

// What those same purchases actually cost in Discretionary points, which is
// NOT the pool contribution above times the rate. Gifts are the one target
// charged per Level rather than per pool point (rules/costs.md, Discretionary
// Rates): a Level is a flat 4 however many Limiters it carries, and an Adder
// costs what it is worth in Levels - a Lesser Adder is one Level, a Greater
// is two. The pool bookkeeping still runs on pool points; only the price here
// is flat.
export function giftsDiscretionarySpent(state, data) {
  const rate = data.discretionaryRates.Gifts ?? 0;
  let spent = 0;
  Object.values(state.discretionaryPurchases.Gifts).forEach((levels) => {
    spent += (levels || 0) * rate;
  });
  Object.entries(state.discretionaryPurchases.GiftAdders).forEach(([giftName, adderNames]) => {
    const giftData = data.gifts.find((x) => x.name === giftName);
    adderNames.forEach((adderName) => {
      const adder = giftData?.adders.find((a) => a.name === adderName);
      if (adder) spent += Math.round((adder.points / data.giftLevelCost) * rate);
    });
  });
  return spent;
}

export function addBoon(state, name, cost, source) {
  state.boons.push({ name, points: cost.points, tier: cost.tier, source, notes: [] });
  if (source === 'discretionary') {
    state.discretionaryExtra.Boons += cost.points;
  }
}

export function removeBoon(state, index) {
  const [removed] = state.boons.splice(index, 1);
  if (removed?.source === 'discretionary') {
    state.discretionaryExtra.Boons -= removed.points;
  }
}

/* What the player had to invent.
 *
 * A Boon, Flaw or Gift routinely asks for something the rules cannot
 * supply - what the Familiar actually is, which weapon system Special
 * Weapons bought, the phrase Incantations needs said out loud, the
 * category Pariah puts you in. Before this it was agreed at the table
 * and written on a napkin, and the character file did not carry it, so
 * it was gone by the next session.
 *
 * Only the entries that genuinely ask - app/describe-spec.js holds that
 * list, derived from the rules text by tools/derive-describe-spec.py.
 * Berserker and Battle Sense define nothing, and a field on those asks
 * the player to describe an absence.
 *
 * Notes are an array because some entries carry more than one answer: a
 * second Animal Companion is its own animal with its own name, and
 * Distinctive Features buys up to four of them.
 */
function noteList(holder) {
  if (!holder) return null;
  // Migration: the first version of this stored one string.
  if (typeof holder.note === 'string') {
    holder.notes = holder.note ? [holder.note] : [];
    delete holder.note;
  }
  if (!Array.isArray(holder.notes)) holder.notes = [];
  return holder.notes;
}

function setNote(holder, index, value) {
  const notes = noteList(holder);
  if (!notes) return;
  while (notes.length <= index) notes.push('');
  notes[index] = value;
}

export function boonNotes(boon) { return noteList(boon) ?? []; }
export function flawNotes(flaw) { return noteList(flaw) ?? []; }
export function giftNotes(gift) { return noteList(gift) ?? []; }

// Answers an Adder or Limiter asks for at creation (describe-spec.js,
// OPTION_CHOICES), kept per option on the Gift as a list, because Narrow
// Fabrication asks for three.
export function optionChoice(gift, option) {
  return gift?.choices?.[option] ?? [];
}

export function setOptionChoice(state, giftName, option, slot, value) {
  const g = state.gifts.find((x) => x.name === giftName);
  if (!g) return;
  g.choices = g.choices || {};
  const list = [...(g.choices[option] || [])];
  list[slot] = value;
  g.choices[option] = list;
}

// "Elemental Edge (Bleeding)" - an option with its answer, for the sheet.
export function optionWithChoice(gift, label, option = label) {
  const picked = optionChoice(gift, option).filter(Boolean);
  return picked.length ? `${label} (${picked.join(', ')})` : label;
}

// Forcefield's three Forms, read off the numbered list in its rules text
// ("1. **Wielded Shield** - ...") so the choice follows the book.
export function forcefieldForms(data) {
  const md = (data?.gifts || []).find((g) => g.name === 'Forcefield')?.markdown || '';
  return [...md.matchAll(/^\d+\.\s+\*\*([^*]+)\*\*/gm)].map((m) => m[1].trim());
}

export function setBoonNote(state, index, slot, value) {
  setNote(state.boons[index], slot, value);
}

export function setFlawNote(state, name, slot, value) {
  setNote(state.flaws.find((f) => f.name === name), slot, value);
}

export function setGiftNote(state, name, slot, value) {
  setNote(state.gifts.find((g) => g.name === name), slot, value);
}

// Every Flaw in flaws.md is Leveled; points granted equal the level taken.
// A Level bought off with XP after creation still granted its point at
// creation, so the grant counts it - buying off a Flaw costs XP, not the
// Discretionary it paid for back then.
export function flawCreationLevel(f) {
  return f.level + (Number(f.boughtOff) || 0);
}

export function flawsPointsGranted(state) {
  return state.flaws.reduce((sum, f) => sum + flawCreationLevel(f), 0);
}

// ---- Flaw buy-off (costs.md, Advancement) ----
// XP per Level, the multiplier times the one point each Level granted.
// The Flaw drops a Level at a time; its level is what everything else
// reads, so a Flaw bought off to 0 is simply not held any more.
export function flawBuyoffCost(data) {
  return data.advancement.flawBuyoffXpMultiplier;
}

export function buyOffFlawLevel(state, name) {
  const f = state.flaws.find((x) => x.name === name);
  if (!f || f.level <= 0) return;
  f.level -= 1;
  f.boughtOff = (Number(f.boughtOff) || 0) + 1;
}

export function restoreFlawLevel(state, name) {
  const f = state.flaws.find((x) => x.name === name);
  if (!f || !(Number(f.boughtOff) > 0)) return;
  f.level += 1;
  f.boughtOff -= 1;
}

export function flawBuyoffXpSpent(state, data) {
  return state.flaws.reduce((sum, f) => sum + (Number(f.boughtOff) || 0), 0) * flawBuyoffCost(data);
}

// Unspent points from the base 10-point Boons Pool convert 1:1 into
// Discretionary rather than being lost. Only counts Boons bought with
// source 'pool' - a Boon bought *with* Discretionary points doesn't feed
// back into this, which would just be moving the same points in a circle.
export function unspentBoonsPoolPoints(state, data) {
  const poolFundedSpent = state.boons
    .filter((b) => b.source !== 'discretionary')
    .reduce((sum, b) => sum + b.points, 0);
  return Math.max(0, data.boonsPoolTotal - poolFundedSpent);
}

// Unspent points from the base 21-point Gifts Pool also convert rather than
// being lost - Limiters discount a Gift's per-Level cost (floored at 1), so
// mixing limited and unlimited Gifts often doesn't divide the pool evenly.
// giftsPoolRemaining() already nets out discretionary-funded Gift spend
// (see giftsDiscretionaryContribution), so whatever's left there is
// genuinely unspent base-pool points, not just "room the pool total was
// puffed up to allow." Floored at 0 the same way Boons is, defensively.
export function unspentGiftsPoolPoints(state, data) {
  // An NPC's forfeit only clears the Gifts badge; the leftover it hides
  // still converts, and is forfeited once, as Discretionary.
  return Math.max(0, giftsPoolRemaining(state, data) + forfeitFor(state, 'Gifts'));
}

// The GM's cap (see the Discretionary Points step) applies only to Flaw-earned Discretionary,
// same as it always has - Boons/Gifts Pool leftover isn't a stacking-for-profit
// lever the way Flaws can be, it's just "don't lose points you didn't
// spend," so both always convert in full regardless of the cap.
export function discretionaryTotal(state, data) {
  const flawBonus =
    state.discretionaryCap != null
      ? Math.min(flawsPointsGranted(state), state.discretionaryCap)
      : flawsPointsGranted(state);
  return (
    data.discretionaryBase +
    flawBonus +
    unspentBoonsPoolPoints(state, data) +
    unspentGiftsPoolPoints(state, data) * data.giftsLeftoverRate
  );
}

export function discretionaryPointsSpent(state, data) {
  let spent = 0;
  Object.entries(state.discretionaryExtra).forEach(([target, extra]) => {
    if (target === 'Gifts') return; // priced per Level, see giftsDiscretionarySpent
    spent += extra * (data.discretionaryRates[target] ?? 0);
  });
  spent += giftsDiscretionarySpent(state, data);
  return spent;
}

export function discretionaryRemaining(state, data) {
  return discretionaryTotal(state, data) - discretionaryPointsSpent(state, data)
    - forfeitFor(state, 'Discretionary');
}

// ---- NPCs ----
// An NPC is built on the same pools as a PC but is not owed the whole
// build: a GM stops when the character is done, and whatever is left is
// simply not theirs. Finish as NPC takes every pool's remainder off it.
// Boons and Gifts leftovers already convert into Discretionary, so their
// badges are cleared but the points themselves are forfeited once, as
// part of Discretionary. Unmarking gives it all back.
const NPC_POOLS = ['Attributes', 'Skills', 'Boons', 'Resources', 'Gifts'];

export function markNpc(state, data) {
  const forfeit = { SubStats: {} };
  state.npc = { forfeit };
  NPC_POOLS.forEach((pool) => {
    const left = allPoolsSummary(state, data).find((p) => p.label === pool).remaining;
    forfeit[pool] = Math.max(0, left);
  });
  data.attributes.forEach((a) => {
    forfeit.SubStats[a.name] = Math.max(0, subStatPoolRemaining(state, data, a.name));
  });
  forfeit.Discretionary = Math.max(0, discretionaryRemaining(state, data));
}

export function unmarkNpc(state) {
  state.npc = null;
}

export function npcPointsRemoved(state) {
  const f = state.npc?.forfeit ?? {};
  const sub = Object.values(f.SubStats ?? {}).reduce((a, b) => a + b, 0);
  return (f.Attributes || 0) + (f.Skills || 0) + (f.Resources || 0) + (f.Discretionary || 0) + sub;
}

export function skillTierName(data, tier) {
  return data.skillTiers.find((t) => t.tier === tier)?.name ?? String(tier);
}

// ---- Descriptors ----
// Descriptors are pure core traits (rules.md#sub-stat-descriptors): one per
// point allocated to a sub-stat, no way to buy an extra one on top.

export function descriptorSlots(state, subStatName) {
  return state.subStats[subStatName];
}

// ---- Figured Characteristics (computed live, formulas parsed but applied here) ----

export function computeFiguredCharacteristics(state) {
  const s = state.subStats;
  // Ki is deliberately common: strongest Element + 8, so every character lands
  // between 13 and 18 (the flattest legal spread still has a 5 somewhere).
  // Whatever a character is most is what channels their Ki.
  const ki = Math.max(...Object.values(state.attributes)) + 8;
  // Ki bought with XP sits on top of the figured value rather than
  // replacing it, so raising an Element later still raises the pool
  // and never quietly recalculates away something the player bought.
  const boughtKi = state.advancementPurchases?.Ki ?? 0;
  return {
    'Health Levels': 5 + s.Health,
    Poise: 5 + s.Presence,
    Sanity: 5 + s.Psyche,
    // Each attack type is answered by two different stats from two
    // different Elements: one keeps it from landing, another absorbs it
    // once it does. Never the same stat for both, or that stat becomes the
    // only one worth buying - Presence walls Social but deflects Mental,
    // Psyche walls Mental but deflects Social.
    Defense: 10 - s.Atropos,
    'Social Defense': 10 - s.Psyche,
    'Mental Defense': 10 - s.Presence,
    'Movement Rate': 5 + state.attributes.Air,
    'Carrying Capacity': Math.pow(s.Potence, 2) * 10,
    Ki: Math.ceil(ki) + boughtKi,
    // What the pool would be with nothing bought - the cap is measured
    // against this, not against itself.
    'Figured Ki': Math.ceil(ki),
  };
}

// Gift Check target number: current Ki (see rules/gifts.md#resolution).
export function giftCheckTarget(state) {
  return state.currentKi ?? computeFiguredCharacteristics(state).Ki;
}

// An Element raised past its roll cap stops adding to target numbers and pays
// out on its own steps instead - see rules/costs.md, Universal Caps and the
// "Attribute over 10" rates. Each effect is floor(points past the cap / N),
// so they arrive at different ratings rather than all at once.
export function attributePointsOverCap(state, data, attrName) {
  return Math.max(0, state.attributes[attrName] - data.attributeRollCap);
}

export function elementCritSteps(state, data, attrName) {
  return Math.floor(
    attributePointsOverCap(state, data, attrName) / data.advancement.attributeOverCapCritStep,
  );
}

export function elementAutoSuccesses(state, data, attrName) {
  return Math.floor(
    attributePointsOverCap(state, data, attrName) / data.advancement.attributeOverCapAutoSuccessStep,
  );
}

// Unlike the other two, this one is not per-Element: every Attribute's spill
// adds to the same ceiling.
function fateCeilingBonus(state, data) {
  return Object.keys(state.attributes).reduce(
    (sum, name) => sum + Math.floor(
      attributePointsOverCap(state, data, name) / data.advancement.attributeOverCapFateStep,
    ),
    0,
  );
}

// Stamina governs the whole Fate Token economy: it caps how many a character
// can hold (x3) as well as how many can be spent per Scene, the latter not
// being the creator's business (rules/fate.md#holding-fate-tokens). Elements
// pushed past the roll cap raise that ceiling further.
export function fateTokenCap(state, data) {
  return state.subStats.Stamina * 3 + fateCeilingBonus(state, data);
}

// How many extra Fate Tokens Discretionary points can actually buy: the gap
// between the flat starting count and the character's current cap.
export function fateTokensBuyable(state, data) {
  return Math.max(0, fateTokenCap(state, data) - data.startingFateTokens);
}

// Stamina is raisable while the player spends (its Attribute can be bought,
// and its own points reallocated), so the cap moves mid-build. Lowering it
// afterwards has to give the points back rather than strand them on Tokens
// the character can't hold - dropping discretionaryExtra does exactly that,
// since the spend is derived from it. Called from the render choke point.
export function clampFateTokenPurchases(state, data) {
  const buyable = fateTokensBuyable(state, data);
  if (state.discretionaryExtra['Fate Tokens'] > buyable) {
    state.discretionaryExtra['Fate Tokens'] = buyable;
  }
}

export function startingFateTokens(state, data) {
  return Math.min(
    fateTokenCap(state, data),
    data.startingFateTokens + state.discretionaryExtra['Fate Tokens'],
  );
}

// ---- Play State (post-creation tracking: damage, Fate Tokens, Ki, rest) ----

// state.current* fields don't exist until the character sheet is first
// shown - initialized here to each track's max/starting value rather than
// baked into createInitialState, so they always reflect whatever the build
// actually looked like the moment the player finished it. Safe to call every
// render: only sets a field the first time (`== null`), never resets an
// in-progress character's tracked values on a later visit to the sheet.
export function initPlayState(state, data) {
  const figured = computeFiguredCharacteristics(state);
  if (state.currentHealth == null) state.currentHealth = figured['Health Levels'];
  if (state.currentPoise == null) state.currentPoise = figured.Poise;
  if (state.currentSanity == null) state.currentSanity = figured.Sanity;
  if (state.currentKi == null) state.currentKi = figured.Ki;
  if (state.currentFateTokens == null) state.currentFateTokens = startingFateTokens(state, data);
  // Both are tracked on the sheet and nowhere else: Exhausted stacks 1-5
  // (rules/fate.md) and Fate Tokens spent this Scene sits beside the held
  // count because the cap is per Scene, not per session.
  if (state.exhausted == null) state.exhausted = 0;
  if (state.fateSpentThisScene == null) state.fateSpentThisScene = 0;
}

// Takes FULL Health Levels (5 + Health), not the Health sub-stat. The rule
// mirrors the whole row - "a character with 7 Health Levels is unconscious
// at 0, Dying from -1, and dead at -7" - and passing the sub-stat here
// dropped the flat 5, killing everyone five Levels early.
export function healthStatus(current, healthLevels) {
  if (current > 0) return null;
  // "At 0 Health Levels, a character falls unconscious" is unconditional,
  // so 0 is Unconscious no matter what the death threshold works out to.
  if (current === 0) return 'Unconscious';
  return current <= -healthLevels ? 'Dead' : 'Dying';
}

export function poiseStatus(current) {
  if (current < 0) return 'Humiliated';
  return current === 0 ? 'Flustered' : null;
}

export function sanityStatus(current) {
  if (current < 0) return 'Shattered';
  return current === 0 ? 'Overwhelmed' : null;
}

// Poise and Sanity have a bottom; Health's bottom is death and needs no
// bookkeeping (rules.md#poise, #sanity). Reaching -(full) resets the Vital to
// 0 - back to Flustered or Overwhelmed, not healed - and charges for it.
//
// This lives here rather than beside the combat tracker so the creator and
// the tracker cannot disagree about when a floor fires.
export function applyVitalFloor(target, track, max, figured) {
  const key = 'current' + track;
  if (track === 'Poise' && target[key] <= -max) {
    target[key] = 0;
    // The Sanity Level the floor costs is itself a Vital change, so it can
    // push Sanity onto its own floor - hence the recursive call rather than
    // a bare decrement.
    target.currentSanity -= 1;
    noteFloor(target, 'Poise floor: reset to 0, took 1 Sanity');
    applyVitalFloor(target, 'Sanity', figured.Sanity, figured);
    return;
  }
  if (track === 'Sanity' && target[key] <= -max) {
    target[key] = 0;
    noteFloor(target, 'Sanity floor: reset to 0, temporary mental health condition');
  }
}

// A Poise floor can knock Sanity onto its own floor in the same stroke.
// Both happened, so both are reported.
function noteFloor(target, text) {
  target.floorNote = target.floorNote ? target.floorNote + ' + ' + text : text;
}

// Short Rest and Full Night's Rest recovery (rules.md#health-level-recovery,
// #poise, #sanity, fate.md#ki-the-pool).
//
// Above 0 all three Vitals behave the same: half the governing sub-stat
// rounded up on a Short Rest, minimum 1 (Math.ceil(0 / 2) would otherwise
// heal nothing at sub-stat 0), and back to full on a Full Night's Rest.
//
// Below 0 they part company, and this is where the old single rule was wrong.
// A body does not knit in an hour: Health recovers NOTHING from a Short Rest
// and exactly one Level from a full night. A reputation and a mind turn a
// corner faster, so either rest puts Poise or Sanity back to 1 - not to full,
// and normal rates resume from there.
function restLevel(track, current, max, subStatValue, isFullRest) {
  if (track === 'Health') {
    if (current < 0) return isFullRest ? Math.min(0, current + 1) : current;
  } else if (current < 0) {
    return 1;
  }
  if (isFullRest) return max;
  return Math.min(max, current + Math.max(1, Math.ceil(subStatValue / 2)));
}

export function applyRest(state, isFullRest) {
  const figured = computeFiguredCharacteristics(state);
  const s = state.subStats;
  state.currentHealth = restLevel('Health', state.currentHealth, figured['Health Levels'], s.Health, isFullRest);
  state.currentSanity = restLevel('Sanity', state.currentSanity, figured.Sanity, s.Psyche, isFullRest);
  state.currentPoise = restLevel('Poise', state.currentPoise, figured.Poise, s.Presence, isFullRest);
  state.currentKi = isFullRest
    ? figured.Ki
    : Math.min(figured.Ki, state.currentKi + Math.max(1, s.Klotho));
  // A Short Rest clears one level of Exhausted, a full night all of them
  // (rules.md, Exhausted). A level from cold or heat does not clear while
  // you are still in it - the sheet cannot know where you are standing,
  // so that one is the player's to put back with the +.
  const exhausted = Number(state.exhausted) || 0;
  state.exhausted = isFullRest ? 0 : Math.max(0, exhausted - 1);
}

// ---- Advancement (post-creation XP spend, see rules/costs.md) ----
// Unlike Discretionary's flat per-unit rates, most Advancement costs scale
// with the current value being raised (current tier/rating/level × a
// multiplier) - so, same convention already used by giftsDiscretionaryContribution,
// XP-funded units are treated as the topmost N of whatever the stat's
// current total is, and their cost is recomputed live from that
// assumption rather than stored per-purchase. This is exact as long as a
// given stat's Advancement-funded units aren't interleaved with a later
// Discretionary purchase on the very same stat after creation has ended,
// which isn't expected to happen in practice (creation finishes, then
// Advancement play begins).

function sumTopN(currentValue, count, costFn) {
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += costFn(currentValue - count + i);
  }
  return total;
}

export function buyAdvancementAttributePoint(state, attrName) {
  state.attributes[attrName] += 1;
  state.advancementPurchases.Attributes[attrName] = (state.advancementPurchases.Attributes[attrName] ?? 0) + 1;
}

export function refundAdvancementAttributePoint(state, attrName) {
  const bought = state.advancementPurchases.Attributes[attrName] ?? 0;
  if (bought <= 0) return;
  state.attributes[attrName] -= 1;
  state.advancementPurchases.Attributes[attrName] = bought - 1;
}

function attributesAdvancementXpSpent(state, data) {
  let total = 0;
  Object.entries(state.advancementPurchases.Attributes).forEach(([name, count]) => {
    if (!count) return;
    total += sumTopN(state.attributes[name], count, (rating) => rating * data.advancement.attributeXpMultiplier);
  });
  return total;
}

export function buyAdvancementSkillTier(state, skillName) {
  state.skills[skillName] += 1;
  state.advancementPurchases.Skills[skillName] = (state.advancementPurchases.Skills[skillName] ?? 0) + 1;
}

export function refundAdvancementSkillTier(state, skillName) {
  const bought = state.advancementPurchases.Skills[skillName] ?? 0;
  if (bought <= 0) return;
  state.skills[skillName] -= 1;
  state.advancementPurchases.Skills[skillName] = bought - 1;
}

function skillsAdvancementXpSpent(state, data) {
  let total = 0;
  Object.entries(state.advancementPurchases.Skills).forEach(([name, count]) => {
    if (!count) return;
    total += sumTopN(state.skills[name], count, (tier) => (
      // Untrained -> Novice is an acquisition, not a rung: tier 0 x N is 0,
      // and it buys more than any later tier does (an Untrained roll gets no
      // Attribute at all). It carries its own flat price.
      tier === 0 ? data.advancement.newSkillXp : tier * data.advancement.skillTierXpMultiplier
    ));
  });
  return total;
}

export function buyAdvancementResourceLevel(state, resourceName) {
  state.resources[resourceName] += 1;
  state.advancementPurchases.Resources[resourceName] = (state.advancementPurchases.Resources[resourceName] ?? 0) + 1;
}

export function refundAdvancementResourceLevel(state, resourceName) {
  const bought = state.advancementPurchases.Resources[resourceName] ?? 0;
  if (bought <= 0) return;
  state.resources[resourceName] -= 1;
  state.advancementPurchases.Resources[resourceName] = bought - 1;
}

function resourcesAdvancementXpSpent(state, data) {
  let total = 0;
  Object.entries(state.advancementPurchases.Resources).forEach(([name, count]) => {
    if (!count) return;
    total += sumTopN(state.resources[name], count, (level) => (
      // Acquiring a Resource is its own flat price - the multiplier collapses
      // to 0 at level 0, and taking a Resource at all buys more than any
      // single step up the ladder afterwards. Same shape as a new Skill.
      level === 0 ? data.advancement.newResourceXp : level * data.advancement.resourceLevelXpMultiplier
    ));
  });
  return total;
}

// New Gift (Level 0→1) uses a flat base instead of the level×multiplier
// formula, same override v1 needed for the same reason (the formula
// collapses to 0 at a starting level of 0).
export function advancementGiftLevelCostAt(data, fromLevel, limiterCount) {
  const base = fromLevel === 0 ? data.advancement.newGiftBaseXp : fromLevel * data.advancement.giftLevelXpMultiplier;
  return Math.max(data.advancement.giftLimiterFloor, base - limiterCount * data.advancement.giftLimiterDiscount);
}

function getOrCreateGift(state, giftName) {
  let g = state.gifts.find((x) => x.name === giftName);
  if (!g) {
    g = { name: giftName, level: 0, adders: [], limiters: [] };
    state.gifts.push(g);
  }
  return g;
}

export function buyAdvancementGiftLevel(state, giftName) {
  const g = getOrCreateGift(state, giftName);
  g.level += 1;
  state.advancementPurchases.Gifts[giftName] = (state.advancementPurchases.Gifts[giftName] ?? 0) + 1;
}

export function refundAdvancementGiftLevel(state, giftName) {
  const bought = state.advancementPurchases.Gifts[giftName] ?? 0;
  if (bought <= 0) return;
  const g = state.gifts.find((x) => x.name === giftName);
  g.level -= 1;
  state.advancementPurchases.Gifts[giftName] = bought - 1;
}

function giftsLevelAdvancementXpSpent(state, data) {
  let total = 0;
  Object.entries(state.advancementPurchases.Gifts).forEach(([name, count]) => {
    if (!count) return;
    const g = state.gifts.find((x) => x.name === name);
    const limiterCount = g ? g.limiters.length : 0;
    total += sumTopN(g.level, count, (fromLevel) => advancementGiftLevelCostAt(data, fromLevel, limiterCount));
  });
  return total;
}

// Adders bought via Advancement are tracked separately from a Gift's own
// `adders` array entry (which just needs the name for display/effect
// text) so they can be refunded specifically, distinct from any Adder the
// same Gift already had from creation.
export function buyAdvancementGiftAdder(state, giftName, adderName, repeatable = false) {
  const g = getOrCreateGift(state, giftName);
  if (repeatable || !g.adders.includes(adderName)) g.adders.push(adderName);
  if (!state.advancementPurchases.GiftAdders) state.advancementPurchases.GiftAdders = {};
  const list = (state.advancementPurchases.GiftAdders[giftName] ??= []);
  list.push(adderName);
}

export function refundAdvancementGiftAdder(state, giftName, adderName) {
  const list = state.advancementPurchases.GiftAdders?.[giftName] ?? [];
  const idx = list.lastIndexOf(adderName);
  if (idx === -1) return;
  list.splice(idx, 1);
  const g = state.gifts.find((x) => x.name === giftName);
  if (g) removeOneAdder(g, adderName);
}

function giftAddersAdvancementXpSpent(state, data) {
  let total = 0;
  Object.entries(state.advancementPurchases.GiftAdders ?? {}).forEach(([giftName, adderNames]) => {
    const giftData = data.gifts.find((x) => x.name === giftName);
    adderNames.forEach((adderName) => {
      const adder = giftData?.adders.find((a) => a.name === adderName);
      if (adder) total += data.advancement.giftAdderXp[adder.tier];
    });
  });
  return total;
}

// Boons bought via Advancement reuse the existing `state.boons` list with
// source 'advancement' (see addBoon/removeBoon) - their XP cost is the
// Boon's own creation-pool points times the Advancement markup, computed
// live rather than stored, same as Discretionary-funded Boons already do.
function boonsAdvancementXpSpent(state, data) {
  return state.boons
    .filter((b) => b.source === 'advancement')
    .reduce((sum, b) => sum + b.points * data.advancement.boonXpMultiplier, 0);
}


// Ki is bought a point at a time, each costing what the pool stands at
// when it is bought - so the tenth point costs more than the first, and a
// character who already channels a lot pays more to channel more.
//
// The ceiling is a multiple of the FIGURED value, not of the current one:
// measuring against the running total would let each purchase raise its own
// limit and the cap would never bind.
export function kiPurchaseCost(state, data) {
  return computeFiguredCharacteristics(state).Ki * data.advancement.kiXpMultiplier;
}

export function kiPurchaseCap(state, data) {
  const f = computeFiguredCharacteristics(state);
  return f['Figured Ki'] * data.advancement.kiMaxMultiplier;
}

export function canBuyKi(state, data) {
  return computeFiguredCharacteristics(state).Ki < kiPurchaseCap(state, data);
}

export function buyAdvancementKi(state, data) {
  if (!canBuyKi(state, data)) return;
  state.advancementPurchases.Ki = (state.advancementPurchases.Ki ?? 0) + 1;
}

export function refundAdvancementKi(state) {
  const bought = state.advancementPurchases.Ki ?? 0;
  if (bought <= 0) return;
  state.advancementPurchases.Ki = bought - 1;
}

// Each point cost the pool as it stood when bought, so the total is the run
// of costs from the figured value up to where the purchases stopped.
function kiAdvancementXpSpent(state, data) {
  const bought = state.advancementPurchases?.Ki ?? 0;
  if (!bought) return 0;
  const base = computeFiguredCharacteristics(state)['Figured Ki'];
  let total = 0;
  for (let i = 0; i < bought; i += 1) total += (base + i) * data.advancement.kiXpMultiplier;
  return total;
}
export function xpSpent(state, data) {
  return (
    attributesAdvancementXpSpent(state, data) +
    skillsAdvancementXpSpent(state, data) +
    resourcesAdvancementXpSpent(state, data) +
    giftsLevelAdvancementXpSpent(state, data) +
    giftAddersAdvancementXpSpent(state, data) +
    boonsAdvancementXpSpent(state, data) +
    kiAdvancementXpSpent(state, data) +
    flawBuyoffXpSpent(state, data)
  );
}

export function xpRemaining(state, data) {
  return state.xpEarned - xpSpent(state, data);
}

export function allPoolsSummary(state, data) {
  return [
    { label: 'Attributes', remaining: attributePoolRemaining(state, data) },
    { label: 'Skills', remaining: skillsPoolRemaining(state, data) },
    { label: 'Boons', remaining: boonsPoolRemaining(state, data) },
    { label: 'Resources', remaining: resourcesPoolRemaining(state, data) },
    { label: 'Gifts', remaining: giftsPoolRemaining(state, data) },
    { label: 'Discretionary', remaining: discretionaryRemaining(state, data) },
  ];
}
