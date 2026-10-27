# -*- coding: utf-8 -*-
"""Genera las placas de desarrollo y módulos (dibujos SVG + bornes) para la biblioteca.

Escala: 0,1" (2,54 mm, el paso de los pines) = 14 px.
Uso:  python tools/placas.py            -> escribe componentes_placas.json junto a app.py
Los pinouts salen de la documentación oficial (Espressif, Arduino, Raspberry Pi)."""
import base64, json, os

P = 14.0          # px por 0,1"
IN = P * 10       # px por pulgada
FONT = 'Arial,Helvetica,sans-serif'


def fmt(v):
    return ('%.2f' % v).rstrip('0').rstrip('.')


class Board:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.parts = []
        self.pins = []           # (nombre, x, y)

    def add(self, s):
        self.parts.append(s)

    def rect(self, x, y, w, h, fill, rx=0, stroke=None, sw=1, extra=''):
        st = ' stroke="%s" stroke-width="%s"' % (stroke, fmt(sw)) if stroke else ''
        self.add('<rect x="%s" y="%s" width="%s" height="%s" rx="%s" fill="%s"%s %s/>' % (fmt(x), fmt(y), fmt(w), fmt(h), fmt(rx), fill, st, extra))

    def circle(self, cx, cy, r, fill, stroke=None, sw=1):
        st = ' stroke="%s" stroke-width="%s"' % (stroke, fmt(sw)) if stroke else ''
        self.add('<circle cx="%s" cy="%s" r="%s" fill="%s"%s/>' % (fmt(cx), fmt(cy), fmt(r), fill, st))

    def text(self, x, y, s, size=7, fill='#fff', anchor='middle', weight='normal', rot=None, family=FONT, extra=''):
        tr = ' transform="rotate(%s %s %s)"' % (fmt(rot), fmt(x), fmt(y)) if rot is not None else ''
        s = s.replace('&', '&amp;').replace('<', '&lt;')
        self.add('<text x="%s" y="%s" font-size="%s" fill="%s" text-anchor="%s" font-weight="%s" font-family="%s" dominant-baseline="central"%s %s>%s</text>'
                 % (fmt(x), fmt(y), fmt(size), fill, anchor, weight, family, tr, extra, s))

    def path(self, d, fill='none', stroke='#000', sw=1, extra=''):
        self.add('<path d="%s" fill="%s" stroke="%s" stroke-width="%s" %s/>' % (d, fill, stroke, fmt(sw), extra))

    # Conectores
    def header(self, x0, y0, names, dx=0.0, dy=0.0, socket=False, pad='#d8b25a'):
        """Fila de pines. socket=True: conector hembra negro (Arduino); si no, pines macho con pad dorado."""
        n = len(names)
        xs = [x0 + i * dx for i in range(n)]
        ys = [y0 + i * dy for i in range(n)]
        x1, y1 = min(xs) - P / 2, min(ys) - P / 2
        w, h = max(xs) - min(xs) + P, max(ys) - min(ys) + P
        if socket:
            self.rect(x1, y1, w, h, '#1b1b1b', 1.5, '#000', 0.6)
            for x, y in zip(xs, ys):
                self.rect(x - 3, y - 3, 6, 6, '#050505', 0.8)
        else:
            self.rect(x1 + 0.5, y1 + 0.5, w - 1, h - 1, '#151515', 1.5)
            for x, y in zip(xs, ys):
                self.rect(x - 4.2, y - 4.2, 8.4, 8.4, pad, 1.2)
                self.circle(x, y, 1.9, '#3a2c10')
        for nm, x, y in zip(names, xs, ys):
            if nm is not None:
                self.pins.append((nm, x, y))
        return list(zip(xs, ys))

    def castellated(self, x0, y0, names, dy, side):
        """Pads almenados (Raspberry Pi Pico)."""
        for i, nm in enumerate(names):
            y = y0 + i * dy
            self.rect(x0 - 5, y - 4, 10, 8, '#d6b45a', 1.5)
            self.circle(x0, y, 2.3, '#3a2c10')
            self.pins.append((nm, x0, y))

    def chip(self, x, y, w, h, label='', size=7, fill='#1c1c1c', pins=0, sub=''):
        if pins:
            for i in range(pins):
                px = x + 4 + i * (w - 8) / max(1, pins - 1)
                self.rect(px - 1, y - 2.5, 2, 3, '#c5c9ce'); self.rect(px - 1, y + h - 0.5, 2, 3, '#c5c9ce')
        self.rect(x, y, w, h, fill, 2, '#4a4d52', 0.8)
        if label:
            self.text(x + w / 2, y + h / 2 - (4 if sub else 0), label, size, '#cfd3d8')
        if sub:
            self.text(x + w / 2, y + h / 2 + 5, sub, size - 2, '#9aa0a6')

    def svg(self):
        return ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">' % (self.w, self.h, self.w, self.h)
                + ''.join(self.parts) + '</svg>')

    def component(self, name, category, show_labels=False, keep_names=False):
        data = 'data:image/svg+xml;base64,' + base64.b64encode(self.svg().encode('utf-8')).decode('ascii')
        seen = {}
        terms = []
        for nm, x, y in self.pins:
            k = nm
            seen[k] = seen.get(k, 0) + 1
            # símbolos (+, −, ~, ·…) se codifican para que «+» y «−» no den el mismo id
            tid = 'p_' + ''.join(ch if (ch.isascii() and ch.isalnum()) else '_%x' % ord(ch) for ch in nm)[:30] + ('_%d' % seen[k] if seen[k] > 1 else '')
            base, n = tid, 2
            while any(t['id'] == tid for t in terms):
                tid = '%s_%d' % (base, n); n += 1
            terms.append({'id': tid[:40], 'name': nm, 'x': round(x / self.w, 4), 'y': round(y / self.h, 4)})
        # nombres repetidos (GND, 5V…) llevan un número para distinguirlos en la lista de conexiones
        counts = {}
        for t in (terms if not keep_names else []):
            counts[t['name']] = counts.get(t['name'], 0) + 1
        idx = {}
        for t in (terms if not keep_names else []):
            if counts[t['name']] > 1:
                idx[t['name']] = idx.get(t['name'], 0) + 1
                t['name'] = '%s·%d' % (t['name'], idx[t['name']])
        return {'name': name, 'category': category, 'kind': 'component', 'width': int(round(self.w)), 'height': int(round(self.h)),
                'color': '#ffffff', 'image': data, 'show_labels': show_labels, 'terminals': terms}


# Piezas comunes

def usb_micro(b, x, y, rot=0):
    g = '<g transform="translate(%s %s) rotate(%s)">' % (fmt(x), fmt(y), rot)
    b.add(g + '<rect x="-17" y="-8" width="34" height="16" rx="2" fill="#c9ccd1" stroke="#7d8288"/><rect x="-12" y="-4" width="24" height="7" rx="1.5" fill="#55595e"/></g>')


def usb_c(b, x, y, rot=0):
    b.add('<g transform="translate(%s %s) rotate(%s)"><rect x="-18" y="-7" width="36" height="14" rx="7" fill="#c9ccd1" stroke="#7d8288"/>'
          '<rect x="-12" y="-3" width="24" height="6" rx="3" fill="#3b3e42"/></g>' % (fmt(x), fmt(y), rot))


