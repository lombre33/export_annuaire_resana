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

        console.log("✅ Grist API initialisée");
    }

    /**
     * Attache les événements aux boutons
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

            // Récupérer les enregistrements de la table Credentials
            const records = await grist.api.getRecords('Credentials');
            
            if (!records || records.length === 0) {
                throw new Error("Aucun credential trouvé dans la table 'Credentials'");
            }

            // Supposer que le premier enregistrement contient les credentials
            const credentialRecord = records[0];
            
            // Extraire les cookies selon la structure de la table
            const phpSessionId = credentialRecord.Cookies_php;
            const interstisToken = credentialRecord.cookie_interstis_access;

            if (!phpSessionId || !interstisToken) {
                throw new Error("Cookies incomplets dans la table Credentials");
            }

            // Stocker les cookies
            this.cookies = {
                PHPSESSID: phpSessionId,
                interstis_access: interstisToken
            };

            // Initialiser les headers avec les cookies
            this.headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "X-Requested-With": "XMLHttpRequest",
                "X-CSRF-TOKEN": "de6188ba05f50df420621ced195b247168f66008b1e0780dd643229ce9b476c4",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Referer": "https://resana.numerique.gouv.fr/public/perimetre?page=contacts",
            };

            console.log("✅ Credentials récupérés avec succès");
            return true;

        } catch (error) {
            this.showError(`Erreur récupération credentials: ${error.message}`);
            console.error("❌", error);
            return false;
        }
    }

    /**
     * Démarre l'extraction
     */
    async startScrape() {
        if (this.isRunning) return;

        // Récupérer les credentials depuis la table Credentials
        if (!(await this.getCredentialsFromGrist())) {
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
        
        try {
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
                            headers: {
                                ...this.headers,
                                'Cookie': this.buildCookieString()
                            },
                            body: formData,
                            credentials: 'include'
                        }
                    );

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

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
                    console.error("❌ Erreur page:", error);
                }
            }

            this.elements.statContacts.textContent = this.data.length;

        } catch (error) {
            throw new Error(`Erreur récupération contacts: ${error.message}`);
        }
    }

    /**
     * Récupère les détails de chaque contact
     */
    async fetchContactDetails() {
        this.updateStatus("📋 Récupération des détails des profils...");

        try {
            const socket = await this.getSocket();

            for (let idx = 0; idx < this.data.length; idx++) {
                try {
                    const contact = this.data[idx];

                    const response = await fetch(
                        `https://resana.numerique.gouv.fr/public/utilisateur/consulter/${contact.id}?socket=${socket}&peri=out`,
                        {
                            headers: {
                                ...this.headers,
                                'Cookie': this.buildCookieString()
                            },
                            credentials: 'include'
                        }
                    );

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }

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
                        this.elements.statPerimetres.textContent = Math.max(
                            parseInt(this.elements.statPerimetres.textContent || 0),
                            contact.perimetres_list.length
                        );
                    }

                    if (this.elements.extractCompetences.checked) {
                        contact.competences_list = this.extractCompetences(html);
                    }

                    this.updateProgress(idx + 1, this.data.length);
                    this.updateStatus(`📋 [${idx + 1}/${this.data.length}] ${contact.prenom} ${contact.nom}`);

                    await this.sleep(150);

                } catch (error) {
                    this.errors.push(`Contact ${idx} (${this.data[idx].prenom} ${this.data[idx].nom}): ${error.message}`);
                    console.error("❌ Erreur contact:", error);
                }
            }

        } catch (error) {
            throw new Error(`Erreur récupération détails: ${error.message}`);
        }
    }

    /**
     * Écrit les données dans Grist
     */
    async writeToGrist() {
        this.updateStatus("📤 Écriture des données dans Grist...");

        try {
            const tableName = 'Annuaire';
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
                        Lien_avatar: contact.avatar || '',
                    };

                    // Ajouter les périmètres (références) - jusqu'à 15
                    const perimetres = contact.perimetres_list || [];
                    for (let i = 0; i < 15; i++) {
                        const fieldName = `perimetre_${i + 1}`;
                        fields[fieldName] = perimetres[i] || '';
                    }

                    // Ajouter les compétences (texte) - jusqu'à 15
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
                    this.updateStatus(`📤 [${idx + 1}/${this.data.length}] ${contact.prenom} ${contact.nom}`);

                } catch (error) {
                    this.errors.push(`Préparation contact ${idx}: ${error.message}`);
                }
            }

            // Envoyer les enregistrements à Grist par batch
            if (records.length > 0) {
                try {
                    await grist.api.bulkUploadRecords(tableName, records);
                    console.log(`✅ ${records.length} enregistrements écrits dans Grist`);
                    this.writtenCount = records.length;
                    this.elements.statWritten.textContent = this.writtenCount;
                } catch (error) {
                    this.errors.push(`Erreur écriture Grist: ${error.message}`);
                    console.error("❌ Erreur lors de l'écriture:", error);
                }
            }

        } catch (error) {
            throw new Error(`Erreur lors de l'écriture: ${error.message}`);
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

        // Debug : afficher la valeur brute avant parsing
        const debugMatches = html.match(/var competence = JSON\.parse\('[^']*'\)/g) || [];
        if (debugMatches.length > 0) {
            console.log("🔍 DEBUG - Compétences trouvées (valeur brute):", debugMatches);
        }

        while ((match = pattern.exec(html)) !== null) {
            try {
                const jsonStr = match[1].replace(/\\"/g, '"');
                console.log("🔍 DEBUG - Parsing compétence:", jsonStr);
                const data = JSON.parse(jsonStr);
                if (data.libelle) {
                    competences.push(data.libelle.trim());
                }
            } catch (e) {
                console.error("❌ Erreur parsing compétence:", e);
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
                headers: {
                    ...this.headers,
                    'Cookie': this.buildCookieString()
                },
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
     * Construit la chaîne de cookies
     */
    buildCookieString() {
        if (!this.cookies) return '';
        return `PHPSESSID=${this.cookies.PHPSESSID}; interstis_access=${this.cookies.interstis_access}`;
    }

    /**
     * Génère le résumé des résultats
     */
    generateResults() {
        const summary = `
            ✅ <strong>${this.data.length}</strong> contacts extraits<br>
            📝 <strong>${this.writtenCount}</strong> contacts écrits dans Grist<br>
            ${this.elements.extractPerimetres.checked ? `📍 Périmètres: jusqu'à 15 colonnes<br>` : ''}
            ${this.elements.extractCompetences.checked ? `🎓 Compétences: jusqu'à 15 colonnes<br>` : ''}
            ${this.errors.length > 0 ? `⚠️ ${this.errors.length} erreur(s)` : '✅ Aucune erreur'}
        `;

        this.elements.resultsSummary.innerHTML = summary;
        this.elements.statErrors.textContent = this.errors.length;

        // Afficher les alertes
        if (this.oversizedProfiles.length > 0) {
            this.elements.alertsSection.style.display = 'block';
            this.elements.alertsList.innerHTML = this.oversizedProfiles
                .map(p => `<div class="alert-item">⚠️ <strong>${p.name}</strong>: ${p.count} périmètres (max 10 supportés)</div>`)
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
