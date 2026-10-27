# -*- coding: utf-8 -*-
"""Ejecuta un firmware de ESP32 en QEMU (fork de lcgamboa usado por PICSimLab, GPL-2) y lo comunica
con el simulador del navegador por líneas JSON:

  salida (stdout):  {"t":"pin","g":2,"v":1}  {"t":"dir","g":2,"o":1,"pu":0,"pd":0}
                    {"t":"uart","d":"texto"}  {"t":"i2c","b":0,"a":39,"e":"w","d":65}
                    {"t":"pwm","l":[[gpio,duty,freq],…]}  {"t":"ready"}  {"t":"exit"}
  entrada (stdin):  {"c":"pin","g":4,"v":0}  {"c":"adc","g":34,"v":1.65}  {"c":"rx","d":"hola\\n"}
                    {"c":"i2c","l":[39,60]}  (direcciones presentes)  {"c":"i2cr","v":12}  (respuesta a una lectura)

Uso: python esp32_runner.py <flash.bin> [carpeta de la librería] [esp32 | esp32c3]
Cada simulación es un proceso aparte: QEMU no se puede reiniciar dentro del mismo proceso."""
import ctypes
import json
import os
import queue
import sys
import threading
import time

BASE = os.path.dirname(os.path.abspath(__file__))
LIB_DIR = sys.argv[2] if len(sys.argv) > 2 else os.path.join(BASE, "bin", "qemu-esp32")
FLASH = sys.argv[1]
CHIP = sys.argv[3] if len(sys.argv) > 3 else "esp32"

# Lo que cambia entre el ESP32 (Xtensa) y el ESP32-C3 (RISC-V), según las placas de PICSimLab
CHIPS = {
    "esp32": dict(lib="libqemu-xtensa", qemu="qemu-system-xtensa", machine="esp32-picsimlab", efuse="nvram.esp32.efuse",
                  timg="timer.esp32.timg", npins=40, flash={6, 7, 8, 9, 10, 11},
                  rtc={0, 2, 4, 12, 13, 14, 15, 25, 26, 27, 32, 33}, ledc=(71, 16),
                  adc={36: 0, 37: 1, 38: 2, 39: 3, 32: 4, 33: 5, 34: 6, 35: 7,             # ADC1 0-7, ADC2 8+n
                       4: 8, 0: 9, 2: 10, 15: 11, 13: 12, 12: 13, 14: 14, 27: 15, 25: 16, 26: 17}),
    "esp32c3": dict(lib="libqemu-riscv32", qemu="qemu-system-riscv32", machine="esp32c3-picsimlab", efuse="nvram.esp32c3.efuse",
                    timg="timer.esp32c3.timg", npins=22, flash={12, 13, 14, 15, 16, 17},
                    rtc={0, 1, 2, 3, 4, 5}, ledc=(45, 6), adc={0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 8}),
}
CFG = CHIPS[CHIP]

# stdout queda para el protocolo; lo que imprima QEMU va a stderr
_proto = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
os.dup2(2, 1)
_out_lock = threading.Lock()


def emit(obj):
    with _out_lock:
        _proto.write(json.dumps(obj, separators=(",", ":")) + "\n")
        _proto.flush()


if hasattr(os, "add_dll_directory"):
    os.add_dll_directory(LIB_DIR)
os.environ["PATH"] = LIB_DIR + os.pathsep + os.environ.get("PATH", "")
lib = ctypes.CDLL(os.path.join(LIB_DIR, CFG["lib"] + (".dll" if os.name == "nt" else ".so")))

WRITE_PIN = ctypes.CFUNCTYPE(None, ctypes.c_int, ctypes.c_int)
DIR_PIN = ctypes.CFUNCTYPE(None, ctypes.c_int, ctypes.c_int)
I2C_EV = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_uint8, ctypes.c_uint8, ctypes.c_uint16)
SPI_EV = ctypes.CFUNCTYPE(ctypes.c_uint8, ctypes.c_uint8, ctypes.c_uint16)
UART_TX = ctypes.CFUNCTYPE(None, ctypes.c_uint8, ctypes.c_uint8)
RMT_EV = ctypes.CFUNCTYPE(None, ctypes.c_uint8, ctypes.c_uint32, ctypes.c_uint32)


class Callbacks(ctypes.Structure):
    _fields_ = [("write_pin", WRITE_PIN), ("dir_pin", DIR_PIN), ("i2c", I2C_EV), ("spi", SPI_EV),
                ("uart", UART_TX), ("pinmap", ctypes.POINTER(ctypes.c_short)), ("rmt", RMT_EV)]


