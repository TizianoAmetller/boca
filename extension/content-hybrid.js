// content-hybrid.js - Bot HÍBRIDO: Velocidad extrema + MutationObserver

let isMonitoring = false;
let refreshInterval = null;
let pageRefreshInterval = null;
let refreshCount = 0;
let lastCheck = null;
let intervalMs = 500;
let autoRefreshPage = false;
let reloadMs = 1000; // intervalo de recarga de página, independiente del intervalo de chequeo
let currentStep = 'sector';
let targetSections = null; // array de códigos de sector (data-section)
let targetSectionsSet = null; // Set para match rápido

// Expresiones regulares MEJORADAS
const BUSCAR_REGEX = /buscar\s+asiento\s+disponible/i;
const AGREGAR_REGEX = /(agregar|añadir)\s+(platea|entrada)/i; // Más flexible

// Cache de selectores
const SELECTORS = {
  sectors: 'g[data-section]',
  allSvgGroups: 'svg g',
  buttons: 'button:not([disabled]), [role="button"]:not([disabled])',
  modals: '[class*="modal"], [class*="popup"], [role="dialog"]',
  // Selectores específicos para búsqueda optimizada
  buscarButton: 'button:not([disabled])', // Botones activos solamente
  agregarButton: 'button:not([disabled])', // Botones activos solamente
  svgContainer: 'svg' // Contenedor SVG principal
};

// Evento pre-creado
const CLICK_EVENT = new MouseEvent('click', {
  bubbles: true,
  cancelable: true,
  view: window
});

// MutationObserver para modales
let modalObserver = null;
let sectorObserver = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'start':
      startMonitoring(message.interval, message.targetSections ?? message.targetSection, message.autoRefresh, message.reloadInterval);
      sendResponse({ success: true });
      break;
    case 'stop':
      stopMonitoring();
      sendResponse({ success: true });
      break;
    case 'getStatus':
      sendResponse({ isActive: isMonitoring, refreshCount, lastCheck });
      break;
    case 'getSectors':
      sendResponse({ sectors: getAvailableSectorsSnapshot() });
      break;
  }
  return true;
});

function startMonitoring(interval, section, autoRefresh, reloadInterval) {
  if (isMonitoring) return;
  isMonitoring = true;
  intervalMs = Math.max(interval || 500, 100);
  autoRefreshPage = autoRefresh || false;
  reloadMs = Math.max(reloadInterval || 1000, 300);
  refreshCount = 0;
  targetSections = normalizeTargetSections(section);
  targetSectionsSet = targetSections ? new Set(targetSections) : null;
  
  // Detectar paso actual
  const url = window.location.href.toLowerCase();
  if (url.includes('/plateas') && !url.includes('/seat') && !url.includes('/reserva')) {
    currentStep = 'sector';
    setupSectorObserver(); // Activar observer para detección instantánea
  } else if (url.includes('/asiento') || url.includes('/seat')) {
    currentStep = 'asiento';
  }
  
  console.log('🚀 Bot HÍBRIDO activado');
  persistBotState();
  checkForTicketsRAF();

  if (autoRefreshPage && currentStep === 'sector') {
    // Primero consultamos solo la API de disponibilidad (page-poll.js); si no se puede, recargamos
    apiPolling = true;
    postToPage('poll-start', { targets: targetSections, intervalMs: reloadMs });
    pollAckTimer = setTimeout(() => {
      if (apiPolling) fallbackToReload('page-poll.js no respondió');
    }, 1500);
  }
}

function startReloadLoop() {
  pageRefreshInterval = setInterval(() => {
    const url = window.location.href.toLowerCase();
    if (url.includes('/plateas') && !url.includes('/seat') && !url.includes('/reserva')) {
      persistBotState();
      window.location.reload();
    } else {
      clearInterval(pageRefreshInterval);
      pageRefreshInterval = null;
    }
  }, reloadMs);
}

// --- Polling por API (sin recargar la página) ---
let apiPolling = false;
let pollAckTimer = null;

function postToPage(type, data = {}) {
  window.postMessage({ source: 'boca-bot', dir: 'content', type, ...data }, '*');
}

function stopApiPolling() {
  if (pollAckTimer) clearTimeout(pollAckTimer);
  pollAckTimer = null;
  if (apiPolling) postToPage('poll-stop');
  apiPolling = false;
}

