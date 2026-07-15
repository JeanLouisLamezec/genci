/* ============================================================================
 * taskflow-schema.js — Source de vérité déclarative du schéma TaskFlow
 * ----------------------------------------------------------------------------
 * Ce fichier contient la définition COMPLÈTE et UNIQUE du modèle de données
 * partagé par tous les widgets TaskFlow.
 * 
 * NE PAS modifier les widgets individuellement pour le schéma de base.
 * Pour ajouter une table ou colonne, modifier CE fichier puis lancer :
 *   npm run build:taskflow
 * ============================================================================ */

(function (global) {
    'use strict';

    // Helper pour créer une colonne de données (non formulée)
    function dataColumn(type, options) {
        return Object.assign({
            type: type,
            isFormula: false
        }, options || {});
    }

    // Helper pour créer une colonne Ref
    function refColumn(targetTable, options) {
        return Object.assign({
            type: 'Ref:' + targetTable,
            isFormula: false
        }, options || {});
    }

    // Helper pour créer une colonne RefList
    function refListColumn(targetTable, options) {
        return Object.assign({
            type: 'RefList:' + targetTable,
            isFormula: false
        }, options || {});
    }

    // Version courante du schéma
    var SCHEMA_VERSION = 3;

    // Ordre de création des tables (important pour les dépendances)
    var TABLE_ORDER = [
        'Team',
        'Programmes',
        'Entites',
        'Competences',
        'Projects',
        'Tasks',
        'TaskAssignments',
        'Actions',
        'KanbanSteps',
        'Disponibilites',
        'MemberDailyCapacities',
        'Feuilles',
        'TimeEntries',
        'TaskFlow_Meta'
    ];

    // Définition complète des tables
    var TABLES = {
        // =========================================================================
        // Team — Annuaire des membres
        // =========================================================================
        Team: {
            label: 'Équipe',
            columns: [
                { id: 'nom',              opts: dataColumn('Text') },
                { id: 'email',            opts: dataColumn('Text') },
                { id: 'avatar',           opts: dataColumn('Text') },
                { id: 'role',             opts: dataColumn('Choice') },
                { id: 'actif',            opts: dataColumn('Bool') },
                { id: 'couleur',          opts: dataColumn('Text') },
                // Plan de charge (opt-in mais défini ici)
                { id: 'capaciteHebdo',    opts: dataColumn('Numeric') },
                { id: 'indispos',         opts: dataColumn('Text') },
                // Annuaire / Organigramme
                { id: 'entite',           opts: refColumn('Entites') },
                { id: 'responsable',      opts: refColumn('Team') },
                { id: 'gristUserId',      opts: dataColumn('Int') },
                { id: 'competences',      opts: refListColumn('Competences') },
                // ACL (formules)
                { id: 'agents_geres',     opts: { type: 'RefList:Team', isFormula: true, formula: '[]' } },
                { id: 'chaine_chefs',     opts: { type: 'RefList:Team', isFormula: true, formula: '[]' } }
            ]
        },

        // =========================================================================
        // Programmes — Regroupement de projets
        // =========================================================================
        Programmes: {
            label: 'Programmes',
            columns: [
                { id: 'nom',              opts: dataColumn('Text') },
                { id: 'couleur',          opts: dataColumn('Text') },
                { id: 'responsable',      opts: refColumn('Team') },
                { id: 'description',      opts: dataColumn('Text') },
                { id: 'actif',            opts: dataColumn('Bool') }
            ]
        },

        // =========================================================================
        // Entites — Organigramme / Annuaire
        // =========================================================================
        Entites: {
            label: 'Entités',
            columns: [
                { id: 'nom',              opts: dataColumn('Text') },
                { id: 'parent',           opts: refColumn('Entites') },
                { id: 'niveau',           opts: dataColumn('Choice') },
                { id: 'chef',             opts: refColumn('Team') },
                { id: 'actif',            opts: dataColumn('Bool') },
                // Formule ancêtres
                { id: 'ancetres',         opts: { type: 'RefList:Entites', isFormula: true, formula: '[]' } }
            ]
        },

        // =========================================================================
        // Competences — Compétences des membres
        // =========================================================================
        Competences: {
            label: 'Compétences',
            columns: [
                { id: 'nom',              opts: dataColumn('Text') },
                { id: 'categorie',        opts: dataColumn('Choice') },
                { id: 'description',      opts: dataColumn('Text') },
                { id: 'actif',            opts: dataColumn('Bool') }
            ]
        },

        // =========================================================================
        // Projects — Projets
        // =========================================================================
        Projects: {
            label: 'Projets',
            columns: [
                { id: 'nom',              opts: dataColumn('Text') },
                { id: 'couleur',          opts: dataColumn('Text') },
                { id: 'dateDebut',        opts: dataColumn('Date') },
                { id: 'dateFin',          opts: dataColumn('Date') },
                { id: 'responsable',      opts: refColumn('Team') },
                { id: 'actif',            opts: dataColumn('Bool') },
                // Programme (opt-in mais défini ici)
                { id: 'programme',        opts: refColumn('Programmes') }
            ]
        },

        // =========================================================================
        // Tasks — Tâches
        // =========================================================================
        Tasks: {
            label: 'Tâches',
            columns: [
                { id: 'titre',            opts: dataColumn('Text') },
                { id: 'description',      opts: dataColumn('Text') },
                { id: 'dateDebut',        opts: dataColumn('Date') },
                { id: 'dateEcheance',     opts: dataColumn('Date') },
                { id: 'priorite',         opts: dataColumn('Choice') },
                { id: 'statut',           opts: dataColumn('Choice') },
                { id: 'progression',      opts: dataColumn('Numeric') },
                { id: 'projet',           opts: refColumn('Projects') },
                { id: 'assignees',        opts: refListColumn('Team') },
                { id: 'type',             opts: dataColumn('Choice') },
                { id: 'dependDe',         opts: refListColumn('Tasks') },
                { id: 'tags',             opts: dataColumn('ChoiceList') },
                { id: 'estimationH',      opts: dataColumn('Numeric') },
                { id: 'tempsPasse',       opts: dataColumn('Numeric') },
                { id: 'couleur',          opts: dataColumn('Text') },
                { id: 'subtasks',         opts: dataColumn('Text') },
                { id: 'parentTask',       opts: refColumn('Tasks') },
                // Plan de charge (opt-in mais défini ici)
                { id: 'charges',          opts: dataColumn('Text') },
                { id: 'dateCloture',      opts: dataColumn('Date') }
            ]
        },

        // =========================================================================
        // TaskAssignments — Affectations d'un membre à une tâche
        // =========================================================================
        TaskAssignments: {
            label: 'Affectations',
            columns: [
                { id: 'tache',            opts: refColumn('Tasks') },
                { id: 'membre',           opts: refColumn('Team') },
                { id: 'heuresAllouees',   opts: dataColumn('Numeric') },
                { id: 'dateDebut',        opts: dataColumn('Date') },
                { id: 'dateFin',          opts: dataColumn('Date') },
                { id: 'modeRepartition',  opts: dataColumn('Choice') },
                { id: 'actif',            opts: dataColumn('Bool') },
                { id: 'commentaire',      opts: dataColumn('Text') }
            ]
        },

        // =========================================================================
        // Actions — Actions secondaires
        // =========================================================================
        Actions: {
            label: 'Actions',
            columns: [
                { id: 'titre',            opts: dataColumn('Text') },
                { id: 'description',      opts: dataColumn('Text') },
                { id: 'statut',           opts: dataColumn('Choice') },
                { id: 'priorite',         opts: dataColumn('Choice') },
                { id: 'progression',      opts: dataColumn('Numeric') },
                { id: 'estimationH',      opts: dataColumn('Numeric') },
                { id: 'dateDebut',        opts: dataColumn('Date') },
                { id: 'dateEcheance',     opts: dataColumn('Date') },
                { id: 'couleur',          opts: dataColumn('Text') },
                { id: 'tags',             opts: dataColumn('ChoiceList') },
                { id: 'ordre',            opts: dataColumn('Int') },
                { id: 'task',             opts: refColumn('Tasks') },
                { id: 'assignee',         opts: refColumn('Team') }
            ]
        },

        // =========================================================================
        // KanbanSteps — Étapes personnalisables du Kanban
        // =========================================================================
        KanbanSteps: {
            label: 'Étapes Kanban',
            columns: [
                { id: 'nom',              opts: dataColumn('Text') },
                { id: 'valeur',           opts: dataColumn('Text') },
                { id: 'couleur',          opts: dataColumn('Text') },
                { id: 'ordre',            opts: dataColumn('Int') },
                { id: 'actif',            opts: dataColumn('Bool') }
            ]
        },

        // =========================================================================
        // Disponibilites — Historique des indisponibilités
        // =========================================================================
        Disponibilites: {
            label: 'Disponibilités',
            columns: [
                { id: 'membre',           opts: refColumn('Team') },
                { id: 'type',             opts: dataColumn('Choice') },
                { id: 'dateDebut',        opts: dataColumn('Date') },
                { id: 'dateFin',          opts: dataColumn('Date') },
                { id: 'dispo',            opts: dataColumn('Numeric') },
                { id: 'commentaire',      opts: dataColumn('Text') }
            ]
        },

        // =========================================================================
        // MemberDailyCapacities — Capacité quotidienne par membre (table unique)
        // =========================================================================
        MemberDailyCapacities: {
            label: 'Capacités quotidiennes',
            columns: [
                { id: 'membre',             opts: refColumn('Team') },
                { id: 'date',               opts: dataColumn('Date') },
                { id: 'capaciteTheorique',  opts: dataColumn('Numeric') },
                { id: 'disponibiliteRatio', opts: dataColumn('Numeric') },
                { id: 'capaciteDisponible', opts: dataColumn('Numeric') },
                { id: 'absenceHeures',      opts: dataColumn('Numeric') },
                { id: 'source',             opts: dataColumn('Choice') },
                { id: 'revision',           opts: dataColumn('Int') },
                { id: 'sourceUpdatedAt',    opts: dataColumn('DateTime') },
                { id: 'commentaire',        opts: dataColumn('Text') }
            ]
        },

        // =========================================================================
        // Feuilles — Feuilles de temps à valider
        // =========================================================================
        Feuilles: {
            label: 'Feuilles de temps',
            columns: [
                { id: 'membre',           opts: refColumn('Team') },
                { id: 'semaine',          opts: dataColumn('Date') },
                { id: 'statut',           opts: dataColumn('Choice') },
                { id: 'validePar',        opts: refColumn('Team') },
                { id: 'dateValidation',   opts: dataColumn('Date') },
                { id: 'motifRejet',       opts: dataColumn('Text') }
            ]
        },

        // =========================================================================
        // TimeEntries — Feuille de temps (réalisé)
        // =========================================================================
        TimeEntries: {
            label: 'Temps passé',
            columns: [
                { id: 'membre',           opts: refColumn('Team') },
                { id: 'tache',            opts: refColumn('Tasks') },
                { id: 'date',             opts: dataColumn('Date') },
                { id: 'heures',           opts: dataColumn('Numeric') },
                { id: 'imputation',       opts: dataColumn('Text') },
                { id: 'description',      opts: dataColumn('Text') },
                // Nouvelles colonnes v2 pour le plan de charge
                { id: 'affectation',      opts: refColumn('TaskAssignments') },
                { id: 'heuresPrevues',    opts: dataColumn('Numeric') },
                { id: 'capaciteTheorique', opts: dataColumn('Numeric') },
                { id: 'capaciteDisponible', opts: dataColumn('Numeric') },
                { id: 'feuille',          opts: refColumn('Feuilles') },
                { id: 'revisionPlan',     opts: dataColumn('Int') },
                // Nouvelle colonne v3 : référence à la capacité quotidienne unique
                { id: 'capaciteJour',     opts: refColumn('MemberDailyCapacities') }
            ]
        },

        // =========================================================================
        // TaskFlow_Meta — Table technique de métadonnées
        // =========================================================================
        TaskFlow_Meta: {
            label: 'Métadonnées TaskFlow',
            columns: [
                { id: 'schemaVersion',    opts: dataColumn('Int') },
                { id: 'installationStatus', opts: dataColumn('Choice') },
                { id: 'lastMigration',    opts: dataColumn('Text') },
                { id: 'lastMigrationAt',  opts: dataColumn('DateTime') },
                { id: 'lastError',        opts: dataColumn('Text') },
                { id: 'installedBy',      opts: dataColumn('Text') }
            ]
        }
    };

    // Configuration des références (pour affichage humain dans les vues natives)
    // Chaque référence doit afficher le nom/titre plutôt que l'ID
    var REFERENCE_DISPLAYS = [
        // Team refs
        { table: 'Team', column: 'entite', targetTable: 'Entites', visibleColumn: 'nom' },
        { table: 'Team', column: 'responsable', targetTable: 'Team', visibleColumn: 'nom' },
        { table: 'Team', column: 'competences', targetTable: 'Competences', visibleColumn: 'nom' },
        
        // Projects refs
        { table: 'Projects', column: 'responsable', targetTable: 'Team', visibleColumn: 'nom' },
        { table: 'Projects', column: 'programme', targetTable: 'Programmes', visibleColumn: 'nom' },
        
        // Programmes refs
        { table: 'Programmes', column: 'responsable', targetTable: 'Team', visibleColumn: 'nom' },
        
        // Entites refs
        { table: 'Entites', column: 'parent', targetTable: 'Entites', visibleColumn: 'nom' },
        { table: 'Entites', column: 'chef', targetTable: 'Team', visibleColumn: 'nom' },
        
        // Tasks refs
        { table: 'Tasks', column: 'projet', targetTable: 'Projects', visibleColumn: 'nom' },
        { table: 'Tasks', column: 'assignees', targetTable: 'Team', visibleColumn: 'nom' },
        { table: 'Tasks', column: 'dependDe', targetTable: 'Tasks', visibleColumn: 'titre' },
        { table: 'Tasks', column: 'parentTask', targetTable: 'Tasks', visibleColumn: 'titre' },
        
        // Actions refs
        { table: 'Actions', column: 'task', targetTable: 'Tasks', visibleColumn: 'titre' },
        { table: 'Actions', column: 'assignee', targetTable: 'Team', visibleColumn: 'nom' },
        
        // TimeEntries refs
        { table: 'TimeEntries', column: 'membre', targetTable: 'Team', visibleColumn: 'nom' },
        { table: 'TimeEntries', column: 'tache', targetTable: 'Tasks', visibleColumn: 'titre' },
        { table: 'TimeEntries', column: 'affectation', targetTable: 'TaskAssignments', visibleColumn: 'tache' },
        { table: 'TimeEntries', column: 'feuille', targetTable: 'Feuilles', visibleColumn: 'semaine' },
        { table: 'TimeEntries', column: 'capaciteJour', targetTable: 'MemberDailyCapacities', visibleColumn: 'date' },
        
        // TaskAssignments refs
        { table: 'TaskAssignments', column: 'tache', targetTable: 'Tasks', visibleColumn: 'titre' },
        { table: 'TaskAssignments', column: 'membre', targetTable: 'Team', visibleColumn: 'nom' },
        
        // Feuilles refs
        { table: 'Feuilles', column: 'membre', targetTable: 'Team', visibleColumn: 'nom' },
        { table: 'Feuilles', column: 'validePar', targetTable: 'Team', visibleColumn: 'nom' },
        
        // Disponibilites refs
        { table: 'Disponibilites', column: 'membre', targetTable: 'Team', visibleColumn: 'nom' },
        
        // MemberDailyCapacities refs
        { table: 'MemberDailyCapacities', column: 'membre', targetTable: 'Team', visibleColumn: 'nom' }
    ];

    // Statuts par défaut pour les colonnes Choice
    var DEFAULT_STATUSES = [
        { value: 'todo',       label: 'À faire',  fillColor: '#94a3b8', textColor: '#ffffff' },
        { value: 'inprogress', label: 'En cours', fillColor: '#f59e0b', textColor: '#ffffff' },
        { value: 'review',     label: 'En revue', fillColor: '#3b82f6', textColor: '#ffffff' },
        { value: 'done',       label: 'Terminé',  fillColor: '#10b981', textColor: '#ffffff' }
    ];

    // Types de tâches par défaut
    var DEFAULT_TASK_TYPES = [
        { value: 'tache', label: 'Tâche' },
        { value: 'jalon', label: 'Jalon' },
        { value: 'epic',  label: 'Épopée' }
    ];

    // Priorités par défaut
    var DEFAULT_PRIORITIES = [
        { value: '1', label: 'Urgent', fillColor: '#ef4444', textColor: '#ffffff' },
        { value: '2', label: 'Élevée', fillColor: '#f59e0b', textColor: '#ffffff' },
        { value: '3', label: 'Normale', fillColor: '#3b82f6', textColor: '#ffffff' },
        { value: '4', label: 'Basse',  fillColor: '#64748b', textColor: '#ffffff' }
    ];

    // Export public
    global.TASKFLOW_SCHEMA = {
        version: SCHEMA_VERSION,
        tableOrder: TABLE_ORDER,
        tables: TABLES,
        referenceDisplays: REFERENCE_DISPLAYS,
        defaultStatuses: DEFAULT_STATUSES,
        defaultTaskTypes: DEFAULT_TASK_TYPES,
        defaultPriorities: DEFAULT_PRIORITIES,
        // Helpers exportés
        dataColumn: dataColumn,
        refColumn: refColumn,
        refListColumn: refListColumn
    };

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
