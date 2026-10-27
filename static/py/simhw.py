"""wiringpi, OPi.GPIO, RPi.GPIO, gpiozero, smbus2, RPLCD.i2c y adafruit_dht conectados al circuito simulado.

Los pines son siempre el número físico del conector (1-40); el puente con la página es _simjs (py-worker.js).
"""
import builtins
import inspect
import json
import signal
import sys
import time
import types

import _simjs
from pyodide.ffi import run_sync

CFG = json.loads(_simjs.cfg)
KIND = CFG.get('kind', 'opi')                       # 'opi' | 'rpi'
PINS = {int(k): v for k, v in CFG.get('pins', {}).items()}
IO = {p for p, v in PINS.items() if v.get('io')}    # pines que son GPIO (no alimentación)

# Numeración BCM de la Raspberry Pi → pin físico (OPi.GPIO también la acepta en modo BCM)
BCM_PHYS = {2: 3, 3: 5, 4: 7, 14: 8, 15: 10, 17: 11, 18: 12, 27: 13, 22: 15, 23: 16, 24: 18, 10: 19, 9: 21,
            25: 22, 11: 23, 8: 24, 7: 26, 0: 27, 1: 28, 5: 29, 6: 31, 12: 32, 13: 33, 19: 35, 16: 36, 26: 37,
            20: 38, 21: 40}
WPI_PHYS = {v['wpi']: p for p, v in PINS.items() if v.get('wpi', -1) >= 0}
SUNXI_PHYS = {v['sunxi']: p for p, v in PINS.items() if v.get('sunxi', -1) >= 0}
NAME_PHYS = {v['name'].upper(): p for p, v in PINS.items() if v.get('name')}


def _w(r):
    """Resultado del puente: si es una promesa, se espera (la página sigue funcionando)."""
    if r is not None and hasattr(r, 'then'):
        r = run_sync(r)
    if hasattr(r, 'to_py'):
        r = r.to_py()
    return r


def pin_desc(phys):
    v = PINS.get(phys) or {}
    return '%s (pin %d)' % (v.get('name', '?'), phys)


def check_io(phys, what):
    if phys not in IO:
        raise ValueError('%s: el pin físico %s no es un GPIO de esta placa%s' % (
            what, phys, ' (%s)' % pin_desc(phys) if phys in PINS else ''))
    return phys


# Núcleo: tiempo, pines, tareas, eventos

class _Core:
    def __init__(self):
        self.watch = {}        # pin → [callback(nivel)]
        self.last = {}         # pin → último nivel visto (para detectar flancos)
        self.tasks = []        # [siguiente_t, generador] tareas en segundo plano (parpadeos…)
        self.busy = False      # dentro de un callback: no se reentra

    def now(self):
        return float(_simjs.now())

    def read(self, phys):
        return 1 if _simjs.read(phys) else 0

    def poll(self):
        _w(_simjs.poll())
        self.service()

    def service(self):
        """Comprueba flancos en las entradas vigiladas y ejecuta las tareas que tocan."""
        if self.busy:
            return
        self.busy = True
        try:
            for phys, cbs in list(self.watch.items()):
                v = self.read(phys)
                if v != self.last.get(phys):
                    self.last[phys] = v
                    for cb in list(cbs):
                        cb(v)
            if self.tasks:
                t = self.now()
                for item in list(self.tasks):
                    if item in self.tasks and item[0] <= t:
                        try:
                            item[0] = t + max(0.0, float(next(item[1])))
                        except StopIteration:
                            self.tasks.remove(item)
        finally:
            self.busy = False

    def sleep(self, s):
        s = max(0.0, float(s))
        end = self.now() + s
        while True:
            self.service()
            left = end - self.now()
            if left <= 0:
                break
            step = left
            if self.watch:
                step = min(step, 0.005)
            if self.tasks:
                step = min(step, max(0.0, min(t for t, _ in self.tasks) - self.now()))
            _w(_simjs.sleep(step))
        if s == 0:
            _w(_simjs.poll())

    def add_task(self, gen):
        item = [self.now(), gen]
        self.tasks.append(item)
        self.service()
        return item

    def cancel(self, item):
        if item in self.tasks:
            self.tasks.remove(item)

    def on_change(self, phys, cb):
        self.last.setdefault(phys, self.read(phys))
        self.watch.setdefault(phys, []).append(cb)

    def off_change(self, phys, cb=None):
        if phys in self.watch:
            if cb is None:
                del self.watch[phys]
            else:
                self.watch[phys] = [c for c in self.watch[phys] if c is not cb]


core = _Core()


def setup(phys, mode, pull=0):
    """mode 'in' | 'out'; pull 0 nada · 1 abajo · 2 arriba"""
    _w(_simjs.setup(phys, mode, pull))


def write(phys, v):
    _simjs.write(phys, 1 if v else 0)


def read(phys):
    core.poll()
    return core.read(phys)


def pwm(phys, duty, freq):
    """duty 0-1 a freq Hz; duty < 0 quita el PWM"""
    _simjs.pwm(phys, float(duty), float(freq))


def i2c(addr, data=(), nread=0):
    """Una transacción: escribe data y, si nread, lee nread bytes (inicio repetido). None = NACK."""
    r = _w(_simjs.i2c(int(addr), json.dumps([int(b) & 255 for b in data]), int(nread)))
    core.service()
    return r


