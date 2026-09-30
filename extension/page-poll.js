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
  let pollMs = 1000;
  let backoffUntil = 0;

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
      pollMs = e.data.intervalMs;
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
    if (Date.now() < backoffUntil) {
      pollTimer = setTimeout(tick, backoffUntil - Date.now());
      return;
    }
    try {
      const res = await origFetch(captured.url, { headers: captured.headers, credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!polling) return;

      // Mismo manejo que el interceptor del sitio: fila de Queue-it
      if (data?.errorCode === 50000 && data.newRedirectUrl) {
        window.location.replace(data.newRedirectUrl);
        return;
      }
      if (res.status === 429) {
        backoffUntil = Date.now() + 3000;
      } else if (!res.ok) {
        // Token vencido u otro error: que el content script vuelva a recargar la página
        polling = false;
        post('poll-failed', { reason: `http-${res.status}`, codigo: data?.codigo });
        return;
      } else {
        post('poll-tick');
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
      console.warn('[boca-bot] error consultando disponibilidad', err);
    }
    if (polling) pollTimer = setTimeout(tick, pollMs);
  }
})();
