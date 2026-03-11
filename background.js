// background.js - Service Worker para eventos en segundo plano

chrome.runtime.onInstalled.addListener(() => {
  console.log('✅ Boca Entradas Bot instalado');
});

// Manejar mensajes entre componentes
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'foundTicket') {
    console.log('🎉 Entrada encontrada!');
    // El popup y content script manejan las notificaciones visuales
  }
  return true;
});
