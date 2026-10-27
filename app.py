"""
Editor de diagramas eléctricos: servidor.

Flask + SQLite. Sirve la interfaz web (carpeta static/) y una API REST para
guardar diagramas y la biblioteca de componentes.

Variables de entorno:
  DATABASE_PATH  ruta del archivo SQLite   (por defecto data/diagramas.db)
  APP_USER       usuario para proteger la app con contraseña (opcional)
  APP_PASSWORD   contraseña                                   (opcional)
  PORT           puerto al ejecutar con `python app.py`       (por defecto 5000)
"""
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone

import mimetypes
from flask import Flask, Response, abort, g, jsonify, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DB_PATH = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "data", "diagramas.db"))
APP_USER = os.environ.get("APP_USER", "")
APP_PASSWORD = os.environ.get("APP_PASSWORD", "")

mimetypes.add_type('application/wasm', '.wasm')   # Pyodide (Python del simulador)
app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 40 * 1024 * 1024  # diagramas con fotos incrustadas

from simulador import bp as simulador_bp  # noqa: E402
app.register_blueprint(simulador_bp)


# Base de datos

SCHEMA = """
CREATE TABLE IF NOT EXISTS diagrams (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    description  TEXT    NOT NULL DEFAULT '',
    data         TEXT    NOT NULL DEFAULT '{}',
    thumbnail    TEXT    NOT NULL DEFAULT '',
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS components (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    category     TEXT    NOT NULL DEFAULT 'General',
    kind         TEXT    NOT NULL DEFAULT 'component',
    width        INTEGER NOT NULL DEFAULT 120,
    height       INTEGER NOT NULL DEFAULT 80,
    color        TEXT    NOT NULL DEFAULT '#eef2f7',
    image        TEXT    NOT NULL DEFAULT '',
    show_labels  INTEGER NOT NULL DEFAULT 1,
    terminals    TEXT    NOT NULL DEFAULT '[]',
    builtin      INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL
);
"""


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def _t(name, x, y):
    """Borne con posición relativa (0..1) dentro del componente."""
    return {"id": "t" + uuid.uuid4().hex[:8], "name": name, "x": round(x, 4), "y": round(y, 4)}