lib.qemu_init.argtypes = [ctypes.c_int, ctypes.POINTER(ctypes.c_char_p), ctypes.c_void_p]
lib.qemu_main_loop.argtypes = []
lib.qemu_picsimlab_set_pin.argtypes = [ctypes.c_int, ctypes.c_int]
lib.qemu_picsimlab_set_apin.argtypes = [ctypes.c_int, ctypes.c_int]
lib.qemu_picsimlab_uart_receive.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
lib.qemu_picsimlab_get_internals.argtypes = [ctypes.c_int]
lib.qemu_picsimlab_get_internals.restype = ctypes.POINTER(ctypes.c_uint32)
lib.bql_lock_impl.argtypes = [ctypes.c_char_p, ctypes.c_int]
lib.bql_unlock.argtypes = []
lib.qmp_stop.argtypes = [ctypes.c_void_p]
lib.qmp_cont.argtypes = [ctypes.c_void_p]

NPINS = CFG["npins"]
PINMAP = (ctypes.c_short * (NPINS + 1))(NPINS, *range(NPINS))     # ranura i → GPIO i-1
ADC_CH = CFG["adc"]                 # GPIO → canal del ADC, como en PICSimLab
FLASH_PINS = CFG["flash"]           # pines de la memoria flash: no se tocan
RTC_PADS = CFG["rtc"]

state = {"dir": [None] * NPINS, "i2c_addrs": set(), "uart": bytearray(), "uart_t": 0.0}
i2c_reply = queue.Queue()


def iomux_pull(g):
    try:
        mux = lib.qemu_picsimlab_get_internals(3)
        v = mux[g]
        return (v >> 8) & 1, (v >> 7) & 1     # FUN_WPU, FUN_WPD
    except Exception:
        return 0, 0


def on_write(slot, value):
    emit({"t": "pin", "g": slot - 1, "v": 1 if value else 0})


def on_dir(slot, d):
    if slot <= 0:
        return
    g = slot - 1
    pu, pd = iomux_pull(g)
    out = 1 if d else 0
    emit({"t": "dir", "g": g, "o": out, "pu": pu, "pd": pd})


I2C_NAMES = {0: "r", 1: "s", 2: "s", 3: "p", 4: "n", 5: "w", 6: "rd"}


def on_i2c(bus, addr, event):
    kind = I2C_NAMES.get(event & 0xFF, "?")
    if kind in ("r", "s"):
        ok = addr in state["i2c_addrs"]
        emit({"t": "i2c", "b": bus, "a": addr, "e": kind, "ok": ok})
        return 0 if ok else 1
    if kind == "w":
        emit({"t": "i2c", "b": bus, "a": addr, "e": "w", "d": event >> 8})
        return 0
    if kind == "rd":
        while not i2c_reply.empty():
            i2c_reply.get_nowait()
        emit({"t": "i2c", "b": bus, "a": addr, "e": "rd"})
        try:
            return i2c_reply.get(timeout=1.0) & 0xFF
        except queue.Empty:
            return 0xFF
    if kind == "p":
        emit({"t": "i2c", "b": bus, "a": addr, "e": "p"})
    return 0


def on_spi(bus, event):
    return 0xFF


_uart_lock = threading.Lock()


def on_uart(uid, value):
    if uid != 0:
        return
    with _uart_lock:
        state["uart"].append(value)
        full = value == 10 or len(state["uart"]) > 64
    if full:
        flush_uart()


def flush_uart():
    with _uart_lock:          # lo vacían dos hilos (QEMU y el sondeo): sin cerrojo se perdían bytes
        data, state["uart"] = state["uart"], bytearray()
    if data:
        emit({"t": "uart", "d": data.decode("utf-8", "replace")})


def on_rmt(ch, conf, value):
    pass


cbs = Callbacks(WRITE_PIN(on_write), DIR_PIN(on_dir), I2C_EV(on_i2c), SPI_EV(on_spi), UART_TX(on_uart),
                ctypes.cast(PINMAP, ctypes.POINTER(ctypes.c_short)), RMT_EV(on_rmt))


def locked(fn, *a):
    lib.bql_lock_impl(b"esp32_runner", 0)
    try:
        fn(*a)
    finally:
        lib.bql_unlock()


commands = queue.Queue()
qemu_ready = threading.Event()      # antes de qemu_init no existe el cerrojo de QEMU: las órdenes esperan


def reader():
    """Lee órdenes del navegador. Las respuestas I2C van directas (QEMU está esperando con el cerrojo
    tomado); lo demás pasa por otro hilo que toma el cerrojo de QEMU."""
    for line in sys.stdin:
        try:
            m = json.loads(line)
        except ValueError:
            continue
        if m.get("c") == "i2cr":
            i2c_reply.put(int(m.get("v", 255)))
        elif m.get("c") == "i2c":
            state["i2c_addrs"] = set(int(a) for a in m.get("l", []))
        elif m.get("c") == "quit":
            os._exit(0)
        else:
            commands.put(m)
    os._exit(0)          # el servidor cerró la tubería: se acaba la simulación


