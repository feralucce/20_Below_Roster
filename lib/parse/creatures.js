// The bestiary, read out of the rules the way the book prints it.
//
// Every creature is an adversary card - <table class="adversary-card"> -
// holding a heading, a paragraph of what it is, and a stat block:
//
//   **Soak** 0 · **Attack** 3 · **Defense** 7 · **Health Levels** 1 · **Movement Rate** 6m
//   **Potence** 1 · **Initiative** 1 · **Psyche** 1 · **Ferocity** 1 · **Presence** 1 · **Stamina** 6
//   **Bite / Wing Buffet**: 1 die, Melee
//   **Hiss**: 4 dice, Close, **Social** - dice against the target's Presence, ...
//   **Notable Skills**: Athletics TN 6
//   **Traits**: **Relentless** - keeps attacking after taking damage ...
//
// A creature is kept as that block, not squeezed into a character: its
// Attack is the number it rolls to hit with, its attacks are the named
// lines with their dice, and its Traits stay the book's own words. The
// Battle Tracker rolls it exactly as printed.
//
// Pure: hand it the markdown of one rules file, get creatures back. The
// browser and the extension build both run it.

// Which book each rules file is, and the tags every creature in it wears.
// These are the pack tags: fixed, and what the library divides by.
export const BESTIARY_SOURCES = [
  { file: 'adversary-index.md', pack: 'Mundane Beasts' },
  { file: 'cryptids.md', pack: 'Cryptids' },
  { file: 'nightmare-creatures.md', pack: 'Nightmare Creatures' },
];

// A Dire, Giant or Mutated animal is a Beast Variant, whichever file it
// is printed in, and says which kind it is.
const VARIANT = /^(Dire|Giant|Mutated)\s/;

// Stats that sit on the block's number lines as "**Name** value".
const NUMBER_STATS = [
  'Soak', 'Attack', 'Defense', 'Social Defense', 'Mental Defense', 'Health Levels',
  'Movement Rate', 'Potence', 'Initiative', 'Psyche', 'Ferocity', 'Presence', 'Stamina',
];

export function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// "**Soak** 0 · **Attack** 3 · **Movement Rate** 6m" -> { Soak: 0, ... }.
// Movement keeps its number; the metres are the rule's, not the value's.
function readNumbers(line, into) {
  let found = 0;
  const pair = /\*\*([^*]+)\*\*\s*(-?\d+)/g;
  let m;
  while ((m = pair.exec(line))) {
    const name = m[1].trim();
    if (NUMBER_STATS.includes(name)) {
      into[name] = Number(m[2]);
      found += 1;
    }
  }
  return found;
}

// "**Bite / Wing Buffet**: 1 die, Melee" or
// "**Hiss**: 4 dice, Close, **Social** - dice against the target's Presence".
// The kind is Physical unless the line says Social or Mental; the wall is
// the kind's own (Soak, Presence, Psyche).
// A few older cards leave the word out and put a condition first:
// "**Knife** (only if cornered): 2, Melee". Same attack, read the same.
const ATTACK_LINE = /^\*\*([^*]+)\*\*\s*(\([^)]*\))?:\s*(\d+)(?:\s+(?:dice|die)\b\s*,?|\s*,)\s*(.*)$/;
const WALL = { Physical: 'Soak', Social: 'Presence', Mental: 'Psyche' };

function readAttack(line) {
  const m = ATTACK_LINE.exec(line);
  if (!m) return null;
  const rest = m[4].trim();
  const kind = /\*\*Social\*\*/.test(rest) ? 'Social' : /\*\*Mental\*\*/.test(rest) ? 'Mental' : 'Physical';
  const range = (rest.split(/,|\s-\s|\.(?:\s|$)/)[0] || '').replace(/\*\*/g, '').trim();
  return {
    name: m[1].trim(),
    when: m[2] ? m[2].slice(1, -1).trim() : '',
    dice: Number(m[3]),
    range: /Social|Mental/.test(range) ? '' : range,
    kind,
    wall: WALL[kind],
    // The whole line, for what the numbers do not say: a range pair, "no
    // to-hit roll required", what a connecting die costs.
    text: line,
  };
}

function cards(markdown) {
  const out = [];
  const text = markdown.replace(/\r\n/g, '\n');
  const open = /<table class="adversary-card">/g;
  let m;
  while ((m = open.exec(text))) {
    const end = text.indexOf('</table>', m.index);
    if (end < 0) break;
    out.push({ at: m.index, body: text.slice(m.index, end) });
    open.lastIndex = end;
  }
  return { text, cards: out };
}

