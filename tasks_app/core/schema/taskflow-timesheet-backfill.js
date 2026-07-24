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
     * @param {*} id - ID à normaliser
     * @returns {number|null} ID numérique ou null
     */
    function normalizeId(id) {
        if (id === null || id === undefined || id === '') {
            return null;
        }
        if (typeof id === 'number' && Number.isFinite(id)) {
            return id;
        }
        if (typeof id === 'string') {
            var parsed = parseInt(id, 10);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
        return null;
    }

    /**
     * Normalise une valeur de date Grist vers un objet Date
     * Grist stocke les dates en secondes Unix (pour Date) ou millisecondes
     * @param {*} value - Valeur Grist (secondes, ms, string ISO, Date)
     * @returns {Date|null} Date ou null
     */
    function normalizeDateValue(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }

        // String ISO
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
            var dateFromIso = new Date(value);
            if (!isNaN(dateFromIso.getTime())) {
                return dateFromIso;
            }
        }

        // Nombre (secondes ou millisecondes)
        if (typeof value === 'number' && Number.isFinite(value)) {
            // Si < 10^10, c'est des secondes Unix
            if (value < 10000000000) {
                return new Date(value * 1000);
            }
            // Sinon millisecondes
            return new Date(value);
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

    // ========================================================================
    // CALCUL DE LA SEMAINE CIVILE (LUNDI → DIMANCHE)
    // ========================================================================

    /**
     * Calcule le lundi de la semaine civile contenant la date donnée
     * La semaine commence le lundi et se termine le dimanche
     * Utilise le calendrier UTC pour éviter les problèmes de fuseau horaire
     * @param {Date} date - Date d'entrée
     * @returns {Date|null} Lundi de la semaine (minuit UTC) ou null
     */
    function getWeekStart(date) {
        if (!date || isNaN(date.getTime())) {
            return null;
        }

        // Obtenir le jour de la semaine (0 = dimanche, 1 = lundi, ..., 6 = dimanche)
        var dayOfWeek = date.getUTCDay();

        // Calculer le décalage vers le lundi
        // Si dimanche (0), on recule de 6 jours
        // Si lundi (1), on recule de 0 jours
        // Si mardi (2), on recule de 1 jour, etc.
        var offset = (dayOfWeek === 0) ? 6 : (dayOfWeek - 1);

        // Créer une nouvelle Date au lundi à minuit UTC
        var weekStart = new Date(Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate() - offset,
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
     * @returns {Object} Diagnostics structurés
     */
    function inspect(data) {
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

        // Inspecter les Feuilles
        var sheetByKey = {};
        var sheetsByMemberWeek = {};

        for (var j = 0; j < sheets.length; j++) {
            var sheet = sheets[j];
            var sheetId = normalizeId(sheet.id);
            var sheetMemberId = normalizeId(sheet.membre);
            var sheetWeek = normalizeDateValue(sheet.semaine);

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

            var weekStart = getWeekStart(sheetWeek);
            var weekKey = formatDateKey(weekStart);
            var sheetWeekKey = formatDateKey(sheetWeek);

            // Vérifier que la semaine est un lundi canonique
            if (weekKey !== sheetWeekKey) {
                warnings.push({
                    code: 'SHEET_WEEK_NOT_CANONICAL',
                    sheetId: sheetId,
                    expected: weekKey,
                    actual: sheetWeekKey,
                    message: 'Semaine de la feuille n\'est pas un lundi canonique'
                });
            }

            var key = sheetMemberId + ':' + weekKey;

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
                sheetByKey[key] = sheet;
            }

            // Regrouper par membre/semaine pour analyse
            if (!sheetsByMemberWeek[key]) {
                sheetsByMemberWeek[key] = [];
            }
            sheetsByMemberWeek[key].push(sheet);
        }

        // Inspecter les TimeEntries
        var entriesBySheetKey = {};

        for (var k = 0; k < entries.length; k++) {
            var entry = entries[k];
            var entryId = normalizeId(entry.id);
            var entryMemberId = normalizeId(entry.membre);
            var entryDate = normalizeDateValue(entry.date);
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

            var entryWeekStart = getWeekStart(entryDate);
            var entryWeekKey = formatDateKey(entryWeekStart);
            var entrySheetKey = entryMemberId + ':' + entryWeekKey;

            if (!entriesBySheetKey[entrySheetKey]) {
                entriesBySheetKey[entrySheetKey] = [];
            }
            entriesBySheetKey[entrySheetKey].push(entry);

            // Si la TimeEntry a déjà un lien feuille, vérifier la cohérence
            if (entrySheetId !== null) {
                // Trouver la feuille référencée
                var referencedSheet = null;
                for (var key in sheetByKey) {
                    if (sheetByKey[key].id === entrySheetId) {
                        referencedSheet = sheetByKey[key];
                        break;
                    }
                }

                if (!referencedSheet) {
                    conflicts.push({
                        code: 'TIME_ENTRY_SHEET_NOT_FOUND',
                        entryId: entryId,
                        sheetId: entrySheetId,
                        message: 'TimeEntry référence une feuille inexistante'
                    });
                } else {
                    // Vérifier la cohérence du membre
                    var refMemberId = normalizeId(referencedSheet.membre);
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
                    var refWeek = normalizeDateValue(referencedSheet.semaine);
                    var refWeekStart = getWeekStart(refWeek);
                    var refWeekKey = formatDateKey(refWeekStart);

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
     * @returns {Object} Plan déclaratif
     */
    function buildPlan(data, inspection) {
        // Si aucune inspection fournie, la faire
        if (!inspection) {
            inspection = inspect(data);
        }

        var conflicts = inspection.conflicts.slice();
        var warnings = inspection.warnings.slice();
        var sheetByKey = inspection.sheetByKey;
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
                // Vérifier qu'il n'y a pas de conflit de doublon pour cette clé
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

                        var entryIds = entries.map(function(e) { return e.id; });

                        creates.push({
                            key: sheetKey,
                            membre: memberId,
                            semaine: weekStart,
                            statut: 'brouillon',
                            revisionValidation: 0,
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

        // Calculer le résumé
        var entriesToLink = linksToExistingSheets.filter(function(l) {
            return !l.pendingCreate;
        }).length;

        var sheetsToCreate = creates.length;

        // Le plan est valide uniquement s'il n'y a pas de conflits
        var valid = conflicts.length === 0;

        return {
            valid: valid,
            creates: creates,
            linksToExistingSheets: linksToExistingSheets,
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
     * @returns {Object} { valid: boolean, conflicts: [] }
     */
    function verifyFinalState(data) {
        var inspection = inspect(data);
        var conflicts = inspection.conflicts.slice();

        // Vérifier que chaque TimeEntry valide a une feuille
        var teamById = inspection.teamById;
        var sheetByKey = inspection.sheetByKey;
        var entriesBySheetKey = inspection.entriesBySheetKey;

        for (var sheetKey in entriesBySheetKey) {
            if (!Object.prototype.hasOwnProperty.call(entriesBySheetKey, sheetKey)) {
                continue;
            }

            var entries = entriesBySheetKey[sheetKey];
            var existingSheet = sheetByKey[sheetKey];

            for (var i = 0; i < entries.length; i++) {
                var entry = entries[i];
                var entrySheetId = normalizeId(entry.feuille);

                // Vérifier que la TimeEntry a un lien vers une feuille
                if (entrySheetId === null || entrySheetId === 0 || entrySheetId === undefined) {
                    conflicts.push({
                        code: 'TIME_ENTRY_WITHOUT_SHEET',
                        entryId: entry.id,
                        sheetKey: sheetKey,
                        message: 'TimeEntry n\'a pas de lien vers une feuille'
                    });
                } else if (!existingSheet) {
                    conflicts.push({
                        code: 'TIME_ENTRY_SHEET_NOT_FOUND',
                        entryId: entry.id,
                        sheetId: entrySheetId,
                        message: 'TimeEntry référence une feuille inexistante'
                    });
                }
            }
        }

        // Vérifier qu'aucune clé membre/semaine n'a plusieurs feuilles
        var sheetsByMemberWeek = inspection.sheetsByMemberWeek;
        for (var key in sheetsByMemberWeek) {
            if (Object.prototype.hasOwnProperty.call(sheetsByMemberWeek, key)) {
                var sheetsForWeek = sheetsByMemberWeek[key];
                if (sheetsForWeek.length > 1) {
                    conflicts.push({
                        code: 'DUPLICATE_SHEETS',
                        key: key,
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
