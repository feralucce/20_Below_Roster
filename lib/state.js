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
    // Everyman Gear Packages (weapons.md#everyman-gear-packages) - a free,
    // no-roll alternative to Wealth Check shopping. Exactly one pick, or
    // null if the player shopped normally instead. { level, name, contents }.
    everymanGearPackage: null,
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
    discretionaryCap: null, // GM-set cap on Flaw-earned Discretionary points, null = uncapped
    // Tracks how many pool-points'-worth of each scalar target (Attributes/
    // Skills/Resources/Gifts) were funded specifically through the Discretionary Points step's
    // Discretionary pickers, keyed by item name. Lets the Discretionary Points step offer real
    // +/- controls on the actual items (not just an abstract pool bump)
    // while still letting the item's own step show/adjust the same value.
    discretionaryPurchases: { Attributes: {}, Skills: {}, Resources: {}, Gifts: {}, GiftAdders: {} },
    finishingNotes: '',

    // ---- Advancement (post-creation XP spend, see docs/advancement-reference.html) ----
    xpEarned: 0,
    // Same shape/role as discretionaryPurchases - tracks how much of each
    // scalar target's current value was funded via Advancement XP rather
    // than creation pools or Discretionary, so it can be refunded and its
    // XP cost recomputed live. Boons funded via Advancement are tagged with
    // source 'advancement' on the existing state.boons list instead, same
    // as Discretionary-funded Boons already are.
    advancementPurchases: { Attributes: {}, Skills: {}, Resources: {}, Gifts: {} },
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

export function mergeCharacterState(data, loaded) {
  const fresh = createInitialState(data);
  const merged = { ...fresh, ...loaded };
  CATALOG_DICT_FIELDS.forEach((field) => {
    merged[field] = { ...fresh[field], ...(loaded[field] || {}) };
  });
  return merged;
}

// ---- Pools ----

export function attributePointsSpent(state, data) {
  let spent = 0;
  data.attributes.forEach((a) => {
    spent += state.attributes[a.name] - data.attributeFloor;
  });
  return spent;
}

export function attributePoolRemaining(state, data) {
  const total = data.attributePoolTotal + state.discretionaryExtra.Attributes;
  return total - attributePointsSpent(state, data);
}

// Each raised Attribute generates a sub-stat pool equal to its own rating,
// split between its two sub-stats however the player likes.
export function subStatPoolRemaining(state, data, attributeName) {
  const attr = data.attributes.find((a) => a.name === attributeName);
  const [subA, subB] = attr.splitsInto;
  const spent = state.subStats[subA] + state.subStats[subB];
  return state.attributes[attributeName] - spent;
}

export function skillPointCost(data, tier, baselineTier) {
  return Math.max(0, (tier - baselineTier) * data.skillTierPointCost);
}

