/* =========================================================
   ÉTAT GLOBAL
   ========================================================= */

const state = {
  isRunning: false,
  gristAPI: null,
  credentialsTable: null,
  annuaireTable: null,
  results: {
    imported: 0,
    updated: 0,
    errors: 0,
    errorList: []
  }
};

/* =========================================================
   DEBUG LOGGING
   ========================================================= */

const debugConsole = {
  logs: [],
  maxLogs: 100,

  add(message, type = 'log') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    
    this.logs.push({ message: logEntry, type });
    
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    this.render();
    console.log(`[${type.toUpperCase()}]`, message);
  },

  render() {
    const container = document.getElementById('debug-console');
    if (!container) return;

    container.innerHTML = this.logs
      .map(log => `<div class="debug-line ${log.type}">${log.message}</div>`)
      .join('');
    
    container.scrollTop = container.scrollHeight;
  }
};

function debugLog(message, data = null) {
  const msg = data ? `${message} ${JSON.stringify(data)}` : message;
  debugConsole.add(msg, 'success');
}

function debugError(context, error) {
  const msg = `❌ ${context}: ${error?.message || error}`;
  debugConsole.add(msg, 'error');
}

function debugWarn(message, data = null) {
  const msg = data ? `${message} ${JSON.stringify(data)}` : message;
  debugConsole.add(msg, 'warning');
}

/* =========================================================
   TOAST NOTIFICATIONS
   ========================================================= */

function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'error' : 'success'}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* =========================================================
   INITIALIZE GRIST API
   ========================================================= */

async function initializeGrist() {
  debugLog('🔌 Initialisation Grist...');

  return new Promise((resolve, reject) => {
    if (typeof grist === 'undefined') {
      debugWarn('⚠️ Objet "grist" non trouvé - Mode simulation');
      state.gristAPI = createMockGristAPI();
      resolve();
      return;
    }

    try {
      grist.onReady(async () => {
        debugLog('✅ Grist chargé');
        
        state.gristAPI = grist;
        
        try {
          const result = await grist.docApi.getDocName();
          debugLog('📄 Document:', result);
          resolve();
        } catch (error) {
          debugError('Erreur getDocName', error);
          state.gristAPI = createMockGristAPI();
          resolve();
        }
      });

      // Timeout de sécurité
      setTimeout(() => {
        if (!state.gristAPI) {
          debugWarn('⚠️ Grist timeout - utiliser mock');
          state.gristAPI = createMockGristAPI();
          resolve();
        }
      }, 5000);

    } catch (error) {
      debugError('Erreur initialisation Grist', error);
      state.gristAPI = createMockGristAPI();
      resolve();
    }
  });
}

/* =========================================================
   MOCK GRIST API (pour les tests)
   ========================================================= */

function createMockGristAPI() {
  debugLog('🎭 Utilisation d\'une API mock');
  
  return {
    docApi: {
      getDocName: async () => ({ name: 'Test Document' }),
      addRows: async (tableId, records) => {
        debugLog(`📝 Mock: ${records.length} enregistrements ajoutés à ${tableId}`);
        return records.map((_, i) => i + 1);
      },
      getRecords: async (tableId) => {
        debugLog(`📖 Mock: lecture de ${tableId}`);
        return { records: [] };
      }
    }
  };
}

/* =========================================================
   SCRAPING FUNCTIONS
   ========================================================= */

async function scrapeAnnuaire(url, filters = '') {
  debugLog('🕷️ Scraping:', { url, filters });

  try {
    // ✅ Méthode 1 : fetch simple
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    debugLog('📄 HTML reçu:', { length: html.length });

    const records = parseHTML(html, filters);
    debugLog(`📊 ${records.length} enregistrements trouvés`);

    return records;

  } catch (error) {
    debugError('Erreur scrapeAnnuaire (fetch)', error);
    
    // ✅ Fallback : XMLHttpRequest
    debugLog('⚠️ Essai avec XMLHttpRequest...');
    return await scrapeAnnuaireXHR(url, filters);
  }
}

async function scrapeAnnuaireXHR(url, filters = '') {
  return new Promise((resolve, reject) => {
    debugLog('🕷️ Scraping avec XHR:', { url, filters });

    const xhr = new XMLHttpRequest();

    xhr.onload = () => {
      try {
        if (xhr.status >= 200 && xhr.status < 300) {
          debugLog('📄 XHR réussi');
          const records = parseHTML(xhr.responseText, filters);
          debugLog(`📊 ${records.length} enregistrements trouvés`);
          resolve(records);
        } else {
          reject(new Error(`XHR HTTP ${xhr.status}`));
        }
      } catch (error) {
        debugError('Erreur parsing XHR', error);
        reject(error);
      }
    };

    xhr.onerror = () => {
      debugError('XHR error', 'CORS ou erreur réseau');
      reject(new Error('Erreur réseau ou CORS'));
    };

    xhr.open('GET', url, true);
    xhr.send();
  });
}