def button(b, x, y, s=14, cap='#1d1d1d'):
    b.rect(x - s / 2, y - s / 2, s, s, '#d9dce0', 1.5, '#8a9096', 0.6)
    b.circle(x, y, s * 0.3, cap)


def smd(b, x, y, w=6, h=3, fill='#3a2b1f'):
    b.rect(x - w / 2, y - h / 2, w, h, '#d0d3d6', 0.5)
    b.rect(x - w / 2 + 1.4, y - h / 2, w - 2.8, h, fill)


def led(b, x, y, color):
    b.rect(x - 4, y - 2.5, 8, 5, '#e8e8e8', 1)
    b.rect(x - 2, y - 2.5, 4, 5, color)


def espressif_logo(b, cx, cy, r, col):
    b.circle(cx, cy, r, 'none', col, 1.6)
    for i, rr in enumerate((r * 0.35, r * 0.6, r * 0.85)):
        b.path('M %s %s A %s %s 0 0 1 %s %s' % (fmt(cx - rr * 0.7), fmt(cy + rr * 0.7), fmt(rr), fmt(rr), fmt(cx + rr * 0.7), fmt(cy - rr * 0.7)),
               stroke=col, sw=1.5)


def esp_module(b, x, y, w, h, title, sub='', ant=34):
    """Módulo ESP32 con antena de PCB y blindaje metálico."""
    b.rect(x, y, w, h, '#1f2a24', 2)
    zz = 'M %s %s' % (fmt(x + 8), fmt(y + ant - 8))
    step = (w - 16) / 6
    for i in range(6):
        xx = x + 8 + i * step
        zz += ' V %s H %s V %s H %s' % (fmt(y + 7), fmt(xx + step / 2), fmt(y + ant - 8), fmt(xx + step))
    b.path(zz, stroke='#c9a24a', sw=2.2)
    b.add('<defs><linearGradient id="sh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e6e8eb"/><stop offset="1" stop-color="#a9adb3"/></linearGradient></defs>')
    b.rect(x + 3, y + ant, w - 6, h - ant - 3, 'url(#sh)', 2, '#8b9096', 0.8)
    b.text(x + w / 2, y + ant + 13, title, 8.5 if len(title) < 15 else 7.5, '#3b3f44', weight='bold')
    if sub:
        b.text(x + w / 2, y + ant + 24, sub, 6, '#50555b')
    espressif_logo(b, x + w / 2, y + ant + (h - ant) * 0.62, min(w, h - ant) * 0.17, '#c0392b')


def side_labels(b, coords, names, side, size=6.6, col='#ffffff'):
    for (x, y), nm in zip(coords, names):
        if side == 'L':
            b.text(x + 9, y, nm, size, col, 'start')
        else:
            b.text(x - 9, y, nm, size, col, 'end')


# ESP32

def esp32_devkitc():
    W, H = 154, 345
    b = Board(W, H)
    b.rect(2, 10, W - 4, H - 12, '#1d1d1f', 7, '#000', 0.8)
    left = ['3V3', 'EN', 'VP', 'VN', '34', '35', '32', '33', '25', '26', '27', '14', '12', 'GND', '13', 'D2', 'D3', 'CMD', '5V']
    right = ['GND', '23', '22', 'TX', 'RX', '21', 'GND', '19', '18', '5', '17', '16', '4', '0', '2', '15', 'D1', 'D0', 'CLK']
    full_l = ['3V3', 'EN', 'GPIO36 (VP)', 'GPIO39 (VN)', 'GPIO34', 'GPIO35', 'GPIO32', 'GPIO33', 'GPIO25', 'GPIO26', 'GPIO27', 'GPIO14',
              'GPIO12', 'GND', 'GPIO13', 'GPIO9 (SD2)', 'GPIO10 (SD3)', 'GPIO11 (CMD)', '5V']
    full_r = ['GND', 'GPIO23', 'GPIO22', 'GPIO1 (TX)', 'GPIO3 (RX)', 'GPIO21', 'GND', 'GPIO19', 'GPIO18', 'GPIO5', 'GPIO17', 'GPIO16', 'GPIO4',
              'GPIO0', 'GPIO2', 'GPIO15', 'GPIO8 (SD1)', 'GPIO7 (SD0)', 'GPIO6 (CLK)']
    y0 = 36
    esp_module(b, 30, 2, 94, 152, 'ESP32-WROOM-32', 'Espressif')
    cl = b.header(8, y0, full_l, dy=P)
    cr = b.header(W - 8, y0, full_r, dy=P)
    side_labels(b, cl, left, 'L')
    side_labels(b, cr, right, 'R')
    b.chip(58, 205, 38, 30, 'CP2102', 6)
    button(b, 34, 314); b.text(34, 301, 'EN', 6.5)
    button(b, 120, 314); b.text(120, 301, 'BOOT', 6.5)
    led(b, 60, 255, '#ff3b30'); led(b, 94, 255, '#3aa0ff')
    b.text(77, 172, 'ESP32-DevKitC', 7.5, '#d0d0d0', weight='bold')
    usb_micro(b, 77, H - 6)
    return b.component('ESP32 DevKitC V4 (38 pines)', 'Microcontroladores · ESP32')


def esp32_devkit_v1():
    W, H = 154, 318
    b = Board(W, H)
    b.rect(2, 10, W - 4, H - 12, '#16263a', 7, '#000', 0.8)
    left = ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND', 'VIN']
    right = ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', 'GND', '3V3']
    full_l = ['EN', 'GPIO36 (VP)', 'GPIO39 (VN)', 'GPIO34', 'GPIO35', 'GPIO32', 'GPIO33', 'GPIO25', 'GPIO26', 'GPIO27', 'GPIO14', 'GPIO12',
              'GPIO13', 'GND', 'VIN']
    full_r = ['GPIO23', 'GPIO22', 'GPIO1 (TX0)', 'GPIO3 (RX0)', 'GPIO21', 'GPIO19', 'GPIO18', 'GPIO5', 'GPIO17 (TX2)', 'GPIO16 (RX2)', 'GPIO4',
              'GPIO2', 'GPIO15', 'GND', '3V3']
    esp_module(b, 30, 2, 94, 150, 'ESP-WROOM-32', 'Espressif')
    cl = b.header(8, 62, full_l, dy=P)
    cr = b.header(W - 8, 62, full_r, dy=P)
    side_labels(b, cl, left, 'L')
    side_labels(b, cr, right, 'R')
    b.chip(58, 190, 38, 30, 'CP2102', 6)
    button(b, 36, 288); b.text(36, 275, 'EN', 6.5)
    button(b, 118, 288); b.text(118, 275, 'BOOT', 6.5)
    led(b, 77, 238, '#ff3b30')
    b.text(77, 168, 'ESP32 DEVKIT V1', 7.5, '#d0d0d0', weight='bold')
    b.text(77, 178, 'DOIT', 6.5, '#9fb3c8')
    usb_micro(b, 77, H - 6)
    return b.component('ESP32 DevKit V1 DOIT (30 pines)', 'Microcontroladores · ESP32')