def builtin_components():
    """Biblioteca inicial: componentes genéricos dibujados (sin foto)."""
    c = []

    def add(name, category, w, h, color, terminals, kind="component", show=1):
        c.append(dict(name=name, category=category, kind=kind, width=w, height=h,
                      color=color, image="", show_labels=show, terminals=terminals))

    AC, PROT, ALIM, MANDO, CTRL, CAMPO, BAS = (
        "Acometida AC", "Protección", "Alimentación DC", "Mando y maniobra",
        "Control", "Campo", "Básicos")

    add("Empalme / nodo", BAS, 22, 22, "#111827", [_t("", 0.5, 0.5)], kind="junction", show=0)
    add("Bornera 6 polos", BAS, 170, 44, "#e5e7eb",
        [_t(str(i), (i - 0.5) / 6, 0) for i in range(1, 7)] +
        [_t(str(i), (i - 0.5) / 6, 1) for i in range(1, 7)])
    add("Barra de tierra", BAS, 220, 26, "#bbf7d0",
        [_t("PE", x, 0) for x in (0.1, 0.26, 0.42, 0.58, 0.74, 0.9)])

    add("Toma de corriente", AC, 130, 60, "#cbd5e1",
        [_t("L", 0.25, 1), _t("N", 0.5, 1), _t("PE", 0.75, 1)])
    add("Interruptor diferencial 2P", PROT, 84, 124, "#f1f5f9",
        [_t("L", 0.3, 0), _t("N", 0.7, 0), _t("L'", 0.3, 1), _t("N'", 0.7, 1)])
    add("Magnetotérmico 1P", PROT, 50, 110, "#f1f5f9", [_t("1", 0.5, 0), _t("2", 0.5, 1)])
    add("Fusible", PROT, 40, 80, "#fff7ed", [_t("1", 0.5, 0), _t("2", 0.5, 1)])
    add("Supresor de picos (MOV/TVS)", PROT, 60, 60, "#ffedd5", [_t("1", 0.5, 0), _t("2", 0.5, 1)])

    add("Fuente 24 V DC (carril DIN)", ALIM, 150, 170, "#dcfce7",
        [_t("−V", 0.15, 0), _t("−V", 0.35, 0), _t("+V", 0.65, 0), _t("+V", 0.85, 0),
         _t("PE", 0.25, 1), _t("N", 0.5, 1), _t("L", 0.75, 1)])

    add("Paro de emergencia (NC)", MANDO, 70, 70, "#fee2e2", [_t("1", 0.5, 0), _t("2", 0.5, 1)])
    add("Pulsador (NA)", MANDO, 64, 64, "#e0f2fe", [_t("3", 0.5, 0), _t("4", 0.5, 1)])
    add("Relé 24 V (conmutado)", MANDO, 96, 116, "#fef9c3",
        [_t("A1", 0.25, 0), _t("A2", 0.75, 0), _t("NC", 0.2, 1), _t("COM", 0.5, 1), _t("NO", 0.8, 1)])
    add("Contactor 3P + aux", MANDO, 150, 160, "#e2e8f0",
        [_t("1L1", 0.15, 0), _t("3L2", 0.35, 0), _t("5L3", 0.55, 0), _t("A1", 0.82, 0),
         _t("2T1", 0.15, 1), _t("4T2", 0.35, 1), _t("6T3", 0.55, 1), _t("A2", 0.82, 1),
         _t("13", 1, 0.35), _t("14", 1, 0.65)])
    add("Módulo de 2 relés", MANDO, 140, 110, "#fde68a",
        [_t("DC+", 0, 0.2), _t("IN1", 0, 0.4), _t("IN2", 0, 0.6), _t("DC−", 0, 0.8),
         _t("COM1", 1, 0.2), _t("NO1", 1, 0.4), _t("COM2", 1, 0.6), _t("NO2", 1, 0.8)])

    plc = [_t("+24V", 0.05, 0), _t("0V", 0.15, 0)]
    plc += [_t("I%d" % i, 0.27 + i * 0.096, 0) for i in range(8)]
    plc += [_t("COM", 0.08, 1)]
    plc += [_t("Q%d" % i, 0.27 + i * 0.096, 1) for i in range(8)]
    add("PLC genérico (8E / 8S)", CTRL, 270, 150, "#dbeafe", plc)

    add("Actuador de válvula ON/OFF", CAMPO, 150, 120, "#ede9fe",
        [_t("1 L", 0, 0.12), _t("2 N", 0, 0.3), _t("4 COM", 0, 0.48),
         _t("5 FC abierto", 0, 0.66), _t("6 FC cerrado", 0, 0.84)])
    add("Motor trifásico", CAMPO, 100, 100, "#e2e8f0",
        [_t("U", 0.25, 0), _t("V", 0.5, 0), _t("W", 0.75, 0), _t("PE", 0.5, 1)])
    add("Sensor 3 hilos (PNP)", CAMPO, 90, 60, "#cffafe",
        [_t("+", 0.2, 1), _t("−", 0.5, 1), _t("S", 0.8, 1)])
    add("Caudalímetro (pulsos + 4-20 mA)", CAMPO, 130, 150, "#cffafe",
        [_t("V+", 0, 0.12), _t("V−", 0, 0.26), _t("P+", 0, 0.4), _t("P−", 0, 0.54),
         _t("mA+", 0, 0.68), _t("mA−", 0, 0.82)])
    add("Lámpara piloto", CAMPO, 50, 50, "#fef08a", [_t("X1", 0.5, 0), _t("X2", 0.5, 1)])
    return c


EXAMPLE_PATH = os.path.join(BASE_DIR, "ejemplo.json")


BOARDS_PATH = os.path.join(BASE_DIR, "componentes_placas.json")
TABLERO_PATH = os.path.join(BASE_DIR, "componentes_tablero.json")


