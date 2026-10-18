/* Rally 3D browser port — main: boot, input, audio, save, menus, flow */
(function () {
'use strict';
const D = window.R3D_DATA;
const R3D = window.R3D;

// ---------------------------------------------------------------- canvas
const W = R3D.W, H = R3D.H;
const glCanvas = document.getElementById('gl');
const uiCanvas = document.getElementById('ui');
uiCanvas.width = W; uiCanvas.height = H;
glCanvas.width = W; glCanvas.height = H;
const ui = uiCanvas.getContext('2d');
ui.imageSmoothingEnabled = false;

function fit() {
  const sc = Math.min(window.innerWidth / W, window.innerHeight / H);
  const w = Math.floor(W * sc), h = Math.floor(H * sc);
  const wrap = document.getElementById('wrap');
  if (wrap) { wrap.style.width = w + 'px'; wrap.style.height = h + 'px'; }
  for (const c of [glCanvas, uiCanvas]) {
    c.style.width = w + 'px';
    c.style.height = h + 'px';
  }
}
window.addEventListener('resize', fit); fit();

const renderer = window.R3D._renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false, alpha: true, preserveDrawingBuffer: true });
R3D._gl = glCanvas;
renderer.setClearColor(0x000000, 0);
renderer.setSize(W, H, false);
const camera = window.R3D._camera = new THREE.PerspectiveCamera(60, W / H, 1, 128);

// ---------------------------------------------------------------- helpers
function argbCss(v) { return R3D.argb(v).css; }
const COL_TEXT = argbCss(-86);        // pale yellow HUD/menu text 0xFFFFFFAA
const COL_WHITE = '#ffffff';
const COL_GREY = '#9a9a9a';

function text(str, x, y, align, color, font) {
  ui.font = font || 'bold 13px "Segoe UI", Arial, sans-serif';
  ui.textAlign = align === 8 ? 'right' : (align === 5 ? 'center' : 'left');
  ui.textBaseline = 'top';
  ui.fillStyle = 'rgba(0,0,0,0.85)';
  ui.fillText(str, x + 1, y + 1);
  ui.fillStyle = color || COL_TEXT;
  ui.fillText(str, x, y);
}
R3D.text = text;

function softkeys(left, right) {
  text(left || '', W / 2, H - 18, 5, COL_TEXT, 'bold 15px Arial, sans-serif');
  text(right || '', W - 6, H - 18, 8, COL_TEXT, 'bold 15px Arial, sans-serif');
}
R3D.softkeys = softkeys;

function drawTitle() {
  if (R3D._titleImg) ui.drawImage(R3D._titleImg, 0, 0);
  if (R3D._barUp) ui.drawImage(R3D._barUp, 0, 0);
  if (R3D._barDown) ui.drawImage(R3D._barDown, 0, H - R3D._barDown.height);
  if (R3D._logoImg) ui.drawImage(R3D._logoImg, (W - R3D._logoImg.width) / 2, 12);
}
function padlock(x, y) {
  // light grey padlock: shackle on top, body below (readable over the car art)
  ui.strokeStyle = '#9e9e9e';
  ui.lineWidth = 1.5;
  ui.beginPath();
  ui.arc(x + 3.5, y + 3, 2.6, Math.PI, 0);
  ui.stroke();
  ui.fillStyle = '#7d7d7d';
  ui.fillRect(x, y + 3, 7, 6);
  ui.fillStyle = 'rgba(0,0,0,0.35)';
  ui.fillRect(x, y + 7, 7, 2);
}

// ---------------------------------------------------------------- save
const SAVE_KEY = 'r3d_save_v1';
function defSave() {
  const scores = [], names = [];
  for (let t = 0; t < 12; t++) {
    names.push([D.lang[68], D.lang[68], D.lang[68], D.lang[68], D.lang[68]]);
    scores.push([D.tracks[t].medals[0], D.tracks[t].medals[1], D.tracks[t].medals[2],
                 D.tracks[t].medals[3], D.tracks[t].medals[3] + 100]);
  }
  return {
    medals: [3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
    cars: [0, 1, 1, 1],
    names, scores,
    champ: 0,
    settings: { sound: 2, units: 0, auto: 0 },
    name: D.lang[68],
  };
}
let save;
try { save = JSON.parse(localStorage.getItem(SAVE_KEY)) || defSave(); }
catch (e) { save = defSave(); }
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }
R3D.save = () => save;
R3D.persist = persist;
R3D.defSave = defSave;
R3D.saveReset = function () {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  save = defSave();
  persist();
  return save;
};
Object.defineProperty(R3D, 'saveObj', {
  get() { return save; },
  set(v) { save = v; },
});

function fmtTime(t) {
  if (t < 0) return '-:-';
  const tenth = t % 10, ss = Math.floor(t / 10) % 60, mm = Math.floor(t / 600);
  const ss2 = (ss < 10 ? '0' : '') + ss;
  return mm > 0 ? mm + ':' + ss2 + ':' + tenth : ss + ':' + tenth;
}
R3D.fmtTime = fmtTime;

