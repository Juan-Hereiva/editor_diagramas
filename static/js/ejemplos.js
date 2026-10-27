/* Ejemplos listos para el simulador: cada uno dice qué piezas poner, cómo cablearlas y el programa.
   El editor los monta con sus propias funciones (cables de verdad, con el enrutador automático) y
   después abre el simulador. Tipos de cable: V24 alimentación (rojo), GND masa, SIG señal,
   AN analógica, COM bus (I2C/SPI). */
(function () {
  'use strict';

  const P = 'V24', G = 'GND', S = 'SIG', A = 'AN', C = 'COM';

  // LED con su resistencia hacia GND
  function ledR(h, mcu, pin, color, x, y, gnd) {
    const led = h.add('LED ' + color + ' 5 mm', x, y), r = h.add('Resistencia', x + 60, y + 100);
    h.wire(mcu, pin, led, 'A (+)', S); h.wire(led, 'K (−)', r, '1', G); h.wire(r, '2', mcu, gnd, G);
    return led;
  }

  const EJEMPLOS = [
    {
      id: 'semaforo', name: 'Semáforo', board: 'uno',
      desc: 'Tres LEDs con sus resistencias que cambian como un semáforo. Lo más básico: pinMode, digitalWrite y delay.',
      build(h) {
        const u = h.add('Arduino Uno R3', 300, 300);
        ledR(h, u, 'D12', 'rojo', 900, 60, 'GND·1');
        ledR(h, u, 'D11', 'amarillo', 1060, 60, 'GND·1');
        ledR(h, u, 'D10', 'verde', 1220, 60, 'GND·1');
      },
      code: `// Semáforo: verde, amarillo parpadeando y rojo.
const int ROJO = 12, AMARILLO = 11, VERDE = 10;

void setup() {
  Serial.begin(9600);
  pinMode(ROJO, OUTPUT);
  pinMode(AMARILLO, OUTPUT);
  pinMode(VERDE, OUTPUT);
}

void luz(int pin, int ms, const char *texto) {
  Serial.println(texto);
  digitalWrite(pin, HIGH);
  delay(ms);
  digitalWrite(pin, LOW);
}

void loop() {
  luz(VERDE, 3000, "Verde: puedes pasar");
  Serial.println("Amarillo: cuidado");
  for (int i = 0; i < 3; i++) {
    digitalWrite(AMARILLO, HIGH); delay(350);
    digitalWrite(AMARILLO, LOW);  delay(350);
  }
  luz(ROJO, 3000, "Rojo: alto");
}
`,
    },
    {
      id: 'boton', name: 'Pulsador que enciende un LED', board: 'uno',
      desc: 'Cada pulsación cambia el LED y se cuenta en el monitor serie. Entrada con INPUT_PULLUP y antirrebote.',
      build(h) {
        const u = h.add('Arduino Uno R3', 300, 300);
        ledR(h, u, 'D13', 'rojo', 950, 60, 'GND·1');
        const b = h.add('Pulsador 12 mm', 950, 360);
        h.wire(u, 'D2', b, '1.l', S); h.wire(b, '2.l', u, 'GND·2', G);
      },
      code: `// Pulsa el botón del plano: el LED cambia y se cuenta cada pulsación.
const int BOTON = 2, LED = 13;
bool encendido = false, anterior = HIGH;
int veces = 0;

void setup() {
  Serial.begin(9600);
  pinMode(BOTON, INPUT_PULLUP);   // sin pulsar lee HIGH; pulsado, LOW
  pinMode(LED, OUTPUT);
  Serial.println("Pulsa el botón");
}

void loop() {
  bool ahora = digitalRead(BOTON);
  if (anterior == HIGH && ahora == LOW) {     // flanco de bajada = pulsación
    encendido = !encendido;
    digitalWrite(LED, encendido);
    Serial.print("Pulsaciones: ");
    Serial.println(++veces);
    delay(30);                                // antirrebote
  }
  anterior = ahora;
}
`,
    },
    {
      id: 'servo', name: 'Servo con potenciómetro', board: 'uno',
      desc: 'Gira el potenciómetro y el servo le sigue. analogRead, map y la librería Servo.',
      build(h) {
        const u = h.add('Arduino Uno R3', 300, 300);
        const pot = h.add('Potenciómetro 10 kΩ', 120, 760);
        h.wire(pot, 'VCC', u, '5V', P); h.wire(pot, 'GND', u, 'GND·2', G); h.wire(pot, 'SIG', u, 'A0', A);
        const sv = h.add('Servo SG90', 1000, 200);
        h.wire(sv, 'PWM', u, 'D9', S); h.wire(sv, 'V+', u, '5V', P); h.wire(sv, 'GND', u, 'GND·3', G);
      },
      code: `// Mueve el potenciómetro (clic en él o en el panel de la derecha).
#include <Servo.h>

Servo servo;

void setup() {
  Serial.begin(9600);
  servo.attach(9);
}

void loop() {
  int valor = analogRead(A0);              // 0 a 1023
  int angulo = map(valor, 0, 1023, 0, 180);
  servo.write(angulo);
  Serial.print("Potenciómetro: "); Serial.print(valor);
  Serial.print("  ángulo: "); Serial.println(angulo);
  delay(100);
}
`,
    },
    {
      id: 'termometro', name: 'Termómetro con DHT22 y LCD', board: 'uno',
      desc: 'Lee temperatura y humedad del DHT22 y las muestra en una pantalla LCD 16×2 I2C.',
      build(h) {
        const u = h.add('Arduino Uno R3', 300, 300);
        const d = h.add('Sensor DHT22 (temp./humedad)', 1000, 60);
        h.wire(d, 'VCC', u, '5V', P); h.wire(d, 'GND', u, 'GND·2', G); h.wire(d, 'SDA', u, 'D2', S);
        const l = h.add('LCD 16×2 I2C', 560, 780);
        h.wire(l, 'VCC', u, '5V', P); h.wire(l, 'GND', u, 'GND·3', G); h.wire(l, 'SDA', u, 'A4', C); h.wire(l, 'SCL', u, 'A5', C);
      },
      code: `// Cambia la temperatura y la humedad del DHT22 con sus deslizadores.
#include <DHT.h>
#include <LiquidCrystal_I2C.h>

DHT dht(2, DHT22);
LiquidCrystal_I2C lcd(0x27, 16, 2);

void setup() {
  Serial.begin(9600);
  dht.begin();
  lcd.init();
  lcd.backlight();
  lcd.print("Termometro");
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) {
    Serial.println("Error leyendo el DHT22");
  } else {
    lcd.setCursor(0, 0); lcd.print("Temp: "); lcd.print(t, 1); lcd.print((char)223); lcd.print("C   ");
    lcd.setCursor(0, 1); lcd.print("Hum:  "); lcd.print(h, 0); lcd.print(" %    ");
    Serial.print(t); Serial.print(" C  "); Serial.print(h); Serial.println(" %");
  }
  delay(2000);
}
`,
    },
    {
      id: 'distancia', name: 'Sensor de aparcamiento', board: 'uno',
      desc: 'El HC-SR04 mide la distancia y el zumbador pita más rápido cuanto más cerca está el obstáculo.',
      build(h) {
        const u = h.add('Arduino Uno R3', 300, 300);
        const s = h.add('Sensor ultrasónico HC-SR04', 1000, 80);
        h.wire(s, 'VCC', u, '5V', P); h.wire(s, 'GND', u, 'GND·2', G); h.wire(s, 'TRIG', u, 'D9', S); h.wire(s, 'ECHO', u, 'D10', S);
        const z = h.add('Buzzer', 1050, 420);
        h.wire(z, '+', u, 'D8', S); h.wire(z, '−', u, 'GND·3', G);
      },
      code: `// Mueve la distancia del HC-SR04: más cerca, pitidos más seguidos.
const int TRIG = 9, ECHO = 10, ZUMBADOR = 8;

void setup() {
  Serial.begin(9600);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
}

long medirCm() {
  digitalWrite(TRIG, LOW);  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long us = pulseIn(ECHO, HIGH, 30000);
  return us / 58;
}

void loop() {
  long cm = medirCm();
  Serial.print("Distancia: "); Serial.print(cm); Serial.println(" cm");
  if (cm > 0 && cm < 100) {
    tone(ZUMBADOR, 1000, 80);
    delay(map(cm, 2, 100, 80, 800));
  } else {
    delay(300);
  }
}
`,
    },
    {
      id: 'neopixel', name: 'Anillo NeoPixel arcoíris', board: 'uno',
      desc: 'Un arcoíris que gira en un anillo de 16 LEDs WS2812. El potenciómetro ajusta el brillo.',
      build(h) {
        const u = h.add('Arduino Uno R3', 300, 300);
        const n = h.add('Anillo NeoPixel WS2812 (16 LED)', 1000, 120);
        h.wire(n, 'VCC', u, '5V', P); h.wire(n, 'GND', u, 'GND·2', G); h.wire(n, 'DIN', u, 'D6', S);
        const pot = h.add('Potenciómetro 10 kΩ', 120, 760);
        h.wire(pot, 'VCC', u, '5V', P); h.wire(pot, 'GND', u, 'GND·3', G); h.wire(pot, 'SIG', u, 'A0', A);
      },
      code: `// Arcoíris en el anillo; el potenciómetro cambia el brillo.
#include <Adafruit_NeoPixel.h>

Adafruit_NeoPixel anillo(16, 6, NEO_GRB + NEO_KHZ800);
uint16_t tono = 0;

void setup() {
  anillo.begin();
}

void loop() {
  anillo.setBrightness(map(analogRead(A0), 0, 1023, 5, 255));
  for (int i = 0; i < 16; i++) {
    anillo.setPixelColor(i, anillo.gamma32(anillo.ColorHSV(tono + i * 65536L / 16)));
  }
  anillo.show();
  tono += 512;
  delay(20);
}
`,
    },
    {
      id: 'reloj', name: 'Reloj con RTC y OLED', board: 'uno',
      desc: 'El DS3231 da la hora (la de tu PC) y una pantalla OLED SSD1306 la muestra en grande.',
      build(h) {
        const u = h.add('Arduino Uno R3', 300, 300);
        const r = h.add('Reloj RTC DS3231', 380, 780);
        h.wire(r, 'VCC', u, '5V', P); h.wire(r, 'GND', u, 'GND·2', G); h.wire(r, 'SDA', u, 'A4', C); h.wire(r, 'SCL', u, 'A5', C);
        const o = h.add('Pantalla OLED SSD1306 I2C', 780, 780);
        h.wire(o, 'VCC', u, '5V', P); h.wire(o, 'GND', u, 'GND·3', G); h.wire(o, 'SDA', u, 'A4', C); h.wire(o, 'SCL', u, 'A5', C);
      },
      code: `// Reloj: el RTC DS3231 (dirección 0x68) y la OLED (0x3C) comparten el bus I2C.
#include <Wire.h>
#include <RTClib.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

RTC_DS3231 rtc;
Adafruit_SSD1306 oled(128, 64, &Wire, -1);

void setup() {
  Serial.begin(9600);
  if (!rtc.begin()) Serial.println("No encuentro el RTC");
  if (!oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) Serial.println("No encuentro la OLED");
  oled.setTextColor(SSD1306_WHITE);
}

void loop() {
  DateTime t = rtc.now();
  char hora[9], fecha[11];
  sprintf(hora, "%02d:%02d:%02d", t.hour(), t.minute(), t.second());
  sprintf(fecha, "%02d/%02d/%04d", t.day(), t.month(), t.year());
  oled.clearDisplay();
  oled.setTextSize(2); oled.setCursor(16, 16); oled.print(hora);
  oled.setTextSize(1); oled.setCursor(34, 44); oled.print(fecha);
  oled.display();
  Serial.println(hora);
  delay(1000);
}
`,
    },
    {
      id: 'contador', name: 'Contador con 7 segmentos', board: 'uno',
      desc: 'Un 74HC595 maneja un display de 7 segmentos; el pulsador suma uno. Registro de desplazamiento con shiftOut.',
      build(h) {
        const u = h.add('Arduino Uno R3', 300, 300);
        const sr = h.add('Registro de desplazamiento 74HC595', 950, 120);
        h.wire(sr, 'VCC', u, '5V', P); h.wire(sr, 'MR', u, '5V', P); h.wire(sr, 'GND', u, 'GND·2', G); h.wire(sr, 'OE', u, 'GND·2', G);
        h.wire(sr, 'DS', u, 'D11', S); h.wire(sr, 'SH_CP', u, 'D12', S); h.wire(sr, 'ST_CP', u, 'D8', S);
        const d = h.add('Display 7 segmentos (cátodo común)', 1300, 100);
        ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach((seg, i) => h.wire(sr, 'Q' + i, d, seg, S));
        h.wire(d, 'COM', u, 'GND·1', G);
        const b = h.add('Pulsador 12 mm', 1000, 420);
        h.wire(u, 'D2', b, '1.l', S); h.wire(b, '2.l', u, 'GND·3', G);
      },
      code: `// Cada pulsación suma 1 (de 0 a 9) en el display.
const int DATOS = 11, RELOJ = 12, CERROJO = 8, BOTON = 2;
// segmentos a-g en los bits 0-6 (Q0 = a … Q6 = g)
const byte DIGITOS[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};
int numero = 0;
bool anterior = HIGH;

void mostrar(int n) {
  digitalWrite(CERROJO, LOW);
  shiftOut(DATOS, RELOJ, MSBFIRST, DIGITOS[n]);
  digitalWrite(CERROJO, HIGH);
}

void setup() {
  pinMode(DATOS, OUTPUT); pinMode(RELOJ, OUTPUT); pinMode(CERROJO, OUTPUT);
  pinMode(BOTON, INPUT_PULLUP);
  Serial.begin(9600);
  mostrar(0);
}

void loop() {
  bool ahora = digitalRead(BOTON);
  if (anterior == HIGH && ahora == LOW) {
    numero = (numero + 1) % 10;
    mostrar(numero);
    Serial.println(numero);
    delay(30);
  }
  anterior = ahora;
}
`,
    },
    {
      id: 'teclado', name: 'Cerradura con teclado 4×4', board: 'uno',
      desc: 'Escribe la clave 1234 y # en el teclado: el relé se activa 3 segundos. Librería Keypad.',
      build(h) {
        const u = h.add('Arduino Uno R3', 300, 300);
        const k = h.add('Teclado matricial 4×4', 950, 40);
        ['R1', 'R2', 'R3', 'R4'].forEach((r, i) => h.wire(k, r, u, 'D' + (9 - i), S));
        ['C1', 'C2', 'C3', 'C4'].forEach((c, i) => h.wire(k, c, u, 'D' + (5 - i), S));
        const rl = h.add('Módulo relé 1 canal 5 V', 1250, 380);
        h.wire(rl, 'VCC', u, '5V', P); h.wire(rl, 'GND', u, 'GND·2', G); h.wire(rl, 'IN', u, 'D12', S);
      },
      code: `// Pulsa las teclas en el plano o en el panel: clave 1234 y luego #.
#include <Keypad.h>

const byte FILAS = 4, COLUMNAS = 4;
char teclas[FILAS][COLUMNAS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'}
};
byte pinesFilas[FILAS] = {9, 8, 7, 6};
byte pinesColumnas[COLUMNAS] = {5, 4, 3, 2};
Keypad teclado = Keypad(makeKeymap(teclas), pinesFilas, pinesColumnas, FILAS, COLUMNAS);

const int RELE = 12;
String escrito = "";

void setup() {
  Serial.begin(9600);
  pinMode(RELE, OUTPUT);
  Serial.println("Escribe la clave y pulsa #");
}

void loop() {
  char t = teclado.getKey();
  if (!t) return;
  Serial.print(t);
  if (t == '#') {
    Serial.println();
    if (escrito == "1234") {
      Serial.println("Clave correcta: abriendo");
      digitalWrite(RELE, HIGH); delay(3000); digitalWrite(RELE, LOW);
    } else {
      Serial.println("Clave incorrecta");
    }
    escrito = "";
  } else if (t == '*') {
    escrito = ""; Serial.println(" (borrado)");
  } else {
    escrito += t;
  }
}
`,
    },
    {
      id: 'pico_pwm', name: 'Raspberry Pi Pico: brillo con PWM', board: 'pico',
      desc: 'En la Pico, el potenciómetro (ADC en GP26) regula con analogWrite el brillo de un LED en GP15.',
      build(h) {
        const p = h.add('Raspberry Pi Pico', 400, 120);
        ledR(h, p, 'GP15', 'azul', 900, 80, 'GND');
        const pot = h.add('Potenciómetro 10 kΩ', 120, 300);
        h.wire(pot, 'VCC', p, '3V3(OUT)', P); h.wire(pot, 'GND', p, 'GND', G); h.wire(pot, 'SIG', p, 'GP26', A);
      },
      code: `// Raspberry Pi Pico: el potenciómetro regula el brillo del LED.
const int LED = 15, POT = 26;

void setup() {
  Serial.begin(115200);
  pinMode(LED, OUTPUT);
}

void loop() {
  int valor = analogRead(POT);          // 0 a 1023
  analogWrite(LED, valor / 4);          // 0 a 255
  Serial.print("ADC: "); Serial.print(valor);
  Serial.print("  brillo: "); Serial.print(valor * 100 / 1023); Serial.println(" %");
  delay(200);
}
`,
    },
    {
      id: 'esp32_fade', name: 'ESP32: LED que respira', board: 'esp32',
      desc: 'Un LED que se enciende y apaga suave con PWM en el ESP32. El pulsador cambia la velocidad.',
      build(h) {
        const e = h.add('ESP32 DevKit V1 DOIT (30 pines)', 400, 120);
        ledR(h, e, 'GPIO5', 'verde', 900, 80, 'GND·1');
        const b = h.add('Pulsador 12 mm', 950, 360);
        h.wire(e, 'GPIO4', b, '1.l', S); h.wire(b, '2.l', e, 'GND·2', G);
      },
      code: `// ESP32: el LED "respira"; pulsa el botón para cambiar la velocidad.
const int LED = 5, BOTON = 4;
int paso = 5;
bool anterior = HIGH;

void setup() {
  Serial.begin(115200);
  pinMode(BOTON, INPUT_PULLUP);
  Serial.println("ESP32 listo");
}

void loop() {
  for (int b = 0; b <= 255; b += paso) { analogWrite(LED, b); delay(15); revisar(); }
  for (int b = 255; b >= 0; b -= paso) { analogWrite(LED, b); delay(15); revisar(); }
}

void revisar() {
  bool ahora = digitalRead(BOTON);
  if (anterior == HIGH && ahora == LOW) {
    paso = paso == 5 ? 25 : 5;
    Serial.println(paso == 5 ? "Lento" : "Rápido");
  }
  anterior = ahora;
}
`,
    },
    {
      id: 'esp32_foco', name: 'ESP32: foco de 230 V con relé', board: 'esp32',
      desc: 'Un foco conectado a la red (toma, magnetotérmico, relé) que el ESP32 enciende y apaga. ' +
        'Pulsa el botón o escribe «on» / «off» en el monitor serie.',
      build(h) {
        const e = h.add('ESP32 DevKit V1 DOIT (30 pines)', 200, 140);
        const r = h.add('Módulo relé 1 canal 5 V', 560, 200);
        const q = h.add('Magnetotérmico 1P', 820, 150);
        const f = h.add('Foco 230 V (bombilla E27)', 1000, 140);
        const t = h.add('Toma de corriente', 860, 440);
        const b = h.add('Pulsador 12 mm', 480, 470);
        h.wire(r, 'VCC', e, 'VIN', P); h.wire(r, 'GND', e, 'GND·1', G); h.wire(e, 'GPIO23', r, 'IN', S);
        h.wire(e, 'GPIO4', b, '1.l', S); h.wire(b, '2.l', e, 'GND·2', G);
        h.wire(t, 'L', q, '1', 'L'); h.wire(q, '2', r, 'COM', 'L');
        h.wire(r, 'NO', f, 'L', 'L'); h.wire(f, 'N', t, 'N', 'N');
      },
      code: `// ESP32: enciende y apaga un foco de 230 V con un módulo de relé.
// El relé (IN en GPIO23) cierra COM-NO y deja pasar la fase al foco.
// Pulsador en GPIO4 (a GND): cada pulsación cambia el estado.
// Monitor serie: escribe "on" u "off".
const int RELE = 23, BOTON = 4;
bool encendido = false;
bool anterior = HIGH;

void aplicar(bool on) {
  encendido = on;
  digitalWrite(RELE, on ? HIGH : LOW);
  Serial.println(on ? "Foco encendido" : "Foco apagado");
}

void setup() {
  Serial.begin(115200);
  pinMode(RELE, OUTPUT);
  pinMode(BOTON, INPUT_PULLUP);
  delay(50);
  anterior = digitalRead(BOTON);   // estado real del botón al arrancar: no cuenta como pulsación
  aplicar(false);
}

void loop() {
  bool ahora = digitalRead(BOTON);
  if (anterior == HIGH && ahora == LOW) aplicar(!encendido);
  anterior = ahora;

  if (Serial.available()) {
    String orden = Serial.readStringUntil('\\n');
    orden.trim();
    if (orden == "on") aplicar(true);
    else if (orden == "off") aplicar(false);
  }
  delay(20);
}
`,
    },
    {
      id: 'dimmer', name: 'Brillo de un foco con potenciómetro', board: 'uno',
      desc: 'Un foco de 230 V que se regula con un potenciómetro: el Arduino lo lee y manda el brillo por PWM ' +
        'a un módulo dimmer AC.',
      build(h) {
        const u = h.add('Arduino Uno R3', 200, 300);
        const pot = h.add('Potenciómetro 10 kΩ', 60, 760);
        h.wire(pot, 'VCC', u, '5V', P); h.wire(pot, 'GND', u, 'GND·2', G); h.wire(pot, 'SIG', u, 'A0', A);
        const dm = h.add('Módulo dimmer AC (entrada PWM)', 760, 260);
        h.wire(dm, 'VCC', u, '5V', P); h.wire(dm, 'GND', u, 'GND·3', G); h.wire(u, 'D9', dm, 'PWM', S);
        const t = h.add('Toma de corriente', 1060, 600);
        const f = h.add('Foco 230 V (bombilla E27)', 1120, 300);
        h.wire(t, 'L', dm, 'L', 'L'); h.wire(t, 'N', dm, 'N', 'N');
        h.wire(dm, 'L carga', f, 'L', 'L'); h.wire(dm, 'N carga', f, 'N', 'N');
      },
      code: `// Gira el potenciómetro (clic en él o en el panel de la derecha) y el foco cambia de brillo.
// A0: potenciómetro (0…1023) · D9: PWM al módulo dimmer AC (0…255).
const int POT = A0, DIMMER = 9;
int anterior = -1;

void setup() {
  Serial.begin(9600);
  pinMode(DIMMER, OUTPUT);
}

void loop() {
  int brillo = analogRead(POT) / 4;          // 0…1023 → 0…255
  analogWrite(DIMMER, brillo);
  int pct = map(brillo, 0, 255, 0, 100);
  if (abs(pct - anterior) >= 5) {             // solo avisa cuando cambia de verdad
    Serial.print("Brillo: "); Serial.print(pct); Serial.println(" %");
    anterior = pct;
  }
  delay(30);
}
`,
    },
    {
      id: 'mega_matriz', name: 'Arduino Mega: matriz de LEDs', board: 'mega',
      desc: 'Un corazón que late en una matriz 8×8 con MAX7219, en el Arduino Mega. Librería LedControl.',
      build(h) {
        const m = h.add('Arduino Mega 2560', 200, 300);
        const x = h.add('Matriz LED 8×8 MAX7219', 1000, 60);
        h.wire(x, 'VCC', m, '5V·1', P); h.wire(x, 'GND', m, 'GND·1', G);
        h.wire(x, 'DIN', m, 'D12', C); h.wire(x, 'CLK', m, 'D11', C); h.wire(x, 'CS', m, 'D10', C);
      },
      code: `// Corazón que late en la matriz MAX7219 (DIN 12, CLK 11, CS 10).
#include <LedControl.h>

LedControl matriz = LedControl(12, 11, 10, 1);
const byte GRANDE[8] = {0x66, 0xFF, 0xFF, 0xFF, 0x7E, 0x3C, 0x18, 0x00};
const byte PEQUE[8]  = {0x00, 0x24, 0x7E, 0x7E, 0x3C, 0x18, 0x00, 0x00};

void dibujar(const byte *f) {
  for (int fila = 0; fila < 8; fila++) matriz.setRow(0, fila, f[fila]);
}

void setup() {
  matriz.shutdown(0, false);
  matriz.setIntensity(0, 8);
  matriz.clearDisplay(0);
}

void loop() {
  dibujar(GRANDE); delay(400);
  dibujar(PEQUE);  delay(300);
}
`,
    },
  ];

  window.SimEjemplos = EJEMPLOS;
})();
