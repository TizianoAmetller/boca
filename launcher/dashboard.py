"""Panel local para ordenar las filas de Queue-it.

El servidor escucha solamente en loopback. Las extensiones de cada perfil
envian sus datos al servidor y el panel los ordena sin exponerlos a Internet.
"""

from __future__ import annotations

import ctypes
import json
import platform
import re
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


DASHBOARD_HOST = "127.0.0.1"
DASHBOARD_PORT = 8765
STALE_AFTER_SECONDS = 15

_LOCK = threading.RLock()
_QUEUES = {}
_SESSION = {
    "expected_count": None,
    "started_at": None,
    "frozen": False,
    "frozen_at": None,
    "order": [],
}
# Ventanas que el usuario pidió cerrar desde el panel. Se les avisa en su
# próximo reporte y ahí se sacan del panel.
_CLOSING = set()


def _parse_integer(value):
    if value is None:
        return None
    digits = re.sub(r"[^0-9]", "", str(value))
    return int(digits) if digits else None


def _parse_wait_minutes(value):
    if value is None:
        return None
    text = str(value).strip().lower()
    if not text or re.search(r"calculating|calculando|estimating|estimando", text):
        return None
    match = re.search(r"([0-9]+(?:[.,][0-9]+)?)", text)
    if not match:
        return None
    try:
        number = float(match.group(1).replace(",", "."))
    except ValueError:
        return None
    if re.search(r"hour|hora", text):
        number *= 60
    return max(number, 0)


def _prune_locked(now=None):
    now = time.time() if now is None else now
    expired = [
        key for key, item in _QUEUES.items()
        if now - item["last_seen"] > STALE_AFTER_SECONDS
    ]
    for key in expired:
        _QUEUES.pop(key, None)


def start_session(expected_count):
    """Reset the dashboard for one launcher run."""
    try:
        expected_count = int(expected_count)
    except (TypeError, ValueError):
        return False
    if expected_count < 1 or expected_count > 100:
        return False

    with _LOCK:
        _QUEUES.clear()
        _CLOSING.clear()
        _SESSION.update({
            "expected_count": expected_count,
            "started_at": time.time(),
            "frozen": False,
            "frozen_at": None,
            "order": [],
        })
    return True


def _initial_sort_key(item):
    wait = item["initial_wait_minutes"]
    ahead = item["initial_ahead_number"]
    return (
        wait is None,
        wait if wait is not None else float("inf"),
        ahead is None,
        ahead if ahead is not None else float("inf"),
        item["sequence"],
    )


def _freeze_if_ready_locked():
    if _SESSION["frozen"] or not _SESSION["expected_count"]:
        return

    captured = [item for item in _QUEUES.values() if item["initial_captured"]]
    if len(captured) < _SESSION["expected_count"]:
        return

    captured.sort(key=_initial_sort_key)
    _SESSION["order"] = [item["client_id"] for item in captured]
    _SESSION["frozen"] = True
    _SESSION["frozen_at"] = time.time()


def update_queue(payload):
    """Store one update from a queue-watch content script."""
    if not isinstance(payload, dict):
        return False

    client_id = str(payload.get("clientId", "")).strip()
    if not client_id or len(client_id) > 128:
        return False

    queue_id = str(payload.get("queueId", "")).strip()[:256]
    ahead_text = str(payload.get("aheadText", "")).strip()[:256]
    number_text = str(payload.get("numberText", "")).strip()[:256]
    wait_text = str(payload.get("waitText", "")).strip()[:256]
    now = time.time()

    with _LOCK:
        item = _QUEUES.get(client_id)
        if item is None:
            item = {
                "client_id": client_id,
                "sequence": len(_QUEUES),
                "initial_captured": False,
                "initial_wait_minutes": None,
                "initial_ahead_number": None,
                "initial_wait_text": "",
                "initial_ahead_text": "",
                "initial_number_text": "",
                "initial_captured_at": None,
            }

        item.update({
            "queue_id": queue_id,
            "queue_suffix": queue_id[-4:].upper() if queue_id else "",
            "ahead_text": ahead_text,
            "ahead_number": _parse_integer(ahead_text),
            "number_text": number_text,
            "wait_text": wait_text,
            "wait_minutes": _parse_wait_minutes(wait_text),
            "last_seen": now,
        })

        # The first complete Queue-it update is the data used for the final
        # ranking. Later countdown changes must not move the row.
        has_queue_data = bool(wait_text or ahead_text or number_text)
        if not item["initial_captured"] and queue_id and has_queue_data:
            item.update({
                "initial_captured": True,
                "initial_wait_minutes": item["wait_minutes"],
                "initial_ahead_number": item["ahead_number"],
                "initial_wait_text": wait_text,
                "initial_ahead_text": ahead_text,
                "initial_number_text": number_text,
                "initial_captured_at": now,
            })

        _QUEUES[client_id] = item
        if not _SESSION["frozen"]:
            _prune_locked(now)
            _freeze_if_ready_locked()
    return True


