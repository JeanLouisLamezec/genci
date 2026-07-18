/**
 * Member Planning Orchestrator - Orchestration de la planification par membre
 * 
 * Gère le partage de capacité entre toutes les affectations d'un même membre.
 * Contrairement au planning-engine.js qui traite une affectation isolément,
 * cet orchestrateur maintient un registre de capacité quotidien partagé.
 */

'use strict';

// Import des dépendances
var PlanningEngine = require('../planning-engine.js');
var PlanningReconciliation = require('../reconciliation/planning-reconciliation.js');
var CapacityService = require('../../capacity/member-daily-capacity-service.js');

var toCentiHours = PlanningEngine.toCentiHours;
var toHours = PlanningEngine.toHours;
var formatDateUTC = PlanningEngine.formatDateUTC;
var parseDateUTC = PlanningEngine.parseDateUTC;
var addDaysUTC = PlanningEngine.addDaysUTC;
var generateDateRange = PlanningEngine.generateDateRange;
var reconcileDailyEntries = PlanningReconciliation.reconcileDailyEntries;
var buildDesiredMemberDailyCapacities = CapacityService.buildDesiredMemberDailyCapacities;
var reconcileMemberDailyCapacities = CapacityService.reconcileMemberDailyCapacities;
  
  // ===========================================================================
  // Helpers de date
  // ===========================================================================
  
  /**
   * Convertit un tableau colonnaire en lignes
   */
  function columnarToRows(data) {
    if (!data || !data.id || data.id.length === 0) {
      return [];
    }
    
    var cols = Object.keys(data);
    var n = data.id.length;
    var rows = [];
    
    for (var i = 0; i < n; i++) {
      var rec = {};
      for (var j = 0; j < cols.length; j++) {
        var col = cols[j];
        rec[col] = data[col][i];
      }
      rows.push(rec);
    }
    
    return rows;
  }
  
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
   * Convertit une date Grist (timestamp ou string) en ISO UTC (YYYY-MM-DD)
   */
  function gristDateToIso(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    if (typeof value === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value;
      }
      var date = new Date(value);
      if (!isNaN(date.getTime())) {
        return formatDateUTC(date);
      }
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      var date = new Date(value * 1000);
      if (!isNaN(date.getTime())) {
        return formatDateUTC(date);
      }
    }
    if (value instanceof Date) {
      return formatDateUTC(value);
    }
    return null;
  }
  
  /**
   * Convertit une date ISO UTC (YYYY-MM-DD) en timestamp Grist
   */
  function isoToGristDate(value) {
    if (!value || typeof value !== 'string') {
      return null;
    }
    var date = parseDateUTC(value);
    if (!date) {
      return null;
    }
    return Math.floor(date.getTime() / 1000);
  }
  
  /**
   * Normalise un statut de feuille Grist vers le statut du domaine
   */
  function normalizeSheetStatus(status) {
    if (status === null || status === undefined || status === '') {
      return null;
    }
    var STATUS_MAPPING = {
      'brouillon': 'draft',
      'soumis': 'submitted',
      'valide': 'validated',
      'rejete': 'draft',
      'draft': 'draft',
      'submitted': 'submitted',
      'validated': 'validated',
      'rejected': 'draft'
    };
    return STATUS_MAPPING[String(status).toLowerCase()] || null;
  }
  
  /**
   * Mappe une affectation Grist vers le format domaine
   */
  function assignmentToDomain(assignment) {
    return {
      id: assignment.id,
      taskId: assignment.tache,
      memberId: assignment.membre,
      allocatedHours: Number(assignment.heuresAllouees || 0),
      startDate: gristDateToIso(assignment.dateDebut),
      endDate: gristDateToIso(assignment.dateFin)
    };
  }
  
  /**
   * Codes de diagnostics bloquants
   */
  var BLOCKING_DIAGNOSTIC_PREFIXES = ['MISSING_', 'INVALID_', 'DUPLICATE_'];
  var BLOCKING_DIAGNOSTIC_CODES = ['PROTECTED_PLAN_EXCEEDS_ALLOCATION', 'OVERCONSUMPTION'];
  
  /**
   * Vérifie si un diagnostic est bloquant
   */
  function isBlockingDiagnostic(diagnostic) {
    var code = diagnostic.code || '';
    for (var i = 0; i < BLOCKING_DIAGNOSTIC_PREFIXES.length; i++) {
      if (code.startsWith(BLOCKING_DIAGNOSTIC_PREFIXES[i])) {
        return true;
      }
    }
    if (BLOCKING_DIAGNOSTIC_CODES.indexOf(code) >= 0) {
      return true;
    }
    return false;
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
    var capacities = params.capacities || [];
    var protectedHoursByDate = params.protectedHoursByDate || {};
    var dateFrom = params.dateFrom;
    var dateTo = params.dateTo;
    
    var registry = {};
    var dates = generateDateRange(dateFrom, dateTo);
    
    var capacityByDate = {};
    capacities.forEach(function(cap) {
      var dateKey = cap.date;
      if (!capacityByDate[dateKey]) {
        capacityByDate[dateKey] = [];
      }
      capacityByDate[dateKey].push(cap);
    });
    
    dates.forEach(function(date) {
      var capsForDate = capacityByDate[date] || [];
      
      // Capacité théorique (somme de toutes les capacités théoriques du jour)
      var baseCapacity = 0;
      capsForDate.forEach(function(cap) {
        baseCapacity += (cap.capaciteTheorique || 0);
      });
      
      // Capacité disponible (somme de toutes les capacités disponibles du jour)
      var availableCapacity = 0;
      capsForDate.forEach(function(cap) {
        availableCapacity += (cap.capaciteDisponible || 0);
      });
      
      var protectedHours = protectedHoursByDate[date] || 0;
      
      registry[date] = {
        memberId: memberId,
        date: date,
        baseCapacityHours: baseCapacity,
        availableCapacityHours: availableCapacity,
        protectedHours: protectedHours,
        remainingCapacityHours: availableCapacity - protectedHours,
        plannedHours: 0
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
          return false;
        }
        
        registry[date].plannedHours += hours;
        registry[date].remainingCapacityHours -= hours;
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
      
      var member = null;
      if (teamTable.id) {
        for (var i = 0; i < teamTable.id.length; i++) {
          if (teamTable.id[i] === memberId) {
            member = {
              id: teamTable.id[i],
              nom: teamTable.nom ? teamTable.nom[i] : '',
              capaciteHebdo: teamTable.capaciteHebdo ? teamTable.capaciteHebdo[i] : 35
            };
            break;
          }
        }
      }
      
      if (!member) {
        throw new Error('Membre ' + memberId + ' non trouvé');
      }
      
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
      
      // Indexer les feuilles par ID
      var feuillesById = {};
      if (feuillesTable.id) {
        for (var p = 0; p < feuillesTable.id.length; p++) {
          feuillesById[feuillesTable.id[p]] = {
            id: feuillesTable.id[p],
            membre: feuillesTable.membre[p],
            semaine: feuillesTable.semaine[p],
            statut: feuillesTable.statut[p]
          };
        }
      }
      
      // Charger les TimeEntries du membre - rattachés par affectation
      var timeEntries = [];
      if (timeEntriesTable.id) {
        for (var l = 0; l < timeEntriesTable.id.length; l++) {
          if (timeEntriesTable.membre[l] === memberId) {
            var feuilleId = timeEntriesTable.feuille[l];
            var feuille = feuilleId ? feuillesById[feuilleId] : null;
            var sheetStatus = feuille ? normalizeSheetStatus(feuille.statut) : null;
            
            // Normaliser au format domaine avec TOUS les champs nécessaires
            timeEntries.push({
              id: timeEntriesTable.id[l],
              assignmentId: timeEntriesTable.affectation[l] || null,
              taskId: timeEntriesTable.tache[l],
              memberId: timeEntriesTable.membre[l],
              date: gristDateToIso(timeEntriesTable.date[l]),
              plannedHours: Number(timeEntriesTable.heuresPrevues[l] || 0),
              actualHours: Number(timeEntriesTable.heures[l] || 0),
              feuille: timeEntriesTable.feuille[l] || null,
              sheetStatus: sheetStatus,
              baseCapacityHours: Number(timeEntriesTable.capaciteTheorique[l] || 0),
              availableCapacityHours: Number(timeEntriesTable.capaciteDisponible[l] || 0),
              capacityRecordId: timeEntriesTable.capaciteJour[l] || null,
              revisionPlan: Number(timeEntriesTable.revisionPlan[l] || 0),
              description: timeEntriesTable.description ? timeEntriesTable.description[l] : null,
              imputation: timeEntriesTable.imputation ? timeEntriesTable.imputation[l] : null
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
              date: gristDateToIso(capacitiesTable.date[m]),
              capaciteTheorique: Number(capacitiesTable.capaciteTheorique[m] || 0),
              disponibiliteRatio: Number(capacitiesTable.disponibiliteRatio[m] || 1),
              capaciteDisponible: Number(capacitiesTable.capaciteDisponible[m] || 0),
              absenceHeures: Number(capacitiesTable.absenceHeures[m] || 0),
              source: capacitiesTable.source[m] || 'calcul',
              revision: Number(capacitiesTable.revision[m] || 1)
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
      
      return {
        member: member,
        assignments: assignments,
        tasks: tasks,
        timeEntries: timeEntries,
        capacities: capacities,
        disponibilites: disponibilites,
        feuilles: Object.keys(feuillesById).map(function(k) { return feuillesById[k]; })
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
      
      assignments.forEach(function(a) {
        if (a.dateDebut) {
          var start = gristDateToIso(a.dateDebut);
          if (start && (!minDate || start < minDate)) minDate = start;
        }
        if (a.dateFin) {
          var end = gristDateToIso(a.dateFin);
          if (end && (!maxDate || end > maxDate)) maxDate = end;
        }
      });
      
      timeEntries.forEach(function(e) {
        if (e.date) {
          var date = typeof e.date === 'string' ? e.date : gristDateToIso(e.date);
          if (date && (!minDate || date < minDate)) minDate = date;
          if (date && (!maxDate || date > maxDate)) maxDate = date;
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
    function identifyProtectedEntries(timeEntries, feuillesById, options) {
      options = options || {};
      var replanFromDate = options.replanFromDate;
      
      return timeEntries.filter(function(entry) {
        var isSubmitted = entry.sheetStatus === 'submitted';
        var isValidated = entry.sheetStatus === 'validated';
        var hasActualHours = entry.actualHours > 0;
        var isBeforeReplan = replanFromDate && entry.date && entry.date < replanFromDate;
        
        // Feuille soumise ou validée
        if (isSubmitted || isValidated) {
          return true;
        }
        
        // Heures réalisées > 0
        if (hasActualHours) {
          return true;
        }
        
        // Avant replanFromDate
        if (isBeforeReplan) {
          return true;
        }
        
        return false;
      });
    }
    
    /**
     * Calcule les heures protégées par date selon le statut
     */
    function calculateProtectedHoursByDate(protectedEntries) {
      var protectedHoursByDate = {};
      
      protectedEntries.forEach(function(entry) {
        if (!protectedHoursByDate[entry.date]) {
          protectedHoursByDate[entry.date] = 0;
        }
        
        // Feuille validée : protéger max(heuresPrevues, heures)
        if (entry.sheetStatus === 'validated') {
          protectedHoursByDate[entry.date] += Math.max(entry.plannedHours, entry.actualHours);
        }
        // Feuille soumise : protéger heuresPrevues
        else if (entry.sheetStatus === 'submitted') {
          protectedHoursByDate[entry.date] += entry.plannedHours;
        }
        // Ligne avec réalisé : protéger max(heuresPrevues, heures)
        else if (entry.actualHours > 0) {
          protectedHoursByDate[entry.date] += Math.max(entry.plannedHours, entry.actualHours);
        }
        // Historique avant replanFromDate : protéger heuresPrevues
        else {
          protectedHoursByDate[entry.date] += entry.plannedHours;
        }
      });
      
      return protectedHoursByDate;
    }
    
    /**
     * Preview de la planification pour un membre
     */
    async function previewMember(memberId, options) {
      options = options || {};
      
      try {
        log('Preview planification membre ' + memberId);
        
        var data;
        try {
          data = await loadMemberData(memberId);
        } catch (loadError) {
          log('Erreur loadMemberData: ' + loadError.message);
          throw loadError;
        }
        
        log('Données chargées: ' + data.assignments.length + ' affectations, ' + Object.keys(data.tasks).length + ' tâches');
        
        if (data.assignments.length === 0) {
          log('Aucune affectation pour le membre ' + memberId);
          return {
            success: true,
            memberId: memberId,
            assignmentResults: [],
            capacities: [],
            capacityActions: [],
            timeEntryActions: [],
            reconciliation: {
              creates: [],
              updates: [],
              deletes: [],
              conflicts: []
            },
            diagnostics: [],
            totals: {
              totalAllocatedHours: 0,
              totalPlannedHours: 0,
              totalUnplannedHours: 0,
              protectedHours: 0
            },
            canCommit: false,
            code: 'NO_ASSIGNMENTS',
            fingerprint: ''
          };
        }
        
        // 2. Calculer la période globale
        var period = calculateGlobalPeriod(data.assignments, data.timeEntries);
        
        if (!period) {
          log('Période invalide');
          return {
            success: false,
            code: 'INVALID_PERIOD'
          };
        }
        
        log('Période globale: ' + period.dateFrom + ' → ' + period.dateTo);
        
        // 3. Indexer les feuilles par ID
        var feuillesById = {};
        data.feuilles.forEach(function(f) {
          feuillesById[f.id] = f;
        });
        
        // 4. Générer les capacités désirées sur toute la période
        var capacityResult = null;
        if (period) {
          capacityResult = buildDesiredMemberDailyCapacities({
            memberId: memberId,
            weeklyCapacity: data.member.capaciteHebdo,
            availabilities: data.disponibilites,
            startDate: period.dateFrom,
            endDate: period.dateTo,
            defaultWeeklyCapacity: 35,
            source: 'calcul',
            revision: 1
          });
        }
        
        // 5. Réconcilier avec les capacités existantes
        var capacityActions = [];
        var capacitiesToUse = data.capacities;
        if (capacityResult && capacityResult.capacities) {
          var nowUnixSeconds = Math.floor(Date.now() / 1000);
          var capReconciliation = reconcileMemberDailyCapacities(
            data.capacities,
            capacityResult.capacities,
            { nowUnixSeconds: nowUnixSeconds }
          );
          
          for (var capI = 0; capI < capReconciliation.creates.length; capI++) {
            var capCreate = capReconciliation.creates[capI];
            capacityActions.push(['AddRecord', 'MemberDailyCapacities', null, capCreate]);
          }
          for (var capJ = 0; capJ < capReconciliation.updates.length; capJ++) {
            var capUpdate = capReconciliation.updates[capJ];
            capacityActions.push(['UpdateRecord', 'MemberDailyCapacities', capUpdate.id, capUpdate.fields]);
          }
          
          // Utiliser les capacités réconciliées
          var reconciledCapacities = [];
          data.capacities.forEach(function(cap) {
            reconciledCapacities.push(cap);
          });
          capReconciliation.creates.forEach(function(cap) {
            reconciledCapacities.push({
              id: null,
              membre: cap.membre,
              date: typeof cap.date === 'number' ? formatDateUTC(new Date(cap.date * 1000)) : cap.date,
              capaciteTheorique: cap.capaciteTheorique,
              capaciteDisponible: cap.capaciteDisponible
            });
          });
          capacitiesToUse = reconciledCapacities;
        }
        
        // 6. Identifier les entrées protégées
        var protectedEntries = identifyProtectedEntries(data.timeEntries, feuillesById, {
          replanFromDate: options.replanFromDate
        });
        
        // Calculer les heures protégées par date selon le statut
        var protectedHoursByDate = calculateProtectedHoursByDate(protectedEntries);
        
        // 7. Créer le registre de capacité avec les heures protégées correctes
        var registry = createCapacityRegistry({
          memberId: memberId,
          capacities: capacitiesToUse,
          protectedHoursByDate: protectedHoursByDate,
          dateFrom: period.dateFrom,
          dateTo: period.dateTo
        });
        
        log('Registre créé: ' + registry.dates.length + ' jours');
        
        // 6. Traiter chaque affectation dans l'ordre
        var assignmentResults = [];
        var allDiagnostics = [];
        var totalAllocated = 0;
        var totalPlanned = 0;
        var totalUnplanned = 0;
        var hasAssignmentFailure = false;
        
        log('Début traitement de ' + data.assignments.length + ' affectations...');
        
        for (var i = 0; i < data.assignments.length; i++) {
          var assignment = data.assignments[i];
          totalAllocated += assignment.heuresAllouees || 0;
          
          var task = data.tasks[assignment.tache];
          
          if (!task) {
            log('Tâche ' + assignment.tache + ' non trouvée, affectation échouée');
            assignmentResults.push({
              assignmentId: assignment.id,
              success: false,
              error: 'Tâche non trouvée',
              diagnostics: [{ code: 'TASK_NOT_FOUND', taskId: assignment.tache }],
              plannedEntries: [],
              summary: {
                allocatedHours: assignment.heuresAllouees || 0,
                unplannedHours: assignment.heuresAllouees || 0
              }
            });
            totalUnplanned += assignment.heuresAllouees || 0;
            allDiagnostics.push({ code: 'TASK_NOT_FOUND', taskId: assignment.tache, assignmentId: assignment.id });
            hasAssignmentFailure = true;
            continue;
          }
          
          log('Traitement affectation ' + assignment.id + ' (tâche ' + assignment.tache + ')');
          
          // Convertir l'affectation au format domaine
          var domainAssignment = assignmentToDomain(assignment);
          
          // Construire le tableau de capacités restantes pour le moteur
          var capacitiesArray = registry.dates.map(function(date) {
            var regEntry = registry.getRegistry()[date];
            return {
              date: date,
              baseCapacityHours: regEntry.baseCapacityHours,
              availableCapacityHours: regEntry.remainingCapacityHours
            };
          });
          
          // Filtrer les TimeEntries pour cette affectation uniquement
          var entriesForAssignment = data.timeEntries.filter(function(e) {
            return e.assignmentId === assignment.id;
          });
          
          // Appeler le moteur de planification avec le bon contrat
          var planningResult = PlanningEngine.buildAssignmentPlan({
            assignment: domainAssignment,
            capacities: capacitiesArray,
            existingEntries: entriesForAssignment,
            replanFromDate: options.replanFromDate || null,
            precisionHours: 0.01,
            capacityPolicy: 'cap'
          });
          
          // Vérifier les diagnostics bloquants
          var hasBlockingDiagnostic = false;
          for (var j = 0; j < planningResult.diagnostics.length; j++) {
            if (isBlockingDiagnostic(planningResult.diagnostics[j])) {
              hasBlockingDiagnostic = true;
              break;
            }
          }
          
          if (hasBlockingDiagnostic) {
            log('Diagnostic bloquant pour affectation ' + assignment.id);
            assignmentResults.push({
              assignmentId: assignment.id,
              success: false,
              error: 'Diagnostic bloquant',
              diagnostics: planningResult.diagnostics,
              plannedEntries: [],
              summary: planningResult.summary
            });
            totalUnplanned += planningResult.summary.unplannedHours || 0;
            allDiagnostics = allDiagnostics.concat(planningResult.diagnostics);
            hasAssignmentFailure = true;
            continue;
          }
          
          // Réserver les heures dans le registre
          var plannedEntries = planningResult.desiredPlan || [];
          var reservationFailed = false;
          for (var k = 0; k < plannedEntries.length; k++) {
            var entry = plannedEntries[k];
            if (!registry.reserveHours(entry.date, entry.plannedHours)) {
              reservationFailed = true;
              break;
            }
          }
          
          if (reservationFailed) {
            log('Échec réservation pour affectation ' + assignment.id);
            assignmentResults.push({
              assignmentId: assignment.id,
              success: false,
              error: 'Capacité insuffisante',
              diagnostics: [{ code: 'INSUFFICIENT_CAPACITY', assignmentId: assignment.id }],
              plannedEntries: [],
              summary: planningResult.summary
            });
            totalUnplanned += planningResult.summary.unplannedHours || 0;
            allDiagnostics = allDiagnostics.concat(planningResult.diagnostics);
            hasAssignmentFailure = true;
            continue;
          }
          
          assignmentResults.push({
            assignmentId: assignment.id,
            success: true,
            plannedEntries: plannedEntries,
            diagnostics: planningResult.diagnostics || [],
            summary: planningResult.summary
          });
          
          allDiagnostics = allDiagnostics.concat(planningResult.diagnostics || []);
          totalUnplanned += planningResult.summary.unplannedHours || 0;
        }
        
        // 7. Vérifier la postcondition
        var postconditionCheck = registry.verifyPostcondition();
        
        if (!postconditionCheck.valid) {
          log('Violation postcondition: ' + JSON.stringify(postconditionCheck.violations));
          return {
            success: false,
            code: 'CAPACITY_OVERCOMMITMENT',
            violations: postconditionCheck.violations
          };
        }
        
        // 8. Réconciliation globale
        // Créer un index des capacités par date pour le lien capaciteJour
        var capacityIdByDate = {};
        capacitiesToUse.forEach(function(cap) {
          if (cap.id) {
            capacityIdByDate[cap.date] = cap.id;
          }
        });
        
        // Filtrer les entrées existantes pour la réconciliation
        // Exclure les lignes protégées par replanFromDate
        var entriesForReconciliation = data.timeEntries;
        if (options.replanFromDate) {
          entriesForReconciliation = data.timeEntries.filter(function(e) {
            return e.date >= options.replanFromDate;
          });
        }
        
        var allDesiredEntries = [];
        assignmentResults.forEach(function(result) {
          if (result.plannedEntries && result.success) {
            result.plannedEntries.forEach(function(entry) {
              allDesiredEntries.push({
                assignmentId: result.assignmentId,
                taskId: entry.taskId,
                memberId: memberId,
                date: entry.date,
                plannedHours: entry.plannedHours,
                baseCapacityHours: entry.baseCapacityHours,
                availableCapacityHours: entry.availableCapacityHours,
                capacityRecordId: capacityIdByDate[entry.date] || null
              });
            });
          }
        });
        
        var reconciliation = reconcileDailyEntries(entriesForReconciliation, allDesiredEntries, {
          precisionHours: 0.01
        });
        
        // 9. Convertir la réconciliation en actions Grist
        var existingEntriesMap = new Map();
        data.timeEntries.forEach(function(e) {
          existingEntriesMap.set(e.id, e);
        });
        var actions = reconciliationToActions(reconciliation, memberId, existingEntriesMap);
        
        // 10. Calculer les totaux depuis le registre
        totalPlanned = 0;
        var totalProtectedHours = 0;
        Object.keys(registry.getRegistry()).forEach(function(date) {
          var regEntry = registry.getRegistry()[date];
          totalPlanned += regEntry.plannedHours;
          totalProtectedHours += regEntry.protectedHours;
        });
        
        // 11. Générer le fingerprint
        var fingerprint = generateFingerprint(data, registry);
        
        log('Preview terminé: ' + totalPlanned + 'h planifiées sur ' + totalAllocated + 'h allouées');
        
        var hasUnplanned = totalUnplanned > 0;
        var hasFailure = hasAssignmentFailure || hasUnplanned;
        
        return {
          success: !hasAssignmentFailure,
          memberId: memberId,
          assignmentResults: assignmentResults,
          capacities: Object.keys(registry.getRegistry()).map(function(date) {
            return registry.getRegistry()[date];
          }),
          capacityActions: capacityActions,
          timeEntryActions: actions.timeEntryActions,
          reconciliation: reconciliation,
          diagnostics: allDiagnostics,
          totals: {
            totalAllocatedHours: totalAllocated,
            totalPlannedHours: totalPlanned,
            totalUnplannedHours: totalUnplanned,
            protectedHours: totalProtectedHours
          },
          fingerprint: fingerprint,
          canCommit: !hasFailure || options.allowPartialPlanning === true,
          code: hasAssignmentFailure ? 'ASSIGNMENT_PLANNING_FAILED' : (hasUnplanned ? 'INSUFFICIENT_SHARED_CAPACITY' : 'SUCCESS')
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
      
      return parts.join('|');
    }
    
    /**
     * Convertit un diff de réconciliation en actions Grist
     */
    function reconciliationToActions(reconciliation, memberId, existingEntriesMap) {
      var capacityActions = [];
      var timeEntryActions = [];
      
      // Créations de TimeEntries
      if (reconciliation.creates && reconciliation.creates.length > 0) {
        for (var i = 0; i < reconciliation.creates.length; i++) {
          var create = reconciliation.creates[i];
          timeEntryActions.push([
            'AddRecord',
            'TimeEntries',
            null,
            {
              affectation: create.assignmentId,
              tache: create.taskId,
              membre: create.memberId,
              date: isoToGristDate(create.date),
              heuresPrevues: create.plannedHours,
              heures: 0,
              capaciteTheorique: create.baseCapacityHours || 0,
              capaciteDisponible: create.availableCapacityHours || 0,
              capaciteJour: create.capacityRecordId,
              revisionPlan: 1,
              description: null,
              imputation: null
            }
          ]);
        }
      }
      
      // Mises à jour de TimeEntries
      if (reconciliation.updates && reconciliation.updates.length > 0) {
        for (var j = 0; j < reconciliation.updates.length; j++) {
          var update = reconciliation.updates[j];
          var fields = {};
          
          if (update.fields.plannedHours !== undefined) {
            fields.heuresPrevues = update.fields.plannedHours;
          }
          if (update.fields.baseCapacityHours !== undefined) {
            fields.capaciteTheorique = update.fields.baseCapacityHours;
          }
          if (update.fields.availableCapacityHours !== undefined) {
            fields.capaciteDisponible = update.fields.availableCapacityHours;
          }
          if (update.fields.capacityRecordId !== undefined) {
            fields.capaciteJour = update.fields.capacityRecordId;
          }
          
          if (Object.keys(fields).length > 0) {
            // Utiliser la revisionPlan déjà calculée par la réconciliation
            if (update.fields.revisionPlan !== undefined) {
              fields.revisionPlan = update.fields.revisionPlan;
            }
            timeEntryActions.push([
              'UpdateRecord',
              'TimeEntries',
              update.id,
              fields
            ]);
          }
        }
      }
      
      // Suppressions de TimeEntries
      if (reconciliation.deletes && reconciliation.deletes.length > 0) {
        for (var k = 0; k < reconciliation.deletes.length; k++) {
          var del = reconciliation.deletes[k];
          timeEntryActions.push([
            'RemoveRecord',
            'TimeEntries',
            del.id
          ]);
        }
      }
      
      return {
        capacityActions: capacityActions,
        timeEntryActions: timeEntryActions
      };
    }
    
    /**
     * Commit de la planification pour un membre
     */
    async function commitMember(memberId, preview, options) {
      options = options || {};
      
      try {
        log('Commit planification membre ' + memberId);
        
        if (!preview || !preview.success) {
          return {
            success: false,
            code: 'INVALID_PREVIEW'
          };
        }
        
        // Vérifier canCommit
        if (!preview.canCommit) {
          return {
            success: false,
            code: preview.code || 'CANNOT_COMMIT',
            message: 'Le preview indique que le commit n\'est pas autorisé'
          };
        }
        
        // Vérifier le fingerprint (optionnel)
        if (options.expectedFingerprint && preview.fingerprint !== options.expectedFingerprint) {
          return {
            success: false,
            code: 'STALE_PREVIEW',
            message: 'Le preview est obsolète'
          };
        }
        
        // Appliquer les actions
        var actions = [];
        
        // Capacités d'abord
        for (var i = 0; i < preview.capacityActions.length; i++) {
          actions.push(preview.capacityActions[i]);
        }
        
        // TimeEntries
        for (var j = 0; j < preview.timeEntryActions.length; j++) {
          actions.push(preview.timeEntryActions[j]);
        }
        
        if (actions.length === 0) {
          log('Aucune action à appliquer');
          return {
            success: true,
            actionsExecuted: 0
          };
        }
        
        log('Application de ' + actions.length + ' actions...');
        
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
      
      var assignmentsData = await grist.docApi.fetchTable('TaskAssignments');
      var taskAssignments = [];
      
      if (assignmentsData.id) {
        for (var i = 0; i < assignmentsData.id.length; i++) {
          if (assignmentsData.tache[i] === taskId && assignmentsData.actif[i] !== false) {
            taskAssignments.push({
              id: assignmentsData.id[i],
              tache: assignmentsData.tache[i],
              membre: assignmentsData.membre[i]
            });
          }
        }
      }
      
      var memberIds = [];
      taskAssignments.forEach(function(a) {
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
      
      var assignmentsData = await grist.docApi.fetchTable('TaskAssignments');
      var taskAssignments = [];
      
      if (assignmentsData.id) {
        for (var i = 0; i < assignmentsData.id.length; i++) {
          if (taskIds.indexOf(assignmentsData.tache[i]) >= 0 && assignmentsData.actif[i] !== false) {
            taskAssignments.push({
              id: assignmentsData.id[i],
              tache: assignmentsData.tache[i],
              membre: assignmentsData.membre[i]
            });
          }
        }
      }
      
      var memberIds = [];
      taskAssignments.forEach(function(a) {
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
  
  // Export CommonJS
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      createMemberPlanningOrchestrator: createMemberPlanningOrchestrator,
      createCapacityRegistry: createCapacityRegistry,
      sortAssignments: sortAssignments
    };
  }
  
  // Export pour le navigateur
  if (typeof window !== 'undefined') {
    window.createMemberPlanningOrchestrator = createMemberPlanningOrchestrator;
    window.createCapacityRegistry = createCapacityRegistry;
    window.sortAssignments = sortAssignments;
  }
