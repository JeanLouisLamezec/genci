/**
 * Planning Reconciliation - Réconciliation entre plan désiré et entrées existantes
 * 
 * Compare le plan généré avec les entrées existantes et produit
 * les opérations de création, mise à jour et suppression nécessaires.
 */

'use strict';

const { toCentiHours, toHours, validateNumber } = require('./planning-engine.js');

const PRECISION_CENTIHOURS = 1;

/**
 * Vérifie si deux valeurs en centièmes d'heure sont différentes
 * @param {number} a - Première valeur en centièmes d'heure
 * @param {number} b - Deuxième valeur en centièmes d'heure
 * @returns {boolean} true si différentes
 */
function areDifferent(a, b) {
  return a !== b;
}

/**
 * Clé logique pour une entrée : assignmentId + date
 * @param {string|number} assignmentId - ID de l'affectation
 * @param {string} date - Date YYYY-MM-DD
 * @returns {string} Clé composite
 */
function makeEntryKey(assignmentId, date) {
  return `${assignmentId}:${date}`;
}

/**
 * Détecte les doublons dans un tableau
 * @param {Array} items - Items à vérifier
 * @param {Function} keyFn - Fonction pour extraire la clé
 * @returns {{ duplicates: Array, hasDuplicates: boolean }}
 */
function findDuplicatesInArray(items, keyFn) {
  const seen = new Map();
  const duplicates = [];
  
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const key = keyFn(item);
    
    if (seen.has(key)) {
      duplicates.push({
        index: i,
        item,
        key,
        firstIndex: seen.get(key),
        firstItem: items[seen.get(key)]
      });
    } else {
      seen.set(key, i);
    }
  }
  
  return {
    duplicates,
    hasDuplicates: duplicates.length > 0
  };
}

/**
 * Réconcilie les entrées existantes avec le plan désiré.
 * 
 * @param {Array} existingEntries - Entrées existantes avec id, assignmentId, date, plannedHours, actualHours, sheetStatus, description, imputation, feuille, baseCapacityHours, availableCapacityHours, capaciteJour, revisionPlan
 * @param {Array} desiredPlan - Plan désiré avec assignmentId, taskId, memberId, date, plannedHours, baseCapacityHours, availableCapacityHours, capacityRecordId
 * @param {Object} [options] - Options de réconciliation
 * @param {number} [options.precisionHours=0.01] - Précision en heures
 * @param {Map} [options.existingEntriesMap] - Map id -> entrée existante pour revisionPlan
 * @returns {Object} Résultat avec creates, updates, deletes, conflicts
 */
