/* Rally 3D port — race v2: physics, suspension, camera, sprite props, HUD, finish flow
   Ported from the original decompiled game loop (h.java d(boolean), b(float), c(float)):
   - physics constants applied per f5-unit (f5 sums to SPEED_K per second)
   - suspension: wheel ground samples at RY(-yaw)*(±2,0,±4), spring g/i/j, body y = avg(g)
   - roll = (g[3]-g[2])*6, pitch = (g[2]+g[3]-g[0]-g[1])*4, smoothed /2 per 25fps frame
   - camera: yaw lerp /6 per frame (~0.24s at 25fps), level pitch, 8u behind, y +3.5 (lerp /1.6) */
(function () {
'use strict';
const D = window.R3D_DATA;
const R3D = window.R3D;
const W = R3D.W, H = R3D.H;
const ui = document.getElementById('ui').getContext('2d');
const renderer = R3D._renderer, camera = R3D._camera;
const S = () => R3D.saveObj;
const text = R3D.text, softkeys = R3D.softkeys, drawTitle = R3D.drawTitle,
      fmtTime = R3D.fmtTime, wasPressed = R3D.wasPressed, AudioSys = R3D.audio;

const SPEED_K = R3D.SPEED_K;             // f5 units per second (world scale)
const TOPS = R3D.STAT_TOP;               // per-car top speed x10
const KMH = 15, MPH = 9.5;               // display multipliers (original q.E / q.ak)

const THEMES = R3D.themeColors;

// sheet lookup: prop code -> sprite key (original bc[] mapping)
function sheetKey(theme, code) {
  if (code === 0 || code === 4) return 'bb_' + theme + '_1';
  if (code === 1) return 'bb_' + theme + '_2';
  if (code === 2) return 'bb_' + theme + '_3';
  if (code === 3) return 'bb_shared_4';
  if (code === 5) return 'bb_shared_6';
  if (code === 6) return 'bb_shared_7';
  return null;
}

// one unit plane per sprite frame: bottom-anchored (translate +0.5y), UVs cut
// to the frame rect in the sheet (canvas image, flipY texture => v = 1 - px/H)
function makeSpriteGeos(key, spr) {
  const img = R3D._sprImgs[key];
  const iw = (img && img.width) || 256, ih = (img && img.height) || 256;
  const geos = [];
  for (let f = 0; f < 6; f++) {
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0, 0.5, 0);
    const u0 = spr.ox[f] / iw, u1 = (spr.ox[f] + spr.w[f]) / iw;
    const vT = 1 - spr.oy[f] / ih, vB = 1 - (spr.oy[f] + spr.h[f]) / ih;
    g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, vT, u1, vT, u0, vB, u1, vB], 2));
    geos.push(g);
  }
  return geos;
}

