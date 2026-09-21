'use strict';

const rules = require('./gantt-task-panel-rules.js');

describe('GanttTaskPanelRules - unités de charge', () => {
  test('convertit les jours en heures avec la convention 1 j = 7 h', () => {
    expect(rules.displayValueToHours(1, 'j')).toBe(7);
    expect(rules.displayValueToHours(1.5, 'j')).toBe(10.5);
    expect(rules.hoursToDisplayValue(10.5, 'j')).toBe(1.5);
  });

  test('conserve les heures et utilise les jours comme unité par défaut', () => {
    expect(rules.displayValueToHours(3.5, 'h')).toBe(3.5);
    expect(rules.displayValueToHours(2, undefined)).toBe(14);
    expect(rules.normalizeUnit(undefined)).toBe('j');
  });

  test('considère une charge nulle ou invalide comme non renseignée', () => {
    expect(rules.displayValueToHours(0, 'j')).toBe(0);
    expect(rules.displayValueToHours('invalide', 'h')).toBe(0);
    expect(rules.validatePositiveCharges([1, 2], [{ teamId: 1, heures: 7 }])).toEqual({
      ok: false,
      missingMemberIds: [2]
    });
  });

  test('autorise une répartition inférieure ou égale au temps prévu', () => {
    expect(rules.validateChargeBudget(
      [1, 2],
      [{ teamId: 1, heures: 3000 }, { teamId: 2, heures: 1000 }],
      4000
    )).toMatchObject({
      ok: true,
      totalChargeHours: 4000,
      estimatedHours: 4000,
      excessHours: 0
    });

    expect(rules.validateChargeBudget(
      [1, 2],
      [{ teamId: 1, heures: 2500 }, { teamId: 2, heures: 500 }],
      4000
    )).toMatchObject({ ok: true, totalChargeHours: 3000 });
  });

  test('refuse une répartition supérieure au temps prévu', () => {
    expect(rules.validateChargeBudget(
      [1, 2],
      [{ teamId: 1, heures: 2000 }, { teamId: 2, heures: 2500 }],
      4000
    )).toEqual({
      ok: false,
      code: 'CHARGE_BUDGET_EXCEEDED',
      totalChargeHours: 4500,
      estimatedHours: 4000,
      excessHours: 500
    });
  });

  test('ignore les anciennes charges de personnes qui ne sont plus affectées', () => {
    expect(rules.validateChargeBudget(
      [1],
      [{ teamId: 1, heures: 7 }, { teamId: 2, heures: 200 }],
      7
    )).toMatchObject({ ok: true, totalChargeHours: 7 });
  });
});

