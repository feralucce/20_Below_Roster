// The windows a character sheet opens over itself: the Roll dice window,
// Initiative inside it, Movement worked out for the character, and what a
// Gift does for them. Shared by the Creator's printed sheet and the
// Owlbear Rodeo character sheet, so a roll or an explanation reads the
// same in both.

import { el, renderMarkdown } from '../ui.js';
import {
  giftNotes, optionChoice, giftMenuBuilds, giftMenuBuildName, giftMenuPurchases,
} from '../state.js';
import {
  buildQuickAttack, buildQuickSkill, buildGiftCheckSection,
  buildCreatureAttack, buildCreatureSkills,
} from '../steps/roller-panel.js';

// Everything a Gift does for this character, in one place: its Level,
// its build if it has a menu, and its Adders and Limiters with their
// rules and any choice made for them.
export function giftInfoPanel(g, data) {
  const entry = (data.gifts || []).find((d) => d.name === g.name);
  if (!entry) return [el('h3', {}, g.name), el('p', {}, 'This Gift is not in the current rules.')];
  const md = (text) => el('div', { class: 'gift-info-text', html: renderMarkdown(text || '') });
  const out = [el('h3', {}, `${g.name} - Level ${g.level}`)];
  const notes = giftNotes(g).filter(Boolean);
  if (notes.length) out.push(el('p', { class: 'roller-howto' }, notes.join(' - ')));

  // Levels build on each other, so every one the character has counts.
  (entry.levels || []).filter((l) => l.level <= g.level).forEach((l) => {
    out.push(el('h4', {}, `Level ${l.level}`), md(l.effect));
  });

  if (entry.menu) {
    const builds = giftMenuBuilds(g);
    builds.forEach((b) => {
      const bought = giftMenuPurchases(g, b);
      out.push(el('h4', {}, builds.length > 1 ? giftMenuBuildName(g, b) : 'Build'));
      if (!bought.length) {
        out.push(el('p', { class: 'hint' }, 'Nothing bought from the menu yet.'));
        return;
      }
      out.push(el('ul', { class: 'gift-info-list' }, bought.map((p) => {
        const key = String(p.option).toLowerCase();
        const item = entry.menu.items.find((i) => i.option.toLowerCase() === key);
        return el('li', {}, [
          el('strong', {}, p.option), p.note ? ` (${p.note})` : '', ` - ${p.cost} pt${p.cost === 1 ? '' : 's'}`,
          item ? md(item.effect)
            : el('p', { class: 'hint' }, "No longer on this Gift's menu in the current rules."),
        ]);
      })));
    });
  }

  const section = (title, names, list) => {
    if (!names.length) return;
    out.push(el('h4', {}, title), el('ul', { class: 'gift-info-list' }, names.map((name) => {
      const opt = list.find((o) => o.name === name);
      const picked = optionChoice(g, name).filter(Boolean);
      return el('li', {}, [
        el('strong', {}, name), picked.length ? ` (${picked.join(', ')})` : '',
        opt ? md(opt.text) : '',
      ]);
    })));
  };
  section('Adders', [...new Set(g.adders || [])], entry.adders || []);
  section('Limiters', g.limiters || [], entry.limiters || []);
  return out;
}

// 1d10 + Initiative, once at the start of a fight. Two dice keeping
// the higher for Enhanced Speed 3, or when something grants Advantage
// on it (Danger Instinct) - the box is there for that one.
// `sent` replaces the closing advice where the roll reaches the GM by
// itself (the Owlbear Character Sheet, with the Battle Tracker open).
export function initiativePanel({ initiative, speed, sent = null }, onRolled = () => {}) {
  let advantage = speed >= 3;
  const result = el('div', { class: 'roller-result' });
  const d10 = () => 1 + Math.floor(Math.random() * 10);
  const adv = el('label', { class: 'roller-row' }, [
    el('input', {
      type: 'checkbox',
      checked: advantage ? '' : undefined,
      onChange: (e) => { advantage = e.target.checked; },
    }),
    speed >= 3
      ? ' Roll 2d10, keep the higher (Enhanced Speed 3)'
      : ' Roll 2d10, keep the higher (Advantage, e.g. Danger Instinct)',
  ]);
  const roll = el('button', {
    type: 'button',
    class: 'roll-btn',
    text: 'Roll Initiative',
    onClick: () => {
      const dice = advantage ? [d10(), d10()] : [d10()];
      const kept = Math.max(...dice);
      onRolled({
        kind: 'Initiative',
        headline: `Initiative ${kept + initiative}`,
        initiative: kept + initiative,
        detail: `${dice.length > 1 ? `Rolled ${dice.join(', ')}, kept ${kept}` : `Rolled ${kept}`} + ${initiative}`,
        success: true,
      });
      result.innerHTML = '';
      result.append(
        el('p', {}, dice.length > 1 ? `Rolled ${dice.join(', ')}, kept ${kept}` : `Rolled ${kept}`),
        el('p', { class: 'status-ok' }, [el('strong', {}, `Initiative ${kept + initiative}`),
          ` (${kept} + ${initiative}). ${sent || 'Tell the GM; it holds for the whole fight.'}`]),
      );
    },
  });
  return [
    el('h4', {}, 'Initiative'),
    el('p', { class: 'roller-howto' },
      `Rolled once, at the start of a fight: 1d10 + your Initiative (${initiative}). Higher goes first within each band.`),
    adv, roll, result,
  ];
}

