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
   RÉCUPÉRATION DES CREDENTIALS (SIMPLE)
   ========================================================= */

async function getCredentialsFromGrist() {
  try {
    console.log("🔐 Récupération des credentials depuis Grist...");
    
    // Utiliser grist.docApi directement
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

    if (!credentials.php) {
      throw new Error("Colonne 'Cookies_php' non trouvée");
    }

    console.log("✅ Credentials trouvés");
    return credentials;

  } catch (error) {
    console.error("❌ Erreur credentials:", error);
    throw error;
  }
}

/* =========================================================
   SCRAPING SIMPLE (PLACEHOLDER)
   ========================================================= */

async function scrapeAnnuaire(url, filters, credentials) {
  try {
    console.log("🕷️ Scraping:", url);

    // Exemple de données (à adapter)
    const dummyData = [
      {
        Prenom: "Jean",
        Nom: "Dupont",
        Email: "jean.dupont@example.com",
        Lien_avatar: "/avatar1.jpg",
        fonction: "Chef",
        Etablissement2: "Hopital A",
        numero_de_telephone: 0,
        Genre: "",
        Justification: ""
      }
    ];

    console.log(`✅ ${dummyData.length} enregistrements scrapés`);
    return dummyData;

  } catch (error) {
    console.error("❌ Erreur scraping:", error);
    throw error;
  }
}

/* =========================================================
   SAUVEGARDE DANS GRIST
   ========================================================= */

async function saveScrapedData(scrapedData) {
  try {
    console.log(`💾 Sauvegarde de ${scrapedData.length} enregistrements...`);

    const actions = scrapedData.map(record => [
      'AddRecord',
      'Annuaire_brut_widget',
      null,
      {
        Prenom: record.Prenom,
        Nom: record.Nom,
        Email: record.Email,
        Lien_avatar: record.Lien_avatar,
        fonction: record.fonction,
        Etablissement2: record.Etablissement2,
        numero_de_telephone: record.numero_de_telephone
      }
    ]);

    if (actions.length > 0) {
      await grist.docApi.applyUserActions(actions);
      state.results.imported = actions.length;
      console.log(`✅ ${actions.length} actions appliquées`);
    }

  } catch (error) {
    console.error("❌ Erreur sauvegarde:", error);
    state.results.errors++;
    throw error;
  }
}

/* =========================================================
   UI SIMPLE
   ========================================================= */

function showToast(msg, isError = false) {
  console.log(isError ? "❌" : "✅", msg);
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    toast.classList.toggle('error', isError);
  }
}

/* =========================================================
   MAIN - LANCEUR
   ========================================================= */

async function startScrape() {
  try {
    console.log("\n🚀 ===== DÉMARRAGE =====");
    
    showToast("Récupération des credentials...");
    const creds = await getCredentialsFromGrist();
    
    showToast("Scraping en cours...");
    const data = await scrapeAnnuaire('http://example.com', '', creds);
    
    showToast("Sauvegarde...");
    await saveScrapedData(data);
    
    showToast(`✅ Terminé: ${state.results.imported} importés`);
    
  } catch (error) {
    console.error("❌ ERREUR GLOBALE:", error);
    showToast(error.message, true);
  }
}

/* =========================================================
   ÉVÉNEMENTS
   ========================================================= */

document.addEventListener('DOMContentLoaded', async () => {
  console.log("🔌 Page chargée");
  await initializeGrist();
  
  const btn = document.getElementById('btn-start-scrape');
  if (btn) {
    btn.addEventListener('click', startScrape);
  }
});