def i2c_or_fail(addr, data=(), nread=0):
    r = i2c(addr, data, nread)
    if r is None:
        raise OSError(121, 'Remote I/O error: nada responde en la dirección I2C 0x%02X' % addr)
    return r


def sensor(kind, phys):
    return _w(_simjs.sensor(kind, phys))


def _sleep(s):
    core.sleep(s)


def _pause():
    while True:
        core.sleep(3600)


def _input(prompt=''):
    r = _w(_simjs.input(str(prompt)))
    core.service()
    return r


time.sleep = _sleep
signal.pause = _pause
builtins.input = _input


def _module(name, **attrs):
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules[name] = m
    return m


def _cb_call(fn, *args):
    """Llama a un callback con los argumentos que acepte (gpiozero pasa el dispositivo si cabe)."""
    if fn is None:
        return
    try:
        sig = inspect.signature(fn)
        n = len([p for p in sig.parameters.values() if p.default is p.empty and p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)])
        has_var = any(p.kind == p.VAR_POSITIONAL for p in sig.parameters.values())
    except (TypeError, ValueError):
        n, has_var = 0, True
    fn(*(args if has_var else args[:n]))


# wiringpi (wiringOP / wiringPi)

def _make_wiringpi():
    st = {'mode': 'wpi', 'range': {}, 'pwm_range': 1024, 'pwm_clock': 0, 'i2c': {}}

    def phys(pin):
        pin = int(pin)
        if st['mode'] == 'phys':
            p = pin
        elif st['mode'] == 'gpio':
            p = SUNXI_PHYS.get(pin) if KIND == 'opi' else BCM_PHYS.get(pin)
        else:
            p = WPI_PHYS.get(pin)
        if p is None or p not in IO:
            raise ValueError('wiringpi: el pin %s no existe en esta placa (numeración %s; mira "gpio readall")' % (
                pin, {'wpi': 'wPi', 'gpio': 'GPIO', 'phys': 'física'}[st['mode']]))
        return p

    def setmode(m):
        def f():
            st['mode'] = m
            return 0
        return f

    def pinMode(pin, mode):
        p = phys(pin)
        if mode in (1, 2, 4, 5):
            setup(p, 'out')
        else:
            setup(p, 'in')

    def pullUpDnControl(pin, pud):
        setup(phys(pin), 'in', {0: 0, 1: 1, 2: 2}.get(int(pud), 0))

    def digitalWrite(pin, v):
        write(phys(pin), v)

    def digitalRead(pin):
        return read(phys(pin))

    def pwm_freq():
        rng = st['pwm_range'] or 1024
        return 24e6 / (st['pwm_clock'] * rng) if st['pwm_clock'] else 1000.0

    def pwmWrite(pin, value):
        p = phys(pin)
        setup(p, 'out')
        pwm(p, max(0.0, min(1.0, value / float(st['pwm_range'] or 1024))), pwm_freq())

    def pwmSetRange(r):
        st['pwm_range'] = int(r)

    def pwmSetClock(c):
        st['pwm_clock'] = int(c)

    def softPwmCreate(pin, value, rng):
        p = phys(pin)
        setup(p, 'out')
        st['range'][p] = int(rng) or 100
        softPwmWrite(pin, value)
        return 0

    def softPwmWrite(pin, value):
        p = phys(pin)
        rng = st['range'].get(p, 100)
        pwm(p, max(0.0, min(1.0, value / float(rng))), 1e4 / rng)

    def softPwmStop(pin):
        p = phys(pin)
        pwm(p, -1, 0)
        write(p, 0)

    def softToneCreate(pin):
        setup(phys(pin), 'out')
        return 0

    def softToneWrite(pin, freq):
        p = phys(pin)
        if freq and freq > 0:
            pwm(p, 0.5, freq)
        else:
            pwm(p, -1, 0)
            write(p, 0)

    def wiringPiISR(pin, edge, cb):
        p = phys(pin)

        def h(v):
            if edge == 3 or (edge == 2 and v) or (edge == 1 and not v):
                _cb_call(cb)
        core.on_change(p, h)
        return 0

    def i2c_setup(dev_id, *rest):
        addr = int(rest[-1] if rest else dev_id) & 0x7f
        fd = 3 + len(st['i2c'])
        st['i2c'][fd] = addr
        return fd

    def addr_of(fd):
        return st['i2c'].get(fd, fd & 0x7f)

    def rd(fd, data, n):
        r = i2c(addr_of(fd), data, n)
        return -1 if r is None else r

    def I2CRead(fd):
        r = rd(fd, [], 1)
        return r if r == -1 else r[0]

    def I2CWrite(fd, v):
        return -1 if i2c(addr_of(fd), [v]) is None else 0

    def I2CWriteReg8(fd, reg, v):
        return -1 if i2c(addr_of(fd), [reg, v]) is None else 0

    def I2CWriteReg16(fd, reg, v):
        return -1 if i2c(addr_of(fd), [reg, v & 255, (v >> 8) & 255]) is None else 0

    def I2CReadReg8(fd, reg):
        r = rd(fd, [reg], 1)
        return r if r == -1 else r[0]

    def I2CReadReg16(fd, reg):
        r = rd(fd, [reg], 2)
        return r if r == -1 else r[0] | (r[1] << 8)

    _module('wiringpi',
            INPUT=0, OUTPUT=1, PWM_OUTPUT=2, GPIO_CLOCK=3, SOFT_PWM_OUTPUT=4, SOFT_TONE_OUTPUT=5,
            LOW=0, HIGH=1, PUD_OFF=0, PUD_DOWN=1, PUD_UP=2,
            INT_EDGE_SETUP=0, INT_EDGE_FALLING=1, INT_EDGE_RISING=2, INT_EDGE_BOTH=3,
            PWM_MODE_MS=0, PWM_MODE_BAL=1,
            wiringPiSetup=setmode('wpi'), wiringPiSetupGpio=setmode('gpio'), wiringPiSetupPhys=setmode('phys'),
            wiringPiSetupSys=setmode('gpio'),
            pinMode=pinMode, pullUpDnControl=pullUpDnControl, digitalWrite=digitalWrite, digitalRead=digitalRead,
            pwmWrite=pwmWrite, pwmSetRange=pwmSetRange, pwmSetClock=pwmSetClock, pwmSetMode=lambda m: None,
            softPwmCreate=softPwmCreate, softPwmWrite=softPwmWrite, softPwmStop=softPwmStop,
            softToneCreate=softToneCreate, softToneWrite=softToneWrite, softToneStop=lambda pin: softToneWrite(pin, 0),
            wiringPiISR=wiringPiISR,
            delay=lambda ms: core.sleep(ms / 1000.0), delayMicroseconds=lambda us: core.sleep(us / 1e6),
            millis=lambda: int(core.now() * 1000), micros=lambda: int(core.now() * 1e6),
            wiringPiI2CSetup=i2c_setup, wiringPiI2CSetupInterface=i2c_setup,
            wiringPiI2CRead=I2CRead, wiringPiI2CWrite=I2CWrite,
            wiringPiI2CWriteReg8=I2CWriteReg8, wiringPiI2CWriteReg16=I2CWriteReg16,
            wiringPiI2CReadReg8=I2CReadReg8, wiringPiI2CReadReg16=I2CReadReg16,
            physPinToGpio=lambda p: PINS.get(int(p), {}).get('sunxi' if KIND == 'opi' else 'bcm', -1),
            wpiPinToGpio=lambda w: PINS.get(WPI_PHYS.get(int(w), 0), {}).get('sunxi' if KIND == 'opi' else 'bcm', -1))


