# Plush Moose

A browser demo: a plush toy moose, modelled and animated in Blender, walks on two feet across a hilly meadow full of pine trees, flowers and giant pints of beer. It uses three.js r187 with `WebGPURenderer`, which falls back to WebGL 2 by itself.

**Where it's going:** a small, simple adventure game. The moose explores the meadow, talks to a few characters, picks things up and completes short quests. Read [Growing into a game](#growing-into-a-game-keep-it-simple) before you add features.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5179 when started via .claude/launch.json, else Vite's default 5173
npm run model      # rebuild public/moose.glb from the Blender script (needs /Applications/Blender.app, tested on 5.2 LTS)
npm run build      # production build into dist/
```

Controls:
- Click or tap the ground to walk there.
- WASD or the arrow keys steer, relative to the camera.
- Hold Shift to hurry. Shift-click hurries to the clicked spot.
- Drag to orbit, scroll to zoom.

## Layout

| Path | What it is |
|---|---|
| `blender/build_moose.py` | **Source of truth for the moose.** Builds the mesh from primitives, rigs it, keys the `Walk` and `Idle` actions and exports the GLB. Running it overwrites both outputs. |
| `blender/moose.blend` | Saved by the script so you can inspect the result in Blender. It is a build output; don't edit it by hand. |
| `public/moose.glb` | Exported model that the web app loads from `/moose.glb`. It is committed, so the web app works without Blender. |
| `src/main.js` | Renderer, sky and lights, moose loading and material tweaks, input, movement, animation blending, camera follow. |
| `src/terrain.js` | Seeded noise, `heightAt(x,z)` and `normalAt(x,z)`, the terrain mesh, and the instanced scatter (pines, beer pints, flowers). |
| `index.html` | Page shell and the instructions box at the top. |
| `.claude/launch.json` | Dev-server config for the Claude Code preview (port 5179). |
| `reference-photos/` | Photos of the real toy. Git ignores this folder, so it may be missing. |

## The moose model (`blender/build_moose.py`)

Run it headless:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b -P blender/build_moose.py
# preview stills instead of exporting:
... -P blender/build_moose.py -- --render /tmp/front.png [--view front|side|back] [--pose <walk frame>]
```

**Coordinates.** Blender is Z-up. The moose faces **−Y**, and its left side is **+X**. glTF export converts this to Y-up with the moose facing **+Z** in three.js. Total height is about 1.2 units, standing on z = 0.

**Building the mesh.**
- `ellipsoid()` adds a scaled UV sphere. An optional `shape` callback deforms the vertices; `pear` and `foot_shape` are examples.
- Each part is assigned to exactly one bone through a vertex group of the same name.
- `"BODY"` is a special case: the weight blends from `hips` to `spine` with height.
- All parts are then joined into one skinned mesh, `MooseMesh`, with an Armature modifier.

**Materials.** The web app matches on these names, so keep them:

| Material | Used for |
|---|---|
| `Fur` | Body, cranium |
| `FurLight` | Snout |
| `Belly` | Belly patch |
| `Dark` | Feet, ears, antlers, nostrils |
| `Eye` | Eyes |

All except `Eye` have Principled sheen, which exports as `KHR_materials_sheen`.

**Nostrils.** These are thin patches placed on the snout surface with `snout_surface()`, so they sit flush. Don't go back to protruding spheres; the user disliked them. If you change the snout, update the `SNOUT` dict, because both the snout and the nostrils are built from it.

**Bones.**

```
root
└─ hips
   ├─ leg.L / leg.R
   └─ spine
      ├─ arm.L / arm.R
      └─ head
         └─ ear.L / ear.R, antler.L / antler.R
```

**Posing.**
- Always pose through `set_rot(pb, ax, ay, az)` and `set_loc(pb, x, y, z)`. They take **armature-space** axes in degrees and metres and convert them into each bone's rest frame, so you don't have to think about bone rolls.
- Rotation about −X swings a leg or arm **forward**.
- Rotation about +Y tilts the top toward the moose's left.

**Animations.**
- `make_action(name, frames, fn)` samples `fn(t)` for t in [0,1] on every frame.
- Each action goes on its own muted NLA track. The export uses `export_animation_mode="NLA_TRACKS"`, so the clip names in the GLB are `Walk` and `Idle`.
- `Walk` is 24 frames at 30 fps (0.8 s per stride). It walks in place and the web app moves the character.
- `Idle` is 72 frames.
- To add a clip, write a pose function and call `make_action`. It is exported automatically.

