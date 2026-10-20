/* ============================================================================
 * CRA Sheet Creation Contract — forme sûre d'une feuille brouillon
 * ----------------------------------------------------------------------------
 * Contrat CommonJS chargé par le service et le bundle CRA. Le garde injecté
 * dans cra.html le consomme via window.TaskFlowCra.weeklySheet, exposé par ce
 * bundle avant l'initialisation des permissions.
 * ========================================================================== */

'use strict';

const DRAFT_SHEET_CREATION_REQUIRED_FIELDS = Object.freeze([
    'membre',
    'semaine',
    'statut',
    'revisionValidation'
  ]);
const DRAFT_SHEET_CREATION_SYSTEM_FIELDS = Object.freeze(['createdAt']);
const DRAFT_SHEET_CREATION_ALLOWED_FIELDS = Object.freeze([
    ...DRAFT_SHEET_CREATION_REQUIRED_FIELDS,
    ...DRAFT_SHEET_CREATION_SYSTEM_FIELDS
  ]);

function isValidCreatedAt(value) {
    return typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0;
  }

/**
 * Vérifie uniquement la forme sûre du payload. Les droits sur le membre et
 * les transitions sont ensuite contrôlés par taskflow-permissions.
 */
function isValidDraftSheetCreationPayload(fields) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return false;

    const keys = Object.keys(fields);
    if (!DRAFT_SHEET_CREATION_REQUIRED_FIELDS.every(field =>
      Object.prototype.hasOwnProperty.call(fields, field)
    )) return false;
    if (!keys.every(field => DRAFT_SHEET_CREATION_ALLOWED_FIELDS.includes(field))) return false;

    return !Object.prototype.hasOwnProperty.call(fields, 'createdAt') ||
      isValidCreatedAt(fields.createdAt);
  }

function buildDraftSheetCreationPayload(creationFields, metadata = {}) {
    const fields = Object.assign({}, creationFields || {});
    if (Object.prototype.hasOwnProperty.call(metadata, 'createdAt')) {
      fields.createdAt = metadata.createdAt;
    }
    if (!isValidDraftSheetCreationPayload(fields)) {
      throw new Error('INVALID_DRAFT_SHEET_CREATION_PAYLOAD');
    }
    return fields;
  }

module.exports = {
  DRAFT_SHEET_CREATION_REQUIRED_FIELDS,
  DRAFT_SHEET_CREATION_SYSTEM_FIELDS,
  DRAFT_SHEET_CREATION_ALLOWED_FIELDS,
  isValidDraftSheetCreationPayload,
  buildDraftSheetCreationPayload
};
