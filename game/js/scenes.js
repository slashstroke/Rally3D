/* Rally 3D port — scenes: menus, showroom, results */
(function () {
'use strict';
const D = window.R3D_DATA;
const R3D = window.R3D;
const W = R3D.W, H = R3D.H;
const ui = document.getElementById('ui').getContext('2d');
const renderer = window.R3D._renderer;
const camera = window.R3D._camera;
const S = () => R3D.saveObj;
const COL_TEXT = '#ffffaa', COL_WHITE = '#ffffff', COL_GREY = '#9a9a9a';
const text = R3D.text, softkeys = R3D.softkeys, menuList = R3D.menuList,
      drawTitle = R3D.drawTitle, padlock = R3D.padlock, fmtTime = R3D.fmtTime,
      wasPressed = R3D.wasPressed, AudioSys = R3D.audio;

function argbCss(v) { return R3D.argb(v).css; }

// ================================================================ TITLE
// Original menus play title.mid ONLY (restarted by the menu loop whenever no
// player is active — h.java line 2251) and have NO navigation sound effects;
// plink1/plink2 are exclusively the race countdown beeps.
function mainItems() {
  return [
    { label: D.lang[101] },                    // New game
    { label: D.lang[97] },                     // High scores
    { label: D.lang[107] },                    // Settings
    { label: D.lang[99] },                     // Instructions
  ];
}

const titleScene = {
  sel: 0, menuMusic: true, banner: true,   // no header → logo slides in with the banner
  enter() { AudioSys.play('title', true, 0.5); R3D.clearScene3d(); },
  update() {
    if (wasPressed('D')) this.sel = (this.sel + 1) % 4;
    if (wasPressed('U')) this.sel = (this.sel + 3) % 4;
    if (wasPressed('F') || wasPressed('L')) {
      if (this.sel === 0) R3D.setScene(newGameScene);
      else if (this.sel === 1) R3D.setScene(hiScoreScene);
      else if (this.sel === 2) R3D.setScene(settingsScene);
      else R3D.setScene(instructionsScene);
    }
  },
  draw() {
    ui.fillStyle = '#000'; ui.fillRect(0, 0, W, H);
    menuList('', mainItems(), this.sel, 130);
    softkeys(D.lang[105], D.lang[95]);
  },
};

// ================================================================ NEW GAME (mode select)
const newGameScene = {
  sel: 0, menuMusic: true, banner: true,
  enter() { this.sel = 0; },
  update() {
    const n = 2;
    if (wasPressed('D')) this.sel = (this.sel + 1) % n;
    if (wasPressed('U')) this.sel = (this.sel + n - 1) % n;
    if (wasPressed('RS')) { R3D.setScene(titleScene); return; }
    if (wasPressed('F') || wasPressed('L')) {
      if (this.sel === 0) { R3D.game.mode = 'champ'; R3D.setScene(nextRaceScene); }
      else { R3D.game.mode = 'tt'; R3D.setScene(trackSelectScene); }
    }
  },
  draw() {
    ui.fillStyle = '#000'; ui.fillRect(0, 0, W, H);
    menuList(D.lang[100], [{ label: D.lang[17] }, { label: D.lang[71] }], this.sel, 150);
    softkeys(D.lang[105], D.lang[92]);
  },
};

// ================================================================ NEXT RACE (championship hub)
// Per user request: plain hub — no trophies, NO showroom car. Just the title
// backdrop with the checkered banners, "Championship:" in the top banner and
// the single "Next race" item dead-centre on the screen (y=160 = middle of
// both the screen and the free band between the banners).
const nextRaceScene = {
  menuMusic: true, banner: true,
  enter() {
    R3D.clearScene3d();          // drop any 3D scene left over from a race
    // reset the shared camera (it may be stale after a race)
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
  },
  update() {
    // F/Select = "Next race"; RS/Back returns to the mode menu (original
    // h.java a(boolean): the hub is nested inside the new-game menu loop)
    if (wasPressed('F') || wasPressed('L')) {
      R3D.game.mode = 'champ';
      R3D.game.raceIdx = S().champ % 12;
      R3D.setScene(trackSelectScene);
    }
    if (wasPressed('RS')) R3D.setScene(newGameScene);
  },
  draw() {
    drawTitle(D.lang[15]);       // backdrop + banners + "Championship:" header
    text(D.lang[41], W / 2, 160, 5, COL_TEXT, 'bold 17px Arial, sans-serif');
    softkeys(D.lang[103], '');
  },
};

// ================================================================ TRACK SELECT
const trackSelectScene = {
  sel: 0, menuMusic: true, banner: true,
  enter() {
    if (R3D.game.mode === 'champ') this.sel = S().champ % 12;
    else this.sel = R3D.game.trackIdx || 0;
  },
  items() {
    return D.tracks.map((t, i) => ({ label: t.name, locked: S().medals[i] >= 4 }));
  },
  update() {
    const n = 12;
    if (wasPressed('D')) this.sel = (this.sel + 1) % n;
    if (wasPressed('U')) this.sel = (this.sel + n - 1) % n;
    if (wasPressed('RS')) {
      R3D.setScene(R3D.game.mode === 'champ' ? nextRaceScene : newGameScene); return;
    }
    if (wasPressed('F') || wasPressed('L')) {
      if (S().medals[this.sel] >= 4) return;
      R3D.game.trackIdx = this.sel;
      R3D.setScene(carSelectScene);
    }
  },
  draw() {
    const items = this.items();
    const start = Math.max(0, Math.min(this.sel - 5, items.length - 10));
    const vis = items.slice(start, start + 10);
    const V = R3D._bannerV, settled = V <= 0;
    const slide = Math.round(V * 6);   // names converge from the left, icons from the right
    ui.fillStyle = '#000'; ui.fillRect(0, 0, W, H);
    drawTitle(D.lang[58]);              // "Select track" inside the sliding banner
    // all 10 rows fit BETWEEN the checkered banners (free band y 60..260):
    // pitch 19 from y=66 keeps the last row clear of the bottom flag, matching
    // the original's contained list; cups and padlocks share one right edge.
    let y = 66;
    for (let i = 0; i < vis.length; i++) {
      const idx = start + i;
      const it = vis[i];
      const col = idx === this.sel ? COL_WHITE : (it.locked ? COL_GREY : COL_TEXT);
      text(it.label, 16 - slide, y, 0, col, 'bold 14px Arial, sans-serif');
      if (idx === this.sel && settled) ui.drawImage(R3D._arrowR, 3, y - 2);
      const m = S().medals[idx];
      if (it.locked) padlock(W - 12 + slide, y + 1);
      else if (m <= 2 && R3D._cupImgs[m]) ui.drawImage(R3D._cupImgs[m], W - 23 + slide, y - 1);
      y += 19;
    }
    softkeys(D.lang[105], D.lang[92]);
  },
};

// ================================================================ CAR SELECT (showroom)
// Original showroom (h.java): the car auto-rotates 10 deg/frame at 25fps
// (=250 deg/s, line 2033) around the podium; the camera looks from 8u away,
// tilted 35 deg down; the three stat bars sit at the very bottom (u - cG - 3w)
// with the label left-aligned at x=5 and the bar on the right half of the screen.
const carSelectScene = {
  sel: 0, yaw: 0, v: 28, spinVel: 250, menuMusic: true, confirmT: 0,
  enter() {
    this.sel = R3D.game.carIdx || 0;
    this.yaw = 0; this.v = 28; this.spinVel = 250; this.confirmT = 0;
    R3D.clearScene3d();
    // reset the shared camera (it may be stale after a race)
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
    const sc = new THREE.Scene();
    sc.background = new THREE.Color(0x0c1014);
    this.holder = new THREE.Group();          // translation: podium distance
    this.tilt = new THREE.Group();            // 35 degree camera tilt
    this.tilt.rotation.x = 35 * Math.PI / 180;
    this.holder.add(this.tilt);
    sc.add(this.holder);
    this.car = null;
    this.swap(0);
    R3D.scene3d = sc;
  },
  swap() {
    if (this.car) this.tilt.remove(this.car);
    this.car = R3D.buildCar(this.sel);
    this.car.rotation.y = this.yaw * Math.PI / 180;
    this.tilt.add(this.car);
    this.holder.position.set(0, 0, -8 - this.v);
  },
  update(dt) {
    // MODIFIED-GAME confirm beat: after Select, the camera zooms OUT from the
    // still-spinning car before the race scene opens (blocks all other input).
    if (this.confirmT > 0) {
      this.confirmT -= dt;
      this.v = Math.min(15, this.v + dt * 30);
      this.holder.position.z = -8 - this.v;
      this.spinVel += (250 - this.spinVel) * Math.min(1, dt * 1.4);
      this.yaw += this.spinVel * dt;
      this.car.rotation.y = this.yaw * Math.PI / 180;
      if (this.confirmT <= 0) { R3D.clearScene3d(); R3D.setScene(R3D.raceScene); }
      return;
    }
    if (this.v > 0) {
      this.v = Math.max(0, this.v - dt * 28);
      this.holder.position.z = -8 - this.v;
    }
    // podium spin: original auto-rotate 250 deg/s (10 deg per 25fps frame),
    // plus the MODIFIED-GAME extra: grab the car with the mouse and spin it —
    // while dragging the car follows 1:1, on release it keeps the flick's
    // momentum and eases back into the classic auto-rotation.
    const dg = R3D.dragState;
    if (dg && dg.down) {
      if (dg.dx !== 0) {
        const dYaw = dg.dx * 2.2;               // ~2.2 deg per canvas px
        this.yaw += dYaw;
        const inst = Math.max(-1500, Math.min(1500, dYaw / Math.max(dt, 1e-4)));
        this.spinVel = this.spinVel * 0.55 + inst * 0.45;
      }
    } else {
      this.spinVel += (250 - this.spinVel) * Math.min(1, dt * 1.4);
      this.yaw += this.spinVel * dt;
    }
    if (this.yaw > 180000 || this.yaw < -180000) this.yaw %= 360;
    this.car.rotation.y = this.yaw * Math.PI / 180;
    if (wasPressed('R')) { this.sel = (this.sel + 1) % 4; this.swap(); }
    if (wasPressed('L')) { this.sel = (this.sel + 3) % 4; this.swap(); }
    if (wasPressed('RS')) { R3D.clearScene3d(); R3D.setScene(trackSelectScene); return; }
    if (wasPressed('F') || wasPressed('U')) {
      if (S().cars[this.sel] === 1) return;
      R3D.game.carIdx = this.sel;
      this.confirmT = 0.55;                 // zoom-out beat before the race
      return;
    }
  },
  draw() {
    ui.fillStyle = '#000'; ui.fillRect(0, 0, W, H);
    if (R3D.scene3d) {
      renderer.render(R3D.scene3d, camera);
      ui.drawImage(R3D._gl, 0, 0);
    }
    const car = D.cars[this.sel];
    const locked = S().cars[this.sel] === 1;
    text(car.name, W / 2, 12, 5, locked ? COL_GREY : COL_TEXT, 'bold 16px Arial, sans-serif');
    if (locked) {
      text(D.lang[9], W / 2, Math.floor((H - 14) / 2), 5, COL_WHITE, 'bold 14px Arial, sans-serif');
      const msgs = ['4x ' + D.lang[8], '8x ' + D.lang[60], '12x ' + D.lang[28]];
      text(D.lang[0].split('.')[0] + '.', 16, 70, 0, COL_GREY, 'bold 11px Arial, sans-serif');
    } else {
      // stat bars, original layout (h.java a(Graphics): rows start at
      // u - cG - w*3 - 2 = 213, one font height (15) apart, bar border at y+4
      // and red/yellow fill at y+5) - the bottom row then clears the
      // Select/Back softkey row (~y282) instead of colliding with it.
      // Label left x=5, black-edged bar on the right half x=120 w=114.
      const bars = [[D.lang[65], R3D.STAT_TOP], [D.lang[4], R3D.STAT_ACC], [D.lang[30], R3D.STAT_GRIP]];
      let y = H - 60 - 45 - 2;
      for (const [label, stat] of bars) {
        text(label, 5, y, 0, COL_TEXT, 'bold 13px Arial, sans-serif');
        ui.fillStyle = '#000'; ui.fillRect(119, y + 4, 116, 6);
        ui.fillStyle = '#ff0000'; ui.fillRect(120, y + 5, 114, 4);
        ui.fillStyle = '#ffffaa'; ui.fillRect(120, y + 5, 114 * stat[this.sel] / 100, 4);
        y += 15;
      }
    }
    ui.drawImage(R3D._arrowL, 8, 140);
    ui.drawImage(R3D._arrowR, W - 18, 140);
    softkeys(D.lang[105], D.lang[92]);
  },
};

// ================================================================ HIGH SCORES
const hiScoreScene = {
  sel: 0, menuMusic: true, banner: true,
  update() {
    if (wasPressed('R')) this.sel = (this.sel + 1) % 12;
    if (wasPressed('L')) this.sel = (this.sel + 11) % 12;
    if (wasPressed('F') || wasPressed('RS')) R3D.setScene(titleScene);
  },
  draw() {
    ui.fillStyle = '#000'; ui.fillRect(0, 0, W, H);
    drawTitle(D.lang[96]);              // "High scores" inside the sliding banner
    const V = R3D._bannerV, settled = V <= 0;
    const slide = Math.round(V * 6);
    text(D.tracks[this.sel].name, W / 2 - slide, 76, 5, COL_WHITE, 'bold 14px Arial, sans-serif');
    const sv = S();
    let y = 112;
    for (let i = 0; i < 5; i++) {
      text((i + 1) + '.', 52, y, 0, COL_TEXT, 'bold 13px Arial, sans-serif');
      text(sv.names[this.sel][i].substring(0, 12), 72, y, 0, COL_TEXT, 'bold 13px Arial, sans-serif');
      text(fmtTime(sv.scores[this.sel][i]), W - 30, y, 8, COL_TEXT, 'bold 13px Arial, sans-serif');
      y += 22;
    }
    if (settled) {
      ui.drawImage(R3D._arrowL, 20, 84);
      ui.drawImage(R3D._arrowR, W - 30, 84);
    }
    softkeys(D.lang[103], D.lang[92]);
  },
};

// ================================================================ SETTINGS
const settingsScene = {
  sel: 0, menuMusic: true, banner: true,
  items() {
    const st = S().settings;
    return [
      // the jar's strings are already complete ("Sound: low", "Speed: km/h") -
      // render them as-is instead of prefixing a second label
      { label: [D.lang[64], D.lang[62], D.lang[61]][st.sound] },
      { label: [D.lang[66], D.lang[67]][st.units] },
      { label: [D.lang[5], D.lang[6]][st.auto] },
      // MODIFIED-GAME: title-song synth switch, labelled by ENGINE name
      // (TinySoundFont = libmidi.wasm core, TinySynth = g200kg webaudio-tinysynth)
      { label: 'Title song: ' + (st.titleSong === 1 ? 'TinySynth' : 'TinySoundFont') },
      { label: D.lang[52] },
    ];
  },
  update() {
    const n = this.items().length;
    if (wasPressed('D')) this.sel = (this.sel + 1) % n;
    if (wasPressed('U')) this.sel = (this.sel + n - 1) % n;
    if (wasPressed('RS')) { R3D.persist(); R3D.setScene(titleScene); return; }
    if (wasPressed('F') || wasPressed('L')) {
      const st = S().settings;
      if (this.sel === 0) { st.sound = (st.sound + 1) % 3; if (st.sound === 0) AudioSys.stopMusic(); }
      else if (this.sel === 1) st.units = (st.units + 1) % 2;
      else if (this.sel === 2) st.auto = (st.auto + 1) % 2;
      else if (this.sel === 3) {
        st.titleSong = (st.titleSong === 1) ? 0 : 1;
        // restart the looping menu music so the switch is heard immediately
        if (AudioSys.music) AudioSys.stopMusic();
      }
      else R3D.saveReset();
      R3D.persist();
    }
  },
  draw() {
    ui.fillStyle = '#000'; ui.fillRect(0, 0, W, H);
    menuList(D.lang[107], this.items(), this.sel, 90);
    softkeys(D.lang[59], D.lang[92]);
  },
};

// ================================================================ INSTRUCTIONS
const instructionsScene = {
  page: 0, menuMusic: true, banner: true,
  pages() { return [D.lang[0], D.lang[1], D.lang[2], D.lang[3]]; },
  update() {
    if (wasPressed('R') || wasPressed('D')) { this.page = (this.page + 1) % 4; }
    if (wasPressed('L') || wasPressed('U')) { this.page = (this.page + 3) % 4; }
    if (wasPressed('F') || wasPressed('RS')) R3D.setScene(titleScene);
  },
  draw() {
    ui.fillStyle = '#000'; ui.fillRect(0, 0, W, H);
    drawTitle(D.lang[99]);              // "Instructions" inside the sliding banner
    const words = this.pages()[this.page].split(' ');
    let line = '', y = 84;
    for (const w of words) {
      const t2 = line + w + ' ';
      if (ui.measureText(t2).width > W - 36) {
        text(line, 18, y, 0, COL_TEXT, 'bold 11px Arial, sans-serif');
        y += 15; line = w + ' ';
      } else line = t2;
    }
    if (line) text(line, 18, y, 0, COL_TEXT, 'bold 11px Arial, sans-serif');
    text((this.page + 1) + '/4', W / 2, H - 44, 5, COL_GREY, 'bold 12px Arial, sans-serif');
    softkeys(D.lang[105], D.lang[92]);
  },
};

// ================================================================ RESULTS
const resultsScene = {
  menuMusic: true, banner: true, musicT: 0,
  enter() { AudioSys.stopMusic(); this.musicT = 2.0; },
  update(dt) {
    if (this.musicT > 0) this.musicT -= dt;   // title restarts after the goal jingle
    if (wasPressed('F') || wasPressed('L') || wasPressed('RS')) {
      if (R3D.game.mode === 'champ') R3D.setScene(nextRaceScene);
      else R3D.setScene(trackSelectScene);
    }
  },
  draw() {
    ui.fillStyle = '#000'; ui.fillRect(0, 0, W, H);
    drawTitle();
    const g = R3D.game.results;
    let y = 66;
    text(g.headline, W / 2, y, 5, COL_WHITE, 'bold 17px Arial, sans-serif'); y += 28;
    if (g.medalText) { text(g.medalText, W / 2, y, 5, COL_TEXT, 'bold 14px Arial, sans-serif'); y += 24; }
    text(D.lang[32] + ' ' + fmtTime(g.time), W / 2, y, 5, COL_TEXT, 'bold 14px Arial, sans-serif'); y += 24;
    if (g.bestText) { text(g.bestText, W / 2, y, 5, COL_GREY, 'bold 12px Arial, sans-serif'); y += 20; }
    let ty = 200;
    for (const t of g.toasts) {
      text(t, W / 2, ty, 5, COL_WHITE, 'bold 12px Arial, sans-serif');
      ty += 18;
    }
    softkeys(D.lang[94], '');
  },
};

R3D.STAT_TOP = [60, 68, 75, 80];
R3D.STAT_ACC = [20, 60, 90, 80];
R3D.STAT_GRIP = [40, 80, 80, 90];
R3D.titleScene = titleScene;
R3D.resultsScene = resultsScene;
R3D.nextRaceScene = nextRaceScene;
R3D.trackSelectScene = trackSelectScene;
R3D.carSelectSceneRef = carSelectScene;

// ================================================================ BOOT
R3D.game = { mode: 'champ', trackIdx: 0, carIdx: 0, raceIdx: 0, results: null };

R3D.start = async function () {
  await R3D.loadAll();
  const img = (f) => new Promise((res) => {
    const i = new Image(); i.onload = () => res(i); i.src = 'assets/img/' + f;
  });
  R3D._titleImg = await img('title.png');
  R3D._barUp = await img('title_up.png');
  R3D._barDown = await img('title_down.png');
  R3D._logoImg = await img('title_text.png');
  R3D._arrowL = await img('arrow_l1.png');
  R3D._arrowR = await img('arrow_r1.png');
  R3D._cupImgs = [await img('cup3.png'), await img('cup2.png'), await img('cup1.png')];
  R3D.setScene(titleScene);
  R3D._loop();
};

})();
