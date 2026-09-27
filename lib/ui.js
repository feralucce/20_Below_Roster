// Small reusable DOM helpers shared by every step module.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== undefined && value !== null) {
      node.setAttribute(key, value);
    }
  });
  (Array.isArray(children) ? children : [children]).forEach((child) => {
    if (child == null) return;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  });
  return node;
}

// Which twirls and <details> the reader has opened, remembered by key
// across re-renders.
//
// Every step rebuilds its whole panel on any change, so an open card is a
// brand new element by the time the change lands. main.js already carried
// open <details> across a rebuild by matching their summary text, but the
// summary is exactly what changes on the interactions that matter: a Gift's
// card is titled "Shapeshifter - Level 2" and buying a level retitles it,
// and an Everyman package's summary carries the word "Selected". The label
// no longer matched, so the card came back shut - which read as "picking
// something closes the card".
//
// A key is stable where the label is not. It is also independent of which
// render path rebuilt the element, so a step that redraws itself without
// going through main.js gets the same treatment for free.
const openState = new Map();

// Wires a name element to show/hide a detail element on click - the "click
// the name, its description twirls out" interaction shared by Boons'
// Available list, Gifts/Resources/Flaws' Available list (description) and
// Gifts' Selected list (adders/limiters). Kept separate from the +/- clicks
// on a counterRow, which live in sibling buttons untouched by this.
//
// Pass a `key` and the twirl remembers its own open state; without one it
// behaves exactly as before and starts from `startOpen`.
export function makeTwirl(nameEl, detailEl, { startOpen = false, key } = {}) {
  nameEl.classList.add('name-toggle');
  let open = key !== undefined && openState.has(key) ? openState.get(key) : startOpen;
  detailEl.style.display = open ? '' : 'none';
  nameEl.classList.toggle('open', open);
  nameEl.addEventListener('click', () => {
    open = !open;
    if (key !== undefined) openState.set(key, open);
    detailEl.style.display = open ? '' : 'none';
    nameEl.classList.toggle('open', open);
  });
  return { get open() { return open; } };
}

// A <details> that remembers whether it was open, by key rather than by its
// summary text. `attrs.open` is the first-time default only - once the
// reader has opened or shut it, their choice wins.
export function keyedDetails(key, attrs = {}) {
  const node = el('details', { ...attrs, 'data-open-key': key });
  if (openState.has(key)) node.open = openState.get(key);
  node.addEventListener('toggle', () => openState.set(key, node.open));
  return node;
}

/* Force a keyed twirl's remembered state.
 *
 * keyedDetails restores whatever the reader last left, which is right for
 * browsing and wrong the moment a choice closes a section: picking a
 * Starting Package should shut that Level, but the remembered "open" won
 * every re-render and it stayed open.
 */
export function setOpenState(key, open) {
  openState.set(key, open);
}

// A labeled +/- counter row. `get`/`set` read and write the current numeric
// value; `min`/`max` may be numbers or functions of no args (re-evaluated on
// every render so they can depend on pool remaining elsewhere in the app).
// `format`, if given, renders the displayed value (e.g. a tier number as its
// tier name) without changing the underlying numeric get/set/min/max logic.
// `detail`, if given, is an element hidden by default and twirled open by
// clicking the name (via makeTwirl) - the row itself (name + counter) always
// stays visible either way.
export function counterRow({ name, hint, get, set, min = 0, max = 99, format, onChange, detail, key }) {
  const row = el('div', { class: 'counter-row' });
  const nameEl = el('span', { class: 'name' }, hint ? `${name} (${hint})` : name);
  const valueEl = el('span', { class: 'value' }, format ? format(get()) : String(get()));
  const resolvedMin = typeof min === 'function' ? min() : min;
  const resolvedMax = typeof max === 'function' ? max() : max;
  const minusBtn = el('button', {
    type: 'button',
    text: '−',
    disabled: get() <= resolvedMin ? '' : undefined,
    onClick: () => {
      if (get() > (typeof min === 'function' ? min() : min)) {
        set(get() - 1);
        onChange?.();
      }
    },
  });
  const plusBtn = el('button', {
    type: 'button',
    text: '+',
    disabled: get() >= resolvedMax ? '' : undefined,
    onClick: () => {
      if (get() < (typeof max === 'function' ? max() : max)) {
        set(get() + 1);
        onChange?.();
      }
    },
  });
  row.append(nameEl, minusBtn, valueEl, plusBtn);
  if (!detail) return row;
  // `name` and not the rendered label: the hint carries the running cost
  // ("3 pts/level, 6 pts spent"), which changes on the very click whose
  // open state we are trying to keep.
  makeTwirl(nameEl, detail, { key: key ?? name });
  return el('div', {}, [row, detail]);
}

