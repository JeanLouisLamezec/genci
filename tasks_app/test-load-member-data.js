#!/usr/bin/env node
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const BUNDLE_PATH = path.join(__dirname, 'core', 'generated', 'taskflow-planning-browser.js');
const bundleContent = fs.readFileSync(BUNDLE_PATH, 'utf8');

const sandbox = { window: {}, console: console };
const context = vm.createContext(sandbox);
vm.runInContext(bundleContent, context);

const TaskFlowPlanning = context.window.TaskFlowPlanning;

const monday = Math.floor(new Date('2025-01-06T00:00:00Z').getTime() / 1000);
const friday = Math.floor(new Date('2025-01-10T00:00:00Z').getTime() / 1000);

const mockGrist = {
  docApi: {
    fetchTable: async function(tableName) {
      console.log('Loading:', tableName);
      const data = {
        'Team': { id: [1], nom: ['Alice'] },
        'TaskAssignments': { id: [1], tache: [1], membre: [1], heuresAllouees: [35], dateDebut: [monday], dateFin: [friday], actif: [true], modeRepartition: ['uniforme'] },
        'Tasks': { id: [1], titre: ['Task A'], dateDebut: [monday], dateEcheance: [friday] },
        'TimeEntries': { id: [], tache: [], membre: [], affectation: [], date: [], heures: [], heuresPrevues: [], feuille: [], sheetStatus: [] },
        'Feuilles': { id: [], membre: [], semaine: [], statut: [] },
        'Disponibilites': { id: [], membre: [], type: [], dateDebut: [], dateFin: [], dispo: [] },
        'MemberDailyCapacities': { id: [1,2,3,4,5], membre: [1,1,1,1,1], date: ['2025-01-06','2025-01-07','2025-01-08','2025-01-09','2025-01-10'], capaciteDisponible: [7,7,7,7,7] }
      };
      return data[tableName] || { id: [], name: [] };
    }
  }
};

(async () => {
  try {
    const orchestrator = TaskFlowPlanning.createMemberPlanningOrchestrator(mockGrist, { logEnabled: false });
    
    // Accéder à loadMemberData via une hack (ce n'est pas dans l'API publique)
    // On va plutôt tester previewMember mais avec plus de logs
    console.log('\n=== Testing previewMember ===\n');
    const result = await orchestrator.previewMember(1);
    console.log('\nResult:', result);
  } catch (e) {
    console.error('ERROR:', e.message);
    console.error(e.stack);
  }
})();
