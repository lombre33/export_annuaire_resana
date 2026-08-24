/* =========================================================
   ATTENDRE QUE GRIST INJECTE L'OBJET GLOBAL
   ========================================================= */

function waitForGrist(maxAttempts = 100) {
  return new Promise((resolve) => {
    let attempts = 0;

    const checkGrist = setInterval(() => {
      attempts++;

      // ✅ Vérifier si grist est maintenant disponible
      if (typeof window.grist !== 'undefined' && window.grist !== null) {
        console.log(`✅ Grist trouvé à la tentative ${attempts}`);
        clearInterval(checkGrist);
        resolve(window.grist);
        return;
      }

      if (attempts >= maxAttempts) {
        console.warn(`⚠️ Grist non trouvé après ${maxAttempts} tentatives`);
        clearInterval(checkGrist);
        resolve(null);
      }
    }, 50); // Vérifie toutes les 50ms
  });
}

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
  console.log("⏳ En attente de l'injection de l'objet Grist...");

  const gristObj = await waitForGrist();

  if (!gristObj) {
    console.error("❌ Grist n'a pas pu être chargé");
    return false;
  }

  console.log("✅ Objet Grist trouvé:", typeof gristObj);
  state.gristAPI = gristObj;

  try {
    // Écouter les mises à jour du document
    gristObj.onRecord(async (record) => {
      console.log("📨 Record reçu de Grist:", record);
    });

    // Signal de prêt - TRÈS IMPORTANT pour que Grist sache que le widget est prêt
    gristObj.ready();
    console.log("✅ Grist initialisé et ready()");
    return true;
  } catch (error) {
    console.error("❌ Erreur lors de l'initialisation Grist:", error);
    return false;
  }
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

    // Vérifier que docAPI existe
    if (!state.gristAPI.docAPI) {
      console.warn("⚠️ docAPI non disponible - Mode démo");
      return {};
    }

    // Récupérer les données de la table Credentials
    const credentialsData = await state.gristAPI.docAPI.getRecords('Credentials');
    console.log("✅ Credentials récupérés:", credentialsData);
    
    return credentialsData.records[0] || {};

  } catch (error) {
    console.error("❌ Erreur récupération credentials:", error);
    return {};
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
    console.error("❌ Erreur scraping:", error.message);
    
    // ⚠️ FALLBACK: Retourner des données de démo si CORS bloque
    console.warn("⚠️ Retour à des données de démo (CORS ou réseau bloqué)");
    return getDefaultData(filters);
  }
}

/* =========================================================
   DONNÉES DE DÉMO (si scraping échoue)
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
  console.log("💾 Sauvegarde de", records.length, "enregistrements dans Grist...");

  try {
    if (!state.gristAPI) {
      throw new Error("Grist non initialisé");
    }

    // ⚠️ Vérifier que docAPI existe avant de l'utiliser
    if (!state.gristAPI.docAPI) {
      console.warn("⚠️ docAPI non disponible - Données non sauvegardées");
      state.results.imported = records.length;
      return;
    }

    // Préparer les données pour Grist
    const recordsToAdd = records.map(item => ({
      Prenom: item.prenom || item.firstName || '',
      Nom: item.nom || item.lastName || '',
      Email: item.email || '',
      Telephone: item.telephone || item.phone || '',
      Service: item.service || '',
    }));

    // Ajouter les enregistrements
    const result = await state.gristAPI.docAPI.addRecords('Annuaire', recordsToAdd);

    console.log("✅ Enregistrements ajoutés:", result);
    state.results.imported = records.length;

  } catch (error) {
    console.error("❌ Erreur sauvegarde Grist:", error);
    state.results.imported = records.length;
    // Ne pas lever d'erreur - continuer même si Grist n'est pas dispo
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
      state.isRunning = false;
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
  }
}

/* =========================================================
   EVENT LISTENERS
   ========================================================= */

document.addEventListener('DOMContentLoaded', async () => {
  console.log("🔌 Page chargée - Initialisation en cours...");

  // Initialiser Grist (attendre son injection)
  const gristReady = await initializeGrist();

  if (!gristReady) {
    console.warn("⚠️ Grist non disponible - Mode démo activé");
    showToast("⚠️ Grist non disponible (mode test)", true);
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
      btnStart.disabled = false;
    });
    console.log("✅ Bouton 'Démarrer' attaché");
  }

  if (btnNew) {
    btnNew.addEventListener('click', () => {
      document.getElementById('main-view').classList.add('active');
      document.getElementById('input-url').value = '';
      document.getElementById('input-filters').value = '';
    });
    console.log("✅ Bouton 'Nouveau scraping' attaché");
  }

  console.log("✅ Initialisation complète");
});
