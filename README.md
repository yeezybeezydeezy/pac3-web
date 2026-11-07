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

## Your Garry's Mod content (no uploading)

**File → Game content** mounts folders from your own computer: pick your `GarrysMod` folder, or your Steam `steamapps` folder to include Workshop items too. Everything is read locally in your browser; nothing is uploaded and no game files are part of this site.

- Reads loose files, `.vpk` archives (Garry's Mod, HL2, CS:S content), Workshop `.gma` addons, and older LZMA-compressed `_legacy.bin` Workshop items (unpacked in a background worker).
- Models (`.mdl`/`.vvd`/`.vtx`), materials (`.vmt`, including `patch`), textures (`.vtf`, DXT and uncompressed formats) and sounds (`.wav` including ADPCM, `.mp3`, `.ogg`) load by their game paths, e.g. `models/player/items/humans/top_hat.mdl`. `.vtf` URLs work too.
- An **entity** part can swap the avatar for any playermodel. It plays that model's own animation set (`$includemodel`, e.g. `m_anm.mdl`, `f_anm.mdl`, `z_anm.mdl`): idle, walk/run blends, crouch, jump, swim, sit and taunts. Animation parts accept any of its sequence names.
- **Import PAC3 outfits** straight from `garrysmod/data/pac3/*.txt`: parts, events, proxies (including `Extra1-5`/`var1()`), `material_3d` settings and per-slot `Materials` lists are converted.
- Chrome and Edge remember mounted folders between visits; other browsers use a folder-upload dialog.

### Same skeleton as Source

The built-in mannequin is rigged like a ValveBiped playermodel: the same bone names, hierarchy, bone axes and attachments (`eyes`, `chest`, hands). Outfits created here use Garry's Mod bone axes (`CoordinateSpace: source`), so positions mean the same thing as in PAC3, on the mannequin or on any playermodel. Without mounted content the mannequin uses built-in procedural animations.

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
- Source models, materials, sounds and player animations load only from game folders you mount; Source particle effects (`.pcf`), detail textures, bodygroups and PAC3's "Showtime dynamics" are not supported.
- Outfits are saved as JSON. PAC3 `.txt` outfits can be imported; a few PAC3-only parts (custom_animation, weapon, holdtype, submaterial) are skipped and their children kept.

Imported outfits are treated as untrusted. They are size- and depth-limited, every property is type-checked, and proxy expressions run in a sandboxed evaluator (no `eval`).

## Credits & license

Based on the design of [PAC3](https://github.com/CapsAdmin/pac3) by CapsAdmin and contributors. Rendering by [three.js](https://threejs.org/) (MIT).

Licensed under the GNU General Public License v3.0, the same license as PAC3. See [LICENSE](LICENSE).
