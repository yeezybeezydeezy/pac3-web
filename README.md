# PAC3 Web

A browser re-implementation of [PAC3](https://github.com/CapsAdmin/pac3) (Player Appearance Customizer 3), the Garry's Mod outfit editor by CapsAdmin and contributors. Build outfits out of parts — models, lights, particles, trails, sounds, events and proxies — on a 3D mannequin, then walk around in play mode to see them react.

It runs entirely in the browser with no build step (plain ES modules + [three.js](https://threejs.org/) from a CDN), so it can be hosted on GitHub Pages.

## Features

- **Part tree editor**: add, nest, drag & drop, rename, hide, copy/paste (as JSON through the system clipboard), clone, undo/redo.
- **Property inspector**: grouped properties, drag-to-scrub numbers, vector/angle/color editors, bone picker, file embedding for models/textures/sounds, live proxy output.
- **Viewport**: orbit camera, move/rotate/scale gizmo, click-to-select, bone markers, animation preview (idle/walk/run/crouch/jump).
- **Play mode**: third/first person, WASD/sprint/jump/crouch, mouse fire, flashlight, chat with speech bubbles, `pac_event` / `pac_proxy` commands, number-key event toggles.
- **Saving**: autosave, named saves in the browser, JSON import/export, compressed share links.
- **26 part types**:

| Category | Parts |
| --- | --- |
| Generic | group, info |
| Model & body | model (primitives or glTF/GLB/OBJ), bone, entity, animation, jiggle |
| Effects | light, sprite, text, trail, beam, particles, sunbeams, halo, shake, camera, sound, projectile |
| Modifiers | material, clip, fog, movement |
| Logic | event, proxy, command |

- **Events**: `is_crouching`, `is_on_ground`, `is_moving`, `is_running`, `is_firing`, `button`, `say`, `command` (pac_event), `timerx`, `random_timer`, `speed`, `health`, `animation`, `camera_distance` and more, with PAC3's operators and Invert semantics.
- **Proxies**: Lua-flavoured expressions (`sin(time()*4)*10`, `hsv_to_color(time()*90,1,1)`, `x > 1 and 5 or 2`) or the easy setup (input → function → min/max). Driven values are never written into the saved outfit.

## Running locally

Any static file server works, for example:

```bash
npx serve .
```

Then open the printed URL. Opening `index.html` straight from disk does not work, because browsers block ES modules on `file://`.

## Differences from PAC3

PAC3 Web recreates the editor, part system, events and proxies, but it is not Garry's Mod:

- Uses an original mannequin and procedurally generated textures and sounds. No Valve or Garry's Mod assets are included.
- No multiplayer wearing, Lua scripting, or server-side parts (damage, physics, health modifiers).
- Source engine models, materials and particle effects are not supported yet. Use primitives or glTF/OBJ files instead.
- Outfits are JSON, not PAC3's Lua `.txt` format. PAC3 class names like `model2` and `light2` are accepted on import.

Imported outfits are treated as untrusted. They are size- and depth-limited, every property is type-checked, and proxy expressions run in a sandboxed evaluator (no `eval`).

## Credits & license

Based on the design of [PAC3](https://github.com/CapsAdmin/pac3) by CapsAdmin and contributors. Rendering by [three.js](https://threejs.org/) (MIT).

Licensed under the GNU General Public License v3.0, the same license as PAC3. See [LICENSE](LICENSE).
