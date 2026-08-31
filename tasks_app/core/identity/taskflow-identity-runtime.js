/* ============================================================================
 * taskflow-identity-runtime.js — Adaptateur Grist du domaine d'identité
 * ========================================================================== */
(function (root, factory) {
    var identity = root && root.TaskFlowIdentity;
    if (typeof module !== 'undefined' && module.exports) {
        identity = require('./taskflow-identity.js');
    }
    var api = factory(identity);
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.TaskFlowIdentityRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (identityDomain) {
    'use strict';

    function requireIdentityDomain() {
        if (!identityDomain || typeof identityDomain.resolveActorIdentity !== 'function') {
            throw new Error('Domaine d\'identité TaskFlow non chargé');
        }
        return identityDomain;
    }

    function columnarToRows(data) {
        if (!data) return [];
        if (Array.isArray(data)) return data.slice();
        var keys = Object.keys(data);
        if (!keys.length) return [];
        var count = Array.isArray(data[keys[0]]) ? data[keys[0]].length : 0;
        var rows = [];
        for (var index = 0; index < count; index++) {
            var row = {};
            keys.forEach(function (key) { row[key] = data[key][index]; });
            rows.push(row);
        }
        return rows;
    }

    function decodeJwtPayload(token) {
        try {
            var parts = String(token || '').split('.');
            if (parts.length !== 3) return null;
            var normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            while (normalized.length % 4) normalized += '=';
            var json;
            if (typeof atob === 'function') {
                json = decodeURIComponent(Array.prototype.map.call(atob(normalized), function (character) {
                    return '%' + ('00' + character.charCodeAt(0).toString(16)).slice(-2);
                }).join(''));
            } else if (typeof Buffer !== 'undefined') {
                json = Buffer.from(normalized, 'base64').toString('utf8');
            } else {
                return null;
            }
            return JSON.parse(json);
        } catch (error) {
            return null;
        }
    }

    async function getCurrentGristUser(grist) {
        try {
            var tokenResult = await grist.docApi.getAccessToken({ readOnly: true });
            var payload = decodeJwtPayload(tokenResult && tokenResult.token);
            if (!payload) return { userId: null, email: null };
            return {
                userId: payload.userId != null
                    ? payload.userId
                    : (payload.user && payload.user.id != null ? payload.user.id : payload.sub),
                email: payload.email || (payload.user && payload.user.email) || payload.loginEmail || null
            };
        } catch (error) {
            return { userId: null, email: null, error: error };
        }
    }

    function unavailableActor(error) {
        return {
            identified: false,
            status: requireIdentityDomain().IDENTITY_STATUS.IDENTITY_DATA_UNAVAILABLE,
            gristUserId: null,
            email: '',
            memberId: null,
            currentUserMemberId: null,
            member: null,
            isAdmin: false,
            associationCandidate: null,
            conflictCodes: ['IDENTITY_DATA_UNAVAILABLE'],
            error: error || null
        };
    }

    function createGristIdentityRuntime(grist, options) {
        options = options || {};
        var state = null;
        var valid = false;
        var loading = null;

        async function load() {
            var currentUser = await getCurrentGristUser(grist);
            if (currentUser.error) throw currentUser.error;
            var rawTeam = await grist.docApi.fetchTable('Team');
            var team = columnarToRows(rawTeam);
            var actor = requireIdentityDomain().resolveActorIdentity({
                team: team,
                currentGristUserId: currentUser.userId,
                currentEmail: currentUser.email
            });
            return { actor: actor, currentUser: currentUser, team: team };
        }

        async function refresh(refreshOptions) {
            refreshOptions = refreshOptions || {};
            var force = !!refreshOptions.force;

            // Une vérification forcée protège une écriture. Elle ne doit jamais
            // réutiliser une lecture commencée avant la demande, car Team peut
            // avoir changé entre-temps (notamment estAdmin true -> false).
            if (force) {
                while (loading) await loading;
            } else {
                if (loading) return loading;
                if (valid) return state;
            }

            var request = (async function () {
                try {
                    state = await load();
                    valid = true;
                    if (typeof options.onIdentity === 'function') options.onIdentity(state.actor);
                    return state;
                } catch (error) {
                    state = { actor: unavailableActor(error), currentUser: null, team: [] };
                    valid = true;
                    if (typeof options.onError === 'function') options.onError(error);
                    if (typeof options.onIdentity === 'function') options.onIdentity(state.actor);
                    return state;
                }
            })();
            loading = request;
            try {
                return await request;
            } finally {
                if (loading === request) loading = null;
            }
        }

        async function buildClaim(expectedTeamMemberId) {
            var current = await refresh({ force: true });
            return requireIdentityDomain().buildIdentityClaim({
                team: current.team,
                currentGristUserId: current.currentUser && current.currentUser.userId,
                currentEmail: current.currentUser && current.currentUser.email,
                expectedTeamMemberId: expectedTeamMemberId
            });
        }

        return {
            refresh: refresh,
            buildClaim: buildClaim,
            invalidate: function () { valid = false; },
            getState: function () { return state; },
            getActor: function () { return state && state.actor; },
            getTeam: function () { return state ? state.team : []; },
            getCurrentUser: function () { return state && state.currentUser; }
        };
    }

    return {
        columnarToRows: columnarToRows,
        decodeJwtPayload: decodeJwtPayload,
        getCurrentGristUser: getCurrentGristUser,
        createGristIdentityRuntime: createGristIdentityRuntime
    };
});
