import { el } from '../ui.js';
import {
  performCoreRoll, SKILL_TIERS, rollThreeWays, classifyRoll, rollD10,
  rollPlain, rollAdvantage, rollDisadvantage, resolveAdvantageState,
} from '../roller/core.js';
import { performGiftCheck } from '../roller/giftCheck.js';
import { performResourceCheck } from '../roller/resourceCheck.js';
import { rollDamagePool, applyBoosts, worthBoosting } from '../roller/damage.js';
import {
  skillTierName,
  effectiveResourceLevel,
  applyResourceCheckFailure,
  applyResourceCheckZeroOut,
  clearResourcePenalty,
  elementCritSteps,
  fateTokenCap,
  jackOfAllTrades,
  skillTierWithJack,
} from '../state.js';

// Physical/Social/Mental each pair a wall stat (what the target's dice are
// checked against), the attacker's own matching Ki Infusion boost sub-stat,
// and which of the character's own trackers absorbs a connecting die - see
// rules.md#the-passive-wall-triad---soak-presence-psyche and #ki-infusion.
const ATTACK_TYPES = {
  Physical: { wallStat: 'Soak', boostStat: 'Ferocity', track: 'health' },
  Social: { wallStat: 'Presence', boostStat: 'Presence', track: 'poise' },
  Mental: { wallStat: 'Psyche', boostStat: 'Psyche', track: 'sanity' },
};

const UNTRAINED_VALUE = '__untrained__';

// Exhausted (rules.md): 1 is Disadvantage on Physical rolls, 2 and up on
// every roll. A roller starts with the box already ticked when Exhausted
// calls for it, and says so - the player can still untick it, because
// the table may know something the sheet does not.
function exhaustedLevel(state) {
  return Number(state.exhausted) || 0;
}

function exhaustionNote(state, physical) {
  const level = exhaustedLevel(state);
  if (!level) return null;
  let text;
  if (level >= 2) text = `Exhausted ${level}: Disadvantage on every roll, already ticked below.`;
  else if (physical) text = 'Exhausted 1: Disadvantage on Physical rolls, already ticked below.';
  else text = 'Exhausted 1: Disadvantage if this is a Physical roll - tick it below if it is.';
  return el('p', { class: 'hint roller-exhausted' }, text);
}

// Every Ki spend costs 1 more at Exhausted 4.
function kiSpendCost(state) {
  return exhaustedLevel(state) >= 4 ? 2 : 1;
}

function toggleBox(label, checked, onClick) {
  return el('div', { class: 'toggle-box', onClick }, [
    el('div', { class: checked ? 'pip' : 'pip pip-empty', style: '--pip-color:var(--accent)' }),
    el('span', {}, label),
  ]);
}

function outcomeLabel(outcome) {
  return {
    'critical-success': 'Critical Success',
    success: 'Success',
    failure: 'Failure',
    'catastrophic-failure': 'Catastrophic Failure',
  }[outcome];
}

function outcomeClass(outcome) {
  return outcome === 'critical-success' || outcome === 'success' ? 'status-ok' : 'status-bad';
}

function diceSummary(rollResult) {
  const { dice, kept } = rollResult;
  if (dice.length === kept.length) {
    return `Rolled ${dice.join(', ')} → ${kept[0] + kept[1]}`;
  }
  return `Rolled ${dice.join(', ')} → kept ${kept.join(', ')} = ${kept[0] + kept[1]}`;
}

// Skill Roll - the character sheet's Skills tab embeds this directly (see
// tab.interactive wiring in 13-sheet.js). Only Skills the character is
// actually Trained in (tier > 0) populate the dropdown, plus "Untrained" at
// the top - a from-scratch roll against an unpurchased Skill is already
// covered by that Untrained option, so listing every unpurchased Skill by
// name too would just be a long wall of redundant Untrained entries.
// Each section opens with the one sentence somebody needs to act on it.
// The rules are elsewhere and at length; this is the caption on the form
// in front of them, not a rules summary.
function howTo(text) {
  return el('p', { class: 'roller-howto' }, text);
}