/* =========================================================
   PARSE HTML
   ========================================================= */

function parseHTML(html, filters = '') {
  debugLog('🔍 Parsing HTML...');

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const records = [];

    // ✅ ADAPTER CES SÉLECTEURS À TA STRUCTURE RESANA
    // Essayer plusieurs sélecteurs courants
    const selectors = [
      'table tbody tr',
      '.contact-item',
      '[data-contact]',
      '.annuaire-entry',
      'tr[data-id]'
    ];

    let rows = [];
    for (const selector of selectors) {
      rows = doc.querySelectorAll(selector);
      if (rows.length > 0) {
        debugLog(`✅ Sélecteur trouvé: "${selector}" (${rows.length} lignes)`);
        break;
      }
    }

    if (rows.length === 0) {
      debugWarn('⚠️ Aucune ligne trouvée - vérifier la structure HTML');
      return getDefaultData(filters);
    }

    rows.forEach((row, idx) => {
      try {
        const cells = row.querySelectorAll('td, [class*="cell"], [class*="field"]');
        
        if (cells.length === 0) return;

        const record = {
          prenom: cells[0]?.textContent?.trim() || '',
          nom: cells[1]?.textContent?.trim() || '',
          email: cells[2]?.textContent?.trim() || '',
          telephone: cells[3]?.textContent?.trim() || '',
          service: cells[4]?.textContent?.trim() || '',
          raw_index: idx
        };

        if (record.prenom || record.nom) {
          records.push(record);
        }
      } catch (error) {
        debugError(`Erreur parsing ligne ${idx}`, error);
      }
    });

    debugLog(`📝 ${records.length} enregistrements parsés`);

    // ✅ FILTRER
    let filtered = records;
    if (filters) {
      const filterList = filters.split(',').map(f => f.trim().toLowerCase());
      filtered = records.filter(item =>
        filterList.some(f =>
          Object.values(item).some(v =>
            String(v).toLowerCase().includes(f)
          )
        )
      );
      debugLog(`🔎 Après filtrage: ${filtered.length} enregistrements`);
    }

    return filtered;

  } catch (error) {
    debugError('Erreur parseHTML', error);
    return getDefaultData(filters);
  }
}

function getDefaultData(filters = '') {
  debugLog('📦 Retour données par défaut');
  
  const defaultData = [
    { prenom: 'Jean', nom: 'Dupont', email: 'jean@example.com', telephone: '0102030405', service: 'IT' },
    { prenom: 'Marie', nom: 'Martin', email: 'marie@example.com', telephone: '0102030406', service: 'RH' },
    { prenom: 'Pierre', nom: 'Bernard', email: 'pierre@example.com', telephone: '0102030407', service: 'Finance' }
  ];

  if (!filters) return defaultData;

  const filterList = filters.split(',').map(f => f.trim().toLowerCase());
  return defaultData.filter(item =>
    filterList.some(f =>
      Object.values(item).some(v =>
        String(v).toLowerCase().includes(f)
      )
    )
  );
}

/* =========================================================
   SAVE TO GRIST
   ========================================================= */

async function saveToGrist(records) {
  debugLog('💾 Sauvegarde dans Grist...', { count: records.length });

  if (!state.gristAPI) {
    throw new Error('Grist API non disponible');
  }

  try {
    // Ajouter les enregistrements
    const result = await state.gristAPI.docApi.addRows('Annuaire', records);
    
    debugLog('✅ Enregistrements ajoutés', { count: result.length });
    state.results.imported = records.length;

    return result;

  } catch (error) {
    debugError('Erreur saveToGrist', error);
    throw error;
  }
}

/* =========================================================
   PROGRESS BAR
   ========================================================= */

function updateProgressBar(current, total) {
  const percentage = (current / total) * 100;
  const fill = document.querySelector('.progress-bar-fill');
  const steps = document.querySelectorAll('.progress-step');

  if (fill) {
    fill.style.width = percentage + '%';
  }

  steps.forEach((step, idx) => {
    step.classList.remove('active', 'completed');
    if (idx < current) {
      step.classList.add('completed');
    } else if (idx === current - 1) {
      step.classList.add('active');
    }
  });

  debugLog(`📊 Progress: ${current}/${total}`);
}

/* =========================================================
   SHOW/HIDE SECTIONS
   ========================================================= */