// ---------------------------------------------------------------- audio
// Music/SFX play the ORIGINAL MIDI files from the jar through the same
// General-MIDI synth the emulator used (libmidi.wasm, TinySoundFont core with
// an embedded soundfont — no CDN, no conversion loss). OGG renders stay as a
// fallback for browsers without AudioWorklet.
const AudioSys = R3D.audio = {
  ctx: null, music: null, _fx: null, vol: 0.8,
  midiLib: null, musicPlayer: null, sfxPlayer: null, midiBufs: {}, midiFailed: false,
  _pending: null, _starting: false,
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      // resume() only succeeds inside a user gesture; flush queued music after
      const c = this.ctx;
      c.resume().then(() => { if (this.ctx === c) this._flushPending(); }).catch(() => {});
    } else if (this.ctx && this.ctx.state === 'running') {
      this._flushPending();
    }
  },
  _flushPending() {
    if (this._pending) {
      const p = this._pending; this._pending = null;
      this.play(p.name, p.loop, p.vol);
    }
  },
  async initMidi() {
    if (this.midiLib || this.midiFailed) return this.midiLib;
    try {
      if (!this.ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') throw new Error('no worklet');
      const mod = await import('../libmidi/libmidi.js');
      this.midiLib = new mod.LibMidi(this.ctx, this.ctx.destination);
      await this.midiLib.init();
      this.MIDIPlayer = mod.MIDIPlayer;
      this.musicPlayer = this.midiLib.midiPlayer;
      this.sfxPlayer = new mod.MIDIPlayer(this.ctx, this.ctx.destination);
    } catch (e) {
      this.midiFailed = true;   // fall back to OGG renders
    }
    return this.midiLib;
  },
  async _midiBuf(name) {
    if (this.midiBufs[name]) return this.midiBufs[name];
    const r = await fetch('assets/midi/' + name + '.mid');
    if (!r.ok) throw new Error('midi ' + name + ' missing');
    const buf = await r.arrayBuffer();
    this.midiBufs[name] = buf;
    return buf;
  },
  async playMidi(name, loop, vol) {
    if (!await this.initMidi()) return false;
    try {
      const buf = await this._midiBuf(name);
      if (loop) {
        const p = this.musicPlayer;
        await p.setSequence(buf);
        p.volume = vol;
        p.stop(); p.loop(-1); p.play();
        this.music = { midi: p };
      } else {
        const p = this.sfxPlayer;
        await p.setSequence(buf);
        p.volume = vol;
        p.stop(); p.play();
        this._fx = { midi: p };
      }
      return true;
    } catch (e) { return false; }
  },
  play(name, loop, vol) {
    this.ensure();
    if (!this.ctx || save.settings.sound === 0) return;
    // A MIDI player started on a suspended context never becomes audible
    // (notes get scheduled against a frozen clock) — queue instead. The queue
    // is flushed by ensure() on the first user gesture / once running.
    if (this.ctx.state !== 'running') {
      if (loop && !this._pending) this._pending = { name, loop, vol };
      return;
    }
    const v = (vol !== undefined ? vol : 0.6) * (save.settings.sound === 1 ? 0.45 : 1);
    if (loop) {
      if (this._starting) return;
      this._starting = true;
      this.stopMusic();
    }
    this.playMidi(name, loop, v).then((ok) => {
      if (loop) this._starting = false;
      if (ok || save.settings.sound === 0) return;
      // OGG fallback
      const a = new Audio('assets/audio/' + name + '.ogg');
      a.loop = !!loop;
      a.volume = v;
      a.play().then(() => {
        if (loop) this.music = a; else this._fx = a;
      }).catch(() => {});
    });
  },
  stopMusic() {
    if (this.music) {
      if (this.music.midi) { try { this.music.midi.stop(); } catch (e) {} }
      else if (this.music.pause) { try { this.music.pause(); } catch (e) {} }
      this.music = null;
    }
  },
  sfx(name) { this.play(name, false, 0.9); },
};

// ---------------------------------------------------------------- input
const keys = {};        // merged per-frame state
const kbKeys = {};      // keyboard state
const PRESSED = {};
function keyName(e) {
  const map = {
    ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'U', ArrowDown: 'D',
    Enter: 'F', ' ': 'F', Digit5: 'F',
    Digit4: 'L', Digit6: 'R', Digit2: 'U', Digit8: 'D',
    KeyQ: 'LS', KeyW: 'RS', F1: 'LS', F2: 'RS',
    Escape: 'RS', Backspace: 'RS',
  };
  return map[e.code] || null;
}
window.addEventListener('keydown', (e) => {
  const k = keyName(e);
  if (k) {
    e.preventDefault();
    if (!kbKeys[k]) PRESSED[k] = true;
    kbKeys[k] = true;
    AudioSys.ensure();   // also flushes queued menu music once running
  }
}, { passive: false });
window.addEventListener('keyup', (e) => {
  const k = keyName(e);
  if (k) { kbKeys[k] = false; e.preventDefault(); }
}, { passive: false });
function wasPressed(k) { if (PRESSED[k]) { PRESSED[k] = false; return true; } return false; }
R3D.keys = keys;
R3D.wasPressed = wasPressed;
R3D.clearPressed = () => { for (const k in PRESSED) PRESSED[k] = false; };