/* The one way the app says "you already have this".
 *
 * Boons appended "(taken)" to the name, the shared list drew a bare
 * border, Equipment had its own pill and Skills said nothing. A player
 * scanning four different steps had to learn four different signals.
 */
export function purchasedPill(count = 1) {
  return el('span', { class: 'purchased-pill' },
    count > 1 ? `Purchased x${count}` : 'Purchased');
}

// Splits a catalog into two headed groups - anything currently "selected"
// (per `isSelected`) pops up to a `Selected {label}` list, everything else
// stays down in `Available {label}`. Mirrors the Boons step's Selected/
// Available split for the simpler "one card per catalog entry, 0-5 counter"
// shape used by Skills, Gifts, Resources, and Flaws. `renderCard` builds the
// Available card (name + counter, description twirled out on click);
// `renderSelectedCard` builds the Selected card and defaults to `renderCard`
// if omitted - pass it explicitly when Selected should look different (e.g.
// Gifts twirl adders/limiters there instead of the description). Returns a
// `render()` you can call again after state changes (e.g. a filter box) or
// wire up to call itself via each card's onChange.
export function renderSelectedAvailable(container, {
  label, getItems, isSelected, renderCard, renderSelectedCard,
  // A selected entry used to leave the Available list. For anything with
  // Levels that made raising one almost impossible to do deliberately:
  // the list closed up behind your click, so the next click landed on
  // whatever moved into that position. Taking Wealth to 5 bought five
  // different Resources at 1, and the screen never said so.
  //
  // Selected entries now stay put and are marked. Pass false for a list
  // where picking something really does remove it from play.
  keepSelected = true,
}) {
  const selectedEl = el('div', { class: 'pick-list' });
  const availableEl = el('div', { class: 'pick-list' });
  container.append(
    el('h3', {}, `Selected ${label}`),
    selectedEl,
    el('h3', {}, `Available ${label}`),
    availableEl,
  );
  const selectedRenderer = renderSelectedCard || renderCard;

  function render() {
    selectedEl.innerHTML = '';
    availableEl.innerHTML = '';
    const items = getItems();
    const selected = items.filter(isSelected);
    const available = keepSelected ? items : items.filter((item) => !isSelected(item));
    if (selected.length === 0) {
      selectedEl.appendChild(el('p', { class: 'detail' }, `No ${label} selected yet.`));
    } else {
      selected.forEach((item) => selectedEl.appendChild(selectedRenderer(item)));
    }
    available.forEach((item) => {
      const card = renderCard(item);
      // Marked, not disabled. The Boons step disables a taken Boon because
      // it cannot be bought twice; a taken Resource has to stay live,
      // since raising it is what the player came here to do.
      if (isSelected(item)) {
        card.classList.add('purchased');
        card.prepend(purchasedPill());
      }
      availableEl.appendChild(card);
    });
  }

  render();
  return { render };
}

// The rules files cross-reference each other - "[Action Bracket](rules.md
// #action-brackets)" and about ninety more like it. Rendered inside the app
// those hrefs resolve against /app/, so clicking one asked for app/rules.md:
// a 404 in the browser, and in the desktop app an "asset not found" screen
// with no way back, since it has no browser chrome to go back with.
//
// The reference itself is worth keeping - it tells you the term is defined
// somewhere - so the text stays and only the trap goes. Genuine external
// links still work, in a new tab.
function deadenCrossRefs(html) {
  const box = document.createElement('div');
  box.innerHTML = html;
  box.querySelectorAll('a[href]').forEach((a) => {
    if (/^https?:/i.test(a.getAttribute('href'))) {
      a.target = '_blank';
      a.rel = 'noopener';
      return;
    }
    const span = document.createElement('span');
    span.className = 'xref';
    span.textContent = a.textContent;
    a.replaceWith(span);
  });
  return box.innerHTML;
}

