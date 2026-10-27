/* Paneles plegables del editor: componentes, herramientas, propiedades y modo enfoque.
   El estado se recuerda en este navegador. */
(function () {
  'use strict';
  const KEY = 'editor-diagramas:paneles';
  const st = { left: true, right: true, tools: true, focus: false };
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (_) { /* sin almacenamiento */ }
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  // En pantallas estrechas los paneles son cajones encima del plano (ver responsive.css):
  // empiezan cerrados, solo hay uno abierto a la vez y se cierran al tocar el plano.
  const narrow = window.matchMedia('(max-width: 1023px)');
  if (narrow.matches) { st.left = false; st.right = false; }

  function apply() {
    body.classList.toggle('hide-left', !st.left || st.focus);
    body.classList.toggle('hide-right', !st.right || st.focus);
    body.classList.toggle('hide-tools', !st.tools || st.focus);
    body.classList.toggle('focus', st.focus);
    [['tg-left', st.left], ['tg-right', st.right], ['tg-tools', st.tools], ['tg-focus', st.focus]].forEach(([id, on]) => {
      const b = $(id);
      if (b) b.classList.toggle('on', st.focus ? id === 'tg-focus' : on);
    });
    if (!narrow.matches) { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (_) { /* modo privado */ } }
    // el plano ocupa el hueco que deja el panel cuando termina la animación
    setTimeout(() => window.dispatchEvent(new Event('resize')), 260);
  }

  function toggle(k) {
    if (st.focus) { st.focus = false; st.left = st.right = st.tools = false; }
    st[k] = !st[k];
    if (narrow.matches && st[k] && (k === 'left' || k === 'right')) st[k === 'left' ? 'right' : 'left'] = false;
    apply();
  }
  function closeDrawers() {
    if (!narrow.matches || (!st.left && !st.right)) return;
    st.left = st.right = false;
    apply();
  }
  function setFocus(on) { st.focus = on; apply(); }

  $('tg-left').onclick = () => toggle('left');
  $('tg-right').onclick = () => toggle('right');
  $('tg-tools').onclick = () => toggle('tools');
  $('tg-tools2').onclick = () => toggle('tools');
  $('tg-focus').onclick = () => setFocus(!st.focus);
  $('focus-exit').onclick = () => setFocus(false);
  $('edge-left').onclick = () => toggle('left');
  $('edge-right').onclick = () => toggle('right');
  $('edge-tools').onclick = () => toggle('tools');
  document.querySelectorAll('.panel-x').forEach((b) => { b.onclick = () => toggle(b.dataset.hide); });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey) return;
    if (e.altKey && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
      e.preventDefault();
      toggle({ Digit1: 'left', Digit2: 'tools', Digit3: 'right' }[e.code]);
    } else if (!e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      setFocus(!st.focus);
    }
  });

  const wrap = $('canvas-wrap');
  if (wrap) wrap.addEventListener('pointerdown', closeDrawers);
  const lib = $('library');
  if (lib) lib.addEventListener('click', (e) => { if (e.target.closest('.lib-item')) setTimeout(closeDrawers, 50); });
  narrow.addEventListener('change', (e) => { if (e.matches) { st.left = st.right = false; apply(); } });

  apply();
})();
