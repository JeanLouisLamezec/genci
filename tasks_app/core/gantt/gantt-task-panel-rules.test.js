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
});

describe('GanttTaskPanelRules - parents de sous-tâche', () => {
  const tasks = [
    { id: 1, titre: 'Courante', projet: 10 },
    { id: 2, titre: 'Même projet', projet: 10 },
    { id: 3, titre: 'Autre projet', projet: 20 },
    { id: 4, titre: 'Sans projet', projet: null }
  ];

  test('ne propose que les tâches du projet courant', () => {
    expect(rules.filterParentTasks(tasks, 1, 10, () => true).map(task => task.id)).toEqual([2]);
  });

  test('filtre aussi les dépendances possibles sur le projet courant', () => {
    expect(rules.filterTasksByProject(tasks, 10).map(task => task.id)).toEqual([1, 2]);
    expect(rules.filterTasksByProject(tasks, 20).map(task => task.id)).toEqual([3]);
  });

  test('respecte aussi le contrôle de cycle existant', () => {
    expect(rules.filterParentTasks(tasks, 1, 10, (_current, candidate) => candidate !== 2)).toEqual([]);
  });

  test('isole les tâches sans projet des tâches appartenant à un projet', () => {
    expect(rules.filterParentTasks(tasks, null, null, () => true).map(task => task.id)).toEqual([4]);
  });
});
