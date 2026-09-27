// The Battle Tracker's library: the bundled bestiary and the GM's own
// catalogue, in one list the GM searches, sorts with tags and adds to a
// fight from.
//
// Two kinds of entry, never squeezed into one:
//   - a character: a Character Creator export - a PC, an NPC, anything
//     built in the Creator. It carries its whole state.
//   - a creature: a stat block as the book prints it (app/parse/creatures.js)
//     - Attack, Defense, Health Levels, named attacks with their dice,
//     Skills and Traits as written.
//
// Bundled creatures come from the rules and are the same for every GM;
// their pack tags (Mundane Beasts, Cryptids...) are fixed. The GM's own
// entries, and the GM's own tags on anything, are kept in this browser
// (IndexedDB - a catalogue of characters with token art outgrows
// localStorage quickly) and travel between machines as an exported file.

export const BACKUP_FORMAT = '20below-library';
const DB_NAME = '20below-library';
const DB_VERSION = 1;

// ---------------------------------------------------------------------------
// what a file is
// ---------------------------------------------------------------------------

export function isCharacter(data) {
  return !!(data && typeof data === 'object' && data.attributes && data.subStats);
}

export function isCreature(data) {
  return !!(data && typeof data === 'object' && data.kind === 'creature' && data.stats);
}

// What an imported file holds: one entry, or a whole backup.
export function classify(data) {
  if (data && data.format === BACKUP_FORMAT && Array.isArray(data.entries)) return 'backup';
  if (isCreature(data)) return 'creature';
  if (isCharacter(data)) return 'character';
  return null;
}

