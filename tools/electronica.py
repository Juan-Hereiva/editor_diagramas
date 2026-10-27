# -*- coding: utf-8 -*-
"""Componentes electrónicos discretos, circuitos integrados y conectores (estilo Wokwi).
Las patillas de los integrados siguen el orden del encapsulado real (pin 1 abajo a la izquierda,
numeración en sentido antihorario visto desde arriba)."""
from placas import Board, P, fmt
from genericos import screw

CAT_C = 'Electrónica · Condensadores y bobinas'
CAT_S = 'Electrónica · Semiconductores'
CAT_I = 'Electrónica · Circuitos integrados'
CAT_K = 'Electrónica · Conectores e interruptores'
CAT_E = 'Electrónica · Energía'


def legs(b, xs, y0, names, y1):
    for x, n in zip(xs, names):
        b.rect(x - 1.1, min(y0, y1), 2.2, abs(y1 - y0), '#b9bec4')
        b.pins.append((n, x, y1))


# Condensadores, bobinas, resistencias especiales

def cer():
    b = Board(40, 70)
    b.path('M 8 22 A 12 12 0 0 1 32 22 A 12 12 0 0 1 8 22', fill='#e8a33b', stroke='#a86a12', sw=1)
    b.circle(20, 22, 13, '#e8a33b', '#a86a12', 1)
    b.text(20, 22, '104', 7, '#5a3200', weight='bold')
    legs(b, (14, 26), 33, ['1', '2'], 68)
    return b.component('Condensador cerámico 100 nF', CAT_C)


def elec(uf, color='#1f5fbf', h=56):
    b = Board(46, h + 30)
    b.rect(9, 4, 28, h, color, 6)
    b.rect(28, 4, 9, h, '#9fc4f0' if color == '#1f5fbf' else '#c9b6e8')
    for i in range(3):
        b.text(32.5, 14 + i * 12, '−', 9, '#1d1d1d', weight='bold')
    b.text(20, 4 + h / 2, uf, 6, '#fff', weight='bold', rot=-90)
    b.rect(9, 4, 28, 4, '#c9ccd1', 2)
    legs(b, (16, 30), 4 + h, ['+', '−'], h + 28)
    return b.component('Condensador electrolítico %s' % uf, CAT_C)


def tantalo():
    b = Board(40, 70)
    b.path('M 9 34 V 18 A 11 13 0 0 1 31 18 V 34 Z', fill='#e6b800', stroke='#a07a00', sw=1)
    b.text(20, 24, '+', 10, '#5a3200', weight='bold'); b.text(20, 36, '10µ', 5.5, '#5a3200')
    legs(b, (14, 26), 34, ['+', '−'], 68)
    return b.component('Condensador de tántalo 10 µF', CAT_C)


def film():
    b = Board(60, 70)
    b.rect(6, 6, 48, 30, '#c0392b', 4, '#7b1f16')
    b.text(30, 16, '0.1µF', 7, '#fff', weight='bold'); b.text(30, 27, '630V', 6, '#ffd6d0')
    legs(b, (18, 42), 36, ['1', '2'], 68)
    return b.component('Condensador de poliéster 0,1 µF 630 V', CAT_C)


def supercap():
    b = Board(60, 90)
    b.rect(8, 4, 44, 56, '#111', 6)
    b.rect(8, 4, 44, 8, '#c9ccd1', 3)
    b.text(30, 30, '1F', 12, '#ffd166', weight='bold'); b.text(30, 46, '5.5V', 7, '#ddd')
    legs(b, (20, 40), 60, ['+', '−'], 88)
    return b.component('Supercondensador 1 F 5,5 V', CAT_C)


def inductor():
    b = Board(96, 30)
    b.rect(0, 14, 96, 2, '#b9bec4')
    b.rect(26, 5, 44, 20, '#2f6b3a', 8)
    for x in range(30, 66, 6):
        b.path('M %s 5 Q %s 15 %s 25' % (fmt(x), fmt(x + 4), fmt(x)), stroke='#c27c2c', sw=2)
    b.pins.append(('1', 2, 15)); b.pins.append(('2', 94, 15))
    return b.component('Bobina / inductor 100 µH', CAT_C)


