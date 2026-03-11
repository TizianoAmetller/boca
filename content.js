// content.js - Bot TURBO para Boca Entradas

let isMonitoring = false;
let refreshInterval = null;
let pageRefreshInterval = null;
let refreshCount = 0;
let lastCheck = null;
let intervalMs = 500;
let autoRefreshPage = false;
let currentStep = 'sector';
let targetSections = null; // array de códigos de sector (data-section)
let targetSectionsSet = null; // Set para match rápido

// Expresiones regulares para búsqueda de botones
const BUSCAR_REGEX = /buscar\s+asiento\s+disponible/i;
const AGREGAR_REGEX = /[+\s]*agregar\s+platea/i; // Detecta con o sin +, múltiples espacios

// Cache de selectores
const SELECTORS = {
  sectors: 'g[data-section]',
  buttons: 'button:not([disabled]), [role="button"]:not([disabled])',
  modals: '[class*="modal"], [class*="popup"], [role="dialog"]'
};

// Pre-crear evento de click para reutilizar (mejor performance)
const CLICK_EVENT = new MouseEvent('click', {
  bubbles: true,
  cancelable: true,
  view: window
});

// MutationObserver para detectar modales instantáneamente
let modalObserver = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'start':
      startMonitoring(message.interval, message.targetSections ?? message.targetSection, message.autoRefresh);
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

function startMonitoring(interval, section, autoRefresh) {
  if (isMonitoring) return;
  isMonitoring = true;
  intervalMs = Math.max(interval || 500, 100);
  autoRefreshPage = autoRefresh || false;
  refreshCount = 0;
  targetSections = normalizeTargetSections(section);
  targetSectionsSet = targetSections ? new Set(targetSections) : null;
  
  // Detectar paso basado en URL actual
  detectCurrentStep();
  
  // Si estamos en la página de sectores, forzar step = 'sector'
  const url = window.location.href.toLowerCase();
  if (url.includes('/plateas') && !url.includes('/seat') && !url.includes('/reserva')) {
    currentStep = 'sector';
  }
  
  console.log('🚀 Bot TURBO activado - Intervalo:', intervalMs + 'ms');
  checkForTickets();
  refreshInterval = setInterval(checkForTickets, intervalMs);
  
  if (autoRefreshPage) {
    console.log(`⏱️ Auto-refresh activado - cada ${intervalMs/1000} segundos`);
    pageRefreshInterval = setInterval(() => {
      const url = window.location.href.toLowerCase();
      if (url.includes('/plateas') && !url.includes('/seat') && !url.includes('/reserva')) {
        console.log('🔄 Refrescando página...');
        sessionStorage.setItem('bocaBotActive', 'true');
        sessionStorage.setItem('bocaBotSettings', JSON.stringify({
          interval: intervalMs, 
          autoRefresh: autoRefreshPage,
          refreshCount, 
          step: 'sector',
          targetSections
        }));
        window.location.reload();
      } else {
        console.log('🛑 No refrescando - página de asientos/reserva');
        clearInterval(pageRefreshInterval);
        pageRefreshInterval = null;
      }
    }, intervalMs);
  }
}

function detectCurrentStep() {
  const url = window.location.href.toLowerCase();
  
  if (url.includes('/reserva') || url.includes('/checkout')) {
    currentStep = 'reserva';
  } else if (url.includes('/seat') || url.includes('/asiento')) {
    currentStep = 'asiento';
  } else {
    currentStep = 'sector';
  }
}

function stopMonitoring() {
  isMonitoring = false;
  if (refreshInterval) clearInterval(refreshInterval);
  if (pageRefreshInterval) clearInterval(pageRefreshInterval);
  sessionStorage.removeItem('bocaBotActive');
  sessionStorage.removeItem('bocaBotSettings');
  targetSections = null;
  targetSectionsSet = null;
}

function checkForTickets() {
  if (!isMonitoring) return;
  
  // Actualizar estadísticas
  refreshCount++;
  lastCheck = Date.now();
  
  // Enviar estadísticas solo cada 10 checks para reducir overhead
  if (refreshCount % 10 === 0) {
    try {
      chrome.runtime.sendMessage({ action: 'updateStats', refreshCount, lastCheck });
    } catch (e) {}
  }

  try {
    const url = window.location.href.toLowerCase();
    
    // Detectar en qué página estamos
    if (url.includes('/asiento') || url.includes('/seat')) {
      if (currentStep !== 'asiento') {
        currentStep = 'asiento';
        if (pageRefreshInterval) {
          clearInterval(pageRefreshInterval);
          pageRefreshInterval = null;
        }
        // VELOCIDAD EXTREMA: 1ms = 1000 checks por segundo
        clearInterval(refreshInterval);
        refreshInterval = setInterval(checkForTickets, 1);
        // Activar MutationObserver para modales
        setupModalObserver();
      }
    } else if (url.includes('/reserva')) {
      currentStep = 'reserva';
      stopMonitoring();
      return;
    }
    
    // Ejecutar acción según el paso
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
    console.error('❌ Error en checkForTickets:', error);
  }
}

