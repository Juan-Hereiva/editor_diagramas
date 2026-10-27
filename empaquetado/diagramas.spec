# -*- mode: python ; coding: utf-8 -*-
# Receta de PyInstaller para la versión de escritorio (escritorio.py). Sirve en Windows y en Linux:
#   Windows  empaquetado\construir_windows.bat   → dist\DiagramasElectricos\ + instalador .exe
#   Linux    empaquetado/construir_deb.sh (en Docker) → dist/diagramas-electricos_<versión>_amd64.deb
# Carpeta y no un único .exe: el simulador del ESP32 relanza el ejecutable por cada simulación y un
# .exe de un solo archivo tendría que descomprimirse entero (QEMU incluido) cada vez.
import os
import sys

ROOT = os.path.abspath(os.path.join(SPECPATH, '..'))
WIN = sys.platform == 'win32'
J = lambda *p: os.path.join(ROOT, *p)

# arduino-cli: el de bin/ en Windows; en Linux lo descarga construir_deb.sh (ARDUINO_CLI_BIN)
cli = J('bin', 'arduino-cli.exe') if WIN else os.environ['ARDUINO_CLI_BIN']

datas = [
    (J('static'), 'static'),
    (J('componentes_placas.json'), '.'),
    (J('bin', 'LICENSE.txt'), 'bin'),
    (cli, 'bin'),
    # QEMU del ESP32 (PICSimLab): siempre en bin/qemu-esp32, que es donde lo busca simulador.py
    (J('bin', 'qemu-esp32' if WIN else 'qemu-esp32-linux'), os.path.join('bin', 'qemu-esp32')),
    # el runner del ESP32 se ejecuta con un Python normal (ver runner_python() en simulador.py)
    (J('esp32_runner.py'), '.'),
]
if WIN:
    datas.append((J('build', 'python-embed'), 'python-runner'))   # lo descarga construir_windows.bat
# opcionales: equipos de un tablero propio y el diagrama que se carga en una base nueva
for extra in ('componentes_tablero.json', 'ejemplo.json'):
    if os.path.exists(J(extra)):
        datas.append((J(extra), '.'))

a = Analysis(
    [J('escritorio.py')],
    pathex=[ROOT],
    datas=datas,
    hiddenimports=['app', 'simulador'],
    excludes=['tkinter', 'gunicorn', 'unittest', 'pydoc_data'],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name='DiagramasElectricos' if WIN else 'diagramas-electricos',
    console=False,
    icon=os.path.join(SPECPATH, 'icono.ico') if WIN else None,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name='DiagramasElectricos' if WIN else 'diagramas-electricos', upx=False)
