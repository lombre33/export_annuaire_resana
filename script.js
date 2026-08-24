/**
 * Resana Scraper - Custom Grist Widget v2.0
 * Extraction de l'annuaire Resana avec stockage dans Grist
 */

class ResanaScraperWidget {
    constructor() {
        this.data = [];
        this.errors = [];
        this.oversizedProfiles = [];
        this.isRunning = false;
        this.cookies = null;
        this.headers = null;
        this.writtenCount = 0;
        this.targetTable = "Annuaire_brut_widget"; // TABLE DE DESTINATION
        this.gristAPI = null;

        this.initializeUI();
        this.initializeGrist();
        this.attachEventListeners();
    }

    /**
     * Initialise les éléments UI
     */
    initializeUI() {
        this.elements = {
            // Config
            maxContacts: document.getElementById('maxContacts'),
            extractOrganisation: document.getElementById('extractOrganisation'),
            extractPerimetres: document.getElementById('extractPerimetres'),
            extractCompetences: document.getElementById('extractCompetences'),

            // Buttons
            startScrapeBtn: document.getElementById('startScrapeBtn'),
            resetBtn: document.getElementById('resetBtn'),

            // Sections
            configSection: document.getElementById('configSection'),
            progressSection: document.getElementById('progressSection'),
            resultsSection: document.getElementById('resultsSection'),

            // Progress
            progressFill: document.getElementById('progressFill'),
            progressText: document.getElementById('progressText'),
            statusMessage: document.getElementById('statusMessage'),

            // Stats
            statContacts: document.getElementById('statContacts'),
            statWritten: document.getElementById('statWritten'),
            statPerimetres: document.getElementById('statPerimetres'),
            statErrors: document.getElementById('statErrors'),

            // Results
            resultsSummary: document.getElementById('resultsSummary'),
            alertsSection: document.getElementById('alertsSection'),
            alertsList: document.getElementById('alertsList'),
        };
    }

    /**
     * Initialise Grist API
     */
    initializeGrist() {
        return new Promise((resolve) => {
            // Vérifier si Grist est disponible
            if (typeof grist !== 'undefined') {
                this.gristAPI = grist;
                console.log("✅ Grist API initialisée");
                resolve(true);
            } else {
                console.warn("⚠️ Grist API non disponible - Mode test");
                resolve(false);
            }
        });
    }

    /**
     * Attache les event listeners
     */
    attachEventListeners() {
        this.elements.startScrapeBtn.addEventListener('click', () => this.startScrape());
        this.elements.resetBtn.addEventListener('click', () => this.reset());
    }

    /**
     * Récupère les credentials depuis la table Credentials
     */
    async getCredentialsFromGrist() {
        try {
            this.updateStatus("🔐 Récupération des credentials...");

            if (!this.gristAPI) {
                throw new Error("Grist API n'est pas disponible");
            }

            // Récupérer les données de la table Credentials
            const credentialsData = await this.gristAPI.getDocAPI().getTableData('Credentials');
            
            if (!credentialsData || credentialsData.length === 0) {
                throw new Error("Aucune donnée trouvée dans la table Credentials");
            }

            // Récupérer la première ligne
            const credentials = credentialsData[0];
            
            const cookiesPhp = credentials.Cookies_php || '';
            const cookieInterstiAccess = credentials.cookie_interstis_access || '';

            if (!cookiesPhp || !cookieInterstiAccess) {
                throw new Error("Cookies manquants dans la table Credentials");
            }

            this.cookies = {
                php: cookiesPhp,
                interstiAccess: cookieInterstiAccess
            };

            console.log("✅ Credentials récupérés avec succès");
            return true;
        } catch (error) {
            console.error("❌ Erreur lors de la récupération des credentials:", error);
            this.showError(`Erreur credentials: ${error.message}`);
            return false;
        }
    }

    /**
     * Construit la chaîne de cookies
     */
    buildCookieString() {
        if (!this.cookies) return '';
        return `php=${this.cookies.php}; interstis_access=${this.cookies.interstiAccess}`;
    }

