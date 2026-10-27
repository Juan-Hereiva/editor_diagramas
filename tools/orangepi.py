# -*- coding: utf-8 -*-
"""Placas Orange Pi. El nombre de cada pin del conector GPIO sale de la librería oficial de Orange Pi
(wiringOP, gpio/readall.c, tablas physNames_*), guardadas en orangepi_pines.json. El contorno, los
puertos y el chip son un dibujo aproximado; el conector (orden y nombres de pines) es el real."""
import json
import os

from placas import Board, IN, P, usb_c

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'orangepi_pines.json'), encoding='utf-8') as f:
    PINES = json.load(f)

CAT = 'Microcontroladores · Orange Pi'


def opi_header(b, x0, y0, names, npins):
    """Conector de 2 filas: impares en la fila interior, pares en la exterior; pin 1 a la izquierda."""
    cols = npins // 2
    yo, yi = y0, y0 + P
    b.rect(x0 - P / 2, yo - P / 2, cols * P, 2 * P, '#151515', 1.5)
    for i in range(cols):
        x = x0 + i * P
        for y, pin in ((yi, 2 * i + 1), (yo, 2 * i + 2)):
            if pin == 1:
                b.rect(x - 4.2, y - 4.2, 8.4, 8.4, '#d8b25a', 0.6)
            else:
                b.circle(x, y, 4.2, '#d8b25a')
            b.circle(x, y, 1.9, '#3a2c10')
            n = names[pin - 1] if pin - 1 < len(names) and names[pin - 1] else 'NC'
            b.pins.append(('%s · pin %d' % (n, pin), x, y))
    b.text(x0 - 9, yi, '1', 6, '#fff', 'end')
    b.text(x0 + (cols - 1) * P + 9, yo, str(npins), 6, '#fff', 'start')


def orange_logo(b, x, y, s):
    b.circle(x, y, s, '#f7941d', '#c46a00', s * 0.12)
    b.path('M %s %s q %s %s %s %s' % (x, y - s, s * 0.35, -s * 0.55, s * 0.8, -s * 0.45), stroke='#3ddc4b', sw=s * 0.28)


def board(name, key, npins, w_mm, h_mm, soc, ports, extra=None, header_x_mm=7.0):
    mm = IN / 25.4
    OX, OY = 4, 18
    W, H = int(OX + w_mm * mm + 8), int(OY + h_mm * mm + 10)
    b = Board(W, H)
    b.rect(OX, OY, w_mm * mm, h_mm * mm, '#1f2125', 3 * mm, '#000', 1)
    for hx, hy in ((3.5, 3.5), (w_mm - 3.5, 3.5), (3.5, h_mm - 3.5), (w_mm - 3.5, h_mm - 3.5)):
        b.circle(OX + hx * mm, OY + hy * mm, 2.6 * mm, '#d9b75b'); b.circle(OX + hx * mm, OY + hy * mm, 1.35 * mm, '#fff')
    names = PINES[key][:npins]
    opi_header(b, OX + header_x_mm * mm, OY + 3.2 * mm, names, npins)
    cx, cy = OX + w_mm * mm * 0.42, OY + h_mm * mm * 0.52
    b.chip(cx - 8 * mm, cy - 7 * mm, 16 * mm, 14 * mm, soc, 7)
    b.chip(cx + 11 * mm, cy - 6 * mm, 9 * mm, 12 * mm, 'RAM', 6)
    B = OY + h_mm * mm
    for xr, label, wmm in ports:          # puertos en el borde inferior
        b.rect(OX + xr * mm - wmm * mm / 2, B - 6 * mm, wmm * mm, 7 * mm, '#c9ccd1', 1.5, '#7d8288')
        b.text(OX + xr * mm, B - 8 * mm, label, 5, '#fff')
    if extra:
        extra(b, OX, OY, mm)
    orange_logo(b, OX + w_mm * mm - 9 * mm, OY + h_mm * mm * (0.45 if w_mm >= 60 else 0.66), 3.2 * mm)
    if h_mm >= 45:      # en las placas pequeñas el nombre va solo arriba, si no tapa el chip
        b.text(cx, OY + h_mm * mm - 13 * mm, name, 8, '#f7941d', weight='bold')
    b.text(OX + w_mm * mm / 2, 10, '%s · GPIO %d pines' % (name, npins), 8, '#c46a00', weight='bold')
    return b.component('%s (GPIO %d pines)' % (name, npins), CAT)


def build_orangepi():
    zero_ports = [(12.4, 'mini HDMI', 11), (41.4, 'USB-C', 9), (54, 'USB-C PWR', 9)]
    big = [(10, 'USB-C PWR', 9), (28, 'HDMI', 15), (50, 'USB 3', 13), (70, 'ETH', 16)]
    return [
        board('Orange Pi Zero 3W', 'ZERO_3_W', 40, 65, 30, 'A733', zero_ports),
        board('Orange Pi Zero 2W', 'ZERO_2_W', 40, 65, 30, 'H618', zero_ports),
        board('Orange Pi Zero 3', 'ZERO_2', 26, 50, 55, 'H618', [(10, 'USB-C', 9), (26, 'micro HDMI', 8), (42, 'ETH', 14)]),
        board('Orange Pi 3B', '3B', 40, 85, 56, 'RK3566', big),
        board('Orange Pi 5', '5', 26, 100, 62, 'RK3588S', big),
        board('Orange Pi 5 Pro', '5PRO', 40, 89, 56, 'RK3588S', big),
        board('Orange Pi 5 Plus', '5PLUS', 40, 100, 75, 'RK3588', big + [(90, 'ETH 2', 16)]),
        board('Orange Pi 5 Max', '5MAX', 40, 89, 57, 'RK3588', big),
        board('Orange Pi 4 LTS', '4_LTS', 26, 91, 56, 'RK3399', big),
        board('Orange Pi PC / One', 'H3', 40, 85, 55, 'H3', [(10, 'PWR', 8), (28, 'HDMI', 15), (50, 'USB', 13), (70, 'ETH', 16)]),
    ]