# RPi.GPIO / OPi.GPIO

def _make_gpio(modname, default_mode):
    BOARD, BCM, SUNXI = 10, 11, 'SUNXI'
    IN, OUT, HIGH, LOW = 1, 0, 1, 0
    PUD_OFF, PUD_DOWN, PUD_UP = 20, 21, 22
    RISING, FALLING, BOTH = 31, 32, 33
    st = {'mode': default_mode, 'dir': {}, 'events': {}, 'hits': set()}

    def phys(ch):
        m = st['mode']
        if m is None:
            raise RuntimeError('Please set pin numbering mode using GPIO.setmode(GPIO.BOARD) or GPIO.setmode(GPIO.BCM)')
        if isinstance(ch, str):
            p = NAME_PHYS.get(ch.upper())
        elif m == BOARD:
            p = int(ch)
        elif m == BCM:
            p = BCM_PHYS.get(int(ch))
        else:
            p = SUNXI_PHYS.get(int(ch))
        if p is None or p not in IO:
            raise ValueError('The channel sent is invalid on a Raspberry Pi' if modname == 'RPi.GPIO' else
                             'Canal %r no válido en esta placa' % (ch,))
        return p

    def each(ch):
        return ch if isinstance(ch, (list, tuple)) else [ch]

    def setmode_(m):
        st['mode'] = m

    def setup_(channel, direction, pull_up_down=PUD_OFF, initial=None):
        for ch in each(channel):
            p = phys(ch)
            st['dir'][p] = direction
            if direction == OUT:
                setup(p, 'out')
                if initial is not None:
                    write(p, initial)
            else:
                setup(p, 'in', {PUD_UP: 2, PUD_DOWN: 1}.get(pull_up_down, 0))

    def output(channel, value):
        chs, vals = each(channel), value if isinstance(value, (list, tuple)) else None
        for i, ch in enumerate(chs):
            p = phys(ch)
            if st['dir'].get(p) != OUT:
                raise RuntimeError('The GPIO channel has not been set up as an OUTPUT')
            write(p, vals[i] if vals else value)

    def input_(channel):
        return read(phys(channel))

    def cleanup(channel=None):
        for p in ([phys(c) for c in each(channel)] if channel is not None else list(st['dir'])):
            pwm(p, -1, 0)
            setup(p, 'in')
            st['dir'].pop(p, None)
            core.off_change(p)

    def add_event_detect(channel, edge, callback=None, bouncetime=None):
        p = phys(channel)
        ev = {'cbs': [callback] if callback else [], 'last': -1.0}

        def h(v):
            if (edge == RISING and not v) or (edge == FALLING and v):
                return
            t = core.now()
            if bouncetime and (t - ev['last']) * 1000 < bouncetime:
                return
            ev['last'] = t
            st['hits'].add(p)
            for cb in list(ev['cbs']):
                _cb_call(cb, channel)
        st['events'][p] = (ev, h)
        core.on_change(p, h)

    def add_event_callback(channel, callback):
        p = phys(channel)
        if p not in st['events']:
            raise RuntimeError('Add event detection using add_event_detect first before adding a callback')
        st['events'][p][0]['cbs'].append(callback)

    def remove_event_detect(channel):
        p = phys(channel)
        if p in st['events']:
            core.off_change(p, st['events'].pop(p)[1])

    def event_detected(channel):
        p = phys(channel)
        if p in st['hits']:
            st['hits'].discard(p)
            return True
        core.poll()
        return False

    def wait_for_edge(channel, edge, bouncetime=None, timeout=None):
        p = phys(channel)
        last, end = read(p), None if timeout is None else core.now() + timeout / 1000.0
        while end is None or core.now() < end:
            core.sleep(0.001)
            v = core.read(p)
            if v != last:
                last = v
                if edge == BOTH or (edge == RISING and v) or (edge == FALLING and not v):
                    return channel
        return None

    class PWM:
        def __init__(self, channel, frequency):
            self.p = phys(channel)
            if st['dir'].get(self.p) != OUT:
                setup(self.p, 'out')
                st['dir'][self.p] = OUT
            self.f, self.dc, self.on = float(frequency), 0.0, False

        def _apply(self):
            pwm(self.p, self.dc / 100.0, self.f) if self.on else pwm(self.p, -1, 0)

        def start(self, dc):
            self.dc, self.on = float(dc), True
            self._apply()

        def ChangeDutyCycle(self, dc):
            if not 0 <= dc <= 100:
                raise ValueError('dutycycle must have a value from 0.0 to 100.0')
            self.dc = float(dc)
            self._apply()

        def ChangeFrequency(self, f):
            self.f = float(f)
            self._apply()

        def stop(self):
            self.on = False
            self._apply()
            write(self.p, 0)

    attrs = dict(BOARD=BOARD, BCM=BCM, SUNXI=SUNXI, IN=IN, OUT=OUT, HIGH=HIGH, LOW=LOW,
                 PUD_OFF=PUD_OFF, PUD_DOWN=PUD_DOWN, PUD_UP=PUD_UP, RISING=RISING, FALLING=FALLING, BOTH=BOTH,
                 VERSION='0.7.1 (simulado)', RPI_INFO={'P1_REVISION': 3, 'TYPE': CFG.get('model', '')},
                 setmode=setmode_, getmode=lambda: st['mode'], setwarnings=lambda flag: None,
                 setboard=lambda b: None, setup=setup_, output=output, input=input_, cleanup=cleanup,
                 add_event_detect=add_event_detect, add_event_callback=add_event_callback,
                 remove_event_detect=remove_event_detect, event_detected=event_detected,
                 wait_for_edge=wait_for_edge, gpio_function=lambda ch: st['dir'].get(phys(ch), IN), PWM=PWM)
    pkg = modname.split('.')[0]
    parent = sys.modules.get(pkg) or _module(pkg)
    m = _module(modname, **attrs)
    setattr(parent, 'GPIO', m)
    return m