def sync_board_components(db):
    """Placas y módulos dibujados (tools/placas.py): se añaden los que falten y se actualizan
    los de serie si cambió su dibujo. Los componentes creados por el usuario no se tocan."""
    boards = []
    for path in (BOARDS_PATH, TABLERO_PATH):     # el segundo es opcional (equipos de un tablero propio)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                boards += json.load(f)
    ts = now()
    for c in boards:
        terms = json.dumps(c["terminals"], ensure_ascii=False)
        row = db.execute("SELECT id, terminals FROM components WHERE name=? AND builtin=1", (c["name"],)).fetchone()
        if row:
            # cada borne conserva su id de antes (se asocia por nombre y orden): así los diagramas
            # que ya usan este componente no pierden sus cables al pulsar «Actualizar desde biblioteca»
            old = {}
            for t in json.loads(row[1] or "[]"):
                old.setdefault(t.get("name", ""), []).append(t.get("id"))
            used = {}
            taken = set()
            for t in c["terminals"]:
                k = t["name"]
                i = used.get(k, 0)
                if i < len(old.get(k, [])) and old[k][i] not in taken:
                    t["id"] = old[k][i]
                used[k] = i + 1
                taken.add(t["id"])
            if len(taken) != len(c["terminals"]):          # nunca dos bornes con el mismo id
                for t in c["terminals"]:
                    t["id"] = t["id"]
                seen_ids = set()
                for j, t in enumerate(c["terminals"]):
                    if t["id"] in seen_ids:
                        t["id"] = "%s_%d" % (t["id"], j)
                    seen_ids.add(t["id"])
            terms = json.dumps(c["terminals"], ensure_ascii=False)
            db.execute("UPDATE components SET category=?, width=?, height=?, image=?, show_labels=?, terminals=?, updated_at=?"
                       " WHERE id=? AND (image<>? OR terminals<>? OR category<>?)",
                       (c["category"], c["width"], c["height"], c["image"], 1 if c["show_labels"] else 0, terms, ts,
                        row[0], c["image"], terms, c["category"]))
        else:
            db.execute("INSERT INTO components (name, category, kind, width, height, color, image, show_labels, terminals,"
                       " builtin, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)",
                       (c["name"], c["category"], "component", c["width"], c["height"], c.get("color", "#ffffff"), c["image"],
                        1 if c["show_labels"] else 0, terms, ts, ts))


def init_db():
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    fresh = not os.path.exists(DB_PATH)
    db = sqlite3.connect(DB_PATH)
    try:
        db.executescript(SCHEMA)
        cols = [r[1] for r in db.execute("PRAGMA table_info(diagrams)")]
        if "sketch" not in cols:      # código del simulador, aparte del dibujo
            db.execute("ALTER TABLE diagrams ADD COLUMN sketch TEXT NOT NULL DEFAULT ''")
            db.execute("ALTER TABLE diagrams ADD COLUMN sim_board TEXT NOT NULL DEFAULT 'uno'")
        count = db.execute("SELECT COUNT(*) FROM components").fetchone()[0]
        if count == 0:
            ts = now()
            for c in builtin_components():
                db.execute(
                    "INSERT INTO components (name, category, kind, width, height, color, image,"
                    " show_labels, terminals, builtin, created_at, updated_at)"
                    " VALUES (?,?,?,?,?,?,?,?,?,1,?,?)",
                    (c["name"], c["category"], c["kind"], c["width"], c["height"], c["color"],
                     c["image"], c["show_labels"], json.dumps(c["terminals"], ensure_ascii=False),
                     ts, ts))
        sync_board_components(db)
        # Solo la primera vez: un diagrama de ejemplo para ver cómo funciona.
        if fresh and os.path.exists(EXAMPLE_PATH):
            with open(EXAMPLE_PATH, encoding="utf-8") as f:
                ej = json.load(f)
            ts = now()
            db.execute(
                "INSERT INTO diagrams (name, description, data, thumbnail, created_at, updated_at)"
                " VALUES (?,?,?,?,?,?)",
                (ej.get("name", "Ejemplo"), ej.get("description", ""),
                 json.dumps(ej.get("data", {}), ensure_ascii=False), ej.get("thumbnail", ""), ts, ts))
        db.commit()
    finally:
        db.close()


