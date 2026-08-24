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
   INITIALISATION GRIST
   ========================================================= */

async function initializeGrist() {
  return new Promise((resolve) => {
    if (typeof grist === 'undefined') {
      console.error("❌ Objet 'grist' non trouvé");
      resolve(false);
      return;
    }

    console.log("✅ Objet 'grist' trouvé");
    state.gristAPI = grist;

    // Écouter les mises à jour du document
    grist.onRecord(async (record) => {
      console.log("📨 Record reçu de Grist:", record);
    });

    // Signal de prêt
    grist.ready();
    console.log("✅ Grist initialisé et ready");
    resolve(true);
  });
}

/* =========================================================
   RÉCUPÉRER LES CREDENTIALS DEPUIS GRIST
   ========================================================= */

async function getCredentialsFromGrist() {
  console.log("🔐 Récupération des credentials depuis Grist...");
  
  try {
    if (!state.gristAPI) {
      throw new Error("Grist non initialisé");
    }

    // Récupérer les données de la table Credentials
    const docAPI = state.gristAPI.docAPI;
    const credentialsData = await docAPI.getRecords('Credentials');
    
    console.log("✅ Credentials récupérés:", credentialsData);
    return credentialsData.records[0] || {};

  } catch (error) {
    console.error("❌ Erreur récupération credentials:", error);
    throw new Error("Impossible de récupérer les credentials: " + error.message);
  }
}

/* =========================================================
   SCRAPER L'ANNUAIRE
   ========================================================= */

async function scrapeAnnuaire(url, filters = '') {
  console.log("🕷️ Scraping:", url);
  console.log("📋 Filtres:", filters);

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    
    // Appliquer les filtres si nécessaire
    let filtered = data;
    if (filters) {
      const filterList = filters.split(',').map(f => f.trim().toLowerCase());
      filtered = data.filter(item => 
        filterList.some(f => 
          JSON.stringify(item).toLowerCase().includes(f)
        )
      );
    }

    console.log("📊 Données scrapées:", filtered.length, "enregistrements");
    return filtered;

  } catch (error) {
    console.error("❌ Erreur scraping:", error);
    throw new Error("Impossible de scraper l'URL: " + error.message);
  }
}

/* =========================================================
   SAUVEGARDER DANS GRIST
   ========================================================= */

async function saveToGrist(records) {
  console.log("💾 Sauvegarde de", records.length, "enregistrements dans Grist...");

  try {
    if (!state.gristAPI) {
      throw new Error("Grist non initialisé");
    }

    const docAPI = state.gristAPI.docAPI;
    
    // Préparer les données pour Grist (adapter selon ta structure)
    const recordsToAdd = records.map(item => ({
      Prenom: item.prenom || item.firstName || '',
      Nom: item.nom || item.lastName || '',
      Email: item.email || '',
      Telephone: item.telephone || item.phone || '',
      Service: item.service || '',
      // Ajoute d'autres colonnes selon ta table Annuaire
    }));

    // Ajouter les enregistrements
    const result = await docAPI.addRecords('Annuaire', recordsToAdd);

    console.log("✅ Enregistrements ajoutés:", result);
    state.results.imported = records.length;

  } catch (error) {
    console.error("❌ Erreur sauvegarde Grist:", error);
    throw new Error("Impossible de sauvegarder dans Grist: " + error.message);
  }
}

/* =========================================================
   AFFICHAGE DES NOTIFICATIONS
   ========================================================= */

function showToast(msg, isError = false) {
  console.log(isError ? "❌" : "✅", msg);
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    toast.classList.toggle('error', isError);
    toast.classList.toggle('success', !isError);
    
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }
}

/* =========================================================
   MISE À JOUR UI
   ========================================================= */

function updateProgressBar(current, total) {
  const percent = total > 0 ? (current / total) * 100 : 0;
  const fill = document.getElementById('progress-fill');
  const text = document.getElementById('progress-text');
  
  if (fill) fill.style.width = percent + '%';
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

  try {
    console.log("\n🚀 ===== DÉMARRAGE DU SCRAPING =====\n");
    state.isRunning = true;
    state.results = { imported: 0, updated: 0, errors: 0, errorList: [] };

    const url = document.getElementById('input-url').value;
    const filters = document.getElementById('input-filters').value;

    if (!url) {
      showToast("❌ Veuillez entrer une URL", true);
      return;
    }

    const progressSection = document.getElementById('progress-section');
    const resultsSection = document.getElementById('results-section');
    if (progressSection) progressSection.classList.remove('hidden');
    if (resultsSection) resultsSection.classList.add('hidden');

    // Étape 1: Scraping
    updateProgressBar(1, 3);
    showToast("🕷️ Scraping en cours...");
    const scrapedData = await scrapeAnnuaire(url, filters);

    // Étape 2: Sauvegarder dans Grist
    updateProgressBar(2, 3);
    showToast("💾 Sauvegarde dans Grist...");
    await saveToGrist(scrapedData);

    updateProgressBar(3, 3);
    showResults();
    showToast(`✅ Terminé: ${state.results.imported} enregistrements importés`);

    console.log("\n✅ ===== SCRAPING RÉUSSI =====\n");

  } catch (error) {
    console.error("❌ ERREUR GLOBALE:", error);
    state.results.errors++;
    state.results.errorList.push(error.message);
    showToast("❌ " + error.message, true);
    showResults();
  } finally {
    state.isRunning = false;
    const btn = document.getElementById('btn-start-scrape');
    if (btn) btn.disabled = false;
  }
}

/* =========================================================
   EVENT LISTENERS
   ========================================================= */

document.addEventListener('DOMContentLoaded', async () => {
  console.log("🔌 Page chargée - Initialisation en cours...");

  // Initialiser Grist
  const gristReady = await initializeGrist();

  if (!gristReady) {
    showToast("⚠️ Grist non disponible", true);
  } else {
    showToast("✅ Connecté à Grist");
  }

  // Attacher les event listeners
  const btnStart = document.getElementById('btn-start-scrape');
  const btnNew = document.getElementById('btn-new-scrape');

  if (btnStart) {
    btnStart.addEventListener('click', async () => {
      btnStart.disabled = true;
      await startScrape();
    });
    console.log("✅ Bouton 'Démarrer' attaché");
  }

  if (btnNew) {
    btnNew.addEventListener('click', () => {
      document.getElementById('main-view').classList.add('active');
      document.getElementById('input-url').value = '';
      document.getElementById('input-filters').value = '';
    });
  }

  console.log("✅ Initialisation complète");
});
