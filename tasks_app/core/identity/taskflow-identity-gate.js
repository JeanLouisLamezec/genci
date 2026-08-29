/* ============================================================================
 * taskflow-identity-gate.js — Parcours d'association commun aux widgets
 * ========================================================================== */
(function (root, factory) {
    var claimServiceModule = root && root.TaskFlowIdentityClaimService;
    if (typeof module !== 'undefined' && module.exports) {
        claimServiceModule = require('./taskflow-identity-claim-service.js');
    }
    var api = factory(claimServiceModule);
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.TaskFlowIdentityGate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (claimServiceModule) {
    'use strict';

    var GATE_ID = 'taskflow-identity-gate';

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function unavailableMessage(actor) {
        var codes = actor && actor.conflictCodes || [];
        if (codes.indexOf('TEAM_EMAIL_NOT_FOUND') !== -1) {
            return 'Aucun profil Team actif ne correspond à votre email Grist. Demandez à un administrateur de créer ou corriger votre profil, puis réessayez.';
        }
        if (codes.indexOf('CURRENT_EMAIL_DUPLICATED') !== -1 || actor && actor.status === 'EMAIL_DUPLICATED') {
            return 'Plusieurs profils Team utilisent votre email. Un administrateur doit corriger ce doublon avant une nouvelle tentative.';
        }
        if (actor && actor.status === 'MEMBER_INACTIVE') {
            return 'Votre profil Team est inactif. Un administrateur doit le réactiver avant une nouvelle tentative.';
        }
        if (actor && actor.status === 'GRIST_USER_ID_DUPLICATED') {
            return 'Des associations Grist sont en conflit dans Team. Un administrateur doit les corriger.';
        }
        return 'Votre compte ne peut pas être associé pour le moment. Vérifiez votre profil Team avec un administrateur, puis réessayez.';
    }

    function createIdentityGate(options) {
        options = options || {};
        var identityRuntime = options.identityRuntime ||
            (options.permissionRuntime && options.permissionRuntime.getIdentityRuntime && options.permissionRuntime.getIdentityRuntime());
        var documentRef = options.document || (typeof document !== 'undefined' ? document : null);
        var mount = options.mount || (documentRef && documentRef.body);
        var gateElement = null;
        var busy = false;
        var claimService = options.claimService || claimServiceModule.createIdentityClaimService({
            grist: options.grist,
            identityRuntime: identityRuntime,
            reloadSnapshot: options.reloadSnapshot
        });

        function destroy() {
            if (gateElement && gateElement.parentNode) gateElement.parentNode.removeChild(gateElement);
            gateElement = null;
        }

        function ensureElement() {
            if (!documentRef || !mount) return null;
            if (gateElement && gateElement.parentNode) return gateElement;
            var previous = documentRef.getElementById(GATE_ID);
            if (previous && previous.parentNode) previous.parentNode.removeChild(previous);
            gateElement = documentRef.createElement('div');
            gateElement.id = GATE_ID;
            gateElement.setAttribute('role', 'dialog');
            gateElement.setAttribute('aria-modal', 'true');
            gateElement.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.58);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
            mount.appendChild(gateElement);
            return gateElement;
        }

        function shell(title, body, buttonLabel, buttonKind) {
            var element = ensureElement();
            if (!element) return;
            element.innerHTML = '<div style="width:min(480px,100%);background:#fff;color:#1e293b;border-radius:14px;padding:24px;box-shadow:0 24px 60px rgba(15,23,42,.3)">' +
                '<h2 style="font-size:1.15rem;margin:0 0 10px">' + escapeHtml(title) + '</h2>' +
                '<div style="font-size:.9rem;line-height:1.5;color:#475569">' + body + '</div>' +
                '<button type="button" data-tf-identity-action="' + buttonKind + '" style="margin-top:18px;width:100%;border:0;border-radius:9px;padding:10px 14px;background:#3e5de7;color:#fff;font-weight:700;cursor:pointer"' + (busy ? ' disabled' : '') + '>' + escapeHtml(buttonLabel) + '</button>' +
                '</div>';
        }

        async function associate(candidateId) {
            if (busy) return;
            busy = true;
            render(identityRuntime.getActor && identityRuntime.getActor());
            var result = await claimService.claim(candidateId);
            busy = false;
            if (!result.success) {
                var refreshed = await identityRuntime.refresh({ force: true });
                render(refreshed.actor, result.reason || null);
                return result;
            }
            if (options.permissionRuntime) options.permissionRuntime.invalidate();
            if (options.permissionRuntime && options.permissionRuntime.refresh) {
                await options.permissionRuntime.refresh({ force: true });
            }
            destroy();
            if (typeof options.onAssociated === 'function') options.onAssociated(result.actor || result.identity);
            return result;
        }

        async function retry() {
            if (busy) return;
            busy = true;
            shell('Association du compte', 'Nouvelle vérification du profil Team…', 'Vérification…', 'retry');
            var state = await identityRuntime.refresh({ force: true });
            busy = false;
            render(state.actor);
            return state;
        }

        function render(actor, errorMessage) {
            if (!actor || actor.status === 'IDENTITY_DATA_UNAVAILABLE') {
                shell('Identité indisponible', escapeHtml(errorMessage || unavailableMessage(actor)), 'Réessayer', 'retry');
            } else if (actor.identified) {
                destroy();
                return;
            } else if (actor.status === 'ASSOCIATION_CONFIRMATION_REQUIRED' && actor.associationCandidate) {
                var candidate = actor.associationCandidate;
                shell(
                    'Associer votre compte Grist',
                    (errorMessage ? '<p style="color:#b91c1c;margin:0 0 10px">' + escapeHtml(errorMessage) + '</p>' : '') +
                    '<p style="margin:0 0 12px">Votre compte Grist correspond au profil suivant :</p>' +
                    '<p style="margin:0;font-weight:700">' + escapeHtml(candidate.nom || 'Profil Team') + '</p>' +
                    '<p style="margin:3px 0 0">' + escapeHtml(candidate.email) + '</p>',
                    busy ? 'Association en cours…' : 'Associer mon compte',
                    'associate'
                );
            } else {
                shell(
                    'Association impossible',
                    (errorMessage ? '<p style="color:#b91c1c;margin:0 0 10px">' + escapeHtml(errorMessage) + '</p>' : '') +
                    '<p style="margin:0">' + escapeHtml(unavailableMessage(actor)) + '</p>',
                    busy ? 'Vérification…' : 'Associer mon compte',
                    'retry'
                );
            }

            if (!gateElement) return;
            var button = gateElement.querySelector('[data-tf-identity-action]');
            if (!button) return;
            button.addEventListener('click', function () {
                if (button.getAttribute('data-tf-identity-action') === 'associate') {
                    associate(actor.associationCandidate.id);
                } else {
                    retry();
                }
            });
        }

        async function start() {
            if (!identityRuntime || typeof identityRuntime.refresh !== 'function') {
                render({ status: 'IDENTITY_DATA_UNAVAILABLE', conflictCodes: [] });
                return null;
            }
            var state = await identityRuntime.refresh();
            render(state.actor);
            return state;
        }

        return {
            start: start,
            retry: retry,
            associate: associate,
            render: render,
            destroy: destroy,
            getElement: function () { return gateElement; },
            isBusy: function () { return busy; }
        };
    }

    return {
        GATE_ID: GATE_ID,
        createIdentityGate: createIdentityGate
    };
});