**After changing the script:** re-render a preview still and look at it, then run the script without arguments to export. Check the GLB with:

```bash
node -e 'const b=require("fs").readFileSync("public/moose.glb");const j=JSON.parse(b.slice(20,20+b.readUInt32LE(12)));console.log(j.animations.map(a=>a.name),j.materials.map(m=>m.name))'
```

## The web app

**Rendering.**
- `import * as THREE from 'three/webgpu'`, with addons from `three/addons/...`.
- Use materials that WebGPU supports: the standard `Mesh*Material` classes are converted to node materials automatically, and TSL/node materials also work. **`ShaderMaterial` and `RawShaderMaterial` don't work** with `WebGPURenderer`.
- Call `renderer.init()` with await before the first render.
- `renderer.backend.isWebGPUBackend` reports whether it fell back to WebGL 2; the instructions box displays it.
- The sky is `SkyMesh`, the WebGPU-only addon. Shadows come from one directional light whose shadow frustum (±12 units) follows the moose.

**Moose.**
- `gltf.scene` sits inside `holder`, a Group.
- `holder` carries the position, the yaw and a partial tilt to the terrain normal (55% toward world up).
- Fur materials get a procedural canvas normal map (`furTexture()`) on top of the glTF sheen.

**Movement (`update(dt)` in `main.js`).**
- Input becomes a wish direction. Keyboard overrides a click target.
- The moose turns toward the wish direction at `TURN_RATE` and only moves forward in proportion to how well it faces it.
- Uphill slows it down.
- Y comes from `heightAt`. Position is clamped to the terrain size.

**Animation sync.**
- `Walk` and `Idle` both play all the time and are cross-weighted by speed.
- `walk.timeScale = speed / WALK_SPEED`. `WALK_SPEED` (0.62 m/s) is tuned so feet don't slide at timeScale 1. If you change the stride in Blender, retune it.

**Terrain.**
- `heightAt` is the only height function, shared by the mesh, the placement of scattered objects and the character. Anything that sits on the ground must use it.
- The noise is seeded, so the world is the same on every load.
- Around the origin the ground is flattened into a spawn meadow.
- Scatter uses a seeded `rand()`. Fixed spawn-adjacent pints are prepended in `createScatter()`.

**Beer pints.** Three `InstancedMesh` layers share one matrix per instance: beer, foam, and a transparent glass shell made with `LatheGeometry`. Lessons from tuning them:
- A double-sided glass with clearcoat washes the beer out to beige. Keep the glass single-sided with opacity around 0.13.
- Keep the beer opaque.

**Gotcha.** WebGPU throws "texture size 0" errors if it renders into a zero-size canvas, for example a hidden preview pane. The render loop skips frames while `innerWidth` or `innerHeight` is 0.

## Checking changes

There are no tests. Check changes visually:
1. Run `npm run build` to catch import and syntax errors.
2. Run the dev server and open the page.
3. Look at the browser console for errors.
4. Click the ground and confirm the moose turns, walks there with its feet stepping and blends back to `Idle`.
5. For model changes, compare `--render` stills from the front and side against `reference-photos/` if you have them.

## Growing into a game: keep it simple

The aim is a small game that one person, or one AI session, can understand by reading a handful of files. Prefer boring, explicit code over clever architecture. When in doubt, write less.

### Source structure

- **Plain JavaScript modules, no framework.** Don't add TypeScript, React, an ECS library, a physics engine or a state-management library unless the user asks. three.js and Vite are the only dependencies. Every new dependency needs a reason you can state in one sentence.
- **One file per system, named for what it does.** As `main.js` grows, split it like this and stop there:

  ```
  src/
    main.js        # boot: renderer, scene, load assets, start loop (keep < ~150 lines)
    world/         # terrain.js (exists), scatter.js, sky/lights
    player.js      # moose movement, animation blending, input → intent
    camera.js      # follow camera
    game/
      state.js     # the one game-state object + save/load (localStorage)
      quests.js    # quest data + tiny step checker
      npcs.js      # NPC placement + talk triggers
      items.js     # pickups, inventory
      dialogue.js  # dialogue UI (HTML overlay, not 3D text)
    ui/hud.js      # DOM overlay: prompts, inventory, quest log
  ```

  Don't create a folder or file until there is code to put in it.
