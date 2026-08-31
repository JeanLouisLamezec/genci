'use strict';

const {
  WITHOUT_PROJECT,
  taskOverlapsRange,
  buildDefaultCollapsedProjectIds,
  buildVisibleRows
} = require('./gantt-visible-tree.js');

const day = value => Date.parse(value + 'T00:00:00Z') / 1000;
const rangeStart = new Date('2026-08-01T00:00:00Z');
const rangeEndExclusive = new Date('2026-09-01T00:00:00Z');

function build(options = {}) {
  const tasks = options.tasks || [];
  return buildVisibleRows({
    tasks,
    filteredTasks: options.filteredTasks || tasks,
    projects: options.projects || [{ id: 1, nom: 'Alpha' }],
    rangeStart,
    rangeEndExclusive,
    expandedTaskIds: new Set(options.expandedTaskIds || []),
    collapsedProjectIds: new Set(options.collapsedProjectIds || [])
  });
}

describe('GanttVisibleTree - fenêtre temporelle', () => {
  test('masque une tâche entièrement avant ou après la période', () => {
    const tasks = [
      { id: 1, projet: 1, dateDebut: day('2024-01-01'), dateEcheance: day('2024-01-31') },
      { id: 2, projet: 1, dateDebut: day('2027-01-01'), dateEcheance: day('2027-01-31') }
    ];
    expect(build({ tasks }).rows).toEqual([]);
  });

  test('garde une tâche qui chevauche le début ou la fin de la période', () => {
    expect(taskOverlapsRange({ dateDebut: day('2026-07-20'), dateEcheance: day('2026-08-03') }, rangeStart, rangeEndExclusive)).toBe(true);
    expect(taskOverlapsRange({ dateDebut: day('2026-08-30'), dateEcheance: day('2026-09-10') }, rangeStart, rangeEndExclusive)).toBe(true);
    expect(taskOverlapsRange({ dateDebut: day('2026-09-01'), dateEcheance: day('2026-09-10') }, rangeStart, rangeEndExclusive)).toBe(false);
  });

  test('utilise la date présente lorsqu’une seule borne est renseignée', () => {
    expect(taskOverlapsRange({ dateDebut: day('2026-08-12') }, rangeStart, rangeEndExclusive)).toBe(true);
    expect(taskOverlapsRange({ dateEcheance: day('2024-08-12') }, rangeStart, rangeEndExclusive)).toBe(false);
  });
});

describe('GanttVisibleTree - état initial des projets', () => {
  test('replie tous les projets et le groupe sans projet', () => {
    const result = buildDefaultCollapsedProjectIds([
      { id: 10, projet: 1 },
      { id: 20, projet: null }
    ], [
      { id: 1, nom: 'Projet A' },
      { id: 2, nom: 'Projet B' }
    ]);

    expect([...result]).toEqual(['1', '2', WITHOUT_PROJECT]);
  });
});

describe('GanttVisibleTree - Projet > Tâche > Sous-tâche', () => {
  test('ajoute le projet et conserve un parent hors période comme contexte', () => {
    const tasks = [
      { id: 10, titre: 'Parent ancien', projet: 1, dateDebut: day('2024-01-01'), dateEcheance: day('2024-01-31') },
      { id: 11, titre: 'Enfant courant', projet: 1, parentTask: 10, dateDebut: day('2026-08-10'), dateEcheance: day('2026-08-20') }
    ];
    const result = build({ tasks, expandedTaskIds: [10] });
    expect(result.rows.map(row => row.kind)).toEqual(['project', 'task', 'task']);
    expect(result.rows[1]).toMatchObject({ depth: 1, dimmed: true });
    expect(result.rows[2]).toMatchObject({ depth: 2, dimmed: false });
  });

  test('affiche un descendant hors période lorsque son parent est explicitement déplié', () => {
    const tasks = [
      { id: 20, titre: 'Parent courant', projet: 1, dateDebut: day('2026-08-01'), dateEcheance: day('2026-08-15') },
      { id: 21, titre: 'Enfant ancien', projet: 1, parentTask: 20, dateDebut: day('2024-01-01'), dateEcheance: day('2024-01-02') }
    ];
    const result = build({ tasks, expandedTaskIds: [20] });
    expect(result.rows.filter(row => row.kind === 'task').map(row => row.task.id)).toEqual([20, 21]);
    expect(result.rows.find(row => row.kind === 'task' && row.task.id === 21).dimmed).toBe(true);
  });

  test('conserve un descendant hors période masqué lorsque son parent est replié', () => {
    const tasks = [
      { id: 22, titre: 'Parent courant', projet: 1, dateDebut: day('2026-08-01'), dateEcheance: day('2026-08-15') },
      { id: 23, titre: 'Enfant ancien', projet: 1, parentTask: 22, dateDebut: day('2024-01-01'), dateEcheance: day('2024-01-02') }
    ];
    const result = build({ tasks });
    expect(result.rows.filter(row => row.kind === 'task').map(row => row.task.id)).toEqual([22]);
  });

  test('ne réintroduit pas un enfant exclu par les filtres métier', () => {
    const tasks = [
      { id: 24, titre: 'Parent courant', projet: 1, dateDebut: day('2026-08-01'), dateEcheance: day('2026-08-15') },
      { id: 25, titre: 'Enfant filtré', projet: 1, parentTask: 24, dateDebut: day('2024-01-01'), dateEcheance: day('2024-01-02') }
    ];
    const result = build({ tasks, filteredTasks: [tasks[0]], expandedTaskIds: [24] });
    expect(result.rows.filter(row => row.kind === 'task').map(row => row.task.id)).toEqual([24]);
  });

  test('masque un projet sans tâche dans la période', () => {
    const tasks = [
      { id: 30, projet: 1, dateDebut: day('2024-01-01'), dateEcheance: day('2024-01-02') },
      { id: 31, projet: 2, dateDebut: day('2026-08-01'), dateEcheance: day('2026-08-02') }
    ];
    const result = build({ tasks, projects: [{ id: 1, nom: 'Ancien' }, { id: 2, nom: 'Courant' }] });
    expect(result.rows.filter(row => row.kind === 'project').map(row => row.project.id)).toEqual([2]);
  });

  test('crée un groupe Sans projet et sait le replier', () => {
    const tasks = [{ id: 40, dateDebut: day('2026-08-01'), dateEcheance: day('2026-08-02') }];
    const result = build({ tasks, collapsedProjectIds: [WITHOUT_PROJECT] });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ kind: 'project', key: WITHOUT_PROJECT, label: 'Sans projet', collapsed: true });
    expect(result.taskCount).toBe(1);
  });

  test('respecte le filtre métier avant le filtre temporel', () => {
    const tasks = [
      { id: 50, projet: 1, dateDebut: day('2026-08-01'), dateEcheance: day('2026-08-02') },
      { id: 51, projet: 1, dateDebut: day('2026-08-03'), dateEcheance: day('2026-08-04') }
    ];
    const result = build({ tasks, filteredTasks: [tasks[1]] });
    expect(result.rows.filter(row => row.kind === 'task').map(row => row.task.id)).toEqual([51]);
  });
});
