# -*- coding: utf-8 -*-
"""Dibujos realistas de los componentes genéricos de la biblioteca (los de serie).
Conservan nombre, categoría y nombres de bornes: al sincronizar, cada borne mantiene su id
(se asocia por nombre), así los diagramas que ya los usan no pierden sus cables."""
from placas import Board, fmt, led

GREY = '#d7dade'


def screw(b, x, y, r=5.2):
    b.circle(x, y, r + 1.2, '#7f858c')
    b.circle(x, y, r, '#e3e6e9', '#8d939a', 0.8)
    b.path('M %s %s L %s %s' % (fmt(x - r * 0.65), fmt(y + r * 0.35), fmt(x + r * 0.65), fmt(y - r * 0.35)), stroke='#555b61', sw=1.4)


def term(b, name, x, y, r=5.2):
    screw(b, x, y, r)
    b.pins.append((name, x, y))


def din_body(b, x, y, w, h, fill='#f2f2ee', stroke='#a9adb2'):
    b.rect(x, y, w, h, fill, 3, stroke, 1)


def toma():
    b = Board(130, 60)
    b.rect(14, 1, 102, 42, '#f5f5f2', 7, '#b5b8bc', 1)
    b.circle(65, 22, 17, '#e9e9e5', '#c2c5c9', 1)
    b.circle(57, 22, 3, '#3a3d40'); b.circle(73, 22, 3, '#3a3d40')
    b.rect(63, 6, 4, 4, '#b8a14a', 1); b.rect(63, 34, 4, 4, '#b8a14a', 1)
    b.rect(18, 44, 94, 15, '#3b3f44', 2)
    for n, x in (('L', 32.5), ('N', 65), ('PE', 97.5)):
        term(b, n, x, 51.5, 4.6)
        b.text(x - 8, 51.5, n, 6.5, '#fff', 'end', 'bold')
    return b


def fuente():
    b = Board(150, 170)
    b.rect(4, 14, 142, 142, '#c9ccd1', 4, '#8d9298', 1)
    for i in range(9):
        b.rect(12 + i * 14.5, 20, 7, 14, '#8d9298', 2)
    b.rect(14, 44, 122, 62, '#2f78c8', 3)
    b.text(75, 60, 'POWER SUPPLY', 8, '#e6f0ff', weight='bold')
    b.text(75, 78, '24 V DC', 16, '#fff', weight='bold')
    b.text(75, 95, 'IN 100-240 VAC', 6.5, '#cfe2ff')
    led(b, 30, 116, '#3ddc4b'); b.text(40, 116, 'DC OK', 6, '#33373c', 'start')
    b.circle(118, 116, 5, '#e9ecef', '#777'); b.text(118, 126, 'ADJ', 5.5, '#33373c')
    b.rect(10, 0, 130, 15, '#3fae55', 2)
    b.rect(10, 155, 130, 15, '#3fae55', 2)
    for n, x in (('−V', 22.5), ('−V', 52.5), ('+V', 97.5), ('+V', 127.5)):
        term(b, n, x, 7.5, 5)
    for n, x in (('PE', 37.5), ('N', 75), ('L', 112.5)):
        term(b, n, x, 162.5, 5)
    for x, t in ((22.5, '−'), (52.5, '−'), (97.5, '+'), (127.5, '+')):
        b.text(x, 23, t, 9, '#222', weight='bold')
    for x, t in ((37.5, '⏚'), (75, 'N'), (112.5, 'L')):
        b.text(x, 146, t, 8, '#222', weight='bold')
    return b


def barra():
    b = Board(220, 26)
    b.rect(2, 13, 216, 12, '#2d8659', 2)
    for i in range(14):
        b.rect(4 + i * 15.4, 13, 7.7, 12, '#e3c33a')
    b.add('<defs><linearGradient id="cu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3d27a"/><stop offset="1" stop-color="#b8862b"/></linearGradient></defs>')
    b.rect(10, 4, 200, 12, 'url(#cu)', 2, '#8a6420', 0.8)
    for x in (22, 57.2, 92.4, 127.6, 162.8, 198):
        term(b, 'PE', x, 9.5, 4.4)
    return b


