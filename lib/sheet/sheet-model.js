// What the character sheet says, worked out from the character: which
// Skills, Gifts and Resources it lists and at what, the weapons, armour and
// gear sorted into their blocks, what Movement comes to, the state each
// Vital is in, and what the sheet's buttons do to the character.
//
// Two sheets read it. The Creator draws it onto the printed pages
// (paged-sheet.js); the Owlbear Rodeo character sheet lays the same
// answers out as a panel (playsheet/). Worked out once, here, so the two
// cannot disagree about a character.

import {
  retiredSkills,
  giftMenuBuilds,
  giftMenuBuildName,
  giftMenuPurchases,
  applyRest,
  applyVitalFloor,
  healthStatus,
  poiseStatus,
  sanityStatus,
  computeFiguredCharacteristics,
  effectiveResourceLevel,
  fateTokenCap,
} from '../state.js';

// Which of the four armour Zones an item's Zone text covers. Characters saved
// before the Zones were split still say "Body", "Body (arms)", "Body + Head".
export function coversZone(zone, which) {
  const z = String(zone || '').toLowerCase();
  if (/all four/.test(z)) return true;
  if (which === 'com') return /center of mass/.test(z) || (/\bbody\b/.test(z) && !/\((arms|legs)\)/.test(z));
  if (which === 'head') return /head/.test(z);
  if (which === 'arms') return /arms/.test(z);
  if (which === 'legs') return /legs/.test(z);
  return false;
}

// ---------------------------------------------------------------------------
// reading the character
//
// Every block on the sheet is a fixed number of slots, and a character
// has as many entries as they have. These collect the entries once, in
// the order they should print, so slot N on the page is entry N here.
// ---------------------------------------------------------------------------

// Each Element's colour as the sheet's own panels print it, lifted a
// little so a small word still reads against the page.
export const SKILL_ELEMENT_COLOURS = {
  Earth: '#c2a27e',
  Air: '#a8c9e0',
  Fire: '#f08a63',
  Water: '#3fbcc6',
  Moira: '#b98ce0',
  Retired: '#e0685c',
};

// Jack of all Trades (boons.md): every Skill is at least Trained, and Tier
// 1 (5 points) also caps every Skill at Trained. The sheet cannot list all
// 77, so it shows what was bought at the tier it actually rolls at, and
// one row for the rest.
export function jackOfAllTrades(state) {
  const b = (state.boons || []).find((x) => x.name === 'Jack of all Trades');
  return b ? { capped: b.points === 5 } : null;
}

export function takenSkills(state, data) {
  const joat = jackOfAllTrades(state);
  const rolled = (tier) => {
    if (!joat) return tier;
    const floored = Math.max(tier, 2);
    return joat.capped ? Math.min(floored, 2) : floored;
  };
  return data.skillCatalog
    .filter((s) => state.skills[s.name] > 0)
    .map((s) => ({ name: s.name, tier: rolled(state.skills[s.name]), element: s.defaultElement }))
    .concat(joat ? [{ name: 'Every other Skill (Jack of all Trades)', tier: 2, joat: true }] : [])
    // A Skill that has left the rules is still on the character until the
    // player removes it, so it is still on the sheet - marked.
    .concat(retiredSkills(state, data).map((r) => ({ ...r, element: 'Retired', retired: true })));
}

export function takenResources(state, data) {
  return data.resources
    .filter((r) => state.resources[r.name] > 0)
    .map((r) => ({
      name: r.name,
      level: state.resources[r.name],
      now: effectiveResourceLevel(state, r.name),
      zeroed: !!state.resourceZeroed[r.name],
      // Only six Resources can be pushed; every other one is a standing
      // fact with nothing to roll about (rules/resources.md).
      pushable: !!r.pushable,
    }));
}

export function takenGifts(state) {
  return state.gifts.filter((g) => g.level > 0);
}

