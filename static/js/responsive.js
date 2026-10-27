/* Barra superior que se adapta a cualquier ancho: los elementos marcados con data-o="N" pasan a un
   menú «⋯ Más» cuando no caben, empezando por el N más alto. Se recalcula al cambiar el tamaño, así que
   no depende de anchos de dispositivo concretos. */
(function () {
  'use strict';

  function setup(bar) {
    const items = [...bar.querySelectorAll(':scope > [data-o]')]
      .sort((a, b) => Number(b.dataset.o) - Number(a.dataset.o));
    if (!items.length) return;
    const marks = new Map(items.map((el) => { const m = document.createComment('tb'); el.before(m); return [el, m]; }));
    const wrap = document.createElement('div');
    wrap.className = 'tb-more';
    wrap.innerHTML = '<button class="btn tb-more-btn" type="button" aria-haspopup="true" aria-expanded="false" title="Más opciones">' +
      '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg><span>Más</span></button>' +
      '<div class="tb-menu" role="menu"></div>';
    const end = bar.querySelector(':scope > .tb-end');
    if (end) end.before(wrap); else bar.appendChild(wrap);
    const btn = wrap.querySelector('.tb-more-btn'), menu = wrap.querySelector('.tb-menu');

    const close = () => { wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !wrap.classList.contains('open');
      wrap.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) return close();
      // al usar una opción del menú (no un selector) se cierra
      if (e.target.closest('.tb-menu button, .tb-menu a') && !e.target.closest('select, label')) setTimeout(close, 0);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    let busy = false;
    function fit() {
      if (busy) return;
      busy = true;
      items.forEach((el) => { marks.get(el).after(el); el.classList.remove('in-menu'); });
      wrap.style.display = 'none';
      // se mide contra el borde de la propia barra: en un teléfono la página se ensancharía para que
      // cupiera y scrollWidth diría que todo cabe
      const over = () => {
        const r = bar.getBoundingClientRect(), pr = parseFloat(getComputedStyle(bar).paddingRight) || 0;
        const lim = Math.min(r.right, document.documentElement.clientWidth) - pr + 1;
        return [...bar.children].some((c) => c.offsetParent !== null && c.getBoundingClientRect().right > lim);
      };
      if (over()) {
        wrap.style.display = '';
        for (const el of items) {
          if (!over()) break;
          el.classList.add('in-menu');
          menu.appendChild(el);
        }
        // en el menú, en el mismo orden que en la barra
        [...menu.children].sort((a, b) => (marks.get(a).compareDocumentPosition(marks.get(b)) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
          .forEach((el) => menu.appendChild(el));
      }
      if (!menu.children.length) close();
      busy = false;
    }
    new ResizeObserver(() => requestAnimationFrame(fit)).observe(bar);
    window.addEventListener('load', fit);
    document.fonts && document.fonts.ready.then(fit);
    fit();
    bar.fitTopbar = fit;
  }

  /* Barra de herramientas del editor: siempre en una fila. Si no cabe, los grupos con data-o="N" se
     pliegan (N alto primero) en un botón que abre sus opciones en un desplegable. */
  const ICONS = {
    'Ver': '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    'Insertar': '<path d="M12 5v14M5 12h14"/>',
    'Trazado': '<path d="M4 18h6V6h10"/><circle cx="4" cy="18" r="1.6"/><circle cx="20" cy="6" r="1.6"/>',
    'Cable nuevo': '<path d="M3 17c4 0 4-10 9-10s5 10 9 10"/>',
    'Edición': '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  };
  function setupTools(tb) {
    const groups = [...tb.querySelectorAll(':scope > .tgroup[data-o]')]
      .sort((a, b) => Number(b.dataset.o) - Number(a.dataset.o));
    if (!groups.length) return;
    let openG = null;
    groups.forEach((g) => {
      const body = document.createElement('div');
      body.className = 'tg-body';
      while (g.firstChild) body.appendChild(g.firstChild);
      const cap = g.dataset.cap || '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tool-btn tg-btn';
      btn.title = cap;
      btn.setAttribute('aria-haspopup', 'true');
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        (ICONS[cap] || ICONS.Insertar) + '</svg><span>' + cap + '</span><i>▾</i>';
      g.append(btn, body);
      btn.addEventListener('click', (e) => { e.stopPropagation(); openG === g ? close() : open(g); });
    });
    function place(g) {
      const r = g.querySelector('.tg-btn').getBoundingClientRect(), body = g.querySelector('.tg-body');
      body.style.top = Math.round(r.bottom + 6) + 'px';
      const w = body.offsetWidth;
      body.style.left = Math.round(Math.max(8, Math.min(r.left, innerWidth - w - 8))) + 'px';
    }
    function open(g) {
      close();
      openG = g;
      g.classList.add('pop-open');
      g.querySelector('.tg-btn').setAttribute('aria-expanded', 'true');
      place(g);
    }
    function close() {
      if (!openG) return;
      openG.classList.remove('pop-open');
      openG.querySelector('.tg-btn').setAttribute('aria-expanded', 'false');
      openG = null;
    }
    document.addEventListener('click', (e) => {
      if (!openG) return;
      if (!openG.contains(e.target)) return close();
      // un botón del desplegable hace su acción y lo cierra; casillas, selectores y color no
      if (e.target.closest('.tg-body button') && !e.target.closest('.dropper-tb')) setTimeout(close, 0);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    tb.addEventListener('scroll', close);
    window.addEventListener('resize', close);

    let busy = false;
    function fit() {
      if (busy) return;
      busy = true;
      close();
      groups.forEach((g) => g.classList.remove('folded'));
      tb.classList.remove('tb-overflow', 'tb-nocap');
      const over = () => tb.scrollWidth > tb.clientWidth + 1;
      // primero se quitan los títulos de los grupos, luego se pliegan grupos
      if (over()) tb.classList.add('tb-nocap');
      for (const g of groups) {
        if (!over()) break;
        g.classList.add('folded');
      }
      tb.classList.toggle('tb-overflow', over());
      busy = false;
    }
    new ResizeObserver(() => requestAnimationFrame(fit)).observe(tb);
    window.addEventListener('load', fit);
    document.fonts && document.fonts.ready.then(fit);
    fit();
  }

  document.querySelectorAll('.topbar').forEach(setup);
  document.querySelectorAll('.toolbar').forEach(setupTools);
  window.fitTopbars = () => document.querySelectorAll('.topbar').forEach((b) => b.fitTopbar && b.fitTopbar());
})();