function fallbackToReload(reason) {
  console.warn('⚠️ Polling por API no disponible (' + reason + '), vuelvo a recargar la página');
  stopApiPolling();
  if (isMonitoring && autoRefreshPage && currentStep === 'sector' && !pageRefreshInterval) {
    startReloadLoop();
  }
}

window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.source !== 'boca-bot' || e.data.dir !== 'page') return;
  if (!apiPolling) return;
  switch (e.data.type) {
    case 'poll-ready':
      clearTimeout(pollAckTimer);
      pollAckTimer = null;
      console.log('🔁 Consultando disponibilidad por API cada ' + reloadMs + 'ms (sin recargar)');
      break;
    case 'poll-tick':
      refreshCount++;
      break;
    case 'poll-found':
      // page-poll.js ya navegó al sector; el loop RAF detecta /seats/ y sigue el flujo
      console.log('🎯 Sector disponible por API: ' + e.data.codigo);
      apiPolling = false;
      currentStep = 'asiento';
      break;
    case 'poll-failed':
      apiPolling = false;
      fallbackToReload(e.data.reason);
      break;
  }
});

function persistBotState() {
  sessionStorage.setItem('bocaBotActive', 'true');
  sessionStorage.setItem('bocaBotSettings', JSON.stringify({
    interval: intervalMs,
    autoRefresh: autoRefreshPage,
    reloadInterval: reloadMs,
    refreshCount,
    step: currentStep,
    targetSections,
  }));
}

function stopMonitoring() {
  isMonitoring = false;
  if (refreshInterval) clearInterval(refreshInterval);
  if (pageRefreshInterval) clearInterval(pageRefreshInterval);
  if (rafId) cancelAnimationFrame(rafId);
  stopApiPolling();
  refreshInterval = null;
  pageRefreshInterval = null;
  rafId = null;
  targetSections = null;
  targetSectionsSet = null;
  if (modalObserver) {
    modalObserver.disconnect();
    modalObserver = null;
  }
  if (sectorObserver) {
    sectorObserver.disconnect();
    sectorObserver = null;
  }
  sessionStorage.removeItem('bocaBotActive');
  sessionStorage.removeItem('bocaBotSettings');
  chrome.storage.local.set({ bocaBotEnabled: false });
}

// El popup apaga el bot escribiendo en chrome.storage: funciona aunque la página
// se esté recargando y el mensaje 'stop' no tenga a quién llegar.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.bocaBotEnabled?.newValue === false && isMonitoring) {
    stopMonitoring();
  }
});

// Función principal con requestAnimationFrame
let rafId = null;
let lastRAFTime = 0;

