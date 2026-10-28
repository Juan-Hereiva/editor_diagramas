/* Editor de diagramas eléctricos (JointJS 4). */
(function () {
  'use strict';
  const { api, WIRE_TYPES, wireType, esc, toast, download, slug, imageToDataURL } = App;

  const diagramId = Number(new URLSearchParams(location.search).get('id'));
  if (!diagramId) { location.href = '/'; return; }

  const FONT = 'Segoe UI, Roboto, Arial, sans-serif';
  const CONNECTOR = { name: 'jumpover', args: { size: 6, jump: 'arc' } };
  const $ = (id) => document.getElementById(id);

  const { PORT_GROUP, Component, Junction, Note, Zone, TitleBlock, namespace } = window.ElecShapes;

  // Estado

  let library = [];
  let selected = null;
  let group = [];            // selección múltiple (2 o más celdas)
  let tool = 'select';       // 'select': arrastrar el fondo dibuja un área · 'pan': mueve el plano
  let portModeEl = null;   // elemento sobre el que se están marcando bornes con clics
  let routingMode = 'auto';
  let currentType = 'V24';
  let currentColor = null;   // color elegido a mano para los cables nuevos (null = el del tipo)
  let showLabels = true;
  let snapGrid = true;       // imán a cuadrícula (desactivable para colocar al píxel)
  const keys = { shift: false, alt: false };
  const assetByKey = new Map();
  const keyByHref = new Map();
  let assetSeq = 0;

  const graph = new joint.dia.Graph({}, { cellNamespace: namespace });
  const wrap = $('canvas-wrap');

  /* Enrutador "eléctrico": busca un camino en ángulo recto que esquive componentes.
     Si los componentes están muy juntos y no cabe con el margen normal, reintenta con
     márgenes más finos; solo como último recurso traza una escuadra directa.
     Se registra por nombre para que los diagramas guardados lo encuentren al reabrirse. */
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

  function routerFor(mode) {
    return mode === 'auto' ? { name: 'electrico' } : { name: 'orthogonal', args: { padding: 16 } };
  }
  const isAutoRouter = (r) => !!r && (r.name === 'electrico' || r.name === 'manhattan');

  function wireLabel(text, color) {
    return {
      markup: [{ tagName: 'rect', selector: 'labelBody' }, { tagName: 'text', selector: 'labelText' }],
      attrs: {
        labelText: {
          text, fill: color, fontSize: 10.5, fontWeight: 700, fontFamily: FONT,
          textAnchor: 'middle', textVerticalAnchor: 'middle', pointerEvents: 'none',
          display: showLabels ? null : 'none',
        },
        labelBody: {
          ref: 'labelText', x: 'calc(x-4)', y: 'calc(y-2)', width: 'calc(w+8)', height: 'calc(h+4)',
          fill: '#ffffff', stroke: color, strokeWidth: 1, rx: 3, ry: 3,
          display: showLabels ? null : 'none',
        },
      },
      position: { distance: 0.5 },
    };
  }

  function newWire() {
    const t = wireType(currentType);
    return new joint.shapes.standard.Link({
      wireType: t.id,
      router: routerFor(routingMode),
      connector: CONNECTOR,
      attrs: {
        line: {
          stroke: currentColor || t.color, strokeWidth: 2.4, strokeDasharray: t.dash || null,
          targetMarker: { type: 'path', d: 'M 0 0' }, sourceMarker: { type: 'path', d: 'M 0 0' },
        },
        wrapper: { strokeWidth: 12 },
      },
    });
  }

  // Papel

  const paper = new joint.dia.Paper({
    el: $('paper'),
    model: graph,
    cellViewNamespace: namespace,
    width: '100%',
    height: '100%',
    gridSize: 10,
    drawGrid: { name: 'mesh', args: { color: '#edf0f4', thickness: 1 } },
    background: { color: '#ffffff' },
    snapLinks: { radius: window.matchMedia('(pointer: coarse)').matches ? 36 : 24 },   // con el dedo, más margen
    markAvailable: true,
    magnetThreshold: 'onleave',
    defaultConnectionPoint: { name: 'anchor' },
    defaultConnector: CONNECTOR,
    defaultLink: () => newWire(),
    sorting: joint.dia.Paper.sorting.APPROX,
    interactive: (cellView) => {
      if (cellView.model.isLink()) return { linkMove: false, labelMove: true };
      // Mientras se marcan bornes, la imagen no se mueve aunque el clic tiemble un poco.
      if (cellView.model === portModeEl) return { elementMove: false, addLinkFromMagnet: true };
      // Bloqueado: no se arrastra, pero se pueden seguir sacando cables de sus bornes.
      if (lockedEff(cellView.model)) return { elementMove: false, addLinkFromMagnet: true };
      return true;
    },
    // Un cable puede soltarse "en el aire" solo si cae encima de otro cable: allowLink lo une
    // con un empalme. En cualquier otro caso se descarta, como antes.
    linkPinning: true,
    allowLink: (linkView) => joinDanglingEnds(linkView.model),
    validateConnection: (cvS, mS, cvT, mT, end, linkView) => {
      if (linkView && linkView.model.get('isArrow')) return false;   // las flechas no se enganchan a bornes
      if (!mS || !mT) return false;
      if (!mT.getAttribute('port')) return false;
      return !(cvS === cvT && mS === mT);
    },
  });

  // El plano ocupa siempre todo el hueco, también al ocultar o mostrar paneles o al girar el teléfono.
  // Si la vista sigue como la dejó «Ajustar» se vuelve a ajustar al nuevo tamaño; si el usuario ya
  // movió o acercó el plano, se conserva lo que había en el centro.
  let fitView = null, wrapSize = null;
  function fitPaperToWrap() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    const prev = wrapSize;
    wrapSize = { w, h };
    const s = paper.scale().sx, t = paper.translate();
    const untouched = fitView && Math.abs(s - fitView.s) < 1e-6 && Math.abs(t.tx - fitView.tx) < 0.5 && Math.abs(t.ty - fitView.ty) < 0.5;
    paper.setDimensions(w, h);
    if (!prev || (prev.w === w && prev.h === h)) return;
    if (untouched) fitContent();
    else paper.translate(t.tx + (w - prev.w) / 2, t.ty + (h - prev.h) / 2);
  }
  if (window.ResizeObserver) new ResizeObserver(fitPaperToWrap).observe(wrap);
  window.addEventListener('resize', fitPaperToWrap);

  // Imán a cuadrícula

  const GRID = 10;
  const gridNow = () => (snapGrid && !keys.alt ? GRID : 1);
  function refreshGrid() { paper.options.gridSize = gridNow(); }
  window.addEventListener('keydown', (e) => {
    keys.shift = e.shiftKey;
    if (e.key === 'Alt') { keys.alt = true; refreshGrid(); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => {
    keys.shift = e.shiftKey;
    if (e.key === 'Alt') { keys.alt = false; refreshGrid(); e.preventDefault(); }
  });
  window.addEventListener('blur', () => { keys.shift = keys.alt = false; refreshGrid(); });

  // Asas: tamaño y giro

  /* Asa de la esquina inferior derecha: cambia el tamaño arrastrando.
     Las imágenes mantienen su proporción (Mayús para deformarlas); los componentes dibujados,
     al revés. */
  const ResizeTool = joint.elementTools.Control.extend({
    children: [{ tagName: 'rect', selector: 'handle', attributes: {
      x: -6, y: -6, width: 12, height: 12, rx: 2, fill: '#b5527c', stroke: '#ffffff', 'stroke-width': 2, cursor: 'nwse-resize' } }],
    getPosition(view) { const s = view.model.size(); return { x: s.width, y: s.height }; },
    setPosition(view, p) {
      const el = view.model, s = el.size();
      let w = Math.max(10, p.x), h = Math.max(10, p.y);
      if (!!el.attr('image/href') !== keys.shift) {
        const k = Math.max(w / s.width, h / s.height);
        w = Math.max(10, s.width * k); h = Math.max(10, s.height * k);
      } else if (gridNow() > 1) {
        w = Math.max(GRID, Math.round(w / GRID) * GRID); h = Math.max(GRID, Math.round(h / GRID) * GRID);
      }
      el.resize(Math.round(w * 10) / 10, Math.round(h * 10) / 10);
    },
  });

  /* Asa redonda encima del componente: gira a cualquier ángulo (Mayús: de 15 en 15°). */
  const RotateTool = joint.elementTools.Control.extend({
    children: [
      { tagName: 'circle', selector: 'handle', attributes: {
        r: 7, fill: '#ffffff', stroke: '#b5527c', 'stroke-width': 2.5, cursor: 'grab' } },
    ],
    getPosition(view) { const s = view.model.size(); return { x: s.width / 2, y: -30 }; },
    setPosition(view, p) {
      const el = view.model, s = el.size();
      const d = Math.atan2(p.y - s.height / 2, p.x - s.width / 2) * 180 / Math.PI + 90;
      let a = el.angle() + d;
      a = keys.shift ? Math.round(a / 15) * 15 : Math.round(a);
      el.rotate(((a % 360) + 360) % 360, true);
    },
  });

  /* Espejo: da la vuelta a la foto y a sus bornes. */
  function applyFlip(el) {
    if (!(el instanceof Component)) return;
    const fx = el.get('flipX') ? -1 : 1, fy = el.get('flipY') ? -1 : 1;
    const { width: w, height: h } = el.size();
    el.attr('image/transform', fx === 1 && fy === 1 ? null
      : 'matrix(' + fx + ',0,0,' + fy + ',' + (fx < 0 ? w : 0) + ',' + (fy < 0 ? h : 0) + ')');
  }
  function flip(el, axis) {
    const key = axis === 'x' ? 'flipX' : 'flipY';
    el.set(key, !el.get(key));
    el.set('terminals', (el.get('terminals') || []).map((t) =>
      Object.assign({}, t, axis === 'x' ? { x: Math.round((1 - t.x) * 1000) / 1000 } : { y: Math.round((1 - t.y) * 1000) / 1000 })));
    applyFlip(el);
    applyPorts(el);
  }

  // Bornes

  /* El nombre del borne va por dentro del componente (como la serigrafía de un equipo real),
     así no estorba a los cables, que siempre llegan desde fuera. */
  function labelPosition(t) {
    const d = 10;
    // Un borne pegado al lateral lleva el nombre al lado aunque esté cerca de una esquina.
    if (t.x >= 0.999 && t.y > 0.001 && t.y < 0.999) return { name: 'left', args: { x: -d } };
    if (t.x <= 0.001 && t.y > 0.001 && t.y < 0.999) return { name: 'right', args: { x: d } };
    if (t.y <= 0.08) return { name: 'bottom', args: { y: d } };
    if (t.y >= 0.92) return { name: 'top', args: { y: -d } };
    if (t.x >= 0.92) return { name: 'left', args: { x: -d } };
    return { name: 'right', args: { x: d } };
  }

  function applyPorts(el) {
    if (!(el instanceof Component)) return;
    const { width: w, height: h } = el.size();
    const show = el.get('showTerminalLabels') !== false;
    const terms = el.get('terminals') || [];
    const existing = new Set(el.getPorts().map((p) => p.id));
    const wanted = new Set(terms.map((t) => t.id));
    terms.forEach((t) => {
      const args = { x: t.x * w, y: t.y * h };
      const text = show ? (t.name || '') : '';
      if (existing.has(t.id)) {
        el.portProp(t.id, 'args', args);
        el.portProp(t.id, 'label/position', labelPosition(t), { rewrite: true });   // sustituye, no mezcla con la posición anterior
        el.portProp(t.id, 'attrs/label/text', text);
      } else {
        el.addPort({ id: t.id, group: 't', args, label: { position: labelPosition(t) }, attrs: { label: { text } } });
      }
    });
    el.getPorts().forEach((p) => {
      if (wanted.has(p.id)) return;
      // Un borne que desaparece se lleva sus cables: no pueden quedar colgando de la nada.
      graph.getConnectedLinks(el).forEach((l) => {
        const s = l.source(), t = l.target();
        if ((s.id === el.id && s.port === p.id) || (t.id === el.id && t.port === p.id)) l.remove();
      });
      el.removePort(p.id);
    });
    // Color y tamaño de los bornes elegidos en el panel (también para los que se marquen después).
    const ts = el.get('termStyle');
    if (ts) el.getPorts().forEach((p) => el.portProp(p.id, 'attrs/portBody', { fill: ts.fill, r: ts.r }));
    // El rótulo central ocupa solo el hueco que dejan libre los nombres de los bornes,
    // con la letra proporcional al espacio para que no parta palabras.
    const side = (pred) => (show ? Math.max(0, ...terms.filter(pred).map((t) => (t.name || '').length * 6 + 16)) : 0);
    const mid = (t) => t.y > 0.08 && t.y < 0.92;
    const left = side((t) => t.x <= 0.08 && mid(t));
    const right = side((t) => t.x >= 0.92 && mid(t));
    const top = show && terms.some((t) => t.y <= 0.08 && t.name) ? 18 : 0;
    const bottom = show && terms.some((t) => t.y >= 0.92 && t.name) ? 18 : 0;
    const aw = Math.max(20, w - left - right - 10), ah = Math.max(12, h - top - bottom - 8);
    el.attr('inner', {
      x: left + (w - left - right) / 2,
      y: top + (h - top - bottom) / 2,
      fontSize: Math.max(8, Math.min(12, aw / 8, ah / 3)),
      textWrap: { width: aw, height: ah, ellipsis: true },
    });
  }

  graph.on('change:size', (el) => { applyPorts(el); applyFlip(el); });

  const JUNCTION_DEFAULT = { color: '#111827', r: 5.5 };
  function styleJunction(el, st) {
    st = Object.assign({}, JUNCTION_DEFAULT, el.get('jStyle'), st);
    el.set('jStyle', st);
    el.portProp('c', 'attrs/portBody', { fill: st.color, stroke: st.color, r: st.r });
  }

  function buildElement(comp, x, y) {
    const snap = (v) => (snapGrid ? Math.round(v / GRID) * GRID : Math.round(v));
    if (comp.kind === 'junction') {
      const el = new Junction({ position: { x: snap(x) - (snapGrid ? 1 : 0), y: snap(y) - (snapGrid ? 1 : 0) }, componentId: comp.id, componentName: comp.name });
      el.addPort({ id: 'c', group: 't', args: { x: 11, y: 11 } });
      return el;
    }
    const el = new Component({
      position: { x: snap(x), y: snap(y) },
      size: { width: comp.width, height: comp.height },
      componentId: comp.id,
      componentName: comp.name,
      terminals: (comp.terminals || []).map((t) => Object.assign({}, t)),
      showTerminalLabels: comp.show_labels !== false,
    });
    styleFromComponent(el, comp);
    applyPorts(el);
    return el;
  }

  function styleFromComponent(el, comp) {
    const hasImg = !!comp.image;
    el.attr({
      title: { text: el.attr('title/text') || comp.name },
      image: { href: comp.image || '', display: hasImg ? null : 'none' },
      inner: { text: hasImg ? '' : comp.name },
      body: hasImg ? { fill: 'transparent', stroke: 'none' } : { fill: comp.color || '#eef2f7', stroke: '#475569' },
    });
  }

  function addComponent(comp, x, y) {
    const el = buildElement(comp, x, y);
    graph.addCell(el);
    if (el instanceof Junction) dropJunctionOnWire(el);
    select(el);
    return el;
  }

  // Imágenes pegadas en el plano

  let lastPointer = null;   // última posición del ratón sobre el plano, para pegar donde estás
  wrap.addEventListener('mousemove', (e) => { lastPointer = { x: e.clientX, y: e.clientY }; });
  wrap.addEventListener('mouseleave', () => { lastPointer = null; });

  function viewCenterLocal() {
    const r = wrap.getBoundingClientRect();
    return paper.clientToLocalPoint(r.left + r.width / 2, r.top + r.height / 2);
  }

  /* Coloca una foto o captura en el plano como un componente sin bornes.
     Después se le pueden marcar bornes con clics y cablearla como cualquier otro. */
  async function insertImage(file, clientPoint, offset) {
    const img = await imageToDataURL(file, 1400);
    const w = Math.min(360, img.width);
    const h = Math.max(10, Math.round(w * img.height / img.width));
    const p = clientPoint ? paper.clientToLocalPoint(clientPoint.x, clientPoint.y) : viewCenterLocal();
    const d = offset || 0;
    const el = buildElement({ id: null, kind: 'component', name: '', width: w, height: h, image: img.dataURL,
      terminals: [], show_labels: true, color: '#ffffff' }, p.x - w / 2 + d, p.y - h / 2 + d);
    el.set('componentName', 'Imagen pegada');
    el.set('isPicture', true);
    graph.addCell(el);
    select(el);
    return el;
  }

  async function insertImages(files, clientPoint) {
    const imgs = [...files].filter((f) => /^image\//.test(f.type));
    if (!imgs.length) return false;
    try {
      for (let i = 0; i < imgs.length; i++) await insertImage(imgs[i], clientPoint, i * 30);
      toast(imgs.length > 1 ? imgs.length + ' imágenes añadidas' : 'Imagen añadida: pulsa «Marcar bornes» para poder conectarle cables', 'ok');
    } catch (e) { toast(e.message, 'error'); }
    return true;
  }

  document.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData ? e.clipboardData.items : [])]
      .filter((it) => it.kind === 'file' && it.type.indexOf('image/') === 0).map((it) => it.getAsFile());
    if (files.length) { e.preventDefault(); insertImages(files, lastPointer); return; }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;   // texto normal en un campo
    const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    const c = text.indexOf(CLIP_MARK) === 0 ? readClip(text.slice(CLIP_MARK.length)) : (!text ? readClip() : null);
    if (c) { e.preventDefault(); pasteClip(c, lastPointer); }
  });

  $('btn-image').onclick = () => $('image-file').click();
  $('image-file').addEventListener('change', (e) => { insertImages(e.target.files, null); e.target.value = ''; });

  // Marcar bornes sobre una imagen (o cualquier componente) con clics

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const snapEdge = (v) => (v < 0.035 ? 0 : v > 0.965 ? 1 : Math.round(v * 200) / 200);

  function nextTerminalName(el) {
    const used = new Set((el.get('terminals') || []).map((t) => t.name));
    let i = 1;
    while (used.has(String(i))) i++;
    return String(i);
  }

  function addTerminalAt(el, x, y) {
    const rel = el.getRelativePointFromAbsolute(x, y);
    const { width: w, height: h } = el.size();
    const t = { id: 't' + Math.random().toString(36).slice(2, 10), name: nextTerminalName(el),
      x: snapEdge(clamp01(rel.x / w)), y: snapEdge(clamp01(rel.y / h)) };
    el.set('terminals', (el.get('terminals') || []).concat([t]));
    applyPorts(el);
    renderProps();
    const input = document.querySelector('#props input[data-tid="' + t.id + '"]');
    if (input) { input.focus(); input.select(); }
  }

  function startPortMode(el) {
    if (!el || !(el instanceof Component)) return;
    if (selected !== el) select(el);
    portModeEl = el;
    $('mode-banner').hidden = false;
    wrap.classList.add('port-mode');
    renderProps();
  }

  function stopPortMode(rerender) {
    portModeEl = null;
    $('mode-banner').hidden = true;
    wrap.classList.remove('port-mode');
    if (rerender !== false) renderProps();
  }
  $('mode-done').onclick = () => stopPortMode();

  function renameTerminal(el, tid, name) {
    el.set('terminals', (el.get('terminals') || []).map((t) => (t.id === tid ? Object.assign({}, t, { name }) : t)));
    applyPorts(el);
  }

  function removeTerminal(el, tid) {
    el.set('terminals', (el.get('terminals') || []).filter((t) => t.id !== tid));
    applyPorts(el);
    renderProps();
  }

  async function saveToLibrary(el) {
    const suggested = el.attr('title/text') || (el.get('isPicture') ? '' : el.get('componentName')) || '';
    const name = prompt('Nombre del componente en la biblioteca:', suggested);
    if (name === null) return;
    const { width, height } = el.size();
    try {
      const comp = await api.createComponent({
        name: name.trim() || 'Componente', category: 'Mis componentes', kind: 'component',
        width: Math.round(width), height: Math.round(height),
        color: el.attr('body/fill') && el.attr('body/fill') !== 'transparent' ? el.attr('body/fill') : '#eef2f7',
        image: el.attr('image/href') || '', show_labels: el.get('showTerminalLabels') !== false,
        terminals: el.get('terminals') || [],
      });
      el.set({ componentId: comp.id, componentName: comp.name, isPicture: false });
      await loadLibrary();
      renderProps();
      toast('Guardado en la biblioteca: ya puedes reutilizarlo en otros diagramas', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  // Numeración de cables

  function nextWireNo() {
    let max = 0;
    graph.getLinks().forEach((l) => { max = Math.max(max, Number(l.get('wireNo')) || 0); });
    return max + 1;
  }

  function setWireLabel(link, text) {
    const color = link.attr('line/stroke');
    link.labels(text ? [wireLabel(text, color)] : []);
  }

  paper.on('link:connect', (linkView) => {
    const link = linkView.model;
    if (!link.get('wireNo')) {
      const n = nextWireNo();
      link.set('wireNo', n);
      setWireLabel(link, 'C' + n);
    }
    // Si el cable acaba en un empalme no se deja seleccionado: su asa taparía el punto
    // y el siguiente arrastre desde el empalme movería este cable en vez de crear otro.
    // El empalme se pone por encima de los cables: si no, la punta del cable tapa el punto y ya
    // no se puede arrastrar otro cable desde él.
    const junctions = [link.source(), link.target()].map((e) => graph.getCell(e.id)).filter((c) => c instanceof Junction);
    junctions.forEach((j) => j.toFront());
    if (junctions.length) clearSelection(); else select(link);
  });

  // Selección

  function clearSelection() {
    if (portModeEl) stopPortMode(false);
    dropGroup();
    paper.removeTools();
    if (selected) {
      const v = selected.findView(paper);
      if (v) joint.highlighters.mask.remove(v, 'sel');
    }
    selected = null;
    renderProps();
  }

  function select(cell) {
    if (!cell || !graph.getCell(cell.id)) return;
    if (portModeEl && portModeEl !== cell) stopPortMode(false);
    dropGroup();
    paper.removeTools();
    if (selected && selected !== cell) {
      const old = selected.findView(paper);
      if (old) joint.highlighters.mask.remove(old, 'sel');
    }
    selected = cell;
    const view = cell.findView(paper);
    if (view) {
      if (cell.isLink()) {
        view.addTools(new joint.dia.ToolsView({
          tools: [
            new joint.linkTools.Vertices({ redundancyRemoval: true, snapRadius: 10, vertexAdding: true }),
            new joint.linkTools.SourceArrowhead(),
            new joint.linkTools.TargetArrowhead(),
            new joint.linkTools.Remove({ distance: '50%', offset: 22 }),
          ],
        }));
        joint.highlighters.mask.add(view, { selector: 'line' }, 'sel', {
          padding: 3, attrs: { stroke: '#b5527c', 'stroke-width': 2, 'stroke-opacity': 0.55 },
        });
      } else {
        view.addTools(new joint.dia.ToolsView({
          tools: [
            new joint.elementTools.Boundary({
              padding: 8, rotate: true,
              attrs: { fill: 'none', stroke: '#b5527c', 'stroke-width': 1.5, 'stroke-dasharray': '5 4', 'pointer-events': 'none' },
            }),
            new joint.elementTools.Remove({ x: '100%', y: 0, offset: { x: 12, y: -12 } }),
          ].filter((t) => !(lockedEff(cell) && t instanceof joint.elementTools.Remove))
            .concat(cell instanceof Junction || lockedEff(cell) ? [] : [new ResizeTool(), new RotateTool()]),
        }));
      }
    }
    renderProps();
  }

  paper.on('element:pointerclick', (view, evt, x, y) => {
    if (util) { utilElementClick(view, evt); return; }
    if (portModeEl && view.model === portModeEl) { addTerminalAt(portModeEl, x, y); return; }
    if (evt.ctrlKey || evt.metaKey || evt.shiftKey) { toggleInSelection(view.model); return; }
    select(view.model);
  });
  paper.on('link:pointerclick', (view, evt, x, y) => {
    if (util) { utilLinkClick(view.model, x, y); return; }
    if (evt.ctrlKey || evt.metaKey || evt.shiftKey) { toggleInSelection(view.model); return; }
    select(view.model);
  });

  // Selección múltiple

  function markGroup(cell, on) {
    const v = cell.findView(paper);
    if (!v) return;
    if (cell.isLink()) {
      if (on) joint.highlighters.mask.add(v, { selector: 'line' }, 'grp', { padding: 3, attrs: { stroke: '#b5527c', 'stroke-width': 2, 'stroke-opacity': 0.6 } });
      else joint.highlighters.mask.remove(v, 'grp');
    } else if (on) {
      joint.highlighters.stroke.add(v, 'root', 'grp', { padding: 6, rx: 4, ry: 4, useFirstSubpath: false,
        attrs: { stroke: '#b5527c', 'stroke-width': 1.6, 'stroke-dasharray': '5 4' } });
    } else joint.highlighters.stroke.remove(v, 'grp');
  }

  function dropGroup() {
    group.forEach((c) => markGroup(c, false));
    group = [];
  }

  /* Selecciona varias celdas a la vez (si solo hay una, es una selección normal). */
  function setGroup(cells) {
    const uniq = [...new Set(cells)].filter((c) => c && graph.getCell(c.id));
    if (uniq.length <= 1) { if (uniq.length) select(uniq[0]); else clearSelection(); return; }
    if (portModeEl) stopPortMode(false);
    dropGroup();
    paper.removeTools();
    if (selected) { const v = selected.findView(paper); if (v) joint.highlighters.mask.remove(v, 'sel'); }
    selected = null;
    group = uniq;
    group.forEach((c) => markGroup(c, true));
    renderProps();
  }

  function currentCells() { return group.length ? group.slice() : selected ? [selected] : []; }

  function toggleInSelection(cell) {
    const cur = currentCells();
    setGroup(cur.includes(cell) ? cur.filter((c) => c !== cell) : cur.concat([cell]));
  }

  const groupElements = () => group.filter((c) => c.isElement());
  /* Cables con los dos extremos dentro de la selección: viajan con ella (puntos de paso incluidos). */
  function innerLinks(els) {
    const ids = new Set(els.map((e) => e.id));
    return graph.getLinks().filter((l) => ids.has(l.source().id) && ids.has(l.target().id));
  }

  function moveGroupBy(dx, dy) {
    const els = groupElements().filter((e) => !lockedEff(e));
    graph.startBatch('group-move');
    els.forEach((e) => e.translate(dx, dy, { group: true }));
    innerLinks(els).forEach((l) => { const v = l.vertices(); if (v.length) l.vertices(v.map((p) => ({ x: p.x + dx, y: p.y + dy }))); });
    graph.stopBatch('group-move');
  }

  // Arrastrar cualquier elemento de la selección mueve todos los demás con él.
  let gdrag = null;
  paper.on('element:pointerdown', (view) => {
    const lead = view.model;
    if (!group.includes(lead) || lockedEff(lead)) { gdrag = null; return; }
    const els = groupElements().filter((e) => !lockedEff(e));
    gdrag = {
      lead,
      start: new Map(els.map((e) => [e.id, Object.assign({}, e.position())])),
      links: innerLinks(els).map((l) => ({ l, v: l.vertices().map((p) => ({ x: p.x, y: p.y })) })),
    };
    graph.startBatch('group-move');
  });
  graph.on('change:position', (el, pos, opt) => {
    if (!gdrag || el !== gdrag.lead || opt.group) return;
    const s0 = gdrag.start.get(el.id);
    const dx = pos.x - s0.x, dy = pos.y - s0.y;
    gdrag.start.forEach((p, id) => {
      if (id === el.id) return;
      const c = graph.getCell(id);
      if (c) c.position(p.x + dx, p.y + dy, { group: true });
    });
    gdrag.links.forEach(({ l, v }) => { if (v.length) l.vertices(v.map((p) => ({ x: p.x + dx, y: p.y + dy })), { group: true }); });
  });

  function alignGroup(kind) {
    const els = groupElements();
    if (els.length < 2) return;
    const bb = els.map((e) => e.getBBox());
    const minX = Math.min(...bb.map((b) => b.x)), maxX = Math.max(...bb.map((b) => b.x + b.width));
    const minY = Math.min(...bb.map((b) => b.y)), maxY = Math.max(...bb.map((b) => b.y + b.height));
    const cx = bb.reduce((a, b) => a + b.center().x, 0) / bb.length;
    const cy = bb.reduce((a, b) => a + b.center().y, 0) / bb.length;
    graph.startBatch('align');
    els.forEach((e, i) => {
      const b = bb[i];
      const d = {
        left: [minX - b.x, 0], right: [maxX - b.x - b.width, 0], hcenter: [cx - b.center().x, 0],
        top: [0, minY - b.y], bottom: [0, maxY - b.y - b.height], vcenter: [0, cy - b.center().y],
      }[kind];
      e.translate(d[0], d[1], { group: true });
    });
    graph.stopBatch('align');
  }

  function duplicateGroup() {
    const els = groupElements();
    if (!els.length) return;
    const map = graph.cloneSubgraph(els.concat(innerLinks(els)));
    const clones = Object.values(map);
    let no = nextWireNo();
    clones.forEach((c) => {
      if (c.isElement()) c.translate(30, 30);
      else c.vertices(c.vertices().map((p) => ({ x: p.x + 30, y: p.y + 30 })));
    });
    graph.addCells(clones);
    // los cables copiados llevan número nuevo
    clones.filter((c) => c.isLink()).forEach((c) => { c.set('wireNo', no); setWireLabel(c, 'C' + no); no++; });
    setGroup(clones);
    toast(clones.length + ' elementos duplicados', 'ok');
  }

  // Área de selección (arrastrar sobre el fondo)
  let box = null;
  function startBox(evt) {
    const r = wrap.getBoundingClientRect();
    const div = document.createElement('div');
    div.className = 'sel-box';
    wrap.appendChild(div);
    box = { x0: evt.clientX, y0: evt.clientY, r, div, add: evt.ctrlKey || evt.metaKey || evt.shiftKey, moved: false };
  }
  document.addEventListener('pointermove', (e) => {
    if (!box) return;
    const x1 = Math.min(box.x0, e.clientX), y1 = Math.min(box.y0, e.clientY);
    const x2 = Math.max(box.x0, e.clientX), y2 = Math.max(box.y0, e.clientY);
    if (!box.moved && x2 - x1 + y2 - y1 < 4) return;
    box.moved = true;
    Object.assign(box.div.style, { left: (x1 - box.r.left) + 'px', top: (y1 - box.r.top) + 'px', width: (x2 - x1) + 'px', height: (y2 - y1) + 'px' });
    box.x1 = e.clientX; box.y1 = e.clientY;
  });
  document.addEventListener('pointerup', () => {
    if (!box) return;
    const b = box; box = null;
    b.div.remove();
    if (!b.moved) return;
    const p0 = paper.clientToLocalPoint(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1));
    const p1 = paper.clientToLocalPoint(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
    const area = new joint.g.Rect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    // Entra lo que queda completamente dentro del área.
    const els = graph.getElements().filter((e) => !lockedEff(e) && !hiddenEff(e) && area.containsRect(e.getBBox({ rotate: true })));
    const ids = new Set(els.map((e) => e.id));
    const links = graph.getLinks().filter((l) => {
      if (ids.has(l.source().id) && ids.has(l.target().id)) return true;
      if (hiddenEff(l) || lockedEff(l)) return false;
      const v = l.findView(paper);
      const c = v && v.getConnection();
      return c ? area.containsRect(c.bbox()) : false;
    });
    const picked = els.concat(links);
    setGroup(b.add ? currentCells().concat(picked) : picked);
  });

  function setTool(t) {
    tool = t;
    $('tool-select').classList.toggle('on', t === 'select');
    $('tool-pan').classList.toggle('on', t === 'pan');
    wrap.classList.toggle('pan-mode', t === 'pan');
  }
  $('tool-select').onclick = () => setTool('select');
  $('tool-pan').onclick = () => setTool('pan');
  // con el dedo lo natural es arrastrar para mover el plano; «Seleccionar» sigue dibujando el recuadro
  if (window.matchMedia('(pointer: coarse)').matches) setTool('pan');

  let spaceDown = false;
  window.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (e.code !== 'Space' || tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return;
    e.preventDefault();
    if (!spaceDown) { spaceDown = true; wrap.classList.add('space-pan'); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { spaceDown = false; wrap.classList.remove('space-pan'); }
  });

  /* Si sueltas un empalme suelto encima de un cable, se coloca exactamente sobre la línea
     y el cable se parte en dos (origen → empalme → destino). */
  function dropJunctionOnWire(j) {
    if (graph.getConnectedLinks(j).length) return false;
    const c = j.getBBox().center();
    const tol = 12 / paper.scale().sx;
    let best = null;
    graph.getLinks().forEach((l) => {
      if (l.get('isArrow')) return;
      const v = l.findView(paper);
      if (!v || !v.getConnection()) return;
      const pt = v.getClosestPoint(c);
      const d = pt ? pt.distance(c) : Infinity;
      if (d <= tol && (!best || d < best.d)) best = { l, pt, d };
    });
    if (!best) return false;
    const { a, b } = splitLinkAt(best.l, best.pt, j);
    toast('Empalme colocado sobre el cable ' + wireName(a) + ' (partido en ' + wireName(a) + ' y ' + wireName(b) + ')', 'ok');
    return true;
  }

  /* Parte el cable `l` en el punto `pt` con un empalme (nuevo, o el que se pase).
     Origen → empalme conserva el número; empalme → destino recibe uno nuevo. */
  function splitLinkAt(l, pt, j) {
    graph.startBatch('split');
    if (!j) {
      const comp = library.find((c) => c.kind === 'junction') || { id: null, kind: 'junction', name: 'Empalme / nodo' };
      j = new Junction({ position: { x: 0, y: 0 }, componentId: comp.id, componentName: comp.name });
      j.addPort({ id: 'c', group: 't', args: { x: 11, y: 11 } });
      const color = l.attr('line/stroke');
      graph.addCell(j);
      styleJunction(j, { color: toHex(color, JUNCTION_DEFAULT.color) });
    }
    const half = j.size().width / 2;
    j.position(Math.round((pt.x - half) * 2) / 2, Math.round((pt.y - half) * 2) / 2);
    const a = l.clone(), b = l.clone();
    a.set({ target: { id: j.id, port: 'c' }, vertices: [] });
    b.set({ source: { id: j.id, port: 'c' }, vertices: [], wireNo: nextWireNo() });
    graph.addCells([a, b]);
    setWireLabel(b, 'C' + b.get('wireNo'));
    l.remove();
    j.toFront();
    graph.stopBatch('split');
    return { j, a, b };
  }

  /* Punta suelta de un cable encima de otro cable → empalme en ese punto y la punta enganchada a él. */
  function nearestWire(pt, exclude) {
    const tol = 14 / paper.scale().sx;
    let best = null;
    graph.getLinks().forEach((l) => {
      if (l === exclude || !l.source().id || !l.target().id) return;
      const v = l.findView(paper);
      if (!v || !v.getConnection()) return;
      const q = v.getClosestPoint(pt);
      const d = q ? q.distance(pt) : Infinity;
      if (d <= tol && (!best || d < best.d)) best = { l, pt: q, d };
    });
    return best;
  }
  function joinDanglingEnds(link) {
    if (link.get('isArrow')) return true;
    const loose = ['source', 'target'].filter((end) => !link.get(end).id);
    if (!loose.length) return true;
    const hits = loose.map((end) => ({ end, hit: nearestWire(new joint.g.Point(link.get(end)), link) }));
    if (hits.some((h) => !h.hit)) return false;
    hits.forEach(({ end, hit }) => {
      const { j } = splitLinkAt(hit.l, hit.pt);
      link.set(end, { id: j.id, port: 'c' });
    });
    return true;
  }

  /* Doble clic sobre un cable: pone un empalme ahí para sacar una derivación. */
  paper.on('link:pointerdblclick', (view, evt, x, y) => {
    if (view.model.get('isArrow')) return;
    if (!view.model.source().id || !view.model.target().id) return;
    const pt = view.getClosestPoint({ x, y });
    const { j } = splitLinkAt(view.model, pt);
    clearSelection();
    toast('Empalme añadido: arrastra desde el punto para sacar otro cable', 'ok');
    j.findView(paper) && joint.highlighters.mask.add(j.findView(paper), { port: 'c' }, 'flash', {
      padding: 4, attrs: { stroke: '#b5527c', 'stroke-width': 3 } });
    setTimeout(() => { const v = j.findView(paper); if (v) joint.highlighters.mask.remove(v, 'flash'); }, 1200);
  });

  /* Quita un empalme que solo une dos cables y deja uno solo, de punta a punta. */
  function mergeAtJunction(j) {
    const ls = graph.getConnectedLinks(j);
    if (ls.length !== 2) return;
    // Se conserva el cable de número más bajo y el sentido original (el que llegaba al empalme manda).
    const [keep, other] = ls.slice().sort((x, y) => (Number(x.get('wireNo')) || 1e9) - (Number(y.get('wireNo')) || 1e9));
    const incoming = keep.target().id === j.id ? keep : other.target().id === j.id ? other : keep;
    const outgoing = incoming === keep ? other : keep;
    const far = (l) => (l.source().id === j.id ? l.target() : l.source());
    graph.startBatch('merge');
    const m = keep.clone();
    m.set({ source: far(incoming), target: far(outgoing), vertices: [] });
    graph.addCell(m);
    setWireLabel(m, wireName(keep));
    const a = keep, b = other;
    graph.removeCells([a, b, j]);
    graph.stopBatch('merge');
    select(m);
    toast('Cables unidos en uno solo: ' + wireName(m), 'ok');
  }
  paper.on('element:pointerup', (view) => {
    if (gdrag) { gdrag = null; graph.stopBatch('group-move'); return; }
    if (view.model instanceof Junction) dropJunctionOnWire(view.model);
  });

  // Los campos de posición, tamaño y giro del panel se actualizan mientras arrastras.
  graph.on('change:position change:size change:angle', (cell) => {
    if (cell !== selected) return;
    const set = (id, v) => { const i = $(id); if (i && document.activeElement !== i) i.value = v; };
    const p = cell.position(), s = cell.size();
    if (cell instanceof Junction) { set('p-x', +(p.x + s.width / 2).toFixed(1)); set('p-y', +(p.y + s.height / 2).toFixed(1)); return; }
    set('p-x', +p.x.toFixed(1)); set('p-y', +p.y.toFixed(1));
    set('p-w', Math.round(s.width)); set('p-h', Math.round(s.height));
    set('p-angle', Math.round(cell.angle()));
  });
  paper.on('blank:pointerclick', () => clearSelection());
  graph.on('remove', (cell) => {
    if (group.includes(cell)) { group = group.filter((c) => c !== cell); if (!group.length) renderProps(); }
    if (portModeEl && cell.id === portModeEl.id) stopPortMode(false);
    if (selected && cell.id === selected.id) { selected = null; paper.removeTools(); renderProps(); }
    else if (selected) renderProps();
  });

  // Mover y zoom

  let pan = null;
  paper.on('blank:pointerdown', (evt) => {
    if (util && util.kind === 'net' && util.marks.length) { clearNet(); utilText(UTIL_TEXT.net); }
    if (tool === 'select' && !spaceDown && evt.button !== 1) { startBox(evt); return; }
    const t = paper.translate();
    pan = { x: evt.clientX, y: evt.clientY, tx: t.tx, ty: t.ty, moved: false };
  });
  document.addEventListener('pointermove', (e) => {
    if (!pan) return;
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (!pan.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    pan.moved = true;
    wrap.classList.add('panning');
    paper.translate(pan.tx + dx, pan.ty + dy);
  });
  const endPan = () => { if (pan) { pan = null; wrap.classList.remove('panning'); } };
  document.addEventListener('pointerup', endPan);
  document.addEventListener('pointercancel', endPan);
  wrap.addEventListener('mousedown', (e) => {
    if (e.button !== 1 && !(spaceDown && e.button === 0)) return;
    e.preventDefault(); e.stopPropagation();
    const t = paper.translate();
    pan = { x: e.clientX, y: e.clientY, tx: t.tx, ty: t.ty, moved: false };
  }, true);

  // Pantallas táctiles: dos dedos acercan, alejan y mueven; mantener pulsado abre el menú contextual.
  let ctxShownAt = 0;
  App.touchGestures(paper, wrap, {
    onPinchStart: () => {
      endPan();
      if (box) { box.div.remove(); box = null; }
      closeCtx();
    },
    onChange: updateZoomLabel,
    longPress: (x, y, target) => {
      if (Date.now() - ctxShownAt < 1000 || !paper.el.contains(target)) return;
      const cellEl = target.closest && target.closest('.joint-cell');
      const v = cellEl && paper.findView(cellEl);
      const ev = { clientX: x, clientY: y, preventDefault() {} };
      if (box) { box.div.remove(); box = null; }
      endPan();
      if (navigator.vibrate) navigator.vibrate(12);
      if (v && v.model) cellMenu(ev, v.model); else blankMenu(ev);
    },
  });

  function updateZoomLabel() { $('zoom-label').textContent = Math.round(paper.scale().sx * 100) + '%'; }

  function zoomTo(scale, clientX, clientY) {
    const s = Math.min(4, Math.max(0.15, scale));
    let local;
    if (clientX == null) {
      const r = wrap.getBoundingClientRect();
      local = paper.clientToLocalPoint(r.left + r.width / 2, r.top + r.height / 2);
    } else {
      local = paper.clientToLocalPoint(clientX, clientY);
    }
    paper.scaleUniformAtPoint(s, local);
    updateZoomLabel();
  }

  function onWheel(evt, delta) {
    evt.preventDefault();
    zoomTo(paper.scale().sx * (delta > 0 ? 1.12 : 1 / 1.12), evt.clientX, evt.clientY);
  }
  paper.on('blank:mousewheel', (evt, x, y, delta) => onWheel(evt, delta));
  paper.on('cell:mousewheel', (view, evt, x, y, delta) => onWheel(evt, delta));

  function fitContent() {
    if (!graph.getCells().length) {
      paper.scale(1, 1);
      paper.translate(40, 40);
    } else {
      paper.transformToFitContent({ padding: wrap.clientWidth < 700 ? 24 : 60, maxScale: 1, minScale: 0.15 });
    }
    const t = paper.translate();
    fitView = { s: paper.scale().sx, tx: t.tx, ty: t.ty };
    updateZoomLabel();
  }

  $('zoom-in').onclick = () => zoomTo(paper.scale().sx * 1.2);
  $('zoom-out').onclick = () => zoomTo(paper.scale().sx / 1.2);
  $('zoom-fit').onclick = fitContent;

  // Modos de clic de la barra «Edición»: resaltar red y partir cable
  const UTIL_TEXT = {
    net: '<b>Resaltar red:</b> haz clic en un cable o en un borne.',
    split: '<b>Partir cable:</b> haz clic en un cable donde quieras el empalme; después saca la derivación desde él.',
  };
  const UTIL_COLOR = '#b5527c';
  let util = null;           // { kind, dim/marks: vistas tocadas al resaltar, count }
  const utilText = (html) => { $('util-text').innerHTML = html; };

  function setUtil(kind) {
    const again = util && util.kind === kind;
    endUtil();
    if (!kind || again) return;
    if (portModeEl) stopPortMode();
    util = { kind, dim: [], marks: [], count: 0 };
    document.querySelectorAll('[data-util]').forEach((b) => b.classList.toggle('on', b.dataset.util === kind));
    wrap.classList.add('util-mode', 'util-' + kind);
    $('util-banner').hidden = false;
    utilText(UTIL_TEXT[kind]);
  }
  function clearNet() {
    util.dim.forEach((v) => { v.el.style.opacity = ''; });
    util.marks.forEach((v) => joint.highlighters.mask.remove(v, 'net'));
    util.dim = []; util.marks = [];
  }
  function endUtil() {
    if (!util) return;
    clearNet();
    wrap.classList.remove('util-mode', 'util-' + util.kind);
    util = null;
    document.querySelectorAll('[data-util]').forEach((b) => b.classList.remove('on'));
    $('util-banner').hidden = true;
  }
  document.querySelectorAll('[data-util]').forEach((b) => { b.onclick = () => setUtil(b.dataset.util); });
  $('util-done').onclick = () => endUtil();

  /* Red eléctrica: cables unidos por un mismo borne o por empalmes. start: { link } o { key } */
  function netFrom(start) {
    const keyOf = (end) => {
      const el = end && end.id ? graph.getCell(end.id) : null;
      if (!el) return null;
      return el instanceof Junction ? 'J' + el.id : el.id + '|' + (end.port || '');
    };
    const at = new Map();
    realLinks().forEach((l) => [l.source(), l.target()].forEach((end) => {
      const k = keyOf(end);
      if (!k) return;
      if (!at.has(k)) at.set(k, []);
      at.get(k).push(l);
    }));
    // bornes de alimentación con el mismo nombre en una pieza (los GND, 5V o 3.3V de una placa) van unidos por dentro
    const RAIL = /^(A?GND|0 ?V|5 ?V|3[.,]3 ?V|3V3|VCC|VIN|VBUS)$/i;
    const railName = (t) => { const b = String(t.name || '').split(' · ')[0].trim(); return RAIL.test(b) ? b.toUpperCase().replace(/\s|,/g, '').replace('3V3', '3.3V') : null; };
    const siblings = (k) => {
      if (k[0] === 'J') return [];
      const i = k.indexOf('|'), el = graph.getCell(k.slice(0, i));
      const ts = (el && el.get('terminals')) || [], me = ts.find((t) => t.id === k.slice(i + 1));
      const rail = me && railName(me);
      return rail ? ts.filter((t) => t !== me && railName(t) === rail).map((t) => el.id + '|' + t.id) : [];
    };
    const links = new Set(), nodes = new Set(), queue = [];
    const visit = (k) => {
      if (!k || nodes.has(k)) return;
      nodes.add(k);
      (at.get(k) || []).forEach((l) => { if (!links.has(l)) { links.add(l); queue.push(l); } });
      siblings(k).forEach(visit);
    };
    if (start.link) { links.add(start.link); queue.push(start.link); } else visit(start.key);
    while (queue.length) { const l = queue.shift(); visit(keyOf(l.source())); visit(keyOf(l.target())); }
    return { links: [...links], nodes: [...nodes] };
  }
  function showNet(start) {
    clearNet();
    const net = netFrom(start);
    const inNet = new Set(net.links.map((l) => l.id));
    realLinks().forEach((l) => {
      const v = l.findView(paper);
      if (!v) return;
      if (inNet.has(l.id)) {
        joint.highlighters.mask.add(v, { selector: 'line' }, 'net', { padding: 3, attrs: { stroke: UTIL_COLOR, 'stroke-width': 3, 'stroke-opacity': 0.75 } });
        util.marks.push(v);
      } else { v.el.style.opacity = '0.18'; util.dim.push(v); }
    });
    // solo los bornes que tienen cable (los de alimentación sin usar de una placa no se listan)
    const wired = new Set();
    net.links.forEach((l) => [l.source(), l.target()].forEach((e) => { if (e.id) wired.add(e.id + '|' + (e.port || '')); }));
    // agrupados por pieza: «Orange Pi Zero 3W: GND 6, GND 9 · LCD 16×2 I2C: GND»
    const byPart = new Map();
    let nTerms = 0;
    net.nodes.filter((k) => k[0] !== 'J' && wired.has(k)).forEach((k) => {
      const i = k.indexOf('|'), el = graph.getCell(k.slice(0, i));
      if (!el) return;
      const part = String(el.attr('title/text') || el.get('componentName') || 'Componente').replace(/\s*\(.*\)$/, '');
      const t = (el.get('terminals') || []).find((x) => x.id === k.slice(i + 1));
      if (!byPart.has(part)) byPart.set(part, []);
      byPart.get(part).push(t && t.name ? t.name.replace(/ · pin (\d+)$/, ' $1') : '?');
      nTerms++;
    });
    const shown = [...byPart].map(([p, ts]) => '<b>' + esc(p) + ':</b> ' + ts.slice(0, 6).map(esc).join(', ') + (ts.length > 6 ? ' +' + (ts.length - 6) : '')).join(' · ');
    utilText('<b>Red:</b> ' + net.links.length + (net.links.length === 1 ? ' cable' : ' cables') + ', ' + nTerms +
      (nTerms === 1 ? ' borne' : ' bornes') + '. ' + shown);
  }

  function utilLinkClick(l, x, y) {
    if (isArrow(l)) return;
    if (util.kind === 'net') showNet({ link: l });
    else if (util.kind === 'split') {
      if (!l.source().id || !l.target().id) return;
      const v = l.findView(paper), q = v && v.getClosestPoint({ x, y });
      if (!q) return;
      splitLinkAt(l, q);
      util.count++;
      utilText('<b>Partir cable:</b> ' + util.count + (util.count === 1 ? ' empalme puesto' : ' empalmes puestos') + '. Arrastra desde el empalme para sacar la derivación.');
    }
  }
  function utilElementClick(view, evt) {
    if (util.kind !== 'net') return;
    if (view.model instanceof Junction) { showNet({ key: 'J' + view.model.id }); return; }
    const m = evt.target.closest && evt.target.closest('[port]');
    if (m) showNet({ key: view.model.id + '|' + m.getAttribute('port') });
  }
  paper.on('element:magnet:pointerclick', (view, evt, magnet) => {
    if (!util || util.kind !== 'net') return;
    const port = view.findAttribute('port', magnet);
    if (port) showNet({ key: view.model.id + '|' + port });
  });

  // Ventana de las herramientas con opciones (en serie, reemplazar, buscar y reemplazar)
  const toolModal = $('modal-tool');
  let toolReturn = null;
  function openTool(title, html) {
    toolReturn = document.activeElement;
    $('tool-title').textContent = title;
    $('tool-body').innerHTML = html;
    toolModal.classList.add('open');
    const first = $('tool-body').querySelector('input, select, button');
    if (first) first.focus();
  }
  function closeTool() {
    toolModal.classList.remove('open');
    if (toolReturn && toolReturn.focus) toolReturn.focus();
    toolReturn = null;
  }
  $('tool-close').onclick = closeTool;
  toolModal.addEventListener('pointerdown', (e) => { if (e.target === toolModal) closeTool(); });
  toolModal.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeTool(); } });

  /* Duplicar en serie: n copias de la selección (con sus cables internos) en fila o columna.
     Los nombres que acaban en número siguen la cuenta: K1 → K2, K3… */
  function openSeries() {
    const els = currentCells().filter((c) => c.isElement());
    if (!els.length) { toast('Elige primero lo que quieres repetir: una pieza o varias', 'error'); return; }
    const bb = graph.getCellsBBox(els);
    openTool('Duplicar en serie',
      field('Copias', '<input type="number" id="t-n" min="1" max="50" value="3">') +
      field('Dirección', '<select id="t-dir"><option value="r">A la derecha</option><option value="d">Hacia abajo</option><option value="l">A la izquierda</option><option value="u">Hacia arriba</option></select>') +
      field('Separación entre copias (px)', '<input type="number" id="t-gap" min="0" step="' + GRID + '" value="' + 2 * GRID + '">') +
      '<label class="check"><input type="checkbox" id="t-num" checked> Numerar los nombres (K1 → K2, K3…)</label>' +
      '<p class="help">Cada copia se desplaza el tamaño de la selección (' + Math.round(bb.width) + ' × ' + Math.round(bb.height) +
      ' px) más la separación. Los cables entre las piezas elegidas también se copian.</p>' +
      '<div class="props-actions"><button class="btn btn-primary" id="t-ok">Crear copias</button></div>');
    $('t-ok').onclick = () => {
      const n = Math.min(50, Math.max(1, Math.round(+$('t-n').value || 1)));
      const gap = Math.max(0, +$('t-gap').value || 0);
      const step = { r: [bb.width + gap, 0], l: [-(bb.width + gap), 0], d: [0, bb.height + gap], u: [0, -(bb.height + gap)] }[$('t-dir').value];
      const num = $('t-num').checked;
      closeTool();
      duplicateSeries(els, n, step[0], step[1], num);
    };
  }
  function duplicateSeries(els, n, dx, dy, numbered) {
    const sub = els.concat(innerLinks(els));
    let no = nextWireNo();
    const made = [];
    graph.startBatch('series');
    for (let i = 1; i <= n; i++) {
      const clones = Object.values(graph.cloneSubgraph(sub));
      clones.forEach((c) => {
        if (c.isElement()) {
          c.translate(dx * i, dy * i);
          const m = numbered && /^(.*?)(\d+)$/.exec(String(c.attr('title/text') || ''));
          if (m) c.attr('title/text', m[1] + (Number(m[2]) + i));
        } else c.vertices(c.vertices().map((p) => ({ x: p.x + dx * i, y: p.y + dy * i })));
      });
      graph.addCells(clones);
      clones.filter((c) => c.isLink()).forEach((c) => { c.set('wireNo', no); setWireLabel(c, 'C' + no); no++; });
      made.push(...clones);
    }
    graph.stopBatch('series');
    setGroup(made);
    toast(n + (n === 1 ? ' copia creada' : ' copias creadas'), 'ok');
  }

  /* Reemplazar componente: la pieza nueva ocupa el mismo sitio y los cables pasan al borne con el
     mismo nombre (si no lo hay, al de la misma posición en la lista; si tampoco, quedan sueltos). */
  const replaceable = (c) => c && c.isElement() && !(c instanceof Junction) && !isAnno(c);
  function openReplace() {
    const el = replaceable(selected) ? selected : null;
    if (!el) { toast('Elige primero el componente que quieres cambiar', 'error'); return; }
    openTool('Reemplazar ' + (el.attr('title/text') || el.get('componentName')),
      '<input class="search" id="t-q" type="search" placeholder="Buscar en la biblioteca…" aria-label="Buscar en la biblioteca" style="width:100%">' +
      '<div class="t-list" id="t-list"></div>' +
      '<p class="help">Los cables pasan al borne con el mismo nombre en la pieza nueva. Si no hay ninguno igual, se usa el de la misma posición en la lista de bornes.</p>');
    const draw = () => {
      const q = $('t-q').value.trim().toLowerCase();
      const items = library.filter((c) => c.kind !== 'junction' && c.id !== el.get('componentId') && (!q || (c.name + ' ' + c.category).toLowerCase().includes(q))).slice(0, 80);
      $('t-list').innerHTML = items.length ? items.map((c) => '<button class="t-item" data-id="' + c.id + '"><b>' + esc(c.name) + '</b><small>' +
        esc(c.category || '') + ' · ' + (c.terminals || []).length + ' bornes</small></button>').join('') : '<p class="help">Sin resultados.</p>';
    };
    $('t-q').addEventListener('input', draw);
    draw();
    $('t-list').onclick = (e) => {
      const b = e.target.closest('.t-item');
      if (!b) return;
      const comp = library.find((c) => c.id === Number(b.dataset.id));
      closeTool();
      if (comp) replaceComponent(el, comp);
    };
  }
  function replaceComponent(old, comp) {
    const c0 = old.getBBox().center();
    const neu = buildElement(comp, c0.x - comp.width / 2, c0.y - comp.height / 2);
    const norm = (s) => String(s || '').split(' · ')[0].trim().toLowerCase();
    const oldTs = old.get('terminals') || [], newTs = neu.get('terminals') || [];
    const mapPort = (pid) => {
      const i = oldTs.findIndex((t) => t.id === pid);
      if (i < 0) return null;
      return newTs.find((t) => norm(t.name) === norm(oldTs[i].name)) || newTs[i] || null;
    };
    graph.startBatch('replace');
    neu.set('layer', old.get('layer'));
    const title = old.attr('title/text');
    if (title && title !== old.get('componentName')) neu.attr('title/text', title);      // conserva K1, Q2…
    graph.addCell(neu);
    if (old.angle()) neu.rotate(old.angle(), true);
    let moved = 0;
    const loose = [];
    graph.getConnectedLinks(old).forEach((l) => ['source', 'target'].forEach((end) => {
      const e = l.get(end);
      if (e.id !== old.id) return;
      const t = mapPort(e.port);
      if (t) { l.set(end, { id: neu.id, port: t.id }); moved++; return; }
      const v = l.findView(paper), p = v && (end === 'source' ? v.sourcePoint : v.targetPoint);
      l.set(end, p ? { x: p.x, y: p.y } : c0);
      loose.push(l);
    }));
    old.remove();
    graph.stopBatch('replace');
    if (loose.length) {
      setGroup([neu].concat(loose));
      toast('Cambiado por ' + comp.name + ': ' + moved + ' cable(s) reconectados y ' + loose.length + ' suelto(s), seleccionados para que los conectes', 'error', 7000);
    } else {
      select(neu);
      toast('Cambiado por ' + comp.name + ': ' + moved + ' cable(s) reconectados', 'ok');
    }
  }

  /* Seleccionar iguales: todas las piezas del mismo modelo, o todos los cables del mismo tipo. */
  function selectSame() {
    const base = selected || group[0];
    if (!base) { toast('Elige primero una pieza o un cable', 'error'); return; }
    let cells;
    if (base.isLink()) {
      const arrow = isArrow(base), wt = base.get('wireType');
      cells = graph.getLinks().filter((l) => isArrow(l) === arrow && (arrow || l.get('wireType') === wt));
    } else {
      const kind = (e) => (e instanceof Junction ? 'J' : e instanceof Note ? 'N' : e instanceof Zone ? 'Z' : 'C:' + (e.get('componentId') || e.get('componentName')));
      const k = kind(base);
      cells = graph.getElements().filter((e) => kind(e) === k);
    }
    cells = cells.filter((c) => !hiddenEff(c) && !lockedEff(c));
    setGroup(cells);
    toast(cells.length + (cells.length === 1 ? ' seleccionado' : ' seleccionados'), 'ok');
  }

  /* Buscar y reemplazar en nombres de piezas, etiquetas de cables y textos o zonas. */
  function openFindReplace() {
    openTool('Buscar y reemplazar texto',
      field('Buscar', '<input type="text" id="t-find" autocomplete="off">') +
      field('Reemplazar por', '<input type="text" id="t-rep" autocomplete="off">') +
      '<label class="check"><input type="checkbox" id="t-case"> Distinguir mayúsculas</label>' +
      '<label class="check"><input type="checkbox" id="t-whole"> Solo palabras completas</label>' +
      field('Dónde', '<label class="check"><input type="checkbox" id="t-in-comp" checked> Nombres de piezas</label>' +
        '<label class="check"><input type="checkbox" id="t-in-wire" checked> Etiquetas de cables</label>' +
        '<label class="check"><input type="checkbox" id="t-in-note" checked> Textos y zonas</label>') +
      '<p class="help" id="t-count" role="status"></p>' +
      '<div class="props-actions"><button class="btn btn-primary" id="t-ok">Reemplazar todo</button></div>');
    const targets = () => {
      const out = [];
      if ($('t-in-comp').checked) graph.getElements().forEach((e) => { if (replaceable(e)) out.push({ get: () => String(e.attr('title/text') || ''), set: (v) => e.attr('title/text', v) }); });
      if ($('t-in-wire').checked) realLinks().forEach((l) => out.push({ get: () => wireName(l), set: (v) => setWireLabel(l, v) }));
      if ($('t-in-note').checked) graph.getElements().forEach((e) => { if (isAnno(e)) out.push({ get: () => String(e.attr('label/text') || ''), set: (v) => e.attr('label/text', v) }); });
      return out;
    };
    const pattern = () => {
      const f = $('t-find').value;
      if (!f) return null;
      const s = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp($('t-whole').checked ? '(?<![\\p{L}\\p{N}])' + s + '(?![\\p{L}\\p{N}])' : s, ($('t-case').checked ? 'g' : 'gi') + 'u');
    };
    const count = () => {
      const r = pattern();
      if (!r) { $('t-count').textContent = 'Escribe lo que quieres buscar.'; return 0; }
      let hits = 0, items = 0;
      targets().forEach((t) => { const m = t.get().match(r); if (m) { hits += m.length; items++; } });
      $('t-count').textContent = hits ? hits + ' coincidencia(s) en ' + items + ' elemento(s).' : 'Sin coincidencias.';
      return hits;
    };
    ['t-find', 't-case', 't-whole', 't-in-comp', 't-in-wire', 't-in-note'].forEach((id) => { $(id).addEventListener('input', count); $(id).addEventListener('change', count); });
    count();
    $('t-ok').onclick = () => {
      const r = pattern();
      if (!r || !count()) return;
      const rep = $('t-rep').value;
      let n = 0;
      graph.startBatch('find-replace');
      targets().forEach((t) => { const v = t.get(), nv = v.replace(r, rep); if (nv !== v) { t.set(nv); n++; } });
      graph.stopBatch('find-replace');
      closeTool();
      renderProps();
      toast(n + (n === 1 ? ' elemento cambiado' : ' elementos cambiados'), 'ok');
    };
  }

  $('btn-series').onclick = openSeries;
  $('btn-replace').onclick = openReplace;
  $('btn-same').onclick = selectSame;
  $('btn-findrep').onclick = openFindReplace;

  // Biblioteca

  async function loadLibrary() {
    if (!library.length) $('library').innerHTML = '<p class="help" role="status" style="padding:8px">Cargando biblioteca…</p>';
    try {
      library = await api.listComponents();
    } catch (e) {
      $('library').innerHTML = '<div class="help" role="alert" style="padding:8px">No se pudo cargar la biblioteca (' + esc(e.message) +
        '). Comprueba que el servidor esté en marcha. <button class="btn btn-sm" id="lib-retry">Reintentar</button></div>';
      $('lib-retry').onclick = () => loadLibrary().catch(() => { /* el aviso ya está en el panel */ });
      throw e;
    }
    renderLibrary();
  }

  function renderLibrary() {
    const q = $('lib-search').value.trim().toLowerCase();
    const items = library.filter((c) => !q || (c.name + ' ' + c.category).toLowerCase().includes(q));
    const cats = {};
    items.forEach((c) => { (cats[c.category] = cats[c.category] || []).push(c); });
    const html = Object.keys(cats).sort((a, b) => a.localeCompare(b, 'es')).map((cat) =>
      '<div class="lib-cat">' + esc(cat) + '</div>' + cats[cat].map((c) => {
        const thumb = c.kind === 'junction' ? '<span class="dot"></span>'
          : c.image ? '<img src="' + esc(c.image) + '" alt="">'
          : '<span class="box" style="background:' + esc(c.color) + '"></span>';
        const about = window.Fichas ? Fichas.part(c.name) : '';
        return '<div class="lib-item" draggable="true" tabindex="0" role="button" data-id="' + c.id + '" title="' +
          esc((about ? about + '\n\n' : '') + 'Arrastra al plano, haz clic o pulsa Enter para añadir') + '">' +
          '<span class="lib-thumb">' + thumb + '</span>' +
          '<span class="lib-name">' + esc(c.name) + '<small>' + (c.terminals || []).length + ' bornes</small></span></div>';
      }).join('')).join('');
    $('library').innerHTML = html || '<p class="help" style="padding:8px">Sin resultados.</p>';
  }

  $('lib-search').addEventListener('input', renderLibrary);
  $('lib-reload').onclick = async () => { await loadLibrary(); toast('Biblioteca actualizada', 'ok'); };

  $('library').addEventListener('dragstart', (e) => {
    const item = e.target.closest('.lib-item');
    if (!item) return;
    e.dataTransfer.setData('text/plain', item.dataset.id);
    e.dataTransfer.effectAllowed = 'copy';
  });
  // con el teclado: Enter o espacio añade la pieza igual que un clic
  $('library').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('lib-item')) { e.preventDefault(); e.target.click(); }
  });
  $('library').addEventListener('click', (e) => {
    const item = e.target.closest('.lib-item');
    if (!item) return;
    const comp = library.find((c) => c.id === Number(item.dataset.id));
    const r = wrap.getBoundingClientRect();
    const p = paper.clientToLocalPoint(r.left + r.width / 2, r.top + r.height / 2);
    addComponent(comp, p.x - comp.width / 2, p.y - comp.height / 2);
  });

  wrap.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; wrap.classList.add('drop-over'); });
  wrap.addEventListener('dragleave', (e) => { if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('drop-over'); });
  wrap.addEventListener('drop', (e) => {
    e.preventDefault();
    wrap.classList.remove('drop-over');
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      insertImages(e.dataTransfer.files, { x: e.clientX, y: e.clientY });
      return;
    }
    const comp = library.find((c) => c.id === Number(e.dataTransfer.getData('text/plain')));
    if (!comp) return;
    const p = paper.clientToLocalPoint(e.clientX, e.clientY);
    addComponent(comp, p.x - comp.width / 2, p.y - comp.height / 2);
  });

  // Barra de herramientas

  function renderWireTypeSelect() {
    $('wire-type').innerHTML = WIRE_TYPES.map((t) =>
      '<option value="' + t.id + '"' + (t.id === currentType ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('');
    $('wire-color').value = currentColor || wireType(currentType).color;
    renderToolbarRecent();
  }
  $('wire-type').addEventListener('change', (e) => { currentType = e.target.value; currentColor = null; renderWireTypeSelect(); markDirty(); renderProps(); });
  $('wire-color').addEventListener('input', (e) => {
    currentColor = e.target.value === wireType(currentType).color ? null : e.target.value;
    markDirty();
  });

  function setMode(mode) {
    routingMode = mode;
    $('mode-auto').classList.toggle('on', mode === 'auto');
    $('mode-manual').classList.toggle('on', mode === 'manual');
  }
  $('mode-auto').onclick = () => { setMode('auto'); markDirty(); };
  $('mode-manual').onclick = () => { setMode('manual'); markDirty(); };
  $('btn-reroute').onclick = () => {
    const links = graph.getLinks();
    if (!links.length) {
      const bare = graph.getElements().some((e) => e instanceof Component && !(e.get('terminals') || []).length);
      toast(bare
        ? 'Todavía no hay cables. «Re-trazar» solo ordena cables ya hechos: selecciona la imagen, pulsa «Marcar bornes en la imagen» y luego arrastra de un borne a otro.'
        : 'Todavía no hay cables: arrastra desde un borne (círculo) hasta otro para crear el primero.', 'error', 6000);
      return;
    }
    links.forEach((l) => { l.router(routerFor(routingMode)); if (routingMode === 'auto') l.vertices([]); });
    toast(links.length + ' cables re-trazados en modo ' + (routingMode === 'auto' ? 'automático' : 'manual'), 'ok');
  };

  $('snap-grid').addEventListener('change', (e) => {
    snapGrid = e.target.checked;
    refreshGrid();
    toast(snapGrid ? 'Imán activado: todo se ajusta a la cuadrícula de 10 px'
      : 'Imán desactivado: colocación libre al píxel', 'ok');
    markDirty();
  });

  $('show-labels').addEventListener('change', (e) => {
    showLabels = e.target.checked;
    graph.getLinks().forEach((l) => {
      if (!l.labels().length) return;
      l.label(0, { attrs: { labelText: { display: showLabels ? null : 'none' }, labelBody: { display: showLabels ? null : 'none' } } });
    });
    markDirty();
  });

  // Panel de propiedades

  function endName(end) {
    const el = end && end.id ? graph.getCell(end.id) : null;
    if (!el) return '-';
    if (el instanceof Junction) return 'Empalme';
    const name = el.attr('title/text') || el.get('componentName') || 'Componente';
    const t = (el.get('terminals') || []).find((x) => x.id === end.port);
    return name + (t && t.name ? ' · ' + t.name : '');
  }

  function wireName(l) {
    const lab = l.labels()[0];
    return (lab && lab.attrs && lab.attrs.labelText && lab.attrs.labelText.text) || ('C' + (l.get('wireNo') || '?'));
  }

  function field(label, inner) { return '<div class="field"><label>' + label + '</label>' + inner + '</div>'; }

  /* Ficha de la pieza: qué es y para qué sirve cada borne (static/js/fichas.js). */
  function fichaHtml(el) {
    if (!window.Fichas) return '';
    const comp = el.get('componentName') || '', about = Fichas.part(comp);
    const rows = (el.get('terminals') || []).map((t) => [t.name, Fichas.pin(comp, t.name)]).filter((r) => r[1]);
    if (!about && !rows.length) return '';
    return '<div class="ficha">' + (about ? '<p>' + esc(about) + '</p>' : '') +
      (rows.length ? '<details' + (rows.length <= 8 ? ' open' : '') + '><summary>Qué es cada borne (' + rows.length + ')</summary><dl>' +
        rows.map(([n, d]) => '<dt>' + esc(n) + '</dt><dd>' + esc(d) + '</dd>').join('') + '</dl></details>' : '') + '</div>';
  }

  /* Al pasar el ratón por un borne: su nombre y para qué sirve. */
  const pinTip = document.createElement('div');
  pinTip.className = 'pin-tip';
  pinTip.setAttribute('role', 'tooltip');
  $('paper').parentNode.appendChild(pinTip);
  $('paper').addEventListener('mousemove', (e) => {
    // los cables van encima: el borne puede estar debajo de la punta de un cable
    const hit = (e.target.closest && e.target.closest('[port]')) ||
      document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.hasAttribute && n.hasAttribute('port'));
    const portEl = hit || null, cellEl = portEl && portEl.closest('[model-id]');
    const el = cellEl && graph.getCell(cellEl.getAttribute('model-id'));
    const t = el && (el.get('terminals') || []).find((x) => x.id === portEl.getAttribute('port'));
    if (!t || !window.Fichas) { pinTip.style.display = 'none'; return; }
    const what = Fichas.pin(el.get('componentName'), t.name);
    pinTip.innerHTML = '<b>' + esc(t.name) + '</b> · ' + esc(el.attr('title/text') || el.get('componentName') || '') + (what ? '<span>' + esc(what) + '</span>' : '');
    const r = $('paper').parentNode.getBoundingClientRect();
    pinTip.style.display = 'block';
    const x = Math.min(e.clientX - r.left + 14, r.width - pinTip.offsetWidth - 8);
    pinTip.style.left = Math.max(8, x) + 'px';
    pinTip.style.top = (e.clientY - r.top + 14) + 'px';
  });
  $('paper').addEventListener('mouseleave', () => { pinTip.style.display = 'none'; });

  /* La toma de corriente es la red en el simulador: con o sin corriente y a qué tensión
     (los mismos valores por defecto que `mainsPart` en sim.js). */
  const MAINS_V = [110, 120, 127, 220, 230];
  const isMains = (el) => /^Toma de corriente/.test(el.get('componentName') || '');
  const mainsOf = (el) => Object.assign({ on: true, volts: 230 }, el.get('mains'));
  function mainsHtml(el) {
    if (!isMains(el)) return '';
    const m = mainsOf(el);
    return field('Red eléctrica en el simulador',
      '<label class="check"><input type="checkbox" id="p-mon"' + (m.on ? ' checked' : '') + '> Con corriente (energizada)</label>' +
      '<select id="p-mv" aria-label="Tensión de la red">' + MAINS_V.map((v) =>
        '<option value="' + v + '"' + (m.volts === v ? ' selected' : '') + '>' + v + ' V ~</option>').join('') + '</select>');
  }
  function bindMains(el) {
    if (!isMains(el)) return;
    const set = () => el.set('mains', { on: $('p-mon').checked, volts: Number($('p-mv').value) });
    $('p-mon').addEventListener('change', set);
    $('p-mv').addEventListener('change', set);
  }

  /* Paleta rápida + selector libre. Los colores de los tipos de cable van primero. */
  const PALETTE = ['#8b1a1a', '#d63031', '#e67e22', '#c9a400', '#2d8659', '#00a37a', '#0f9fa8', '#1f5fbf',
    '#6c5ce7', '#be185d', '#7c4a1e', '#2d3436', '#64748b', '#cbd5e1', '#ffffff'];
  const toHex = (c, fb) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : fb);
  const DROPPER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>';
  const swatch = (c, v) => '<span class="sw' + (c === v ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '" title="' + c + '"></span>';

  // Colores recientes (se recuerdan en este navegador, para todos los diagramas)
  const RECENT_KEY = 'editor-diagramas:recent-colors';
  let recentColors = [];
  try { recentColors = (JSON.parse(localStorage.getItem(RECENT_KEY)) || []).filter((c) => toHex(c)); } catch (_) { recentColors = []; }
  function recentHtml(v) {
    return recentColors.length
      ? '<span class="lbl">Recientes</span>' + recentColors.map((c) => swatch(c, v)).join('')
      : '<span class="lbl">Recientes: aún ninguno</span>';
  }
  function rememberColor(c) {
    c = toHex(c);
    if (!c) return;
    recentColors = [c].concat(recentColors.filter((x) => x !== c)).slice(0, 10);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentColors)); } catch (_) { /* modo privado */ }
    document.querySelectorAll('.recent-row').forEach((row) => {
      const inp = row.parentNode.querySelector('input[type=color]');
      row.innerHTML = recentHtml(inp ? inp.value : c);
    });
    renderToolbarRecent();
  }

  // Gotero: coge un color de cualquier sitio
  const imgCache = new Map();
  function imagePixel(href, u, v) {
    return new Promise((resolve) => {
      const draw = (img) => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const x = Math.min(c.width - 1, Math.max(0, Math.floor(u * c.width)));
        const y = Math.min(c.height - 1, Math.max(0, Math.floor(v * c.height)));
        const d = ctx.getImageData(x, y, 1, 1).data;
        resolve(d[3] < 10 ? '#ffffff' : '#' + [d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, '0')).join(''));
      };
      if (imgCache.has(href)) return draw(imgCache.get(href));
      const img = new Image();
      img.onload = () => { imgCache.set(href, img); draw(img); };
      img.onerror = () => resolve(null);
      img.src = href;
    });
  }
  /* Color de lo que hay bajo el puntero dentro del plano: foto (píxel real), cable, empalme,
     borne o fondo del componente. Se usa cuando el navegador no trae gotero propio. */
  async function colorAtEvent(e) {
    const view = paper.findView(e.target);
    if (!view) return '#ffffff';
    const m = view.model;
    const t = e.target;
    if (m.isLink()) return toHex(m.attr('line/stroke'), null);
    if (t.getAttribute && t.getAttribute('magnet')) return toHex(t.getAttribute('fill'), null);
    if (m instanceof Junction) return toHex((m.get('jStyle') || JUNCTION_DEFAULT).color, null);
    if (t.tagName === 'image' && m.attr('image/href')) {
      const p = paper.clientToLocalPoint(e.clientX, e.clientY);
      const r = m.getRelativePointFromAbsolute(p.x, p.y);
      const { width: w, height: h } = m.size();
      let u = r.x / w, v = r.y / h;
      if (m.get('flipX')) u = 1 - u;
      if (m.get('flipY')) v = 1 - v;
      return imagePixel(m.attr('image/href'), u, v);
    }
    return toHex(m.attr('body/fill'), '#ffffff');
  }
  let dropperResolve = null;
  function pickColor() {
    if (window.EyeDropper) {
      return new window.EyeDropper().open().then((r) => {
        const c = r.sRGBHex;
        if (toHex(c)) return c.toLowerCase();
        const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(c || '');
        return m ? '#' + m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('') : null;
      }).catch(() => null);
    }
    return new Promise((resolve) => {
      if (dropperResolve) dropperResolve(null);
      dropperResolve = resolve;
      wrap.classList.add('dropper-mode');
      toast('Gotero: haz clic en el plano sobre el color que quieres (Esc para cancelar)', 'ok', 5000);
    });
  }
  function endDropper(c) {
    if (!dropperResolve) return;
    const r = dropperResolve;
    dropperResolve = null;
    wrap.classList.remove('dropper-mode');
    r(c);
  }
  wrap.addEventListener('mousedown', async (e) => {
    if (!dropperResolve || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    endDropper(await colorAtEvent(e));
  }, true);
  wrap.addEventListener('click', (e) => { if (wrap.classList.contains('dropper-mode')) { e.stopPropagation(); } }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dropperResolve) { e.stopPropagation(); endDropper(null); } }, true);

  function colorPicker(id, value) {
    const v = toHex(value, '#000000');
    return '<div class="cpick"><div class="palette">' + PALETTE.map((c) => swatch(c, v)).join('') +
      '<input type="color" id="' + id + '" value="' + v + '" title="Cualquier otro color">' +
      '<button type="button" class="dropper-btn" title="Gotero: coge un color de la pantalla (también de tus fotos)">' + DROPPER_SVG + '</button></div>' +
      '<div class="palette recent-row">' + recentHtml(v) + '</div></div>';
  }
  function bindColor(id, fn) {
    const inp = $(id);
    const box = inp.closest('.cpick');
    const mark = (c) => box.querySelectorAll('.sw').forEach((s) => s.classList.toggle('on', s.dataset.c === c));
    const apply = (c, remember) => { inp.value = c; mark(c); fn(c); if (remember) rememberColor(c); };
    inp.addEventListener('input', () => { mark(inp.value); fn(inp.value); });
    inp.addEventListener('change', () => rememberColor(inp.value));   // al cerrar el selector
    box.addEventListener('click', async (e) => {
      const sw = e.target.closest('.sw');
      if (sw) { apply(sw.dataset.c, true); return; }
      if (e.target.closest('.dropper-btn')) {
        const c = await pickColor();
        if (c) apply(c, true);
      }
    });
  }

  // gotero y recientes también para el color de los cables nuevos (barra superior)
  function renderToolbarRecent() {
    const box = $('wire-recent');
    if (!box) return;
    box.innerHTML = recentColors.slice(0, 6).map((c) => swatch(c, $('wire-color').value)).join('');
  }
  function setNewWireColor(c) {
    $('wire-color').value = c;
    currentColor = c === wireType(currentType).color ? null : c;
    renderToolbarRecent();
    markDirty();
  }
  $('wire-color').addEventListener('change', (e) => rememberColor(e.target.value));
  $('wire-dropper').innerHTML = DROPPER_SVG;
  $('wire-dropper').onclick = async () => { const c = await pickColor(); if (c) { setNewWireColor(c); rememberColor(c); } };
  $('wire-recent').addEventListener('click', (e) => {
    const sw = e.target.closest('.sw');
    if (sw) { setNewWireColor(sw.dataset.c); rememberColor(sw.dataset.c); }
  });

  function setLinkColor(l, c) { l.attr('line/stroke', c); setWireLabel(l, wireName(l)); }

  /* Todo lo que está unido a este cable a través de empalmes (mismo potencial). */
  function samePotential(link) {
    const links = new Set([link]), junctions = new Set(), queue = [link];
    while (queue.length) {
      const l = queue.shift();
      [l.source(), l.target()].forEach((end) => {
        const el = end.id && graph.getCell(end.id);
        if (!(el instanceof Junction) || junctions.has(el)) return;
        junctions.add(el);
        graph.getConnectedLinks(el).forEach((x) => { if (!links.has(x)) { links.add(x); queue.push(x); } });
      });
    }
    return { links: [...links], junctions: [...junctions] };
  }

  function renderProps() {
    queueMicrotask(updateSelBar);
    const box = $('props');
    if (group.length) { renderGroupProps(box); return; }
    if (!selected) {
      box.innerHTML = '<div class="props help">' +
        '<h3>Cómo dibujar</h3>' +
        '<ol>' +
        '<li><b>Arrastra</b> un componente desde la izquierda al plano.</li>' +
        '<li>Elige el <b>tipo de cable</b> arriba (fase, neutro, +24 V…).</li>' +
        '<li><b>Arrastra desde un borne</b> (círculo) hasta otro borne. El cable se traza solo en ángulo recto.</li>' +
        '<li>Para derivar un cable a varios sitios usa un <b>Empalme / nodo</b>.</li>' +
        '<li>Haz clic en un cable para cambiar color, número o recorrido. Arrastra la línea para añadir un punto de paso.</li>' +
        '</ol>' +
        '<h3 style="margin-top:14px">Atajos</h3>' +
        '<p><kbd>Supr</kbd> borrar · <kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Y</kbd> deshacer/rehacer · <kbd>Ctrl</kbd>+<kbd>D</kbd> duplicar · <kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>X</kbd>/<kbd>V</kbd> copiar/cortar/pegar · <kbd>Ctrl</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> subir/bajar capa (con <kbd>Mayús</kbd>: al frente/al fondo) · <kbd>R</kbd> rotar · <kbd>Ctrl</kbd>+<kbd>S</kbd> guardar · flechas: mover · <kbd>T</kbd> texto · <kbd>Ctrl</kbd>+<kbd>F</kbd> buscar · clic derecho: menú · <kbd>F</kbd> modo enfoque · <kbd>Alt</kbd>+<kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> ocultar componentes / herramientas / propiedades</p>' +
        '<h3 style="margin-top:14px">Código de colores</h3>' +
        '<ul class="legend-list">' + WIRE_TYPES.map((t) =>
          '<li><span class="ln" style="border-color:' + t.color + (t.dash ? ';border-top-style:dashed' : '') + '"></span>' + esc(t.name) + '</li>').join('') +
        '</ul></div>';
      return;
    }

    if (selected.isLink() && selected.get('isArrow')) { renderArrowProps(box, selected); return; }
    if (selected.isLink()) {
      const l = selected;
      const color = l.attr('line/stroke');
      const wt = l.get('wireType');
      const auto = isAutoRouter(l.router());
      box.innerHTML = '<div class="props">' +
        '<h3>Cable ' + esc(wireName(l)) + '</h3>' +
        '<div class="sub">' + esc(endName(l.source())) + ' → ' + esc(endName(l.target())) + '</div>' +
        field('Etiqueta del cable', '<input type="text" id="p-label" value="' + esc(wireName(l)) + '" placeholder="Ej. C7 +24V">') +
        field('Tipo de cable', '<div class="chips">' + WIRE_TYPES.map((t) =>
          '<span class="chip' + (t.id === wt ? ' on' : '') + '" data-type="' + t.id + '"><span class="wire-swatch" style="background:' + t.color + '"></span>' + esc(t.name) + '</span>').join('') + '</div>') +
        field('Color del cable', colorPicker('p-color', color)) +
        field('Grosor', '<select id="p-width">' + [1.5, 2.4, 3.5, 5].map((w) =>
          '<option value="' + w + '"' + (Number(l.attr('line/strokeWidth')) === w ? ' selected' : '') + '>' + w + ' px</option>').join('') + '</select>') +
        '<label class="check"><input type="checkbox" id="p-dash"' + (l.attr('line/strokeDasharray') ? ' checked' : '') + '> Línea discontinua</label>' +
        field('Trazado de este cable', '<div class="row">' +
          '<button class="tool-btn' + (auto ? ' on' : '') + '" id="p-auto">Automático</button>' +
          '<button class="tool-btn' + (!auto ? ' on' : '') + '" id="p-manual">Manual</button></div>') +
        field('Capa (grupo)', layerSelect('p-llayer', layerOf(l).id)) +
        '<div class="props-actions">' +
        '<button class="btn btn-sm" id="p-novert">Quitar puntos de paso</button>' +
        '<button class="btn btn-sm" id="p-spread" title="Pinta del mismo color y tipo todos los cables y empalmes unidos a este por empalmes">Mismo color en todo el tramo</button>' +
        '<button class="btn btn-sm btn-danger" id="p-del">Eliminar cable</button></div>' +
        '<p class="help" style="margin-top:12px">Arrastra sobre la línea para añadir un punto de paso; arrastra los extremos para cambiar de borne.</p>' +
        '</div>';

      $('p-label').addEventListener('input', (e) => setWireLabel(l, e.target.value.trim()));
      box.querySelectorAll('.chip').forEach((ch) => ch.addEventListener('click', () => {
        const t = wireType(ch.dataset.type);
        l.set('wireType', t.id);
        l.attr('line/stroke', t.color);
        l.attr('line/strokeDasharray', t.dash || null);
        setWireLabel(l, wireName(l));
        renderProps();
      }));
      bindColor('p-color', (c) => setLinkColor(l, c));
      $('p-spread').onclick = () => {
        const { links: ls, junctions: js } = samePotential(l);
        const c = l.attr('line/stroke');
        ls.forEach((x) => { x.set('wireType', l.get('wireType')); x.attr('line/strokeDasharray', l.attr('line/strokeDasharray') || null); setLinkColor(x, c); });
        js.forEach((j) => styleJunction(j, { color: c }));
        toast(ls.length + ' cable(s) y ' + js.length + ' empalme(s) pintados', 'ok');
      };
      $('p-width').addEventListener('change', (e) => l.attr('line/strokeWidth', Number(e.target.value)));
      $('p-dash').addEventListener('change', (e) => l.attr('line/strokeDasharray', e.target.checked ? '9 5' : null));
      $('p-auto').onclick = () => { l.router(routerFor('auto')); renderProps(); };
      $('p-manual').onclick = () => { l.router(routerFor('manual')); renderProps(); };
      $('p-novert').onclick = () => l.vertices([]);
      bindLayerSelect('p-llayer', () => [l]);
      $('p-del').onclick = () => l.remove();
      return;
    }

    const el = selected;
    if (el instanceof Note || el instanceof Zone) { renderAnnoProps(box, el); return; }
    if (el instanceof TitleBlock) { renderTitleBlockProps(box, el); return; }
    const links = graph.getConnectedLinks(el);
    const connHtml = links.length
      ? '<ul class="conn-list">' + links.map((l) => {
        const other = l.source().id === el.id ? l.target() : l.source();
        const mine = l.source().id === el.id ? l.source() : l.target();
        const t = (el.get('terminals') || []).find((x) => x.id === mine.port);
        return '<li data-link="' + l.id + '" style="border-left-color:' + esc(l.attr('line/stroke')) + '"><b>' + esc(wireName(l)) + '</b> · ' +
          esc(t && t.name ? t.name : '•') + ' → ' + esc(endName(other)) + '</li>';
      }).join('') + '</ul>'
      : '<p class="help">Sin cables todavía.</p>';

    if (el instanceof Junction) {
      const js = Object.assign({}, JUNCTION_DEFAULT, el.get('jStyle'));
      box.innerHTML = '<div class="props"><h3>Empalme / nodo</h3>' +
        '<div class="sub">Punto donde se unen varios cables del mismo potencial.</div>' +
        field('Posición del centro (X, Y)', '<div class="row"><input type="number" id="p-x" step="0.5" value="' + +(el.position().x + el.size().width / 2).toFixed(1) + '">' +
          '<input type="number" id="p-y" step="0.5" value="' + +(el.position().y + el.size().height / 2).toFixed(1) + '"></div>') +
        '<p class="help">Afina con las flechas del teclado (1 px; Mayús: 10 px). Suéltalo encima de un cable para clavarlo en él.</p>' +
        field('Color del punto', colorPicker('p-jcolor', js.color)) +
        field('Tamaño', '<select id="p-jsize">' + [[4, 'Pequeño'], [5.5, 'Normal'], [7.5, 'Grande']].map(([r, n]) =>
          '<option value="' + r + '"' + (js.r === r ? ' selected' : '') + '>' + n + '</option>').join('') + '</select>') +
        '<div class="props-actions">' +
        (links.length ? '<button class="btn btn-sm" id="p-jlinks" title="Pinta también los cables que llegan a este empalme">Pintar sus cables de este color</button>' : '') +
        (links.length === 2 ? '<button class="btn btn-sm" id="p-merge" title="Quita el empalme y deja un único cable de punta a punta">Unir en un solo cable</button>' : '') +
        '<button class="btn btn-sm btn-danger" id="p-del">Eliminar</button></div>' +
        field('Cables conectados (' + links.length + ')', connHtml) + '</div>';
      bindColor('p-jcolor', (c) => styleJunction(el, { color: c }));
      const moveJ = () => {
        const h = el.size().width / 2;
        el.position(Number($('p-x').value) - h, Number($('p-y').value) - h);
      };
      $('p-x').addEventListener('change', moveJ);
      $('p-y').addEventListener('change', moveJ);
      $('p-jsize').addEventListener('change', (e) => styleJunction(el, { r: Number(e.target.value) }));
      if ($('p-merge')) $('p-merge').onclick = () => mergeAtJunction(el);
      if ($('p-jlinks')) $('p-jlinks').onclick = () => {
        const c = Object.assign({}, JUNCTION_DEFAULT, el.get('jStyle')).color;
        links.forEach((l) => setLinkColor(l, c));
        toast(links.length + ' cable(s) pintados', 'ok');
      };
    } else {
      const size = el.size();
      const terms = el.get('terminals') || [];
      const marking = portModeEl === el;
      const hasImage = !!el.attr('image/href');
      const termHtml =
        (terms.length
          ? '<ul class="term-list">' + terms.map((t) =>
            '<li><input type="text" data-tid="' + esc(t.id) + '" value="' + esc(t.name) + '" placeholder="Nombre" title="Nombre del borne">' +
            '<span class="xy">' + Math.round(t.x * 100) + '%, ' + Math.round(t.y * 100) + '%</span>' +
            '<button class="icon-btn sm" data-del-term="' + esc(t.id) + '" title="Quitar este borne (y sus cables)">✕</button></li>').join('') + '</ul>'
          : '<p class="help">' + (el.get('isPicture')
            ? 'Esta imagen aún no tiene bornes. Pulsa el botón de abajo y haz clic sobre cada tornillo o punto de conexión de la foto.'
            : 'Sin bornes.') + '</p>') +
        '<div class="props-actions">' +
        '<button class="btn btn-sm' + (marking ? ' btn-primary' : '') + '" id="p-mark">' +
        (marking ? 'Terminar de marcar' : '＋ Marcar bornes en la imagen') + '</button>' +
        '<button class="btn btn-sm" id="p-savelib" title="Guarda imagen y bornes como componente reutilizable">Guardar en biblioteca</button></div>';
      box.innerHTML = '<div class="props">' +
        '<h3>' + esc(el.attr('title/text') || el.get('componentName')) + '</h3>' +
        '<div class="sub">' + esc(el.get('componentName') || '') + '</div>' +
        fichaHtml(el) +
        field('Nombre en el plano', '<input type="text" id="p-title" value="' + esc(el.attr('title/text') || '') + '" placeholder="Ej. PLC1, Q1, F2">') +
        mainsHtml(el) +
        field('Posición (X, Y)', '<div class="row"><input type="number" id="p-x" step="1" value="' + +el.position().x.toFixed(1) + '">' +
          '<input type="number" id="p-y" step="1" value="' + +el.position().y.toFixed(1) + '"></div>') +
        field('Tamaño (ancho × alto)', '<div class="row"><input type="number" id="p-w" min="10" step="1" value="' + Math.round(size.width) + '">' +
          '<input type="number" id="p-h" min="10" step="1" value="' + Math.round(size.height) + '"></div>') +
        '<label class="check"><input type="checkbox" id="p-ratio" checked> Mantener proporción</label>' +
        field('Giro (grados)', '<div class="row"><input type="number" id="p-angle" step="1" value="' + Math.round(el.angle()) + '">' +
          '<button class="btn btn-sm" id="p-rotl" title="Girar 90° a la izquierda">↺ 90°</button>' +
          '<button class="btn btn-sm" id="p-rotr" title="Girar 90° a la derecha">↻ 90°</button></div>') +
        '<div class="props-actions" style="margin-top:6px">' +
        '<button class="btn btn-sm" id="p-flipx" title="Voltea izquierda y derecha (los bornes también)">Espejo horizontal</button>' +
        '<button class="btn btn-sm" id="p-flipy" title="Voltea arriba y abajo (los bornes también)">Espejo vertical</button></div>' +
        '<p class="help">Asa cuadrada de la esquina: tamaño. Asa redonda de arriba: girar (Mayús = de 15 en 15°).</p>' +
        '<label class="check"><input type="checkbox" id="p-labels"' + (el.get('showTerminalLabels') !== false ? ' checked' : '') + '> Mostrar nombres de bornes</label>' +
        '<div class="props-actions">' +
        '<button class="btn btn-sm" id="p-dup">Duplicar</button>' +
        '<button class="btn btn-sm" id="p-sync" title="Vuelve a cargar foto y bornes desde la biblioteca">Actualizar desde biblioteca</button>' +
        '<button class="btn btn-sm btn-danger" id="p-del">Eliminar</button></div>' +
        field('Capa (grupo)', layerSelect('p-layer', layerOf(el).id)) +
        lookHtml(el, hasImage) +
        field('Bornes (' + terms.length + ')', termHtml) +
        field('Color de los bornes', colorPicker('p-tcolor', (el.get('termStyle') || {}).fill || '#ffffff')) +
        field('Tamaño de los bornes', '<select id="p-tsize">' + [[3.5, 'Pequeño'], [5, 'Normal'], [7, 'Grande']].map(([r, n]) =>
          '<option value="' + r + '"' + (((el.get('termStyle') || {}).r || 5) === r ? ' selected' : '') + '>' + n + '</option>').join('') + '</select>') +
        (hasImage ? '' :
          field('Color de fondo', colorPicker('p-fill', el.attr('body/fill'))) +
          field('Color del borde', colorPicker('p-stroke', el.attr('body/stroke')))) +
        field('Cables conectados (' + links.length + ')', connHtml) +
        '</div>';
      if (!el.get('componentId') || !library.some((c) => c.id === el.get('componentId'))) $('p-sync').style.display = 'none';
      box.querySelectorAll('input[data-tid]').forEach((inp) =>
        inp.addEventListener('input', () => renameTerminal(el, inp.dataset.tid, inp.value.trim())));
      box.querySelectorAll('[data-del-term]').forEach((b) =>
        b.addEventListener('click', () => removeTerminal(el, b.dataset.delTerm)));
      $('p-mark').onclick = () => (marking ? stopPortMode() : startPortMode(el));
      const setTerm = (patch) => { el.set('termStyle', Object.assign({ fill: '#ffffff', r: 5 }, el.get('termStyle'), patch)); applyPorts(el); };
      bindColor('p-tcolor', (c) => setTerm({ fill: c }));
      $('p-tsize').addEventListener('change', (e) => setTerm({ r: Number(e.target.value) }));
      if (!hasImage) {
        bindColor('p-fill', (c) => el.attr('body/fill', c));
        bindColor('p-stroke', (c) => el.attr('body/stroke', c));
      }
      $('p-savelib').onclick = () => saveToLibrary(el);

      $('p-title').addEventListener('input', (e) => el.attr('title/text', e.target.value));
      bindMains(el);
      const resize = (src) => {
        let w = Math.max(10, Number($('p-w').value) || size.width);
        let h = Math.max(10, Number($('p-h').value) || size.height);
        if ($('p-ratio').checked) {
          const k = size.height / size.width;
          if (src === 'w') { h = Math.round(w * k); $('p-h').value = h; } else { w = Math.round(h / k); $('p-w').value = w; }
        }
        el.resize(w, h);
      };
      $('p-w').addEventListener('change', () => resize('w'));
      $('p-h').addEventListener('change', () => resize('h'));
      $('p-labels').addEventListener('change', (e) => { el.set('showTerminalLabels', e.target.checked); applyPorts(el); });
      const moveC = () => el.position(Number($('p-x').value) || 0, Number($('p-y').value) || 0);
      $('p-x').addEventListener('change', moveC);
      $('p-y').addEventListener('change', moveC);
      $('p-angle').addEventListener('change', (e) => el.rotate(((Number(e.target.value) || 0) % 360 + 360) % 360, true));
      $('p-rotl').onclick = () => el.rotate(-90);
      $('p-rotr').onclick = () => el.rotate(90);
      $('p-flipx').onclick = () => { flip(el, 'x'); renderProps(); };
      $('p-flipy').onclick = () => { flip(el, 'y'); renderProps(); };
      $('p-dup').onclick = () => duplicateSelected();
      $('p-sync').onclick = () => syncFromLibrary(el);
      bindLook(el, hasImage);
      bindLayerSelect('p-layer', () => [el]);
    }
    $('p-del').onclick = () => (lockedEff(el) ? toast('Está bloqueado: desbloquéalo para eliminarlo', 'error') : el.remove());
    box.querySelectorAll('[data-link]').forEach((li) => li.addEventListener('click', () => select(graph.getCell(li.dataset.link))));
  }

  function renderGroupProps(box) {
    const els = groupElements(), links = group.filter((c) => c.isLink());
    const sel = links.length ? links : innerLinks(els);
    box.innerHTML = '<div class="props">' +
      '<h3>' + group.length + ' seleccionados</h3>' +
      '<div class="sub">' + els.length + ' componente(s)/empalme(s) · ' + links.length + ' cable(s)</div>' +
      '<p class="help">Arrastra cualquiera de ellos para mover todo junto, o usa las flechas del teclado ' +
      '(Mayús = paso largo). Ctrl o Mayús + clic añade o quita elementos.</p>' +
      (els.length > 1 ? field('Alinear', '<div class="align-grid">' +
        '<button class="btn btn-sm" data-al="left" title="Alinear a la izquierda">⇤ Izq.</button>' +
        '<button class="btn btn-sm" data-al="hcenter" title="Mismo centro vertical (en columna)">Centro en columna</button>' +
        '<button class="btn btn-sm" data-al="right" title="Alinear a la derecha">Der. ⇥</button>' +
        '<button class="btn btn-sm" data-al="top" title="Alinear arriba">⤒ Arriba</button>' +
        '<button class="btn btn-sm" data-al="vcenter" title="Mismo centro horizontal (en fila)">Centro en fila</button>' +
        '<button class="btn btn-sm" data-al="bottom" title="Alinear abajo">Abajo ⤓</button></div>') : '') +
      (els.length > 2 ? field('Distribuir a la misma distancia', '<div class="row"><button class="btn btn-sm" id="p-dish">Horizontal</button>' +
        '<button class="btn btn-sm" id="p-disv">Vertical</button></div>') : '') +
      (sel.length ? field('Color de los ' + sel.length + ' cable(s)', colorPicker('p-gcolor', sel[0].attr('line/stroke'))) : '') +
      field('Mover a la capa', layerSelect('p-glayer', '')) +
      field('Orden', layerButtons()) +
      '<div class="props-actions">' +
      '<button class="btn btn-sm" id="p-gcopy">Copiar (Ctrl+C)</button>' +
      '<button class="btn btn-sm" id="p-gcut">Cortar (Ctrl+X)</button>' +
      '<button class="btn btn-sm" id="p-glock">Bloquear</button>' +
      '<button class="btn btn-sm" id="p-gunlock">Desbloquear</button>' +
      '<button class="btn btn-sm" id="p-ghide">Ocultar</button></div>' +
      '<div class="props-actions">' +
      '<button class="btn btn-sm" id="p-gdup">Duplicar (Ctrl+D)</button>' +
      '<button class="btn btn-sm btn-danger" id="p-gdel">Eliminar (Supr)</button>' +
      '<button class="btn btn-sm" id="p-gnone">Deseleccionar (Esc)</button></div></div>';
    box.querySelectorAll('[data-al]').forEach((b) => b.addEventListener('click', () => alignGroup(b.dataset.al)));
    if ($('p-dish')) { $('p-dish').onclick = () => distributeGroup('h'); $('p-disv').onclick = () => distributeGroup('v'); }
    if (sel.length) bindColor('p-gcolor', (c) => sel.forEach((l) => setLinkColor(l, c)));
    $('p-gdup').onclick = duplicateGroup;
    bindLayerButtons(box, () => group.slice());
    bindLayerSelect('p-glayer', () => group.slice());
    $('p-gcopy').onclick = () => copySelection(false);
    $('p-gcut').onclick = () => copySelection(true);
    $('p-glock').onclick = () => setLocked(group.slice(), true);
    $('p-gunlock').onclick = () => setLocked(group.slice(), false);
    $('p-ghide').onclick = () => setHidden(group.slice(), true);
    $('p-gdel').onclick = deleteGroup;
    $('p-gnone').onclick = clearSelection;
  }

  function deleteGroup() {
    const cells = group.filter((c) => !lockedEff(c));
    if (cells.length < group.length) toast('Los elementos bloqueados no se eliminan', 'error');
    dropGroup();
    graph.removeCells(cells);
    renderProps();
  }

  function rotateSelected() {
    if (selected && selected.isElement() && !(selected instanceof Junction)) selected.rotate(90);
  }

  function duplicateSelected() {
    if (!selected || !selected.isElement()) return;
    const copy = selected.clone();
    copy.translate(30, 30);
    graph.addCell(copy);
    select(copy);
  }

  function syncFromLibrary(el) {
    const comp = library.find((c) => c.id === el.get('componentId'));
    if (!comp) { toast('Ese componente ya no existe en la biblioteca', 'error'); return; }
    el.set('terminals', (comp.terminals || []).map((t) => Object.assign({}, t)));
    el.set('componentName', comp.name);
    el.set('showTerminalLabels', comp.show_labels !== false);
    styleFromComponent(el, comp);
    applyPorts(el);
    renderProps();
    toast('Componente actualizado desde la biblioteca', 'ok');
  }

  // Serialización

  function keyForHref(href) {
    let k = keyByHref.get(href);
    if (!k) {
      k = 'img' + (++assetSeq) + '-' + Date.now().toString(36);
      keyByHref.set(href, k);
      assetByKey.set(k, href);
    }
    return k;
  }

  function serializeGraph() {
    const json = graph.toJSON();
    const used = {};
    json.cells.forEach((c) => {
      const href = c.attrs && c.attrs.image && c.attrs.image.href;
      if (href && href.indexOf('data:') === 0) {
        const k = keyForHref(href);
        c.attrs.image.href = 'asset:' + k;
        used[k] = href;
      }
    });
    return { json, used };
  }

  function serialize() {
    const { json, used } = serializeGraph();
    return { version: 1, graph: json, assets: used, settings: { showLabels, routingMode, currentType, currentColor, snapGrid, layers, activeLayer, wiresOnTop } };
  }

  function restoreGraph(json) {
    (json.cells || []).forEach((c) => {
      const href = c.attrs && c.attrs.image && c.attrs.image.href;
      if (href && href.indexOf('asset:') === 0) c.attrs.image.href = assetByKey.get(href.slice(6)) || '';
    });
    group = [];
    history.lock = true;
    graph.fromJSON(json);
    history.lock = false;
  }

  function loadData(data) {
    Object.entries((data && data.assets) || {}).forEach(([k, v]) => {
      assetByKey.set(k, v); keyByHref.set(v, k);
      const n = Number((k.match(/^img(\d+)/) || [])[1]);
      if (n > assetSeq) assetSeq = n;
    });
    const s = (data && data.settings) || {};
    showLabels = s.showLabels !== false;
    $('show-labels').checked = showLabels;
    snapGrid = s.snapGrid !== false;
    $('snap-grid').checked = snapGrid;
    refreshGrid();
    setMode(s.routingMode === 'manual' ? 'manual' : 'auto');
    if (s.currentType && WIRE_TYPES.some((t) => t.id === s.currentType)) currentType = s.currentType;
    currentColor = /^#[0-9a-f]{6}$/i.test(s.currentColor || '') ? s.currentColor : null;
    renderWireTypeSelect();
    if (Array.isArray(s.layers) && s.layers.length) {
      layers = s.layers.map((l) => ({ id: String(l.id), name: String(l.name || 'Capa'), visible: l.visible !== false, locked: !!l.locked }));
    }
    activeLayer = layerById(s.activeLayer) ? s.activeLayer : layers[layers.length - 1].id;
    wiresOnTop = s.wiresOnTop !== false;
    $('lay-wires').checked = wiresOnTop;
    if (data && data.graph) restoreGraph(JSON.parse(JSON.stringify(data.graph)));
    // lo que no tenía capa (diagramas anteriores) queda fijado en la capa original
    const def = (layerById('base') || layers[0]).id;
    graph.getCells().forEach((c) => { if (!layerById(c.get('layer'))) c.set('layer', def, { silent: true }); applyVisibility(c); });
  }

  // Deshacer y rehacer

  const history = { stack: [], index: -1, lock: false, timer: null };

  function snapshot() { return JSON.stringify(serializeGraph().json); }

  function pushHistory() {
    if (history.lock) return;
    const s = snapshot();
    if (history.stack[history.index] === s) return;
    history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push(s);
    if (history.stack.length > 80) history.stack.shift();
    history.index = history.stack.length - 1;
    updateUndoButtons();
  }

  function scheduleHistory() {
    clearTimeout(history.timer);
    history.timer = setTimeout(pushHistory, 350);
  }

  function updateUndoButtons() {
    $('btn-undo').disabled = history.index <= 0;
    $('btn-redo').disabled = history.index >= history.stack.length - 1;
  }

  function goHistory(step) {
    clearTimeout(history.timer);
    pushHistory();
    const i = history.index + step;
    if (i < 0 || i >= history.stack.length) return;
    history.index = i;
    clearSelection();
    restoreGraph(JSON.parse(history.stack[i]));
    updateUndoButtons();
    markDirty();
  }
  const undo = () => goHistory(-1);
  const redo = () => goHistory(1);
  $('btn-undo').onclick = undo;
  $('btn-redo').onclick = redo;

  graph.on('add remove change', (cell) => {
    if (history.lock) return;
    // Un cable que se está arrastrando todavía no tiene borne en un extremo: no cuenta.
    if (cell && cell.isLink && cell.isLink() && (!cell.source().id || !cell.target().id)) return;
    markDirty();
    scheduleHistory();
  });

  // Guardar

  let changeSeq = 0, savedSeq = 0, saving = false, pendingSave = false, saveTimer = null, lastThumb = 0;

  function setState(kind, msg) {
    const el = $('save-state');
    el.className = 'save-state' + (kind === 'dirty' ? ' dirty' : kind === 'error' ? ' error' : '');
    el.textContent = msg;
  }

  function markDirty() {
    changeSeq++;
    setState('dirty', 'Cambios sin guardar');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(false), 2500);
  }

  async function save(manual) {
    clearTimeout(saveTimer);
    if (saving) { pendingSave = true; return; }
    saving = true;
    const seq = changeSeq;
    setState('saving', 'Guardando…');
    try {
      const payload = { name: $('diagram-name').value.trim() || 'Diagrama sin nombre', data: serialize() };
      if (manual || Date.now() - lastThumb > 30000) {
        payload.thumbnail = await makeThumbnail();
        lastThumb = Date.now();
      }
      await api.updateDiagram(diagramId, payload);
      savedSeq = seq;
      const t = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
      if (changeSeq === savedSeq) setState('saved', 'Guardado ' + t);
      if (manual) toast('Diagrama guardado', 'ok');
    } catch (e) {
      setState('error', 'Error al guardar');
      toast('No se pudo guardar: ' + e.message, 'error');
    } finally {
      saving = false;
      if (pendingSave || changeSeq !== savedSeq) { pendingSave = false; saveTimer = setTimeout(() => save(false), 1200); }
    }
  }

  $('btn-save').onclick = () => save(true);
  // El simulador lee el diagrama guardado: se guarda antes de abrirlo.
  $('btn-guia').onclick = async (e) => {
    e.preventDefault();
    if (changeSeq !== savedSeq || saving) await save(false);
    location.href = '/guia?id=' + diagramId;
  };
  $('btn-sim').onclick = async () => {
    if (changeSeq !== savedSeq || saving) await save(false);
    location.href = '/simulador?id=' + diagramId;
  };
  $('diagram-name').addEventListener('input', () => { document.title = $('diagram-name').value + ' · Diagramas eléctricos'; markDirty(); });
  window.addEventListener('beforeunload', (e) => {
    if (changeSeq !== savedSeq) { e.preventDefault(); e.returnValue = ''; }
  });

  // Exportar

  function buildExportSVG(padding) {
    padding = padding == null ? 30 : padding;
    const area = paper.getContentArea();
    if (!area || !area.width) return null;
    const x = area.x - padding, y = area.y - padding;
    const w = Math.ceil(area.width + padding * 2), h = Math.ceil(area.height + padding * 2);

    const svg = paper.svg.cloneNode(true);
    const path = [];
    let n = paper.layers;
    while (n && n !== paper.svg) { path.unshift(Array.prototype.indexOf.call(n.parentNode.children, n)); n = n.parentNode; }
    let layers = svg;
    path.forEach((i) => { layers = layers.children[i]; });
    if (layers) layers.removeAttribute('transform');
    // Fuera herramientas de edición y resaltados de selección: no forman parte del plano.
    svg.querySelectorAll('[class]').forEach((node) => {
      const cls = node.getAttribute('class') || '';
      if (/joint-tool|joint-highlight|(^|\s)tools?(\s|$)/.test(cls)) node.remove();
      else if (/available-(magnet|cell)/.test(cls)) node.setAttribute('class', cls.replace(/\s*joint-available-(magnet|cell)|\s*available-(magnet|cell)/g, ''));
    });
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.setAttribute('viewBox', x + ' ' + y + ' ' + w + ' ' + h);
    svg.removeAttribute('style');
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', x); bg.setAttribute('y', y); bg.setAttribute('width', w); bg.setAttribute('height', h);
    bg.setAttribute('fill', '#ffffff');
    svg.insertBefore(bg, svg.firstChild);
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = 'text{font-family:' + FONT + '}';
    svg.insertBefore(style, svg.firstChild);
    return { svg, w, h };
  }

  function svgToDataURL(svg, w, h, scale, type, quality) {
    return new Promise((resolve, reject) => {
      const xml = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL(type || 'image/png', quality));
      };
      img.onerror = () => reject(new Error('No se pudo rasterizar el diagrama'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    });
  }

  async function makeThumbnail() {
    const out = buildExportSVG(20);
    if (!out) return '';
    const scale = Math.min(1, 420 / out.w, 260 / out.h);
    try { return await svgToDataURL(out.svg, out.w, out.h, scale, 'image/jpeg', 0.78); } catch (_) { return ''; }
  }

  $('btn-svg').onclick = () => {
    const out = buildExportSVG(30);
    if (!out) { toast('El diagrama está vacío'); return; }
    download(slug($('diagram-name').value) + '.svg', new XMLSerializer().serializeToString(out.svg), 'image/svg+xml');
  };

  $('btn-png').onclick = async () => {
    const out = buildExportSVG(30);
    if (!out) { toast('El diagrama está vacío'); return; }
    try {
      const url = await svgToDataURL(out.svg, out.w, out.h, 2, 'image/png');
      const a = document.createElement('a');
      a.href = url; a.download = slug($('diagram-name').value) + '.png';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast(e.message, 'error'); }
  };

  // Lista de conexiones

  function connectionRows() {
    return graph.getLinks().filter((l) => !l.get('isArrow')).map((l) => ({
      no: Number(l.get('wireNo')) || 0,
      label: wireName(l),
      type: wireType(l.get('wireType')).name,
      color: l.attr('line/stroke'),
      from: endName(l.source()),
      to: endName(l.target()),
    })).sort((a, b) => a.no - b.no);
  }

  $('btn-conns').onclick = () => {
    const rows = connectionRows();
    $('conns-body').innerHTML = rows.length
      ? '<table class="table"><thead><tr><th>Cable</th><th>Tipo</th><th>Desde</th><th>Hasta</th></tr></thead><tbody>' +
        rows.map((r) => '<tr><td><span class="wire-swatch" style="background:' + esc(r.color) + '"></span> <b>' + esc(r.label) +
          '</b></td><td>' + esc(r.type) + '</td><td>' + esc(r.from) + '</td><td>' + esc(r.to) + '</td></tr>').join('') +
        '</tbody></table>'
      : '<p class="help">Todavía no hay cables en el diagrama.</p>';
    $('modal-conns').classList.add('open');
  };
  $('conns-close').onclick = () => $('modal-conns').classList.remove('open');
  $('modal-conns').addEventListener('click', (e) => { if (e.target.id === 'modal-conns') $('modal-conns').classList.remove('open'); });
  $('conns-csv').onclick = () => {
    const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const csv = '﻿' + ['Cable;Tipo;Color;Desde;Hasta']
      .concat(connectionRows().map((r) => [r.label, r.type, r.color, r.from, r.to].map(q).join(';'))).join('\r\n');
    download(slug($('diagram-name').value) + '-conexiones.csv', csv, 'text/csv;charset=utf-8');
  };

  // Capas, bloqueo, aspecto, copiar y pegar

  let wiresOnTop = true;
  const isJ = (c) => c instanceof Junction;
  const byZ = () => graph.getElements().slice().sort((a, b) => (a.get('z') || 0) - (b.get('z') || 0));

  /* Cables y empalmes por encima de las imágenes, para que siempre se vea dónde llegan. */
  function raiseWires() { normalizeZ(); }

  function layerMove(cells, how) {
    const els = cells.filter((c) => c.isElement() && !isJ(c));
    if (!els.length) return;
    graph.startBatch('layer');
    if (how === 'front') els.slice().sort((a, b) => a.get('z') - b.get('z')).forEach((e) => e.toFront());
    else if (how === 'back') els.slice().sort((a, b) => b.get('z') - a.get('z')).forEach((e) => e.toBack());
    else {
      const step = how === 'up' ? 1 : -1;
      const list = els.slice().sort((a, b) => step * (b.get('z') - a.get('z')));
      list.forEach((e) => {
        const ord = byZ().filter((x) => !isJ(x) && layerOf(x) === layerOf(e));
        const j = ord.indexOf(e) + step;
        if (j < 0 || j >= ord.length || els.includes(ord[j])) return;
        const za = e.get('z') || 0, zb = ord[j].get('z') || 0;
        if (za === zb) e.set('z', zb + step * 0.5);
        else { e.set('z', zb); ord[j].set('z', za); }
      });
    }
    raiseWires();
    graph.stopBatch('layer');
    renderLayersSoon();
  }

  function setLocked(cells, on) {
    cells.filter((c) => c.isElement()).forEach((c) => c.set('locked', !!on));
    toast(on ? 'Bloqueado: no se moverá ni entrará en el recuadro de selección' : 'Desbloqueado', 'ok');
    const cur = currentCells();
    if (cur.length > 1) setGroup(cur); else if (selected) select(selected); else renderProps();
    renderLayersSoon();
  }

  function setHidden(cells, on) {
    cells.filter((c) => c.isElement()).forEach((c) => {
      c.set('hiddenEl', !!on);
      applyVisibility(c);
    });
    if (on) { clearSelection(); toast('Oculto. Vuelve a mostrarlo desde el panel de Capas', 'ok'); }
    renderLayersSoon();
  }

  // Aspecto: opacidad y ajustes de imagen
  const LOOK_DEF = { opacity: 1, brightness: 1, contrast: 1, saturate: 1, grayscale: 0 };
  function applyLook(el) {
    const k = Object.assign({}, LOOK_DEF, el.get('look'));
    el.attr('root/opacity', k.opacity === 1 ? null : k.opacity);
    const f = [];
    if (k.brightness !== 1) f.push('brightness(' + k.brightness + ')');
    if (k.contrast !== 1) f.push('contrast(' + k.contrast + ')');
    if (k.saturate !== 1) f.push('saturate(' + k.saturate + ')');
    if (k.grayscale) f.push('grayscale(1)');
    el.attr('image/style', { filter: f.join(' ') || 'none' });
  }
  function setLook(el, patch) { el.set('look', Object.assign({}, LOOK_DEF, el.get('look'), patch)); applyLook(el); }

  const layerButtons = () => '<div class="layer-grid">' +
    '<button class="btn btn-sm" data-ly="front" title="Traer al frente (Ctrl+Mayús+↑)">⤒ Frente</button>' +
    '<button class="btn btn-sm" data-ly="up" title="Subir una capa (Ctrl+↑)">↑ Subir</button>' +
    '<button class="btn btn-sm" data-ly="down" title="Bajar una capa (Ctrl+↓)">↓ Bajar</button>' +
    '<button class="btn btn-sm" data-ly="back" title="Enviar al fondo (Ctrl+Mayús+↓)">⤓ Fondo</button></div>';
  function bindLayerButtons(box, cells) {
    box.querySelectorAll('[data-ly]').forEach((b) => b.addEventListener('click', () => layerMove(cells(), b.dataset.ly)));
  }

  function lookHtml(el, hasImage) {
    const k = Object.assign({}, LOOK_DEF, el.get('look'));
    const rng = (id, label, v, min, max) => field(label, '<div class="rng"><input type="range" id="' + id + '" min="' + min + '" max="' + max +
      '" value="' + Math.round(v * 100) + '"><span id="' + id + '-v">' + Math.round(v * 100) + '%</span></div>');
    return field('Orden', layerButtons()) +
      '<label class="check"><input type="checkbox" id="p-lock"' + (el.get('locked') ? ' checked' : '') +
      '> Bloquear (no se mueve ni entra en el recuadro de selección)</label>' +
      '<div class="props-actions">' +
      '<button class="btn btn-sm" id="p-copy" title="Ctrl+C · se puede pegar en otro diagrama">Copiar</button>' +
      '<button class="btn btn-sm" id="p-cut" title="Ctrl+X">Cortar</button>' +
      '<button class="btn btn-sm" id="p-hide" title="Se vuelve a mostrar desde el panel de Capas">Ocultar</button></div>' +
      rng('p-op', 'Opacidad', k.opacity, 10, 100) +
      (hasImage
        ? rng('p-br', 'Brillo', k.brightness, 30, 200) + rng('p-ct', 'Contraste', k.contrast, 30, 200) + rng('p-sa', 'Saturación', k.saturate, 0, 200) +
          '<label class="check"><input type="checkbox" id="p-gray"' + (k.grayscale ? ' checked' : '') + '> Blanco y negro</label>' +
          '<div class="props-actions">' +
          '<button class="btn btn-sm" id="p-lookreset">Restablecer imagen</button>' +
          '<button class="btn btn-sm" id="p-imgcopy" title="Para pegarla en Paint, Word, WhatsApp…">Copiar imagen al portapapeles</button>' +
          '<button class="btn btn-sm" id="p-imgdl">Descargar imagen</button></div>'
        : '<div class="props-actions"><button class="btn btn-sm" id="p-lookreset">Restablecer opacidad</button></div>');
  }

  function bindLook(el, hasImage) {
    const box = $('props');
    bindLayerButtons(box, () => [el]);
    $('p-lock').addEventListener('change', (e) => setLocked([el], e.target.checked));
    $('p-copy').onclick = () => copySelection(false);
    $('p-cut').onclick = () => copySelection(true);
    $('p-hide').onclick = () => setHidden([el], true);
    const live = (id, key) => {
      const inp = $(id);
      if (!inp) return;
      inp.addEventListener('input', () => { $(id + '-v').textContent = inp.value + '%'; setLook(el, { [key]: Number(inp.value) / 100 }); });
    };
    live('p-op', 'opacity'); live('p-br', 'brightness'); live('p-ct', 'contrast'); live('p-sa', 'saturate');
    if ($('p-gray')) $('p-gray').addEventListener('change', (e) => setLook(el, { grayscale: e.target.checked ? 1 : 0 }));
    $('p-lookreset').onclick = () => { el.set('look', Object.assign({}, LOOK_DEF)); applyLook(el); renderProps(); };
    if (hasImage) {
      $('p-imgcopy').onclick = () => copyImageToSystem(el);
      $('p-imgdl').onclick = async () => {
        try { download(slug(el.attr('title/text') || 'imagen') + '.png', await imageBlob(el)); } catch (e) { toast(e.message, 'error'); }
      };
    }
  }

  async function imageBlob(el) {
    const img = new Image();
    img.src = el.attr('image/href');
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext('2d');
    const k = Object.assign({}, LOOK_DEF, el.get('look'));
    ctx.filter = [k.brightness !== 1 && 'brightness(' + k.brightness + ')', k.contrast !== 1 && 'contrast(' + k.contrast + ')',
      k.saturate !== 1 && 'saturate(' + k.saturate + ')', k.grayscale && 'grayscale(1)'].filter(Boolean).join(' ') || 'none';
    ctx.drawImage(img, 0, 0);
    return new Promise((res) => cv.toBlob(res, 'image/png'));
  }

  async function copyImageToSystem(el) {
    try {
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('Este navegador no permite copiar imágenes; usa «Descargar imagen»');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': imageBlob(el) })]);
      toast('Imagen copiada: pégala en Paint, Word… con Ctrl+V', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  // Copiar, cortar y pegar (también entre diagramas, vía localStorage)
  const CLIP_KEY = 'editor-diagramas:portapapeles';
  const CLIP_MARK = 'editor-diagramas:copia:';
  let clip = null;

  function copySelection(cut) {
    const cells = currentCells();
    const els = cells.filter((c) => c.isElement());
    if (!els.length) { toast('Selecciona componentes, imágenes o empalmes para copiar', 'error'); return; }
    const links = innerLinks(els);
    clip = { stamp: Date.now().toString(36), cells: els.concat(links).map((c) => c.toJSON()), n: 0 };
    try { localStorage.setItem(CLIP_KEY, JSON.stringify(clip)); } catch (_) { /* demasiado grande: queda solo en esta pestaña */ }
    try { if (navigator.clipboard) navigator.clipboard.writeText(CLIP_MARK + clip.stamp).catch(() => {}); } catch (_) { /* sin permiso */ }
    if (cut) {
      const del = cells.filter((c) => !lockedEff(c));
      dropGroup();
      graph.removeCells(del);
      clearSelection();
    }
    toast((cut ? 'Cortado' : 'Copiado') + ': ' + els.length + ' elemento(s)' + (links.length ? ' y ' + links.length + ' cable(s)' : '') +
      '. Pega con Ctrl+V, también en otro diagrama.', 'ok');
  }

  function readClip(stamp) {
    let c = clip;
    if (!c || (stamp && c.stamp !== stamp)) {
      try { c = JSON.parse(localStorage.getItem(CLIP_KEY)); } catch (_) { c = null; }
    }
    if (!c || (stamp && c.stamp !== stamp)) return null;
    if (!clip || clip.stamp !== c.stamp) clip = c;
    return clip;
  }

  function pasteClip(c, clientPoint) {
    const tmp = new joint.dia.Graph({}, { cellNamespace: namespace });
    tmp.fromJSON({ cells: JSON.parse(JSON.stringify(c.cells)) });
    const clones = Object.values(tmp.cloneSubgraph(tmp.getCells()));
    const bb = tmp.getCellsBBox(tmp.getElements());
    let dx, dy;
    if (clientPoint) {
      const p = paper.clientToLocalPoint(clientPoint.x, clientPoint.y);
      dx = p.x - (bb.x + bb.width / 2); dy = p.y - (bb.y + bb.height / 2);
    } else { c.n = (c.n || 0) + 1; dx = dy = 30 * c.n; }
    clones.forEach((x) => {
      x.unset('locked'); x.unset('hiddenEl');
      if (!layerById(x.get('layer'))) x.set('layer', activeLayer);
      if (x.isElement()) x.translate(dx, dy);
      else x.vertices(x.vertices().map((p) => ({ x: p.x + dx, y: p.y + dy })));
    });
    graph.addCells(clones);
    clones.forEach(applyVisibility);
    let no = nextWireNo();
    clones.filter((x) => x.isLink()).forEach((x) => { x.set('wireNo', no); setWireLabel(x, 'C' + no); no++; });
    raiseWires();
    setGroup(clones);
    toast('Pegado: ' + clones.length + ' elemento(s)', 'ok');
  }

  // Panel de capas
  const layerName = (e) => {
    if (isJ(e)) return 'Empalme';
    if (e instanceof Note) return 'Texto: ' + (String(e.attr('label/text') || '').split('\n')[0]);
    if (e instanceof Zone) return '▢ ' + (e.attr('label/text') || 'Zona');
    if (e instanceof TitleBlock) return '▤ Cajetín';
    const t = e.attr('title/text');
    if (t) return t;
    const n = e.get('componentName') || 'Componente';
    return n === 'Imagen pegada' ? 'Imagen' : n;
  };
  let layersTimer = null;
  function renderLayersSoon() { clearTimeout(layersTimer); layersTimer = setTimeout(renderLayers, 120); }
  // Capas con nombre (como en un programa de dibujo)
  let layers = [{ id: 'base', name: 'Capa 1', visible: true, locked: false }];
  let activeLayer = 'base';
  const collapsed = new Set();
  function layerById(id) { return layers.find((l) => l.id === id); }
  function layerOf(c) { return layerById(c.get('layer')) || layerById('base') || layers[0]; }
  function lockedEff(c) { return !!(c && c.get && (c.get('locked') || layerOf(c).locked)); }
  function hiddenEff(c) { return !!(c && c.get && (c.get('hiddenEl') || !layerOf(c).visible)); }
  function applyVisibility(c) { c.attr('root/display', hiddenEff(c) ? 'none' : null); }

  /* Orden de dibujo: capa a capa (la de abajo primero); con «cables encima», cables y empalmes al final. */
  function normalizeZ() {
    const byz = (a, b) => (a.get('z') || 0) - (b.get('z') || 0);
    const wireish = (c) => wiresOnTop && (c.isLink() || isJ(c));
    let z = 1;
    graph.startBatch('z');
    layers.forEach((L) => {
      graph.getCells().filter((c) => !wireish(c) && layerOf(c) === L).sort(byz).forEach((c) => { if (c.get('z') !== z) c.set('z', z); z++; });
    });
    if (wiresOnTop) {
      graph.getLinks().sort(byz).forEach((c) => { if (c.get('z') !== z) c.set('z', z); z++; });
      graph.getElements().filter(isJ).sort(byz).forEach((c) => { if (c.get('z') !== z) c.set('z', z); z++; });
    }
    graph.stopBatch('z');
  }

  function layersChanged() { markDirty(); renderLayersSoon(); if (group.length || selected) renderProps(); }

  function newLayer(name) {
    const id = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    layers.push({ id, name: name || 'Capa ' + (layers.length + 1), visible: true, locked: false });
    activeLayer = id;
    layersChanged();
    return id;
  }

  function assignLayer(cells, id) {
    if (!layerById(id)) return;
    cells.forEach((c) => { c.set('layer', id); applyVisibility(c); });
    normalizeZ();
    toast(cells.length + ' elemento(s) movidos a «' + layerById(id).name + '»', 'ok');
    layersChanged();
  }

  function deleteLayer(id) {
    if (layers.length === 1) { toast('Tiene que quedar al menos una capa', 'error'); return; }
    const L = layerById(id);
    const dest = layers.find((l) => l.id !== id);
    const cells = graph.getCells().filter((c) => layerOf(c) === L);
    if (!confirm('¿Eliminar la capa «' + L.name + '»?' + (cells.length ? '\nSus ' + cells.length + ' elemento(s) pasan a «' + dest.name + '» (no se borran).' : ''))) return;
    graph.getCells().forEach((c) => { if (!layerById(c.get('layer'))) c.set('layer', layerOf(c).id, { silent: true }); });
    cells.forEach((c) => c.set('layer', dest.id));
    layers = layers.filter((l) => l.id !== id);
    if (activeLayer === id) activeLayer = dest.id;
    graph.getCells().forEach(applyVisibility);
    normalizeZ();
    layersChanged();
  }

  function moveLayer(id, dir) {
    const i = layers.findIndex((l) => l.id === id), j = i + dir;
    if (j < 0 || j >= layers.length) return;
    [layers[i], layers[j]] = [layers[j], layers[i]];
    normalizeZ();
    layersChanged();
  }

  function setLayerFlag(id, key, value) {
    const L = layerById(id);
    L[key] = value;
    if (key === 'visible') graph.getCells().filter((c) => layerOf(c) === L).forEach(applyVisibility);
    if (key === 'visible' && !value || key === 'locked' && value) {
      const cur = currentCells().filter((c) => layerOf(c) !== L);
      if (cur.length !== currentCells().length) { if (cur.length > 1) setGroup(cur); else if (cur.length) select(cur[0]); else clearSelection(); }
    }
    layersChanged();
  }

  function layerSelect(id, cur) {
    return '<select id="' + id + '">' + (cur ? '' : '<option value="" selected>(elegir capa)</option>') +
      layers.slice().reverse().map((l) => '<option value="' + esc(l.id) + '"' + (l.id === cur ? ' selected' : '') + '>' + esc(l.name) +
        (l.visible ? '' : ' (oculta)') + (l.locked ? ' (bloqueada)' : '') + '</option>').join('') +
      '<option value="__new">＋ Nueva capa…</option></select>';
  }
  function bindLayerSelect(id, cells) {
    const sel = $(id);
    if (!sel) return;
    sel.addEventListener('change', () => {
      let v = sel.value;
      if (v === '__new') {
        const name = prompt('Nombre de la capa nueva:', 'Capa ' + (layers.length + 1));
        if (name === null) { renderProps(); return; }
        v = newLayer(name.trim() || undefined);
      }
      if (v) assignLayer(cells(), v);
    });
  }

  // Lo nuevo que se añade al plano entra en la capa activa.
  graph.on('add', (c) => {
    if (history.lock) return;
    if (!layerById(c.get('layer'))) c.set('layer', activeLayer);
    applyVisibility(c);
    const L = layerOf(c);
    if (!L.visible || L.locked) toast('La capa activa «' + L.name + '» está ' + (!L.visible ? 'oculta' : 'bloqueada'), 'error');
  });

  // iconos de las capas, con el mismo trazo que el resto de la interfaz
  const ico = (d) => '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const LAY_ICO = {
    vis: ico('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    hid: ico('<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/>'),
    lock: ico('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    unlock: ico('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>'),
  };

  function elemRow(e, sel) {
    const href = e.attr('image/href');
    const thumb = href ? '<img src="' + esc(href) + '" alt="">' : '<span class="ic">' + (isJ(e) ? '●' : '▭') + '</span>';
    return '<li data-id="' + e.id + '" draggable="true" class="el' + (sel.has(e.id) ? ' on' : '') + (e.get('hiddenEl') ? ' off' : '') +
      (hiddenEff(e) && !e.get('hiddenEl') ? ' dim' : '') + '">' +
      '<button class="lb" data-act="vis" title="Mostrar / ocultar" aria-pressed="' + !e.get('hiddenEl') + '">' + (e.get('hiddenEl') ? LAY_ICO.hid : LAY_ICO.vis) + '</button>' +
      '<button class="lb" data-act="lock" title="Bloquear / desbloquear" aria-pressed="' + !!e.get('locked') + '">' + (e.get('locked') ? LAY_ICO.lock : LAY_ICO.unlock) + '</button>' +
      thumb + '<span class="nm" title="' + esc(layerName(e)) + '">' + esc(layerName(e)) + '</span>' +
      (isJ(e) ? '' : '<button class="lb" data-act="up" title="Subir dentro de la capa">▲</button><button class="lb" data-act="down" title="Bajar dentro de la capa">▼</button>') +
      '</li>';
  }

  function renderLayers() {
    const panel = $('layers');
    if (!panel || panel.hidden) return;
    const showJ = $('lay-j').checked;
    const sel = new Set(currentCells().map((c) => c.id));
    const all = byZ();
    let html = '';
    layers.slice().reverse().forEach((L) => {
      const n = graph.getCells().filter((c) => layerOf(c) === L).length;
      html += '<li class="lyr' + (L.id === activeLayer ? ' act' : '') + '" data-l="' + esc(L.id) + '">' +
        '<button class="lb" data-la="fold" title="Plegar / desplegar">' + (collapsed.has(L.id) ? '▸' : '▾') + '</button>' +
        '<button class="lb" data-la="vis" title="Mostrar / ocultar toda la capa" aria-pressed="' + !!L.visible + '">' + (L.visible ? LAY_ICO.vis : LAY_ICO.hid) + '</button>' +
        '<button class="lb" data-la="lock" title="Bloquear / desbloquear toda la capa" aria-pressed="' + !!L.locked + '">' + (L.locked ? LAY_ICO.lock : LAY_ICO.unlock) + '</button>' +
        '<span class="nm" title="Clic: capa activa · doble clic: renombrar">' + esc(L.name) + '</span>' +
        '<span class="cnt">' + n + '</span>' +
        '<button class="lb" data-la="sel" title="Seleccionar todo lo de esta capa">⬚</button>' +
        '<button class="lb" data-la="up" title="Subir la capa">▲</button>' +
        '<button class="lb" data-la="down" title="Bajar la capa">▼</button>' +
        '<button class="lb" data-la="del" title="Eliminar la capa (su contenido pasa a otra)">✕</button></li>';
      if (!collapsed.has(L.id)) html += all.filter((e) => layerOf(e) === L && (showJ || !isJ(e))).reverse().map((e) => elemRow(e, sel)).join('');
    });
    $('lay-list').innerHTML = html;
  }

  $('lay-list').addEventListener('click', (ev) => {
    const lh = ev.target.closest('li.lyr');
    if (lh) {
      const id = lh.dataset.l, L = layerById(id);
      const b = ev.target.closest('[data-la]');
      const a = b ? b.dataset.la : 'act';
      if (a === 'fold') { if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id); renderLayers(); }
      else if (a === 'vis') setLayerFlag(id, 'visible', !L.visible);
      else if (a === 'lock') setLayerFlag(id, 'locked', !L.locked);
      else if (a === 'up') moveLayer(id, 1);
      else if (a === 'down') moveLayer(id, -1);
      else if (a === 'del') deleteLayer(id);
      else if (a === 'sel') {
        if (!L.visible || L.locked) { toast('La capa está ' + (!L.visible ? 'oculta' : 'bloqueada'), 'error'); return; }
        setGroup(graph.getCells().filter((c) => layerOf(c) === L && !c.get('hiddenEl') && !c.get('locked')));
      }
      else { activeLayer = id; toast('Capa activa: «' + L.name + '»', 'ok'); layersChanged(); }
      return;
    }
    const li = ev.target.closest('li[data-id]');
    if (!li) return;
    const el = graph.getCell(li.dataset.id);
    if (!el) return;
    const act = ev.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'vis') setHidden([el], !el.get('hiddenEl'));
      else if (a === 'lock') setLocked([el], !el.get('locked'));
      else layerMove([el], a);
      return;
    }
    if (hiddenEff(el)) { toast('Está oculto (él o su capa): pulsa el ojo en el panel de capas para mostrarlo', 'error'); return; }
    if (ev.ctrlKey || ev.metaKey || ev.shiftKey) toggleInSelection(el); else select(el);
    renderLayersSoon();
  });
  $('lay-list').addEventListener('dblclick', (ev) => {
    const lh = ev.target.closest('li.lyr');
    if (!lh || ev.target.closest('[data-la]')) return;
    const L = layerById(lh.dataset.l);
    const name = prompt('Nuevo nombre de la capa:', L.name);
    if (name && name.trim()) { L.name = name.trim(); layersChanged(); }
  });
  // arrastrar elementos de la lista sobre otra capa
  $('lay-list').addEventListener('dragstart', (ev) => {
    const li = ev.target.closest('li[data-id]');
    if (!li) return;
    ev.dataTransfer.setData('application/x-capa-celda', li.dataset.id);
    ev.dataTransfer.effectAllowed = 'move';
  });
  $('lay-list').addEventListener('dragover', (ev) => {
    const lh = ev.target.closest('li.lyr');
    if (!lh || ![...ev.dataTransfer.types].includes('application/x-capa-celda')) return;
    ev.preventDefault(); ev.stopPropagation();
    $('lay-list').querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
    lh.classList.add('drop');
  });
  $('lay-list').addEventListener('drop', (ev) => {
    const lh = ev.target.closest('li.lyr');
    const id = ev.dataTransfer.getData('application/x-capa-celda');
    if (!lh || !id) return;
    ev.preventDefault(); ev.stopPropagation();
    const cell = graph.getCell(id);
    const cur = currentCells();
    assignLayer(cell && cur.includes(cell) ? cur : [cell].filter(Boolean), lh.dataset.l);
  });
  $('lay-list').addEventListener('dragend', () => $('lay-list').querySelectorAll('.drop').forEach((x) => x.classList.remove('drop')));
  $('lay-new').onclick = () => {
    const name = prompt('Nombre de la capa nueva:', 'Capa ' + (layers.length + 1));
    if (name === null) return;
    newLayer(name.trim() || undefined);
    const cur = currentCells();
    if (cur.length && confirm('¿Mover lo que tienes seleccionado (' + cur.length + ') a la capa nueva?')) assignLayer(cur, activeLayer);
  };
  $('btn-layers').onclick = () => {
    const p = $('layers');
    p.hidden = !p.hidden;
    $('btn-layers').classList.toggle('on', !p.hidden);
    renderLayers();
  };
  $('lay-close').onclick = () => { $('layers').hidden = true; $('btn-layers').classList.remove('on'); };
  $('lay-j').addEventListener('change', renderLayers);
  $('lay-wires').addEventListener('change', (e) => { wiresOnTop = e.target.checked; raiseWires(); renderLayersSoon(); });
  graph.on('add remove change:z change:locked change:hiddenEl change:attrs change:layer', renderLayersSoon);
  paper.on('cell:pointerclick blank:pointerclick', renderLayersSoon);

  // Texto, zonas, menú contextual, buscar, minimapa

  const isAnno = (c) => c instanceof Note || c instanceof Zone;

  function addNote(p, text) {
    const pt = p || viewCenterLocal();
    const el = new Note({ position: { x: Math.round(pt.x - 90), y: Math.round(pt.y - 25) } });
    el.attr('label/text', text || 'Texto');
    graph.addCell(el);
    select(el);
    setTimeout(() => { const t = $('p-ntext'); if (t) { t.focus(); t.select(); } }, 30);
    return el;
  }

  function addZone(p, title) {
    const cur = currentCells().filter((c) => c.isElement() && !isAnno(c));
    let x, y, w = 420, h = 260;
    if (cur.length) {            // rodea lo que tengas seleccionado
      const bb = graph.getCellsBBox(cur).inflate(30);
      x = bb.x; y = bb.y - 10; w = bb.width; h = bb.height + 10;
    } else {
      const pt = p || viewCenterLocal();
      x = pt.x - w / 2; y = pt.y - h / 2;
    }
    const el = new Zone({ position: { x: Math.round(x), y: Math.round(y) }, size: { width: Math.round(w), height: Math.round(h) } });
    el.attr('label/text', title || 'Zona');
    graph.addCell(el);
    el.toBack();
    normalizeZ();
    select(el);
    setTimeout(() => { const t = $('p-ztitle'); if (t) { t.focus(); t.select(); } }, 30);
    return el;
  }

  function renderAnnoProps(box, el) {
    const note = el instanceof Note;
    const fs = Number(el.attr('label/fontSize')) || (note ? 14 : 14);
    const sizes = [10, 12, 14, 16, 20, 24, 32, 40];
    box.innerHTML = '<div class="props">' +
      '<h3>' + (note ? 'Texto' : 'Zona') + '</h3>' +
      '<div class="sub">' + (note ? 'Nota o rótulo libre en el plano. Doble clic sobre él para editarlo.' : 'Recuadro para agrupar un área del tablero. Se dibuja detrás de todo.') + '</div>' +
      (note
        ? field('Texto', '<textarea id="p-ntext" rows="3">' + esc(el.attr('label/text') || '') + '</textarea>')
        : field('Título', '<input type="text" id="p-ztitle" value="' + esc(el.attr('label/text') || '') + '">')) +
      field('Tamaño de letra', '<select id="p-fs">' + sizes.map((s) => '<option' + (s === fs ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>') +
      '<label class="check"><input type="checkbox" id="p-bold"' + (String(el.attr('label/fontWeight')) === '700' ? ' checked' : '') + '> Negrita</label>' +
      field(note ? 'Color del texto' : 'Color de la zona', colorPicker('p-acolor', note ? el.attr('label/fill') : el.attr('body/stroke'))) +
      (note
        ? field('Fondo', colorPicker('p-abg', el.attr('body/fill') === 'transparent' ? '#ffffff' : el.attr('body/fill'))) +
          '<label class="check"><input type="checkbox" id="p-nobg"' + (el.attr('body/fill') === 'transparent' ? ' checked' : '') + '> Sin fondo ni borde</label>'
        : '<label class="check"><input type="checkbox" id="p-dash"' + (el.attr('body/strokeDasharray') ? ' checked' : '') + '> Borde discontinuo</label>') +
      field('Capa (grupo)', layerSelect('p-layer', layerOf(el).id)) +
      '<div class="props-actions"><button class="btn btn-sm" id="p-dup">Duplicar</button>' +
      '<button class="btn btn-sm btn-danger" id="p-del">Eliminar</button></div>' +
      lookHtml(el, false) + '</div>';
    if (note) $('p-ntext').addEventListener('input', (e) => el.attr('label/text', e.target.value));
    else $('p-ztitle').addEventListener('input', (e) => el.attr('label/text', e.target.value));
    $('p-fs').addEventListener('change', (e) => el.attr('label/fontSize', Number(e.target.value)));
    $('p-bold').addEventListener('change', (e) => el.attr('label/fontWeight', e.target.checked ? 700 : 400));
    bindColor('p-acolor', (c) => {
      if (note) el.attr('label/fill', c);
      else { el.attr('body/stroke', c); el.attr('label/fill', c); el.attr('body/fill', c + '0d'); }
    });
    if (note) {
      bindColor('p-abg', (c) => { el.attr('body/fill', c); el.attr('body/stroke', '#d6d9ea'); $('p-nobg').checked = false; });
      $('p-nobg').addEventListener('change', (e) => {
        el.attr('body/fill', e.target.checked ? 'transparent' : '#ffffff');
        el.attr('body/stroke', e.target.checked ? 'transparent' : '#d6d9ea');
      });
    } else {
      $('p-dash').addEventListener('change', (e) => el.attr('body/strokeDasharray', e.target.checked ? '8 5' : null));
    }
    bindLayerSelect('p-layer', () => [el]);
    $('p-dup').onclick = () => duplicateSelected();
    $('p-del').onclick = () => (lockedEff(el) ? toast('Está bloqueado: desbloquéalo para eliminarlo', 'error') : el.remove());
    bindLook(el, false);
  }

  paper.on('element:pointerdblclick', (view) => {
    const el = view.model;
    if (!isAnno(el)) return;
    select(el);
    setTimeout(() => { const t = $(el instanceof Note ? 'p-ntext' : 'p-ztitle'); if (t) { t.focus(); t.select(); } }, 30);
  });

  $('btn-note').onclick = () => addNote(null);
  $('btn-zone').onclick = () => addZone(null);

  // Distribuir a la misma distancia
  function distributeGroup(axis) {
    const els = groupElements().filter((e) => !lockedEff(e));
    if (els.length < 3) { toast('Selecciona al menos 3 elementos', 'error'); return; }
    const k = axis === 'h' ? 'x' : 'y', dim = axis === 'h' ? 'width' : 'height';
    const items = els.map((e) => ({ e, b: e.getBBox() })).sort((a, b) => a.b[k] - b.b[k]);
    const first = items[0].b, last = items[items.length - 1].b;
    const total = last[k] + last[dim] - first[k];
    const used = items.reduce((s, it) => s + it.b[dim], 0);
    const gap = (total - used) / (items.length - 1);
    let pos = first[k];
    graph.startBatch('distribute');
    items.forEach((it) => {
      const d = pos - it.b[k];
      it.e.translate(axis === 'h' ? d : 0, axis === 'h' ? 0 : d, { group: true });
      pos += it.b[dim] + gap;
    });
    graph.stopBatch('distribute');
  }

  // Centrar la vista en un elemento
  function centerOn(cell) {
    let bb;
    if (cell.isLink()) { const v = cell.findView(paper); bb = v && v.getConnection() ? v.getConnection().bbox() : null; }
    else bb = cell.getBBox();
    if (!bb) return;
    const s = paper.scale().sx, c = bb.center();
    paper.translate(wrap.clientWidth / 2 - c.x * s, wrap.clientHeight / 2 - c.y * s);
  }

  // Buscar (Ctrl+F)
  function searchItems(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    graph.getElements().forEach((e) => {
      if (isJ(e)) return;
      const name = isAnno(e) ? String(e.attr('label/text') || '') : (e.attr('title/text') || e.get('componentName') || '');
      const terms = (e.get('terminals') || []).map((t) => t.name).filter(Boolean);
      const hitT = terms.filter((t) => t.toLowerCase().includes(q));
      if (name.toLowerCase().includes(q) || hitT.length) {
        out.push({ cell: e, label: (isAnno(e) ? (e instanceof Note ? 'Texto: ' : 'Zona: ') : '') + (name || 'Componente'),
          sub: hitT.length ? 'bornes: ' + hitT.slice(0, 4).join(', ') : layerOf(e).name });
      }
    });
    realLinks().forEach((l) => {
      const n = wireName(l);
      const desc = endName(l.source()) + ' → ' + endName(l.target());
      if (n.toLowerCase().includes(q) || desc.toLowerCase().includes(q)) out.push({ cell: l, label: n, sub: desc });
    });
    return out.slice(0, 40);
  }
  function openSearch() {
    $('search-box').hidden = false;
    const q = $('search-q');
    q.focus(); q.select();
    renderSearch();
  }
  function closeSearch() { $('search-box').hidden = true; }
  let searchRes = [];
  function renderSearch() {
    searchRes = searchItems($('search-q').value);
    $('search-res').innerHTML = searchRes.length
      ? searchRes.map((r, i) => '<li data-i="' + i + '"><b>' + esc(r.label) + '</b><small>' + esc(r.sub) + '</small></li>').join('')
      : ($('search-q').value.trim() ? '<li class="none">Sin resultados</li>' : '<li class="none">Escribe un nombre, un cable (C12) o un borne (I0.2, +V…)</li>');
  }
  function pickSearch(i) {
    const r = searchRes[i];
    if (!r) return;
    if (hiddenEff(r.cell)) { toast('Está oculto (él o su capa)', 'error'); return; }
    select(r.cell);
    centerOn(r.cell);
  }
  $('search-q').addEventListener('input', renderSearch);
  $('search-q').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
    else if (e.key === 'Enter') { e.preventDefault(); pickSearch(0); }
  });
  $('search-res').addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) pickSearch(Number(li.dataset.i)); });
  $('search-close').onclick = closeSearch;
  $('btn-search').onclick = () => ($('search-box').hidden ? openSearch() : closeSearch());

  // Cuadrícula y minimapa
  const VIEW_KEY = 'editor-diagramas:vista';
  const view = { grid: true, minimap: false };
  try { Object.assign(view, JSON.parse(localStorage.getItem(VIEW_KEY)) || {}); } catch (_) { /* sin almacenamiento */ }
  const saveView = () => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (_) { /* modo privado */ } };
  function applyGrid() {
    paper.options.drawGrid = view.grid ? { name: 'mesh', args: { color: '#edf0f4', thickness: 1 } } : false;
    paper.setGrid(paper.options.drawGrid);
    $('show-grid').checked = view.grid;
  }
  $('show-grid').addEventListener('change', (e) => { view.grid = e.target.checked; saveView(); applyGrid(); });

  let mmTimer = null;
  const drawMinimapSoon = () => { clearTimeout(mmTimer); mmTimer = setTimeout(drawMinimap, 60); };
  let mmMap = null;
  function drawMinimap() {
    const cv = $('minimap');
    if (cv.hidden) return;
    const W = cv.width, H = cv.height, ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const els = graph.getElements().filter((e) => !hiddenEff(e));
    const p0 = paper.clientToLocalPoint(wrap.getBoundingClientRect().left, wrap.getBoundingClientRect().top);
    const vp = new joint.g.Rect(p0.x, p0.y, wrap.clientWidth / paper.scale().sx, wrap.clientHeight / paper.scale().sy);
    let bb = els.length ? graph.getCellsBBox(els).union(vp) : vp;
    bb = bb.inflate(20);
    const k = Math.min(W / bb.width, H / bb.height);
    const ox = (W - bb.width * k) / 2 - bb.x * k, oy = (H - bb.height * k) / 2 - bb.y * k;
    mmMap = { k, ox, oy };
    const R = (r) => [r.x * k + ox, r.y * k + oy, Math.max(1, r.width * k), Math.max(1, r.height * k)];
    els.forEach((e) => {
      const r = R(e.getBBox());
      if (e instanceof Zone) { ctx.strokeStyle = '#6f7882'; ctx.setLineDash([3, 2]); ctx.strokeRect(...r); ctx.setLineDash([]); }
      else if (e.attr('image/href')) { ctx.fillStyle = '#c8cdd3'; ctx.fillRect(...r); }
      else if (isJ(e)) { ctx.fillStyle = '#1f2328'; ctx.fillRect(r[0], r[1], 2, 2); }
      else { ctx.fillStyle = '#9fb3c5'; ctx.fillRect(...r); }
    });
    ctx.lineWidth = 1;
    graph.getLinks().forEach((l) => {
      if (hiddenEff(l)) return;
      const v = l.findView(paper);
      if (!v || !v.sourcePoint) return;
      const pts = [v.sourcePoint, ...(v.route || []), v.targetPoint];
      ctx.strokeStyle = l.attr('line/stroke') || '#64748b';
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x * k + ox, p.y * k + oy) : ctx.moveTo(p.x * k + ox, p.y * k + oy)));
      ctx.stroke();
    });
    ctx.strokeStyle = '#3b6182'; ctx.lineWidth = 2;
    ctx.strokeRect(...R(vp));
    ctx.fillStyle = 'rgba(59,97,130,.08)'; ctx.fillRect(...R(vp));
  }
  function minimapGo(ev) {
    if (!mmMap) return;
    const r = $('minimap').getBoundingClientRect();
    const x = ((ev.clientX - r.left) * ($('minimap').width / r.width) - mmMap.ox) / mmMap.k;
    const y = ((ev.clientY - r.top) * ($('minimap').height / r.height) - mmMap.oy) / mmMap.k;
    const s = paper.scale().sx;
    paper.translate(wrap.clientWidth / 2 - x * s, wrap.clientHeight / 2 - y * s);
  }
  let mmDrag = false;
  $('minimap').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); mmDrag = true; minimapGo(e); });
  document.addEventListener('pointermove', (e) => { if (mmDrag) minimapGo(e); });
  document.addEventListener('pointerup', () => { mmDrag = false; });
  function applyMinimap() { $('minimap').hidden = !view.minimap; $('show-minimap').checked = view.minimap; drawMinimap(); }
  $('show-minimap').addEventListener('change', (e) => { view.minimap = e.target.checked; saveView(); applyMinimap(); });
  paper.on('translate scale', drawMinimapSoon);
  graph.on('add remove change:position change:size change:attrs change:vertices change:target change:source', drawMinimapSoon);
  if (window.ResizeObserver) new ResizeObserver(drawMinimapSoon).observe(wrap);
  applyGrid();
  applyMinimap();

  // Imprimir o PDF
  $('btn-print').onclick = async () => {
    const out = buildExportSVG(30);
    if (!out) { toast('El diagrama está vacío'); return; }
    try {
      const url = await svgToDataURL(out.svg, out.w, out.h, 2, 'image/png');
      // marco oculto en vez de ventana emergente: lo bloquean algunos navegadores y la versión de
      // escritorio (pywebview) no abre ventanas en blanco
      const fr = document.createElement('iframe');
      fr.setAttribute('aria-hidden', 'true');
      fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
      document.body.appendChild(fr);
      const w = fr.contentWindow;
      w.onafterprint = () => setTimeout(() => fr.remove(), 100);
      const name = esc($('diagram-name').value || 'Diagrama');
      w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + name + '</title><style>@page{size:' +
        (out.w > out.h ? 'landscape' : 'portrait') + ';margin:10mm}body{margin:0;font:14px system-ui}h1{font-size:16px;margin:0 0 8px}' +
        'img{width:100%;height:auto;display:block}.d{color:#666;font-size:11px;margin-top:6px}</style></head><body><h1>' + name + '</h1>' +
        '<img src="' + url + '" onload="setTimeout(function(){print()},250)"><div class="d">' + new Date().toLocaleString('es') + '</div></body></html>');
      w.document.close();
    } catch (e) { toast(e.message, 'error'); }
  };

  // Menú del botón derecho
  const ctx = $('ctx-menu');
  ctx.setAttribute('role', 'menu');
  let ctxReturn = null;          // dónde vuelve el foco al cerrar un menú abierto con el teclado
  function closeCtx() {
    if (ctx.hidden) return;
    ctx.hidden = true;
    if (ctxReturn) { ctxReturn.focus(); ctxReturn = null; }
  }
  function openCtx(ev, items) {
    ctx.innerHTML = items.map((it, i) => (it === '-' ? '<li class="sep" role="separator"></li>'
      : it.head ? '<li class="head" role="presentation">' + esc(it.head) + '</li>'
        : '<li data-i="' + i + '" role="menuitem" tabindex="-1"' + (it.disabled ? ' class="dis" aria-disabled="true"' : '') + '><span>' + esc(it.label) + '</span>' + (it.key ? '<kbd>' + esc(it.key) + '</kbd>' : '') + '</li>')).join('');
    ctx.hidden = false;
    const r = ctx.getBoundingClientRect();
    ctx.style.left = Math.min(ev.clientX, window.innerWidth - r.width - 6) + 'px';
    ctx.style.top = Math.min(ev.clientY, window.innerHeight - r.height - 6) + 'px';
    ctx.onclick = (e) => {
      const li = e.target.closest('li[data-i]');
      if (!li || li.classList.contains('dis')) return;
      ctxReturn = null;
      closeCtx();
      items[Number(li.dataset.i)].run();
    };
    if (ev.keyboard) {
      ctxReturn = document.activeElement;
      const first = ctx.querySelector('li[data-i]:not(.dis)');
      if (first) first.focus();
    }
  }
  // dentro del menú: flechas para moverse, Enter o espacio para elegir
  ctx.addEventListener('keydown', (e) => {
    const list = [...ctx.querySelectorAll('li[data-i]:not(.dis)')];
    const i = list.indexOf(document.activeElement);
    let to = null;
    if (e.key === 'ArrowDown') to = list[(i + 1) % list.length];
    else if (e.key === 'ArrowUp') to = list[(i - 1 + list.length) % list.length];
    else if (e.key === 'Home') to = list[0];
    else if (e.key === 'End') to = list[list.length - 1];
    else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) { e.preventDefault(); list[i].click(); return; }
    else if (e.key === 'Tab') { e.preventDefault(); closeCtx(); return; }
    if (to) { e.preventDefault(); to.focus(); }
  });
  document.addEventListener('pointerdown', (e) => { if (e.button !== 2 && !ctx.hidden && !ctx.contains(e.target)) { ctxReturn = null; closeCtx(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCtx(); });
  // tecla Menú o Mayús+F10: el mismo menú sobre la selección, o en el centro del plano si no hay nada elegido
  document.addEventListener('keydown', (e) => {
    if (!(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    e.preventDefault();
    const cell = currentCells()[0], v = cell && cell.findView(paper);
    const r = (v ? v.el : wrap).getBoundingClientRect();
    const kev = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, keyboard: true, preventDefault() {} };
    if (cell) cellMenu(kev, cell); else blankMenu(kev);
  });
  wrap.addEventListener('wheel', closeCtx, { passive: true });

  function cellMenu(ev, cell) {
    if (!currentCells().includes(cell)) select(cell);
    const cells = currentCells();
    const els = cells.filter((c) => c.isElement());
    const many = cells.length > 1;
    const locked = cells.some(lockedEff);
    const items = [
      { label: 'Copiar', key: 'Ctrl+C', run: () => copySelection(false) },
      { label: 'Cortar', key: 'Ctrl+X', run: () => copySelection(true) },
      { label: 'Duplicar', key: 'Ctrl+D', run: () => (many ? duplicateGroup() : duplicateSelected()) },
      { label: 'Eliminar', key: 'Supr', disabled: locked, run: () => (many ? deleteGroup() : cell.remove()) },
      '-',
      { label: 'Traer al frente', key: 'Ctrl+Mayús+↑', disabled: !els.length, run: () => layerMove(cells, 'front') },
      { label: 'Enviar al fondo', key: 'Ctrl+Mayús+↓', disabled: !els.length, run: () => layerMove(cells, 'back') },
      { label: cells.every((c) => c.get('locked')) ? 'Desbloquear' : 'Bloquear', disabled: !els.length,
        run: () => setLocked(cells, !cells.every((c) => c.get('locked'))) },
      { label: 'Ocultar', disabled: !els.length, run: () => setHidden(cells, true) },
    ];
    if (cell.isElement() && !isJ(cell) && !isAnno(cell) && !many) {
      items.push({ label: 'Girar 90°', key: 'R', run: () => cell.rotate(90) });
      if (cell.attr('image/href')) items.push({ label: 'Copiar imagen (para Paint)', run: () => copyImageToSystem(cell) });
    }
    if (els.length && !many) items.push({ label: 'Rodear con una zona', run: () => addZone(null) });
    items.push('-');
    if (!many && cell.isLink() && !isArrow(cell) && cell.source().id && cell.target().id) {
      items.push({ label: 'Partir cable aquí (empalme)', run: () => { const v = cell.findView(paper), q = v && v.getClosestPoint(paper.clientToLocalPoint(ev.clientX, ev.clientY)); if (q) splitLinkAt(cell, q); } });
    }
    if (!many && replaceable(cell)) items.push({ label: 'Reemplazar componente…', run: openReplace });
    if (els.length) items.push({ label: 'Duplicar en serie…', run: openSeries });
    if (!many) items.push({ label: 'Seleccionar iguales', key: 'I', run: selectSame });
    if (cells.filter((c) => c.isElement()).length >= 3) {
      items.push('-', { label: 'Distribuir en horizontal', run: () => distributeGroup('h') }, { label: 'Distribuir en vertical', run: () => distributeGroup('v') });
    }
    items.push('-', { head: 'Mover a la capa' });
    layers.slice().reverse().forEach((L) => items.push({ label: (cells.every((c) => layerOf(c) === L) ? '● ' : '○ ') + L.name, run: () => assignLayer(cells, L.id) }));
    items.push({ label: '＋ Capa nueva…', run: () => { const n = prompt('Nombre de la capa nueva:', 'Capa ' + (layers.length + 1)); if (n !== null) assignLayer(cells, newLayer(n.trim() || undefined)); } });
    openCtx(ev, items);
  }
  function blankMenu(ev) {
    const p = paper.clientToLocalPoint(ev.clientX, ev.clientY);
    const c = readClip();
    openCtx(ev, [
      { label: 'Pegar aquí', key: 'Ctrl+V', disabled: !c, run: () => pasteClip(c, { x: ev.clientX, y: ev.clientY }) },
      { label: 'Añadir texto aquí', run: () => addNote(p) },
      { label: 'Añadir zona aquí', run: () => { clearSelection(); addZone(p); } },
      { label: 'Añadir flecha aquí', run: () => addArrow(p) },
      { label: 'Insertar imagen…', run: () => $('image-file').click() },
      '-',
      { label: 'Seleccionar todo', key: 'Ctrl+A', run: () => setGroup(graph.getCells().filter((x) => !hiddenEff(x) && !lockedEff(x))) },
      { label: 'Ver todo el diagrama', run: () => fitContent() },
      { label: 'Buscar…', key: 'Ctrl+F', run: () => openSearch() },
      { label: view.grid ? 'Ocultar cuadrícula' : 'Mostrar cuadrícula', run: () => { view.grid = !view.grid; saveView(); applyGrid(); } },
    ]);
  }
  // en Android mantener pulsado también lanza el menú del navegador: no se abre dos veces
  const dupCtx = () => Date.now() - App.touchGestures.last < 1500;
  paper.on('cell:contextmenu', (v, ev) => { ev.preventDefault(); if (dupCtx()) return; ctxShownAt = Date.now(); cellMenu(ev, v.model); });
  paper.on('blank:contextmenu', (ev) => { ev.preventDefault(); if (dupCtx()) return; ctxShownAt = Date.now(); blankMenu(ev); });

  // Barra de la selección: girar, duplicar, eliminar… a un toque (en el móvil no hay teclado)
  const SB_ICON = {
    rot: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
    dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
    del: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    props: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  };
  function updateSelBar() {
    const bar = $('sel-bar');
    if (!bar) return;
    const cells = currentCells();
    if (!cells.length || portModeEl) { bar.hidden = true; return; }
    const one = cells.length === 1 ? cells[0] : null;
    const locked = cells.some(lockedEff);
    const btn = (k, title, dis) => '<button class="tool-btn" data-k="' + k + '" title="' + title + '" aria-label="' + title + '"' + (dis ? ' disabled' : '') + '>' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + SB_ICON[k] + '</svg></button>';
    let h = one ? '' : '<span class="sb-n">' + cells.length + ' elementos</span>';
    if (one && one.isElement() && !isJ(one) && !isAnno(one)) h += btn('rot', 'Girar 90° (R)', locked);
    if (!one || one.isElement()) h += btn('dup', 'Duplicar (Ctrl+D)');
    h += btn('del', 'Eliminar (Supr)', locked);
    if (document.body.classList.contains('hide-right')) h += btn('props', 'Propiedades');
    h += btn('more', 'Más acciones');
    bar.innerHTML = h;
    bar.hidden = false;
  }
  $('sel-bar').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b || b.disabled) return;
    const cells = currentCells(), many = cells.length > 1;
    if (!cells.length) return;
    const k = b.dataset.k;
    if (k === 'rot') rotateSelected();
    else if (k === 'dup') { if (many) duplicateGroup(); else duplicateSelected(); }
    else if (k === 'del') { if (many) deleteGroup(); else cells[0].remove(); }
    else if (k === 'props') $('edge-right').click();
    else if (k === 'more') { const r = b.getBoundingClientRect(); cellMenu({ clientX: r.left, clientY: r.bottom + 6 }, cells[0]); }
  });
  new MutationObserver(updateSelBar).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  wrap.addEventListener('contextmenu', (e) => e.preventDefault());

  // Cajetín, flechas, revisión, materiales, atajos

  const isArrow = (l) => !!(l && l.get && l.get('isArrow'));
  const realLinks = () => graph.getLinks().filter((l) => !isArrow(l));

  // Cajetín de plano
  const TB_FIELDS = [['plano', 'Plano'], ['proyecto', 'Proyecto'], ['autor', 'Autor'], ['fecha', 'Fecha'], ['revision', 'Revisión'], ['hoja', 'Hoja']];
  function applyTitleBlock(el) {
    const d = el.get('tb') || {};
    TB_FIELDS.forEach(([k]) => el.attr('v_' + k + '/text', d[k] || ''));
  }
  function addTitleBlock() {
    const els = graph.getElements().filter((e) => !hiddenEff(e));
    const bb = els.length ? graph.getCellsBBox(els) : new joint.g.Rect(0, 0, 400, 300);
    const el = new TitleBlock({ position: { x: Math.round(bb.x + bb.width - 380), y: Math.round(bb.y + bb.height + 30) } });
    el.set('tb', { plano: $('diagram-name').value || 'Plano', proyecto: '', autor: '', fecha: new Date().toLocaleDateString('es'), revision: 'A', hoja: '1 / 1' });
    applyTitleBlock(el);
    graph.addCell(el);
    select(el);
    return el;
  }
  function renderTitleBlockProps(box, el) {
    const d = el.get('tb') || {};
    box.innerHTML = '<div class="props"><h3>Cajetín del plano</h3>' +
      '<div class="sub">Los datos del plano, como en un plano impreso. Sale en la exportación y al imprimir.</div>' +
      TB_FIELDS.map(([k, n]) => field(n, '<input type="text" data-tb="' + k + '" value="' + esc(d[k] || '') + '">')).join('') +
      '<div class="props-actions"><button class="btn btn-sm" id="p-tbtoday">Fecha de hoy</button>' +
      '<button class="btn btn-sm" id="p-tbname">Usar nombre del diagrama</button></div>' +
      field('Capa (grupo)', layerSelect('p-layer', layerOf(el).id)) +
      '<div class="props-actions"><button class="btn btn-sm btn-danger" id="p-del">Eliminar</button></div>' +
      lookHtml(el, false) + '</div>';
    const set = (k, v) => { el.set('tb', Object.assign({}, el.get('tb'), { [k]: v })); applyTitleBlock(el); };
    box.querySelectorAll('[data-tb]').forEach((i) => i.addEventListener('input', () => set(i.dataset.tb, i.value)));
    $('p-tbtoday').onclick = () => { set('fecha', new Date().toLocaleDateString('es')); renderProps(); };
    $('p-tbname').onclick = () => { set('plano', $('diagram-name').value); renderProps(); };
    bindLayerSelect('p-layer', () => [el]);
    $('p-del').onclick = () => (lockedEff(el) ? toast('Está bloqueado', 'error') : el.remove());
    bindLook(el, false);
  }
  $('btn-tb').onclick = () => {
    const ex = graph.getElements().find((e) => e instanceof TitleBlock);
    if (ex) { select(ex); centerOn(ex); toast('Este plano ya tiene cajetín: aquí lo tienes', 'ok'); return; }
    const el = addTitleBlock();
    centerOn(el);
  };

  // Flechas de anotación (no son cables: no cuentan en la lista de conexiones)
  function addArrow(p) {
    const c = p || viewCenterLocal();
    const l = new joint.shapes.standard.Link({
      source: { x: Math.round(c.x - 70), y: Math.round(c.y + 40) }, target: { x: Math.round(c.x + 50), y: Math.round(c.y - 30) },
      isArrow: true, router: { name: 'normal' }, connector: { name: 'normal' },
      attrs: { line: { stroke: '#e11d48', strokeWidth: 2.2, targetMarker: { type: 'path', d: 'M 10 -5 0 0 10 5 z' }, sourceMarker: { type: 'path', d: 'M 0 0' } },
        wrapper: { strokeWidth: 12 } },
    });
    graph.addCell(l);
    select(l);
    toast('Flecha añadida: arrastra sus extremos para colocarla', 'ok');
    return l;
  }
  function renderArrowProps(box, l) {
    box.innerHTML = '<div class="props"><h3>Flecha</h3><div class="sub">Anotación para señalar algo. No es un cable: no sale en la lista de conexiones.</div>' +
      field('Color', colorPicker('p-acol', l.attr('line/stroke'))) +
      field('Grosor', '<select id="p-aw">' + [1.5, 2.2, 3, 4.5].map((w) => '<option value="' + w + '"' + (Number(l.attr('line/strokeWidth')) === w ? ' selected' : '') + '>' + w + ' px</option>').join('') + '</select>') +
      field('Puntas', '<select id="p-ah"><option value="t">Al final</option><option value="b">En los dos extremos</option><option value="n">Sin punta</option></select>') +
      '<label class="check"><input type="checkbox" id="p-adash"' + (l.attr('line/strokeDasharray') ? ' checked' : '') + '> Discontinua</label>' +
      field('Capa (grupo)', layerSelect('p-llayer', layerOf(l).id)) +
      '<div class="props-actions"><button class="btn btn-sm" id="p-anovert">Quitar codos</button><button class="btn btn-sm btn-danger" id="p-del">Eliminar</button></div>' +
      '<p class="help">Arrastra los extremos para moverla; arrastra sobre la línea para hacer un codo.</p></div>';
    const head = { type: 'path', d: 'M 10 -5 0 0 10 5 z' }, none = { type: 'path', d: 'M 0 0' };
    const cur = l.attr('line/sourceMarker/d') !== 'M 0 0' ? 'b' : l.attr('line/targetMarker/d') === 'M 0 0' ? 'n' : 't';
    $('p-ah').value = cur;
    bindColor('p-acol', (c) => l.attr('line/stroke', c));
    $('p-aw').addEventListener('change', (e) => l.attr('line/strokeWidth', Number(e.target.value)));
    $('p-ah').addEventListener('change', (e) => {
      const v = e.target.value;
      l.attr('line/targetMarker', v === 'n' ? none : head);
      l.attr('line/sourceMarker', v === 'b' ? head : none);
    });
    $('p-adash').addEventListener('change', (e) => l.attr('line/strokeDasharray', e.target.checked ? '7 5' : null));
    bindLayerSelect('p-llayer', () => [l]);
    $('p-anovert').onclick = () => l.vertices([]);
    $('p-del').onclick = () => l.remove();
  }
  $('btn-arrow').onclick = () => addArrow(null);

  // Revisión automática del diagrama
  function reviewIssues() {
    const out = [];
    const add = (lvl, msg, cells) => out.push({ lvl, msg, cells: cells || [] });
    const links = realLinks();
    // empalmes con 0 o 1 cable
    // Un empalme encima de una foto es un punto de conexión sobre su borne: con un cable basta.
    const solids = graph.getElements().filter((e) => !isJ(e) && !(e instanceof Zone) && !(e instanceof Note) && !hiddenEff(e));
    const onSomething = (j) => { const c = j.getBBox().center(); return solids.some((e) => e.getBBox().containsPoint(c)); };
    const loose = [];
    graph.getElements().filter(isJ).forEach((j) => {
      const n = graph.getConnectedLinks(j).filter((l) => !isArrow(l)).length;
      if (n === 0) loose.push(j);
      else if (n === 1 && !onSomething(j)) add('warn', 'Empalme en el aire con un solo cable: ese cable no llega a ningún sitio', [j]);
    });
    if (loose.length) add('info', loose.length + ' punto(s) de empalme sin ningún cable (sobran o falta conectarlos)', loose);
    // cables raros
    const key = (e) => e.id + ':' + (e.port || '');
    const seen = new Map();
    links.forEach((l) => {
      const s = l.source(), t = l.target();
      if (!s.id || !t.id) { add('err', 'Cable ' + wireName(l) + ' con un extremo suelto', [l]); return; }
      if (key(s) === key(t)) add('err', 'Cable ' + wireName(l) + ' empieza y termina en el mismo punto', [l]);
      const k = [key(s), key(t)].sort().join('|');
      if (seen.has(k)) add('warn', 'Cables duplicados: ' + wireName(seen.get(k)) + ' y ' + wireName(l) + ' unen los mismos puntos', [seen.get(k), l]);
      else seen.set(k, l);
    });
    // números repetidos
    const byNo = {};
    links.forEach((l) => { const n = wireName(l); (byNo[n] = byNo[n] || []).push(l); });
    Object.entries(byNo).forEach(([n, ls]) => { if (ls.length > 1) add('warn', 'El número ' + n + ' está repetido en ' + ls.length + ' cables', ls); });
    // redes que mezclan potenciales distintos (por el tipo de cable)
    const parent = {};
    const find = (a) => (parent[a] === a ? a : (parent[a] = find(parent[a])));
    const node = (e) => { const c = graph.getCell(e.id); return c && isJ(c) ? 'J' + c.id : key(e); };
    links.forEach((l) => {
      const a = node(l.source()), b = node(l.target());
      parent[a] = parent[a] || a; parent[b] = parent[b] || b;
      parent[find(a)] = find(b);
    });
    const nets = {};
    links.forEach((l) => { const r = find(node(l.source())); (nets[r] = nets[r] || []).push(l); });
    const clash = [['L', 'N', 'fase y neutro'], ['L', 'PE', 'fase y tierra'], ['N', 'PE', 'neutro y tierra'], ['V24', 'GND', '+24 V y 0 V']];
    Object.values(nets).forEach((ls) => {
      const types = new Set(ls.map((l) => l.get('wireType')));
      clash.forEach(([a, b, txt]) => {
        if (types.has(a) && types.has(b)) {
          add('err', 'Posible cortocircuito: en un mismo grupo de cables unidos hay ' + txt + ' (' + ls.map(wireName).join(', ') + '). Revisa el tipo de esos cables o sus uniones.', ls);
        }
      });
    });
    // componentes con bornes sin ningún cable
    graph.getElements().forEach((e) => {
      if (!(e instanceof Component) || !(e.get('terminals') || []).length) return;
      if (!graph.getConnectedLinks(e).length) add('info', '«' + (e.attr('title/text') || e.get('componentName')) + '» tiene bornes pero ningún cable', [e]);
    });
    // ocultos
    const hid = graph.getCells().filter(hiddenEff);
    if (hid.length) add('info', hid.length + ' elemento(s) ocultos (por ellos mismos o por su capa): no saldrán al exportar', hid);
    const rank = { err: 0, warn: 1, info: 2 };
    return out.sort((a, b) => rank[a.lvl] - rank[b.lvl]);
  }

  // Lista de materiales
  function bomRows() {
    const groups = {};
    graph.getElements().forEach((e) => {
      if (isJ(e) || isAnno(e) || e instanceof TitleBlock) return;
      const pic = e.get('isPicture') || e.get('componentName') === 'Imagen pegada';
      const kind = pic ? 'Imagen / foto' : (e.get('componentName') || 'Componente');
      const g = groups[kind] = groups[kind] || { kind, n: 0, names: [] };
      g.n++;
      const t = e.attr('title/text');
      if (t && t !== kind) g.names.push(t);
    });
    const comps = Object.values(groups).sort((a, b) => a.kind.localeCompare(b.kind, 'es'));
    const wires = {};
    realLinks().forEach((l) => {
      const t = wireType(l.get('wireType')).name;
      const w = wires[t] = wires[t] || { kind: t, n: 0, len: 0, color: l.attr('line/stroke') };
      w.n++;
      const v = l.findView(paper);
      if (v && v.getConnection()) w.len += v.getConnection().length();
    });
    return { comps, wires: Object.values(wires), junctions: graph.getElements().filter(isJ).length };
  }

  // La ventana de conexiones pasa a tener pestañas
  let modalTab = 'conns';
  function renderModal() {
    document.querySelectorAll('#modal-conns [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === modalTab));
    $('conns-renum').style.display = modalTab === 'conns' ? '' : 'none';
    $('conns-csv').style.display = modalTab === 'review' ? 'none' : '';
    const body = $('conns-body');
    if (modalTab === 'conns') {
      const rows = connectionRows();
      body.innerHTML = rows.length
        ? '<table class="table"><thead><tr><th>Cable</th><th>Tipo</th><th>Desde</th><th>Hasta</th></tr></thead><tbody>' +
          rows.map((r) => '<tr><td><span class="wire-swatch" style="background:' + esc(r.color) + '"></span> <b>' + esc(r.label) +
            '</b></td><td>' + esc(r.type) + '</td><td>' + esc(r.from) + '</td><td>' + esc(r.to) + '</td></tr>').join('') + '</tbody></table>'
        : '<p class="help">Todavía no hay cables en el diagrama.</p>';
    } else if (modalTab === 'bom') {
      const b = bomRows();
      body.innerHTML = '<h4 class="mh">Componentes</h4><table class="table"><thead><tr><th>Componente</th><th>Cantidad</th><th>Nombres en el plano</th></tr></thead><tbody>' +
        (b.comps.map((c) => '<tr><td><b>' + esc(c.kind) + '</b></td><td>' + c.n + '</td><td>' + esc(c.names.join(', ')) + '</td></tr>').join('') || '<tr><td colspan="3">Ninguno</td></tr>') +
        '</tbody></table><h4 class="mh">Cables</h4><table class="table"><thead><tr><th>Tipo</th><th>Cantidad</th><th>Longitud en el dibujo</th></tr></thead><tbody>' +
        (b.wires.map((w) => '<tr><td><span class="wire-swatch" style="background:' + esc(w.color) + '"></span> ' + esc(w.kind) + '</td><td>' + w.n + '</td><td>' + Math.round(w.len) + ' px</td></tr>').join('') || '<tr><td colspan="3">Ninguno</td></tr>') +
        '</tbody></table><p class="help">Empalmes / nodos: <b>' + b.junctions + '</b>. La longitud es la del dibujo, no la real: sirve para comparar.</p>';
    } else {
      const iss = reviewIssues();
      const ico = { err: '<b>Error:</b>', warn: '<b>Aviso:</b>', info: '<b>Nota:</b>' };
      body.innerHTML = iss.length
        ? '<p class="help">Haz clic en un aviso para ir a él en el plano.</p><ul class="review">' +
          iss.map((x, i) => '<li class="' + x.lvl + '" data-i="' + i + '"><span>' + ico[x.lvl] + '</span>' + esc(x.msg) + '</li>').join('') + '</ul>'
        : '<div class="review-ok">No he encontrado problemas: sin empalmes sueltos, cables duplicados ni mezclas de potenciales.</div>';
      body.querySelectorAll('.review li[data-i]').forEach((li) => li.addEventListener('click', () => {
        const x = iss[Number(li.dataset.i)];
        const cells = x.cells.filter((c) => graph.getCell(c.id) && !hiddenEff(c));
        if (!cells.length) return;
        $('modal-conns').classList.remove('open');
        if (cells.length > 1) setGroup(cells); else select(cells[0]);
        centerOn(cells[0]);
      }));
    }
  }
  function openModal(tab) { modalTab = tab; renderModal(); $('modal-conns').classList.add('open'); }
  $('btn-conns').onclick = () => openModal('conns');
  $('btn-review').onclick = () => openModal('review');
  document.querySelectorAll('#modal-conns [data-tab]').forEach((b) => b.addEventListener('click', () => { modalTab = b.dataset.tab; renderModal(); }));
  $('conns-csv').onclick = () => {
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    let csv;
    if (modalTab === 'bom') {
      const b = bomRows();
      csv = ['Componente;Cantidad;Nombres en el plano'].concat(b.comps.map((c) => [c.kind, c.n, c.names.join(', ')].map(q).join(';')))
        .concat(['', 'Tipo de cable;Cantidad']).concat(b.wires.map((w) => [w.kind, w.n].map(q).join(';'))).concat(['', 'Empalmes;' + b.junctions]);
    } else {
      csv = ['Cable;Tipo;Color;Desde;Hasta'].concat(connectionRows().map((r) => [r.label, r.type, r.color, r.from, r.to].map(q).join(';')));
    }
    download(slug($('diagram-name').value) + (modalTab === 'bom' ? '-materiales' : '-conexiones') + '.csv', '﻿' + csv.join('\r\n'), 'text/csv;charset=utf-8');
  };

  // Renumerar cables C1, C2, C3… sin huecos
  function renumberWires() {
    const ls = realLinks().sort((a, b) => (Number(a.get('wireNo')) || 1e9) - (Number(b.get('wireNo')) || 1e9));
    if (!ls.length) return;
    if (!confirm('¿Renumerar los ' + ls.length + ' cables como C1…C' + ls.length + ' (manteniendo su orden)?\nLos cables con un nombre propio (que no sea «C + número») conservan su nombre.')) return;
    graph.startBatch('renumber');
    ls.forEach((l, i) => {
      const keep = !/^C\d+$/.test(wireName(l));
      l.set('wireNo', i + 1);
      if (!keep) setWireLabel(l, 'C' + (i + 1));
    });
    graph.stopBatch('renumber');
    renderModal();
    toast('Cables renumerados del C1 al C' + ls.length, 'ok');
  }
  $('conns-renum').onclick = renumberWires;

  // Atajos de teclado (tecla ?)
  function openShortcuts() { $('modal-keys').classList.add('open'); }
  $('btn-keys').onclick = openShortcuts;
  $('keys-close').onclick = () => $('modal-keys').classList.remove('open');
  $('modal-keys').addEventListener('click', (e) => { if (e.target.id === 'modal-keys') $('modal-keys').classList.remove('open'); });
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.key === '?') { e.preventDefault(); openShortcuts(); }
    if (e.key === 'Escape') $('modal-keys').classList.remove('open');
  });

  // Teclado

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 's') { e.preventDefault(); save(true); return; }
    if (mod && key === 'f') { e.preventDefault(); openSearch(); return; }
    if (e.key === 'Escape' && util) { e.preventDefault(); endUtil(); return; }
    if (e.key === 'Escape' && portModeEl) { e.preventDefault(); stopPortMode(); return; }
    if (typing) {
      // Enter en el nombre de un borne recién marcado: listo para el siguiente clic
      if (e.key === 'Enter' && e.target.dataset && e.target.dataset.tid) e.target.blur();
      return;
    }
    if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (mod && key === 'a') { e.preventDefault(); setGroup(graph.getCells()); }
    else if (mod && key === 'd') { e.preventDefault(); if (group.length) duplicateGroup(); else duplicateSelected(); }
    else if (mod && key === 'c' && currentCells().length && !String(window.getSelection())) { e.preventDefault(); copySelection(false); }
    else if (mod && key === 'x' && currentCells().length) { e.preventDefault(); copySelection(true); }
    else if (mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && currentCells().length) {
      e.preventDefault();
      layerMove(currentCells(), e.key === 'ArrowUp' ? (e.shiftKey ? 'front' : 'up') : (e.shiftKey ? 'back' : 'down'));
    }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (group.length) { e.preventDefault(); deleteGroup(); }
      else if (selected) {
        e.preventDefault();
        if (lockedEff(selected)) toast('Está bloqueado: desbloquéalo para eliminarlo', 'error'); else selected.remove();
      }
    }
    else if (key === 'a' && !mod && !e.shiftKey) addArrow(lastPointer ? paper.clientToLocalPoint(lastPointer.x, lastPointer.y) : null);
    else if (key === 't' && !mod) addNote(lastPointer ? paper.clientToLocalPoint(lastPointer.x, lastPointer.y) : null);
    else if (key === 'v' && !mod) setTool('select');
    else if (key === 'h' && !mod) setTool('pan');
    else if (key === 'n' && !mod && !e.shiftKey) setUtil('net');
    else if (key === 'j' && !mod && !e.shiftKey) setUtil('split');
    else if (key === 'i' && !mod && !e.shiftKey) selectSame();
    else if (group.length && e.key.indexOf('Arrow') === 0) {
      e.preventDefault();
      const fine = e.altKey || !snapGrid;
      const step = fine ? (e.shiftKey ? 10 : 1) : (e.shiftKey ? 50 : 10);
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      moveGroupBy(d[0], d[1]);
    }
    else if (e.key === 'Escape') { clearSelection(); $('modal-conns').classList.remove('open'); }
    else if (key === 'r' && !mod) rotateSelected();
    else if (selected && selected.isElement() && !lockedEff(selected) && e.key.indexOf('Arrow') === 0) {
      e.preventDefault();
      const fine = e.altKey || !snapGrid || selected instanceof Junction;
      const step = fine ? (e.shiftKey ? 10 : 1) : (e.shiftKey ? 50 : 10);
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      selected.translate(d[0], d[1]);
    }
  });

  // Arranque

  async function init() {
    renderWireTypeSelect();
    try {
      const [d] = await Promise.all([api.getDiagram(diagramId), loadLibrary()]);
      $('diagram-name').value = d.name;
      document.title = d.name + ' · Diagramas eléctricos';
      loadData(d.data || {});
      fitContent();
      history.stack = [snapshot()];
      history.index = 0;
      updateUndoButtons();
      changeSeq = savedSeq = 0;
      setState('saved', 'Guardado');
      renderProps();
      const ejemplo = new URLSearchParams(location.search).get('ejemplo');
      if (ejemplo && !graph.getCells().length) await buildExample(ejemplo);
    } catch (e) {
      setState('error', 'Error');
      toast('No se pudo abrir el diagrama: ' + e.message, 'error');
    }
  }

  /* Monta un ejemplo del simulador (static/js/ejemplos.js) en el diagrama vacío, lo guarda y abre
     el simulador, que arranca solo. */
  async function buildExample(id) {
    const ex = (window.SimEjemplos || []).find((e) => e.id === id);
    if (!ex) return;
    const add = (name, x, y) => {
      const comp = library.find((c) => c.name === name);
      if (!comp) throw new Error('falta en la biblioteca: ' + name);
      const el = buildElement(comp, x, y);
      graph.addCell(el);
      return el;
    };
    const port = (el, name) => {
      const ts = el.get('terminals') || [];
      const t = ts.find((x) => x.name === name) || ts.find((x) => x.name.startsWith(name + ' '));
      if (!t) throw new Error(el.get('componentName') + ' no tiene el borne ' + name);
      return t.id;
    };
    const wire = (a, an, b, bn, type) => {
      const l = newWire();
      const wt = wireType(type || 'SIG');
      l.set('wireType', wt.id);
      l.attr('line/stroke', wt.color);
      l.attr('line/strokeDasharray', wt.dash || null);
      l.source({ id: a.id, port: port(a, an) });
      l.target({ id: b.id, port: port(b, bn) });
      graph.addCell(l);
    };
    try {
      ex.build({ add, wire });
    } catch (e) {
      toast('No se pudo montar el ejemplo: ' + e.message, 'error', 6000);
      return;
    }
    fitContent();
    await save(true);
    location.href = '/simulador?id=' + diagramId + '&auto=1';
  }

  // Acceso para pruebas automáticas y depuración desde la consola.
  window.Editor = {
    graph, paper, addComponent, select, serialize, save, connectionRows, undo, redo,
    copySelection, pasteClip, readClip, layerMove, setLocked, setHidden, setGroup,
    addNote, addZone, distributeGroup, centerOn, openSearch,
    addArrow, addTitleBlock, reviewIssues, bomRows, renumberWires, openModal,
    newLayer, assignLayer, deleteLayer, moveLayer, setLayerFlag, get layers() { return layers; }, get activeLayer() { return activeLayer; },
    exportSVG: () => buildExportSVG(30), makeThumbnail, get library() { return library; },
  };

  init();
})();
