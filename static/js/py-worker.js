/* Programa de Python (Pyodide) de una Orange Pi o Raspberry Pi. Lo que espera (time.sleep, I2C,
   input()) devuelve una promesa que Python espera con run_sync (JSPI), sin bloquear la página.
   Mensajes de la página: run {code, cfg} · in {p, v} · pause {on} · resp {id, v} · stdin {d}
   Mensajes a la página:  loading · ready · dir · pin · pwm · out · i2c/sensor {id} · stdin · end · error */
/* global loadPyodide */
'use strict';

const BASE = self.location.origin + '/static/';
const post = (m) => self.postMessage(m);
let pyodide = null;
let loading = null;

function load() {
  if (!loading) {
    loading = (async () => {
      if (typeof WebAssembly.Suspending !== 'function') throw new Error('nojspi');
      importScripts(BASE + 'vendor/pyodide/pyodide.js');
      pyodide = await loadPyodide({ indexURL: BASE + 'vendor/pyodide/' });
      return pyodide;
    })();
  }
  return loading;
}
load().then(() => post({ t: 'loaded' }), () => { /* se avisa al ejecutar */ });

// Estado compartido con la página
const inputs = {}, outputs = {}, isOut = {};
let paused = false, pausedAt = 0, pausedTotal = 0, t0 = 0, lastYield = 0;
let waiters = [];
const pending = new Map();
let seq = 0;
const stdinLines = [];
let stdinWait = null;

const nowS = () => ((paused ? pausedAt : performance.now()) - t0 - pausedTotal) / 1000;
const resumed = () => (paused ? new Promise((r) => waiters.push(r)) : null);
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

async function sleepUntil(target) {
  for (;;) {
    if (paused) await resumed();
    const left = target - nowS();
    if (left <= 0) return;
    await tick(Math.min(left * 1000, 100));
  }
}

function request(m) {
  const id = ++seq;
  m.id = id;
  return new Promise((res) => { pending.set(id, res); post(m); });
}

const bridge = {
  cfg: '{}',
  setup(p, mode, pull) {
    isOut[p] = mode === 'out';
    post({ t: 'dir', p, o: mode === 'out' ? 1 : 0, pu: pull === 2 ? 1 : 0, pd: pull === 1 ? 1 : 0 });
    // una entrada: se espera a que el circuito devuelva su nivel (con el pull-up ya puesto) antes
    // de seguir, si no el programa leería el nivel de antes y vería un flanco que no existe
    return mode === 'out' ? null : request({ t: 'sync' });
  },
  write(p, v) {
    if (outputs[p] === v) return;
    outputs[p] = v;
    post({ t: 'pin', p, v });
  },
  // como en el hardware: leer un pin de salida devuelve el nivel que está dando
  read: (p) => ((isOut[p] ? outputs[p] : inputs[p]) ? 1 : 0),
  pwm(p, d, f) { post({ t: 'pwm', p, d, f }); },
  now: nowS,
  sleep: (s) => sleepUntil(nowS() + Math.max(0, s)),
  // en bucles sin sleep: cada pocos ms se cede el turno para recibir entradas y la pausa
  poll() {
    if (paused) return resumed();
    const t = performance.now();
    if (t - lastYield < 8) return null;
    lastYield = t;
    return tick(0);
  },
  i2c: (a, w, n) => request({ t: 'i2c', a, w: JSON.parse(w), n }),
  sensor: (k, p) => request({ t: 'sensor', k, p }),
  input(prompt) {
    if (prompt) post({ t: 'out', d: prompt });
    if (stdinLines.length) return Promise.resolve(stdinLines.shift());
    post({ t: 'stdin' });
    return new Promise((r) => { stdinWait = r; });
  },
};

async function run(code, cfg) {
  post({ t: 'loading' });
  try {
    await load();
  } catch (e) {
    post({ t: 'error', d: e.message === 'nojspi'
      ? 'Este navegador no puede ejecutar Python aquí: hace falta Chrome o Edge 137 o posterior (JSPI de WebAssembly).'
      : 'No se pudo cargar Python (Pyodide): ' + e.message });
    return;
  }
  pyodide.setStdout({ batched: (s) => post({ t: 'out', d: s + '\n' }) });
  pyodide.setStderr({ batched: (s) => post({ t: 'out', d: s + '\n' }) });
  bridge.cfg = JSON.stringify(cfg);
  pyodide.registerJsModule('_simjs', bridge);
  const shims = await (await fetch(BASE + 'py/simhw.py')).text();
  try {
    pyodide.FS.writeFile('/home/pyodide/simhw.py', shims);
    pyodide.runPython("import sys\nif '/home/pyodide' not in sys.path: sys.path.insert(0, '/home/pyodide')\nimport simhw");
  } catch (e) {
    post({ t: 'error', d: 'Error interno del simulador de Python:\n' + e.message });
    return;
  }
  pyodide.globals.set('_user_src', code);
  t0 = performance.now(); pausedTotal = 0; lastYield = t0;
  post({ t: 'ready' });
  let r;
  try {
    r = await pyodide.runPythonAsync('import simhw\nsimhw.run_user(_user_src)', { filename: '<sim>' });
  } catch (e) {
    r = 'error:' + e.message;
  }
  r = String(r);
  if (r.startsWith('error:')) post({ t: 'error', d: r.slice(6) });
  else post({ t: 'end', d: r });
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.t === 'run') run(m.code, m.cfg);
  else if (m.t === 'in') inputs[m.p] = m.v;
  else if (m.t === 'resp') { const r = pending.get(m.id); if (r) { pending.delete(m.id); r(m.v); } }
  else if (m.t === 'stdin') {
    stdinLines.push(...String(m.d).replace(/\r?\n$/, '').split(/\r?\n/));
    if (stdinWait) { const r = stdinWait; stdinWait = null; r(stdinLines.shift()); }
  } else if (m.t === 'pause') {
    if (m.on && !paused) { paused = true; pausedAt = performance.now(); }
    else if (!m.on && paused) {
      pausedTotal += performance.now() - pausedAt; paused = false;
      const w = waiters; waiters = []; w.forEach((f) => f());
    }
  }
};