    /**
     * Démarre le scraping
     */
    async startScrape() {
        if (this.isRunning) return;

        // Vérifier que Grist est disponible
        if (!this.gristAPI) {
            this.showError("Grist API n'est pas disponible. Assurez-vous que ce widget est inséré dans un document Grist.");
            return;
        }

        this.isRunning = true;
        this.elements.startScrapeBtn.disabled = true;
        this.data = [];
        this.errors = [];
        this.oversizedProfiles = [];
        this.writtenCount = 0;

        // Afficher la section progress
        this.elements.configSection.style.display = 'none';
        this.elements.progressSection.style.display = 'block';
        this.elements.resultsSection.style.display = 'none';

        try {
            // Récupérer les credentials
            const credOk = await this.getCredentialsFromGrist();
            if (!credOk) {
                this.isRunning = false;
                this.elements.startScrapeBtn.disabled = false;
                return;
            }

            const maxContacts = parseInt(this.elements.maxContacts.value) || 500;
            const extractOrganisation = this.elements.extractOrganisation.checked;
            const extractPerimetres = this.elements.extractPerimetres.checked;
            const extractCompetences = this.elements.extractCompetences.checked;

            this.updateStatus("🔍 Connexion à Resana...");

            // Récupérer les contacts
            const socket = await this.getSocket();
            if (!socket) {
                throw new Error("Impossible de se connecter à Resana");
            }

            const contacts = await this.fetchContacts(socket, maxContacts);
            console.log(`✅ ${contacts.length} contacts récupérés`);

            this.updateStatus("📝 Extraction des détails des contacts...");
            this.data = [];

            for (let i = 0; i < contacts.length; i++) {
                const contact = contacts[i];
                const details = await this.extractContactDetails(
                    socket,
                    contact,
                    extractOrganisation,
                    extractPerimetres,
                    extractCompetences
                );

                if (details) {
                    this.data.push(details);
                }

                this.updateProgress(i + 1, contacts.length);
                await this.sleep(100); // Délai anti-rate limit
            }

            console.log(`✅ ${this.data.length} contacts extraits`);
            this.elements.statContacts.textContent = this.data.length;

            if (this.data.length === 0) {
                throw new Error("Aucun contact à écrire");
            }

            this.updateStatus("💾 Écriture dans Grist...");

            // Écrire dans la table Annuaire_brut_widget
            await this.writeToGrist(this.data);

            this.elements.resultsSection.style.display = 'block';
            this.displayResults();

        } catch (error) {
            console.error("❌ Erreur:", error);
            this.showError(error.message);
        } finally {
            this.isRunning = false;
            this.elements.startScrapeBtn.disabled = false;
        }
    }

