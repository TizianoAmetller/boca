// page-poll.js - corre en el MAIN world de la página (document_start).
// Captura el pedido de disponibilidad de sectores que hace el sitio y lo repite,
// así el bot consulta solo la API en vez de recargar toda la página.
// Habla con content-hybrid.js por window.postMessage.

(() => {
  const AVAILABILITY_RE = /\/event\/(\d+)\/seat\/section\/availability/;
  const MSG_SOURCE = 'boca-bot';

  let captured = null; // { url, headers, matchId }
  let pollTimer = null;
  let polling = false;
  let pollTargets = null; // Set de códigos normalizados, o null = cualquiera
  let baseMs = 1000; // intervalo del popup: el piso, nunca vamos más rápido
  let pollMs = 1000; // intervalo actual: sube durante un bloqueo, vuelve a baseMs al terminar
  let penaltyStart = 0; // primer rechazo del bloqueo actual (0 = no hay bloqueo)
  let penaltyHits = 0;
  let lastRejectAt = 0;
  let lastPenaltyEnd = 0;

  // El rate limit del sitio es un castigo (~10s bloqueado aunque bajes el ritmo), no un ritmo:
  // durante el bloqueo duplicamos la espera (tope 16s, por si los rechazos alargan el bloqueo),
  // y con la primera respuesta OK volvemos directo al intervalo del popup.
  const MAX_MS = 16000;
  const RETRY_AFTER_MAX_MS = 30000;
  const REPEAT_WINDOW_MS = 2 * 60 * 1000;
  // Un 4xx que dura más que esto probablemente no es rate limit (ej. token vencido): recargar
  const MAX_PENALTY_MS = 60000;

  const origFetch = window.fetch.bind(window);
  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const origSend = XMLHttpRequest.prototype.send;

  // El sitio usa axios (adapter XHR): guardamos URL + headers del pedido real
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__bocaUrl = String(url);
    this.__bocaHeaders = {};
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__bocaHeaders) this.__bocaHeaders[name] = value;
    return origSetHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const m = this.__bocaUrl && this.__bocaUrl.match(AVAILABILITY_RE);
    if (m) {
      captured = { url: this.__bocaUrl, headers: { ...this.__bocaHeaders }, matchId: m[1] };
    }
    return origSend.apply(this, args);
  };

  const post = (type, data = {}) => window.postMessage({ source: MSG_SOURCE, dir: 'page', type, ...data }, '*');
  const normalizeKey = (s) => String(s).toUpperCase().replace(/\s+/g, '');

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== MSG_SOURCE || e.data.dir !== 'content') return;
    if (e.data.type === 'poll-start') {
      pollTargets = e.data.targets?.length ? new Set(e.data.targets.map(normalizeKey)) : null;
      baseMs = e.data.intervalMs;
      pollMs = baseMs;
      penaltyStart = 0;
      lastPenaltyEnd = 0;
      startPolling();
    } else if (e.data.type === 'poll-stop') {
      stopPolling();
    }
  });

  function startPolling() {
    stopPolling();
    polling = true;
    // Si el pedido todavía no pasó (mapa cargando), esperamos un poco antes de rendirnos
    const startedAt = Date.now();
    const waitCapture = () => {
      if (!polling) return;
      if (captured) {
        post('poll-ready');
        pollTimer = setTimeout(tick, pollMs);
      } else if (Date.now() - startedAt > 5000) {
        polling = false;
        post('poll-failed', { reason: 'no-request' });
      } else {
        pollTimer = setTimeout(waitCapture, 200);
      }
    };
    waitCapture();
  }

  function stopPolling() {
    polling = false;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }

  async function tick() {
    pollTimer = null;
    let delay = pollMs;
    try {
      const res = await origFetch(captured.url, { headers: captured.headers, credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!polling) return;

      // Mismo manejo que el interceptor del sitio: fila de Queue-it
      if (data?.errorCode === 50000 && data.newRedirectUrl) {
        window.location.replace(data.newRedirectUrl);
        return;
      }
      // El sitio detecta el rate limit por el campo codigo === "429" del cuerpo (no por el status HTTP),
      // pero en vivo también rechazó con otros 4xx: cualquier 4xx se trata como bloqueo
      const rateLimited = String(data?.codigo) === '429' || (res.status >= 400 && res.status < 500);
      if (rateLimited && penaltyStart && Date.now() - penaltyStart > MAX_PENALTY_MS) {
        // Bloqueo demasiado largo: que el content script recargue la página (token nuevo)
        polling = false;
        post('poll-failed', { reason: `http-${res.status}-persistente`, codigo: data?.codigo });
        return;
      } else if (rateLimited) {
        delay = Math.max(slowDown(`rechazo (HTTP ${res.status}, codigo ${data?.codigo ?? '-'})`), retryAfterMs(res));
      } else if (!res.ok) {
        // Error del servidor u otro: que el content script vuelva a recargar la página
        polling = false;
        post('poll-failed', { reason: `http-${res.status}`, codigo: data?.codigo });
        return;
      } else {
        post('poll-tick');
        if (penaltyStart) delay = endPenalty();
        const section = (data?.secciones || []).find(
          (s) => s.activa && s.hayDisponibilidad && (!pollTargets || pollTargets.has(normalizeKey(s.codigo)))
        );
        if (section) {
          const path = `/matches/${captured.matchId}/plateas/seats/${section.nid}`;
          polling = false;
          post('poll-found', { codigo: section.codigo, nid: section.nid });
          // Misma navegación que hace el sitio al clickear el sector (SPA, sin recarga)
          if (window.next?.router) window.next.router.push(path);
          else window.location.assign(path);
          return;
        }
      }
    } catch (err) {
      // Error de red, o un 429 del gateway sin headers CORS (fetch lo ve como error de red)
      console.warn('[boca-bot] error consultando disponibilidad', err);
      delay = slowDown('error de red');
    }
    if (polling) pollTimer = setTimeout(tick, delay);
  }

  function slowDown(reason) {
    const now = Date.now();
    if (!penaltyStart) {
      penaltyStart = now;
      penaltyHits = 0;
    }
    penaltyHits++;
    lastRejectAt = now;
    pollMs = Math.min(pollMs * 2, MAX_MS);
    console.log(`[boca-bot] ${reason}: reintento en ${pollMs}ms`);
    return pollMs;
  }

  function endPenalty() {
    const now = Date.now();
    // El bloqueo terminó en algún momento entre el último rechazo y ahora
    const min = ((lastRejectAt - penaltyStart) / 1000).toFixed(1);
    const max = ((now - penaltyStart) / 1000).toFixed(1);
    console.log(`[boca-bot] bloqueo levantado: duró entre ${min}s y ${max}s (${penaltyHits} consultas rechazadas). Vuelvo a ${baseMs}ms`);
    if (lastPenaltyEnd && now - lastPenaltyEnd < REPEAT_WINDOW_MS) {
      console.warn(`[boca-bot] Segundo bloqueo en menos de 2 min: el intervalo de ${baseMs}ms dispara el límite, subilo en el popup`);
    }
    lastPenaltyEnd = now;
    penaltyStart = 0;
    pollMs = baseMs;
    return pollMs;
  }

  // Retry-After puede venir en segundos o como fecha; solo es legible si el servidor lo expone por CORS
  function retryAfterMs(res) {
    const v = res.headers.get('Retry-After');
    if (!v) return 0;
    const secs = Number(v);
    if (!Number.isNaN(secs)) return Math.min(secs * 1000, RETRY_AFTER_MAX_MS);
    const date = Date.parse(v);
    return Number.isNaN(date) ? 0 : Math.min(Math.max(date - Date.now(), 0), RETRY_AFTER_MAX_MS);
  }
})();