export function newId() {
  return `mine:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// A GM's entry, from a character export or a creature block.
export function mineEntry(data, { icon = null, tags = [] } = {}) {
  const kind = isCreature(data) ? 'creature' : 'character';
  return {
    id: newId(),
    kind,
    name: data.name || 'Unnamed',
    data,
    icon,
    tags: [...new Set(tags.filter(Boolean))],
    added: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// The GM's catalogue. Falls back to a memory-only store when the browser
// refuses IndexedDB (a private window, blocked storage), so the tracker
// still works for the session - it says so, and nothing is kept.
export async function openLibrary() {
  if (typeof indexedDB === 'undefined') return memoryLibrary();
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const d = open.result;
        if (!d.objectStoreNames.contains('entries')) d.createObjectStore('entries', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  } catch {
    return memoryLibrary();
  }
  const store = (name, mode = 'readonly') => db.transaction(name, mode).objectStore(name);
  return {
    persistent: true,
    all: () => request(store('entries').getAll()),
    put: (entry) => request(store('entries', 'readwrite').put(entry)),
    remove: (id) => request(store('entries', 'readwrite').delete(id)),
    getMeta: async (key, fallback) => (await request(store('meta').get(key))) ?? fallback,
    setMeta: (key, value) => request(store('meta', 'readwrite').put(value, key)),
  };
}

function memoryLibrary() {
  const entries = new Map();
  const meta = new Map();
  return {
    persistent: false,
    all: async () => [...entries.values()],
    put: async (e) => { entries.set(e.id, e); },
    remove: async (id) => { entries.delete(id); },
    getMeta: async (key, fallback) => (meta.has(key) ? meta.get(key) : fallback),
    setMeta: async (key, value) => { meta.set(key, value); },
  };
}

// ---------------------------------------------------------------------------
// tags and finding things
// ---------------------------------------------------------------------------

// Tags on an entry: a bundled creature's pack tags, fixed, plus whatever
// the GM put on it. `bundledTags` is the GM's own tags on bundled
// creatures, keyed by id - the creature itself never changes.
export function tagsOf(entry, bundledTags = {}) {
  if (entry.id.startsWith('bestiary:')) {
    return { fixed: entry.tags || [], own: bundledTags[entry.id] || [] };
  }
  return { fixed: [], own: entry.tags || [] };
}

// The packs, in the order they are printed, then the kinds of variant.
// Where a creature lives (Farm & Rural, Aquatic...) follows, as printed.
const PACK_ORDER = ['Mundane Beasts', 'Beast Variants', 'Cryptids', 'Nightmare Creatures', 'Dire', 'Giant', 'Mutated'];

// Every tag in use: the packs and variants first, then where things live,
// then the GM's own, alphabetical.
export function allTags(bundled, mine, bundledTags = {}) {
  const seen = [];
  bundled.forEach((c) => (c.tags || []).forEach((t) => { if (!seen.includes(t)) seen.push(t); }));
  const fixed = [...PACK_ORDER.filter((t) => seen.includes(t)), ...seen.filter((t) => !PACK_ORDER.includes(t))];
  const own = new Set();
  mine.forEach((e) => (e.tags || []).forEach((t) => own.add(t)));
  Object.values(bundledTags).forEach((list) => list.forEach((t) => own.add(t)));
  return { fixed, own: [...own].filter((t) => !fixed.includes(t)).sort((a, b) => a.localeCompare(b)) };
}

// A name, a tag or a word from the description, and every picked tag.
export function matches(entry, { query = '', tags = [], source = 'all' } = {}, bundledTags = {}) {
  const bundled = entry.id.startsWith('bestiary:');
  if (source === 'bestiary' && !bundled) return false;
  if (source === 'mine' && bundled) return false;
  const { fixed, own } = tagsOf(entry, bundledTags);
  const all = [...fixed, ...own];
  if (tags.some((t) => !all.includes(t))) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const data = entry.data || entry;
  const haystack = [entry.name, ...all, data.concept, data.description, entry.family]
    .filter(Boolean).join(' ').toLowerCase();
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

// ---------------------------------------------------------------------------
// backups
// ---------------------------------------------------------------------------

export function exportLibrary(mine, bundledTags, headings = [], encounters = []) {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exported: new Date().toISOString(),
    entries: mine,
    bundledTags,
    headings,
    // Premade fights travel with everything else, which is how one made on
    // the site or the desktop reaches the Owlbear tracker.
    encounters,
  };
}

// A backup brought back in. An entry already here (same id) is replaced
// rather than doubled, so importing the same backup twice is harmless;
// the GM's tags on bundled creatures are merged, not overwritten.
export function mergeBackup(backup, bundledTags) {
  const entries = backup.entries
    .filter((e) => e && e.id && e.data && classify(e.data))
    .map((e) => ({ ...e, kind: isCreature(e.data) ? 'creature' : 'character', tags: e.tags || [] }));
  const tags = { ...bundledTags };
  Object.entries(backup.bundledTags || {}).forEach(([id, list]) => {
    tags[id] = [...new Set([...(tags[id] || []), ...list])];
  });
  const encounters = (backup.encounters || []).filter((x) => x && x.id && Array.isArray(x.members));
  return { entries, bundledTags: tags, headings: backup.headings || [], encounters };
}

// ---------------------------------------------------------------------------
// headings
// ---------------------------------------------------------------------------
//
// A heading is a group the GM makes in the Catalog - an enemy organization,
// a faction, a session - shown like a pack, holding their own entries and
// bundled creatures alike. Underneath it is a tag the list shows as a group,
// so putting an entry under one, searching it and exporting it all work the
// way tags already do. `headings` is the list of names, in the GM's order.

// A tag renamed everywhere it is used: on the GM's entries and on the
// bundled creatures they tagged. Returns the entries that changed.
export function renameTag(mine, bundledTags, from, to) {
  const changed = [];
  mine.forEach((e) => {
    if ((e.tags || []).includes(from)) {
      e.tags = [...new Set(e.tags.map((t) => (t === from ? to : t)))];
      changed.push(e);
    }
  });
  Object.keys(bundledTags).forEach((id) => {
    bundledTags[id] = [...new Set(bundledTags[id].map((t) => (t === from ? to : t)))];
  });
  return changed;
}

// A tag taken off everything. The entries stay.
export function dropTag(mine, bundledTags, tag) {
  const changed = [];
  mine.forEach((e) => {
    if ((e.tags || []).includes(tag)) {
      e.tags = e.tags.filter((t) => t !== tag);
      changed.push(e);
    }
  });
  Object.keys(bundledTags).forEach((id) => {
    bundledTags[id] = bundledTags[id].filter((t) => t !== tag);
    if (!bundledTags[id].length) delete bundledTags[id];
  });
  return changed;
}

// ---------------------------------------------------------------------------
// into a fight
// ---------------------------------------------------------------------------

// The combat engine counts Health, Poise, Sanity and Initiative the way it
// counts a character's, from sub-stats. A creature's block prints the
// results instead, so this works them back: Health Levels 7 is Health 2,
// Defense 5 is Atropos 5, and a Mental Defense with no Presence printed is
// read as 10 - Presence. The block itself rides along untouched, and is
// what the tracker shows and rolls from.
export function creatureState(creature, name = creature.name) {
  const s = creature.stats || {};
  const presence = s.Presence ?? (s['Mental Defense'] != null ? 10 - s['Mental Defense'] : 0);
  const psyche = s.Psyche ?? (s['Social Defense'] != null ? 10 - s['Social Defense'] : 0);
  const move = s['Movement Rate'] ?? 5;
  // Under its name in the fight, a creature shows the numbers the GM
  // reaches for; the description is one click away.
  const line = [`Attack ${s.Attack ?? '-'}`, `Defense ${s.Defense ?? '-'}`, `Soak ${s.Soak ?? '-'}`,
    ...(creature.attacks || []).slice(0, 2).map((a) => `${a.name} ${a.dice} ${a.dice === 1 ? 'die' : 'dice'}`)];
  return {
    name,
    concept: line.join(' · '),
    kind: 'creature',
    creature,
    // Movement is 5 + Air, so a snake at 3 m has Air -2. Nobody sees it.
    attributes: { Earth: 0, Air: move - 5, Fire: 0, Water: 0, Moira: 0 },
    subStats: {
      Soak: s.Soak ?? 0,
      Potence: s.Potence ?? 0,
      Initiative: s.Initiative ?? 0,
      Psyche: psyche,
      Ferocity: s.Ferocity ?? 0,
      Presence: presence,
      Stamina: s.Stamina ?? 0,
      Health: (s['Health Levels'] ?? 5) - 5,
      Atropos: 10 - (s.Defense ?? 10),
      Klotho: 0,
    },
    skills: {},
    gifts: [],
    boons: [],
    flaws: [],
  };
}

// The name a combatant goes by: a second Coyote in the same fight is
// "Coyote 2", so the turn order and the tokens can tell them apart.
export function uniqueName(name, taken) {
  if (!taken.includes(name)) return name;
  let n = 2;
  while (taken.includes(`${name} ${n}`)) n += 1;
  return `${name} ${n}`;
}
