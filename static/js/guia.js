/* Guía de puesta en marcha: lee el diagrama, detecta la placa y qué hay conectado a cada pin,
   y genera los pasos (sistema operativo o IDE, interfaces, librerías) y un programa de partida
   que usa los pines reales del diagrama. */
(function () {
  'use strict';

  const { esc } = window.App;
  const $ = (id) => document.getElementById(id);
  const diagramId = Number(new URLSearchParams(location.search).get('id')) || 0;

  // Lectura del diagrama

  const BOARD_RE = [
    [/^Arduino Uno R3/, 'uno'], [/^Arduino Nano/, 'nano'], [/^Arduino Mega/, 'mega'],
    [/^ESP32-C3/, 'esp32c3'], [/^ESP32/, 'esp32'], [/^Raspberry Pi Pico/, 'pico'],
    [/^Raspberry Pi (4|5|Zero)/, 'rpi'], [/^Orange Pi/, 'opi'], [/PLC/, 'plc'],
  ];
  const OPI_KEYS = [[/Zero 3W/, 'ZERO_3_W'], [/Zero 2W/, 'ZERO_2_W'], [/Zero 3\b/, 'ZERO_2'], [/ 3B/, '3B'], [/ 5 Pro/, '5PRO'],
    [/ 5 Plus/, '5PLUS'], [/ 5 Max/, '5MAX'], [/ 5 /, '5'], [/4 LTS/, '4_LTS'], [/PC|One/, 'H3']];

  function analyze(data) {
    const cells = (data.graph && data.graph.cells) || [];
    const els = cells.filter((c) => c.type !== 'standard.Link');
    const byId = new Map(els.map((c) => [c.id, c]));
    const par = new Map();
    const find = (k) => { while (par.has(k) && par.get(k) !== k) k = par.get(k); return k; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) par.set(a, b); };
    const node = (id, port) => id + '|' + port;
    cells.filter((c) => c.type === 'standard.Link').forEach((l) => {
      const s = l.source || {}, t = l.target || {};
      if (s.id && t.id && s.port != null && t.port != null) union(node(s.id, s.port), node(t.id, t.port));
    });
    // Bornes con el mismo nombre en una pieza están unidos (GND·1, GND·2… se tratan aparte)
    const termName = (el, port) => ((el.terminals || []).find((t) => t.id === port) || {}).name || port;

    let board = null, family = null;
    for (const el of els) {
      const name = el.componentName || '';
      const hit = BOARD_RE.find(([re]) => re.test(name));
      if (hit) { board = el; family = hit[1]; break; }
    }
    const comps = [];
    if (board) {
      const pinOf = new Map();       // red → borne de la placa
      (board.terminals || []).forEach((t) => pinOf.set(find(node(board.id, t.id)), t.name));
      els.forEach((el) => {
        if (el === board || el.type === 'elec.Junction' || !(el.terminals || []).length) return;
        const pins = {};
        el.terminals.forEach((t) => { const p = pinOf.get(find(node(el.id, t.id))); if (p) pins[t.name] = p; });
        if (Object.keys(pins).length) comps.push({ el, name: el.componentName || '', label: (el.attrs && el.attrs.title && el.attrs.title.text) || el.componentName, pins });
      });
    }
    // Lista de material
    const bom = new Map();
    els.forEach((el) => {
      if (el.type !== 'elec.Component') return;
      const n = el.componentName || 'Imagen';
      if (/^Imagen pegada$|^Datasheet/.test(n)) return;
      bom.set(n, (bom.get(n) || 0) + 1);
    });
    const mains = els.some((el) => /Toma de corriente|Acometida|Magnetotérmico|diferencial|RCBO|Contactor|Fuente 24 V|Fuente AMQR|UPS|230|110-230/.test(el.componentName || '')) ||
      /PLC/.test(board ? board.componentName : '') ||
      els.some((el) => /Raspberry PLC|PLC 19R/.test(el.componentName || ''));
    const plcHint = els.some((el) => /PLC/.test(el.componentName || ''));
    return { board, family, comps, bom, mains, plcHint, els };
  }

  /* Borne de la placa → pin para el programa, o null si es alimentación. */
  function pinFor(family, boardName, bornName) {
    const s = String(bornName).trim();
    if (/^(A?GND|5V|\+5V|3V3|3\.3V|VIN|VBUS|VSYS|IOREF|AREF|RESET|RST|EN\b)/.test(s)) return null;
    let m;
    switch (family) {
      case 'uno': case 'nano': case 'mega':
        if ((m = /^D(\d+)/.exec(s) || /\(D(\d+)\)/.exec(s))) return { code: m[1], label: 'D' + m[1] };
        if ((m = /^A(\d+)$/.exec(s))) return { code: 'A' + m[1], label: 'A' + m[1], analog: true };
        if (s === 'SDA' || s === 'SCL') return { code: s, label: s, i2c: true };
        return null;
      case 'esp32': case 'esp32c3':
        if ((m = /^GPIO(\d+)/.exec(s))) return { code: m[1], label: 'GPIO' + m[1] };
        return null;
      case 'pico':
        if ((m = /^GP(\d+)/.exec(s))) return { code: m[1], label: 'GP' + m[1], analog: +m[1] >= 26 };
        return null;
      case 'rpi':
        if ((m = /^GPIO(\d+).*pin (\d+)/.exec(s))) return { code: m[1], label: 'GPIO' + m[1] + ' (pin ' + m[2] + ')', phys: +m[2] };
        return null;
      case 'opi': {
        m = /^(.*) · pin (\d+)/.exec(s);
        if (!m || /^(3\.3V|5V|GND|NC)$/.test(m[1])) return null;
        const key = (OPI_KEYS.find(([re]) => re.test(boardName)) || [null, 'ZERO_2_W'])[1];
        const wpi = ((window.OPI_WPI || {})[key] || [])[+m[2]];
        return { code: wpi != null && wpi >= 0 ? String(wpi) : '?', label: m[1] + ' (pin ' + m[2] + ')', phys: +m[2], i2cBus: (/SDA\.(\d)/.exec(m[1]) || [])[1] };
      }
      default: return null;
    }
  }

  // Tipos de componente

  const KINDS = [
    ['led', /^LED (?!RGB)/], ['relay', /^Módulo relé|^Módulo de 2 relés/], ['buzzer', /^Buzzer/],
    ['button', /Pulsador|Interruptor|Final de carrera|Paro de emergencia/], ['pir', /PIR/],
    ['servo', /^Servo/], ['dht', /DHT22/], ['lcd', /^LCD .*I2C/], ['oled', /SSD1306/], ['sonar', /HC-SR04/],
    ['neo', /NeoPixel/], ['analog', /Potenciómetro|Sensor de luz|humedad del suelo|gas MQ|LM35|ACS712|Joystick|Fotorresistencia|Termistor/],
  ];
  const kindOf = (name) => (KINDS.find(([, re]) => re.test(name)) || ['other'])[0];
  const ident = (s, i) => (s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() || 'PIEZA') + (i ? '_' + i : '');

  function pick(c, re) { const k = Object.keys(c.pins).find((t) => re.test(t)); return k ? c.pins[k] : Object.values(c.pins)[0]; }

  /* Lista de "cosas a programar" con su pin ya traducido. */
  function items(an, family) {
    const used = {};
    return an.comps.map((c) => {
      const kind = kindOf(c.name);
      const base = { led: 'LED', relay: 'RELE', buzzer: 'ZUMBADOR', button: 'BOTON', pir: 'PIR', servo: 'SERVO', dht: 'DHT', lcd: 'LCD', oled: 'OLED',
        sonar: 'SONAR', neo: 'NEOPIXEL', analog: 'SENSOR', other: 'PIEZA' }[kind];
      used[base] = (used[base] || 0) + 1;
      const id = base + (used[base] > 1 ? used[base] : '');
      const P = (re) => { const b = pick(c, re); return b ? pinFor(family, an.board.componentName, b) : null; };
      const it = { kind, id, c };
      if (kind === 'led') it.pin = P(/^A/);
      else if (kind === 'relay') it.pin = P(/^IN/);
      else if (kind === 'buzzer') it.pin = P(/^\+/);
      else if (kind === 'button' || kind === 'pir') it.pin = P(/OUT|^1|^3|COM|NO/);
      else if (kind === 'servo') it.pin = P(/PWM/);
      else if (kind === 'dht') it.pin = P(/SDA|DATA|OUT/);
      else if (kind === 'sonar') { it.trig = P(/TRIG/); it.echo = P(/ECHO/); }
      else if (kind === 'neo') it.pin = P(/DIN/);
      else if (kind === 'analog') it.pin = P(/SIG|AO|OUT|VRX|W$/);
      else if (kind === 'lcd' || kind === 'oled') it.sda = P(/SDA/);
      else it.pins = Object.entries(c.pins).map(([t, b]) => [t, pinFor(family, an.board.componentName, b)]).filter(([, p]) => p);
      return it;
    }).filter((it) => it.pin || it.trig || it.sda || (it.pins && it.pins.length));
  }

  // Generadores de código

  function arduinoCode(list, family) {
    const inc = new Set(), glob = [], setup = ['  Serial.begin(115200);'], loop = [];
    const pinNum = (p) => (p ? p.code : '?');
    list.forEach((it) => {
      const n = it.id;
      switch (it.kind) {
        case 'led': case 'relay':
          glob.push('const int ' + n + ' = ' + pinNum(it.pin) + ';   // ' + esc0(it.c.label));
          setup.push('  pinMode(' + n + ', OUTPUT);');
          loop.push('  digitalWrite(' + n + ', HIGH); delay(500);', '  digitalWrite(' + n + ', LOW);  delay(500);');
          break;
        case 'buzzer':
          glob.push('const int ' + n + ' = ' + pinNum(it.pin) + ';');
          loop.push('  tone(' + n + ', 1000, 200);   // pitido de 1 kHz');
          break;
        case 'button': case 'pir':
          glob.push('const int ' + n + ' = ' + pinNum(it.pin) + ';   // ' + esc0(it.c.label));
          setup.push('  pinMode(' + n + (it.kind === 'button' ? ', INPUT_PULLUP);   // pulsado = LOW' : ', INPUT);'));
          loop.push('  Serial.print("' + n + ': "); Serial.println(digitalRead(' + n + '));');
          break;
        case 'analog':
          glob.push('const int ' + n + ' = ' + pinNum(it.pin) + ';   // ' + esc0(it.c.label));
          loop.push('  Serial.print("' + n + ': "); Serial.println(analogRead(' + n + '));');
          break;
        case 'servo':
          inc.add(family.startsWith('esp32') ? '#include <ESP32Servo.h>' : '#include <Servo.h>');
          glob.push('Servo ' + n.toLowerCase() + ';');
          setup.push('  ' + n.toLowerCase() + '.attach(' + pinNum(it.pin) + ');');
          loop.push('  ' + n.toLowerCase() + '.write(0); delay(800);', '  ' + n.toLowerCase() + '.write(180); delay(800);');
          break;
        case 'dht':
          inc.add('#include <DHT.h>');
          glob.push('DHT ' + n.toLowerCase() + '(' + pinNum(it.pin) + ', DHT22);');
          setup.push('  ' + n.toLowerCase() + '.begin();');
          loop.push('  Serial.print("Temp: "); Serial.print(' + n.toLowerCase() + '.readTemperature());',
            '  Serial.print(" C  Hum: "); Serial.println(' + n.toLowerCase() + '.readHumidity());');
          break;
        case 'lcd':
          inc.add('#include <Wire.h>'); inc.add('#include <LiquidCrystal_I2C.h>');
          glob.push('LiquidCrystal_I2C ' + n.toLowerCase() + '(0x27, 16, 2);   // si no se ve nada, prueba la dirección 0x3F');
          setup.push('  ' + n.toLowerCase() + '.init();', '  ' + n.toLowerCase() + '.backlight();', '  ' + n.toLowerCase() + '.print("Hola!");');
          break;
        case 'oled':
          inc.add('#include <Wire.h>'); inc.add('#include <Adafruit_GFX.h>'); inc.add('#include <Adafruit_SSD1306.h>');
          glob.push('Adafruit_SSD1306 ' + n.toLowerCase() + '(128, 64, &Wire, -1);');
          setup.push('  ' + n.toLowerCase() + '.begin(SSD1306_SWITCHCAPVCC, 0x3C);', '  ' + n.toLowerCase() + '.clearDisplay();',
            '  ' + n.toLowerCase() + '.setTextColor(SSD1306_WHITE);', '  ' + n.toLowerCase() + '.setCursor(0, 0);',
            '  ' + n.toLowerCase() + '.print("Hola!");', '  ' + n.toLowerCase() + '.display();');
          break;
        case 'sonar':
          glob.push('const int ' + n + '_TRIG = ' + pinNum(it.trig) + ', ' + n + '_ECHO = ' + pinNum(it.echo) + ';');
          setup.push('  pinMode(' + n + '_TRIG, OUTPUT);', '  pinMode(' + n + '_ECHO, INPUT);');
          loop.push('  digitalWrite(' + n + '_TRIG, LOW); delayMicroseconds(2);', '  digitalWrite(' + n + '_TRIG, HIGH); delayMicroseconds(10);',
            '  digitalWrite(' + n + '_TRIG, LOW);', '  Serial.print("Distancia (cm): "); Serial.println(pulseIn(' + n + '_ECHO, HIGH, 30000) / 58);');
          break;
        case 'neo':
          inc.add('#include <Adafruit_NeoPixel.h>');
          glob.push('Adafruit_NeoPixel ' + n.toLowerCase() + '(16, ' + pinNum(it.pin) + ', NEO_GRB + NEO_KHZ800);   // pon el número de LEDs');
          setup.push('  ' + n.toLowerCase() + '.begin();', '  ' + n.toLowerCase() + '.fill(' + n.toLowerCase() + '.Color(0, 40, 0));', '  ' + n.toLowerCase() + '.show();');
          break;
        default:
          glob.push('// ' + esc0(it.c.label) + ': ' + it.pins.map(([t, p]) => t + ' → ' + p.label).join(', ') + ' (usa su librería)');
      }
    });
    return [...inc, inc.size ? '' : null, ...glob, '', 'void setup() {', ...setup, '}', '', 'void loop() {', ...(loop.length ? loop : ['  // tu programa']), '  delay(200);', '}', '']
      .filter((l) => l !== null).join('\n');
  }

  function rpiCode(list) {
    const imp = new Set(['from time import sleep']), gz = new Set(), body = [], loop = [];
    list.forEach((it) => {
      const n = it.id.toLowerCase(), p = it.pin && it.pin.code;
      switch (it.kind) {
        case 'led': gz.add('LED'); body.push(n + ' = LED(' + p + ')   # ' + it.c.label); loop.push('    ' + n + '.toggle()'); break;
        case 'relay': gz.add('OutputDevice'); body.push(n + ' = OutputDevice(' + p + ', active_high=True)   # cambia a False si tu módulo es activo a nivel bajo');
          loop.push('    ' + n + '.toggle()'); break;
        case 'buzzer': gz.add('Buzzer'); body.push(n + ' = Buzzer(' + p + ')'); loop.push('    ' + n + '.beep(0.1, 0.1, n=1)'); break;
        case 'button': gz.add('Button'); body.push(n + ' = Button(' + p + ')   # pull-up interno: conecta el otro lado a GND');
          loop.push('    print("' + it.id + ':", "pulsado" if ' + n + '.is_pressed else "suelto")'); break;
        case 'pir': gz.add('MotionSensor'); body.push(n + ' = MotionSensor(' + p + ')'); loop.push('    print("' + it.id + ':", ' + n + '.motion_detected)'); break;
        case 'servo': gz.add('AngularServo'); body.push(n + ' = AngularServo(' + p + ', min_angle=0, max_angle=180)');
          loop.push('    ' + n + '.angle = 0 if ' + n + '.angle else 180'); break;
        case 'sonar': gz.add('DistanceSensor'); body.push(n + ' = DistanceSensor(echo=' + (it.echo && it.echo.code) + ', trigger=' + (it.trig && it.trig.code) + ')   # ECHO a 3,3 V con divisor');
          loop.push('    print("Distancia: %.1f cm" % (' + n + '.distance * 100))'); break;
        case 'dht': imp.add('import board'); imp.add('import adafruit_dht'); body.push(n + ' = adafruit_dht.DHT22(board.D' + p + ')');
          loop.push('    try:', '        print("Temp:", ' + n + '.temperature, "Hum:", ' + n + '.humidity)', '    except RuntimeError:', '        pass   # el DHT22 a veces falla una lectura'); break;
        case 'lcd': imp.add('from RPLCD.i2c import CharLCD'); body.push(n + ' = CharLCD("PCF8574", 0x27)   # dirección: compruébala con i2cdetect -y 1');
          body.push(n + '.write_string("Hola!")'); break;
        case 'analog': body.push('# ' + it.c.label + ': la Raspberry Pi no tiene entradas analógicas; usa un ADC como el ADS1115 por I2C.'); break;
        default: body.push('# ' + it.c.label + ': ' + (it.pins || []).map(([t, pp]) => t + ' → ' + pp.label).join(', '));
      }
    });
    if (gz.size) imp.add('from gpiozero import ' + [...gz].sort().join(', '));
    return [...imp].sort().reverse().join('\n') + '\n\n' + body.join('\n') + '\n\nwhile True:\n' + (loop.length ? loop.join('\n') : '    pass') + '\n    sleep(1)\n';
  }

  function opiCode(list) {
    const body = [], loop = [], imp = ['import time', 'import wiringpi'];
    list.forEach((it) => {
      const n = it.id, p = it.pin;
      if (it.kind === 'lcd' && it.sda) {        // pantalla I2C: RPLCD en el bus del conector (SDA.N → /dev/i2c-N)
        const bus = it.sda.i2cBus || '1';
        if (!imp.includes('from RPLCD.i2c import CharLCD')) imp.push('from RPLCD.i2c import CharLCD');
        body.push(n.toLowerCase() + ' = CharLCD("PCF8574", 0x27, port=' + bus + ')   # bus I2C ' + bus + ' (/dev/i2c-' + bus + '); dirección: i2cdetect -y ' + bus,
          n.toLowerCase() + '.write_string("Hola!")');
        return;
      }
      if (!p) { body.push('# ' + it.c.label + ': conéctalo a mano (ver tabla de pines)'); return; }
      const w = p.code, info = '   # ' + it.c.label + ' · ' + p.label;
      if (['led', 'relay', 'buzzer'].includes(it.kind)) { body.push(n + ' = ' + w + info, 'wiringpi.pinMode(' + n + ', 1)'); loop.push('    wiringpi.digitalWrite(' + n + ', 1 - wiringpi.digitalRead(' + n + '))'); }
      else if (['button', 'pir'].includes(it.kind)) {
        body.push(n + ' = ' + w + info, 'wiringpi.pinMode(' + n + ', 0)');
        if (it.kind === 'button') body.push('wiringpi.pullUpDnControl(' + n + ', 2)   # pull-up: el otro lado del pulsador a GND');
        loop.push('    print("' + n + ':", wiringpi.digitalRead(' + n + '))');
      } else if (it.kind === 'analog') body.push('# ' + it.c.label + ': la Orange Pi no tiene entradas analógicas en el conector; usa un ADC (ADS1115) por I2C.');
      else body.push('# ' + it.c.label + ' (' + it.kind + '): usa una librería de Python para Linux (I2C en /dev/i2c-N) o un microcontrolador.');
    });
    return imp.join('\n') + '\n\nwiringpi.wiringPiSetup()   # numeración wPi (columna "wPi" de gpio readall)\n\n' + body.join('\n') +
      '\n\nwhile True:\n' + (loop.length ? loop.join('\n') : '    pass') + '\n    time.sleep(1)\n';
  }

  function plcCode(an) {
    const relays = new Set(), inputs = new Set();
    an.els.forEach((el) => (el.terminals || []).forEach((t) => {
      const m = /^(R\d\.\d|Q\d\.\d|I\d\.\d+)/.exec(t.name || '');
      if (m) (m[1][0] === 'I' ? inputs : relays).add(m[1]);
    }));
    const outs = [...relays].slice(0, 8), ins = [...inputs].slice(0, 6);
    if (!outs.length) outs.push('R0.1', 'R0.2');
    if (!ins.length) ins.push('I0.0');
    return `import sys
from librpiplc import rpiplc

# Versión y modelo: los indica la etiqueta del PLC y la documentación de Industrial Shields
# (por ejemplo "RPIPLC_V6" y "RPIPLC_19R"). Ajústalos a tu equipo.
VERSION, MODELO = "RPIPLC_V6", "RPIPLC_19R"

SALIDAS = ${JSON.stringify(outs)}    # relés / salidas
ENTRADAS = ${JSON.stringify(ins)}    # entradas digitales

def main():
    rc = rpiplc.init(VERSION, MODELO, restart=True)
    if rc not in (0, 1):
        print("No se pudo iniciar librpiplc")
        return 1
    try:
        for s in SALIDAS:
            rpiplc.pin_mode(s, rpiplc.OUTPUT)
        for e in ENTRADAS:
            rpiplc.pin_mode(e, rpiplc.INPUT)
        while True:
            for s in SALIDAS:              # prueba: activa cada relé medio segundo
                rpiplc.digital_write(s, rpiplc.HIGH)
                rpiplc.delay(500)
                rpiplc.digital_write(s, rpiplc.LOW)
            for e in ENTRADAS:
                print(e, "=", rpiplc.digital_read(e))
    finally:
        rpiplc.deinit(restart=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
`;
  }

  const esc0 = (s) => String(s || '').replace(/[\r\n]+/g, ' ');

  // Pasos por placa

  const BOARD_INFO = {
    uno: { title: 'Arduino Uno', fqbn: 'Arduino AVR Boards › Arduino Uno', mcu: true },
    nano: { title: 'Arduino Nano', fqbn: 'Arduino AVR Boards › Arduino Nano (si no sube: Procesador › ATmega328P (Old Bootloader))', mcu: true },
    mega: { title: 'Arduino Mega 2560', fqbn: 'Arduino AVR Boards › Arduino Mega or Mega 2560', mcu: true },
    esp32: { title: 'ESP32 DevKit', fqbn: 'esp32 › ESP32 Dev Module', mcu: true, url: 'https://espressif.github.io/arduino-esp32/package_esp32_index.json', core: 'esp32 (de Espressif Systems)' },
    esp32c3: { title: 'ESP32-C3', fqbn: 'esp32 › ESP32C3 Dev Module', mcu: true, url: 'https://espressif.github.io/arduino-esp32/package_esp32_index.json', core: 'esp32 (de Espressif Systems)' },
    pico: { title: 'Raspberry Pi Pico', fqbn: 'Raspberry Pi Pico/RP2040 › Raspberry Pi Pico', mcu: true, url: 'https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json', core: 'Raspberry Pi Pico/RP2040 (de Earle F. Philhower)' },
    rpi: { title: 'Raspberry Pi' }, opi: { title: 'Orange Pi' }, plc: { title: 'Raspberry PLC (Industrial Shields)' },
  };

  function libsFor(list, family) {
    const L = new Set();
    list.forEach((it) => {
      if (it.kind === 'servo' && family.startsWith('esp32')) L.add('ESP32Servo');
      if (it.kind === 'dht') L.add('DHT sensor library (Adafruit) + Adafruit Unified Sensor');
      if (it.kind === 'lcd') L.add('LiquidCrystal I2C');
      if (it.kind === 'oled') L.add('Adafruit SSD1306 + Adafruit GFX Library');
      if (it.kind === 'neo') L.add('Adafruit NeoPixel');
    });
    return [...L];
  }

  function stepsMCU(fam, list, sketch) {
    const B = BOARD_INFO[fam], libs = libsFor(list, fam);
    const ol = (arr) => '<ol>' + arr.map((x) => '<li>' + x + '</li>').join('') + '</ol>';
    let h = sec('3', 'Instalar el programa para cargar el código', ol([
      'Descarga e instala <b>Arduino IDE 2</b> desde <code>arduino.cc/en/software</code> (Windows, macOS o Linux).',
      B.url ? 'En <b>Archivo › Preferencias › URLs adicionales del gestor de placas</b> añade:<pre class="code">' + B.url + '</pre>' : null,
      B.url ? 'En <b>Herramientas › Placa › Gestor de placas</b> busca e instala <b>' + B.core + '</b>.' +
        (fam.startsWith('esp32') ? ' El simulador usa la versión <b>2.0.17</b>; en la placa real puedes usar la última.' : '') : null,
      'Conecta la placa por USB. Si no aparece el puerto, instala el driver del chip USB de tu placa (<b>CH340</b> o <b>CP2102</b> en muchos clones y en los ESP32).' +
        (fam === 'pico' ? ' La Pico, la primera vez: mantén pulsado <b>BOOTSEL</b> al enchufarla y aparecerá como una memoria USB.' : ''),
      'En <b>Herramientas › Placa</b> elige <b>' + B.fqbn + '</b> y en <b>Herramientas › Puerto</b> el puerto de la placa (COM3, COM4… en Windows).',
    ].filter(Boolean)));
    h += sec('4', 'Librerías', libs.length
      ? '<p>En <b>Herramientas › Gestionar librerías</b> instala:</p><ul>' + libs.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>'
      : '<p>Tu circuito no necesita librerías extra.</p>');
    const code = sketch && sketch.code && sketch.code.trim() ? sketch.code : arduinoCode(list, fam);
    h += sec('5', 'Cargar el programa', '<p>' + (sketch && sketch.code && sketch.code.trim()
      ? 'Este es el programa que tienes guardado en el <b>simulador</b> para este diagrama (lo que probaste es lo que vas a cargar):'
      : 'Programa de partida con los pines de tu diagrama (enciende salidas, lee entradas y muestra todo en el monitor serie):') + '</p>' +
      codeBlock(code, 'sketch.ino') +
      (sketch && sketch.code && sketch.code.trim() ? '<details><summary>Ver un programa de prueba generado con los pines del diagrama</summary>' + codeBlock(arduinoCode(list, fam), 'prueba.ino') + '</details>' : '') +
      ol(['Pega el código en Arduino IDE (Archivo › Nuevo).', 'Pulsa <b>✓ Verificar</b> y después <b>→ Subir</b>.',
        'Abre <b>Herramientas › Monitor serie</b> a <b>115200</b> baudios para ver los mensajes' + (sketch && /Serial\.begin\((\d+)/.test(sketch.code || '') ? ' (tu programa usa ' + /Serial\.begin\((\d+)/.exec(sketch.code)[1] + ')' : '') + '.']));
    return h;
  }

  function stepsRPi(list) {
    const needI2C = list.some((it) => ['lcd', 'oled'].includes(it.kind)), needDHT = list.some((it) => it.kind === 'dht');
    const pip = ['gpiozero'].concat(needI2C ? ['RPLCD', 'smbus2'] : []).concat(needDHT ? ['adafruit-circuitpython-dht'] : []);
    return sec('3', 'Instalar el sistema operativo', ol0([
      'Descarga <b>Raspberry Pi Imager</b> desde <code>raspberrypi.com/software</code>.',
      'Mete la tarjeta microSD (16 GB o más) en el PC. En Imager elige tu modelo, <b>Raspberry Pi OS (64-bit)</b> y la tarjeta.',
      'En <b>Editar ajustes</b> pon usuario y contraseña, la red WiFi y activa <b>SSH</b>. Graba la tarjeta.',
      'Pon la tarjeta en la Raspberry, conéctala a su fuente oficial (5 V 3 A en la Pi 4, 5 V 5 A en la Pi 5) y espera un par de minutos.',
      'Conéctate por SSH desde el PC: <code>ssh tu_usuario@raspberrypi.local</code> (o con el ratón y una pantalla).',
      'Actualiza: <pre class="code">sudo apt update && sudo apt full-upgrade -y</pre>',
    ])) + sec('4', 'Activar interfaces y librerías', ol0([
      needI2C ? 'Activa el I2C: <code>sudo raspi-config</code> › Interface Options › I2C › Sí. Comprueba la pantalla con <code>i2cdetect -y 1</code>.' : 'Si usas I2C o SPI, actívalos en <code>sudo raspi-config</code> › Interface Options.',
      'Crea un entorno de Python e instala lo necesario:<pre class="code">python3 -m venv --system-site-packages ~/proyecto\nsource ~/proyecto/bin/activate\npip install ' + pip.join(' ') + '</pre>',
      '<b>Importante:</b> los GPIO de la Raspberry Pi son de <b>3,3 V</b>. No les metas 5 V (por ejemplo el ECHO del HC-SR04 necesita un divisor de tensión).',
    ])) + sec('5', 'Programa de control (Python)', codeBlock(rpiCode(list), 'control.py') + ol0([
      'Guárdalo en la Raspberry como <code>control.py</code> y ejecútalo: <code>python3 control.py</code> (para pararlo, Ctrl+C).',
      'Para que arranque solo al encender, crea un servicio de systemd (ver sección 8).',
    ]));
  }

  function stepsOPi(list, boardName) {
    return sec('3', 'Instalar el sistema operativo', ol0([
      'Descarga la imagen oficial de tu placa (<b>' + esc(boardName || 'Orange Pi') + '</b>) desde <code>orangepi.org</code> › Resources/Downloads: <b>Debian</b> u <b>Ubuntu</b> («Orange Pi OS»). También sirve <b>Armbian</b> si da soporte a tu modelo.',
      'Graba la imagen en la microSD con <b>balenaEtcher</b> o con Raspberry Pi Imager › «Usar personalizada».',
      'Arranca la placa con su fuente (5 V; mira el amperaje que pide tu modelo) y conéctala por cable de red o con pantalla y teclado.',
      'Entra por SSH: <code>ssh orangepi@IP_DE_LA_PLACA</code>. En las imágenes oficiales el usuario y la contraseña de fábrica son <b>orangepi</b> / <b>orangepi</b>: cámbiala con <code>passwd</code>.',
      'Actualiza: <pre class="code">sudo apt update && sudo apt upgrade -y</pre>',
    ])) + sec('4', 'Instalar wiringOP (control de los pines)', ol0([
      'Instala la librería oficial de Orange Pi y comprueba los pines:<pre class="code">sudo apt install -y git\ngit clone https://github.com/orangepi-xunlong/wiringOP.git -b next\ncd wiringOP\nsudo ./build clean\nsudo ./build\ngpio readall</pre>',
      '<code>gpio readall</code> muestra la tabla de tu placa con la columna <b>wPi</b>: es el número que usa el programa. Comprueba que coincide con el de esta guía.',
      'Para usarla desde Python:<pre class="code">sudo apt install -y swig python3-dev python3-setuptools\ngit clone --recursive https://github.com/orangepi-xunlong/wiringOP-Python.git\ncd wiringOP-Python\npython3 generate-bindings.py > bindings.i\nsudo python3 setup.py install</pre>',
      'Para I2C/SPI/UART del conector, actívalos en <code>sudo orangepi-config</code> › System › Hardware (en Armbian, <code>armbian-config</code>).',
      list.some((it) => it.kind === 'lcd') ? 'Para la pantalla LCD I2C:<pre class="code">sudo apt install -y i2c-tools python3-pip\nsudo pip3 install RPLCD smbus2 --break-system-packages</pre>' : null,
      '<b>Importante:</b> los pines son de <b>3,3 V</b>.',
    ])) + sec('5', 'Programa de control (Python)', codeBlock(opiCode(list), 'control.py') +
      ol0(['Ejecútalo con <code>sudo python3 control.py</code> (wiringOP necesita permisos para los pines).']));
  }

  function stepsPLC(an) {
    return sec('3', 'Preparar el sistema operativo del PLC', ol0([
      'El Raspberry PLC viene con <b>Raspberry Pi OS</b> preparado por Industrial Shields. Si necesitas reinstalarlo, usa la imagen y las instrucciones de <code>industrialshields.com</code> para tu modelo.',
      'Conéctate por SSH (cable de red) con el usuario y la IP que indica su manual, y actualiza:<pre class="code">sudo apt update && sudo apt upgrade -y</pre>',
    ])) + sec('4', 'Instalar la librería del PLC (librpiplc)', ol0([
      'Añade el repositorio de Industrial Shields e instala la librería en C y la de Python:<pre class="code">printf "\\n\\ndeb https://apps.industrialshields.com/main/DebRepo/ ./" | sudo tee -a /etc/apt/sources.list > /dev/null\nwget -O - https://apps.industrialshields.com/main/DebRepo/PublicKey.gpg | gpg --dearmor | sudo tee /etc/apt/trusted.gpg.d/IndustrialShieldsDebian.gpg > /dev/null\nsudo apt update\nsudo apt install librpiplc python3-librpiplc</pre>',
      'Comprueba en la etiqueta del PLC su <b>versión</b> (V3…V6) y <b>modelo</b> (p. ej. 19R) y ponlos en el programa. Usar la versión equivocada da errores de E/S.',
    ])) + sec('5', 'Programa de control (Python)', codeBlock(plcCode(an), 'plc.py') + ol0([
      'Ejecútalo con <code>python3 plc.py</code>. Los nombres <b>R0.1…</b> (relés), <b>Q0.x</b> (salidas) e <b>I0.x</b> (entradas) son los que lleva impresos el PLC.',
      'Para Node-RED existe el nodo <code>@industrial-shields/node-red-librpiplc</code>.',
    ]));
  }

  /* Revisión eléctrica a partir de las conexiones: niveles de 3,3 V frente a 5 V, LED sin resistencia… */
  const LOGIC_3V3 = ['esp32', 'esp32c3', 'pico', 'rpi', 'opi'];
  function checks(an, fam) {
    const out = [];
    if (!an.board || an.family !== fam) return out;
    const is5V = (b) => /^(5V|\+5V|VBUS|VIN)/.test(String(b));
    const isGnd = (b) => /^A?GND/.test(String(b));
    an.comps.forEach((c) => {
      const kind = kindOf(c.name), vals = Object.entries(c.pins);
      const pow5 = vals.some(([t, b]) => /^(VCC|V\+|\+5V|5V)$/i.test(t) && is5V(b));
      const sig = vals.filter(([, b]) => pinFor(fam, an.board.componentName, b));
      if (LOGIC_3V3.includes(fam) && pow5 && sig.length) {
        if (kind === 'lcd' || kind === 'oled') out.push('<b>' + esc(c.label) + '</b> está alimentada a 5 V: sus resistencias de pull-up ponen <b>5 V en SDA/SCL</b> y la placa trabaja a 3,3 V. Usa un <b>conversor de nivel I2C</b> (p. ej. con BSS138) o quita las pull-ups del módulo y añádelas a 3,3 V.');
        else if (kind === 'relay') out.push('<b>' + esc(c.label) + '</b> es de 5 V y su entrada IN la controla un pin de 3,3 V: muchos módulos conmutan igual, pero si no responde usa un <b>módulo de relé de 3,3 V</b> o un transistor. Si el módulo es activo a nivel bajo, apagado = salida en HIGH.');
        else if (kind === 'sonar') out.push('El <b>ECHO</b> de <b>' + esc(c.label) + '</b> da 5 V: ponle un <b>divisor de tensión</b> (1 kΩ y 2 kΩ) antes del pin de la placa.');
        else if (kind === 'pir') out.push('<b>' + esc(c.label) + '</b>: alimentado a 5 V, su salida OUT es de 3,3 V, así que se puede conectar directo.');
      }
      if (kind === 'led' && vals.length >= 2 && vals.some(([, b]) => isGnd(b)) && vals.some(([, b]) => pinFor(fam, an.board.componentName, b))) {
        out.push('<b>' + esc(c.label) + '</b> va del pin a GND <b>sin resistencia</b>: pon una de 220–330 Ω en serie o puedes dañar el LED y el pin.');
      }
      if (kind === 'buzzer' && /rpi|opi/.test(fam)) out.push('<b>' + esc(c.label) + '</b>: si es un zumbador <b>pasivo</b>, al encender el pin solo hace un clic; para que suene necesita una señal PWM (o usa uno activo).');
    });
    return out;
  }

  // Maquetación

  function sec(n, title, html) { return '<section class="g-sec"><h2><span class="g-n">' + n + '</span>' + title + '</h2>' + html + '</section>'; }
  function ol0(arr) { return '<ol>' + arr.filter(Boolean).map((x) => '<li>' + x + '</li>').join('') + '</ol>'; }
  function codeBlock(code, name) {
    return '<div class="g-code"><div class="g-code-h"><span>' + esc(name) + '</span><button class="btn btn-sm" data-copy>Copiar</button></div><pre>' + esc(code) + '</pre></div>';
  }

  function render(an, family, sketch, dname) {
    const B = BOARD_INFO[family];
    const fam = family;
    const list = an.board && an.family === fam ? items(an, fam) : [];
    let h = '<div class="g-intro"><h1>Del diagrama al montaje real</h1><p>' +
      (an.board ? 'Placa detectada en el diagrama: <b>' + esc(an.board.componentName) + '</b>.' : an.plcHint ? 'El diagrama usa un <b>Raspberry PLC</b> (a partir de fotos).' : 'No hay una placa de la biblioteca en el diagrama: elige arriba cuál vas a usar.') +
      ' Guía para <b>' + esc(B.title) + '</b>.</p></div>';

    if (an.mains) {
      h += '<div class="g-warn"><b>Este circuito tiene partes de 110/230 V.</b> Haz el cableado con todo desconectado, usa las protecciones del diagrama (magnetotérmico, diferencial), ' +
        'separa la parte de red de la de señal y, si no tienes formación eléctrica, que lo revise un electricista.</div>';
    }

    // 1. Material
    const bom = [...an.bom.entries()].sort((a, b) => b[1] - a[1]);
    h += sec('1', 'Material', bom.length ? '<table class="table"><thead><tr><th>Cant.</th><th>Pieza</th></tr></thead><tbody>' +
      bom.map(([n, q]) => '<tr><td>' + q + '</td><td>' + esc(n) + '</td></tr>').join('') + '</tbody></table><p class="help">Añade cables Dupont o de la sección adecuada y la fuente de alimentación' + (B.mcu ? ', y un cable USB de datos para cargar el programa.' : (fam === 'plc' ? ' de 12-24 V del PLC.' : ', una tarjeta microSD de 16 GB o más y, para configurarla, un cable de red o pantalla y teclado.')) + '</p>'
      : '<p class="help">El diagrama no tiene piezas de la biblioteca (solo fotos o dibujos). Revisa el material a mano.</p>');

    // 2. Conexiones
    if (an.board && an.family === fam && an.comps.length) {
      const rows = [];
      an.comps.forEach((c) => Object.entries(c.pins).forEach(([t, b]) => {
        const p = pinFor(fam, an.board.componentName, b);
        rows.push('<tr><td>' + esc(b) + (p && fam === 'opi' ? ' <small>(wPi ' + esc(p.code) + ')</small>' : '') + '</td><td>' + esc(c.label) + '</td><td>' + esc(t) + '</td></tr>');
      }));
      h += sec('2', 'Conexiones (sale de tu diagrama)', '<table class="table"><thead><tr><th>Pin de la placa</th><th>Pieza</th><th>Borne</th></tr></thead><tbody>' + rows.join('') +
        '</tbody></table><p class="help">Monta los cables con la placa desconectada y compruébalos uno a uno con esta tabla antes de dar corriente. Todas las masas (GND) deben estar unidas.</p>' +
        (() => { const w = checks(an, fam); return w.length ? '<div class="g-check"><b>Revisión eléctrica de tu diagrama</b><ul>' + w.map((x) => '<li>' + x + '</li>').join('') + '</ul></div>' : '<p class="g-ok">Revisión eléctrica: no se ven problemas de tensión ni LEDs sin resistencia.</p>'; })());
    } else {
      h += sec('2', 'Conexiones', '<p class="help">' + (an.board && an.family !== fam ? 'La placa del diagrama no coincide con la elegida, así que no se puede sacar la tabla de pines.' :
        'Las conexiones de este diagrama están hechas sobre fotos: usa la lista de <b>Conexiones</b> del editor para montarlas.') + '</p>');
    }

    if (B.mcu) h += stepsMCU(fam, list, sketch && sketch.board === fam ? sketch : null);
    else if (fam === 'rpi') h += stepsRPi(list);
    else if (fam === 'opi') h += stepsOPi(list, an.board && an.family === 'opi' ? an.board.componentName : '');
    else h += stepsPLC(an);

    h += sec('6', 'Probar paso a paso', ol0([
      'Antes de dar corriente: revisa la polaridad de la alimentación y que no haya cortos entre 5V/3,3V y GND (polímetro en continuidad).',
      'Prueba primero solo la placa (' + (B.mcu ? 'un LED o un mensaje por el monitor serie' : 'que arranque y puedas entrar por SSH') + '), y después ve añadiendo las piezas de una en una.',
      'Comprueba cada salida (LED, relé) y cada entrada (pulsador, sensor) con el programa de prueba antes de hacer el programa final.',
      B.mcu ? 'Puedes probar el mismo programa en el <b>simulador</b> de esta aplicación antes de cargarlo en la placa real.' : null,
    ]));
    h += sec('7', 'Si algo no funciona', '<ul>' + [
      B.mcu ? '<b>No aparece el puerto / no sube el programa:</b> otro cable USB (algunos solo cargan), el driver CH340/CP2102, otra placa o puerto en Herramientas.'
        : '<b>No arranca o no responde por SSH:</b> vuelve a grabar la microSD, usa una fuente con el amperaje que pide la placa y busca su IP en tu router.',
      !B.mcu && fam !== 'plc' ? '<b>gpio readall da error o los pines no cambian:</b> ejecuta el programa con <code>sudo</code> y comprueba que el número wPi/BCM es el de la tabla.' : null,
      '<b>La pantalla I2C no muestra nada:</b> ajusta el contraste (potenciómetro azul del módulo) y prueba la dirección 0x27 o 0x3F; comprueba SDA y SCL.',
      '<b>El relé no conmuta:</b> muchos módulos se activan con nivel BAJO; y los de 5 V pueden no responder bien a 3,3 V (ESP32, Raspberry).',
      '<b>Lecturas que bailan en un pulsador:</b> falta la resistencia de pull-up/pull-down (usa INPUT_PULLUP o Button() con pull-up).',
      '<b>Un sensor da valores raros:</b> revisa la alimentación (3,3 V o 5 V según el sensor) y que comparta GND con la placa.',
    ].filter(Boolean).map((x) => '<li>' + x + '</li>').join('') + '</ul>');
    if (!B.mcu) {
      h += sec('8', 'Arrancar el programa solo al encender', '<p>Crea el servicio <code>/etc/systemd/system/control.service</code>:</p>' + codeBlock(
        '[Unit]\nDescription=Control del tablero\nAfter=network.target\n\n[Service]\nExecStart=/usr/bin/python3 /home/' + (fam === 'opi' ? 'orangepi' : 'TU_USUARIO') + '/' + (fam === 'plc' ? 'plc.py' : 'control.py') +
        '\nRestart=always\nUser=root\n\n[Install]\nWantedBy=multi-user.target\n', 'control.service') +
        '<p>Y actívalo con <code>sudo systemctl enable --now control.service</code>. Mira su estado con <code>systemctl status control</code>.</p>');
    }
    h += '<p class="help g-foot">Guía generada a partir del diagrama «' + esc(dname) + '». El programa es un punto de partida para comprobar el montaje: adáptalo a lo que tenga que hacer tu sistema.</p>';
    $('guia').innerHTML = h;
  }

  // lo de la página de la guía; el simulador solo usa los generadores de código (window.Guia)
  if ($('guia')) {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const pre = b.closest('.g-code').querySelector('pre');
    navigator.clipboard.writeText(pre.textContent).then(() => { b.textContent = 'Copiado ✓'; setTimeout(() => { b.textContent = 'Copiar'; }, 1500); });
  });
  $('g-print').onclick = () => window.print();

  async function init() {
    if (!diagramId) { $('guia').innerHTML = '<p class="help">Abre la guía desde un diagrama (botón Guía del editor o del simulador).</p>'; return; }
    $('g-editor').href = '/editor?id=' + diagramId;
    $('g-sim').href = '/simulador?id=' + diagramId;
    const d = await window.App.api.getDiagram(diagramId);
    let sketch = null;
    try { sketch = await (await fetch('/api/diagrams/' + diagramId + '/sketch')).json(); } catch (_) { /* sin código */ }
    $('g-name').textContent = 'Guía · ' + d.name;
    document.title = 'Guía · ' + d.name;
    const an = analyze(d.data || {});
    const auto = an.family || (an.plcHint ? 'plc' : (sketch && sketch.board) || 'uno');
    const draw = () => {
      const v = $('g-board').value;
      render(an, v === 'auto' ? auto : v, sketch, d.name);
    };
    $('g-board').onchange = draw;
    draw();
  }
  init().catch((e) => { $('guia').innerHTML = '<p class="help">No se pudo abrir el diagrama: ' + esc(e.message) + '</p>'; });
  }

  window.Guia = { analyze, items, arduinoCode, rpiCode, opiCode, plcCode };
})();