# Protección opcional

@app.before_request
def basic_auth():
    if not (APP_USER and APP_PASSWORD):
        return None
    if request.path == "/api/health":
        return None
    auth = request.authorization
    if auth and auth.username == APP_USER and auth.password == APP_PASSWORD:
        return None
    return Response("Acceso restringido", 401,
                    {"WWW-Authenticate": 'Basic realm="Diagramas electricos"'})


# Utilidades

def body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        abort(400, description="Se esperaba un objeto JSON")
    return data


def clean_name(value, fallback):
    value = (value or "").strip()
    return value[:200] if value else fallback


def clean_terminals(raw):
    if not isinstance(raw, list):
        abort(400, description="terminals debe ser una lista")
    out = []
    for t in raw[:300]:
        if not isinstance(t, dict):
            continue
        try:
            x = min(max(float(t.get("x", 0)), 0.0), 1.0)
            y = min(max(float(t.get("y", 0)), 0.0), 1.0)
        except (TypeError, ValueError):
            abort(400, description="Coordenadas de borne no válidas")
        tid = str(t.get("id") or ("t" + uuid.uuid4().hex[:8]))[:40]
        out.append({"id": tid, "name": str(t.get("name", ""))[:40], "x": round(x, 4), "y": round(y, 4)})
    return out


def diagram_row(r, with_data=True):
    d = {"id": r["id"], "name": r["name"], "description": r["description"],
         "thumbnail": r["thumbnail"], "created_at": r["created_at"], "updated_at": r["updated_at"]}
    if with_data:
        try:
            d["data"] = json.loads(r["data"] or "{}")
        except json.JSONDecodeError:
            d["data"] = {}
    return d


def component_row(r):
    return {"id": r["id"], "name": r["name"], "category": r["category"], "kind": r["kind"],
            "width": r["width"], "height": r["height"], "color": r["color"], "image": r["image"],
            "show_labels": bool(r["show_labels"]), "terminals": json.loads(r["terminals"] or "[]"),
            "builtin": bool(r["builtin"]), "updated_at": r["updated_at"]}


@app.errorhandler(400)
@app.errorhandler(404)
@app.errorhandler(413)
@app.errorhandler(503)
def json_error(e):
    if request.path.startswith("/api/"):
        return jsonify(error=getattr(e, "description", str(e))), e.code
    return e


# Páginas

@app.get("/sw.js")
def service_worker():
    # en la raíz para que controle toda la app; sin caché del navegador para que se actualice
    res = send_from_directory(STATIC_DIR, "sw.js", mimetype="text/javascript")
    res.headers["Cache-Control"] = "no-cache"
    return res


@app.get("/manifest.webmanifest")
def manifest():
    return send_from_directory(STATIC_DIR, "manifest.webmanifest", mimetype="application/manifest+json")


@app.get("/")
def page_index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/guia")
def guia_page():
    return send_from_directory(STATIC_DIR, "guia.html")


@app.get("/simulador")
def simulador_page():
    return send_from_directory(STATIC_DIR, "simulador.html")


@app.get("/api/diagrams/<int:did>/sketch")
def get_sketch(did):
    row = get_db().execute("SELECT sketch, sim_board FROM diagrams WHERE id=?", (did,)).fetchone()
    if not row:
        abort(404, description="Diagrama no encontrado")
    return jsonify(code=row["sketch"], board=row["sim_board"])


@app.put("/api/diagrams/<int:did>/sketch")
def put_sketch(did):
    b = body()
    db = get_db()
    if not db.execute("SELECT 1 FROM diagrams WHERE id=?", (did,)).fetchone():
        abort(404, description="Diagrama no encontrado")
    db.execute("UPDATE diagrams SET sketch=?, sim_board=? WHERE id=?",
               (str(b.get("code") or "")[:500000], str(b.get("board") or "uno")[:20], did))
    db.commit()
    return jsonify(ok=True)


