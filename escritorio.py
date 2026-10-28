# -*- coding: utf-8 -*-
"""Versión de escritorio (instalador .exe de Windows y paquete .deb de Linux).

Arranca el servidor en este PC (solo escucha en 127.0.0.1) y abre la app en una ventana propia:
  Windows  pywebview con WebView2 (el motor de Edge que trae Windows 10/11)
  Linux    ventana_gtk.py con WebKitGTK, ejecutada con el python3 del sistema
Si no se puede, la abre en Edge/Chrome/Chromium en modo aplicación o en el navegador por defecto.
Los diagramas se guardan en la carpeta del usuario, no junto al programa:
  Windows  %LOCALAPPDATA%\\DiagramasElectricos\\diagramas.db
  Linux    ~/.local/share/diagramas-electricos/diagramas.db
Cada página avisa al servidor cada 20 s (/api/latido); cuando no queda ninguna abierta, se cierra solo."""
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

PORT = 47215            # fijo: el navegador guarda el tema y el portapapeles de la app por puerto
IDLE_EXIT = 180         # s sin noticias de ninguna ventana (una pestaña en segundo plano avisa cada minuto)
FIRST_WAIT = 300        # s de margen si la ventana tarda en abrir la primera vez
OTHERS_WAIT = 90        # Linux: s que sigue el servidor tras cerrar su ventana, por si otra instancia lo usa
TITLE = "Diagramas eléctricos"
OPEN_EXTRA = {"fn": None}   # abre otra ventana de la app en este proceso (solo con pywebview)
ES = {      # textos de pywebview (diálogo de guardar descargas, confirmaciones)
    "global.quitConfirmation": "¿Seguro que quieres salir?", "global.ok": "Aceptar", "global.quit": "Salir",
    "global.cancel": "Cancelar", "global.saveFile": "Guardar archivo",
    "windows.fileFilter.allFiles": "Todos los archivos", "windows.fileFilter.otherFiles": "Otros tipos de archivo",
    "linux.openFile": "Abrir archivo", "linux.openFiles": "Abrir archivos", "linux.openFolder": "Abrir carpeta",
}


def data_dir():
    if os.name == "nt":
        return os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "DiagramasElectricos")
    return os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "diagramas-electricos")


def already_running(url):
    try:
        with urllib.request.urlopen(url + "api/latido", timeout=1.5) as r:
            return json.load(r).get("app") == "diagramas-electricos"
    except (OSError, ValueError):
        return False


def ask_window(url):
    """Pide a la instancia que ya está abierta que abra otra ventana suya."""
    try:
        req = urllib.request.Request(url + "api/ventana", data=b"", method="POST")
        with urllib.request.urlopen(req, timeout=3) as r:
            return json.load(r).get("ok") is True
    except (OSError, ValueError):
        return False


