/* ============================================================================
 * taskflow-dom-security.js — Primitives de rendu DOM partagees
 * ----------------------------------------------------------------------------
 * Ces fonctions ne remplacent pas les API DOM. Elles servent aux quelques
 * rendus historiques encore construits sous forme de chaines HTML.
 * ========================================================================== */
(function (root, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.TaskFlowDomSecurity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /**
     * Encode une valeur non fiable pour un noeud texte ou un attribut HTML
     * delimite par des guillemets. Cette fonction ne doit jamais etre utilisee
     * pour construire du JavaScript inline, une URL ou une regle CSS.
     */
    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Les couleurs TaskFlow sont saisies avec <input type="color"> et sont
     * stockees sous forme hexadecimale. Refuser toute autre syntaxe empeche une
     * valeur Grist alteree de sortir d'un attribut style/value.
     */
    function sanitizeCssColor(value, fallback) {
        var safeFallback = /^#[0-9a-fA-F]{6}$/.test(String(fallback || ''))
            ? String(fallback)
            : '#94a3b8';
        var candidate = String(value == null ? '' : value).trim();
        return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate : safeFallback;
    }

    /**
     * Valide un unique nom de classe avant son insertion dans un attribut
     * class. Les espaces et caracteres de syntaxe HTML sont volontairement
     * refuses : un statut persistant ne peut ainsi ni ajouter une classe ni
     * sortir de l'attribut.
     */
    function sanitizeCssClassToken(value, fallback) {
        var tokenPattern = /^[a-zA-Z0-9_-]+$/;
        var safeFallback = tokenPattern.test(String(fallback || '')) ? String(fallback) : '';
        var candidate = String(value == null ? '' : value);
        return tokenPattern.test(candidate) ? candidate : safeFallback;
    }

    /**
     * Convertit une valeur persistante en pourcentage fini et borne. Le retour
     * est un nombre, directement utilisable dans une largeur CSS ou un input.
     */
    function sanitizePercentage(value, fallback) {
        var fallbackNumber = Number(fallback);
        if (!Number.isFinite(fallbackNumber)) fallbackNumber = 0;
        var candidate = Number(value);
        var result = Number.isFinite(candidate) ? candidate : fallbackNumber;
        return Math.min(100, Math.max(0, result));
    }

    /**
     * Restreint une preference persistante a une liste de valeurs connues.
     * Les preferences locales restent une entree non fiable : une extension,
     * un ancien build ou un script tiers peut avoir modifie localStorage.
     */
    function sanitizeEnumValue(value, allowedValues, fallback) {
        var allowed = Array.isArray(allowedValues) ? allowedValues.map(String) : [];
        var safeFallback = allowed.includes(String(fallback)) ? String(fallback) : (allowed[0] || '');
        var candidate = String(value == null ? '' : value);
        return allowed.includes(candidate) ? candidate : safeFallback;
    }

    /**
     * Normalise une reference Grist avant son transport dans un attribut
     * data-*. Une reference est un entier strictement positif ; toute autre
     * valeur est refusee plutot que concatenee dans du HTML ou du JavaScript.
     */
    function sanitizeRecordId(value) {
        var candidate = Number(value);
        return Number.isSafeInteger(candidate) && candidate > 0 ? String(candidate) : '';
    }

    return {
        escapeHtml: escapeHtml,
        sanitizeCssColor: sanitizeCssColor,
        sanitizeCssClassToken: sanitizeCssClassToken,
        sanitizePercentage: sanitizePercentage,
        sanitizeEnumValue: sanitizeEnumValue,
        sanitizeRecordId: sanitizeRecordId
    };
});
