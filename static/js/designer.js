/* Diseñador de componentes: foto + bornes con posición relativa. */
(function () {
  'use strict';
  const { api, esc, toast, imageToDataURL } = App;
  const $ = (id) => document.getElementById(id);

  let library = [];
  let current = null;      // componente en edición (copia)
  let selTerm = null;      // id del borne seleccionado
  let dirty = false;

  const blank = () => ({
    id: null, name: '', category: 'Mis componentes', kind: 'component',
    width: 160, height: 100, color: '#eef2f7', image: '', show_labels: true, terminals: [], builtin: false,
  });
  const uid = () => 't' + Math.random().toString(36).slice(2, 10);

  function setDirty(v) {
    dirty = v;
    $('state').textContent = v ? 'Cambios sin guardar' : '';
    $('state').className = 'save-state' + (v ? ' dirty' : '');
  }

  // Lista

  async function loadList() {
    if (!library.length) $('list').innerHTML = '<p class="help" role="status" style="padding:8px">Cargando biblioteca…</p>';
    try {
      library = await api.listComponents();
    } catch (e) {
      $('list').innerHTML = '<div class="help" role="alert" style="padding:8px">No se pudo cargar la biblioteca (' + esc(e.message) +
        '). Comprueba que el servidor esté en marcha. <button class="btn btn-sm" id="list-retry">Reintentar</button></div>';
      $('list-retry').onclick = () => loadList().catch(() => { /* el aviso ya está en la lista */ });
      throw e;
    }
    renderList();
    $('cats').innerHTML = [...new Set(library.map((c) => c.category))].sort()
      .map((c) => '<option value="' + esc(c) + '">').join('');
  }

  function renderList() {
    const q = $('search').value.trim().toLowerCase();
    const cats = {};
    library.filter((c) => !q || (c.name + ' ' + c.category).toLowerCase().includes(q))
      .forEach((c) => { (cats[c.category] = cats[c.category] || []).push(c); });
    $('list').innerHTML = Object.keys(cats).sort((a, b) => a.localeCompare(b, 'es')).map((cat) =>
      '<div class="lib-cat">' + esc(cat) + '</div>' + cats[cat].map((c) => {
        const thumb = c.kind === 'junction' ? '<span class="dot"></span>'
          : c.image ? '<img src="' + esc(c.image) + '" alt="">'
          : '<span class="box" style="background:' + esc(c.color) + '"></span>';
        const on = current && current.id === c.id ? ' aria-current="true"' : '';
        return '<div class="lib-item" tabindex="0" role="button" data-id="' + c.id + '"' + on + '><span class="lib-thumb">' + thumb +
          '</span><span class="lib-name">' + esc(c.name) + '<small>' + c.terminals.length + ' bornes' +
          (c.builtin ? ' · de serie' : '') + '</small></span></div>';
      }).join('')).join('') || '<p class="help" style="padding:8px">Sin resultados.</p>';
  }

  $('search').addEventListener('input', renderList);
  $('list').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('lib-item')) { e.preventDefault(); e.target.click(); }
  });
  $('list').addEventListener('click', (e) => {
    const item = e.target.closest('.lib-item');
    if (!item) return;
    const c = library.find((x) => x.id === Number(item.dataset.id));
    if (c && confirmLeave()) edit(c);
  });

  function confirmLeave() {
    return !dirty || confirm('Hay cambios sin guardar en este componente. ¿Descartarlos?');
  }

  // Edición

  function edit(c) {
    current = JSON.parse(JSON.stringify(c));
    selTerm = null;
    setDirty(false);
    fillForm();
    renderStage();
    renderTerms();
    renderList();
  }

  function fillForm() {
    $('form-title').textContent = current.id ? 'Editar componente' : 'Nuevo componente';
    $('f-name').value = current.name;
    $('f-cat').value = current.category;
    $('f-w').value = current.width;
    $('f-h').value = current.height;
    $('f-color').value = /^#[0-9a-f]{6}$/i.test(current.color) ? current.color : '#eef2f7';
    $('f-labels').checked = current.show_labels !== false;
    $('btn-del').disabled = !current.id;
    $('btn-dup').disabled = !current.id;
    $('color-field').style.display = current.image ? 'none' : '';
    $('btn-noimg').disabled = !current.image;
  }

  function zoom() {
    const wrap = $('stage-wrap').getBoundingClientRect();
    const avail = Math.max(200, Math.min(wrap.width - 80, wrap.height - 80));
    return Math.min(4, avail / Math.max(current.width, current.height));
  }

  function renderStage() {
    const z = zoom();
    const st = $('stage');
    st.style.width = Math.round(current.width * z) + 'px';
    st.style.height = Math.round(current.height * z) + 'px';
    st.innerHTML = (current.image
      ? '<img src="' + esc(current.image) + '" alt="" draggable="false">'
      : '<div class="generic" style="background:' + esc(current.color) + '">' + esc(current.name || 'Componente') + '</div>') +
      current.terminals.map((t) =>
        '<div class="term' + (t.id === selTerm ? ' sel' : '') + '" data-id="' + t.id + '" style="left:' +
        (t.x * 100) + '%;top:' + (t.y * 100) + '%"><span>' + esc(t.name) + '</span></div>').join('');
  }

  function renderTerms() {
    $('t-count').textContent = current.terminals.length;
    $('t-help').style.display = current.terminals.length ? 'none' : '';
    $('terms').innerHTML = current.terminals.map((t) =>
      '<div class="term-row' + (t.id === selTerm ? ' sel' : '') + '" data-id="' + t.id + '">' +
      '<input type="text" value="' + esc(t.name) + '" data-id="' + t.id + '" placeholder="Nombre">' +
      '<span class="xy">' + Math.round(t.x * 100) + '% · ' + Math.round(t.y * 100) + '%</span>' +
      '<button class="btn btn-sm btn-danger" data-del="' + t.id + '" title="Quitar borne">✕</button></div>').join('');
  }

  function nextName() {
    const used = new Set(current.terminals.map((t) => t.name));
    let i = 1;
    while (used.has(String(i))) i++;
    return String(i);
  }

  const clamp = (v) => Math.min(1, Math.max(0, v));
  function snapEdge(v) {
    if (v < 0.035) return 0;
    if (v > 0.965) return 1;
    return Math.round(v * 200) / 200;
  }

  function relFromEvent(e) {
    const r = $('stage').getBoundingClientRect();
    return { x: snapEdge(clamp((e.clientX - r.left) / r.width)), y: snapEdge(clamp((e.clientY - r.top) / r.height)) };
  }

  // clic en el escenario → borne nuevo; arrastrar un borne → moverlo
  let drag = null;
  $('stage').addEventListener('pointerdown', (e) => {
    if (!current) return;
    const termEl = e.target.closest('.term');
    if (termEl) {
      selTerm = termEl.dataset.id;
      drag = { id: selTerm, moved: false };
      $('stage').setPointerCapture(e.pointerId);
      renderStage(); renderTerms();
      return;
    }
    const p = relFromEvent(e);
    const t = { id: uid(), name: nextName(), x: p.x, y: p.y };
    current.terminals.push(t);
    selTerm = t.id;
    setDirty(true);
    renderStage(); renderTerms();
    const input = $('terms').querySelector('input[data-id="' + t.id + '"]');
    if (input) { input.focus(); input.select(); }
  });
  $('stage').addEventListener('pointermove', (e) => {
    if (!drag) return;
    const t = current.terminals.find((x) => x.id === drag.id);
    if (!t) return;
    const p = relFromEvent(e);
    t.x = p.x; t.y = p.y;
    drag.moved = true;
    const el = $('stage').querySelector('.term[data-id="' + t.id + '"]');
    if (el) { el.style.left = (t.x * 100) + '%'; el.style.top = (t.y * 100) + '%'; }
  });
  $('stage').addEventListener('pointerup', () => {
    if (drag && drag.moved) { setDirty(true); renderTerms(); }
    drag = null;
  });

  $('terms').addEventListener('input', (e) => {
    const id = e.target.dataset.id;
    const t = current.terminals.find((x) => x.id === id);
    if (!t) return;
    t.name = e.target.value;
    const label = $('stage').querySelector('.term[data-id="' + id + '"] span');
    if (label) label.textContent = t.name;
    setDirty(true);
  });
  $('terms').addEventListener('focusin', (e) => {
    const id = e.target.dataset && e.target.dataset.id;
    if (id && id !== selTerm) {
      selTerm = id;
      $('stage').querySelectorAll('.term').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
      $('terms').querySelectorAll('.term-row').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
    }
  });
  $('terms').addEventListener('click', (e) => {
    const id = e.target.dataset && e.target.dataset.del;
    if (!id) return;
    removeTerm(id);
  });

  function removeTerm(id) {
    current.terminals = current.terminals.filter((t) => t.id !== id);
    if (selTerm === id) selTerm = null;
    setDirty(true);
    renderStage(); renderTerms();
  }

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selTerm) { e.preventDefault(); removeTerm(selTerm); }
  });

  // Campos

  $('f-name').addEventListener('input', (e) => {
    current.name = e.target.value; setDirty(true);
    const g = $('stage').querySelector('.generic');
    if (g) g.textContent = current.name || 'Componente';
  });
  $('f-cat').addEventListener('input', (e) => { current.category = e.target.value; setDirty(true); });
  $('f-color').addEventListener('input', (e) => { current.color = e.target.value; setDirty(true); renderStage(); });
  $('f-labels').addEventListener('change', (e) => { current.show_labels = e.target.checked; setDirty(true); });
  function onSize(src) {
    let w = Math.max(10, Number($('f-w').value) || current.width);
    let h = Math.max(10, Number($('f-h').value) || current.height);
    if ($('f-ratio').checked) {
      const k = current.height / current.width;
      if (src === 'w') { h = Math.round(w * k); $('f-h').value = h; } else { w = Math.round(h / k); $('f-w').value = w; }
    }
    current.width = w; current.height = h;
    setDirty(true); renderStage();
  }
  $('f-w').addEventListener('change', () => onSize('w'));
  $('f-h').addEventListener('change', () => onSize('h'));

  // Imagen

  async function useImage(file) {
    if (!file || !/^image\//.test(file.type)) { toast('Eso no es una imagen', 'error'); return; }
    try {
      const img = await imageToDataURL(file, 900);
      current.image = img.dataURL;
      const k = img.height / img.width;
      if (!current.terminals.length || $('f-ratio').checked) {
        const w = current.terminals.length ? current.width : 220;
        current.width = w;
        current.height = Math.max(10, Math.round(w * k));
      }
      setDirty(true);
      fillForm(); renderStage();
      toast('Imagen cargada: ahora haz clic sobre cada borne', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  $('drop').addEventListener('click', () => $('f-file').click());
  $('f-file').addEventListener('change', (e) => { useImage(e.target.files[0]); e.target.value = ''; });
  $('drop').addEventListener('dragover', (e) => { e.preventDefault(); $('drop').classList.add('over'); });
  $('drop').addEventListener('dragleave', () => $('drop').classList.remove('over'));
  $('drop').addEventListener('drop', (e) => { e.preventDefault(); $('drop').classList.remove('over'); useImage(e.dataTransfer.files[0]); });
  document.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData ? e.clipboardData.items : [])].find((i) => i.type.indexOf('image/') === 0);
    if (item) { e.preventDefault(); useImage(item.getAsFile()); }
  });
  $('btn-noimg').addEventListener('click', () => { current.image = ''; setDirty(true); fillForm(); renderStage(); });

  // Guardar, duplicar, eliminar

  function payload() {
    return {
      name: current.name.trim() || 'Componente', category: current.category.trim() || 'Mis componentes',
      kind: current.kind, width: current.width, height: current.height, color: current.color,
      image: current.image, show_labels: current.show_labels !== false,
      terminals: current.terminals.map((t) => ({ id: t.id, name: t.name.trim(), x: t.x, y: t.y })),
    };
  }

  $('btn-save').addEventListener('click', async () => {
    if (!current.name.trim()) { toast('Ponle un nombre al componente', 'error'); $('f-name').focus(); return; }
    if (!current.terminals.length && current.kind !== 'junction') {
      if (!confirm('El componente no tiene bornes, así que no se podrá cablear. ¿Guardar igualmente?')) return;
    }
    try {
      const saved = current.id ? await api.updateComponent(current.id, payload()) : await api.createComponent(payload());
      await loadList();
      edit(saved);
      toast('Componente guardado. En el editor pulsa «Recargar biblioteca».', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  });

  $('btn-dup').addEventListener('click', async () => {
    if (!current.id) return;
    try {
      const p = payload();
      p.name += ' (copia)';
      p.terminals = p.terminals.map((t) => Object.assign({}, t, { id: uid() }));
      const saved = await api.createComponent(p);
      await loadList(); edit(saved);
      toast('Copia creada', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  });

  $('btn-del').addEventListener('click', async () => {
    if (!current.id) return;
    if (!confirm('¿Eliminar "' + current.name + '" de la biblioteca?\nLos diagramas que ya lo usan no se ven afectados.')) return;
    try {
      await api.deleteComponent(current.id);
      await loadList();
      edit(blank());
      toast('Componente eliminado');
    } catch (e) { toast(e.message, 'error'); }
  });

  $('btn-new').addEventListener('click', () => { if (confirmLeave()) { edit(blank()); $('f-name').focus(); } });

  window.addEventListener('resize', () => { if (current) renderStage(); });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  (async function init() {
    try { await loadList(); } catch (e) { toast('No se pudo cargar la biblioteca: ' + e.message, 'error'); }
    edit(blank());
    if (new URLSearchParams(location.search).get('nuevo')) $('f-name').focus();
  })();

  window.Designer = { get current() { return current; } };
})();