// The Gift card has room for what a conjured weapon looks like; a cell in
// the Weapons table does not, and a description that runs past the column
// is clipped mid-word. That answer asks for a name and a look together, so
// take the name off the front of it: up to the first dash, sentence end or
// comma, and never more than a cell's worth.
function shortName(text) {
  const first = text.split(/\s+[-–]\s+|(?<=[.!?])\s+|,\s+/)[0].trim();
  const name = first || text.trim();
  return name.length > 40 ? `${name.slice(0, 39).trimEnd()}…` : name;
}

// The gear the character bought, split the way the pages are: anything
// from an Armor table goes to the Armour block, anything with a Damage
// column goes to Weapons, everything else is just carried.
//
// Conjured Armory's weapon is a real item from the catalogue, and its
// Damage is that item's listed rating plus the Gift's Level, uncapped -
// so an Armory attack keeps pace with the Gifts that attack directly
// rather than stalling at the weapon table's ceiling of 5 while
// Onslaught and the rest climb past it. Bonded Blade adds one more, for
// the signature weapon specifically.
const CONJURED_BASE = 3;

function conjuredWeapon(state, catalog) {
  const gift = (state.gifts || []).find((g) => g.name === 'Conjured Armory' && g.level > 0);
  if (!gift) return null;

  // Bonded Blade's edge starts where the Gift's own bonus used to, at
  // Level 3 - the adder is written as "+1 higher than any other weapon
  // you conjure", and below Level 3 there is nothing yet to be higher
  // than.
  const bonded = gift.level >= 3 && (gift.adders || []).includes('Bonded Blade');
  const bonus = gift.level + (bonded ? 1 : 0);

  const notes = (gift.notes || []).filter(Boolean);
  const wanted = (notes[0] || '').trim().toLowerCase();
  const item = wanted && wanted !== 'needs name'
    ? [...catalog.values()].find((x) => x.name.toLowerCase() === wanted)
    : null;

  // A weapon nobody has named yet, or one the catalogue has never heard
  // of. Either way the character still swings something, and a row that
  // cannot be rolled is worse than one carrying the catalogue's own
  // middle rating until the real weapon is filled in. Three is that
  // middle: the most common Damage across the 91 weapons in the tables,
  // and their median.
  const base = item ? Number(item.Damage) : CONJURED_BASE;
  const damage = String((Number.isFinite(base) ? base : CONJURED_BASE) + bonus);

  const called = notes[1] ? notes[1].trim() : '';
  const named = notes[0] && wanted !== 'needs name';
  const label = named
    ? (called ? `${notes[0].trim()} - ${shortName(called)}` : notes[0].trim())
    : 'Conjured Armory - needs name';

  return {
    name: label,
    damage,
    range: item ? (item['Range (Normal / Long)'] || item.Range || '') : 'as listed',
    // Level 1 already says it never runs dry, whatever the weapon is.
    ammo: 'never dry',
    reload: item ? (item.Reload || '') : '-',
  };
}

// Which sub-stat a Gift's dice come from, and which wall they land on.
// Read out of the Gift's own rules text rather than listed here, so a
// Gift added or reworded in the book arrives on the sheet without this
// file being touched. The fallback pairing is the rule's own: Ferocity
// against Soak, Presence against Presence, Psyche against Psyche.
const WALL_FOR = { Ferocity: 'Soak', Presence: 'Presence', Psyche: 'Psyche' };

// No Gift carries a Ki cost as a field - it is written into the level
// that charges it, so the number is read back out of that sentence.
// Nothing to find means nothing to show, not a zero.
export function giftKi(gift, data) {
  const entry = (data.gifts || []).find((d) => d.name === gift.name);
  const row = (entry?.levels || []).find((l) => l.level === gift.level);
  // The cost is stated once, at the Level that introduces it - Onslaught
  // says "spend 1 Ki" at Level 1 and never repeats itself - so a Level 3
  // character reading only their own row finds nothing. Fall back to the
  // Gift's whole text rather than leaving a blank where a cost belongs.
  const find = (t) => /(\d+)\s*Ki\b/i.exec(t || '')?.[1];
  return find(row?.effect) || find(entry?.markdown) || '';
}