@app.get("/editor")
def page_editor():
    return send_from_directory(STATIC_DIR, "editor.html")


@app.get("/componentes")
def page_components():
    return send_from_directory(STATIC_DIR, "components.html")


@app.get("/api/health")
def health():
    return jsonify(ok=True)


# Diagramas

@app.get("/api/diagrams")
def list_diagrams():
    rows = get_db().execute(
        "SELECT id, name, description, thumbnail, created_at, updated_at, '' AS data"
        " FROM diagrams ORDER BY updated_at DESC").fetchall()
    return jsonify([diagram_row(r, with_data=False) for r in rows])


@app.post("/api/diagrams")
def create_diagram():
    b = body()
    ts = now()
    data = b.get("data") if isinstance(b.get("data"), dict) else {}
    db = get_db()
    cur = db.execute(
        "INSERT INTO diagrams (name, description, data, thumbnail, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?)",
        (clean_name(b.get("name"), "Diagrama sin nombre"), str(b.get("description", ""))[:2000],
         json.dumps(data, ensure_ascii=False), str(b.get("thumbnail", "")), ts, ts))
    db.commit()
    row = db.execute("SELECT * FROM diagrams WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(diagram_row(row)), 201


@app.get("/api/diagrams/<int:did>")
def get_diagram(did):
    row = get_db().execute("SELECT * FROM diagrams WHERE id=?", (did,)).fetchone()
    if not row:
        abort(404, description="Diagrama no encontrado")
    return jsonify(diagram_row(row))


@app.put("/api/diagrams/<int:did>")
def update_diagram(did):
    b = body()
    db = get_db()
    row = db.execute("SELECT * FROM diagrams WHERE id=?", (did,)).fetchone()
    if not row:
        abort(404, description="Diagrama no encontrado")
    name = clean_name(b["name"], row["name"]) if "name" in b else row["name"]
    desc = str(b["description"])[:2000] if "description" in b else row["description"]
    data = row["data"]
    if "data" in b:
        if not isinstance(b["data"], dict):
            abort(400, description="data debe ser un objeto")
        data = json.dumps(b["data"], ensure_ascii=False)
    thumb = str(b["thumbnail"]) if "thumbnail" in b else row["thumbnail"]
    ts = now()
    db.execute("UPDATE diagrams SET name=?, description=?, data=?, thumbnail=?, updated_at=? WHERE id=?",
               (name, desc, data, thumb, ts, did))
    db.commit()
    return jsonify({"id": did, "name": name, "updated_at": ts})


@app.delete("/api/diagrams/<int:did>")
def delete_diagram(did):
    db = get_db()
    db.execute("DELETE FROM diagrams WHERE id=?", (did,))
    db.commit()
    return jsonify(ok=True)


@app.post("/api/diagrams/<int:did>/duplicate")
def duplicate_diagram(did):
    db = get_db()
    row = db.execute("SELECT * FROM diagrams WHERE id=?", (did,)).fetchone()
    if not row:
        abort(404, description="Diagrama no encontrado")
    ts = now()
    cur = db.execute(
        "INSERT INTO diagrams (name, description, data, thumbnail, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?)",
        (row["name"] + " (copia)", row["description"], row["data"], row["thumbnail"], ts, ts))
    db.commit()
    new = db.execute("SELECT * FROM diagrams WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(diagram_row(new, with_data=False)), 201


# Componentes

@app.get("/api/components")
def list_components():
    rows = get_db().execute("SELECT * FROM components ORDER BY category, name").fetchall()
    return jsonify([component_row(r) for r in rows])


def component_values(b, row=None):
    def pick(key, default):
        return b[key] if key in b else (row[key] if row is not None else default)

    try:
        width = int(pick("width", 120))
        height = int(pick("height", 80))
    except (TypeError, ValueError):
        abort(400, description="Ancho y alto deben ser números")
    terminals = clean_terminals(b["terminals"]) if "terminals" in b else (
        json.loads(row["terminals"]) if row is not None else [])
    kind = pick("kind", "component")
    return dict(
        name=clean_name(pick("name", ""), "Componente"),
        category=clean_name(pick("category", ""), "General"),
        kind=kind if kind in ("component", "junction") else "component",
        width=min(max(width, 10), 2000), height=min(max(height, 10), 2000),
        color=str(pick("color", "#eef2f7"))[:20],
        image=str(pick("image", "")),
        show_labels=1 if pick("show_labels", True) else 0,
        terminals=json.dumps(terminals, ensure_ascii=False))


@app.post("/api/components")
def create_component():
    v = component_values(body())
    ts = now()
    db = get_db()
    cur = db.execute(
        "INSERT INTO components (name, category, kind, width, height, color, image, show_labels,"
        " terminals, builtin, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,0,?,?)",
        (v["name"], v["category"], v["kind"], v["width"], v["height"], v["color"], v["image"],
         v["show_labels"], v["terminals"], ts, ts))
    db.commit()
    row = db.execute("SELECT * FROM components WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(component_row(row)), 201


@app.put("/api/components/<int:cid>")
def update_component(cid):
    db = get_db()
    row = db.execute("SELECT * FROM components WHERE id=?", (cid,)).fetchone()
    if not row:
        abort(404, description="Componente no encontrado")
    v = component_values(body(), row)
    db.execute(
        "UPDATE components SET name=?, category=?, kind=?, width=?, height=?, color=?, image=?,"
        " show_labels=?, terminals=?, updated_at=? WHERE id=?",
        (v["name"], v["category"], v["kind"], v["width"], v["height"], v["color"], v["image"],
         v["show_labels"], v["terminals"], now(), cid))
    db.commit()
    row = db.execute("SELECT * FROM components WHERE id=?", (cid,)).fetchone()
    return jsonify(component_row(row))


@app.delete("/api/components/<int:cid>")
def delete_component(cid):
    db = get_db()
    db.execute("DELETE FROM components WHERE id=?", (cid,))
    db.commit()
    return jsonify(ok=True)


# Respaldo

@app.get("/api/backup")
def export_backup():
    db = get_db()
    payload = {
        "app": "editor-diagramas-electricos", "version": 1, "exported_at": now(),
        "diagrams": [diagram_row(r) for r in db.execute("SELECT * FROM diagrams").fetchall()],
        "components": [component_row(r) for r in db.execute("SELECT * FROM components").fetchall()],
    }
    fname = "respaldo-diagramas-%s.json" % datetime.now().strftime("%Y%m%d-%H%M")
    return Response(json.dumps(payload, ensure_ascii=False), mimetype="application/json",
                    headers={"Content-Disposition": 'attachment; filename="%s"' % fname})


@app.post("/api/backup")
def import_backup():
    b = body()
    db = get_db()
    ts = now()
    n_d = n_c = 0
    for d in b.get("diagrams", []) or []:
        if not isinstance(d, dict):
            continue
        db.execute(
            "INSERT INTO diagrams (name, description, data, thumbnail, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?)",
            (clean_name(d.get("name"), "Diagrama importado"), str(d.get("description", ""))[:2000],
             json.dumps(d.get("data") if isinstance(d.get("data"), dict) else {}, ensure_ascii=False),
             str(d.get("thumbnail", "")), ts, ts))
        n_d += 1
    existing = {(r["name"], r["category"]) for r in db.execute("SELECT name, category FROM components")}
    for c in b.get("components", []) or []:
        if not isinstance(c, dict) or (c.get("name"), c.get("category")) in existing:
            continue
        v = component_values(c)
        db.execute(
            "INSERT INTO components (name, category, kind, width, height, color, image, show_labels,"
            " terminals, builtin, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,0,?,?)",
            (v["name"], v["category"], v["kind"], v["width"], v["height"], v["color"], v["image"],
             v["show_labels"], v["terminals"], ts, ts))
        n_c += 1
    db.commit()
    return jsonify(diagrams=n_d, components=n_c)


init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    # Solo ASCII: la consola de Windows (cp1252) no puede imprimir flechas ni acentos raros.
    print("\n  Editor de diagramas electricos -> http://localhost:%d\n" % port)
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=port, debug=False)