def toroide():
    b = Board(80, 90)
    b.circle(40, 38, 32, '#3b3f44', '#111', 1)
    b.circle(40, 38, 14, '#f4f5fb', '#111', 1)
    import math
    for i in range(18):
        a = i * math.pi * 2 / 18
        b.path('M %s %s L %s %s' % (fmt(40 + 14 * math.cos(a)), fmt(38 + 14 * math.sin(a)), fmt(40 + 32 * math.cos(a)), fmt(38 + 32 * math.sin(a))),
               stroke='#c27c2c', sw=2.4)
    legs(b, (28, 52), 66, ['1', '2'], 88)
    return b.component('Bobina toroidal', CAT_C)


def transformador():
    b = Board(140, 120)
    b.rect(20, 14, 100, 84, '#555a60', 4, '#2b2f34', 1.2)
    b.rect(40, 26, 60, 60, '#c27c2c', 4, '#7a4a1d')
    b.text(70, 48, '230 V', 10, '#fff', weight='bold'); b.text(70, 64, '12 V', 10, '#ffd166', weight='bold')
    for i, n in enumerate(('PRI 1', 'PRI 2')):
        y = 34 + i * 44; b.rect(2, y - 1.5, 18, 3, '#8b1a1a'); b.pins.append((n, 2, y))
    for i, n in enumerate(('SEC 1', 'SEC 2')):
        y = 34 + i * 44; b.rect(120, y - 1.5, 18, 3, '#e6b800'); b.pins.append((n, 138, y))
    return b.component('Transformador 230 V → 12 V', CAT_C)


def cristal():
    b = Board(60, 60)
    b.rect(8, 8, 44, 22, '#c9ccd1', 10, '#8d9298')
    b.text(30, 19, '16.000', 7, '#333', weight='bold')
    legs(b, (20, 40), 30, ['1', '2'], 58)
    return b.component('Cristal de cuarzo 16 MHz', CAT_C)


def trimmer():
    b = Board(50, 70)
    b.rect(6, 6, 38, 34, '#1f5fbf', 3)
    b.circle(25, 23, 11, '#e9ecef', '#888'); b.path('M 25 15 V 31 M 17 23 H 33', stroke='#555', sw=2)
    legs(b, (12, 25, 38), 40, ['1', 'W', '3'], 68)
    return b.component('Potenciómetro trimmer', CAT_C)


def ntc():
    b = Board(40, 70)
    b.circle(20, 20, 12, '#1d1d1d')
    b.text(20, 20, 'NTC', 6, '#ddd', weight='bold')
    legs(b, (14, 26), 30, ['1', '2'], 68)
    return b.component('Termistor NTC 10 kΩ', CAT_C)


def fotorresistencia():
    b = Board(40, 70)
    b.circle(20, 20, 13, '#d6a23a', '#8a6420')
    b.path('M 10 16 Q 14 11 18 16 T 26 16 T 32 16 M 10 24 Q 14 19 18 24 T 26 24 T 32 24', stroke='#7a2e1f', sw=1.4)
    legs(b, (14, 26), 33, ['1', '2'], 68)
    return b.component('Fotorresistencia LDR', CAT_C)


# Semiconductores discretos

def led_color(nombre, color, dark):
    b = Board(40, 70)
    b.path('M 8 40 V 18 A 12 12 0 0 1 32 18 V 40 Z', fill=color, stroke=dark, sw=1)
    b.rect(5, 38, 30, 5, dark, 1)
    b.path('M 14 14 A 7 7 0 0 1 22 9', stroke='#ffffff', sw=2, extra='stroke-opacity=".6"')
    b.rect(12.8, 43, 2.4, 25, '#b9bec4'); b.rect(24.8, 43, 2.4, 20, '#b9bec4')
    b.pins.append(('A (+)', 14, 68)); b.pins.append(('K (−)', 26, 63))
    return b.component('LED %s 5 mm' % nombre, CAT_S)


def diodo_ax(nombre, body, band, txt):
    b = Board(96, 20)
    b.rect(0, 9, 96, 2, '#b9bec4')
    b.rect(30, 4, 36, 12, body, 3); b.rect(58, 4, 5, 12, band)
    b.text(44, 10, txt, 5, '#ddd' if body != '#e8a33b' else '#333')
    b.pins.append(('A', 2, 10)); b.pins.append(('K', 94, 10))
    return b.component(nombre, CAT_S)


def puente():
    b = Board(70, 80)
    b.rect(8, 6, 54, 40, '#1d1d1d', 4)
    b.text(35, 18, 'KBP307', 7, '#ddd', weight='bold')
    b.text(35, 32, '+  ~  ~  −', 8, '#ddd')
    legs(b, (17, 29, 41, 53), 46, ['+', '~ AC 1', '~ AC 2', '−'], 78)
    return b.component('Puente rectificador KBP307', CAT_S)


