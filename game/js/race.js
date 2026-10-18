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
const TMPV = new THREE.Vector3();   // scratch for prop depth (camera forward)

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
  segHint: 0, air: 0,
  cpNext: 0, finished: false, wrongWay: false,
  azCnt: 0, cI: 0, coastT: 0, finishSeg: 0,
  doneT: 0, orbitFrom: 0,          // finish cinematic: orbit duration + start yaw
  splitText: '', splitColor: '#fff', splitT: 0,

  enter() {
    const ti = R3D.game.trackIdx;
    this.track = D.tracks[ti];
    this.theme = this.track.theme;
    this.world = R3D.buildTrack(this.track);
    R3D.clearScene3d();
    const sc = new THREE.Scene();
    sc.add(this.world.mesh);
    this.car = R3D.buildCar(R3D.game.carIdx);
    sc.add(this.car);
    // Props as real depth-tested billboards: the original blitted them as 2D
    // sprites over the finished frame (r.a(Graphics,...) has no occlusion
    // test), so trees/bushes standing below an elevated section floated over
    // it. Placed in the z-buffer they hide behind hills/bridges and clip
    // correctly at crests, matching what the world should look like.
    const pg = new THREE.PlaneGeometry(1, 1);
    pg.translate(0, 0.5, 0);                  // origin at the bottom centre
    this.propGeo = pg;
    this.propMeshes = [];
    for (const p of this.world.props) {
      const key = sheetKey(this.theme, p.sheet);
      if (!key || !D.sprites[key]) continue;
      const m = new THREE.Mesh(pg, null);
      m.position.set(p.x, p.y, p.z);
      m.visible = false;
      m.userData.prop = { p, key };
      sc.add(m);
      this.propMeshes.push(m);
    }
    R3D.scene3d = sc;
    this.tc = THEMES[this.theme];
    this.phase = 'prerace';
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
    // snap wheels to ground (original h(int))
    this.sampleWheels(0.0001, true);
    this.pos.y = (this.gH[0] + this.gH[1] + this.gH[2] + this.gH[3]) / 4;
    this.air = 0;
  },

  update(dt) {
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

  // -------------------------------------------------- physics (original d(boolean))
  step(dt) {
    const car = R3D.game.carIdx;
    const top = TOPS[car] / 10;
    const F5 = dt * SPEED_K;
    // input frozen once finished (finish cinematic coast)
    const gas = !this.finished && (R3D.keys.U || S().settings.auto === 1);
    const brake = !this.finished && R3D.keys.D;
    const left = !this.finished && R3D.keys.L, right = !this.finished && R3D.keys.R;

    // steering (original: 1.5 accumulate, 2.5 return, clamp +-6;
    // frozen while airborne - ao < 4 gate means at least one wheel touched)
    if (this.air < 4) {
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
    if (this.air < 4) {
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
  // Faithful port of h.java a(o): the boundary polyline is built per station
  // pair with the original's F/D storage order (r.java a(int,a,a,a)):
  //   RIGHT edge: F = prev station point, D = cur  (F->D along the travel)
  //   LEFT  edge: F = cur station point,  D = prev (F->D against the travel)
  // The push normal ag = perp(F - D) is FIXED by that order and always points
  // OUTWARD on both sides - the original never re-orients it. (The old port
  // flipped the normal toward the local centreline; on extent-sweep curves the
  // boundary midpoint can fall on the wrong side, inverting the test and
  // shoving the car ACROSS the track - the reported "pushed to the left".)
  // For every boundary edge, if the wheel ring crosses it outwards, the car is
  // pushed back by the outside wheel's penetration (S = f2 * ag, most negative
  // f2 wins, one push per frame).
  // Two guards taken from the original keep far-away edges inert:
  //  1. tile activation (original o.a[] flags via the r.p AABB): a tile's
  //     edges are only live while a wall-ring point is inside the tile's
  //     outer-vertex bounding box. Without it the boundary line of a tile the
  //     car passed seconds ago (a straight section that a later curve bends
  //     back towards, ~90u back along the path but a few units away in space)
  //     still crosses the ring via its INFINITE extension - the car got a
  //     sideways shove at exactly the same spot of every lap.
  //  2. dominant-axis span check (original compares |ag.z|>|ag.x|): the
  //     crossing must land within the edge's LONG axis, not its narrow one -
  //     testing the narrow axis made the check vacuous for track-aligned
  //     edges (crossing.x == edge.x trivially) and let guard 1's leftovers
  //     through.
  wallCollide() {
    const sts = this.world.stations;
    const boxes = this.world.tileBoxes;
    const n = sts.length;
    const h0 = this.segHint || 0;
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
    const i0 = Math.max(0, h0 - 9), i1 = Math.min(n - 2, h0 + 8);
    for (let i = i0; i <= i1; i++) {
      const sa = sts[i], sb = sts[i + 1];
      if (boxes) {
        const box = boxes[sa.ti];
        let inside = false;
        for (let k = 0; k < 4; k++) {
          if (wx[k] >= box.minx && wx[k] <= box.maxx && wz[k] >= box.minz && wz[k] <= box.maxz) { inside = true; break; }
        }
        if (!inside) continue;
      }
      for (let side = 0; side < 2; side++) {
        // extent boundary points in the original's F/D order
        let Fx, Fz, Dx, Dz;
        if (side === 0) {   // right: F = prev, D = cur
          Fx = sa.x + sa.extR * sa.lx / 4; Fz = sa.z + sa.extR * sa.lz / 4;
          Dx = sb.x + sb.extR * sb.lx / 4; Dz = sb.z + sb.extR * sb.lz / 4;
        } else {            // left: F = cur, D = prev
          Fx = sb.x - sb.extL * sb.lx / 4; Fz = sb.z - sb.extL * sb.lz / 4;
          Dx = sa.x - sa.extL * sa.lx / 4; Dz = sa.z - sa.extL * sa.lz / 4;
        }
        let px = Fx - Dx, pz = Fz - Dz;
        const pl = Math.sqrt(px * px + pz * pz);
        if (pl < 1e-6) continue;
        px /= pl; pz /= pl;
        const agx = -pz, agz = px;           // fixed outward normal (r.java)
        for (let k = 0; k < 4; k++) {
          bb[k] = (wx[ring[k]] - Fx) * agx + (wz[ring[k]] - Fz) * agz;
        }
        bb[4] = bb[0];
        for (let k = 0; k < 4; k++) {
          if (bb[k] * bb[k + 1] > 0) continue;          // no line crossing
          let t, ax, az, bx, bz;
          if (bb[k] > 0) {
            t = bb[k] / (bb[k] - bb[k + 1]);
            if (t > 1) continue;
            ax = wx[ring[k]]; az = wz[ring[k]];
            bx = wx[ring[k + 1]]; bz = wz[ring[k + 1]];
          } else {
            t = bb[k + 1] / (bb[k + 1] - bb[k]);
            if (t > 1) continue;
            ax = wx[ring[k + 1]]; az = wz[ring[k + 1]];
            bx = wx[ring[k]]; bz = wz[ring[k]];
          }
          const aux = ax + t * (bx - ax), auz = az + t * (bz - az);
          // crossing must land within the edge span - DOMINANT axis of the
          // edge (original: |ag.z|>|ag.x| with ag.z=P.x, ag.x=-P.z)
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
      this.coastT = 4.0;              // finish shot: slower orbit to the front,
      this.doneT = 4.0;               // hold the front view, then fade
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
      // axis (yaw+180); yaw is frozen once finished, so the target is stable.
      // The sweep eases through the first 72% of the shot (slower than
      // before), then the camera HOLDS the front view for a beat before the
      // fade begins at 86%.
      const t = 1 - this.coastT / this.doneT;
      const tOrb = Math.min(1, t / 0.72);
      const e = tOrb * tOrb * (3 - 2 * tOrb); // smoothstep
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
      const tOrb = Math.min(1, t / 0.72);
      const k = Math.min(1, tOrb * 4);
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
    this.updateProps();
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

    // 3D composited over the 2D background (props are part of the 3D scene)
    if (R3D.scene3d) {
      renderer.render(R3D.scene3d, camera);
      ui.drawImage(R3D._gl, 0, 0);
    }

    // HUD
    this.drawHUD();

    if (this.phase === 'prerace') {
      drawTitleTransparent();
      text(R3D.game.mode === 'champ' ? D.lang[17] : D.lang[71], W / 2, 96, 5, '#ffffaa', 'bold 15px Arial, sans-serif');
      text(this.track.name, W / 2, 118, 5, '#ffffaa', 'bold 15px Arial, sans-serif');
      text(D.lang[48].replace('%U', '5'), W / 2, 150, 5, '#5fd8f5', 'bold 10px Arial, sans-serif');
      softkeys('', '');
    }
  },

  // -------------------------------------------------- props (3D billboards)
  // Per-sheet assets: 6 alpha-tested materials (one per distance frame, UV
  // window into the sheet) + world sizes that reproduce the original's screen
  // sizes at each 16u bucket mid (frame f covers depth 16f..16f+16 and was
  // drawn at its native pixel size; px = Yw*(H/2)/(tan(fov/2)*d)). Sizes are
  // lerped between buckets so the scaling is continuous instead of the
  // original's 6 hard steps.
  propAssets(key) {
    let a = R3D._propAssets[key];
    if (a) return a;
    const img = R3D._sprImgs[key];
    const spr = D.sprites[key];
    if (!img || !img.complete || !img.naturalWidth || !spr) return null;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const base = new THREE.Texture(img);
    base.magFilter = THREE.NearestFilter;
    base.minFilter = THREE.NearestFilter;
    base.generateMipmaps = false;
    const mats = [], Yw = [], Xw = [];
    const K = 2 * Math.tan(camera.fov * Math.PI / 360) / H;
    for (let f = 0; f < 6; f++) {
      const t = base.clone();
      t.offset.set(spr.ox[f] / iw, 1 - (spr.oy[f] + spr.h[f]) / ih);
      t.repeat.set(spr.w[f] / iw, spr.h[f] / ih);
      t.needsUpdate = true;
      mats.push(new THREE.MeshBasicMaterial({
        map: t, alphaTest: 0.5, side: THREE.DoubleSide,
        depthTest: true, depthWrite: true,
      }));
      const d = 16 * f + 8;
      Yw.push(spr.h[f] * d * K);
      Xw.push(spr.w[f] * d * K);
    }
    a = { mats, Yw, Xw };
    R3D._propAssets[key] = a;
    return a;
  },

  updateProps() {
    if (!this.propMeshes) return;
    const cp = camera.position;
    camera.getWorldDirection(TMPV);
    const fx = TMPV.x, fz = TMPV.z;
    for (const m of this.propMeshes) {
      const pr = m.userData.prop;
      const a = this.propAssets(pr.key);
      if (!a) { m.visible = false; continue; }
      const dx = pr.p.x - cp.x, dz = pr.p.z - cp.z;
      const depth = dx * fx + dz * fz;
      if (depth < 6 || depth > 128) { m.visible = false; continue; }
      let f = Math.floor(depth / 16);
      if (f > 5) f = 5;
      if (f < 0) f = 0;
      const frac = Math.min(1, depth / 16 - f);
      const f2 = f < 5 ? f + 1 : 5;
      m.material = a.mats[f];
      m.scale.set(a.Xw[f] + (a.Xw[f2] - a.Xw[f]) * frac,
                  a.Yw[f] + (a.Yw[f2] - a.Yw[f]) * frac, 1);
      m.rotation.y = Math.atan2(cp.x - pr.p.x, cp.z - pr.p.z);
      m.visible = true;
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
    // finish shot fade-out into the results scene (after the front-view hold)
    if (this.phase === 'done' && this.doneT > 1) {
      const t = 1 - Math.max(0, this.coastT) / this.doneT;
      const a = t <= 0.86 ? 0 : Math.min(1, (t - 0.86) / 0.14);
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
R3D._propAssets = {};   // cached billboard materials + world sizes per sheet
(function preload() {
  const img = (f) => {
    const i = new Image(); i.src = 'assets/img/' + f; return i;
  };
  for (const t of ['summer', 'desert', 'winter', 'night']) R3D._bgImg[t] = img('bg_' + t + '.png');
  for (const k in D.sprites) R3D._sprImgs[k] = img(k + '.png');
})();

R3D.raceScene = raceScene;

})();