export function renderMarkdown(md) {
  if (window.marked) return deadenCrossRefs(window.marked.parse(md));
  return `<pre>${md}</pre>`;
}

// Same, for a fragment that must stay inside a table cell or a sentence -
// three modules had their own copy of this and every one of them let the
// cross-file links through.
export function renderMarkdownInline(md) {
  if (window.marked) return deadenCrossRefs(window.marked.parseInline(md));
  return md;
}

/* An entry's description, for the top of its opened card.
 *
 * Boons, Flaws and Resources get theirs from rules/flavour.json (see
 * rules-data.js); Gifts already carry theirs in the rules text itself and
 * don't come through here. Returns '' when there is none, so a caller can
 * concatenate it in front of the rules unconditionally.
 *
 * Rendered inline rather than as a block: these are one paragraph, and
 * some of them carry emphasis - Alertness has "never *not* paying
 * attention" - which would be lost by dropping the text in as-is.
 */
export function flavourHtml(entry) {
  const text = entry?.flavour;
  if (!text) return '';
  return `<p class="entry-flavour">${renderMarkdownInline(text)}</p>`;
}

/* The field for whatever the rules asked the player to invent - what the
 * Familiar is, which weapon system was bought, the phrase that has to be
 * said out loud. One helper so a Boon, a Flaw and a Gift all present it
 * the same way, and so the placeholder is worded in one place.
 *
 * No rerender on input: redrawing the step on every keystroke would take
 * the focus out of the field being typed in.
 */
export function describeBox(value, onChange, placeholder, options) {
  // A closed list is a real dropdown: the answer has to be one of these,
  // because something downstream reads it by name.
  if (options && !Array.isArray(options) && options.strict) {
    const list = options.list || [];
    const select = el('select', {
      class: 'describe-box',
      onChange: (e) => onChange(e.target.value),
    }, [
      el('option', { value: '' }, placeholder ?? 'Choose one'),
      ...list.map((o) => el('option', { value: o, selected: o === value ? '' : undefined }, o)),
    ]);
    return select;
  }
  const input = el('input', {
    type: 'text',
    class: 'describe-box',
    placeholder: placeholder ?? 'Describe it',
    value: value ?? '',
    onInput: (e) => onChange(e.target.value),
  });
  if (!options?.length) return input;

  // A list, not a dropdown: Conjured Armory's weapon is an item from the
  // catalogue and the sheet needs the real name to find its Damage - but
  // Armory of Anything exists to conjure a chainsaw, so typing something
  // the catalogue has never heard of has to stay possible.
  const id = `dl-${Math.random().toString(36).slice(2, 9)}`;
  input.setAttribute('list', id);
  const list = el('datalist', { id });
  options.forEach((o) => list.appendChild(el('option', { value: o })));
  return el('div', { class: 'describe-field' }, [input, list]);
}

/* Every field one entry asks for, in order.
 *
 * `count` fields, all carrying the same prompt, because when there are
 * two they are two of the same kind of thing - a second Animal
 * Companion is another animal with another name, not a different
 * question. Numbered only when there is more than one, so the ordinary
 * case stays a single unadorned line.
 */
export function describeBoxes({ count, prompt, prompts, notes, onChange, optionsFor }) {
  const wrap = el('div', { class: 'describe-list' });
  for (let i = 0; i < count; i += 1) {
    // Numbering only makes sense when every slot asks the same question.
    // Two animals is "(1)" and "(2)"; a weapon and its name are not.
    const label = prompts ? (prompts[i] ?? prompt)
      : (count > 1 ? `${prompt} (${i + 1})` : prompt);
    wrap.appendChild(describeBox(notes[i] ?? '', (v) => onChange(i, v), label,
      optionsFor ? optionsFor(i) : null));
  }
  return wrap;
}

export function poolBadge(label, remaining) {
  const cls = remaining < 0 ? 'pool negative' : 'pool';
  return el('span', { class: cls }, `${label}: ${remaining}`);
}
