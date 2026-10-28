# Editor de diagramas eléctricos

Aplicación web para dibujar diagramas de cableado de tableros sin pelearse con las líneas:
arrastras componentes, unes un borne con otro y **el cable se traza solo en ángulo recto,
esquivando los componentes**. Todo se guarda en una base de datos SQLite.

## Qué hace

- Los cables se trazan en ángulo recto y rodean los componentes. Donde dos cables se cruzan sin
  conectarse, dibujan un pequeño salto (arco).
- Cada tipo de cable tiene su color: fase, neutro, tierra (discontinua), +24 V, 0 V, señal, retorno,
  potencia, analógica y bus. Se numeran solos (C1, C2…) y el número se puede cambiar.
- El empalme (punto negro) deriva un mismo potencial a varios sitios.
- En *Biblioteca de componentes* subes la foto del equipo (también pegándola con Ctrl+V) y haces clic
  sobre cada tornillo para marcar sus bornes. Desde ahí lo arrastras al plano como cualquier otro.
- Las imágenes se pegan directamente en el plano, igual que en Paint: <kbd>Ctrl</kbd>+<kbd>V</kbd> con
  una captura o foto copiada, arrastrar el archivo de imagen al plano o el botón *Insertar imagen*.
  Después, en el panel derecho, *Marcar bornes en la imagen* y un clic en cada tornillo: ya se le
  pueden conectar cables. Con *Guardar en biblioteca* queda como componente reutilizable.
- La biblioteca inicial trae 20 componentes genéricos: toma de corriente, diferencial, magnetotérmico,
  fusible, fuente 24 V, paro de emergencia, pulsador, relé, contactor, módulo de relés, PLC,
  actuador de válvula, motor, sensores, bornera, barra de tierra, etc.
- Placas y módulos dibujados (categorías *Microcontroladores* y *Módulos*), con cada pin conectable y su nombre real:
  Arduino Uno R3, UNO Q, Mega 2560 y Nano · ESP32 DevKitC V4 (38 pines), DevKit V1 DOIT (30), ESP32-S3-DevKitC-1 y
  ESP32-C3-DevKitM-1 · Raspberry Pi Pico / Pico W, Pi 4 Model B, Pi 5 y Zero 2 W · LED, pulsador, resistencia, potenciómetro,
  LED RGB, buzzer, servo, relé, DHT22, HC-SR04, OLED SSD1306 y LCD 16×2 I2C. Se generan con `python tools/placas.py`
  (escribe `componentes_placas.json`, que el servidor carga al arrancar).
- La lista de conexiones (desde → hasta) se exporta a CSV para Excel.
- El plano se exporta a PNG (alta resolución) o SVG.
- Deshacer y rehacer, autoguardado y miniaturas en la lista de diagramas.
- El respaldo exporta e importa todos los diagramas y componentes en un único JSON.

## Usarlo en tu PC (Windows)

1. Necesitas Python 3.10 o superior.
2. Doble clic en **`iniciar.bat`**. Instala lo necesario y abre `http://localhost:5000`.
3. Para detenerlo, cierra la ventana negra.

O desde una terminal:

```bash
pip install -r requirements.txt
python app.py
```

Los datos quedan en `data/diagramas.db`. Para tener una copia de seguridad basta con copiar ese
archivo o usar el botón **Exportar respaldo**.

## Versión de escritorio (instalador .exe y paquete .deb)

Aplicación de escritorio que no necesita Python ni navegador: ventana propia con su icono en la barra de
tareas, y al cerrar la última ventana el programa termina. Lleva dentro arduino-cli y el QEMU del ESP32.

