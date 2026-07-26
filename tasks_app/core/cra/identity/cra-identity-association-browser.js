/**
 * CRA Identity Association - Browser Bundle
 * 
 * Expose le module d'identité dans globalThis pour utilisation dans le navigateur.
 * Ce fichier doit être chargé APRÈS cra-identity-association.js et AVANT cra-data-loader.js.
 */

(function(global) {
  'use strict';
  
  // Charger le module CommonJS
  if (typeof module !== 'undefined' && module.exports && require) {
    try {
      const identityModule = require('./cra-identity-association.js');
      global.CraIdentityAssociation = identityModule;
      console.info('[CRA identity] Module chargé');
    } catch (e) {
      console.error('[CRA identity] Échec chargement module', e);
    }
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