def esp32_s3():
    W, H = 154, 395
    b = Board(W, H)
    b.rect(2, 10, W - 4, H - 22, '#1d1d1f', 7, '#000', 0.8)
    j1 = ['3V3', '3V3', 'RST', '4', '5', '6', '7', '15', '16', '17', '18', '8', '3', '46', '9', '10', '11', '12', '13', '14', '5V', 'G']
    j3 = ['G', 'TX', 'RX', '1', '2', '42', '41', '40', '39', '38', '37', '36', '35', '0', '45', '48', '47', '21', '20', '19', 'G', 'G']
    fl = [('GPIO' + n if n.isdigit() else ('GND' if n == 'G' else n)) for n in j1]
    fr = [('GPIO' + n if n.isdigit() else ('GND' if n == 'G' else ('GPIO43 (TX)' if n == 'TX' else ('GPIO44 (RX)' if n == 'RX' else n)))) for n in j3]
    esp_module(b, 30, 2, 94, 150, 'ESP32-S3-WROOM-1', 'Espressif')
    cl = b.header(8, 26, fl, dy=P)
    cr = b.header(W - 8, 26, fr, dy=P)
    side_labels(b, cl, j1, 'L')
    side_labels(b, cr, j3, 'R')
    b.text(77, 168, 'ESP32-S3-DevKitC-1', 7.5, '#d0d0d0', weight='bold')
    b.circle(77, 190, 6, '#f2f2f2', '#999'); b.text(77, 202, 'RGB', 5.5, '#bbb')
    b.chip(60, 230, 34, 26, 'CP2102N', 5.5)
    button(b, 36, 344); b.text(36, 331, 'BOOT', 6)
    button(b, 118, 344); b.text(118, 331, 'RST', 6)
    usb_c(b, 50, H - 14); b.text(50, H - 26, 'USB', 5.5, '#bbb')
    usb_c(b, 104, H - 14); b.text(104, H - 26, 'UART', 5.5, '#bbb')
    return b.component('ESP32-S3-DevKitC-1 (44 pines)', 'Microcontroladores · ESP32')


def esp32_c3():
    W, H = 154, 318
    b = Board(W, H)
    b.rect(2, 10, W - 4, H - 22, '#1d1d1f', 7, '#000', 0.8)
    j1 = ['GND', '3V3', '3V3', 'IO2', 'IO3', 'GND', 'RST', 'GND', 'IO0', 'IO1', 'IO10', 'GND', '5V', '5V', 'GND']
    j3 = ['GND', 'TX', 'RX', 'GND', 'IO9', 'IO8', 'GND', 'IO7', 'IO6', 'IO5', 'IO4', 'GND', 'IO18', 'IO19', 'GND']
    fl = [n.replace('IO', 'GPIO') for n in j1]
    fr = [('GPIO21 (TX)' if n == 'TX' else 'GPIO20 (RX)' if n == 'RX' else n.replace('IO', 'GPIO')) for n in j3]
    esp_module(b, 38, 8, 78, 104, 'ESP32-C3-MINI-1', '', ant=28)
    cl = b.header(8, 46, fl, dy=P)
    cr = b.header(W - 8, 46, fr, dy=P)
    side_labels(b, cl, j1, 'L')
    side_labels(b, cr, j3, 'R')
    b.text(77, 130, 'ESP32-C3-DevKitM-1', 7.2, '#d0d0d0', weight='bold')
    b.circle(77, 150, 6, '#f2f2f2', '#999'); b.text(77, 162, 'RGB', 5.5, '#bbb')
    b.chip(60, 180, 34, 26, 'CP2102N', 5.5)
    button(b, 36, 270); b.text(36, 257, 'BOOT', 6)
    button(b, 118, 270); b.text(118, 257, 'RST', 6)
    usb_micro(b, 77, H - 14)
    return b.component('ESP32-C3-DevKitM-1 (30 pines)', 'Microcontroladores · ESP32')


# Arduino

def arduino_logo(b, cx, cy, s, col='#fff'):
    r = s
    b.circle(cx - r * 0.95, cy, r, 'none', col, s * 0.38)
    b.circle(cx + r * 0.95, cy, r, 'none', col, s * 0.38)
    b.path('M %s %s H %s' % (fmt(cx - r * 1.4), fmt(cy), fmt(cx - r * 0.5)), stroke=col, sw=s * 0.3)
    b.path('M %s %s H %s M %s %s V %s' % (fmt(cx + r * 0.5), fmt(cy), fmt(cx + r * 1.4), fmt(cx + r * 0.95), fmt(cy - r * 0.45), fmt(cy + r * 0.45)), stroke=col, sw=s * 0.3)


def uno_layout(b, ox, oy, top10, top8, power, analog, labels_power, labels_analog, top_labels10, top_labels8, extra_top=None):
    """Conectores en las posiciones de la placa UNO (pulgadas desde el borde superior izquierdo)."""
    yT = oy + 0.1 * IN
    yB = oy + 2.0 * IN
    x10 = [0.84 + 0.1 * i for i in range(10)]
    x8 = [1.9 + 0.1 * i for i in range(8)]
    c10 = b.header(ox + x10[0] * IN, yT, top10, dx=P, socket=True)
    c8 = b.header(ox + x8[0] * IN, yT, top8, dx=P, socket=True)
    cp = b.header(ox + 1.0 * IN, yB, power, dx=P, socket=True)
    ca = b.header(ox + 1.9 * IN, yB, analog, dx=P, socket=True)
    for (x, y), t in zip(c10, top_labels10):
        b.text(x, y + 13, t, 6.2, '#fff', 'end', rot=-90)
    for (x, y), t in zip(c8, top_labels8):
        b.text(x, y + 13, t, 6.2, '#fff', 'end', rot=-90)
    for (x, y), t in zip(cp, labels_power):
        b.text(x, y - 13, t, 6.2, '#fff', 'start', rot=-90)
    for (x, y), t in zip(ca, labels_analog):
        b.text(x, y - 13, t, 6.2, '#fff', 'start', rot=-90)
    return c10, c8, cp, ca


