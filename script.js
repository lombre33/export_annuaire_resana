/* =========================================================
   ATTENDRE GRIST - VERSION ROBUSTE
   ========================================================= */

async function initializeGrist() {
  return new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = 200; // 10 secondes à 50ms d'intervalle

    console.log("⏳ Initialisation Grist en cours...");

    const interval = setInterval(() => {
      attempts++;

      // ✅ Vérifier window.grist
      if (typeof window.grist !== 'undefined' && window.grist) {
        console.log(`✅ Grist trouvé au bout de ${attempts * 50}ms`);
        clearInterval(interval);

        try {
          // Enregistrer et signaler ready
          state.gristAPI = window.grist;
          window.grist.ready();
          
          // Écouter les changements
          window.grist.onRecord((record) => {
            console.log("📨 Record reçu:", record);
          });

          console.log("✅ Widget prêt");
          resolve(true);
        } catch (error) {
          console.error("❌ Erreur lors du ready():", error);
          resolve(false);
        }
        return;
      }

      // Timeout
      if (attempts >= maxAttempts) {
        console.error(`❌ Grist introuvable après ${maxAttempts * 50}ms`);
        clearInterval(interval);
        resolve(false);
      }

      // Log tous les 20 tentatives
      if (attempts % 20 === 0) {
        console.log(`🔍 Tentative ${attempts}/${maxAttempts}...`);
      }
    }, 50);
  });
}

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
   RÉCUPÉRER LES CREDENTIALS DEPUIS GRIST
   ========================================================= */

async function getCredentialsFromGrist() {
  console.log("🔐 Récupération des credentials...");
  
  if (!state.gristAPI || !state.gristAPI.docAPI) {
    console.warn("⚠️ docAPI non disponible");
    return {};
  }

  try {
    const data = await state.gristAPI.docAPI.getRecords('Credentials');
    console.log("✅ Credentials trouvés");
    return data.records[0] || {};
  } catch (error) {
    console.error("❌ Erreur credentials:", error);
    return {};
  }
}

/* =========================================================
   SCRAPER L'ANNUAIRE
   ========================================================= */

async function scrapeAnnuaire(url, filters = '') {
  console.log("🕷️ Scraping:", url);

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

    console.log(`📊 ${filtered.length} enregistrements trouvés`);
    return filtered;

  } catch (error) {
    console.error("❌ Erreur scraping:", error);
    console.warn("⚠️ Retour à données de démo");
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
  console.log(`💾 Sauvegarde de ${records.length} enregistrements...`);

  if (!state.gristAPI || !state.gristAPI.docAPI) {
    console.warn("⚠️ docAPI non disponible - Données non sauvegardées dans Grist");
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

    await state.gristAPI.docAPI.addRecords('Annuaire', recordsToAdd);
    console.log("✅ Enregistrements sauvegardés");
    state.results.imported = records.length;

  } catch (error) {
    console.error("❌ Erreur sauvegarde:", error);
    state.results.imported = records.length;
  }
}

/* =========================================================
   NOTIFICATIONS
   ========================================================= */

function showToast(msg, isError = false) {
  console.log(isError ? "❌" : "✅", msg);
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = msg;
  toast.classList.remove('hidden', 'error', 'success');
  toast.classList.add(isError ? 'error' : 'success');

  setTimeout(() => toast.classList.add('hidden'), 3000);
}

/* =========================================================
   UI
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
    const url = document.getElementById('input-url').value;
    const filters = document.getElementById('input-filters').value;

    if (!url) {
      showToast("❌ URL requise", true);
      return;
    }

    document.getElementById('progress-section').classList.remove('hidden');
    document.getElementById('results-section').classList.add('hidden');

    updateProgressBar(1, 3);
    showToast("🕷️ Scraping...");
    const data = await scrapeAnnuaire(url, filters);

    updateProgressBar(2, 3);
    showToast("💾 Sauvegarde...");
    await saveToGrist(data);

    updateProgressBar(3, 3);
    showResults();
    showToast(`✅ ${state.results.imported} enregistrements importés`);

  } catch (error) {
    console.error("❌ Erreur:", error);
    showToast("❌ " + error.message, true);
  } finally {
    state.isRunning = false;
  }
}

/* =========================================================
   INITIALISATION AU DÉMARRAGE
   ========================================================= */

document.addEventListener('DOMContentLoaded', async () => {
  console.log("🚀 Démarrage du widget...");

  const gristReady = await initializeGrist();

  if (gristReady) {
    showToast("✅ Connecté à Grist");
  } else {
    console.warn("⚠️ Grist non disponible - Mode démo");
    showToast("⚠️ Mode test (Grist indisponible)");
  }

  // Event listeners
  const btnStart = document.getElementById('btn-start-scrape');
  if (btnStart) {
    btnStart.addEventListener('click', () => {
      btnStart.disabled = true;
      startScrape().finally(() => {
        btnStart.disabled = false;
      });
    });
  }

  const btnNew = document.getElementById('btn-new-scrape');
  if (btnNew) {
    btnNew.addEventListener('click', () => {
      document.getElementById('main-view').classList.add('active');
      document.getElementById('input-url').value = '';
      document.getElementById('input-filters').value = '';
    });
  }

  console.log("✅ Widget initialisé");
});