- **Windows:** la ventana es [pywebview](https://pywebview.flowrl.com) con WebView2, el motor que ya trae
  Windows 10/11. Si se abre el programa otra vez, aparece otra ventana del mismo proceso.
- **Linux:** la ventana es GTK con WebKitGTK (`ventana_gtk.py`). WebKitGTK no ejecuta el Python de la
  Orange Pi / Raspberry Pi (le falta JSPI): para esas placas, abre `http://127.0.0.1:47215` en Chromium o Chrome.
- Si la ventana propia no se puede abrir, la app se abre en Edge/Chrome/Chromium en modo aplicación.

| | Windows 10/11 (64 bits) | Linux (Ubuntu, Debian, Mint… 64 bits) |
|---|---|---|
| Archivo | `dist/DiagramasElectricos-1.0.0-instalador.exe` | `dist/diagramas-electricos_1.0.0_amd64.deb` |
| Instalar | Doble clic. No pide administrador: va a `%LOCALAPPDATA%\Programs` | `sudo apt install ./diagramas-electricos_1.0.0_amd64.deb` |
| Abrir | Menú Inicio o escritorio: **Diagramas eléctricos** | Menú de aplicaciones o el comando `diagramas-electricos` |
| Datos | `%LOCALAPPDATA%\DiagramasElectricos\diagramas.db` | `~/.local/share/diagramas-electricos/diagramas.db` |

- Los diagramas no se borran al desinstalar. Los de `iniciar.bat` (`data/diagramas.db`) son otra base:
  para llevarlos a la versión de escritorio usa **Exportar respaldo** en una e **Importar** en la otra.
- La primera vez que simulas una placa se descarga su núcleo de Arduino (hace falta internet).
- En Linux, la simulación del ESP32 necesita Ubuntu 22.04+ o Debian 12+ (el QEMU pide glibc 2.34);
  lo demás funciona desde Ubuntu 20.04.
- Sin ventana (para entrar desde otro navegador): `DIAGRAMAS_SIN_VENTANA=1`, y abre `http://127.0.0.1:47215`.

Cómo se construyen (código en `escritorio.py` y `empaquetado/`):

```bat
:: Windows: PyInstaller + Inno Setup (o Docker con amake/innosetup si no está instalado)
empaquetado\construir_windows.bat
```

```bash
# Linux, dentro de Docker (Debian 11, para que valga también en sistemas antiguos)
docker run --rm -v "$PWD:/src" -w /src python:3.12-slim-bullseye sh empaquetado/construir_deb.sh
```

Los paquetes solo llevan la biblioteca pública. Para una versión propia que incluya también
`componentes_tablero.json` y `ejemplo.json` (si los tienes), construye con `INCLUIR_PRIVADO=1`.

## Cómo se dibuja

| Acción | Cómo |
|---|---|
| Añadir componente | Arrástralo desde la izquierda, o haz clic en él |
| Pegar una foto o captura | <kbd>Ctrl</kbd>+<kbd>V</kbd>, arrastra el archivo al plano o *Insertar imagen* |
| Bornes en una imagen | Selecciónala → *Marcar bornes en la imagen* → clic en cada punto (<kbd>Esc</kbd> para terminar) |
| Conectar | Arrastra desde un borne (círculo) hasta otro borne |
| Copiar / cortar / pegar | <kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd> (también entre diagramas: copia en uno y pega en otro) |
| Copiar una foto a otro programa | Selecciona la imagen → *Copiar imagen al portapapeles* (o *Descargar imagen*) |
| Crear capas | Panel **Capas** → *＋ Nueva capa*. Cada capa se puede renombrar (doble clic), mostrar/ocultar (ojo), bloquear (candado), subir/bajar ▲▼, seleccionar entera ⬚ o borrar ✕ (su contenido pasa a otra capa). Lo nuevo entra en la capa **activa** (clic en su nombre). Mueve elementos arrastrándolos sobre otra capa o con el selector *Capa (grupo)* del panel derecho |
| Orden dentro de la capa | Botón **Capas** de la barra: orden, mostrar/ocultar (ojo) y bloquear (candado) cada elemento. <kbd>Ctrl</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> subir/bajar, con <kbd>Mayús</kbd> al frente/al fondo |
| Bloquear | Casilla *Bloquear* en el panel: no se mueve ni entra en el recuadro de selección (ideal para fotos de fondo) |
| Ajustes de imagen | Opacidad, brillo, contraste, saturación y blanco y negro en el panel derecho |
| Colocar al píxel | Desmarca **Imán a cuadrícula** (o mantén <kbd>Alt</kbd> al arrastrar); flechas = 1 px, <kbd>Mayús</kbd>+flechas = 10 px; o escribe X/Y en el panel |
| Empalme sobre un cable | Suelta el empalme encima del cable: se clava justo en la línea y lo parte en dos |
| Tamaño / giro / espejo | Asa cuadrada de la esquina = tamaño; asa redonda de arriba = girar (<kbd>Mayús</kbd>: de 15 en 15°); botones *Espejo horizontal* y *Espejo vertical* en el panel |
| Color de los cables nuevos | Selector **Color** de la barra (cualquier color, no solo el del tipo) |
| Cambiar color | Clic en el cable, empalme o componente → paleta del panel derecho (o cualquier color con el último cuadro) |
| Gotero | Botón del cuentagotas junto a cada selector de color (y en la barra, para los cables nuevos). En Chrome/Edge coge cualquier píxel de la pantalla; en otros navegadores, haz clic en el plano (también sobre una foto) |
| Colores recientes | Los 10 últimos colores usados aparecen bajo cada paleta y en la barra; se recuerdan en el navegador |
| Pintar un tramo entero | Clic en un cable → *Mismo color en todo el tramo* (cables y empalmes unidos) |
| Bornes y empalmes | Color y tamaño en el panel; en componentes sin foto también fondo y borde |
| Tipo de cable | Elígelo arriba **antes** de conectar, o cámbialo luego en el panel derecho |
| Derivar un cable | Pon un **Empalme / nodo** y conecta a él todos los cables de ese potencial |
| Unir un cable a otro | Arrastra desde un borne y suelta la punta **encima de otro cable**: se crea un empalme justo ahí |
| Sacar una derivación | **Doble clic** sobre un cable: aparece un empalme desde el que arrastrar otro cable |
| Juntar dos cables en uno | Selecciona un empalme que une dos cables → *Unir en un solo cable* |
| Punto de paso | Selecciona el cable y arrastra sobre la línea |
| Cambiar de borne | Selecciona el cable y arrastra uno de sus extremos |
| Seleccionar varios | Arrastra sobre el fondo (herramienta *Seleccionar*, tecla <kbd>V</kbd>) para dibujar un recuadro; <kbd>Ctrl</kbd>/<kbd>Mayús</kbd>+clic añade o quita; <kbd>Ctrl</kbd>+<kbd>A</kbd> todo |
| Mover varios | Arrastra cualquiera de los seleccionados (o flechas del teclado); el panel permite alinear, duplicar, borrar y colorear los cables |
| Texto | Botón **Texto** o tecla <kbd>T</kbd>: nota o rótulo libre (tamaño, negrita, color, fondo). Doble clic para editarlo |
| Zona | Botón **Zona**: recuadro con título para agrupar un área; si hay algo seleccionado, lo rodea. Se dibuja detrás |
| Menú del botón derecho | Sobre un elemento: copiar, cortar, duplicar, eliminar, orden, bloquear, ocultar, mover de capa, distribuir… Sobre el fondo: pegar aquí, añadir texto o zona, seleccionar todo, buscar |
| Buscar | <kbd>Ctrl</kbd>+<kbd>F</kbd> o la lupa: componentes, cables (C12) o bornes; clic en un resultado para ir a él |
| Minimapa y cuadrícula | Casillas *Minimapa* y *Cuadrícula* de la barra. Clic o arrastre en el minimapa para moverte |
| Distribuir | Con 3 o más seleccionados: *Distribuir a la misma distancia* (horizontal o vertical) |
| Imprimir / PDF | Botón **Imprimir** de la barra superior (en el diálogo elige «Guardar como PDF») |
| Revisar el diagrama | Botón **Revisar**: empalmes en el aire, cables duplicados o con número repetido, cables que vuelven al mismo punto y **posibles cortocircuitos** (fase con neutro, +24 V con 0 V… según el tipo de cable). Clic en un aviso para ir a él |
| Lista de materiales | **Conexiones → Lista de materiales**: componentes por tipo (con sus nombres) y cables por tipo; descargable en CSV |
| Renumerar cables | **Conexiones → Renumerar cables**: C1, C2, C3… sin huecos (los cables con nombre propio lo conservan) |
| Cajetín | Botón **Cajetín**: recuadro con plano, proyecto, autor, fecha, revisión y hoja |
| Flechas | Botón **Flecha** o tecla <kbd>A</kbd>: anotación para señalar algo (no cuenta como cable) |
| Atajos | Tecla <kbd>?</kbd> o botón **?**: todos los atajos de teclado |
| Ocultar paneles | Botones de la barra superior (o <kbd>Alt</kbd>+<kbd>1</kbd> componentes, <kbd>Alt</kbd>+<kbd>2</kbd> herramientas, <kbd>Alt</kbd>+<kbd>3</kbd> propiedades). Para volver a mostrarlos, las pestañas en el borde del tablero. Se recuerda en el navegador |
| Modo enfoque | Tecla <kbd>F</kbd> o el botón de modo enfoque: solo queda el tablero; *Salir del modo enfoque* arriba |
| Partir cable | *Edición → Partir* o <kbd>J</kbd> (también con clic derecho sobre el cable): clic en un cable y se mete un empalme en ese punto, listo para sacar una derivación |
| Duplicar en serie | *Edición → En serie*: varias copias de lo elegido en fila o en columna, con sus cables internos. Los nombres que acaban en número siguen la cuenta (K1 → K2, K3…) |
| Reemplazar componente | *Edición → Reemplazar*: cambia la pieza elegida por otra de la biblioteca en el mismo sitio; los cables pasan al borne con el mismo nombre (o al de la misma posición). Si alguno no tiene borne equivalente queda suelto y seleccionado |
| Seleccionar iguales | *Edición → Iguales* o <kbd>I</kbd>: todas las piezas del mismo modelo, o todos los cables del mismo tipo, que lo elegido |
| Buscar y reemplazar texto | *Edición → Reemplazar texto*: en nombres de piezas, etiquetas de cables y textos o zonas, con recuento previo; se deshace con <kbd>Ctrl</kbd>+<kbd>Z</kbd> |
| Resaltar red | *Edición → Red* o <kbd>N</kbd>: clic en un cable o un borne y se resalta todo lo que está al mismo potencial (por empalmes, por bornes compartidos y por los GND, 5V o 3.3V de una misma placa, que van unidos por dentro). Arriba se listan los bornes de esa red |
| Mover el plano | <kbd>Espacio</kbd> + arrastrar, botón central del ratón, o herramienta *Mano* (<kbd>H</kbd>) |
| Zoom | Rueda del ratón, o los botones − / + / Ajustar |
| Borrar | Tecla <kbd>Supr</kbd> |
| Deshacer / rehacer | <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> |
| Duplicar / rotar | <kbd>Ctrl</kbd>+<kbd>D</kbd> / <kbd>R</kbd> |
| Guardar | <kbd>Ctrl</kbd>+<kbd>S</kbd> (además se guarda solo a los pocos segundos) |

**Trazado *Automático* o *Manual*.** El automático busca el camino y esquiva componentes. El manual
traza una escuadra directa y tú decides el recorrido añadiendo puntos de paso. Se puede elegir para
los cables nuevos, cambiar cable a cable o aplicar a todos con *Re-trazar todos*.

**Si editas un componente de la biblioteca** (por ejemplo, para mover un borne), los diagramas que
ya lo usan no cambian solos. Selecciónalo en el plano y pulsa *Actualizar desde biblioteca*.

## Simulador de Arduino, Raspberry Pi Pico y ESP32 (como Wokwi)

Botón verde **Simular** en el editor (o en la tarjeta del diagrama). Se abre una página con el código
a la izquierda, tu circuito en el centro y los controles a la derecha.

- **El código se compila de verdad** con `arduino-cli` (el compilador oficial de Arduino) en tu PC,
  así que funcionan las librerías. Las más usadas (Servo, LiquidCrystal I2C, DHT, Adafruit NeoPixel,
  Adafruit SSD1306/GFX, RTClib, Keypad, TM1637, LedControl, OneWire…) **se instalan solas** la primera
  vez que las incluyes. El resto se busca e instala desde **Librerías**.
- **El micro se emula en el navegador** con [avr8js](https://github.com/wokwi/avr8js) (el mismo motor
  que usa Wokwi): el ATmega328P instrucción a instrucción, con temporizadores, PWM, UART, ADC, I2C y SPI.
  En un PC normal va al 100 % del tiempo real (se ve en *Rendimiento*).
- **Placas:**
  - **Arduino Uno, Nano y Mega 2560**: avr8js en el navegador (el Mega con sus 70 pines, 16 entradas
    analógicas, temporizadores 0-5 y las 4 UART).
  - **Raspberry Pi Pico**: [rp2040js](https://github.com/wokwi/rp2040js) en el navegador, con el núcleo
    arduino-pico a 125 MHz. `Serial` va por USB (CDC). La PIO avanza al ritmo del reloj y el programa
    del `Servo` se calcula directamente para que no frene la simulación.
  - **ESP32 DevKit (V1 DOIT y DevKitC V4)**: corre en **QEMU en el propio PC** (el fork de PICSimLab,
    `bin/qemu-esp32`, GPL-2), lanzado por `esp32_runner.py`; el navegador recibe los pines, el puerto
    serie, el PWM (LEDC) y el I2C por eventos. Se compila con el núcleo ESP32 **2.0.17** (el 3.x se cuelga
    en este QEMU). Va a tiempo real; no sirven los protocolos de microsegundos (DHT22, HC-SR04) ni WiFi/BT.
  - **ESP32-C3 DevKitM**: igual que el ESP32, con el QEMU RISC-V del mismo fork. Pines, ADC, PWM, servo y
    monitor serie funcionan; el I2C (`Wire`) cuelga ese emulador, así que no hay pantallas ni sensores I2C.
  - Los núcleos de la Pico y del ESP32 se descargan solos la primera vez que eliges esa placa.
  - ESP32-S3, Arduino UNO Q y las Raspberry Pi con Linux se dibujan pero no se emulan.
- **Lo que reacciona en el plano:** LEDs (con brillo PWM), LED RGB, 7 segmentos, pulsadores (clic en el
  plano), interruptores, teclado 4×4, DIP, encoder, potenciómetros y joystick (deslizadores), LDR, NTC,
  servo (gira el brazo), zumbador (suena), relés y contactores (conmutan de verdad), transistores y MOSFET,
  optoacoplador, motores, L298N/L293D, A4988 + paso a paso, 74HC595, 74HC00, CD4017, LM358, ULN2003,
  NeoPixel, LCD 16×2 y 20×4 I2C, OLED SSD1306, TM1637, MAX7219, RTC DS1307/DS3231 (da la hora del PC),
  DHT22, HC-SR04, PIR, sensores analógicos (luz, humedad, gas, LM35, ACS712), baterías y reguladores,
  MPU6050, BMP280, DS18B20 (1-Wire, con búsqueda de ROM), HX711, receptor IR con mando NEC y pantalla TFT ILI9341.
- **Qué es cada borne:** al pasar el ratón por un borne (en el editor y en el simulador) se ve su nombre y
  para qué sirve: fase, neutro, tierra, GPIO5, NO/COM/NC, SDA… En el editor, el panel Propiedades lleva la
  ficha de la pieza seleccionada con todos sus bornes explicados, y la biblioteca la muestra al pasar el
  ratón por cada componente. Se definen en `static/js/fichas.js`.
- **Instalación de 230 V:** la toma de corriente es la red (L a la tensión elegida, N y PE a 0 V). En sus
  propiedades del editor, o en Controles del simulador, se elige si está **con corriente** o no y la
  tensión: 110, 120, 127, 220 o 230 V ~ (por defecto, con corriente a 230 V). Clic en la toma durante la
  simulación = quitar o dar la corriente. Se guarda en el diagrama. El foco E27 se
  enciende y el ventilador gira cuando les llega fase y neutro; el interruptor de pared, el magnetotérmico,
  el diferencial y los contactos de un relé los cortan. Así se monta un foco que el ESP32 enciende con un
  módulo de relé (ejemplo «ESP32: foco de 230 V con relé»).
- **En el plano, como en Wokwi:** clic en un potenciómetro o sensor abre sus controles junto a la pieza;
  al pasar el ratón por un cable o un borne se ve su tensión y el estado del pin del micro.
- **Monitor serie** abajo, con entrada de texto para `Serial.read()`.
- **Analizador lógico** (pestaña de abajo): las señales de los pines del micro en el tiempo, con ventana
  de 1 ms a 10 s, congelar y medida de frecuencia y ciclo de trabajo. El panel de abajo se puede estirar.
- **Pausa** (botón o barra espaciadora) para parar el tiempo y mirar con calma.
- **Editar circuito** (arriba a la derecha del plano): sin salir del simulador se mueven piezas, se tiran
  cables de borne a borne (con su color: señal, alimentación, GND, bus…), se giran (R), se borran (Supr) y se
  añaden piezas de la biblioteca con un buscador. Se guarda solo en el diagrama y al pulsar Simular ya
  se usa el circuito nuevo.
- **Ejemplos** (también en la página principal): 14 circuitos listos: semáforo, pulsador, servo con
  potenciómetro, termómetro DHT22 + LCD, sensor de aparcamiento, NeoPixel, reloj RTC + OLED, contador de
  7 segmentos, cerradura con teclado, brillo de un foco de 230 V con potenciómetro y dimmer, uno para la
  Pico, dos para el ESP32 (LED con PWM y foco de 230 V con relé) y uno para el Mega. Cada uno crea un diagrama
  nuevo con las piezas cableadas y su programa, y arranca solo. Se definen en `static/js/ejemplos.js`.
- La red eléctrica es simplificada: cables, resistencias y fuentes. Los condensadores y diodos no se
  calculan; si dos salidas distintas quedan unidas avisa de **cortocircuito**.
- El código se guarda con el diagrama.

Para usarlo hace falta `arduino-cli` en `bin/` o en el `PATH`, o la variable `ARDUINO_CLI`. El ESP32
necesita además el QEMU de PICSimLab en `bin/qemu-esp32` (o la variable `QEMU_ESP32_DIR`). Ninguno de los
dos viene en el repositorio: ver [Programas de bin/](#programas-de-bin). La imagen Docker descarga
arduino-cli sola; el QEMU de Linux lo toma de `bin/qemu-esp32-linux`.

### Programas de bin/

Son programas de terceros, grandes, y no van en el repositorio (los instaladores de *Releases* sí los llevan):

| Carpeta | Qué poner | De dónde |
|---|---|---|
| `bin/` | `arduino-cli.exe` (Windows) o `arduino-cli` (Linux) | [arduino-cli 1.5.1](https://github.com/arduino/arduino-cli/releases) (GPL-3.0) |
| `bin/qemu-esp32/` | `libqemu-xtensa.dll`, `libqemu-riscv32.dll`, sus DLL y la carpeta `fw/` | [PICSimLab 0.9.3](https://github.com/lcgamboa/picsimlab/releases) para Windows de 64 bits (GPL-2) |
| `bin/qemu-esp32-linux/` | `libqemu-xtensa.so`, `libqemu-riscv32.so` y `fw/` | el AppImage de PICSimLab 0.9.3 para Linux (GPL-2) |

Los `LEEME.txt` de cada carpeta explican qué archivos son. Sin el QEMU, el editor y el simulador de
Arduino Uno/Nano/Mega y Pico funcionan igual; solo el ESP32 avisa de que falta.

### Orange Pi y Raspberry Pi (Python)

No se emula Linux ni el procesador (QEMU no tiene el H618 de la Orange Pi Zero 3W y arrancar un sistema
entero sería lentísimo): se ejecuta **el programa de Python** que controla el GPIO, que es lo que importa
para el circuito. Corre en el navegador con [Pyodide](https://pyodide.org) (CPython 3.12 compilado a
WebAssembly, en `static/vendor/pyodide`, sin internet y sin ejecutar nada en el servidor) y estas
librerías están sustituidas por otras iguales que mueven los pines y el bus I2C del circuito
(`static/py/simhw.py`):

| Librería | Qué se puede usar |
|---|---|
| `wiringpi` (wiringOP) | `wiringPiSetup` / `SetupPhys` / `SetupGpio`, `pinMode`, `digitalWrite/Read`, `pullUpDnControl`, `pwmWrite`, `softPwm*`, `softTone*`, `wiringPiISR`, `wiringPiI2C*`, `delay`, `millis` |
| `OPi.GPIO`, `RPi.GPIO` | `setmode(BOARD/BCM/SUNXI)`, `setup`, `output`, `input`, `PWM`, `add_event_detect`, `wait_for_edge`, `cleanup` |
| `gpiozero` | `LED`, `PWMLED`, `RGBLED`, `Button` (`when_pressed`…), `MotionSensor`, `Buzzer`, `TonalBuzzer`, `OutputDevice`, `Servo`, `AngularServo`, `DistanceSensor`, `Motor`; `blink`/`pulse` en segundo plano y `signal.pause()` |
| `smbus2`, `smbus` | lectura y escritura de bytes, registros y bloques, `i2c_rdwr` |
| `RPLCD.i2c` | `CharLCD("PCF8574", 0x27)`: `write_string`, `clear`, `cursor_pos`, `backlight_enabled`, `create_char` |
| `board` + `adafruit_dht` | `DHT22` / `DHT11`: temperatura y humedad de la pieza conectada |

`print()` sale en el monitor serie e `input()` lee lo que escribes en él. Al abrir el simulador desde un
diagrama con una Orange Pi o una Raspberry Pi 4 / 5 / Zero 2 W, la placa se detecta sola y el código de
partida es el mismo programa que propone la guía. Pausa, analizador lógico, sensores y piezas funcionan
igual que con Arduino. Hace falta **Chrome o Edge 137+** (también en Android): Python espera (`time.sleep`,
I2C) con JSPI de WebAssembly sin bloquear la página.

## Guía de puesta en marcha

Botón **Guía** en el editor y en el simulador (o `/guia?id=N`). Lee el diagrama, detecta la placa y qué
hay conectado a cada pin, y genera: lista de material, tabla de conexiones, cómo instalar el IDE o el
sistema operativo (Arduino IDE 2, Raspberry Pi OS, imagen de Orange Pi, Raspberry PLC de Industrial
Shields), interfaces y librerías, y un programa de prueba con los pines reales (Arduino C++, Python con
gpiozero, wiringOP o librpiplc). Si el diagrama tiene partes de red, avisa de seguridad. Se puede elegir
otra placa a mano e imprimir o guardar como PDF.

## Modo claro y oscuro

El botón del sol o la luna de la barra superior (o del menú «⋯ Más») cambia entre claro y oscuro, y
la elección se recuerda en ese navegador. Sin elegir, se sigue el modo del sistema. El plano y el
escenario del simulador son blancos en los dos modos, porque son la hoja del dibujo (así se ven los
cables negros de 0 V y se imprime igual). La dirección de diseño está en `DESIGN.md`.

## En pantallas pequeñas (tableta y teléfono)

Todas las páginas se adaptan al ancho de la ventana, no a modelos de dispositivo concretos:

- **Barra superior:** lo que no cabe pasa al menú **⋯ Más**, empezando por lo menos usado. Se recalcula al
  girar el dispositivo o al cambiar el tamaño de la ventana.
- **Editor, por debajo de 1024 px:** los paneles de *Componentes* y *Propiedades* son cajones que se abren
  sobre el plano (pestañas en los bordes o Alt+1 / Alt+3). Se cierran al tocar el plano y solo hay uno
  abierto a la vez. En el teléfono, las herramientas forman una sola fila que se desliza con el dedo.
- **Simulador:** por debajo de 1200 px, los potenciómetros, sensores e interruptores están en el cajón
  **Controles**. Por debajo de 700 px hay tres pestañas (*Código · Circuito · Controles*), y al pulsar
  Simular se pasa sola al circuito.
- En pantallas táctiles los botones tienen al menos 40 px de alto.

**Con el dedo (móvil y tableta):**

| Gesto | Qué hace |
|---|---|
| Arrastrar con un dedo el fondo | Mueve el plano. En pantallas táctiles la herramienta *Mano* viene activada; con *Seleccionar* se dibuja el recuadro de selección |
| Dos dedos | Pellizcar para acercar o alejar y mover a la vez (editor y simulador) |
| Tocar un componente o cable | Lo selecciona y aparece arriba la **barra de selección**: girar, duplicar, eliminar, propiedades y ⋯ más acciones |
| Mantener pulsado | Menú contextual (lo mismo que el clic derecho), también en iPhone y iPad |
| Pulsadores y teclados del simulador | Se mantienen apretados mientras el dedo esté encima |

**Instalarla como app:** en Chrome (Android) o Edge, menú ⋮ → *Instalar aplicación*; en iPhone/iPad, Safari →
Compartir → *Añadir a pantalla de inicio*. Se abre a pantalla completa con su icono y, sin conexión, muestra lo
último que se abrió en ese dispositivo (guardar y simular necesitan el servidor). El navegador solo permite
instalarla con **HTTPS** o en `localhost`; desde otro dispositivo de la red local (`http://IP-del-PC:8000`)
funciona igual en el navegador, pero para instalarla hace falta servirla con HTTPS.

## Desplegarlo en un servidor

La base de datos es un archivo. Donde lo despliegues necesitas **almacenamiento persistente**: si
no, los diagramas se pierden en cada redespliegue. La variable `DATABASE_PATH` indica dónde vive el
archivo.

### Con Docker (VPS, servidor propio, NAS)

```bash
docker compose up -d --build
```

Queda en `http://IP-del-servidor:8000`, con los datos en el volumen `datos`.

La imagen trae el simulador: `arduino-cli` para Linux con el núcleo AVR (Uno, Nano, Mega). Los núcleos de la
Raspberry Pi Pico y del ESP32 se descargan la primera vez que se usan y quedan en el volumen `arduino`.
El ESP32 y el ESP32-C3 usan la versión de Linux del QEMU de PICSimLab, en `bin/qemu-esp32-linux`
(sacada de su AppImage oficial, GPL-2).

### Render.com

El repositorio incluye `render.yaml`: sube esta carpeta a GitHub, crea un *Blueprint* en Render y
ya monta un disco persistente en `/data`. Rellena `APP_USER` y `APP_PASSWORD` en el panel.

### Railway / Fly.io / otros

Usan el `Dockerfile`. Monta un volumen en `/data` y deja `DATABASE_PATH=/data/diagramas.db`.

### Proteger con contraseña

Si la publicas en internet, define estas dos variables de entorno y el navegador pedirá usuario y
contraseña:

```
APP_USER=admin
APP_PASSWORD=una-clave-larga
```

## Estructura

```
app.py                 servidor Flask + API REST + base de datos SQLite
escritorio.py          lanzador de la versión de escritorio (empaquetado/: .exe y .deb)
static/js/fichas.js    qué es cada componente y para qué sirve cada borne
static/index.html      lista de diagramas
static/editor.html     editor
static/components.html biblioteca y diseñador de componentes
static/simulador.html  simulador de Arduino (static/js/sim.js)
simulador.py           compilación con arduino-cli, librerías y sesiones del ESP32
esp32_runner.py        ejecuta el ESP32 en QEMU y habla con el navegador (líneas JSON)
static/js/sim-engines.js  motores: avr8js, rp2040js y el puente con QEMU
bin/qemu-esp32/        QEMU del ESP32 de PICSimLab (GPL-2, ver LEEME.txt; no incluido)
bin/arduino-cli.exe    compilador oficial de Arduino (GPL-3.0; no incluido)
static/js/             lógica del navegador (editor.js, designer.js, common.js)
static/vendor/         JointJS 4.0.4 (MPL-2.0), avr8js 0.21 (MIT), CodeMirror 5 (MIT): sin internet
Dockerfile, docker-compose.yml, render.yaml   despliegue
iniciar.bat            arranque rápido en Windows
```

### API

| Método | Ruta | Uso |
|---|---|---|
| GET/POST | `/api/diagrams` | listar / crear diagramas |
| GET/PUT/DELETE | `/api/diagrams/<id>` | leer / guardar / borrar |
| POST | `/api/diagrams/<id>/duplicate` | duplicar |
| GET/POST | `/api/components` | biblioteca |
| PUT/DELETE | `/api/components/<id>` | editar / borrar componente |
| GET/POST | `/api/backup` | exportar / importar respaldo |
| GET | `/api/health` | comprobación de estado |
| GET/PUT | `/api/diagrams/<id>/sketch` | código del simulador |
| POST | `/api/sim/compile` | compilar un sketch → `.hex` |
| GET/POST | `/api/sim/libs`, `/api/sim/libs/search`, `/api/sim/libs/install` | librerías |
| POST | `/api/sim/cores/install` | instala el núcleo de una placa (AVR, Pico o ESP32) |
| POST/GET | `/api/sim/esp32/start`, `/api/sim/esp32/<sesión>/events` (SSE), `/cmd`, `/stop` | ESP32 en QEMU |

## Licencia

MIT (ver `LICENSE`). Las bibliotecas de `static/vendor/` y los programas de `bin/` tienen sus propias
licencias, indicadas arriba.