// touch controls
const touchState = { L: false, R: false, U: false, D: false, F: false };
(function setupTouch() {
  const zones = [
    ['L', 0, 0.62, 0.25, 0.38], ['R', 0.25, 0.62, 0.25, 0.38],
    ['D', 0.5, 0.62, 0.25, 0.38], ['U', 0.75, 0.62, 0.25, 0.38],
  ];
  function upd() {
    keys.L = touchState.L || keys._kbL; // merged below
  }
  function handle(evt, phase) {
    evt.preventDefault();
    const r = uiCanvas.getBoundingClientRect();
    for (const ev of (evt.changedTouches || [evt])) {
      const nx = (ev.clientX - r.left) / r.width, ny = (ev.clientY - r.top) / r.height;
      if (phase === 'down' && ny < 0.55) {
        PRESSED.F = true; touchState.F = true; AudioSys.ensure();
      }
      if (phase === 'down' && ny >= 0.55 && ny < 0.62) { PRESSED.LS = true; }
      for (const z of zones) {
        const inZ = nx >= z[1] && nx < z[1] + z[3] && ny >= z[2] && ny < z[2] + z[4];
        if (inZ) {
          touchState[z[0]] = phase !== 'up';
          if (phase === 'down') { PRESSED[z[0]] = true; }
        } else if (phase === 'up' || phase === 'move') {
          // recompute below
        }
      }
    }
    if (phase === 'up' || phase === 'move') {
      const active = {};
      for (const t of (evt.touches || [])) {
        const r2 = uiCanvas.getBoundingClientRect();
        const nx2 = (t.clientX - r2.left) / r2.width, ny2 = (t.clientY - r2.top) / r2.height;
        for (const z of zones) {
          if (nx2 >= z[1] && nx2 < z[1] + z[3] && ny2 >= z[2] && ny2 < z[2] + z[4]) active[z[0]] = true;
        }
      }
      for (const z of zones) if (!active[z[0]]) touchState[z[0]] = false;
    }
  }
  uiCanvas.addEventListener('touchstart', (e) => handle(e, 'down'), { passive: false });
  uiCanvas.addEventListener('touchmove', (e) => handle(e, 'move'), { passive: false });
  uiCanvas.addEventListener('touchend', (e) => handle(e, 'up'), { passive: false });
  R3D.touch = touchState;
})();
// merge touch into key state each frame
R3D.pollInput = function () {
  for (const k of ['L', 'R', 'U', 'D']) keys[k] = kbKeys[k] || touchState[k];
};

// ---------------------------------------------------------------- scenes / state machine
let scene = null;           // {update(dt), draw(), enter(...)}
let last = 0;
R3D.setScene = function (s) { scene = s; R3D.activeScene = s; if (s.enter) s.enter(); };
R3D.scene3d = null;          // active three.js scene for race/showroom
R3D.clearScene3d = function () {
  if (R3D.scene3d) {
    R3D.scene3d.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    R3D.scene3d = null;
  }
};

function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
  last = ts;
  R3D.pollInput();
  if (scene) {
    scene.update(dt);
    scene.draw();
  }
  R3D.clearPressed();
}

// original menu behaviour: title.mid keeps looping in every menu; restart it
// whenever nothing is playing (h.java menu loop, line 2251). musicT lets the
// results screen wait for the goal jingle to finish first.
R3D.ensureMenuMusic = function () {
  const A = R3D.audio;
  if (!A.music && !A._starting && save.settings.sound !== 0) A.play('title', true, 0.5);
};

// shared: draw a menu list over title bg.
// Screen headers sit just BELOW the RALLY 3D logo (logo spans y 12..51);
// drawing them at y=10 overlapped the logo art (user-reported misalignment).
function menuList(title, items, sel, startY) {
  drawTitle();
  if (title) text(title, W / 2, 54, 5, COL_TEXT, 'bold 17px Arial, sans-serif');
  let y = startY || 72;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const locked = it.locked;
    const col = i === sel ? COL_WHITE : (locked ? COL_GREY : COL_TEXT);
    text(it.label, W / 2, y, 5, col, 'bold 14px Arial, sans-serif');
    const wdt = ui.measureText(it.label).width;
    if (i === sel) {
      ui.drawImage(R3D._arrowR, W / 2 + wdt / 2 + 8, y - 2);
      ui.drawImage(R3D._arrowL, W / 2 - wdt / 2 - 18, y - 2);
    }
    if (locked) padlock(W - 22, y + 2);   // fixed column: every lock lines up
    y += 17;
  }
}

// (scenes are defined in scenes.js / race.js)
R3D.menuList = menuList;
R3D.drawTitle = drawTitle;
R3D.padlock = padlock;
R3D._loop = function () { requestAnimationFrame(function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
  last = ts;
  R3D.pollInput();
  if (scene) {
    if (scene.menuMusic && !(scene.musicT > 0)) R3D.ensureMenuMusic();
    scene.update(dt);
    scene.draw();
  }
  R3D.clearPressed();
}); };

})();
