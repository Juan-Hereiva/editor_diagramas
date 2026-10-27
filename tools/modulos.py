# -*- coding: utf-8 -*-
"""Más módulos y componentes (estilo Wokwi). Pines con el nombre serigrafiado en el módulo real."""
from placas import Board, P, fmt, led, button, smd


def pcb(b, x, y, w, h, color='#1f5fbf', holes=True):
    b.rect(x, y, w, h, color, 4, '#0b2f66' if color == '#1f5fbf' else '#000', 0.8)
    if holes:
        for hx, hy in ((x + 6, y + 6), (x + w - 6, y + 6), (x + 6, y + h - 6), (x + w - 6, y + h - 6)):
            b.circle(hx, hy, 3.2, '#e6e6e6', '#999', 0.6)


def pins_row(b, x0, y, names, label_dy=-11, size=5.6, col='#fff', dx=P, rot=None):
    cs = b.header(x0, y, names, dx=dx)
    for (x, yy), n in zip(cs, names):
        b.text(x, yy + label_dy, n, size, col, rot=rot)
    return cs


def pins_col(b, x, y0, names, side='L', size=5.6, col='#fff'):
    cs = b.header(x, y0, names, dy=P)
    for (xx, y), n in zip(cs, names):
        b.text(xx + (9 if side == 'L' else -9), y, n, size, col, 'start' if side == 'L' else 'end')
    return cs


def screw_term(b, x, y, names, dy=18, col='#1aa34a', side='R'):
    for i, n in enumerate(names):
        yy = y + i * dy
        b.rect(x - 9, yy - 8, 18, 16, col, 2)
        b.circle(x, yy, 4.5, '#d0d3d6', '#777', 0.8)
        b.path('M %s %s L %s %s' % (fmt(x - 3), fmt(yy + 2), fmt(x + 3), fmt(yy - 2)), stroke='#555', sw=1.2)
        b.pins.append((n, x, yy))
        if side == 'R':
            b.text(x - 12, yy, n, 5.6, '#fff', 'end')
        else:
            b.text(x + 12, yy, n, 5.6, '#fff', 'start')


# Entrada / sensores

def rfid():
    b = Board(170, 120)
    pcb(b, 4, 4, 162, 98)
    b.rect(16, 14, 110, 80, 'none', 8, '#d8b25a', 3)
    b.rect(26, 24, 90, 60, 'none', 6, '#d8b25a', 2)
    b.chip(132, 40, 22, 22, 'RC522', 4.5)
    b.text(71, 54, 'MFRC522', 9, '#fff', weight='bold')
    pins_row(b, 22, 112, ['SDA', 'SCK', 'MOSI', 'MISO', 'IRQ', 'GND', 'RST', '3.3V'], -12, 5, rot=-90)
    return b.component('Lector RFID MFRC522', 'Módulos · Sensores')


def rtc_ds1307():
    b = Board(120, 100)
    pcb(b, 4, 4, 112, 80)
    b.circle(78, 44, 24, '#c9ccd1', '#888'); b.text(78, 44, 'CR2032', 6, '#555', weight='bold')
    b.chip(18, 20, 26, 20, 'DS1307', 5)
    b.rect(22, 52, 18, 8, '#c9ccd1', 3)
    pins_row(b, 25, 92, ['GND', 'VCC', 'SDA', 'SCL', 'SQW'], -12, 5.2)
    return b.component('Reloj RTC DS1307', 'Módulos · Sensores')


def rtc_ds3231():
    b = Board(120, 100)
    pcb(b, 4, 4, 112, 80)
    b.circle(80, 44, 22, '#c9ccd1', '#888'); b.text(80, 44, 'CR2032', 6, '#555', weight='bold')
    b.chip(16, 22, 32, 24, 'DS3231', 5.5)
    pins_row(b, 25, 92, ['32K', 'SQW', 'SCL', 'SDA', 'VCC', 'GND'], -12, 5)
    return b.component('Reloj RTC DS3231', 'Módulos · Sensores')


def pir():
    b = Board(120, 120)
    pcb(b, 4, 20, 112, 80, '#1d6b3a')
    b.circle(60, 56, 38, '#f4f4f0', '#ccc')
    for r in (28, 18, 8):
        b.circle(60, 56, r, 'none', '#ddd', 1)
    for x in (24, 96):
        b.circle(x, 28, 6, '#ff8c1a', '#a85a0c')
    b.text(60, 104, 'HC-SR501', 6.5, '#fff', weight='bold')
    pins_row(b, 46, 112, ['VCC', 'OUT', 'GND'], -12, 5.2)
    return b.component('Sensor de movimiento PIR HC-SR501', 'Módulos · Sensores')


