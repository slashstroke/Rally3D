/* Rally 3D port — engine v2 (world/track/car rendering)
   Geometry ported 1:1 from the original jar's decompiled renderer (r.java):
   - cross-sections spread along the RIGHT vector (cross(up, dir) x 4), 8 profile points
   - 3 cross-sections per 32u tile (cursor advances 16u/step, rotates 4x tile-heading per step)
   - 7 strips per cross-section pair: outer/shoulder/road/shoulder/outer
   - atlas UV: v = (tileIndex&1)*0.5 + station, u per-section texel 1/31 rule
   - per-quad random vertex brightness, 8 variants cycled by tileIndex%8
   - NO ground plain mesh (original shows the 2D background behind the strips) */
(function () {
'use strict';
const D = window.R3D_DATA;

const R3D = window.R3D = {
  W: 240, H: 320,
  SPEED_K: 15,          // world units/s per speed unit c (calibrated vs medal times)
  themeColors: {
    desert: { N: -9667900, ct: -4940137, bD: -7770560 },
    winter: { N: -12821864, ct: -2828839, bD: -86 },
    summer: { N: -10058565, ct: -10198189, bD: -86 },
    night:  { N: -9078942, ct: -16514546, bD: -86 },
  },
};

function argb(v) {
  v = v | 0;
  const a = (v >>> 24) & 255, r = (v >>> 16) & 255, g = (v >>> 8) & 255, b = v & 255;
  return { a, r, g, b, css: 'rgba(' + r + ',' + g + ',' + b + ',' + (a / 255) + ')' };
}
R3D.argb = argb;

// ---------------------------------------------------------------- textures
const TEX = {};
R3D._sprTex = TEX;      // sprite-sheet textures for the race prop billboards
function loadTex(key, file, repeat) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const t = new THREE.Texture(img);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
      t.needsUpdate = true;
      TEX[key] = t; res();
    };
    img.onerror = () => res();
    img.src = 'assets/img/' + file;
  });
}

R3D.loadAll = async function () {
  const jobs = [];
  jobs.push(loadTex('squares_summer', 'squares_summer.png', true));
  jobs.push(loadTex('squares_desert', 'squares_desert.png', true));
  jobs.push(loadTex('squares_winter', 'squares_winter.png', true));
  jobs.push(loadTex('squares_night', 'squares_night.png', true));
  for (let c = 1; c <= 4; c++) jobs.push(loadTex('car' + c, 'car' + c + '.png'));
  jobs.push(loadTex('wheel', 'wheel.png'));
  for (const k in D.sprites) jobs.push(loadTex('spr_' + k, k + '.png'));
  jobs.push(loadTex('bg_summer', 'bg_summer.png'));
  jobs.push(loadTex('bg_desert', 'bg_desert.png'));
  jobs.push(loadTex('bg_winter', 'bg_winter.png'));
  jobs.push(loadTex('bg_night', 'bg_night.png'));
  await Promise.all(jobs);
};

