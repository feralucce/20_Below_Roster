// The core roll engine (see rules.md#core-mechanic and skills.md#training-tiers).
// Pure logic, no DOM - built and tested standalone before any Roller UI exists.

export function rollD10() {
  return 1 + Math.floor(Math.random() * 10);
}

// Advantage: roll 3d10, keep the lowest two (summed). Disadvantage: roll
// 3d10, keep the highest two. Roll-under, so lower is always better either
// way - this only changes which two of the three get kept.
export function rollAdvantage() {
  const dice = [rollD10(), rollD10(), rollD10()];
  const kept = [...dice].sort((a, b) => a - b).slice(0, 2);
  return { dice, kept, sum: kept[0] + kept[1] };
}

export function rollDisadvantage() {
  const dice = [rollD10(), rollD10(), rollD10()];
  const kept = [...dice].sort((a, b) => a - b).slice(1, 3);
  return { dice, kept, sum: kept[0] + kept[1] };
}

export function rollPlain() {
  const dice = [rollD10(), rollD10()];
  return { dice, kept: dice, sum: dice[0] + dice[1] };
}

// Advantage/Disadvantage are each binary - multiple sources of the same
// one don't compound. Opposing sources cancel 1-for-1; whichever side has
// leftover sources after canceling is what applies. Equal sources cancel
// out entirely to a normal roll. See rules.md#advantage--disadvantage.
export function resolveAdvantageState(advantageSources, disadvantageSources) {
  const net = advantageSources - disadvantageSources;
  if (net > 0) return 'advantage';
  if (net < 0) return 'disadvantage';
  return 'normal';
}

// Skill Training Tiers, see skills.md#training-tiers. Tier 0 (Untrained)
// doesn't add the Attribute to the target number at all - see
// rules.md#untrained-rolls.
export const SKILL_TIERS = {
  0: { name: 'Untrained', usesAttribute: false, grantsAdvantage: false, widenCrit: false, masterReroll: false },
  1: { name: 'Novice', usesAttribute: true, grantsAdvantage: 'disadvantage', widenCrit: false, masterReroll: false },
  2: { name: 'Trained', usesAttribute: true, grantsAdvantage: false, widenCrit: false, masterReroll: false },
  3: { name: 'Adept', usesAttribute: true, grantsAdvantage: 'advantage', widenCrit: false, masterReroll: false },
  4: { name: 'Expert', usesAttribute: true, grantsAdvantage: 'advantage', widenCrit: true, masterReroll: false },
  5: { name: 'Master', usesAttribute: true, grantsAdvantage: 'advantage', widenCrit: true, masterReroll: true },
};

function rollByMode(mode) {
  if (mode === 'advantage') return rollAdvantage();
  if (mode === 'disadvantage') return rollDisadvantage();
  return rollPlain();
}

// Critical results apply "regardless of target number" - even a critical
// success on an unreachable target counts as success, and vice versa for
// critical failure. Expert/Master widen critical success to a roll of 2 or
// 3; critical failure is always exactly a roll of 20 (uniquely (10,10) on
// two dice), never widened. See rules.md#difficulty-chart.
export function classifyRoll(sum, target, widenCrit) {
  const critSuccessMax = widenCrit ? 3 : 2;
  if (sum <= critSuccessMax) return 'critical-success';
  if (sum === 20) return 'critical-failure';
  return sum <= target ? 'success' : 'failure';
}

// Lucky Number (rules.md#klotho): whenever the result of one of the
// character's own core rolls (this 2d10, or an Advantage/Disadvantage
// 3d10) equals their Klotho rating, they gain 1 Fate Token, automatic,
// never more than once per roll. It's the roll's own result (the kept
// two dice here) that has to match, not any individual die - and this
// check only applies to core Skill rolls, never damage dice pools.
function checkLuckyNumber(sum, klotho) {
  return klotho != null && sum === klotho;
}

// `extraAdvantage`/`extraDisadvantage`: sources beyond the Skill Tier's own
// (e.g. off-hand Disadvantage, a Gift's Advantage), combined via the same
// binary stacking rule as the Tier's own grant.
export function performCoreRoll({ attribute, difficulty, skillTier, extraAdvantage = 0, extraDisadvantage = 0, klotho = null }) {
  const tier = SKILL_TIERS[skillTier];
  if (!tier) throw new Error(`Unknown Skill Tier: ${skillTier}`);

  const target = tier.usesAttribute ? attribute + difficulty : difficulty;

  const advantageSources = extraAdvantage + (tier.grantsAdvantage === 'advantage' ? 1 : 0);
  const disadvantageSources = extraDisadvantage + (tier.grantsAdvantage === 'disadvantage' ? 1 : 0);
  const mode = resolveAdvantageState(advantageSources, disadvantageSources);

  let roll = rollByMode(mode);
  let outcome = classifyRoll(roll.sum, target, tier.widenCrit);
  const luckyNumber = checkLuckyNumber(roll.sum, klotho);
  let reroll = null;

  if (outcome === 'critical-failure' && tier.masterReroll) {
    reroll = rollByMode(mode);
    const rerollOutcome = classifyRoll(reroll.sum, target, tier.widenCrit);
    // "if the second roll succeeds, it's treated as a normal failure" -
    // Master's reroll only ever strips the "critical" severity, never
    // turns a critical failure into any kind of success.
    if (rerollOutcome === 'success' || rerollOutcome === 'critical-success') {
      outcome = 'failure';
    }
    // if the reroll also fails (critically or not), the original critical
    // failure stands - outcome is left unchanged.
  }

  return { target, mode, tierName: tier.name, roll, reroll, outcome, luckyNumber };
}