def port_free(port):
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def browsers():
    if os.name == "nt":
        roots = [os.environ.get(k, "") for k in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA")]
        rel = [r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe", r"Chromium\Application\chrome.exe"]
        return [os.path.join(r, p) for p in rel for r in roots if r and os.path.exists(os.path.join(r, p))]
    names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "brave-browser"]
    return [p for p in map(shutil.which, names) if p]


def system_env():
    """Entorno para lanzar programas del sistema: PyInstaller apunta LD_LIBRARY_PATH a sus propias
    bibliotecas y el python3 del sistema (GTK, WebKit) cargaría las que no son."""
    env = dict(os.environ)
    if "LD_LIBRARY_PATH_ORIG" in env:
        env["LD_LIBRARY_PATH"] = env["LD_LIBRARY_PATH_ORIG"]
    elif getattr(sys, "frozen", False):
        env.pop("LD_LIBRARY_PATH", None)
    return env


def webview_window(url, home):
    """Windows: ventana de pywebview (WebView2). Bloquea hasta cerrar todas sus ventanas."""
    try:
        import webview
        from webview.platforms import edgechromium
    except Exception as e:          # sin pywebview o sin .NET
        print("ventana propia no disponible:", repr(e))
        return False
    webview.settings["ALLOW_DOWNLOADS"] = True          # exportar PNG/SVG, copias: diálogo «Guardar como»
    external = edgechromium.EdgeChrome.on_new_window_request

    def new_window(self, sender, args):
        uri = str(args.get_Uri())
        if uri.startswith(url):     # página de la app (p. ej. «Crear componente con foto»): otra ventana
            args.set_Handled(True)
            webview.create_window(TITLE, uri, width=1280, height=820, min_size=(760, 520))
        else:                       # enlaces de fuera: el navegador del sistema
            external(self, sender, args)

    edgechromium.EdgeChrome.on_new_window_request = new_window
    # si se abre el programa otra vez, la ventana nueva la pone este proceso (POST /api/ventana):
    # así, al cerrar la última ventana, el programa termina en el acto
    OPEN_EXTRA["fn"] = lambda: webview.create_window(TITLE, url, width=1440, height=900, min_size=(760, 520), maximized=True)
    loaded = []
    try:
        win = webview.create_window(TITLE, url, width=1440, height=900, min_size=(760, 520), maximized=True)
        win.events.loaded += lambda: loaded.append(1)
        webview.start(private_mode=False, storage_path=os.path.join(home, "app"), localization=ES)
    except Exception as e:          # p. ej. sin el runtime de WebView2
        print("ventana propia:", repr(e))
    OPEN_EXTRA["fn"] = None
    return bool(loaded)


def gtk_window(url, home):
    """Linux: ventana_gtk.py con el python3 del sistema (PyGObject y WebKitGTK no van en el paquete)."""
    here = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    script, py = os.path.join(here, "ventana_gtk.py"), shutil.which("python3")
    if not py or not os.path.exists(script):
        return False
    icon = os.path.join(here, "static", "icons", "icon-192.png")
    r = subprocess.run([py, script, url, os.path.join(home, "app"), icon, TITLE], env=system_env())
    return r.returncode == 0       # 3: faltan GTK/WebKit → navegador


def show(url, home):
    """Abre la app. True si fue en una ventana propia (y ya se cerró); False si quedó en el navegador.
    DIAGRAMAS_SIN_VENTANA=1: no abre nada (pruebas, o para entrar desde otro navegador)."""
    if os.environ.get("DIAGRAMAS_SIN_VENTANA") == "1":
        return False
    if (webview_window if os.name == "nt" else gtk_window)(url, home):
        return True
    open_window(url, os.path.join(home, "ventana"))
    return False


def open_window(url, profile):
    """Plan B: el navegador en modo aplicación, sin barras. Con un perfil aparte, Chrome/Edge abren un
    proceso nuevo (si no, la ventana se uniría al navegador que ya esté abierto)."""
    for exe in browsers():
        try:
            subprocess.Popen([exe, "--app=" + url, "--user-data-dir=" + profile, "--no-first-run",
                              "--no-default-browser-check", "--window-size=1440,900"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             creationflags=getattr(subprocess, "DETACHED_PROCESS", 0))
            return
        except OSError:
            continue
    webbrowser.open(url)


def main():
    home = data_dir()
    os.makedirs(home, exist_ok=True)
    os.environ.setdefault("DATABASE_PATH", os.path.join(home, "diagramas.db"))
    if sys.stdout is None or sys.stderr is None:          # ejecutable sin consola (Windows)
        log = open(os.path.join(home, "registro.txt"), "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stdout or log
        sys.stderr = sys.stderr or log

    port = PORT
    url = "http://127.0.0.1:%d/" % port
    if already_running(url):        # otra instancia ya tiene el servidor: solo hace falta una ventana
        if not ask_window(url):
            show(url, home)
        return
    if not port_free(port):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        url = "http://127.0.0.1:%d/" % port

    import app as web
    from flask import jsonify
    from werkzeug.serving import make_server

    beat = {"last": 0.0}

    def latido():
        beat["last"] = time.time()
        return jsonify(app="diagramas-electricos")

    def ventana():
        if not OPEN_EXTRA["fn"]:
            return jsonify(ok=False), 409
        OPEN_EXTRA["fn"]()
        return jsonify(ok=True)

    web.app.add_url_rule("/api/latido", "latido", latido, methods=["GET", "POST"])
    web.app.add_url_rule("/api/ventana", "ventana", ventana, methods=["POST"])
    server = make_server("127.0.0.1", port, web.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print("Diagramas electricos -> %s (datos en %s)" % (url, home))
    own = show(url, home)           # con ventana propia, vuelve cuando se cierra
    if own and os.name == "nt":     # pywebview: todas las ventanas eran de este proceso
        server.shutdown()
        return

    start = time.time()
    while True:
        now = time.time()
        if own:                     # su ventana ya se cerró: sigue solo si otra instancia aún lo usa
            if now - max(beat["last"], start) > OTHERS_WAIT:
                break
        elif beat["last"] and now - beat["last"] > IDLE_EXIT:
            break
        elif not beat["last"] and now - start > FIRST_WAIT:
            break
        time.sleep(5)
    server.shutdown()


if __name__ == "__main__":
    main()