function giftAttack(entry, gift, subStats) {
  const text = entry?.markdown || '';
  const source = /half (?:your |their )?(Ferocity|Presence|Psyche)/.exec(text)?.[1];
  if (!source) return null;
  const wall = /(?:vs\.?|against) \*\*(Soak|Presence|Psyche)\*\*/.exec(text)?.[1]
    || WALL_FOR[source];
  const range = /\*\*(Melee|Close|Near|Far)\*\* range/.exec(text)?.[1] || '';
  // Level plus half the sub-stat that powers it, rounded down.
  const dice = gift.level + Math.floor((subStats[source] || 0) / 2);
  return { dice, wall, range };
}

// A Signature Move is built rather than looked up: the player picks the
// sub-stat the dice come from and the wall they land on, and the two do
// not have to match - which is how a scream ends up breaking composure.
function signatureAttacks(state, subStats) {
  const gift = (state.gifts || []).find((g) => g.name === 'Signature Move' && g.level > 0);
  if (!gift) return [];
  const moves = Array.isArray(gift.moves) ? gift.moves : [];
  return moves
    .filter((m) => m.source && m.wall)
    .map((m) => ({
      name: m.name ? `${m.name} (Move)` : 'Signature Move',
      damage: `${(m.level || gift.level) + Math.floor((subStats[m.source] || 0) / 2)} vs ${m.wall}`,
      range: '',
      ammo: '1 Ki',
      reload: '-',
    }));
}

function giftWeapons(state, data) {
  const subStats = state.subStats || {};
  const out = [];
  (state.gifts || []).filter((g) => g.level > 0).forEach((g) => {
    if (g.name === 'Conjured Armory' || g.name === 'Signature Move') return;
    const entry = (data.gifts || []).find((d) => d.name === g.name);
    const atk = giftAttack(entry, g, subStats);
    if (!atk) return;
    const told = (g.notes || []).filter(Boolean)[0];
    out.push({
      name: told ? `${g.name} - ${told}` : g.name,
      damage: `${atk.dice} vs ${atk.wall}`,
      range: atk.range,
      ammo: giftKi(g, data) ? `${giftKi(g, data)} Ki` : '',
      reload: '-',
    });
  });
  return out.concat(signatureAttacks(state, subStats));
}

// A package's contents are written as prose: three or four catalogue
// items separated by commas, and on fourteen of the seventy-eight a last
// clause the book marks as flavour - "and a doctor who doesn't file
// paperwork (flavor)". Equipment is a column of slots holding the name of
// a thing, and that clause is not a thing; it is a standing advantage,
// written as a sentence, and it cannot be made to fit one. It stays in
// the package on the Creator's gear step, where there is room to read it,
// and does not take an equipment slot it would run three times over.
function packageItems(contents) {
  return String(contents || '')
    .split(',')
    .map((part) => part.trim().replace(/^and\s+/i, '').replace(/\.$/, '').trim())
    .filter((part) => part && !/\((?:flavor|flavour)\)$/i.test(part));
}