function checkForTicketsRAF(timestamp = 0) {
  if (!isMonitoring) return;
  
  // Control de throttle basado en intervalMs
  const url = window.location.href.toLowerCase();
  const isAsientosPage = url.includes('/asiento') || url.includes('/seat');
  const currentInterval = isAsientosPage ? 0 : intervalMs;
  
  if (timestamp - lastRAFTime < currentInterval) {
    rafId = requestAnimationFrame(checkForTicketsRAF);
    return;
  }
  
  lastRAFTime = timestamp;
  refreshCount++;
  lastCheck = Date.now();

  try {
    // Detectar página y optimizar velocidad
    if (isAsientosPage) {
      if (currentStep !== 'asiento') {
        currentStep = 'asiento';
        if (pageRefreshInterval) {
          clearInterval(pageRefreshInterval);
          pageRefreshInterval = null;
        }
        stopApiPolling();
        setupModalObserver();
      }
    } else if (url.includes('/reserva')) {
      stopMonitoring();
      return;
    }
    
    // Ejecutar acción
    switch (currentStep) {
      case 'sector':
        findAndClickAvailableSector();
        break;
      case 'asiento':
        findAndClickBuscarAsiento();
        break;
      case 'agregar-platea':
        findAndClickAgregarPlatea();
        break;
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  // Continuar loop
  rafId = requestAnimationFrame(checkForTicketsRAF);
}

// Mantener checkForTickets legacy para setInterval de pageRefresh
function checkForTickets() {
  if (!isMonitoring) return;
  
  refreshCount++;
  lastCheck = Date.now();

  try {
    const url = window.location.href.toLowerCase();
    
    // Detectar página y optimizar velocidad
    if (url.includes('/asiento') || url.includes('/seat')) {
      if (currentStep !== 'asiento') {
        currentStep = 'asiento';
        if (pageRefreshInterval) {
          clearInterval(pageRefreshInterval);
          pageRefreshInterval = null;
        }
        stopApiPolling();
        // VELOCIDAD EXTREMA: 0ms = ejecutar lo más rápido posible
        clearInterval(refreshInterval);
        refreshInterval = setInterval(checkForTickets, 0);
        setupModalObserver();
      }
    } else if (url.includes('/reserva')) {
      stopMonitoring();
      return;
    }
    
    // Ejecutar acción
    switch (currentStep) {
      case 'sector':
        findAndClickAvailableSector();
        break;
      case 'asiento':
        findAndClickBuscarAsiento();
        break;
      case 'agregar-platea':
        findAndClickAgregarPlatea();
        break;
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

function findAndClickAvailableSector() {
  // Si hay filtro de sectores, buscar SOLO esos códigos
  if (targetSectionsSet && targetSectionsSet.size > 0) {
    const sector = findFirstAvailableTargetSector();
    if (!sector) return false;
    
    if (pageRefreshInterval) {
      clearInterval(pageRefreshInterval);
      pageRefreshInterval = null;
    }
    stopApiPolling();
    
    currentStep = 'asiento';
    
    // CLICKS DOBLES - rápido y sin riesgo de doble submit
    sector.dispatchEvent(CLICK_EVENT);
    sector.dispatchEvent(CLICK_EVENT);
    
    return true; // EARLY RETURN - ya encontró sector
  }

  // Sin filtro: primer sector marcado como disponible por el sitio
  const sectors = document.querySelectorAll(SELECTORS.sectors); // g[data-section]
  if (sectors.length > 0) {
    const sector = sectors[0];
    if (!sector) return false;

    if (pageRefreshInterval) {
      clearInterval(pageRefreshInterval);
      pageRefreshInterval = null;
    }
    stopApiPolling();

    currentStep = 'asiento';
    sector.dispatchEvent(CLICK_EVENT);
    sector.dispatchEvent(CLICK_EVENT);
    return true;
  }
  return false;
}

function findAndClickBuscarAsiento() {
  // Buscar solo botones (más específico que todos los elementos)
  const buttons = document.querySelectorAll(SELECTORS.buscarButton);
  
  for (const btn of buttons) {
    const text = btn.textContent;
    if (text && BUSCAR_REGEX.test(text)) {
      // Click doble + llamada inmediata
      btn.click();
      btn.click();
      currentStep = 'agregar-platea';
      // Buscar AGREGAR inmediatamente - PASAR BOTONES CACHEADOS
      findAndClickAgregarPlatea(buttons);
      break; // EARLY BREAK - no seguir buscando
    }
  }
  return false;
}

function findAndClickAgregarPlatea(cachedButtons) {
  // OPTIMIZACIÓN: Buscar párrafos con texto exacto primero (más rápido)
  const paragraphs = document.querySelectorAll('p[role="paragraph"]');
  for (let p of paragraphs) {
    const text = p.textContent.trim();
    if (text === 'Agregar platea' || text === 'AGREGAR PLATEA' || text === '+ AGREGAR PLATEA') {
      // Encontrar el botón padre
      const btn = p.closest('button');
      if (btn && !btn.disabled) {
        btn.click();
        stopMonitoring();
        return true;
      }
    }
  }
  
  // FALLBACK: Usar botones cacheados si están disponibles
  const allButtons = cachedButtons || document.querySelectorAll(SELECTORS.agregarButton);
  
  // 1. Búsqueda exacta en botones
  for (let btn of allButtons) {
    const text = btn.textContent.trim();
    if (text === '+ AGREGAR PLATEA' || text === 'AGREGAR PLATEA') {
      btn.click();
      stopMonitoring();
      return true;
    }
  }
  
  // 2. Búsqueda flexible
  for (let btn of allButtons) {
    const textLower = btn.textContent.trim().toLowerCase();
    if (textLower.includes('agregar') && textLower.includes('platea')) {
      btn.click();
      stopMonitoring();
      return true;
    }
  }
  
  return false;
}

// MutationObserver para detectar modales INSTANTÁNEAMENTE
function setupModalObserver() {
  if (modalObserver) return;
  
  modalObserver = new MutationObserver(() => {
    if (currentStep !== 'agregar-platea') return;
    
    // OPTIMIZACIÓN: Buscar párrafos primero
    const paragraphs = document.querySelectorAll('p[role="paragraph"]');
    for (let p of paragraphs) {
      const text = p.textContent.trim();
      if (text === 'Agregar platea' || text === 'AGREGAR PLATEA' || text === '+ AGREGAR PLATEA') {
        const btn = p.closest('button');
        if (btn && !btn.disabled) {
          btn.click();
          stopMonitoring();
          return;
        }
      }
    }
    
    // FALLBACK: Búsqueda tradicional
    const allButtons = document.querySelectorAll(SELECTORS.buttons);
    
    for (let btn of allButtons) {
      const text = btn.textContent.trim();
      if (text === '+ AGREGAR PLATEA' || text === 'AGREGAR PLATEA') {
        btn.click();
        stopMonitoring();
        return;
      }
    }
    
    for (let btn of allButtons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text.includes('agregar') && text.includes('platea')) {
        btn.click();
        stopMonitoring();
        return;
      }
    }
  });
  
  modalObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'aria-hidden', 'open']
  });
  
  console.log('👁️ Observer activado');
}

// MutationObserver para sectores SVG - DETECCIÓN INSTANTÁNEA
function setupSectorObserver() {
  if (sectorObserver) return;
  
  sectorObserver = new MutationObserver(() => {
    if (currentStep !== 'sector' || !isMonitoring) return;

    // Con filtro: chequear directo solo los sectores objetivo
    if (targetSectionsSet && targetSectionsSet.size > 0) {
      const sector = findFirstAvailableTargetSector();
      if (!sector) return;
      
      if (pageRefreshInterval) {
        clearInterval(pageRefreshInterval);
        pageRefreshInterval = null;
      }
      stopApiPolling();
      
      currentStep = 'asiento';
      
      // CLICKS DOBLES INSTANTÁNEOS
      sector.dispatchEvent(CLICK_EVENT);
      sector.dispatchEvent(CLICK_EVENT);
      
      // Desconectar observer después de encontrar sector
      sectorObserver.disconnect();
      sectorObserver = null;
      return;
    }

    // Sin filtro: cualquier sector "disponible" (data-section)
    const sectors = document.querySelectorAll(SELECTORS.sectors);
    if (sectors.length > 0) {
      const sector = sectors[0];
      if (!sector) return;

      if (pageRefreshInterval) {
        clearInterval(pageRefreshInterval);
        pageRefreshInterval = null;
      }
      stopApiPolling();

      currentStep = 'asiento';
      sector.dispatchEvent(CLICK_EVENT);
      sector.dispatchEvent(CLICK_EVENT);

      sectorObserver.disconnect();
      sectorObserver = null;
    }
  });
  
  sectorObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-section', 'class', 'style']
  });
  
  console.log('🎯 Observer de sectores activado');
}

