#!/bin/sh
# Construye dist/diagramas-electricos_<versión>_amd64.deb. Se ejecuta dentro de Docker, en Debian 11
# (glibc 2.31) para que el paquete funcione también en Ubuntu 20.04 / 22.04 / 24.04 y Debian 11 / 12:
#
#   docker run --rm -v "$PWD:/src" -w /src python:3.12-slim-bullseye sh empaquetado/construir_deb.sh
#
# El paquete instala el programa en /opt/diagramas-electricos, el comando diagramas-electricos y su
# entrada en el menú de aplicaciones. Los diagramas van a ~/.local/share/diagramas-electricos.
set -eu
VERSION="${VERSION:-1.1.0}"
CLI_VERSION=1.5.1
B=build/linux

# binutils (objdump) lo necesita PyInstaller. Solo eso de apt: Debian 11 ya está archivado y a veces
# el espejo de seguridad no tiene los paquetes que anuncia (curl, ca-certificates).
apt-get update -qq
apt-get install -y -qq --no-install-recommends binutils >/dev/null
pip install -q --root-user-action=ignore -r requirements.txt pyinstaller

mkdir -p "$B"
python -c "import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])" \
  "https://downloads.arduino.cc/arduino-cli/arduino-cli_${CLI_VERSION}_Linux_64bit.tar.gz" "$B/arduino-cli.tar.gz"
tar -xzf "$B/arduino-cli.tar.gz" -C "$B" arduino-cli
ARDUINO_CLI_BIN="$PWD/$B/arduino-cli" pyinstaller --noconfirm --clean --distpath "$B/dist" --workpath "$B/work" empaquetado/diagramas.spec

R="$B/raiz"
rm -rf "$R"
mkdir -p "$R/DEBIAN" "$R/opt" "$R/usr/bin" "$R/usr/share/applications" \
         "$R/usr/share/icons/hicolor/512x512/apps" "$R/usr/share/icons/hicolor/192x192/apps"
cp -a "$B/dist/diagramas-electricos" "$R/opt/"
chmod 755 "$R/opt/diagramas-electricos/diagramas-electricos" "$R/opt/diagramas-electricos/_internal/bin/arduino-cli"
ln -s /opt/diagramas-electricos/diagramas-electricos "$R/usr/bin/diagramas-electricos"
cp static/icons/icon-512.png "$R/usr/share/icons/hicolor/512x512/apps/diagramas-electricos.png"
cp static/icons/icon-192.png "$R/usr/share/icons/hicolor/192x192/apps/diagramas-electricos.png"

cat > "$R/usr/share/applications/diagramas-electricos.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Diagramas eléctricos
Comment=Editor y simulador de diagramas eléctricos (Arduino, ESP32, Raspberry Pi)
Exec=diagramas-electricos
Icon=diagramas-electricos
Categories=Development;Electronics;Engineering;
Terminal=false
StartupNotify=true
EOF

# python3 + python3-serial: esptool del núcleo ESP32 y el runner de QEMU (simulador.py, runner_python)
# libgcrypt20, libfdt1, libglib2.0-0: las pide el QEMU del ESP32 (bin/qemu-esp32)
# python3-gi + GTK 3 + WebKitGTK: la ventana propia (ventana_gtk.py)
# Recommends Chromium/Chrome: el simulador de Orange Pi / Raspberry Pi (Python) necesita JSPI, que
# WebKitGTK no tiene; esas placas se pueden abrir en el navegador
cat > "$R/DEBIAN/control" <<EOF
Package: diagramas-electricos
Version: $VERSION
Section: electronics
Priority: optional
Architecture: amd64
Depends: libc6 (>= 2.31), python3, python3-serial, libgcrypt20, libfdt1, libglib2.0-0, xdg-utils, python3-gi, gir1.2-gtk-3.0, gir1.2-webkit2-4.1 | gir1.2-webkit2-4.0
Recommends: chromium | chromium-browser | google-chrome-stable | microsoft-edge-stable
Installed-Size: $(du -sk "$R/opt" | cut -f1)
Maintainer: Diagramas electricos <diagramas@localhost>
Description: Editor y simulador de diagramas eléctricos
 Dibuja diagramas de cableado con cables ortogonales automáticos y simula
 Arduino Uno/Nano/Mega, Raspberry Pi Pico, ESP32 y Raspberry Pi / Orange Pi
 (Python). Se abre en su propia ventana; los datos se guardan en
 ~/.local/share/diagramas-electricos.
 .
 La simulación del ESP32 (QEMU de PICSimLab) necesita glibc 2.34 o más:
 Ubuntu 22.04+ o Debian 12+. El resto funciona desde Ubuntu 20.04 / Debian 11.
EOF

find "$R" -type d -exec chmod 755 {} +
mkdir -p dist
dpkg-deb --build --root-owner-group "$R" "dist/diagramas-electricos_${VERSION}_amd64.deb"
ls -la dist/*.deb