def to92(nombre, txt, names):
    b = Board(50, 80)
    b.path('M 10 44 V 14 A 15 15 0 0 1 40 14 V 44 Z', fill='#1d1d1d')
    b.text(25, 26, txt, 5.5, '#ccc', weight='bold')
    legs(b, (15, 25, 35), 44, names, 78)
    return b.component(nombre, CAT_S)


def to220(nombre, txt, names):
    b = Board(60, 90)
    b.rect(10, 4, 40, 18, '#9aa0a6', 2); b.circle(30, 13, 4, '#f4f5fb')
    b.rect(10, 22, 40, 34, '#1d1d1d', 2)
    b.text(30, 39, txt, 6.5 if len(txt) < 8 else 5.5, '#ccc', weight='bold')
    legs(b, (18, 30, 42), 56, names, 88)
    return b.component(nombre, CAT_S)


# Circuitos integrados (DIP)

def dip(label, names, nombre, cat=CAT_I):
    """names = pines 1..n en orden. Abajo izquierda→derecha 1..n/2; arriba derecha→izquierda n/2+1..n."""
    n = len(names); half = n // 2
    w = 20 + half * P
    b = Board(w, 76)
    b.rect(4, 18, w - 8, 40, '#1d1d1d', 3)
    b.path('M 4 32 A 6 6 0 0 1 4 44', fill='#3b3b3b', stroke='#3b3b3b', sw=1)
    b.circle(14, 50, 2.5, '#444')
    b.text(w / 2, 38, label, 8 if len(label) < 9 else 6.5, '#ccc', weight='bold')
    for i in range(half):
        x = 10 + P / 2 + i * P
        b.rect(x - 1.6, 58, 3.2, 16, '#b9bec4'); b.pins.append(('%d %s' % (i + 1, names[i]), x, 74))
        xt = 10 + P / 2 + (half - 1 - i) * P
        b.rect(xt - 1.6, 2, 3.2, 16, '#b9bec4'); b.pins.append(('%d %s' % (half + i + 1, names[half + i]), xt, 2))
    return b.component(nombre, cat)


