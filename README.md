# Rally 3D — Native Browser Port (no emulator)

This is the **native rewrite**: the original Nokia Rally 3D (2005 J2ME) rebuilt
directly in JavaScript + Three.js using the real assets extracted from your
original jar — actual car model, textures, sprites, MIDI music, track data,
UI text, medal times and unlock rules. No Java, no emulation, no camera bug.

This build includes all gameplay fixes through **v9** (see changelog).

- **Camera follows the car** — authentic chase-cam lag (yaw lerps at /6 per
  frame like the original), the car itself moves and rotates while steering.
- **Tracks rebuilt 1:1** from the original turtle-graphics track format
  (cross-section stations, checkerboard grass, road-edge lines, tree walls,
  hills/banks, per-tile brightness variants).
- **Original riding mechanics** — spring suspension with body roll/pitch,
  exact accel/brake/offroad constants and steering rates from the decompiled
  jar.

## How to run

Double-click **`start.bat`** (Windows), or in a terminal in this folder:

    python3 serve.py 8088        (Windows: py serve.py 8088)

then open:

    http://localhost:8088/game/index.html

- Port 8088 is used so it can run side-by-side with the emulator package on 8080.
- **Why a server?** Opening `index.html` directly from the file system
  (`file://`) is blocked by the browser's WebGL texture security rules.
  Any static server works — the bundled `serve.py` is just the easiest.
- **Fully offline**: Three.js, textures, models and music are all bundled.
  Nothing is downloaded at runtime (unlike the emulator version).
- Save data (medals, unlocked cars/tracks) persists in the browser's
  localStorage.

## Controls

| Key            | Action                          |
|----------------|---------------------------------|
| Arrow keys / 4-6 | Steer                         |
| 2 / Up         | Gas                             |
| 8 / Down       | Brake                           |
| Enter / 5      | OK / Fire                       |
| Q / W            | Left / right soft key           |

Touch zones are enabled automatically on phones/tablets.

## What's inside

- `game/` — the whole game as static files:
  - `index.html` — 240x320 canvas (UI canvas composited over WebGL canvas)
  - `js/` — three.min.js (Three.js r128), engine.js (track mesh generator
    ported 1:1 from the original renderer), race.js (physics/camera/HUD),
    scenes.js (menus/showroom with original art), main.js (input/audio/saves),
    data.js (track geometry, sprite sheets, language strings parsed from the jar)
  - `assets/` — the 46 original PNGs and the 5 original MIDI music files
    (played through the bundled libmidi General-MIDI synth; OGG renders kept
    only as an automatic fallback)
- `serve.py` — static file server (Range-capable, stdlib only)
- `start.bat` — one-click launcher for Windows

## Changelog

### v9
- **"Pushed to the left" bug fixed for good** (reproducible shove a few seconds
  into every race). Two defects in the boundary-wall port compounded:
  the span check tested the *narrow* axis of each boundary edge instead of the
  *dominant* one (making the check vacuous for track-aligned edges), and no
  per-tile activation filter existed (the original only tests boundary edges of
  tiles whose bounding box contains the car). Together they let the boundary
  line of a tile the car had passed seconds earlier — e.g. the opening
  straight that a later curve bends back towards, ~90u back along the path but
  a few units away in space — cross the car via its infinite extension and
  shove it sideways across the road, always at exactly the same spot.
  Both guards are now ported from the original (dominant-axis span check +
  per-tile AABB activation). Validated by simulation on all 12 tracks: the
  port now produces *fewer* wall pushes than the original everywhere but one,
  and no mid-road shoves at all.
- **Car select: drag to spin** (a deliberate mod, not in the original game —
  this port is a modified edition). Click and drag the car horizontally to
  rotate it; on release it keeps the flick's momentum and then eases back into
  the original's automatic 250 deg/s turntable spin. Touch screens keep the
  original tap behaviour; the hint text on the screen marks the feature.

### v8

- **Menus aligned and symmetrical**:
  - the screen header no longer overlaps the RALLY 3D logo art (it sits just
    below it now);
  - the championship trophy grid centres every row (the second row of a 6+4
    grid no longer hangs on the left) and both rows clear the bottom bar;
  - track-select padlocks line up in a fixed right-hand column (inline locks
    used to make locked rows look off-centre), the 10 rows fit above the
    bottom bar again, and the padlock icon is lighter and easier to read.

### v7
- **Floating road/grass slabs fixed**: the track renderer used double-sided
  faces, so the UNDERSIDES of elevated sections showed against the sky as
  stray patches of road and grass (most visible on Haze). The original
  renderer culls back faces, so only the top side of every strip is drawn —
  exactly what the port does now.