export function splitGear(state, data) {
  const catalog = new Map();
  (data.equipment || []).forEach((cat) => {
    cat.items.forEach((item) => {
      if (!catalog.has(item.name)) catalog.set(item.name, { ...item, _cat: cat });
    });
  });

  const weapons = [];
  const armour = [];
  const gear = [];

  // Where one named thing belongs: the Armour block if it is armour, the
  // Weapons block if it has a Damage column, and carried otherwise.
  function file(name, category, own) {
    // Something written in by hand has no catalogue entry to look up, so
    // it brings its own Damage and range with it.
    if (own && own.damage) {
      weapons.push({
        name,
        damage: String(own.damage),
        range: own.range || '',
        ammo: own.ammo || '',
        reload: own.reload || '',
      });
      return;
    }
    if (own && own.hardness) {
      armour.push({
        name,
        zone: own.zone || '',
        hardness: String(own.hardness),
        health: Number(own.health) || 0,
      });
      return;
    }
    const item = catalog.get(name);
    // Armour is whatever has a Zone to cover and a Hardness to cover it
    // with, not whatever sits under a heading called Armor - the Black
    // Market and Beyond the Ordinary suits live under their own headings
    // and were landing in carried gear. Vehicles have a Hardness too, but
    // no Zone, so they stay where they were.
    const parent = item?._cat?.parent || category || '';
    if ((item?.Zone && item?.Hardness) || (!item && /armor|armour/i.test(parent))) {
      armour.push({
        name,
        zone: item?.Zone || '',
        hardness: item?.Hardness || '',
        health: Number(item?.['Health Levels']) || 0,
        // "Movement Rate -2" in the Notes is what the suit costs you.
        slows: Number(String(item?.Notes || '').match(/Movement Rate\s*[-−](\d+)/)?.[1]) || 0,
      });
    } else if (item && item.Damage) {
      weapons.push({
        name,
        damage: item.Damage || '',
        range: item['Range (Normal / Long)'] || item.Range || '',
        ammo: item.Ammo || '',
        reload: item.Reload || '',
      });
    } else {
      gear.push(name);
    }
  }

  (state.gearPurchases || []).forEach((p) => file(p.name, p.category, p));

  // A conjured weapon is not gear a character bought, but it is a weapon
  // they fight with, so it goes where the weapons are - first, because
  // it is the one they call rather than carry.
  const conjured = conjuredWeapon(state, catalog);
  if (conjured) weapons.unshift(conjured);
  // A Gift that attacks is an attack, and attacks belong with the
  // weapons - not buried three pages away on a card.
  weapons.push(...giftWeapons(state, data));

  // A starting package is a list of things, not one thing. Printed as a
  // single line it ran three slots past the edge of the box and was cut
  // off mid-sentence, and the grenade launcher in it never reached the
  // Weapons block. Each entry is filed as though it had been bought.
  Object.values(state.everymanGearPackages || {})
    .sort((a, b) => a.level - b.level)
    .forEach((p) => {
      gear.push(`${p.name} - Level ${p.level} package`);
      packageItems(p.contents).forEach((name) => file(name, ''));
    });
  (state.flavorItems || []).forEach((t) => gear.push(t));

  // Damage is remembered by item, not by row: a row number moves when
  // something is bought or dropped, and the dent would move with it. Two
  // of the same thing are told apart by which one it is.
  const seen = {};
  armour.forEach((a) => {
    seen[a.name] = (seen[a.name] ?? 0) + 1;
    a.key = `${a.name}#${seen[a.name]}`;
    const lost = Number(state.armourDamage?.[a.key]) || 0;
    a.current = Math.max(0, a.health - lost);
    if (a.health > 0 && a.current === 0) a.broken = true;
  });

  return { weapons, armour, gear };
}

// The scar log predates the sheet and only recorded physical or not.
// Reading a `kind` when there is one and falling back to that flag keeps
// every character already saved working, and new scars written from the
// sheet carry the finer split.
export function scarsOfKind(state, kind) {
  return (state.scars || []).filter(
    (s) => (s.kind ?? (s.physical ? 'battle' : 'mental')) === kind,
  );
}


// A Secret is not "Secret", it is the thing you are hiding; a Notable
// Appearance is what people notice. The creator asks, and the answer is
// the useful half - so the sheet prints it beside the name rather than
// leaving the player to remember which secret this was.
export function named(name, notes) {
  const written = (notes || []).filter(Boolean).join('; ');
  return written ? `${name} - ${written}` : name;
}

export const FIGURED_KEYS = {
  Defence: 'Defense',
  SocialDef: 'Social Defense',
  MentalDef: 'Mental Defense',
  Movement: 'Movement Rate',
  Carry: 'Carrying Capacity',
};