export function buildSkillRollSection(state, data, refreshHeader = () => {}, preselect = null) {
  const section = el('div', { class: 'roller-gift-check' });
  const resultEl = el('div', { class: 'roller-result' });

  // A Skill rolls against its own Default Element unless the player
  // challenges it (rules.md#sub-stat-descriptors, skills.md#skills-default-to-an-element)
  // - picking the Skill sets the radio group to that default, but the group
  // stays a free choice underneath so a challenge is just picking a
  // different Attribute before rolling.
  function defaultElementFor(skillName) {
    if (skillName === UNTRAINED_VALUE) return data.attributes[0].name;
    const skill = data.skillCatalog.find((s) => s.name === skillName);
    const el = skill?.defaultElement;
    return el && el !== 'Context-dependent' ? el : data.attributes[0].name;
  }

  // The paged sheet opens this panel by clicking a Skill row, so it can
  // name the Skill it wants already chosen.
  let selectedSkill = preselect && state.skills[preselect] > 0 ? preselect : UNTRAINED_VALUE;
  let selectedAttribute = defaultElementFor(selectedSkill);
  let selectedDifficulty = 5;
  let advantageOn = false;
  // A Skill can be Physical or not, and the sheet cannot tell which, so
  // Exhausted 1 only reminds here; 2 and up is every roll.
  let disadvantageOn = exhaustedLevel(state) >= 2;
  // Jack of all Trades (boons.md) applies by itself, read off the
  // character: every Skill rolls at least Trained, and the 5-point tier
  // holds every Skill at Trained.
  const joat = jackOfAllTrades(state);

  const skillSelect = el(
    'select',
    {
      onChange: (e) => {
        selectedSkill = e.target.value;
        selectedAttribute = defaultElementFor(selectedSkill);
        renderAttributeGroup();
        renderAttributeVisibility();
        renderTierGrantNote();
      },
    },
    [
      el('option', { value: UNTRAINED_VALUE }, joat
        ? 'Any other Skill - Trained (Jack of all Trades)' : 'No Skill (Untrained)'),
      ...data.skillCatalog
        .filter((s) => state.skills[s.name] > 0)
        .map((s) => el('option', {
          value: s.name,
          selected: s.name === selectedSkill ? '' : undefined,
        }, `${s.name} - ${skillTierName(data, skillTierWithJack(state, state.skills[s.name]))}`)),
    ],
  );

  const attributeNote = el('p', { class: 'roller-tier-note' });
  function renderAttributeNote() {
    const defaultEl = defaultElementFor(selectedSkill);
    attributeNote.textContent =
      selectedAttribute === defaultEl
        ? `Using ${defaultEl}, this Skill's default. Use your Descriptors to argue a different Element.`
        : `Using ${selectedAttribute} instead of ${defaultEl} - argued with one of your Descriptors.`;
  }

  const attributeGroup = el('div', { class: 'attribute-radio-group' });
  function renderAttributeGroup() {
    attributeGroup.innerHTML = '';
    const defaultEl = defaultElementFor(selectedSkill);
    data.attributes.forEach((a) => {
      const id = `roller-attr-${a.name}`;
      attributeGroup.append(
        el('label', { class: 'attribute-radio', for: id }, [
          el('input', {
            type: 'radio',
            id,
            name: 'roller-attribute',
            value: a.name,
            checked: selectedAttribute === a.name ? '' : undefined,
            onChange: () => {
              selectedAttribute = a.name;
              renderAttributeNote();
            },
          }),
          ` ${a.name} (${state.attributes[a.name]})${a.name === defaultEl ? ' - default' : ''}`,
        ]),
      );
    });
    renderAttributeNote();
  }
  renderAttributeGroup();

  function currentTier() {
    const purchasedTier = selectedSkill === UNTRAINED_VALUE ? 0 : state.skills[selectedSkill];
    return skillTierWithJack(state, purchasedTier);
  }

  function renderAttributeVisibility() {
    const visible = currentTier() !== 0;
    attributeGroup.style.display = visible ? 'flex' : 'none';
    attributeNote.style.display = visible ? '' : 'none';
  }
  renderAttributeVisibility();

  const joatNote = joat
    ? el('p', { class: 'roller-tier-note' }, joat.capped
      ? 'Jack of all Trades: every Skill rolls at Trained.'
      : 'Jack of all Trades: every Skill rolls at least at Trained.')
    : null;

  // The effective Tier can already grant Advantage (Adept, Expert,
  // Master) before either toggle box is touched - the toggles are an *additional* source that stacks with the
  // Tier's own grant via the binary cancellation rule
  // (rules.md#advantage--disadvantage), not a direct override. This note
  // makes that visible so a toggle that seems to "do nothing" (because it
  // canceled the Tier's own grant back to Normal) isn't mistaken for a bug.
  const tierGrantNote = el('p', { class: 'roller-tier-note' });
  function renderTierGrantNote() {
    const grant = SKILL_TIERS[currentTier()].grantsAdvantage;
    tierGrantNote.textContent = grant
      ? `${SKILL_TIERS[currentTier()].name} already grants ${grant === 'advantage' ? 'Advantage' : 'Disadvantage'} from its Tier - checking the opposite box below cancels it back to Normal, it doesn't reverse it.`
      : '';
  }
  renderTierGrantNote();

  const difficultySelect = el(
    'select',
    {
      onChange: (e) => {
        selectedDifficulty = Number(e.target.value);
      },
    },
    data.difficultyChart.map((d) =>
      el(
        'option',
        { value: d.difficulty, selected: d.difficulty === selectedDifficulty ? '' : undefined },
        `${d.difficulty} - ${d.label}`,
      ),
    ),
  );

  // Advantage/Disadvantage are mutually exclusive click-toggle boxes (same
  // interaction as the sheet header's Vitals pips) - clicking
  // one on forces the other off. Rebuilt whole on every toggle rather than
  // diffed in place, simplest way to keep each box's pip class in sync.
  const togglesRow = el('div', { class: 'roller-toggles' });
  function renderToggles() {
    togglesRow.innerHTML = '';
    togglesRow.append(
      toggleBox('Advantage', advantageOn, () => {
        advantageOn = !advantageOn;
        if (advantageOn) disadvantageOn = false;
        renderToggles();
      }),
      toggleBox('Disadvantage', disadvantageOn, () => {
        disadvantageOn = !disadvantageOn;
        if (disadvantageOn) advantageOn = false;
        renderToggles();
      }),
    );
  }
  renderToggles();

  const rollBtn = el('button', {
    type: 'button',
    class: 'roll-btn',
    text: 'Roll',
    onClick: () => {
      const tier = currentTier();
      const attributeValue = tier === 0 ? 0 : state.attributes[selectedAttribute];
      const result = performCoreRoll({
        attribute: attributeValue,
        difficulty: selectedDifficulty,
        skillTier: tier,
        extraAdvantage: advantageOn ? 1 : 0,
        extraDisadvantage: disadvantageOn ? 1 : 0,
        klotho: state.subStats.Klotho,
        attributeRollCap: data.attributeRollCap,
        critSteps: elementCritSteps(state, data, selectedAttribute),
      });

      if (result.luckyNumber) {
        // A Token earned at the holding cap is lost, not banked
        // (rules/fate.md#holding-fate-tokens).
        state.currentFateTokens = Math.min(fateTokenCap(state, data), state.currentFateTokens + 1);
        refreshHeader();
      }

      renderResult(result);
    },
  });

  function renderResult(result) {
    resultEl.innerHTML = '';
    const skillLabel = selectedSkill === UNTRAINED_VALUE ? 'Untrained' : `${selectedSkill} (${result.tierName})`;
    resultEl.append(
      ...[
        el('p', {}, [
          el('strong', {}, `${skillLabel} vs target ${result.target}`),
          result.mode !== 'normal' ? ` (${result.mode === 'advantage' ? 'Advantage' : 'Disadvantage'})` : '',
        ]),
        el('p', {}, diceSummary(result.roll)),
        el('p', { class: outcomeClass(result.outcome) }, [el('strong', {}, outcomeLabel(result.outcome))]),
        result.reroll ? el('p', {}, `Master's reroll: ${diceSummary(result.reroll)}`) : null,
        result.luckyNumber ? el('p', { class: 'status-ok' }, 'Lucky Number! +1 Fate Token.') : null,
      ].filter((n) => n != null),
    );
  }

  section.append(
    el('h4', {}, 'Skill Roll'),
    howTo('Pick the Skill, the Element you are doing it through, and how hard '
      + 'the GM says it is. You want 2d10 under that total.'),
    el('div', { class: 'roller-row' }, [el('label', {}, 'Skill'), skillSelect]),
    attributeGroup,
    attributeNote,
    ...(joatNote ? [joatNote] : []),
    el('div', { class: 'roller-row' }, [el('label', {}, 'Difficulty'), difficultySelect]),
    tierGrantNote,
    exhaustionNote(state, false),
    togglesRow,
    rollBtn,
    resultEl,
  );

  return section;
}