# gpiozero

def _make_gpiozero():
    class GPIOZeroError(Exception):
        pass

    class BadPinFactory(GPIOZeroError):
        pass

    def pin_of(pin):
        if pin is None:
            raise GPIOZeroError('No pin given')
        if isinstance(pin, str):
            s = pin.strip().upper()
            for pre in ('BOARD', 'J8:', 'P1:'):
                if s.startswith(pre):
                    return check_io(int(s[len(pre):]), 'gpiozero')
            for pre in ('GPIO', 'BCM'):
                if s.startswith(pre):
                    s = s[len(pre):]
            pin = int(s)
        p = BCM_PHYS.get(int(pin))
        if p is None:
            raise GPIOZeroError('GPIO%s no existe en el conector de 40 pines' % pin)
        return check_io(p, 'gpiozero')

    class Device:
        def __init__(self):
            self._closed = False

        def close(self):
            self._closed = True

        @property
        def closed(self):
            return self._closed

        def __enter__(self):
            return self

        def __exit__(self, *a):
            self.close()

    class OutputDevice(Device):
        def __init__(self, pin=None, active_high=True, initial_value=False, pin_factory=None):
            super().__init__()
            self.pin = pin_of(pin)
            self.active_high = active_high
            self._task = None
            self._v = 0
            setup(self.pin, 'out')
            self._set(1 if initial_value else 0)

        def _set(self, v):
            self._v = v
            write(self.pin, v if self.active_high else 1 - v)

        def _stop(self):
            if self._task:
                core.cancel(self._task)
                self._task = None

        def on(self):
            self._stop()
            self._set(1)

        def off(self):
            self._stop()
            self._set(0)

        def toggle(self):
            self._stop()
            self._set(1 - self._v)

        @property
        def value(self):
            return self._v

        @value.setter
        def value(self, v):
            self._stop()
            self._set(1 if v else 0)

        @property
        def is_active(self):
            return bool(self._v)

        def _run(self, gen, background):
            self._stop()
            if background:
                self._task = core.add_task(gen)
            else:
                for d in gen:
                    core.sleep(d)

        def blink(self, on_time=1, off_time=1, n=None, background=True):
            def g():
                i = 0
                while n is None or i < n:
                    self._set(1)
                    yield on_time
                    self._set(0)
                    yield off_time
                    i += 1
            self._run(g(), background)

        def close(self):
            self._stop()
            super().close()

    class DigitalOutputDevice(OutputDevice):
        pass

    class LED(DigitalOutputDevice):
        is_lit = property(lambda self: self.is_active)

    class Buzzer(DigitalOutputDevice):
        def beep(self, on_time=1, off_time=1, n=None, background=True):
            self.blink(on_time, off_time, n, background)

    class PWMOutputDevice(OutputDevice):
        def __init__(self, pin=None, active_high=True, initial_value=0, frequency=100, pin_factory=None):
            self._freq = float(frequency)
            super().__init__(pin, active_high, initial_value)

        def _set(self, v):
            self._v = max(0.0, min(1.0, float(v)))
            d = self._v if self.active_high else 1 - self._v
            if d <= 0:
                pwm(self.pin, -1, 0)
                write(self.pin, 0)
            elif d >= 1:
                pwm(self.pin, -1, 0)
                write(self.pin, 1)
            else:
                pwm(self.pin, d, self._freq)

        @property
        def value(self):
            return self._v

        @value.setter
        def value(self, v):
            self._stop()
            self._set(v)

        def toggle(self):
            self._stop()
            self._set(1 - self._v)

        @property
        def frequency(self):
            return self._freq

        @frequency.setter
        def frequency(self, f):
            self._freq = float(f)
            self._set(self._v)

        def pulse(self, fade_in_time=1, fade_out_time=1, n=None, background=True):
            def g():
                i, steps = 0, 25
                while n is None or i < n:
                    for k in range(steps + 1):
                        self._set(k / steps)
                        yield fade_in_time / steps
                    for k in range(steps, -1, -1):
                        self._set(k / steps)
                        yield fade_out_time / steps
                    i += 1
            self._run(g(), background)

    class PWMLED(PWMOutputDevice):
        is_lit = property(lambda self: self._v > 0)

    class RGBLED(Device):
        def __init__(self, red=None, green=None, blue=None, active_high=True, initial_value=(0, 0, 0), pwm=True, pin_factory=None):
            super().__init__()
            cls = PWMLED if pwm else LED
            self._leds = [cls(p, active_high=active_high) for p in (red, green, blue)]
            self.color = initial_value

        @property
        def color(self):
            return tuple(l.value for l in self._leds)

        @color.setter
        def color(self, c):
            for l, v in zip(self._leds, c):
                l.value = v

        value = color
        red = property(lambda s: s._leds[0].value, lambda s, v: setattr(s._leds[0], 'value', v))
        green = property(lambda s: s._leds[1].value, lambda s, v: setattr(s._leds[1], 'value', v))
        blue = property(lambda s: s._leds[2].value, lambda s, v: setattr(s._leds[2], 'value', v))

        def on(self):
            self.color = (1, 1, 1)

        def off(self):
            self.color = (0, 0, 0)

        def toggle(self):
            self.color = tuple(1 - v for v in self.color)

    class InputDevice(Device):
        def __init__(self, pin=None, pull_up=False, active_state=None, bounce_time=None, pin_factory=None):
            super().__init__()
            self.pin = pin_of(pin)
            self.pull_up = pull_up
            self._active_high = (not pull_up) if active_state is None else bool(active_state)
            self.bounce_time = bounce_time
            self._handlers = {}
            self._last_t = -1.0
            setup(self.pin, 'in', 2 if pull_up else (1 if pull_up is False else 0))
            core.on_change(self.pin, self._edge)

        def _active(self, v):
            return bool(v) == self._active_high

        @property
        def value(self):
            return 1 if self._active(read(self.pin)) else 0

        is_active = property(lambda self: bool(self.value))

        def _edge(self, v):
            t = core.now()
            if self.bounce_time and t - self._last_t < self.bounce_time:
                return
            self._last_t = t
            self._fire('when_activated' if self._active(v) else 'when_deactivated')

        def _fire(self, name):
            fn = self._handlers.get(name)
            if fn:
                _cb_call(fn, self)

        def _wait(self, want, timeout):
            end = None if timeout is None else core.now() + timeout
            while self.is_active != want:
                if end is not None and core.now() >= end:
                    return False
                core.sleep(0.002)
            return True

        def wait_for_active(self, timeout=None):
            return self._wait(True, timeout)

        def wait_for_inactive(self, timeout=None):
            return self._wait(False, timeout)

        def close(self):
            core.off_change(self.pin, self._edge)
            super().close()

    def _alias(active, inactive):
        def get_a(self):
            return self._handlers.get('when_activated')

        def set_a(self, fn):
            self._handlers['when_activated'] = fn

        def get_i(self):
            return self._handlers.get('when_deactivated')

        def set_i(self, fn):
            self._handlers['when_deactivated'] = fn
        return {active: property(get_a, set_a), inactive: property(get_i, set_i),
                'when_activated': property(get_a, set_a), 'when_deactivated': property(get_i, set_i)}

    DigitalInputDevice = type('DigitalInputDevice', (InputDevice,), _alias('when_activated', 'when_deactivated'))

    class Button(DigitalInputDevice):
        def __init__(self, pin=None, pull_up=True, active_state=None, bounce_time=None, hold_time=1, hold_repeat=False, pin_factory=None):
            super().__init__(pin, pull_up, active_state, bounce_time)
            self.hold_time, self.hold_repeat = hold_time, hold_repeat
            self._hold_task = None

        is_pressed = property(lambda self: self.is_active)
        wait_for_press = InputDevice.wait_for_active
        wait_for_release = InputDevice.wait_for_inactive

        def _fire(self, name):
            super()._fire(name)
            if name == 'when_activated' and self._handlers.get('when_held'):
                def g():
                    yield self.hold_time
                    while self.is_active:
                        _cb_call(self._handlers.get('when_held'), self)
                        if not self.hold_repeat:
                            return
                        yield self.hold_time
                if self._hold_task:
                    core.cancel(self._hold_task)
                self._hold_task = core.add_task(g())

        when_held = property(lambda s: s._handlers.get('when_held'), lambda s, fn: s._handlers.__setitem__('when_held', fn))

    for k, v in _alias('when_pressed', 'when_released').items():
        setattr(Button, k, v)

    class MotionSensor(DigitalInputDevice):
        def __init__(self, pin=None, pull_up=False, active_state=None, queue_len=1, sample_rate=10, threshold=0.5, partial=False, pin_factory=None):
            super().__init__(pin, pull_up, active_state)

        motion_detected = property(lambda self: self.is_active)
        wait_for_motion = InputDevice.wait_for_active
        wait_for_no_motion = InputDevice.wait_for_inactive

    for k, v in _alias('when_motion', 'when_no_motion').items():
        setattr(MotionSensor, k, v)

    class LineSensor(DigitalInputDevice):
        line_detected = property(lambda self: self.is_active)

    for k, v in _alias('when_line', 'when_no_line').items():
        setattr(LineSensor, k, v)

    class Servo(Device):
        def __init__(self, pin=None, initial_value=0.0, min_pulse_width=1 / 1000, max_pulse_width=2 / 1000, frame_width=20 / 1000, pin_factory=None):
            super().__init__()
            self.pin = pin_of(pin)
            self.min_pulse_width, self.max_pulse_width, self.frame_width = min_pulse_width, max_pulse_width, frame_width
            setup(self.pin, 'out')
            self.value = initial_value

        @property
        def value(self):
            return self._v

        @value.setter
        def value(self, v):
            self._v = v
            if v is None:
                pwm(self.pin, -1, 0)
                write(self.pin, 0)
                return
            v = max(-1.0, min(1.0, float(v)))
            self._v = v
            width = self.min_pulse_width + (v + 1) / 2 * (self.max_pulse_width - self.min_pulse_width)
            pwm(self.pin, width / self.frame_width, 1 / self.frame_width)

        pulse_width = property(lambda s: None if s._v is None else s.min_pulse_width + (s._v + 1) / 2 * (s.max_pulse_width - s.min_pulse_width))

        def min(self):
            self.value = -1

        def mid(self):
            self.value = 0

        def max(self):
            self.value = 1

        def detach(self):
            self.value = None

    class AngularServo(Servo):
        def __init__(self, pin=None, initial_angle=0.0, min_angle=-90, max_angle=90, min_pulse_width=1 / 1000, max_pulse_width=2 / 1000, frame_width=20 / 1000, pin_factory=None):
            self.min_angle, self.max_angle = min_angle, max_angle
            super().__init__(pin, self._to_value(initial_angle), min_pulse_width, max_pulse_width, frame_width)

        def _to_value(self, a):
            if a is None:
                return None
            return (float(a) - self.min_angle) / (self.max_angle - self.min_angle) * 2 - 1

        @property
        def angle(self):
            if self._v is None:
                return None
            return self.min_angle + (self._v + 1) / 2 * (self.max_angle - self.min_angle)

        @angle.setter
        def angle(self, a):
            self.value = self._to_value(a)

    class DistanceSensor(Device):
        def __init__(self, echo=None, trigger=None, queue_len=9, max_distance=1, threshold_distance=0.3, partial=False, pin_factory=None):
            super().__init__()
            self.echo, self.trigger = pin_of(echo), pin_of(trigger)
            self.max_distance, self.threshold_distance = max_distance, threshold_distance
            setup(self.trigger, 'out')
            setup(self.echo, 'in')

        @property
        def distance(self):
            r = sensor('sonar', self.trigger)
            if not r:
                return self.max_distance
            return max(0.0, min(self.max_distance, float(r['d']) / 100.0))

        value = property(lambda self: self.distance / self.max_distance)

    NOTES = {'C': -9, 'D': -7, 'E': -5, 'F': -4, 'G': -2, 'A': 0, 'B': 2}

    def tone_hz(t):
        if hasattr(t, 'frequency'):
            return float(t.frequency)
        if isinstance(t, str):
            s = t.strip().upper()
            n = NOTES[s[0]] + (1 if '#' in s else -1 if s[1:2] == 'B' and len(s) > 2 else 0)
            octave = int(s.lstrip('ABCDEFG#').lstrip('B') or 4)
            return 440.0 * 2 ** ((n + (octave - 4) * 12) / 12)
        return float(t)

    class TonalBuzzer(Device):
        def __init__(self, pin=None, initial_value=None, mid_tone='A4', octaves=1, pin_factory=None):
            super().__init__()
            self.pin = pin_of(pin)
            setup(self.pin, 'out')
            self._tone = None
            if initial_value is not None:
                self.play(initial_value)

        def play(self, tone):
            self._tone = tone_hz(tone)
            pwm(self.pin, 0.5, self._tone)

        def stop(self):
            self._tone = None
            pwm(self.pin, -1, 0)
            write(self.pin, 0)

        is_active = property(lambda self: self._tone is not None)

    class Motor(Device):
        def __init__(self, forward=None, backward=None, enable=None, pwm=True, pin_factory=None):
            super().__init__()
            cls = PWMOutputDevice if pwm else DigitalOutputDevice
            self.forward_device, self.backward_device = cls(forward), cls(backward)
            self.enable_device = DigitalOutputDevice(enable, initial_value=True) if enable is not None else None
            self._v = 0

        def forward(self, speed=1):
            self.backward_device.off()
            self.forward_device.value = speed
            self._v = speed

        def backward(self, speed=1):
            self.forward_device.off()
            self.backward_device.value = speed
            self._v = -speed

        def stop(self):
            self.forward_device.off()
            self.backward_device.off()
            self._v = 0

        def reverse(self):
            self.value = -self._v

        @property
        def value(self):
            return self._v

        @value.setter
        def value(self, v):
            if v > 0:
                self.forward(v)
            elif v < 0:
                self.backward(-v)
            else:
                self.stop()

        is_active = property(lambda self: self._v != 0)

    class Tone(float):
        frequency = property(lambda self: float(self))

    _module('gpiozero', Device=Device, GPIOZeroError=GPIOZeroError, BadPinFactory=BadPinFactory,
            OutputDevice=OutputDevice, DigitalOutputDevice=DigitalOutputDevice, LED=LED, Buzzer=Buzzer,
            PWMOutputDevice=PWMOutputDevice, PWMLED=PWMLED, RGBLED=RGBLED,
            InputDevice=InputDevice, DigitalInputDevice=DigitalInputDevice, Button=Button,
            MotionSensor=MotionSensor, LineSensor=LineSensor, Servo=Servo, AngularServo=AngularServo,
            DistanceSensor=DistanceSensor, TonalBuzzer=TonalBuzzer, Motor=Motor)
    _module('gpiozero.tones', Tone=Tone)