// Everything movement.md derives from Movement Rate, Air and Stamina, with
// what slows it applied: worn armour's Movement Rate penalty first, then
// Exhausted 3 halving what is left (rules.md, Exhausted), rounded up the
// way the book rounds every half.
export function movementFigures(state, figured, armour = []) {
  const base = figured['Movement Rate'];
  const slowedBy = armour.filter((a) => a.slows && !a.broken).map((a) => ({ name: a.name, by: a.slows }));
  let rate = Math.max(1, base - slowedBy.reduce((n, a) => n + a.by, 0));
  const exhausted = (Number(state.exhausted) || 0) >= 3;
  if (exhausted) rate = Math.ceil(rate / 2);
  const air = Number(state.attributes?.Air) || 0;
  const stamina = Number(state.subStats?.Stamina) || 0;
  return {
    base, slowedBy, exhausted, rate,
    dash: rate * 2,
    sprint: rate * 5,
    runJump: air,
    standJump: air / 2,
    highRun: air / 2,
    highStand: air / 4,
    pace: 3 + air / 5,
    day: 4 + stamina,
  };
}

// Everything a sheet shows, collected once. Slot N in any block is entry
// N here, so the printed page and the panel list the same things in the
// same order.
export function sheetContext(state, data) {
  const figured = computeFiguredCharacteristics(state);
  const { weapons, armour, gear } = splitGear(state, data);
  const ctx = {
    state,
    data,
    figured,
    skills: takenSkills(state, data),
    flaws: (state.flaws || []).filter((f) => f.level > 0),
    resources: takenResources(state, data),
    gifts: takenGifts(state),
    weapons,
    armour,
    gear,
    // A Gift's levels are rows of {level, effect}; what the character can
    // do is the row they have reached. Gifts built from a menu instead
    // carry no level table at all, so those fall back to their own text.
    giftEffect: (g) => {
      const entry = (data.gifts || []).find((d) => d.name === g.name);
      if (!entry) return '';
      const row = (entry.levels || []).find((l) => l.level === g.level);
      // A menu Gift is what was bought from the menu, build by build.
      if (entry.menu && (g.buildPurchases || []).length) {
        const builds = giftMenuBuilds(g);
        const list = (b) => giftMenuPurchases(g, b)
          .map((p) => (p.note ? `${p.option} (${p.note})` : p.option)).join(', ') || 'nothing yet';
        return builds.length > 1
          ? builds.map((b) => `${giftMenuBuildName(g, b)}: ${list(b)}`).join('. ')
          : list(1);
      }
      // Gifts built from a menu have no Level table, so their text comes
      // from the body - but the first line of a body is a heading, a rule
      // or a table row as often as it is prose.
      const prose = (line) => {
        const t = line.trim();
        return t && !t.startsWith('#') && !t.startsWith('|') && !t.startsWith('-');
      };
      const raw = row
        ? (row.effect || '')
        : ((entry.markdown || '').split(/\r?\n/).find(prose) || '');
      // The rules are markdown; the sheet is a printed page. Emphasis
      // markers and link brackets are noise once there is no renderer.
      return raw
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/<br\s*\/?>/gi, ' ')
        .trim();
    },
    giftKi: (g) => giftKi(g, data),
    giftText: (g) => ctx.giftEffect(g),
  };
  return ctx;
}

// The state each Vital is in, or null where there is nothing to say.
// Unstoppable keeps a character on their feet at 0 and below.
export function vitalStatuses(state, figured) {
  const unstoppable = (state.boons || []).some((b) => b.name === 'Unstoppable');
  let health = healthStatus(state.currentHealth, figured['Health Levels']);
  if (unstoppable && health === 'Unconscious') health = null;
  return {
    health,
    poise: poiseStatus(state.currentPoise),
    sanity: sanityStatus(state.currentSanity),
  };
}