// Pushing a Resource (resources.md#pushing-a-resource): 2d10 against
// Resource Level + (10 - Resource Index), ordinary critical success/
// failure rule, no Skill involved. A normal-range check never denies the
// ask - it only drops the Resource's effective Level (state.
// resourcePenalties) until manually cleared, since the app has no
// in-game calendar to auto-expire "a Month" against. Reaching beyond your
// means (Resource Index up to 2 higher than the current effective Level,
// or Index 6 always) zeroes the Resource out instead (state.
// resourceZeroed), unless the roll is a critical success - except Index 6
// itself, which is never saved by a crit.
export function buildResourceCheckSection(state, data, preselect = null) {
  const section = el('div', { class: 'roller-gift-check' });

  // Only the Resources the rules say can be pushed. The rest are a
  // standing fact - their Level table says what you have, and there
  // is nothing to roll about it.
  const ownedResources = data.resources.filter(
    (r) => state.resources[r.name] > 0 && r.pushable,
  );
  let selectedResource = ownedResources.some((r) => r.name === preselect)
    ? preselect
    : (ownedResources[0]?.name ?? null);
  let selectedResourceIndex = 3;

  const resourceSelect = el(
    'select',
    {
      onChange: (e) => {
        selectedResource = e.target.value;
        renderSummary();
        renderResourceIndexOptions();
      },
    },
    ownedResources.map((r) =>
      el('option', {
        value: r.name,
        selected: r.name === selectedResource ? '' : undefined,
      }, `${r.name} (Level ${state.resources[r.name]})`),
    ),
  );

  // Resource Index is a flat 1-6 scale, its own thing rather than the
  // general Difficulty Chart - bare numbers only, no descriptive labels.
  // An Index more than 2 above the Resource's current effective Level is
  // simply out of reach and disabled, except Index 6, which is always
  // attemptable (resources.md: "always treated as reaching 2 levels
  // beyond the Resource's current Level, no matter how high that Level
  // actually is").
  const resourceIndexSelect = el('select', {
    onChange: (e) => {
      selectedResourceIndex = Number(e.target.value);
    },
  });
  // What the Index is called depends on what is being pushed. Every item
  // now carries a Wealth rating, so a Wealth push does not need the GM to
  // invent a number - the rating is the number. Nothing else has items,
  // so a Contacts or Fame push keeps the general term.
  const indexLabelEl = el('label', {}, 'Resource Index');

  function renderResourceIndexOptions() {
    indexLabelEl.textContent = selectedResource === 'Wealth'
      ? 'Item Wealth Rating'
      : 'Resource Index';
    const effective = selectedResource ? effectiveResourceLevel(state, selectedResource) : 0;
    resourceIndexSelect.innerHTML = '';
    for (let ri = 1; ri <= 6; ri++) {
      const reachable = ri === 6 || ri - effective <= 2;
      resourceIndexSelect.append(
        el(
          'option',
          {
            value: ri,
            selected: ri === selectedResourceIndex ? '' : undefined,
            disabled: reachable ? undefined : '',
          },
          `${ri}`,
        ),
      );
    }
  }
  renderResourceIndexOptions();

  const summaryEl = el('p', {});
  const clearBtn = el('button', {
    type: 'button',
    text: 'Clear penalty (a Month has passed)',
    onClick: () => {
      clearResourcePenalty(state, selectedResource);
      renderSummary();
      renderResourceIndexOptions();
    },
  });

  function renderSummary() {
    if (!selectedResource) {
      summaryEl.textContent = 'No Resources owned yet.';
      clearBtn.disabled = true;
      return;
    }
    const effective = effectiveResourceLevel(state, selectedResource);
    const zeroed = state.resourceZeroed[selectedResource];
    const penalty = state.resourcePenalties[selectedResource] ?? 0;
    summaryEl.textContent = effective <= 0
      ? `Effective Level 0 - spent until the next Month. Nothing left to push.`
      : penalty
        ? `Effective Level ${effective} (reduced from ${state.resources[selectedResource]} by a prior failure).`
        : `Current Level ${effective}.`;
    clearBtn.disabled = !zeroed && !penalty;
  }
  renderSummary();

  const resultEl = el('div', { class: 'roller-result' });

  const rollBtn = el('button', {
    type: 'button',
    class: 'roll-btn',
    text: 'Roll Resource Check',
    disabled: selectedResource ? undefined : '',
    onClick: () => {
      const resourceLevel = effectiveResourceLevel(state, selectedResource);
      // A Resource already at 0 for the Month has nothing left to draw on.
      // Rolling anyway treated every Index as reaching beyond its means and
      // zeroed it again, so a spent Resource could be pushed indefinitely.
      if (resourceLevel <= 0) {
        resultEl.innerHTML = '';
        resultEl.append(el('p', { class: 'detail' },
          `${selectedResource} is spent until the next Month - there is nothing to push.`));
        return;
      }
      const result = performResourceCheck({ resourceLevel, resourceIndex: selectedResourceIndex });
      if (result.resourceZeroed) {
        applyResourceCheckZeroOut(state, selectedResource);
      } else if (result.resourceReduced) {
        applyResourceCheckFailure(state, selectedResource, result.levelsLost);
      }
      renderSummary();
      renderResourceIndexOptions();
      resultEl.innerHTML = '';
      const costLine = result.resourceZeroed
        ? `${selectedResource} drops to 0 until a Month passes - reaching that far beyond your means always costs everything${result.outcome === 'critical-success' ? ' (Resource Index 6 isn\'t saved by a critical success)' : ''}.`
        : result.resourceReduced
          ? (() => {
            const now = effectiveResourceLevel(state, selectedResource);
            const cost = result.levelsLost === 2 ? 'two Levels' : 'a Level';
            return now <= 0
              ? `${selectedResource} costs ${cost} and is spent - nothing more can be drawn on it until a Month passes.`
              : `${selectedResource} costs ${cost} and drops to Level ${now} until a Month passes.`;
          })()
          : result.beyondMeans
            ? `Critical success - ${selectedResource} is unaffected even reaching this far beyond your means.`
            : `${selectedResource} is unaffected - you got what you were after.`;
      resultEl.append(
        el('p', {}, `Rolled ${result.roll.dice.join(', ')} → ${result.roll.sum} vs target ${result.target}`),
        el('p', { class: outcomeClass(result.outcome) }, [el('strong', {}, outcomeLabel(result.outcome))]),
        el('p', {}, costLine),
      );
    },
  });

  section.append(
    el('h4', {}, 'Resource Check'),
    howTo('Say what you are asking the Resource for. Asking within its Level is '
      + 'safe; reaching past it can cost you the Resource itself.'),
    el('div', { class: 'roller-row' }, [el('label', {}, 'Resource'), resourceSelect]),
    el('div', { class: 'roller-row' }, [indexLabelEl, resourceIndexSelect]),
    summaryEl,
    el('div', { style: 'display:flex;gap:0.5rem;' }, [rollBtn, clearBtn]),
    resultEl,
  );
  return section;
}

// Attack Roll - the to-hit step (rules.md, Choosing the Attacking Element
// and the three attack sections under it). Three kinds of attack, one
// shape: an Element against the matching Defense to hit, then dice one at
// a time against the matching wall. What changes between them is which
// Elements may carry it, which Defense it rolls against, and where the
// dice come from - a weapon, a Skill's Tier, or a Gift.
//
// Reuses the core roll engine with a fixed Tier of 1 (Trained): that
// Tier's shape is exactly "use the Attribute, no auto Advantage/
// Disadvantage, no crit widening, no Master reroll" - precisely a plain
// Attribute-vs-Difficulty roll with no Skill-Tier modifiers layered on.
const PLAIN_ATTACK_TIER = 1;

const ATTACK_KINDS = {
  Physical: {
    elements: ['Earth', 'Air', 'Fire', 'Water'],
    defense: 'Defense',
  },
  Social: {
    elements: ['Earth', 'Air', 'Fire', 'Water', 'Moira'],
    defense: 'Social Defense',
  },
  Mental: {
    elements: ['Earth', 'Air', 'Fire', 'Water', 'Moira'],
    defense: 'Mental Defense',
  },
};

const KIND_NOTES = {
  Physical: 'A weapon, a fist, a thrown brick. Rolls against Defense; the dice come from the weapon and go against Soak.',
  Social: "Words used as a weapon. Rolls against Social Defense; you roll your Skill's Tier + 1 in dice, against Presence. Moira can carry it.",
  Mental: 'Only a Gift or a creature can make one - there is no ordinary way to push on a mind. Rolls against Mental Defense; the dice come from the Gift and go against Psyche.',
};

// The Skills rules.md names as Social attacks, with Etiquette last: it is
// the GM's call whether naming a broken protocol lands as one.
const SOCIAL_ATTACK_SKILLS = ['Ridicule', 'Intimidation', 'Persuasion', 'Public Speaking',
  'Performance', 'Leadership', 'Deception', 'Insight', 'Etiquette'];

// The steps a player actually takes, in order. Short enough to read at
// the table; the rules have the rest.
function attackSteps() {
  const list = el('ol', { class: 'roller-steps' }, [
    el('li', { html: '<strong>Pick the kind of attack.</strong> Physical hurts the body (Health), Social hurts composure (Poise), Mental hurts the mind (Sanity).' }),
    el('li', { html: '<strong>Say how you do it.</strong> Your approach picks the Element, and the GM confirms it before you roll.' }),
    el('li', { html: "<strong>Set the target's Defense.</strong> The GM tells you the number." }),
    el('li', { html: '<strong>Roll to hit.</strong> 2d10 under your Element plus their Defense.' }),
    el('li', { html: "<strong>If it hits, roll damage below.</strong> Every die over the target's wall costs them one." }),
  ]);
  return el('details', { class: 'roller-help', open: '' }, [el('summary', {}, 'How an attack works'), list]);
}

