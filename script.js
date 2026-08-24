async function startScrape() {
  if (state.isRunning) return;
  state.isRunning = true;
  state.results = { imported: 0, updated: 0, errors: 0, errorList: [] };

  const url = document.getElementById('input-url')?.value.trim();
  const filters = document.getElementById('input-filters')?.value.trim();

  if (!url) {
    showToast('URL requise', true);
    state.isRunning = false;
    return;
  }

  try {
    document.getElementById('main-view').classList.remove('active');
    document.getElementById('progress-section').classList.remove('hidden');
    document.getElementById('results-section').classList.add('hidden');

    updateProgressBar(1, 3);
    showToast('🕷️ Scraping en cours...');

    // ✅ Essayer fetch direct d'abord
    let data;
    try {
      data = await scrapeAnnuaire(url, filters);
    } catch (fetchError) {
      debugLog('⚠️ fetch échoué, essayer XHR...');
      data = await scrapeAnnuaireXHR(url, filters);
    }

    updateProgressBar(2, 3);
    showToast('💾 Sauvegarde dans Grist...');
    await saveToGrist(data);

    updateProgressBar(3, 3);
    showResults();
    showToast(`✅ Terminé: ${state.results.imported} enregistrements importés`);

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
