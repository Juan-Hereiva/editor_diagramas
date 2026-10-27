/* Formas del editor (compartidas por el editor y el simulador). */
(function () {
  'use strict';
  const FONT = 'Segoe UI, Roboto, Arial, sans-serif';
  // Formas

  const PORT_GROUP = {
    position: { name: 'absolute' },
    markup: [{ tagName: 'circle', selector: 'portBody' }],
    attrs: {
      portBody: { r: 5, magnet: true, fill: '#ffffff', stroke: '#0f172a', strokeWidth: 1.6 },
      label: {
        fontSize: 10, fontWeight: 700, fill: '#0f172a', fontFamily: FONT,
        stroke: '#ffffff', strokeWidth: 3, paintOrder: 'stroke', pointerEvents: 'none',
      },
    },
    label: { markup: [{ tagName: 'text', selector: 'label' }], position: { name: 'right' } },
  };

  const Component = joint.dia.Element.define('elec.Component', {
    size: { width: 120, height: 80 },
    attrs: {
      body: { width: 'calc(w)', height: 'calc(h)', fill: '#eef2f7', stroke: '#475569', strokeWidth: 1.5, rx: 4, ry: 4 },
      image: { width: 'calc(w)', height: 'calc(h)', preserveAspectRatio: 'none' },
      inner: {
        x: 'calc(0.5*w)', y: 'calc(0.5*h)', textAnchor: 'middle', textVerticalAnchor: 'middle',
        fontSize: 12, fontWeight: 600, fill: '#334155', fontFamily: FONT, pointerEvents: 'none',
        textWrap: { width: 'calc(w-16)', height: 'calc(h-16)', ellipsis: true },
      },
      title: {
        x: 'calc(0.5*w)', y: -8, textAnchor: 'middle', textVerticalAnchor: 'bottom',
        fontSize: 12, fontWeight: 700, fill: '#0f172a', fontFamily: FONT,
        stroke: '#ffffff', strokeWidth: 4, paintOrder: 'stroke', pointerEvents: 'none',
      },
    },
    ports: { groups: { t: PORT_GROUP }, items: [] },
  }, {
    markup: [
      { tagName: 'rect', selector: 'body' },
      { tagName: 'image', selector: 'image' },
      { tagName: 'text', selector: 'inner' },
      { tagName: 'text', selector: 'title' },
    ],
  });

  const Junction = joint.dia.Element.define('elec.Junction', {
    size: { width: 22, height: 22 },
    attrs: {
      body: { cx: 'calc(0.5*w)', cy: 'calc(0.5*h)', r: 'calc(0.5*w)', fill: 'rgba(15,23,42,0.001)', stroke: 'none' },
    },
    ports: {
      groups: {
        t: {
          position: { name: 'absolute' },
          markup: [{ tagName: 'circle', selector: 'portBody' }],
          attrs: { portBody: { r: 5.5, magnet: true, fill: '#111827', stroke: '#111827', strokeWidth: 1 } },
        },
      },
      items: [],
    },
  }, { markup: [{ tagName: 'circle', selector: 'body' }] });

  /* Texto libre (nota o rótulo) y zona (recuadro con título para agrupar un área). */
  const Note = joint.dia.Element.define('elec.Note', {
    size: { width: 180, height: 52 },
    attrs: {
      body: { width: 'calc(w)', height: 'calc(h)', fill: '#ffffff', stroke: '#d6d9ea', strokeWidth: 1, rx: 6, ry: 6 },
      label: {
        x: 'calc(0.5*w)', y: 'calc(0.5*h)', textAnchor: 'middle', textVerticalAnchor: 'middle', fontSize: 14, fontWeight: 400,
        fill: '#1e1b3a', fontFamily: FONT, text: 'Texto', pointerEvents: 'none',
        textWrap: { width: 'calc(w-14)', height: 'calc(h-8)', ellipsis: true },
      },
    },
  }, { markup: [{ tagName: 'rect', selector: 'body' }, { tagName: 'text', selector: 'label' }] });

  const Zone = joint.dia.Element.define('elec.Zone', {
    size: { width: 420, height: 260 },
    attrs: {
      hit: { width: 'calc(w)', height: 'calc(h)', fill: 'none', stroke: 'transparent', strokeWidth: 12, rx: 12, ry: 12, pointerEvents: 'stroke' },
      body: { width: 'calc(w)', height: 'calc(h)', fill: '#3b61820d', stroke: '#3b6182', strokeWidth: 1.6, strokeDasharray: '8 5',
        rx: 12, ry: 12, pointerEvents: 'visibleStroke' },
      label: { x: 14, y: 18, textVerticalAnchor: 'middle', fontSize: 14, fontWeight: 700, fill: '#3b6182', fontFamily: FONT, text: 'Zona',
        stroke: '#ffffff', strokeWidth: 4, paintOrder: 'stroke' },
    },
  }, { markup: [{ tagName: 'rect', selector: 'hit' }, { tagName: 'rect', selector: 'body' }, { tagName: 'text', selector: 'label' }] });

  /* Cajetín del plano (datos del plano, como en un plano impreso). */
  const tbTxt = (x, y, size, weight, fill, anchor) => ({ x, y, fontSize: size, fontWeight: weight, fill, fontFamily: FONT,
    textVerticalAnchor: anchor || 'middle', pointerEvents: 'none' });
  const tbLine = (x1, y1, x2, y2) => ({ x1, y1, x2, y2, stroke: '#1f2328', strokeWidth: 1 });
  const TitleBlock = joint.dia.Element.define('elec.TitleBlock', {
    size: { width: 380, height: 120 },
    attrs: {
      body: { width: 'calc(w)', height: 'calc(h)', fill: '#ffffff', stroke: '#1f2328', strokeWidth: 1.8 },
      h1: tbLine(0, 'calc(0.40*h)', 'calc(w)', 'calc(0.40*h)'),
      h2: tbLine(0, 'calc(0.70*h)', 'calc(w)', 'calc(0.70*h)'),
      vA: tbLine('calc(0.62*w)', 'calc(0.40*h)', 'calc(0.62*w)', 'calc(0.70*h)'),
      vB: tbLine('calc(0.40*w)', 'calc(0.70*h)', 'calc(0.40*w)', 'calc(h)'),
      vC: tbLine('calc(0.70*w)', 'calc(0.70*h)', 'calc(0.70*w)', 'calc(h)'),
      k_plano: Object.assign(tbTxt(8, 5, 9, 700, '#5c636c', 'top'), { text: 'Plano' }),
      v_plano: tbTxt(8, 'calc(0.25*h)', 17, 700, '#1f2328'),
      k_proyecto: Object.assign(tbTxt(8, 'calc(0.40*h+4)', 9, 700, '#5c636c', 'top'), { text: 'Proyecto' }),
      v_proyecto: tbTxt(8, 'calc(0.60*h)', 12, 400, '#1e1b3a'),
      k_autor: Object.assign(tbTxt('calc(0.62*w+8)', 'calc(0.40*h+4)', 9, 700, '#5c636c', 'top'), { text: 'Autor' }),
      v_autor: tbTxt('calc(0.62*w+8)', 'calc(0.60*h)', 12, 400, '#1e1b3a'),
      k_fecha: Object.assign(tbTxt(8, 'calc(0.70*h+4)', 9, 700, '#5c636c', 'top'), { text: 'Fecha' }),
      v_fecha: tbTxt(8, 'calc(0.90*h)', 12, 400, '#1e1b3a'),
      k_revision: Object.assign(tbTxt('calc(0.40*w+8)', 'calc(0.70*h+4)', 9, 700, '#5c636c', 'top'), { text: 'Revisión' }),
      v_revision: tbTxt('calc(0.40*w+8)', 'calc(0.90*h)', 12, 400, '#1e1b3a'),
      k_hoja: Object.assign(tbTxt('calc(0.70*w+8)', 'calc(0.70*h+4)', 9, 700, '#5c636c', 'top'), { text: 'Hoja' }),
      v_hoja: tbTxt('calc(0.70*w+8)', 'calc(0.90*h)', 12, 400, '#1e1b3a'),
    },
  }, {
    markup: ['body', 'h1', 'h2', 'vA', 'vB', 'vC'].map((n) => ({ tagName: n === 'body' ? 'rect' : 'line', selector: n }))
      .concat(['plano', 'proyecto', 'autor', 'fecha', 'revision', 'hoja'].flatMap((k) => [
        { tagName: 'text', selector: 'k_' + k }, { tagName: 'text', selector: 'v_' + k }])),
  });

  const namespace = Object.assign({}, joint.shapes, { elec: { Component, Junction, Note, Zone, TitleBlock } });
  window.ElecShapes = { FONT, PORT_GROUP, Component, Junction, Note, Zone, TitleBlock, namespace };
})();