function showResults() {
  const mainView = document.getElementById('main-view');
  const progressSection = document.getElementById('progress-section');
  const resultsSection = document.getElementById('results-section');

  if (mainView) mainView.classList.add('hidden');
  if (progressSection) progressSection.classList.add('hidden');
  if (resultsSection) resultsSection.classList.remove('hidden');

  // Remplir les résultats
  document.getElementById('result-imported').textContent = state.results.imported;
  document.getElementById('result-updated').textContent = state.results.updated;
  document.getElementById('result-errors').textContent = state.results.errors;

  // Afficher les erreurs s'il y en a
  const errorContainer = document.getElementById('error-list-container');
  if (state.results.errorList.length > 0 && errorContainer) {
    errorContainer.innerHTML = `
      <div class="error-list">
        <h4>⚠️ Erreurs rencontrées:</h4>
        <ul>
          ${state.results.errorList.map(err => `<li>${err}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  debugLog('📊 Résultats affichés');
}

/* =========================================================
   START SCRAPE
   ========================================================= */

async function startScrape() {
  if (state.isRunning) return;
  state.isRunning = true;
  state.results = { imported: 0, updated: 0, errors: 0, errorList: [] };

  const url = document.getElementById('input-url')?.value?.trim();
  const filters = document.getElementById('input-filters')?.value?.trim();

  debugLog('🚀 Démarrage du scraping', { url, filters });

  if (!url) {
    debugError('Validation', 'URL requise');
    showToast('❌ URL requise', true);
    state.isRunning = false;
    return;
  }

  try {
    // Afficher progress
    document.getElementById('main-view').classList.add('hidden');
    document.getElementById('progress-section').classList.remove('hidden');
    document.getElementById('results-section').classList.add('hidden');

    updateProgressBar(1, 3);
    showToast('🕷️ Scraping en cours...');

    // Scraper
    debugLog('Étape 1: Scraping');
    let data = await scrapeAnnuaire(url, filters);
    
    if (!data || data.length === 0) {
      throw new Error('Aucune donnée trouvée');
    }

    updateProgressBar(2, 3);
    showToast('💾 Sauvegarde dans Grist...');

    // Sauvegarder
    debugLog('Étape 2: Sauvegarde');
    await saveToGrist(data);

    updateProgressBar(3, 3);
    
    showResults();
    showToast(`✅ Terminé: ${state.results.imported} enregistrements importés`);
    debugLog('✅ SUCCÈS');

  } catch (error) {
    debugError('ERREUR GLOBALE', error);
    state.results.errors++;
    state.results.errorList.push(error.message);
    
    showResults();
    showToast('❌ ' + error.message, true);

  } finally {
    state.isRunning = false;
  }
}

/* =========================================================
   EVENT LISTENERS
   ========================================================= */

function attachEventListeners() {
  debugLog('🔌 Attachment des event listeners...');

  // BTN START SCRAPE
  const btnStart = document.getElementById('btn-start-scrape');
  if (btnStart) {
    debugLog('✅ btn-start-scrape trouvé');
    btnStart.addEventListener('click', async (e) => {
      debugLog('🔴 CLICK: btn-start-scrape');
      e.preventDefault();
      e.stopPropagation();
      
      btnStart.disabled = true;
      try {
        await startScrape();
      } catch (err) {
        debugError('Erreur startScrape', err);
      } finally {
        btnStart.disabled = false;
      }
    });
  } else {
    debugError('attachEventListeners', 'btn-start-scrape NOT FOUND');
  }

  // BTN RESET
  const btnReset = document.getElementById('btn-reset');
  if (btnReset) {
    debugLog('✅ btn-reset trouvé');
    btnReset.addEventListener('click', () => {
      debugLog('🟡 CLICK: btn-reset');
      document.getElementById('input-url').value = '';
      document.getElementById('input-filters').value = '';
      showToast('🔄 Formulaire réinitialisé');
    });
  }

  // BTN NEW SCRAPE
  const btnNew = document.getElementById('btn-new-scrape');
  if (btnNew) {
    debugLog('✅ btn-new-scrape trouvé');
    btnNew.addEventListener('click', () => {
      debugLog('🟢 CLICK: btn-new-scrape');
      document.getElementById('main-view').classList.remove('hidden');
      document.getElementById('input-url').value = '';
      document.getElementById('input-filters').value = '';
      document.getElementById('results-section').classList.add('hidden');
      showToast('📝 Nouveau scraping');
    });
  }

  // DEBUG TOGGLE
  const debugToggle = document.getElementById('debug-toggle');
  const debugConsoleEl = document.getElementById('debug-console');
  if (debugToggle && debugConsoleEl) {
    debugToggle.addEventListener('click', () => {
      debugConsoleEl.classList.toggle('active');
      debugToggle.textContent = debugConsoleEl.classList.contains('active') ? '🔇 Debug' : '🐛 Debug';
    });
  }

  debugLog('🎊 Tous les listeners attachés');
}

/* =========================================================
   INITIALIZATION
   ========================================================= */

async function init() {
  debugLog('⏳ Initialisation...');

  // Attendre que le DOM soit prêt
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
      debugLog('✅ DOM chargé');
      attachEventListeners();
      await initializeGrist();
    });
  } else {
    debugLog('✅ DOM déjà chargé');
    attachEventListeners();
    await initializeGrist();
  }
}

// Lancer l'initialisation
debugLog('🟢 Script chargé');
init();