export function buildAttackRollSection(state, data, refreshHeader, onCritical = () => {},
                                      preselect = null, opts = {}) {
  const { onSetup = () => {}, kind: presetKind = null } = opts;
  const section = el('div', { class: 'roller-gift-check' });

  // The sheet opens this by clicking an Element, so it can say which one
  // is swinging. Moira never carries a Physical attack, so a click on it
  // opens a Social one instead - the kind it can carry.
  let kind = presetKind && ATTACK_KINDS[presetKind] ? presetKind
    : preselect === 'Moira' ? 'Social' : 'Physical';
  let selectedAttribute = ATTACK_KINDS[kind].elements.includes(preselect)
    ? preselect : ATTACK_KINDS[kind].elements[0];
  const socialSkills = SOCIAL_ATTACK_SKILLS.filter((n) => data.skillCatalog.some((s) => s.name === n));
  let socialSkill = socialSkills.find((n) => (state.skills[n] || 0) > 0) || socialSkills[0];
  let selectedDefense = 5;
  let advantageOn = false;
  // Swinging at something is as Physical as a roll gets; a Social or
  // Mental attack only takes Disadvantage from Exhausted 2 up.
  let disadvantageOn = exhaustedLevel(state) >= (kind === 'Physical' ? 1 : 2);

  const skillTier = (name) => Number(state.skills[name]) || 0;
  const socialDice = () => SKILL_TIERS[skillTier(socialSkill)]?.socialDice ?? 1;
  function skillElement(name) {
    const e = data.skillCatalog.find((s) => s.name === name)?.defaultElement;
    return ATTACK_KINDS.Social.elements.includes(e) ? e : 'Fire';
  }
  if (kind === 'Social' && preselect !== 'Moira') selectedAttribute = skillElement(socialSkill);

  // The damage panel below follows whatever is chosen here, so a Social
  // attack arrives there with its type and its dice already set.
  function announce() {
    onSetup({ type: kind, dice: kind === 'Social' ? socialDice() : null });
  }

  const kindRow = el('div', { class: 'attribute-radio-group' });
  const kindNote = el('p', { class: 'hint' });
  const skillRow = el('div', { class: 'roller-row' });
  const attributeGroup = el('div', { class: 'attribute-radio-group' });
  const defenseLabel = el('label', {});

  function renderKind() {
    kindRow.innerHTML = '';
    Object.keys(ATTACK_KINDS).forEach((k) => {
      const id = `atk-kind-${k}`;
      kindRow.append(el('label', { class: 'attribute-radio', for: id }, [
        el('input', {
          type: 'radio', id, name: 'atk-kind', value: k,
          checked: kind === k ? '' : undefined,
          onChange: () => {
            kind = k;
            if (k === 'Social') selectedAttribute = skillElement(socialSkill);
            if (!ATTACK_KINDS[k].elements.includes(selectedAttribute)) selectedAttribute = ATTACK_KINDS[k].elements[0];
            if (exhaustedLevel(state) === 1) disadvantageOn = k === 'Physical';
            // A result from the last kind of attack is not a result for this one.
            toHitResultEl.innerHTML = '';
            renderAll();
            announce();
          },
        }),
        ` ${k}`,
      ]));
    });
    kindNote.textContent = KIND_NOTES[kind];
    defenseLabel.textContent = `Target's ${ATTACK_KINDS[kind].defense}`;
  }

  function renderSkill() {
    skillRow.innerHTML = '';
    skillRow.style.display = kind === 'Social' ? '' : 'none';
    if (kind !== 'Social') return;
    const select = el('select', {
      onChange: (e) => {
        socialSkill = e.target.value;
        selectedAttribute = skillElement(socialSkill);
        renderAll();
        announce();
      },
    }, socialSkills.map((n) => el('option', { value: n, selected: n === socialSkill ? '' : undefined },
      `${n} - ${skillTierName(data, skillTier(n))}, ${SKILL_TIERS[skillTier(n)]?.socialDice ?? 1} dice`)));
    skillRow.append(el('label', {}, 'Skill'), select);
  }

  function renderAttributeGroup() {
    attributeGroup.innerHTML = '';
    ATTACK_KINDS[kind].elements.forEach((name) => {
      const id = `atk-attr-${name}`;
      attributeGroup.append(
        el('label', { class: 'attribute-radio', for: id }, [
          el('input', {
            type: 'radio', id, name: 'atk-attribute', value: name,
            checked: selectedAttribute === name ? '' : undefined,
            onChange: () => { selectedAttribute = name; },
          }),
          ` ${name} (${state.attributes[name]})`,
        ]),
      );
    });
  }

  // Defense runs the same 0-10 scale as the Difficulty Chart (rules.md:
  // "Defense becomes the attacker's Difficulty"), but shown as bare
  // numbers here - a Defense score isn't a GM-picked task difficulty, so
  // the Difficulty Chart's descriptive labels ("Nearly Impossible", etc.)
  // don't apply to what this dropdown means.
  const defenseSelect = el(
    'select',
    { onChange: (e) => { selectedDefense = Number(e.target.value); } },
    data.difficultyChart.map((d) =>
      el('option', { value: d.difficulty, selected: d.difficulty === selectedDefense ? '' : undefined },
        `${d.difficulty}`)),
  );

  const togglesRow = el('div', { class: 'roller-toggles' });
  function renderToggles() {
    togglesRow.innerHTML = '';
    togglesRow.append(
      toggleBox('Advantage', advantageOn, () => {
        advantageOn = !advantageOn;
        if (advantageOn) disadvantageOn = false;
        renderToggles();
      }),
      toggleBox('Disadvantage', disadvantageOn, () => {
        disadvantageOn = !disadvantageOn;
        if (disadvantageOn) advantageOn = false;
        renderToggles();
      }),
    );
  }

  const exhaustHost = el('div', {});
  function renderAll() {
    renderKind();
    renderSkill();
    renderAttributeGroup();
    exhaustHost.innerHTML = '';
    const note = exhaustionNote(state, kind === 'Physical');
    if (note) exhaustHost.append(note);
    renderToggles();
  }
  renderAll();

  const toHitResultEl = el('div', { class: 'roller-result' });
  const rollBtn = el('button', {
    type: 'button',
    class: 'roll-btn',
    text: 'Roll to Hit',
    onClick: () => {
      const info = ATTACK_KINDS[kind];
      const result = performCoreRoll({
        attribute: state.attributes[selectedAttribute],
        difficulty: selectedDefense,
        skillTier: PLAIN_ATTACK_TIER,
        extraAdvantage: advantageOn ? 1 : 0,
        extraDisadvantage: disadvantageOn ? 1 : 0,
        klotho: state.subStats.Klotho,
        attributeRollCap: data.attributeRollCap,
        critSteps: elementCritSteps(state, data, selectedAttribute),
      });

      if (result.luckyNumber) {
        // A Token earned at the holding cap is lost, not banked
        // (rules/fate.md#holding-fate-tokens).
        state.currentFateTokens = Math.min(fateTokenCap(state, data), state.currentFateTokens + 1);
        refreshHeader();
      }

      const hit = result.outcome === 'success' || result.outcome === 'critical-success';
      const crit = result.outcome === 'critical-success';
      // Arm or disarm the damage panel to match this roll, so a critical
      // never has to be remembered and a normal hit never leaves it armed.
      onCritical(crit);

      toHitResultEl.innerHTML = '';
      toHitResultEl.append(
        ...[
          el('p', {}, [
            el('strong', {}, `${kind}: ${selectedAttribute} vs ${info.defense} ${selectedDefense} - roll under ${result.target}`),
            result.mode !== 'normal' ? ` (${result.mode === 'advantage' ? 'Advantage' : 'Disadvantage'})` : '',
          ]),
          el('p', {}, diceSummary(result.roll)),
          el('p', { class: outcomeClass(result.outcome) }, [
            el('strong', {}, hit
              ? `${outcomeLabel(result.outcome)} - it lands. Roll damage below.`
              : `${outcomeLabel(result.outcome)} - it misses.`),
          ]),
          crit ? el('p', { class: 'status-ok' }, [el('strong', {},
            'Critical hit - half the damage dice connect free, and the rest add your Klotho. Already set below.')]) : null,
          result.luckyNumber ? el('p', { class: 'status-ok' }, 'Lucky Number! +1 Fate Token.') : null,
        ].filter((n) => n != null),
      );
    },
  });

  section.append(
    el('h4', {}, 'Attack Roll'),
    attackSteps(),
    el('p', { class: 'roller-label' }, 'Kind of attack'),
    kindRow,
    kindNote,
    skillRow,
    el('p', { class: 'roller-label' }, 'Element - how you do it'),
    attributeGroup,
    el('div', { class: 'roller-row' }, [defenseLabel, defenseSelect]),
    exhaustHost,
    togglesRow,
    rollBtn,
    toHitResultEl,
  );
  // Tell the damage panel where it starts, once it exists to hear it.
  queueMicrotask(announce);
  return section;
}

