'use strict';

const { validateTaskDates, validateTaskMutation } = require('./gantt-task-date-constraints.js');

const day = value => Date.parse(value + 'T00:00:00Z') / 1000;
const project = {
  id: 1,
  nom: 'Projet test 1',
  dateDebut: day('2026-01-01'),
  dateFin: day('2026-12-31')
};
const parent = {
  id: 10,
  titre: 'Tâche parente',
  projet: 1,
  dateDebut: day('2026-03-01'),
  dateEcheance: day('2026-04-30')
};

const validate = task => validateTaskDates(task, { projects: [project], tasks: [parent] });

describe('GanttTaskDateConstraints - projet', () => {
  test('accepte une tâche exactement aux bornes inclusives du projet', () => {
    expect(validate({ projet: 1, dateDebut: project.dateDebut, dateEcheance: project.dateFin })).toEqual({ ok: true, code: 'VALID' });
  });

  test('refuse une tâche qui commence avant le projet', () => {
    const result = validate({ projet: 1, dateDebut: day('2025-12-31'), dateEcheance: day('2026-02-01') });
    expect(result.code).toBe('PROJECT_RANGE');
    expect(result.message).toContain('Projet test 1');
    expect(result.message).toContain('01/01/2026');
    expect(result.message).toContain('31/12/2026');
  });

  test('refuse une tâche qui finit après le projet', () => {
    expect(validate({ projet: 1, dateDebut: day('2026-12-01'), dateEcheance: day('2027-01-01') }).code).toBe('PROJECT_RANGE');
  });

  test('refuse un projet sans plage valide', () => {
    const result = validateTaskDates(
      { projet: 2, dateDebut: day('2026-01-01'), dateEcheance: day('2026-01-02') },
      { projects: [{ id: 2, nom: 'Sans dates' }], tasks: [] }
    );
    expect(result.code).toBe('PROJECT_DATES_INVALID');
  });
});

describe('GanttTaskDateConstraints - sous-tâche', () => {
  test('accepte une sous-tâche comprise dans son parent', () => {
    expect(validate({ projet: 1, parentTask: 10, dateDebut: day('2026-03-10'), dateEcheance: day('2026-04-20') }).ok).toBe(true);
  });

  test('refuse une sous-tâche qui commence avant son parent', () => {
    const result = validate({ projet: 1, parentTask: 10, dateDebut: day('2026-02-28'), dateEcheance: day('2026-03-10') });
    expect(result.code).toBe('PARENT_RANGE');
    expect(result.message).toContain('Tâche parente');
    expect(result.message).toContain('01/03/2026');
    expect(result.message).toContain('30/04/2026');
  });

  test('refuse une sous-tâche qui finit après son parent', () => {
    expect(validate({ projet: 1, parentTask: 10, dateDebut: day('2026-04-20'), dateEcheance: day('2026-05-01') }).code).toBe('PARENT_RANGE');
  });

  test('refuse les dates manquantes dans un périmètre borné', () => {
    expect(validate({ projet: 1, dateDebut: day('2026-03-01') }).code).toBe('TASK_DATES_REQUIRED');
  });

  test('refuse de réduire une tâche parente autour de sa sous-tâche', () => {
    const child = {
      id: 11,
      titre: 'Sous-tâche existante',
      projet: 1,
      parentTask: 10,
      dateDebut: day('2026-03-10'),
      dateEcheance: day('2026-04-20')
    };
    const narrowedParent = { ...parent, dateEcheance: day('2026-04-01') };
    const result = validateTaskMutation(narrowedParent, { projects: [project], tasks: [parent, child] });
    expect(result.code).toBe('PARENT_RANGE');
    expect(result.message).toContain('Tâche parente');
  });

  test('ne bloque pas une modification sans rapport avec les dates à cause d’un ancien enfant invalide', () => {
    const invalidChild = {
      id: 11,
      projet: 1,
      parentTask: 10,
      dateDebut: day('2026-02-20'),
      dateEcheance: day('2026-03-20')
    };
    const renamedParent = { ...parent, titre: 'Nouveau titre' };
    const result = validateTaskMutation(renamedParent, { projects: [project], tasks: [parent, invalidChild] });
    expect(result.ok).toBe(true);
  });

  test('accepte une référence Grist représentée par un objet avec id', () => {
    const result = validate({
      projet: { id: 1 },
      parentTask: { id: 10 },
      dateDebut: day('2026-03-10'),
      dateEcheance: day('2026-03-20')
    });
    expect(result.ok).toBe(true);
  });

  test('ne revalide pas un ancien parent introuvable sans changement temporel', () => {
    const legacyTask = {
      id: 20,
      titre: 'Ancienne tâche',
      projet: 1,
      parentTask: 999,
      dateDebut: day('2026-05-01'),
      dateEcheance: day('2026-05-10')
    };
    const renamedTask = { ...legacyTask, titre: 'Titre corrigé' };
    const result = validateTaskMutation(renamedTask, { projects: [project], tasks: [legacyTask] });
    expect(result).toEqual({ ok: true, code: 'UNCHANGED_TEMPORAL_SCOPE' });
  });

  test('refuse toujours un parent introuvable lorsque les dates changent', () => {
    const legacyTask = {
      id: 20,
      projet: 1,
      parentTask: 999,
      dateDebut: day('2026-05-01'),
      dateEcheance: day('2026-05-10')
    };
    const changedTask = { ...legacyTask, dateEcheance: day('2026-05-11') };
    const result = validateTaskMutation(changedTask, { projects: [project], tasks: [legacyTask] });
    expect(result.code).toBe('PARENT_NOT_FOUND');
  });

  test('validation forcée : refuse une tâche mutée en place hors de son projet', () => {
    const mutableTask = {
      id: 30,
      projet: 1,
      dateDebut: day('2026-06-01'),
      dateEcheance: day('2026-06-10')
    };
    const taskSet = [mutableTask];
    mutableTask.dateEcheance = day('2027-01-10');
    const result = validateTaskMutation(mutableTask, {
      projects: [project],
      tasks: taskSet,
      forceValidation: true
    });
    expect(result.code).toBe('PROJECT_RANGE');
  });
});
