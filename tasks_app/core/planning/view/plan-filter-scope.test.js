const scope = require('./plan-filter-scope');

const team = [
  { id: 3, nom: 'Antoine', entite: 10 },
  { id: 4, nom: 'Guillaume', entite: 10 },
  { id: 5, nom: 'Léa', entite: 11 }
];

describe('PlanFilterScope', () => {
  test('un filtre personne retire les contributions des collègues sur la même tâche', () => {
    expect(scope.filterCharges([
      { teamId: 3, heures: 7 },
      { teamId: 4, heures: 7 }
    ], { assignee: ['3'] }, team)).toEqual([{ teamId: 3, heures: 7 }]);
  });

  test('les filtres personne et équipe se combinent avec un ET', () => {
    const accepts = scope.createMemberPredicate({ assignee: ['3'], team: ['11'] }, team);
    expect(accepts(3)).toBe(false);
    expect(accepts(5)).toBe(false);
  });

  test('le scope canonique filtre tâches et membres avant agrégation', () => {
    const result = scope.scopeCanonData({
      team,
      tasks: [{ id: 20 }, { id: 21 }],
      assignments: [
        { id: 1, tache: 20, membre: 3 },
        { id: 2, tache: 20, membre: 4 },
        { id: 3, tache: 21, membre: 3 }
      ],
      timeEntries: [
        { id: 1, taskId: 20, memberId: 3 },
        { id: 2, taskId: 20, memberId: 4 }
      ],
      dailyCapacities: [
        { membre: 3, date: '2024-01-01' },
        { membre: 4, date: '2024-01-01' }
      ]
    }, new Set([20]), { assignee: ['3'] });

    expect(result.team.map(member => member.id)).toEqual([3]);
    expect(result.tasks.map(task => task.id)).toEqual([20]);
    expect(result.assignments.map(assignment => assignment.id)).toEqual([1]);
    expect(result.timeEntries.map(entry => entry.id)).toEqual([1]);
    expect(result.dailyCapacities.map(capacity => capacity.membre)).toEqual([3]);
  });
});
