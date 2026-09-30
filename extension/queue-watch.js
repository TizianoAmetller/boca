// queue-watch.js - Corre en la sala de espera de Queue-it (cualquier sitio).
// 1) Marca que este perfil está en la fila; content-hybrid.js avisa cuando volvemos a Boca Socios.
// 2) Pone en el título de la pestaña cuánta gente hay adelante y la espera estimada, para
//    comparar de un vistazo varias ventanas abiertas con el launcher.
chrome.storage.local.set({ bocaInQueue: true });

// Queue-it muestra u oculta cada campo según el evento; solo leemos los visibles.
function visibleText(id) {
  const el = document.getElementById(id);
  if (!el || el.offsetParent === null) return '';
  const text = el.textContent.trim();
  return /calculating|calculando/i.test(text) ? '' : text;
}

setInterval(() => {
  const ahead = visibleText('MainPart_lbUsersInLineAheadOfYou');
  const number = visibleText('MainPart_lbQueueNumber');
  const wait = visibleText('MainPart_lbWhichIsIn');
  const queueId = (document.getElementById('hlLinkToQueueTicket2')?.textContent || '').trim();

  const parts = [];
  if (ahead) parts.push(`👥 ${ahead} adelante`);
  else if (number) parts.push(`#${number}`);
  if (wait) parts.push(`⏱ ${wait}`);
  if (!parts.length) parts.push('⏳ En fila');
  // Últimos 4 caracteres del QueueId: tienen que ser distintos en cada ventana
  if (/^[0-9a-f-]{36}$/i.test(queueId) && !/^[0-]+$/.test(queueId)) parts.push(queueId.slice(-4));

  const title = parts.join(' · ');
  if (document.title !== title) document.title = title;
}, 1000);
