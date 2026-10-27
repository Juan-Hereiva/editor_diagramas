/* Utilidades compartidas por las tres páginas. */
(function () {
  'use strict';

  async function request(method, url, data) {
    const opts = { method, headers: {} };
    if (data !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(data);
    }
    const res = await fetch(url, opts);
    let payload = null;
    try { payload = await res.json(); } catch (_) { /* sin cuerpo */ }
    if (!res.ok) {
      const msg = (payload && payload.error) || ('Error ' + res.status);
      throw new Error(msg);
    }
    return payload;
  }

  const api = {
    listDiagrams: () => request('GET', '/api/diagrams'),
    getDiagram: (id) => request('GET', '/api/diagrams/' + id),
    createDiagram: (d) => request('POST', '/api/diagrams', d),
    updateDiagram: (id, d) => request('PUT', '/api/diagrams/' + id, d),
    deleteDiagram: (id) => request('DELETE', '/api/diagrams/' + id),
    duplicateDiagram: (id) => request('POST', '/api/diagrams/' + id + '/duplicate', {}),
    listComponents: () => request('GET', '/api/components'),
    createComponent: (c) => request('POST', '/api/components', c),
    updateComponent: (id, c) => request('PUT', '/api/components/' + id, c),
    deleteComponent: (id) => request('DELETE', '/api/components/' + id),
    importBackup: (b) => request('POST', '/api/backup', b),
  };

  /* Tipos de cable con su color convencional. */
  const WIRE_TYPES = [
    { id: 'L',   name: 'Fase L',               color: '#8b1a1a' },
    { id: 'N',   name: 'Neutro N',             color: '#1f5fbf' },
    { id: 'PE',  name: 'Tierra PE',            color: '#2d8659', dash: '9 5' },
    { id: 'V24', name: '+24 V DC',             color: '#d63031' },
    { id: 'GND', name: '0 V / GND',            color: '#2d3436' },
    { id: 'SIG', name: 'Señal de control',     color: '#e67e22' },
    { id: 'FB',  name: 'Retorno / feedback',   color: '#0f9fa8' },
    { id: 'PWR', name: 'Potencia conmutada',   color: '#6c5ce7' },
    { id: 'AN',  name: 'Analógica 4-20 mA',    color: '#c9a400' },
    { id: 'COM', name: 'Comunicación (bus)',   color: '#00a37a' },
    { id: 'OTH', name: 'Otro',                 color: '#64748b' },
  ];
  const wireType = (id) => WIRE_TYPES.find((t) => t.id === id) || WIRE_TYPES[WIRE_TYPES.length - 1];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  let toastTimer = null;
  function toast(msg, kind, ms) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, ms || 2600);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' · ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  }

  /* Reduce una imagen (File/Blob) a un data URL de tamaño razonable. */
  function imageToDataURL(file, maxSide) {
    maxSide = maxSide || 900;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('El archivo no es una imagen válida'));
        img.onload = () => {
          const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * k));
          const h = Math.max(1, Math.round(img.naturalHeight * k));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          // Las capturas de pantalla llegan como PNG pero casi nunca tienen transparencia:
          // si no la tienen se guardan como JPEG, que pesa varias veces menos.
          let transparent = false;
          if (/png|gif|webp|svg/i.test(file.type || '')) {
            try {
              const px = ctx.getImageData(0, 0, w, h).data;
              const stride = Math.max(4, Math.floor(px.length / 4 / 40000) * 4);
              for (let i = 3; i < px.length; i += stride) { if (px[i] < 250) { transparent = true; break; } }
            } catch (_) { transparent = true; }
          }
          let dataURL;
          if (transparent) {
            dataURL = canvas.toDataURL('image/png');
          } else {
            const flat = document.createElement('canvas');
            flat.width = w; flat.height = h;
            const fctx = flat.getContext('2d');
            fctx.fillStyle = '#fff'; fctx.fillRect(0, 0, w, h);
            fctx.drawImage(canvas, 0, 0);
            dataURL = flat.toDataURL('image/jpeg', 0.9);
          }
          resolve({ dataURL, width: w, height: h });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function slug(s) {
    return String(s || 'diagrama').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'diagrama';
  }

  /* Gestos táctiles sobre un plano de JointJS: dos dedos = zoom y desplazamiento a la vez;
     mantener pulsado = menú contextual (en iPhone/iPad no hay clic derecho). */
  function touchGestures(paper, el, opts) {
    opts = opts || {};
    const pts = new Map();
    const minS = opts.minScale || 0.15, maxS = opts.maxScale || 4;
    let pinch = null, lp = null;
    const cancelLp = () => { if (lp) { clearTimeout(lp.t); lp = null; } };
    const two = () => [...pts.values()].slice(0, 2);
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1 && opts.longPress) {
        const x = e.clientX, y = e.clientY, target = e.target;
        lp = { x, y, t: setTimeout(() => { lp = null; touchGestures.last = Date.now(); opts.longPress(x, y, target); }, 550) };
      }
      if (pts.size === 2) {
        cancelLp();
        const [a, b] = two(), t = paper.translate();
        pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, s0: paper.scale().sx, tx: t.tx, ty: t.ty };
        if (opts.onPinchStart) opts.onPinchStart();
      }
    }, true);
    document.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) cancelLp();
      if (!pinch || pts.size < 2) return;
      const [a, b] = two(), r = paper.el.getBoundingClientRect();
      const s = Math.min(maxS, Math.max(minS, pinch.s0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0));
      // el punto del plano que estaba entre los dedos al empezar sigue entre los dedos
      const lx = (pinch.mx - r.left - pinch.tx) / pinch.s0, ly = (pinch.my - r.top - pinch.ty) / pinch.s0;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      paper.scale(s, s);
      paper.translate(mx - r.left - lx * s, my - r.top - ly * s);
      if (opts.onChange) opts.onChange();
    });
    const up = (e) => { if (!pts.delete(e.pointerId)) return; cancelLp(); if (pts.size < 2) pinch = null; };
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }
  touchGestures.last = 0;

  // Tema claro u oscuro: sin elección guardada se sigue al sistema (la página lo aplica en <head>)
  const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
  const THEME_ICON = {
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  };
  const isDark = () => (document.documentElement.dataset.theme || (darkMQ.matches ? 'dark' : 'light')) === 'dark';
  function paintTheme() {
    const next = isDark() ? 'light' : 'dark';
    document.querySelectorAll('.theme-btn').forEach((b) => {
      b.innerHTML = THEME_ICON[next] + '<span>' + (next === 'dark' ? 'Modo oscuro' : 'Modo claro') + '</span>';
      b.title = next === 'dark' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro';
      b.setAttribute('aria-label', b.title);
    });
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.content = isDark() ? '#000000' : '#ffffff'; });
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.theme-btn')) return;
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('editor-diagramas:tema', next); } catch (_) { /* sin almacenamiento: vale para esta página */ }
    paintTheme();
  });
  darkMQ.addEventListener('change', paintTheme);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paintTheme); else paintTheme();

  // App instalable (PWA). El navegador solo lo permite con HTTPS o en localhost.
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => { /* sin service worker */ }));
  }

  // Versión de escritorio (escritorio.py): la ventana avisa de que sigue abierta; cuando no queda
  // ninguna, el programa se cierra solo. En la versión web la ruta no existe y no se repite.
  fetch('/api/latido', { method: 'POST' }).then((r) => {
    if (r.ok) setInterval(() => fetch('/api/latido', { method: 'POST' }).catch(() => {}), 20000);
  }).catch(() => {});

  window.App = { api, WIRE_TYPES, wireType, esc, toast, fmtDate, imageToDataURL, download, slug, touchGestures };
})();