# smbus2 / smbus

def _make_smbus():
    class i2c_msg:
        def __init__(self, addr, data, rd):
            self.addr, self.buf, self.rd = addr, list(data), rd
            self.len = len(self.buf)

        @staticmethod
        def write(addr, buf):
            return i2c_msg(addr, list(buf.encode() if isinstance(buf, str) else buf), False)

        @staticmethod
        def read(addr, length):
            return i2c_msg(addr, [0] * length, True)

        def __iter__(self):
            return iter(self.buf)

        def __len__(self):
            return self.len

        def __bytes__(self):
            return bytes(self.buf)

    class SMBus:
        def __init__(self, bus=None, force=False):
            self.bus = bus

        def open(self, bus):
            self.bus = bus

        def close(self):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            self.close()

        def write_quick(self, addr, force=None):
            i2c_or_fail(addr)

        def read_byte(self, addr, force=None):
            return i2c_or_fail(addr, [], 1)[0]

        def write_byte(self, addr, value, force=None):
            i2c_or_fail(addr, [value])

        def read_byte_data(self, addr, reg, force=None):
            return i2c_or_fail(addr, [reg], 1)[0]

        def write_byte_data(self, addr, reg, value, force=None):
            i2c_or_fail(addr, [reg, value])

        def read_word_data(self, addr, reg, force=None):
            r = i2c_or_fail(addr, [reg], 2)
            return r[0] | (r[1] << 8)

        def write_word_data(self, addr, reg, value, force=None):
            i2c_or_fail(addr, [reg, value & 255, (value >> 8) & 255])

        def read_i2c_block_data(self, addr, reg, length, force=None):
            return list(i2c_or_fail(addr, [reg], length))

        def write_i2c_block_data(self, addr, reg, data, force=None):
            i2c_or_fail(addr, [reg] + list(data))

        read_block_data = read_i2c_block_data
        write_block_data = write_i2c_block_data

        def i2c_rdwr(self, *msgs):
            k = 0
            while k < len(msgs):
                m = msgs[k]
                nxt = msgs[k + 1] if k + 1 < len(msgs) else None
                if not m.rd and nxt is not None and nxt.rd and nxt.addr == m.addr:
                    nxt.buf = list(i2c_or_fail(m.addr, m.buf, nxt.len))       # escritura + inicio repetido + lectura
                    k += 2
                    continue
                if m.rd:
                    m.buf = list(i2c_or_fail(m.addr, [], m.len))
                else:
                    i2c_or_fail(m.addr, m.buf)
                k += 1

    _module('smbus2', SMBus=SMBus, i2c_msg=i2c_msg)
    _module('smbus', SMBus=SMBus)
    return SMBus


