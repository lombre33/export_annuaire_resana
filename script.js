/* =========================================================
   ÉTAT GLOBAL
   ========================================================= */

const state = {
  gristApi: null,
  isRunning: false,
  results: {
    imported: 0,
    updated: 0,
    errors: 0,
    errorList: []
  },
  existingRecords: {} // Cache des enregistrements existants
};

/* =========================================================
   INITIALISATION GRIST
   ========================================================= */

async function initializeGrist() {
  try {
    console.log("📡 Initialisation Grist...");

    // Signaler au système Grist qu'on est prêt
    grist.ready({
      requiredAccess: 'full',
    });

    // Charger les données existantes
    await loadExistingRecords();

    console.log("✅ Grist initialisé");

  } catch (error) {
    console.error("❌ Erreur initialisation Grist:", error);
    showToast("Erreur d'initialisation. Vérifiez la console.", true);
  }
}

async function loadExistingRecords() {
  try {
    console.log("📦 Chargement des enregistrements existants...");

    const annuaireTable = await grist.docApi.fetchTable('Annuaire');
    const records = toRecords(annuaireTable);

    // Index par email pour détecter les doublons
    state.existingRecords = {};
    records.forEach(rec => {
      if (rec.Email) {
        state.existingRecords[rec.Email.toLowerCase()] = rec;
      }
    });

    console.log(`✅ ${records.length} enregistrements existants`);

  } catch (error) {
    console.error("❌ Erreur chargement existants:", error);
    // Non bloquant
  }
}

/**
 * Convertit format columnar Grist en array d'objets
 */
function toRecords(columnarTable) {
  if (!columnarTable || !columnarTable.id) return [];

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
   RÉCUPÉRATION DES CREDENTIALS
   ========================================================= */

async function getCredentialsFromGrist() {
  try {
    console.log("🔐 Récupération des credentials...");

    const credentialsTable = await grist.docApi.fetchTable('Credentials');
    const records = toRecords(credentialsTable);

    if (records.length === 0) {
      throw new Error("Table Credentials vide. Veuillez ajouter vos credentials.");
    }

    const cred = records[0];

    // Chercher les colonnes (variantes possibles)
    const phpCookie = cred.Cookies_PHP || cred.Cookie_PHP || cred.cookies_php || '';
    const interstiCookie = cred.Cookie_Interstis_Access || cred.Interstis_Access || '';

    if (!phpCookie) {
      throw new Error(`Cookie PHP non trouvé. Colonnes disponibles: ${Object.keys(cred).join(', ')}`);
    }

    console.log("✅ Credentials récupérés");

    return {
      phpCookie: String(phpCookie),
      interstiCookie: String(interstiCookie)
    };

  } catch (error) {
    console.error("❌ Erreur récupération credentials:", error);
    throw error;
  }
}

/* =========================================================
   SCRAPING (STUB)
   ========================================================= */

async function scrapeAnnuaire(url, filters, credentials) {
  console.log(`🕷️  Scraping : ${url}`);
  console.log(`🔓 Utilisation des credentials...`);

  // STUB : simuler le scraping
  // À remplacer par ton vrai code de scraping

  const mockData = [
    {
      prenom: "Jean",
      nom: "Dupont",
      email: "jean.dupont@example.com",
      telephone: "01 23 45 67 89"
    },
    {
      prenom: "Marie",
      nom: "Martin",
      email: "marie.martin@example.com",
      telephone: "01 98 76 54 32"
    }
  ];

  // Simuler une progression
  const results = [];
  for (let i = 0; i < mockData.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 500)); // délai fictif
    results.push(mockData[i]);
    updateProgress(i + 1, mockData.length);
  }

  return results;
}

/* =========================================================
   SAUVEGARDE DANS GRIST
   ========================================================= */

async function saveScrapedData(records) {
  try {
    console.log(`💾 Sauvegarde de ${records.length} enregistrements...`);

    const shouldUpdate = document.getElementById('checkbox-update').checked;
    const actions = [];

    for (const record of records) {
      const email = (record.email || '').toLowerCase();
      const existing = state.existingRecords[email];

      const fields = {
        Prenom: record.prenom || '',
        NOM: record.nom || '',
        Email: record.email || '',
        Telephone: record.telephone || ''
      };

      if (existing && shouldUpdate) {
        // Mise à jour
        actions.push(['UpdateRecord', 'Annuaire', existing.id, fields]);
        state.results.updated++;
      } else if (!existing) {
        // Ajout
        actions.push(['AddRecord', 'Annuaire', null, fields]);
        state.results.imported++;
      }
    }

    // Appliquer toutes les actions en une seule requête
    if (actions.length > 0) {
      await grist.docApi.applyUserActions(actions);
      console.log(`✅ ${actions.length} enregistrement(s) traité(s)`);
    }

  } catch (error) {
    console.error("❌ Erreur sauvegarde:", error);
    state.results.errors++;
    state.results.errorList.push(error.message);
    throw error;
  }
}

/* =========================================================
   INTERFACE UTILISATEUR
   ========================================================= */

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden', 'error', 'success');
  toast.classList.add(isError ? 'error' : 'success');

  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 4000);
}

function updateProgress(current, total) {
  const percentage = (current / total) * 100;
  document.getElementById('progress-fill').style.width = `${percentage}%`;
  document.getElementById('progress-text').textContent = `${current} / ${total} enregistrements`;
}

function showProgress() {
  document.getElementById('progress-section').classList.remove('hidden');
}

function hideProgress() {
  document.getElementById('progress-section').classList.add('hidden');
}

function showResults() {
  document.getElementById('results-section').classList.remove('hidden');
  document.getElementById('result-imported').textContent = state.results.imported;
  document.getElementById('result-updated').textContent = state.results.updated;
  document.getElementById('result-errors').textContent = state.results.errors;
}

function hideResults() {
  document.getElementById('results-section').classList.add('hidden');
}

function resetForm() {
  document.getElementById('input-url').value = '';
  document.getElementById('input-filters').value = '';
  document.getElementById('checkbox-update').checked = true;
  state.results = { imported: 0, updated: 0, errors: 0, errorList: [] };
  hideProgress();
  hideResults();
}

/* =========================================================
   ÉVÉNEMENTS PRINCIPAL
   ========================================================= */

document.getElementById('btn-start-scrape').addEventListener('click', async () => {
  const url = document.getElementById('input-url').value.trim();
  const filters = document.getElementById('input-filters').value.trim();

  if (!url) {
    showToast('Veuillez entrer une URL.', true);
    return;
  }

  state.isRunning = true;
  document.getElementById('btn-start-scrape').disabled = true;
  showProgress();

  try {
    // 1️⃣ Récupérer les credentials
    const creds = await getCredentialsFromGrist();

    // 2️⃣ Lancer le scraping
    const scrapedData = await scrapeAnnuaire(url, filters, creds);

    // 3️⃣ Sauvegarder dans Grist
    await saveScrapedData(scrapedData);

    showResults();
    showToast(`✅ Scraping terminé : ${state.results.imported} importés, ${state.results.updated} mis à jour`);

  } catch (error) {
    console.error("❌ Erreur processus:", error);
    showToast(error.message, true);
    state.results.errors++;
  } finally {
    state.isRunning = false;
    document.getElementById('btn-start-scrape').disabled = false;
  }
});

document.getElementById('btn-new-scrape').addEventListener('click', () => {
  resetForm();
});

/* =========================================================
   DÉMARRAGE
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  initializeGrist();
});
