# -*- coding: utf-8 -*-
"""Versión de escritorio (instalador .exe de Windows y paquete .deb de Linux).

Arranca el servidor en este PC (solo escucha en 127.0.0.1) y abre la app en su propia ventana
(Edge, Chrome o Chromium en modo aplicación; si no hay ninguno, el navegador por defecto).
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


def open_window(url, profile):
    """Ventana propia sin barras del navegador. Con un perfil aparte, Chrome/Edge abren un proceso
    nuevo (si no, la ventana se uniría al navegador que ya esté abierto).
    DIAGRAMAS_SIN_VENTANA=1: no abre nada (pruebas, o para entrar desde otro navegador)."""
    if os.environ.get("DIAGRAMAS_SIN_VENTANA") == "1":
        return
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
    if already_running(url):
        open_window(url, os.path.join(home, "ventana"))
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

    web.app.add_url_rule("/api/latido", "latido", latido, methods=["GET", "POST"])
    server = make_server("127.0.0.1", port, web.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print("Diagramas electricos -> %s (datos en %s)" % (url, home))
    open_window(url, os.path.join(home, "ventana"))

    start = time.time()
    while True:
        time.sleep(5)
        now = time.time()
        if beat["last"] and now - beat["last"] > IDLE_EXIT:
            break
        if not beat["last"] and now - start > FIRST_WAIT:
            break
    server.shutdown()


if __name__ == "__main__":
    main()