def bornera():
    b = Board(170, 44)
    b.rect(0, 14, 170, 16, '#b9bcc0', 1)
    for i in range(6):
        x = 1 + i * 28.2
        b.rect(x, 0, 27, 44, '#8e9399' if i % 2 else '#9aa0a6', 2, '#6d7278', 0.8)
        b.text(x + 13.5, 22, str(i + 1), 9, '#fff', weight='bold')
    xs = [14.2 + i * 28.3 for i in range(6)]
    for i, x in enumerate(xs):
        term(b, str(i + 1), x, 7, 5)
    for i, x in enumerate(xs):
        term(b, str(i + 1), x, 37, 5)
    return b


def actuador():
    b = Board(150, 120)
    b.rect(40, 30, 104, 72, '#6d5bd0', 6, '#3e3191', 1)
    b.rect(52, 40, 80, 52, '#5847b5', 4)
    b.circle(92, 66, 20, '#2b2b2b', '#fff', 2)
    b.path('M 92 66 L 104 54', stroke='#ffd43b', sw=3)
    b.path('M 76 10 H 108 L 112 30 H 72 Z', fill='#c9ccd1', stroke='#8d9298')
    b.text(92, 112, 'ACTUADOR 90°', 7, '#3e3191', weight='bold')
    b.rect(2, 4, 26, 112, '#2b2f34', 3)
    names = ['1 L', '2 N', '4 COM', '5 FC abierto', '6 FC cerrado']
    for n, y in zip(names, (16, 37, 58, 79, 100)):
        term(b, n, 10, y, 4.8)
        b.text(30, y, n.split()[0], 8, '#2b2f34', 'start', 'bold')
    return b


def caudalimetro():
    b = Board(130, 150)
    b.rect(36, 112, 92, 26, '#5e6670', 3)
    b.rect(30, 106, 10, 38, '#868d95', 2); b.rect(124, 106, 6, 38, '#868d95', 2)
    b.rect(46, 18, 76, 88, '#1f7fae', 8, '#0f4f6e', 1)
    b.rect(54, 28, 60, 30, '#0a1a12', 3, '#30a07b', 1)
    b.text(84, 39, '123.45', 10, '#5bf0b0', family='Consolas,monospace')
    b.text(84, 51, 'm³/h', 6, '#5bf0b0')
    b.text(84, 74, 'FLOW', 9, '#e6f6ff', weight='bold')
    b.text(84, 88, 'pulsos · 4-20 mA', 5.5, '#cfeeff')
    b.rect(2, 6, 24, 132, '#2b2f34', 3)
    names = ['V+', 'V−', 'P+', 'P−', 'mA+', 'mA−']
    for n, y in zip(names, (18, 39, 60, 81, 102, 123)):
        term(b, n, 10, y, 4.6)
        b.text(29, y, n, 7, '#2b2f34', 'start', 'bold')
    return b


def lampara():
    b = Board(50, 50)
    b.circle(25, 25, 18, '#c9ccd1', '#8d9298', 1)
    b.circle(25, 25, 13, '#ffd43b', '#c79a00', 1)
    b.circle(21, 21, 4, '#fff6c2')
    b.pins.append(('X1', 25, 3)); b.pins.append(('X2', 25, 47))
    b.rect(23.5, 0, 3, 7, '#b9bec4'); b.rect(23.5, 43, 3, 7, '#b9bec4')
    return b