- **"Car gets pushed sideways" fixed**: the port of the original boundary-wall
  code flipped the push normal toward the local centreline; on some extent
  transitions the boundary midpoint fell on the wrong side, inverted the test
  and shoved the car across the track (the "pushed to the left a few seconds
  after the start, always the same spot" bug). The push normal is now the
  fixed outward normal from the original renderer (r.java), verified with a
  wall-push scan on all 12 tracks: zero cross-track shoves, zero false
  respawns.

### v6
- **Finish cinematic refined**: the orbit around the car is slower and eases
  into a short HOLD on the car's front axis before the screen fades into the
  results (orbit 2.9 s - hold 0.55 s - fade 0.6 s).
- **Bridge rails are solid**: the invisible wall now sits at the rail base on
  all bridge tiles (the original let wheels reach the rail, where no ground
  exists, and respawned the car). Grind along the rails as long as you like.
- **Roadside props (trees/bushes) are real 3D billboards now**: they live in
  the depth buffer instead of being pasted over the frame, so trees below an
  elevated section are properly hidden behind it and clip correctly at crests.
  Sizes still follow the original's six distance frames, smoothly interpolated.

### v5
- **Mountains, walls and bridges are truly continuous now** - two renderer
  bugs fixed after re-reading the original track renderer (r.java):
  1. *Per-station shading* - in the original every cross-section carries its
     own random brightness and each quad smoothly interpolates between its
     two cross-sections. The port was colouring both edges of every 16u quad
     the same, which made the terrain a patchwork of flat slabs with harsh
     steps (the "split mountains"). Shading now follows the original rule,
     so hills shade continuously like the real game.
  2. *Seam healing* - the original restarts every 32u tile at its own
     profile row, and the track data intentionally allows rows that do not
     chain (wall 13 high -> bank 5 high, ditch -> bridge deck), which leaves
     a vertical cliff with a hole in the mesh at every such tile boundary.
     The port now blends the previous tile's end profile into the next tile,
     so mountains, walls, ditches and bridge approaches (e.g. the bridges on
     Haze) are aligned and continuous end to end. Verified numerically: all
     12 tracks have zero discontinuity at every tile boundary.
- **Finish line camera**: after crossing the checker-flag gate the input
  freezes, the car rolls gently to a stop while the camera orbits from
  behind the car around to its front, then the screen fades into the
  result screen.

### v4
- **Finish line rebuilt**: the checker-flag gate now has TWO flags (one on
  each road edge, as in the original — the left flag previously shared the
  right flag's vertex, so only one was visible), and the race now finishes
  when the car actually crosses the flag gate, then coasts through it before
  the results appear.
- **Menus sound like the original**: the title music plays continuously in
  every menu (including the car showroom), and there are no navigation beeps
  — plink1/plink2 are only the race countdown sounds, exactly like the jar.
  Also fixes menu music not being audible until the first key press
  (the synth was being started on a suspended audio context).
- **Car showroom**: the car now rotates automatically (10 deg/frame at the
  original 25 fps pace = 250 deg/s), the view resets properly when entering
  from a race, and the Speed/Acc/Grip bars sit at the bottom of the screen
  in the original layout (label left, bar on the right half) without
  overlapping the car.
- **Mountains fixed**: the terrain brightness chain now follows the original
  rule (tile-boundary quads share the previous tile's brightness), so hills
  and mountains are continuous instead of looking like separate slabs.
- **Invisible boundary walls ported from the original**: the car is pushed
  back at the track extent line (profile col16) exactly like the original's
  collision code, so you can still drive up the gentle roadside hills but can
  no longer climb through the steep mountains and glitch upwards.
- **Ditch guard**: falling into the steep ditch tiles (profile row 7) with
  both rear wheels respawns the car on the road, as in the original.
- Physics ground sampling also honours the original per-section walkability
  flags (K[] from the profile tables).

### v3
- **Ground physics rewritten**: sampling now uses point-in-quad tests over the
  actual rendered mesh triangles (faithful port of the original sampler), so
  the wheels always follow exactly the road you see. Fixes the bouncing +
  false "Loading..." respawns that appeared a few seconds into a race.
- **Authentic jump physics**: airborne wheels fall with the original spring
  acceleration; steering and throttle freeze in the air like the original.
- **Respawns are instant** (as in the original) when off the track mesh.
- **Original MIDI music**: the game now plays the real MIDI files extracted
  from your jar through the same General-MIDI synthesizer the emulator used
  (libmidi.wasm with an embedded soundfont, bundled locally - no conversion,
  no washed-out sound). OGG renders remain only as an automatic fallback for
  browsers without AudioWorklet.

### v2
- Chase camera, rebuilt tracks, original suspension/steering physics.