const raceScene = {
  phase: 'prerace',   // prerace | countdown | racing | done
  cd: 0, cdN: 0, goT: 0,
  timeT: 0,           // race time in 1/10 s
  car: null,
  world: null,
  track: null,
  camYaw: 0, camY: 0, camPos: new THREE.Vector3(),
  pos: new THREE.Vector3(), yaw: 0, speed: 0, steer: 0,
  roll: 0, pitch: 0,
  gH: [0, 0, 0, 0], sus: [0, 0, 0, 0], gJ: [0, 0, 0, 0],
  segHint: 0, air: 0, airT: 0,
  cpNext: 0, finished: false, wrongWay: false,
  azCnt: 0, cI: 0, coastT: 0, finishSeg: 0,
  doneT: 0, orbitFrom: 0,          // finish cinematic: orbit duration + start yaw
  splitText: '', splitColor: '#fff', splitT: 0,
  paused: false, pauseSel: 0,      // simple pause menu (will be extended later)

  enter() {
    const ti = R3D.game.trackIdx;
    this.track = D.tracks[ti];
    this.theme = this.track.theme;
    if (this._propGeos) for (const key in this._propGeos) for (const g of this._propGeos[key]) g.dispose();
    this._propGeos = null;
    this.world = R3D.buildTrack(this.track);
    R3D.clearScene3d();
    const sc = new THREE.Scene();
    for (const m of this.world.tileMeshes) sc.add(m);
    this.car = R3D.buildCar(R3D.game.carIdx);
    sc.add(this.car);
    this.buildPropBillboards(sc);
    R3D.scene3d = sc;
    this.tc = THEMES[this.theme];
    this.phase = 'prerace';
    this.paused = false; this.pauseSel = 0;
    this.timeT = 0; this.cpNext = 0; this.finished = false;
    this.splitT = 0; this.goT = 0;
    this.checkpoints = this.track.checkpoints;
    this.finishIdx = this.track.finish;
    this.finishSeg = this.track.finish * 3 + 2;   // gate cross-section (checker flags)
    this.azCnt = 0; this.cI = 0; this.coastT = 0;
    this.doneT = 0; this.orbitFrom = 0;
    this.gold = this.track.medals[0];
    this.teleport(5);
    this.camYaw = this.yaw;
    this.camY = this.pos.y + 3.5;
    this.camPos.set(this.pos.x, this.camY, this.pos.z);
    AudioSys.stopMusic();
  },

  // original h(int): place car at a tile start, orientation from accumulated heading
  teleport(tileIdx) {
    const tiles = this.track.tiles;
    const i = Math.max(0, Math.min(tiles.length - 2, tileIdx));
    const t = tiles[i], t2 = tiles[i + 1];
    this.pos.set(t.x, t.h, t.z);
    this.yaw = 180 - (t.acc + t2.acc) / 2;
    this.speed = 0; this.steer = 0; this.roll = 0; this.pitch = 0;
    this.sus = [0, 0, 0, 0];
    this.segHint = i * 3;
    this.tileIdx = i;   // render window + wall gate need the tile immediately
    // snap wheels to ground (original h(int))
    this.sampleWheels(0.0001, true);
    this.pos.y = (this.gH[0] + this.gH[1] + this.gH[2] + this.gH[3]) / 4;
    this.air = 0; this.airT = 0;
  },

  update(dt) {
    // ---- simple pause menu (racing / countdown only) ----
    if (this.paused) { this.pauseInput(); return; }
    if ((this.phase === 'racing' || this.phase === 'countdown') &&
        (wasPressed('RS') || wasPressed('LS'))) {
      this.paused = true; this.pauseSel = 0;
      AudioSys.stopMusic();          // resume restarts the race music
      return;
    }
    if (this.phase === 'prerace') {
      if (wasPressed('F') || wasPressed('L')) {
        AudioSys.sfx('plink1');
        this.phase = 'countdown'; this.cd = 0; this.cdN = 0;
      }
      if (wasPressed('RS')) { R3D.clearScene3d(); R3D.setScene(R3D.carSelectSceneRef); }
      this.updateCamera(dt);
      return;
    }
    if (this.phase === 'countdown') {
      this.cd += dt;
      if (this.cd >= 1.0) {
        this.cd = 0; this.cdN++;
        if (this.cdN >= 2) {
          AudioSys.sfx('plink2');
          this.phase = 'racing';
          this.goT = 1.0;
          AudioSys.play('title', true, 0.85);
        } else {
          AudioSys.sfx('plink1');
        }
      }
      this.updateCamera(dt);
      return;
    }
    if (this.phase === 'racing') {
      if (this.goT > 0) this.goT -= dt;
      this.step(dt);
      this.updateCamera(dt);
      return;
    }
    if (this.phase === 'done') {
      // original: d() keeps running (input + physics) for bs = fps*2/3 frames
      // after the goal jingle -> the car coasts on through the checker gate.
      // Extended into a finish shot: input freezes, the car rolls to a stop
      // while the camera orbits from behind around to the car's front, then
      // the screen fades into the results scene.
      if (this.coastT > 0) {
        this.coastT -= dt;
        this.step(dt);
        this.speed *= Math.exp(-dt * 1.1);
      } else {
        R3D.setScene(R3D.resultsScene);
      }
      this.updateCamera(dt);
    }
  },

  // ---- pause menu input (items: Continue / Restart / Quit race) ----
  pauseInput() {
    if (wasPressed('U') || wasPressed('L')) this.pauseSel = (this.pauseSel + 2) % 3;
    if (wasPressed('D') || wasPressed('R')) this.pauseSel = (this.pauseSel + 1) % 3;
    if (wasPressed('RS')) { this.resumeRace(); return; }
    if (wasPressed('F') || wasPressed('LS')) {
      if (this.pauseSel === 0) this.resumeRace();
      else if (this.pauseSel === 1) {          // restart from the pre-race screen
        this.paused = false;
        R3D.clearScene3d();
        R3D.setScene(R3D.raceScene);
      } else {                                 // quit to the mode's hub menu
        this.paused = false;
        R3D.clearScene3d();
        R3D.setScene(R3D.game.mode === 'champ' ? R3D.nextRaceScene : R3D.trackSelectScene);
      }
    }
  },

  resumeRace() {
    this.paused = false;
    if (this.phase === 'racing') AudioSys.play('title', true, 0.85);
  },

  // -------------------------------------------------- physics (original d(boolean))
  step(dt) {
    const car = R3D.game.carIdx;
    const top = TOPS[car] / 10;
    const F5 = dt * SPEED_K;
    // control freeze buffer: the original zeroes steering the moment all four
    // wheels leave the ground (ao == 4); at 60fps the brief 1-2 frame ground
    // kisses on rolling terrain kept resetting the steering every few frames
    // (the "less sensitive" feel). Only freeze after ~3 consecutive airborne
    // frames - real jumps still freeze, kisses don't.
    if (this.air === 4) this.airT += dt; else this.airT = 0;
    const frozen = this.airT >= 0.05;
    // input frozen once finished (finish cinematic coast)
    const gas = !this.finished && !frozen && (R3D.keys.U || S().settings.auto === 1);
    const brake = !this.finished && !frozen && R3D.keys.D;
    const left = !this.finished && !frozen && R3D.keys.L, right = !this.finished && !frozen && R3D.keys.R;

    // steering (original: 1.5 accumulate, 2.5 return, clamp +-6;
    // frozen while fully airborne for >3 frames - ao < 4 gate)
    if (!frozen) {
      if (left && this.speed > 0.2) {
        this.steer -= 1.5 * F5;
        if (this.steer < -6) this.steer = -6;
      } else if (right && this.speed > 0.2) {
        this.steer += 1.5 * F5;
        if (this.steer > 6) this.steer = 6;
      } else {
        if (this.steer > 0) { this.steer -= 2.5 * F5; if (this.steer < 0) this.steer = 0; }
        else { this.steer += 2.5 * F5; if (this.steer > 0) this.steer = 0; }
      }
    } else {
      this.steer = 0;
    }
    this.yaw += this.steer * F5;

    // speed (original: 0.25*(top-c)/10 gas, 0.3 brake, 0.14 offroad floor 1.0)
    if (!frozen) {
      if (brake) {
        this.speed -= 0.3 * F5;
        if (this.speed < 0) this.speed = 0;
      } else if (gas && this.speed < top) {
        this.speed += 0.25 * (top - this.speed) / 10 * F5;
        if (this.speed > top) this.speed = top;
      }
    }

    // motion (original: heading drives velocity, yaw=180 faces +Z)
    const rad = this.yaw * Math.PI / 180;
    this.pos.x += Math.sin(rad) * this.speed * F5;
    this.pos.z += -Math.cos(rad) * this.speed * F5;

    // boundary wall (original a(o): push-back at the track extent line)
    this.wallCollide();

    // suspension + body
    this.sampleWheels(dt, false);
    if (this.offCnt > 1 && this.speed > 1.0) {
      this.speed -= 0.14 * F5;
      if (this.speed < 1.0) this.speed = 1.0;
    }
    if (!this.finished) this.timeT += dt * 10;

    // off-world respawn (original: G > 1 -> h(aW.a), instant);
    // restart guard (aU.f < 4 -> h(5))
    if (this.noGround > 1) this.doRespawn();
    if (this.tileIdx >= 0 && this.tileIdx < 4) this.teleport(5);

    this.checkProgress();

    // ditch guard (original: az >= 2 && (cI==-1 && r[tile].a==7 || cI==1 && r[tile].f==7)
    // -> h(aW.a)): both rear wheels off the road on a steep-ditch profile tile
    if (!this.finished && this.azCnt >= 2 && this.tileIdx >= 0) {
      const tt = this.track.tiles[this.tileIdx];
      if (tt && ((this.cI < 0 && tt.rowR === 7) || (this.cI > 0 && tt.rowL === 7))) {
        this.doRespawn();
      }
    }
  },

  // -------------------------------------------------- boundary wall (original a(o))
  // The original blocks the car with an invisible wall built from the per-tile
  // extent points (profile col16, clamped by neighbours): for every boundary
  // edge, if a wheel crosses it outwards, the car is pushed back inside by the
  // penetration depth (S = f2 * ag, most negative f2 wins, one push per frame).
  // ACTIVATION GATE (original b(o,b2)/a(o,b2) + u.p): a tile's wall edges are
  // only tested when one of the four wheel points is inside that tile's
  // outer-vertex bbox (r.p = min/max of H[0]/H[7] over the tile's 3 stations,
  // x/z only). Edges are built PER TILE only (2 station pairs, r.java collects
  // F/D pairs within the tile's own cross-sections) — testing beyond that lets
  // a far-away edge's infinite line cross the wheel rectangle and shove the
  // car sideways every frame.
  wallCollide() {
    const sts = this.world.stations;
    const bboxes = this.world.tileBboxes;
    const nT = bboxes ? bboxes.length : 0;
    const a = this.tileIdx;
    if (!nT || a === undefined || a === null) return;
    const pts = [[2, 4], [-2, 4], [2, -4], [-2, -4]];
    const rad = this.yaw * Math.PI / 180;
    const cy = Math.cos(rad), sy = Math.sin(rad);
    const wx = [], wz = [];
    for (let k = 0; k < 4; k++) {
      wx[k] = this.pos.x + pts[k][0] * cy - pts[k][1] * sy;
      wz[k] = this.pos.z + pts[k][0] * sy + pts[k][1] * cy;
    }
    const ring = [0, 1, 3, 2, 0];            // wheel rectangle walk (original bK)
    const bb = [0, 0, 0, 0, 0];
    let bestF = 0, pushX = 0, pushZ = 0;
    const t0 = Math.max(0, a - 7), t1 = Math.min(nT - 1, a + 7);
    for (let t = t0; t <= t1; t++) {
      const bx = bboxes[t];
      let active = false;
      for (let k = 0; k < 4 && !active; k++) {
        active = wx[k] >= bx.minX && wx[k] <= bx.maxX && wz[k] >= bx.minZ && wz[k] <= bx.maxZ;
      }
      if (!active) continue;
      for (let s2 = 0; s2 < 2; s2++) {       // the tile's own 2 station pairs
        const i = t * 3 + s2;
        const sa = sts[i], sb = sts[i + 1];
        if (!sa || !sb) continue;
        for (let side = 0; side < 2; side++) {
          // extent boundary points (engine stations carry neighbour-clamped extents)
          const ea = side === 0 ? sa.extR : sa.extL;
          const eb = side === 0 ? sb.extR : sb.extL;
          const sgn = side === 0 ? 1 : -1;
          const Fx = sa.x + sgn * ea * sa.lx / 4, Fz = sa.z + sgn * ea * sa.lz / 4;
          const Dx = sb.x + sgn * eb * sb.lx / 4, Dz = sb.z + sgn * eb * sb.lz / 4;
          let px = Fx - Dx, pz = Fz - Dz;
          const pl = Math.sqrt(px * px + pz * pz);
          if (pl < 1e-6) continue;
          px /= pl; pz /= pl;
          let agx = -pz, agz = px;             // candidate outward normal
          // orient away from the track centreline (station midpoints)
          const cxm = (Fx + Dx) * 0.5 - (sa.x + sb.x) * 0.5;
          const czm = (Fz + Dz) * 0.5 - (sa.z + sb.z) * 0.5;
          if (agx * cxm + agz * czm < 0) { agx = -agx; agz = -agz; }
          for (let k = 0; k < 4; k++) {
            bb[k] = (wx[ring[k]] - Fx) * agx + (wz[ring[k]] - Fz) * agz;
          }
          bb[4] = bb[0];
          for (let k = 0; k < 4; k++) {
            if (bb[k] * bb[k + 1] > 0) continue;          // no line crossing
            let t3, ax, az, bx2, bz;
            if (bb[k] > 0) {
              t3 = bb[k] / (bb[k] - bb[k + 1]);
              if (t3 > 1) continue;
              ax = wx[ring[k]]; az = wz[ring[k]];
              bx2 = wx[ring[k + 1]]; bz = wz[ring[k + 1]];
            } else {
              t3 = bb[k + 1] / (bb[k + 1] - bb[k]);
              if (t3 > 1) continue;
              ax = wx[ring[k + 1]]; az = wz[ring[k + 1]];
              bx2 = wx[ring[k]]; bz = wz[ring[k]];
            }
            const aux = ax + t3 * (bx2 - ax), auz = az + t3 * (bz - az);
            // crossing must land within the edge span - DOMINANT axis of the
            // edge (original: |ag.z|>|ag.x| with ag.z=P.x, ag.x=-P.z). The
            // crossing lies ON the edge line, so its narrow-axis coordinate
            // equals the edge's trivially; only the long-axis span is a real
            // test - checking the narrow axis rejects half the valid crossings
            // on float error and makes the wall leaky.
            if (Math.abs(px) > Math.abs(pz)) {
              if (!((aux >= Fx && aux <= Dx) || (aux <= Fx && aux >= Dx))) continue;
            } else {
              if (!((auz >= Fz && auz <= Dz) || (auz <= Fz && auz >= Dz))) continue;
            }
            const f2 = (aux - ax) * agx + (auz - az) * agz;
            if (f2 < bestF) { bestF = f2; pushX = f2 * agx; pushZ = f2 * agz; }
          }
        }
      }
    }
    if (bestF < 0) {
      this.pos.x += pushX;
      this.pos.z += pushZ;
    }
  },

  // -------------------------------------------------- suspension (original b(float))
  sampleWheels(dt, snap) {
    const F5 = dt * SPEED_K;
    const settle = 0.35 * F5 * F5;
    const rad = this.yaw * Math.PI / 180;
    const cy = Math.cos(rad), sy = Math.sin(rad);
    // wheel ground points in car space: (x=right, z=front+): RF, LF, RR, LR order b[0..3]
    const pts = [[2, 4], [-2, 4], [2, -4], [-2, -4]];
    let noGround = 0, offCnt = 0, touched = 0, azCnt = 0, cI = 0;
    for (let n = 0; n < 4; n++) {
      const ox = pts[n][0], oz = pts[n][1];
      // original bX.postRotate(-yaw): wx = px + ox*cos - oz*sin; wz = px + ox*sin + oz*cos
      const wx = this.pos.x + ox * cy - oz * sy;
      const wz = this.pos.z + ox * sy + oz * cy;
      const g = R3D.sampleGround(this.world, wx, wz, this.segHint);
      if (!g) { noGround++; continue; }
      if (!g.drivable) {
        offCnt++;
        if (n >= 2) azCnt++;                     // original az: rear wheels offroad
        cI = g.sec < 3 ? -1 : 1;                 // original cI: side of last offroad wheel
      }
      const f3 = this.gH[n];
      const f4 = this.gH[n] + this.sus[n];
      if (f3 <= g.y || f4 <= g.y) touched++;   // wheel on ground (original ao)
      if (snap) {
        this.gH[n] = g.y; this.gJ[n] = g.y; this.sus[n] = 0;
        continue;
      }
      if (f3 < g.y && this.sus[n] < g.y - this.gJ[n]) this.sus[n] = g.y - this.gJ[n];
      if (f4 < g.y) {
        this.gH[n] = g.y;
        if (this.sus[n] <= g.y - this.gJ[n]) this.sus[n] = g.y - this.gJ[n];
      } else {
        this.gH[n] = f4;
        // downhill stick-assist: on steep S-curve descents the ground can dive
        // away faster than the spring gravity (0.35*f5^2) pulls the wheel down;
        // the original plant rule then resets the fall rate at every touch and
        // the wheel enters a float->slam->float cycle (body vibration + the
        // airborne control freeze). When a FALLING wheel is only slightly
        // above ground that is descending faster than the wheel falls, glue it
        // to the ground with the terrain's own descent rate. Genuine jumps are
        // untouched: they leave with upward velocity (sus > 0) and build a gap
        // well over 0.6u before falling.
        const gap = f4 - g.y;
        const groundRate = g.y - this.gJ[n];
        if (this.sus[n] < 0 && gap < 0.6 && groundRate < -0.02 && this.sus[n] > groundRate) {
          this.gH[n] = g.y;
          this.sus[n] = groundRate;
        }
      }
      this.gJ[n] = g.y;
    }
    if (!snap) for (let n = 0; n < 4; n++) this.sus[n] -= settle;
    this.noGround = noGround;
    this.offCnt = offCnt;
    this.azCnt = azCnt;
    this.cI = cI;
    this.air = 4 - touched;
    if (noGround === 4) return;
    // roll / pitch (original: target from wheel heights, smoothed /2 per 25fps frame, clamp +-45)
    const f = snap ? 1 : 1 - Math.pow(0.5, dt * 25);
    let targetRoll = (this.gH[3] - this.gH[2]) * 6;
    let targetPitch = (this.gH[2] + this.gH[3] - this.gH[0] - this.gH[1]) * 4;
    this.roll += (targetRoll - this.roll) * f;
    if (this.roll > 45) this.roll = 45; if (this.roll < -45) this.roll = -45;
    this.pitch += (targetPitch - this.pitch) * f;
    if (this.pitch > 45) this.pitch = 45; if (this.pitch < -45) this.pitch = -45;
    if (!snap) this.pos.y = (this.gH[0] + this.gH[1] + this.gH[2] + this.gH[3]) / 4;
  },

  doRespawn() {
    // teleport to the start of the tile the car was last on (original h(aW.a):
    // aW.a keeps its last known segment when airborne)
    const ti = (this.tileIdx !== undefined && this.tileIdx !== null) ? this.tileIdx : 5;
    this.teleport(ti);
    this.camYaw = this.yaw;
  },

  checkProgress() {
    const seg = R3D.sampleGround(this.world, this.pos.x, this.pos.z, this.segHint);
    if (seg) this.segHint = seg.seg;
    const ti = seg ? seg.ti : this.tileIdx;
    this.tileIdx = ti;
    if (ti === undefined || ti === null) return;
    // wrong way: heading vs track direction (original aS via camera-forward dot segment)
    if (seg) {
      const a = this.world.stations[seg.seg], b = this.world.stations[seg.seg + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const rad = this.yaw * Math.PI / 180;
      const dot = Math.sin(rad) * dx + -Math.cos(rad) * dz;
      this.wrongWay = this.timeT > 30 && dot < 0;
    }
    if (this.cpNext < 3 && ti >= this.checkpoints[this.cpNext]) {
      const target = this.gold * (this.cpNext + 1) / 4;
      const diff = Math.round(this.timeT - target);
      this.splitText = (diff >= 0 ? '+' : '-') + fmtTime(Math.abs(diff));
      this.splitColor = diff >= 0 ? '#ff5050' : '#50ff50';
      this.splitT = 2.5;
      AudioSys.sfx('check');
      this.cpNext++;
    }
    if (!this.finished && seg && seg.seg >= this.finishSeg) {
      // finish when the car crosses the checker-flag gate cross-section
      this.finished = true;
      this.phase = 'done';
      this.coastT = 2.4;              // finish shot: orbit to front + fade
      this.doneT = 2.4;
      this.orbitFrom = this.camYaw;
      AudioSys.stopMusic();
      AudioSys.sfx('goal');
      this.buildResults();
    }
    if (!this.finished && this.timeT >= 3000) { // 5 min -> time up
      this.finished = true;
      this.phase = 'done';
      this.coastT = 0.01;
      this.doneT = 0;                 // no cinematic on time-up
      this.buildResults(true);
    }
  },

  buildResults(timeUp) {
    const ti = R3D.game.trackIdx;
    const t10 = Math.round(this.timeT);
    const sv = S();
    // insert into top-5
    let rank = 5;
    for (let i = 4; i >= 0; i--) {
      if (t10 < sv.scores[ti][i]) {
        if (i < 4) { sv.scores[ti][i + 1] = sv.scores[ti][i]; sv.names[ti][i + 1] = sv.names[ti][i]; }
        sv.scores[ti][i] = t10; sv.names[ti][i] = sv.name || D.lang[68];
        rank = i;
      }
    }
    const medalNames = [D.lang[28], D.lang[60], D.lang[8]];
    const rankNames = [D.lang[25], D.lang[55], D.lang[69]];
    let headline, medalText = '', toasts = [];
    if (timeUp) {
      headline = D.lang[72];
    } else if (rank <= 2) {
      headline = medalNames[rank];
      medalText = rankNames[rank];
      // medal + unlocks (original b(int,int))
      if (sv.medals[ti] > rank) sv.medals[ti] = rank;
      for (let k = 1; k < 12; k++) {
        if (sv.medals[k] === 4 && sv.medals[k - 1] <= 2) {
          sv.medals[k] = 3;
          toasts.push(D.lang[85] + ' ' + D.tracks[k].name);
        }
      }
      const need = [-1, 4, 8, 12], req = [-1, 2, 1, 0];
      for (let c = 1; c < 4; c++) {
        if (sv.cars[c] !== 1) continue;
        let blocked = false;
        for (let k = 0; k < need[c]; k++) if (sv.medals[k] > req[c]) { blocked = true; break; }
        if (!blocked) {
          sv.cars[c] = 0;
          toasts.push(D.lang[14] + ' ' + D.cars[c].name);
        }
      }
    } else if (rank === 5) {
      headline = D.lang[29]; // Good job! (new best)
    } else {
      headline = D.lang[42]; // Sorry, no medal
    }
    const best = sv.scores[ti][0];
    R3D.game.results = {
      headline, medalText, toasts, time: t10,
      bestText: rank === 0 ? '' : (D.lang[32].replace(':', '') + ' ' + fmtTime(best)),
    };
    // championship progress
    if (R3D.game.mode === 'champ' && !timeUp && R3D.game.raceIdx === (sv.champ % 12)) {
      sv.champ = (sv.champ + 1);
      if (sv.champ >= 12) {
        R3D.game.results.headline = D.lang[16]; // You are the champion
      }
    }
    R3D.persist();
  },

  // -------------------------------------------------- camera (original c(float))
  updateCamera(dt) {
    const cine = this.phase === 'done' && this.doneT > 1 && this.coastT > 0;
    if (cine) {
      // finish shot: orbit from behind the car around to exactly its front
      // axis (yaw+180); yaw is frozen once finished, so the target is stable
      const t = 1 - this.coastT / this.doneT;
      const e = t * t * (3 - 2 * t);          // smoothstep
      const target = this.yaw + 180;
      this.camYaw = this.orbitFrom + (target - this.orbitFrom) * e;
    } else {
      // camYaw += (yaw - camYaw)/6 per frame (25fps reference -> tau = 0.24s)
      this.camYaw += (this.yaw - this.camYaw) * (1 - Math.exp(-dt * 25 / 6));
    }
    const rad = this.camYaw * Math.PI / 180;
    // camY += (target-camY)/1.6 per frame
    const targetY = this.pos.y + 3.5;
    this.camY += (targetY - this.camY) * (1 - Math.exp(-dt * 25 / 1.6));
    this.camPos.set(
      this.pos.x - Math.sin(rad) * 8,
      this.camY,
      this.pos.z + Math.cos(rad) * 8
    );
    camera.position.copy(this.camPos);
    if (cine) {
      // look at the car while orbiting (blend the look target over the first quarter)
      const t = 1 - this.coastT / this.doneT;
      const k = Math.min(1, t * 4);
      camera.lookAt(
        this.camPos.x + Math.sin(rad) * 10 * (1 - k) + (this.pos.x - this.camPos.x) * k,
        this.camY * (1 - k) + (this.pos.y + 1.2) * k,
        this.camPos.z - Math.cos(rad) * 10 * (1 - k) + (this.pos.z - this.camPos.z) * k
      );
    } else {
      // level look direction (original camera has no pitch)
      camera.lookAt(
        this.camPos.x + Math.sin(rad) * 10,
        this.camY,
        this.camPos.z - Math.cos(rad) * 10
      );
    }
    // car transform: T(pos) * RY(180-yaw) * RZ(roll) * RX(-pitch)  (original a(b,b,int,boolean))
    this.car.position.copy(this.pos);
    this.car.rotation.order = 'YZX';
    this.car.rotation.set(
      -this.pitch * Math.PI / 180,
      (180 - this.yaw) * Math.PI / 180,
      this.roll * Math.PI / 180
    );
  },

  // -------------------------------------------------- draw
  draw() {
    const th = this.tc;
    // background image + sky/ground fills (original d(Graphics))
    const bg = R3D._bgImg[this.theme];
    const bgW = bg.width, bgH = bg.height;
    let x0 = Math.floor((-(this.camYaw * 5 * W / 256) + 3600) % bgW) - bgW;
    const y0 = Math.floor(H / 2 - 110);
    ui.fillStyle = '#000'; ui.fillRect(0, 0, W, H);
    for (let x = x0; x < W; x += bgW) ui.drawImage(bg, x, y0);
    if (y0 > 0) { ui.fillStyle = R3D.argb(th.N).css; ui.fillRect(0, 0, W, y0); }
    const yBot = y0 + bgH;
    if (yBot < H) { ui.fillStyle = R3D.argb(th.ct).css; ui.fillRect(0, yBot, W, H - yBot); }

    // 3D composited over the 2D background (tiles + car + prop billboards)
    if (R3D.scene3d) {
      this.updateTileWindow();
      this.updateProps();
      renderer.render(R3D.scene3d, camera);
      ui.drawImage(R3D._gl, 0, 0);
    }

    // HUD
    this.drawHUD();

    // pause overlay: dim the frozen race frame + simple menu
    if (this.paused) {
      ui.fillStyle = 'rgba(0,0,0,0.6)';
      ui.fillRect(0, 0, W, H);
      text('Paused', W / 2, 76, 5, '#ffffff', 'bold 20px Arial, sans-serif');
      const items = [D.lang[94], 'Restart', 'Quit race'];   // Continue / Restart / Quit
      let py = 130;
      for (let i = 0; i < items.length; i++) {
        text(items[i], W / 2, py, 5, i === this.pauseSel ? '#ffffff' : '#ffffaa', 'bold 15px Arial, sans-serif');
        if (i === this.pauseSel) {
          const w2 = ui.measureText(items[i]).width;
          ui.drawImage(R3D._arrowL, W / 2 - w2 / 2 - 18, py - 2);
          ui.drawImage(R3D._arrowR, W / 2 + w2 / 2 + 8, py - 2);
        }
        py += 24;
      }
      softkeys(D.lang[105], D.lang[92]);
    }

    if (this.phase === 'prerace') {
      drawTitleTransparent();
      text(R3D.game.mode === 'champ' ? D.lang[17] : D.lang[71], W / 2, 96, 5, '#ffffaa', 'bold 15px Arial, sans-serif');
      text(this.track.name, W / 2, 118, 5, '#ffffaa', 'bold 15px Arial, sans-serif');
      text(D.lang[48].replace('%U', '5'), W / 2, 150, 5, '#5fd8f5', 'bold 10px Arial, sans-serif');
      softkeys('', '');
    }
  },

  // -------------------------------------------------- prop billboards
  // The original draws each race section's props as 2D sprites INTERLEAVED with
  // the far-to-near section rendering (h.d(Graphics) releases the 3D target per
  // section), so nearer terrain overdraws farther sprites — trees below the
  // road elevation are hidden by the hill in front of them. A whole-mesh pass
  // with a 2D prop overlay on top loses that occlusion (trees visible through
  // the road). The port draws props as depth-tested billboards INSIDE the 3D
  // scene instead: per-pixel terrain occlusion, same bottom-center anchor
  // (i.java), same 6 distance frames (16u buckets, 6..128u gate, r.java).
  buildPropBillboards(sc) {
    this.propBills = [];
    this._propGeos = {};
    if (!R3D._propMatCache) R3D._propMatCache = {};
    const geoCache = this._propGeos, matCache = R3D._propMatCache;
    for (const p of this.world.props) {
      const key = sheetKey(this.theme, p.sheet);
      const spr = key ? D.sprites[key] : null;
      if (!spr) continue;
      let mat = matCache[key];
      if (!mat) {
        const tex = R3D._sprTex['spr_' + key];
        if (!tex) continue;
        mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
        matCache[key] = mat;
      }
      const geos = geoCache[key] || (geoCache[key] = makeSpriteGeos(key, spr));
      const mesh = new THREE.Mesh(geos[0], mat);
      mesh.visible = false;
      sc.add(mesh);
      this.propBills.push({ p, key, spr, geos, mesh, frame: 0 });
    }
  },

  updateProps() {
    if (!this.propBills) return;
    const k0 = 2 * Math.tan(camera.fov * Math.PI / 360);   // 2*tan(fov/2)
    const v = this._v3 || (this._v3 = new THREE.Vector3());
    const camDir = this._camDir || (this._camDir = new THREE.Vector3());
    camera.getWorldDirection(camDir);
    for (const b of this.propBills) {
      const p = b.p;
      const dx = p.x - camera.position.x, dz = p.z - camera.position.z;
      const depth = dx * camDir.x + dz * camDir.z;          // view-space Z (r.java -x[2])
      if (depth < 6 || depth > 128) { b.mesh.visible = false; continue; }
      v.set(p.x, p.y, p.z).project(camera);
      if (v.z > 1) { b.mesh.visible = false; continue; }
      let frame = Math.floor(depth / 16);
      if (frame > 5) frame = 5;
      if (frame < 0) frame = 0;
      const w = b.spr.w[frame], h = b.spr.h[frame];
      if (!w || !h) { b.mesh.visible = false; continue; }
      if (b.frame !== frame) { b.frame = frame; b.mesh.geometry = b.geos[frame]; }
      // world size so the quad covers exactly w x h pixels at this depth
      const k = k0 * depth / H;
      b.mesh.scale.set(w * k, h * k, 1);
      b.mesh.position.set(p.x, p.y, p.z);
      b.mesh.rotation.y = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
      b.mesh.visible = true;
    }
  },

  // original render window: h.d(Graphics) draws tiles a-1..a+4 only (a = car
  // tile; the 16-slot ring refreshes +-7). Everything farther shows the 2D
  // background — distant elevated strands never float in the sky. The finish
  // cinematic orbits the camera to the car's front, so widen it there.
  updateTileWindow() {
    const meshes = this.world.tileMeshes;
    const a = this.tileIdx;
    if (!meshes || a === undefined || a === null) return;
    const back = this.phase === 'done' ? 5 : 2;
    for (let i = 0; i < meshes.length; i++) {
      meshes[i].visible = i >= a - back && i <= a + 5;
    }
  },

  drawHUD() {
    if (this.phase === 'prerace') return;
    const units = S().settings.units;
    const kmh = Math.round(this.speed * (units === 0 ? KMH : MPH));
    text((units === 0 ? D.lang[34] : D.lang[37]) + kmh, 4, 4, 0, '#ffffaa', 'bold 14px Arial, sans-serif');
    text(fmtTime(Math.round(this.timeT)), W - 4, 4, 8, '#ffffaa', 'bold 14px Arial, sans-serif');
    if (this.splitT > 0) {
      this.splitT -= 1 / 60;
      text(this.splitText, W - 4, 22, 8, this.splitColor, 'bold 13px Arial, sans-serif');
    }
    if (this.goT > 0) {
      text(D.lang[27], W / 2, H / 2 - 20, 5, '#ffffff', 'bold 26px Arial, sans-serif');
    } else if (this.wrongWay && this.phase === 'racing') {
      text(D.lang[91], W / 2, H / 3, 5, '#ffffaa', 'bold 15px Arial, sans-serif');
    }
    if (this.phase === 'countdown') {
      const labels = [D.lang[49], D.lang[59]];
      const idx = Math.min(this.cdN, 1);
      text(labels[idx], W / 2, H / 2 - 20, 5, '#ffffff', 'bold 26px Arial, sans-serif');
    }
    // finish shot fade-out into the results scene
    if (this.phase === 'done' && this.doneT > 1) {
      const t = 1 - Math.max(0, this.coastT) / this.doneT;
      const a = t <= 0.72 ? 0 : Math.min(1, (t - 0.72) / 0.28);
      if (a > 0) {
        ui.fillStyle = 'rgba(0,0,0,' + a.toFixed(3) + ')';
        ui.fillRect(0, 0, W, H);
      }
    }
  },
};

function drawTitleTransparent() {
  // dark translucent band like the original pre-race banner
  ui.fillStyle = 'rgba(0,0,0,0.45)';
  ui.fillRect(0, 88, W, 90);
}

// background images cache
R3D._bgImg = {};
R3D._sprImgs = {};
(function preload() {
  const img = (f) => {
    const i = new Image(); i.src = 'assets/img/' + f; return i;
  };
  for (const t of ['summer', 'desert', 'winter', 'night']) R3D._bgImg[t] = img('bg_' + t + '.png');
  for (const k in D.sprites) R3D._sprImgs[k] = img(k + '.png');
})();

R3D.raceScene = raceScene;

})();