# RPLCD.i2c: LCD HD44780 con adaptador PCF8574

def _make_rplcd(SMBus):
    RS, EN, BL = 0x01, 0x04, 0x08

    class CharLCD:
        def __init__(self, i2c_expander='PCF8574', address=0x27, expander_params=None, port=1, cols=20, rows=4,
                     dotsize=8, charmap='A02', auto_linebreaks=True, backlight_enabled=True):
            if str(i2c_expander).upper() not in ('PCF8574', 'MCP23008', 'MCP23017'):
                raise NotImplementedError('I2C expander "%s" is not supported.' % i2c_expander)
            self.addr, self.cols, self.rows = int(address), int(cols), int(rows)
            self.auto_linebreaks = auto_linebreaks
            self._bl = BL if backlight_enabled else 0
            self._pos = [0, 0]
            self._offsets = [0x00, 0x40, self.cols, 0x40 + self.cols]
            i2c_or_fail(self.addr, [self._bl])
            for n in (0x03, 0x03, 0x03, 0x02):          # pasar a 4 bits, como el datasheet
                self._nib(n << 4, 0)
                core.sleep(0.005)
            self.command(0x28 if self.rows > 1 else 0x20)
            self._display = 0x04
            self._cursor = 0
            self.command(0x08 | self._display)
            self.clear()
            self.command(0x06)

        def _nib(self, hi, mode):
            b = hi | mode | self._bl
            i2c_or_fail(self.addr, [b | EN, b])

        def _send(self, values, mode):
            data = []
            for v in values:
                for hi in (v & 0xf0, (v << 4) & 0xf0):
                    b = hi | mode | self._bl
                    data += [b | EN, b]
            i2c_or_fail(self.addr, data)

        def command(self, v):
            self._send([v], 0)

        def write(self, value):
            self._send([value & 255], RS)
            self._advance()

        def _advance(self):
            self._pos[1] += 1
            if self.auto_linebreaks and self._pos[1] >= self.cols:
                self._pos = [(self._pos[0] + 1) % self.rows, 0]
                self._goto()

        def _goto(self):
            r, c = self._pos
            self.command(0x80 | (self._offsets[r % 4] + c))

        def write_string(self, s):
            for ch in str(s):
                if ch == '\n':
                    self._pos[0] = (self._pos[0] + 1) % self.rows
                    self._goto()
                elif ch == '\r':
                    self._pos[1] = 0
                    self._goto()
                else:
                    o = ord(ch)
                    self.write(o if o < 256 else 0x3f)

        def clear(self):
            self.command(0x01)
            self._pos = [0, 0]
            core.sleep(0.002)

        def home(self):
            self.command(0x02)
            self._pos = [0, 0]
            core.sleep(0.002)

        def cr(self):
            self.write_string('\r')

        def lf(self):
            self.write_string('\n')

        def crlf(self):
            self.write_string('\r\n')

        @property
        def cursor_pos(self):
            return tuple(self._pos)

        @cursor_pos.setter
        def cursor_pos(self, value):
            self._pos = [int(value[0]), int(value[1])]
            self._goto()

        @property
        def backlight_enabled(self):
            return bool(self._bl)

        @backlight_enabled.setter
        def backlight_enabled(self, on):
            self._bl = BL if on else 0
            i2c_or_fail(self.addr, [self._bl])

        @property
        def display_enabled(self):
            return bool(self._display)

        @display_enabled.setter
        def display_enabled(self, on):
            self._display = 0x04 if on else 0
            self.command(0x08 | self._display | self._cursor)

        @property
        def cursor_mode(self):
            return {0: 'hide', 2: 'line', 3: 'blink'}.get(self._cursor, 'hide')

        @cursor_mode.setter
        def cursor_mode(self, m):
            self._cursor = {'hide': 0, 'line': 2, 'blink': 3}[m]
            self.command(0x08 | self._display | self._cursor)

        def create_char(self, location, bitmap):
            self.command(0x40 | ((location & 7) << 3))
            self._send(list(bitmap)[:8], RS)
            self._goto()

        def shift_display(self, amount):
            for _ in range(abs(amount)):
                self.command(0x1c if amount > 0 else 0x18)

        def close(self, clear=False):
            if clear:
                self.clear()

    rp = _module('RPLCD')
    rp.i2c = _module('RPLCD.i2c', CharLCD=CharLCD)
    rp.CharLCD = CharLCD