function findAndClickAvailableSector() {
  // Si hay filtro, buscar directo por id (más confiable)
  if (targetSectionsSet && targetSectionsSet.size > 0) {
    const sector = findFirstAvailableTargetSectorById();
    if (!sector) return;
    const sectionId = sector.getAttribute('data-section');
    
    console.log(`🎯 Clickeando sector: ${sectionId}`);
    
    // DETENER SOLO EL AUTO-REFRESH (mantener el monitoreo activo)
    if (pageRefreshInterval) {
      clearInterval(pageRefreshInterval);
      pageRefreshInterval = null;
    }
    
    // Cambiar el paso actual ANTES de hacer click
    currentStep = 'asiento';
    
    // Click usando evento pre-creado (más rápido)
    sector.dispatchEvent(CLICK_EVENT);
    
    return;
  }

  // Sin filtro: Buscar elementos <g> con atributo data-section (sectores disponibles)
  const availableSectors = document.querySelectorAll(SELECTORS.sectors);
  if (availableSectors.length > 0) {
    console.log(`✅ ${availableSectors.length} sectores disponibles`);

    const sector = availableSectors[0];
    const sectionId = sector.getAttribute('data-section');

    console.log(`🎯 Clickeando sector: ${sectionId}`);

    if (pageRefreshInterval) {
      clearInterval(pageRefreshInterval);
      pageRefreshInterval = null;
    }

    currentStep = 'asiento';
    sector.dispatchEvent(CLICK_EVENT);
    return;
  }
}

function findAndClickBuscarAsiento() {
  const buttons = document.querySelectorAll(SELECTORS.buttons);
  
  for (const btn of buttons) {
    const text = btn.textContent;
    if (text && BUSCAR_REGEX.test(text)) {
      btn.click();
      currentStep = 'agregar-platea';
      findAndClickAgregarPlatea();
      return true;
    }
  }
  return false;
}

