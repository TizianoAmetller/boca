// background.js - Service Worker para eventos en segundo plano

// El launcher levanta este panel solo en la computadora local. Si el panel
// no está abierto (por ejemplo, cuando se usa la extensión manualmente), el
// error se ignora y el resto de la extensión sigue funcionando.
const QUEUE_DASHBOARD_ENDPOINT = 'http://127.0.0.1:8765/api/queue';

chrome.runtime.onInstalled.addListener(() => {
  console.log('✅ Boca Entradas Bot instalado');
});

// Manejar mensajes entre componentes
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'foundTicket') {
    console.log('🎉 Entrada encontrada!');
    // El popup y content script manejan las notificaciones visuales
  } else if (message.action === 'queueUpdate') {
    fetch(QUEUE_DASHBOARD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message.data || {})
    }).then((response) => response.json()).then((result) => {
      // Desde el panel se pidió quedarse solo con las mejores filas.
      if (result && result.close && sender.tab) chrome.windows.remove(sender.tab.windowId);
    }).catch(() => {
      // El panel es opcional: no interrumpir la espera si todavía no arrancó.
    });
    sendResponse({ accepted: true });
  } else if (message.action === 'queuePassed' && sender.tab) {
    // Esta ventana salió de la fila: traerla al frente y avisar
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '✅ ¡Pasaste la fila!',
      message: 'Esta ventana ya está en Boca Socios. Abrí la extensión e iniciá el bot acá.',
      priority: 2,
      requireInteraction: true
    });
    chrome.windows.update(sender.tab.windowId, { focused: true, drawAttention: true });
    chrome.tabs.update(sender.tab.id, { active: true });
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#16a34a' });
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: 'OK' });
  }
  return true;
});

// Atajo de teclado para detener el bot sin abrir el popup (se cierra solo al recargar)
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'stop-bot') return;
  chrome.storage.local.set({ bocaBotEnabled: false });
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '⏸ Bot detenido',
    message: 'Se detuvo desde el atajo de teclado.'
  });
});