// What the sheet's buttons do. Each changes the character and nothing
// else: the caller saves and redraws. `notice` is how a sheet says
// something out loud - a Vital reset at its floor, a Fate spend over the
// Scene's limit, the sunrise Token - because a number that jumps looks
// like a bug unless something says why.
export function sheetActions(state, data, figured, notice = () => {}) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // The floor rules live in state.js, shared with the GM's combat
  // tracker.
  function floor(track, max) {
    state.floorNote = null;
    applyVitalFloor(state, track, max, figured);
    if (state.floorNote) notice(state.floorNote);
    delete state.floorNote;
  }

  const steppers = {
    'vital.health': {
      get: () => state.currentHealth,
      set: (v) => { state.currentHealth = v; },
      lo: () => -figured['Health Levels'], hi: () => figured['Health Levels'],
    },
    // Poise and Sanity run as far below 0 as above it. Reaching the bottom
    // is not a stop but a reset (rules.md, Poise and Sanity): back to 0,
    // and a Poise floor costs a Sanity Level on the way.
    'vital.poise': {
      get: () => state.currentPoise,
      set: (v) => { state.currentPoise = v; floor('Poise', figured.Poise); },
      lo: () => -figured.Poise, hi: () => figured.Poise,
    },
    'vital.sanity': {
      get: () => state.currentSanity,
      set: (v) => { state.currentSanity = v; floor('Sanity', figured.Sanity); },
      lo: () => -figured.Sanity, hi: () => figured.Sanity,
    },
    'pool.ki': {
      get: () => state.currentKi,
      set: (v) => { state.currentKi = v; },
      lo: () => 0, hi: () => figured.Ki,
    },
    // Earning a Token and spending one are different events (fate.md):
    // the - spends, and counts against the Scene's limit of Stamina
    // spends; the + only ever earns. It used to undo a spend, so a Token
    // earned mid-Scene quietly erased one already used.
    'pool.fate': {
      get: () => state.currentFateTokens,
      set: (v) => {
        if (v < state.currentFateTokens) {
          const spent = state.fateSpentThisScene ?? 0;
          const limit = Number(state.subStats?.Stamina) || 0;
          if (spent >= limit) {
            notice(`Stamina ${limit}: that's ${limit} Fate Token spend${limit === 1 ? '' : 's'} this Scene, the most you can make. Start a new Scene to spend again.`);
            return;
          }
          state.fateSpentThisScene = spent + 1;
        }
        state.currentFateTokens = v;
      },
      lo: () => 0, hi: () => fateTokenCap(state, data),
    },
    exhausted: {
      get: () => state.exhausted ?? 0,
      set: (v) => { state.exhausted = v; },
      lo: () => 0, hi: () => 5,
    },
  };

  return {
    steppers,
    // One step up or down on a track, inside its limits.
    step(key, by) {
      const t = steppers[key];
      t.set(clamp(t.get() + by, t.lo(), t.hi()));
    },
    // Armour loses at most one Health Level an attack and breaks at 0
    // (rules.md, Armor & Called Shots). Damage is kept by item key, not
    // row, so it stays with the thing that took it.
    dentArmour(a, by) {
      state.armourDamage = state.armourDamage || {};
      const lost = Number(state.armourDamage[a.key]) || 0;
      const next = clamp(lost + by, 0, a.health);
      if (next) state.armourDamage[a.key] = next;
      else delete state.armourDamage[a.key];
    },
    // A new Scene clears the Fate Token tally - the per-Scene limit is
    // Stamina spends, and this is where the count starts over.
    newScene() {
      state.fateSpentThisScene = 0;
      notice('New Scene: Fate Token spends reset.');
    },
    // One Short Rest's worth between full nights (rules.md, Rests). A
    // Full Night's Rest brings a Fate Token up with the sun (fate.md), and
    // one earned at the holding cap is lost rather than banked. Returns
    // false when the rest was refused.
    rest(full) {
      if (!full && state.shortRestTaken) {
        notice("Already had a Short Rest. A Full Night's Rest resets it.");
        return false;
      }
      applyRest(state, full);
      if (!full) {
        state.shortRestTaken = true;
        return true;
      }
      state.shortRestTaken = false;
      const cap = fateTokenCap(state, data);
      const before = state.currentFateTokens ?? 0;
      state.currentFateTokens = Math.min(cap, before + 1);
      notice(state.currentFateTokens > before
        ? 'Morning: +1 Fate Token.'
        : `Morning: at the cap of ${cap} Fate Tokens, so the sunrise Token is lost.`);
      return true;
    },
  };
}