// Damage dice pool - weapon/Gift attacks, per-die resolution against a
// wall stat with an optional pre-committed Ki Infusion boost (see
// rules.md#the-passive-wall-triad---soak-presence-psyche and #ki-infusion).
// Dice count and the target's wall value are typed in directly rather than
// looked up from a weapon/Gift catalog - see the discussion in
// character-creator.notes.md for why that's out of scope for this pass.
export function buildDamageRollSection(state, data, refreshHeader, heading = 'Damage Roll',
                                       presetDice = null) {
  const section = el('div', { class: 'roller-gift-check' });

  let attackType = 'Physical';
  // Opened from a weapon row, the dice start at that weapon's Damage.
  // Three was only ever a placeholder for having nothing to go on.
  let diceCount = Math.max(1, Math.min(15, Number(presetDice) || 3));
  let wall = 5;
  let boostedDice = new Set();

  const typeSelect = el(
    'select',
    {
      onChange: (e) => {
        attackType = e.target.value;
        boostedDice = new Set();
        renderPool();
        renderSummary();
      },
    },
    Object.keys(ATTACK_TYPES).map((t) => el('option', { value: t }, t)),
  );

  const diceInput = el('input', {
    type: 'number',
    min: '1',
    max: '15',
    value: diceCount,
    onInput: (e) => {
      diceCount = Math.max(1, Math.min(15, Number(e.target.value) || 1));
      e.target.value = diceCount;
      boostedDice = new Set([...boostedDice].filter((i) => i < diceCount));
      renderPool();
    },
  });

  const wallInput = el('input', {
    type: 'number',
    min: '0',
    max: '10',
    value: wall,
    onInput: (e) => {
      wall = Math.max(0, Math.min(10, Number(e.target.value) || 0));
      e.target.value = wall;
    },
  });

  // Ki Infusion is chosen after the roll (rules.md#ki-infusion), so the
  // panel works in two beats: roll the pool, then decide what to spend on
  // it. `pool` holds the rolled dice between those beats; null means
  // nothing has been rolled yet.
  let pool = null;
  let critical = false;

  const critToggle = el('input', {
    type: 'checkbox',
    onChange: (e) => {
      critical = e.target.checked;
      renderSummary();
    },
  });

  const summaryEl = el('p', {});
  function renderSummary() {
    const info = ATTACK_TYPES[attackType];
    const track = info.track === 'health' ? 'Health Level' : info.track === 'poise' ? 'Poise' : 'Sanity Level';
    summaryEl.textContent =
      `${attackType}: ${diceCount} dice vs the target's ${info.wallStat}` +
      `${critical
        ? ` - critical hit, so ${Math.ceil(diceCount / 2)} connect free and the rest add ${state.subStats.Klotho} Klotho`
        : ''}. Each connecting die costs the target a ${track}.`;
  }

  const resultEl = el('div', { class: 'roller-result' });

  // Renders the rolled dice with a boost toggle on each. Toggling spends or
  // refunds Ki immediately, so the running Ki total on the sheet always
  // matches what the panel shows.
  function renderPool() {
    const info = ATTACK_TYPES[attackType];
    const boostAmount = state.subStats[info.boostStat];
    resultEl.innerHTML = '';
    if (!pool) return;

    const applied = applyBoosts(pool, pool.chosen, boostAmount);
    const worth = new Set(worthBoosting(pool, boostAmount));
    const track = info.track === 'health' ? 'Levels' : info.track === 'poise' ? 'Poise' : 'Levels';

    const dieRow = el('div', { class: 'roller-boost-row' });
    applied.dice.forEach((d, i) => {
      const chosen = pool.chosen.has(i);
      // A die is only checkable if boosting it could change the outcome and
      // there is Ki left to pay for it.
      const useful = worth.has(i);
      const atCap = !chosen && pool.chosen.size >= state.currentKi + pool.chosen.size - pool.paid;
      const disabled = !useful || (!chosen && pool.paid >= state.currentKi + pool.paid && state.currentKi <= 0);
      dieRow.append(
        el('label', {
          class: 'boost-die' + (disabled && !chosen ? ' boost-die-disabled' : '') + (d.connects ? ' boost-die-hit' : ''),
          title: d.connects ? 'connects' : useful ? `boost for ${kiSpendCost(state)} Ki: ${d.raw}+${boostAmount}` : 'too far under the wall to save',
        }, [
          el('input', {
            type: 'checkbox',
            checked: chosen ? '' : undefined,
            disabled: disabled && !chosen ? '' : undefined,
            onChange: (e) => {
              const cost = kiSpendCost(state);
              if (e.target.checked) {
                if (state.currentKi < cost) { e.target.checked = false; return; }
                pool.chosen.add(i);
                state.currentKi -= cost;
                pool.paid += cost;
              } else {
                pool.chosen.delete(i);
                state.currentKi += cost;
                pool.paid -= cost;
              }
              refreshHeader();
              renderPool();
            },
          }),
          ` ${d.boosted ? `${d.raw}+${boostAmount}=${d.result}` : d.raw}`,
        ]),
      );
    });

    const unspent = worth.size - pool.chosen.size;
    resultEl.append(
      ...[
        el('p', {}, [
          el('strong', {}, `${applied.dice.length} dice vs wall ${pool.wall}`),
          pool.critical
            ? ` - critical hit: ${pool.freeDice} through free, ${pool.klotho} Klotho on the rest`
            : '',
        ]),
        dieRow,
        el('p', {}, `Tick a die to spend ${kiSpendCost(state)} Ki and add ${boostAmount} ${info.boostStat} to it. ${state.currentKi} Ki left.`),
        unspent > 0
          ? el('p', { class: 'status-warn' }, `${unspent} more die${unspent === 1 ? '' : 's'} could still be carried over the wall.`)
          : null,
        el('p', { class: 'status-bad' }, [
          el('strong', {}, `${applied.connectCount} connect - ${applied.connectCount} ${track} to the target`),
        ]),
        pool.paid > 0 ? el('p', {}, `${pool.paid} Ki spent on this attack.`) : null,
      ].filter((n) => n != null),
    );
  }

  const rollBtn = el('button', {
    type: 'button',
    class: 'roll-btn',
    text: 'Roll Damage',
    onClick: () => {
      // Damage the character is dealing to someone else, not to their own
      // sheet - only the Ki spend touches this character's state. The
      // crossing-zero throttle is not applied here: it depends on the
      // target's own current track, which this app cannot see for an NPC.
      // The connect count is the damage dealt, for whoever holds that sheet.
      pool = rollDamagePool({ diceCount, wall, critical, klotho: state.subStats.Klotho });
      pool.chosen = new Set();
      pool.paid = 0;
      renderPool();
    },
  });

  renderSummary();

  section.append(
    el('h4', {}, heading),
    howTo('One die per point of Damage, each rolled against the wall that '
      + 'resists it. Ki can boost dice before you roll; a critical is set for '
      + 'you if the to-hit crits.'),
    el('div', { class: 'roller-row' }, [el('label', {}, 'Attack Type'), typeSelect]),
    el('div', { class: 'roller-row' }, [el('label', {}, 'Dice'), diceInput]),
    el('div', { class: 'roller-row' }, [el('label', {}, "Target's Wall"), wallInput]),
    el('div', { class: 'roller-row' }, [el('label', {}, 'Critical hit'), critToggle]),
    summaryEl,
    rollBtn,
    resultEl,
  );
  // The to-hit roller says what kind of attack this is, and for a Social
  // one how many dice its Skill gives. A weapon's own dice are left alone.
  section.setAttack = ({ type, dice }) => {
    if (!ATTACK_TYPES[type]) return;
    attackType = type;
    typeSelect.value = type;
    if (dice) {
      diceCount = Math.max(1, Math.min(15, dice));
      diceInput.value = diceCount;
    }
    boostedDice = new Set();
    renderPool();
    renderSummary();
  };
  // The to-hit roller arms this when it crits, so the two panels agree.
  section.armCritical = (on) => {
    critical = on;
    critToggle.checked = on;
    renderSummary();
  };
  section.refreshBoostRow = renderPool;
  return section;
}