def ldr():
    b = Board(110, 70)
    pcb(b, 4, 4, 102, 50)
    b.circle(28, 29, 12, '#d6a23a', '#8a6420'); b.path('M 20 25 Q 24 20 28 25 T 36 25 M 20 33 Q 24 28 28 33 T 36 33', stroke='#7a2e1f', sw=1.4)
    b.rect(48, 18, 22, 22, '#2b6ee8', 2); b.circle(59, 29, 5, '#ddd')
    led(b, 84, 20, '#ff3b30'); led(b, 84, 38, '#3ddc4b')
    pins_row(b, 34, 62, ['VCC', 'GND', 'DO', 'AO'], -11, 5)
    return b.component('Sensor de luz (LDR)', 'Módulos · Sensores')


def mpu6050():
    b = Board(100, 80)
    pcb(b, 4, 4, 92, 56)
    b.chip(36, 16, 28, 28, 'MPU', 6); b.text(50, 52, 'GY-521', 6, '#fff', weight='bold')
    b.path('M 16 20 V 40 M 16 20 l -4 6 M 16 20 l 4 6 M 16 40 H 30 M 30 40 l -6 -4 M 30 40 l -6 4', stroke='#fff', sw=1)
    pins_row(b, 15, 72, ['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT'], -11, 4.6, rot=-90)
    return b.component('Acelerómetro/giroscopio MPU6050', 'Módulos · Sensores')


def bmp280():
    b = Board(80, 76)
    pcb(b, 4, 4, 72, 52, '#6b2fb3')
    b.rect(30, 18, 18, 14, '#c9ccd1', 2, '#888'); b.circle(36, 25, 1.5, '#333')
    b.text(40, 44, 'BMP280', 6, '#fff', weight='bold')
    pins_row(b, 12, 68, ['VCC', 'GND', 'SCL', 'SDA', 'CSB', 'SDO'], -11, 4.6, rot=-90)
    return b.component('Sensor de presión BMP280', 'Módulos · Sensores')


def ds18b20():
    b = Board(60, 90)
    b.path('M 14 44 V 20 A 16 16 0 0 1 46 20 V 44 Z', fill='#1d1d1d', stroke='#000', sw=1)
    b.text(30, 32, 'DS18B20', 5.5, '#ddd')
    for x, n in ((18, 'GND'), (30, 'DQ'), (42, 'VCC')):
        b.rect(x - 1.2, 44, 2.4, 44, '#b9bec4'); b.pins.append((n, x, 88))
    return b.component('Sensor de temperatura DS18B20', 'Módulos · Sensores')


def suelo():
    b = Board(80, 170)
    b.path('M 14 54 H 66 V 150 L 56 166 L 50 150 V 70 H 30 V 150 L 24 166 L 18 150 Z', fill='#1f5fbf', stroke='#0b2f66')
    b.rect(22, 80, 4, 66, '#d8b25a'); b.rect(54, 80, 4, 66, '#d8b25a')
    b.text(40, 62, 'SOIL', 6.5, '#fff', weight='bold')
    pins_row(b, 26, 44, ['VCC', 'GND', 'AO'], -11, 5)
    b.text(40, 8, 'Humedad del suelo', 5.5, '#555')
    return b.component('Sensor de humedad del suelo', 'Módulos · Sensores')


def ir_receiver():
    b = Board(50, 80)
    b.rect(10, 8, 30, 30, '#1d1d1d', 3)
    b.circle(25, 20, 9, '#333', '#555')
    b.text(25, 42, 'VS1838', 5, '#555')
    for x, n in ((15, 'OUT'), (25, 'GND'), (35, 'VCC')):
        b.rect(x - 1.2, 38, 2.4, 40, '#b9bec4'); b.pins.append((n, x, 78))
    return b.component('Receptor infrarrojo VS1838', 'Módulos · Sensores')


def mq2():
    b = Board(100, 100)
    pcb(b, 4, 4, 92, 70)
    b.circle(50, 38, 26, '#c9ccd1', '#888'); b.circle(50, 38, 18, '#a7abb0')
    for i in range(6):
        b.path('M %s 26 V 50' % fmt(38 + i * 5), stroke='#888', sw=1.2)
    b.text(50, 66, 'MQ-2 gas', 6, '#fff', weight='bold')
    pins_row(b, 29, 90, ['VCC', 'GND', 'DO', 'AO'], -11, 5)
    return b.component('Sensor de gas MQ-2', 'Módulos · Sensores')


def hx711():
    b = Board(120, 80)
    pcb(b, 4, 4, 112, 72, '#1d6b3a')
    b.chip(44, 24, 32, 22, 'HX711', 6)
    pins_col(b, 12, 18, ['E+', 'E−', 'A−', 'A+', 'B−'], 'L', 5)
    pins_col(b, 108, 24, ['GND', 'DT', 'SCK', 'VCC'], 'R', 5)
    return b.component('Amplificador de celda de carga HX711', 'Módulos · Sensores')


