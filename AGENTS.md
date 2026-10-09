# AGENTS.md

## Repo Reality (read first)
- Two parts: `extension/` is a plain Manifest V3 Chrome extension (no `package.json`, no build step, no test/lint tooling configured); `launcher/launch.py` is a stdlib-only Python 3 script that opens N isolated Chrome profiles with the extension loaded (see README).
- Main runtime wiring is in `extension/manifest.json`: content script is `content-hybrid.js`, popup is `popup.html` + `popup.js`, background service worker is `background.js`.
- `content.js` exists as a legacy/alternate implementation; it is **not** loaded by default.

## Fastest Safe Dev Loop
- Edit files directly, then reload from `chrome://extensions` (Developer Mode -> Reload on this unpacked extension, loaded from `extension/`).
- Verify on a real Boca Socios page matching `https://bocasocios.bocajuniors.com.ar/*`; popup disables start outside this domain.
- If popup/content messaging fails after edits, reload both the extension and the target tab before debugging logic.

## Behavior Gotchas Worth Remembering
- Interval unit mismatch is intentional in code: popup sends seconds -> ms; `startMonitoring` clamps to minimum `100ms` (`Math.max(..., 100)`) even though popup input allows `0.05`.
- In seat pages (`/asiento` or `/seat`), `content-hybrid.js` switches to a `requestAnimationFrame` loop (effectively fastest-per-frame checks), so sector-page interval tuning does not fully represent seat-page behavior.
- Sector filtering is code-based and normalized (`uppercase` + no spaces). Matching is done against SVG ids like `g[id^="seccion-"]`; availability click still requires site-provided availability markers (`data-section`).
- Popup fallback injection uses `chrome.scripting.executeScript(... content-hybrid.js ...)` if messaging fails; keep this path working when refactoring message actions.

## File Map (only the parts that matter, extension files live in `extension/`)
- `manifest.json`: single source of truth for what runs in Chrome.
- `content-hybrid.js`: active automation flow (`sector -> asiento -> agregar-platea`), observers, and sector snapshot API for popup.
- `popup.js`: start/stop commands, stored settings, sector selector UI state, script injection fallback.
- `popup.html`: inline styles + UI copy (Spanish).
- `content.js`: non-default variant; update only if intentionally keeping parity.
- `page-poll.js`: MAIN-world content script (`document_start`). Hooks XHR to capture the site's own `GET /event/{matchId}/seat/section/availability` request (with its `Authorization`/`acceptRequest`/`queueittoken` headers) and replays it every `reloadInterval` instead of reloading (penalty-aware backoff: the site's rate limit is a ~10s lockout that keeps rejecting even at slower rates, not a rate cap. Rate limit = HTTP 429 (confirmed live, CORS headers, JSON body, no `Retry-After`) or body `codigo === "429"` (what the site checks) or a network error. During a lockout the retry delay doubles up to 16s (or `Retry-After`, up to 30s); the first OK goes straight back to `reloadInterval` and logs the lockout duration; a second lockout within 2 min warns to raise the interval. 0.5s tested without 429s, 0.3s triggers them); on a matching `hayDisponibilidad` section it calls `window.next.router.push('/matches/{matchId}/plateas/seats/{nid}')`. Talks to `content-hybrid.js` via `window.postMessage` (`source: 'boca-bot'`); on `poll-failed` or no ack the content script falls back to `location.reload()`.
- `queue-watch.js`: runs on any `*.queue-it.net` page; flags `bocaInQueue` and writes queue position into the tab title (Queue-it ids `MainPart_lbUsersInLineAheadOfYou`, `MainPart_lbQueueNumber`, `MainPart_lbWhichIsIn`, `hlLinkToQueueTicket2`).
- `launcher/launch.py`: Chrome 137+ ignores `--load-extension`, so it loads the extension over `--remote-debugging-pipe` (`Extensions.loadUnpacked`). Chrome exits when that pipe closes, so Chrome also inherits the other pipe ends; keep that or windows die with the script. Cookies DB is `Default/Network/Cookies` on Windows but `Default/Cookies` on macOS.
- `VERSIONES.md`: human docs claiming version tradeoffs; trust code + `manifest.json` first if conflicts appear.

## Change Discipline for Agents
- Do not invent npm/pnpm commands in this repo; there is no JS toolchain configured.
- When changing automation selectors/flow, validate both message actions used by popup (`start`, `stop`, `getStatus`, `getSectors`) and session restore keys (`bocaBotActive`, `bocaBotSettings`).
- Keep user-facing popup text in Spanish unless explicitly asked to localize.

## Launcher and live dashboard
- Dashboard snapshots use current values and sort on every request; stale clients expire after 60 seconds. "Close all but top 3" uses the live order at click time; windows close on their next report. Treat over-an-hour text as a lower bound, with precise estimates ranked first. Read `launcher/test_dashboard.py` before changing ranking or focus.
- Preserve the default single-account flow (`--setup`, profile-0, `-n`, three windows by default). `--no-dashboard` skips server/session/page startup only; already-running servers remain.
- Chrome inherits its pipe copies to survive launcher exit; close parent descriptors after configuring each instance. Convert pipe errors into handled failures. Background mode is disabled so closing the last window releases the profile.
- Windows focus succeeds only if the actual foreground HWND matches. ALT fallback is used only for explicit dashboard focus requests, with key release guaranteed.
- Run `python -m unittest discover -s launcher -p "test_*.py"`. Manual checks in Queue-it must preserve active queue windows; restart only the dashboard helper to load server changes.
