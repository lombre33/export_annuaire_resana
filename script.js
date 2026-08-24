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
  try {
    console.log("🔄 Initialisation Grist...");
    
    grist.ready({
      requiredAccess: 'full',
    });

    console.log("✅ Grist initialized");
    return true;

  } catch (error) {
    console.error("❌ Erreur initialisation Grist:", error);
    showToast("Erreur: Grist non disponible", true);
    return false;
  }
}

/* =========================================================
   RÉCUPÉRATION DES CREDENTIALS
   ========================================================= */

async function getCredentialsFromGrist() {
  try {
    console.log("🔐 Récupération des credentials...");
    
    // ✅ Utiliser grist.docApi directement (pas this.gristAPI)
    const credentialsTable = await grist.docApi.fetchTable('Credentials');
    
    if (!credentialsTable || !credentialsTable.id || credentialsTable.id.length === 0) {
      throw new Error("Table Credentials vide ou inexistante");
    }

    // Convertir format columnar en record
    const records = toRecords(credentialsTable);
    const credentials = records[0];

    if (!credentials) {
      throw new Error("Aucun record trouvé dans Credentials");
    }

    const cookiesPhp = credentials.Cookies_PHP || credentials.Cookie_PHP || credentials.cookies_php;
    const cookieInterstiAccess = credentials.Cookie_Interstis_Access || credentials.Interstis_Access;

    if (!cookiesPhp) {
      throw new Error(`Cookie PHP non trouvé. Colonnes disponibles: ${Object.keys(credentials).join(', ')}`);
    }

    console.log("✅ Credentials récupérés avec succès");
    return {
      php: String(cookiesPhp).trim(),
      interstiAccess: String(cookieInterstiAccess || '').trim()
    };

  } catch (error) {
    console.error("❌ Erreur récupération credentials:", error);
    throw new Error(`Impossible de récupérer les credentials: ${error.message}`);
  }
}

/* =========================================================
   CONVERSION FORMAT COLUMNAR → RECORDS
   ========================================================= */

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
   SCRAPING DE L'ANNUAIRE
   ========================================================= */

async function scrapeAnnuaire(url, filters, credentials) {
  try {
    console.log("🕷️ Lancement du scraping...", { url, filters });

    // Exemple basique - à adapter selon votre structure Resana
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Cookie': `PHP_SESSION=${credentials.php}`
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const scrapedData = parseAnnuaire(html, filters);

    console.log(`✅ ${scrapedData.length} enregistrements scrapés`);
    return scrapedData;

  } catch (error) {
    console.error("❌ Erreur scraping:", error);
    throw new Error(`Erreur lors du scraping: ${error.message}`);
  }
}

/* =========================================================
   PARSING DU HTML
   ========================================================= */

function parseAnnuaire(html, filters) {
  // À adapter selon la structure HTML de Resana
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  const records = [];
  const rows = doc.querySelectorAll('tr[data-person]'); // exemple

  rows.forEach((row) => {
    const prenom = row.querySelector('[data-prenom]')?.textContent.trim() || '';
    const nom = row.querySelector('[data-nom]')?.textContent.trim() || '';
    const email = row.querySelector('[data-email]')?.textContent.trim() || '';
    const telephone = row.querySelector('[data-tel]')?.textContent.trim() || '';

    if (!prenom || !nom) return; // sauter si données incomplètes

    // Appliquer les filtres si fournis
    if (filters) {
      const filterList = filters.split(',').map(f => f.trim().toLowerCase());
      const haystack = `${prenom} ${nom} ${email}`.toLowerCase();
      if (!filterList.some(f => haystack.includes(f))) return;
    }

    records.push({ prenom, nom, email, telephone });
    updateProgressUI(records.length);
  });

  return records;
}

/* =========================================================
   SAUVEGARDE DANS GRIST
   ========================================================= */

async function saveScrapedData(scrapedData) {
  try {
    console.log(`💾 Sauvegarde de ${scrapedData.length} enregistrements...`);

    // Récupérer les enregistrements existants pour vérifier les doublons
    const existingTable = await grist.docApi.fetchTable('Annuaire');
    const existing = toRecords(existingTable);
    const shouldUpdate = document.getElementById('checkbox-update').checked;

    // Construire les actions
    const actions = [];

    for (const record of scrapedData) {
      // Chercher si la personne existe déjà (par email ou nom+prénom)
      const existing_record = existing.find(ex =>
        (ex.Email === record.email && record.email) ||
        (ex.Prenom === record.prenom && ex.NOM === record.nom)
      );

      if (existing_record && shouldUpdate) {
        // Mise à jour
        actions.push([
          'UpdateRecord',
          'Annuaire',
          existing_record.id,
          {
            Prenom: record.prenom,
            NOM: record.nom,
            Email: record.email,
            Telephone: record.telephone
          }
        ]);
        state.results.updated++;
      } else if (!existing_record) {
        // Ajout
        actions.push([
          'AddRecord',
          'Annuaire',
          null,
          {
            Prenom: record.prenom,
            NOM: record.nom,
            Email: record.email,
            Telephone: record.telephone
          }
        ]);
        state.results.imported++;
      }
    }

    // Envoyer toutes les actions en une seule requête
    if (actions.length > 0) {
      await grist.docApi.applyUserActions(actions);
      console.log(`✅ ${actions.length} actions appliquées`);
    }

  } catch (error) {
    console.error("❌ Erreur sauvegarde:", error);
    state.results.errors++;
    state.results.errorList.push(error.message);
    throw new Error(`Erreur lors de la sauvegarde: ${error.message}`);
  }
}

/* =========================================================
   INTERFACE UTILISATEUR
   ========================================================= */

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toast.classList.toggle('error', isError);
  
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 4000);
}

function updateProgressUI(current, total = 100) {
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  
  const percentage = Math.round((current / total) * 100);
  progressFill.style.width = percentage + '%';
  progressText.textContent = `${current} / ${total} enregistrements`;
}

function showProgress() {
  document.getElementById('progress-section').classList.remove('hidden');
}

function hideProgress() {
  document.getElementById('progress-section').classList.add('hidden');
}

function showResults() {
  document.getElementById('result-imported').textContent = state.results.imported;
  document.getElementById('result-updated').textContent = state.results.updated;
  document.getElementById('result-errors').textContent = state.results.errors;
  document.getElementById('results-section').classList.remove('hidden');
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
   ÉVÉNEMENTS PRINCIPAUX
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
  resetForm();
  showProgress();

  try {
    // 1️⃣ Récupérer les credentials
    console.log("📍 Étape 1: Récupération credentials");
    const creds = await getCredentialsFromGrist();

    // 2️⃣ Lancer le scraping
    console.log("📍 Étape 2: Scraping en cours");
    const scrapedData = await scrapeAnnuaire(url, filters, creds);

    // 3️⃣ Sauvegarder dans Grist
    console.log("📍 Étape 3: Sauvegarde dans Grist");
    await saveScrapedData(scrapedData);

    showResults();
    showToast(`✅ Scraping terminé : ${state.results.imported} importés, ${state.results.updated} mis à jour`);

  } catch (error) {
    console.error("❌ Erreur processus:", error);
    showToast(error.message, true);
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

document.addEventListener('DOMContentLoaded', async () => {
  console.log("🚀 Démarrage du widget...");
  await initializeGrist();
});