def acs712():
    b = Board(120, 80)
    pcb(b, 4, 4, 112, 72, '#b31b1b')
    b.chip(40, 26, 26, 22, 'ACS712', 5)
    screw_term(b, 102, 24, ['IP+', 'IP−'], 26, '#1f5fbf')
    pins_col(b, 12, 26, ['VCC', 'OUT', 'GND'], 'L', 5)
    return b.component('Sensor de corriente ACS712', 'Módulos · Sensores')


def joystick():
    b = Board(110, 120)
    pcb(b, 4, 4, 102, 92, '#1a1a1a')
    b.circle(55, 50, 32, '#555', '#222'); b.circle(55, 50, 20, '#2b2b2b', '#000', 2)
    pins_row(b, 27, 108, ['GND', '+5V', 'VRX', 'VRY', 'SW'], -11, 5)
    return b.component('Joystick analógico', 'Módulos · Entradas')


def keypad():
    b = Board(170, 200)
    b.rect(4, 4, 162, 160, '#1d1d1f', 6)
    keys = ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D']
    for i, k in enumerate(keys):
        x, y = 12 + (i % 4) * 39, 12 + (i // 4) * 37
        b.rect(x, y, 32, 30, '#c0392b' if k in 'ABCD' else '#2f6fb0' if k in '*#' else '#e9ecef', 5)
        b.text(x + 16, y + 15, k, 12, '#fff' if k in 'ABCD*#' else '#222', weight='bold')
    b.rect(30, 164, 110, 12, '#222', 2)
    pins_row(b, 36, 186, ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'], 12, 5)
    return b.component('Teclado matricial 4×4', 'Módulos · Entradas')


def encoder():
    b = Board(110, 90)
    pcb(b, 4, 4, 102, 60, '#1a1a1a')
    b.circle(55, 34, 22, '#c9ccd1', '#888'); b.circle(55, 34, 14, '#a7abb0')
    b.rect(53, 20, 4, 12, '#666', 1)
    pins_row(b, 27, 78, ['CLK', 'DT', 'SW', '+', 'GND'], -11, 5)
    return b.component('Encoder rotativo KY-040', 'Módulos · Entradas')


def slide_switch():
    b = Board(70, 50)
    b.rect(6, 6, 58, 22, '#1d1d1d', 3)
    b.rect(14, 10, 20, 14, '#e9ecef', 2)
    for x, n in ((17, '1'), (35, '2'), (53, '3')):
        b.rect(x - 1.2, 28, 2.4, 20, '#b9bec4'); b.pins.append((n, x, 48))
    return b.component('Interruptor deslizante', 'Módulos · Entradas')


def dip8():
    b = Board(140, 80)
    b.rect(10, 18, 120, 44, '#c0392b', 3)
    for i in range(8):
        x = 18 + i * 14
        b.rect(x - 4, 26, 8, 22, '#fff', 1.5); b.rect(x - 3, 28, 6, 9, '#333', 1)
        b.text(x, 54, str(i + 1), 5.5, '#fff')
        b.rect(x - 1, 0, 2, 18, '#b9bec4'); b.pins.append(('%da' % (i + 1), x, 2))
        b.rect(x - 1, 62, 2, 18, '#b9bec4'); b.pins.append(('%db' % (i + 1), x, 78))
    b.text(122, 40, 'ON', 6, '#fff', weight='bold', rot=-90)
    return b.component('Interruptor DIP de 8', 'Módulos · Entradas')


# Salida / actuadores

def stepper():
    b = Board(140, 140)
    b.rect(10, 10, 120, 120, '#9aa0a6', 10, '#6d7278', 1.5)
    for x, y in ((22, 22), (118, 22), (22, 118), (118, 118)):
        b.circle(x, y, 5, '#5b6168')
    b.circle(70, 70, 34, '#7d8288', '#5b6168', 2); b.circle(70, 70, 8, '#d0d3d6', '#777')
    b.text(70, 120, 'NEMA 17', 7, '#333', weight='bold')
    for i, (n, c) in enumerate((('A+', '#222'), ('A−', '#1aa34a'), ('B+', '#d63031'), ('B−', '#1f5fbf'))):
        y = 44 + i * 16
        b.rect(118, y - 1.5, 22, 3, c); b.pins.append((n, 140, y))
    return b.component('Motor paso a paso bipolar', 'Módulos · Actuadores')


def a4988():
    b = Board(100, 140)
    b.rect(14, 6, 72, 128, '#1aa34a', 4)
    b.chip(34, 50, 32, 32, 'A4988', 6)
    b.circle(50, 110, 7, '#c9ccd1', '#777'); b.rect(48, 104, 4, 12, '#777')
    left = ['ENABLE', 'MS1', 'MS2', 'MS3', 'RESET', 'SLEEP', 'STEP', 'DIR']
    right = ['VMOT', 'GND', '2B', '2A', '1A', '1B', 'VDD', 'GND']
    pins_col(b, 8, 20, left, 'L', 4.8)
    pins_col(b, 92, 20, right, 'R', 4.8)
    return b.component('Driver de motor paso a paso A4988', 'Módulos · Actuadores')


def l298n():
    b = Board(170, 150)
    pcb(b, 4, 4, 162, 142, '#b31b1b')
    b.rect(54, 14, 62, 40, '#222', 2); b.text(85, 34, 'L298N', 9, '#ddd', weight='bold')
    for i in range(6):
        b.rect(56 + i * 10, 6, 6, 10, '#9aa0a6')
    screw_term(b, 20, 40, ['OUT1', 'OUT2'], 20, '#1f5fbf', 'L')
    screw_term(b, 150, 40, ['OUT3', 'OUT4'], 20, '#1f5fbf', 'R')
    for i, n in enumerate(('+12V', 'GND', '+5V')):
        x = 40 + i * 20
        b.rect(x - 9, 116, 18, 16, '#1f5fbf', 2); b.circle(x, 124, 4.5, '#d0d3d6', '#777'); b.pins.append((n, x, 124)); b.text(x, 110, n, 5.2, '#fff')
    cs = b.header(106, 124, ['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB'], dx=P * 0.85)
    for (x, y), n in zip(cs, ('ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB')):
        b.text(x, y - 12, n, 4.6, '#fff', rot=-90)
    return b.component('Driver de motores L298N', 'Módulos · Actuadores')


def motor_dc():
    b = Board(120, 70)
    b.rect(30, 8, 80, 54, '#c9ccd1', 10, '#8d9298', 1.2)
    b.rect(110, 30, 10, 10, '#9aa0a6', 1)
    b.text(70, 35, 'M', 16, '#555', weight='bold')
    for i, (n, c) in enumerate((('+', '#d63031'), ('−', '#222'))):
        y = 25 + i * 20
        b.rect(4, y - 1.5, 26, 3, c); b.pins.append((n, 4, y))
    return b.component('Motor DC', 'Módulos · Actuadores')


def relay4():
    b = Board(220, 120)
    pcb(b, 4, 4, 212, 112)
    for i in range(4):
        x = 30 + i * 48
        b.rect(x, 16, 40, 40, '#2b6ee8', 2, '#0d3d8a'); b.text(x + 20, 30, 'SRD-05', 5.5, '#fff'); b.text(x + 20, 42, 'VDC', 5.5, '#fff')
        for j, n in enumerate(('NO', 'COM', 'NC')):
            xx = x + 7 + j * 13
            b.rect(xx - 6, 64, 12, 18, '#1aa34a', 1.5); b.circle(xx, 73, 3.8, '#d0d3d6', '#777')
            b.pins.append(('%s%d' % (n, i + 1), xx, 73))
            b.text(xx, 88, n, 4.4, '#fff')
        led(b, x + 20, 98, '#ff3b30')
    cs = b.header(14, 30, ['GND', 'IN1', 'IN2', 'IN3', 'IN4', 'VCC'], dy=P)
    for (x, y), n in zip(cs, ('GND', 'IN1', 'IN2', 'IN3', 'IN4', 'VCC')):
        b.text(x + 8, y, n, 4.6, '#fff', 'start')
    return b.component('Módulo relé 4 canales 5 V', 'Módulos · Actuadores')


def dpdt():
    b = Board(100, 96)
    b.rect(10, 4, 80, 50, '#e8b100', 4, '#a07a00')
    b.text(50, 22, 'KS2E-M-DC5', 7, '#333', weight='bold')
    b.text(50, 36, 'DPDT 5 V', 6, '#333')
    for r, (row, y) in enumerate(((['COIL1', 'COM1', 'NC1', 'NO1'], 74), (['COIL2', 'COM2', 'NC2', 'NO2'], 92))):
        for i, n in enumerate(row):
            x = 20 + i * 20 + r * 6
            b.rect(x - 1, 54, 2, y - 54, '#b9bec4')
            b.pins.append((n, x, y))
    return b.component('Relé DPDT KS2E-M-DC5', 'Módulos · Actuadores')


def bomba():
    b = Board(100, 90)
    b.rect(20, 20, 60, 60, '#2b2b2b', 8)
    b.circle(50, 50, 18, '#3b3b3b', '#111')
    b.rect(44, 4, 12, 18, '#555', 2); b.rect(78, 44, 18, 12, '#555', 2)
    b.text(50, 50, 'PUMP', 7, '#ccc', weight='bold')
    for i, (n, c) in enumerate((('+', '#d63031'), ('−', '#222'))):
        y = 40 + i * 20
        b.rect(4, y - 1.5, 18, 3, c); b.pins.append((n, 4, y))
    return b.component('Mini bomba de agua 5 V', 'Módulos · Actuadores')


def solenoide():
    b = Board(110, 70)
    b.rect(30, 10, 66, 50, '#9aa0a6', 4, '#6d7278')
    b.rect(36, 16, 54, 38, '#b5651d', 3)
    b.rect(96, 28, 12, 14, '#c9ccd1', 2)
    for i, (n, c) in enumerate((('+', '#d63031'), ('−', '#222'))):
        y = 25 + i * 20
        b.rect(4, y - 1.5, 26, 3, c); b.pins.append((n, 4, y))
    return b.component('Solenoide / electroválvula 12 V', 'Módulos · Actuadores')


# Pantallas / LEDs

def seg7():
    b = Board(70, 110)
    b.rect(6, 14, 58, 82, '#1d1d1d', 3)
    segs = {'a': (20, 24, 26, 4), 'b': (46, 28, 4, 22), 'c': (46, 56, 4, 22), 'd': (20, 78, 26, 4),
            'e': (16, 56, 4, 22), 'f': (16, 28, 4, 22), 'g': (20, 51, 26, 4)}
    for x, y, w, h in segs.values():
        b.rect(x, y, w, h, '#ff3b30', 1.5)
    b.circle(54, 84, 2.5, '#ff3b30')
    for i, n in enumerate(('G', 'F', 'COM', 'A', 'B')):
        x = 11 + i * 12
        b.rect(x - 1, 0, 2, 14, '#b9bec4'); b.pins.append((n, x, 2))
    for i, n in enumerate(('E', 'D', 'COM ', 'C', 'DP')):
        x = 11 + i * 12
        b.rect(x - 1, 96, 2, 14, '#b9bec4'); b.pins.append((n, x, 108))
    return b.component('Display 7 segmentos (cátodo común)', 'Módulos · Pantallas')


def tm1637():
    b = Board(170, 80)
    pcb(b, 4, 4, 162, 72)
    b.rect(14, 12, 128, 56, '#111', 3)
    for i in range(4):
        b.text(31 + i * 31, 40, '8', 34, '#ff3b30', weight='bold')
    b.circle(77, 32, 2.5, '#ff3b30'); b.circle(77, 48, 2.5, '#ff3b30')
    pins_col(b, 156, 19, ['CLK', 'DIO', 'VCC', 'GND'], 'R', 4.8)
    return b.component('Display 4 dígitos TM1637', 'Módulos · Pantallas')


def max7219():
    b = Board(130, 150)
    pcb(b, 4, 20, 122, 110)
    b.rect(18, 26, 94, 94, '#111', 3)
    for r in range(8):
        for c in range(8):
            b.circle(27 + c * 11, 35 + r * 11, 4, '#ff3b30' if (r * c) % 7 == 1 else '#4a1410')
    pins_row(b, 37, 8, ['VCC', 'GND', 'DIN', 'CS', 'CLK'], 0, 0.1)
    for i, n in enumerate(('VCC', 'GND', 'DIN', 'CS', 'CLK')):
        b.text(37 + i * P, 138, n, 4.8, '#555', rot=-90)
    return b.component('Matriz LED 8×8 MAX7219', 'Módulos · Pantallas')


def neopixel_ring():
    b = Board(140, 150)
    b.circle(70, 70, 64, '#1d1d1d'); b.circle(70, 70, 44, '#f4f5fb')
    import math
    for i in range(16):
        a = i * math.pi * 2 / 16
        x, y = 70 + 54 * math.cos(a), 70 + 54 * math.sin(a)
        b.rect(x - 5, y - 5, 10, 10, '#f2f2f2', 1.5); b.circle(x, y, 3, ['#ff3b30', '#3ddc4b', '#3a7bff', '#ffd43b'][i % 4])
    for i, n in enumerate(('DIN', 'VCC', 'GND', 'DOUT')):
        x = 49 + i * P
        b.rect(x - 1, 128, 2, 20, '#b9bec4'); b.pins.append((n, x, 148)); b.text(x, 118, n, 4.6, '#555')
    return b.component('Anillo NeoPixel WS2812 (16 LED)', 'Módulos · Pantallas')


def neopixel_strip():
    b = Board(240, 44)
    b.rect(30, 8, 206, 28, '#f2f2f2', 3, '#ccc')
    for i in range(8):
        x = 46 + i * 25
        b.rect(x - 7, 15, 14, 14, '#fff', 2, '#bbb'); b.circle(x, 22, 4, ['#ff3b30', '#3ddc4b', '#3a7bff', '#ffd43b'][i % 4])
    for i, (n, c) in enumerate((('5V', '#d63031'), ('DIN', '#1aa34a'), ('GND', '#222'))):
        y = 12 + i * 10
        b.rect(2, y - 1.5, 28, 3, c); b.pins.append((n, 2, y))
    return b.component('Tira NeoPixel WS2812 (8 LED)', 'Módulos · Pantallas')


def tft():
    b = Board(200, 150)
    pcb(b, 4, 4, 192, 142, '#b31b1b')
    b.rect(16, 14, 152, 116, '#111', 3); b.rect(22, 20, 140, 104, '#1a3c78', 1)
    b.text(92, 66, 'ILI9341', 12, '#7dd3fc', weight='bold'); b.text(92, 82, '2.8" 320×240', 7, '#9fd0ff')
    pins_col(b, 186, 12, ['VCC', 'GND', 'CS', 'RESET', 'DC', 'MOSI', 'SCK', 'LED', 'MISO'], 'R', 4.8)
    return b.component('Pantalla TFT ILI9341 SPI', 'Módulos · Pantallas')


def lcd2004():
    b = Board(320, 130)
    pcb(b, 4, 4, 312, 122)
    b.rect(14, 18, 270, 90, '#222', 3); b.rect(22, 26, 254, 74, '#6aa121', 2)
    for r in range(4):
        for c in range(20):
            b.rect(26 + c * 12.4, 30 + r * 17.5, 10.5, 15, '#7cb82a', 0.5)
    cs = b.header(302, 44, ['GND', 'VCC', 'SDA', 'SCL'], dy=P)
    for (x, y), t in zip(cs, ('GND', 'VCC', 'SDA', 'SCL')):
        b.text(x - 10, y, t, 5.5, '#fff', 'end')
    return b.component('LCD 20×4 I2C', 'Módulos · Pantallas')


# Comunicación / almacenamiento / energía

def microsd():
    b = Board(110, 120)
    pcb(b, 4, 4, 102, 112)
    b.rect(20, 14, 70, 56, '#c9ccd1', 3, '#888'); b.rect(30, 22, 50, 40, '#333', 2); b.text(55, 42, 'microSD', 6, '#ddd')
    pins_col(b, 12, 74, ['GND', 'VCC', 'MISO'], 'L', 4.8)
    pins_col(b, 98, 74, ['MOSI', 'SCK', 'CS'], 'R', 4.8)
    return b.component('Lector de tarjetas microSD', 'Módulos · Comunicación')


def hc05():
    b = Board(90, 150)
    b.rect(10, 4, 70, 120, '#1f5fbf', 4)
    b.rect(18, 10, 54, 80, '#1d6b3a', 2); b.text(45, 50, 'HC-05', 9, '#fff', weight='bold')
    b.path('M 22 16 V 26 H 32 V 16 H 42 V 26', stroke='#d8b25a', sw=2)
    pins_row(b, 10 + 10, 136, ['STATE', 'RXD', 'TXD', 'GND', 'VCC', 'EN'], 0, 0.1, dx=10)
    for i, n in enumerate(('STATE', 'RXD', 'TXD', 'GND', 'VCC', 'EN')):
        b.text(20 + i * 10, 112, n, 4.6, '#fff', rot=-90)
    return b.component('Módulo Bluetooth HC-05', 'Módulos · Comunicación')


def nrf24():
    b = Board(140, 70)
    b.rect(4, 4, 132, 62, '#1d6b3a', 3)
    b.path('M 100 12 V 24 H 108 V 12 H 116 V 24 H 124 V 12', stroke='#d8b25a', sw=2.2)
    b.chip(52, 22, 26, 26, 'nRF24', 5)
    cs = b.header(12, 22, ['GND', 'CE', 'SCK', 'MISO'], dy=P)
    cs2 = b.header(26, 22, ['VCC', 'CSN', 'MOSI', 'IRQ'], dy=P)
    for (x, y), n in zip(cs + cs2, ('GND', 'CE', 'SCK', 'MISO', 'VCC', 'CSN', 'MOSI', 'IRQ')):
        pass
    b.text(19, 12, 'GND·VCC', 4.5, '#fff')
    return b.component('Radio nRF24L01', 'Módulos · Comunicación')


def max485():
    b = Board(110, 80)
    pcb(b, 4, 4, 102, 72)
    b.chip(42, 26, 26, 22, 'MAX485', 4.6)
    pins_col(b, 12, 19, ['RO', 'RE', 'DE', 'DI'], 'L', 5)
    pins_col(b, 98, 19, ['VCC', 'B', 'A', 'GND'], 'R', 5)
    return b.component('Transceptor RS-485 MAX485', 'Módulos · Comunicación')


def shift595():
    b = Board(140, 70)
    b.rect(10, 16, 120, 38, '#1d1d1d', 3); b.circle(18, 35, 4, '#333')
    b.text(70, 35, '74HC595', 9, '#ccc', weight='bold')
    top = ['VCC', 'Q0', 'DS', 'OE', 'ST_CP', 'SH_CP', 'MR', 'Q7S']
    bot = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'GND']
    for i, n in enumerate(top):
        x = 21 + i * P
        b.rect(x - 1.5, 2, 3, 14, '#b9bec4'); b.pins.append((n, x, 3))
    for i, n in enumerate(bot):
        x = 21 + i * P
        b.rect(x - 1.5, 54, 3, 14, '#b9bec4'); b.pins.append((n, x, 67))
    return b.component('Registro de desplazamiento 74HC595', 'Módulos · Circuitos integrados')


def lm7805():
    b = Board(60, 90)
    b.rect(10, 4, 40, 18, '#9aa0a6', 2); b.circle(30, 13, 4, '#f4f5fb')
    b.rect(10, 22, 40, 34, '#1d1d1d', 2); b.text(30, 39, '7805', 8, '#ccc', weight='bold')
    for x, n in ((18, 'IN'), (30, 'GND'), (42, 'OUT')):
        b.rect(x - 1.5, 56, 3, 32, '#b9bec4'); b.pins.append((n, x, 88))
    return b.component('Regulador 7805 (5 V)', 'Módulos · Energía')


def buck():
    b = Board(140, 80)
    pcb(b, 4, 4, 132, 72)
    b.rect(54, 16, 30, 30, '#2b2b2b', 4); b.text(69, 31, '220', 7, '#ccc')
    b.rect(92, 14, 22, 12, '#1f5fbf', 2); b.circle(110, 20, 2, '#e8b100')
    b.text(70, 60, 'LM2596', 7, '#fff', weight='bold')
    screw_term(b, 18, 30, ['IN+', 'IN−'], 22, '#1aa34a', 'L')
    screw_term(b, 122, 30, ['OUT+', 'OUT−'], 22, '#1aa34a', 'R')
    return b.component('Convertidor reductor LM2596', 'Módulos · Energía')


def bateria():
    b = Board(160, 60)
    b.rect(10, 10, 140, 40, '#2f6fb0', 6, '#1d4a78')
    b.rect(150, 22, 6, 16, '#9aa0a6', 1)
    b.text(80, 30, '18650 · 3,7 V', 10, '#fff', weight='bold')
    b.pins.append(('−', 4, 30)); b.rect(2, 28.5, 8, 3, '#222')
    b.pins.append(('+', 156, 30))
    return b.component('Batería 18650', 'Módulos · Energía')


def capacitor():
    b = Board(40, 80)
    b.rect(8, 6, 24, 44, '#1f5fbf', 5)
    b.rect(24, 6, 6, 44, '#9fc4f0')
    b.text(18, 28, '100µF', 5, '#fff', rot=-90)
    for x, n in ((14, '+'), (26, '−')):
        b.rect(x - 1, 50, 2, 28, '#b9bec4'); b.pins.append((n, x, 78))
    return b.component('Condensador electrolítico', 'Módulos · Básicos')


def diodo():
    b = Board(96, 20)
    b.rect(0, 9, 96, 2, '#b9bec4')
    b.rect(30, 4, 36, 12, '#1d1d1d', 3); b.rect(58, 4, 5, 12, '#c9ccd1')
    b.pins.append(('A', 2, 10)); b.pins.append(('K', 94, 10))
    return b.component('Diodo 1N4007', 'Módulos · Básicos')


def transistor():
    b = Board(50, 80)
    b.path('M 10 44 V 14 A 15 15 0 0 1 40 14 V 44 Z', fill='#1d1d1d')
    b.text(25, 30, 'NPN', 6, '#ccc')
    for x, n in ((15, 'E'), (25, 'B'), (35, 'C')):
        b.rect(x - 1, 44, 2, 34, '#b9bec4'); b.pins.append((n, x, 78))
    return b.component('Transistor NPN 2N2222', 'Módulos · Básicos')


def mosfet():
    b = Board(60, 90)
    b.rect(10, 4, 40, 18, '#9aa0a6', 2); b.circle(30, 13, 4, '#f4f5fb')
    b.rect(10, 22, 40, 34, '#1d1d1d', 2); b.text(30, 39, 'IRF520', 6.5, '#ccc', weight='bold')
    for x, n in ((18, 'G'), (30, 'D'), (42, 'S')):
        b.rect(x - 1.5, 56, 3, 32, '#b9bec4'); b.pins.append((n, x, 88))
    return b.component('MOSFET IRF520', 'Módulos · Básicos')


# Instalación de 230 V ~ (cargas y mando de la red)
def ac_terms(b, y, pins, x0, x1):
    b.rect(x0, y - 8, x1 - x0, 16, '#3b3f44', 2)
    for n, x in pins:
        b.circle(x, y, 5.6, '#7f858c')
        b.circle(x, y, 4.6, '#e3e6e9', '#8d939a', 0.8)
        b.path('M %s %s L %s %s' % (fmt(x - 3), fmt(y + 1.6), fmt(x + 3), fmt(y - 1.6)), stroke='#555b61', sw=1.3)
        b.pins.append((n, x, y))
        b.text(x + 9, y, n, 6.5, '#fff', 'start', 'bold')


def foco():
    b = Board(80, 120)
    b.path('M 26 76 C 26 66 12 60 12 42 A 28 28 0 0 1 68 42 C 68 60 54 66 54 76 Z', '#f6f3e8', '#b9b4a3', 1.2)
    b.path('M 33 74 L 35 46 M 47 74 L 45 46', stroke='#9a9384', sw=1)
    b.path('M 35 46 L 37 40 L 39 46 L 41 40 L 43 46 L 45 40', stroke='#8a6d2f', sw=1.3)
    b.circle(28, 30, 5, '#ffffff')
    b.rect(26, 75, 28, 19, '#c9ccd1', 2, '#8d939a', 0.8)
    for i in range(4):
        b.path('M 26 %s L 54 %s' % (fmt(79 + i * 4), fmt(77 + i * 4)), stroke='#8d939a', sw=1)
    b.rect(14, 94, 52, 26, '#2f3337', 4)
    b.text(40, 99.5, 'E27 230 V ~', 5, '#c9ccd1')
    ac_terms(b, 110, (('L', 24), ('N', 50)), 16, 64)
    return b.component('Foco 230 V (bombilla E27)', 'Instalación 230 V')


def interruptor_pared():
    b = Board(70, 100)
    b.rect(3, 2, 64, 78, '#f5f5f2', 7, '#b5b8bc', 1)
    b.rect(20, 14, 30, 54, '#e9e9e5', 4, '#c2c5c9', 1)
    b.rect(23, 17, 24, 22, '#f8f8f6', 3)
    b.circle(35, 60, 2.2, '#b5b8bc')
    ac_terms(b, 90, (('L', 16), ('L1', 42)), 6, 64)
    return b.component('Interruptor de luz (pared)', 'Instalación 230 V')


def ventilador():
    b = Board(100, 120)
    b.circle(50, 46, 44, '#e3e6e9', '#8d939a', 1.2)
    b.circle(50, 46, 38, '#f4f5f6', '#b5b8bc', 0.8)
    for a in (0, 120, 240):
        b.path('M 50 46 C 44 30 48 14 58 10 C 64 22 60 36 50 46 Z', '#9fb3c4', '#6f8597', 0.8,
               'transform="rotate(%d 50 46)"' % a)
    b.circle(50, 46, 7, '#6f8597', '#4c6273', 1)
    for r in (16, 26, 36):
        b.circle(50, 46, r, 'none', '#c2c5c9', 0.6)
    b.rect(24, 94, 52, 26, '#2f3337', 4)
    b.text(50, 99.5, '230 V ~  40 W', 5, '#c9ccd1')
    ac_terms(b, 110, (('L', 32), ('N', 58)), 26, 74)
    return b.component('Ventilador 230 V', 'Instalación 230 V')


def dimmer():
    """Dimmer de triac para cargas de red con entrada PWM (0-100 % → brillo), lógica de 3,3-5 V."""
    b = Board(170, 110)
    pcb(b, 0, 0, 170, 110, '#1f5fbf')
    b.rect(62, 14, 46, 40, '#9aa0a6', 3, '#6d7278')                 # disipador
    for i in range(6):
        b.rect(66 + i * 7, 16, 3, 36, '#b5bac0', 1)
    b.rect(74, 56, 22, 16, '#1d1d1d', 2); b.text(85, 64, 'BTA16', 5, '#ccc', weight='bold')
    b.rect(30, 62, 26, 14, '#e8e8e8', 2); b.text(43, 69, 'MOC', 5, '#333', weight='bold')
    b.text(85, 92, 'AC DIMMER · PWM', 7, '#fff', weight='bold')
    led(b, 44, 92, '#ff3b30')
    pins_col(b, 12, 26, ['VCC', 'GND', 'PWM'], 'L')
    ac_terms_col(b, 150, 22, ('L', 'N'), 'AC IN')
    ac_terms_col(b, 150, 68, ('L carga', 'N carga'), 'CARGA', short=('L', 'N'))
    return b.component('Módulo dimmer AC (entrada PWM)', 'Instalación 230 V')


def ac_terms_col(b, x, y, names, title, short=None):
    b.text(x - 12, y - 13, title, 5.5, '#fff', 'end', 'bold')
    for i, n in enumerate(names):
        yy = y + i * 18
        b.rect(x - 9, yy - 8, 18, 16, '#1aa34a', 2)
        b.circle(x, yy, 4.5, '#d0d3d6', '#777', 0.8)
        b.path('M %s %s L %s %s' % (fmt(x - 3), fmt(yy + 2), fmt(x + 3), fmt(yy - 2)), stroke='#555', sw=1.2)
        b.pins.append((n, x, yy))
        b.text(x - 12, yy, (short or names)[i], 6, '#fff', 'end', 'bold')


def build_modulos():
    fns = [rfid, rtc_ds1307, rtc_ds3231, pir, ldr, mpu6050, bmp280, ds18b20, suelo, ir_receiver, mq2, hx711, acs712,
           joystick, keypad, encoder, slide_switch, dip8,
           stepper, a4988, l298n, motor_dc, relay4, dpdt, bomba, solenoide,
           seg7, tm1637, max7219, neopixel_ring, neopixel_strip, tft, lcd2004,
           microsd, hc05, nrf24, max485, shift595, lm7805, buck, bateria, capacitor, diodo, transistor, mosfet,
           foco, interruptor_pared, ventilador, dimmer]
    return [f() for f in fns]
