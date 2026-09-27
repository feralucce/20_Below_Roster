// Pushing a Resource (see resources.md#pushing-a-resource): 2d10 against
// Resource Level + (10 - Resource Index), roll-under. Resource Index is a
// flat 1-6 scale, inverted the same way Defense is (a lower Index is
// easier, a higher one harder, RI 6 adding only 4 - the minimum). Unlike
// the Gift Check, this uses the ordinary critical success/failure rule (no
// Skill Tier involved, so never widened) - a character always gets what
// they were after either way; the roll only decides the cost: nothing on
// a success, one Level on a failure, two on a critical failure. Those
// drops stack, and a Resource walked down to 0 is spent for the Month.
//
// "Reaching beyond your means": an RI up to 2 higher than the Resource's
// current effective Level can be attempted (anything further is simply
// not reachable, handled by the caller disabling those options) - doing
// so always drops the Resource to 0 for a Month regardless of success or
// failure, unless the roll is a critical success, which resolves as an
// ordinary free success instead. RI 6 is always treated as reaching 2
// levels beyond the Resource's current Level no matter what that Level
// actually is, and is never saved by a critical success - it always
// zeroes the Resource out.

import { rollPlain, classifyRoll } from './core.js';

export function performResourceCheck({ resourceLevel, resourceIndex }) {
  const target = resourceLevel + (10 - resourceIndex);
  const roll = rollPlain();
  const outcome = classifyRoll(roll.sum, target, false);
  const critSuccess = outcome === 'critical-success';

  const gap = resourceIndex - resourceLevel;
  const beyondMeans = resourceIndex === 6 || gap >= 1;

  let resourceReduced = false;
  let resourceZeroed = false;
  let levelsLost = 0;

  if (beyondMeans) {
    if (resourceIndex === 6) {
      resourceZeroed = true;
    } else if (!critSuccess) {
      resourceZeroed = true;
    }
  } else if (outcome === 'catastrophic-failure') {
    levelsLost = 2;
    resourceReduced = true;
  } else if (outcome === 'failure') {
    levelsLost = 1;
    resourceReduced = true;
  }

  return {
    target, roll, outcome, resourceReduced, resourceZeroed, levelsLost,
    beyondMeans, gap,
  };
}