// Gift Check (rules.md#resolution, gifts.md#resolution): 2d10 roll-under
// against current Ki + Stamina. Success is free; failure costs 1 Ki,
// deducted here immediately since there's no separate confirmation step
// for a cost this small and automatic.
export function buildGiftCheckSection(state, data, refreshKiDependents, { onRolled = () => {} } = {}) {
  const section = el('div', { class: 'roller-gift-check' });
  const summary = el('p', {});
  const resultEl = el('div', { class: 'roller-result' });

  function updateSummary() {
    // Rolls against current Ki alone now, not Ki + Stamina
    // (rules/gifts.md#resolution).
    summary.textContent = `Roll under your current Ki: ${state.currentKi}`;
  }
  updateSummary();

  const rollBtn = el('button', {
    type: 'button',
    class: 'roll-btn',
    text: 'Roll Gift Check',
    onClick: () => {
      const result = performGiftCheck({ ki: state.currentKi });
      if (result.outcome === 'failure') {
        state.currentKi = Math.max(0, state.currentKi - 1);
        refreshKiDependents();
      }
      updateSummary();
      onRolled({
        kind: 'Gift Check',
        headline: result.outcome === 'success' ? 'Success' : 'Failure, 1 Ki spent',
        detail: `Rolled ${result.roll.dice.join(', ')} = ${result.roll.sum} under Ki ${result.target}`,
        success: result.outcome === 'success',
      });
      resultEl.innerHTML = '';
      resultEl.append(
        el('p', {}, `Rolled ${result.roll.dice.join(', ')} → ${result.roll.sum} vs target ${result.target}`),
        el('p', { class: result.outcome === 'success' ? 'status-ok' : 'status-bad' }, [
          el('strong', {}, result.outcome === 'success' ? 'Success' : 'Failure (1 Ki spent)'),
        ]),
      );
    },
  });

  section.append(
    el('h4', {}, 'Gift Check'),
    howTo("2d10 under your current Ki. It costs the Gift's Ki either way - "
      + 'failing is what makes it cost 1 more.'),
    summary, rollBtn, resultEl,
  );
  return section;
}
// --- The Roll dice window ------------------------------------------------
// An attack is one throw read Normal, at Advantage and at Disadvantage
// side by side, so nobody has to know which applies before they roll. A
// Skill is ticked boxes and one roll.

const MODES = [['normal', 'Normal'], ['advantage', 'Advantage'], ['disadvantage', 'Disadvantage']];

function numberSelect(from, to, value, onPick, label = (n) => `${n}`) {
  const options = [];
  for (let n = from; n <= to; n++) {
    options.push(el('option', { value: n, selected: n === value ? '' : undefined }, label(n)));
  }
  return el('select', { onChange: (e) => onPick(Number(e.target.value)) }, options);
}

function quickField(label, control) {
  return el('label', { class: 'quick-field' }, [el('span', {}, label), control]);
}

function keptText(r) {
  return r.dice.length === r.kept.length ? `${r.sum}` : `${r.kept.join(' + ')} = ${r.sum}`;
}

function modeTable(heads, rows) {
  return el('table', { class: 'menu-table quick-table' }, [
    el('tr', {}, heads.map((h) => el('th', {}, h))),
    ...rows,
  ]);
}

const ATTACK_OUTCOME = {
  'critical-success': 'Critical hit',
  success: 'Hit',
  failure: 'Miss',
  'catastrophic-failure': 'Catastrophic miss',
};

function modeCell(outcome) {
  return el('td', { class: outcomeClass(outcome) }, [el('strong', {}, ATTACK_OUTCOME[outcome])]);
}

// The damage dice after the count: green for a die that got through,
// red for one the wall soaked. A critical's free dice go through
// whatever they show; the rest show their face with Klotho added.
function damageCell(parts) {
  if (!parts) return el('td', {}, '-');
  const through = parts.filter((p) => p.through).length;
  const dice = [];
  parts.forEach((p, i) => {
    if (i) dice.push(', ');
    dice.push(el('span', {
      class: p.through ? 'quick-die-through' : 'quick-die-soaked',
      title: p.free ? 'Free on a critical' : p.through ? 'Gets through' : 'Soaked',
    }, p.free ? `${p.shown}*` : `${p.shown}`));
  });
  return el('td', {}, [el('strong', {}, `${through}`), ' (', ...dice, ')']);
}

// A Lucky Number is the kept two matching Klotho. Only the row that
// counts earns the Token, so the roller marks it and leaves the Token to
// the player.
function luckyMark(sum, klotho) {
  return klotho && sum === klotho ? ' ★' : '';
}

function luckyNote(throwResult, klotho) {
  const hit = MODES.some(([m]) => klotho && throwResult[m].sum === klotho);
  return hit ? el('p', { class: 'hint' },
    `★ Lucky Number (${klotho}): if that is the row that counts, take 1 Fate Token.`) : null;
}

function exhaustedLine(state) {
  const level = exhaustedLevel(state);
  if (!level) return null;
  return el('p', { class: 'hint roller-exhausted' }, level >= 2
    ? `Exhausted ${level}: read the Disadvantage row, or cancel it with an Advantage.`
    : 'Exhausted 1: a Physical roll reads the Disadvantage row, or cancels it with an Advantage.');
}

// Attack: Element against Defense to hit, then the damage dice against the
// wall. The damage dice are thrown once and scored against each row's hit,
// so a row that crits shows what the critical does to the same dice.
export function buildQuickAttack(state, data, { onRolled = () => {} } = {}) {
  const fighting = data.attributes.map((a) => a.name);
  let element = fighting.filter((n) => n !== 'Moira')
    .sort((a, b) => (state.attributes[b] || 0) - (state.attributes[a] || 0))[0] || fighting[0];
  let defense = 5;
  let dice = 3;
  let wall = 5;
  const klotho = Number(state.subStats?.Klotho) || 0;
  const result = el('div', { class: 'roller-result' });

  const elementSelect = el('select', { onChange: (e) => { element = e.target.value; } },
    fighting.map((n) => el('option', { value: n, selected: n === element ? '' : undefined },
      `${n} (${state.attributes[n] ?? 0})`)));

  function roll() {
    const rating = Math.min(Number(state.attributes[element]) || 0, data.attributeRollCap);
    const { nodes, record } = threeWayAttack({
      label: `${element} ${rating}`, rating, defense, dice, wall, klotho,
      steps: elementCritSteps(state, data, element),
    });
    onRolled(record);
    result.innerHTML = '';
    result.append(...nodes);
  }

  return el('div', { class: 'roller-gift-check' }, [
    el('h4', {}, 'Attack'),
    howTo('Your Element plus their Defense is the number to roll under. '
      + 'The GM gives you their Defense and wall.'),
    el('div', { class: 'quick-fields' }, [
      quickField('Element', elementSelect),
      quickField('Defense', numberSelect(0, 10, defense, (n) => { defense = n; })),
      quickField('Damage rating', numberSelect(0, 20, dice, (n) => { dice = n; }, (n) => `${n} ${n === 1 ? 'die' : 'dice'}`)),
      quickField('Wall', numberSelect(0, 10, wall, (n) => { wall = n; })),
    ]),
    exhaustedLine(state),
    el('button', { type: 'button', class: 'roll-btn', text: 'Roll attack', onClick: roll }),
    result,
  ]);
}

