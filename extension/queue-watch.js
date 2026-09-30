// queue-watch.js - Corre en la sala de espera de Queue-it (cualquier sitio).
//
// Además de mostrar los datos en el título de la pestaña, informa cada fila
// al panel local del launcher. Cada perfil tiene su propio service worker y
// su propia sessionStorage, por eso clientId identifica una ventana concreta.

const QUEUE_CLIENT_ID_KEY = 'bocaQueueDashboardClientId';

chrome.storage.local.set({ bocaInQueue: true });

function getClientId() {
  try {
    const current = sessionStorage.getItem(QUEUE_CLIENT_ID_KEY);
    if (current) return current;
    const generated = window.crypto?.randomUUID?.() ||
      `queue-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem(QUEUE_CLIENT_ID_KEY, generated);
    return generated;
  } catch (_) {
    return `queue-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

const clientId = getClientId();

// Queue-it muestra u oculta cada campo según el evento; solo leemos los visibles.
function visibleText(id) {
  const element = document.getElementById(id);
  if (!element || element.offsetParent === null) return '';
  const text = element.textContent.trim();
  return /calculating|calculando|estimating|estimando/i.test(text) ? '' : text;
}

function getQueueId() {
  const displayed = (document.getElementById('hlLinkToQueueTicket2')?.textContent || '').trim();
  if (displayed) return displayed;
  try {
    return new URL(location.href).searchParams.get('queueittoken') || '';
  } catch (_) {
    return '';
  }
}

function reportToDashboard(data) {
  try {
    chrome.runtime.sendMessage({ action: 'queueUpdate', data }, () => {
      // Si el launcher no está ejecutándose, no hay nada que hacer.
      void chrome.runtime.lastError;
    });
  } catch (_) {
    // La fila debe seguir funcionando aunque el panel local no esté disponible.
  }
}

function updateQueueInfo() {
  const ahead = visibleText('MainPart_lbUsersInLineAheadOfYou');
  const number = visibleText('MainPart_lbQueueNumber');
  const wait = visibleText('MainPart_lbWhichIsIn');
  const queueId = getQueueId();

  const parts = [];
  if (ahead) parts.push(`👥 ${ahead} adelante`);
  else if (number) parts.push(`#${number}`);
  if (wait) parts.push(`⏱ ${wait}`);
  if (!parts.length) parts.push('⏳ En fila');

  // Los últimos caracteres permiten que el launcher enfoque la ventana correcta.
  if (queueId) parts.push(queueId.slice(-4).toUpperCase());

  const title = parts.join(' · ');
  if (document.title !== title) document.title = title;

  reportToDashboard({
    clientId,
    queueId,
    aheadText: ahead,
    numberText: number,
    waitText: wait,
    updatedAt: Date.now()
  });
}

updateQueueInfo();
setInterval(updateQueueInfo, 1000);
