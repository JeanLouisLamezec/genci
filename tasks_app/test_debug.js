const { createWidgetPlanningService } = require('./core/widget-planning-service.js');
const { createMockGrist } = require('./core/grist/mock-grist.js');

const mockGrist = createMockGrist({
  initialData: {
    TaskAssignments: [{ id: 1, tache: 1, membre: 1, heuresAllouees: 35, dateDebut: 1719792000, dateFin: 1720137600, actif: true }],
    Tasks: [{ id: 1, titre: 'Tâche 1' }],
    Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
    TimeEntries: [],
    Feuilles: [],
    Disponibilites: [],
    MemberDailyCapacities: []
  }
});

const service = createWidgetPlanningService(mockGrist);

console.log('First call...');
const p1 = service.commitAssignment(1);
console.log('p1 created');

console.log('Second call...');
const p2 = service.commitAssignment(1);
console.log('p2 created');

console.log('Same?', p1 === p2);