describe('GanttTaskPanelRules - parents de sous-tâche', () => {
  const tasks = [
    { id: 1, titre: 'Courante', projet: 10, type: 'tache' },
    { id: 2, titre: 'Même projet', projet: 10, type: 'tache' },
    { id: 3, titre: 'Autre projet', projet: 20 },
    { id: 4, titre: 'Sans projet', projet: null },
    { id: 5, titre: 'Jalon', projet: 10, type: 'jalon' }
  ];

  test('ne propose que les tâches du projet courant', () => {
    expect(rules.filterParentTasks(tasks, 1, 10, () => true).map(task => task.id)).toEqual([2]);
  });

  test('filtre aussi les dépendances possibles sur le projet courant', () => {
    expect(rules.filterTasksByProject(tasks, 10).map(task => task.id)).toEqual([1, 2, 5]);
    expect(rules.filterTasksByProject(tasks, 20).map(task => task.id)).toEqual([3]);
  });

  test('un jalon ne peut jamais servir de parent structurel', () => {
    expect(rules.filterParentTasks(tasks, 1, 10, () => true).map(task => task.id)).toEqual([2]);
    expect(rules.canBeStructuralParent(tasks[4])).toBe(false);
  });

  test('les dépendances proposées à un jalon excluent les autres jalons', () => {
    expect(rules.filterDependencyTasks(tasks, 10, 'jalon').map(task => task.id)).toEqual([1, 2]);
    expect(rules.filterDependencyTasks(tasks, 10, 'tache').map(task => task.id)).toEqual([1, 2, 5]);
  });

  test('respecte aussi le contrôle de cycle existant', () => {
    expect(rules.filterParentTasks(tasks, 1, 10, (_current, candidate) => candidate !== 2)).toEqual([]);
  });

  test('isole les tâches sans projet des tâches appartenant à un projet', () => {
    expect(rules.filterParentTasks(tasks, null, null, () => true).map(task => task.id)).toEqual([4]);
  });

  test('préremplit le projet et le parent depuis la tâche sélectionnée', () => {
    expect(rules.resolveCreationContext(tasks, 2)).toEqual({
      projectId: 10,
      parentTaskId: 2,
      dependencyTaskId: null
    });
  });

  test('préremplit le projet cliqué lorsqu’aucune tâche n’est sélectionnée', () => {
    expect(rules.resolveCreationContext(tasks, null, 20)).toEqual({
      projectId: 20,
      parentTaskId: null,
      dependencyTaskId: null
    });
  });

  test('ne transforme pas un jalon sélectionné en parent', () => {
    expect(rules.resolveCreationContext(tasks, 5)).toEqual({
      projectId: 10,
      parentTaskId: null,
      dependencyTaskId: 5
    });
  });
});

describe('GanttTaskPanelRules - modèle des jalons', () => {
  const tasks = [
    { id: 1, titre: 'Tâche porteuse', projet: 10, type: 'tache' },
    { id: 2, titre: 'Jalon', projet: 10, type: 'jalon', parentTask: 1 },
    { id: 3, titre: 'Autre jalon', projet: 10, type: 'jalon', parentTask: 1 },
    { id: 4, titre: 'Enfant legacy', projet: 10, type: 'tache', parentTask: 2 }
  ];

  test('exige une tâche porteuse pour créer un jalon', () => {
    expect(rules.validateHierarchy({ type: 'jalon', projet: 10, parentTask: null }, tasks)).toMatchObject({
      ok: false,
      code: 'MILESTONE_PARENT_REQUIRED'
    });
  });

  test('accepte un jalon rattaché à une vraie tâche du même projet', () => {
    expect(rules.validateHierarchy({ type: 'jalon', projet: 10, parentTask: 1 }, tasks)).toMatchObject({
      ok: true
    });
  });

  test('refuse un jalon rattaché à une tâche d’un autre projet', () => {
    const otherProjectTask = { id: 5, titre: 'Autre projet', projet: 20, type: 'tache' };
    expect(rules.validateHierarchy(
      { type: 'jalon', projet: 10, parentTask: 5 },
      tasks.concat([otherProjectTask])
    )).toMatchObject({
      ok: false,
      code: 'PARENT_PROJECT_MISMATCH'
    });
  });

  test('refuse toute tâche placée dans un jalon', () => {
    expect(rules.validateHierarchy({ type: 'tache', projet: 10, parentTask: 2 }, tasks)).toMatchObject({
      ok: false,
      code: 'MILESTONE_CANNOT_BE_PARENT'
    });
  });

  test('refuse de conserver des enfants legacy sous un jalon', () => {
    expect(rules.validateHierarchy(tasks[1], tasks, 2)).toMatchObject({
      ok: false,
      code: 'MILESTONE_CHILDREN_FORBIDDEN'
    });
  });
});

describe('GanttTaskPanelRules - projets proposés à la création', () => {
  test('ne garde que les projets actifs autorisés', () => {
    const projects = [
      { id: 1, actif: true },
      { id: 2, actif: true },
      { id: 3, actif: false }
    ];
    expect(rules.filterCreatableProjects(projects, project => project.id === 2).map(project => project.id)).toEqual([2]);
  });
});
