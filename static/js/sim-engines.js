/* Motores de emulación del simulador. Todos ofrecen la misma interfaz a sim.js:

     eng.family / eng.vcc / eng.label
     eng.now()                 tiempo simulado en microsegundos
     eng.after(us, fn)         programa fn dentro de `us` microsegundos de tiempo simulado
     eng.run(ms)               avanza la simulación lo que corresponde a `ms` de tiempo real
     eng.pinState(key)         0 bajo · 1 alto · 2 entrada · 3 entrada con pull-up · 4 con pull-down
     eng.pwm(key)              { duty, freq } si el pin lo mueve un PWM por hardware que no se ve flanco a flanco
     eng.setInput(key, bool)   nivel que ve el micro en una entrada
     eng.setAnalog(key, volts) tensión en un pin analógico
     eng.serialWrite(bytes)    datos hacia Serial.read()
     eng.stop()

   hooks (los pone sim.js): onPins(), onSerial(texto), onError(msg), onReady(),
     i2c: { start(), connect(addr, write) → bool, write(b) → bool, read() → byte, stop() }, spiByte(b) */
(function () {
  'use strict';

  // AVR: Uno, Nano, Mega (avr8js)

  function loadHex(src, target) {
    let hi = 0;
    for (const line of src.split(/\r?\n/)) {
      if (line[0] !== ':') continue;
      const n = parseInt(line.substr(1, 2), 16), addr = parseInt(line.substr(3, 4), 16), type = parseInt(line.substr(7, 2), 16);
      if (type === 0) for (let i = 0; i < n; i++) target[hi + addr + i] = parseInt(line.substr(9 + i * 2, 2), 16);
      else if (type === 2) hi = parseInt(line.substr(9, 4), 16) << 4;
      else if (type === 4) hi = parseInt(line.substr(9, 4), 16) << 16;
    }
  }

  /* ATmega2560: avr8js trae las direcciones de registro del 328P; la tabla de vectores y los
     periféricos de más (temporizadores 3-5, USART1-3, puertos A-L) salen de iomxx0_1.h. */
  function megaConfigs(A) {
    const V = (n) => n * 2;      // vector n → dirección de palabra
    const PORT = { A: 0x22, B: 0x25, C: 0x28, D: 0x2b, E: 0x2e, F: 0x31, G: 0x34, H: 0x102, J: 0x105, K: 0x108, L: 0x10b };
    const t16 = (base, tifr, timsk, vec, ports) => Object.assign({}, A.timer1Config, {
      TCCRA: base, TCCRB: base + 1, TCCRC: base + 2, TCNT: base + 4, ICR: base + 6, OCRA: base + 8, OCRB: base + 10, OCRC: base + 12,
      TIFR: tifr, TIMSK: timsk, captureInterrupt: V(vec), compAInterrupt: V(vec + 1), compBInterrupt: V(vec + 2), compCInterrupt: V(vec + 3), ovfInterrupt: V(vec + 4),
      OCFC: 8, OCIEC: 8, compPortA: PORT[ports[0][0]], compPinA: ports[0][1], compPortB: PORT[ports[1][0]], compPinB: ports[1][1],
      compPortC: PORT[ports[2][0]], compPinC: ports[2][1], externalClockPort: 0, externalClockPin: 0,
    });
    const timers = [
      Object.assign({}, A.timer0Config, { compAInterrupt: V(21), compBInterrupt: V(22), ovfInterrupt: V(23), compPortA: PORT.B, compPinA: 7, compPortB: PORT.G, compPinB: 5, externalClockPort: 0 }),
      Object.assign({}, A.timer1Config, { captureInterrupt: V(16), compAInterrupt: V(17), compBInterrupt: V(18), compCInterrupt: V(19), ovfInterrupt: V(20),
        OCRC: 0x8c, OCFC: 8, OCIEC: 8, compPortA: PORT.B, compPinA: 5, compPortB: PORT.B, compPinB: 6, compPortC: PORT.B, compPinC: 7, externalClockPort: 0 }),
      Object.assign({}, A.timer2Config, { compAInterrupt: V(13), compBInterrupt: V(14), ovfInterrupt: V(15), compPortA: PORT.B, compPinA: 4, compPortB: PORT.H, compPinB: 6 }),
      t16(0x90, 0x38, 0x71, 31, [['E', 3], ['E', 4], ['E', 5]]),
      t16(0xa0, 0x39, 0x72, 41, [['H', 3], ['H', 4], ['H', 5]]),
      t16(0x120, 0x3a, 0x73, 46, [['L', 3], ['L', 4], ['L', 5]]),
    ];
    const usart = (base, vec) => ({ rxCompleteInterrupt: V(vec), dataRegisterEmptyInterrupt: V(vec + 1), txCompleteInterrupt: V(vec + 2),
      UCSRA: base, UCSRB: base + 1, UCSRC: base + 2, UBRRL: base + 4, UBRRH: base + 5, UDR: base + 6 });
    const usarts = [usart(0xc0, 25), usart(0xc8, 36), usart(0xd0, 51), usart(0x130, 54)];
    const INT = (i) => ({ EICR: i < 4 ? 0x69 : 0x6a, EIMSK: 0x3d, EIFR: 0x3c, index: i, iscOffset: (i % 4) * 2, interrupt: V(i + 1) });
    const PC = (pcie, pcmsk, vec, mask, offset) => ({ PCIE: pcie, PCICR: 0x68, PCIFR: 0x3b, PCMSK: pcmsk, pinChangeInterrupt: V(vec), mask, offset });
    const port = (L, extra) => Object.assign({ PIN: PORT[L] - 2, DDR: PORT[L] - 1, PORT: PORT[L], externalInterrupts: [] }, extra || {});
    const ports = {
      A: port('A'), B: port('B', { pinChange: PC(0, 0x6b, 9, 0xff, 0) }), C: port('C'),
      D: port('D', { externalInterrupts: [INT(0), INT(1), INT(2), INT(3)] }),
      E: port('E', { externalInterrupts: [null, null, null, null, INT(4), INT(5), INT(6), INT(7)], pinChange: PC(1, 0x6c, 10, 0x01, 0) }),
      F: port('F'), G: port('G'), H: port('H'), J: port('J', { pinChange: PC(1, 0x6c, 10, 0x7f, 1) }),
      K: port('K', { pinChange: PC(2, 0x6d, 11, 0xff, 0) }), L: port('L'),
    };
    const muxChannels = {};
    for (let i = 0; i < 8; i++) { muxChannels[i] = { type: 0, channel: i }; muxChannels[32 + i] = { type: 0, channel: 8 + i }; }
    muxChannels[30] = { type: 2, voltage: 1.1 }; muxChannels[31] = { type: 2, voltage: 0 };
    return {
      timers, usarts, ports,
      adc: Object.assign({}, A.adcConfig, { adcInterrupt: V(29), numChannels: 16, muxInputMask: 0x3f, muxChannels }),
      twi: Object.assign({}, A.twiConfig, { twiInterrupt: V(39) }),
      spi: Object.assign({}, A.spiConfig, { spiInterrupt: V(24) }),
      eeprom: Object.assign({}, A.eepromConfig, { eepromReadyInterrupt: V(30) }),
      // pin de Arduino → [puerto, bit] (variants/mega/pins_arduino.h)
      pins: 'E0 E1 E4 E5 G5 E3 H3 H4 H5 H6 B4 B5 B6 B7 J1 J0 H1 H0 D3 D2 D1 D0 A0 A1 A2 A3 A4 A5 A6 A7 C7 C6 C5 C4 C3 C2 C1 C0 D7 G2 G1 G0 L7 L6 L5 L4 L3 L2 L1 L0 B3 B2 B1 B0 F0 F1 F2 F3 F4 F5 F6 F7 K0 K1 K2 K3 K4 K5 K6 K7'
        .split(' ').map((s) => [s[0], +s[1]]),
    };
  }

  function avr(kind, hex, hooks) {
    const A = window.AVR8;
    const MHZ = 16e6, CPUS = 16;            // ciclos por µs
    const mega = kind === 'mega';
    let cpu, ports, adc, usart, pinMap, adcPins, extraUsarts = [];
    if (mega) {
      const C = megaConfigs(A);
      const prog = new Uint16Array(0x20000);
      loadHex(hex, new Uint8Array(prog.buffer));
      cpu = new A.CPU(prog, 0x2100);           // datos 0x0000-0x21FF
      C.timers.forEach((t) => new A.AVRTimer(cpu, t));
      ports = {};
      Object.keys(C.ports).forEach((L) => { ports[L] = new A.AVRIOPort(cpu, C.ports[L]); });
      adc = new A.AVRADC(cpu, C.adc);
      usart = new A.AVRUSART(cpu, C.usarts[0], MHZ);
      extraUsarts = C.usarts.slice(1).map((u) => new A.AVRUSART(cpu, u, MHZ));
      new A.AVREEPROM(cpu, new A.EEPROMMemoryBackend(4096), C.eeprom);
      var twi = new A.AVRTWI(cpu, C.twi, MHZ), spi = new A.AVRSPI(cpu, C.spi, MHZ);
      pinMap = (k) => (typeof k === 'number' && C.pins[k] ? C.pins[k] : null);
      adcPins = (k) => (typeof k === 'number' && k >= 54 && k <= 69 ? k - 54 : -1);
    } else {
      const prog = new Uint16Array(0x4000);
      loadHex(hex, new Uint8Array(prog.buffer));
      cpu = new A.CPU(prog);
      [A.timer0Config, A.timer1Config, A.timer2Config].forEach((t) => new A.AVRTimer(cpu, t));
      ports = { B: new A.AVRIOPort(cpu, A.portBConfig), C: new A.AVRIOPort(cpu, A.portCConfig), D: new A.AVRIOPort(cpu, A.portDConfig) };
      adc = new A.AVRADC(cpu, A.adcConfig);
      usart = new A.AVRUSART(cpu, A.usart0Config, MHZ);
      new A.AVREEPROM(cpu, new A.EEPROMMemoryBackend(1024));
      var twi = new A.AVRTWI(cpu, A.twiConfig, MHZ), spi = new A.AVRSPI(cpu, A.spiConfig, MHZ);
      pinMap = (k) => (typeof k !== 'number' ? null : k < 8 ? ['D', k] : k < 14 ? ['B', k - 8] : k < 20 ? ['C', k - 14] : null);
      adcPins = (k) => (typeof k === 'number' && k >= 14 && k <= 19 ? k - 14 : k === 'A6' ? 6 : k === 'A7' ? 7 : -1);
    }
    Object.values(ports).forEach((p) => p.addListener(() => hooks.onPins()));
    const dec = new TextDecoder();
    usart.onByteTransmit = (b) => hooks.onSerial(dec.decode(new Uint8Array([b]), { stream: true }));
    extraUsarts.forEach((u, i) => { u.onByteTransmit = () => { /* Serial1-3: sin monitor */ }; });
    const rxq = [];
    const feed = () => { if (rxq.length && !usart.rxBusy && usart.writeByte(rxq[0])) rxq.shift(); };
    usart.onRxComplete = feed;

    let dev = false;
    twi.eventHandler = {
      start() { twi.completeStart(); },
      stop() { hooks.i2c.stop(); twi.completeStop(); },
      connectToSlave(addr, write) { twi.completeConnect(hooks.i2c.connect(addr, write)); },
      writeByte(v) { twi.completeWrite(hooks.i2c.write(v)); },
      readByte() { twi.completeRead(hooks.i2c.read() & 0xff); },
    };
    spi.onTransfer = (b) => { hooks.spiByte(b); return 0xff; };

    const eng = {
      family: 'avr', kind, vcc: 5, label: mega ? 'Arduino Mega 2560' : 'Arduino ' + (kind === 'nano' ? 'Nano' : 'Uno'),
      i2cPins: mega ? [20, 21] : [18, 19], mosi: mega ? 51 : 11,
      now: () => cpu.cycles / CPUS,
      after: (us, fn) => cpu.addClockEvent(fn, Math.max(1, Math.round(us * CPUS))),
      run(ms) {
        const target = cpu.cycles + ms * 1000 * CPUS, t0 = performance.now(), step = A.avrInstruction;
        let k = 0;
        while (cpu.cycles < target) {
          step(cpu); cpu.tick();
          if (++k === 25000) { k = 0; if (performance.now() - t0 > 30) break; }
        }
        feed();
      },
      pinState(k) { const m = pinMap(k); return m ? ports[m[0]].pinState(m[1]) : 2; },
      pwm: () => null,
      setInput(k, h) { const m = pinMap(k); if (m) ports[m[0]].setPin(m[1], h); },
      setAnalog(k, v) { const ch = adcPins(k); if (ch >= 0) adc.channelValues[ch] = v; },
      serialWrite(bytes) { for (const b of bytes) rxq.push(b); feed(); },
      stop() { },
      cpu,
    };
    setTimeout(() => hooks.onReady && hooks.onReady(), 0);
    return eng;
  }

  // RP2040: Raspberry Pi Pico (rp2040js)

  function rp2040(bin, hooks) {
    const R = window.RP2040JS;
    const sim = new R.Simulator();
    const mcu = sim.rp2040, clock = sim.clock;
    mcu.logger = new R.ConsoleLogger(R.LogLevel.Error);
    mcu.loadBootrom(window.RP2040_BOOTROM);
    mcu.flash.set(bin.subarray(0, mcu.flash.length));
    mcu.core.PC = 0x10000000;
    // Una salida se lee a sí misma (digitalRead de un pin en OUTPUT), como en el chip real
    mcu.gpio.forEach((g) => g.addListener((state) => {
      if (state === 0 || state === 1) g.setInputValue(state === 1);
      hooks.onPins();
    }));
    const dec = new TextDecoder(), dec1 = new TextDecoder();
    // Serial = USB CDC (pila USB del Pico SDK); Serial1 = UART0 en GP0/GP1, también al monitor
    const cdc = new R.USBCDC(mcu.usbCtrl);
    cdc.onSerialData = (buf) => hooks.onSerial(dec.decode(buf, { stream: true }));
    mcu.uart[0].onByte = (b) => hooks.onSerial(dec1.decode(new Uint8Array([b]), { stream: true }));
    mcu.uart[1].onByte = () => { };
    [0, 1].forEach((i) => {
      const bus = mcu.i2c[i];
      bus.onStart = () => bus.completeStart();
      bus.onConnect = (addr, mode) => bus.completeConnect(hooks.i2c.connect(addr, mode === 0));
      bus.onWriteByte = (v) => bus.completeWrite(hooks.i2c.write(v));
      bus.onReadByte = () => bus.completeRead(hooks.i2c.read() & 0xff);
      bus.onStop = () => { hooks.i2c.stop(); bus.completeStop(); };
    });
    mcu.spi.forEach((s) => { s.onTransmit = (v) => { hooks.spiByte(v); s.completeTransmit(0xff); }; });
    const NS = 1e9 / 125e6;

    /* rp2040js mueve la PIO con su propio setTimeout, desacoplada del reloj de la CPU: aquí avanza
       desde el bucle, ciclo a ciclo y respetando el divisor de cada máquina (servo, NeoPixel…). */
    mcu.pio.forEach((pio) => {
      pio.run = () => { };
      pio.machines.forEach((m) => {
        m.acc = 0;
        const write = m.writeUint32.bind(m);
        m.writeUint32 = (offset, value) => {
          const before = m.shiftCtrl;
          write(offset, value);
          // cambiar FJOIN vacía las dos FIFO (pio_sm_clear_fifos), como en el chip
          if (offset === 8 && ((before ^ value) & 0xc0000000)) { m.txFIFO.reset(); m.rxFIFO.reset(); }
        };
      });
    });
    const pioActive = () => !mcu.pio[0].stopped || !mcu.pio[1].stopped;

    /* El programa servo.pio de arduino-pico cuenta a 125 MHz (3 ciclos por cuenta): ejecutarlo paso
       a paso hundiría la simulación. Se reconoce y se calcula: cada periodo toma el ancho del FIFO
       (pull noblock) y pone el pin alto los últimos (X+1)·3 ciclos, igual que el programa. */
    const SERVO_PIO = [[0x9080, 0xffff], [0xa027, 0xffff], [0x0020, 0xffe0], [0xa046, 0xffff], [0x00a0, 0xffe0], [0x1800, 0xffe0], [0xa042, 0xffff], [0x0080, 0xffe0]];
    function isServo(pio, m) {
      const b = m.wrapBottom;
      return m.wrapTop - b === 7 && SERVO_PIO.every(([v, mask], i) => (pio.instructions[b + i] & mask) === v);
    }
    function servoStep(pio, m, cycles) {
      const s = m.sv || (m.sv = { t: 0, len: 0, hiAt: Infinity, high: false });
      const pin = (h) => { if (h !== s.high) { s.high = h; m.setSideset(h ? 1 : 0, 1); pio.checkChangedPins(); } };
      s.t += cycles;
      while (s.t >= s.len) {
        s.t -= s.len;
        if (!m.txFIFO.empty) m.outputShiftReg = m.txFIFO.pull();
        const X = m.outputShiftReg >>> 0, P = m.inputShiftReg >>> 0;
        m.x = X;
        pin(false);
        if (!X || !P) { s.len = 1000; s.hiAt = Infinity; m.pc = m.wrapBottom + 2; continue; }     // detenido: x = 0
        m.pc = m.wrapBottom + 4;
        s.len = 4 + 3 * (P + 1);
        s.hiAt = 4 + 3 * Math.max(0, P - X);
      }
      if (s.t >= s.hiAt) pin(true);
    }

    /* Máquinas en marcha: se recalcula cada pocos miles de instrucciones (activar una es raro). */
    function activeMachines() {
      const list = [];
      for (const pio of mcu.pio) {
        if (pio.stopped) continue;
        for (const m of pio.machines) {
          if (!m.enabled) continue;
          if (m.servo === undefined || m.servoPc !== m.wrapBottom) { m.servo = isServo(pio, m); m.servoPc = m.wrapBottom; }
          list.push(m);
        }
      }
      return list;
    }
    function stepPIO(list, cycles) {
      for (const m of list) {
        if (!m.enabled) continue;
        if (m.servo) { servoStep(m.pio, m, cycles); continue; }
        const div = (m.clockDivInt || 65536) + m.clockDivFrac / 256;
        m.acc += cycles;
        if (m.acc < div) continue;
        while (m.acc >= div) { m.acc -= div; m.step(); }
        m.pio.checkChangedPins();
      }
    }
    const eng = {
      family: 'rp2040', kind: 'pico', vcc: 3.3, label: 'Raspberry Pi Pico', i2cPins: null, mosi: 19,
      now: () => clock.nanos / 1000,
      after: (us, fn) => clock.createAlarm(fn).schedule(Math.max(1, us * 1000)),
      run(ms) {
        const target = clock.nanos + ms * 1e6, core = mcu.core, t0 = performance.now();
        let k = 0;
        let act = pioActive() ? activeMachines() : null;
        while (clock.nanos < target) {
          if (core.waiting) {
            const n = clock.nanosToNextAlarm;
            let dt = Math.min(n > 0 && isFinite(n) ? n : target - clock.nanos, target - clock.nanos) || NS;
            if (act) dt = Math.min(dt, 2000 * NS);        // con la PIO activa se avanza a trozos
            clock.tick(dt);
            if (act) stepPIO(act, Math.round(dt / NS));
          } else {
            const c = core.executeInstruction();
            clock.tick(c * NS);
            if (act) stepPIO(act, c);
          }
          if (++k === 5000) {
            k = 0;
            act = pioActive() ? activeMachines() : null;
            if (act && !act.length) act = null;
            if (performance.now() - t0 > 30) break;
          }
        }
      },
      pinState(k) { const g = mcu.gpio[k]; if (!g) return 2; const v = g.value; return v === 5 ? 2 : v; },
      pwm: () => null,
      setInput(k, h) { const g = mcu.gpio[k]; if (g) g.setInputValue(h); },
      setAnalog(k, v) { if (k >= 26 && k <= 29) mcu.adc.channelValues[k - 26] = Math.round(Math.max(0, Math.min(3.3, v)) / 3.3 * 4095); },
      serialWrite(bytes) { for (const b of bytes) cdc.sendSerialByte(b); },
      stop() { sim.stop(); },
      mcu,
    };
    setTimeout(() => hooks.onReady && hooks.onReady(), 0);
    return eng;
  }

  // ESP32: QEMU en el servidor

  /* El firmware corre en QEMU (fork de PICSimLab) en el propio PC. El navegador recibe por
     Server-Sent Events los cambios de pines y el puerto serie, y devuelve entradas y lecturas I2C. */
  function esp32(session, hooks, chip) {
    const st = {}, pw = {};
    let queue = [], timer = null, closed = false;
    const t0 = performance.now();
    const send = (m) => {
      if (closed) return;
      queue.push(m);
      if (m.c === 'i2cr') flush();
      else if (!timer) timer = setTimeout(flush, 4);
    };
    function flush() {
      clearTimeout(timer); timer = null;
      if (!queue.length) return;
      const body = JSON.stringify(queue); queue = [];
      fetch('/api/sim/esp32/' + session + '/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => { });
    }
    const es = new EventSource('/api/sim/esp32/' + session + '/events');
    let ackAddrs = [];
    es.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch (_) { return; }
      if (m.t === 'pin') { const s = st[m.g] || (st[m.g] = { out: false, v: 0, pu: 0, pd: 0 }); s.v = m.v; if (s.out) hooks.onPins(); }
      else if (m.t === 'dir') { const s = st[m.g] || (st[m.g] = { v: 0 }); s.out = !!m.o; s.pu = m.pu; s.pd = m.pd; hooks.onPins(); }
      else if (m.t === 'uart') hooks.onSerial(m.d);
      else if (m.t === 'pull') {
        Object.values(st).forEach((x) => { x.pu = 0; x.pd = 0; });
        m.l.forEach(([g, pu, pd]) => { const x = st[g] || (st[g] = { out: false, v: 0 }); x.pu = pu; x.pd = pd; });
        hooks.onPins();
      }
      else if (m.t === 'pwm') {
        Object.keys(pw).forEach((k) => delete pw[k]);
        m.l.forEach(([g, duty, freq]) => { pw[g] = { duty, freq }; });
        hooks.onPins();
      } else if (m.t === 'i2c') {
        if (m.e === 's' || m.e === 'r') { hooks.i2c.connect(m.a, m.e === 's'); }
        else if (m.e === 'w') hooks.i2c.write(m.d);
        else if (m.e === 'rd') send({ c: 'i2cr', v: hooks.i2c.read() & 0xff });
        else if (m.e === 'p') hooks.i2c.stop();
      } else if (m.t === 'ready') hooks.onReady && hooks.onReady();
      else if (m.t === 'exit' || m.t === 'end') { hooks.onError && hooks.onError('El ESP32 se detuvo.'); es.close(); }
      else if (m.t === 'error') { hooks.onError && hooks.onError(m.msg); es.close(); }
    };
    es.onerror = () => { if (!closed) { hooks.onError && hooks.onError('Se perdió la conexión con el emulador del ESP32.'); es.close(); closed = true; } };
    return {
      family: 'esp32', kind: chip || 'esp32', vcc: 3.3, label: chip === 'esp32c3' ? 'ESP32-C3' : 'ESP32 DevKit', i2cPins: null,
      mosi: chip === 'esp32c3' ? 7 : 23, remote: true,
      now: () => (performance.now() - t0) * 1000,
      after: (us, fn) => setTimeout(fn, us / 1000),
      run() { },
      pinState(k) {
        const s = st[k];
        if (pw[k]) return pw[k].duty > 0 ? 1 : 0;
        if (!s) return 2;
        if (s.out) return s.v ? 1 : 0;
        return s.pu ? 3 : s.pd ? 4 : 2;
      },
      pwm: (k) => pw[k] || null,
      setInput(k, h) { send({ c: 'pin', g: k, v: h ? 1 : 0 }); },
      setAnalog(k, v) { send({ c: 'adc', g: k, v: Math.round(v * 1000) / 1000 }); },
      pause(on) { send({ c: on ? 'pause' : 'resume' }); },
      setI2cAddrs(list) { const s = JSON.stringify(list); if (s !== JSON.stringify(ackAddrs)) { ackAddrs = list; send({ c: 'i2c', l: list }); } },
      serialWrite(bytes) { send({ c: 'rx', d: new TextDecoder().decode(new Uint8Array(bytes)) }); },
      stop() {
        closed = true; es.close(); flush();
        fetch('/api/sim/esp32/' + session + '/stop', { method: 'POST', keepalive: true }).catch(() => { });
      },
    };
  }

  // Orange Pi / Raspberry Pi: Python (Pyodide)

  /* No se emula Linux ni el procesador: el programa de Python corre en un Web Worker (CPython
     compilado a WebAssembly) con wiringpi, OPi.GPIO, RPi.GPIO, gpiozero, smbus2 y RPLCD
     conectados a los pines físicos del conector y al bus I2C del circuito. */
  let spare = null;
  const newWorker = () => new Worker('/static/js/py-worker.js');
  function prewarmPython() { if (!spare) spare = newWorker(); }

  function python(prog, hooks) {
    const w = spare || newWorker();
    spare = null;
    const st = {}, pw = {};
    let t0 = performance.now(), pausedAt = 0, ended = false;
    const s = (p) => st[p] || (st[p] = { out: false, v: 0, pu: 0, pd: 0 });
    const reply = (id, v) => w.postMessage({ t: 'resp', id, v });
    function i2cTx(addr, data, n) {
      const bus = hooks.i2c;
      if (data.length || !n) {
        if (!bus.connect(addr, true)) { bus.stop(); return null; }
        for (const b of data) if (!bus.write(b)) { bus.stop(); return null; }
      }
      let out = [];
      if (n) {
        if (!bus.connect(addr, false)) { bus.stop(); return null; }
        for (let i = 0; i < n; i++) out.push(bus.read() & 0xff);
      }
      bus.stop();
      return out;
    }
    w.onmessage = (e) => {
      const m = e.data;
      if (ended) return;
      if (m.t === 'pin') { s(m.p).v = m.v; hooks.onPins(); }
      else if (m.t === 'dir') { const x = s(m.p); x.out = !!m.o; x.pu = m.pu; x.pd = m.pd; hooks.onPins(); }
      else if (m.t === 'pwm') { if (m.d < 0) delete pw[m.p]; else pw[m.p] = { duty: m.d, freq: m.f }; hooks.onPins(); }
      else if (m.t === 'out') hooks.onSerial(m.d);
      else if (m.t === 'i2c') reply(m.id, i2cTx(m.a, m.w, m.n));
      else if (m.t === 'sensor') reply(m.id, hooks.sensor ? hooks.sensor(m.k, m.p) : null);
      else if (m.t === 'sync') { hooks.onPins(); reply(m.id, 1); }      // las entradas nuevas ya van en camino
      else if (m.t === 'stdin') hooks.onStdin && hooks.onStdin();
      else if (m.t === 'loading') hooks.onStatus && hooks.onStatus('Cargando Python…');
      else if (m.t === 'ready') { t0 = performance.now(); hooks.onReady && hooks.onReady(); }
      else if (m.t === 'end') { ended = true; hooks.onExit && hooks.onExit(m.d); }
      else if (m.t === 'error') { ended = true; hooks.onError && hooks.onError(m.d); }
    };
    w.onerror = (e) => { if (!ended) { ended = true; hooks.onError && hooks.onError('Error en el trabajador de Python: ' + (e.message || '')); } };
    w.postMessage({ t: 'run', code: prog.code, cfg: prog.cfg });
    setTimeout(prewarmPython, 1500);        // el siguiente Simular arranca sin esperar a cargar Python
    return {
      family: 'python', kind: prog.board, vcc: 3.3, remote: true, speed: 'tiempo real (Python)',
      label: (prog.cfg.model || (prog.board === 'rpi' ? 'Raspberry Pi' : 'Orange Pi')) + ' · Python',
      i2cPins: prog.cfg.i2c || null, mosi: 19,
      now: () => ((pausedAt || performance.now()) - t0) * 1000,
      after: (us, fn) => setTimeout(fn, us / 1000),
      run() { },
      pinState(k) {
        const x = st[k];
        if (pw[k]) return pw[k].duty > 0 ? 1 : 0;
        if (!x) return 2;
        if (x.out) return x.v ? 1 : 0;
        return x.pu ? 3 : x.pd ? 4 : 2;
      },
      pwm: (k) => pw[k] || null,
      setInput(k, h) { w.postMessage({ t: 'in', p: k, v: h ? 1 : 0 }); },
      setAnalog() { },
      pause(on) {
        if (on && !pausedAt) pausedAt = performance.now();
        else if (!on && pausedAt) { t0 += performance.now() - pausedAt; pausedAt = 0; }
        w.postMessage({ t: 'pause', on });
      },
      serialWrite(bytes) { w.postMessage({ t: 'stdin', d: new TextDecoder().decode(new Uint8Array(bytes)) }); },
      stop() { ended = true; w.terminate(); },
    };
  }

  window.SimEngines = { avr, rp2040, esp32, python, prewarmPython };
})();