- **One game-state object.** Keep all progress in one serialisable object in `game/state.js`, for example `{ inventory: [], flags: {}, quest: {id, step} }`. Systems read and write it directly. There are no event buses or observers unless two systems genuinely need decoupling. Saving the game is `JSON.stringify(state)`.
- **Content is data, logic is small.** Quests, dialogue lines, item definitions and NPC spawn points are plain JS arrays and objects (`const QUESTS = [...]`). A quest step is `{ say, need: 'flag' | 'item', id }` or similar. Adding content should mean editing data, not writing new functions.
- **One update loop.** `renderer.setAnimationLoop` calls `update(dt)` on each system in a fixed, visible order inside `main.js`. Don't give systems their own `requestAnimationFrame` or timers.
- **Interaction stays distance-based.** "Near an NPC or item and pressing E" (or tapping a button) is enough. Use `heightAt` and plain distance checks; don't add a physics engine. If you need simple collisions, use circles on the XZ plane, pushed apart in `player.js`.
- **UI is HTML/CSS over the canvas** (like the instructions box), not 3D text. It's easier to style, it's accessible, and it works on mobile.
- **Delete instead of commenting out.** Remove dead code, debug helpers and unused assets in the same change that makes them unused.
- **Keep the feature list short.** Finish and polish one loop (walk, talk, fetch, reward) before adding mechanics like combat, crafting or a day/night cycle.

### 3D models and assets

- **One Blender script per asset, and the script is the source.** `blender/build_<thing>.py` produces `public/<thing>.glb`. Never hand-edit a `.blend` or `.glb` and commit it as the source. If a change can't be scripted, say so to the user instead of hand-editing silently.
- **Share helpers, don't copy them.** When a second character script appears, move the generic bits (`ellipsoid`, `mat`, `srgb`, `set_rot`, `set_loc`, `make_action`, the export call) into `blender/lib.py`. Import it with `sys.path.insert(0, os.path.dirname(__file__))`. Each asset script then only holds its shapes, bones and pose functions.
- **Build from primitives in the same plush style.** Rounded ellipsoids, sheen fabric materials and a few flat colours. Keep characters roughly between 5k and 25k triangles. Don't import downloaded models or photo textures. Fur detail comes from the shared procedural normal map in the web app.
- **Simple props belong in JS, not Blender.** Rigid, non-animated props like trees, pints, rocks, signs and pickups can be `three` primitives or lathes in `world/scatter.js`, using `InstancedMesh` when there are many of them. Use Blender only for anything skinned or animated, or too organic for primitives.
- **Names are a contract.** Bone names, material names and clip names are read by the JS. Keep them short and consistent:
  - Bones: `root`, `hips`, `spine`, `head`, then `<part>.L` / `<part>.R`.
  - Materials: by look (`Fur`, `Dark`, ...), not by part.
  - Clips: PascalCase verbs (`Idle`, `Walk`, `Talk`, `PickUp`, `Wave`).
  If you rename one, update the JS in the same commit.
- **Few bones, few clips.** Add a bone only when an animation needs it. Every clip loops cleanly or is clearly one-shot, and every clip is in place (no root motion); the game moves the character. Write down each new clip's speed assumption (as `WALK_SPEED` does) next to the code that uses it.
- **One GLB per character, all its clips inside.** Load each GLB once and clone with `SkeletonUtils.clone` for repeated NPCs. Don't split animations into separate files.
- **Always look at it.** After any model change, render `--render` stills (front and side, plus a `--pose` frame for new clips), view them, and only then export.

### Checklist before you finish a change

1. `npm run build` passes.
2. The page loads with no console errors, and the core loop (walk, interact) still works.
3. No new dependency, folder or abstraction that the change doesn't need.
4. This README is updated if the structure, a name contract or a command changed.

## Ideas / open work

- First adventure loop: an NPC (for example a plush squirrel) asks the moose to fetch something, there's a pickup to find, then a reward.
- Press E or tap to interact, with an HTML prompt that appears when the moose is near something.
- Save and load progress in `localStorage`.
- The moose has no collision with trees or pints.
- WASD steering hasn't been checked in the browser yet.
- Plush fur via shell or fin rendering in TSL, instead of only sheen plus a normal map.
- Footprints or grass that bends where the moose walks.
- Mobile on-screen joystick.
- Proper glass using `transmission` (it costs extra on WebGPU).
- Code-splitting. Vite warns that the three.js chunk is over 500 kB.
