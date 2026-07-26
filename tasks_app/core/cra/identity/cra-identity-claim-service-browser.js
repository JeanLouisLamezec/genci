/**
 * CRA Identity Claim Service - Browser Bundle
 * 
 * Expose le service d'association dans globalThis pour utilisation dans le navigateur.
 */

(function(global) {
  'use strict';
  
  // Charger le module CommonJS
  if (typeof module !== 'undefined' && module.exports && require) {
    try {
      const claimService = require('./cra-identity-claim-service.js');
      global.CraIdentityClaimService = claimService;
      console.info('[CRA identity claim] Service chargé');
    } catch (e) {
      console.error('[CRA identity claim] Échec chargement service', e);
    }
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
