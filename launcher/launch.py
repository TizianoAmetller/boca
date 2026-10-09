#!/usr/bin/env python3
"""Abre N ventanas de Chrome, cada una con su propio perfil, para ocupar N lugares en una
sala de espera de Queue-it. Cada ventana trae cargada la extensión de ../extension, que pone
en el título de la pestaña cuánta gente hay adelante. No compra nada: la compra se hace a
mano en la ventana que pase primero.

Uso:
  python3 launch.py --setup                  # loguearse una vez (después cerrar Chrome del todo)
  python3 launch.py -u <url> -n 9            # abrir 9 ventanas en <url>
  python3 launch.py                          # sin -u ni -n: Boca Socios, 3 ventanas
  python3 launch.py --reset                  # borrar los perfiles guardados

Funciona en macOS y Windows. Solo usa la librería estándar de Python 3.
"""
import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

from dashboard import DASHBOARD_HOST, DASHBOARD_PORT, serve_dashboard

ROOT = Path(__file__).resolve().parent
PROFILES = ROOT / "profiles"
MAIN = PROFILES / "profile-0"
EXTENSION = ROOT.parent / "extension"
IS_WIN = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"

DEFAULT_URL = "https://bocasocios.bocajuniors.com.ar"
DEFAULT_COUNT = 3

MIN_WINDOW_W = 500  # ancho mínimo de una ventana de Chrome (medido)
MAX_ROWS = 4
CASCADE = 40        # desplazamiento de las ventanas que no entran en la grilla