// ---------------------------------------------------------------- car meshes
function synGeometry(m) {
  const pos = new Float32Array(m.pos.length * 3);
  const uv = new Float32Array(m.pos.length * 2);
  for (let i = 0; i < m.pos.length; i++) {
    pos[i * 3] = m.pos[i][0]; pos[i * 3 + 1] = m.pos[i][1]; pos[i * 3 + 2] = m.pos[i][2];
    uv[i * 2] = m.uv[i][0]; uv[i * 2 + 1] = 1 - m.uv[i][1];
  }
  const idx = [];
  for (let i = 0; i + 2 < m.idx.length; i += 3) {
    idx.push(m.idx[i], m.idx[i + 1], m.idx[i + 2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

R3D.buildCar = function (carIdx) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ map: TEX['car' + (carIdx + 1)] });
  const body = new THREE.Mesh(synGeometry(D.meshes['car' + (carIdx + 1)]), mat);
  grp.add(body);
  const wmat = new THREE.MeshBasicMaterial({ map: TEX.wheel });
  const wg = synGeometry(D.meshes.wheel);
  const offs = [[1.05, -0.1, 1.5], [-1.05, -0.1, 1.5], [1.05, -0.1, -1.6], [-1.05, -0.1, -1.6]];
  grp.userData.wheels = [];
  for (const o of offs) {
    const w = new THREE.Mesh(wg, wmat);
    w.position.set(o[0], o[1], o[2]);
    grp.add(w);
    grp.userData.wheels.push(w);
  }
  return grp;
};

// ---------------------------------------------------------------- track world
// Port of the original tile builder + renderer (r.java a(int,a,a,a) + h.a(String,int)):
//  - tile = 32u: 3 cross-sections spaced 16u (cursor |16|, rotates 4x heading per step)
//  - cross-section points H[0..7]: left side -nv[0,2,4,6], right side +pv[6,4,2,0]
//    (H0/H7 outermost terrain edge, H3/H4 road edges at profile col6)
//  - strip k spans H[k]..H[k+1]; strip 3 = road
R3D.buildTrack = function (track) {
  const tiles = track.tiles;
  const theme = track.theme;
  const P = D.profiles;
  const positions = [], uvs = [], colors = [], indices = [];
  const props = [];
  const stations = []; // {x,y,z, fx,fz, lx,lz, H[8], extR, extL, ti, st}
  let rngState = 1234 + tiles.length * 7919;
  function rng() { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; }

  // per-tile randomized prop codes (original h.a(String,int) load rules)
  const tileProps = tiles.map((t) => {
    function code(p) { if (p === -1) return Math.floor(rng() * 3); if (p === -2) return -1; return p; }
    function lat(o) { if (o <= -1) return 1 + Math.floor(rng() * 2); return o; }
    return { pA: code(t.pL), oA: lat(t.oL), pB: code(t.pR), oB: lat(t.oR) };
  });

  // ---- per-quad vertex brightness variants (r.a init) ----
  // variants[v][quad 0..2][section 0..6] = [brightA, brightB]
  // Original rule: bytes regenerate for j==0 or q!=0 ONLY — variant j>0 quad 0
  // keeps the previous variant's last bytes, so the brightness CHAIN is
  // continuous across tile boundaries (tile boundary quad v[j]q0 == v[j-1]q2).
  // v7q2 wraps by copying v0q0. Without the carry-over every 32u tile seam
  // shows a brightness step -> mountains look like separate slabs.
  const variants = [];
  {
    const by = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let j = 0; j < 8; j++) {
      const quads = [];
      for (let q = 0; q < 3; q++) {
        if (j === 0 || q !== 0) {
          for (let n = 0; n < 8; n++) by[n] = 64 + Math.floor(rng() * 192);
        }
        const secs = [];
        for (let sec = 0; sec < 7; sec++) {
          secs.push([by[sec + 1], by[sec]]);
        }
        quads.push(secs);
      }
      variants.push(quads);
    }
    variants[7][2] = variants[0][0].map((s) => s.slice());
  }

  // ---- stations: 3 per tile, positions identical to the parser's turtle walk ----
  // SEAM HEALING: the original renderer restarts every tile at its OWN row-start
  // profile, and the ad[] transition table allows rows whose start != previous
  // row's end (wall 13 -> bank 5, ditch -20 -> bridge deck). At the shared
  // boundary cross-section that is a vertical cliff with no polygon between
  // (the user-visible "split mountains / broken bridges"). We blend instead
  // from the PREVIOUS tile's row-END profile to this tile's row-END profile:
  // for matched chains (end == next start) this reduces to the original
  // exactly; for step transitions it becomes a smooth 32u morph, so hills,
  // walls, ditches and bridge approaches are truly continuous.
  let prevEndR = null, prevEndN = null;
  // bridge profile rows (11/12/13: raised rails, plain deck ledge): identified
  // by atlas columns 18-20 = 6,6,6 (hill rows 4-6 share extent 12 but have
  // atlas 4,1,2). Their drivable deck is the road strip only (|lat| <= 8u);
  // sections beyond it are the vertical rail faces / ledge with K=0.
  function rowBridge(row) { return row[18] === 6 && row[19] === 6 && row[20] === 6; }
  for (let ti = 0; ti < tiles.length; ti++) {
    const t = tiles[ti];
    const rp = P[t.rowL], rn = P[t.rowR];      // rowL = right side (s7), rowR = left side (s8)
    const startR = prevEndR || rp.slice(0, 8);
    const startN = prevEndN || rn.slice(0, 8);
    let pv = startR.slice(), nv = startN.slice();
    const dpv = [], dnv = [];
    for (let i = 0; i < 8; i++) { dpv.push((rp[8 + i] - startR[i]) / 2); dnv.push((rn[8 + i] - startN[i]) / 2); }
    // terrain extent (col16, world units), lerped across the tile with neighbour clamping.
    // BRIDGE RAILS: bridge rows carry rails whose faces/ledge are non-drivable
    // (K=0) beyond the road edge (8u) while their extent says 12u - the wall
    // sat BEYOND the deck, so wheels could reach the rails, found no ground
    // and the car respawned. Make the rails SOLID: wall the car at the rail
    // base (8u) so it rides pressed against them instead of dying on them.
    const effR = rowBridge(rp) ? 8 : rp[16];
    const effL = rowBridge(rn) ? 8 : rn[16];
    let extRs = effR, extRe = effR, extLs = effL, extLe = effL;
    const prev = tiles[ti - 1], next = tiles[ti + 1];
    if (prev) {
      const pvR = rowBridge(P[prev.rowL]) ? 8 : P[prev.rowL][16];
      const pvL = rowBridge(P[prev.rowR]) ? 8 : P[prev.rowR][16];
      if (pvR < extRs) extRs = pvR;
      if (pvL < extLs) extLs = pvL;
    }
    if (next) {
      const nxR = rowBridge(P[next.rowL]) ? 8 : P[next.rowL][16];
      const nxL = rowBridge(P[next.rowR]) ? 8 : P[next.rowR][16];
      if (extRe > nxR) extRe = nxR;
      if (extLe > nxL) extLe = nxL;
    }
    const dExtR = (extRe - extRs) / 2, dExtL = (extLe - extLs) / 2;

    let dirx = t.cx, dirz = t.cz2;
    let px = t.x, pz = t.z;
    let h = t.h, vy = t.vy, ay = t.ay;
    const rad = t.deg * Math.PI / 180;
    const cosr = Math.cos(rad), sinr = Math.sin(rad);

    for (let st = 0; st < 3; st++) {
      // RIGHT vector = cross(up, dir) normalized * 4  (r.java: l.c(I,S); l.a(); *=4)
      const ln = Math.sqrt(dirx * dirx + dirz * dirz) || 1;
      const lx = dirz / ln * 4, lz = -dirx / ln * 4;
      const fx = dirx / ln, fz = dirz / ln;
      const H = new Array(8);
      for (let k = 0; k < 4; k++) {   // left side: H[0]=outermost ... H[3]=road left edge
        H[k] = { x: px - nv[k * 2] * lx, y: h + nv[k * 2 + 1], z: pz - nv[k * 2] * lz };
      }
      for (let k = 0; k < 4; k++) {   // right side: H[7]=outermost ... H[4]=road right edge
        H[7 - k] = { x: px + pv[k * 2] * lx, y: h + pv[k * 2 + 1], z: pz + pv[k * 2] * lz };
      }
      stations.push({
        x: px, y: h, z: pz, fx, fz, lx, lz, H,
        extR: extRs + dExtR * st, extL: extLs + dExtL * st,
        ti, st,
      });
      // advance cursor one station step (16u), elevation 4 sub-steps, rotate 4x heading
      px += dirx; pz += dirz;
      for (let r = 0; r < 4; r++) { h += vy; vy += ay; }
      for (let r = 0; r < 4; r++) {
        const nx = dirx * cosr + dirz * sinr, nz = -dirx * sinr + dirz * cosr;
        dirx = nx; dirz = nz;
      }
      for (let i = 0; i < 8; i++) { pv[i] += dpv[i]; nv[i] += dnv[i]; }
    }
    extRs += dExtR * 3; extLs += dExtL * 3;

    // props at the tile's last cross-section, at cross-section vertices (r.java a(Graphics,T,T))
    const tp = tileProps[ti];
    const S2 = stations[stations.length - 1];
    // r.java prop vertices: right prop at section (3+j) slot4 row -> H[4+j];
    // left prop at section (3-G) slot5 row -> H[3-G]  (NOT H[4-oB] — that put
    // both finish flags on the same road-edge vertex -> only one visible)
    if (tp.pA > -1) {
      const idx = 4 + Math.max(0, Math.min(3, tp.oA));
      const Hv = S2.H[idx];
      props.push({ sheet: tp.pA, x: Hv.x, y: Hv.y, z: Hv.z, ti });
    }
    if (tp.pB > -1) {
      const idx = 3 - Math.max(0, Math.min(3, tp.oB));
      const Hv = S2.H[Math.max(0, idx)];
      props.push({ sheet: tp.pB, x: Hv.x, y: Hv.y, z: Hv.z, ti });
    }

    prevEndR = rp.slice(8, 16);
    prevEndN = rn.slice(8, 16);
  }

  // ---- road/terrain strips: ONE MESH PER TILE (2 quads per section, 3 cross-sections).
  // The original renders only a 6-tile window (h.d(Graphics): tiles a-1..a+4 drawn
  // far-to-near, props interleaved per section); distant strands are NEVER drawn
  // (the 2D background + haze show instead). Per-tile meshes let race.js toggle
  // that window every frame — distant elevated strands no longer float in the sky.
  const texW = 256;
  const trackMat = new THREE.MeshBasicMaterial({
    map: TEX['squares_' + theme], vertexColors: true, side: THREE.DoubleSide,
  });
  const tileMeshes = [];
  for (let ti = 0; ti < tiles.length; ti++) {
    const t = tiles[ti];
    const rp = P[t.rowL], rn = P[t.rowR];
    const ncols = [rn[20], rn[19], rn[18], (t.line === 0 ? 0 : 5), rp[18], rp[19], rp[20]];
    const vbase = (ti & 1) * 0.5;
    const varr = variants[ti % 8];
    const positions = [], uvs = [], colors = [], indices = [];
    for (let q = 0; q < 2; q++) {
      const SA = stations[ti * 3 + q], SB = stations[ti * 3 + q + 1];
      for (let sec = 0; sec < 7; sec++) {
        const base = positions.length / 3;
        const Aa = SA.H[sec + 1], Ba = SA.H[sec];
        const Ab = SB.H[sec + 1], Bb = SB.H[sec];
        positions.push(Aa.x, Aa.y, Aa.z, Ba.x, Ba.y, Ba.z, Ab.x, Ab.y, Ab.z, Bb.x, Bb.y, Bb.z);
        // per-STATION vertex colours (r.java o[] init): every cross-section
        // vertex carries the brightness bytes generated for ITS station, and a
        // quad Gouraud-interpolates between the two stations. Feeding one
        // station's bytes to BOTH quad edges (old bug) made each 16u quad a
        // flat slab with harsh 4x brightness steps - the patchwork look.
        // Station q+1 of the variant chain == the next quad's station q, and
        // variant j station 0 carries variant j-1 station 2, so brightness is
        // continuous along the whole track AND across tile boundaries.
        const brA = varr[q][sec], brB = varr[q + 1][sec];
        colors.push(brA[0] / 255, brA[0] / 255, brA[0] / 255,
                    brA[1] / 255, brA[1] / 255, brA[1] / 255,
                    brB[0] / 255, brB[0] / 255, brB[0] / 255,
                    brB[1] / 255, brB[1] / 255, brB[1] / 255);
        // u per section: terrain strips keep texel 31 on the road-side vertex;
        // road strip: right edge texel 1, left edge texel 31 (r.java s4/s5 rule)
        const cell = ncols[sec] * 32;
        let uA, uB;
        if (sec < 3) { uA = (cell + 31) / texW; uB = (cell + 1) / texW; }
        else { uA = (cell + 1) / texW; uB = (cell + 31) / texW; }
        const vA = vbase + q, vB = vbase + q + 1;
        uvs.push(uA, vA, uB, vA, uA, vB, uB, vB);
        indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    tileMeshes.push(new THREE.Mesh(geo, trackMat));
  }

  // per-tile section walkability flags (r.java K[]): K[0..2] from the LEFT row
  // (rowR) cols 21..23, K[4..6] from the RIGHT row (rowL) cols 23..21, K[3]=1.
  // Sections with K=0 return no ground in the original sampler (h.c).
  const tileK = tiles.map((t) => {
    const L = P[t.rowL], R = P[t.rowR];   // rowL drives RIGHT side, rowR LEFT
    return [R[21], R[22], R[23], 1, L[23], L[22], L[21]];
  });

  // per-tile boundary-wall activation bbox (original r.p): min/max over the
  // tile's 3 stations' OUTERMOST cross-section vertices H[0]/H[7], X/Z only
  // (u.java a(b) tests x and z). h.a(o,o2) only tests walls of tiles whose
  // bbox contains one of the four wheel points — without this gate a far-away
  // edge whose infinite line crosses the wheel rectangle shoves the car
  // sideways every frame (the "car pushed to one side" bug).
  const tileBboxes = [];
  for (let ti = 0; ti < tiles.length; ti++) {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let st = 0; st < 3; st++) {
      const s = stations[ti * 3 + st];
      for (const v of [s.H[0], s.H[7]]) {
        if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
        if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
      }
    }
    tileBboxes.push({ minX, maxX, minZ, maxZ });
  }

  return { tileMeshes, props, stations, tileK, tileBboxes };
};

// ---------------------------------------------------------------- ground sampling
// Faithful port of the original h.c(o,b): a point-in-quad test over the actual
// track mesh triangles, exactly the quads the renderer draws, so physics height
// always matches what is on screen (the old nearest-centerline approximation
// grabbed the wrong strand near hairpins -> bouncing + false respawns).
// - window: +-7 tiles (= +-21 stations) around the hint, like the original
//   16-tile segment window; searched OUTWARDS from the hint (slot order)
// - containment: the quad's two triangles in the x/z plane (same corner order
//   as the rendered indices), height = planar interpolation of the hit triangle
// - no height-based rejection: the original returns -999999 only when the point
//   is inside no quad at all
R3D.sampleGround = function (world, x, z, hint) {
  const sts = world.stations;
  const n = sts.length;
  const h0 = (hint !== undefined && hint !== null) ? hint : 0;
  const EPS = 0.003;   // shared-edge tolerance (barycentric), avoids seam flicker
  function triHit(p0, p1, p2) {
    const d = (p1.z - p2.z) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.z - p2.z);
    if (d > -1e-9 && d < 1e-9) return null;    // degenerate quad row
    const l1 = ((p1.z - p2.z) * (x - p2.x) + (p2.x - p1.x) * (z - p2.z)) / d;
    const l2 = ((p2.z - p0.z) * (x - p2.x) + (p0.x - p2.x) * (z - p2.z)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -EPS || l2 < -EPS || l3 < -EPS) return null;
    return l1 * p0.y + l2 * p1.y + l3 * p2.y;
  }
  for (let off = 0; off <= 21; off++) {
    const cands = off === 0 ? [h0] : [h0 + off, h0 - off];
    for (let ci = 0; ci < cands.length; ci++) {
      const i = cands[ci];
      if (i < 0 || i >= n - 1) continue;
      const a = sts[i], b = sts[i + 1];
      // cheap reject: strip extent never exceeds ~34u from the centerline;
      // allow one segment length of slack
      const mx = x - (a.x + b.x) * 0.5, mz = z - (a.z + b.z) * 0.5;
      const dxs = b.x - a.x, dzs = b.z - a.z;
      const lim = Math.sqrt(dxs * dxs + dzs * dzs) * 0.5 + 42;
      if (mx * mx + mz * mz > lim * lim) continue;
      const K = world.tileK ? world.tileK[a.ti] : null;   // original K[] section gate
      for (let sec = 0; sec < 7; sec++) {
        if (K && !K[sec]) continue;
        const Aa = a.H[sec + 1], Ba = a.H[sec], Ab = b.H[sec + 1], Bb = b.H[sec];
        let y = triHit(Aa, Ba, Ab);
        if (y === null) y = triHit(Ab, Ba, Bb);
        if (y !== null) {
          return { y, seg: i, ti: a.ti, sec, drivable: sec >= 2 && sec <= 4, onRoad: sec === 3 };
        }
      }
    }
  }
  return null;                                  // off-world (original -999999)
};

})();