// Skill: picked from the sheet, which sets its Element and Tier. The
// Element stays open to a Descriptor argument; the Difficulty is the GM's.
export function buildQuickSkill(state, data, { onRolled = () => {} } = {}) {
  // Jack of all Trades lifts every Skill to Trained; at 5 points it also
  // holds every one there (boons.md) - the sheet reads it the same way.
  const joat = jackOfAllTrades(state);
  const tierOf = (t) => skillTierWithJack(state, t);
  const skills = data.skillCatalog
    .filter((s) => (state.skills[s.name] || 0) > 0)
    .map((s) => ({ name: s.name, tier: tierOf(state.skills[s.name]), element: s.defaultElement }));
  const OTHER = { name: '', tier: tierOf(0), element: null };
  const elements = data.attributes.map((a) => a.name);
  const defaultElement = (s) => (elements.includes(s.element) ? s.element : elements[0]);

  let skill = skills[0] || OTHER;
  let element = defaultElement(skill);
  let difficulty = 5;
  const klotho = Number(state.subStats?.Klotho) || 0;
  const result = el('div', { class: 'roller-result' });
  const note = el('p', { class: 'roller-tier-note' });

  const elementSelect = el('select', {
    onChange: (e) => { element = e.target.value; renderNote(); },
  });
  function renderElements() {
    elementSelect.innerHTML = '';
    elements.forEach((n) => elementSelect.append(el('option', {
      value: n, selected: n === element ? '' : undefined,
    }, `${n} (${state.attributes[n] ?? 0})`)));
  }
  function renderNote() {
    const d = defaultElement(skill);
    const parts = [];
    if (skill.tier === 0) parts.push('Untrained: your Element does not count, only the Difficulty.');
    else if (skill.name && element !== d) parts.push(`${element} instead of ${d}: argued with a Descriptor.`);
    else if (skill.name) parts.push(`${d} is this Skill's Element. Use your Descriptors to argue a different Element.`);
    note.textContent = parts.join(' ');
  }

  const skillSelect = el('select', {
    onChange: (e) => {
      skill = skills.find((s) => s.name === e.target.value) || OTHER;
      element = defaultElement(skill);
      renderElements();
      renderNote();
      setBoxes();
    },
  }, [
    // With Jack of all Trades, "every other Skill" leads the list, as it
    // leads the sheet.
    joat ? el('option', { value: '' }, 'Any other Skill - Trained (Jack of all Trades)') : null,
    ...skills.map((s) => el('option', { value: s.name, selected: s === skill ? '' : undefined },
      `${s.name} - ${skillTierName(data, s.tier)}`)),
    joat ? null : el('option', { value: '' }, 'Any other Skill - Untrained'),
  ].filter(Boolean));
  renderElements();
  renderNote();

  // A Skill rolls once. Adept and up start with Advantage ticked, and
  // Exhausted 2 and up with Disadvantage; either box can be changed, and
  // the two cancel by the usual rule (rules.md#advantage--disadvantage).
  let advantage = false;
  let disadvantage = false;
  const boxes = el('div', { class: 'quick-boxes' });
  function setBoxes() {
    const grant = SKILL_TIERS[skill.tier].grantsAdvantage;
    advantage = grant === 'advantage';
    disadvantage = exhaustedLevel(state) >= 2;
    renderBoxes();
  }
  function renderBoxes() {
    const box = (label, on, flip) => el('label', { class: 'roller-row' }, [
      el('input', { type: 'checkbox', checked: on ? '' : undefined, onChange: (e) => flip(e.target.checked) }),
      ` ${label}`,
    ]);
    boxes.innerHTML = '';
    boxes.append(
      box('Advantage', advantage, (v) => { advantage = v; }),
      box('Disadvantage', disadvantage, (v) => { disadvantage = v; }),
    );
  }
  setBoxes();

  function roll() {
    const tier = SKILL_TIERS[skill.tier];
    const rating = tier.usesAttribute ? Math.min(Number(state.attributes[element]) || 0, data.attributeRollCap) : 0;
    const target = rating + difficulty;
    const steps = elementCritSteps(state, data, element);
    const mode = resolveAdvantageState(advantage ? 1 : 0, disadvantage ? 1 : 0);
    const throwOnce = () => (mode === 'advantage' ? rollAdvantage()
      : mode === 'disadvantage' ? rollDisadvantage() : rollPlain());
    const r = throwOnce();
    let outcome = classifyRoll(r.sum, target, tier.widenCrit, steps);
    // Master's reroll only ever takes the Catastrophic off: a success on
    // it is a plain Failure, and a failure leaves the Catastrophic.
    let reroll = null;
    if (outcome === 'catastrophic-failure' && tier.masterReroll) {
      reroll = throwOnce();
      const again = classifyRoll(reroll.sum, target, tier.widenCrit, steps);
      if (again === 'success' || again === 'critical-success') outcome = 'failure';
    }
    // Lucky Number: the kept two matching Klotho is a Fate Token, and one
    // earned at the holding cap is lost (rules/fate.md).
    const lucky = klotho && r.sum === klotho;
    if (lucky) {
      state.currentFateTokens = Math.min(fateTokenCap(state, data), (state.currentFateTokens || 0) + 1);
    }
    onRolled({
      kind: skill.name || 'Any other Skill',
      headline: outcomeLabel(outcome),
      detail: `${tier.usesAttribute ? `${element} ${rating} + ` : ''}Difficulty ${difficulty}, under ${target}`
        + `${mode !== 'normal' ? ` at ${mode === 'advantage' ? 'Advantage' : 'Disadvantage'}` : ''}: ${diceSummary(r)}`
        + `${reroll ? `; Master's reroll ${diceSummary(reroll)}` : ''}${lucky ? '; Lucky Number, +1 Fate Token' : ''}`,
      success: outcome === 'success' || outcome === 'critical-success',
    });
    result.innerHTML = '';
    result.append(...[
      el('p', {}, [el('strong', {}, `${skill.name || 'Any other Skill'}: `
        + `${tier.usesAttribute ? `${element} ${rating} + ` : ''}Difficulty ${difficulty}, roll under ${target}`),
        mode !== 'normal' ? ` (${mode === 'advantage' ? 'Advantage' : 'Disadvantage'})` : '']),
      el('p', {}, diceSummary(r)),
      el('p', { class: outcomeClass(outcome) }, [el('strong', {}, outcomeLabel(outcome))]),
      reroll ? el('p', {}, `Master's reroll: ${diceSummary(reroll)}`) : null,
      lucky ? el('p', { class: 'status-ok' }, `Lucky Number (${klotho})! +1 Fate Token.`) : null,
    ].filter(Boolean));
  }

  return el('div', { class: 'roller-gift-check' }, [
    el('h4', {}, 'Skill'),
    howTo('Pick the Skill; its Element and Tier come from your sheet. '
      + 'The GM says how hard it is.'),
    el('div', { class: 'quick-fields' }, [
      quickField('Skill', skillSelect),
      quickField('Element', elementSelect),
      quickField('Difficulty', el('select', { onChange: (e) => { difficulty = Number(e.target.value); } },
        data.difficultyChart.map((d) => el('option', {
          value: d.difficulty, selected: d.difficulty === difficulty ? '' : undefined,
        }, `${d.difficulty} - ${d.label}`)))),
    ]),
    note,
    exhaustionNote(state, false),
    boxes,
    el('button', { type: 'button', class: 'roll-btn', text: 'Roll Skill', onClick: roll }),
    result,
  ]);
}