def motor():
    b = Board(100, 100)
    b.rect(14, 30, 72, 52, '#5d7f99', 6, '#3a556b', 1)
    for i in range(7):
        b.rect(18 + i * 9.5, 32, 4, 48, '#4c6c85', 1.5)
    b.rect(86, 50, 12, 12, '#9aa0a6', 1)
    b.rect(20, 82, 60, 8, '#3a556b', 2)
    b.rect(26, 2, 48, 26, '#4c6c85', 3, '#2f4557', 1)
    for n, x in (('U', 33), ('V', 50), ('W', 67)):
        term(b, n, x, 13, 5)
        b.text(x, 24, n, 6.5, '#fff', weight='bold')
    b.text(50, 66, 'M 3~', 11, '#fff', weight='bold')
    term(b, 'PE', 50, 95, 4.4)
    b.text(62, 95, '⏚', 8, '#2d8659', 'start')
    return b


def sensor():
    b = Board(90, 60)
    b.rect(8, 6, 66, 20, '#9aa0a6', 3, '#6d7278')
    for i in range(10):
        b.path('M %s 6 V 26' % fmt(12 + i * 5), stroke='#7c8288', sw=1)
    b.rect(74, 9, 12, 14, '#2b2b2b', 2); b.circle(80, 16, 2.5, '#ffb020')
    b.rect(4, 8, 6, 16, '#d0d3d6', 1)
    b.text(8, 36, 'PNP M18', 6.5, '#555', 'start', 'bold')
    for n, x, c in (('+', 18, '#8b5a2b'), ('−', 45, '#1f5fbf'), ('S', 72, '#222')):
        b.path('M 80 23 C 80 40 %s 36 %s 52' % (fmt(x), fmt(x)), stroke=c, sw=2.2)
        term(b, n, x, 53, 4.2)
    return b


def plc():
    b = Board(270, 150)
    b.rect(2, 16, 266, 118, '#d9dce0', 5, '#9aa0a6', 1)
    b.rect(2, 0, 266, 18, '#3b3f44', 2)
    b.rect(2, 132, 266, 18, '#3b3f44', 2)
    top = ['+24V', '0V', 'I0', 'I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7']
    xt = [13.5, 40.5] + [72.9 + i * 25.92 for i in range(8)]
    for n, x in zip(top, xt):
        term(b, n, x, 9, 5)
        b.text(x, 25, n, 6.5, '#2b2f34', weight='bold')
    bot = ['COM'] + ['Q%d' % i for i in range(8)]
    xb = [21.6] + [72.9 + i * 25.92 for i in range(8)]
    for n, x in zip(bot, xb):
        term(b, n, x, 141, 5)
        b.text(x, 125, n, 6.5, '#2b2f34', weight='bold')
    b.rect(14, 40, 92, 58, '#1a2a3a', 3)
    b.text(60, 58, 'PLC', 14, '#7dd3fc', weight='bold')
    b.text(60, 76, 'RUN  STOP', 6.5, '#9fb3c8')
    led(b, 40, 88, '#3ddc4b'); led(b, 80, 88, '#ff3b30')
    for i in range(8):
        led(b, 72.9 + i * 25.92, 46, '#3ddc4b')
        led(b, 72.9 + i * 25.92, 108, '#ffb020')
    b.text(176, 64, 'ENTRADAS 24 V DC', 6.5, '#555')
    b.text(176, 92, 'SALIDAS RELÉ', 6.5, '#555')
    return b


def contactor():
    b = Board(150, 160)
    b.rect(4, 14, 120, 132, '#6d7278', 5, '#3e4247', 1)
    b.rect(16, 46, 96, 66, '#555a60', 4)
    b.rect(48, 62, 32, 22, '#e9ecef', 2, '#999'); b.rect(54, 66, 20, 14, '#2b2b2b', 1)
    b.text(64, 98, 'LC1D18', 9, '#fff', weight='bold')
    b.text(64, 108, '18 A · bobina 24 V', 5.5, '#d0d3d6')
    for n, x in (('1L1', 22.5), ('3L2', 52.5), ('5L3', 82.5), ('A1', 112)):
        term(b, n, x, 8, 5.2)
        b.text(x, 23, n, 6, '#fff', weight='bold')
    for n, x in (('2T1', 22.5), ('4T2', 52.5), ('6T3', 82.5), ('A2', 112)):
        term(b, n, x, 152, 5.2)
        b.text(x, 137, n, 6, '#fff', weight='bold')
    b.rect(124, 40, 24, 78, '#7d8288', 3, '#3e4247', 1)
    term(b, '13', 140, 56, 4.6); b.text(130, 56, '13', 5.5, '#fff', 'end')
    term(b, '14', 140, 104, 4.6); b.text(130, 104, '14', 5.5, '#fff', 'end')
    b.text(136, 80, 'NO', 6, '#fff', weight='bold', rot=-90)
    return b