// Inicialización
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

function initialize() {
  if (!window.location.href.includes('bocasocios.bocajuniors.com.ar')) return;

  checkQueuePassed();

  if (sessionStorage.getItem('bocaBotActive') === 'true') {
    // Solo retomar si no se pidió detener mientras la página recargaba
    chrome.storage.local.get('bocaBotEnabled', ({ bocaBotEnabled }) => {
      if (bocaBotEnabled === false) {
        sessionStorage.removeItem('bocaBotActive');
        sessionStorage.removeItem('bocaBotSettings');
        return;
      }
      try {
        const settings = JSON.parse(sessionStorage.getItem('bocaBotSettings') || '{}');
        if (settings.interval) {
          startMonitoring(settings.interval, settings.targetSections ?? null, settings.autoRefresh, settings.reloadInterval);
          if (settings.refreshCount) refreshCount = settings.refreshCount;
          if (settings.step) currentStep = settings.step;
        }
      } catch (e) {
        sessionStorage.removeItem('bocaBotActive');
        sessionStorage.removeItem('bocaBotSettings');
      }
    });
  }
}

// Aviso de "pasaste la fila": queue-watch.js marca bocaInQueue mientras estamos en
// Queue-it; al volver a Boca (o si la URL trae queueittoken) avisamos una sola vez.
function checkQueuePassed() {
  // location.reload() conserva queueittoken en la URL: avisar solo una vez por pestaña
  if (sessionStorage.getItem('bocaQueueAlerted') === 'true') return;
  const hasToken = /[?&]queueittoken=/i.test(window.location.search);
  chrome.storage.local.get('bocaInQueue', ({ bocaInQueue }) => {
    if (!bocaInQueue && !hasToken) return;
    sessionStorage.setItem('bocaQueueAlerted', 'true');
    chrome.storage.local.set({ bocaInQueue: false });
    chrome.runtime.sendMessage({ action: 'queuePassed' });

    // El sitio puede pisar el título al navegar: lo re-aplicamos un rato
    const prefix = '✅ ADENTRO — ';
    let ticks = 0;
    const titleTimer = setInterval(() => {
      if (!document.title.startsWith(prefix)) document.title = prefix + document.title;
      if (++ticks >= 300) clearInterval(titleTimer);
    }, 1000);
  });
}

