# -*- coding: utf-8 -*-
"""Simulador: compila sketches con arduino-cli (el compilador oficial, con librerías).
Uno/Nano/Mega (avr8js) y Raspberry Pi Pico (rp2040js) se ejecutan en el navegador; el ESP32 corre
en QEMU (fork de PICSimLab) en este mismo PC y se comunica con el navegador por eventos."""
import base64
import glob
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid

from flask import Blueprint, Response, abort, jsonify, request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
bp = Blueprint("simulador", __name__)
_lock = threading.Lock()

BOARDS = {
    "uno": "arduino:avr:uno",
    "nano": "arduino:avr:nano:cpu=atmega328",
    "mega": "arduino:avr:mega:cpu=atmega2560",
    "pico": "rp2040:rp2040:rpipico:freq=125",     # rp2040js emula el reloj de 125 MHz
    # El QEMU de PICSimLab arranca bien el núcleo 2.0.x (ESP-IDF 4.4); con el 3.x falla la caché.
    "esp32": "esp32:esp32:esp32:FlashMode=dio",
    "esp32c3": "esp32:esp32:esp32c3:FlashMode=dio",
}
CORES = {"pico": ("rp2040:rp2040", "https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json"),
         "esp32": ("esp32:esp32@2.0.17", "https://espressif.github.io/arduino-esp32/package_esp32_index.json")}
CORES["esp32c3"] = CORES["esp32"]
# en un PC recién instalado (versión de escritorio) tampoco está el núcleo AVR del Uno/Nano/Mega
CORES["uno"] = CORES["nano"] = CORES["mega"] = ("arduino:avr", "")
IMAGES = os.path.join(tempfile.gettempdir(), "simulador_esp32")


# #include → librería del gestor de Arduino. El índice oficial no publica qué cabeceras trae cada
# librería, así que las más usadas se resuelven con esta tabla y se instalan solas al compilar.
HEADER_LIBS = {
    "Servo.h": "Servo", "Stepper.h": "Stepper", "LiquidCrystal.h": "LiquidCrystal",
    "LiquidCrystal_I2C.h": "LiquidCrystal I2C", "DHT.h": "DHT sensor library", "DHT_U.h": "DHT sensor library",
    "Adafruit_Sensor.h": "Adafruit Unified Sensor", "Adafruit_NeoPixel.h": "Adafruit NeoPixel",
    "Adafruit_GFX.h": "Adafruit GFX Library", "Adafruit_SSD1306.h": "Adafruit SSD1306",
    "Adafruit_I2CDevice.h": "Adafruit BusIO", "Adafruit_SPIDevice.h": "Adafruit BusIO", "Adafruit_BusIO_Register.h": "Adafruit BusIO",
    "Adafruit_ILI9341.h": "Adafruit ILI9341", "Adafruit_BMP280.h": "Adafruit BMP280 Library",
    "Adafruit_MPU6050.h": "Adafruit MPU6050", "MPU6050.h": "MPU6050", "RTClib.h": "RTClib",
    "Keypad.h": "Keypad", "TM1637Display.h": "TM1637", "LedControl.h": "LedControl",
    "MD_MAX72xx.h": "MD_MAX72XX", "MD_Parola.h": "MD_Parola", "OneWire.h": "OneWire",
    "DallasTemperature.h": "DallasTemperature", "NewPing.h": "NewPing", "AccelStepper.h": "AccelStepper",
    "U8g2lib.h": "U8g2", "U8x8lib.h": "U8g2", "FastLED.h": "FastLED", "IRremote.h": "IRremote", "IRremote.hpp": "IRremote",
    "MFRC522.h": "MFRC522", "HX711.h": "HX711 Arduino Library", "ArduinoJson.h": "ArduinoJson",
    "Encoder.h": "Encoder", "Bounce2.h": "Bounce2", "SevSeg.h": "SevSeg", "TimerOne.h": "TimerOne",
    "RF24.h": "RF24", "SD.h": "SD", "ESP32Servo.h": "ESP32Servo", "IRremoteESP8266.h": "IRremoteESP8266", "Ultrasonic.h": "Ultrasonic",
}


def cli_path():
    env = os.environ.get("ARDUINO_CLI")
    if env and os.path.exists(env):
        return env
    for name in ("arduino-cli.exe", "arduino-cli"):
        p = os.path.join(BASE_DIR, "bin", name)
        if os.path.exists(p):
            return p
    return shutil.which("arduino-cli")