// The nearest heading of a depth above a point in the file: the section
// (## Farm & Rural) and the animal it belongs to (### Aggressive Goose).
function headingBefore(text, at, hashes) {
  const re = new RegExp(`^${hashes} (.+)$`, 'gm');
  let last = null;
  let m;
  while ((m = re.exec(text)) && m.index < at) last = m[1].trim();
  return last;
}

export function parseCreatures(markdown, source) {
  const { text, cards: found } = cards(markdown);
  const creatures = [];
  for (const card of found) {
    const lines = card.body.split('\n').map((l) => l.trim());
    const headingLine = lines.find((l) => /^#{3,4} /.test(l));
    if (!headingLine) continue;
    const name = headingLine.replace(/^#+\s*/, '').trim();
    // "How to read a stat block" walks through an example; it is not a
    // creature anyone fights.
    if (/^Example\b/i.test(name)) continue;

    const stats = {};
    const attacks = [];
    const other = [];
    let description = '';
    let skills = '';
    let traits = '';
    lines.forEach((line) => {
      if (!line || line === headingLine || line.startsWith('<') || /^-{3,}$/.test(line)) return;
      if (/^\*\*Notable Skills\*\*:/.test(line)) { skills = line.replace(/^\*\*Notable Skills\*\*:\s*/, ''); return; }
      if (/^\*\*Traits?\*\*:/.test(line)) { traits = line.replace(/^\*\*Traits?\*\*:\s*/, ''); return; }
      const attack = readAttack(line);
      if (attack) { attacks.push(attack); return; }
      if (line.startsWith('**') && readNumbers(line, stats)) return;
      if (!description && !line.startsWith('**')) { description = line; return; }
      other.push(line);
    });

    const variant = VARIANT.exec(name)?.[1] || null;
    const pack = variant ? 'Beast Variants' : source.pack;
    const tags = [pack];
    if (variant) tags.push(variant);
    const section = headingBefore(text, card.at, '##');
    if (section && section !== 'Contents' && !/Beast Variants/i.test(section)) tags.push(section);

    creatures.push({
      id: `bestiary:${slug(name)}`,
      kind: 'creature',
      name,
      pack,
      tags,
      family: source.file === 'adversary-index.md' ? headingBefore(text, card.at, '###') : null,
      description,
      stats,
      attacks,
      skills,
      traits,
      notes: other.join('\n'),
      source: source.file,
    });
  }
  return creatures;
}

// The book saves space by borrowing: "**Ambush Predator** (as Mountain
// Lion)" means the Mountain Lion's Ambush Predator, whose words are on its
// own card. A GM at the table should not have to go and find it, so the
// borrowed text is written into the bracket, after the book's own words:
// "(as Mountain Lion: Advantage on its first attack roll if ...)". A note in
// the bracket stays ("Feral Dog, applies within a pod"), and so does
// anything the card says after it ("... when attacking from open water").
function traitText(creature, trait) {
  const esc = trait.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`\\*\\*${esc}\\*\\*\\s*[-–—:]\\s*([\\s\\S]*?)(?=\\s*\\*\\*[^*]+\\*\\*\\s*(?:[-–—:]|\\(as )|$)`)
    .exec(creature.traits || '');
  return m ? m[1].trim().replace(/\.$/, '') : null;
}

export function resolveBorrowedTraits(creatures) {
  const byName = new Map(creatures.map((c) => [c.name.toLowerCase(), c]));
  const fill = (text) => String(text || '').replace(/\*\*([^*]+)\*\*\s*\(as ([^)]+)\)/g, (whole, trait, as) => {
    const from = byName.get(as.split(',')[0].trim().toLowerCase());
    const words = from && traitText(from, trait.trim());
    return words ? `**${trait}** (as ${as}: ${words})` : whole;
  });
  creatures.forEach((c) => {
    c.traits = fill(c.traits);
    c.notes = fill(c.notes);
  });
  return creatures;
}

// Every creature in every bestiary file. `read` fetches one rules file by
// name and returns its markdown (fetchText in the browser, a file read in
// the extension build).
export async function loadBestiary(read) {
  const all = [];
  for (const source of BESTIARY_SOURCES) {
    all.push(...parseCreatures(await read(source.file), source));
  }
  return resolveBorrowedTraits(all);
}
