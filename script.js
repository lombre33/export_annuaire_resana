/* =========================================================
   ATTENDRE QUE GRIST SOIT CHARGÉ
   ========================================================= */

function waitForGrist() {
  return new Promise((resolve) => {
    if (typeof grist !== 'undefined') {
      console.log("✅ Grist déjà chargé");
      resolve();
      return;
    }

    const maxAttempts = 50;
    let attempts = 0;

    const interval = setInterval(() => {
      attempts++;
      if (typeof grist !== 'undefined') {
        console.log("✅ Grist détecté");
        clearInterval(interval);
        resolve();
      } else if (attempts >= maxAttempts) {
        console.error("❌ Grist non trouvé après 5s");
        clearInterval(interval);
        resolve(); // Continue quand même
      }
    }, 100);
  });
}

/* =========================================================
   ÉTAT GLOBAL
   ========================================================= */

const state = {
  isRunning: false,
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
    console.log("🔄 Initialisation Grist...");
    
    if (typeof grist === 'undefined') {
      console.error("❌ Grist non disponible");
      resolve(false);
      return;
    }

    grist.ready({
      requiredAccess: 'full',
      onError: (err) => {
        console.error("❌ Erreur Grist:", err);
        resolve(false);
      }
    });

    console.log("✅ Grist ready");
    resolve(true);
  });
}

/* =========================================================
   RÉCUPÉRATION DES CREDENTIALS
   ========================================================= */

async function getCredentialsFromGrist() {
  try {
    console.log("🔐 Récupération des credentials depuis Grist...");
    
    if (typeof grist === 'undefined') {
      throw new Error("Grist n'est pas disponible");
    }

    // Récupérer la table Credentials
    const table = await grist.docApi.fetchTable('Credentials');
    
    console.log("📊 Table Credentials reçue:", table);

    if (!table.id || table.id.length === 0) {
      throw new Error("Table Credentials vide");
    }

    // Premier record
    const idx = 0;
    const credentials = {
      php: table.Cookies_php?.[idx] || '',
      access: table.cookie_interstis_access?.[idx] || ''
    };

    if (!credentials.php || !credentials.access) {
      throw new Error("Credentials manquantes dans Grist");
    }

    console.log("✅ Credentials récupérées");
    return credentials;

  } catch (error) {
    console.error("❌ Erreur récupération credentials:", error);
    throw new Error("Impossible de récupérer les credentials: " + error.message);
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
    
    // Auto-hide après 3 secondes
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }
}

/* =========================================================
   SCRAPING FICTIF (À REMPLACER PAR TA VRAIE LOGIQUE)
   ========================================================= */

async function scrapeAnnuaire(url, filters, credentials) {
  console.log("🕷️ Scraping:", url, filters);
  
  // Pour le test, retourner des données fictives
  return [
    { id: 1, name: "Alice Dupont", email: "alice@resana.fr" },
    { id: 2, name: "Bob Martin", email: "bob@resana.fr" },
    { id: 3, name: "Charlie Durand", email: "charlie@resana.fr" }
  ];
}

/* =========================================================
   SAUVEGARDE DANS GRIST
   ========================================================= */

async function saveScrapedData(data) {
  try {
    console.log("💾 Sauvegarde dans Grist...", data.length, "enregistrements");
    
    if (typeof grist === 'undefined') {
      throw new Error("Grist n'est pas disponible");
    }

    // Préparer les données pour Grist
    const records = data.map(item => ({
      fields: {
        Name: item.name,
        Email: item.email,
        // Ajoute d'autres champs selon ta table
      }
    }));

    // Ajouter les enregistrements
    const result = await grist.docApi.addRecords('Annuaire', records);
    
    console.log("✅ Données sauvegardées:", result);
    state.results.imported = data.length;

  } catch (error) {
    console.error("❌ Erreur sauvegarde:", error);
    throw new Error("Erreur lors de la sauvegarde: " + error.message);
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
    
    // Réinitialiser les résultats
    state.results = { imported: 0, updated: 0, errors: 0, errorList: [] };
    
    // Récupérer les paramètres du formulaire
    const url = document.getElementById('input-url').value;
    const filters = document.getElementById('input-filters').value;
    const shouldUpdate = document.getElementById('checkbox-update').checked;
    
    if (!url) {
      showToast("❌ Veuillez entrer une URL", true);
      return;
    }

    // Afficher la barre de progression
    const progressSection = document.getElementById('progress-section');
    const resultsSection = document.getElementById('results-section');
    if (progressSection) progressSection.classList.remove('hidden');
    if (resultsSection) resultsSection.classList.add('hidden');
    
    updateProgressBar(0, 1);
    
    // Étape 1: Récupérer credentials
    showToast("🔐 Récupération des credentials...");
    const credentials = await getCredentialsFromGrist();
    updateProgressBar(1, 3);
    
    // Étape 2: Scraping
    showToast("🕷️ Scraping en cours...");
    const scrapedData = await scrapeAnnuaire(url, filters, credentials);
    updateProgressBar(2, 3);
    console.log("📊 Données scrapées:", scrapedData.length);
    
    // Étape 3: Sauvegarde
    showToast("💾 Sauvegarde dans Grist...");
    await saveScrapedData(scrapedData);
    updateProgressBar(3, 3);
    
    // Résultats
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
  
  // Attendre Grist
  await waitForGrist();
  
  // Initialiser Grist
  const gristReady = await initializeGrist();
  
  if (!gristReady) {
    showToast("⚠️ Grist non disponible - mode test", false);
  }

  // Attacher les event listeners
  const btnStart = document.getElementById('btn-start-scrape');
  const btnNew = document.getElementById('btn-new-scrape');
  const btnBack = document.getElementById('btn-back-errors');

  if (btnStart) {
    btnStart.addEventListener('click', async () => {
      btnStart.disabled = true;
      await startScrape();
    });
    console.log("✅ Bouton 'Démarrer' attaché");
  } else {
    console.error("❌ Bouton #btn-start-scrape non trouvé");
  }

  if (btnNew) {
    btnNew.addEventListener('click', () => {
      document.getElementById('main-view').classList.add('active');
      document.getElementById('errors-view').classList.remove('active');
    });
  }

  if (btnBack) {
    btnBack.addEventListener('click', () => {
      document.getElementById('main-view').classList.add('active');
      document.getElementById('errors-view').classList.remove('active');
    });
  }

  console.log("✅ Initialisation complète");
});
