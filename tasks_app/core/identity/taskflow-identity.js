/* ============================================================================
 * taskflow-identity.js — Domaine d'identité commun TaskFlow
 * ----------------------------------------------------------------------------
 * Module pur : aucune dépendance au DOM, à Grist ou aux widgets.
 * ========================================================================== */
(function (root, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.TaskFlowIdentity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var IDENTITY_STATUS = Object.freeze({
        IDENTIFIED: 'IDENTIFIED',
        ASSOCIATION_CONFIRMATION_REQUIRED: 'ASSOCIATION_CONFIRMATION_REQUIRED',
        ASSOCIATION_UNAVAILABLE: 'ASSOCIATION_UNAVAILABLE',
        MEMBER_INACTIVE: 'MEMBER_INACTIVE',
        GRIST_USER_ID_DUPLICATED: 'GRIST_USER_ID_DUPLICATED',
        EMAIL_DUPLICATED: 'EMAIL_DUPLICATED',
        INVALID_CURRENT_USER: 'INVALID_CURRENT_USER',
        IDENTITY_DATA_UNAVAILABLE: 'IDENTITY_DATA_UNAVAILABLE'
    });

    function normalizePositiveId(value) {
        if (value === null || value === undefined || value === '' || value === 0 || value === '0') {
            return null;
        }
        if (typeof value === 'string' && !/^[1-9]\d*$/.test(value.trim())) return null;
        var numeric = Number(value);
        return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
    }

    function normalizeEmail(value) {
        return value === null || value === undefined
            ? ''
            : String(value).trim().toLowerCase();
    }

    function isTruthy(value) {
        return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
    }

    function isActive(member) {
        return !(member && (member.actif === false || member.actif === 0 || member.actif === '0'));
    }

    function isUnassociated(value) {
        return normalizePositiveId(value) === null;
    }

    function duplicateValues(rows, selector) {
        var counts = new Map();
        (rows || []).forEach(function (row) {
            var value = selector(row);
            if (value !== null && value !== '') counts.set(value, (counts.get(value) || 0) + 1);
        });
        return Array.from(counts.entries())
            .filter(function (entry) { return entry[1] > 1; })
            .map(function (entry) { return entry[0]; });
    }

    function findDuplicateGristUserIds(team) {
        return duplicateValues(team, function (member) {
            return normalizePositiveId(member && member.gristUserId);
        });
    }

    function findDuplicateEmails(team) {
        return duplicateValues(team, function (member) {
            return normalizeEmail(member && member.email);
        });
    }

    function baseIdentity(currentGristUserId, currentEmail) {
        return {
            identified: false,
            status: null,
            gristUserId: normalizePositiveId(currentGristUserId),
            email: normalizeEmail(currentEmail),
            memberId: null,
            currentUserMemberId: null,
            member: null,
            isAdmin: false,
            associationCandidate: null,
            conflictCodes: [],
            duplicateUserIds: [],
            duplicateEmails: []
        };
    }

    function resolveActorIdentity(options) {
        options = options || {};
        var team = Array.isArray(options.team) ? options.team : [];
        var result = baseIdentity(options.currentGristUserId, options.currentEmail);

        if (result.gristUserId === null) {
            result.status = IDENTITY_STATUS.INVALID_CURRENT_USER;
            result.conflictCodes.push('INVALID_CURRENT_USER_ID');
            return result;
        }

        result.duplicateUserIds = findDuplicateGristUserIds(team);
        if (result.duplicateUserIds.length > 0) {
            result.status = IDENTITY_STATUS.GRIST_USER_ID_DUPLICATED;
            result.conflictCodes.push('GRIST_USER_ID_DUPLICATED');
            return result;
        }

        var idMatches = team.filter(function (member) {
            return normalizePositiveId(member && member.gristUserId) === result.gristUserId;
        });
        if (idMatches.length === 1) {
            var associatedMember = idMatches[0];
            result.memberId = normalizePositiveId(associatedMember.id);
            result.currentUserMemberId = result.memberId;
            result.member = associatedMember;
            if (!isActive(associatedMember)) {
                result.status = IDENTITY_STATUS.MEMBER_INACTIVE;
                result.conflictCodes.push('MEMBER_INACTIVE');
                return result;
            }
            result.identified = true;
            result.status = IDENTITY_STATUS.IDENTIFIED;
            result.isAdmin = isTruthy(associatedMember.estAdmin);
            return result;
        }

        if (!result.email) {
            result.status = IDENTITY_STATUS.ASSOCIATION_UNAVAILABLE;
            result.conflictCodes.push('CURRENT_EMAIL_MISSING');
            return result;
        }

        var emailMatches = team.filter(function (member) {
            return normalizeEmail(member && member.email) === result.email;
        });
        if (emailMatches.length > 1) {
            result.status = IDENTITY_STATUS.EMAIL_DUPLICATED;
            result.duplicateEmails = [result.email];
            result.conflictCodes.push('CURRENT_EMAIL_DUPLICATED');
            return result;
        }
        if (emailMatches.length === 0) {
            result.status = IDENTITY_STATUS.ASSOCIATION_UNAVAILABLE;
            result.conflictCodes.push('TEAM_EMAIL_NOT_FOUND');
            return result;
        }

        var candidate = emailMatches[0];
        if (!isActive(candidate)) {
            result.status = IDENTITY_STATUS.MEMBER_INACTIVE;
            result.member = candidate;
            result.memberId = normalizePositiveId(candidate.id);
            result.currentUserMemberId = result.memberId;
            result.conflictCodes.push('MEMBER_INACTIVE');
            return result;
        }
        if (!isUnassociated(candidate.gristUserId)) {
            result.status = IDENTITY_STATUS.ASSOCIATION_UNAVAILABLE;
            result.conflictCodes.push('TEAM_MEMBER_ALREADY_ASSOCIATED');
            return result;
        }

        result.status = IDENTITY_STATUS.ASSOCIATION_CONFIRMATION_REQUIRED;
        result.associationCandidate = {
            id: normalizePositiveId(candidate.id),
            nom: candidate.nom || '',
            email: normalizeEmail(candidate.email)
        };
        return result;
    }

    function buildIdentityClaim(options) {
        options = options || {};
        var identity = resolveActorIdentity(options);
        var result = {
            allowed: false,
            idempotent: false,
            status: identity.status,
            code: identity.status,
            reason: null,
            teamMemberId: null,
            gristUserId: identity.gristUserId,
            action: null,
            identity: identity
        };

        if (identity.status === IDENTITY_STATUS.IDENTIFIED) {
            var alreadyExpectedMemberId = normalizePositiveId(options.expectedTeamMemberId);
            if (alreadyExpectedMemberId !== null && alreadyExpectedMemberId !== identity.memberId) {
                result.code = 'ACTOR_ALREADY_ASSOCIATED';
                result.reason = 'Ce compte Grist est déjà associé à un autre profil Team';
                return result;
            }
            result.allowed = true;
            result.idempotent = true;
            result.code = 'ALREADY_APPLIED';
            result.teamMemberId = identity.memberId;
            return result;
        }
        if (identity.status !== IDENTITY_STATUS.ASSOCIATION_CONFIRMATION_REQUIRED) {
            result.reason = 'Association impossible tant que le profil Team ou son email ne sont pas corrigés';
            return result;
        }

        var expectedMemberId = normalizePositiveId(options.expectedTeamMemberId);
        var candidateId = identity.associationCandidate.id;
        if (expectedMemberId !== null && expectedMemberId !== candidateId) {
            result.code = 'ASSOCIATION_CANDIDATE_CHANGED';
            result.reason = 'Le profil Team proposé ne correspond plus au profil confirmé';
            return result;
        }

        result.allowed = true;
        result.code = 'ASSOCIATION_ALLOWED';
        result.teamMemberId = candidateId;
        result.action = ['UpdateRecord', 'Team', candidateId, { gristUserId: identity.gristUserId }];
        return result;
    }

    return {
        IDENTITY_STATUS: IDENTITY_STATUS,
        normalizePositiveId: normalizePositiveId,
        normalizeGristUserId: normalizePositiveId,
        normalizeEmail: normalizeEmail,
        isTruthy: isTruthy,
        isActive: isActive,
        isUnassociated: isUnassociated,
        findDuplicateGristUserIds: findDuplicateGristUserIds,
        findDuplicateEmails: findDuplicateEmails,
        resolveActorIdentity: resolveActorIdentity,
        buildIdentityClaim: buildIdentityClaim
    };
});