def run(args, timeout=300):
    exe = cli_path()
    if not exe:
        abort(503, description="No se encontró arduino-cli. Ponlo en la carpeta bin/ o define ARDUINO_CLI.")
    p = subprocess.run([exe] + args, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout,
                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)   # sin consola que parpadee
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def clean(text):
    return re.sub(r"\x1b\[[0-9;]*m", "", text)


@bp.get("/api/sim/status")
def status():
    exe = cli_path()
    if not exe:
        return jsonify(ok=False, error="arduino-cli no está instalado")
    code, out = run(["version"], 30)
    rc, cores = run(["core", "list", "--format", "json"], 60)
    try:
        data = json.loads(cores[cores.index("{"):]) if "{" in cores else {}
        installed = {p.get("id"): p.get("installed_version") for p in data.get("platforms") or []}
    except ValueError:
        installed = {}
    avr = "arduino:avr" in installed
    ready = {"uno": avr, "nano": avr, "mega": avr, "pico": "rp2040:rp2040" in installed,
             "esp32": str(installed.get("esp32:esp32", "")).startswith("2.")}
    ready["esp32c3"] = ready["esp32"]
    ext = ".dll" if os.name == "nt" else ".so"
    qemu = {"esp32": os.path.exists(os.path.join(esp32_lib_dir(), "libqemu-xtensa" + ext)),
            "esp32c3": os.path.exists(os.path.join(esp32_lib_dir(), "libqemu-riscv32" + ext))}
    return jsonify(ok=code == 0, version=clean(out).strip(), boards=list(BOARDS), ready=ready, qemu=qemu)


@bp.post("/api/sim/compile")
def compile_sketch():
    b = request.get_json(silent=True) or {}
    code = str(b.get("code") or "")
    board = BOARDS.get(b.get("board") or "uno")
    if not board:
        abort(400, description="Placa no soportada")
    if not code.strip():
        abort(400, description="El sketch está vacío")
    tmp = tempfile.mkdtemp(prefix="sim_")
    try:
        sk = os.path.join(tmp, "sketch")
        os.makedirs(sk)
        with open(os.path.join(sk, "sketch.ino"), "w", encoding="utf-8") as f:
            f.write(code)
        out_dir = os.path.join(tmp, "out")
        installed = []
        with _lock:     # el compilador comparte caché: una compilación cada vez
            for _ in range(20):     # el compilador avisa de una librería que falta cada vez
                rc, out = run(["compile", "--fqbn", board, "--output-dir", out_dir, sk], 600)
                out = clean(out).replace(sk + os.sep, "").replace(sk, "")
                missing = sorted(set(re.findall(r"fatal error: ([\w./-]+\.h(?:pp)?): No such file", out)))
                known = [HEADER_LIBS[h] for h in missing if h in HEADER_LIBS and HEADER_LIBS[h] not in installed]
                if rc == 0 or not known:
                    break
                for lib in known:       # falta una librería conocida: se instala (con sus dependencias) y se reintenta
                    irc, _ = run(["lib", "install", lib], 600)
                    installed.append(lib)
                    if irc != 0:
                        known = []
                if not known:
                    break
        note = "".join("Librería instalada automáticamente: %s\n" % l for l in installed)
        if rc != 0:
            return jsonify(ok=False, output=note + out, missing=missing, installed=installed)
        out = note + out
        kind = b.get("board") or "uno"
        if kind == "pico":
            with open(os.path.join(out_dir, "sketch.ino.bin"), "rb") as f:
                return jsonify(ok=True, kind="bin", board=kind, data=base64.b64encode(f.read()).decode(), output=out)
        if kind in ("esp32", "esp32c3"):
            return jsonify(ok=True, kind="esp32", board=kind, image=esp32_image(out_dir, kind), output=out)
        with open(os.path.join(out_dir, "sketch.ino.hex"), encoding="ascii") as f:
            return jsonify(ok=True, kind="hex", board=kind, data=f.read(), output=out)
    except subprocess.TimeoutExpired:
        return jsonify(ok=False, output="La compilación tardó demasiado (más de 10 minutos).")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def esp32_image(out_dir, chip="esp32"):
    """Imagen de flash de 4 MB: bootloader (0x1000 en el ESP32, 0x0 en el C3), particiones 0x8000,
    boot_app0 0xE000 y programa 0x10000."""
    img = bytearray(b"\xff" * (4 * 1024 * 1024))
    merged = os.path.join(out_dir, "sketch.ino.merged.bin")
    if os.path.exists(merged):
        with open(merged, "rb") as f:
            d = f.read()
        img[:len(d)] = d[:len(img)]
    else:
        roots = [os.environ.get("ARDUINO_DIRECTORIES_DATA", ""),
                 os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "Arduino15"),
                 os.path.join(os.path.expanduser("~"), ".arduino15")]
        boot_app0 = sorted(p for r in roots if r for p in glob.glob(os.path.join(
            r, "packages", "esp32", "hardware", "esp32", "*", "tools", "partitions", "boot_app0.bin")))
        parts = [(0x0 if chip == "esp32c3" else 0x1000, "sketch.ino.bootloader.bin"), (0x8000, "sketch.ino.partitions.bin"),
                 (0x10000, "sketch.ino.bin")]
        parts = [(off, os.path.join(out_dir, name)) for off, name in parts]
        if boot_app0:
            parts.append((0xE000, boot_app0[-1]))
        for off, path in parts:
            with open(path, "rb") as f:
                d = f.read()
            img[off:off + len(d)] = d
    os.makedirs(IMAGES, exist_ok=True)
    for old in glob.glob(os.path.join(IMAGES, "*")):       # las de más de un día sobran
        try:
            if time.time() - os.path.getmtime(old) > 86400:
                os.remove(old)
        except OSError:
            pass
    token = uuid.uuid4().hex + ("c3" if chip == "esp32c3" else "")
    with open(os.path.join(IMAGES, token + ".bin"), "wb") as f:
        f.write(img)
    return token