def find_chrome():
    if os.environ.get("CHROME"):
        return os.environ["CHROME"]
    if IS_MAC:
        candidates = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    elif IS_WIN:
        candidates = [os.path.join(os.environ.get(v, ""), r"Google\Chrome\Application\chrome.exe")
                      for v in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA")]
    else:
        candidates = [shutil.which(n) or "" for n in ("google-chrome", "google-chrome-stable", "chromium")]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    sys.exit("No encontré Chrome. Pasá la ruta en la variable de entorno CHROME.")


def profile_in_use(profile):
    # Si Chrome se cerró mal, el lock queda en el disco: hay que ver si el proceso sigue vivo
    lock = profile / "SingletonLock"  # macOS/Linux: symlink a "<host>-<pid>"
    if lock.is_symlink():
        try:
            os.kill(int(os.readlink(lock).rsplit("-", 1)[1]), 0)
            return True
        except (ProcessLookupError, ValueError):
            return False
        except PermissionError:
            return True
    lockfile = profile / "lockfile"  # Windows: Chrome lo tiene abierto y no se puede borrar
    try:
        lockfile.unlink()
    except FileNotFoundError:
        pass
    except PermissionError:
        return True
    return False


def check_closed():
    busy = [p.name for p in PROFILES.glob("profile-*") if profile_in_use(p)]
    if busy:
        sys.exit(f"Estos perfiles siguen abiertos: {', '.join(busy)}. Cerrá esas ventanas "
                 "(en Mac: Cmd+Q) y volvé a correr el script. Ojo: se pierden los lugares en la fila.")


# --- Perfiles -------------------------------------------------------------------------------

def cookie_db(profile):
    # Windows las guarda en Default/Network/Cookies; macOS en Default/Cookies
    for path in (profile / "Default" / "Network" / "Cookies", profile / "Default" / "Cookies"):
        if path.exists():
            return path
    return None


def clone_session(count):
    """Cada ventana extra es un perfil nuevo que solo recibe las cookies y el localStorage de
    profile-0 (muchos sitios, como Deportick, guardan el login en localStorage)."""
    cookies = cookie_db(MAIN)
    for i in range(1, count):
        dest = PROFILES / f"profile-{i}"
        shutil.rmtree(dest, ignore_errors=True)
        (dest / "Default").mkdir(parents=True)
        # Local State guarda la clave con la que Chrome cifra las cookies en Windows
        shutil.copy2(MAIN / "Local State", dest)
        if cookies:
            target = dest / cookies.relative_to(MAIN)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(cookies, target)
        storage = MAIN / "Default" / "Local Storage"
        if storage.exists():
            shutil.copytree(storage, dest / "Default" / "Local Storage")
    print(f"Sesión de profile-0 copiada a {count - 1} perfiles más.")


def clear_queue_cookies(profile):
    """Queue-it guarda el lugar en la fila en sus cookies. Sin ellas, cada ventana recibe un
    QueueId nuevo al entrar a la sala de espera."""
    db = cookie_db(profile)
    if not db:
        return
    c = sqlite3.connect(db)
    n = c.execute("DELETE FROM cookies WHERE host_key LIKE '%queue-it%' "
                  "OR name LIKE 'QueueIT%' OR name LIKE 'Queue-it%'").rowcount
    c.commit()
    c.close()
    print(f"  {profile.name}: {n} cookies de Queue-it borradas")


# --- Pantallas ------------------------------------------------------------------------------

def work_areas():
    """Área útil de cada pantalla, la principal primero, como (x, y, ancho, alto) en las
    unidades que usa Chrome para --window-position/--window-size."""
    if IS_WIN:
        return _win_work_areas()
    if IS_MAC:
        # Solo la pantalla principal, sin la barra de menú ni el Dock (AppKit mide desde abajo)
        script = ('ObjC.import("AppKit"); var s = $.NSScreen.mainScreen, f = s.frame, v = s.visibleFrame;'
                  '[v.origin.x, f.size.height - v.origin.y - v.size.height, v.size.width, v.size.height].join(",")')
        try:
            out = subprocess.run(["osascript", "-l", "JavaScript", "-e", script],
                                 capture_output=True, text=True, timeout=5).stdout
            return [tuple(int(float(v)) for v in out.split(","))]
        except (subprocess.TimeoutExpired, ValueError):
            pass
    return [(0, 40, 1512, 942)]


def _win_work_areas():
    import ctypes
    from ctypes import wintypes

    class MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT),
                    ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]

    user32, shcore = ctypes.windll.user32, ctypes.windll.shcore
    user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))  # per-monitor v2
    areas = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HMONITOR, wintypes.HDC, ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)
    def callback(monitor, dc, rect, data):
        info = MONITORINFO(cbSize=ctypes.sizeof(MONITORINFO))
        user32.GetMonitorInfoW(monitor, ctypes.byref(info))
        dpi_x, dpi_y = wintypes.UINT(), wintypes.UINT()
        shcore.GetDpiForMonitor(monitor, 0, ctypes.byref(dpi_x), ctypes.byref(dpi_y))
        s, w = dpi_x.value / 96, info.rcWork
        area = (int(w.left / s), int(w.top / s), int((w.right - w.left) / s), int((w.bottom - w.top) / s))
        areas.insert(0, area) if info.dwFlags & 1 else areas.append(area)
        return True

    user32.EnumDisplayMonitors(None, None, callback, 0)
    return areas or [(0, 0, 1920, 1040)]