def worker():
    qemu_ready.wait()
    while True:
        m = commands.get()
        c = m.get("c")
        try:
            if c == "pin":
                g = int(m["g"])
                if 0 <= g < NPINS:
                    locked(lib.qemu_picsimlab_set_pin, g + 1, 1 if m.get("v") else 0)
            elif c == "adc":
                ch = ADC_CH.get(int(m["g"]))
                if ch is not None:
                    raw = max(0, min(4095, int(float(m.get("v", 0)) / 3.3 * 4095)))
                    locked(lib.qemu_picsimlab_set_apin, ch, raw)
            elif c == "pause":
                locked(lib.qmp_stop, None)
            elif c == "resume":
                locked(lib.qmp_cont, None)
            elif c == "rx":
                data = str(m.get("d", "")).encode("utf-8")
                if data:
                    locked(lib.qemu_picsimlab_uart_receive, 0, data, len(data))
        except Exception as e:      # una orden mala no debe tirar la simulación
            print("esp32_runner:", e, file=sys.stderr)


def pwm_poll():
    """Los canales LEDC (analogWrite, ledcWrite, servo) no cambian el pin uno a uno:
    se lee su ciclo de trabajo y frecuencia y se envían cuando cambian."""
    last = None
    last_pull = None
    while True:
        time.sleep(0.05)
        flush_uart()
        try:     # pull-up / pull-down de las entradas (IO_MUX): sin él, INPUT_PULLUP leería 0 al aire
            mux = lib.qemu_picsimlab_get_internals(3)
            pull = []
            for g in range(NPINS):
                v = mux[g]
                if g in FLASH_PINS or not (v >> 9) & 1:        # sin entrada habilitada (FUN_IE) no importa
                    continue
                pu, pd = (v >> 8) & 1, (v >> 7) & 1
                if g in RTC_PADS and not pd:
                    pu = 1      # en los pads RTC el pull-up vive en RTC_IO, que este QEMU no expone
                if pu or pd:
                    pull.append([g, pu, pd])
            if pull != last_pull:
                last_pull = pull
                emit({"t": "pull", "l": pull})
        except Exception as e:
            print("esp32_runner pull:", e, file=sys.stderr)
        try:
            out_sel = lib.qemu_picsimlab_get_internals(2)
            duty = ctypes.cast(lib.qemu_picsimlab_get_internals(6), ctypes.POINTER(ctypes.c_float))
            conf = lib.qemu_picsimlab_get_internals(4)
            freq = lib.qemu_picsimlab_get_internals(5)
            lst = []
            first, count = CFG["ledc"]
            for g in range(NPINS):
                sig = out_sel[g] & 0x1FF
                if first <= sig < first + count:
                    ch = sig - first
                    timer = (conf[ch] & 0x3) + (4 if CHIP == "esp32" and ch >= 8 else 0)
                    lst.append([g, round(float(duty[ch]) / 100.0, 4) if duty[ch] > 1 else round(float(duty[ch]), 4), int(freq[timer])])
            if lst != last:
                last = lst
                emit({"t": "pwm", "l": lst})
        except Exception as e:
            print("esp32_runner pwm:", e, file=sys.stderr)


def efuse_file(path):
    if CHIP == "esp32c3":       # eFuse del C3 (1 KB): versión menor del chip y MAC, como PICSimLab
        if not os.path.exists(path):
            e = bytearray(1024)
            e[38] = 0x0C
            e[24:30] = bytes(reversed([0x34, 0x85, 0x18, 0x12, 0x34, 0x56]))
            e[48:64] = bytes(range(16))
            with open(path, "wb") as f:
                f.write(e)
        return path
    if not os.path.exists(path):
        e = bytearray(124)
        e[13] = 0x80
        e[22] = 0x10
        mac = [0x24, 0x0A, 0xC4, 0x12, 0x34, 0x56]
        crc = 0
        for b in mac:
            crc ^= b
            for _ in range(8):
                crc = ((crc >> 1) ^ 0x8C) & 0xFF if crc & 1 else (crc >> 1) & 0xFF
        e[4:10] = bytes(reversed(mac))
        e[10] = crc
        with open(path, "wb") as f:
            f.write(e)
    return path


def main():
    fw = os.path.join(LIB_DIR, "fw")
    efuse = efuse_file(os.path.splitext(FLASH)[0] + ".efuse")
    args = [CFG["qemu"], "-M", CFG["machine"], "-L", fw,
            "-drive", "file=%s,if=mtd,format=raw" % FLASH.replace("\\", "/"),
            "-drive", "file=%s,if=none,format=raw,id=efuse" % efuse.replace("\\", "/"),
            "-global", "driver=%s,property=drive,value=efuse" % CFG["efuse"],
            "-global", "driver=%s,property=wdt_disable,value=true" % CFG["timg"],
            "-serial", "null", "-display", "none", "-monitor", "none", "-nodefaults"]
    argv = (ctypes.c_char_p * (len(args) + 1))(*[a.encode() for a in args], None)
    lib.qemu_picsimlab_register_callbacks(ctypes.byref(cbs))
    threading.Thread(target=reader, daemon=True).start()
    threading.Thread(target=worker, daemon=True).start()
    lib.qemu_init(len(args), argv, None)
    qemu_ready.set()
    threading.Thread(target=pwm_poll, daemon=True).start()
    emit({"t": "ready"})
    lib.qemu_main_loop()
    emit({"t": "exit"})


if __name__ == "__main__":
    main()