function normalizeTargetSections(input) {
  if (!input) return null;
  if (Array.isArray(input)) {
    const arr = input.map(v => String(v).trim()).filter(Boolean);
    return arr.length ? arr.map(normalizeKey) : null;
  }
  if (typeof input === 'string') {
    const arr = input.split(/[,\s]+/g).map(v => v.trim()).filter(Boolean);
    return arr.length ? arr.map(normalizeKey) : null;
  }
  return null;
}

function normalizeKey(s) {
  return String(s).toUpperCase().replace(/\s+/g, '');
}

function anyKeyMatchesTargets(rawKey) {
  if (!targetSectionsSet || targetSectionsSet.size === 0) return true;
  if (!rawKey) return false;
  const k = normalizeKey(rawKey);
  if (!k) return false;
  if (targetSectionsSet.has(k)) return true;
  // Match por "contiene" solo si hay filtro (sigue siendo barato: pocos targets)
  for (const t of targetSectionsSet) {
    if (k.includes(t)) return true;
  }
  return false;
}

function sectorMatchesTarget(el) {
  if (!targetSectionsSet || targetSectionsSet.size === 0) return true;
  // Camino rápido: data-section (en este sitio suele existir)
  if (anyKeyMatchesTargets(el?.getAttribute?.('data-section'))) return true;
  // Fallbacks livianos
  if (anyKeyMatchesTargets(el?.getAttribute?.('data-name'))) return true;
  if (anyKeyMatchesTargets(el?.getAttribute?.('aria-label'))) return true;
  if (anyKeyMatchesTargets(el?.id)) return true;
  const cls = el?.className?.baseVal || el?.className;
  if (anyKeyMatchesTargets(cls)) return true;
  // Último recurso (más caro): texto interno
  try {
    const t = el?.textContent;
    if (anyKeyMatchesTargets(t)) return true;
  } catch (e) {}
  return false;
}

function findFirstAvailableTargetSector() {
  if (!targetSectionsSet || targetSectionsSet.size === 0) return null;
  // Recorremos todos los grupos de sectores por id ("seccion-XXX_..."),
  // pero solo clickeamos cuando el sitio los marca como disponibles (data-section presente).
  const groups = document.querySelectorAll('g[id^="seccion-"]');
  for (const g of groups) {
    const shortCode = getSectorKeyFromId(g.id);
    if (!shortCode) continue;
    const key = normalizeKey(shortCode);
    if (!targetSectionsSet.has(key)) continue;
    // Solo considerar disponibles si el sitio les puso data-section
    if (!g.getAttribute || !g.getAttribute('data-section')) continue;
    return g;
  }
  return null;
}

function getAvailableSectorsSnapshot() {
  // Lista de TODOS los sectores del mapa (por id),
  // independientemente de si en este momento tienen data-section o no.
  const groups = document.querySelectorAll('g[id^="seccion-"]');
  const seen = new Set();
  const result = [];
  for (const g of groups) {
    const base = getSectorKeyFromId(g.id);
    if (!base) continue;
    const norm = normalizeKey(base);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    const hasData = !!(g.getAttribute && g.getAttribute('data-section'));
    result.push({ code: base, id: g.id || null, hasDataSection: hasData });
  }
  result.sort((a, b) => a.code.localeCompare(b.code));
  return result;
}

function getSectorKeyFromId(id) {
  if (!id || typeof id !== 'string') return '';
  // Ejemplos: "seccion-F_1_", "seccion-PLCPREF_1_", "seccion-TS1_1_"
  const prefix = 'seccion-';
  const idx = id.indexOf(prefix);
  if (idx === -1) return '';
  const after = id.slice(idx + prefix.length);
  const parts = after.split('_');
  return parts[0] || '';
}

function pickFirstMatchingSector(nodeList) {
  for (const el of nodeList) {
    if (sectorMatchesTarget(el)) return el;
  }
  return null;
}