def arduino_uno():
    OX, OY = 22, 4
    W, H = int(OX + 2.7 * IN + 4), int(OY + 2.1 * IN + 4)
    b = Board(W, H)
    b.rect(OX, OY, 2.7 * IN, 2.1 * IN, '#1d6fa6', 9, '#0f4a73', 1)
    for hx, hy in ((0.55, 0.1), (0.6, 2.0), (2.6, 0.3), (2.6, 1.4)):
        b.circle(OX + hx * IN, OY + hy * IN, 5.5, '#f1f1f1', '#0f4a73')
    # USB-B y jack de alimentación
    b.rect(0, OY + 0.38 * IN, 0.62 * IN, 0.48 * IN, '#c8cbcf', 2, '#7d8288'); b.rect(6, OY + 0.45 * IN, 0.45 * IN, 0.34 * IN, '#9fa4aa', 1)
    b.rect(2, OY + 1.55 * IN, 0.55 * IN, 0.38 * IN, '#1b1b1b', 3); b.circle(38, OY + 1.74 * IN, 9, '#333')
    top10 = ['SCL', 'SDA', 'AREF', 'GND', 'D13', 'D12', 'D11 ~', 'D10 ~', 'D9 ~', 'D8']
    top8 = ['D7', 'D6 ~', 'D5 ~', 'D4', 'D3 ~', 'D2', 'D1 (TX)', 'D0 (RX)']
    power = [None, 'IOREF', 'RESET', '3.3V', '5V', 'GND', 'GND', 'VIN']
    analog = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5']
    uno_layout(b, OX, OY, top10, top8, power, analog, ['', 'IOREF', 'RESET', '3.3V', '5V', 'GND', 'GND', 'Vin'], analog,
               ['SCL', 'SDA', 'AREF', 'GND', '13', '12', '~11', '~10', '~9', '8'], ['7', '~6', '~5', '4', '~3', '2', 'TX→1', 'RX←0'])
    b.text(OX + 2.22 * IN, OY + 0.33 * IN, 'DIGITAL (PWM~)', 6.5, '#fff', weight='bold')
    b.text(OX + 1.35 * IN, OY + 1.73 * IN, 'POWER', 6.5, '#fff', weight='bold')
    b.text(OX + 2.15 * IN, OY + 1.73 * IN, 'ANALOG IN', 6.5, '#fff', weight='bold')
    # chips
    b.chip(OX + 1.25 * IN, OY + 1.12 * IN, 1.38 * IN, 0.34 * IN, 'ATMEGA328P-PU', 7.5, pins=14)
    b.chip(OX + 0.78 * IN, OY + 0.58 * IN, 0.22 * IN, 0.22 * IN, '16U2', 5)
    b.rect(OX + 1.02 * IN, OY + 0.96 * IN, 0.18 * IN, 0.08 * IN, '#c9ccd1', 3)
    # logo y texto
    arduino_logo(b, OX + 1.35 * IN, OY + 0.62 * IN, 9)
    b.rect(OX + 1.6 * IN, OY + 0.52 * IN, 0.5 * IN, 0.22 * IN, 'none', 3, '#fff', 1.2)
    b.text(OX + 1.85 * IN, OY + 0.63 * IN, 'UNO', 13, '#fff', weight='bold')
    b.text(OX + 1.35 * IN, OY + 0.86 * IN, 'ARDUINO', 8, '#fff', weight='bold')
    # ICSP, reset, leds
    b.header(OX + 2.55 * IN, OY + 0.95 * IN, [None, None, None], dy=P)
    b.header(OX + 2.65 * IN, OY + 0.95 * IN, [None, None, None], dy=P)
    button(b, OX + 0.3 * IN, OY + 0.2 * IN, 16, '#c0392b')
    for i, (t, c) in enumerate((('L', '#ffb020'), ('TX', '#ffb020'), ('RX', '#ffb020'))):
        led(b, OX + 0.95 * IN, OY + (0.36 + i * 0.08) * IN, c); b.text(OX + 1.05 * IN, OY + (0.36 + i * 0.08) * IN, t, 5, '#fff', 'start')
    led(b, OX + 2.45 * IN, OY + 1.62 * IN, '#3ddc4b'); b.text(OX + 2.45 * IN, OY + 1.55 * IN, 'ON', 5, '#fff')
    return b.component('Arduino Uno R3', 'Microcontroladores · Arduino')


def arduino_uno_q():
    OX, OY = 22, 4
    W, H = int(OX + 2.7 * IN + 4), int(OY + 2.1 * IN + 4)
    b = Board(W, H)
    b.rect(OX, OY, 2.7 * IN, 2.1 * IN, '#1f2a2e', 9, '#000', 1)
    for hx, hy in ((0.55, 0.1), (0.6, 2.0), (2.6, 0.3), (2.6, 1.4)):
        b.circle(OX + hx * IN, OY + hy * IN, 5.5, '#c9ccd1', '#000')
    usb_c(b, 14, OY + 0.62 * IN, 90)
    top10 = ['D21 (SCL)', 'D20 (SDA)', 'AREF', 'GND', 'D13', 'D12', 'D11 ~', 'D10 ~', 'D9 ~', 'D8']
    top8 = ['D7', 'D6 ~', 'D5 ~', 'D4', 'D3 ~', 'D2', 'D1', 'D0']
    power = ['BOOT', 'IOREF', 'RESET', '+3V3', '+5V', 'GND', 'GND', 'VIN']
    analog = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5']
    uno_layout(b, OX, OY, top10, top8, power, analog, ['BOOT', 'IOREF', 'RESET', '3V3', '5V', 'GND', 'GND', 'VIN'], analog,
               ['SCL', 'SDA', 'AREF', 'GND', '13', '12', '~11', '~10', '~9', '8'], ['7', '~6', '~5', '4', '~3', '2', '1', '0'])
    b.chip(OX + 0.85 * IN, OY + 0.55 * IN, 0.55 * IN, 0.55 * IN, 'QRB2210', 6.5, '#2a2d30', sub='Qualcomm')
    b.chip(OX + 1.55 * IN, OY + 0.6 * IN, 0.4 * IN, 0.4 * IN, 'STM32', 6, '#2a2d30', sub='U585')
    # matriz de LEDs 8×13
    mx, my = OX + 1.2 * IN, OY + 1.2 * IN
    b.rect(mx - 4, my - 4, 13 * 7 + 4, 8 * 5 + 4, '#111', 2)
    for r in range(8):
        for c in range(13):
            b.rect(mx + c * 7, my + r * 5, 3.4, 2.2, '#ffb6a0' if (r + c) % 5 == 0 else '#6b3a30', 0.5)
    b.text(OX + 2.25 * IN, OY + 0.62 * IN, 'UNO Q', 15, '#fff', weight='bold')
    arduino_logo(b, OX + 2.2 * IN, OY + 0.88 * IN, 7)
    b.text(OX + 0.3 * IN, OY + 1.4 * IN, 'QWIIC', 5.5, '#9fd8e0')
    b.header(OX + 0.25 * IN, OY + 1.5 * IN, [None, None, None, None], dy=P * 0.7)
    return b.component('Arduino UNO Q', 'Microcontroladores · Arduino')


