// Help dialogs: part reference, proxy functions, controls, about.
import { h } from '../core/util.js';
import { PartRegistry } from '../core/part.js';
import { PROXY_FUNCTIONS, PROXY_INPUT_NAMES, EVENTS } from '../core/inputs.js';
import { CATEGORIES } from '../parts/index.js';
import { modal } from './ui.js';

const kbd = (k) => h('kbd', { text: k });

export const help = {
  partReference(focus) {
    const body = h('div', { class: 'ref' });
    for (const [cat, title] of CATEGORIES) {
      body.append(h('h3', { text: title }));
      for (const C of PartRegistry.values()) {
        if (C.category !== cat) continue;
        const props = C.schema.filter((d) => !['Name', 'Hide', 'Notes'].includes(d.name));
        const det = h('details', { open: C.className === focus },
          h('summary', {}, h('span', { text: `${C.icon} ` }), h('b', { text: C.className }), h('span', { class: 'muted', text: ` — ${C.description}` })),
          h('dl', {}, props.map((d) => [h('dt', { text: `${d.name}`, title: d.type }), h('dd', { text: d.help || d.type })])));
        body.append(det);
      }
    }
    modal('Part reference', body);
    const el = body.querySelector('details[open]');
    if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 0);
  },

  functions() {
    const inputs = PROXY_INPUT_NAMES;
    const math = Object.keys(PROXY_FUNCTIONS).filter((n) => !inputs.includes(n) && !/^feedback_|^stime$|^ftime$/.test(n));
    const body = h('div', { class: 'ref' },
      h('p', { text: 'Proxy expressions use Lua-like syntax: + - * / % ^, comparisons, and/or/not, parentheses. Return several values separated by commas to drive a vector or color, e.g. "sin(time()), 0, cos(time())".' }),
      h('p', {}, 'Examples: ', h('code', { text: 'sin(time() * 4) * 10' }), ' · ', h('code', { text: 'owner_velocity_length() / 100' }), ' · ', h('code', { text: 'hsv_to_color(time() * 90, 1, 1)' }), ' · ', h('code', { text: 'is_crouching() > 0 and 20 or 5' })),
      h('h3', { text: 'Inputs' }), h('div', { class: 'chips' }, inputs.map((n) => h('code', { text: `${n}()` }))),
      h('h3', { text: 'Math' }), h('div', { class: 'chips' }, math.map((n) => h('code', { text: `${n}()` }))),
      h('h3', { text: 'Constants' }), h('div', { class: 'chips' }, h('code', { text: 'pi' }), h('code', { text: 'huge' })));
    modal('Proxy functions', body);
  },

  events() {
    const body = h('div', { class: 'ref' }, h('dl', {}, Object.entries(EVENTS).map(([n, e]) => [h('dt', { text: n }), h('dd', { text: `${e.help}${e.args ? ` Arguments: ${e.args}.` : ''}` })])));
    modal('Event types', body);
  },

  controls() {
    const row = (keys, what) => h('tr', {}, h('td', {}, keys.map((k, i) => [i ? ' ' : '', kbd(k)])), h('td', { text: what }));
    const body = h('div', { class: 'ref' },
      h('h3', { text: 'Editor' }),
      h('table', { class: 'keys' },
        row(['W', 'E', 'R'], 'Move / rotate / scale gizmo'), row(['Q'], 'Local / world axes'), row(['F'], 'Focus selected part'),
        row(['B'], 'Show bones'), row(['H'], 'Hide / show selected'), row(['Ctrl', 'Z'], 'Undo'), row(['Ctrl', 'Y'], 'Redo'),
        row(['Ctrl', 'C'], 'Copy part'), row(['Ctrl', 'V'], 'Paste into selected'), row(['Ctrl', 'D'], 'Clone'), row(['Del'], 'Remove'),
        row(['Ctrl', 'S'], 'Save to browser'), row(['F2'], 'Rename'), row(['P'], 'Play mode'),
        row(['drag label'], 'Scrub number values (Shift ×10, Alt ×0.1)')),
      h('h3', { text: 'Play mode' }),
      h('table', { class: 'keys' },
        row(['click'], 'Capture mouse to look around'), row(['W', 'A', 'S', 'D'], 'Move'), row(['Shift'], 'Sprint'), row(['Space'], 'Jump'),
        row(['Ctrl'], 'Crouch'), row(['mouse'], 'Fire (is_firing) / secondary'), row(['F'], 'Flashlight'), row(['V'], 'First / third person'),
        row(['T'], 'Chat (try "pac_event name")'), row(['1'], 'Toggle the first command event (1-9)'), row(['wheel'], 'Camera distance'), row(['Esc'], 'Release mouse, then exit')));
    modal('Controls', body);
  },

  about() {
    const body = h('div', { class: 'ref' },
      h('p', {}, h('b', { text: 'PAC3 Web' }), ' is a browser re-implementation of ', h('a', { href: 'https://github.com/CapsAdmin/pac3', target: '_blank', rel: 'noopener', text: 'PAC3' }), ' (Player Appearance Customizer 3) by CapsAdmin and contributors, the Garry\'s Mod outfit editor.'),
      h('p', { text: 'It recreates the part tree, part types, events, proxies and editor workflow on top of three.js with an original mannequin and procedurally generated textures and sounds. No game assets are included.' }),
      h('p', { text: 'With File → Game content you can mount your own Garry\'s Mod / Steam folders to use their models, materials, sounds, playermodels and animations, and import your PAC3 outfits. Files are read locally and never uploaded.' }),
      h('p', { text: 'Not included: multiplayer wearing, Lua scripting, server-side parts (damage, physics, health), Source particle effects.' }),
      h('p', { text: 'Licensed under the GNU GPL v3, like the original.' }));
    modal('About PAC3 Web', body);
  },
};