# ESP32: una sesión de QEMU por simulación

_sessions = {}
_sess_lock = threading.Lock()


class Esp32Session:
    """esp32_runner.py en un proceso aparte (QEMU no se puede reiniciar dentro del mismo proceso)."""

    def __init__(self, image, chip):
        self.id = uuid.uuid4().hex
        self.events = queue.Queue(maxsize=20000)
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        self.proc = subprocess.Popen([runner_python(), os.path.join(BASE_DIR, "esp32_runner.py"), image, esp32_lib_dir(), chip],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                     creationflags=flags, cwd=BASE_DIR)
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self):
        for line in self.proc.stdout:
            try:
                self.events.put_nowait(line.decode("utf-8", "replace").strip())
            except queue.Full:
                pass
        self.events.put('{"t":"end"}')

    def send(self, msgs):
        try:
            for m in msgs:
                self.proc.stdin.write((json.dumps(m) + "\n").encode("utf-8"))
            self.proc.stdin.flush()
        except (OSError, ValueError):
            pass

    def stop(self):
        try:
            self.proc.kill()
        except OSError:
            pass


def runner_python():
    """Intérprete para esp32_runner.py. En la versión de escritorio (PyInstaller) el QEMU del ESP32 se
    cae a los pocos segundos dentro del intérprete congelado (0xC0000409), así que se usa un Python
    normal: en Windows el «embeddable» que va en el paquete (python-runner/), en Linux el python3 del
    sistema (el .deb ya depende de él por el esptool del núcleo ESP32)."""
    if not getattr(sys, "frozen", False):
        return sys.executable
    emb = os.path.join(BASE_DIR, "python-runner", "python.exe")
    return emb if os.path.exists(emb) else (shutil.which("python3") or "python3")


def esp32_lib_dir():
    return os.environ.get("QEMU_ESP32_DIR") or os.path.join(BASE_DIR, "bin", "qemu-esp32")


@bp.post("/api/sim/esp32/start")
def esp32_start():
    b = request.get_json(silent=True) or {}
    token = re.sub(r"[^0-9a-fc]", "", str(b.get("image") or ""))
    chip = "esp32c3" if token.endswith("c3") else "esp32"
    image = os.path.join(IMAGES, token + ".bin")
    if not token or not os.path.exists(image):
        return jsonify(ok=False, error="La imagen compilada ya no existe: vuelve a pulsar Simular.")
    name = "libqemu-riscv32" if chip == "esp32c3" else "libqemu-xtensa"
    lib = os.path.join(esp32_lib_dir(), name + (".dll" if os.name == "nt" else ".so"))
    if not os.path.exists(lib):
        return jsonify(ok=False, error="Falta el emulador QEMU del ESP32 en bin/qemu-esp32.")
    with _sess_lock:        # el emulador pesa: una sesión de ESP32 a la vez
        for s in list(_sessions.values()):
            s.stop()
        _sessions.clear()
        s = Esp32Session(image, chip)
        _sessions[s.id] = s
    return jsonify(ok=True, session=s.id)