function findAndClickAgregarPlatea() {
  // Buscar primero en modales visibles
  const modals = document.querySelectorAll(SELECTORS.modals);
  
  for (let modal of modals) {
    const style = window.getComputedStyle(modal);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    
    const buttons = modal.querySelectorAll(SELECTORS.buttons);
    for (let btn of buttons) {
      const text = btn.textContent.trim();
      if (AGREGAR_REGEX.test(text)) {
        console.log('✅ CLICK AGREGAR: "' + text + '" (modal)');
        btn.click();
        console.log('🎉 RESERVADA!');
        stopMonitoring();
        return true;
      }
    }
  }
  
  // Buscar en toda la página
  const buttons = document.querySelectorAll(SELECTORS.buttons);
  for (let btn of buttons) {
    const text = btn.textContent.trim();
    if (AGREGAR_REGEX.test(text)) {
      console.log('✅ CLICK AGREGAR: "' + text + '" (página)');
      btn.click();
      console.log('🎉 RESERVADA!');
      stopMonitoring();
      return true;
    }
  }
  
  return false;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

function initialize() {
  console.log('✅ Bot TURBO:', window.location.href);
  if (!window.location.href.includes('bocasocios.bocajuniors.com.ar')) return;
  
  // Verificar si debemos reiniciar el bot después de un refresh
  if (sessionStorage.getItem('bocaBotActive') === 'true') {
    try {
      const settings = JSON.parse(sessionStorage.getItem('bocaBotSettings') || '{}');
      console.log('🔄 Reiniciando bot después de refresh...');
      
      if (settings.interval) {
        startMonitoring(settings.interval, settings.targetSections ?? null, settings.autoRefresh);
        if (settings.refreshCount) refreshCount = settings.refreshCount;
        if (settings.step) currentStep = settings.step;
        
        console.log('✅ Bot reiniciado');
        console.log('   - Intervalo:', settings.interval + 'ms');
        console.log('   - Auto-refresh:', settings.autoRefresh);
        console.log('   - Paso actual:', currentStep);
      }
    } catch (e) {
      console.error('❌ Error al reiniciar bot:', e);
      sessionStorage.removeItem('bocaBotActive');
      sessionStorage.removeItem('bocaBotSettings');
    }
  }
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
  for (const t of targetSectionsSet) {
    if (k.includes(t)) return true;
  }
  return false;
}

function sectorMatchesTarget(el) {
  if (!targetSectionsSet || targetSectionsSet.size === 0) return true;
  if (anyKeyMatchesTargets(el?.getAttribute?.('data-section'))) return true;
  if (anyKeyMatchesTargets(el?.getAttribute?.('data-name'))) return true;
  if (anyKeyMatchesTargets(el?.getAttribute?.('aria-label'))) return true;
  if (anyKeyMatchesTargets(el?.id)) return true;
  const cls = el?.className?.baseVal || el?.className;
  if (anyKeyMatchesTargets(cls)) return true;
  try {
    const t = el?.textContent;
    if (anyKeyMatchesTargets(t)) return true;
  } catch (e) {}
  return false;
}

function pickFirstMatchingSector(nodeList) {
  for (const el of nodeList) {
    if (sectorMatchesTarget(el)) return el;
  }
  return null;
}

function findFirstAvailableTargetSectorById() {
  // 1) Camino rápido: ids con patrón conocido (ej: "seccion-F_1_")
  for (const t of targetSectionsSet) {
    const idPrefix = cssEscape(String(t));
    const candidates = [
      ...document.querySelectorAll(`g[id^="seccion-${idPrefix}"]`),
      ...document.querySelectorAll(`g[id^="section-${idPrefix}"]`)
    ];
    for (const el of candidates) {
      if (isSectorAvailable(el)) return el;
    }
  }

  // 2) Fallback robusto: usar el texto visible dentro del grupo SVG
  const allGroups = document.querySelectorAll('svg g');
  for (const el of allGroups) {
    if (!el || !isSectorAvailable(el)) continue;
    const label = getSectorLabelFromGroup(el);
    if (!label) continue;
    const key = normalizeKey(label);
    for (const t of targetSectionsSet) {
      if (key === t || key.includes(t)) {
        return el;
      }
    }
  }

  return null;
}

function isSectorAvailable(el) {
  if (!el) return false;
  if (el.getAttribute && el.getAttribute('data-section')) return true;
  const path = el.querySelector?.('path, polygon, rect, circle, ellipse');
  if (!path) return false;
  const fill = window.getComputedStyle(path).fill;
  return isGreenish(fill);
}

function isGreenish(color) {
  const rgb = parseRgb(color);
  if (!rgb) return false;
  const { r, g, b } = rgb;
  return g > 120 && g >= r + 25 && g >= b + 25;
}

function parseRgb(color) {
  if (!color) return null;
  const m = String(color).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

function cssEscape(s) {
  return String(s).replace(/["\\\]]/g, '\\$&');
}

function getSectorLabelFromGroup(g) {
  if (!g) return '';
  const textNode = g.querySelector?.('text, tspan');
  if (textNode && textNode.textContent) {
    return textNode.textContent.trim();
  }
  const raw = g.textContent || '';
  return raw.trim();
}

// MutationObserver para detectar modales instantáneamente (más rápido que interval)
function setupModalObserver() {
  if (modalObserver) return; // Ya está activo
  
  modalObserver = new MutationObserver((mutations) => {
    if (currentStep !== 'agregar-platea') return;
    
    // Buscar botón inmediatamente cuando el DOM cambia
    // Primero en modales
    const modals = document.querySelectorAll(SELECTORS.modals);
    for (let modal of modals) {
      const style = window.getComputedStyle(modal);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        const buttons = modal.querySelectorAll(SELECTORS.buttons);
        for (let btn of buttons) {
          const text = btn.textContent.trim();
          if (AGREGAR_REGEX.test(text)) {
            console.log('⚡ Observer: "' + text + '" (modal)');
            btn.click();
            console.log('🎉 RESERVADA!');
            stopMonitoring();
            return;
          }
        }
      }
    }
    
    // También buscar en toda la página por si no es modal
    const allButtons = document.querySelectorAll(SELECTORS.buttons);
    for (let btn of allButtons) {
      const text = btn.textContent.trim();
      if (AGREGAR_REGEX.test(text)) {
        console.log('⚡ Observer: "' + text + '" (página)');
        btn.click();
        console.log('🎉 RESERVADA!');
        stopMonitoring();
        return;
      }
    }
  });
  
  // Observar todo el body para detectar cualquier cambio
  modalObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class']
  });
  
  console.log('👁️ MutationObserver activado para modales');
}