export function skillsPointsSpent(state, data) {
  let spent = 0;
  data.skillCatalog.forEach((s) => {
    const baseline = data.everymanSkills.includes(s.name) ? 2 : 0;
    spent += skillPointCost(data, state.skills[s.name], baseline);
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
  const total = data.skillsPoolTotal + state.discretionaryExtra.Skills;
  return total - skillsPointsSpent(state, data);
}

export function boonsPointsSpent(state) {
  return state.boons.reduce((sum, b) => sum + b.points, 0);
}

export function boonsPoolRemaining(state, data) {
  const total = data.boonsPoolTotal + state.discretionaryExtra.Boons;
  return total - boonsPointsSpent(state);
}

export function resourcesPointsSpent(state, data) {
  let spent = 0;
  data.resources.forEach((r) => {
    spent += state.resources[r.name] * data.resourceLevelCost;
  });
  return spent;
}

export function resourcesPoolRemaining(state, data) {
  const total = data.resourcesPoolTotal + state.discretionaryExtra.Resources;
  return total - resourcesPointsSpent(state, data);
}

// ---- Resource Checks (see resources.md#pushing-a-resource) ----
// A failed check drops a Resource's *effective* Level by 1 (floored at 1)
// until the app's user manually clears it once a Month has passed in
// fiction - there's no in-game calendar here to auto-expire it against.
// "Reaching beyond your means" is a separate, harsher penalty - it zeroes
// the Resource out entirely (not floored at 1), tracked in its own
// resourceZeroed map so the normal floor-at-1 logic below doesn't blunt
// it. Both penalties are tracked separately from the purchased Level
// itself so point-cost accounting (resourcesPointsSpent above) is never
// affected.

export function effectiveResourceLevel(state, resourceName) {
  if (state.resourceZeroed[resourceName]) return 0;
  const level = state.resources[resourceName] ?? 0;
  const penalty = state.resourcePenalties[resourceName] ?? 0;
  return Math.max(Math.min(level, 1), level - penalty);
}

export function applyResourceCheckFailure(state, resourceName) {
  const level = state.resources[resourceName] ?? 0;
  const current = state.resourcePenalties[resourceName] ?? 0;
  state.resourcePenalties[resourceName] = Math.min(Math.max(level - 1, 0), current + 1);
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
// math (via currentCreationWealth's own floor of 1, below) and the Everyman
// Gear Package picker's eligibility (weapons.md#everyman-gear-packages,
// which needs the real unfloored 0 to gate Level 0 exclusively) read the
// same starting number.
export function creationWealthBase(state) {
  if (state.flaws.some((f) => f.name === 'Destitute')) return 0;
  return state.resources.Wealth > 0 ? state.resources.Wealth : 2;
}

export function currentCreationWealth(state) {
  return Math.max(1, creationWealthBase(state) - state.creationWealthLoss);
}

export function setEverymanGearPackage(state, pkg) {
  state.everymanGearPackage = pkg;
}

function nextGearPurchaseId(state) {
  return state.gearPurchases.reduce((max, p) => Math.max(max, p.id), 0) + 1;
}

export function addGearPurchase(state, { category, name, wealth, loss = 0 }) {
  const id = nextGearPurchaseId(state);
  state.gearPurchases.push({ id, category, name, wealth, loss });
  state.creationWealthLoss += loss;
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

export function giftsPointsSpent(state, data) {
  return state.gifts.reduce((sum, g) => sum + giftPointsSpent(g, data), 0);
}

export function giftsPoolRemaining(state, data) {
  const total = data.giftsPoolTotal + giftsDiscretionaryContribution(state, data);
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

export function giftMenuSpent(gift) {
  return (gift.buildPurchases ?? []).reduce((sum, p) => sum + p.cost, 0);
}

export function giftMenuRemaining(gift, giftData) {
  return giftMenuPool(gift, giftData) - giftMenuSpent(gift);
}

function nextBuildPurchaseId(gift) {
  return (gift.buildPurchases ?? []).reduce((max, p) => Math.max(max, p.id), 0) + 1;
}

export function addGiftMenuPurchase(state, giftName, { option, cost, note = '' }) {
  const g = state.gifts.find((x) => x.name === giftName);
  const id = nextBuildPurchaseId(g);
  (g.buildPurchases ??= []).push({ id, option, cost, note });
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
export function buyDiscretionaryGiftAdder(state, giftName, adderName) {
  const g = state.gifts.find((x) => x.name === giftName);
  if (g && !g.adders.includes(adderName)) g.adders.push(adderName);
  const list = (state.discretionaryPurchases.GiftAdders[giftName] ??= []);
  list.push(adderName);
}

export function refundDiscretionaryGiftAdder(state, giftName, adderName) {
  const list = state.discretionaryPurchases.GiftAdders[giftName] ?? [];
  const idx = list.lastIndexOf(adderName);
  if (idx === -1) return;
  list.splice(idx, 1);
  const g = state.gifts.find((x) => x.name === giftName);
  if (g) g.adders = g.adders.filter((a) => a !== adderName);
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

export function addBoon(state, name, cost, source) {
  state.boons.push({ name, points: cost.points, tier: cost.tier, source });
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

// Every Flaw in flaws.md is Leveled; points granted equal the level taken.
export function flawsPointsGranted(state) {
  return state.flaws.reduce((sum, f) => sum + f.level, 0);
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
  return Math.max(0, giftsPoolRemaining(state, data));
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
    if (target === 'Gifts') return; // computed separately, see giftsDiscretionaryContribution
    spent += extra * (data.discretionaryRates[target] ?? 0);
  });
  spent += giftsDiscretionaryContribution(state, data) * (data.discretionaryRates.Gifts ?? 0);
  return spent;
}

export function discretionaryRemaining(state, data) {
  return discretionaryTotal(state, data) - discretionaryPointsSpent(state, data);
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
  const ki =
    ((s.Soak + s.Initiative + s.Ferocity + s.Stamina + s.Atropos) / 5) * 2;
  return {
    'Health Levels': 5 + s.Health,
    Poise: 5 + s.Presence,
    Sanity: 5 + s.Psyche,
    Defense: 10 - s.Atropos,
    'Movement Rate': 5 + state.attributes.Air,
    'Carrying Capacity': Math.pow(s.Potence, 2) * 10,
    Ki: Math.ceil(ki),
  };
}

// Gift Check target number: current Ki + Stamina (see rules/gifts.md#resolution).
export function giftCheckTarget(state) {
  return computeFiguredCharacteristics(state).Ki + state.subStats.Stamina;
}

export function startingFateTokens(state, data) {
  return data.startingFateTokens + state.discretionaryExtra['Fate Tokens'];
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
}

export function healthStatus(current, healthSubStat) {
  if (current > 0) return null;
  // "At 0 Health Levels, a character falls unconscious" is unconditional -
  // death requires actually going negative, not just reaching the death
  // formula's threshold. Without the `current < 0` check, a character with
  // Health sub-stat 0 (death threshold ≤ -0, i.e. ≤ 0) would show Dead the
  // instant they hit 0, skipping Unconscious entirely.
  return current < 0 && current <= -healthSubStat ? 'Dead' : 'Unconscious';
}

export function poiseStatus(current) {
  if (current < 0) return 'Humiliated';
  return current === 0 ? 'Flustered' : null;
}

export function sanityStatus(current) {
  if (current < 0) return 'Shattered';
  return current === 0 ? 'Overwhelmed' : null;
}

// Short Rest and Full Night's Rest recovery (see rules.md#health-level-recovery,
// #sanity, #ki). Health, Sanity, and Poise share the same below-0 exception,
// confirmed 2026-08-14 (Health/Sanity) and extended to Poise 2026-08-20: any
// rest, Short or Full, only recovers 1 Level and caps at 0 - never the normal
// partial rate, never a full heal, while already below 0.
//
// A Short Rest always recovers at least 1, even at 0 in the governing
// sub-stat (Math.ceil(0 / 2) would otherwise be 0, healing nothing) -
// confirmed 2026-08-24, applies above 0 only; the below-0 case already
// always recovers exactly 1.
function restLevel(current, max, subStatValue, isFullRest) {
  if (current < 0) {
    return Math.min(0, current + 1);
  }
  if (isFullRest) return max;
  return Math.min(max, current + Math.max(1, Math.ceil(subStatValue / 2)));
}

export function applyRest(state, isFullRest) {
  const figured = computeFiguredCharacteristics(state);
  const s = state.subStats;
  state.currentHealth = restLevel(state.currentHealth, figured['Health Levels'], s.Health, isFullRest);
  state.currentSanity = restLevel(state.currentSanity, figured.Sanity, s.Psyche, isFullRest);
  state.currentPoise = restLevel(state.currentPoise, figured.Poise, s.Presence, isFullRest);
  state.currentKi = isFullRest
    ? figured.Ki
    : Math.min(figured.Ki, state.currentKi + Math.max(1, Math.ceil(s.Klotho / 2)));
}

// ---- Advancement (post-creation XP spend, see docs/advancement-reference.html) ----
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
    total += sumTopN(state.skills[name], count, (tier) => tier * data.advancement.skillTierXpMultiplier);
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
  const totalLevels = Object.values(state.advancementPurchases.Resources).reduce((a, b) => a + b, 0);
  return totalLevels * data.advancement.resourceXpPerLevel;
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
export function buyAdvancementGiftAdder(state, giftName, adderName) {
  const g = getOrCreateGift(state, giftName);
  if (!g.adders.includes(adderName)) g.adders.push(adderName);
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
  if (g) g.adders = g.adders.filter((a) => a !== adderName);
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

// Limiter buy-off (see docs/advancement-reference.html#limiters): 3 × the
// Gift's current Level XP, per Limiter, priced at the moment it's removed.
// Unlike Gift Levels/Adders, a bought-off Limiter can't be recomputed live
// from a stored count (its price depends on the Level at removal time, which
// may keep changing afterward), so the XP actually paid is stored on the
// purchase record itself and summed directly, same as a Boon's own points
// are captured at purchase.
export function buyoffAdvancementLimiter(state, data, giftName, limiterName) {
  const g = state.gifts.find((x) => x.name === giftName);
  if (!g || !g.limiters.includes(limiterName)) return;
  const xpPaid = g.level * data.advancement.giftLimiterBuyoffXpMultiplier;
  g.limiters = g.limiters.filter((l) => l !== limiterName);
  if (!state.advancementPurchases.LimiterBuyoffs) state.advancementPurchases.LimiterBuyoffs = {};
  const list = (state.advancementPurchases.LimiterBuyoffs[giftName] ??= []);
  list.push({ limiterName, xpPaid });
}

export function refundAdvancementLimiterBuyoff(state, giftName, limiterName) {
  const list = state.advancementPurchases.LimiterBuyoffs?.[giftName] ?? [];
  const idx = list.findIndex((entry) => entry.limiterName === limiterName);
  if (idx === -1) return;
  list.splice(idx, 1);
  const g = state.gifts.find((x) => x.name === giftName);
  if (g && !g.limiters.includes(limiterName)) g.limiters.push(limiterName);
}

function limiterBuyoffsAdvancementXpSpent(state) {
  let total = 0;
  Object.values(state.advancementPurchases.LimiterBuyoffs ?? {}).forEach((entries) => {
    entries.forEach((entry) => (total += entry.xpPaid));
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

export function xpSpent(state, data) {
  return (
    attributesAdvancementXpSpent(state, data) +
    skillsAdvancementXpSpent(state, data) +
    resourcesAdvancementXpSpent(state, data) +
    giftsLevelAdvancementXpSpent(state, data) +
    giftAddersAdvancementXpSpent(state, data) +
    limiterBuyoffsAdvancementXpSpent(state) +
    boonsAdvancementXpSpent(state, data)
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