# board + adafruit_dht

def _make_dht():
    class Pin:
        def __init__(self, bcm):
            self.id = bcm

        def __repr__(self):
            return 'board.D%d' % self.id

    b = _module('board', **{'D%d' % n: Pin(n) for n in BCM_PHYS})
    b.SDA, b.SCL = Pin(2), Pin(3)

    class DHTBase:
        def __init__(self, pin, use_pulseio=True):
            self.pin = BCM_PHYS.get(pin.id if hasattr(pin, 'id') else int(pin))

        def _read(self):
            r = sensor('dht', self.pin)
            if not r:
                raise RuntimeError('DHT sensor not found, check wiring')
            return r

        @property
        def temperature(self):
            return float(self._read()['t'])

        @property
        def humidity(self):
            return float(self._read()['h'])

        def measure(self):
            self._read()

        def exit(self):
            pass

    class DHT22(DHTBase):
        pass

    class DHT11(DHTBase):
        @property
        def temperature(self):
            return int(round(super().temperature))

        @property
        def humidity(self):
            return int(round(super().humidity))

    _module('adafruit_dht', DHT22=DHT22, DHT11=DHT11, DHT21=DHT22)


_make_wiringpi()
_make_gpio('OPi.GPIO', 10)          # OPi.GPIO: numeración física (BOARD) por defecto en sus ejemplos
_make_gpio('RPi.GPIO', None)        # RPi.GPIO: hay que elegir setmode()
_make_gpiozero()
_make_rplcd(_make_smbus())
_make_dht()


def run_user(src):
    """Ejecuta el programa del usuario; los errores se muestran solo con sus propias líneas."""
    import traceback
    g = {'__name__': '__main__', '__file__': 'programa.py', '__builtins__': builtins}
    try:
        exec(compile(src, 'programa.py', 'exec'), g)
    except SystemExit as e:
        return 'exit:%s' % (e.code if e.code is not None else 0)
    except KeyboardInterrupt:
        return 'exit:0'
    except BaseException as e:
        tb = traceback.extract_tb(e.__traceback__)
        own = [f for f in tb if f.filename == 'programa.py']
        lines = ['Traceback (most recent call last):\n'] + traceback.format_list(own) if own else []
        lines += traceback.format_exception_only(type(e), e)
        return 'error:' + ''.join(lines)
    return 'end'
