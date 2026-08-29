/* ============================================================================
 * taskflow-identity-claim-service.js — Écriture contrôlée de l'association
 * ========================================================================== */
(function (root, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.TaskFlowIdentityClaimService = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var CLAIM_STATUS = Object.freeze({
        APPLIED: 'APPLIED',
        ALREADY_APPLIED: 'ALREADY_APPLIED',
        PENDING: 'PENDING',
        NOT_ALLOWED: 'NOT_ALLOWED',
        WRITE_FAILED: 'WRITE_FAILED',
        RELOAD_FAILED: 'RELOAD_FAILED',
        POSTCONDITION_FAILED: 'POSTCONDITION_FAILED'
    });

    function createIdentityClaimService(options) {
        options = options || {};
        var grist = options.grist;
        var identityRuntime = options.identityRuntime;
        var pending = false;

        async function claim(expectedTeamMemberId) {
            if (pending) {
                return { success: false, code: CLAIM_STATUS.PENDING };
            }
            if (!identityRuntime || typeof identityRuntime.buildClaim !== 'function') {
                return { success: false, code: CLAIM_STATUS.NOT_ALLOWED, reason: 'Runtime d\'identité indisponible' };
            }

            pending = true;
            try {
                var validation = await identityRuntime.buildClaim(expectedTeamMemberId);
                if (!validation.allowed) {
                    return {
                        success: false,
                        code: CLAIM_STATUS.NOT_ALLOWED,
                        reason: validation.reason,
                        validationCode: validation.code,
                        identity: validation.identity
                    };
                }
                if (validation.idempotent) {
                    return {
                        success: true,
                        code: CLAIM_STATUS.ALREADY_APPLIED,
                        teamMemberId: validation.teamMemberId,
                        identity: validation.identity
                    };
                }

                try {
                    await grist.docApi.applyUserActions([validation.action]);
                } catch (error) {
                    return { success: false, code: CLAIM_STATUS.WRITE_FAILED, reason: error.message || String(error), error: error };
                }

                identityRuntime.invalidate();
                if (typeof options.reloadSnapshot === 'function') {
                    try {
                        await options.reloadSnapshot({ reason: 'identity-association', immediate: true });
                    } catch (error) {
                        return { success: false, code: CLAIM_STATUS.RELOAD_FAILED, reason: error.message || String(error), error: error };
                    }
                }

                var after = await identityRuntime.refresh({ force: true });
                var actor = after && after.actor;
                if (!actor || !actor.identified || actor.memberId !== validation.teamMemberId) {
                    return {
                        success: false,
                        code: CLAIM_STATUS.POSTCONDITION_FAILED,
                        expectedTeamMemberId: validation.teamMemberId,
                        actor: actor || null
                    };
                }

                return {
                    success: true,
                    code: CLAIM_STATUS.APPLIED,
                    teamMemberId: actor.memberId,
                    actor: actor
                };
            } finally {
                pending = false;
            }
        }

        return {
            claim: claim,
            isPending: function () { return pending; }
        };
    }

    return {
        CLAIM_STATUS: CLAIM_STATUS,
        createIdentityClaimService: createIdentityClaimService
    };
});
