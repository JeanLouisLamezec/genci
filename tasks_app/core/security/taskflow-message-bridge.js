/* ============================================================================
 * taskflow-message-bridge.js — Relais postMessage strict pour le shell TaskFlow
 * ----------------------------------------------------------------------------
 * Le shell est imbrique entre Grist (parent) et le widget actif (iframe enfant).
 * Ce module ne relaie que les messages grain-rpc valides entre ces deux fenetres,
 * avec une origine cible explicite dans chaque direction.
 * ========================================================================== */
(function (root, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.TaskFlowMessageBridge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var MESSAGE_TYPES = Object.freeze({
        RPC_CALL: 1,
        RPC_RESPONSE_DATA: 2,
        RPC_RESPONSE_ERROR: 3,
        CUSTOM: 4,
        READY: 5
    });

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function hasOwn(value, key) {
        return Object.prototype.hasOwnProperty.call(value, key);
    }

    function isSafeRequestId(value) {
        return Number.isSafeInteger(value) && value >= 0;
    }

    function isOptionalString(value) {
        return value === undefined || typeof value === 'string';
    }

    /**
     * Validation structurelle du protocole grain-rpc utilise par l'API Grist.
     * Les contenus metier restent volontairement opaques : ils sont controles
     * par les interfaces RPC de Grist, tandis que le relais ne valide que
     * l'enveloppe necessaire au routage.
     */
    function isValidGristMessage(message) {
        if (!isObject(message) || !Number.isInteger(message.mtype)) return false;
        if (!isOptionalString(message.mdest)) return false;

        switch (message.mtype) {
        case MESSAGE_TYPES.RPC_CALL:
            return (message.reqId === undefined || isSafeRequestId(message.reqId))
                && typeof message.iface === 'string'
                && message.iface.length > 0
                && typeof message.meth === 'string'
                && message.meth.length > 0
                && Array.isArray(message.args);
        case MESSAGE_TYPES.RPC_RESPONSE_DATA:
            return isSafeRequestId(message.reqId);
        case MESSAGE_TYPES.RPC_RESPONSE_ERROR:
            return isSafeRequestId(message.reqId)
                && typeof message.mesg === 'string'
                && isOptionalString(message.code);
        case MESSAGE_TYPES.CUSTOM:
            return hasOwn(message, 'data');
        case MESSAGE_TYPES.READY:
            return true;
        default:
            return false;
        }
    }

    function parseHttpOrigin(value, baseUrl) {
        if (typeof value !== 'string' || !value.trim()) return null;
        try {
            var parsed = new URL(value, baseUrl);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
            return parsed.origin === 'null' ? null : parsed.origin;
        } catch (_) {
            return null;
        }
    }

    /**
     * L'origine du parent n'est jamais acceptee depuis le contenu d'un message.
     * Elle est determinee par les metadonnees de navigation fournies par le
     * navigateur, en privilegiant l'ancetre direct lorsqu'il est disponible.
     */
    function resolveParentOrigin(options) {
        var opts = options || {};
        var currentWindow = opts.window || (typeof window !== 'undefined' ? window : null);
        var currentDocument = opts.document || (typeof document !== 'undefined' ? document : null);
        var currentLocation = opts.location || (currentWindow && currentWindow.location);
        if (!currentWindow || currentWindow.parent === currentWindow) return null;

        var baseUrl = currentLocation && currentLocation.href;
        var ancestorOrigins = currentLocation && currentLocation.ancestorOrigins;
        if (ancestorOrigins && ancestorOrigins.length > 0) {
            var ancestorOrigin = parseHttpOrigin(ancestorOrigins[0], baseUrl);
            if (ancestorOrigin) return ancestorOrigin;
        }

        return parseHttpOrigin(currentDocument && currentDocument.referrer, baseUrl);
    }

    function createMessageBridge(options) {
        var opts = options || {};
        var currentWindow = opts.window || (typeof window !== 'undefined' ? window : null);
        if (!currentWindow || typeof currentWindow.addEventListener !== 'function') {
            throw new Error('TaskFlowMessageBridge requiert une fenetre valide.');
        }

        var parentWindow = opts.parentWindow || currentWindow.parent;
        var getChildWindow = typeof opts.getChildWindow === 'function'
            ? opts.getChildWindow
            : function () { return null; };
        var parentOrigin = parseHttpOrigin(opts.parentOrigin, currentWindow.location && currentWindow.location.href);
        var childOrigin = parseHttpOrigin(opts.childUrl, currentWindow.location && currentWindow.location.href);
        var onBlocked = typeof opts.onBlocked === 'function' ? opts.onBlocked : function () {};
        var started = false;

        function block(direction, reason) {
            onBlocked({ direction: direction, reason: reason });
        }

        function handleMessage(event) {
            var childWindow = getChildWindow();

            if (childWindow && event.source === childWindow) {
                // Un message issu de l'enfant ne doit jamais atteindre un autre
                // listener eventuel du shell, qu'il soit valide ou non.
                if (typeof event.stopImmediatePropagation === 'function') {
                    event.stopImmediatePropagation();
                }
                if (!parentOrigin || event.origin !== childOrigin) {
                    block('child-to-parent', 'origin');
                    return false;
                }
                if (!isValidGristMessage(event.data)) {
                    block('child-to-parent', 'schema');
                    return false;
                }
                parentWindow.postMessage(event.data, parentOrigin);
                return true;
            }

            if (parentWindow && event.source === parentWindow) {
                if (!parentOrigin || event.origin !== parentOrigin) {
                    block('parent-to-child', 'origin');
                    return false;
                }
                if (!childWindow || !childOrigin) {
                    block('parent-to-child', 'destination');
                    return false;
                }
                if (!isValidGristMessage(event.data)) {
                    block('parent-to-child', 'schema');
                    return false;
                }
                childWindow.postMessage(event.data, childOrigin);
                return true;
            }

            return false;
        }

        function setChildUrl(url) {
            childOrigin = parseHttpOrigin(url, currentWindow.location && currentWindow.location.href);
            return childOrigin;
        }

        function start() {
            if (started) return;
            currentWindow.addEventListener('message', handleMessage);
            started = true;
        }

        function stop() {
            if (!started) return;
            currentWindow.removeEventListener('message', handleMessage);
            started = false;
        }

        return {
            handleMessage: handleMessage,
            setChildUrl: setChildUrl,
            start: start,
            stop: stop,
            getParentOrigin: function () { return parentOrigin; },
            getChildOrigin: function () { return childOrigin; }
        };
    }

    return {
        MESSAGE_TYPES: MESSAGE_TYPES,
        isValidGristMessage: isValidGristMessage,
        parseHttpOrigin: parseHttpOrigin,
        resolveParentOrigin: resolveParentOrigin,
        createMessageBridge: createMessageBridge
    };
});
