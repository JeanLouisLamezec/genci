/* ============================================================================
 * taskflow-timesheet-backfill.js — Planificateur pur du rattachement TimeEntries → Feuilles
 * ----------------------------------------------------------------------------
 * Module pur et testable qui :
 * - Reçoit des tableaux de lignes (Team, Feuilles, TimeEntries)
 * - Produit un plan déclaratif de créations et rattachements
 * - Ne modifie jamais les données reçues
 * - Ne dépend d'aucun accès Grist / DOM / état global
 * 
 * API publique :
 * - normalizeId
 * - normalizeDateValue
 * - getWeekStart
 * - buildSheetKey
 * - inspect
 * - buildPlan
 * - verifyFinalState
 * ============================================================================ */

(function (global) {
    'use strict';

    // ========================================================================
    // HELPERS : NORMALISATION DES IDS ET DATES
    // ========================================================================

    /**
     * Normalise un ID (numérique ou référence Grist)
     * Seuls sont valides : un nombre entier strictement positif ou une chaîne contenant uniquement un entier strictement positif
     * @param {*} id - ID à normaliser
     * @returns {number|null} ID numérique ou null
     */
    function normalizeId(id) {
        if (
            id === null ||
            id === undefined ||
            id === ''
        ) {
            return null;
        }

        if (
            typeof id === 'string' &&
            !/^[1-9]\d*$/.test(id)
        ) {
            return null;
        }

        var numeric = Number(id);

        return (
            Number.isInteger(numeric) &&
            numeric > 0
        )
            ? numeric
            : null;
    }

    /**
     * Normalise une valeur de date Grist vers un objet Date
     * Grist stocke les dates en secondes Unix (pour Date) ou millisecondes
     * Utilise le fuseau Europe/Paris par défaut pour déterminer la date civile
     * @param {*} value - Valeur Grist (secondes, ms, string ISO, Date)
     * @param {Object} options - Options dont timeZone (défaut: 'Europe/Paris')
     * @returns {Date|null} Date ou null
     */
    function normalizeDateValue(value, options) {
        var opts = options || {};
        var timeZone = opts.timeZone || 'Europe/Paris';

        if (value === null || value === undefined || value === '') {
            return null;
        }

        // String ISO YYYY-MM-DD
        if (typeof value === 'string') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                // Date civile UTC
                var parts = value.split('-');
                return new Date(Date.UTC(
                    parseInt(parts[0], 10),
                    parseInt(parts[1], 10) - 1,
                    parseInt(parts[2], 10)
                ));
            }
            // String avec heure : convertir en utilisant le fuseau
            var dateFromIso = new Date(value);
            if (!isNaN(dateFromIso.getTime())) {
                return dateFromIso;
            }
        }

        // Nombre (secondes ou millisecondes)
        if (typeof value === 'number' && Number.isFinite(value)) {
            var ms;
            // Si < 10^10, c'est des secondes Unix
            if (value < 10000000000) {
                ms = value * 1000;
            } else {
                ms = value;
            }

            // Convertir vers la date civile dans le fuseau spécifié
            var date = new Date(ms);
            if (isNaN(date.getTime())) {
                return null;
            }

            // Utiliser Intl.DateTimeFormat pour obtenir la date civile dans le fuseau
            var formatter = new Intl.DateTimeFormat('fr-FR', {
                timeZone: timeZone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });

            var parts = formatter.formatToParts(date);
            var year, month, day;
            for (var i = 0; i < parts.length; i++) {
                var part = parts[i];
                if (part.type === 'year') {
                    year = parseInt(part.value, 10);
                } else if (part.type === 'month') {
                    month = parseInt(part.value, 10);
                } else if (part.type === 'day') {
                    day = parseInt(part.value, 10);
                }
            }

            // Retourner minuit UTC de cette date civile
            return new Date(Date.UTC(year, month - 1, day));
        }

        // Déjà une Date
        if (value instanceof Date) {
            return value;
        }

        return null;
    }

    /**
     * Formate une Date en clé ISO YYYY-MM-DD (UTC)
     * @param {Date} date - Date à formater
     * @returns {string|null} Clé ISO ou null
     */
    function formatDateKey(date) {
        if (!date || isNaN(date.getTime())) {
            return null;
        }
        var year = date.getUTCFullYear();
        var month = String(date.getUTCMonth() + 1).padStart(2, '0');
        var day = String(date.getUTCDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    }

    /**
     * Convertit une date en secondes Unix pour stockage Grist
     * @param {Date} date - Date à convertir
     * @returns {number|null} Secondes Unix ou null
     */
    function dateToUnixSeconds(date) {
        if (!date || isNaN(date.getTime())) {
            return null;
        }
        return Math.floor(date.getTime() / 1000);
    }

    // ========================================================================
    // CALCUL DE LA SEMAINE CIVILE (LUNDI → DIMANCHE)
    // ========================================================================

    /**
     * Calcule le lundi de la semaine civile contenant la date donnée
     * La semaine commence le lundi et se termine le dimanche
     * Utilise le calendrier UTC pour éviter les problèmes de fuseau horaire
     * @param {Date} date - Date d'entrée
     * @param {Object} options - Options dont timeZone (défaut: 'Europe/Paris')
     * @returns {Date|null} Lundi de la semaine (minuit UTC) ou null
     */
    function getWeekStart(date, options) {
        if (!date || isNaN(date.getTime())) {
            return null;
        }

        var opts = options || {};
        var timeZone = opts.timeZone || 'Europe/Paris';

        // Utiliser Intl.DateTimeFormat pour obtenir la date civile dans le fuseau
        var formatter = new Intl.DateTimeFormat('fr-FR', {
            timeZone: timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });

        var parts = formatter.formatToParts(date);
        var year, month, day;
        for (var i = 0; i < parts.length; i++) {
            var part = parts[i];
            if (part.type === 'year') {
                year = parseInt(part.value, 10);
            } else if (part.type === 'month') {
                month = parseInt(part.value, 10);
            } else if (part.type === 'day') {
                day = parseInt(part.value, 10);
            }
        }

        // Créer une date UTC pour la date civile
        var inputDate = new Date(Date.UTC(year, month - 1, day));

        // Obtenir le jour de la semaine (0 = dimanche, 1 = lundi, ..., 6 = samedi)
        var dayOfWeek = inputDate.getUTCDay();

        // Calculer le décalage vers le lundi
        // Si dimanche (0), on recule de 6 jours
        // Si lundi (1), on recule de 0 jours
        // Si mardi (2), on recule de 1 jour, etc.
        var offset = (dayOfWeek === 0) ? 6 : (dayOfWeek - 1);

        // Créer une nouvelle Date au lundi à minuit UTC
        var weekStart = new Date(Date.UTC(
            inputDate.getUTCFullYear(),
            inputDate.getUTCMonth(),
            inputDate.getUTCDate() - offset,
            0, 0, 0, 0
        ));

        return weekStart;
    }

    /**
     * Construit une clé canonique pour une feuille (membre + semaine)
     * @param {number} memberId - ID du membre
     * @param {Date} weekStart - Lundi de la semaine
     * @returns {string|null} Clé canonique ou null
     */
    function buildSheetKey(memberId, weekStart) {
        var normalizedId = normalizeId(memberId);
        var weekKey = formatDateKey(weekStart);

        if (normalizedId === null || !weekKey) {
            return null;
        }

        return normalizedId + ':' + weekKey;
    }

    // ========================================================================
    // INSPECTION
    // ========================================================================

    /**
     * Inspecte les données et produit des diagnostics
     * @param {Object} data - { team, sheets, entries }
     * @param {Object} options - Options dont timeZone
     * @returns {Object} Diagnostics structurés
     */
    function inspect(data, options) {
        var opts = options || {};
        var team = data.team || [];
        var sheets = data.sheets || [];
        var entries = data.entries || [];

        var conflicts = [];
        var warnings = [];

        // Indexer Team par ID
        var teamById = {};
        for (var i = 0; i < team.length; i++) {
            var member = team[i];
            var memberId = normalizeId(member.id);
            if (memberId !== null) {
                teamById[memberId] = member;
            }
        }

        // Indexer les Feuilles
        var sheetById = {};
        var sheetByKey = {};
        var sheetsByMemberWeek = {};

        for (var j = 0; j < sheets.length; j++) {
            var sheet = sheets[j];
            var sheetId = normalizeId(sheet.id);
            var sheetMemberId = normalizeId(sheet.membre);
            var sheetWeek = normalizeDateValue(sheet.semaine, opts);

            if (sheetId === null) {
                conflicts.push({
                    code: 'SHEET_ID_INVALID',
                    sheet: sheet,
                    message: 'Feuille sans ID valide'
                });
                continue;
            }

            if (sheetMemberId === null) {
                conflicts.push({
                    code: 'SHEET_MEMBER_INVALID',
                    sheetId: sheetId,
                    sheet: sheet,
                    message: 'Feuille sans membre valide'
                });
                continue;
            }

            if (!teamById[sheetMemberId]) {
                conflicts.push({
                    code: 'SHEET_MEMBER_INVALID',
                    sheetId: sheetId,
                    memberId: sheetMemberId,
                    message: 'Feuille référence un membre absent de Team'
                });
                continue;
            }

            if (!sheetWeek) {
                conflicts.push({
                    code: 'SHEET_WEEK_INVALID',
                    sheetId: sheetId,
                    message: 'Feuille sans semaine valide'
                });
                continue;
            }

            var weekStart = getWeekStart(sheetWeek, opts);
            var weekKey = formatDateKey(weekStart);
            var sheetWeekKey = formatDateKey(sheetWeek);

            // Vérifier que la semaine est un lundi canonique
            if (weekKey !== sheetWeekKey) {
                conflicts.push({
                    code: 'SHEET_WEEK_NOT_CANONICAL',
                    sheetId: sheetId,
                    memberId: sheetMemberId,
                    actualWeekDate: sheetWeekKey,
                    expectedWeekStart: weekKey,
                    message: 'Semaine de la feuille n\'est pas un lundi canonique'
                });
                // Ne pas indexer cette feuille comme valide
                continue;
            }

            var key = sheetMemberId + ':' + weekKey;

            // Indexer la feuille
            var normalizedSheet = {
                row: sheet,
                id: sheetId,
                memberId: sheetMemberId,
                weekStartIso: weekKey,
                key: key
            };

            sheetById[sheetId] = normalizedSheet;

            // Vérifier les doublons
            if (sheetByKey[key]) {
                var existing = sheetByKey[key];
                conflicts.push({
                    code: 'DUPLICATE_SHEETS',
                    memberId: sheetMemberId,
                    weekStart: weekKey,
                    sheetIds: [existing.id, sheetId],
                    message: 'Plusieurs feuilles pour le même membre/semaine'
                });
            } else {
                sheetByKey[key] = normalizedSheet;
            }

            // Regrouper par membre/semaine pour analyse
            if (!sheetsByMemberWeek[key]) {
                sheetsByMemberWeek[key] = [];
            }
            sheetsByMemberWeek[key].push(normalizedSheet);
        }

        // Inspecter les TimeEntries
        var entriesBySheetKey = {};

        for (var k = 0; k < entries.length; k++) {
            var entry = entries[k];
            var entryId = normalizeId(entry.id);
            var entryMemberId = normalizeId(entry.membre);
            var entryDate = normalizeDateValue(entry.date, opts);
            var entrySheetId = normalizeId(entry.feuille);

            if (entryId === null) {
                conflicts.push({
                    code: 'TIME_ENTRY_ID_INVALID',
                    entry: entry,
                    message: 'TimeEntry sans ID valide'
                });
                continue;
            }

            if (entryMemberId === null) {
                conflicts.push({
                    code: 'TIME_ENTRY_MEMBER_INVALID',
                    entryId: entryId,
                    entry: entry,
                    message: 'TimeEntry sans membre valide'
                });
                continue;
            }

            if (!teamById[entryMemberId]) {
                conflicts.push({
                    code: 'TIME_ENTRY_MEMBER_INVALID',
                    entryId: entryId,
                    memberId: entryMemberId,
                    message: 'TimeEntry référence un membre absent de Team'
                });
                continue;
            }

            if (!entryDate) {
                conflicts.push({
                    code: 'TIME_ENTRY_DATE_INVALID',
                    entryId: entryId,
                    entry: entry,
                    message: 'TimeEntry sans date valide'
                });
                continue;
            }

            var entryWeekStart = getWeekStart(entryDate, opts);
            var entryWeekKey = formatDateKey(entryWeekStart);
            var entrySheetKey = entryMemberId + ':' + entryWeekKey;

            if (!entriesBySheetKey[entrySheetKey]) {
                entriesBySheetKey[entrySheetKey] = [];
            }
            entriesBySheetKey[entrySheetKey].push(entry);

            // Si la TimeEntry a déjà un lien feuille, vérifier la cohérence
            if (entrySheetId !== null) {
                // Trouver la feuille référencée par ID normalisé
                var referencedSheet = sheetById[entrySheetId];

                if (!referencedSheet) {
                    conflicts.push({
                        code: 'TIME_ENTRY_SHEET_NOT_FOUND',
                        entryId: entryId,
                        sheetId: entrySheetId,
                        message: 'TimeEntry référence une feuille inexistante'
                    });
                } else {
                    // Vérifier la cohérence du membre
                    var refMemberId = referencedSheet.memberId;
                    if (refMemberId !== entryMemberId) {
                        conflicts.push({
                            code: 'TIME_ENTRY_SHEET_MEMBER_MISMATCH',
                            entryId: entryId,
                            entryMemberId: entryMemberId,
                            sheetMemberId: refMemberId,
                            sheetId: entrySheetId,
                            message: 'Membre de la TimeEntry différent du membre de la feuille'
                        });
                    }

                    // Vérifier la cohérence de la semaine
                    var refWeekKey = referencedSheet.weekStartIso;

                    if (refWeekKey !== entryWeekKey) {
                        conflicts.push({
                            code: 'TIME_ENTRY_SHEET_WEEK_MISMATCH',
                            entryId: entryId,
                            entryWeek: entryWeekKey,
                            sheetWeek: refWeekKey,
                            sheetId: entrySheetId,
                            message: 'Semaine de la TimeEntry différente de la semaine de la feuille'
                        });
                    }
                }
            }
        }

        return {
            conflicts: conflicts,
            warnings: warnings,
            summary: {
                teamCount: team.length,
                sheetCount: sheets.length,
                entryCount: entries.length,
                validSheets: Object.keys(sheetByKey).length,
                sheetKeysWithEntries: Object.keys(entriesBySheetKey).length,
                conflictCount: conflicts.length,
                warningCount: warnings.length
            },
            sheetById: sheetById,
            sheetByKey: sheetByKey,
            sheetsByMemberWeek: sheetsByMemberWeek,
            entriesBySheetKey: entriesBySheetKey,
            teamById: teamById
        };
    }

    // ========================================================================
    // CONSTRUCTION DU PLAN
    // ========================================================================

    /**
     * Construit un plan de backfill à partir des données inspectées
     * @param {Object} data - { team, sheets, entries }
     * @param {Object} inspection - Résultat de inspect(data)
     * @param {Object} options - Options dont timeZone
     * @returns {Object} Plan déclaratif
     */
    function buildPlan(data, inspection, options) {
        var opts = options || {};

        // Si aucune inspection fournie, la faire
        if (!inspection) {
            inspection = inspect(data, opts);
        }

        // FAIL CLOSED : si conflits, retour immédiat sans aucune action
        if (inspection.conflicts.length > 0) {
            return {
                valid: false,
                creates: [],
                links: [],
                preservedLinks: [],
                conflicts: inspection.conflicts.slice(),
                warnings: inspection.warnings.slice(),
                summary: {
                    teamCount: inspection.summary.teamCount,
                    sheetCount: inspection.summary.sheetCount,
                    entryCount: inspection.summary.entryCount,
                    sheetsToCreate: 0,
                    entriesToLink: 0,
                    preservedLinks: 0,
                    conflicts: inspection.conflicts.length,
                    warnings: inspection.warnings.length
                }
            };
        }

        var conflicts = [];
        var warnings = inspection.warnings.slice();
        var sheetById = inspection.sheetById;
        var sheetByKey = inspection.sheetByKey;
        var sheetsByMemberWeek = inspection.sheetsByMemberWeek;
        var entriesBySheetKey = inspection.entriesBySheetKey;
        var teamById = inspection.teamById;

        var creates = [];
        var linksToExistingSheets = [];
        var preservedLinks = [];

        // Pour chaque groupe d'entrées par membre/semaine
        for (var sheetKey in entriesBySheetKey) {
            if (!Object.prototype.hasOwnProperty.call(entriesBySheetKey, sheetKey)) {
                continue;
            }

            var entries = entriesBySheetKey[sheetKey];
            var existingSheet = sheetByKey[sheetKey];

            // Cas A — lien absent et Feuille unique existante
            if (existingSheet) {
                // Vérifier si des entrées ont déjà un lien correct
                for (var i = 0; i < entries.length; i++) {
                    var entry = entries[i];
                    var entrySheetId = normalizeId(entry.feuille);

                    if (entrySheetId === existingSheet.id) {
                        // Lien déjà correct
                        preservedLinks.push({
                            entryId: entry.id,
                            sheetId: existingSheet.id,
                            key: sheetKey
                        });
                    } else if (entrySheetId === null || entrySheetId === 0 || entrySheetId === undefined) {
                        // Lien absent : planifier rattachement
                        linksToExistingSheets.push({
                            entryId: entry.id,
                            sheetId: existingSheet.id,
                            key: sheetKey
                        });
                    }
                    // Si entrySheetId !== null et !== existingSheet.id, c'est un conflit déjà enregistré
                }
            } else {
                // Cas B — aucune Feuille existante : création nécessaire
                var hasConflict = conflicts.some(function(c) {
                    return c.code === 'DUPLICATE_SHEETS' &&
                           sheetsByMemberWeek[sheetKey] &&
                           sheetsByMemberWeek[sheetKey].length > 1;
                });

                if (!hasConflict) {
                    var parts = sheetKey.split(':');
                    var memberId = parseInt(parts[0], 10);
                    var weekStartStr = parts[1];

                    // Vérifier que le membre existe
                    if (teamById[memberId]) {
                        // Construire la date du lundi
                        var weekParts = weekStartStr.split('-');
                        var weekStart = new Date(Date.UTC(
                            parseInt(weekParts[0], 10),
                            parseInt(weekParts[1], 10) - 1,
                            parseInt(weekParts[2], 10)
                        ));

                        var weekStartUnixSeconds = dateToUnixSeconds(weekStart);

                        var entryIds = entries.map(function(e) { return e.id; });

                        creates.push({
                            key: sheetKey,
                            memberId: memberId,
                            weekStartIso: weekStartStr,
                            weekStartUnixSeconds: weekStartUnixSeconds,
                            values: {
                                membre: memberId,
                                semaine: weekStartUnixSeconds,
                                statut: 'brouillon',
                                revisionValidation: 0
                            },
                            entryIds: entryIds
                        });

                        // Après création, toutes les entrées seront rattachées
                        for (var j = 0; j < entries.length; j++) {
                            linksToExistingSheets.push({
                                entryId: entries[j].id,
                                sheetId: null, // Sera rempli après création
                                key: sheetKey,
                                pendingCreate: true
                            });
                        }
                    }
                }
            }
        }

        // Trier pour déterminisme
        creates.sort(function(a, b) {
            return a.key.localeCompare(b.key);
        });

        linksToExistingSheets.sort(function(a, b) {
            return a.entryId - b.entryId;
        });

        preservedLinks.sort(function(a, b) {
            return a.entryId - b.entryId;
        });

        // Construire les liens finaux
        var links = linksToExistingSheets.map(function(l) {
            return {
                key: l.key,
                entryId: l.entryId,
                sheetId: l.sheetId
            };
        });

        // Calculer le résumé
        var entriesToLink = linksToExistingSheets.filter(function(l) {
            return !l.pendingCreate;
        }).length;

        var sheetsToCreate = creates.length;

        return {
            valid: true,
            creates: creates,
            links: links,
            preservedLinks: preservedLinks,
            conflicts: conflicts,
            warnings: warnings,
            summary: {
                teamCount: inspection.summary.teamCount,
                sheetCount: inspection.summary.sheetCount,
                entryCount: inspection.summary.entryCount,
                sheetsToCreate: sheetsToCreate,
                entriesToLink: entriesToLink,
                preservedLinks: preservedLinks.length,
                conflicts: conflicts.length,
                warnings: warnings.length
            }
        };
    }

    // ========================================================================
    // VÉRIFICATION FINALE
    // ========================================================================

    /**
     * Vérifie l'état final après application du plan
     * @param {Object} data - { team, sheets, entries } (après modifications)
     * @param {Object} options - Options dont timeZone
     * @returns {Object} { valid: boolean, conflicts: [] }
     */
    function verifyFinalState(data, options) {
        var opts = options || {};
        var inspection = inspect(data, opts);
        var conflicts = [];
        var seenConflictKeys = {};

        // Helper pour ajouter un conflit sans doublon
        function addConflict(conflict) {
            var key = conflict.code + ':' +
                      (conflict.entryId || conflict.sheetId || '') + ':' +
                      (conflict.memberId || '') + ':' +
                      (conflict.weekStart || '');

            if (!seenConflictKeys[key]) {
                conflicts.push(conflict);
                seenConflictKeys[key] = true;
            }
        }

        // Inclure TOUS les conflits de l'inspection initiale
        for (var i = 0; i < inspection.conflicts.length; i++) {
            addConflict(inspection.conflicts[i]);
        }

        var teamById = inspection.teamById;
        var sheetById = inspection.sheetById;
        var sheetByKey = inspection.sheetByKey;
        var entriesBySheetKey = inspection.entriesBySheetKey;
        var sheetsByMemberWeek = inspection.sheetsByMemberWeek;

        // 1. Vérifier que chaque Team utilisée existe
        for (var key in sheetsByMemberWeek) {
            if (!Object.prototype.hasOwnProperty.call(sheetsByMemberWeek, key)) {
                continue;
            }
            var sheetsForWeek = sheetsByMemberWeek[key];
            for (var si = 0; si < sheetsForWeek.length; si++) {
                var sheet = sheetsForWeek[si];
                if (!teamById[sheet.memberId]) {
                    addConflict({
                        code: 'SHEET_MEMBER_NOT_IN_TEAM',
                        sheetId: sheet.id,
                        memberId: sheet.memberId,
                        message: 'Feuille référence un membre absent de Team'
                    });
                }
            }
        }

        // 2. Vérifier chaque TimeEntry
        for (var sheetKey in entriesBySheetKey) {
            if (!Object.prototype.hasOwnProperty.call(entriesBySheetKey, sheetKey)) {
                continue;
            }

            var entries = entriesBySheetKey[sheetKey];

            for (var i = 0; i < entries.length; i++) {
                var entry = entries[i];
                var entrySheetId = normalizeId(entry.feuille);

                // Vérifier que la TimeEntry a un lien vers une feuille
                if (entrySheetId === null || entrySheetId === 0 || entrySheetId === undefined) {
                    addConflict({
                        code: 'TIME_ENTRY_WITHOUT_SHEET',
                        entryId: entry.id,
                        sheetKey: sheetKey,
                        message: 'TimeEntry n\'a pas de lien vers une feuille'
                    });
                    continue;
                }

                // Vérifier que la feuille référencée existe
                var referencedSheet = sheetById[entrySheetId];
                if (!referencedSheet) {
                    addConflict({
                        code: 'TIME_ENTRY_SHEET_NOT_FOUND',
                        entryId: entry.id,
                        sheetId: entrySheetId,
                        message: 'TimeEntry référence une feuille inexistante'
                    });
                    continue;
                }

                // 3. Vérifier que le membre correspond
                if (referencedSheet.memberId !== normalizeId(entry.membre)) {
                    addConflict({
                        code: 'TIME_ENTRY_SHEET_MEMBER_MISMATCH',
                        entryId: entry.id,
                        entryMemberId: normalizeId(entry.membre),
                        sheetMemberId: referencedSheet.memberId,
                        sheetId: entrySheetId,
                        message: 'Membre de la TimeEntry différent du membre de la feuille'
                    });
                }

                // 4. Vérifier que la semaine correspond
                if (referencedSheet.weekStartIso !== sheetKey.split(':')[1]) {
                    var entryWeekKey = sheetKey.split(':')[1];
                    addConflict({
                        code: 'TIME_ENTRY_SHEET_WEEK_MISMATCH',
                        entryId: entry.id,
                        entryWeek: entryWeekKey,
                        sheetWeek: referencedSheet.weekStartIso,
                        sheetId: entrySheetId,
                        message: 'Semaine de la TimeEntry différente de la semaine de la feuille'
                    });
                }
            }
        }

        // 5. Vérifier qu'aucune clé membre/semaine n'a plusieurs feuilles
        for (var wk in sheetsByMemberWeek) {
            if (Object.prototype.hasOwnProperty.call(sheetsByMemberWeek, wk)) {
                var sheetsForWeek = sheetsByMemberWeek[wk];
                if (sheetsForWeek.length > 1) {
                    addConflict({
                        code: 'DUPLICATE_SHEETS',
                        key: wk,
                        sheetIds: sheetsForWeek.map(function(s) { return s.id; }),
                        message: 'Plusieurs feuilles pour le même membre/semaine'
                    });
                }
            }
        }

        return {
            valid: conflicts.length === 0,
            conflicts: conflicts,
            summary: {
                teamCount: inspection.summary.teamCount,
                sheetCount: inspection.summary.sheetCount,
                entryCount: inspection.summary.entryCount,
                conflictCount: conflicts.length
            }
        };
    }

    // ========================================================================
    // EXPORT PUBLIC
    // ========================================================================

    var TaskFlowTimesheetBackfill = {
        normalizeId: normalizeId,
        normalizeDateValue: normalizeDateValue,
        getWeekStart: getWeekStart,
        buildSheetKey: buildSheetKey,
        formatDateKey: formatDateKey,
        dateToUnixSeconds: dateToUnixSeconds,
        inspect: inspect,
        buildPlan: buildPlan,
        verifyFinalState: verifyFinalState
    };

    // Export navigateur
    if (typeof window !== 'undefined') {
        window.TaskFlowTimesheetBackfill = TaskFlowTimesheetBackfill;
    }

    // Export CommonJS
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = TaskFlowTimesheetBackfill;
    }

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