// movement.md, laid out for this character. Nothing to roll: these are
// the distances, so nobody has to multiply at the table.
export function movementPanel(m) {
  const n = (v) => String(Number(v.toFixed(2)));
  const why = [
    ...m.slowedBy.map((a) => `${a.name} -${a.by}`),
    m.exhausted ? 'Exhausted 3: halved' : null,
  ].filter(Boolean);
  const row = (what, how, value) => el('tr', {}, [
    el('td', {}, [el('strong', {}, what)]), el('td', {}, how), el('td', {}, value)]);
  return [
    el('h3', {}, 'Movement'),
    el('p', { class: 'roller-howto' }, why.length
      ? `Movement Rate ${m.base}, down to ${m.rate}: ${why.join(', ')}.`
      : `Movement Rate ${m.rate}: 5 + Air.`),
    el('table', { class: 'menu-table movement-table' }, [
      el('tr', {}, [el('th', {}, 'In combat'), el('th', {}, 'Action'), el('th', {}, 'Distance')]),
      row('Move', 'Part of any action', `${m.rate} m`),
      row('Dash', 'Normal: both actions on movement', `${m.dash} m`),
      row('Sprint', 'Slow: nothing else; 1 Ki to Normal, 2 to Fast', `${m.sprint} m`),
      el('tr', {}, [el('th', {}, 'Jumping'), el('th', {}, ''), el('th', {}, '')]),
      row('Long jump', 'Running / standing', `${n(m.runJump)} m / ${n(m.standJump)} m`),
      row('High jump', 'Running / standing', `${n(m.highRun)} m / ${n(m.highStand)} m`),
      el('tr', {}, [el('th', {}, 'Travel'), el('th', {}, ''), el('th', {}, '')]),
      row('Pace', 'Clear ground, 3 + Air/5', `${n(m.pace)} km per hour`),
      row('Travel day', '4 + Stamina hours of walking', `${m.day} hours, ${Math.round(m.pace * m.day)} km`),
    ]),
  ];
}

// The one roller every page shares, on the Creator's sheet and in
// Owlbear. `onKi` redraws whatever shows Ki after a failed Gift Check;
// `onRolled` hears every result, which is how Owlbear posts a roll to
// the room.
export function rollDicePanel(state, data, { onKi = () => {}, onRolled = () => {}, initiativeSent = null } = {}) {
  // Enhanced Speed 3 rolls Initiative as 2d10, keeping the higher die.
  const speed = (state.gifts || []).find((g) => g.name === 'Enhanced Speed')?.level || 0;
  return [
    el('h3', {}, 'Roll dice'),
    // In the order a fight asks for them: who goes first, then the
    // swing, then everything else.
    el('div', { class: 'roller-gift-check' },
      initiativePanel({ initiative: Number(state.subStats?.Initiative) || 0, speed, sent: initiativeSent }, onRolled)),
    buildQuickAttack(state, data, { onRolled }),
    buildQuickSkill(state, data, { onRolled }),
    buildGiftCheckSection(state, data, onKi, { onRolled }),
  ];
}

// A creature's Roll dice window: its printed attacks and its Notable
// Skills, rolled from the stat block. Initiative is rolled on its line in
// the tracker, like everyone else's.
export function creatureRollPanel(creature, name, { onRolled = () => {} } = {}) {
  return [
    el('h3', {}, `${name}: roll dice`),
    buildCreatureAttack(creature, { onRolled }),
    buildCreatureSkills(creature, { onRolled }),
  ].filter(Boolean);
}