def modulo_reles():
    b = Board(140, 110)
    b.rect(10, 4, 120, 102, '#1f5fbf', 4)
    for y in (12, 58):
        b.rect(40, y, 56, 38, '#2b6ee8', 2, '#0d3d8a')
        b.text(68, y + 14, 'SRD-05VDC', 6, '#fff'); b.text(68, y + 26, '10A 250VAC', 5.5, '#dfe9ff')
    left = ['DC+', 'IN1', 'IN2', 'DC−']
    for n, y in zip(left, (22, 44, 66, 88)):
        b.rect(4, y - 6, 12, 12, '#151515', 1.5); b.rect(6, y - 4, 8, 8, '#d8b25a', 1)
        b.pins.append((n, 10, y)); b.text(19, y, n, 6, '#fff', 'start')
    for n, y in zip(['COM1', 'NO1', 'COM2', 'NO2'], (22, 44, 66, 88)):
        b.rect(110, y - 9, 26, 18, '#1aa34a', 2)
        term(b, n, 126, y, 4.6)
        b.text(108, y, n, 5.5, '#fff', 'end')
    led(b, 30, 100, '#ff3b30')
    return b


def paro():
    b = Board(70, 70)
    b.circle(35, 35, 33, '#ffd43b', '#c79a00', 1)
    b.text(35, 9.5, 'EMERGENCIA', 4.6, '#222', weight='bold')
    b.circle(35, 35, 20, '#d32f2f', '#8e1b1b', 1.5)
    b.circle(31, 31, 7, '#ef6a6a')
    b.pins.append(('1', 35, 3)); b.pins.append(('2', 35, 67))
    return b


def pulsador():
    b = Board(64, 64)
    b.circle(32, 32, 26, '#c9ccd1', '#8d9298', 1)
    b.circle(32, 32, 18, '#1e8f3a', '#0c5a22', 1.5)
    b.circle(28, 28, 6, '#3fbf5f')
    b.text(32, 48, 'I', 7, '#fff', weight='bold')
    b.pins.append(('3', 32, 3)); b.pins.append(('4', 32, 61))
    b.rect(30.5, 0, 3, 7, '#b9bec4'); b.rect(30.5, 57, 3, 7, '#b9bec4')
    return b


def rele():
    b = Board(96, 116)
    b.rect(4, 10, 88, 96, '#3b3f44', 4)
    b.rect(14, 24, 68, 66, '#e9ecef', 4, '#9aa0a6')
    b.rect(20, 30, 56, 40, '#d0e4f7', 3, '#9ab8d6')
    b.rect(28, 38, 18, 24, '#b5651d', 2)
    b.text(48, 80, '24 V DC', 7, '#2b2f34', weight='bold')
    for n, x in (('A1', 24), ('A2', 72)):
        term(b, n, x, 7, 4.8)
        b.text(x, 19, n, 5.5, '#fff', weight='bold')
    for n, x in (('NC', 19), ('COM', 48), ('NO', 77)):
        term(b, n, x, 109, 4.8)
        b.text(x, 97, n, 5.5, '#fff', weight='bold')
    return b


def fusible():
    b = Board(40, 80)
    din_body(b, 3, 8, 34, 64, '#5b6168', '#3a3e43')
    b.rect(9, 22, 22, 36, '#3a3e43', 2)
    b.rect(14, 26, 12, 28, '#f1e2b8', 2, '#b49650')
    b.rect(14, 26, 12, 4, '#c9ccd1'); b.rect(14, 50, 12, 4, '#c9ccd1')
    b.text(20, 64, '10x38', 4.8, '#fff')
    term(b, '1', 20, 8, 5)
    term(b, '2', 20, 72, 5)
    return b


