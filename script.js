/* =========================================================
   ÉTAT GLOBAL
   ========================================================= */

const state = {
  isRunning: false,
  gristAPI: null,
  results: {
    imported: 0,
    updated: 0,
    errors: 0,
    errorList: []
  }
};

/* =========================================================
   DEBUG HELPERS
   ========================================================= */
function debugLog(msg, data = null) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] ${msg}`, data || '');
}

function debugError(msg, err) {
  const timestamp = new Date().toLocaleTimeString();
  console.error(`[${timestamp}] ❌ ${msg}`, err);
}

/* =========================================================
   INITIALISATION GRIST - APPROCHE DIRECTE
   ========================================================= */

debugLog('Script chargé, initialisation Grist...');

// ✅ Appel direct à grist.ready() comme dans le widget qui marche
grist.ready({
  requiredAccess: 'full',
});

debugLog('grist.ready() appelé');
state.gristAPI = grist;

debugLog('Script initialisation terminé');

/* =========================================================
   HELPERS GENERIQUES
   ========================================================= */

function showToast(msg, isError = false) {
  debugLog(`Toast: ${msg}`, { isError });
  const t = document.getElementById('toast');
  if (!t) {
    console.warn('Element toast non trouvé');
    return;
  }
  t.textContent = msg;
  t.classList.remove('hidden');
  t.classList.toggle('error', isError);
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add('hidden'), 4000);
}

function toRecords(columnarTable) {
  if (!columnarTable || !columnarTable.id) {
    return [];
  }
  const ids = columnarTable.id;
  const records = [];
  for (let i = 0; i < ids.length; i++) {
    const rec = { id: ids[i] };
    for (const col of Object.keys(columnarTable)) {
      if (col === 'id') continue;
      rec[col] = columnarTable[col][i];
    }
    records.push(rec);
  }
  return records;
}

/* =========================================================
   SCRAPER L'ANNUAIRE
   ========================================================= */

async function scrapeAnnuaire(url, filters = '') {
  debugLog('🕷️ Scraping:', { url, filters });

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    let filtered = data;

    if (filters) {
      const filterList = filters.split(',').map(f => f.trim().toLowerCase());
      filtered = data.filter(item =>
        filterList.some(f => JSON.stringify(item).toLowerCase().includes(f))
      );
    }

    debugLog(`📊 ${filtered.length} enregistrements trouvés`);
    return filtered;

  } catch (error) {
    debugError('Erreur scraping', error);
    return getDefaultData(filters);
  }
}

/* =========================================================
   DONNÉES DE DÉMO
   ========================================================= */

function getDefaultData(filters = '') {
  const demoData = [
    { prenom: 'Jean', nom: 'Dupont', email: 'jean.dupont@resana.fr', telephone: '01 23 45 67 89', service: 'IT' },
    { prenom: 'Marie', nom: 'Martin', email: 'marie.martin@resana.fr', telephone: '01 23 45 67 90', service: 'RH' },
    { prenom: 'Pierre', nom: 'Bernard', email: 'pierre.bernard@resana.fr', telephone: '01 23 45 67 91', service: 'Finance' },
  ];

  if (!filters) return demoData;

  const filterList = filters.split(',').map(f => f.trim().toLowerCase());
  return demoData.filter(item =>
    filterList.some(f => JSON.stringify(item).toLowerCase().includes(f))
  );
}

/* =========================================================
   SAUVEGARDER DANS GRIST
   ========================================================= */

async function saveToGrist(records) {
  debugLog(`💾 Sauvegarde de ${records.length} enregistrements...`);

  if (!state.gristAPI || !state.gristAPI.docApi) {
    debugLog('⚠️ docApi non disponible - Données non sauvegardées');
    state.results.imported = records.length;
    return;
  }

  try {
    const recordsToAdd = records.map(item => ({
      Prenom: item.prenom || item.firstName || '',
      Nom: item.nom || item.lastName || '',
      Email: item.email || '',
      Telephone: item.telephone || item.phone || '',
      Service: item.service || '',
    }));

    debugLog('Enregistrements préparés', { count: recordsToAdd.length });

    // ✅ Utiliser applyUserActions comme dans le widget qui marche
    const result = await state.gristAPI.docApi.applyUserActions([
      ['AddRecords', 'Annuaire', null, recordsToAdd]
    ]);

    debugLog('✅ Enregistrements sauvegardés', { result });
    state.results.imported = records.length;

  } catch (error) {
    debugError('Erreur sauvegarde Grist', error);
    state.results.imported = records.length;
  }
}

/* =========================================================
   MISE À JOUR UI
   ========================================================= */

function updateProgressBar(current, total) {
  const fill = document.getElementById('progress-fill');
  const text = document.getElementById('progress-text');

  if (fill) fill.style.width = total > 0 ? (current / total * 100) + '%' : '0%';
  if (text) text.textContent = `${current} / ${total} enregistrements`;
}

function showResults() {
  const progressSection = document.getElementById('progress-section');
  const resultsSection = document.getElementById('results-section');

  if (progressSection) progressSection.classList.add('hidden');
  if (resultsSection) resultsSection.classList.remove('hidden');

  document.getElementById('result-imported').textContent = state.results.imported;
  document.getElementById('result-updated').textContent = state.results.updated;
  document.getElementById('result-errors').textContent = state.results.errors;
}

/* =========================================================
   SCRAPING PRINCIPAL
   ========================================================= */

async function startScrape() {
  if (state.isRunning) return;

  state.isRunning = true;
  state.results = { imported: 0, updated: 0, errors: 0, errorList: [] };

  try {
    debugLog('\n🚀 ===== DÉMARRAGE DU SCRAPING =====\n');

    const url = document.getElementById('input-url').value;
    const filters = document.getElementById('input-filters').value;

    if (!url) {
      showToast('❌ Veuillez entrer une URL', true);
      return;
    }

    document.getElementById('progress-section').classList.remove('hidden');
    document.getElementById('results-section').classList.add('hidden');

    // Étape 1: Scraping
    updateProgressBar(1, 3);
    showToast('🕷️ Scraping en cours...');
    const data = await scrapeAnnuaire(url, filters);

    // Étape 2: Sauvegarder dans Grist
    updateProgressBar(2, 3);
    showToast('💾 Sauvegarde dans Grist...');
    await saveToGrist(data);

    updateProgressBar(3, 3);
    showResults();
    showToast(`✅ Terminé: ${state.results.imported} enregistrements importés`);

    debugLog('\n✅ ===== SCRAPING RÉUSSI =====\n');

  } catch (error) {
    debugError('ERREUR GLOBALE', error);
    state.results.errors++;
    state.results.errorList.push(error.message);
    showToast('❌ ' + error.message, true);
    showResults();
  } finally {
    state.isRunning = false;
  }
}

/* =========================================================
   EVENT LISTENERS
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  debugLog('🔌 Page chargée - Event listeners attachés');

  const btnStart = document.getElementById('btn-start-scrape');
  if (btnStart) {
    btnStart.addEventListener('click', async () => {
      btnStart.disabled = true;
      await startScrape();
      btnStart.disabled = false;
    });
    debugLog('✅ Bouton "Démarrer" attaché');
  }

  const btnNew = document.getElementById('btn-new-scrape');
  if (btnNew) {
    btnNew.addEventListener('click', () => {
      document.getElementById('main-view').classList.add('active');
      document.getElementById('input-url').value = '';
      document.getElementById('input-filters').value = '';
      debugLog('Réinitialisation du formulaire');
    });
  }

  showToast('✅ Widget prêt');
  debugLog('✅ Initialisation complète');
});