def ics():
    return [
        dip('NE555', ['GND', 'TRIG', 'OUT', 'RESET', 'CTRL', 'THR', 'DIS', 'VCC'], 'Temporizador NE555'),
        dip('LM358', ['OUT A', 'IN− A', 'IN+ A', 'GND', 'IN+ B', 'IN− B', 'OUT B', 'VCC'], 'Amplificador operacional LM358'),
        dip('PC817', ['A', 'K', 'E', 'C'], 'Optoacoplador PC817', CAT_S),
        dip('ULN2003', ['IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'GND', 'COM', 'OUT7', 'OUT6', 'OUT5', 'OUT4', 'OUT3', 'OUT2', 'OUT1'],
            'Array Darlington ULN2003'),
        dip('L293D', ['EN1,2', '1A', '1Y', 'GND', 'GND', '2Y', '2A', 'VCC2', 'EN3,4', '3A', '3Y', 'GND', 'GND', '4Y', '4A', 'VCC1'],
            'Driver de motores L293D'),
        dip('ATtiny85', ['PB5 RESET', 'PB3', 'PB4', 'GND', 'PB0', 'PB1', 'PB2', 'VCC'], 'Microcontrolador ATtiny85'),
        dip('ATmega328P', ['PC6 RESET', 'PD0 RX', 'PD1 TX', 'PD2', 'PD3', 'PD4', 'VCC', 'GND', 'PB6 XTAL1', 'PB7 XTAL2', 'PD5', 'PD6', 'PD7',
                           'PB0', 'PB1', 'PB2', 'PB3 MOSI', 'PB4 MISO', 'PB5 SCK', 'AVCC', 'AREF', 'GND', 'PC0 A0', 'PC1 A1', 'PC2 A2',
                           'PC3 A3', 'PC4 A4 SDA', 'PC5 A5 SCL'], 'Microcontrolador ATmega328P (DIP-28)'),
        dip('CD4017', ['Q5', 'Q1', 'Q0', 'Q2', 'Q6', 'Q7', 'Q3', 'VSS', 'Q8', 'Q4', 'Q9', 'CO', 'CLK INH', 'CLK', 'RESET', 'VDD'], 'Contador CD4017'),
        dip('MAX232', ['C1+', 'V+', 'C1−', 'C2+', 'C2−', 'V−', 'T2OUT', 'R2IN', 'R2OUT', 'T2IN', 'T1IN', 'R1OUT', 'R1IN', 'T1OUT', 'GND', 'VCC'],
            'Conversor RS-232 MAX232'),
        dip('74HC00', ['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC'], 'Puertas NAND 74HC00'),
    ]


# Conectores, interruptores, energía

def borna(n):
    w = 12 + n * 20
    b = Board(w, 50)
    b.rect(2, 6, w - 4, 38, '#1f5fbf', 3)
    for i in range(n):
        x = 12 + i * 20
        b.rect(x - 8, 10, 16, 14, '#173f80', 2)
        screw(b, x, 17, 5)
        b.rect(x - 1.2, 44, 2.4, 6, '#b9bec4')
        b.pins.append((str(i + 1), x, 48))
    return b.component('Borna de tornillo %d polos (PCB)' % n, CAT_K)


def jack_dc():
    b = Board(80, 60)
    b.rect(14, 6, 60, 44, '#1d1d1d', 4)
    b.circle(44, 28, 12, '#2b2b2b', '#555'); b.circle(44, 28, 4, '#c9ccd1')
    for n, y in (('+ (centro)', 16), ('− (manga)', 30), ('detección', 44)):
        b.rect(2, y - 1.5, 12, 3, '#b9bec4'); b.pins.append((n, 2, y))
    return b.component('Conector jack DC 5,5×2,1 mm', CAT_K)


def usb_conn():
    b = Board(90, 60)
    b.rect(30, 10, 56, 40, '#c9ccd1', 4, '#7d8288')
    b.rect(38, 22, 40, 16, '#3b3e42', 2)
    for i, n in enumerate(('VBUS', 'D−', 'D+', 'GND')):
        y = 15 + i * 10
        b.rect(4, y - 1.2, 26, 2.4, '#b9bec4'); b.pins.append((n, 4, y))
    return b.component('Conector USB-A hembra', CAT_K)


def header(n):
    w = 8 + n * P
    b = Board(w, 34)
    b.rect(4, 14, w - 8, 14, '#151515', 1.5)
    for i in range(n):
        x = 4 + P / 2 + i * P
        b.rect(x - 1.6, 2, 3.2, 18, '#d8b25a'); b.pins.append((str(i + 1), x, 3))
    return b.component('Tira de pines macho 1×%d' % n, CAT_K)


def toggle():
    b = Board(60, 80)
    b.rect(10, 30, 40, 26, '#c9ccd1', 3, '#7d8288')
    b.rect(26, 4, 8, 30, '#e9ecef', 3, '#888')
    b.text(30, 43, 'ON-ON', 6, '#333', weight='bold')
    legs(b, (18, 30, 42), 56, ['1', 'COM', '2'], 78)
    return b.component('Interruptor de palanca SPDT', CAT_K)


def rocker():
    b = Board(70, 80)
    b.rect(8, 8, 54, 40, '#1d1d1d', 4)
    b.rect(16, 14, 38, 28, '#d32f2f', 3); b.text(35, 28, 'I  O', 9, '#fff', weight='bold')
    legs(b, (25, 45), 48, ['1', '2'], 78)
    return b.component('Interruptor basculante (rocker)', CAT_K)


def tact():
    b = Board(50, 50)
    b.rect(8, 8, 34, 34, '#2b2b2b', 3)
    b.circle(25, 25, 9, '#d32f2f', '#7b1f16')
    for nm, x, y in (('1', 4, 12), ('2', 4, 38), ('3', 46, 12), ('4', 46, 38)):
        b.rect(min(x, 42), y - 1.5, 4, 3, '#b9bec4'); b.pins.append((nm, x, y))
    return b.component('Pulsador táctil 6 mm', CAT_K)


def micro_switch():
    b = Board(90, 70)
    b.rect(10, 16, 70, 30, '#1d1d1d', 3)
    b.path('M 18 16 L 74 4', stroke='#c9ccd1', sw=3); b.circle(74, 4, 3.5, '#c9ccd1')
    legs(b, (22, 45, 68), 46, ['COM', 'NC', 'NO'], 68)
    return b.component('Final de carrera (microswitch)', CAT_K)


def bat9v():
    b = Board(80, 110)
    b.rect(8, 22, 64, 84, '#1d1d1d', 5)
    b.rect(8, 40, 64, 30, '#e6b800', 2)
    b.text(40, 55, '9 V', 14, '#1d1d1d', weight='bold')
    b.circle(26, 14, 8, '#c9ccd1', '#777'); b.rect(46, 6, 16, 16, '#c9ccd1', 2, '#777')
    b.pins.append(('+', 26, 6)); b.pins.append(('−', 54, 6))
    return b.component('Batería 9 V', CAT_E)


def coin():
    b = Board(60, 80)
    b.circle(30, 30, 24, '#c9ccd1', '#8d9298', 1.5)
    b.text(30, 26, 'CR2032', 7, '#333', weight='bold'); b.text(30, 38, '3 V', 7, '#333')
    legs(b, (20, 40), 54, ['+', '−'], 78)
    return b.component('Pila de botón CR2032', CAT_E)


def portapilas():
    b = Board(150, 70)
    b.rect(4, 10, 142, 50, '#1d1d1d', 4)
    for i in range(2):
        b.rect(14 + i * 66, 18, 58, 34, '#2f6fb0', 6)
        b.text(43 + i * 66, 35, 'AA 1,5 V', 7, '#fff', weight='bold')
    b.rect(146, 22, 4, 4, '#d63031'); b.rect(146, 44, 4, 4, '#222')
    b.pins.append(('+ (rojo)', 148, 24)); b.pins.append(('− (negro)', 148, 46))
    return b.component('Portapilas 2×AA (3 V)', CAT_E)


def solar():
    b = Board(160, 110)
    b.rect(4, 4, 152, 92, '#1a2a4a', 4, '#c9ccd1', 2)
    for i in range(4):
        for j in range(6):
            b.rect(10 + j * 24, 10 + i * 20, 22, 18, '#22406e', 1, '#3a5f99', 0.6)
    b.rect(150, 96, 2, 14, '#d63031'); b.rect(140, 96, 2, 14, '#222')
    b.pins.append(('+', 151, 108)); b.pins.append(('−', 141, 108))
    return b.component('Panel solar 6 V', CAT_E)


def ams1117():
    b = Board(60, 80)
    b.rect(10, 6, 40, 14, '#9aa0a6', 2)
    b.rect(10, 20, 40, 30, '#1d1d1d', 2); b.text(30, 35, 'AMS1117', 5.5, '#ccc', weight='bold'); b.text(30, 44, '3.3', 5.5, '#ccc')
    legs(b, (18, 30, 42), 50, ['GND/ADJ', 'OUT', 'IN'], 78)
    return b.component('Regulador AMS1117 3,3 V', CAT_E)


def build_electronica():
    out = [cer(), elec('10 µF', '#1f5fbf', 40), elec('100 µF'), elec('1000 µF', '#5b2a86', 70), tantalo(), film(), supercap(),
           inductor(), toroide(), transformador(), cristal(), trimmer(), ntc(), fotorresistencia(),
           led_color('verde', '#2ecc40', '#1a8a2a'), led_color('azul', '#2f7bff', '#1a4bb0'), led_color('amarillo', '#ffd43b', '#c79a00'),
           led_color('blanco', '#f4f4f4', '#bbbbbb'),
           diodo_ax('Diodo Zener 5,1 V', '#e8a33b', '#1d1d1d', '5V1'), diodo_ax('Diodo Schottky 1N5819', '#1d1d1d', '#c9ccd1', '5819'),
           diodo_ax('Diodo rápido 1N4148', '#e8a33b', '#1d1d1d', '4148'),
           puente(),
           to92('Transistor PNP 2N3906', 'PNP', ['E', 'B', 'C']), to92('Transistor NPN BC547', 'BC547', ['C', 'B', 'E']),
           to92('Sensor de temperatura LM35', 'LM35', ['+VS', 'OUT', 'GND']), to92('Regulador 78L05', '78L05', ['OUT', 'GND', 'IN']),
           to220('Transistor Darlington TIP120', 'TIP120', ['B', 'C', 'E']), to220('MOSFET IRFZ44N', 'IRFZ44N', ['G', 'D', 'S']),
           to220('Regulador LM317', 'LM317', ['ADJ', 'OUT', 'IN']), to220('Regulador 7812 (12 V)', '7812', ['IN', 'GND', 'OUT']),
           to220('Triac BTA16', 'BTA16', ['A1', 'A2', 'G'])]
    out += ics()
    out += [borna(2), borna(3), jack_dc(), usb_conn(), header(4), header(6), toggle(), rocker(), tact(), micro_switch(),
            bat9v(), coin(), portapilas(), solar(), ams1117()]
    return out
