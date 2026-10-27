/* Fichas de los componentes: qué es cada pieza y para qué sirve cada borne (fase, neutro, GPIO5…).
   Las usan el editor (panel Propiedades y aviso al pasar por un borne) y el simulador.
   Fichas.part(nombreComponente) → texto · Fichas.pin(nombreComponente, nombreBorne) → texto o '' */
(function () {
  'use strict';

  // Qué es cada pieza (la primera regla que encaje con el nombre del componente)
  const PARTS = [
    [/^Toma de corriente/, 'Enchufe de la red eléctrica. En el simulador es la fuente de la instalación: L lleva la tensión (110–230 V ~), N es el retorno y PE la tierra. Se elige si tiene corriente y a qué tensión en Propiedades.'],
    [/^Bornera \+ toma/, 'Bornera de entrada con una toma de corriente: reparte fase (L), neutro (N) y tierra.'],
    [/^Foco 230 V/, 'Bombilla de rosca E27 para la red. Se enciende cuando le llega la fase por L y el neutro por N. Para mandarla con un microcontrolador, la fase pasa por el contacto COM-NO de un relé.'],
    [/^Interruptor de luz/, 'Interruptor de pared de una vía. Corta la fase: entra por L y sale por L1 hacia el foco cuando está encendido.'],
    [/^Ventilador 230 V/, 'Ventilador de red. Gira cuando tiene fase en L y neutro en N.'],
    [/^Módulo dimmer AC/, 'Regulador de luz (dimmer) de triac para la red. La red entra por L y N y la carga (un foco incandescente o regulable) va en L carga y N carga. El brillo lo marca la entrada PWM: analogWrite(pin, 0…255) desde el microcontrolador.'],
    [/^Magnetotérmico/, 'Interruptor automático: protege el circuito y se dispara con sobrecargas o cortocircuitos. La fase entra por 1 y sale por 2.'],
    [/^Interruptor diferencial|^RCBO/, 'Protección diferencial: corta fase y neutro si hay una fuga a tierra (protege a las personas). Entrada arriba, salida abajo.'],
    [/^Fusible/, 'Fusible: se funde y abre el circuito si pasa demasiada corriente.'],
    [/^Supresor de picos/, 'Supresor de sobretensiones (varistor/TVS): absorbe picos de tensión. Se pone en paralelo con la línea.'],
    [/^Fuente 24 V DC|^Fuente AMQR/, 'Fuente de alimentación de carril DIN: convierte la red (L, N, PE) en 24 V de continua (+V y −V).'],
    [/^UPS/, 'Sistema de alimentación ininterrumpida: mantiene la tensión de salida aunque falle la red.'],
    [/^Barra de tierra/, 'Barra donde se juntan todas las tierras de protección (PE) del tablero.'],
    [/^Bornera 6 polos|^Borna de tornillo/, 'Bornas de tornillo para empalmar cables. Cada borne une lo que se conecta en él.'],
    [/^Actuador de válvula/, 'Actuador eléctrico que abre o cierra una válvula. Se alimenta por L y N y la orden de abrir/cerrar llega por sus bornes de mando; los finales de carrera indican la posición.'],
    [/^Caudalímetro|conector 15 pines/, 'Caudalímetro: da el caudal con pulsos y con una señal 4-20 mA para un PLC.'],
    [/^Lámpara piloto/, 'Piloto de señalización del tablero: se ilumina con tensión entre X1 y X2.'],
    [/^Motor trifásico/, 'Motor de corriente alterna trifásica: fases U, V y W y tierra PE.'],
    [/^Sensor 3 hilos/, 'Sensor industrial PNP: + y − de alimentación (24 V) y S, la salida que da +24 V al detectar.'],
    [/^PLC genérico|^Raspberry PLC/, 'Autómata programable: lee entradas (I) y activa salidas (Q) o relés (R) según su programa.'],
    [/^Contactor/, 'Contactor: un relé de potencia. Con tensión en la bobina A1-A2 cierra los contactos principales (L→T) y el auxiliar 13-14.'],
    [/^Relé 24 V/, 'Relé con bobina de 24 V: al alimentar A1-A2 el común COM pasa de NC a NO.'],
    [/^Módulo de 2 relés|^Módulo relé/, 'Módulo de relé para microcontroladores: con la entrada IN en HIGH (y VCC/GND conectados) el relé une COM con NO. Sirve para encender cargas de red (foco, ventilador, bomba) desde un pin.'],
    [/^Relé DPDT/, 'Relé de dos circuitos conmutados con bobina de 5 V.'],
    [/^Paro de emergencia/, 'Seta de emergencia, contacto normalmente cerrado: al pulsarla abre el circuito.'],
    [/^Pulsador \(NA\)/, 'Pulsador normalmente abierto: une sus bornes mientras se mantiene pulsado.'],
    [/^Pulsador 12 mm|^Pulsador táctil/, 'Pulsador de 4 patas. Las patas de cada lado van unidas siempre; al pulsar se unen las dos parejas. Para un microcontrolador: un lado a un pin con INPUT_PULLUP y el otro a GND.'],
    [/^Arduino Uno|^Arduino UNO Q/, 'Placa Arduino de 5 V. Pines digitales D0-D13 (los de ~ admiten PWM), entradas analógicas A0-A5, I²C en SDA/SCL.'],
    [/^Arduino Mega/, 'Arduino Mega 2560: 54 pines digitales (15 PWM), 16 entradas analógicas y 4 puertos serie. Trabaja a 5 V.'],
    [/^Arduino Nano/, 'Arduino Nano: como el Uno en pequeño, para protoboard. 5 V, pines D2-D13 y A0-A7.'],
    [/^ESP32/, 'Placa ESP32 con Wi-Fi y Bluetooth. Sus pines trabajan a 3,3 V (no aguantan 5 V). VIN recibe 5 V del USB o de una fuente. Se programa con el IDE de Arduino.'],
    [/^Raspberry Pi Pico/, 'Raspberry Pi Pico (RP2040): microcontrolador de 3,3 V con pines GP0-GP28 (GP26-28 analógicos).'],
    [/^Raspberry Pi/, 'Ordenador Raspberry Pi con Linux. El conector GPIO de 40 pines trabaja a 3,3 V; se programa en Python.'],
    [/^Orange Pi/, 'Ordenador Orange Pi con Linux. Su conector GPIO trabaja a 3,3 V; se programa en Python con wiringOP.'],
    [/^LED RGB/, 'LED de tres colores con cátodo común: COM a GND y cada color a un pin con su resistencia.'],
    [/^LED /, 'Diodo LED: el ánodo (+) va al pin o al positivo y el cátodo (−) a GND, siempre con una resistencia en serie (220–330 Ω).'],
    [/^Resistencia/, 'Resistencia: limita la corriente. No tiene polaridad.'],
    [/^Potenciómetro/, 'Resistencia variable: los extremos a 5 V/3,3 V y GND, y el cursor (W o central) da una tensión que se lee con una entrada analógica.'],
    [/^Buzzer/, 'Zumbador: suena con tensión o con tone() en un pin.'],
    [/^Condensador|^Supercondensador/, 'Condensador: almacena carga y filtra. Los electrolíticos tienen polaridad (+ y −).'],
    [/^Diodo|^Puente rectificador/, 'Diodo: deja pasar la corriente de ánodo (A) a cátodo (K).'],
    [/^Transistor|^Triac/, 'Transistor: con una corriente pequeña en la base (B) o puerta (G) controla una mayor entre colector y emisor.'],
    [/^MOSFET/, 'MOSFET: con tensión en la puerta (G) conduce entre drenador (D) y fuente (S). Para cargas de continua.'],
    [/^Servo/, 'Servomotor: GND, V+ (5 V) y PWM, la señal que fija el ángulo.'],
    [/^Motor paso a paso/, 'Motor paso a paso bipolar: dos bobinas (A y B) que mueve un driver.'],
    [/^Driver de motor|^Driver de motores/, 'Driver de motores: recibe las órdenes del microcontrolador y da la corriente que necesita el motor.'],
    [/^Motor DC|^Mini bomba|^Solenoide/, 'Carga de continua: se alimenta entre + y −. Desde un microcontrolador, con un transistor, MOSFET o relé.'],
    [/^Display 7|^Display 4|^Matriz LED|^Anillo NeoPixel|^Tira NeoPixel/, 'Pantalla de LEDs controlada desde el microcontrolador.'],
    [/^Pantalla|^LCD/, 'Pantalla para mostrar texto o gráficos; las I²C se conectan con VCC, GND, SDA y SCL.'],
    [/^Sensor|^Receptor|^Lector|^Reloj RTC|^Acelerómetro|^Amplificador de celda/, 'Módulo sensor: se alimenta por VCC y GND y entrega su medida por una salida o un bus (I²C, SPI, 1-Wire).'],
    [/^Joystick|^Teclado|^Encoder|^Interruptor deslizante|^Interruptor DIP|^Interruptor de palanca|^Interruptor basculante|^Final de carrera/, 'Elemento de entrada o maniobra: une o separa sus contactos según su posición.'],
    [/^Módulo Bluetooth|^Radio|^Transceptor|^Lector de tarjetas/, 'Módulo de comunicación con el microcontrolador (serie, SPI o RS-485).'],
    [/^Regulador|^Convertidor reductor/, 'Regulador de tensión: de una tensión mayor en IN saca una fija en OUT.'],
    [/^Batería|^Pila|^Portapilas|^Panel solar/, 'Fuente de continua: + positivo y − negativo.'],
    [/^Transformador/, 'Transformador: baja la tensión de la red del primario (PRI) al secundario (SEC).'],
    [/^Bobina/, 'Bobina o inductor: se opone a los cambios de corriente.'],
    [/^Cristal/, 'Cristal de cuarzo: da la frecuencia de reloj a un microcontrolador.'],
    [/^Termistor|^Fotorresistencia/, 'Resistencia que cambia con la temperatura o la luz; con otra resistencia forma un divisor para una entrada analógica.'],
    [/^Temporizador|^Amplificador|^Array|^Microcontrolador|^Contador|^Conversor|^Puertas|^Registro|^Optoacoplador/, 'Circuito integrado. Los bornes llevan el número de pata del encapsulado y su función.'],
    [/^Conector|^Tira de pines/, 'Conector para unir cables o módulos.'],
    [/^Empalme/, 'Punto de unión de cables del mismo potencial.'],
  ];

  const AC = /Toma|Bornera \+|UPS|RCBO|diferencial|Magnetot|Foco|Ventilador|Interruptor de luz|Actuador|Fuente 24|Fuente AMQR|Supresor|Lámpara|dimmer AC/;
  const GPIO_EXTRA = {
    VP: 'sensor VP, solo entrada', VN: 'sensor VN, solo entrada', TX: 'transmisión serie', TX0: 'transmisión serie (USB)', RX0: 'recepción serie (USB)',
    RX: 'recepción serie', TX2: 'serie 2, transmisión', RX2: 'serie 2, recepción', SDA: 'datos I²C', SCL: 'reloj I²C',
    TXD: 'transmisión serie', RXD: 'recepción serie', MOSI: 'SPI, datos de salida', MISO: 'SPI, datos de entrada', SCLK: 'reloj SPI',
    CE0: 'SPI, selección 0', CE1: 'SPI, selección 1', CLK: 'flash interna, no usar', CMD: 'flash interna, no usar',
    SD0: 'flash interna, no usar', SD1: 'flash interna, no usar', SD2: 'flash interna, no usar', SD3: 'flash interna, no usar',
  };

  function esp32Gpio(n) {
    const t = [];
    if (n >= 34 && n <= 39) t.push('solo entrada, sin pull-up');
    if ([0, 2, 4, 12, 13, 14, 15, 25, 26, 27, 32, 33, 34, 35, 36, 39].includes(n)) t.push('admite entrada analógica');
    if (n === 21) t.push('SDA de I²C por defecto');
    if (n === 22) t.push('SCL de I²C por defecto');
    if ([0, 2, 12, 15].includes(n)) t.push('interviene en el arranque');
    if (n >= 6 && n <= 11) t.push('conectado a la flash interna, no usar');
    return t;
  }

  /* [regla del componente o null, regla del borne, texto o función(m, comp)] — gana la primera */
  const PINS = [
    // red eléctrica
    [AC, /^(?:Entrada |Bornera |Toma |\d+ )?(?:L|LÍNEA|L entrada)$/, 'Fase (L): el conductor con tensión de la red. Va por el interruptor, el fusible o el relé.'],
    [AC, /^(?:Batería \d+ |Supresión \d+ )L$/, 'Fase (L) de esta salida.'],
    [AC, /^(?:L salida|L')$/, 'Fase de salida: la fase ya protegida, hacia los circuitos.'],
    [/^Interruptor de luz/, /^L1$/, 'Retorno de fase: sale hacia el foco cuando el interruptor está encendido.'],
    [/dimmer AC/, /^L carga$/, 'Fase regulada: va al borne L del foco.'],
    [/dimmer AC/, /^N carga$/, 'Neutro de la carga: va al borne N del foco (unido por dentro con N).'],
    [/dimmer AC/, /^PWM$/, 'Entrada de brillo: un pin con PWM del microcontrolador (analogWrite). 0 = apagado, 255 = brillo máximo.'],
    [AC, /^(?:Entrada |Bornera |Toma |Batería \d+ |Supresión \d+ |\d+ )?(?:N|N entrada)$/, 'Neutro (N): el retorno de la corriente de la red, cerca de 0 V. No se interrumpe con el interruptor.'],
    [AC, /^(?:N salida|N')$/, 'Neutro de salida, hacia los circuitos.'],
    [null, /^(?:Entrada |Batería \d+ |Supresión \d+ )?(?:PE|⏚|⏚ carcasa)$/, 'Tierra de protección (PE): une las partes metálicas con tierra; normalmente no lleva corriente.'],
    [AC, /^(?:Toma |Bornera )GND$/, 'Tierra de protección (PE) de la toma.'],
    [/^Contactor/, /^(\d)L(\d)$/, (m) => 'Entrada del contacto principal ' + m[2] + ' (fase que llega de la red).'],
    [/^Contactor/, /^(\d)T(\d)$/, (m) => 'Salida del contacto principal ' + m[2] + ' (hacia el motor o la carga).'],
    [/^Contactor/, /^13$/, 'Contacto auxiliar normalmente abierto, entrada.'],
    [/^Contactor/, /^14$/, 'Contacto auxiliar normalmente abierto, salida.'],
    [/^Relé|^Contactor/, /^A1$/, 'Bobina, borne A1 (+): con tensión entre A1 y A2 el relé conmuta.'],
    [/^Relé|^Contactor/, /^A2$/, 'Bobina, borne A2 (−).'],
    [/^Motor trifásico/, /^([UVW])$/, (m) => 'Fase ' + m[1] + ' del motor.'],
    [/^Lámpara piloto/, /^X([12])$/, 'Borne de la lámpara; se enciende con tensión entre X1 y X2.'],
    [/^Magnetotérmico|^Fusible|^Supresor/, /^1$/, 'Entrada (viene de la red).'],
    [/^Magnetotérmico|^Fusible|^Supresor/, /^2$/, 'Salida (hacia el circuito protegido).'],
    [/^Transformador/, /^PRI/, 'Primario: se conecta a la red.'],
    [/^Transformador/, /^SEC/, 'Secundario: sale la tensión reducida.'],
    [null, /^~ AC/, 'Entrada de alterna del puente rectificador.'],
    // contactos de relés y finales de carrera
    [/Sensor|DHT/, /^NC$/, 'No conectado: se deja libre.'],
    [null, /^NO(\d?)$/, 'Contacto normalmente abierto (NO): se une con COM cuando el relé se activa. Aquí se pone la carga que se quiere encender.'],
    [null, /^NC(\d?)$/, 'Contacto normalmente cerrado (NC): unido a COM en reposo; se abre al activar el relé.'],
    [/LED RGB|Display 7/, /^COM/, 'Común: el cátodo común, va a GND.'],
    [/ULN2003/, /COM$/, 'Común de los diodos de protección: a la alimentación de la carga.'],
    [null, /^COM(\d?)\s*$/, 'Común (COM) del contacto: aquí entra lo que se conmuta (por ejemplo la fase que va al foco).'],
    [null, /^COIL\d$/, 'Bobina del relé.'],
    [/^Módulo relé|^Módulo de 2 relés/, /^IN(\d?)$/, 'Entrada de control: en HIGH el relé se activa y une COM con NO. Va a un pin del microcontrolador.'],
    [/^Actuador/, /FC abierto/, 'Final de carrera: indica que la válvula está abierta.'],
    [/^Actuador/, /FC cerrado/, 'Final de carrera: indica que la válvula está cerrada.'],
    [/^Actuador/, /REMOTE OPEN/, 'Orden de abrir la válvula.'],
    [/^Actuador/, /REMOTE CLOSE/, 'Orden de cerrar la válvula.'],
    // alimentación de continua
    [null, /^(?:\d+ )?(?:A?GND|Gnd|0V|VSS|− GND|GND ISO|ISO-GND|GND entradas|GND salidas|GND\/ADJ)$/, 'Masa (GND, 0 V): la referencia común. Todas las GND del circuito van unidas.'],
    [null, /^(?:\+5V|5V|VBUS)$/, 'Alimentación de 5 V.'],
    [null, /^(?:\+3V3|3V3|3\.3V|3V3\(OUT\))$/, 'Alimentación de 3,3 V.'],
    [/^ESP32|^Arduino|^Raspberry Pi Pico/, /^VIN$/, 'Entrada de alimentación de la placa: 5 V del USB o de una fuente externa. También sirve para dar 5 V a un módulo (por ejemplo un relé).'],
    [null, /^(?:\d+ )?(?:VCC\d?|VDD|VCC ISO|5 V ISO)$/, 'Alimentación (+): a 5 V o 3,3 V según la pieza.'],
    [null, /^(?:\+V(?: \d)?|\+24V|\+12V|DC\+|\+ 12-24 Vdc|QVdc|POWER\+|\d+ POWER\+)$/, 'Positivo de la alimentación de continua.'],
    [null, /^(?:−V(?: \d)?|DC−|POWER−|\d+ POWER−)$/, 'Negativo de la alimentación de continua (0 V).'],
    [null, /^VMOT$/, 'Alimentación de los motores (aparte de la lógica).'],
    [null, /^VSYS$/, 'Entrada de alimentación de la Pico (1,8–5,5 V).'],
    [null, /^(?:\+|\+ \(centro\)|\+ \(rojo\))$/, 'Positivo (+).'],
    [null, /^(?:−|− \(manga\)|− \(negro\))$/, 'Negativo (−).'],
    [null, /^A \(\+\)$/, 'Ánodo (+): hacia el pin o el positivo.'],
    [null, /^K \(−\)$/, 'Cátodo (−): hacia GND, con una resistencia en serie.'],
    [/^Diodo|^LED|^Optoacoplador/, /^(?:\d+ )?A$/, 'Ánodo: entra la corriente.'],
    [/NE555/, /^(?:\d+ )?OUT$/, 'Salida del 555 (hasta 200 mA).'],
    [/^Diodo|^LED|^Optoacoplador/, /^(?:\d+ )?K$/, 'Cátodo: sale la corriente (la raya del diodo).'],
    // transistores
    [/^Transistor|^Optoacoplador/, /^(?:\d+ )?E$/, 'Emisor.'],
    [/^Transistor/, /^B$/, 'Base: la corriente de control (con resistencia desde el pin).'],
    [/^Transistor|^Optoacoplador/, /^(?:\d+ )?C$/, 'Colector: hacia la carga.'],
    [/^MOSFET/, /^G$/, 'Puerta (gate): tensión de control desde el pin.'],
    [/^MOSFET/, /^D$/, 'Drenador (drain): hacia la carga.'],
    [/^MOSFET/, /^S$/, 'Fuente (source): a GND.'],
    [/^Triac/, /^G$/, 'Puerta: impulso de disparo.'],
    [/^Triac/, /^A[12]$/, 'Ánodo del triac: lado de la carga de alterna.'],
    // microcontroladores
    [/^ESP32/, /^GPIO(\d+)(?: \((\w+)\))?$/, (m) => {
      const n = +m[1], extra = esp32Gpio(n);
      if (m[2] && GPIO_EXTRA[m[2]] && !/VP|VN/.test(m[2])) extra.unshift(GPIO_EXTRA[m[2]]);
      return 'GPIO' + n + ': pin ' + (n >= 34 && n <= 39 ? 'de entrada' : 'de entrada o salida') + ' digital (3,3 V)' +
        (extra.length ? '; ' + extra.join('; ') : '') + '. En el código: ' + n + '.';
    }],
    [null, /^GPIO(\d+)(?: \((\w+)\))?$/, (m) => 'GPIO' + m[1] + ': pin de entrada o salida digital (3,3 V)' + (m[2] && GPIO_EXTRA[m[2]] ? '; ' + GPIO_EXTRA[m[2]] : '') + '.'],
    [null, /^GP(\d+)$/, (m) => 'GP' + m[1] + ': pin de entrada o salida digital (3,3 V)' + (+m[1] >= 26 ? '; admite entrada analógica' : '') + '.'],
    [/^Arduino/, /^D(\d+)( ~)?(?: \((\w+)\))?$/, (m) => 'Pin digital ' + m[1] + (m[2] ? ', admite PWM (analogWrite)' : '') + (m[3] ? '; ' + (GPIO_EXTRA[m[3].replace(/\d$/, '')] || m[3]) : '') + '.'],
    [/^Arduino/, /^(?:RX0 \(D0\)|D0 \(RX0?\))$/, 'Pin digital 0: recepción serie (va al TX del otro equipo). Lo usa también el USB.'],
    [/^Arduino/, /^(?:TX1 \(D1\)|D1 \(TX0?\))$/, 'Pin digital 1: transmisión serie (va al RX del otro equipo). Lo usa también el USB.'],
    [/^Arduino/, /^A(\d+)$/, (m) => 'Entrada analógica A' + m[1] + ' (analogRead, 0–5 V); también sirve como pin digital.'],
    [null, /^AREF$/, 'Referencia de tensión para las entradas analógicas.'],
    [null, /^IOREF$/, 'Indica la tensión de trabajo de los pines (5 V).'],
    [null, /^(?:\d+ )?(?:RESET|RST)$/, 'Reinicio: a GND reinicia el chip.'],
    [/^ESP32/, /^EN$/, 'Enable: a GND reinicia el ESP32 (el botón EN).'],
    [null, /^BOOT$/, 'Botón de arranque: modo de carga del programa.'],
    // buses y señales
    [null, /^(?:SDA|XDA)(?:\.\d)?$|_SDA$/, 'SDA: datos del bus I²C. Va al SDA del microcontrolador.'],
    [null, /^(?:SCL|XCL)(?:\.\d)?$|_SCL$/, 'SCL: reloj del bus I²C. Va al SCL del microcontrolador.'],
    [null, /^(?:\d+ )?(?:MOSI|SI|DI)(?:\.\d)?$|_TXD$/, 'MOSI: datos del microcontrolador hacia el módulo (SPI).'],
    [null, /^(?:\d+ )?(?:MISO|SO|SDO)(?:\.\d)?$|_RXD$/, 'MISO: datos del módulo hacia el microcontrolador (SPI).'],
    [null, /^(?:SCK|SCLK)(?:\.\d)?$|_CLK$/, 'Reloj del bus SPI.'],
    [null, /^(?:CS|CSN|CSB|SS|CE\.\d)$|_CS\d?$/, 'Selección de chip (CS): en LOW el módulo atiende al bus SPI.'],
    [null, /^(?:TX|TXD)(?:\.\d)?$/, 'TX: transmite datos serie. Va al RX del otro equipo.'],
    [null, /^(?:RX|RXD)(?:\.\d)?$/, 'RX: recibe datos serie. Va al TX del otro equipo.'],
    [/^Servo/, /^PWM$/, 'Señal de control: un pulso de 0,5–2,5 ms fija el ángulo (librería Servo).'],
    [/^Servo/, /^V\+$/, 'Alimentación del servo (5 V).'],
    [null, /^PWM[\d-]*$/, 'Salida PWM (modulación por ancho de pulso).'],
    [null, /^TRIG$/, 'Disparo: un pulso de 10 µs inicia la medida.'],
    [null, /^ECHO$/, 'Eco: pulso cuya duración es la distancia medida.'],
    [null, /^DQ$/, 'Datos 1-Wire (con resistencia de 4,7 kΩ a VCC).'],
    [null, /^DIN$/, 'Entrada de datos.'],
    [null, /^DOUT$/, 'Salida de datos.'],
    [null, /^(?:OUT|AO|SIG|S)$/, 'Salida de la señal o medida: va a una entrada del microcontrolador.'],
    [null, /^DO$/, 'Salida digital (comparador con umbral ajustable).'],
    [null, /^IN$/, 'Entrada.'],
    [null, /^INT$|^IRQ$/, 'Interrupción: avisa al microcontrolador.'],
    [null, /^(?:VRX|VRY)$/, 'Salida analógica del eje.'],
    [/^Encoder/, /^CLK$/, 'Canal A del encoder.'],
    [/^Encoder/, /^DT$/, 'Canal B del encoder.'],
    [null, /^SW$/, 'Pulsador: se une a GND al pulsar.'],
    [null, /^STEP$/, 'Un pulso = un paso del motor.'],
    [null, /^DIR$/, 'Sentido de giro.'],
    [null, /^(?:EN|ENA|ENB|ENABLE)$/, 'Habilitar (enable).'],
    [/^Driver/, /^IN(\d)$/, (m) => 'Entrada de control ' + m[1] + ' del puente H.'],
    [/^Driver|^Motor/, /^OUT(\d)$/, (m) => 'Salida ' + m[1] + ' hacia el motor.'],
    [/^Motor paso/, /^([AB])([+−])$/, (m) => 'Bobina ' + m[1] + ', extremo ' + m[2] + '.'],
    [/^PLC|^Raspberry PLC/, /^I(\d)\.?(\d)?/, 'Entrada del PLC: lee un sensor, pulsador o final de carrera.'],
    [/^PLC|^Raspberry PLC/, /^Q(\d)\.?(\d)?/, 'Salida del PLC: activa una carga (relé, piloto, válvula).'],
    [/^Raspberry PLC/, /^R\d\.\d · [ab]$/, 'Contacto de un relé del PLC (a y b se unen cuando el relé se activa).'],
    [/^Potenciómetro/, /^(?:W|2)$/, 'Cursor: la tensión variable, a una entrada analógica.'],
    [/^Pulsador 12 mm/, /^([12])\.[lr]$/, (m) => 'Pata ' + m[1] + ': las dos patas ' + m[1] + ' van unidas siempre; al pulsar se unen con las ' + (m[1] === '1' ? '2' : '1') + '.'],
    // maniobra y pasivos con bornes numerados
    [/^Paro de emergencia/, /^(?:1|LÍNEA)$/, 'Entrada del contacto NC: la corriente pasa mientras la seta no está pulsada.'],
    [/^Paro de emergencia/, /^(?:2|REGRESO)$/, 'Salida del contacto NC: se abre al pulsar la seta.'],
    [/^Pulsador \(NA\)/, /^[34]$/, 'Contacto normalmente abierto: se une con el otro borne mientras se pulsa.'],
    [/^Pulsador táctil/, /^\d$/, 'Pata del pulsador: las patas del mismo lado van unidas; al pulsar se une un lado con el otro.'],
    [/^Interruptor de palanca|^Interruptor deslizante/, /^(?:2|COM)$/, 'Común: se une con 1 o con 3 según la posición.'],
    [/^Interruptor de palanca|^Interruptor deslizante/, /^[13]$/, 'Contacto de una de las dos posiciones.'],
    [/^Interruptor basculante/, /^[12]$/, 'Contacto del interruptor: se une con el otro al encenderlo.'],
    [/^Interruptor DIP/, /^(\d)([ab])$/, (m) => 'Interruptor ' + m[1] + ', lado ' + m[2] + ': se une con el ' + m[1] + (m[2] === 'a' ? 'b' : 'a') + ' en ON.'],
    [/^Bornera 6|^Borna|^Tira de pines/, /^\d+$/, 'Borne: une todos los cables que llegan a él.'],
    [/^Resistencia|^Condensador cerámico|^Condensador de poliéster|^Bobina|^Cristal|^Termistor|^Fotorresistencia/, /^\d$/, 'Terminal sin polaridad: se puede conectar en cualquier sentido.'],
    [/^Potenciómetro/, /^[13]$/, 'Extremo de la pista: uno a VCC y el otro a GND.'],
    // módulos
    [/^LED RGB/, /^([RGB])$/, (m) => 'Ánodo del color ' + { R: 'rojo', G: 'verde', B: 'azul' }[m[1]] + ': a un pin con su resistencia.'],
    [/^Display 7/, /^([A-G]|DP)$/, (m) => (m[1] === 'DP' ? 'Punto decimal' : 'Segmento ' + m[1]) + ': a un pin con su resistencia.'],
    [/^Reloj RTC/, /^SQW$/, 'Salida de onda cuadrada (1 Hz…), opcional.'],
    [/^Reloj RTC/, /^32K$/, 'Salida de 32 kHz, opcional.'],
    [/MPU6050/, /^AD0$/, 'Elige la dirección I²C: a GND 0x68, a VCC 0x69.'],
    [/HX711/, /^E([+−])$/, (m) => 'Excitación de la celda de carga (' + m[1] + ').'],
    [/HX711/, /^([AB])([+−])$/, (m) => 'Señal de la celda de carga, canal ' + m[1] + ' (' + m[2] + ').'],
    [/HX711|TM1637/, /^(?:DT|DIO)$/, 'Datos: a un pin digital.'],
    [/TM1637|MAX7219|CD4017/, /^(?:\d+ )?CLK$/, 'Reloj: a un pin digital.'],
    [/ACS712/, /^IP[+−]$/, 'Paso de la corriente que se mide: en serie con la carga.'],
    [/^Teclado/, /^R(\d)$/, (m) => 'Fila ' + m[1] + ' del teclado: a un pin digital.'],
    [/^Teclado/, /^C(\d)$/, (m) => 'Columna ' + m[1] + ' del teclado: a un pin digital.'],
    [/A4988/, /^MS(\d)$/, 'Selección de micropasos.'],
    [/A4988/, /^SLEEP$/, 'Reposo: en LOW apaga el driver (unir con RESET para tenerlo activo).'],
    [/A4988/, /^([12])([AB])$/, (m) => 'Salida a la bobina ' + m[1] + ' del motor.'],
    [/ILI9341/, /^DC$/, 'Dato o comando (D/C).'],
    [/ILI9341/, /^LED$/, 'Retroiluminación: a 3,3 V.'],
    [/HC-05/, /^STATE$/, 'Indica si hay conexión Bluetooth.'],
    [/nRF24/, /^CE$/, 'Activa la radio (chip enable): a un pin digital.'],
    [/MAX485/, /^RO$/, 'Salida de recepción: al RX del microcontrolador.'],
    [/MAX485/, /^(?:RE|DE)$/, 'Control de dirección: HIGH transmite, LOW recibe (RE y DE suelen ir juntos a un pin).'],
    [/MAX485/, /^([AB])$/, (m) => 'Línea ' + m[1] + ' del bus RS-485 (par trenzado).'],
    [/74HC595/, /^Q(\d)$/, (m) => 'Salida ' + m[1] + ' del registro.'],
    [/74HC595/, /^DS$/, 'Datos serie: a un pin digital.'],
    [/74HC595/, /^OE$/, 'Habilitar salidas: a GND.'],
    [/74HC595/, /^ST_CP$/, 'Latch: copia el registro a las salidas.'],
    [/74HC595/, /^SH_CP$/, 'Reloj de desplazamiento.'],
    [/74HC595/, /^MR$/, 'Borrado: a VCC para funcionar.'],
    [/74HC595/, /^Q7S$/, 'Salida serie: a DS del siguiente 74HC595.'],
    [/LM2596/, /^IN([+−])$/, (m) => 'Entrada ' + (m[1] === '+' ? 'positiva' : 'negativa') + ' (tensión sin reducir).'],
    [/LM2596/, /^OUT([+−])$/, (m) => 'Salida ' + (m[1] === '+' ? 'positiva' : 'negativa') + ' (tensión reducida, ajustable).'],
    [/^Caudalímetro/, /^V([+−])$/, 'Alimentación del caudalímetro.'],
    [/^Caudalímetro/, /^P([+−])$/, 'Salida de pulsos (cada pulso = un volumen).'],
    [/^Caudalímetro/, /^mA([+−])$/, 'Salida 4-20 mA proporcional al caudal.'],
    [/conector 15 pines/, /PULSE/, 'Salida de pulsos.'],
    [/conector 15 pines/, /4-20mA/, 'Salida 4-20 mA proporcional al caudal.'],
    [/conector 15 pines/, /DOUT/, 'Salida digital.'],
    [/conector 15 pines/, /A\/TX|B\/RX|RTS/, 'Comunicación serie RS-485/Modbus.'],
    [/^Actuador/, /COM$/, 'Común de las órdenes y finales de carrera.'],
    [/LM35/, /^\+VS$/, 'Alimentación (4–20 V).'],
    [/LM317/, /^ADJ$/, 'Ajuste: fija la tensión de salida con dos resistencias.'],
    [/^Conector jack/, /^detección$/, 'Detecta si hay clavija enchufada.'],
    [/^Conector USB/, /^D[+−]$/, 'Línea de datos USB.'],
    [/^Raspberry PLC/, /^A\d\.\d$/, 'Entrada analógica del PLC (0-10 V).'],
    [/^Raspberry PLC/, /^IN\d$|^OUT\d$|^[AB]\d[+−]$|^PREL/, 'Borne de comunicación o de E/S del PLC (ver el manual).'],
    // integrados (el número de pata ya se quitó)
    [/NE555/, /^CTRL$/, 'Tensión de control (con condensador de 10 nF a GND).'],
    [/NE555/, /^TRIG$/, 'Disparo: por debajo de 1/3 de VCC activa la salida.'],
    [/NE555/, /^THR$/, 'Umbral: por encima de 2/3 de VCC desactiva la salida.'],
    [/NE555/, /^DIS$/, 'Descarga del condensador de temporización.'],
    [/LM358/, /^OUT ([AB])$/, (m) => 'Salida del amplificador ' + m[1] + '.'],
    [/LM358/, /^IN([+−]) ([AB])$/, (m) => 'Entrada ' + (m[1] === '+' ? 'no inversora' : 'inversora') + ' del amplificador ' + m[2] + '.'],
    [/ULN2003/, /^IN(\d)$/, (m) => 'Entrada ' + m[1] + ': desde un pin del microcontrolador.'],
    [/ULN2003/, /^OUT(\d)$/, (m) => 'Salida ' + m[1] + ': conecta la carga a GND al activarse.'],
    [/L293D/, /^EN/, 'Habilitar el puente (o PWM de velocidad).'],
    [/L293D/, /^(\d)A$/, (m) => 'Entrada ' + m[1] + ': desde un pin del microcontrolador.'],
    [/L293D/, /^(\d)Y$/, (m) => 'Salida ' + m[1] + ': al motor.'],
    [/ATtiny|ATmega/, /^P([BCD])(\d)(.*)$/, (m) => 'Puerto ' + m[1] + ', bit ' + m[2] + (m[3].trim() ? ' (' + m[3].trim() + ')' : '') + '.'],
    [/ATmega/, /^AVCC$/, 'Alimentación del convertidor analógico: a VCC.'],
    [/CD4017/, /^Q(\d)$/, (m) => 'Salida ' + m[1] + ': se activa en el pulso ' + m[1] + '.'],
    [/CD4017/, /^CO$/, 'Salida de acarreo: un pulso cada 10.'],
    [/CD4017/, /^CLK INH$/, 'Inhibir el reloj: a GND para contar.'],
    [/MAX232/, /^C\d[+−]$/, 'Condensador de la bomba de carga.'],
    [/MAX232/, /^V[+−]$/, 'Tensión generada para RS-232.'],
    [/MAX232/, /^T\dIN$|^R\dOUT$/, 'Lado TTL: al microcontrolador.'],
    [/MAX232/, /^T\dOUT$|^R\dIN$/, 'Lado RS-232: al conector DB9.'],
    [/74HC00/, /^(\d)([AB])$/, (m) => 'Entrada ' + m[2] + ' de la puerta ' + m[1] + '.'],
    [/74HC00/, /^(\d)Y$/, (m) => 'Salida de la puerta ' + m[1] + '.'],
  ];

  function clean(name) {
    return String(name || '').replace(/ · pin \d+$/, '').replace(/·\d+$/, '').trim();
  }
  function part(comp) {
    const r = PARTS.find(([re]) => re.test(comp || ''));
    return r ? r[1] : '';
  }
  function pin(comp, name) {
    comp = comp || '';
    const raw = String(name || ''), t = clean(raw);
    const phys = / · pin (\d+)$/.exec(raw);
    const tail = phys ? ' Pin físico ' + phys[1] + ' del conector.' : '';
    // los integrados llevan delante el número de pata («3 OUT»): si no encaja, se prueba sin él
    for (const s of t.match(/^\d+ \S/) ? [t, t.replace(/^\d+ /, '')] : [t]) {
      for (const [cre, nre, out] of PINS) {
        if (cre && !cre.test(comp)) continue;
        const m = nre.exec(s);
        if (m) return (typeof out === 'function' ? out(m, comp) : out) + tail;
      }
    }
    return tail.trim();
  }

  window.Fichas = { part, pin };
})();
