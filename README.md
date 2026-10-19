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

### v9 (current)
- **Championship hub: the spinning showroom car removed** (it was never
  requested). The hub is now a plain menu - the blue title backdrop with the
  checkered banners, "Championship:" in the top banner, and the single
  "Next race" item dead-centre on the screen. Navigation is unchanged:
  OK / Enter = next race, Back = New game menu.
- **Title song switch now labelled by engine name**: the Settings item reads
  "Title song: TinySoundFont / TinySynth" instead of "Original / Claude".
  TinySoundFont = the libmidi.wasm synth this port has always used;
  TinySynth = the webaudio-tinysynth wavetable synth (with its own reverb)
  from the other port. Same two renditions and the same saved switch as v8 -
  only the labels changed. Nothing else was taken from the other port.

### v8
- **Championship hub redesigned**: the earned-trophy grid is gone; the screen
  now shows the "Next race" heading centred in the middle with the selected
  car spinning on its podium over the blue streak backdrop, like the original
  hub. Pressing Back (right softkey / Escape) in the hub now correctly returns
  to the New game menu instead of bouncing to track select and back.
- **Title song switch (Settings)**: the same original `title.mid` was rendered
  by two different General-MIDI synthesizers in the two browser ports — this
  build uses libmidi (TinySoundFont core), the other port uses
  webaudio-tinysynth with its own wavetable and reverb, which is why the
  melody sounds different. Settings now has a "Title song: Original / Claude"
  item: Original plays the libmidi rendition (as before), Claude plays the
  webaudio-tinysynth rendition (soft synth with reverb). The choice is saved,
  and toggling restarts the menu music immediately.

### v7
- **"Pushed/dragged to one side" fixed (the invisible-wall misfire)**: the
  port tested wall edges within a window that follows the track's ARC, so on
  curved sections an edge from a completely different part of the track (up to
  90 units away) could "block" the car and shove it sideways every frame —
  the car felt dragged/pushed to one side and fought your steering. The
  original only tests a tile's wall when one of the four wheels is inside
  that tile's bounding box; the port now does exactly the same (verified:
  Green mountain went from being pinned at tile 10 with 5191 wall pushes to
  completing all 218 tiles with 20 normal touches).
- **Trees/bushes below the road elevation no longer show through the road**:
  the original draws each track section's props interleaved with the
  far-to-near section rendering, so nearer hills overdraw farther sprites.
  The port drew all props as a 2D layer on top of everything — trees standing
  on lower ground appeared painted over the road ahead. Props are now
  depth-tested 3D billboards inside the 3D scene (same sprites, same 6
  distance sizes, same bottom anchor), so hills properly hide what is behind
  them — per pixel, like a real 3D renderer.
- **Distant track pieces no longer float in the sky (Haze/bridges)**: the
  original only ever draws 6 tiles around the car (everything farther is the
  2D background); the port drew the entire track, so far-away elevated
  strands appeared as giant slabs floating above the horizon. The port now
  renders the same 6-tile window (widened during the finish orbit), matching
  the original's distance look.
- **Menus: header no longer overlaps the RALLY 3D logo** on Select track /
  High scores / Instructions / New game / Settings.

### v6
- **Downhill bounce / vibration fixed**: on steep descents the road can dive
  away faster than the suspension's gravity pulls the wheels down; the wheel
  spring then entered a float -> slam -> float cycle (the car visibly bounced
  and vibrated, pitch swinging +-15 degrees) and every float frame froze the
  steering (the "less sensitive to controls" feel). Two changes:
  1. *Downhill stick-assist* - when a falling wheel is only slightly above
     ground that is descending faster than the wheel falls, it is glued to
     the ground with the terrain's own descent rate, so the car rides steep
     S-curve downhills smoothly. Real jumps (crests, summits) are untouched:
     they leave the ground with upward speed and a growing gap, so they still
     fly exactly like before.
  2. *Control-freeze buffer* - the original zeroes steering the instant all
     four wheels are off the ground; at 60fps the brief 1-2 frame ground
     kisses kept resetting your steering. Controls now only freeze after ~3
     consecutive airborne frames (real jumps), never on ground kisses.
  Verified on a physics harness across all 12 tracks: full-airborne stretches
  cut 30-80%, hard landings cut ~60%, crest jumps preserved.
- **Car select: grab & spin** - click and drag the mouse in the car showroom
  to rotate the car (it follows the cursor 1:1); on release it keeps the
  flick's momentum, keeps spinning, and eases back into the classic 250 deg/s
  auto-rotation. The showroom keeps its own identity on purpose - this port
  is a modified game, not a 1:1 replica.

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