    /**
     * Récupère le socket de connexion à Resana
     */
    async getSocket() {
        try {
            const cookies = this.buildCookieString();
            
            const response = await fetch('https://resana.net/Socket.io/', {
                method: 'GET',
                headers: {
                    'Cookie': cookies,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`Socket.io error: ${response.status}`);
            }

            const data = await response.text();
            const match = data.match(/sid["\']?\s*:\s*["\']?([^"'\s,}]+)/);
            
            if (!match || !match[1]) {
                throw new Error("Impossible d'extraire le SID");
            }

            return match[1];
        } catch (error) {
            console.error("❌ Erreur Socket.io:", error);
            return null;
        }
    }

    /**
     * Récupère la liste des contacts
     */
    async fetchContacts(socket, max) {
        try {
            const cookies = this.buildCookieString();

            const response = await fetch(
                `https://resana.net/Socket.io/?transport=polling&sid=${socket}`,
                {
                    method: 'POST',
                    headers: {
                        'Cookie': cookies,
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    body: JSON.stringify({
                        event: 'search_contacts',
                        data: { limit: max }
                    }),
                    credentials: 'include'
                }
            );

            const text = await response.text();
            const jsonMatch = text.match(/\{.*\}/);
            
            if (!jsonMatch) {
                throw new Error("Pas de données reçues");
            }

            const data = JSON.parse(jsonMatch[0]);
            return data.results || [];
        } catch (error) {
            console.error("❌ Erreur fetchContacts:", error);
            return [];
        }
    }

    /**
     * Extrait les détails d'un contact
     */
    async extractContactDetails(socket, contact, org, perim, comp) {
        try {
            const cookies = this.buildCookieString();

            const response = await fetch(
                `https://resana.net/Socket.io/?transport=polling&sid=${socket}`,
                {
                    method: 'POST',
                    headers: {
                        'Cookie': cookies,
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    body: JSON.stringify({
                        event: 'get_contact',
                        data: { id: contact.id }
                    }),
                    credentials: 'include'
                }
            );

            const text = await response.text();
            const jsonMatch = text.match(/\{.*\}/);
            
            if (!jsonMatch) return null;

            const data = JSON.parse(jsonMatch[0]);
            const fullContact = data.contact || {};

            // Préparer les données à écrire
            const recordData = {
                name: fullContact.name || '',
                email: fullContact.email || '',
                phone: fullContact.phone || '',
                position: fullContact.position || '',
            };

            if (org) {
                recordData.organisation = fullContact.organisation?.name || '';
            }

            if (perim) {
                const perimetres = (fullContact.perimetres || []).slice(0, 15);
                if (perimetres.length > 10) {
                    this.oversizedProfiles.push({
                        name: fullContact.name,
                        count: perimetres.length
                    });
                }
                recordData.perimetres = perimetres.join(', ');
            }

            if (comp) {
                const competences = (fullContact.competences || []).slice(0, 15);
                recordData.competences = competences.join(', ');
            }

            return recordData;
        } catch (error) {
            this.errors.push(`Erreur contact ${contact.id}: ${error.message}`);
            console.error("❌ Erreur extractContactDetails:", error);
            return null;
        }
    }

    /**
     * Écrit les données dans Grist (Table: Annuaire_brut_widget)
     */
    async writeToGrist(records) {
        try {
            if (!records || records.length === 0) {
                throw new Error("Aucun enregistrement à écrire");
            }

            if (!this.gristAPI) {
                throw new Error("Grist API n'est pas disponible");
            }

            const docApi = this.gristAPI.getDocAPI();

            // Ajouter les enregistrements dans la table Annuaire_brut_widget
            const addResult = await docApi.addRows(this.targetTable, records);

            this.writtenCount = addResult.rowIds ? addResult.rowIds.length : records.length;
            this.elements.statWritten.textContent = this.writtenCount;

            console.log(`✅ ${this.writtenCount} enregistrements écrits dans ${this.targetTable}`);
            this.updateStatus(`✅ ${this.writtenCount} contacts écrits dans ${this.targetTable}`);

        } catch (error) {
            console.error("❌ Erreur lors de l'écriture dans Grist:", error);
            throw new Error(`Erreur écriture Grist: ${error.message}`);
        }
    }

    /**
     * Affiche les résultats finaux
     */
    displayResults() {
        this.elements.statErrors.textContent = this.errors.length;

        let summary = `
            <strong>✅ Extraction réussie</strong><br>
            📊 Contacts extraits: ${this.data.length}<br>
            💾 Contacts écrits: ${this.writtenCount}<br>
            ❌ Erreurs: ${this.errors.length}
        `;

        if (this.errors.length > 0) {
            summary += `<br><br><strong>⚠️ Erreurs rencontrées:</strong><br>`;
            summary += this.errors.slice(0, 5).map(e => `• ${e}`).join('<br>');
            if (this.errors.length > 5) {
                summary += `<br>... et ${this.errors.length - 5} autres erreurs`;
            }
        }

        this.elements.resultsSummary.innerHTML = summary;

        if (this.oversizedProfiles.length > 0) {
            this.elements.alertsList.innerHTML = this.oversizedProfiles
                .map(p => `<div class="alert-item"><strong>${p.name}</strong>: ${p.count} périmètres (max 10 supportés)</div>`)
                .join('');
        } else if (this.elements.extractPerimetres.checked) {
            this.elements.alertsSection.style.display = 'none';
        }

        this.updateProgress(this.data.length, this.data.length);
        this.updateStatus("✅ Extraction et écriture terminées!");
    }

    /**
     * Met à jour la progression
     */
    updateProgress(current, total) {
        const percent = total > 0 ? (current / total) * 100 : 0;
        this.elements.progressFill.style.width = percent + '%';
        this.elements.progressText.textContent = `${current}/${total} contacts`;
    }

    /**
     * Met à jour le message de statut
     */
    updateStatus(message) {
        this.elements.statusMessage.textContent = message;
        console.log(message);
    }

    /**
     * Affiche une erreur
     */
    showError(message) {
        console.error("❌", message);
        alert(`❌ ${message}`);
    }

    /**
     * Réinitialise le widget
     */
    reset() {
        this.data = [];
        this.errors = [];
        this.oversizedProfiles = [];
        this.writtenCount = 0;

        this.elements.configSection.style.display = 'block';
        this.elements.progressSection.style.display = 'none';
        this.elements.resultsSection.style.display = 'none';

        this.updateProgress(0, 0);
        this.updateStatus("🔄 Widget réinitialisé - Prêt pour une nouvelle extraction");
        this.elements.statContacts.textContent = '0';
        this.elements.statWritten.textContent = '0';
        this.elements.statPerimetres.textContent = '0';
        this.elements.statErrors.textContent = '0';
    }

    /**
     * Délai asynchrone
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Initialiser au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    window.scraperWidget = new ResanaScraperWidget();
    console.log("✅ Widget Resana Scraper initialisé");
});
