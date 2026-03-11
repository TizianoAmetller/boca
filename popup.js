// popup.js - Control del bot desde la interfaz

document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const statusDiv = document.getElementById('status');
  const refreshIntervalInput = document.getElementById('refreshInterval');
  const sectorsContainer = document.getElementById('sectorsContainer');
  const sectorsEmpty = document.getElementById('sectorsEmpty');
  const autoRefreshCheckbox = document.getElementById('autoRefresh');
  const refreshCountSpan = document.getElementById('refreshCount');
  const lastCheckSpan = document.getElementById('lastCheck');

  let availableSectors = [];
  let selectedSectorCodes = new Set();

  // Cargar estado guardado
  loadSettings();

  // Obtener la pestaña activa
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];
    
    if (!currentTab.url.includes('bocasocios.bocajuniors.com.ar')) {
      statusDiv.className = 'status inactive';
      statusDiv.innerHTML = '⚠ Abre la página de Boca Socios';
      startBtn.disabled = true;
      return;
    }

    // Verificar estado actual del bot
    chrome.tabs.sendMessage(currentTab.id, { action: 'getStatus' }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('No hay content script activo aún');
        return;
      }
      
      if (response && response.isActive) {
        updateUI(true);
        refreshCountSpan.textContent = response.refreshCount || 0;
        if (response.lastCheck) {
          lastCheckSpan.textContent = new Date(response.lastCheck).toLocaleTimeString();
        }
      }
    });

    // Cargar lista de sectores disponibles desde el content script
    loadSectorsForTab(currentTab);

    startBtn.addEventListener('click', () => {
      const interval = parseFloat(refreshIntervalInput.value) * 1000 || 100;
      const autoRefresh = autoRefreshCheckbox.checked;
      const targetSections = Array.from(selectedSectorCodes);
      
      saveSettings();
      
      chrome.tabs.sendMessage(currentTab.id, {
        action: 'start',
        interval: interval,
        targetSections,
        autoRefresh: autoRefresh
      }, (response) => {
        if (chrome.runtime.lastError) {
          // Inyectar content script si no está disponible
          chrome.scripting.executeScript({
            target: { tabId: currentTab.id },
            files: ['content-hybrid.js']
          }, () => {
            chrome.tabs.sendMessage(currentTab.id, {
              action: 'start',
              interval: interval,
              targetSections,
              autoRefresh: autoRefresh
            });
          });
        }
        updateUI(true);
      });
    });

    stopBtn.addEventListener('click', () => {
      chrome.tabs.sendMessage(currentTab.id, { action: 'stop' }, () => {
        updateUI(false);
      });
    });
  });

  // Escuchar mensajes del content script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateStats') {
      refreshCountSpan.textContent = message.refreshCount || 0;
      if (message.lastCheck) {
        lastCheckSpan.textContent = new Date(message.lastCheck).toLocaleTimeString();
      }
    } else if (message.action === 'foundTicket') {
      statusDiv.className = 'status success';
      statusDiv.innerHTML = '🎉 ¡ENTRADA ENCONTRADA!';
      updateUI(false);
    }
  });

  function updateUI(isActive) {
    if (isActive) {
      statusDiv.className = 'status active';
      statusDiv.innerHTML = '🔄 Monitoreando...';
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';
    } else {
      statusDiv.className = 'status inactive';
      statusDiv.innerHTML = '⏸ Detenido';
      startBtn.style.display = 'block';
      stopBtn.style.display = 'none';
    }
  }

  function saveSettings() {
    chrome.storage.local.set({
      refreshInterval: refreshIntervalInput.value,
      autoRefresh: autoRefreshCheckbox.checked,
      selectedSectorCodes: Array.from(selectedSectorCodes)
    });
  }

  function loadSettings() {
    chrome.storage.local.get(['refreshInterval', 'autoRefresh', 'selectedSectorCodes'], (result) => {
      if (result.refreshInterval) {
        refreshIntervalInput.value = result.refreshInterval;
      }
      if (result.autoRefresh !== undefined) {
        autoRefreshCheckbox.checked = result.autoRefresh;
      }
      if (Array.isArray(result.selectedSectorCodes)) {
        selectedSectorCodes = new Set(result.selectedSectorCodes);
      }
    });
  }

  function loadSectorsForTab(tab) {
    chrome.tabs.sendMessage(tab.id, { action: 'getSectors' }, (response) => {
      if (chrome.runtime.lastError) {
        // Intentar inyectar el content script y reintentar una vez
        chrome.scripting.executeScript(
          {
            target: { tabId: tab.id },
            files: ['content-hybrid.js']
          },
          () => {
            chrome.tabs.sendMessage(tab.id, { action: 'getSectors' }, (resp2) => {
              if (chrome.runtime.lastError) {
                renderSectors([]);
              } else {
                renderSectors(resp2 && Array.isArray(resp2.sectors) ? resp2.sectors : []);
              }
            });
          }
        );
        return;
      }
      renderSectors(response && Array.isArray(response.sectors) ? response.sectors : []);
    });
  }

  function renderSectors(sectors) {
    availableSectors = sectors || [];
    sectorsContainer.innerHTML = '';

    if (!availableSectors.length) {
      sectorsEmpty.style.display = 'block';
      return;
    }
    sectorsEmpty.style.display = 'none';

    availableSectors.forEach(({ code }) => {
      const normalized = String(code).trim();
      const isChecked = selectedSectorCodes.has(normalized.toUpperCase());

      const label = document.createElement('label');
      label.className = 'sector-pill';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = isChecked;
      checkbox.addEventListener('change', () => {
        const key = normalized.toUpperCase();
        if (checkbox.checked) {
          selectedSectorCodes.add(key);
        } else {
          selectedSectorCodes.delete(key);
        }
        // Persistir selección rápidamente
        chrome.storage.local.set({
          selectedSectorCodes: Array.from(selectedSectorCodes)
        });
      });

      const span = document.createElement('span');
      span.textContent = normalized;

      label.appendChild(checkbox);
      label.appendChild(span);
      sectorsContainer.appendChild(label);
    });
  }
});