// One attack, rolled once and read all three ways: to hit (rating + the
// target's Defense, 2d10 under), then the damage dice against the wall,
// scored against each row's result. A critical sends half the dice in free
// and adds Klotho to the rest (rules.md#critical-hits). Returns what to show
// and a line for the room log. A character's Element and a creature's
// printed Attack both come through here.
export function threeWayAttack({
  label, rating, defense, dice, wall, klotho = 0, steps = 0, defenseName = 'Defense', noToHit = false,
}) {
  const target = rating + defense;
  const toHit = rollThreeWays();
  const faces = Array.from({ length: dice }, rollD10);

  function damage(outcome) {
    if (outcome === 'failure' || outcome === 'catastrophic-failure' || !dice) return null;
    const crit = outcome === 'critical-success';
    const free = crit ? Math.ceil(dice / 2) : 0;
    return faces.map((f, i) => {
      if (i < free) return { shown: f, free: true, through: true };
      const shown = crit ? f + klotho : f;
      return { shown, through: shown > wall };
    });
  }

  // Some attacks land by being seen or heard: no to-hit, just the dice.
  if (noToHit) {
    const dmg = damage('success');
    const through = dmg ? dmg.filter((p) => p.through).length : 0;
    return {
      nodes: [
        el('p', {}, [el('strong', {}, `${label}: no to-hit roll`), ` - it lands on anyone who perceives it.`]),
        modeTable(['', 'Damage dealt'], [el('tr', {}, [el('td', {}, [el('strong', {}, 'Lands')]), damageCell(dmg)])]),
        el('p', { class: 'hint' }, `Each die over the wall (${wall}) costs them one.`),
      ],
      record: {
        kind: 'Attack', headline: `${label}: ${through} damage`,
        detail: `No to-hit. Damage dice ${faces.join(', ')} vs wall ${wall}`, success: through > 0,
      },
    };
  }

  const anyCrit = MODES.some(([m]) => classifyRoll(toHit[m].sum, target, false, steps) === 'critical-success');
  const record = {
    kind: 'Attack',
    headline: `${label} + ${defenseName} ${defense}, under ${target}`,
    detail: MODES.map(([m, name]) => {
      const outcome = classifyRoll(toHit[m].sum, target, false, steps);
      const dmg = damage(outcome);
      const through = dmg ? dmg.filter((p) => p.through).length : 0;
      return `${name} ${toHit[m].sum}: ${ATTACK_OUTCOME[outcome]}${dmg ? `, ${through} damage` : ''}`;
    }).join(' · ') + (dice ? ` (damage dice ${faces.join(', ')} vs wall ${wall})` : ''),
    success: true,
  };
  const nodes = [
    el('p', {}, [el('strong', {}, `${label} + ${defenseName} ${defense}: roll under ${target}`),
      ` - dice ${toHit.dice.join(', ')}`]),
    modeTable(['', 'To hit', 'Result', 'Damage dealt'], MODES.map(([m, name]) => {
      const r = toHit[m];
      const outcome = classifyRoll(r.sum, target, false, steps);
      return el('tr', {}, [
        el('td', {}, [el('strong', {}, name)]),
        el('td', {}, keptText(r) + luckyMark(r.sum, klotho)),
        modeCell(outcome),
        damageCell(damage(outcome)),
      ]);
    })),
    dice ? el('p', { class: 'hint' }, `Each damage die over the wall (${wall}) costs them one.`
      + (anyCrit ? ` On a critical hit, * dice get through free${klotho ? ` and the rest add Klotho (+${klotho})` : ''}.` : '')) : null,
    luckyNote(toHit, klotho),
  ].filter(Boolean);
  return { nodes, record };
}

// --- A creature's own rolls -------------------------------------------------
// A creature rolls from its stat block as the book prints it: its Attack
// against the target's Defense for the kind of attack, then that attack's
// dice against the matching wall. The GM sets the target's numbers.

const DEFENSE_FOR = { Physical: 'Defense', Social: 'Social Defense', Mental: 'Mental Defense' };

export function buildCreatureAttack(creature, { onRolled = () => {} } = {}) {
  const attacks = creature.attacks || [];
  const attackStat = Number(creature.stats?.Attack) || 0;
  if (!attacks.length) {
    return el('div', { class: 'roller-gift-check' }, [
      el('h4', {}, 'Attack'),
      el('p', { class: 'hint' }, 'It has no dice attack; what it does is under Also and Traits in its stat block.'),
    ]);
  }
  let pick = 0;
  let defense = 5;
  let wall = 3;
  const result = el('div', { class: 'roller-result' });
  const defenseLabel = el('span', {});
  const wallLabel = el('span', {});
  const note = el('p', { class: 'roller-tier-note' });
  const current = () => attacks[pick];
  function label() {
    const a = current();
    defenseLabel.textContent = `Target's ${DEFENSE_FOR[a.kind]}`;
    wallLabel.textContent = `Target's ${a.wall}`;
    const noHit = /no to-hit roll required/i.test(a.text);
    note.textContent = [a.when ? `Only ${a.when}.` : '', noHit ? 'No to-hit roll: it lands on anyone who perceives it.' : '']
      .filter(Boolean).join(' ');
  }
  const attackSelect = el('select', {
    onChange: (e) => { pick = Number(e.target.value); label(); result.innerHTML = ''; },
  }, attacks.map((a, i) => el('option', { value: i }, `${a.name} - ${a.dice} ${a.dice === 1 ? 'die' : 'dice'}, ${a.kind}`)));
  label();

  function roll() {
    const a = current();
    const { nodes, record } = threeWayAttack({
      label: `${a.name}: Attack ${attackStat}`, rating: attackStat, defense, dice: a.dice, wall,
      defenseName: DEFENSE_FOR[a.kind], noToHit: /no to-hit roll required/i.test(a.text),
    });
    onRolled(record);
    result.innerHTML = '';
    result.append(...nodes);
  }

  return el('div', { class: 'roller-gift-check' }, [
    el('h4', {}, 'Attack'),
    howTo(`Its Attack (${attackStat}) plus the target's Defense is the number to roll under; the attack's dice go against the target's wall.`),
    el('div', { class: 'quick-fields' }, [
      quickField('Attack', attackSelect),
      el('label', { class: 'quick-field' }, [defenseLabel, numberSelect(0, 10, defense, (n) => { defense = n; })]),
      el('label', { class: 'quick-field' }, [wallLabel, numberSelect(0, 10, wall, (n) => { wall = n; })]),
    ]),
    note,
    el('button', { type: 'button', class: 'roll-btn', text: 'Roll attack', onClick: roll }),
    result,
  ]);
}

// "Stealth 7 vs. Perception, Athletics TN 9": each is a number to roll
// under, and a "vs." names what the other side rolls against it.
export function creatureSkills(text) {
  return String(text || '').split(/,\s*/).map((part) => {
    const m = /^(.+?)\s+(?:TN\s+)?(\d+)\s*(.*)$/.exec(part.replace(/\*\*/g, '').trim());
    return m ? { name: m[1].trim(), target: Number(m[2]), against: m[3].replace(/^vs\.?\s*/i, '').trim() } : null;
  }).filter(Boolean);
}

export function buildCreatureSkills(creature, { onRolled = () => {} } = {}) {
  const skills = creatureSkills(creature.skills);
  if (!skills.length) return null;
  let advantage = false;
  let disadvantage = false;
  const result = el('div', { class: 'roller-result' });
  const box = (label, flip) => el('label', { class: 'roller-row' }, [
    el('input', { type: 'checkbox', onChange: (e) => flip(e.target.checked) }), ` ${label}`,
  ]);
  function roll(skill) {
    const mode = resolveAdvantageState(advantage ? 1 : 0, disadvantage ? 1 : 0);
    const r = mode === 'advantage' ? rollAdvantage() : mode === 'disadvantage' ? rollDisadvantage() : rollPlain();
    const outcome = classifyRoll(r.sum, skill.target, false, 0);
    const vs = skill.against ? ` (against their ${skill.against})` : '';
    onRolled({
      kind: skill.name,
      headline: outcomeLabel(outcome),
      detail: `Under ${skill.target}${vs}${mode !== 'normal' ? ` at ${mode === 'advantage' ? 'Advantage' : 'Disadvantage'}` : ''}: ${diceSummary(r)}`,
      success: outcome === 'success' || outcome === 'critical-success',
    });
    result.innerHTML = '';
    result.append(
      el('p', {}, [el('strong', {}, `${skill.name}: roll under ${skill.target}`), vs]),
      el('p', {}, diceSummary(r)),
      el('p', { class: outcomeClass(outcome) }, [el('strong', {}, outcomeLabel(outcome))]),
    );
  }
  return el('div', { class: 'roller-gift-check' }, [
    el('h4', {}, 'Skills'),
    howTo('Its Notable Skills, as printed: click one to roll 2d10 under its number.'),
    el('div', { class: 'quick-boxes' }, [
      box('Advantage', (v) => { advantage = v; }),
      box('Disadvantage', (v) => { disadvantage = v; }),
    ]),
    el('div', { class: 'quick-fields' }, skills.map((k) => el('button', {
      type: 'button', class: 'roll-btn', onClick: () => roll(k),
      text: `${k.name} ${k.target}`,
    }))),
    result,
  ]);
}