def arduino_mega():
    OX, OY = 22, 4
    W, H = int(OX + 4.0 * IN + 4), int(OY + 2.1 * IN + 4)
    b = Board(W, H)
    b.rect(OX, OY, 4.0 * IN, 2.1 * IN, '#1d6fa6', 9, '#0f4a73', 1)
    b.rect(0, OY + 0.38 * IN, 0.62 * IN, 0.48 * IN, '#c8cbcf', 2, '#7d8288'); b.rect(6, OY + 0.45 * IN, 0.45 * IN, 0.34 * IN, '#9fa4aa', 1)
    b.rect(2, OY + 1.55 * IN, 0.55 * IN, 0.38 * IN, '#1b1b1b', 3); b.circle(38, OY + 1.74 * IN, 9, '#333')
    top10 = ['SCL', 'SDA', 'AREF', 'GND', 'D13', 'D12', 'D11 ~', 'D10 ~', 'D9 ~', 'D8 ~']
    top8 = ['D7 ~', 'D6 ~', 'D5 ~', 'D4 ~', 'D3 ~', 'D2 ~', 'D1 (TX0)', 'D0 (RX0)']
    power = [None, 'IOREF', 'RESET', '3.3V', '5V', 'GND', 'GND', 'VIN']
    analog = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']
    yT, yB = OY + 0.1 * IN, OY + 2.0 * IN
    for xs, nm, lab in ((0.84, top10, ['SCL', 'SDA', 'AREF', 'GND', '13', '12', '11', '10', '9', '8']),
                        (1.9, top8, ['7', '6', '5', '4', '3', '2', 'TX0', 'RX0']),
                        (2.76, ['D14 (TX3)', 'D15 (RX3)', 'D16 (TX2)', 'D17 (RX2)', 'D18 (TX1)', 'D19 (RX1)', 'D20 (SDA)', 'D21 (SCL)'],
                         ['TX3 14', 'RX3 15', 'TX2 16', 'RX2 17', 'TX1 18', 'RX1 19', 'SDA 20', 'SCL 21'])):
        cs = b.header(OX + xs * IN, yT, nm, dx=P, socket=True)
        for (x, y), t in zip(cs, lab):
            b.text(x, y + 13, t, 6, '#fff', 'end', rot=-90)
    for xs, nm, lab in ((1.0, power, ['', 'IOREF', 'RESET', '3.3V', '5V', 'GND', 'GND', 'Vin']), (1.9, analog, analog),
                        (2.76, ['A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15'], ['A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15'])):
        cs = b.header(OX + xs * IN, yB, nm, dx=P, socket=True)
        for (x, y), t in zip(cs, lab):
            b.text(x, y - 13, t, 6, '#fff', 'start', rot=-90)
    # doble fila 22–53
    rows = [('5V', '5V')] + [('D%d' % (22 + 2 * i), 'D%d' % (23 + 2 * i)) for i in range(16)] + [('GND', 'GND')]
    xl, xr = OX + 3.75 * IN, OX + 3.85 * IN
    y0 = OY + 0.2 * IN
    b.rect(xl - P / 2, y0 - P / 2, 2 * P, len(rows) * P, '#1b1b1b', 1.5)
    for i, (a, c) in enumerate(rows):
        y = y0 + i * P
        for x, nm in ((xl, a), (xr, c)):
            b.rect(x - 3, y - 3, 6, 6, '#050505', 0.8)
            b.pins.append((nm, x, y))
        b.text(xl - 10, y, a.replace('D', ''), 5.6, '#fff', 'end')
        b.text(xr + 10, y, c.replace('D', ''), 5.6, '#fff', 'start')
    b.chip(OX + 1.75 * IN, OY + 0.75 * IN, 0.6 * IN, 0.6 * IN, 'ATMEGA2560', 6.5)
    arduino_logo(b, OX + 1.0 * IN, OY + 0.8 * IN, 9)
    b.text(OX + 1.0 * IN, OY + 1.05 * IN, 'ARDUINO', 8, '#fff', weight='bold')
    b.text(OX + 2.9 * IN, OY + 0.9 * IN, 'MEGA 2560', 14, '#fff', weight='bold')
    b.text(OX + 2.48 * IN, OY + 0.33 * IN, 'PWM', 6, '#fff', weight='bold')
    b.text(OX + 3.12 * IN, OY + 0.33 * IN, 'COMMUNICATION', 6, '#fff', weight='bold')
    b.text(OX + 2.35 * IN, OY + 1.72 * IN, 'ANALOG IN', 6.5, '#fff', weight='bold')
    button(b, OX + 0.3 * IN, OY + 0.2 * IN, 16, '#c0392b')
    return b.component('Arduino Mega 2560', 'Microcontroladores · Arduino')


