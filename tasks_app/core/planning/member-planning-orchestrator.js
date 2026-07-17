/**
 * Member Planning Orchestrator - Orchestration de la planification par membre
 * 
 * Gère le partage de capacité entre toutes les affectations d'un même membre.
 * Contrairement au planning-engine.js qui traite une affectation isolément,
 * cet orchestrateur maintient un registre de capacité quotidien partagé.
 */

(function (global) {
  'use strict';
  
  // Import des dépendances
  var PlanningEngine = global.PlanningEngine || require('./planning-engine.js');
  var PlanningReconciliation = global.PlanningReconciliation || require('./planning-reconciliation.js');
  
  var toCentiHours = PlanningEngine.toCentiHours;
  var toHours = PlanningEngine.toHours;
  var formatDateUTC = PlanningEngine.formatDateUTC;
  var parseDateUTC = PlanningEngine.parseDateUTC;
  var addDaysUTC = PlanningEngine.addDaysUTC;
  var generateDateRange = PlanningEngine.generateDateRange;
  var reconcileDailyEntries = PlanningReconciliation.reconcileDailyEntries;
  
  // ===========================================================================
  // Helpers de date
  // ===========================================================================
  
  /**
   * Convertit un timestamp Grist (secondes) en date YYYY-MM-DD
   */
  function gristTimestampToDate(timestamp) {
    if (!timestamp) return null;
    var date = new Date(timestamp * 1000);
    return formatDateUTC(date);
  }
  
  /**
   * Convertit une date YYYY-MM-DD en timestamp Grist
   */
  function dateToGristTimestamp(dateStr) {
    if (!dateStr) return null;
    var date = parseDateUTC(dateStr);
    if (!date) return null;
    return Math.floor(date.getTime() / 1000);
  }
  
  /**
   * Trie les affectations dans un ordre déterministe
   */
  function sortAssignments(assignments) {
    return assignments.slice().sort(function(a, b) {
      // Date de fin croissante
      if (a.dateFin !== b.dateFin) {
        return (a.dateFin || 0) - (b.dateFin || 0);
      }
      // Date de début croissante
      if (a.dateDebut !== b.dateDebut) {
        return (a.dateDebut || 0) - (b.dateDebut || 0);
      }
      // Tâche croissante
      if (a.tache !== b.tache) {
        return (a.tache || 0) - (b.tache || 0);
      }
      // ID croissant
      return (a.id || 0) - (b.id || 0);
    });
  }
  
  // ===========================================================================
  // Registre de capacité quotidien
  // ===========================================================================
  
  /**
   * Crée un registre de capacité pour un membre
   * @param {Object} params - Paramètres
   * @returns {Object} Registre de capacité
   */
  function createCapacityRegistry(params) {
    var memberId = params.memberId;
    var capacities = params.capacities || []; // MemberDailyCapacities
    var protectedEntries = params.protectedEntries || []; // TimeEntries verrouillées
    var dateFrom = params.dateFrom;
    var dateTo = params.dateTo;
    
    // Initialiser le registre par date
    var registry = {};
    var dates = generateDateRange(dateFrom, dateTo);
    
    // Indexer les capacités par date
    var capacityByDate = {};
    capacities.forEach(function(cap) {
      var dateKey = cap.date;
      if (!capacityByDate[dateKey]) {
        capacityByDate[dateKey] = [];
      }
      capacityByDate[dateKey].push(cap);
    });
    
    // Initialiser chaque date
    dates.forEach(function(date) {
      var capsForDate = capacityByDate[date] || [];
      
      // Capacité de base (somme de toutes les capacités du jour)
      var baseCapacity = 0;
      capsForDate.forEach(function(cap) {
        baseCapacity += (cap.capaciteDisponible || 0);
      });
      
      // Heures protégées (entrées verrouillées)
      var protectedHours = 0;
      protectedEntries.forEach(function(entry) {
        if (entry.date === date) {
          protectedHours += (entry.heures || 0);
        }
      });
      
      registry[date] = {
        memberId: memberId,
        date: date,
        baseCapacityHours: baseCapacity,
        availableCapacityHours: baseCapacity,
        protectedHours: protectedHours,
        remainingCapacityHours: baseCapacity - protectedHours,
        plannedHours: 0 // Sera incrémenté par les affectations
      };
    });
    
    return {
      registry: registry,
      dates: dates,
      
      /**
       * Réserve des heures pour une affectation
       */
      reserveHours: function(date, hours) {
        if (!registry[date]) return false;
        
        var remaining = registry[date].remainingCapacityHours;
        if (remaining < hours) {
          return false; // Capacité insuffisante
        }
        
        registry[date].plannedHours += hours;
        registry[date].remainingCapacityHours -= hours;
        registry[date].availableCapacityHours -= hours;
        return true;
      },
      
      /**
       * Obtient la capacité restante pour une date
       */
      getRemainingCapacity: function(date) {
        if (!registry[date]) return 0;
        return registry[date].remainingCapacityHours;
      },
      
      /**
       * Obtient le registre complet
       */
      getRegistry: function() {
        return registry;
      },
      
      /**
       * Vérifie la postcondition : protégé + prévu <= disponible
       */
      verifyPostcondition: function(tolerance) {
        tolerance = tolerance || 0.01;
        var violations = [];
        
        dates.forEach(function(date) {
          var entry = registry[date];
          var total = entry.protectedHours + entry.plannedHours;
          
          if (total > entry.availableCapacityHours + tolerance) {
            violations.push({
              date: date,
              protected: entry.protectedHours,
              planned: entry.plannedHours,
              available: entry.availableCapacityHours,
              excess: total - entry.availableCapacityHours
            });
          }
        });
        
        return {
          valid: violations.length === 0,
          violations: violations
        };
      }
    };
  }
  
  // ===========================================================================
  // Orchestrateur principal
  // ===========================================================================
  
  /**
   * Crée un orchestrateur de planification par membre
   * @param {Object} grist - Grist API
   * @param {Object} options - Options
   * @returns {Object} API de l'orchestrateur
   */
  function createMemberPlanningOrchestrator(grist, options) {
    options = options || {};
    var logEnabled = options.logEnabled || false;
    
    function log(message) {
      if (logEnabled && console) {
        console.log('[MemberPlanningOrchestrator]', message);
      }
    }
    
    /**
     * Charge toutes les données nécessaires pour un membre
     */
    async function loadMemberData(memberId) {
      var tables = await Promise.all([
        grist.docApi.fetchTable('Team'),
        grist.docApi.fetchTable('TaskAssignments'),
        grist.docApi.fetchTable('Tasks'),
        grist.docApi.fetchTable('TimeEntries'),
        grist.docApi.fetchTable('Feuilles'),
        grist.docApi.fetchTable('Disponibilites'),
        grist.docApi.fetchTable('MemberDailyCapacities')
      ]);
      
      var teamTable = tables[0];
      var assignmentsTable = tables[1];
      var tasksTable = tables[2];
      var timeEntriesTable = tables[3];
      var feuillesTable = tables[4];
      var disponibilitesTable = tables[5];
      var capacitiesTable = tables[6];
      
      // Trouver le membre
      var memberIndex = -1;
      if (teamTable.id) {
        for (var i = 0; i < teamTable.id.length; i++) {
          if (teamTable.id[i] === memberId) {
            memberIndex = i;
            break;
          }
        }
      }
      
      if (memberIndex < 0) {
        throw new Error('Membre ' + memberId + ' non trouvé');
      }
      
      var member = {
        id: teamTable.id[memberIndex],
        nom: teamTable.nom ? teamTable.nom[memberIndex] : '',
        capaciteHebdo: teamTable.capaciteHebdo ? teamTable.capaciteHebdo[memberIndex] : 35
      };
      
      // Charger les affectations actives du membre
      var assignments = [];
      if (assignmentsTable.id) {
        for (var j = 0; j < assignmentsTable.id.length; j++) {
          if (assignmentsTable.membre[j] === memberId && assignmentsTable.actif[j] !== false) {
            assignments.push({
              id: assignmentsTable.id[j],
              tache: assignmentsTable.tache[j],
              membre: assignmentsTable.membre[j],
              heuresAllouees: assignmentsTable.heuresAllouees[j] || 0,
              dateDebut: assignmentsTable.dateDebut[j],
              dateFin: assignmentsTable.dateFin[j],
              modeRepartition: assignmentsTable.modeRepartition[j] || 'uniforme'
            });
          }
        }
      }
      
      // Trier les affectations
      assignments = sortAssignments(assignments);
      
      // Charger les tâches liées
      var tasks = {};
      if (tasksTable.id) {
        for (var k = 0; k < tasksTable.id.length; k++) {
          tasks[tasksTable.id[k]] = {
            id: tasksTable.id[k],
            titre: tasksTable.titre[k],
            dateDebut: tasksTable.dateDebut[k],
            dateEcheance: tasksTable.dateEcheance[k]
          };
        }
      }
      
      // Charger les TimeEntries du membre
      var timeEntries = [];
      if (timeEntriesTable.id) {
        for (var l = 0; l < timeEntriesTable.id.length; l++) {
          if (timeEntriesTable.membre[l] === memberId) {
            timeEntries.push({
              id: timeEntriesTable.id[l],
              tache: timeEntriesTable.tache[l],
              membre: timeEntriesTable.membre[l],
              date: timeEntriesTable.date[l],
              heures: timeEntriesTable.heures[l] || 0,
              feuille: timeEntriesTable.feuille[l],
              sheetStatus: timeEntriesTable.sheetStatus[l],
              plannedHours: timeEntriesTable.heuresPrevues ? timeEntriesTable.heuresPrevues[l] : 0
            });
          }
        }
      }
      
      // Charger les capacités du membre
      var capacities = [];
      if (capacitiesTable.id) {
        for (var m = 0; m < capacitiesTable.id.length; m++) {
          if (capacitiesTable.membre[m] === memberId) {
            capacities.push({
              id: capacitiesTable.id[m],
              membre: capacitiesTable.membre[m],
              date: capacitiesTable.date[m],
              capaciteDisponible: capacitiesTable.capaciteDisponible[m] || 0
            });
          }
        }
      }
      
      // Charger les indisponibilités
      var disponibilites = [];
      if (disponibilitesTable.id) {
        for (var n = 0; n < disponibilitesTable.id.length; n++) {
          if (disponibilitesTable.membre[n] === memberId) {
            disponibilites.push({
              id: disponibilitesTable.id[n],
              membre: disponibilitesTable.membre[n],
              type: disponibilitesTable.type[n],
              dateDebut: disponibilitesTable.dateDebut[n],
              dateFin: disponibilitesTable.dateFin[n],
              dispo: disponibilitesTable.dispo[n]
            });
          }
        }
      }
      
      // Charger les feuilles
      var feuilles = [];
      if (feuillesTable.id) {
        for (var p = 0; p < feuillesTable.id.length; p++) {
          feuilles.push({
            id: feuillesTable.id[p],
            membre: feuillesTable.membre[p],
            semaine: feuillesTable.semaine[p],
            statut: feuillesTable.statut[p]
          });
        }
      }
      
      return {
        member: member,
        assignments: assignments,
        tasks: tasks,
        timeEntries: timeEntries,
        capacities: capacities,
        disponibilites: disponibilites,
        feuilles: feuilles
      };
    }
    
    /**
     * Calcule la période globale couvrant toutes les affectations
     */
    function calculateGlobalPeriod(assignments, timeEntries) {
      if (!assignments || assignments.length === 0) {
        return null;
      }
      
      var minDate = null;
      var maxDate = null;
      
      // Période des affectations
      assignments.forEach(function(a) {
        if (a.dateDebut) {
          var start = gristTimestampToDate(a.dateDebut);
          if (!minDate || start < minDate) minDate = start;
        }
        if (a.dateFin) {
          var end = gristTimestampToDate(a.dateFin);
          if (!maxDate || end > maxDate) maxDate = end;
        }
      });
      
      // Inclure les TimeEntries protégées
      timeEntries.forEach(function(e) {
        if (e.date) {
          var date = gristTimestampToDate(e.date);
          if (!minDate || date < minDate) minDate = date;
          if (!maxDate || date > maxDate) maxDate = date;
        }
      });
      
      if (!minDate || !maxDate) {
        return null;
      }
      
      return {
        dateFrom: minDate,
        dateTo: maxDate
      };
    }
    
    /**
     * Identifie les entrées protégées (verrouillées)
     */
    function identifyProtectedEntries(timeEntries, options) {
      options = options || {};
      var replanFromDate = options.replanFromDate;
      
      return timeEntries.filter(function(entry) {
        // Feuille soumise ou validée
        if (entry.sheetStatus === 'submitted' || entry.sheetStatus === 'validated') {
          return true;
        }
        
        // Feuille renseignée
        if (entry.feuille && entry.feuille !== null) {
          return true;
        }
        
        // Heures réalisées > 0
        if (entry.heures > 0) {
          return true;
        }
        
        // Avant replanFromDate
        if (replanFromDate && entry.date) {
          var entryDate = gristTimestampToDate(entry.date);
          if (entryDate < replanFromDate) {
            return true;
          }
        }
        
        return false;
      });
    }
    
    /**
     * Preview de la planification pour un membre
     */
    async function previewMember(memberId, options) {
      options = options || {};
      
      try {
        log('Preview planification membre ' + memberId);
        
        // 1. Charger les données
        var data = await loadMemberData(memberId);
        
        if (data.assignments.length === 0) {
          log('Aucune affectation pour le membre ' + memberId);
          return {
            success: true,
            memberId: memberId,
            assignmentResults: [],
            capacities: [],
            timeEntries: {
              creates: [],
              updates: [],
              deletes: [],
              unchanged: [],
              locked: [],
              conflicts: []
            },
            diagnostics: [],
            totals: {
              totalAllocated: 0,
              totalPlanned: 0,
              unplannedHours: 0
            },
            canCommit: false,
            code: 'NO_ASSIGNMENTS'
          };
        }
        
        // 2. Calculer la période globale
        var period = calculateGlobalPeriod(data.assignments, data.timeEntries);
        
        if (!period) {
          return {
            success: false,
            code: 'INVALID_PERIOD'
          };
        }
        
        log('Période globale: ' + period.dateFrom + ' → ' + period.dateTo);
        
        // 3. Identifier les entrées protégées
        var protectedEntries = identifyProtectedEntries(data.timeEntries, {
          replanFromDate: options.replanFromDate
        });
        
        // 4. Créer le registre de capacité
        var registry = createCapacityRegistry({
          memberId: memberId,
          capacities: data.capacities,
          protectedEntries: protectedEntries,
          dateFrom: period.dateFrom,
          dateTo: period.dateTo
        });
        
        log('Registre créé: ' + registry.dates.length + ' jours');
        
        // 5. Traiter chaque affectation dans l'ordre
        var assignmentResults = [];
        var allDiagnostics = [];
        var totalUnplanned = 0;
        
        for (var i = 0; i < data.assignments.length; i++) {
          var assignment = data.assignments[i];
          var task = data.tasks[assignment.tache];
          
          if (!task) {
            log('Tâche ' + assignment.tache + ' non trouvée, ignorée');
            continue;
          }
          
          log('Traitement affectation ' + assignment.id + ' (tâche ' + assignment.tache + ')');
          
          // Obtenir la capacité restante du registre
          var remainingCapacities = {};
          registry.dates.forEach(function(date) {
            remainingCapacities[date] = registry.getRemainingCapacity(date);
          });
          
          // Appeler le moteur de planification avec la capacité restante
          // Note: ceci est un appel simplifié - dans une implémentation complète,
          // il faudrait adapter le planning-engine pour accepter un objet de capacités
          var planningResult = await PlanningEngine.planAssignment({
            assignment: assignment,
            task: task,
            capacities: remainingCapacities,
            existingEntries: data.timeEntries.filter(function(e) {
              return e.tache === assignment.tache && e.membre === memberId;
            }),
            options: options
          });
          
          if (!planningResult.success) {
            assignmentResults.push({
              assignmentId: assignment.id,
              success: false,
              error: planningResult.error
            });
            continue;
          }
          
          // Réserver les heures dans le registre
          var plannedEntries = planningResult.plannedEntries || [];
          plannedEntries.forEach(function(entry) {
            registry.reserveHours(entry.date, entry.plannedHours);
          });
          
          assignmentResults.push({
            assignmentId: assignment.id,
            success: true,
            plannedEntries: plannedEntries,
            diagnostics: planningResult.diagnostics || []
          });
          
          allDiagnostics = allDiagnostics.concat(planningResult.diagnostics || []);
          totalUnplanned += (planningResult.unplannedHours || 0);
        }
        
        // 6. Vérifier la postcondition
        var postconditionCheck = registry.verifyPostcondition();
        
        if (!postconditionCheck.valid) {
          log('Violation postcondition: ' + JSON.stringify(postconditionCheck.violations));
          return {
            success: false,
            code: 'CAPACITY_OVERCOMMITMENT',
            violations: postconditionCheck.violations
          };
        }
        
        // 7. Réconciliation globale
        var allDesiredEntries = [];
        assignmentResults.forEach(function(result) {
          if (result.plannedEntries) {
            result.plannedEntries.forEach(function(entry) {
              allDesiredEntries.push({
                assignmentId: result.assignmentId,
                taskId: data.assignments.find(function(a) { return a.id === result.assignmentId; }).tache,
                memberId: memberId,
                date: entry.date,
                plannedHours: entry.plannedHours
              });
            });
          }
        });
        
        var reconciliation = reconcileDailyEntries(data.timeEntries, allDesiredEntries, {
          precisionHours: 0.01
        });
        
        // 8. Calculer les totaux
        var totalAllocated = 0;
        data.assignments.forEach(function(a) {
          totalAllocated += (a.heuresAllouees || 0);
        });
        
        var totalPlanned = 0;
        Object.keys(registry.getRegistry()).forEach(function(date) {
          totalPlanned += registry.getRegistry()[date].plannedHours;
        });
        
        // 9. Générer le fingerprint
        var fingerprint = generateFingerprint(data, registry);
        
        log('Preview terminé: ' + totalPlanned + 'h planifiées sur ' + totalAllocated + 'h allouées');
        
        return {
          success: true,
          memberId: memberId,
          assignmentResults: assignmentResults,
          capacities: Object.keys(registry.getRegistry()).map(function(date) {
            return registry.getRegistry()[date];
          }),
          timeEntries: reconciliation,
          diagnostics: allDiagnostics,
          totals: {
            totalAllocated: totalAllocated,
            totalPlanned: totalPlanned,
            unplannedHours: totalUnplanned
          },
          fingerprint: fingerprint,
          canCommit: totalUnplanned === 0 || options.allowPartialPlanning === true,
          code: totalUnplanned > 0 ? 'INSUFFICIENT_SHARED_CAPACITY' : 'SUCCESS'
        };
        
      } catch (e) {
        log('Erreur preview: ' + e.message);
        return {
          success: false,
          code: 'PREVIEW_ERROR',
          message: e.message
        };
      }
    }
    
    /**
     * Génère un fingerprint pour détecter les changements
     */
    function generateFingerprint(data, registry) {
      var parts = [
        data.member.capaciteHebdo,
        data.assignments.length,
        data.timeEntries.length,
        data.capacities.length
      ];
      
      // Hash simple
      return parts.join('|');
    }
    
    /**
     * Commit de la planification pour un membre
     */
    async function commitMember(memberId, preview, options) {
      options = options || {};
      
      try {
        log('Commit planification membre ' + memberId);
        
        // 1. Vérifier le preview
        if (!preview || !preview.success) {
          return {
            success: false,
            code: 'INVALID_PREVIEW'
          };
        }
        
        // 2. Vérifier le fingerprint (optionnel, à implémenter)
        // var currentData = await loadMemberData(memberId);
        // var currentFingerprint = generateFingerprint(currentData);
        // if (currentFingerprint !== preview.fingerprint) {
        //   return { success: false, code: 'STALE_PREVIEW' };
        // }
        
        // 3. Appliquer les actions
        var actions = [];
        
        // Capacités d'abord
        if (preview.capacities && preview.capacities.length > 0) {
          // ... actions AddRecord/UpdateRecord MemberDailyCapacities
        }
        
        // TimeEntries
        var timeEntries = preview.timeEntries;
        
        if (timeEntries.creates) {
          timeEntries.creates.forEach(function(create) {
            actions.push(['AddRecord', 'TimeEntries', null, create]);
          });
        }
        
        if (timeEntries.updates) {
          timeEntries.updates.forEach(function(update) {
            actions.push(['UpdateRecord', 'TimeEntries', update.id, update]);
          });
        }
        
        if (timeEntries.deletes) {
          timeEntries.deletes.forEach(function(del) {
            actions.push(['RemoveRecord', 'TimeEntries', del.id]);
          });
        }
        
        if (actions.length === 0) {
          log('Aucune action à appliquer');
          return {
            success: true,
            actionsExecuted: 0
          };
        }
        
        // 4. Exécuter les actions
        var result = await grist.docApi.applyUserActions(actions);
        
        log('Commit terminé: ' + actions.length + ' actions');
        
        return {
          success: true,
          actionsExecuted: actions.length,
          result: result
        };
        
      } catch (e) {
        log('Erreur commit: ' + e.message);
        return {
          success: false,
          code: 'COMMIT_ERROR',
          message: e.message
        };
      }
    }
    
    /**
     * Replanifie plusieurs membres
     */
    async function replanMembers(memberIds, options) {
      options = options || {};
      
      log('Replanification de ' + memberIds.length + ' membres');
      
      var results = [];
      
      for (var i = 0; i < memberIds.length; i++) {
        var memberId = memberIds[i];
        
        var preview = await previewMember(memberId, options);
        
        if (!preview.success || !preview.canCommit) {
          results.push({
            memberId: memberId,
            success: false,
            code: preview.code
          });
          continue;
        }
        
        var commitResult = await commitMember(memberId, preview, options);
        
        results.push({
          memberId: memberId,
          success: commitResult.success,
          actionsExecuted: commitResult.actionsExecuted
        });
      }
      
      return {
        success: results.every(function(r) { return r.success; }),
        results: results
      };
    }
    
    /**
     * Replanifie une tâche (tous ses assignés)
     */
    async function replanTask(taskId, options) {
      options = options || {};
      
      log('Replanification tâche ' + taskId);
      
      // Charger les affectations de la tâche
      var data = await loadMemberData(0); // Charger toutes les données
      var memberIds = [];
      
      data.assignments
        .filter(function(a) { return a.tache === taskId; })
        .forEach(function(a) {
          if (memberIds.indexOf(a.membre) < 0) {
            memberIds.push(a.membre);
          }
        });
      
      return await replanMembers(memberIds, options);
    }
    
    /**
     * Replanifie plusieurs tâches
     */
    async function replanTasks(taskIds, options) {
      options = options || {};
      
      log('Replanification de ' + taskIds.length + ' tâches');
      
      // Collecter tous les membres concernés
      var data = await loadMemberData(0);
      var memberIds = [];
      
      data.assignments
        .filter(function(a) { return taskIds.indexOf(a.tache) >= 0; })
        .forEach(function(a) {
          if (memberIds.indexOf(a.membre) < 0) {
            memberIds.push(a.membre);
          }
        });
      
      return await replanMembers(memberIds, options);
    }
    
    // API publique
    return {
      previewMember: previewMember,
      commitMember: commitMember,
      replanMembers: replanMembers,
      replanTask: replanTask,
      replanTasks: replanTasks,
      loadMemberData: loadMemberData,
      createCapacityRegistry: createCapacityRegistry
    };
  }
  
  // Export
  global.createMemberPlanningOrchestrator = createMemberPlanningOrchestrator;
  
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