def close_others(keep):
    """Mark every window after the first `keep` of the frozen order to close."""
    try:
        keep = int(keep)
    except (TypeError, ValueError):
        return None
    if keep < 1:
        return None

    with _LOCK:
        if not _SESSION["frozen"]:
            return None
        # Mismo orden que muestra el panel: las que llegaron después de la
        # captura van al final.
        ordered_ids = [client_id for client_id in _SESSION["order"] if client_id in _QUEUES]
        ordered_ids.extend(client_id for client_id in _QUEUES if client_id not in _SESSION["order"])
        to_close = ordered_ids[keep:]
        _CLOSING.update(to_close)
    return len(to_close)


def take_close_request(client_id):
    """Return True once if this window has to close, and drop it from the panel."""
    client_id = str(client_id or "").strip()
    with _LOCK:
        if client_id not in _CLOSING:
            return False
        _CLOSING.discard(client_id)
        _QUEUES.pop(client_id, None)
        if client_id in _SESSION["order"]:
            _SESSION["order"].remove(client_id)
    return True


def queue_snapshot():
    now = time.time()
    with _LOCK:
        if not _SESSION["frozen"]:
            _prune_locked(now)

        ordered_ids = list(_SESSION["order"])
        ordered_ids.extend(
            client_id for client_id in _QUEUES
            if client_id not in _SESSION["order"]
        )
        frozen = _SESSION["frozen"]
        rows = []
        for client_id in ordered_ids:
            item = _QUEUES.get(client_id)
            if item is None:
                continue

            if frozen and item["initial_captured"]:
                display_wait = item["initial_wait_text"]
                display_ahead = item["initial_ahead_text"]
                display_number = item["initial_number_text"]
                display_wait_minutes = item["initial_wait_minutes"]
                captured_at = item["initial_captured_at"]
            else:
                display_wait = item["wait_text"]
                display_ahead = item["ahead_text"]
                display_number = item["number_text"]
                display_wait_minutes = item["wait_minutes"]
                captured_at = item["last_seen"]

            rows.append({
                "client_id": item["client_id"],
                "queue_suffix": item["queue_suffix"],
                "ahead_text": display_ahead,
                "ahead_number": _parse_integer(display_ahead),
                "number_text": display_number,
                "wait_text": display_wait,
                "wait_minutes": display_wait_minutes,
                "captured_at": captured_at,
                "closing": client_id in _CLOSING,
            })

        session = {
            "expected_count": _SESSION["expected_count"],
            "received_count": len(_QUEUES),
            "captured_count": sum(1 for item in _QUEUES.values() if item["initial_captured"]),
            "frozen": frozen,
            "frozen_at": _SESSION["frozen_at"],
        }
    return rows, session


def _focus_windows_windows(suffix):
    """Focus the Chrome window whose tab title contains the queue suffix."""
    if not suffix:
        return False

    from ctypes import wintypes

    user32 = ctypes.windll.user32
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    matches = []

    @callback_type
    def callback(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buffer, length + 1)
        if suffix.lower() in buffer.value.lower():
            matches.append(hwnd)
            return False
        return True

    user32.EnumWindows(callback, 0)
    if not matches:
        return False

    hwnd = matches[0]
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    user32.SetForegroundWindow(hwnd)
    return True


def _focus_windows_macos(suffix):
    if not suffix:
        return False
    # json.dumps produces a safely quoted AppleScript string literal.
    needle = json.dumps(suffix)
    script = f"""
tell application "Google Chrome"
  repeat with w in windows
    repeat with t in tabs of w
      if (title of t) contains {needle} then
        set index of w to 1
        activate
        return "ok"
      end if
    end repeat
  end repeat
end tell
return "not-found"
"""
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=3,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0 and "ok" in result.stdout


def focus_queue(client_id):
    with _LOCK:
        item = _QUEUES.get(str(client_id))
        suffix = item.get("queue_suffix", "") if item else ""
    if not suffix:
        return False

    system = platform.system()
    if system == "Windows":
        return _focus_windows_windows(suffix)
    if system == "Darwin":
        return _focus_windows_macos(suffix)
    return False


