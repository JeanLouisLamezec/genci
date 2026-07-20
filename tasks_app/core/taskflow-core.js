/* ============================================================================
 * taskflow-core.js — Module commun aux widgets TaskFlow
 * ----------------------------------------------------------------------------
 * SOURCE UNIQUE. Inline dans chaque widget par scripts/build-taskflow.js entre
 * les marqueurs de generation prevus a cet effet.
 * NE PAS editer la copie inlinee dans les .html : editer CE fichier puis lancer
 *   npm run build:taskflow
 *
 * Expose un objet `TF` (namespace) pour ne jamais entrer en collision avec les
 * helpers locaux existants des widgets. Toutes les fonctions qui ecrivent dans
 * Grist sont DEFENSIVES : en cas d'echec elles n'interrompent jamais le widget
 * (au pire, comportement actuel inchange).
 * ========================================================================== */
const TF = (function () {
    'use strict';

    /* ----- Statuts ---------------------------------------------------------
     * Convention : l'ORDRE fait foi. Le DERNIER statut de la liste est l'etat
     * terminal ("termine") utilise par la logique de completion des widgets.
     * Les statuts reels proviennent de la colonne Choice `statut` (editable par
     * l'utilisateur dans Grist). DEFAULT_STATUSES n'est qu'un repli.
     * --------------------------------------------------------------------- */
    const DEFAULT_STATUSES = [
        { value: 'todo',       label: 'À faire',  fillColor: '#94a3b8', textColor: '#ffffff' },
        { value: 'inprogress', label: 'En cours', fillColor: '#f59e0b', textColor: '#ffffff' },
        { value: 'review',     label: 'En revue', fillColor: '#3b82f6', textColor: '#ffffff' },
        { value: 'done',       label: 'Terminé',  fillColor: '#10b981', textColor: '#ffffff' }
    ];
    // Repli libelle + couleur pour les CODES par defaut. Permet d'afficher un libelle
    // FR (et la bonne couleur) meme quand la colonne Choice stocke le code brut
    // (todo/inprogress/...). Une valeur renommee par l'utilisateur garde SON libelle.
    const DEFAULTS_BY_VALUE = {};
    for (var _i = 0; _i < DEFAULT_STATUSES.length; _i++) DEFAULTS_BY_VALUE[DEFAULT_STATUSES[_i].value] = DEFAULT_STATUSES[_i];

    // Convertit un tableau Grist colonnaire en tableau d'objets lignes.
    function columnarToRows(data) {
        if (!data || Array.isArray(data)) return data || [];
        const cols = Object.keys(data);
        if (!cols.length) return [];
        const n = (data[cols[0]] && data[cols[0]].length) || 0;
        const rows = [];
        for (let i = 0; i < n; i++) {
            const rec = {};
            for (const k of cols) rec[k] = data[k][i];
            rows.push(rec);
        }
        return rows;
    }

    // Resout le rowId d'une table depuis son tableId via _grist_Tables.
    async function tableRowId(grist, tableId) {
        const meta = columnarToRows(await grist.docApi.fetchTable('_grist_Tables'));
        const row = meta.find(r => r.tableId === tableId);
        return row ? row.id : null;
    }

    // Verifie si un type est une reference (Ref ou RefList)
    function isRefType(type) {
        return /^(Ref|RefList):/.test(String(type || ''));
    }

    // Extrait la table cible d'un type Ref ou RefList
    function getRefTarget(type) {
        const match = /^(?:Ref|RefList):(.+)$/.exec(String(type || ''));
        return match ? match[1] : null;
    }

    // Verifie si une colonne est une formule derivee
    function isFormulaColumn(tableName, colId, formulasMap) {
        if (!formulasMap || !formulasMap[tableName]) return false;
        return Boolean(formulasMap[tableName][colId]);
    }

    // Helper : délai
    function delay(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    // Attend que les metadonnees de toutes les tables soient disponibles
    async function waitForTablesMetadata(grist, expectedTableIds, options) {
        options = options || {};
        var maxAttempts = options.maxAttempts || 30;
        var baseDelay = options.baseDelay || 200;
        var attempt = 0;
        var missing = [];
        var unavailable = [];

        while (attempt < maxAttempts) {
            try {
                var tablesData = await grist.docApi.fetchTable('_grist_Tables');
                var tables = columnarToRows(tablesData);
                var tableIds = tables.map(function(t) { return t.tableId; });
                
                missing = [];
                unavailable = [];
                
                for (var i = 0; i < expectedTableIds.length; i++) {
                    var tableId = expectedTableIds[i];
                    
                    // Vérifier si la table existe dans _grist_Tables
                    if (tableIds.indexOf(tableId) === -1) {
                        missing.push(tableId);
                        continue;
                    }
                    
                    // Vérifier que fetchTable(tableId) réussit
                    try {
                        await grist.docApi.fetchTable(tableId);
                    } catch (e) {
                        unavailable.push(tableId);
                    }
                }
                
                if (missing.length === 0 && unavailable.length === 0) {
                    // Petit delai supplementaire pour stabilisation
                    await delay(300);
                    return { 
                        success: true, 
                        missing: [],
                        unavailable: [],
                        attempts: attempt + 1
                    };
                }
            } catch (e) {
                // Erreur globale, continuer a essayer
            }
            
            attempt++;
            if (attempt < maxAttempts) {
                await delay(baseDelay * Math.min(attempt, 5));
            }
        }

        return { 
            success: false, 
            missing: missing,
            unavailable: unavailable,
            error: 'Timeout after ' + attempt + ' attempts. Missing: ' + missing.join(', ') + '. Unavailable: ' + unavailable.join(', '),
            attempts: attempt
        };
    }

    // Construit une config de statuts normalisee depuis une liste brute.
    function buildStatusConfig(list, source) {
        const clean = (list || []).filter(s => s && s.value != null).map(s => {
            const v = String(s.value);
            const d = DEFAULTS_BY_VALUE[v];
            const hasExplicitLabel = s.label != null && s.label !== '' && String(s.label) !== v;
            return {
                value: v,
                label: hasExplicitLabel ? String(s.label) : (d ? d.label : v),
                fillColor: s.fillColor || (d ? d.fillColor : '#94a3b8'),
                textColor: s.textColor || (d ? d.textColor : '#ffffff')
            };
        });
        const final = clean.length ? clean : DEFAULT_STATUSES.slice();
        const byValue = {};
        for (const s of final) byValue[s.value] = s;
        return {
            list: final,
            byValue,
            values: final.map(s => s.value),
            terminalValue: final[final.length - 1].value, // convention "dernier = termine"
            firstValue: final[0].value,
            source: clean.length ? source : 'default'
        };
    }

    /* Lit les statuts (libelles + couleurs + ordre) depuis la colonne Choice
     * indiquee, via les metadonnees Grist. Repli en cascade :
     *   1. options de la colonne Choice (cas ideal)
     *   2. valeurs distinctes presentes dans les donnees (colonne Text)
     *   3. DEFAULT_STATUSES
     * Ne jette jamais : retourne toujours une config exploitable.
     */
    async function loadStatusConfig(grist, table, column, distinctFallback) {
        try {
            const tid = await tableRowId(grist, table);
            if (tid != null) {
                const cols = columnarToRows(await grist.docApi.fetchTable('_grist_Tables_column'));
                const col = cols.find(c => c.parentId === tid && c.colId === column);
                if (col && col.widgetOptions) {
                    let opt = {};
                    try { opt = JSON.parse(col.widgetOptions) || {}; } catch (e) { opt = {}; }
                    const choices = Array.isArray(opt.choices) ? opt.choices : [];
                    const co = opt.choiceOptions || {};
                    if (choices.length) {
                        return buildStatusConfig(choices.map(ch => ({
                            value: ch,
                            label: ch,
                            fillColor: co[ch] && co[ch].fillColor,
                            textColor: co[ch] && co[ch].textColor
                        })), 'choice');
                    }
                }
            }
        } catch (e) { /* repli silencieux */ }

        if (Array.isArray(distinctFallback) && distinctFallback.length) {
            const seen = [];
            for (const v of distinctFallback) { if (v != null && v !== '' && seen.indexOf(v) === -1) seen.push(v); }
            if (seen.length) return buildStatusConfig(seen.map(v => ({ value: v, label: v })), 'data');
        }
        return buildStatusConfig(DEFAULT_STATUSES.slice(), 'default');
    }

    function getStatus(cfg, value) {
        if (cfg && cfg.byValue && cfg.byValue[value]) return cfg.byValue[value];
        return { value: value, label: value || '', fillColor: '#94a3b8', textColor: '#ffffff' };
    }
    function isTerminal(cfg, value) { return !!cfg && value === cfg.terminalValue; }

    /* Seme les options (choix + couleurs) sur une colonne Choice si elle n'en a
     * pas encore. Defensif. A appeler depuis ensureSchema apres creation.
     * Retourne un resultat structure : { ok, changed, reason/error }
     */
    async function seedStatusChoices(grist, table, column, statuses) {
        try {
            const tid = await tableRowId(grist, table);
            if (tid == null) {
                return { ok: false, changed: false, reason: 'Table non trouvée: ' + table };
            }
            
            const cols = columnarToRows(await grist.docApi.fetchTable('_grist_Tables_column'));
            const col = cols.find(c => c.parentId === tid && c.colId === column);
            
            if (!col) {
                return { ok: false, changed: false, reason: 'Colonne non trouvée: ' + table + '.' + column };
            }
            
            let opt = {};
            try { opt = JSON.parse(col.widgetOptions || '{}') || {}; } catch (e) { opt = {}; }
            
            // Si deja configure, on respecte les personnalisations
            if (Array.isArray(opt.choices) && opt.choices.length) {
                return { ok: true, changed: false, reason: 'already-configured' };
            }
            
            const list = statuses && statuses.length ? statuses : DEFAULT_STATUSES;
            const choiceOptions = {};
            for (const s of list) choiceOptions[s.value] = { fillColor: s.fillColor, textColor: s.textColor };
            const widgetOptions = JSON.stringify({ choices: list.map(s => s.value), choiceOptions: choiceOptions });
            
            await grist.docApi.applyUserActions([['ModifyColumn', table, column, { widgetOptions: widgetOptions }]]);
            
            return { ok: true, changed: true, reason: null };
        } catch (e) {
            console.warn('TF.seedStatusChoices:', e && e.message);
            return { ok: false, changed: false, error: e.message || String(e) };
        }
    }

    /* ----- #2 : colonnes d'affichage des Ref (noms au lieu des IDs) ---------
     * Pose le visibleCol + la display formula sur des colonnes Ref pour que les
     * VUES NATIVES Grist affichent un libelle plutot que l'ID de ligne.
     * specs : [{ table:'Tasks', column:'projet', visibleColId:'nom' }, ...]
     * ROBUSTE : verifie les metadonnees, gere les erreurs, retourne un rapport.
     * --------------------------------------------------------------------- */
    async function setRefDisplayColumns(grist, specs) {
        var result = {
            ok: true,
            configured: [],
            alreadyCorrect: [],
            skipped: [],
            errors: []
        };

        if (!Array.isArray(specs) || !specs.length) {
            return result;
        }

        try {
            // Relire les metadonnees fraîches
            var tables = columnarToRows(await grist.docApi.fetchTable('_grist_Tables'));
            var cols = columnarToRows(await grist.docApi.fetchTable('_grist_Tables_column'));
            
            var tidOf = function(tableId) {
                var r = tables.find(function(t) { return t.tableId === tableId; });
                return r ? r.id : null;
            };
            
            var colOf = function(tableRowId, colId) {
                return cols.find(function(c) { return c.parentId === tableRowId && c.colId === colId; });
            };

            for (var i = 0; i < specs.length; i++) {
                var s = specs[i];
                var srcTid = tidOf(s.table);
                
                if (srcTid == null) {
                    result.skipped.push({ table: s.table, column: s.column, reason: 'Table source non trouvée' });
                    continue;
                }
                
                var refCol = colOf(srcTid, s.column);
                if (!refCol) {
                    result.skipped.push({ table: s.table, column: s.column, reason: 'Colonne référence absente des métadonnées' });
                    result.ok = false;  // IMPORTANT : skipped = échec, pas ignoré
                    continue;
                }
                
                // Verifier que c'est bien une colonne Ref ou RefList
                var typeMatch = /^(?:Ref|RefList):(.+)$/.exec(refCol.type || '');
                if (!typeMatch) {
                    result.errors.push({
                        table: s.table,
                        column: s.column,
                        reason: 'Type incorrect: ' + (refCol.type || 'undefined') + ' (attendu Ref:*)'
                    });
                    result.ok = false;
                    continue;
                }
                
                // Table cible deduite du type
                var targetTid = tidOf(typeMatch[1]);
                if (targetTid == null) {
                    result.errors.push({
                        table: s.table,
                        column: s.column,
                        reason: 'Table cible non trouvée: ' + typeMatch[1]
                    });
                    result.ok = false;
                    continue;
                }
                
                var visCol = colOf(targetTid, s.visibleColId);
                if (!visCol) {
                    result.errors.push({
                        table: s.table,
                        column: s.column,
                        reason: 'Colonne visible non trouvée: ' + s.visibleColId
                    });
                    result.ok = false;
                    continue;
                }
                
                // Verifier si deja configure correctement
                var visibleColId = refCol.visibleCol;
                var displayColId = refCol.displayCol;
                
                // Verifier visibleCol (comparaison numerique)
                var visibleColIsCorrect = (Number(visibleColId) === Number(visCol.id));
                
                // Verifier display formula
                var displayFormula = '$' + s.column + '.' + s.visibleColId;
                var displayCol = displayColId ? cols.find(function(c) { return c.id === displayColId; }) : null;
                var displayFormulaIsCorrect = displayCol && displayCol.formula === displayFormula;
                
                if (visibleColIsCorrect && displayFormulaIsCorrect) {
                    result.alreadyCorrect.push({ table: s.table, column: s.column });
                    continue;
                }
                
                // Appliquer les corrections
                var actions = [];
                
                // Configurer la formule d'affichage
                actions.push(['SetDisplayFormula', s.table, null, s.column, displayFormula]);
                
                // Configurer le visibleCol
                actions.push(['UpdateRecord', '_grist_Tables_column', refCol.id, { visibleCol: visCol.id }]);
                
                try {
                    await grist.docApi.applyUserActions(actions);
                    result.configured.push({ table: s.table, column: s.column });
                } catch (e) {
                    result.errors.push({
                        table: s.table,
                        column: s.column,
                        reason: e.message || String(e)
                    });
                    result.ok = false;
                }
            }
            
            return result;
        } catch (e) {
            result.ok = false;
            result.errors.push({ reason: 'Erreur globale: ' + (e.message || String(e)) });
            return result;
        }
    }

    /* ----- #3 : plan de charge (heures par personne) ------------------------
     * Stockage : colonne Text `charges` sur Tasks, JSON [{teamId, heures}].
     * Parse defensif identique au pattern subtasks.
     * --------------------------------------------------------------------- */
    function parseCharges(v) {
        try {
            const a = JSON.parse(v || '[]');
            if (!Array.isArray(a)) return [];
            return a.filter(x => x && x.teamId != null)
                    .map(x => ({ teamId: Number(x.teamId), heures: Number(x.heures) || 0 }))
                    .filter(x => !isNaN(x.teamId));
        } catch (e) { return []; }
    }
    function chargesToJson(arr) {
        return JSON.stringify((arr || [])
            .filter(x => x && x.teamId != null)
            .map(x => ({ teamId: Number(x.teamId), heures: Number(x.heures) || 0 }))
            .filter(x => !isNaN(x.teamId)));
    }
    // Heures totales d'une tache (somme des charges par personne).
    function chargeTotal(charges) { return parseCharges(typeof charges === 'string' ? charges : JSON.stringify(charges || [])).reduce((s, c) => s + c.heures, 0); }
    // Agrege la charge par membre sur une liste de taches (chaque tache expose .charges).
    function chargeByMember(tasks) {
        const by = {};
        for (const t of (tasks || [])) {
            for (const c of parseCharges(t && t.charges)) {
                by[c.teamId] = (by[c.teamId] || 0) + c.heures;
            }
        }
        return by;
    }

    // Cle de periode : semaine ISO 'YYYY-Www' ou mois 'YYYY-MM'.
    function periodKey(date, granularity) {
        if (granularity === 'month') {
            return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0');
        }
        const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
        const day = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - day);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
    }

    // #3 plan de charge temporel : etale les charges PROPRES de chaque tache sur sa
    // duree (jours calendaires), agrege par personne et par periode.
    // dateDebut/dateEcheance = timestamps Unix SECONDES (Grist). Tache sans dates ou
    // sans charge = ignoree. Retourne { teamId: { periodKey: heures } }.
    function chargeByMemberPeriod(tasks, granularity) {
        const g = granularity === 'month' ? 'month' : 'week';
        const out = {};
        for (const t of (tasks || [])) {
            const charges = parseCharges(t && t.charges);
            if (!charges.length) continue;
            const s = t.dateDebut, e = t.dateEcheance;
            if (s == null || e == null) continue;
            const day0 = Math.floor((s * 1000) / 86400000);
            const day1 = Math.floor((e * 1000) / 86400000);
            const nDays = Math.max(day1 - day0 + 1, 1);
            for (const c of charges) {
                const perDay = (Number(c.heures) || 0) / nDays;
                if (!perDay) continue;
                if (!out[c.teamId]) out[c.teamId] = {};
                for (let dd = day0; dd <= day1; dd++) {
                    const key = periodKey(new Date(dd * 86400000), g);
                    out[c.teamId][key] = (out[c.teamId][key] || 0) + perDay;
                }
            }
        }
        return out;
    }

    // Decale une date de n periodes (semaine = 7 jours, mois = 1 mois).
    function shiftPeriods(date, granularity, n) {
        const d = new Date(date.getTime());
        if (granularity === 'month') d.setUTCMonth(d.getUTCMonth() + n);
        else d.setUTCDate(d.getUTCDate() + n * 7);
        return d;
    }

    // Liste contigue de cles de periode (semaine ISO ou mois) a partir d'une date,
    // alignee sur le debut de periode (lundi / 1er du mois). Inclut les periodes vides.
    function periodRange(startDate, granularity, count) {
        const g = granularity === 'month' ? 'month' : 'week';
        let d = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
        if (g === 'week') { const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() - day + 1); }
        else { d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
        const out = [];
        for (let i = 0; i < count; i++) {
            out.push(periodKey(d, g));
            if (g === 'week') d.setUTCDate(d.getUTCDate() + 7);
            else d.setUTCMonth(d.getUTCMonth() + 1);
        }
        return out;
    }

    // chargeMatrix : generalise chargeByMemberPeriod. Etale les charges (via getCharges,
    // defaut parseCharges) sur la duree, agrege par cle keyFn(t, charge) et periode.
    function chargeMatrix(tasks, keyFn, granularity, getCharges, workdays) {
        const g = granularity === 'month' ? 'month' : 'week';
        const out = {};
        for (const t of (tasks || [])) {
            const charges = getCharges ? getCharges(t) : parseCharges(t && t.charges);
            if (!charges.length || t.dateDebut == null || t.dateEcheance == null) continue;
            const d0 = Math.floor((t.dateDebut * 1000) / 86400000), d1 = Math.floor((t.dateEcheance * 1000) / 86400000);
            const days = [];
            for (let dd = d0; dd <= d1; dd++) { if (workdays) { const wd = new Date(dd * 86400000).getUTCDay(); if (wd < 1 || wd > 5) continue; } days.push(dd); }
            if (!days.length) days.push(d0);
            for (const c of charges) {
                const key = keyFn(t, c); if (key == null) continue;
                const perDay = c.heures / days.length; if (!perDay) continue;
                if (!out[key]) out[key] = {};
                for (const dd of days) { const pk = periodKey(new Date(dd * 86400000), g); out[key][pk] = (out[key][pk] || 0) + perDay; }
            }
        }
        return out;
    }

    /* ----- #7 : respect des droits (ACL) ------------------------------------
     * Deux niveaux : (a) acces document lecture seule -> Grist passe
     * `readonly=true` dans l'URL de l'iframe ; (b) ACL au niveau ligne ->
     * l'acces widget peut etre `full` mais une ecriture sur une ligne donnee
     * est refusee par le serveur. safeApply absorbe ce refus proprement.
     * --------------------------------------------------------------------- */
    function _qp(name) { try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; } }
    // Vrai si Grist a ouvert le widget en lecture seule (acces doc restreint).
    function isReadOnly() { return _qp('readonly') === 'true'; }
    // Niveau d'acces accorde au widget : 'full' | 'read table' | 'none' (defaut 'full').
    function accessLevel() { return _qp('access') || 'full'; }
    // Detecte un message d'erreur Grist correspondant a un refus de droits.
    function isAccessError(e) {
        const msg = (e && (e.message || e.toString())) || '';
        return /access denied|not allowed|permission|forbidden|read[- ]?only|cannot (modify|add|remove)|acl/i.test(msg);
    }
    // Applique des actions en absorbant un refus de droits.
    // Retourne { ok:true } ou { ok:false, denied:bool, message }. Ne fait PAS d'UI
    // (chaque widget affiche son propre toast et recharge pour annuler l'optimiste).
    async function safeApply(grist, actions) {
        if (isReadOnly()) return { ok: false, denied: true, message: 'Document en lecture seule' };
        try { const r = await grist.docApi.applyUserActions(actions); return { ok: true, ret: r }; }
        catch (e) { return { ok: false, denied: isAccessError(e), message: (e && (e.message || e.toString())) || 'Erreur' }; }
    }
    // Garde transverse : enrobe grist.docApi.applyUserActions une seule fois pour
    // respecter les droits sur TOUS les sites d'ecriture sans les modifier un a un.
    // - lecture seule -> bloque + opts.onReadOnly()
    // - refus ACL au niveau ligne -> opts.onDenied(err) (le widget toast + recharge)
    // Les erreurs continuent d'etre levees (les try/catch existants les absorbent).
    function guardWrites(grist, opts) {
        opts = opts || {};
        if (!grist || !grist.docApi || grist.docApi._tfGuarded) return;
        const raw = grist.docApi.applyUserActions.bind(grist.docApi);
        grist.docApi._tfGuarded = true;
        grist.docApi.applyUserActions = async function (actions) {
            if (isReadOnly()) { try { opts.onReadOnly && opts.onReadOnly(); } catch (e) {} const err = new Error('Document en lecture seule'); err.tfReadOnly = true; throw err; }
            try { return await raw(actions); }
            catch (e) { if (isAccessError(e)) { try { opts.onDenied && opts.onDenied(e); } catch (e2) {} } throw e; }
        };
    }
    // Bandeau "lecture seule" auto-contenu (aucun markup widget requis).
    // Pousse le contenu vers le bas (padding-top sur body) pour NE PAS recouvrir l'en-tete du widget.
    function readOnlyBanner() {
        if (!isReadOnly() || (typeof document === 'undefined') || document.getElementById('tf-ro-banner')) return;
        const b = document.createElement('div');
        b.id = 'tf-ro-banner';
        b.textContent = 'Lecture seule — vos droits ne permettent pas la modification';
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#b45309;color:#fff;font:600 12px/1.4 system-ui,-apple-system,sans-serif;text-align:center;padding:6px 10px;letter-spacing:.2px;box-sizing:border-box';
        document.body.appendChild(b);
        const h = b.offsetHeight || 28;
        const prev = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
        document.body.style.paddingTop = (prev + h) + 'px';
    }

    // ========================================================================
    // FAST PATH — Lecture rapide de l'état du schéma via TaskFlow_Meta
    // ========================================================================
    
    // Lit TaskFlow_Meta et retourne un état rapide pour décider du fast path
    async function readSchemaFastState(grist, expectedVersion) {
        var result = {
            ready: false,
            meta: null,
            reason: null,
            error: null
        };
        
        try {
            var raw = await grist.docApi.fetchTable('TaskFlow_Meta');
            var rows = columnarToRows(raw);
            
            if (rows.length === 0) {
                result.reason = 'META_EMPTY';
                return result;
            }
            
            if (rows.length > 1) {
                result.reason = 'META_DUPLICATE';
                result.meta = rows;
                return result;
            }
            
            var meta = rows[0];
            result.meta = meta;
            
            var schemaVersion = Number(meta.schemaVersion || 0);
            var installationStatus = String(meta.installationStatus || '').toLowerCase();
            var lastError = meta.lastError;
            
            var versionMatch = expectedVersion == null || schemaVersion === Number(expectedVersion);
            var statusReady = installationStatus === 'ready' || installationStatus === 'migrated';
            var noError = !lastError || lastError === '' || lastError === 'null';
            
            result.ready = versionMatch && statusReady && noError;
            result.reason = result.ready ? 'SCHEMA_META_READY' : 'SCHEMA_META_STALE';
            
            return result;
            
        } catch (e) {
            result.reason = 'META_UNAVAILABLE';
            result.error = e.message || String(e);
            return result;
        }
    }
    
    // Écrit ou met à jour TaskFlow_Meta avec le statut 'ready'
    async function writeSchemaReady(grist, options) {
        options = options || {};
        
        var record = {
            schemaVersion: options.schemaVersion || 3,
            installationStatus: 'ready',
            lastError: null,
            lastMigrationAt: Math.floor(Date.now() / 1000)
        };
        
        if (options.installedBy) {
            record.installedBy = options.installedBy;
        }
        
        if (options.lastMigration) {
            record.lastMigration = options.lastMigration;
        }
        
        try {
            var raw = await grist.docApi.fetchTable('TaskFlow_Meta');
            var rows = columnarToRows(raw);
            
            if (rows.length === 0) {
                await grist.docApi.applyUserActions([
                    ['AddRecord', 'TaskFlow_Meta', null, record]
                ]);
                return { success: true, action: 'created' };
            }
            
            if (rows.length > 1) {
                return { 
                    success: false, 
                    error: 'META_DUPLICATE',
                    count: rows.length,
                    reason: 'TaskFlow_Meta contient ' + rows.length + ' lignes (1 attendue)'
                };
            }
            
            var existingId = rows[0].id;
            await grist.docApi.applyUserActions([
                ['UpdateRecord', 'TaskFlow_Meta', existingId, record]
            ]);
            
            return { success: true, action: 'updated', id: existingId };
            
        } catch (e) {
            return { 
                success: false, 
                error: e.message || String(e)
            };
        }
    }

    return {
        DEFAULT_STATUSES: DEFAULT_STATUSES,
        columnarToRows: columnarToRows,
        loadStatusConfig: loadStatusConfig,
        buildStatusConfig: buildStatusConfig,
        getStatus: getStatus,
        isTerminal: isTerminal,
        seedStatusChoices: seedStatusChoices,
        setRefDisplayColumns: setRefDisplayColumns,
        parseCharges: parseCharges,
        chargesToJson: chargesToJson,
        chargeTotal: chargeTotal,
        chargeByMember: chargeByMember,
        periodKey: periodKey,
        chargeByMemberPeriod: chargeByMemberPeriod,
        shiftPeriods: shiftPeriods,
        periodRange: periodRange,
        chargeMatrix: chargeMatrix,
        isReadOnly: isReadOnly,
        accessLevel: accessLevel,
        isAccessError: isAccessError,
        safeApply: safeApply,
        guardWrites: guardWrites,
        readOnlyBanner: readOnlyBanner,
    // Helpers pour le schema
    tableRowId: tableRowId,
    isRefType: isRefType,
    getRefTarget: getRefTarget,
    isFormulaColumn: isFormulaColumn,
    waitForTablesMetadata: waitForTablesMetadata,
    delay: delay,
    readSchemaFastState: readSchemaFastState,
    writeSchemaReady: writeSchemaReady
    };
})();

// Export explicite pour globalThis (fonctionne dans navigateur et autres environnements)
if (typeof globalThis !== 'undefined') {
    globalThis.TF = TF;
}