def arduino_nano():
    OX, OY = 16, 4
    W, H = int(OX + 1.7 * IN + 4), int(OY + 0.7 * IN + 4)
    b = Board(W, H)
    b.rect(OX, OY, 1.7 * IN, 0.7 * IN, '#1d6fa6', 5, '#0f4a73', 1)
    b.rect(0, OY + 0.22 * IN, 0.36 * IN, 0.26 * IN, '#c8cbcf', 2, '#7d8288')
    top = ['D13', '3V3', 'AREF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RST', 'GND', 'VIN']
    bot = ['D12', 'D11 ~', 'D10 ~', 'D9 ~', 'D8', 'D7', 'D6 ~', 'D5 ~', 'D4', 'D3 ~', 'D2', 'GND', 'RST', 'RX0 (D0)', 'TX1 (D1)']
    x0 = OX + 0.15 * IN
    ct = b.header(x0, OY + 0.05 * IN, top, dx=P)
    cb = b.header(x0, OY + 0.65 * IN, bot, dx=P)
    for (x, y), t in zip(ct, ['D13', '3V3', 'REF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RST', 'GND', 'VIN']):
        b.text(x, y + 11, t, 5.2, '#fff', 'start', rot=90)
    for (x, y), t in zip(cb, ['D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'GND', 'RST', 'RX0', 'TX1']):
        b.text(x, y - 11, t, 5.2, '#fff', 'end', rot=90)
    b.chip(OX + 0.75 * IN, OY + 0.24 * IN, 0.3 * IN, 0.22 * IN, '328P', 5.5)
    button(b, OX + 1.2 * IN, OY + 0.35 * IN, 12, '#ddd')
    b.text(OX + 1.48 * IN, OY + 0.35 * IN, 'NANO', 7, '#fff', weight='bold', rot=-90)
    return b.component('Arduino Nano', 'Microcontroladores · Arduino')


# Raspberry Pi

def rpi_logo(b, cx, cy, s):
    b.path('M %s %s q %s %s %s %s' % (fmt(cx - s * 0.2), fmt(cy - s * 0.95), fmt(-s * 0.4), fmt(-s * 0.3), fmt(-s * 0.7), fmt(-s * 0.1)), stroke='#7ad46b', sw=s * 0.22)
    b.path('M %s %s q %s %s %s %s' % (fmt(cx + s * 0.2), fmt(cy - s * 0.95), fmt(s * 0.4), fmt(-s * 0.3), fmt(s * 0.7), fmt(-s * 0.1)), stroke='#7ad46b', sw=s * 0.22)
    for dx, dy in ((0, -0.45), (-0.45, -0.15), (0.45, -0.15), (-0.28, 0.32), (0.28, 0.32), (0, 0.72), (0, 0.05)):
        b.circle(cx + dx * s, cy + dy * s, s * 0.27, '#c51a4a', '#ffffff', s * 0.07)


def pi_gpio_names():
    m = {1: '3V3', 2: '5V', 3: 'GPIO2 (SDA)', 4: '5V', 5: 'GPIO3 (SCL)', 6: 'GND', 7: 'GPIO4', 8: 'GPIO14 (TXD)', 9: 'GND', 10: 'GPIO15 (RXD)',
         11: 'GPIO17', 12: 'GPIO18', 13: 'GPIO27', 14: 'GND', 15: 'GPIO22', 16: 'GPIO23', 17: '3V3', 18: 'GPIO24', 19: 'GPIO10 (MOSI)', 20: 'GND',
         21: 'GPIO9 (MISO)', 22: 'GPIO25', 23: 'GPIO11 (SCLK)', 24: 'GPIO8 (CE0)', 25: 'GND', 26: 'GPIO7 (CE1)', 27: 'ID_SD', 28: 'ID_SC',
         29: 'GPIO5', 30: 'GND', 31: 'GPIO6', 32: 'GPIO12', 33: 'GPIO13', 34: 'GND', 35: 'GPIO19', 36: 'GPIO16', 37: 'GPIO26', 38: 'GPIO20',
         39: 'GND', 40: 'GPIO21'}
    return {k: '%s · pin %d' % (v, k) for k, v in m.items()}


def pi_header(b, ox, oy, x_mm_first=8.37):
    """Conector de 40 pines: fila exterior = pines pares, interior = impares; pin 1 a la izquierda."""
    mm = IN / 25.4
    names = pi_gpio_names()
    x0 = ox + x_mm_first * mm
    yo, yi = oy + 2.23 * mm, oy + 4.77 * mm
    b.rect(x0 - P / 2, yo - P / 2, 20 * P, 2 * P, '#151515', 1.5)
    for i in range(20):
        x = x0 + i * P
        for y, pin in ((yi, 2 * i + 1), (yo, 2 * i + 2)):
            if pin == 1:
                b.rect(x - 4.2, y - 4.2, 8.4, 8.4, '#d8b25a', 0.6)
            else:
                b.circle(x, y, 4.2, '#d8b25a')
            b.circle(x, y, 1.9, '#3a2c10')
            b.pins.append((names[pin], x, y))
    b.text(x0 - 9, yi, '1', 6, '#fff', 'end')
    b.text(x0 + 19 * P + 9, yo, '40', 6, '#fff', 'start')


def raspberry_pi(model):
    mm = IN / 25.4
    OX, OY = 4, 4
    W, H = int(OX + 85 * mm + 26), int(OY + 56 * mm + 16)
    b = Board(W, H)
    b.rect(OX, OY, 85 * mm, 56 * mm, '#1b7a3c' if model == 4 else '#1a6e38', 3 * mm, '#0d4d24', 1)
    for hx, hy in ((3.5, 3.5), (61.5, 3.5), (3.5, 52.5), (61.5, 52.5)):
        b.circle(OX + hx * mm, OY + hy * mm, 3.1 * mm / 2 + 2, '#d9b75b'); b.circle(OX + hx * mm, OY + hy * mm, 2.7 * mm / 2, '#fff')
    pi_header(b, OX, OY)
    R = OX + 85 * mm

    def eth(y):
        b.rect(R - 21 * mm, OY + y - 8 * mm, 21 * mm + 18, 16 * mm, '#c9ccd1', 2, '#7d8288')
        b.rect(R - 6 * mm, OY + y - 5 * mm, 6 * mm + 14, 10 * mm, '#2b2d30', 1)
        b.rect(R + 6, OY + y - 6 * mm, 4, 2 * mm, '#f5a623'); b.rect(R + 6, OY + y + 4 * mm, 4, 2 * mm, '#4cd964')

    def usb_pair(y, blue):
        b.rect(R - 17 * mm, OY + y - 7.5 * mm, 17 * mm + 18, 15 * mm, '#c9ccd1', 2, '#7d8288')
        for dy in (-3.4, 3.4):
            b.rect(R - 3 * mm, OY + y + dy * mm - 2.4 * mm, 3 * mm + 14, 4.8 * mm, '#1f4fbf' if blue else '#202224', 1)
    if model == 4:
        eth(10.25); usb_pair(29, True); usb_pair(47, False)
    else:
        usb_pair(9, False); usb_pair(27, True); eth(45.75)
    B = OY + 56 * mm
    # puertos inferiores
    b.rect(OX + 11.2 * mm - 4.5 * mm, B - 7 * mm, 9 * mm, 8 * mm, '#c9ccd1', 2, '#7d8288'); b.text(OX + 11.2 * mm, B - 9 * mm, 'POWER', 5, '#fff')
    for xh in ((26, 39.5) if model == 4 else (25.8, 39.2)):
        b.rect(OX + xh * mm - 3.6 * mm, B - 7 * mm, 7.2 * mm, 8 * mm, '#c9ccd1', 1.5, '#7d8288')
        b.text(OX + xh * mm, B - 9 * mm, 'HDMI', 5, '#fff')
    if model == 4:
        b.rect(OX + 54 * mm - 3.5 * mm, B - 12 * mm, 7 * mm, 13 * mm, '#1b1b1b', 2); b.circle(OX + 54 * mm, B - 2 * mm, 2.5 * mm, '#333')
        b.chip(OX + 22 * mm, OY + 22 * mm, 15 * mm, 15 * mm, 'BCM2711', 8, '#b7bbc0')
        b.chip(OX + 40 * mm, OY + 23 * mm, 9 * mm, 12 * mm, 'RAM', 6.5)
        b.rect(OX + 6 * mm, OY + 10 * mm, 12 * mm, 10 * mm, '#c4c8cc', 1, '#8b9096', 0.6)
        b.text(OX + 12 * mm, OY + 15 * mm, 'WiFi/BT', 5.5, '#4a4f55')
        b.text(OX + 30 * mm, OY + 44 * mm, 'Raspberry Pi 4 Model B', 9, '#fff', weight='bold')
        b.text(OX + 30 * mm, OY + 48.5 * mm, '© Raspberry Pi 2018', 6, '#cfe9d6')
        rpi_logo(b, OX + 52 * mm, OY + 35 * mm, 9)
        name = 'Raspberry Pi 4 Model B (GPIO 40 pines)'
    else:
        b.chip(OX + 22 * mm, OY + 20 * mm, 15 * mm, 15 * mm, 'BCM2712', 8, '#b7bbc0')
        b.chip(OX + 40 * mm, OY + 21 * mm, 10 * mm, 13 * mm, 'LPDDR4X', 6)
        b.chip(OX + 58 * mm, OY + 24 * mm, 8 * mm, 8 * mm, 'RP1', 6.5)
        b.rect(OX + 6 * mm, OY + 10 * mm, 12 * mm, 10 * mm, '#c4c8cc', 1, '#8b9096', 0.6)
        b.text(OX + 12 * mm, OY + 15 * mm, 'WiFi/BT', 5.5, '#4a4f55')
        b.rect(OX + 46 * mm, OY + 37 * mm, 6 * mm, 3 * mm, '#f2f2f2', 0.5); b.text(OX + 49 * mm, OY + 41.5 * mm, 'FAN', 5, '#fff')
        b.rect(OX - 1, OY + 41 * mm, 4 * mm, 5 * mm, '#ddd', 1, '#888'); b.text(OX + 5 * mm, OY + 43.5 * mm, 'PWR', 5, '#fff', 'start')
        b.rect(OX + 2 * mm, OY + 20 * mm, 3 * mm, 15 * mm, '#d9d9d9', 0.5); b.text(OX + 7.5 * mm, OY + 27.5 * mm, 'PCIe', 5, '#fff', rot=-90)
        b.text(OX + 30 * mm, OY + 42 * mm, 'Raspberry Pi 5', 10, '#fff', weight='bold')
        b.text(OX + 30 * mm, OY + 46.5 * mm, '© Raspberry Pi Ltd 2023', 6, '#cfe9d6')
        rpi_logo(b, OX + 13 * mm, OY + 42 * mm, 8)
        name = 'Raspberry Pi 5 (GPIO 40 pines)'
    return b.component(name, 'Microcontroladores · Raspberry Pi')


def raspberry_pi_zero():
    mm = IN / 25.4
    OX, OY = 4, 4
    W, H = int(OX + 65 * mm + 8), int(OY + 30 * mm + 12)
    b = Board(W, H)
    b.rect(OX, OY, 65 * mm, 30 * mm, '#1b7a3c', 3 * mm, '#0d4d24', 1)
    for hx, hy in ((3.5, 3.5), (61.5, 3.5), (3.5, 26.5), (61.5, 26.5)):
        b.circle(OX + hx * mm, OY + hy * mm, 2.6 * mm, '#d9b75b'); b.circle(OX + hx * mm, OY + hy * mm, 1.35 * mm, '#fff')
    pi_header(b, OX, OY)
    B = OY + 30 * mm
    b.rect(OX + 12.4 * mm - 5.5 * mm, B - 5 * mm, 11 * mm, 6.5 * mm, '#c9ccd1', 1.5, '#7d8288'); b.text(OX + 12.4 * mm, B - 7 * mm, 'mini HDMI', 5, '#fff')
    for xu, t in ((41.4, 'USB'), (54, 'PWR')):
        b.rect(OX + xu * mm - 4 * mm, B - 4 * mm, 8 * mm, 5 * mm, '#c9ccd1', 1.5, '#7d8288'); b.text(OX + xu * mm, B - 6 * mm, t, 5, '#fff')
    b.chip(OX + 26 * mm, OY + 11 * mm, 13 * mm, 13 * mm, 'RP3A0', 7, '#b7bbc0')
    b.rect(OX - 1, OY + 9 * mm, 6 * mm, 12 * mm, '#bfc3c7', 1); b.text(OX + 2 * mm, OY + 15 * mm, 'SD', 5, '#333')
    b.rect(OX + 65 * mm - 4 * mm, OY + 8 * mm, 4 * mm + 2, 14 * mm, '#efe7cf', 0.5)
    b.text(OX + 47 * mm, OY + 16 * mm, 'Raspberry Pi Zero 2 W', 7.5, '#fff', weight='bold')
    return b.component('Raspberry Pi Zero 2 W (GPIO 40 pines)', 'Microcontroladores · Raspberry Pi')


def pico(wifi=False):
    mm = IN / 25.4
    OX, OY = 4, 14
    W, H = int(OX + 21 * mm + 4), int(OY + 51 * mm + 4)
    b = Board(W, H)
    b.rect(OX, OY, 21 * mm, 51 * mm, '#1a7a3a', 1.5 * mm, '#0d4d24', 1)
    usb_micro(b, OX + 10.5 * mm, OY - 4)
    left = ['GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND', 'GP6', 'GP7', 'GP8', 'GP9', 'GND', 'GP10', 'GP11', 'GP12', 'GP13', 'GND', 'GP14', 'GP15']
    right = ['VBUS', 'VSYS', 'GND', '3V3_EN', '3V3(OUT)', 'ADC_VREF', 'GP28', 'AGND', 'GP27', 'GP26', 'RUN', 'GP22', 'GND', 'GP21', 'GP20', 'GP19',
             'GP18', 'GND', 'GP17', 'GP16']
    y0 = OY + 1.61 * mm
    xl, xr = OX + 1.61 * mm, OX + 21 * mm - 1.61 * mm
    b.castellated(xl, y0, ['%s · pin %d' % (n, i + 1) for i, n in enumerate(left)], P, 'L')
    b.castellated(xr, y0, ['%s · pin %d' % (n, 40 - i) for i, n in enumerate(right)], P, 'R')
    for i, n in enumerate(left):
        b.text(xl + 8, y0 + i * P, n, 5.6, '#fff', 'start')
    for i, n in enumerate(right):
        b.text(xr - 8, y0 + i * P, n, 5.6, '#fff', 'end')
    b.chip(OX + 6.5 * mm, OY + 22 * mm, 8 * mm, 8 * mm, 'RP2040', 6.5)
    b.chip(OX + 7.5 * mm, OY + 33 * mm, 6 * mm, 4.5 * mm, 'W25Q16', 4.5)
    button(b, OX + 13 * mm, OY + 12 * mm, 11, '#f2f2f2'); b.text(OX + 13 * mm, OY + 15.6 * mm, 'BOOTSEL', 4.5, '#fff')
    led(b, OX + 7 * mm, OY + 8 * mm, '#3ddc4b'); b.text(OX + 7 * mm, OY + 10 * mm, 'LED', 4.5, '#fff')
    if wifi:
        b.rect(OX + 6 * mm, OY + 40 * mm, 9 * mm, 6 * mm, '#c9ccd1', 1, '#8b9096', 0.6); b.text(OX + 10.5 * mm, OY + 43 * mm, 'CYW43439', 4.6, '#444')
        b.rect(OX + 4 * mm, OY + 47 * mm, 13 * mm, 3 * mm, '#2e8b57', 1)
    else:
        for i, t in enumerate(('SWCLK', 'GND', 'SWDIO')):
            b.circle(OX + (7 + i * 3.5) * mm, OY + 48.5 * mm, 2.4, '#d6b45a')
    rpi_logo(b, OX + 10.5 * mm, OY + 41 * mm if not wifi else OY + 36 * mm, 5)
    b.text(OX + 10.5 * mm, OY + 18 * mm, 'Pico W' if wifi else 'Pico', 7, '#fff', weight='bold')
    return b.component('Raspberry Pi Pico W' if wifi else 'Raspberry Pi Pico', 'Microcontroladores · Raspberry Pi')


# Módulos básicos (como en Wokwi)

def leg_pins(b, xs, y, names, length=22):
    for x, n in zip(xs, names):
        b.rect(x - 1.2, y - length, 2.4, length, '#b9bec4')
        b.pins.append((n, x, y))


def part_led():
    b = Board(40, 70)
    b.path('M 8 40 V 18 A 12 12 0 0 1 32 18 V 40 Z', fill='#e8322f', stroke='#9e1c1a', sw=1)
    b.rect(5, 38, 30, 5, '#c42825', 1)
    b.path('M 14 14 A 7 7 0 0 1 22 9', stroke='#ff9b98', sw=2)
    b.rect(12.8, 43, 2.4, 25, '#b9bec4'); b.rect(24.8, 43, 2.4, 20, '#b9bec4')
    b.pins.append(('A (+)', 14, 68)); b.pins.append(('K (−)', 26, 63))
    b.text(14, 58, '+', 8, '#555', rot=0);
    return b.component('LED rojo 5 mm', 'Módulos · Básicos')


def part_button():
    b = Board(56, 56)
    b.rect(6, 6, 44, 44, '#2b2b2b', 3)
    for x, y in ((10, 10), (46, 10), (10, 46), (46, 46)):
        b.circle(x, y, 3, '#555')
    b.circle(28, 28, 12, '#1e8f3a', '#0c5a22', 1.5)
    for nm, x, y in (('1.l', 0, 14), ('2.l', 0, 42), ('1.r', 56, 14), ('2.r', 56, 42)):
        b.rect(min(x, 50), y - 1.5, 6, 3, '#b9bec4')
        b.pins.append((nm, x if x else 1, y))
    return b.component('Pulsador 12 mm', 'Módulos · Básicos')


def part_resistor():
    b = Board(96, 20)
    b.rect(0, 9, 96, 2, '#b9bec4')
    b.rect(24, 3, 48, 14, '#d9c08c', 6, '#a88c55', 0.8)
    for x, c in ((32, '#7a4a1d'), (40, '#000000'), (48, '#7a4a1d'), (62, '#c9a24a')):
        b.rect(x, 3, 4, 14, c)
    b.pins.append(('1', 2, 10)); b.pins.append(('2', 94, 10))
    return b.component('Resistencia', 'Módulos · Básicos')


def part_pot():
    b = Board(70, 80)
    b.rect(5, 8, 60, 48, '#2f6fb0', 6)
    b.circle(35, 32, 18, '#d4d7db', '#888'); b.rect(33, 16, 4, 14, '#555', 1)
    leg_pins(b, (21, 35, 49), 78, ['GND', 'SIG', 'VCC'], 22)
    for x, t in ((21, 'GND'), (35, 'SIG'), (49, 'VCC')):
        b.text(x, 62, t, 6, '#fff')
    return b.component('Potenciómetro 10 kΩ', 'Módulos · Básicos')


def part_rgb():
    b = Board(56, 80)
    b.path('M 12 44 V 20 A 16 16 0 0 1 44 20 V 44 Z', fill='#f2f2f2', stroke='#aaa', sw=1)
    b.rect(9, 42, 38, 5, '#dcdcdc', 1)
    xs = (16, 25, 34, 43)
    for x, n, l in zip(xs, ('R', 'COM', 'G', 'B'), (26, 31, 26, 26)):
        b.rect(x - 1.2, 47, 2.4, l, '#b9bec4'); b.pins.append((n, x, 47 + l))
    for x, t in zip(xs, ('R', 'C', 'G', 'B')):
        b.text(x, 35, t, 6, '#666')
    return b.component('LED RGB (cátodo común)', 'Módulos · Básicos')


def part_buzzer():
    b = Board(60, 74)
    b.circle(30, 28, 26, '#1d1d1d', '#000'); b.circle(30, 28, 4, '#000'); b.text(30, 12, '+', 10, '#fff')
    b.rect(21 - 1.2, 50, 2.4, 22, '#b9bec4'); b.rect(39 - 1.2, 50, 2.4, 22, '#b9bec4')
    b.pins.append(('+', 21, 72)); b.pins.append(('−', 39, 72))
    return b.component('Buzzer', 'Módulos · Básicos')


def part_servo():
    b = Board(150, 70)
    b.rect(30, 14, 110, 44, '#1f5fbf', 4)
    b.rect(18, 26, 130, 20, '#1f5fbf', 3)
    b.circle(60, 36, 14, '#fff', '#ccc'); b.rect(50, 32, 52, 8, '#fff', 4)
    b.text(120, 50, 'SG90', 8, '#fff', weight='bold')
    for i, (c, n) in enumerate((('#5a3a22', 'GND'), ('#d63031', 'V+'), ('#f39c12', 'PWM'))):
        y = 26 + i * 9
        b.rect(4, y - 1.5, 26, 3, c)
        b.pins.append((n, 4, y))
    return b.component('Servo SG90', 'Módulos · Actuadores')


def part_relay():
    b = Board(120, 92)
    b.rect(4, 4, 112, 84, '#1f5fbf', 4)
    b.rect(36, 14, 46, 38, '#2b6ee8', 2, '#0d3d8a'); b.text(59, 28, 'SRD-05VDC', 6, '#fff'); b.text(59, 40, '10A 250VAC', 5.5, '#dfe9ff')
    led(b, 24, 66, '#ff3b30')
    left = b.header(12, 30, ['VCC', 'GND', 'IN'], dy=P)
    for (x, y), t in zip(left, ('VCC', 'GND', 'IN')):
        b.text(x + 10, y, t, 6, '#fff', 'start')
    for i, n in enumerate(('NO', 'COM', 'NC')):
        y = 30 + i * 16
        b.rect(98, y - 7, 18, 14, '#1aa34a', 2); b.circle(107, y, 4, '#c9ccd1', '#777')
        b.pins.append((n, 116, y)); b.text(94, y, n, 6, '#fff', 'end')
    return b.component('Módulo relé 1 canal 5 V', 'Módulos · Actuadores')


def part_dht22():
    b = Board(64, 100)
    b.rect(6, 4, 52, 66, '#f2f2f2', 4, '#bbb')
    for r in range(6):
        for c in range(4):
            b.rect(13 + c * 10, 10 + r * 9, 6, 5, '#cfcfcf', 1)
    b.text(32, 64, 'DHT22', 7, '#555', weight='bold')
    leg_pins(b, (14, 26, 38, 50), 98, ['VCC', 'SDA', 'NC', 'GND'], 28)
    return b.component('Sensor DHT22 (temp./humedad)', 'Módulos · Sensores')


def part_hcsr04():
    b = Board(160, 92)
    b.rect(4, 4, 152, 58, '#1f5fbf', 4)
    for x in (42, 118):
        b.circle(x, 33, 24, '#c9ccd1', '#888'); b.circle(x, 33, 17, '#3b3b3b'); b.circle(x, 33, 13, '#4a4a4a')
    b.text(80, 18, 'HC-SR04', 7, '#fff', weight='bold')
    leg_pins(b, (59, 73, 87, 101), 90, ['VCC', 'TRIG', 'ECHO', 'GND'], 28)
    for x, t in zip((59, 73, 87, 101), ('Vcc', 'Trig', 'Echo', 'Gnd')):
        b.text(x, 54, t, 5.5, '#fff')
    return b.component('Sensor ultrasónico HC-SR04', 'Módulos · Sensores')


def part_oled():
    b = Board(130, 110)
    b.rect(4, 16, 122, 90, '#1a3c78', 5)
    b.rect(12, 34, 106, 60, '#000', 2, '#333'); b.rect(16, 40, 98, 48, '#03101e', 1)
    b.text(65, 64, 'SSD1306 128×64', 7, '#3ec7ff')
    cs = b.header(44, 8, ['GND', 'VCC', 'SCL', 'SDA'], dx=P)
    for (x, y), t in zip(cs, ('GND', 'VCC', 'SCL', 'SDA')):
        b.text(x, y + 14, t, 5.5, '#fff')
    return b.component('Pantalla OLED SSD1306 I2C', 'Módulos · Pantallas')


def part_lcd():
    b = Board(260, 110)
    b.rect(4, 4, 252, 102, '#1f5fbf', 4)
    b.rect(14, 18, 210, 64, '#222', 3); b.rect(22, 26, 194, 48, '#6aa121', 2)
    for r in range(2):
        for c in range(16):
            b.rect(26 + c * 11.8, 31 + r * 21, 10, 17, '#7cb82a', 0.5)
    b.text(119, 92, 'LCD 1602 + I2C', 7, '#fff', weight='bold')
    cs = b.header(242, 33, ['GND', 'VCC', 'SDA', 'SCL'], dy=P)
    for (x, y), t in zip(cs, ('GND', 'VCC', 'SDA', 'SCL')):
        b.text(x - 10, y, t, 5.5, '#fff', 'end')
    return b.component('LCD 16×2 I2C', 'Módulos · Pantallas')


def build():
    from genericos import build_genericos
    return build_genericos() + [
        arduino_uno(), arduino_uno_q(), arduino_mega(), arduino_nano(),
        esp32_devkitc(), esp32_devkit_v1(), esp32_s3(), esp32_c3(),
        pico(False), pico(True), raspberry_pi(4), raspberry_pi(5), raspberry_pi_zero(),
    ] + __import__('orangepi').build_orangepi() + [
        part_led(), part_button(), part_resistor(), part_pot(), part_rgb(), part_buzzer(),
        part_servo(), part_relay(), part_dht22(), part_hcsr04(), part_oled(), part_lcd(),
    ] + __import__('modulos').build_modulos() + __import__('electronica').build_electronica()


def build_tablero():
    """Equipos de un tablero concreto («Mi tablero»). Van aparte, en componentes_tablero.json, y sus
    dibujos (transformar.py, tablero_full.py) no se publican: si no están, no se genera nada."""
    try:
        return __import__('transformar').build_tablero()
    except ImportError:
        return []


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    for name, comps in (('componentes_placas.json', build()), ('componentes_tablero.json', build_tablero())):
        if not comps:
            continue
        out = os.path.join(os.path.dirname(here), name)
        with open(out, 'w', encoding='utf-8') as f:
            json.dump(comps, f, ensure_ascii=False)
        for c in comps:
            print('%-42s %4dx%-4d %3d bornes' % (c['name'], c['width'], c['height'], len(c['terminals'])))
        print('->', out)
