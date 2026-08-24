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
        this.configData = null;
        this.writtenCount = 0;

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
            tableSelect: document.getElementById('tableSelect'),
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
        if (!window.grist) {
            console.error("❌ Grist API non disponible");
            this.showError("Widget Grist non disponible");
            return;
        }

        grist.onRecord((record) => {
            console.log("Enregistrement reçu:", record);
        });

        grist.onOptions((options) => {
            console.log("Options reçues:", options);
        });

        // Récupérer les tables disponibles
        this.loadConfigTables();
    }

    /**
     * Charge les tables de configuration disponibles
     */
    async loadConfigTables() {
        try {
            // Dans Grist, on récupère les informations via getDocInfo
            const docInfo = await grist.api.getDocInfo();
            const tables = docInfo.tables || [];

            // Chercher une table nommée "Config" ou similaire
            const configTables = tables.filter(t => 
                t.name.toLowerCase().includes('config') || 
                t.name.toLowerCase().includes('credential') ||
                t.name.toLowerCase().includes('resana')
            );

            if (configTables.length > 0) {
                this.elements.tableSelect.innerHTML = configTables.map(t => 
                    `<option value="${t.name}">${t.name}</option>`
                ).join('');
            } else {
                console.warn("⚠️ Aucune table de configuration trouvée");
                this.elements.tableSelect.innerHTML = '<option value="">⚠️ Aucune table trouvée</option>';
            }
        } catch (error) {
            console.error("Erreur lors du chargement des tables:", error);
        }
    }

    /**
     * Attache les événements aux boutons
     */
    attachEventListeners() {
        this.elements.startScrapeBtn.addEventListener('click', () => this.startScrape());
        this.elements.resetBtn.addEventListener('click', () => this.reset());
    }

    /**
     * Récupère les credentials depuis la table Grist
     */
    async getCredentialsFromGrist(tableName) {
        try {
            if (!tableName) {
                throw new Error("Veuillez sélectionner une table de configuration");
            }

            // Récupérer les données de la table
            const records = await grist.api.getRecords(tableName);
            
            if (!records || records.length === 0) {
                throw new Error("Aucune donnée dans la table de configuration");
            }

            // Supposer que la première ligne contient les credentials
            const config = records[0];
            
            this.cookies = {
                PHPSESSID: config.phpsessid || config.PHPSESSID,
                interstis_access: config.token || config.interstis_access
            };

            this.headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "X-Requested-With": "XMLHttpRequest",
                "X-CSRF-TOKEN": config.csrf || config.CSRF,
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Referer": "https://resana.numerique.gouv.fr/public/perimetre?page=contacts",
            };

            if (!this.cookies.PHPSESSID || !this.cookies.interstis_access) {
                throw new Error("Credentials incomplets dans la table");
            }

            this.configData = config;
            return true;

        } catch (error) {
            this.showError(`Erreur credentials: ${error.message}`);
            return false;
        }
    }

    /**
     * Démarre l'extraction
     */
    async startScrape() {
        if (this.isRunning) return;

        const tableName = this.elements.tableSelect.value;
        if (!tableName) {
            this.showError("Sélectionnez une table de configuration");
            return;
        }

        // Récupérer les credentials
        if (!(await this.getCredentialsFromGrist(tableName))) {
            return;
        }

        this.isRunning = true;
        this.data = [];
        this.errors = [];
        this.oversizedProfiles = [];
        this.writtenCount = 0;

        this.elements.startScrapeBtn.disabled = true;
        this.elements.configSection.style.display = 'none';
        this.elements.progressSection.style.display = 'block';
        this.elements.resultsSection.style.display = 'none';

        try {
            await this.fetchAllContacts();
            await this.fetchContactDetails();
            await this.writeToGrist();
            this.generateResults();
            this.elements.resultsSection.style.display = 'block';
        } catch (error) {
            this.showError(`Erreur: ${error.message}`);
            this.updateStatus(`❌ ${error.message}`);
        } finally {
            this.isRunning = false;
            this.elements.startScrapeBtn.disabled = false;
        }
    }

    /**
     * Récupère la liste complète des contacts
     */
    async fetchAllContacts() {
        this.updateStatus("📥 Récupération de la liste des contacts...");

        let offset = 0;
        let page = 1;
        const maxContacts = parseInt(this.elements.maxContacts.value);
        const socket = await this.getSocket();

        while (this.data.length < maxContacts) {
            try {
                const formData = new FormData();
                formData.append("recherche", "");
                formData.append("retourJSON", "true");
                formData.append("offset", offset);
                formData.append("perimetreId", "");
                formData.append("perimetreMereId", "19374");

                const response = await fetch(
                    `https://resana.numerique.gouv.fr/public/utilisateur/listerContacts?socket=${socket}&peri=out`,
                    {
                        method: 'POST',
                        headers: this.headers,
                        body: formData,
                        credentials: 'include'
                    }
                );

                const jsonData = await response.json();
                const contacts = Array.isArray(jsonData) ? jsonData : (jsonData.contacts || []);

                if (!contacts.length) break;

                this.data.push(...contacts);
                this.updateProgress(this.data.length, maxContacts);
                this.updateStatus(`📥 Page ${page}: ${contacts.length} contact(s)`);

                offset += 50;
                page++;
                await this.sleep(300);

            } catch (error) {
                this.errors.push(`Page ${page}: ${error.message}`);
            }
        }

        this.elements.statContacts.textContent = this.data.length;
    }

    /**
     * Récupère les détails de chaque contact
     */
    async fetchContactDetails() {
        this.updateStatus("📋 Récupération des détails des profils...");

        const socket = await this.getSocket();

        for (let idx = 0; idx < this.data.length; idx++) {
            try {
                const contact = this.data[idx];

                const response = await fetch(
                    `https://resana.numerique.gouv.fr/public/utilisateur/consulter/${contact.id}?socket=${socket}&peri=out`,
                    {
                        headers: this.headers,
                        credentials: 'include'
                    }
                );

                const html = await response.text();

                if (this.elements.extractOrganisation.checked) {
                    contact.organisation = this.extractOrganisation(html);
                }

                if (this.elements.extractPerimetres.checked) {
                    contact.perimetres_list = this.extractPerimetres(html);
                    if (contact.perimetres_list.length > 10) {
                        this.oversizedProfiles.push({
                            name: `${contact.prenom} ${contact.nom}`,
                            id: contact.id,
                            count: contact.perimetres_list.length
                        });
                    }
                }

                if (this.elements.extractCompetences.checked) {
                    contact.competences_list = this.extractCompetences(html);
                }

                this.updateProgress(idx + 1, this.data.length);
                this.updateStatus(`📋 [${idx + 1}/${this.data.length}] ${contact.prenom} ${contact.nom}`);

                await this.sleep(150);

            } catch (error) {
                this.errors.push(`Contact ${idx}: ${error.message}`);
            }
        }
    }

    /**
     * Écrit les données dans Grist
     */
    async writeToGrist() {
        this.updateStatus("📤 Écriture des données dans Grist...");

        const tableName = 'Annuaire'; // À ajuster selon votre schéma
        const records = [];

        for (let idx = 0; idx < this.data.length; idx++) {
            try {
                const contact = this.data[idx];

                const fields = {
                    Prenom: contact.prenom || '',
                    Nom: contact.nom || '',
                    Email: contact.email || '',
                    fonction: contact.fonction || '',
                    numero_de_telephone: contact.telephone || '',
                    Etablissement2: contact.organisation || '',
                };

                // Ajouter les périmètres (références)
                const perimetres = contact.perimetres_list || [];
                for (let i = 0; i < 15; i++) {
                    const fieldName = `perimetre_${i + 1}`;
                    fields[fieldName] = perimetres[i] || '';
                }

                // Ajouter les compétences (texte)
                const competences = contact.competences_list || [];
                for (let i = 0; i < 15; i++) {
                    const fieldName = `competences_${i + 1}`;
                    fields[fieldName] = competences[i] || '';
                }

                records.push({
                    fields: fields
                });

                this.writtenCount++;
                this.elements.statWritten.textContent = this.writtenCount;
                this.updateProgress(idx + 1, this.data.length);
                this.updateStatus(`📤 [${idx + 1}/${this.data.length}] Écriture ${contact.prenom} ${contact.nom}`);

            } catch (error) {
                this.errors.push(`Écriture contact ${idx}: ${error.message}`);
            }
        }

        // Envoyer les enregistrements à Grist par batch
        try {
            await grist.api.bulkUploadRecords(tableName, records);
            console.log("✅ Données écrites dans Grist");
        } catch (error) {
            this.errors.push(`Erreur écriture Grist: ${error.message}`);
            console.error("❌ Erreur lors de l'écriture:", error);
        }
    }

    /**
     * Extrait l'organisation du HTML
     */
    extractOrganisation(html) {
        const match = html.match(/<b>Organisation<\/b>\s*:\s*([^<]+)/);
        return match ? match[1].trim() : "";
    }

    /**
     * Extrait les périmètres du HTML
     */
    extractPerimetres(html) {
        const pattern = /<a[^>]*onclick='afficherFichePerimetre\([^)]*\)'[^>]*>([^<]+)<\/a>/g;
        const matches = [];
        let match;

        while ((match = pattern.exec(html)) !== null) {
            matches.push(match[1].trim());
        }

        return matches;
    }

    /**
     * Extrait les compétences du HTML
     */
    extractCompetences(html) {
        const pattern = /var competence = JSON\.parse\('({.*?})'\)/gs;
        const competences = [];
        let match;

        while ((match = pattern.exec(html)) !== null) {
            try {
                const jsonStr = match[1].replace(/\\"/g, '"');
                const data = JSON.parse(jsonStr);
                if (data.libelle) {
                    competences.push(data.libelle.trim());
                }
            } catch (e) {
                console.error("Erreur parsing compétence:", e);
            }
        }

        return competences;
    }

    /**
     * Récupère le socket de session
     */
    async getSocket() {
        try {
            const response = await fetch('https://resana.numerique.gouv.fr/public/perimetre?page=contacts', {
                headers: this.headers,
                credentials: 'include'
            });

            const html = await response.text();
            const match = html.match(/socket=([a-zA-Z0-9]+)/);
            if (!match) throw new Error("Socket non trouvé");
            return match[1];
        } catch (error) {
            throw new Error(`Impossible de récupérer le socket: ${error.message}`);
        }
    }

    /**
     * Génère le résumé des résultats
     */
    generateResults() {
        const summary = `
            ✅ <strong>${this.data.length}</strong> contacts extraits<br>
            📝 <strong>${this.writtenCount}</strong> contacts écrits dans Grist<br>
            ${this.elements.extractPerimetres.checked ? `📍 Périmètres: 15 colonnes<br>` : ''}
            ${this.elements.extractCompetences.checked ? `🎓 Compétences: 15 colonnes<br>` : ''}
            ${this.errors.length > 0 ? `⚠️ ${this.errors.length} erreur(s)` : ''}
        `;

        this.elements.resultsSummary.innerHTML = summary;
        this.elements.statErrors.textContent = this.errors.length;

        // Afficher les alertes
        if (this.oversizedProfiles.length > 0) {
            this.elements.alertsSection.style.display = 'block';
            this.elements.alertsList.innerHTML = this.oversizedProfiles
                .map(p => `<div class="alert-item">⚠️ ${p.name}: ${p.count} périmètres</div>`)
                .join('');
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
        this.updateStatus("Prêt");
        this.elements.statContacts.textContent = '0';
        this.elements.statWritten.textContent = '0';
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
