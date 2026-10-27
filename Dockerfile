FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATABASE_PATH=/data/diagramas.db \
    PORT=8000 \
    ARDUINO_DIRECTORIES_DATA=/opt/arduino/data \
    ARDUINO_DIRECTORIES_USER=/opt/arduino/user \
    ARDUINO_DIRECTORIES_DOWNLOADS=/opt/arduino/staging \
    QEMU_ESP32_DIR=/app/bin/qemu-esp32-linux

# Simulador: el compilador oficial de Arduino (arduino-cli) con el núcleo AVR (Uno, Nano, Mega) y Servo.
# Los núcleos de la Pico y del ESP32 se descargan solos la primera vez que se usan; viven en /opt/arduino,
# que docker-compose monta como volumen para no volver a descargarlos.
ARG ARDUINO_CLI_VERSION=1.5.1
# libgcrypt20 y libfdt1: los pide el QEMU del ESP32 (bin/qemu-esp32-linux, de PICSimLab)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates libgcrypt20 libfdt1 \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL "https://downloads.arduino.cc/arduino-cli/arduino-cli_${ARDUINO_CLI_VERSION}_Linux_64bit.tar.gz" \
    | tar -xz -C /usr/local/bin arduino-cli \
 && arduino-cli core update-index \
 && arduino-cli core install arduino:avr \
 && arduino-cli lib install Servo

WORKDIR /app
COPY requirements.txt .
# pyserial: lo importa esptool (núcleo ESP32) al generar el .bin
RUN pip install --no-cache-dir -r requirements.txt pyserial
COPY . .

# La base de datos vive en /data: monta ahí un volumen para no perderla al redesplegar.
VOLUME ["/data"]
EXPOSE 8000

# Un solo proceso con hilos: las sesiones del ESP32 y los eventos del simulador viven en memoria.
CMD gunicorn --workers 1 --threads 16 --timeout 900 --bind 0.0.0.0:${PORT} app:app
