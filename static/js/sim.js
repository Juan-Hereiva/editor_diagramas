/* Simulador de Arduino en el navegador.
   - El sketch se compila en el servidor con arduino-cli (el compilador oficial, con librerías).
   - avr8js ejecuta el .hex instrucción a instrucción, con sus temporizadores, UART, ADC, I2C y SPI.
   - Una red eléctrica sencilla (nodos unidos por cables, resistencias y fuentes) traslada los pines
     del micro a los componentes del plano y devuelve botones, potenciómetros y sensores al micro. */
(function () {
  'use strict';

  const { esc, toast } = window.App;
  const { namespace, Component, Junction } = window.ElecShapes;
  const A = window.AVR8;
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const diagramId = Number(new URLSearchParams(location.search).get('id')) || 0;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const BOARDS = ['uno', 'nano', 'mega', 'pico', 'esp32', 'esp32c3', 'opi', 'rpi'];
  const PY_BOARDS = new Set(['opi', 'rpi']);          // ordenadores con Linux: el programa es de Python
  const isPy = (b) => PY_BOARDS.has(b);
  const DEFAULT_PY = [
    '# Programa de Python para la placa con Linux. Se ejecuta aquí mismo (Python 3.12 en el navegador)',
    '# con wiringpi, OPi.GPIO, RPi.GPIO, gpiozero, smbus2 y RPLCD conectados al circuito.',
    'import time',
    'import wiringpi',
    '',
    'wiringpi.wiringPiSetupPhys()      # numeración física: el número de pin del conector (1-40)',
    'LED = 7',
    'wiringpi.pinMode(LED, wiringpi.OUTPUT)',
    '',
    'while True:',
    '    wiringpi.digitalWrite(LED, 1)',
    '    time.sleep(0.5)',
    '    wiringpi.digitalWrite(LED, 0)',
    '    time.sleep(0.5)',
    '',
  ].join('\n');
  const DEFAULT_SKETCH = [
    '// Programa de Arduino: se compila con el compilador oficial y se ejecuta aquí mismo.',
    '// Puedes usar librerías (#include): instálalas con el botón Librerías.',
    '',
    'void setup() {',
    '  Serial.begin(9600);',
    '  pinMode(LED_BUILTIN, OUTPUT);',
    '  Serial.println("¡Hola desde el simulador!");',
    '}',
    '',
    'void loop() {',
    '  digitalWrite(LED_BUILTIN, HIGH);',
    '  delay(500);',
    '  digitalWrite(LED_BUILTIN, LOW);',
    '  delay(500);',
    '}',
    '',
  ].join('\n');

  // Editor de código

  const cm = CodeMirror.fromTextArea($('code'), {
    mode: 'text/x-c++src', theme: 'material-darker', lineNumbers: true, matchBrackets: true,
    autoCloseBrackets: true, indentUnit: 2, tabSize: 2,
  });

  function setCodeMode(board) {
    const py = isPy(board);
    cm.setOption('mode', py ? 'python' : 'text/x-c++src');
    cm.setOption('indentUnit', py ? 4 : 2);
    cm.setOption('tabSize', py ? 4 : 2);
    $('code-file').textContent = py ? 'programa.py' : 'sketch.ino';
    $('btn-libs').disabled = py;
    $('btn-libs').title = py ? 'Las librerías de Python (wiringpi, OPi.GPIO, RPi.GPIO, gpiozero, smbus2, RPLCD, adafruit_dht) ya están incluidas'
      : 'Buscar e instalar librerías de Arduino';
    $('btn-run').title = py ? 'Ejecutar el programa de Python (Ctrl+Enter)' : 'Compilar y ejecutar (Ctrl+Enter)';
    $('serial-in').placeholder = py ? 'Escribe y pulsa Enter: le llega a input() del programa' : 'Escribe y pulsa Enter para enviarlo al Arduino (Serial.read)';
  }

  let saveTimer = null;
  let savedCode = null;
  cm.on('change', () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveCode(false), 1500); });

  async function saveCode(manual) {
    clearTimeout(saveTimer);
    const code = cm.getValue(), board = $('board').value;
    if (!diagramId) {
      try { localStorage.setItem('sim-sketch', JSON.stringify({ code, board })); } catch (_) { /* sin almacenamiento */ }
      if (manual) toast('Código guardado en este navegador');
      return;
    }
    if (code === savedCode && !manual) return;
    try {
      await fetch('/api/diagrams/' + diagramId + '/sketch', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, board }),
      });
      savedCode = code;
      if (manual) toast('Código guardado con el diagrama', 'ok');
    } catch (e) { toast('No se pudo guardar el código', 'err'); }
  }

  // Plano (solo lectura)

  // Mismo enrutador que el editor: los diagramas guardados lo nombran.
  const ROUTE_ATTEMPTS = [{ step: 10, padding: 16 }, { step: 5, padding: 8 }, { step: 5, padding: 3 }];
  joint.routers.electrico = function (vertices, opt, linkView) {
    let i = 0;
    const tryNext = (v, o, lv) => {
      const a = ROUTE_ATTEMPTS[i++];
      if (!a) return joint.routers.orthogonal(v, { padding: 8 }, lv);
      return joint.routers.manhattan(v, Object.assign({ maximumLoops: 3000, perpendicular: true }, a, { fallbackRouter: tryNext }), lv);
    };
    return tryNext(vertices, opt, linkView);
  };

  const graph = new joint.dia.Graph({}, { cellNamespace: namespace });
  const paperEl = $('sim-paper');
  const paper = new joint.dia.Paper({
    el: paperEl, model: graph, cellViewNamespace: namespace,
    width: '100%', height: '100%', gridSize: 10,
    background: { color: '#ffffff' },
    interactive: false,
    defaultConnectionPoint: { name: 'anchor' },
    sorting: joint.dia.Paper.sorting.APPROX,
  });

  // Capa propia encima del dibujo para los efectos: LEDs encendidos, servos, pantallas…
  const overlay = document.createElementNS(SVGNS, 'g');
  overlay.setAttribute('class', 'sim-overlay');
  overlay.style.pointerEvents = 'none';
  paper.svg.appendChild(overlay);
  function syncOverlay() { overlay.setAttribute('transform', joint.V.matrixToTransformString(paper.matrix())); }
  paper.on('scale translate resize', syncOverlay);

  function fit() {
    if (!graph.getElements().length) return;
    paper.transformToFitContent({ padding: paperEl.clientWidth < 700 ? 16 : 40, maxScale: 1.6, minScale: 0.05 });
    const t = paper.translate();
    fit.view = { s: paper.scale().sx, tx: t.tx, ty: t.ty };
    syncOverlay();
  }
  function zoomAt(f, cx, cy) {
    const r = paperEl.getBoundingClientRect();
    if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    const p = paper.clientToLocalPoint(cx, cy);
    const s = clamp(paper.scale().sx * f, 0.05, 5);
    paper.scale(s, s);
    paper.translate(cx - r.left - p.x * s, cy - r.top - p.y * s);
    syncOverlay();
  }
  $('z-in').onclick = () => zoomAt(1.2);
  $('z-out').onclick = () => zoomAt(1 / 1.2);
  $('z-fit').onclick = fit;
  paperEl.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY); }, { passive: false });

  // Arrastrar el fondo (o un componente que no se pulsa) desplaza la vista.
  let pan = null, held = null;
  function startPan(evt) {
    const t = paper.translate();
    pan = { x: evt.clientX, y: evt.clientY, tx: t.tx, ty: t.ty };
    paperEl.classList.add('panning');
  }
  paper.on('blank:pointerdown', (evt) => { closePopup(); if (edit.on) selectCell(null); startPan(evt); });
  paper.on('cell:pointerdown', (view, evt, x, y) => {
    if (edit.on) { selectCell(view.model); return; }        // editando: se elige y se arrastra
    const p = view.model.isElement() ? partByEl.get(view.model.id) : null;
    if (p && (p.press || p.click)) {
      const lx = local(p, x, y);
      if (p.press) { p.press(true, lx); held = p; } else p.click(lx);
      return;
    }
    if (p && p.ctlEl) { openPopup(p, view); return; }       // potenciómetros y sensores: ajuste junto a la pieza
    closePopup();
    startPan(evt);
  });

  /* Ventanita junto a la pieza con sus controles (los mismos del panel derecho, que se mueven aquí
     mientras está abierta: así ambos sitios siempre coinciden). */
  let popup = null;
  function openPopup(p, view) {
    if (popup && popup.p === p) return;
    closePopup();
    const box = p.ctlEl, mark = document.createComment('ctl');
    box.parentNode.insertBefore(mark, box);
    const pop = document.createElement('div');
    pop.className = 'sim-pop';
    pop.innerHTML = '<button class="sim-pop-x" title="Cerrar (Esc)">×</button>';
    pop.appendChild(box);
    pop.querySelector('.sim-pop-x').onclick = closePopup;
    pop.addEventListener('mousedown', (e) => e.stopPropagation());
    const stage = paperEl.parentNode, sr = stage.getBoundingClientRect(), er = view.el.getBoundingClientRect();
    stage.appendChild(pop);
    let left = er.right - sr.left + 10, top = er.top - sr.top;
    if (left + pop.offsetWidth > sr.width - 8) left = Math.max(8, er.left - sr.left - pop.offsetWidth - 10);
    pop.style.left = left + 'px';
    pop.style.top = clamp(top, 8, Math.max(8, sr.height - pop.offsetHeight - 8)) + 'px';
    popup = { p, pop, box, mark };
  }
  function closePopup() {
    if (!popup) return;
    popup.mark.parentNode.insertBefore(popup.box, popup.mark);
    popup.mark.remove(); popup.pop.remove();
    popup = null;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopup(); });

  /* Al pasar por un cable o un borne se ve su tensión (y el estado del pin si es del micro). */
  const tip = document.createElement('div');
  tip.className = 'sim-tip';
  paperEl.parentNode.appendChild(tip);
  function nodeUnder(t) {
    const portEl = t.closest && t.closest('[port]'), cellEl = t.closest && t.closest('[model-id]');
    if (!cellEl) return -1;
    const id = cellEl.getAttribute('model-id');
    if (portEl) { const k = net.nodeIdx.get(id + '|' + portEl.getAttribute('port')); return k === undefined ? -1 : k; }
    const cell = graph.getCell(id);
    if (cell && cell.isLink()) {
      const s = cell.source(), k = net.nodeIdx.get(s.id + '|' + s.port);
      return k === undefined ? -1 : k;
    }
    return -1;
  }
  const ST_NAMES = ['salida LOW', 'salida HIGH', 'entrada', 'entrada con pull-up', 'entrada con pull-down'];
  /* Borne bajo el ratón: su nombre y para qué sirve (fichas.js), con o sin simulación. */
  function pinAbout(t, e) {
    // los cables van encima: el borne puede estar debajo de la punta de un cable
    const portEl = (t.closest && t.closest('[port]')) ||
      document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.hasAttribute && n.hasAttribute('port'));
    const cellEl = portEl && portEl.closest('[model-id]');
    const el = cellEl && graph.getCell(cellEl.getAttribute('model-id'));
    const term = el && (el.get('terminals') || []).find((x) => x.id === portEl.getAttribute('port'));
    if (!term) return '';
    const what = window.Fichas ? Fichas.pin(el.get('componentName'), term.name) : '';
    return '<b>' + esc(term.name) + '</b> · ' + esc(el.attr('title/text') || el.get('componentName') || '') + (what ? '<span>' + esc(what) + '</span>' : '');
  }
  paperEl.addEventListener('mousemove', (e) => {
    const node = sim.running && !pan ? nodeUnder(e.target) : -1;
    const about = pan ? '' : pinAbout(e.target, e);
    if ((node < 0 || !net.netOf) && !about) { tip.style.display = 'none'; return; }
    let txt = '';
    if (node >= 0 && net.netOf) {
      const v = volt(node), k = net.netOf[node];
      txt = v === v ? v.toFixed(2).replace('.', ',') + ' V' : 'al aire';
      const pin = mcu.list.find((q) => net.netOf[q.node] === k);
      if (pin) {
        const pw = sim.eng.pwm(pin.key);
        txt += ' · ' + pinLabel(pin.key) + ' ' + (pw ? 'PWM ' + Math.round(pw.duty * 100) + ' %' : ST_NAMES[pin.st] || '');
      }
    }
    tip.innerHTML = about ? about + (txt ? '<span>Ahora: ' + esc(txt) + '</span>' : '') : esc(txt);
    const sr = paperEl.getBoundingClientRect();
    tip.style.display = 'block';
    tip.style.left = Math.max(8, Math.min(e.clientX - sr.left + 14, sr.width - tip.offsetWidth - 8)) + 'px';
    tip.style.top = (e.clientY - sr.top + 12) + 'px';
  });
  paperEl.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  document.addEventListener('pointermove', (e) => {
    if (!pan) return;
    paper.translate(pan.tx + e.clientX - pan.x, pan.ty + e.clientY - pan.y);
    syncOverlay();
  });
  // con el dedo hay que soltar con pointerup: el mouseup emulado llega junto al mousedown y el
  // pulsador no se quedaría apretado mientras se mantiene
  const release = () => {
    pan = null; paperEl.classList.remove('panning');
    if (held) { held.press(false); held = null; }
  };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  App.touchGestures(paper, paperEl, { minScale: 0.05, maxScale: 5, onPinchStart: () => { pan = null; }, onChange: syncOverlay });
  // Posición del clic dentro del componente, de 0 a 1 (sin tener en cuenta el giro).
  function local(p, x, y) {
    const pos = p.el.position(), sz = p.el.size();
    return { x: (x - pos.x) / sz.width, y: (y - pos.y) / sz.height };
  }

  function svg(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  /* Grupo de dibujo alineado con un componente. Se dibuja en las coordenadas originales
     de la pieza (w0 × h0) y se escala, gira y voltea igual que ella en el plano. */
  function ov(p, w0, h0) {
    const el = p.el, pos = el.position(), sz = el.size();
    const g = svg('g', { transform: 'translate(' + pos.x + ',' + pos.y + ') rotate(' + el.angle() + ',' + sz.width / 2 + ',' + sz.height / 2 + ')' }, overlay);
    const fx = el.get('flipX') ? -1 : 1, fy = el.get('flipY') ? -1 : 1;
    p.box = svg('g', { transform: 'matrix(' + fx + ',0,0,' + fy + ',' + (fx < 0 ? sz.width : 0) + ',' + (fy < 0 ? sz.height : 0) + ')' }, g);
    return svg('g', { transform: 'scale(' + sz.width / (w0 || sz.width) + ',' + sz.height / (h0 || sz.height) + ')' }, p.box);
  }

  /* Etiqueta de estado sobre el componente ("90°", "ON", "440 Hz"…). */
  function tag(p, text, color) {
    if (!p.tagEl) {
      const bb = p.el.getBBox();
      const g = svg('g', { transform: 'translate(' + (bb.x + bb.width / 2) + ',' + (bb.y - 9) + ')' }, overlay);
      const r = svg('rect', { y: -9, height: 17, rx: 8.5, fill: '#3b6182' }, g);
      const t = svg('text', { 'text-anchor': 'middle', y: 4, 'font-size': 11, 'font-weight': 700, fill: '#fff', 'font-family': 'system-ui, Segoe UI, sans-serif' }, g);
      p.tagEl = { g, r, t, text: null, color: null };
    }
    const T = p.tagEl;
    if (!text) { T.g.style.display = 'none'; T.text = ''; return; }
    T.g.style.display = '';
    if (T.text !== text) {
      T.text = text; T.t.textContent = text;
      const w = text.length * 6.6 + 14;
      T.r.setAttribute('x', -w / 2); T.r.setAttribute('width', w);
    }
    if (T.color !== color) { T.color = color; T.r.setAttribute('fill', color || '#3b6182'); }
  }

  /* Recuadro que marca un pulsador o interruptor accionado. */
  function highlight(p, on) {
    if (!p.hl) {
      const sz = p.el.size();
      ov(p, 0, 0);
      p.hl = svg('rect', { x: -4, y: -4, width: sz.width + 8, height: sz.height + 8, rx: 7, fill: 'rgba(59,97,130,.10)', stroke: '#3b6182', 'stroke-width': 2.5 }, p.box);
    }
    p.hl.style.display = on ? '' : 'none';
  }

  // Red eléctrica

  const net = {
    nodeIdx: new Map(), nNodes: 0,
    base: null, netOf: null, nNets: 0,
    V: new Float64Array(16), fixed: new Uint8Array(16),
    wg: new Float64Array(16), wgv: new Float64Array(16), sg: new Float64Array(16), sgv: new Float64Array(16),
  };
  const R = { a: new Int32Array(64), b: new Int32Array(64), g: new Float64Array(64), n: 0 };
  let shorted = false, weakAny = false;

  function nodeOf(elId, portId) {
    const k = elId + '|' + portId;
    let i = net.nodeIdx.get(k);
    if (i === undefined) { i = net.nNodes++; net.nodeIdx.set(k, i); }
    return i;
  }
  function find(par, i) {
    while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; }
    return i;
  }
  function union(par, a, b) {
    if (a < 0 || b < 0) return;
    a = find(par, a); b = find(par, b);
    if (a !== b) par[a] = b;
  }

  /* Uniones que no cambian: cables, empalmes y las conexiones internas de cada pieza. */
  function buildBase() {
    const wires = [];
    graph.getLinks().forEach((l) => {
      const s = l.source(), t = l.target();
      if (!s.id || !t.id || s.port == null || t.port == null) return;
      wires.push([nodeOf(s.id, s.port), nodeOf(t.id, t.port)]);
    });
    const par = new Int32Array(net.nNodes);
    for (let i = 0; i < par.length; i++) par[i] = i;
    wires.forEach(([a, b]) => union(par, a, b));
    parts.forEach((p) => {
      p.same.forEach(([a, b]) => union(par, a, b));
      (p.fixed || []).forEach(([a, b]) => union(par, p.n(a), p.n(b)));
      (p.fixedNodes || []).forEach(([a, b]) => union(par, a, b));
    });
    net.base = par;
  }

  /* Uniones que cambian (pulsadores, relés, transistores) y numeración de redes. */
  function rebuild() {
    const par = net.base.slice();
    for (const p of linkParts) p.links(par);
    const netOf = new Int32Array(par.length);
    const roots = new Map();
    for (let i = 0; i < par.length; i++) {
      const r = find(par, i);
      let k = roots.get(r);
      if (k === undefined) { k = roots.size; roots.set(r, k); }
      netOf[i] = k;
    }
    net.netOf = netOf;
    net.nNets = roots.size;
    if (net.V.length < net.nNets) {
      const n = net.nNets * 2;
      ['V', 'wg', 'wgv', 'sg', 'sgv'].forEach((k) => { net[k] = new Float64Array(n); });
      net.fixed = new Uint8Array(n);
    }
  }

  const netId = (node) => (node < 0 || !net.netOf ? -1 : net.netOf[node]);
  const volt = (node) => (node < 0 || !net.netOf ? NaN : net.V[net.netOf[node]]);

  /* Fuente fuerte: salida de un pin, 5V, GND, una batería… */
  function fix(node, v) {
    if (node < 0) return;
    const k = net.netOf[node];
    if (net.fixed[k]) { if (Math.abs(net.V[k] - v) > 0.6) shorted = true; return; }
    net.fixed[k] = 1; net.V[k] = v;
  }
  /* Fuente débil: resistencia de pull-up interna o de un módulo. */
  function weak(node, v, g) {
    if (node < 0) return;
    const k = net.netOf[node];
    net.wg[k] += g; net.wgv[k] += g * v; weakAny = true;
  }
  function addR(a, b, ohm) {
    if (a < 0 || b < 0) return;
    const ka = net.netOf[a], kb = net.netOf[b];
    if (ka === kb) return;
    if (R.n === R.a.length) {
      const n = R.n * 2, a2 = new Int32Array(n), b2 = new Int32Array(n), g2 = new Float64Array(n);
      a2.set(R.a); b2.set(R.b); g2.set(R.g); R.a = a2; R.b = b2; R.g = g2;
    }
    R.a[R.n] = ka; R.b[R.n] = kb; R.g[R.n] = 1 / Math.max(0.01, ohm); R.n++;
  }

  /* Calcula la tensión de cada red: las fuentes fijan su red y el resto se reparte por las
     resistencias (divisor de tensión, pull-up, potenciómetro). Sin camino a ninguna fuente,
     la red queda "al aire" (NaN). */
  function solve() {
    const n = net.nNets, V = net.V, fixed = net.fixed;
    V.fill(NaN, 0, n); fixed.fill(0, 0, n); net.wg.fill(0, 0, n); net.wgv.fill(0, 0, n);
    weakAny = false;
    if (sim.eng) {
      const vcc = sim.eng.vcc;
      for (const pin of mcu.list) {
        if (pin.st === 1) fix(pin.node, vcc);
        else if (pin.st === 0) fix(pin.node, 0);
        else if (pin.st === 3) weak(pin.node, vcc, 1 / 35000);
        else if (pin.st === 4) weak(pin.node, 0, 1 / 35000);
      }
    }
    for (const p of drvParts) p.drive();
    R.n = 0;
    for (const p of resParts) for (const r of p.res) addR(r.a, r.b, r.ohm);
    if (!R.n && !weakAny) return;
    const sg = net.sg, sgv = net.sgv, wg = net.wg, wgv = net.wgv, ra = R.a, rb = R.b, rg = R.g, m = R.n;
    for (let it = 0; it < 400; it++) {
      for (let k = 0; k < n; k++) { sg[k] = wg[k]; sgv[k] = wgv[k]; }
      for (let i = 0; i < m; i++) {
        const a = ra[i], b = rb[i], g = rg[i], va = V[a], vb = V[b];
        if (!fixed[a] && vb === vb) { sg[a] += g; sgv[a] += g * vb; }
        if (!fixed[b] && va === va) { sg[b] += g; sgv[b] += g * va; }
      }
      let d = 0;
      for (let k = 0; k < n; k++) {
        if (fixed[k] || sg[k] === 0) continue;
        const nv = sgv[k] / sg[k], old = V[k];
        const dv = old === old ? Math.abs(nv - old) : 10;
        if (dv > d) d = dv;
        V[k] = nv;
      }
      if (d < 2e-4) break;
    }
  }

  /* Recalcula la red y avisa a las piezas. Se llama cada vez que un pin cambia,
     en el mismo ciclo de reloj, para que los protocolos con tiempos (servo, DHT22,
     NeoPixel, HC-SR04) vean los flancos exactos. */
  function evaluate() {
    if (!net.netOf) return;
    const now = sim.eng ? sim.eng.now() : 0;
    for (let pass = 0; pass < 6; pass++) {
      sim.again = false; sim.topo = false;
      solve();
      if (sim.eng) applyInputs();
      for (const p of updParts) p.update(now);
      if (sim.topo) rebuild();
      else if (!sim.again) break;
    }
  }

  // Microcontrolador

  const sim = { eng: null, running: false, again: false, topo: false, prog: null };
  /* pins: clave del pin en la placa (número de Arduino, GPn de la Pico, GPIOn del ESP32) → estado */
  const mcu = { board: null, kind: null, pins: new Map(), list: [], all: [], nets: new Set() };
  const mcuPin = (key) => {
    let p = mcu.pins.get(key);
    if (!p) { p = { key, node: -1, st: 2, inp: null, av: -1 }; mcu.pins.set(key, p); }
    return p;
  };

  /* Nombre del borne en el dibujo → pin del micro o alimentación, según la placa. */
  function boardPin(kind, name) {
    const s = String(name).trim();
    if (/^3V3_EN|^RUN|^ADC_VREF/.test(s)) return null;
    if (/^A?GND/.test(s)) return { power: 0 };
    if (/^(3\.3V|3V3)/.test(s)) return { power: 3.3 };
    if (/^(5V|\+5V|VBUS|IOREF)/.test(s)) return { power: 5 };
    let m;
    if (isPy(kind)) {
      m = / · pin (\d+)$/.exec(s);
      return m ? { pin: +m[1] } : null;
    }
    if (kind === 'pico') {
      m = /^GP(\d+)\b/.exec(s);
      return m ? { pin: +m[1] } : /^VSYS/.test(s) ? { power: 5 } : null;
    }
    if (kind === 'esp32' || kind === 'esp32c3') {
      m = /^GPIO(\d+)\b/.exec(s);
      return m ? { pin: +m[1] } : /^VIN/.test(s) ? { power: 5 } : null;
    }
    m = /^D(\d+)\b/.exec(s) || /\(D(\d+)\)/.exec(s);
    if (m) return { pin: +m[1] };
    m = /^A(\d+)$/.exec(s);
    if (kind === 'mega') {
      if (m) return { pin: 54 + +m[1] };
      if (s === 'SDA') return { pin: 20 };
      if (s === 'SCL') return { pin: 21 };
      return null;
    }
    if (m) return +m[1] <= 5 ? { pin: 14 + +m[1] } : { pin: 'A' + m[1] };
    if (s === 'SDA') return { pin: 18 };
    if (s === 'SCL') return { pin: 19 };
    return null;
  }

  function applyInputs() {
    const V = net.V, netOf = net.netOf, eng = sim.eng, half = eng.vcc / 2;
    for (const pin of mcu.list) {
      const v = V[netOf[pin.node]];
      if (pin.st > 1) {
        const h = v === v ? v > half : pin.st === 3;
        if (h !== pin.inp) { pin.inp = h; eng.setInput(pin.key, h); scopeRec(pin.key, h ? 1 : 0, eng.now()); }
      }
      const av = v === v ? Math.round(clamp(v, 0, eng.vcc) * 1000) / 1000 : 0;
      if (av !== pin.av) { pin.av = av; eng.setAnalog(pin.key, av); }
    }
  }

  /* Comprueba los pines del micro y recalcula si alguno cambió (lo llama el motor). */
  function pinsChanged() {
    const eng = sim.eng;
    if (!eng) return;
    let ch = false;
    for (const pin of mcu.all) {
      const st = eng.pinState(pin.key);
      if (st !== pin.st) { pin.st = st; ch = true; if (st <= 1) scopeRec(pin.key, st, eng.now()); }
    }
    if (ch || eng.remote) evaluate();
  }

  /* Ciclo de trabajo del PWM por hardware que alimenta una red (ESP32: LEDC). 1 si no hay PWM. */
  function dutyOf(node) {
    if (!sim.eng || !sim.eng.remote || node < 0) return 1;
    const k = net.netOf[node];
    const near = new Set([k]);
    for (let i = 0; i < R.n; i++) { if (R.a[i] === k) near.add(R.b[i]); if (R.b[i] === k) near.add(R.a[i]); }
    for (const pin of mcu.list) {
      const pw = sim.eng.pwm(pin.key);
      if (pw && near.has(net.netOf[pin.node])) return pw.duty;
    }
    return 1;
  }
  function pwmAt(node) {
    if (!sim.eng || !sim.eng.remote || node < 0) return null;
    const k = net.netOf[node];
    for (const pin of mcu.list) if (net.netOf[pin.node] === k) return sim.eng.pwm(pin.key);
    return null;
  }

  /* Nombre del pin como lo escribe el programa: D13, A0, GP15, GPIO4… */
  function pinLabel(key) {
    if (typeof key !== 'number') return key;
    if (isPy(mcu.kind)) return ((mcu.board && mcu.board.pinNames[key]) || '?') + ' (pin ' + key + ')';
    if (mcu.kind === 'pico') return 'GP' + key;
    if (mcu.kind === 'esp32' || mcu.kind === 'esp32c3') return 'GPIO' + key;
    if (mcu.kind === 'mega') return key >= 54 ? 'A' + (key - 54) : 'D' + key;
    return key >= 14 ? 'A' + (key - 14) : 'D' + key;
  }

  // Analizador lógico

  /* Guarda cada cambio de nivel de los pines del micro (tiempo en µs) y los dibuja como un
     analizador lógico: canales a elegir, ventana de tiempo, congelar; mide frecuencia y ciclo de trabajo. */
  const scope = { data: new Map(), sel: null, win: 20000, frozen: null, last: 0 };
  function scopeRec(key, v, t) {
    let d = scope.data.get(key);
    if (!d) { d = { t: [], v: [] }; scope.data.set(key, d); }
    if (d.v.length && d.v[d.v.length - 1] === v) return;
    d.t.push(t); d.v.push(v);
    if (d.t.length > 60000) { d.t.splice(0, 30000); d.v.splice(0, 30000); }
  }
  function fmtTime(us) {
    const a = Math.abs(us);
    if (a >= 1e6) return (us / 1e6).toFixed(a >= 1e7 ? 0 : 2).replace('.', ',') + ' s';
    if (a >= 1e3) return (us / 1e3).toFixed(a >= 1e4 ? 0 : 2).replace('.', ',') + ' ms';
    return us.toFixed(a >= 10 ? 0 : 1).replace('.', ',') + ' µs';
  }
  const byPin = (a, b) => String(pinLabel(a)).localeCompare(String(pinLabel(b)), 'es', { numeric: true });
  /* Canales por defecto: los pines unidos a otra pieza, primero los que más se mueven (como mucho 8). */
  function scopeDefault() {
    const used = new Set();
    parts.forEach((p) => { if (p !== mcu.board) p.t.forEach((node) => used.add(netId(node))); });
    const moves = (k) => (scope.data.get(k) || { t: [] }).t.length;
    return mcu.list.filter((p) => used.has(netId(p.node))).map((p) => p.key)
      .sort((a, b) => moves(b) - moves(a) || byPin(a, b)).slice(0, 8).sort(byPin);
  }
  function scopeChannels() {
    const box = $('scope-ch');
    if (!scope.sel) scope.sel = scopeDefault();
    const keys = mcu.list.map((p) => p.key).sort(byPin);
    $('scope-n').textContent = scope.sel.length;
    box.innerHTML = keys.length ? '' : '<span>No hay pines del micro en el plano.</span>';
    keys.forEach((k) => {
      const l = document.createElement('label');
      l.innerHTML = '<input type="checkbox"' + (scope.sel.includes(k) ? ' checked' : '') + '><span>' + esc(pinLabel(k)) + '</span>';
      l.querySelector('input').onchange = (e) => {
        scope.sel = scope.sel.filter((x) => x !== k);
        if (e.target.checked) scope.sel.push(k);
        scope.sel.sort(byPin);
        $('scope-n').textContent = scope.sel.length;
        drawScope(true);
      };
      box.appendChild(l);
    });
  }
  function levelAt(d, t) {
    let lo = 0, hi = d.t.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (d.t[m] <= t) { r = m; lo = m + 1; } else hi = m - 1; }
    return r;
  }
  /* Periodo entre los dos últimos flancos de subida y tiempo en alto de ese ciclo. */
  function measure(d, tEnd) {
    const rises = [];
    for (let i = levelAt(d, tEnd); i > 0 && rises.length < 2; i--) if (d.v[i] === 1) rises.push(i);
    if (rises.length < 2) return '';
    const per = d.t[rises[0]] - d.t[rises[1]];
    if (!(per > 0) || tEnd - d.t[rises[0]] > per * 3) return '';
    const hiT = d.t[rises[1] + 1] - d.t[rises[1]];
    const f = 1e6 / per;
    return (f >= 1000 ? (f / 1000).toFixed(2).replace('.', ',') + ' kHz' : f.toFixed(f < 10 ? 2 : 1).replace('.', ',') + ' Hz') +
      ' · ' + Math.round(hiT / per * 100) + ' %';
  }
  function drawScope(force) {
    const cv = $('scope-cv');
    if (!$('pane-scope').classList.contains('on')) return;
    const now = performance.now();
    if (!force && now - scope.last < 60) return;
    scope.last = now;
    const sel = scope.sel || [];
    const W = Math.max(200, cv.parentNode.clientWidth - 2), rowH = 30, H = Math.max(60, sel.length * rowH + 26);
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
    }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#0b1020'; c.fillRect(0, 0, W, H);
    const L = 62, R = 128, pw = W - L - R;
    const tEnd = scope.frozen != null ? scope.frozen : (sim.eng ? sim.eng.now() : scope.lastEnd || 0);
    scope.lastEnd = tEnd;
    const tStart = tEnd - scope.win;
    const x = (t) => L + (t - tStart) / scope.win * pw;
    c.strokeStyle = '#1e293b'; c.lineWidth = 1; c.font = '11px system-ui, sans-serif'; c.fillStyle = '#64748b';
    for (let i = 0; i <= 10; i++) {
      const xx = Math.round(L + pw * i / 10) + 0.5;
      c.beginPath(); c.moveTo(xx, 0); c.lineTo(xx, H - 18); c.stroke();
    }
    c.textAlign = 'left'; c.fillText(fmtTime(-scope.win), L, H - 5);
    c.textAlign = 'right'; c.fillText(scope.frozen != null ? 'congelado' : 'ahora', L + pw, H - 5);
    c.textAlign = 'center'; c.fillText(fmtTime(scope.win / 10) + ' / div', L + pw / 2, H - 5);
    if (!sel.length) { c.textAlign = 'left'; c.fillText('Marca arriba los pines que quieres ver.', L + 8, 24); return; }
    const COLORS = ['#22d3ee', '#a3e635', '#fbbf24', '#f472b6', '#818cf8', '#34d399', '#fb923c', '#e879f9'];
    sel.forEach((k, r) => {
      const y0 = r * rowH + 6, yHi = y0 + 4, yLo = y0 + rowH - 8, col = COLORS[r % COLORS.length];
      c.fillStyle = col; c.textAlign = 'left'; c.font = '600 12px system-ui, sans-serif';
      c.fillText(pinLabel(k), 8, y0 + rowH / 2 + 2);
      const d = scope.data.get(k);
      c.strokeStyle = col; c.lineWidth = 1.6; c.beginPath();
      if (!d || !d.t.length) { c.moveTo(L, yLo); c.lineTo(L + pw, yLo); c.stroke(); return; }
      let i = levelAt(d, tStart);
      let py = (i >= 0 ? d.v[i] : 0) ? yHi : yLo;
      c.moveTo(L, py);
      for (i += 1; i < d.t.length && d.t[i] <= tEnd; i++) {
        const xx = x(d.t[i]);
        c.lineTo(xx, py);
        py = d.v[i] ? yHi : yLo;
        c.lineTo(xx, py);
      }
      c.lineTo(L + pw, py); c.stroke();
      c.fillStyle = '#cbd5e1'; c.font = '11px system-ui, sans-serif';
      c.fillText(measure(d, tEnd), L + pw + 8, y0 + rowH / 2 + 2);
    });
  }
  $('scope-win').onchange = (e) => { scope.win = +e.target.value; drawScope(true); };
  $('scope-freeze').onclick = () => {
    scope.frozen = scope.frozen != null ? null : (sim.eng ? sim.eng.now() : null);
    $('scope-freeze').classList.toggle('on', scope.frozen != null);
    $('scope-freeze').textContent = scope.frozen != null ? 'Seguir' : 'Congelar';
    drawScope(true);
  };
  window.addEventListener('resize', () => drawScope(true));
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('.scope-pick')) $('scope-pick').open = false; });

  /* El borde superior del panel inferior se arrastra para hacerlo más alto o más bajo. */
  (() => {
    const bottom = document.querySelector('.sim-bottom'), grip = document.createElement('div');
    grip.className = 'sim-grip'; grip.title = 'Arrastra para cambiar el alto';
    bottom.prepend(grip);
    try { const h = +localStorage.getItem('sim-bottom-h'); if (h > 100) bottom.style.height = h + 'px'; } catch (_) { /* nada */ }
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const y0 = e.clientY, h0 = bottom.offsetHeight, max = bottom.parentNode.clientHeight - 120;
      const move = (ev) => { bottom.style.height = clamp(h0 + y0 - ev.clientY, 110, max) + 'px'; cm.refresh(); drawScope(true); };
      const up = () => {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
        try { localStorage.setItem('sim-bottom-h', bottom.offsetHeight); } catch (_) { /* nada */ }
      };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    });
  })();

  // Piezas simuladas

  let parts = [], partByEl = new Map(), linkParts = [], drvParts = [], resParts = [], updParts = [], frmParts = [];
  const i2c = [];             // dispositivos del bus I2C
  const spiDevs = [];         // dispositivos que escuchan el SPI por hardware

  const Proto = {
    n(k) { const v = this.t.get(k); return v === undefined ? -1 : v; },
    v(k) { return volt(this.n(k)); },
    hi(k) { return this.v(k) > 2.5; },
    net(k) { return netId(this.n(k)); },
    powered(vcc, gnd) { return this.v(vcc || 'VCC') - this.v(gnd || 'GND') > 3; },
  };

  function newPart(el, name) {
    const p = Object.create(Proto);
    p.el = el; p.kind = name; p.order = 3; p.same = [];
    p.label = String(el.attr('title/text') || name);
    p.t = new Map();
    (el.get('terminals') || []).forEach((t) => {
      const node = nodeOf(el.id, t.id), nm = String(t.name || '').trim();
      const add = (k) => {
        if (!k) return;
        // Bornes con el mismo nombre en una pieza están unidos por dentro (−V −V, COM, PE…)
        if (p.t.has(k)) p.same.push([p.t.get(k), node]); else p.t.set(k, node);
      };
      add(nm);
      const sfx = nm.replace(/^\d+\s+/, '');      // circuitos integrados: "3 OUT" también como "OUT"
      if (sfx !== nm) add(sfx);
    });
    return p;
  }

  /* Seguidor del tiempo encendido entre fotogramas: da el brillo con PWM y la multiplexación. */
  function duty() {
    return {
      on: false, since: 0, acc: 0,
      set(on, now) {
        if (on === this.on) return;
        if (this.on) this.acc += now - this.since;
        this.on = on; this.since = now;
      },
      take(now, span) {
        if (this.on) this.acc += now - this.since;
        this.since = now;
        const d = span > 0 ? Math.min(1, this.acc / span) : (this.on ? 1 : 0);
        this.acc = 0;
        return d;
      },
      reset() { this.on = false; this.since = 0; this.acc = 0; },
    };
  }
  const glow = (d) => (d <= 0.004 ? 0 : 0.25 + 0.75 * Math.pow(d, 0.6));

  // Controles del panel derecho
  function ctlBox(p, extra) {
    const box = document.createElement('div');
    box.className = 'ctl';
    box.innerHTML = '<div class="nm">' + esc(p.label) + (extra ? '<small>' + esc(extra) + '</small>' : '') + '</div>';
    $('controls').appendChild(box);
    p.ctlEl = box;
    return box;
  }
  function slider(box, label, min, max, step, val, fmt, on) {
    const l = document.createElement('label');
    l.innerHTML = '<span>' + esc(label) + '</span><input type="range"><output></output>';
    const inp = l.querySelector('input'), out = l.querySelector('output');
    Object.assign(inp, { min, max, step, value: val });
    const show = () => { out.textContent = fmt(+inp.value); };
    inp.oninput = () => { show(); on(+inp.value); };
    show();
    box.appendChild(l);
    return inp;
  }
  function holdBtn(box, text, on) {
    const b = document.createElement('button');
    b.className = 'btn btn-sm hold'; b.textContent = text;
    const set = (v) => { b.classList.toggle('on', v); on(v); };
    b.onpointerdown = (e) => { e.preventDefault(); set(true); };
    b.onpointerup = b.onpointerleave = b.onpointercancel = () => { if (b.classList.contains('on')) set(false); };
    box.appendChild(b);
    return b;
  }
  function check(box, text, val, on) {
    const l = document.createElement('label');
    l.innerHTML = '<input type="checkbox"><span>' + esc(text) + '</span>';
    const c = l.querySelector('input');
    c.checked = !!val; c.onchange = () => on(c.checked);
    box.appendChild(l);
    return c;
  }

  /* Cambió algo que une o separa redes (pulsador, interruptor). */
  function topoChanged() {
    if (!net.base) return;
    rebuild();
    evaluate();
  }
  function changed() { evaluate(); }

  // Interruptores y pulsadores
  function switchPart(opt) {
    return (p) => {
      p.state = !!opt.def;
      p.fixed = opt.fixed || [];
      p.links = (par) => { for (const [a, b] of (p.state ? opt.on : opt.off) || []) union(par, p.n(a), p.n(b)); };
      p.set = (s) => {
        if (s === p.state) return;
        p.state = s;
        if (p.cb) p.cb.checked = s;
        if (p.hb) p.hb.classList.toggle('on', s);
        draw(); topoChanged();
      };
      const draw = () => {
        highlight(p, opt.hold ? p.state : p.state !== !!opt.def);
        if (!opt.hold) tag(p, p.state ? (opt.onText || 'ON') : (opt.offText || 'OFF'), p.state ? '#15803d' : '#64748b');
      };
      if (opt.hold) p.press = (on) => p.set(on); else p.click = () => p.set(!p.state);
      p.ctl = () => {
        const box = ctlBox(p, opt.hold ? 'pulsador' : 'interruptor');
        if (opt.hold) p.hb = holdBtn(box, 'Mantener pulsado', (v) => p.set(v));
        else p.cb = check(box, opt.onText ? opt.onText : 'Cerrado', p.state, (v) => p.set(v));
      };
      draw();
    };
  }

  // Resistencias
  function parseOhms(s) {
    const m = /(\d+(?:[.,]\d+)?)\s*([kKmM]?)\s*(?:Ω|ohm|ohms|R\b)/.exec(s) || /(\d+(?:[.,]\d+)?)\s*([kKM])\b/.exec(s);
    if (!m) return 0;
    const v = parseFloat(m[1].replace(',', '.'));
    return v * ({ k: 1e3, K: 1e3, M: 1e6, m: 1e6 }[m[2]] || 1);
  }
  function potPart(triples, ohm, labels) {
    return (p) => {
      p.res = [];
      p.pos = triples.map(() => 0.5);
      const rs = triples.map(([hiT, w, loT]) => {
        const r1 = { a: p.n(hiT), b: p.n(w), ohm: ohm / 2 }, r2 = { a: p.n(w), b: p.n(loT), ohm: ohm / 2 };
        p.res.push(r1, r2);
        return [r1, r2];
      });
      p.setPos = (i, x) => {
        p.pos[i] = x;
        rs[i][0].ohm = ohm * (1 - x) + 0.5;
        rs[i][1].ohm = ohm * x + 0.5;
        if (p.knob) p.knob();
        changed();
      };
      triples.forEach((_, i) => { rs[i][0].ohm = ohm * 0.5; rs[i][1].ohm = ohm * 0.5; });
      p.ctl = () => {
        const box = ctlBox(p, 'potenciómetro');
        triples.forEach((_, i) => slider(box, labels ? labels[i] : 'Giro', 0, 100, 1, 50, (v) => v + ' %', (v) => p.setPos(i, v / 100)));
      };
    };
  }
  function varResPart(a, b, label, min, max, step, val, fmt, ohmOf) {
    return (p) => {
      const r = { a: p.n(a), b: p.n(b), ohm: ohmOf(val) };
      p.res = [r];
      p.ctl = () => slider(ctlBox(p, 'resistencia variable'), label, min, max, step, val, fmt, (v) => { r.ohm = ohmOf(v); changed(); });
    };
  }
  const ldrOhm = (lux) => 10000 * Math.pow(Math.max(0.1, lux) / 10, -0.7);
  const ntcOhm = (c) => 10000 * Math.exp(3950 * (1 / (c + 273.15) - 1 / 298.15));
  const luxOf = (x) => Math.round(Math.pow(10, x));      // el control va en escala logarítmica

  // Fuentes
  function batteryPart(plus, minus, volts) {
    return (p) => {
      p.order = 1;
      p.drive = () => {
        const np = p.n(plus), nm = p.n(minus);
        if (np < 0 || nm < 0) return;
        const kp = net.netOf[np], km = net.netOf[nm];
        if (net.fixed[km]) fix(np, net.V[km] + volts);
        else if (net.fixed[kp]) fix(nm, net.V[kp] - volts);
        else { fix(nm, 0); fix(np, volts); }
      };
    };
  }
  /* Red eléctrica: se simula como el valor eficaz entre L y N (el relé o el interruptor solo
     necesitan saber si hay tensión). PE va con N, como en el cuadro. Con corriente o sin ella y la
     tensión se eligen en el editor o aquí, y se guardan en el elemento (`mains`). */
  const MAINS_V = [110, 120, 127, 220, 230];
  function mainsPart(p) {
    p.order = 1;
    p.m = Object.assign({ on: true, volts: 230 }, p.el.get('mains'));
    p.drive = () => {
      if (!p.m.on) return;
      const nn = p.n('N'), nl = p.n('L');
      if (nn < 0 && nl < 0) return;
      const kn = nn < 0 ? -1 : net.netOf[nn];
      const vn = kn >= 0 && net.fixed[kn] ? net.V[kn] : 0;
      fix(nn, vn); fix(p.n('PE'), vn); fix(nl, vn + p.m.volts);
    };
    const draw = () => tag(p, p.m.on ? p.m.volts + ' V ~' : 'Sin corriente', p.m.on ? '#8a5a14' : '#64748b');
    p.set = (patch) => {
      Object.assign(p.m, patch);
      p.el.set('mains', Object.assign({}, p.m));
      if (p.cb) p.cb.checked = p.m.on;
      draw(); changed();
      if (diagramId) { edit.dirty = true; clearTimeout(edit.timer); edit.timer = setTimeout(flushSave, 1200); }
    };
    p.click = () => p.set({ on: !p.m.on });
    p.ctl = () => {
      const box = ctlBox(p, 'red eléctrica');
      p.cb = check(box, 'Con corriente', p.m.on, (v) => p.set({ on: v }));
      const l = document.createElement('label');
      l.innerHTML = '<span>Tensión</span><select>' + MAINS_V.map((v) =>
        '<option value="' + v + '"' + (v === p.m.volts ? ' selected' : '') + '>' + v + ' V ~</option>').join('') + '</select>';
      l.querySelector('select').onchange = (e) => p.set({ volts: Number(e.target.value) });
      box.appendChild(l);
    };
    draw();
  }
  function regulatorPart(inT, gT, outT, volts) {
    return (p) => {
      p.order = 2;
      p.drive = () => {
        const vi = p.v(inT), vg = p.v(gT);
        const g = vg === vg ? vg : 0;
        if (vi - g >= volts + 1) fix(p.n(outT), g + volts);
      };
    };
  }

  /* Módulo que entrega una tensión de salida según un control (sensor analógico, PIR…). */
  function sourcePart(opt) {
    return (p) => {
      p.val = opt.val;
      p.drive = () => {
        if (!p.powered(opt.vcc, opt.gnd)) return;
        const vcc = p.v(opt.vcc || 'VCC') - (p.v(opt.gnd || 'GND') || 0);
        opt.out(p.val, vcc).forEach(([t, v]) => fix(p.n(t), v));
      };
      p.set = (v) => { p.val = v; if (opt.draw) opt.draw(p); changed(); };
      p.ctl = () => {
        const box = ctlBox(p, 'sensor');
        if (opt.check) p.cb = check(box, opt.check, p.val, (v) => p.set(v));
        else slider(box, opt.label, opt.min, opt.max, opt.step, opt.val, opt.fmt, (v) => p.set(v));
      };
      if (opt.check) p.click = () => { p.set(!p.val); if (p.cb) p.cb.checked = p.val; };
      if (opt.draw) opt.draw(p);
    };
  }

  // LEDs
  const LED_COLORS = { rojo: '#ff2a1a', verde: '#2bff4f', azul: '#3d86ff', amarillo: '#ffd60a', blanco: '#ffffff' };
  function ledPart(color) {
    return (p) => {
      const g = ov(p, 40, 70);
      const halo = svg('circle', { cx: 20, cy: 24, r: 26, fill: color, opacity: 0, filter: 'url(#sim-blur)' }, g);
      const core = svg('path', { d: 'M 8 40 V 18 A 12 12 0 0 1 32 18 V 40 Z', fill: color, opacity: 0 }, g);
      const d = duty();
      p.update = (now) => d.set(p.v('A (+)') - p.v('K (−)') > 1.5, now);
      p.frame = (now, span) => {
        const b = glow(d.take(now, span) * dutyOf(p.n('A (+)')));
        halo.setAttribute('opacity', (b * 0.55).toFixed(3));
        core.setAttribute('opacity', (b * 0.85).toFixed(3));
      };
      p.reset = () => d.reset();
      p.idle = () => { halo.setAttribute('opacity', 0); core.setAttribute('opacity', 0); };
    };
  }
  function rgbPart(p) {
    const g = ov(p, 56, 80);
    const halo = svg('circle', { cx: 28, cy: 28, r: 30, fill: '#000', opacity: 0, filter: 'url(#sim-blur)' }, g);
    const core = svg('path', { d: 'M 12 44 V 20 A 16 16 0 0 1 44 20 V 44 Z', fill: '#000', opacity: 0 }, g);
    const ds = ['R', 'G', 'B'].map(() => duty());
    p.update = (now) => ['R', 'G', 'B'].forEach((c, i) => ds[i].set(p.v(c) - p.v('COM') > 1.5, now));
    p.frame = (now, span) => {
      const c = ds.map((d) => glow(d.take(now, span)));
      const m = Math.max(...c);
      const col = 'rgb(' + c.map((x) => Math.round(255 * (m ? x / m : 0))).join(',') + ')';
      halo.setAttribute('fill', col); core.setAttribute('fill', col);
      halo.setAttribute('opacity', (m * 0.6).toFixed(3)); core.setAttribute('opacity', (m * 0.85).toFixed(3));
    };
    p.reset = () => ds.forEach((d) => d.reset());
    p.idle = () => { halo.setAttribute('opacity', 0); core.setAttribute('opacity', 0); };
  }

  /* Dígito de 7 segmentos dibujado con rectángulos. */
  function digitSegs(g, x0, y0, w, h, t) {
    const v = h / 2 - 1.5 * t;
    const geo = [[x0 + t, y0, w - 2 * t, t], [x0 + w - t, y0 + t, t, v], [x0 + w - t, y0 + h / 2 + t / 2, t, v],
      [x0 + t, y0 + h - t, w - 2 * t, t], [x0, y0 + h / 2 + t / 2, t, v], [x0, y0 + t, t, v], [x0 + t, y0 + h / 2 - t / 2, w - 2 * t, t]];
    return geo.map(([x, y, ww, hh]) => svg('rect', { x, y, width: ww, height: hh, rx: t / 2, fill: '#ff2a1a', opacity: 0.08 }, g));
  }

  function seg7Part(p) {
    const g = ov(p, 70, 110);
    const geo = { A: [20, 24, 26, 4], B: [46, 28, 4, 22], C: [46, 56, 4, 22], D: [20, 78, 26, 4], E: [16, 56, 4, 22], F: [16, 28, 4, 22], G: [20, 51, 26, 4] };
    svg('rect', { x: 12, y: 20, width: 46, height: 70, fill: '#1d1d1d' }, g);
    const segs = {};
    Object.entries(geo).forEach(([k, [x, y, w, h]]) => { segs[k] = svg('rect', { x, y, width: w, height: h, rx: 1.5, fill: '#ff2a1a', opacity: 0.1 }, g); });
    segs.DP = svg('circle', { cx: 54, cy: 84, r: 2.5, fill: '#ff2a1a', opacity: 0.1 }, g);
    const ds = {};
    Object.keys(segs).forEach((k) => { ds[k] = duty(); });
    p.update = (now) => { const c = p.v('COM'); for (const k in ds) ds[k].set(p.v(k) - c > 1.5, now); };
    p.frame = (now, span) => { for (const k in ds) segs[k].setAttribute('opacity', Math.max(0.1, glow(ds[k].take(now, span))).toFixed(3)); };
    p.reset = () => { for (const k in ds) ds[k].reset(); };
    p.idle = () => { for (const k in segs) segs[k].setAttribute('opacity', 0.1); };
  }

  // Cargas: motor, bomba, solenoide, lámpara
  function loadPart(plus, minus, kind) {
    return (p) => {
      const d = duty();
      let dir = 1, ang = 0, rot = null;
      if (kind === 'motor') {
        const sz = p.el.size();
        ov(p, 0, 0);
        const r = Math.min(sz.width, sz.height) * 0.26;
        rot = svg('g', {}, svg('g', { transform: 'translate(' + sz.width * 0.58 + ',' + sz.height / 2 + ')' }, p.box));
        svg('circle', { r, fill: 'none', stroke: '#3b6182', 'stroke-width': 2, 'stroke-dasharray': '4 3' }, rot);
        svg('line', { x1: 0, y1: 0, x2: r, y2: 0, stroke: '#3b6182', 'stroke-width': 3, 'stroke-linecap': 'round' }, rot);
        rot.parentNode.style.display = 'none';
      }
      p.update = (now) => {
        const dv = p.v(plus) - p.v(minus);
        d.set(Math.abs(dv) > 2.5, now);
        if (Math.abs(dv) > 2.5) dir = dv > 0 ? 1 : -1;
      };
      p.frame = (now, span, dt) => {
        const x = d.take(now, span);
        if (rot) {
          rot.parentNode.style.display = x > 0.01 ? '' : 'none';
          ang = (ang + dir * x * dt * 0.9) % 360;
          rot.setAttribute('transform', 'rotate(' + ang.toFixed(1) + ')');
        }
        tag(p, x > 0.01 ? (kind === 'motor' ? (dir > 0 ? '⟳ ' : '⟲ ') + Math.round(x * 100) + ' %' : 'ON') : '', '#15803d');
      };
      p.reset = () => d.reset();
      p.idle = () => { tag(p, ''); if (rot) rot.parentNode.style.display = 'none'; };
    };
  }

  /* Cargas de red (110–230 V ~) entre L y N: el foco se enciende y el ventilador gira. Por debajo
     de ~80 V no arrancan (un borne al aire o una fuente de 5/24 V no los mueve). */
  function acLoadPart(kind) {
    return (p) => {
      const d = duty();
      let ang = 0, light = null, rot = null;
      if (kind === 'lamp') {
        const g = ov(p, 80, 120);
        light = svg('g', { opacity: 0 }, g);
        svg('circle', { cx: 40, cy: 42, r: 40, fill: '#ffd43b', filter: 'url(#sim-blur)' }, light);
        svg('path', { d: 'M 26 76 C 26 66 12 60 12 42 A 28 28 0 0 1 68 42 C 68 60 54 66 54 76 Z', fill: '#fff3b0', stroke: '#d9b84a', 'stroke-width': 1.2 }, light);
        svg('path', { d: 'M 35 46 L 37 40 L 39 46 L 41 40 L 43 46 L 45 40', fill: 'none', stroke: '#ff9d00', 'stroke-width': 2 }, light);
      } else {
        const g = ov(p, 100, 120);
        rot = svg('g', {}, svg('g', { transform: 'translate(50,46)' }, g));
        for (const a of [0, 120, 240]) {
          svg('path', { d: 'M 0 0 C -6 -16 -2 -32 8 -36 C 14 -24 10 -10 0 0 Z', fill: '#9fb3c4', stroke: '#6f8597', 'stroke-width': 0.8, transform: 'rotate(' + a + ')' }, rot);
        }
        svg('circle', { r: 7, fill: '#6f8597', stroke: '#4c6273' }, rot);
        rot.parentNode.style.display = 'none';
      }
      p.update = (now) => d.set(Math.abs(p.v('L') - p.v('N')) > 80, now);
      p.frame = (now, span, dt) => {
        // detrás de un dimmer, el brillo es el nivel que da su entrada PWM
        const k = netId(p.n('L')), dim = parts.find((q) => q.dimmer && netId(q.n('L carga')) === k);
        const x = d.take(now, span) * (dim ? dim.level : 1);
        if (light) light.setAttribute('opacity', x > 0.01 ? glow(x).toFixed(3) : 0);
        if (rot) {
          rot.parentNode.style.display = x > 0.01 ? '' : 'none';
          ang = (ang + x * dt * 1.2) % 360;
          rot.setAttribute('transform', 'rotate(' + ang.toFixed(1) + ')');
        }
        tag(p, x > 0.01 ? (kind === 'lamp' ? (dim ? 'Brillo ' + Math.round(x * 100) + ' %' : 'Encendido') : 'Girando') : '', '#15803d');
      };
      p.reset = () => d.reset();
      p.idle = () => {
        tag(p, '');
        if (light) light.setAttribute('opacity', 0);
        if (rot) rot.parentNode.style.display = 'none';
      };
    };
  }

  /* Dimmer de triac con entrada PWM: el ciclo de trabajo de la entrada es el brillo de la carga.
     No une L con «L carga» (serían la misma red y se atenuaría todo lo que cuelga de la toma): pone
     la tensión de L en «L carga» mientras hay PWM y el foco de su salida multiplica por `level`. */
  function dimmerPart(p) {
    const d = duty();
    p.order = 2;                     // después de la toma (order 1), que fija L
    p.dimmer = true; p.on = false; p.level = 0;
    p.links = (par) => union(par, p.n('N'), p.n('N carga'));
    p.drive = () => {
      const vl = p.v('L');
      if (p.on && vl === vl) fix(p.n('L carga'), vl);
    };
    p.update = (now) => d.set(p.powered('VCC', 'GND') && p.v('PWM') - p.v('GND') > 1.5, now);
    p.frame = (now, span) => {
      p.level = p.level * 0.5 + d.take(now, span) * 0.5;      // suaviza el parpadeo entre fotogramas
      const on = p.level > 0.02;
      if (on !== p.on) { p.on = on; changed(); }
      tag(p, p.on ? Math.round(p.level * 100) + ' %' : '0 %', p.on ? '#15803d' : '#64748b');
    };
    p.reset = () => { d.reset(); p.on = false; p.level = 0; };
    p.idle = () => tag(p, '');
  }

  // Relés
  /* channels: [{ coil: () => bool, com, no, nc }] */
  function relayPart(channels, leds) {
    return (p) => {
      p.st = channels.map(() => false);
      p.links = (par) => channels.forEach((c, i) => {
        if (p.st[i] && c.no) union(par, p.n(c.com), p.n(c.no));
        if (!p.st[i] && c.nc) union(par, p.n(c.com), p.n(c.nc));
      });
      p.update = () => channels.forEach((c, i) => {
        const on = !!c.coil(p);
        if (on !== p.st[i]) { p.st[i] = on; sim.topo = true; }
      });
      const lg = leds ? ov(p, leds.w, leds.h) : null;
      const dots = leds ? leds.at.map(([x, y]) => svg('circle', { cx: x, cy: y, r: 6, fill: '#ff2a1a', opacity: 0, filter: 'url(#sim-blur)' }, lg)) : [];
      p.frame = () => {
        dots.forEach((dt, i) => dt.setAttribute('opacity', p.st[i] ? 0.9 : 0));
        tag(p, channels.length === 1 ? (p.st[0] ? 'ON' : 'OFF') : p.st.map((s, i) => (i + 1) + (s ? '●' : '○')).join(' '), p.st.some(Boolean) ? '#15803d' : '#64748b');
      };
      p.reset = () => { p.st = channels.map(() => false); };
      p.idle = () => { dots.forEach((dt) => dt.setAttribute('opacity', 0)); tag(p, ''); };
    };
  }
  const moduleCoil = (inT, vcc, gnd) => (p) => p.powered(vcc, gnd) && p.v(inT) - p.v(gnd || 'GND') > 2.5;
  const coil = (a, b) => (p) => Math.abs(p.v(a) - p.v(b)) > 3.5;

  // Transistores y optoacoplador
  function switchByVoltage(c, e, test) {
    return (p) => {
      p.on = false;
      p.links = (par) => { if (p.on) union(par, p.n(c), p.n(e)); };
      p.update = () => { const on = !!test(p); if (on !== p.on) { p.on = on; sim.topo = true; } };
      p.reset = () => { p.on = false; };
    };
  }

  // Servo
  /* Ancho de pulso → ángulo, con el rango por defecto de la librería Servo de cada placa:
     AVR y ESP32Servo 544–2400 µs, arduino-pico 1000–2000 µs. */
  function servoAngle(us) {
    const [lo, hi] = sim.eng && sim.eng.family === 'rp2040' ? [1000, 2000] : [544, 2400];
    return clamp((us - lo) / (hi - lo) * 180, 0, 180);
  }
  function servoPart(p) {
    const g = ov(p, 150, 70);
    svg('rect', { x: 46, y: 28, width: 60, height: 16, rx: 3, fill: '#1f5fbf' }, g);       // tapa el brazo dibujado
    const arm = svg('g', { transform: 'translate(60,36)' }, g);
    svg('rect', { x: -6, y: -5, width: 50, height: 10, rx: 5, fill: '#fff', stroke: '#c7c7c7' }, arm);
    svg('circle', { r: 9, fill: '#fff', stroke: '#c7c7c7' }, arm);
    svg('circle', { r: 2.5, fill: '#999' }, arm);
    for (let i = 1; i <= 3; i++) svg('circle', { cx: 8 + i * 9, r: 1.6, fill: '#bbb' }, arm);
    let target = 90, shown = 90, lvl = false, rise = -1;
    const draw = () => { arm.setAttribute('transform', 'translate(60,36) rotate(' + (shown - 90).toFixed(1) + ')'); };
    p.update = (now) => {
      const h = p.hi('PWM');
      if (h === lvl) return;
      lvl = h;
      if (h) rise = now;
      else if (rise >= 0) {
        const us = now - rise;
        if (us > 400 && us < 2700) target = servoAngle(us);
      }
    };
    p.frame = (now, span, dt) => {
      const pw = pwmAt(p.n('PWM'));       // ESP32: el servo lo mueve el LEDC, se lee su ciclo de trabajo
      if (pw && pw.freq > 0 && pw.duty > 0) {
        const us = pw.duty * 1e6 / pw.freq;
        if (us > 400 && us < 2700) target = servoAngle(us);
      }
      const step = 0.6 * dt;              // 60° cada 0,1 s, como un SG90
      shown += clamp(target - shown, -step, step);
      draw(); tag(p, Math.round(shown) + '°');
    };
    p.reset = () => { target = shown = 90; lvl = false; rise = -1; draw(); };
    p.idle = () => tag(p, '');
    draw();
  }

  // Zumbador
  const audio = {
    ctx: null, osc: null, gain: null, enabled: true,
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.osc = this.ctx.createOscillator(); this.gain = this.ctx.createGain();
        this.osc.type = 'square'; this.gain.gain.value = 0;
        this.osc.connect(this.gain).connect(this.ctx.destination); this.osc.start();
      } catch (_) { this.ctx = null; }
    },
    set(freq) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      if (freq > 0 && this.enabled) {
        this.osc.frequency.setTargetAtTime(clamp(freq, 20, 15000), t, 0.005);
        this.gain.gain.setTargetAtTime(0.06, t, 0.01);
      } else this.gain.gain.setTargetAtTime(0, t, 0.01);
    },
  };
  let loudest = 0;
  function buzzerPart(p) {
    const g = ov(p, 60, 74);
    const waves = svg('g', { opacity: 0 }, g);
    [10, 18, 26].forEach((r) => svg('path', { d: 'M ' + (56 + r * 0.3) + ' ' + (28 - r) + ' A ' + r * 1.2 + ' ' + r * 1.2 + ' 0 0 1 ' + (56 + r * 0.3) + ' ' + (28 + r), fill: 'none', stroke: '#3b6182', 'stroke-width': 2.5 }, waves));
    const d = duty();
    let edges = 0, lastRise = -1, period = 0;
    p.update = (now) => {
      const on = p.v('+') - p.v('−') > 2.5;
      if (on && !d.on) {
        edges++;
        if (lastRise >= 0) period = period ? period * 0.7 + (now - lastRise) * 0.3 : now - lastRise;
        lastRise = now;
      }
      d.set(on, now);
    };
    p.frame = (now, span) => {
      const x = d.take(now, span);
      // frecuencia por el periodo entre flancos (más fina que contar flancos en un fotograma)
      let f = edges >= 2 && period > 0 ? 1e6 / period : 0;
      if (!edges) { period = 0; lastRise = -1; }
      edges = 0;
      if (f < 20) f = x > 0.9 ? 2300 : 0;        // tensión continua: zumbador activo
      loudest = Math.max(loudest, f);
      waves.setAttribute('opacity', f ? 0.85 : 0);
      tag(p, f ? Math.round(f) + ' Hz' : '', '#b45309');
    };
    p.reset = () => { d.reset(); edges = 0; period = 0; lastRise = -1; };
    p.idle = () => { waves.setAttribute('opacity', 0); tag(p, ''); };
  }

  // NeoPixel WS2812
  function neoPart(count, pos, vccT) {
    return (p) => {
      const g = ov(p, count === 16 ? 140 : 240, count === 16 ? 150 : 44);
      const dots = pos.map(([x, y]) => {
        svg('circle', { cx: x, cy: y, r: 4.2, fill: '#e8e8e8' }, g);
        return svg('circle', { cx: x, cy: y, r: 6.5, fill: '#000', opacity: 0 }, g);
      });
      let cols = new Array(count).fill(0), buf = [], cur = 0, nb = 0, lvl = false, rise = 0, lastFall = 0, dirty = true;
      const latch = () => {
        if (buf.length) { for (let i = 0; i < count && i < buf.length; i++) cols[i] = buf[i]; buf = []; dirty = true; }
        cur = 0; nb = 0;
      };
      p.update = (now) => {
        const h = p.hi('DIN');
        if (h === lvl) return;
        lvl = h;
        if (h) { if (now - lastFall > 50) latch(); rise = now; }
        else {
          lastFall = now;
          cur = (cur << 1) | (now - rise > 0.6 ? 1 : 0);
          if (++nb === 24) { buf.push(cur); cur = 0; nb = 0; }
        }
      };
      p.frame = (now) => {
        if (buf.length && now - lastFall > 50) latch();
        if (!dirty) return;
        dirty = false;
        const on = p.powered(vccT, 'GND');
        dots.forEach((dt, i) => {
          const c = on ? cols[i] : 0;
          const gg = (c >> 16) & 255, r = (c >> 8) & 255, b = c & 255, m = Math.max(r, gg, b);
          if (!m) { dt.setAttribute('opacity', 0); return; }
          const k = 255 / m;        // color a tope y la intensidad en la opacidad, para que se vea aunque brille poco
          dt.setAttribute('fill', 'rgb(' + Math.round(r * k) + ',' + Math.round(gg * k) + ',' + Math.round(b * k) + ')');
          dt.setAttribute('opacity', (0.35 + 0.65 * Math.sqrt(m / 255)).toFixed(3));
        });
      };
      p.reset = () => { cols = new Array(count).fill(0); buf = []; cur = nb = 0; lvl = false; dirty = true; };
      p.idle = () => { dots.forEach((dt) => dt.setAttribute('opacity', 0)); };
    };
  }

  // LCD HD44780 con adaptador I2C PCF8574
  const LCD_CHARS = { 0xDF: '°', 0xE4: 'µ', 0xF4: 'Ω', 0xFF: '█', 0x7E: '→', 0x7F: '←', 0xA5: '·' };
  function lcdPart(cols, rows, geo) {
    return (p) => {
      const g = ov(p, geo.w, geo.h);
      const bl = svg('rect', { x: geo.bx, y: geo.by, width: geo.bw, height: geo.bh, rx: 2, fill: '#000', opacity: 0 }, g);
      const cells = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = geo.x0 + c * geo.dx, y = geo.y0 + r * geo.dy;
          cells.push({
            t: svg('text', { x: x + geo.cw / 2, y: y + geo.ch * 0.8, 'text-anchor': 'middle', 'font-size': geo.ch * 0.92, 'font-family': 'Consolas, "Courier New", monospace', fill: '#14240a' }, g),
            px: svg('path', { fill: '#14240a', transform: 'translate(' + x + ',' + y + ') scale(' + geo.cw / 5 + ',' + geo.ch / 8 + ')' }, g),
            ch: -1,
          });
        }
      }
      const s = {};
      const reset = () => Object.assign(s, { dd: new Uint8Array(128).fill(0x20), cg: new Uint8Array(64), addr: 0, cga: 0, cgMode: false,
        inc: 1, shift: 0, on: true, mode8: true, half: -1, prev: 0, light: true, dirty: true });
      reset();
      function command(c) {
        if (c & 0x80) { s.addr = c & 0x7f; s.cgMode = false; }
        else if (c & 0x40) { s.cga = c & 0x3f; s.cgMode = true; }
        else if (c & 0x20) { s.mode8 = !!(c & 0x10); }
        else if (c & 0x10) { const d = c & 4 ? 1 : -1; if (c & 8) s.shift += d; else s.addr = (s.addr + d) & 0x7f; }
        else if (c & 0x08) { s.on = !!(c & 4); }
        else if (c & 0x04) { s.inc = c & 2 ? 1 : -1; }
        else if (c & 0x02) { s.addr = 0; s.shift = 0; s.cgMode = false; }
        else if (c & 0x01) { s.dd.fill(0x20); s.addr = 0; s.shift = 0; s.inc = 1; s.cgMode = false; }
        s.dirty = true;
      }
      function data(d) {
        if (s.cgMode) { s.cg[s.cga] = d & 0x1f; s.cga = (s.cga + 1) & 0x3f; }
        else { s.dd[s.addr] = d; s.addr = (s.addr + s.inc) & 0x7f; }
        s.dirty = true;
      }
      function nibble(nib, rs) {
        if (s.mode8) { if (!rs && (nib & 0xe) === 0x2) s.mode8 = !!(nib & 1); return; }      // 0x3 = sigue en 8 bits, 0x2 = pasa a 4 bits
        if (s.half < 0) { s.half = nib; return; }
        const b = (s.half << 4) | nib;
        s.half = -1;
        if (rs) data(b); else command(b);
      }
      i2c.push({
        part: p,
        match: (a) => (a & 0xf8) === 0x20 || (a & 0xf8) === 0x38,
        loose: true,              // rango de direcciones: cede ante una pieza con dirección exacta (OLED 0x3C)
        write(v) {
          if ((s.prev & 4) && !(v & 4)) nibble(v >> 4, v & 1);      // flanco de bajada de EN
          if (!!(v & 8) !== s.light) { s.light = !!(v & 8); s.dirty = true; }
          s.prev = v;
        },
        read: () => 0xff,
      });
      p.frame = () => {
        if (!s.dirty) return;
        s.dirty = false;
        bl.setAttribute('opacity', s.light ? 0 : 0.45);
        for (let r = 0; r < rows; r++) {
          const base = r % 2 ? 0x40 : 0, off = r >= 2 ? cols : 0;
          for (let c = 0; c < cols; c++) {
            const cell = cells[r * cols + c];
            const code = s.on ? s.dd[base + (((off + c - s.shift) % 40) + 40) % 40] : 0x20;
            const key = code < 16 ? 1000 + code * 64 + s.cg.slice((code & 7) * 8, (code & 7) * 8 + 8).reduce((a, b) => a * 31 + b, 0) : code;
            if (cell.ch === key) continue;
            cell.ch = key;
            if (code < 16) {
              let d = '';
              const k = (code & 7) * 8;
              for (let y = 0; y < 8; y++) for (let x = 0; x < 5; x++) if (s.cg[k + y] & (16 >> x)) d += 'M' + x + ' ' + y + 'h0.9v0.9h-0.9z';
              cell.px.setAttribute('d', d); cell.t.textContent = '';
            } else {
              cell.px.setAttribute('d', '');
              cell.t.textContent = code >= 0x20 && code < 0x7e ? String.fromCharCode(code) : (LCD_CHARS[code] || (code === 0x20 ? '' : '▯'));
            }
          }
        }
      };
      p.reset = () => { reset(); cells.forEach((c) => { c.ch = -1; }); };
      p.idle = () => { s.on = false; s.dirty = true; p.frame(); };
      p.reset();
    };
  }

  // OLED SSD1306 I2C
  const OLED_ARGS = { 0x20: 1, 0x21: 2, 0x22: 2, 0x26: 6, 0x27: 6, 0x29: 5, 0x2a: 5, 0x81: 1, 0x8d: 1, 0xa3: 2, 0xa8: 1, 0xd3: 1, 0xd5: 1, 0xd6: 1, 0xd9: 1, 0xda: 1, 0xdb: 1 };
  function oledPart(p) {
    const g = ov(p, 130, 110);
    const img = svg('image', { x: 16, y: 40, width: 98, height: 49, preserveAspectRatio: 'none' }, g);
    img.style.imageRendering = 'pixelated';
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 64;
    const ctx = cv.getContext('2d'), im = ctx.createImageData(128, 64);
    const s = {};
    const reset = () => Object.assign(s, { vram: new Uint8Array(1024), ctl: -1, op: -1, need: 0, args: [], mode: 2, c0: 0, c1: 127, p0: 0, p1: 7,
      col: 0, page: 0, on: false, inv: false, remap: true, comRev: true, dirty: true });
    reset();
    function exec(op, a) {
      if (op === 0x20) s.mode = a[0] & 3;
      else if (op === 0x21) { s.c0 = a[0] & 127; s.c1 = a[1] & 127; s.col = s.c0; }
      else if (op === 0x22) { s.p0 = a[0] & 7; s.p1 = a[1] & 7; s.page = s.p0; }
      else if (op === 0xae || op === 0xaf) s.on = op === 0xaf;
      else if (op === 0xa6 || op === 0xa7) s.inv = op === 0xa7;
      else if (op === 0xa0 || op === 0xa1) s.remap = op === 0xa1;
      else if (op === 0xc0 || op === 0xc8) s.comRev = op === 0xc8;
      else if (op >= 0xb0 && op <= 0xb7) s.page = op & 7;
      else if (op <= 0x0f) s.col = (s.col & 0xf0) | op;
      else if (op >= 0x10 && op <= 0x1f) s.col = (s.col & 0x0f) | ((op & 0xf) << 4);
      s.dirty = true;
    }
    function command(b) {
      if (s.need > 0) { s.args.push(b); if (--s.need === 0) exec(s.op, s.args); return; }
      const n = OLED_ARGS[b] || 0;
      if (n) { s.op = b; s.need = n; s.args = []; } else exec(b, []);
    }
    function data(b) {
      s.vram[s.page * 128 + s.col] = b;
      s.dirty = true;
      if (s.mode === 0) { if (++s.col > s.c1) { s.col = s.c0; if (++s.page > s.p1) s.page = s.p0; } }
      else if (s.mode === 1) { if (++s.page > s.p1) { s.page = s.p0; if (++s.col > s.c1) s.col = s.c0; } }
      else s.col = Math.min(127, s.col + 1);
    }
    i2c.push({
      part: p,
      match: (a) => a === 0x3c || a === 0x3d,
      start() { s.ctl = -1; },
      write(b) {
        if (s.ctl < 0) { s.ctl = b; return; }
        if (s.ctl & 0x40) data(b); else command(b);
        if (s.ctl & 0x80) s.ctl = -1;          // Co = 1: el siguiente byte vuelve a ser de control
      },
      read: () => 0x00,
    });
    p.frame = () => {
      if (!s.dirty) return;
      s.dirty = false;
      const px = im.data;
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 128; x++) {
          const sx = s.remap ? x : 127 - x, sy = s.comRev ? y : 63 - y;
          let on = s.on && (s.vram[(sy >> 3) * 128 + sx] >> (sy & 7)) & 1;
          if (s.on && s.inv) on = !on;
          const i = (y * 128 + x) * 4;
          px[i] = on ? 170 : 3; px[i + 1] = on ? 235 : 16; px[i + 2] = on ? 255 : 30; px[i + 3] = 255;
        }
      }
      ctx.putImageData(im, 0, 0);
      img.setAttribute('href', cv.toDataURL());
    };
    p.reset = () => { reset(); p.frame(); };
    p.idle = () => { s.on = false; s.dirty = true; p.frame(); };
    p.reset();
  }

  // Reloj RTC DS1307 / DS3231
  function rtcPart(p) {
    const regs = new Uint8Array(64);
    let ptr = 0, first = false, wrote = false, offset = 0;
    const bcd = (v) => ((v / 10) | 0) * 16 + (v % 10);
    const unbcd = (v) => (v >> 4) * 10 + (v & 15);
    function fill() {
      const d = new Date(Date.now() + offset);
      regs[0] = bcd(d.getSeconds()); regs[1] = bcd(d.getMinutes()); regs[2] = bcd(d.getHours());
      regs[3] = d.getDay() + 1; regs[4] = bcd(d.getDate()); regs[5] = bcd(d.getMonth() + 1); regs[6] = bcd(d.getFullYear() % 100);
      regs[0x0f] &= 0x7f; regs[0x11] = 25; regs[0x12] = 0;      // DS3231: sin pérdida de alimentación, 25 °C
    }
    i2c.push({
      part: p,
      match: (a) => a === 0x68,
      start(write) { first = write; if (!write) fill(); },
      write(b) {
        if (first) { ptr = b & 63; first = false; return; }
        regs[ptr] = b;
        if (ptr <= 6) wrote = true;
        ptr = (ptr + 1) & 63;
      },
      read() { const v = regs[ptr]; ptr = (ptr + 1) & 63; return v; },
      stop() {
        if (!wrote) return;
        wrote = false;
        const t = new Date(2000 + unbcd(regs[6]), unbcd(regs[5] & 0x1f) - 1, unbcd(regs[4] & 0x3f),
          unbcd(regs[2] & 0x3f), unbcd(regs[1] & 0x7f), unbcd(regs[0] & 0x7f));
        offset = t.getTime() - Date.now();
      },
    });
    p.reset = () => { ptr = 0; wrote = false; };
  }

  // DHT22
  function dhtPart(p) {
    p.temp = 24; p.hum = 40;
    let lvl = true, lowAt = 0, busy = false, pull = false;
    p.drive = () => {
      if (!p.powered('VCC', 'GND')) return;
      weak(p.n('SDA'), p.v('VCC'), 1 / 10000);          // pull-up del módulo
      if (pull) fix(p.n('SDA'), 0);
    };
    p.update = (now) => {
      if (busy) return;
      const h = p.v('SDA') > 2.5;
      if (h === lvl) return;
      lvl = h;
      if (!h) lowAt = now;
      else if (now - lowAt > 500 && p.powered('VCC', 'GND')) respond();
    };
    function respond() {
      busy = true;
      const hv = Math.round(clamp(p.hum, 0, 100) * 10), tv = Math.round(Math.abs(p.temp) * 10) | (p.temp < 0 ? 0x8000 : 0);
      const bytes = [hv >> 8, hv & 255, tv >> 8, tv & 255];
      bytes.push(bytes.reduce((a, b) => a + b, 0) & 255);
      const seq = [[30, true], [80, false], [80, true]];          // [µs hasta el cambio, tira la línea a 0]
      bytes.forEach((b) => { for (let i = 7; i >= 0; i--) seq.push([50, false], [(b >> i) & 1 ? 70 : 26, true]); });
      seq.push([50, null]);
      let i = 0;
      const step = () => {
        const [, low] = seq[i];
        pull = !!low;
        if (low === null) busy = false;
        evaluate();
        if (++i < seq.length) sim.eng.after(seq[i][0], step);
        else { lvl = true; busy = false; }
      };
      sim.eng.after(seq[0][0], step);
    }
    p.ctl = () => {
      const box = ctlBox(p, 'sensor');
      slider(box, 'Temp.', -40, 80, 0.5, p.temp, (v) => v.toFixed(1) + ' °C', (v) => { p.temp = v; });
      slider(box, 'Humedad', 0, 100, 0.5, p.hum, (v) => v.toFixed(1) + ' %', (v) => { p.hum = v; });
    };
    p.reset = () => { lvl = true; busy = false; pull = false; };
  }

  // HC-SR04
  function sonarPart(p) {
    p.dist = 100;
    let lvl = false, rise = 0, echo = false, busy = false;
    p.drive = () => { if (p.powered('VCC', 'GND')) fix(p.n('ECHO'), echo ? 5 : 0); };
    p.update = (now) => {
      const h = p.hi('TRIG');
      if (h === lvl) return;
      lvl = h;
      if (h) { rise = now; return; }
      if (busy || now - rise < 8 || !p.powered('VCC', 'GND')) return;
      busy = true;
      sim.eng.after(250, () => {
        echo = true; evaluate();
        sim.eng.after(p.dist * 58.3, () => { echo = false; busy = false; evaluate(); });
      });
    };
    p.ctl = () => slider(ctlBox(p, 'sensor'), 'Distancia', 2, 400, 1, p.dist, (v) => v + ' cm', (v) => { p.dist = v; });
    p.reset = () => { lvl = false; echo = false; busy = false; };
  }

  // 74HC595
  function hc595Part(p) {
    let sr = 0, out = 0, lsh = false, lst = false;
    p.drive = () => {
      if (!p.powered('VCC', 'GND')) return;
      const oe = p.v('OE');
      if (!(oe > 2.5)) for (let i = 0; i < 8; i++) fix(p.n('Q' + i), (out >> i) & 1 ? p.v('VCC') : 0);
      fix(p.n('Q7S'), (sr >> 7) & 1 ? p.v('VCC') : 0);
    };
    p.update = () => {
      const sh = p.hi('SH_CP'), st = p.hi('ST_CP'), mr = p.v('MR');
      const before = out, srb = sr;
      if (mr < 1.5) sr = 0;
      else if (sh && !lsh) sr = ((sr << 1) | (p.hi('DS') ? 1 : 0)) & 0xff;
      if (st && !lst) out = sr;
      lsh = sh; lst = st;
      if (out !== before || ((sr ^ srb) & 0x80)) sim.again = true;
    };
    p.reset = () => { sr = out = 0; lsh = lst = false; };
  }

  // 74HC00, CD4017, LM358, ULN2003, puentes H, A4988
  function logicPart(compute, outs, vccT, gndT) {
    return (p) => {
      let st = {};
      p.drive = () => {
        if (!p.powered(vccT, gndT)) return;
        const vcc = p.v(vccT) - (p.v(gndT) || 0);
        outs.forEach((o) => { if (st[o] != null) fix(p.n(o), st[o] ? vcc : 0); });
      };
      p.update = () => {
        const ns = compute(p, st);
        for (const o of outs) if (ns[o] !== st[o]) { st = ns; sim.again = true; return; }
      };
      p.reset = () => { st = {}; };
    };
  }
  const lo = (p, k) => !(p.v(k) > 2.5);
  function cd4017(p, st) {
    if (p.ctr == null) p.ctr = 0;
    const clk = p.hi('CLK') && lo(p, 'CLK INH');
    if (p.hi('RESET')) p.ctr = 0;
    else if (clk && !p.lclk) p.ctr = (p.ctr + 1) % 10;
    p.lclk = clk;
    const o = { CO: p.ctr < 5 };
    for (let i = 0; i < 10; i++) o['Q' + i] = p.ctr === i;
    return o;
  }
  function hbridge(map, supplyT) {
    // map: [[en, in, out], …]: salida al positivo o a masa según la entrada, al aire si EN está bajo
    return (p) => {
      p.drive = () => {
        let vs = p.v(supplyT);
        if (!(vs === vs) || vs < 4) vs = 12;      // alimentación de potencia externa
        map.forEach(([en, inT, out]) => {
          const e = p.v(en);
          if (e === e && e < 1.5) return;          // sin puente/jumper y a 0: deshabilitado
          fix(p.n(out), p.hi(inT) ? vs : 0);
        });
      };
    };
  }
  function a4988Part(p) {
    let pos = 0, lstep = false;
    p.update = () => {
      const s = p.hi('STEP');
      const en = !(p.v('ENABLE') > 2.5), awake = !(p.v('SLEEP') < 1.5) && !(p.v('RESET') < 1.5);
      if (s && !lstep && en && awake) pos += p.hi('DIR') ? 1 : -1;
      lstep = s;
    };
    p.micro = () => {
      const m = (p.hi('MS1') ? 1 : 0) | (p.hi('MS2') ? 2 : 0) | (p.hi('MS3') ? 4 : 0);
      return { 0: 1, 1: 2, 2: 4, 3: 8, 7: 16 }[m] || 1;
    };
    p.angle = () => pos * 1.8 / p.micro();
    p.frame = () => tag(p, pos ? pos + ' pasos' : '', '#3d444c');
    p.reset = () => { pos = 0; lstep = false; };
    p.idle = () => tag(p, '');
  }
  function stepperPart(p) {
    const g = ov(p, 140, 140);
    const rot = svg('g', { transform: 'translate(70,70)' }, g);
    svg('line', { x1: 0, y1: 0, x2: 0, y2: -30, stroke: '#3b6182', 'stroke-width': 4, 'stroke-linecap': 'round' }, rot);
    let drv = null;
    p.frame = () => {
      if (drv === null) {
        const mine = ['A+', 'A−', 'B+', 'B−'].map((k) => p.net(k)).filter((k) => k >= 0);
        drv = parts.find((q) => q.angle && ['1A', '1B', '2A', '2B'].some((k) => mine.includes(q.net(k)))) || false;
      }
      const a = drv ? drv.angle() : 0;
      rot.setAttribute('transform', 'translate(70,70) rotate(' + a.toFixed(1) + ')');
      tag(p, drv ? (Math.round(a * 10) / 10) + '°' : '');
    };
    p.reset = () => { drv = null; };
    p.idle = () => tag(p, '');
  }

  // TM1637 (4 dígitos)
  function tm1637Part(p) {
    const g = ov(p, 170, 80);
    svg('rect', { x: 16, y: 14, width: 124, height: 52, fill: '#111' }, g);
    const digs = [0, 1, 2, 3].map((i) => digitSegs(g, 31 + i * 31 - 10, 24, 20, 32, 3.5));
    const colon = [svg('circle', { cx: 77, cy: 32, r: 2.5, fill: '#ff2a1a', opacity: 0.08 }, g), svg('circle', { cx: 77, cy: 48, r: 2.5, fill: '#ff2a1a', opacity: 0.08 }, g)];
    const s = { segs: [0, 0, 0, 0, 0, 0], on: false, bright: 7, bytes: [], cur: 0, nb: 0, lc: true, ld: true, active: false, addr: 0, dirty: true };
    p.drive = () => {
      if (!p.powered('VCC', 'GND')) return;
      weak(p.n('CLK'), p.v('VCC'), 1 / 10000); weak(p.n('DIO'), p.v('VCC'), 1 / 10000);
    };
    function finish() {
      const b = s.bytes;
      if (!b.length) return;
      if ((b[0] & 0xc0) === 0xc0) { let a = b[0] & 7; for (let i = 1; i < b.length; i++) s.segs[a++ % 6] = b[i]; }
      else if ((b[0] & 0xc0) === 0x80) { s.on = !!(b[0] & 8); s.bright = b[0] & 7; }
      s.dirty = true;
    }
    p.update = () => {
      const c = p.hi('CLK'), d = p.hi('DIO');
      if (c && s.lc && d !== s.ld) {
        if (!d) { s.active = true; s.bytes = []; s.cur = 0; s.nb = 0; }
        else if (s.active) { s.active = false; finish(); }
      } else if (c && !s.lc && s.active) {
        if (s.nb < 8) { s.cur |= (d ? 1 : 0) << s.nb; s.nb++; }
        else { s.bytes.push(s.cur); s.cur = 0; s.nb = 0; }      // 9.º pulso: ACK
      }
      s.lc = c; s.ld = d;
    };
    p.frame = () => {
      if (!s.dirty) return;
      s.dirty = false;
      const op = (on) => (on && s.on ? (0.45 + s.bright * 0.08).toFixed(2) : 0.08);
      digs.forEach((segs, i) => segs.forEach((r, k) => r.setAttribute('opacity', op((s.segs[i] >> k) & 1))));
      colon.forEach((c) => c.setAttribute('opacity', op((s.segs[1] >> 7) & 1)));
    };
    p.reset = () => { Object.assign(s, { segs: [0, 0, 0, 0, 0, 0], on: false, active: false, lc: true, ld: true, dirty: true }); };
    p.idle = () => { s.on = false; s.dirty = true; p.frame(); };
  }

  // Matriz MAX7219
  function max7219Part(p) {
    const g = ov(p, 130, 150);
    svg('rect', { x: 18, y: 26, width: 94, height: 94, rx: 3, fill: '#111' }, g);
    const dots = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) dots.push(svg('circle', { cx: 27 + c * 11, cy: 35 + r * 11, r: 4, fill: '#ff2a1a', opacity: 0.12 }, g));
    const s = { rows: new Uint8Array(8), on: false, test: false, sr: 0, lclk: false, lcs: true, dirty: true };
    function word(w) {
      const a = (w >> 8) & 15, d = w & 255;
      if (a >= 1 && a <= 8) s.rows[a - 1] = d;
      else if (a === 0x0c) s.on = !!(d & 1);
      else if (a === 0x0f) s.test = !!(d & 1);
      s.dirty = true;
    }
    p.update = () => {
      const clk = p.hi('CLK'), cs = p.hi('CS');
      if (!cs && clk && !s.lclk) s.sr = ((s.sr << 1) | (p.hi('DIN') ? 1 : 0)) & 0xffff;
      if (cs && !s.lcs) word(s.sr);
      s.lclk = clk; s.lcs = cs;
    };
    spiDevs.push({ part: p, mosi: 'DIN', byte(b) { if (!p.hi('CS')) s.sr = ((s.sr << 8) | b) & 0xffff; } });
    p.frame = () => {
      if (!s.dirty) return;
      s.dirty = false;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const on = s.test || (s.on && (s.rows[r] >> (7 - c)) & 1);
        dots[r * 8 + c].setAttribute('opacity', on ? 1 : 0.12);
      }
    };
    p.reset = () => { s.rows.fill(0); Object.assign(s, { on: false, test: false, sr: 0, lclk: false, lcs: true, dirty: true }); };
    p.idle = () => { s.on = false; s.test = false; s.dirty = true; p.frame(); };
  }

  // Teclado 4×4
  const KEYS = ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D'];
  function keypadPart(p) {
    p.down = -1;
    const g = ov(p, 170, 200);
    const hl = svg('rect', { width: 32, height: 30, rx: 5, fill: 'rgba(59,97,130,.45)', stroke: '#3b6182', 'stroke-width': 2 }, g);
    hl.style.display = 'none';
    p.links = (par) => { if (p.down >= 0) union(par, p.n('R' + ((p.down >> 2) + 1)), p.n('C' + ((p.down & 3) + 1))); };
    const set = (k) => {
      if (k === p.down) return;
      p.down = k;
      if (k >= 0) { hl.setAttribute('x', 12 + (k & 3) * 39); hl.setAttribute('y', 12 + (k >> 2) * 37); }
      hl.style.display = k >= 0 ? '' : 'none';
      topoChanged();
    };
    p.press = (on, lp) => {
      if (!on) return set(-1);
      const x = lp.x * 170, y = lp.y * 200;
      const c = Math.floor((x - 10) / 39), r = Math.floor((y - 10) / 37);
      if (c >= 0 && c < 4 && r >= 0 && r < 4) set(r * 4 + c);
    };
    p.ctl = () => {
      const box = ctlBox(p, 'teclado');
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:6px';
      KEYS.forEach((k, i) => {
        const b = document.createElement('button');
        b.className = 'btn btn-sm'; b.textContent = k;
        b.onpointerdown = (e) => { e.preventDefault(); set(i); };
        b.onpointerup = b.onpointerleave = b.onpointercancel = () => { if (p.down === i) set(-1); };
        grid.appendChild(b);
      });
      box.appendChild(grid);
    };
  }

  // Interruptor DIP de 8
  function dipPart(p) {
    p.sw = new Array(8).fill(false);
    const g = ov(p, 140, 80);
    const levers = p.sw.map((_, i) => svg('rect', { x: 18 + i * 14 - 3, y: 39, width: 6, height: 9, rx: 1, fill: '#333' }, g));
    p.sw.forEach((_, i) => svg('rect', { x: 18 + i * 14 - 3, y: 28, width: 6, height: 9, rx: 1, fill: '#fff' }, g));
    levers.forEach((l) => g.appendChild(l));
    const boxes = [];
    p.links = (par) => p.sw.forEach((on, i) => { if (on) union(par, p.n((i + 1) + 'a'), p.n((i + 1) + 'b')); });
    const set = (i, v) => {
      p.sw[i] = v;
      levers[i].setAttribute('y', v ? 28 : 39);
      if (boxes[i]) boxes[i].checked = v;
      topoChanged();
    };
    p.click = (lp) => { const i = clamp(Math.floor((lp.x * 140 - 11) / 14), 0, 7); set(i, !p.sw[i]); };
    p.ctl = () => {
      const box = ctlBox(p, 'DIP');
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px';
      p.sw.forEach((v, i) => {
        const l = document.createElement('label');
        l.style.cssText = 'margin:0;gap:2px;flex-direction:column;font-size:11px';
        l.innerHTML = '<input type="checkbox"><span>' + (i + 1) + '</span>';
        boxes[i] = l.querySelector('input');
        boxes[i].onchange = () => set(i, boxes[i].checked);
        row.appendChild(l);
      });
      box.appendChild(row);
    };
  }

  // Encoder KY-040
  function encoderPart(p) {
    let a = 1, b = 1, busy = false;
    p.sw = false;
    p.links = (par) => { if (p.sw) union(par, p.n('SW'), p.n('GND')); };
    p.drive = () => {
      if (!p.powered('+', 'GND')) return;
      fix(p.n('CLK'), a ? p.v('+') : 0); fix(p.n('DT'), b ? p.v('+') : 0);
      weak(p.n('SW'), p.v('+'), 1 / 10000);
    };
    function turn(dir) {
      if (busy || !sim.eng) return;
      busy = true;
      const seq = dir > 0 ? [[0, 1], [0, 0], [1, 0], [1, 1]] : [[1, 0], [0, 0], [0, 1], [1, 1]];
      let i = 0;
      const step = () => {
        [a, b] = seq[i]; evaluate();
        if (++i < seq.length) sim.eng.after(1500, step); else busy = false;
      };
      step();
    }
    p.ctl = () => {
      const box = ctlBox(p, 'encoder');
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;margin-top:6px';
      [['⟲ Izq.', -1], ['Der. ⟳', 1]].forEach(([t, d]) => {
        const bt = document.createElement('button');
        bt.className = 'btn btn-sm'; bt.style.flex = '1'; bt.textContent = t; bt.onclick = () => turn(d);
        row.appendChild(bt);
      });
      box.appendChild(row);
      holdBtn(box, 'Pulsar eje (SW)', (v) => { p.sw = v; topoChanged(); });
    };
    p.reset = () => { a = b = 1; busy = false; };
  }

  // Placa (Arduino, Pico, ESP32, Orange Pi, Raspberry Pi)
  function boardPart(kind) {
    return (p) => {
      p.order = 0;
      p.isMcu = !mcu.board;
      if (p.isMcu) { mcu.board = p; mcu.kind = kind; p.boardKind = kind; }
      p.pinNames = {};
      if (isPy(kind)) (p.el.get('terminals') || []).forEach((t) => { const m = /^(.*) · pin (\d+)$/.exec(t.name); if (m) p.pinNames[+m[2]] = m[1]; });
      const power = { 0: [], 5: [], 3.3: [] };
      p.fixedNodes = [];
      (p.el.get('terminals') || []).forEach((t) => {
        const info = boardPin(kind, t.name);
        if (!info) return;
        const node = nodeOf(p.el.id, t.id);
        if (info.power != null) power[info.power].push(node);
        else if (p.isMcu && info.pin != null) {
          const pin = mcuPin(info.pin);
          if (pin.node < 0) pin.node = node; else p.fixedNodes.push([pin.node, node]);     // SDA = A4, GND·1 = GND·2…
        }
      });
      Object.values(power).forEach((list) => list.slice(1).forEach((n) => p.fixedNodes.push([list[0], n])));
      p.drive = () => {
        if (power[0][0] != null) fix(power[0][0], 0);
        if (power[5][0] != null) fix(power[5][0], 5);
        if (power[3.3][0] != null) fix(power[3.3][0], 3.3);
      };
      // LED integrado: Uno (D13), Pico (GP25), ESP32 DevKit (GPIO2)
      const led = { uno: [404, 302, 151, 51.9, 13, '#ffb020'], esp32v1: [154, 318, 73, 235.5, 2, '#3a7bff'], pico: [123, 299, 38.6, 55.6, 25, '#3ddc4b'] }[
        kind === 'esp32' && /V1/.test(p.kind) ? 'esp32v1' : kind === 'pico' && / W$/.test(p.kind) ? '' : kind];
      if (p.isMcu && led) {
        const [w0, h0, x, y, pinKey, color] = led;
        const g = ov(p, w0, h0);
        const L = svg('rect', { x, y, width: 8, height: 5, fill: color, opacity: 0, filter: 'url(#sim-blur)' }, g);
        const on = kind === 'uno' ? svg('rect', { x: 361, y: 228.3, width: 8, height: 5, fill: '#3ddc4b', opacity: 0, filter: 'url(#sim-blur)' }, g) : null;
        const d = duty();
        p.update = (now) => { const pin = mcu.pins.get(pinKey); d.set(!!pin && pin.st === 1, now); };
        p.frame = (now, span) => {
          const pin = mcu.pins.get(pinKey);
          L.setAttribute('opacity', glow(d.take(now, span) * (pin ? dutyOf(pin.node) : 1)));
          if (on) on.setAttribute('opacity', 1);
        };
        p.reset = () => d.reset();
        p.idle = () => { L.setAttribute('opacity', 0); if (on) on.setAttribute('opacity', 0); };
      }
    };
  }

  // MPU6050 (acelerómetro + giroscopio, I2C 0x68 / 0x69 con AD0)
  function mpuPart(p) {
    Object.assign(p, { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0, temp: 25 });
    const regs = new Uint8Array(128);
    let ptr = 0, first = false;
    const reset = () => { regs.fill(0); regs[0x6b] = 0x40; regs[0x75] = 0x68; };
    reset();
    const put16 = (a, v) => {
      v = Math.max(-32768, Math.min(32767, Math.round(v)));
      regs[a] = (v >> 8) & 255; regs[a + 1] = v & 255;
    };
    function fill() {
      const ar = 16384 / (1 << ((regs[0x1c] >> 3) & 3)), gr = 131 / (1 << ((regs[0x1b] >> 3) & 3));
      put16(0x3b, p.ax * ar); put16(0x3d, p.ay * ar); put16(0x3f, p.az * ar);
      put16(0x41, (p.temp - 36.53) * 340);
      put16(0x43, p.gx * gr); put16(0x45, p.gy * gr); put16(0x47, p.gz * gr);
    }
    i2c.push({
      part: p,
      match: (a) => a === (p.hi('AD0') ? 0x69 : 0x68),
      start(write) { first = write; if (!write) fill(); },
      write(b) {
        if (first) { ptr = b & 127; first = false; return; }
        if (ptr === 0x6b && (b & 0x80)) reset(); else regs[ptr] = b;
        ptr = (ptr + 1) & 127;
      },
      read() { const v = regs[ptr]; ptr = (ptr + 1) & 127; return v; },
    });
    p.ctl = () => {
      const box = ctlBox(p, 'acelerómetro');
      ['x', 'y', 'z'].forEach((k) => slider(box, 'Acel. ' + k.toUpperCase(), -2, 2, 0.01, p['a' + k], (v) => v.toFixed(2) + ' g', (v) => { p['a' + k] = v; }));
      ['x', 'y', 'z'].forEach((k) => slider(box, 'Giro ' + k.toUpperCase(), -250, 250, 1, 0, (v) => v + ' °/s', (v) => { p['g' + k] = v; }));
      slider(box, 'Temp.', -40, 85, 0.5, p.temp, (v) => v.toFixed(1) + ' °C', (v) => { p.temp = v; });
    };
    p.reset = () => { reset(); ptr = 0; };
  }

  // BMP280 (presión y temperatura, I2C 0x76 / 0x77 según SDO)
  /* Se usan los coeficientes de calibración del ejemplo del datasheet y se buscan las lecturas
     "crudas" que, compensadas con las fórmulas de Bosch, dan la temperatura y presión elegidas. */
  const BMP_CAL = [27504, 26435, -1000, 36477, -10685, 3024, 2855, 140, -7, 15500, -14600, 6000];
  function bmpCompT(adc) {
    const [T1, T2, T3] = BMP_CAL;
    const v1 = (adc / 16384 - T1 / 1024) * T2, v2 = (adc / 131072 - T1 / 8192) ** 2 * T3;
    return v1 + v2;      // t_fine
  }
  function bmpCompP(adc, tf) {
    const [, , , P1, P2, P3, P4, P5, P6, P7, P8, P9] = BMP_CAL;
    let v1 = tf / 2 - 64000, v2 = v1 * v1 * P6 / 32768;
    v2 = v2 + v1 * P5 * 2; v2 = v2 / 4 + P4 * 65536;
    v1 = (P3 * v1 * v1 / 524288 + P2 * v1) / 524288; v1 = (1 + v1 / 32768) * P1;
    let pr = 1048576 - adc; pr = (pr - v2 / 4096) * 6250 / v1;
    v1 = P9 * pr * pr / 2147483648; v2 = pr * P8 / 32768;
    return pr + (v1 + v2 + P7) / 16;
  }
  function bisect(f, target, rising) {
    let lo = 0, hi = (1 << 20) - 1;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) >> 1; if ((f(m) < target) === rising) lo = m; else hi = m; }
    return lo;
  }
  function bmpPart(p) {
    p.temp = 22; p.hpa = 1013.25;
    const regs = new Uint8Array(256);
    let ptr = 0, first = false;
    const reset = () => {
      regs.fill(0); regs[0xd0] = 0x58;
      BMP_CAL.forEach((v, i) => { regs[0x88 + i * 2] = v & 255; regs[0x89 + i * 2] = (v >> 8) & 255; });
    };
    reset();
    function fill() {
      const aT = bisect((a) => bmpCompT(a) / 5120, p.temp, true), tf = bmpCompT(aT);
      const aP = bisect((a) => bmpCompP(a, tf), p.hpa * 100, false);
      [[0xf7, aP], [0xfa, aT]].forEach(([r, v]) => { regs[r] = (v >> 12) & 255; regs[r + 1] = (v >> 4) & 255; regs[r + 2] = (v & 15) << 4; });
      regs[0xf3] = 0;
    }
    i2c.push({
      part: p,
      match: (a) => { const sdo = p.v('SDO'); return sdo === sdo ? a === (sdo > 1.5 ? 0x77 : 0x76) : a === 0x76 || a === 0x77; },
      start(write) { first = write; if (!write) fill(); },
      write(b) {
        if (first) { ptr = b; first = false; return; }
        if (ptr === 0xe0 && b === 0xb6) reset(); else regs[ptr] = b;
        ptr = (ptr + 1) & 255;
      },
      read() { const v = regs[ptr]; ptr = (ptr + 1) & 255; return v; },
    });
    p.ctl = () => {
      const box = ctlBox(p, 'sensor');
      slider(box, 'Temp.', -40, 85, 0.1, p.temp, (v) => v.toFixed(1) + ' °C', (v) => { p.temp = v; });
      slider(box, 'Presión', 300, 1100, 0.25, p.hpa, (v) => v.toFixed(1) + ' hPa', (v) => { p.hpa = v; });
    };
    p.reset = () => { reset(); ptr = 0; };
  }

  // DS18B20 (1-Wire)
  function crc8(bytes) {
    let c = 0;
    for (let b of bytes) for (let i = 0; i < 8; i++) { const mix = (c ^ b) & 1; c >>= 1; if (mix) c ^= 0x8c; b >>= 1; }
    return c;
  }
  /* Esclavo 1-Wire por tiempos: pulso de reset → presencia; los bits se leen por la duración del nivel
     bajo que pone el micro y, para responder un 0, se mantiene la línea abajo 30 µs. Incluye
     SEARCH ROM, que usa DallasTemperature para encontrar los sensores. */
  function ds18Part(p) {
    p.temp = 22;
    const serial = [0x28, 0xaa, 0x13, 0x35, 0x57, 0x79, 0x02];
    const rom = serial.concat([crc8(serial)]);
    let hold = false, released = false, lvl = true, fallAt = 0, readSlot = false;
    let mode = 'idle', rxBits = 0, rxByte = 0, rxBuf = [], rxNeed = 0, rxThen = null;
    let txBits = [], txThen = 'idle', sIdx = 0, sPhase = 0;
    const sp = [0, 0, 0x4b, 0x46, 0x7f, 0xff, 0x0c, 0x10, 0];
    const romBit = (i) => (rom[i >> 3] >> (i & 7)) & 1;
    const sendBytes = (bytes, then) => {
      txBits = [];
      bytes.forEach((b) => { for (let i = 0; i < 8; i++) txBits.push((b >> i) & 1); });
      mode = 'tx'; txThen = then;
    };
    const receive = (n, then) => { mode = 'rx'; rxNeed = n; rxBuf = []; rxThen = then; };
    const pull = (delay, len) => sim.eng.after(delay, () => {
      hold = true; evaluate();
      sim.eng.after(len, () => { hold = false; released = true; evaluate(); });
    });
    function convert() {
      const raw = Math.round(clamp(p.temp, -55, 125) * 16) & 0xffff;
      sp[0] = raw & 255; sp[1] = raw >> 8; sp[8] = crc8(sp.slice(0, 8));
    }
    function gotByte(b) {
      if (mode === 'rom') {
        if (b === 0x33) sendBytes(rom, 'fn');
        else if (b === 0x55) receive(8, (bytes) => { mode = bytes.every((x, i) => x === rom[i]) ? 'fn' : 'idle'; });
        else if (b === 0xcc) mode = 'fn';
        else if (b === 0xf0) { mode = 'search'; sIdx = 0; sPhase = 0; }
        else mode = 'idle';
      } else if (mode === 'fn') {
        if (b === 0x44) { convert(); mode = 'idle'; }
        else if (b === 0xbe) sendBytes(sp, 'idle');
        else if (b === 0x4e) receive(3, (bytes) => { sp[2] = bytes[0]; sp[3] = bytes[1]; sp[4] = bytes[2] | 0x1f; sp[8] = crc8(sp.slice(0, 8)); mode = 'idle'; });
        else mode = 'idle';           // B4 (alimentación externa: se lee 1), 48, B8…
      } else if (mode === 'rx') {
        rxBuf.push(b);
        if (rxBuf.length === rxNeed) rxThen(rxBuf);
      }
    }
    p.drive = () => {
      if (!p.powered('VCC', 'GND')) return;
      weak(p.n('DQ'), p.v('VCC'), 1 / 4700);          // la resistencia de 4,7 kΩ que lleva siempre
      if (hold) fix(p.n('DQ'), 0);
    };
    p.update = (now) => {
      const h = p.v('DQ') > 1.5;
      if (h === lvl) return;
      lvl = h;
      if (!h) {          // el micro empieza una ranura
        fallAt = now;
        if (hold) return;
        let bit = -1;
        if (mode === 'tx') { bit = txBits.shift(); if (!txBits.length) mode = txThen; }
        else if (mode === 'search' && sPhase < 2) { bit = sPhase === 0 ? romBit(sIdx) : 1 - romBit(sIdx); sPhase++; }
        readSlot = bit !== -1;          // esta ranura es de lectura: su subida no es un bit escrito
        if (bit === 0) {          // responder un 0: mantener la línea abajo
          hold = true; sim.again = true;
          sim.eng.after(30, () => { hold = false; released = true; evaluate(); });
        }
        return;
      }
      if (released) { released = false; readSlot = false; return; }      // subida provocada por nosotros
      const d = now - fallAt;
      if (d >= 400) {          // reset: responder con el pulso de presencia
        if (!p.powered('VCC', 'GND')) return;
        mode = 'rom'; rxBits = 0; rxByte = 0;
        pull(30, 120);
        return;
      }
      if (readSlot) { readSlot = false; return; }
      const bit = d < 15 ? 1 : 0;
      if (mode === 'search') {      // el micro escribe la dirección elegida
        if (bit !== romBit(sIdx)) mode = 'idle';
        else if (++sIdx === 64) mode = 'fn';
        else sPhase = 0;
        return;
      }
      if (mode === 'idle') return;
      rxByte |= bit << rxBits;
      if (++rxBits === 8) { const b = rxByte; rxBits = 0; rxByte = 0; gotByte(b); }
    };
    p.ctl = () => slider(ctlBox(p, 'sensor'), 'Temp.', -55, 125, 0.5, p.temp, (v) => v.toFixed(1) + ' °C', (v) => { p.temp = v; });
    p.reset = () => { hold = false; released = false; readSlot = false; lvl = true; mode = 'idle'; txBits = []; convert(); };
    convert();
  }

  // HX711 (celda de carga)
  function hx711Part(p) {
    p.grams = 0;
    let idx = -1, val = 0, lsck = false, dout = false, wait = false;
    p.drive = () => { if (p.powered('VCC', 'GND')) fix(p.n('DT'), dout ? p.v('VCC') : 0); };
    p.update = () => {
      const sck = p.hi('SCK');
      if (sck === lsck) return;
      lsck = sck;
      if (!sck || wait) return;
      if (idx < 0) { val = Math.round(p.grams * 420) & 0xffffff; idx = 0; }     // ~420 cuentas por gramo (celda de 5 kg)
      dout = idx < 24 ? !!((val >> (23 - idx)) & 1) : true;
      idx++;
      sim.again = true;
      if (idx === 24) {          // tras los pulsos de ganancia vuelve a estar listo (DT a 0)
        wait = false;
        sim.eng.after(1000, () => { idx = -1; dout = false; evaluate(); });
      }
    };
    p.ctl = () => slider(ctlBox(p, 'balanza'), 'Peso', -1000, 5000, 1, 0, (v) => v + ' g', (v) => { p.grams = v; });
    p.reset = () => { idx = -1; dout = false; lsck = false; wait = false; };
  }

  // Receptor IR VS1838 + mando (protocolo NEC)
  const IR_KEYS = [['POWER', 0x45], ['VOL+', 0x46], ['FUNC', 0x47], ['ANT', 0x44], ['PLAY', 0x40], ['SIG', 0x43], ['▼', 0x07], ['VOL−', 0x15], ['▲', 0x09],
    ['0', 0x16], ['EQ', 0x19], ['ST', 0x0d], ['1', 0x0c], ['2', 0x18], ['3', 0x5e], ['4', 0x08], ['5', 0x1c], ['6', 0x5a], ['7', 0x42], ['8', 0x52], ['9', 0x4a]];
  function irPart(p) {
    let low = false, busy = false;
    p.drive = () => { if (p.powered('VCC', 'GND')) fix(p.n('OUT'), low ? 0 : p.v('VCC')); };
    p.send = (cmd) => {
      if (busy || !sim.eng || sim.eng.remote) return;
      busy = true;
      const seq = [[9000, true], [4500, false]];
      [0x00, 0xff, cmd, cmd ^ 0xff].forEach((b) => { for (let i = 0; i < 8; i++) seq.push([562, true], [(b >> i) & 1 ? 1687 : 562, false]); });
      seq.push([562, true], [0, false]);
      let i = 0;
      const step = () => {
        low = seq[i][0] > 0 && seq[i][1]; evaluate();
        const d = seq[i][0];
        if (++i < seq.length && d) sim.eng.after(d, step); else { low = false; busy = false; evaluate(); }
      };
      step();
      tag(p, 'IR 0x' + cmd.toString(16).toUpperCase().padStart(2, '0'), '#b45309');
      setTimeout(() => tag(p, ''), 700);
    };
    p.ctl = () => {
      const box = ctlBox(p, 'mando IR (NEC)');
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:6px';
      IR_KEYS.forEach(([t, c]) => {
        const b = document.createElement('button');
        b.className = 'btn btn-sm'; b.textContent = t; b.title = 'Código 0x' + c.toString(16).toUpperCase();
        b.onclick = () => p.send(c);
        grid.appendChild(b);
      });
      box.appendChild(grid);
    };
    p.reset = () => { low = false; busy = false; };
  }

  // Pantalla TFT ILI9341 (SPI)
  function tftPart(p) {
    const g = ov(p, 200, 150);
    const img = svg('image', { x: 22, y: 20, width: 140, height: 104, preserveAspectRatio: 'none' }, g);
    const cv = document.createElement('canvas');
    cv.width = 320; cv.height = 240;
    const ctx = cv.getContext('2d'), im = ctx.createImageData(320, 240), px = im.data;
    const s = {};
    const reset = () => {
      for (let i = 0; i < px.length; i += 4) { px[i] = px[i + 1] = px[i + 2] = 0; px[i + 3] = 255; }
      Object.assign(s, { cmd: -1, args: [], c0: 0, c1: 239, p0: 0, p1: 319, col: 0, page: 0, mad: 0, on: false, inv: false, hi: -1, dirty: true });
    };
    reset();
    /* (columna, página) de la RAM → píxel del panel según MADCTL (MV, MX, MY) → pantalla apaisada,
       que es como está dibujado el módulo: setRotation(1) se ve derecho. */
    function pixel(v) {
      let x, y;
      if (s.mad & 0x20) { x = s.page; y = s.col; } else { x = s.col; y = s.page; }
      if (s.mad & 0x40) x = 239 - x;
      if (s.mad & 0x80) y = 319 - y;
      if (x >= 0 && x < 240 && y >= 0 && y < 320) {
        const i = (x * 320 + y) * 4;
        px[i] = ((v >> 11) & 31) << 3; px[i + 1] = ((v >> 5) & 63) << 2; px[i + 2] = (v & 31) << 3;
      }
      if (++s.col > s.c1) { s.col = s.c0; if (++s.page > s.p1) s.page = s.p0; }
      s.dirty = true;
    }
    spiDevs.push({
      part: p, mosi: 'MOSI',
      byte(b) {
        if (p.hi('CS')) return;
        if (!p.hi('DC')) {          // orden
          s.cmd = b; s.args = []; s.hi = -1;
          if (b === 0x01) { s.mad = 0; s.on = false; s.dirty = true; }
          else if (b === 0x29 || b === 0x28) { s.on = b === 0x29; s.dirty = true; }
          else if (b === 0x20 || b === 0x21) { s.inv = b === 0x21; s.dirty = true; }
          else if (b === 0x2c) { s.col = s.c0; s.page = s.p0; }
          return;
        }
        if (s.cmd === 0x2c) {       // datos de píxel, RGB565 en dos bytes
          if (s.hi < 0) s.hi = b; else { pixel((s.hi << 8) | b); s.hi = -1; }
          return;
        }
        s.args.push(b);
        const a = s.args;
        if (s.cmd === 0x2a && a.length === 4) { s.c0 = (a[0] << 8) | a[1]; s.c1 = (a[2] << 8) | a[3]; }
        else if (s.cmd === 0x2b && a.length === 4) { s.p0 = (a[0] << 8) | a[1]; s.p1 = (a[2] << 8) | a[3]; }
        else if (s.cmd === 0x36 && a.length === 1) s.mad = b;
      },
    });
    let last = 0;
    p.frame = () => {
      const now = performance.now();
      if (!s.dirty || now - last < 50) return;      // como mucho 20 veces por segundo
      last = now; s.dirty = false;
      const lit = s.on && !(p.v('LED') < 1);
      if (!lit) { ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, 320, 240); }
      else {
        ctx.putImageData(im, 0, 0);
        if (s.inv) { ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 320, 240); ctx.globalCompositeOperation = 'source-over'; }
      }
      img.setAttribute('href', cv.toDataURL());
    };
    p.reset = () => { reset(); last = 0; p.frame(); };
    p.idle = () => { s.on = false; s.dirty = true; last = 0; p.frame(); };
  }

  /* Catálogo: nombre de la pieza en la biblioteca → comportamiento. */
  const SPECS = [
    [/^Arduino Uno R3$/, boardPart('uno')],
    [/^Arduino Nano$/, boardPart('nano')],
    [/^Arduino Mega 2560$/, boardPart('mega')],
    [/^Raspberry Pi Pico( W)?$/, boardPart('pico')],
    [/^ESP32 DevKit(C V4| V1 DOIT)/, boardPart('esp32')],
    [/^ESP32-C3-DevKitM-1/, boardPart('esp32c3')],
    [/^Orange Pi /, boardPart('opi')],
    [/^Raspberry Pi (4|5|Zero 2)/, boardPart('rpi')],
    [/^LED (rojo|verde|azul|amarillo|blanco) 5 mm$/i, (p, m) => ledPart(LED_COLORS[m[1].toLowerCase()])(p)],
    [/^LED RGB/, rgbPart],
    [/^Display 7 segmentos/, seg7Part],
    [/^Pulsador 12 mm$/, switchPart({ hold: true, fixed: [['1.l', '1.r'], ['2.l', '2.r']], on: [['1.l', '2.l']] })],
    [/^Pulsador táctil 6 mm$/, switchPart({ hold: true, fixed: [['1', '3'], ['2', '4']], on: [['1', '2']] })],
    [/^Pulsador \(NA\)$/, switchPart({ hold: true, on: [['3', '4']] })],
    [/^Paro de emergencia \(NC\)$/, switchPart({ def: true, on: [['1', '2']], onText: 'Rearmado', offText: 'PARO' })],
    [/^Paro de emergencia ZB2/, switchPart({ def: true, on: [['LÍNEA', 'REGRESO']], onText: 'Rearmado', offText: 'PARO' })],
    [/^Final de carrera/, switchPart({ hold: true, on: [['COM', 'NO']], off: [['COM', 'NC']] })],
    [/^Interruptor deslizante$/, switchPart({ on: [['2', '3']], off: [['1', '2']], onText: '2–3', offText: '1–2' })],
    [/^Interruptor de palanca SPDT$/, switchPart({ on: [['COM', '2']], off: [['COM', '1']], onText: 'COM–2', offText: 'COM–1' })],
    [/^Interruptor basculante/, switchPart({ on: [['1', '2']] })],
    [/^Magnetotérmico 1P$/, switchPart({ def: true, on: [['1', '2']] })],
    [/^Interruptor diferencial 2P$/, switchPart({ def: true, on: [['L', "L'"], ['N', "N'"]] })],
    [/^Interruptor DIP de 8$/, dipPart],
    [/^Teclado matricial 4×4$/, keypadPart],
    [/^Encoder rotativo KY-040$/, encoderPart],
    [/^Resistencia/, (p) => { p.res = [{ a: p.n('1'), b: p.n('2'), ohm: parseOhms(p.label) || parseOhms(p.kind) || 1000 }]; }],
    [/^(Fusible|Bobina)/, (p) => { p.fixed = [['1', '2']]; }],
    [/^Potenciómetro 10 kΩ$/, potPart([['VCC', 'SIG', 'GND']], 10000)],
    [/^Potenciómetro trimmer$/, potPart([['1', 'W', '3']], 10000)],
    [/^Joystick analógico$/, (p) => {
      potPart([['+5V', 'VRX', 'GND'], ['+5V', 'VRY', 'GND']], 10000, ['Eje X', 'Eje Y'])(p);
      const potCtl = p.ctl;
      p.sw = false;
      p.links = (par) => { if (p.sw) union(par, p.n('SW'), p.n('GND')); };
      p.ctl = () => { potCtl(); holdBtn($('controls').lastChild, 'Pulsar (SW)', (v) => { p.sw = v; topoChanged(); }); };
      const g = ov(p, 110, 120);
      const knob = svg('circle', { cx: 55, cy: 50, r: 13, fill: '#3b6182', opacity: 0.55 }, g);
      p.knob = () => { knob.setAttribute('cx', 55 + (p.pos[0] - 0.5) * 36); knob.setAttribute('cy', 50 + (0.5 - p.pos[1]) * 36); };
    }],
    [/^Fotorresistencia LDR$/, varResPart('1', '2', 'Luz', -1, 5, 0.05, 2, (x) => luxOf(x) + ' lx', (x) => ldrOhm(luxOf(x)))],
    [/^Termistor NTC/, varResPart('1', '2', 'Temp.', -40, 125, 1, 25, (v) => v + ' °C', ntcOhm)],
    [/^Batería 9 V$/, batteryPart('+', '−', 9)],
    [/^Batería 18650$/, batteryPart('+', '−', 3.7)],
    [/^Pila de botón/, batteryPart('+', '−', 3)],
    [/^Portapilas 2×AA/, batteryPart('+ (rojo)', '− (negro)', 3)],
    [/^Panel solar/, batteryPart('+', '−', 6)],
    [/^Fuente 24 V DC/, batteryPart('+V', '−V', 24)],
    [/^Regulador (7805|78L05)/, regulatorPart('IN', 'GND', 'OUT', 5)],
    [/^Regulador 7812/, regulatorPart('IN', 'GND', 'OUT', 12)],
    [/^Regulador AMS1117/, regulatorPart('IN', 'GND/ADJ', 'OUT', 3.3)],
    [/^Convertidor reductor LM2596/, regulatorPart('IN+', 'IN−', 'OUT+', 5)],
    [/^Sensor de luz \(LDR\)$/, sourcePart({ label: 'Luz', min: -1, max: 5, step: 0.05, val: 2, fmt: (x) => luxOf(x) + ' lx',
      out: (x, vcc) => { const r = ldrOhm(luxOf(x)), ao = vcc * r / (r + 10000); return [['AO', ao], ['DO', ao > vcc / 2 ? vcc : 0]]; } })],
    [/^Sensor de humedad del suelo$/, sourcePart({ label: 'Humedad', min: 0, max: 100, step: 1, val: 30, fmt: (v) => v + ' %',
      out: (v, vcc) => [['AO', vcc * (0.98 - v / 100 * 0.68)]] })],
    [/^Sensor de gas MQ-2$/, sourcePart({ label: 'Gas', min: 0, max: 100, step: 1, val: 5, fmt: (v) => v + ' %',
      out: (v, vcc) => [['AO', vcc * (0.08 + v / 100 * 0.84)], ['DO', v > 50 ? 0 : vcc]] })],
    [/^Sensor de temperatura LM35$/, sourcePart({ vcc: '+VS', label: 'Temp.', min: 0, max: 150, step: 0.5, val: 24, fmt: (v) => v.toFixed(1) + ' °C',
      out: (v) => [['OUT', v / 100]] })],
    [/^Sensor de corriente ACS712$/, sourcePart({ label: 'Corriente', min: -5, max: 5, step: 0.05, val: 0, fmt: (v) => v.toFixed(2) + ' A',
      out: (v, vcc) => [['OUT', vcc / 2 + 0.185 * v]] })],
    [/^Sensor de movimiento PIR/, sourcePart({ check: 'Movimiento detectado', val: false,
      out: (v) => [['OUT', v ? 3.3 : 0]], draw: (p) => tag(p, p.val ? 'MOVIMIENTO' : '', '#b45309') })],
    [/^Servo SG90$/, servoPart],
    [/^Buzzer$/, buzzerPart],
    [/^Motor DC$/, loadPart('+', '−', 'motor')],
    [/^Mini bomba de agua/, loadPart('+', '−', 'motor')],
    [/^Solenoide/, loadPart('+', '−', 'on')],
    [/^Lámpara piloto$/, loadPart('X1', 'X2', 'on')],
    [/^Toma de corriente$/, mainsPart],
    [/^Foco 230 V/, acLoadPart('lamp')],
    [/^Ventilador 230 V$/, acLoadPart('fan')],
    [/^Módulo dimmer AC/, dimmerPart],
    [/^Interruptor de luz \(pared\)$/, switchPart({ on: [['L', 'L1']], onText: 'Encendido', offText: 'Apagado' })],
    [/^Módulo relé 1 canal 5 V$/, relayPart([{ coil: moduleCoil('IN'), com: 'COM', no: 'NO', nc: 'NC' }], { w: 120, h: 92, at: [[24, 66]] })],
    [/^Módulo relé 4 canales 5 V$/, relayPart([1, 2, 3, 4].map((i) => ({ coil: moduleCoil('IN' + i), com: 'COM' + i, no: 'NO' + i, nc: 'NC' + i })),
      { w: 220, h: 120, at: [0, 1, 2, 3].map((i) => [50 + i * 48, 98]) })],
    [/^Módulo de 2 relés$/, relayPart([1, 2].map((i) => ({ coil: moduleCoil('IN' + i, 'DC+', 'DC−'), com: 'COM' + i, no: 'NO' + i })))],
    [/^Relé DPDT/, relayPart([1, 2].map((i) => ({ coil: coil('COIL1', 'COIL2'), com: 'COM' + i, no: 'NO' + i, nc: 'NC' + i })))],
    [/^Relé 24 V/, relayPart([{ coil: coil('A1', 'A2'), com: 'COM', no: 'NO', nc: 'NC' }])],
    [/^Contactor/, relayPart([['1L1', '2T1'], ['3L2', '4T2'], ['5L3', '6T3'], ['13', '14']].map(([a, b]) => ({ coil: coil('A1', 'A2'), com: a, no: b })))],
    [/^Transistor (NPN|Darlington)/, (p, m) => switchByVoltage('C', 'E', (q) => q.v('B') - q.v('E') > (m[1] === 'NPN' ? 0.6 : 1.2))(p)],
    [/^Transistor PNP/, switchByVoltage('C', 'E', (q) => q.v('E') - q.v('B') > 0.6)],
    [/^MOSFET/, switchByVoltage('D', 'S', (q) => q.v('G') - q.v('S') > 3)],
    [/^Optoacoplador PC817$/, switchByVoltage('C', 'E', (q) => q.v('A') - q.v('K') > 1)],
    [/^Array Darlington ULN2003$/, (p) => {
      p.st = new Array(8).fill(false);
      p.links = (par) => p.st.forEach((on, i) => { if (on) union(par, p.n('OUT' + i), p.n('GND')); });
      p.update = () => { for (let i = 1; i <= 7; i++) { const on = p.hi('IN' + i); if (on !== p.st[i]) { p.st[i] = on; sim.topo = true; } } };
      p.reset = () => p.st.fill(false);
    }],
    [/^Registro de desplazamiento 74HC595$/, hc595Part],
    [/^Puertas NAND 74HC00$/, logicPart((p) => {
      const o = {};
      for (let i = 1; i <= 4; i++) o[i + 'Y'] = !(p.hi(i + 'A') && p.hi(i + 'B'));
      return o;
    }, ['1Y', '2Y', '3Y', '4Y'], 'VCC', 'GND')],
    [/^Contador CD4017$/, logicPart(cd4017, ['Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9', 'CO'], 'VDD', 'VSS')],
    [/^Amplificador operacional LM358$/, logicPart((p) => ({ 'OUT A': p.v('IN+ A') > p.v('IN− A'), 'OUT B': p.v('IN+ B') > p.v('IN− B') }), ['OUT A', 'OUT B'], 'VCC', 'GND')],
    [/^Driver de motores L298N$/, hbridge([['ENA', 'IN1', 'OUT1'], ['ENA', 'IN2', 'OUT2'], ['ENB', 'IN3', 'OUT3'], ['ENB', 'IN4', 'OUT4']], '+12V')],
    [/^Driver de motores L293D$/, hbridge([['EN1,2', '1A', '1Y'], ['EN1,2', '2A', '2Y'], ['EN3,4', '3A', '3Y'], ['EN3,4', '4A', '4Y']], 'VCC2')],
    [/^Driver de motor paso a paso A4988$/, a4988Part],
    [/^Motor paso a paso bipolar$/, stepperPart],
    [/^Anillo NeoPixel/, neoPart(16, Array.from({ length: 16 }, (_, i) => [70 + 54 * Math.cos(i * Math.PI / 8), 70 + 54 * Math.sin(i * Math.PI / 8)]), 'VCC')],
    [/^Tira NeoPixel/, neoPart(8, Array.from({ length: 8 }, (_, i) => [46 + i * 25, 22]), '5V')],
    [/^LCD 16×2 I2C$/, lcdPart(16, 2, { w: 260, h: 110, x0: 26, y0: 31, dx: 11.8, dy: 21, cw: 10, ch: 17, bx: 22, by: 26, bw: 194, bh: 48 })],
    [/^LCD 20×4 I2C$/, lcdPart(20, 4, { w: 320, h: 130, x0: 26, y0: 30, dx: 12.4, dy: 17.5, cw: 10.5, ch: 15, bx: 22, by: 26, bw: 254, bh: 74 })],
    [/^Pantalla OLED SSD1306 I2C$/, oledPart],
    [/^Reloj RTC DS(1307|3231)$/, rtcPart],
    [/^Sensor DHT22/, dhtPart],
    [/^Sensor ultrasónico HC-SR04$/, sonarPart],
    [/^Display 4 dígitos TM1637$/, tm1637Part],
    [/^Matriz LED 8×8 MAX7219$/, max7219Part],
    [/^Acelerómetro\/giroscopio MPU6050$/, mpuPart],
    [/^Sensor de presión BMP280$/, bmpPart],
    [/^Sensor de temperatura DS18B20$/, ds18Part],
    [/^Amplificador de celda de carga HX711$/, hx711Part],
    [/^Receptor infrarrojo VS1838$/, irPart],
    [/^Pantalla TFT ILI9341 SPI$/, tftPart],
    [/^Barra de tierra$|^Bornera|^Borna de tornillo|^Tira de pines|^Condensador|^Cristal|^Diodo|^Puente rectificador|^Supresor/, () => { /* pasivo: solo une lo que ya une */ }],
  ];

  /* Piezas que se reconocen pero aún no se emulan por dentro. */
  const NOT_YET = /^(Arduino UNO Q|ESP32-S3|Raspberry Pi [45]|Raspberry Pi Zero|Orange Pi|Lector|Radio nRF24|Módulo Bluetooth|Transceptor RS-485|Temporizador NE555|Microcontrolador|Conversor RS-232)/;

  function buildParts() {
    parts = []; partByEl = new Map(); i2c.length = 0; spiDevs.length = 0;
    net.nodeIdx = new Map(); net.nNodes = 0;
    mcu.board = null; mcu.kind = null; mcu.pins = new Map();
    overlay.innerHTML = '';
    const defs = svg('defs', {}, overlay);
    const f = svg('filter', { id: 'sim-blur', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
    svg('feGaussianBlur', { stdDeviation: 3 }, f);
    const unknown = new Set(), later = new Set();
    graph.getElements().forEach((el) => {
      if (el instanceof Junction) { nodeOf(el.id, 'c'); return; }
      if (!(el instanceof Component)) return;
      const name = String(el.get('componentName') || '').trim();
      const spec = SPECS.find(([re]) => re.test(name));
      if (!spec) {
        (el.get('terminals') || []).forEach((t) => nodeOf(el.id, t.id));
        if ((el.get('terminals') || []).length && name) (NOT_YET.test(name) ? later : unknown).add(name);
        return;
      }
      const p = newPart(el, name);
      spec[1](p, name.match(spec[0]));
      parts.push(p); partByEl.set(el.id, p);
      if (p.press || p.click) { const v = paper.findViewByModel(el); if (v) v.el.classList.add('sim-press'); }
    });
    parts.sort((a, b) => a.order - b.order);
    linkParts = parts.filter((p) => p.links);
    drvParts = parts.filter((p) => p.drive);
    resParts = parts.filter((p) => p.res);
    updParts = parts.filter((p) => p.update);
    frmParts = parts.filter((p) => p.frame);
    mcu.list = [...mcu.pins.values()].filter((p) => p.node >= 0);
    buildBase();
    rebuild();

    closePopup();
    scope.sel = null;
    $('controls').innerHTML = '';
    const sound = document.createElement('div');
    sound.className = 'ctl';
    sound.innerHTML = '<label style="margin:0"><input type="checkbox" checked><span>Sonido del zumbador</span></label>';
    sound.querySelector('input').onchange = (e) => { audio.enabled = e.target.checked; };
    $('controls').appendChild(sound);
    parts.forEach((p) => p.ctl && p.ctl());
    parts.forEach((p) => { if (p.ctlEl && !(p.press || p.click)) { const v = paper.findViewByModel(p.el); if (v) v.el.classList.add('sim-press'); } });
    if ($('controls').children.length === 1) {
      $('controls').insertAdjacentHTML('beforeend', '<p class="help">Este diagrama no tiene potenciómetros, sensores ni interruptores que ajustar.</p>');
    }

    const msgs = [];
    if (!mcu.board) msgs.push('No hay ninguna placa simulable en el plano (<b>Arduino Uno, Nano, Mega, Raspberry Pi Pico o ESP32 DevKit</b>): el programa se ejecuta y verás el monitor serie, pero no mueve ninguna pieza.');
    if (mcu.kind === 'esp32c3' && i2c.length) msgs.push('El emulador del <b>ESP32-C3</b> se cuelga al usar el I2C (<code>Wire</code>): las pantallas y sensores I2C solo funcionan con el ESP32, la Pico o los Arduino.');
    if (later.size) msgs.push('Sin emular todavía: ' + [...later].map(esc).join(', ') + '.');
    if (unknown.size) msgs.push('Sin simulación (se dibujan pero no actúan): ' + [...unknown].slice(0, 12).map(esc).join(', ') + (unknown.size > 12 ? '…' : '') + '.');
    hint(msgs);
    if (mcu.board && mcu.board.boardKind) return mcu.board.boardKind;
    return null;
  }

  function hint(msgs) {
    $('sim-hint').innerHTML = msgs.length ? '<ul>' + msgs.map((m) => '<li>' + m + '</li>').join('') + '</ul>' : '';
  }
  $('sim-hint').onclick = () => { $('sim-hint').innerHTML = ''; };

  // Ejecución

  /* Bus I2C común a todas las placas: responde la pieza alimentada, conectada a los pines I2C
     del micro y con esa dirección (una dirección exacta gana a un rango). */
  function onBus(p) {
    if (!p.powered() || p.net('SDA') < 0) return false;
    const pins = sim.eng && sim.eng.i2cPins;
    if (pins) {
      const a = mcu.pins.get(pins[0]), b = mcu.pins.get(pins[1]);
      return !!a && !!b && p.net('SDA') === netId(a.node) && p.net('SCL') === netId(b.node);
    }
    return mcu.nets.has(p.net('SDA')) && mcu.nets.has(p.net('SCL'));      // Pico/ESP32: I2C en cualquier pin
  }
  const bus = {
    dev: null,
    connect(addr, write) {
      if (bus.dev && bus.dev.stop) bus.dev.stop();
      const ok = (d) => d.match(addr) && onBus(d.part);
      bus.dev = i2c.find((d) => !d.loose && ok(d)) || i2c.find(ok) || null;
      if (bus.dev && bus.dev.start) bus.dev.start(write);
      return !!bus.dev;
    },
    write(v) { return !!bus.dev && bus.dev.write(v) !== false; },
    read() { return bus.dev && bus.dev.read ? bus.dev.read() : 0xff; },
    stop() { if (bus.dev && bus.dev.stop) bus.dev.stop(); bus.dev = null; },
  };
  function i2cAddrs() {
    const list = [];
    for (let a = 1; a < 128; a++) if (i2c.some((d) => d.match(a) && onBus(d.part))) list.push(a);
    return list;
  }

  /* Pines del conector para las librerías de Python: nombre, número wPi (wiringOP / wiringPi),
     número GPIO de la Raspberry (BCM) y número SUNXI de la Orange Pi (PB0 = 32…). */
  const RPI_WPI = [-1, -1, -1, 8, -1, 9, -1, 7, 15, -1, 16, 0, 1, 2, -1, 3, 4, -1, 5, 12, -1, 13, 6, 14, 10, -1, 11, 30, 31, 21, -1, 22, 26, 23, -1, 24, 27, 25, 28, -1, 29];
  const OPI_KEYS = [[/Zero 3W/, 'ZERO_3_W'], [/Zero 2W/, 'ZERO_2_W'], [/Zero 3\b/, 'ZERO_2'], [/ 3B/, '3B'], [/ 5 Pro/, '5PRO'],
    [/ 5 Plus/, '5PLUS'], [/ 5 Max/, '5MAX'], [/ 5 /, '5'], [/4 LTS/, '4_LTS'], [/PC|One/, 'H3']];
  const BCM_OF_PHYS = { 3: 2, 5: 3, 7: 4, 8: 14, 10: 15, 11: 17, 12: 18, 13: 27, 15: 22, 16: 23, 18: 24, 19: 10, 21: 9, 22: 25, 23: 11, 24: 8,
    26: 7, 27: 0, 28: 1, 29: 5, 31: 6, 32: 12, 33: 13, 35: 19, 36: 16, 37: 26, 38: 20, 40: 21 };
  function pyConfig() {
    const b = mcu.board, kind = mcu.kind;
    const model = String((b && b.el.get('componentName')) || (kind === 'rpi' ? 'Raspberry Pi' : 'Orange Pi')).replace(/ \(GPIO.*\)$/, '');
    const wpiTable = kind === 'rpi' ? RPI_WPI : ((window.OPI_WPI || {})[(OPI_KEYS.find(([re]) => re.test(model)) || [null, 'ZERO_2_W'])[1]] || []);
    const pins = {};
    Object.entries((b && b.pinNames) || {}).forEach(([n, name]) => {
      const io = !/^(3\.3V|3V3|5V|GND|NC)$/.test(name);
      const sx = /^P([A-Z])(\d+)$/.exec(name), g = /^GPIO(\d+)/.exec(name);
      pins[n] = {
        name, io,
        wpi: io && wpiTable[+n] != null ? wpiTable[+n] : -1,
        bcm: g ? +g[1] : (BCM_OF_PHYS[n] != null ? BCM_OF_PHYS[n] : -1),
        sunxi: sx ? (sx[1].charCodeAt(0) - 65) * 32 + +sx[2] : -1,
      };
    });
    return { kind, model, pins, i2c: pins[3] && pins[5] ? [3, 5] : null };
  }

  /* Sensores que en Linux se leen con una librería de alto nivel (DHT, HC-SR04): se toma el valor
     de la pieza conectada a ese pin en vez de imitar su protocolo de microsegundos. */
  function sensorAt(kind, key) {
    const pin = mcu.pins.get(key);
    if (!pin || pin.node < 0) return null;
    const k = netId(pin.node);
    if (kind === 'dht') {
      const p = parts.find((q) => q.temp != null && q.hum != null && q.net('SDA') === k);
      return p && p.powered('VCC', 'GND') ? { t: p.temp, h: p.hum } : null;
    }
    if (kind === 'sonar') {
      const p = parts.find((q) => q.dist != null && q.net('TRIG') === k);
      return p && p.powered('VCC', 'GND') ? { d: p.dist } : null;
    }
    return null;
  }

  let serialPending = '';
  const hooks = {
    onPins: () => pinsChanged(),
    onSerial: (t) => { serialPending += t; },
    onError: (msg) => {
      if (serialPending) flushSerial();
      if (/ModuleNotFoundError/.test(msg)) msg += '\nEn el simulador están disponibles: wiringpi, OPi.GPIO, RPi.GPIO, gpiozero, smbus2, smbus, RPLCD.i2c, board, adafruit_dht y la librería estándar de Python.';
      appendOut('\n' + msg + '\n', 'err');
      if (sim.eng && sim.eng.family === 'python') showPane('out');
      stop(); setState('err', 'Detenido');
    },
    onReady: () => { if (sim.eng && sim.eng.family === 'python') setState('run', 'Ejecutando · ' + sim.eng.label); },
    onExit: (r) => {
      const code = /^exit:(.*)/.exec(r || '');
      flushSerial();
      appendOut('\nEl programa terminó' + (code && code[1] !== '0' ? ' (sys.exit(' + code[1] + '))' : '') + '.\n', 'ok');
      stop(); setState('', 'Terminado');
    },
    onStdin: () => { flushSerial(); showPane('serial'); const i = $('serial-in'); if (i) { i.placeholder = 'El programa espera una línea (input()): escríbela y pulsa Enter'; i.focus(); } },
    onStatus: (t) => setState('busy', t),
    sensor: sensorAt,
    i2c: bus,
    spiByte(b) {
      const pin = mcu.pins.get(sim.eng.mosi), mosi = pin ? netId(pin.node) : -1;
      spiDevs.forEach((d) => { if (mosi >= 0 && d.part.net(d.mosi) === mosi) d.byte(b); });
    },
  };

  const ICO_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg><span>Pausa</span>';
  const ICO_RESUME = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg><span>Continuar</span>';

  /* prog: { kind: 'hex'|'bin'|'esp32', data } tal como lo devuelve /api/sim/compile */
  function start(prog) {
    stop(true);
    sim.prog = prog;
    const board = prog.board;
    let eng;
    if (prog.kind === 'hex') eng = window.SimEngines.avr(board, prog.data, hooks);
    else if (prog.kind === 'bin') eng = window.SimEngines.rp2040(Uint8Array.from(atob(prog.data), (c) => c.charCodeAt(0)), hooks);
    else if (prog.kind === 'python') eng = window.SimEngines.python(prog, hooks);
    else eng = window.SimEngines.esp32(prog.session, hooks, board);
    sim.eng = eng;
    mcu.nets = new Set(mcu.list.map((p) => netId(p.node)));
    mcu.all = [...mcu.pins.values()];
    mcu.all.forEach((p) => { p.st = 2; p.inp = null; p.av = -1; });
    scope.data.clear(); scope.frozen = null;
    $('scope-freeze').classList.remove('on'); $('scope-freeze').textContent = 'Congelar';
    parts.forEach((p) => p.reset && p.reset());
    rebuild();
    evaluate();
    if (eng.setI2cAddrs) eng.setI2cAddrs(i2cAddrs());

    audio.init();
    sim.running = true;
    sim.lastTs = performance.now();
    sim.lastFlush = eng.now();
    sim.perf = { real: 0, sim: 0, t: performance.now() };
    setState('run', 'Ejecutando · ' + eng.label);
    sim.paused = false;
    $('btn-pause').innerHTML = ICO_PAUSE; $('btn-pause').disabled = false;
    $('btn-stop').disabled = false; $('btn-reset').disabled = false;
    requestAnimationFrame(loop);
  }

  function loop(ts) {
    if (!sim.running) return;
    const eng = sim.eng;
    let dt = ts - sim.lastTs;
    sim.lastTs = ts;
    if (!(dt > 0) || dt > 100) dt = 16;
    try {
      if (!sim.paused) eng.run(dt);
    } catch (e) {
      stop();
      setState('err', 'Error');
      appendOut('\nLa simulación se detuvo: ' + e.message + '\n', 'err');
      return;
    }
    if (eng.remote) pinsChanged();
    const now = eng.now(), span = now - sim.lastFlush;
    sim.lastFlush = now;
    loudest = 0;
    for (const p of frmParts) p.frame(now, span, dt);
    audio.set(loudest);
    if (serialPending) flushSerial();
    drawScope();
    // rendimiento: tiempo simulado frente al real, cada medio segundo
    const P = sim.perf;
    P.sim += span; P.real += dt;
    if (ts - P.t > 500) {
      P.t = ts;
      $('perf-speed').textContent = eng.speed || (eng.remote ? 'tiempo real (QEMU)' : Math.round(P.sim / 1000 / P.real * 100) + ' %');
      P.sim = 0; P.real = 0;
    }
    $('perf-time').textContent = (now / 1e6).toFixed(1).replace('.', ',') + ' s';
    if (shorted) {
      shorted = false;
      if (!sim.warnedShort) { sim.warnedShort = true; toast('Cortocircuito: hay dos salidas distintas unidas (por ejemplo 5V con GND o un pin en HIGH con GND)', 'err', 6000); }
    }
    requestAnimationFrame(loop);
  }

  function stop(silent) {
    sim.running = false;
    if (sim.eng) {
      try { sim.eng.stop(); } catch (_) { /* ya parado */ }
      parts.forEach((p) => p.idle && p.idle());
    }
    sim.eng = null;
    audio.set(0);
    sim.warnedShort = false;
    sim.paused = false;
    $('btn-pause').innerHTML = ICO_PAUSE; $('btn-pause').disabled = true;
    $('btn-stop').disabled = true; $('btn-reset').disabled = !sim.prog;
    if (!silent) setState('', 'Detenido');
  }

  function setState(cls, text) {
    const s = $('sim-state');
    s.className = 'sim-state ' + cls; s.textContent = text;
  }

  // Monitor serie
  const serialPane = $('pane-serial');
  function flushSerial() {
    const atEnd = serialPane.scrollTop + serialPane.clientHeight >= serialPane.scrollHeight - 30;
    let t = serialPane.textContent + serialPending;
    serialPending = '';
    if (t.length > 80000) t = t.slice(-60000);
    serialPane.textContent = t;
    if (atEnd) serialPane.scrollTop = serialPane.scrollHeight;
  }
  $('serial-in').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const txt = e.target.value + '\n';
    e.target.value = '';
    if (sim.eng) sim.eng.serialWrite([...new TextEncoder().encode(txt)]);
  });

  // Pestañas inferiores
  document.querySelectorAll('.sim-bottom .tab').forEach((b) => {
    b.onclick = () => showPane(b.dataset.pane);
  });
  function showPane(name) {
    document.querySelectorAll('.sim-bottom .tab').forEach((x) => x.classList.toggle('on', x.dataset.pane === name));
    $('pane-serial').classList.toggle('on', name === 'serial');
    $('pane-out').classList.toggle('on', name === 'out');
    $('pane-scope').classList.toggle('on', name === 'scope');
    $('serial-in-row').style.display = name === 'serial' ? '' : 'none';
    if (name === 'scope') { scopeChannels(); drawScope(true); }
  }
  $('btn-clear').onclick = () => {
    if ($('pane-out').classList.contains('on')) $('pane-out').textContent = '';
    else if ($('pane-scope').classList.contains('on')) { scope.data.clear(); drawScope(true); }
    else serialPane.textContent = '';
  };
  function appendOut(text, cls) {
    const s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    $('pane-out').appendChild(s);
    $('pane-out').scrollTop = $('pane-out').scrollHeight;
  }

  // Compilar
  let compiling = false;
  let coresReady = null, qemuReady = {};
  async function compileAndRun() {
    if (compiling) return;
    if (edit.on) setEdit(false);
    compiling = true;
    audio.init();                        // el navegador solo deja sonar tras un clic
    saveCode(false);
    stop(true);
    if (isPy($('board').value)) {
      compiling = false;
      $('pane-out').textContent = '';
      appendOut('Python 3.12 (Pyodide) · programa.py en ' + $('board').selectedOptions[0].textContent + '\n' +
        'Librerías: wiringpi, OPi.GPIO, RPi.GPIO, gpiozero, smbus2, RPLCD.i2c, adafruit_dht. print() sale en el monitor serie.\n', 'ok');
      serialPane.textContent = '';
      showPane('serial');
      if (!mcu.board || !isPy(mcu.kind)) appendOut('El diagrama no tiene una Orange Pi ni una Raspberry Pi: el programa corre, pero sus pines no mueven nada.\n', 'err');
      start({ kind: 'python', board: $('board').value, code: cm.getValue(), cfg: pyConfig() });
      return;
    }
    setState('busy', 'Compilando…');
    $('btn-run').disabled = true;
    $('pane-out').textContent = '';
    appendOut('Compilando para ' + $('board').selectedOptions[0].textContent + '…\n');
    const t0 = performance.now();
    try {
      const board = $('board').value;
      if (qemuReady[board] === false) {
        appendOut('Este servidor no tiene el emulador QEMU del ESP32 (bin/qemu-esp32). En Windows con iniciar.bat sí está; '
          + 'en Docker falta la versión de Linux. Puedes simular Arduino y la Raspberry Pi Pico.\n', 'err');
        showPane('out'); setState('err', 'Sin emulador ESP32'); return;
      }
      if (coresReady && coresReady[board] === false) {
        appendOut('Instalando el soporte para ' + $('board').selectedOptions[0].textContent + ' (solo la primera vez; puede tardar varios minutos)…\n');
        const ins = await (await fetch('/api/sim/cores/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board }) })).json();
        if (!ins.ok) { appendOut((ins.output || 'No se pudo instalar') + '\n', 'err'); showPane('out'); setState('err', 'Error'); return; }
        coresReady[board] = true;
      }
      const res = await fetch('/api/sim/compile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: cm.getValue(), board: $('board').value }),
      });
      const r = await res.json().catch(() => ({ ok: false, output: 'Respuesta no válida del servidor (' + res.status + ')' }));
      if (!res.ok && !r.output) r.output = r.error || ('Error ' + res.status);
      if (!r.ok) {
        appendOut((r.output || '') + '\n', 'err');
        showPane('out');
        setState('err', 'Error al compilar');
        if (r.missing && r.missing.length) suggestLibs(r.missing);
        return;
      }
      appendOut((r.output || '').trim() + '\n', '');
      appendOut('Compilado en ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s. Ejecutando…\n', 'ok');
      serialPane.textContent = '';
      showPane('serial');
      await launch({ kind: r.kind, data: r.data, image: r.image, board: r.board });
    } catch (e) {
      appendOut('No se pudo contactar con el servidor: ' + e.message + '\n', 'err');
      showPane('out');
      setState('err', 'Error');
    } finally {
      compiling = false;
      $('btn-run').disabled = false;
    }
  }
  $('btn-run').onclick = compileAndRun;
  $('btn-stop').onclick = () => stop();
  function togglePause() {
    if (!sim.eng) return;
    sim.paused = !sim.paused;
    if (sim.eng.pause) sim.eng.pause(sim.paused);
    if (sim.paused) audio.set(0);
    $('btn-pause').innerHTML = sim.paused ? ICO_RESUME : ICO_PAUSE;
    setState(sim.paused ? 'busy' : 'run', (sim.paused ? 'En pausa · ' : 'Ejecutando · ') + sim.eng.label);
  }
  $('btn-pause').onclick = togglePause;
  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ' || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t.closest && (t.closest('.CodeMirror') || /INPUT|TEXTAREA|SELECT|BUTTON/.test(t.tagName))) return;
    e.preventDefault();
    togglePause();
  });
  $('btn-reset').onclick = () => { if (sim.prog) { serialPane.textContent = ''; launch(sim.prog); } };

  /* El ESP32 corre en QEMU en el servidor: cada arranque abre una sesión nueva. */
  async function launch(prog) {
    if (prog.kind !== 'esp32') return start(prog);
    stop(true);
    setState('busy', 'Arrancando ESP32…');
    sim.prog = prog;
    const r = await (await fetch('/api/sim/esp32/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: prog.image }) })).json()
      .catch(() => ({ ok: false, error: 'Respuesta no válida del servidor' }));
    if (!r.ok) { appendOut('\nNo se pudo arrancar el emulador del ESP32: ' + (r.error || '') + '\n', 'err'); showPane('out'); setState('err', 'Error'); return; }
    start(Object.assign({}, prog, { session: r.session }));
  }
  const stashKey = (fam) => 'sim-code:' + (diagramId || 0) + ':' + fam;
  let lastBoard = null;
  function pyTemplate() {
    const G = window.Guia;
    try {
      const an = G.analyze(edit.doc.data || {});
      if (an.board && isPy(an.family)) return (an.family === 'rpi' ? G.rpiCode : G.opiCode)(G.items(an, an.family));
    } catch (_) { /* sin plantilla de la guía */ }
    return DEFAULT_PY;
  }
  $('board').onchange = () => {
    const b = $('board').value, was = lastBoard;
    lastBoard = b;
    if (was && isPy(was) !== isPy(b)) {
      try { localStorage.setItem(stashKey(isPy(was) ? 'py' : 'ino'), cm.getValue()); } catch (_) { /* nada */ }
      let next = null;
      try { next = localStorage.getItem(stashKey(isPy(b) ? 'py' : 'ino')); } catch (_) { /* nada */ }
      cm.setValue(next || (isPy(b) ? pyTemplate() : DEFAULT_SKETCH));
      cm.clearHistory();
    }
    setCodeMode(b);
    saveCode(true);
    if (isPy(b)) window.SimEngines.prewarmPython();
  };
  // Al cerrar la página se para el QEMU del ESP32 (si no, seguiría corriendo en el PC)
  window.addEventListener('pagehide', () => { if (sim.eng && sim.eng.remote) sim.eng.stop(); });
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); saveCode(true); }
    else if (e.key === 'Enter') { e.preventDefault(); compileAndRun(); }
  });

  // Librerías

  const modal = $('modal-libs');
  function openLibs(q) {
    modal.classList.add('open');
    loadInstalled();
    if (q) { $('lib-q').value = q; searchLibs(); }
    setTimeout(() => $('lib-q').focus(), 50);
  }
  $('btn-libs').onclick = () => openLibs();
  $('libs-close').onclick = () => modal.classList.remove('open');
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) modal.classList.remove('open'); });
  $('lib-go').onclick = searchLibs;
  $('lib-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchLibs(); });
  // Escape cierra los diálogos y el foco vuelve al botón que los abrió
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    [['modal-examples', 'btn-examples'], ['modal-libs', 'btn-libs']].forEach(([m, b]) => {
      if (!$(m).classList.contains('open')) return;
      $(m).classList.remove('open');
      // si el botón está dentro del menú «Más» (oculto), el foco vuelve a ese menú
      const back = $(b).offsetParent ? $(b) : document.querySelector('.tb-more-btn');
      if (back) back.focus();
    });
  });

  async function loadInstalled() {
    try {
      const list = await (await fetch('/api/sim/libs')).json();
      $('lib-inst').innerHTML = list.length ? list.map((l) => esc(l.name) + ' <small>' + esc(l.version) + '</small>').join(' · ') : 'Ninguna todavía (las básicas como Wire, SPI, EEPROM y SoftwareSerial ya vienen con la placa).';
    } catch (_) { $('lib-inst').textContent = 'No se pudo leer la lista.'; }
  }

  async function searchLibs(header) {
    const q = $('lib-q').value.trim();
    header = typeof header === 'string' ? header : '';
    if (q.length < 2 && !header) return;
    $('lib-res').innerHTML = '<p class="help">Buscando…</p>';
    let list = [];
    try {
      list = await (await fetch('/api/sim/libs/search?q=' + encodeURIComponent(q) + (header ? '&header=' + encodeURIComponent(header) : ''))).json();
    } catch (_) { /* vacío */ }
    $('lib-res').innerHTML = list.length ? '' : '<p class="help">No se encontró ninguna librería.</p>';
    list.slice(0, 25).forEach((l) => {
      const row = document.createElement('div');
      row.className = 'lib-row';
      row.innerHTML = '<div class="t"><b>' + esc(l.name) + ' <small style="display:inline">' + esc(l.version || '') + '</small></b>' +
        '<small>' + esc(l.sentence || '') + '</small><small>' + esc(l.author || '') + '</small>' +
        ((l.headers || []).length ? '<code>' + l.headers.slice(0, 6).map(esc).join(' · ') + '</code>' : '') + '</div>';
      const b = document.createElement('button');
      b.className = 'btn btn-primary btn-sm'; b.textContent = 'Instalar';
      b.onclick = async () => {
        b.disabled = true; b.textContent = 'Instalando…';
        try {
          const r = await (await fetch('/api/sim/libs/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: l.name }) })).json();
          b.textContent = r.ok ? 'Instalada' : 'Error';
          if (r.ok) { toast(l.name + ' instalada', 'ok'); loadInstalled(); } else toast((r.output || 'No se pudo instalar').slice(0, 200), 'err', 6000);
        } catch (e) { b.textContent = 'Error'; }
      };
      row.appendChild(b);
      $('lib-res').appendChild(row);
    });
  }

  /* Falta un #include: se busca la librería que lo trae y se ofrece instalarla. */
  function suggestLibs(missing) {
    const h = missing[0];
    appendOut('\nFalta la librería que trae «' + h + '». Elige cuál instalar en el buscador de librerías y vuelve a pulsar Simular.\n', 'err');
    openLibs();
    $('lib-q').value = h.replace(/\.h$/, '').replace(/_/g, ' ');
    searchLibs(h);
  }

  // Editar el circuito aquí mismo

  /* Como en Wokwi: con la simulación parada se mueven piezas, se tiran cables de borne a borne,
     se borran, se giran y se añaden piezas de la biblioteca. Se guarda solo en el diagrama.
     Las piezas nuevas se construyen igual que en el editor (bornes y rótulos). */
  const edit = { on: false, sel: null, dirty: false, timer: null, lib: null, doc: { data: {}, assets: {} }, type: 'SIG' };

  function labelPosition(t) {
    const d = 10;
    if (t.x >= 0.999 && t.y > 0.001 && t.y < 0.999) return { name: 'left', args: { x: -d } };
    if (t.x <= 0.001 && t.y > 0.001 && t.y < 0.999) return { name: 'right', args: { x: d } };
    if (t.y <= 0.08) return { name: 'bottom', args: { y: d } };
    if (t.y >= 0.92) return { name: 'top', args: { y: -d } };
    if (t.x >= 0.92) return { name: 'left', args: { x: -d } };
    return { name: 'right', args: { x: d } };
  }
  function buildNewPart(comp, x, y) {
    const snap = (v) => Math.round(v / 10) * 10;
    if (comp.kind === 'junction') {
      const j = new Junction({ position: { x: snap(x), y: snap(y) }, componentId: comp.id, componentName: comp.name });
      j.addPort({ id: 'c', group: 't', args: { x: 11, y: 11 } });
      return j;
    }
    const el = new Component({
      position: { x: snap(x), y: snap(y) }, size: { width: comp.width, height: comp.height },
      componentId: comp.id, componentName: comp.name,
      terminals: (comp.terminals || []).map((t) => Object.assign({}, t)), showTerminalLabels: comp.show_labels !== false,
    });
    const img = !!comp.image;
    el.attr({
      title: { text: comp.name },
      image: { href: comp.image || '', display: img ? null : 'none' },
      inner: { text: img ? '' : comp.name },
      body: img ? { fill: 'transparent', stroke: 'none' } : { fill: comp.color || '#eef2f7', stroke: '#475569' },
    });
    const show = comp.show_labels !== false;
    (comp.terminals || []).forEach((t) => el.addPort({
      id: t.id, group: 't', args: { x: t.x * comp.width, y: t.y * comp.height },
      label: { position: labelPosition(t) }, attrs: { label: { text: show ? (t.name || '') : '' } },
    }));
    return el;
  }
  function newWire() {
    const t = window.App.wireType(edit.type);
    return new joint.shapes.standard.Link({
      wireType: t.id, router: { name: 'electrico' }, connector: { name: 'jumpover', args: { size: 6, jump: 'arc' } },
      attrs: {
        line: { stroke: t.color, strokeWidth: 2.4, strokeDasharray: t.dash || null,
          targetMarker: { type: 'path', d: 'M 0 0' }, sourceMarker: { type: 'path', d: 'M 0 0' } },
        wrapper: { strokeWidth: 12 },
      },
    });
  }

  paper.options.interactive = (view) => {
    if (!edit.on) return false;
    if (view.model.isLink()) return { linkMove: false, labelMove: false, vertexAdd: false, vertexMove: false, vertexRemove: false, arrowheadMove: true };
    return true;
  };
  Object.assign(paper.options, {
    defaultLink: () => newWire(),
    linkPinning: false,
    snapLinks: { radius: 22 },
    markAvailable: true,
    validateConnection: (cvS, mS, cvT, mT) => !!mT && !!mT.getAttribute('port') && !(cvS === cvT && mS === mT),
  });

  function selectCell(cell) {
    if (edit.sel) { const v = paper.findViewByModel(edit.sel); if (v) v.el.classList.remove('sim-sel'); }
    edit.sel = cell || null;
    if (cell) { const v = paper.findViewByModel(cell); if (v) v.el.classList.add('sim-sel'); }
    $('ed-del').disabled = !cell;
    $('ed-rot').disabled = !cell || !cell.isElement();
  }

  function setEdit(on) {
    if (on === edit.on) return;
    if (on) stop();
    edit.on = on;
    document.body.classList.toggle('sim-editing', on);
    $('btn-edit').classList.toggle('on', on);
    $('btn-edit').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      (on ? '<path d="M5 12l5 5 9-10"/>' : '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>') +
      '</svg><span>' + (on ? 'Terminar edición' : 'Editar circuito') + '</span>';
    $('edit-bar').hidden = !on;
    overlay.style.display = on ? 'none' : '';
    closePopup();
    if (!on) {
      selectCell(null);
      if (edit.dirty) flushSave();
      if (edit.touched) { edit.touched = false; buildParts(); }      // la simulación usa el circuito nuevo
    }
  }
  $('btn-edit').onclick = () => setEdit(!edit.on);

  function changed2() {
    if (!edit.on || !diagramId) return;
    edit.dirty = true; edit.touched = true;
    $('ed-state').textContent = 'Sin guardar…';
    clearTimeout(edit.timer);
    edit.timer = setTimeout(flushSave, 1200);
  }
  graph.on('add remove change:position change:angle change:source change:target', (cell, a, b) => {
    if (!edit.on) return;
    if (cell.isLink && cell.isLink() && (!cell.target().id || !cell.source().id)) return;     // cable a medio tirar
    changed2();
  });

  /* Se guarda como lo hace el editor: las imágenes van una sola vez en `assets`. */
  async function flushSave() {
    clearTimeout(edit.timer);
    if (!edit.dirty || !diagramId) return;
    edit.dirty = false;
    const json = graph.toJSON();
    const assets = Object.assign({}, edit.doc.assets);
    const keyOf = new Map(Object.entries(assets).map(([k, v]) => [v, k]));
    let n = Object.keys(assets).length;
    json.cells.forEach((c) => {
      const h = c.attrs && c.attrs.image && c.attrs.image.href;
      if (!h || h.indexOf('data:') !== 0) return;
      let k = keyOf.get(h);
      if (!k) { do { k = 'img' + (++n); } while (assets[k]); assets[k] = h; keyOf.set(h, k); }
      c.attrs.image.href = 'asset:' + k;
    });
    edit.doc.assets = assets;
    try {
      await window.App.api.updateDiagram(diagramId, { data: Object.assign({}, edit.doc.data, { graph: json, assets }) });
      $('ed-state').textContent = 'Guardado';
    } catch (e) {
      edit.dirty = true;
      $('ed-state').textContent = 'Error al guardar';
      toast('No se pudo guardar el circuito: ' + e.message, 'err');
    }
  }
  window.addEventListener('beforeunload', () => { if (edit.dirty) flushSave(); });

  // Añadir piezas
  async function searchParts() {
    if (!edit.lib) { try { edit.lib = await window.App.api.listComponents(); } catch (_) { edit.lib = []; } }
    const q = $('ed-q').value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const hits = edit.lib.filter((c) => !q || norm(c.name + ' ' + c.category).includes(q)).slice(0, 40);
    const box = $('ed-res');
    box.innerHTML = hits.length ? '' : '<p class="help">No hay piezas con ese nombre.</p>';
    hits.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'ed-item';
      b.innerHTML = (c.image ? '<img src="' + esc(c.image) + '" alt="">' : '<span class="ed-noimg"></span>') +
        '<span><b>' + esc(c.name) + '</b><small>' + esc(c.category || '') + '</small></span>';
      b.onclick = () => {
        const r = paperEl.getBoundingClientRect(), p = paper.clientToLocalPoint(r.left + r.width / 2, r.top + r.height / 2);
        const el = buildNewPart(c, p.x - c.width / 2, p.y - c.height / 2);
        el.set('layer', (edit.doc.data.settings || {}).activeLayer || 'base');
        graph.addCell(el);
        selectCell(el);
        $('ed-pick').open = false;
      };
      box.appendChild(b);
    });
  }
  $('ed-q').addEventListener('input', searchParts);
  $('ed-pick').addEventListener('toggle', () => { if ($('ed-pick').open) { searchParts(); setTimeout(() => $('ed-q').focus(), 30); } });
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#ed-pick')) $('ed-pick').open = false; });

  // Borrar, girar, color de cable
  function delSel() { if (edit.sel) { const c = edit.sel; selectCell(null); c.remove(); } }
  function rotSel() { if (edit.sel && edit.sel.isElement()) edit.sel.rotate(90); }
  $('ed-del').onclick = delSel;
  $('ed-rot').onclick = rotSel;
  const typeSel = $('ed-type');
  window.App.WIRE_TYPES.filter((t) => ['SIG', 'V24', 'GND', 'COM', 'AN', 'PWR'].includes(t.id)).forEach((t) => {
    const o = document.createElement('option');
    o.value = t.id; o.textContent = { V24: 'Alimentación (rojo)', GND: 'Masa GND (negro)', SIG: 'Señal (naranja)', COM: 'Bus I2C/SPI (verde)', AN: 'Analógica (amarillo)', PWR: 'Potencia (morado)' }[t.id] || t.name;
    typeSel.appendChild(o);
  });
  typeSel.value = 'SIG';
  typeSel.onchange = () => {
    edit.type = typeSel.value;
    if (edit.sel && edit.sel.isLink()) {      // con un cable elegido, el color se le aplica a él
      const t = window.App.wireType(edit.type);
      edit.sel.set('wireType', t.id);
      edit.sel.attr('line/stroke', t.color);
      changed2();
    }
  };
  document.addEventListener('keydown', (e) => {
    if (!edit.on || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || (e.target.closest && e.target.closest('.CodeMirror'))) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); delSel(); }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); rotSel(); }
    else if (e.key === 'Escape') selectCell(null);
  });
  paper.on('link:connect', (lv) => { selectCell(lv.model); changed2(); });
  // Editando, la pieza bajo el ratón pasa delante de los cables: así sus bornes se pueden coger
  // aunque un cable pase por encima.
  paper.on('element:mouseenter', (v) => { if (edit.on && !paperEl.classList.contains('panning')) v.model.toFront(); });

  // Ejemplos

  const BOARD_NAMES = { uno: 'Arduino Uno', nano: 'Arduino Nano', mega: 'Arduino Mega', pico: 'Raspberry Pi Pico', esp32: 'ESP32', esp32c3: 'ESP32-C3' };
  $('btn-examples').onclick = () => {
    const grid = $('ex-grid');
    grid.innerHTML = '';
    (window.SimEjemplos || []).forEach((ex) => {
      const card = document.createElement('button');
      card.className = 'ex-card';
      card.innerHTML = '<b>' + esc(ex.name) + '</b><small>' + esc(BOARD_NAMES[ex.board] || ex.board) +
        '</small><span class="ex-d">' + esc(ex.desc) + '</span>';
      card.onclick = () => openExample(ex, card);
      grid.appendChild(card);
    });
    $('modal-examples').classList.add('open');
  };
  $('examples-close').onclick = () => $('modal-examples').classList.remove('open');
  $('modal-examples').addEventListener('mousedown', (e) => { if (e.target === $('modal-examples')) $('modal-examples').classList.remove('open'); });

  /* Crea un diagrama nuevo con el programa del ejemplo; el editor monta las piezas y vuelve aquí. */
  async function openExample(ex, card) {
    card.disabled = true;
    card.classList.add('busy');
    try {
      const d = await window.App.api.createDiagram({ name: 'Ejemplo · ' + ex.name, description: ex.desc });
      await fetch('/api/diagrams/' + d.id + '/sketch', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: ex.code, board: ex.board }),
      });
      stop(true);
      location.href = '/editor?id=' + d.id + '&ejemplo=' + encodeURIComponent(ex.id);
    } catch (e) {
      toast('No se pudo crear el ejemplo: ' + e.message, 'err');
      card.disabled = false; card.classList.remove('busy');
    }
  }

  // Vistas en pantallas pequeñas

  /* Teléfono: pestañas Código · Circuito · Controles. Pantalla mediana: cajón de controles. */
  const phone = window.matchMedia('(max-width: 699px)');
  function setView(v) {
    document.body.dataset.mv = v;
    document.querySelectorAll('#sim-mtabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      if (v === 'code') cm.refresh();
      if (v === 'stage') { syncOverlay(); if (!setView.fitted) { setView.fitted = true; fit(); } }
    });
  }
  setView('code');
  document.querySelectorAll('#sim-mtabs button').forEach((b) => { b.onclick = () => setView(b.dataset.v); });
  $('btn-ctrl').onclick = () => {
    const open = !document.body.classList.contains('ctrl-open');
    document.body.classList.toggle('ctrl-open', open);
    $('btn-ctrl').classList.toggle('on', open);
  };
  paper.on('blank:pointerdown', () => { if (document.body.classList.contains('ctrl-open')) $('btn-ctrl').click(); });
  // al poner en marcha la simulación en el teléfono se pasa a ver el circuito
  const runBtn = $('btn-run');
  runBtn.addEventListener('click', () => { if (phone.matches) setView('stage'); });
  // al cambiar el tamaño (girar el teléfono, cajones, ventana): si nadie tocó la vista se vuelve a
  // ajustar; si no, se mantiene lo que había en el centro
  let stageSize = null;
  new ResizeObserver(() => {
    const w = paperEl.clientWidth, h = paperEl.clientHeight;
    if (!w || !h) return;
    const prev = stageSize;
    stageSize = { w, h };
    if (prev && (prev.w !== w || prev.h !== h)) {
      const s = paper.scale().sx, t = paper.translate(), v = fit.view;
      if (v && Math.abs(s - v.s) < 1e-6 && Math.abs(t.tx - v.tx) < 0.5 && Math.abs(t.ty - v.ty) < 0.5) fit();
      else paper.translate(t.tx + (w - prev.w) / 2, t.ty + (h - prev.h) / 2);
    }
    syncOverlay();
  }).observe(paperEl);

  // Carga

  async function init() {
    let saved = { code: '', board: 'uno' };
    let detected = null;
    if (diagramId) {
      $('btn-editor').href = '/editor?id=' + diagramId;
      $('btn-guia').href = '/guia?id=' + diagramId;
      try {
        const d = await window.App.api.getDiagram(diagramId);
        $('sim-name').textContent = d.name;
        document.title = d.name + ' · Simulador';
        const data = d.data || {};
        const json = JSON.parse(JSON.stringify(data.graph || { cells: [] }));
        const assets = data.assets || {};
        (json.cells || []).forEach((c) => {
          const href = c.attrs && c.attrs.image && c.attrs.image.href;
          if (href && href.indexOf('asset:') === 0) c.attrs.image.href = assets[href.slice(6)] || '';
        });
        const hidden = new Set(((data.settings || {}).layers || []).filter((l) => l.visible === false).map((l) => String(l.id)));
        edit.doc = { data, assets: Object.assign({}, assets) };
        graph.fromJSON(json);
        if (hidden.size) graph.getCells().forEach((c) => { if (hidden.has(String(c.get('layer')))) { const v = paper.findViewByModel(c); if (v) v.el.style.display = 'none'; } });
        detected = buildParts();
        fit();
      } catch (e) {
        hint(['No se pudo abrir el diagrama: ' + esc(e.message)]);
      }
      try { saved = await (await fetch('/api/diagrams/' + diagramId + '/sketch')).json(); } catch (_) { /* sin código */ }
    } else {
      $('btn-editor').style.display = 'none';
      $('btn-guia').style.display = 'none';
      hint(['Abre el simulador desde un diagrama (botón Simular del editor) para ver el circuito. Aquí puedes probar el código con el monitor serie.']);
      try { saved = JSON.parse(localStorage.getItem('sim-sketch') || 'null') || saved; } catch (_) { /* nada */ }
      buildParts();
    }
    savedCode = saved.code || '';
    $('board').value = detected || (BOARDS.includes(saved.board) ? saved.board : 'uno');
    lastBoard = $('board').value;
    const pyNow = isPy(lastBoard);
    // un programa guardado de la otra familia (Arduino o Python) no sirve para esta placa
    const fits = saved.code && (isPy(saved.board) === pyNow || !BOARDS.includes(saved.board));
    cm.setValue(fits ? saved.code : (pyNow ? pyTemplate() : DEFAULT_SKETCH));
    cm.clearHistory();
    setCodeMode(lastBoard);
    if (pyNow) window.SimEngines.prewarmPython();
    clearTimeout(saveTimer);
    try {
      const st = await (await fetch('/api/sim/status')).json();
      if (!st.ok && !isPy($('board').value)) hint(['No está disponible el compilador de Arduino (arduino-cli) en el servidor: ' + esc(st.error || '')]);
      coresReady = st.ready || null;
      qemuReady = st.qemu || {};
      if (new URLSearchParams(location.search).get('ejemplos')) $('btn-examples').click();
      if (new URLSearchParams(location.search).get('auto') && diagramId) {      // recién creado desde un ejemplo
        history.replaceState(null, '', '/simulador?id=' + diagramId);
        setTimeout(compileAndRun, 300);
      }
      if (coresReady) [...$('board').options].forEach((o) => { if (coresReady[o.value] === false) o.textContent += ' (se instala al usarla)'; });
    } catch (_) { /* sin servidor */ }
  }

  window.Sim = {
    compileAndRun, start, stop, evaluate, graph, paper, cm,
    get parts() { return parts; }, get running() { return sim.running; }, get eng() { return sim.eng; }, mcu,
    part: (label) => parts.find((p) => p.label === label || p.kind === label),
    voltage: (label, term) => { const p = parts.find((q) => q.label === label || q.kind === label); return p ? p.v(term) : NaN; },
  };

  init();
})();