@bp.get("/api/sim/esp32/<sid>/events")
def esp32_events(sid):
    s = _sessions.get(sid)
    if not s:
        abort(404, description="Sesión no encontrada")

    def stream():
        while True:
            try:
                line = s.events.get(timeout=15)
            except queue.Empty:
                yield ": sigue vivo\n\n"
                if s.proc.poll() is not None:
                    break
                continue
            yield "data: " + line + "\n\n"
            if line == '{"t":"end"}':
                break

    return Response(stream(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@bp.post("/api/sim/esp32/<sid>/cmd")
def esp32_cmd(sid):
    s = _sessions.get(sid)
    if not s:
        abort(404, description="Sesión no encontrada")
    msgs = request.get_json(silent=True) or []
    if isinstance(msgs, dict):
        msgs = [msgs]
    s.send([m for m in msgs if isinstance(m, dict)][:500])
    return jsonify(ok=True)


@bp.post("/api/sim/esp32/<sid>/stop")
def esp32_stop(sid):
    with _sess_lock:
        s = _sessions.pop(sid, None)
    if s:
        s.stop()
    return jsonify(ok=True)


@bp.post("/api/sim/cores/install")
def core_install():
    """Instala el núcleo de una placa (Pico, ESP32) la primera vez que se usa."""
    b = request.get_json(silent=True) or {}
    core = CORES.get(b.get("board"))
    if not core:
        abort(400, description="Placa sin núcleo extra")
    extra = ["--additional-urls", core[1]] if core[1] else []
    with _lock:
        run(["core", "update-index"] + extra, 600)     # sin índice (primera vez) el núcleo no se encuentra
        rc, out = run(["core", "install", core[0]] + extra, 3600)
    return jsonify(ok=rc == 0, output=clean(out)[-3000:])


@bp.get("/api/sim/libs/search")
def lib_search():
    q = (request.args.get("q") or "").strip()
    header = (request.args.get("header") or "").strip()
    if len(q) < 2 and not header:
        return jsonify([])
    import json

    def search(term):
        rc, out = run(["lib", "search", term, "--format", "json", "--omit-releases-details"], 120)
        try:
            return (json.loads(out[out.index("{"):]) if "{" in out else {}).get("libraries") or []
        except ValueError:
            return []

    libs = []
    if header:      # primero la de la tabla y las que declaran esa cabecera, luego por nombre
        if header in HEADER_LIBS:
            libs += [l for l in search('name="%s"' % HEADER_LIBS[header]) if l.get("name") == HEADER_LIBS[header]]
        libs += search("provides:" + header)
        q = q or re.sub(r"\.h(pp)?$", "", header).replace("_", " ")
    names = {l.get("name") for l in libs}
    libs += [l for l in search(q) if l.get("name") not in names]
    res = []
    for lib in libs[:40]:
        rel = lib.get("latest") or {}
        res.append({"name": lib.get("name"), "version": rel.get("version"), "author": rel.get("author"),
                    "sentence": rel.get("sentence"), "headers": rel.get("provides_includes") or []})
    return jsonify(res)


@bp.post("/api/sim/libs/install")
def lib_install():
    b = request.get_json(silent=True) or {}
    name = str(b.get("name") or "").strip()
    if not name or len(name) > 120:
        abort(400, description="Nombre de librería no válido")
    with _lock:
        rc, out = run(["lib", "install", name], 600)
    return jsonify(ok=rc == 0, output=clean(out))


@bp.get("/api/sim/libs")
def lib_list():
    rc, out = run(["lib", "list", "--format", "json"], 120)
    import json
    try:
        data = json.loads(out[out.index("{"):]) if "{" in out else {}
    except ValueError:
        data = {}
    return jsonify([{"name": (x.get("library") or {}).get("name"), "version": (x.get("library") or {}).get("version")}
                    for x in data.get("installed_libraries") or []])
