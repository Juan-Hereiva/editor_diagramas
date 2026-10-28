# -*- coding: utf-8 -*-
"""Ventana de la versión de escritorio en Linux: GTK 3 + WebKitGTK (WebKit2 4.1 o 4.0).

La lanza escritorio.py con el python3 del sistema, porque PyGObject y WebKitGTK son del sistema y no
van dentro del paquete:  python3 ventana_gtk.py <url> <carpeta de datos> <icono> <título>
Sale con 0 al cerrar la ventana y con 3 si faltan GTK o WebKit (entonces se usa el navegador)."""
import os
import sys

try:
    import gi
    gi.require_version("Gtk", "3.0")
    try:
        gi.require_version("WebKit2", "4.1")
    except ValueError:
        gi.require_version("WebKit2", "4.0")
    from gi.repository import GLib, Gtk, WebKit2
except (ImportError, ValueError) as e:
    print("ventana_gtk: falta GTK/WebKit:", e, file=sys.stderr)
    sys.exit(3)

URL, DATA, ICON, TITLE = sys.argv[1:5]
windows = []


def new_window(view, w=1440, h=900):
    win = Gtk.Window(title=TITLE)
    win.set_default_size(w, h)
    if os.path.exists(ICON):
        win.set_icon_from_file(ICON)
    win.add(view)
    view.connect("notify::title", lambda v, _p: win.set_title(v.get_title() or TITLE))
    view.connect("create", on_create)
    view.connect("close", lambda v: win.destroy())
    win.connect("destroy", on_destroy)
    windows.append(win)
    return win


def on_destroy(win):
    windows.remove(win)
    if not windows:
        Gtk.main_quit()


def on_create(view, action):
    """target=_blank / window.open: las páginas de la app en otra ventana; lo de fuera, al navegador."""
    uri = action.get_request().get_uri()
    if uri and not uri.startswith(URL) and not uri.startswith("about:"):
        Gtk.show_uri_on_window(None, uri, Gtk.get_current_event_time())
        return None
    child = WebKit2.WebView.new_with_related_view(view)
    win = new_window(child, 1280, 820)
    child.connect("ready-to-show", lambda v: win.show_all())
    return child


def on_download(ctx, download):
    """Exportar PNG/SVG o una copia: diálogo «Guardar como», empezando en Descargas."""
    def decide(dl, name):
        dlg = Gtk.FileChooserDialog(title="Guardar archivo", parent=windows[0] if windows else None,
                                    action=Gtk.FileChooserAction.SAVE)
        dlg.add_buttons("Cancelar", Gtk.ResponseType.CANCEL, "Guardar", Gtk.ResponseType.ACCEPT)
        dlg.set_do_overwrite_confirmation(True)
        dlg.set_current_folder(GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) or os.path.expanduser("~"))
        dlg.set_current_name(name)
        if dlg.run() == Gtk.ResponseType.ACCEPT:
            dl.set_destination(GLib.filename_to_uri(dlg.get_filename(), None))
        else:
            dl.cancel()
        dlg.destroy()
        return True
    download.connect("decide-destination", decide)


# datos propios (localStorage: tema, portapapeles de la app) que se conservan entre sesiones
manager = WebKit2.WebsiteDataManager(base_data_directory=os.path.join(DATA, "datos"),
                                     base_cache_directory=os.path.join(DATA, "cache"))
context = WebKit2.WebContext.new_with_website_data_manager(manager)
context.connect("download-started", on_download)
view = WebKit2.WebView.new_with_context(context)
settings = view.get_settings()
settings.set_enable_html5_local_storage(True)
settings.set_javascript_can_access_clipboard(True)
settings.set_javascript_can_open_windows_automatically(True)
settings.set_enable_write_console_messages_to_stdout(False)
win = new_window(view)
win.maximize()
win.show_all()
view.load_uri(URL)
Gtk.main()
sys.exit(0)