def _json_response(handler, status, value):
    body = json.dumps(value, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(body)


def _html_response(handler):
    body = DASHBOARD_HTML.encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


class DashboardHandler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        # The launcher should not fill the terminal with one line per update.
        return

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ("/", "/index.html"):
            _html_response(self)
            return
        if parsed.path == "/api/health":
            _json_response(self, 200, {"ok": True, "service": "boca-queue-dashboard"})
            return
        if parsed.path == "/api/queues":
            queues, session = queue_snapshot()
            _json_response(self, 200, {"queues": queues, "session": session})
            return
        if parsed.path == "/api/focus":
            client_id = parse_qs(parsed.query).get("client_id", [""])[0]
            _json_response(self, 200, {"focused": focus_queue(client_id)})
            return
        _json_response(self, 404, {"error": "not-found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path not in ("/api/queue", "/api/session", "/api/close-others"):
            _json_response(self, 404, {"error": "not-found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 64 * 1024:
                raise ValueError("invalid payload size")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            _json_response(self, 400, {"error": "invalid-json"})
            return

        if not isinstance(payload, dict):
            accepted = False
        elif parsed.path == "/api/session":
            accepted = start_session(payload.get("expectedCount"))
        elif parsed.path == "/api/close-others":
            closed = close_others(payload.get("keep"))
            if closed is None:
                _json_response(self, 409, {"error": "order-not-frozen"})
            else:
                _json_response(self, 202, {"accepted": True, "closing": closed})
            return
        elif take_close_request(payload.get("clientId")):
            # La extensión cierra la ventana al leer esta respuesta.
            _json_response(self, 202, {"accepted": True, "close": True})
            return
        else:
            accepted = update_queue(payload)

        if not accepted:
            _json_response(self, 400, {"error": "invalid-client"})
            return
        _json_response(self, 202, {"accepted": True})


def serve_dashboard(port=DASHBOARD_PORT):
    server = ThreadingHTTPServer((DASHBOARD_HOST, port), DashboardHandler)
    print(f"Panel de filas: http://{DASHBOARD_HOST}:{port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


DASHBOARD_HTML = r"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Filas de Boca Socios</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-width: 360px;
      background: #020617;
      color: #e5e7eb;
      font: 14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main { max-width: 900px; margin: 0 auto; padding: 28px 18px 42px; }
    header { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 20px; }
    h1 { margin: 0; color: #bfdbfe; font-size: 22px; letter-spacing: .02em; }
    .subtle { color: #94a3b8; font-size: 12px; }
    #state { color: #86efac; text-align: right; }
    .empty, .error {
      border: 1px dashed #334155;
      border-radius: 14px;
      padding: 28px;
      color: #94a3b8;
      text-align: center;
    }
    .error { color: #fecaca; border-color: #7f1d1d; }
    .queue {
      display: grid;
      grid-template-columns: 46px 1fr auto;
      gap: 14px;
      align-items: center;
      margin-bottom: 10px;
      padding: 15px 16px;
      background: linear-gradient(135deg, #0f172a, #111827);
      border: 1px solid #263449;
      border-radius: 14px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, .22);
    }
    .rank { color: #93c5fd; font-size: 21px; font-weight: 700; text-align: center; }
    .queue-title { display: flex; align-items: center; gap: 8px; color: #f8fafc; font-weight: 650; }
    .queue-title code { color: #facc15; font-size: 13px; }
    .details { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 6px; color: #cbd5e1; font-size: 12px; }
    .wait { color: #fde68a; font-size: 16px; font-weight: 650; white-space: nowrap; }
    button {
      border: 1px solid #3b82f6;
      border-radius: 999px;
      padding: 7px 12px;
      background: #172554;
      color: #dbeafe;
      cursor: pointer;
    }
    button:hover { background: #1d4ed8; }
    button:disabled { cursor: default; opacity: .45; }
    #closeOthers { border-color: #ef4444; background: #450a0a; color: #fee2e2; margin-top: 8px; }
    #closeOthers:hover:not(:disabled) { background: #b91c1c; }
    .queue.closing { opacity: .4; }
    @media (max-width: 620px) {
      header { align-items: start; flex-direction: column; }
      #state { text-align: left; }
      .queue { grid-template-columns: 38px 1fr; }
      .wait { grid-column: 2; }
      .queue button { grid-column: 2; justify-self: start; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Filas de Boca Socios</h1>
        <div class="subtle">Ordenadas por menor tiempo estimado</div>
      </div>
      <div>
        <div id="state" class="subtle">Conectando…</div>
        <button id="closeOthers" type="button" disabled>Cerrar todas menos las 3 primeras</button>
      </div>
    </header>
    <section id="list"></section>
    <p class="subtle">El panel solo organiza la información y enfoca la ventana existente; no modifica la posición en la fila.</p>
  </main>
  <script>
    const list = document.getElementById('list');
    const state = document.getElementById('state');
    const closeOthers = document.getElementById('closeOthers');
    const KEEP = 3;
    let closableCount = 0;

    closeOthers.addEventListener('click', async () => {
      if (!confirm('¿Cerrar ' + closableCount + ' ventanas y quedarte solo con las ' + KEEP + ' primeras? No se puede deshacer: las ventanas cerradas pierden su lugar en la fila.')) return;
      closeOthers.disabled = true;
      try {
        const response = await fetch('/api/close-others', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keep: KEEP })
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
      } catch (_) {
        alert('No se pudieron cerrar las ventanas.');
      }
    });

    function render(queues) {
      list.textContent = '';
      if (!queues.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'Todavía no hay filas activas.';
        list.appendChild(empty);
        return;
      }

      queues.forEach((queue, index) => {
        const card = document.createElement('article');
        card.className = queue.closing ? 'queue closing' : 'queue';

        const rank = document.createElement('div');
        rank.className = 'rank';
        rank.textContent = '#' + (index + 1);

        const info = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'queue-title';
        title.append('⚠️ Token');
        const code = document.createElement('code');
        code.textContent = queue.queue_suffix ? '· ' + queue.queue_suffix : '';
        title.appendChild(code);

        const details = document.createElement('div');
        details.className = 'details';
        const ahead = document.createElement('span');
        ahead.textContent = '👥 Delante: ' + (queue.ahead_text || 'calculando');
        const number = document.createElement('span');
        number.textContent = '🎟 Posición: ' + (queue.number_text || 'calculando');
        const age = document.createElement('span');
        age.textContent = queue.captured_at
          ? 'Capturado: ' + new Date(queue.captured_at * 1000).toLocaleTimeString()
          : 'Esperando captura';
        details.append(ahead, number, age);
        info.append(title, details);

        const wait = document.createElement('div');
        wait.className = 'wait';
        wait.textContent = '⏱ ' + (queue.wait_text || 'Calculando…');

        const focus = document.createElement('button');
        focus.type = 'button';
        focus.textContent = 'Enfocar ventana';
        focus.disabled = !queue.queue_suffix;
        focus.addEventListener('click', async () => {
          focus.disabled = true;
          try {
            const response = await fetch('/api/focus?client_id=' + encodeURIComponent(queue.client_id), { cache: 'no-store' });
            const result = await response.json();
            focus.textContent = result.focused ? 'Ventana enfocada' : 'No encontrada';
            setTimeout(() => { focus.textContent = 'Enfocar ventana'; focus.disabled = !queue.queue_suffix; }, 1600);
          } catch (_) {
            focus.textContent = 'Error';
            setTimeout(() => { focus.textContent = 'Enfocar ventana'; focus.disabled = !queue.queue_suffix; }, 1600);
          }
        });

        card.append(rank, info, wait, focus);
        list.appendChild(card);
      });
    }

    async function refresh() {
      try {
        const response = await fetch('/api/queues', { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        const session = data.session || {};
        const queues = data.queues || [];
        render(queues);
        closableCount = queues.slice(KEEP).filter((queue) => !queue.closing).length;
        closeOthers.disabled = !session.frozen || closableCount === 0;
        if (session.frozen) {
          state.textContent = 'Orden capturado · ' + (session.captured_count || 0) + ' filas';
        } else if (session.expected_count) {
          state.textContent = 'Esperando filas · ' + (session.captured_count || 0) + '/' + session.expected_count;
        } else {
          state.textContent = 'Esperando al launcher';
        }
        state.style.color = '#86efac';
      } catch (_) {
        state.textContent = 'Sin conexión con el launcher';
        state.style.color = '#fca5a5';
        list.textContent = '';
        const error = document.createElement('div');
        error.className = 'error';
        error.textContent = 'No se pudo consultar el panel local.';
        list.appendChild(error);
      }
    }

    refresh();
    setInterval(refresh, 1000);
  </script>
</body>
</html>"""