function reconcileDailyEntries(existingEntries, desiredPlan, options = {}) {
  const precisionCentiHours = toCentiHours(options.precisionHours || 0.01);
  const existingEntriesMap = options.existingEntriesMap || new Map();
  
  const creates = [];
  const updates = [];
  const deletes = [];
  const conflicts = [];
  const conflictingKeys = new Set();
  
  const existingByKey = new Map();
  const existingDuplicateCheck = findDuplicatesInArray(
    existingEntries || [], 
    e => makeEntryKey(e.assignmentId, e.date)
  );
  
  if (existingDuplicateCheck.hasDuplicates) {
    for (const dup of existingDuplicateCheck.duplicates) {
      conflicts.push({
        code: "DUPLICATE_EXISTING_ENTRY",
        key: dup.key,
        assignmentId: dup.item.assignmentId,
        date: dup.item.date,
        entryIds: [dup.firstItem.id, dup.item.id],
        message: `Doublon existant : entrées ${dup.firstItem.id} et ${dup.item.id} pour ${dup.key}`
      });
      conflictingKeys.add(dup.key);
    }
  }
  
  for (const entry of existingEntries || []) {
    const key = makeEntryKey(entry.assignmentId, entry.date);
    
    if (existingByKey.has(key)) {
      existingByKey.get(key).push(entry);
    } else {
      existingByKey.set(key, [entry]);
    }
  }
  
  const desiredByKey = new Map();
  const desiredDuplicateCheck = findDuplicatesInArray(
    desiredPlan || [],
    d => makeEntryKey(d.assignmentId, d.date)
  );
  
  if (desiredDuplicateCheck.hasDuplicates) {
    for (const dup of desiredDuplicateCheck.duplicates) {
      conflicts.push({
        code: "DUPLICATE_DESIRED_ENTRY",
        key: dup.key,
        assignmentId: dup.item.assignmentId,
        date: dup.item.date,
        plannedHours: [dup.firstItem.plannedHours, dup.item.plannedHours],
        message: `Doublon dans le plan désiré : ${dup.key} apparaît ${dup.index + 1} fois`
      });
      conflictingKeys.add(dup.key);
    }
  }
  
  for (const item of desiredPlan || []) {
    const key = makeEntryKey(item.assignmentId, item.date);
    
    if (desiredByKey.has(key)) {
      desiredByKey.get(key).push(item);
    } else {
      desiredByKey.set(key, [item]);
    }
  }
  
  const processedKeys = new Set();
  
  for (const entry of existingEntries || []) {
    const key = makeEntryKey(entry.assignmentId, entry.date);
    
    if (processedKeys.has(key)) {
      continue;
    }
    processedKeys.add(key);
    
    if (conflictingKeys.has(key)) {
      continue;
    }
    
    const entriesForKey = existingByKey.get(key) || [];
    const primaryEntry = entriesForKey[0];
    
    const isSubmitted = primaryEntry.sheetStatus === 'submitted';
    const isValidated = primaryEntry.sheetStatus === 'validated';
    const isLocked = isSubmitted || isValidated;
    
    const desiredItems = desiredByKey.get(key);
    
    if (!desiredItems || desiredItems.length === 0) {
      // Aucune entrée désirée pour cette clé
      const plannedCentiHours = toCentiHours(primaryEntry.plannedHours || 0);
      const actualCentiHours = toCentiHours(primaryEntry.actualHours || 0);
      const hasDescription = !!(primaryEntry.description && primaryEntry.description.trim());
      const hasImputation = !!(primaryEntry.imputation && primaryEntry.imputation.trim());
      const hasFeuille = !!(primaryEntry.feuille && primaryEntry.feuille !== null && primaryEntry.feuille !== undefined);
      
      const isEmpty = (
        plannedCentiHours === 0 &&
        actualCentiHours === 0 &&
        !hasDescription &&
        !hasImputation &&
        !hasFeuille
      );
      
      // Une ligne verrouillée (soumise ou validée) absente de desiredPlan est simplement conservée
      // sans action ni conflit
      if (isLocked) {
        // Ne rien faire - la ligne est préservée telle quelle
        continue;
      }
      
      if (isEmpty) {
        deletes.push({
          id: primaryEntry.id,
          reason: "ENTRY_EMPTY_AND_MUTABLE"
        });
      } else if (plannedCentiHours !== 0) {
        // Ligne mutable avec du prévu mais absente de desiredPlan
        updates.push({
          id: primaryEntry.id,
          fields: {
            plannedHours: 0
          },
          reason: "PLANNED_HOURS_ZEROED"
        });
      }
      
      continue;
    }
    
    const desiredItem = desiredItems[0];
    const existingPlannedCentiHours = toCentiHours(primaryEntry.plannedHours || 0);
    const desiredPlannedCentiHours = toCentiHours(desiredItem.plannedHours || 0);
    const existingBaseCapCentiHours = toCentiHours(primaryEntry.baseCapacityHours || 0);
    const desiredBaseCapCentiHours = toCentiHours(desiredItem.baseCapacityHours || 0);
    const existingAvailCapCentiHours = toCentiHours(primaryEntry.availableCapacityHours || 0);
    const desiredAvailCapCentiHours = toCentiHours(desiredItem.availableCapacityHours || 0);
    const existingCapacityRecordId = primaryEntry.capaciteJour || null;
    const desiredCapacityRecordId = desiredItem.capacityRecordId !== undefined ? desiredItem.capacityRecordId : null;
    
    const fieldsToUpdate = {};
    
    if (areDifferent(existingPlannedCentiHours, desiredPlannedCentiHours)) {
      fieldsToUpdate.plannedHours = desiredItem.plannedHours;
    }
    
    if (areDifferent(existingBaseCapCentiHours, desiredBaseCapCentiHours)) {
      fieldsToUpdate.baseCapacityHours = desiredItem.baseCapacityHours;
    }
    
    if (areDifferent(existingAvailCapCentiHours, desiredAvailCapCentiHours)) {
      fieldsToUpdate.availableCapacityHours = desiredItem.availableCapacityHours;
    }
    
    // Correction 3 : Ne jamais effacer automatiquement une référence existante
    // lorsque le desired capacityRecordId est nul (capacité simulée sans ID)
    if (desiredCapacityRecordId !== null && desiredCapacityRecordId !== undefined) {
      if (areDifferent(existingCapacityRecordId, desiredCapacityRecordId)) {
        fieldsToUpdate.capacityRecordId = desiredCapacityRecordId;
      }
    }
    
    if (Object.keys(fieldsToUpdate).length > 0) {
      if (!isLocked) {
        // Incrémenter revisionPlan si un champ de planification change
        const existingRevision = Number(primaryEntry.revisionPlan || 0);
        fieldsToUpdate.revisionPlan = existingRevision + 1;
        
        updates.push({
          id: primaryEntry.id,
          fields: fieldsToUpdate,
          reason: "FIELDS_UPDATED"
        });
      } else {
        conflicts.push({
          code: "LOCKED_ENTRY_MISMATCH",
          key,
          date: primaryEntry.date,
          entryId: primaryEntry.id,
          sheetStatus: primaryEntry.sheetStatus,
          existingPlannedHours: primaryEntry.plannedHours,
          desiredPlannedHours: desiredItem.plannedHours,
          message: `Entrée ${primaryEntry.sheetStatus} : écart entre prévu existant (${primaryEntry.plannedHours}h) et désiré (${desiredItem.plannedHours}h)`
        });
      }
    }
  }
  
  for (const item of desiredPlan || []) {
    const key = makeEntryKey(item.assignmentId, item.date);
    
    if (conflictingKeys.has(key)) {
      continue;
    }
    
    const entriesForKey = existingByKey.get(key);
    
    if (!entriesForKey || entriesForKey.length === 0) {
      creates.push({
        assignmentId: item.assignmentId,
        taskId: item.taskId,
        memberId: item.memberId,
        date: item.date,
        plannedHours: item.plannedHours,
        baseCapacityHours: item.baseCapacityHours,
        availableCapacityHours: item.availableCapacityHours,
        capacityRecordId: item.capacityRecordId !== undefined ? item.capacityRecordId : null,
        revisionPlan: 1,
        reason: "NEW_PLAN_ENTRY"
      });
    }
  }
  
  return {
    creates,
    updates,
    deletes,
    conflicts
  };
}

module.exports = {
  reconcileDailyEntries,
  areDifferent,
  makeEntryKey,
  findDuplicatesInArray
};