def tile(count):
    """Tantas columnas de ~500px como entren en cada pantalla y las menos filas (hasta 4) que
    alcancen para poner todas las ventanas una al lado de la otra."""
    areas = work_areas()
    cols_per_area = [max(1, a[2] // MIN_WINDOW_W) for a in areas]
    rows = min(MAX_ROWS, -(-count // sum(cols_per_area)))
    slots = []
    for (x, y, w, h), cols in zip(areas, cols_per_area):
        cw, ch = w // cols, h // rows
        slots += [(x + c * cw, y + r * ch, cw, ch) for r in range(rows) for c in range(cols)]
    print(f"Entran {len(slots)} ventanas una al lado de la otra.")
    return slots


# --- Chrome ---------------------------------------------------------------------------------

class DevToolsPipe:
    """Protocolo de DevTools por pipe: mensajes JSON terminados en \\0. Es la única forma de
    cargar una extensión sin empaquetar en Chrome 137+, que ignora --load-extension."""

    def __init__(self, write_fd, read_fd):
        self.write_fd, self.read_fd, self.buf, self.next_id = write_fd, read_fd, b"", 0

    def call(self, method, timeout=15, **params):
        self.next_id += 1
        try:
            os.write(self.write_fd, json.dumps({"id": self.next_id, "method": method, "params": params}).encode() + b"\0")
        except OSError as error:
            raise RuntimeError(f"{method}: pipe de Chrome cerrado ({error})") from error
        result = {}
        reader = threading.Thread(target=self._read_until, args=(self.next_id, result), daemon=True)
        reader.start()
        reader.join(timeout)
        if "error" in result or "result" not in result:
            raise RuntimeError(result.get("error", f"{method}: Chrome no respondió"))
        return result["result"]

    def _read_until(self, msg_id, result):
        while True:
            while b"\0" not in self.buf:
                try:
                    chunk = os.read(self.read_fd, 65536)
                except OSError as error:
                    result["error"] = f"No se pudo leer el pipe de Chrome: {error}"
                    return
                if not chunk:
                    result["error"] = "Chrome cerró la conexión"
                    return
                self.buf += chunk
            raw, self.buf = self.buf.split(b"\0", 1)
            msg = json.loads(raw)
            if msg.get("id") == msg_id:  # los eventos no tienen id
                result.update(msg)
                return


def launch(chrome, profile, url, slot):
    x, y, w, h = slot
    args = [chrome, f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check",
            "--disable-sync", "--disable-background-mode", f"--window-size={w},{h}", f"--window-position={x},{y}",
            "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", "about:blank"]
    to_chrome_r, to_chrome_w = os.pipe()
    from_chrome_r, from_chrome_w = os.pipe()
    # Chrome se cierra cuando se cierra el pipe. Para que las ventanas sigan abiertas cuando
    # termina este script, Chrome también hereda el otro extremo de cada pipe.
    if IS_WIN:
        import msvcrt
        handles = [msvcrt.get_osfhandle(fd) for fd in (to_chrome_r, from_chrome_w, to_chrome_w, from_chrome_r)]
        for handle in handles:
            os.set_handle_inheritable(handle, True)
        args.insert(-1, f"--remote-debugging-io-pipes={handles[0]},{handles[1]}")
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
        proc = subprocess.Popen(args, close_fds=False, creationflags=flags,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        def wire_pipes():  # Chrome lee de fd 3 y escribe en fd 4
            fds = [os.dup(fd) for fd in (to_chrome_r, from_chrome_w, to_chrome_w, from_chrome_r)]
            for target, fd in zip((3, 4, 5, 6), fds):
                os.dup2(fd, target)
        proc = subprocess.Popen(args, preexec_fn=wire_pipes, close_fds=False, start_new_session=True,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.close(to_chrome_r)
    os.close(from_chrome_w)

    pipe = DevToolsPipe(to_chrome_w, from_chrome_r)
    try:
        pipe.call("Extensions.loadUnpacked", path=str(EXTENSION))
    except RuntimeError as e:
        print(f"  AVISO: no se pudo cargar la extensión en {profile.name}: {e}")
    try:
        # La URL se abre recién ahora, así la extensión ya corre en la primera página
        blank = [t["targetId"] for t in pipe.call("Target.getTargets")["targetInfos"] if t["type"] == "page"]
        pipe.call("Target.createTarget", url=url)
        for target_id in blank:
            pipe.call("Target.closeTarget", targetId=target_id)
    except RuntimeError as e:
        print(f"  AVISO: no se pudo abrir la página en {profile.name} ({e}). Abrila a mano.")
    finally:
        # Chrome conserva sus copias; Python no debe heredarlas a las otras ventanas.
        os.close(to_chrome_w)
        os.close(from_chrome_r)
    if proc.poll() is not None:
        print(f"  AVISO: Chrome de {profile.name} termino con codigo {proc.returncode}.")
    return proc


def ensure_dashboard_server(port=DASHBOARD_PORT):
    """Start the local dashboard as a detached helper if it is not running."""
    health_url = f"http://{DASHBOARD_HOST}:{port}/api/health"
    try:
        with urllib.request.urlopen(health_url, timeout=0.5) as response:
            data = json.loads(response.read().decode("utf-8"))
            if response.status == 200 and data.get("service") == "boca-queue-dashboard":
                return
    except (OSError, urllib.error.URLError, ValueError):
        pass

    command = [
        sys.executable,
        str(Path(__file__).resolve()),
        "--dashboard-server",
        "--dashboard-port",
        str(port),
    ]
    kwargs = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "close_fds": True,
    }
    if IS_WIN:
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen(command, **kwargs)

    for _ in range(30):
        try:
            with urllib.request.urlopen(health_url, timeout=0.5) as response:
                data = json.loads(response.read().decode("utf-8"))
                if response.status == 200 and data.get("service") == "boca-queue-dashboard":
                    return
        except (OSError, urllib.error.URLError, ValueError):
            time.sleep(0.2)
    raise RuntimeError(f"No se pudo iniciar el panel local en {health_url}")


def start_dashboard_session(port, expected_count):
    endpoint = f"http://{DASHBOARD_HOST}:{port}/api/session"
    body = json.dumps({"expectedCount": expected_count}).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=2) as response:
        result = json.loads(response.read().decode("utf-8"))
    if response.status != 202 or not result.get("accepted"):
        raise RuntimeError("el panel no aceptó la nueva tanda de ventanas")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-u", "--url", default=DEFAULT_URL,
                        help=f"página del evento, o la del sitio si todavía no la publicaron (default: {DEFAULT_URL})")
    parser.add_argument("-n", "--count", type=int, default=DEFAULT_COUNT,
                        help=f"cantidad de ventanas (default: {DEFAULT_COUNT})")
    parser.add_argument("--setup", action="store_true", help="abrir profile-0 para loguearse una vez")
    parser.add_argument("--reset", action="store_true", help="borrar todos los perfiles y el login guardado")
    parser.add_argument("--no-dashboard", action="store_true", help="abrir ventanas sin iniciar ni abrir el panel local")
    parser.add_argument("--dashboard-server", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--dashboard-port", type=int, default=DASHBOARD_PORT, help=argparse.SUPPRESS)
    opts = parser.parse_args()
    if opts.dashboard_server:
        serve_dashboard(opts.dashboard_port)
        return
    if opts.count < 1:
        parser.error("-n tiene que ser 1 o más")

    if opts.reset:
        check_closed()
        shutil.rmtree(PROFILES, ignore_errors=True)
        print("Perfiles borrados.")
        return

    chrome = find_chrome()
    PROFILES.mkdir(exist_ok=True)
    check_closed()

    if opts.setup:
        proc = launch(chrome, MAIN, opts.url, work_areas()[0])
        print("Logueate en la ventana que se abrió y después cerrá Chrome del todo (en Mac: Cmd+Q).")
        proc.wait()
        print("Listo. Ya podés abrir las ventanas.")
        return

    if MAIN.exists():
        clone_session(opts.count)
        for i in range(opts.count):
            clear_queue_cookies(PROFILES / f"profile-{i}")
    else:
        print("No hay login guardado (--setup): las ventanas arrancan sin sesión.")

    if not opts.no_dashboard:
        try:
            ensure_dashboard_server(opts.dashboard_port)
            start_dashboard_session(opts.dashboard_port, opts.count)
            dashboard_url = f"http://{DASHBOARD_HOST}:{opts.dashboard_port}/"
            webbrowser.open(dashboard_url)
            print(f"Panel de filas: {dashboard_url}")
        except (OSError, ValueError, RuntimeError) as error:
            print(f"AVISO: {error}. Las ventanas se abriran igual.")
    slots = tile(opts.count)
    for i in range(opts.count):
        x, y, w, h = slots[i % len(slots)]
        offset = (i // len(slots)) * CASCADE
        proc = launch(chrome, PROFILES / f"profile-{i}", opts.url, (x + offset, y + offset, w, h))
        if proc.poll() is None:
            print(f"[{i + 1}/{opts.count}] ventana abierta - profile-{i}")
        else:
            print(f"[{i + 1}/{opts.count}] no se pudo mantener abierta - profile-{i}")
        time.sleep(0.4)
    print("Listo. Podés cerrar esta terminal: las ventanas siguen abiertas.")


if __name__ == "__main__":
    main()