def diferencial():
    b = Board(84, 124)
    din_body(b, 2, 10, 80, 104)
    b.rect(2, 52, 80, 22, '#e3e5e8')
    b.rect(30, 46, 24, 34, '#2f6fb0', 3, '#1d4a78')
    b.rect(34, 48, 16, 12, '#4c8fd6', 2)
    b.text(42, 90, 'ID 40A', 7, '#333', weight='bold')
    b.text(42, 99, '30 mA', 7, '#c0392b', weight='bold')
    b.rect(62, 84, 12, 9, '#f4d03f', 2, '#b7950b'); b.text(68, 88.5, 'T', 6, '#333', weight='bold')
    for n, x in (('L', 25), ('N', 59)):
        term(b, n, x, 11, 5.2)
        b.text(x, 25, n, 6.5, '#333', weight='bold')
    for n, x in (("L'", 25), ("N'", 59)):
        term(b, n, x, 113, 5.2)
        b.text(x, 99, n.replace("'", ''), 6.5, '#333', weight='bold')
    return b


def magneto():
    b = Board(50, 110)
    din_body(b, 3, 10, 44, 90)
    b.rect(3, 45, 44, 20, '#e3e5e8')
    b.rect(16, 38, 18, 30, '#2b2b2b', 3)
    b.rect(19, 40, 12, 12, '#555', 2)
    b.text(25, 78, 'C16', 8, '#333', weight='bold')
    b.text(25, 88, '6000', 5, '#555')
    term(b, '1', 25, 11, 5.2)
    term(b, '2', 25, 99, 5.2)
    b.text(36, 11, '1', 6.5, '#333', 'start', 'bold')
    b.text(36, 99, '2', 6.5, '#333', 'start', 'bold')
    return b


def supresor():
    b = Board(60, 60)
    b.rect(28.8, 0, 2.4, 12, '#b9bec4'); b.rect(28.8, 48, 2.4, 12, '#b9bec4')
    b.circle(30, 30, 19, '#2f6fb0', '#1d4a78', 1.5)
    b.text(30, 26, '14D', 7, '#fff', weight='bold')
    b.text(30, 36, '471K', 6.5, '#dfe9ff')
    b.pins.append(('1', 30, 3)); b.pins.append(('2', 30, 57))
    return b


GENERICOS = [
    ('Toma de corriente', 'Acometida AC', toma),
    ('Fuente 24 V DC (carril DIN)', 'Alimentación DC', fuente),
    ('Barra de tierra', 'Básicos', barra),
    ('Bornera 6 polos', 'Básicos', bornera),
    ('Actuador de válvula ON/OFF', 'Campo', actuador),
    ('Caudalímetro (pulsos + 4-20 mA)', 'Campo', caudalimetro),
    ('Lámpara piloto', 'Campo', lampara),
    ('Motor trifásico', 'Campo', motor),
    ('Sensor 3 hilos (PNP)', 'Campo', sensor),
    ('PLC genérico (8E / 8S)', 'Control', plc),
    ('Contactor 3P + aux', 'Mando y maniobra', contactor),
    ('Módulo de 2 relés', 'Mando y maniobra', modulo_reles),
    ('Paro de emergencia (NC)', 'Mando y maniobra', paro),
    ('Pulsador (NA)', 'Mando y maniobra', pulsador),
    ('Relé 24 V (conmutado)', 'Mando y maniobra', rele),
    ('Fusible', 'Protección', fusible),
    ('Interruptor diferencial 2P', 'Protección', diferencial),
    ('Magnetotérmico 1P', 'Protección', magneto),
    ('Supresor de picos (MOV/TVS)', 'Protección', supresor),
]


def build_genericos():
    out = []
    for name, cat, fn in GENERICOS:
        c = fn().component(name, cat, keep_names=True)
        c['generico'] = True
        out.append(c)
    return out
