'use strict';

const transaction = require('./gantt-date-change-transaction.js');

function target(id) {
  return {
    id,
    label: 'Tâche ' + id,
    nextStart: 20,
    nextEnd: 30,
    previousStart: 10,
    previousEnd: 15
  };
}

describe('GanttDateChangeTransaction', () => {
  test('valide les dates uniquement après toutes les synchronisations', async () => {
    const applyActions = jest.fn().mockResolvedValue({});
    const syncTaskDates = jest.fn().mockResolvedValue({ ok: true, planningResult: { success: true } });
    const result = await transaction.run({
      applyActions,
      forwardActions: [['forward']],
      rollbackActions: [['rollback']],
      targets: [target(1), target(2)],
      syncTaskDates
    });
    expect(result.ok).toBe(true);
    expect(applyActions).toHaveBeenCalledTimes(1);
    expect(syncTaskDates).toHaveBeenCalledTimes(2);
  });

  test('restaure les dates et le planning dès qu’une synchronisation échoue', async () => {
    const applyActions = jest.fn().mockResolvedValue({});
    const syncTaskDates = jest.fn()
      .mockResolvedValueOnce({ ok: false, message: 'CRA protégé' })
      .mockResolvedValueOnce({ ok: true, planningResult: { success: true } });
    const result = await transaction.run({
      applyActions,
      forwardActions: [['forward']],
      rollbackActions: [['rollback']],
      targets: [target(1)],
      syncTaskDates
    });
    expect(result.ok).toBe(false);
    expect(result.datesRestored).toBe(true);
    expect(result.planningRestored).toBe(true);
    expect(applyActions).toHaveBeenNthCalledWith(2, [['rollback']]);
    expect(syncTaskDates).toHaveBeenNthCalledWith(2, 1, 10, 15);
  });

  test('traite un échec de planification comme un échec de synchronisation', async () => {
    const applyActions = jest.fn().mockResolvedValue({});
    const syncTaskDates = jest.fn()
      .mockResolvedValueOnce({ ok: true, planningResult: { success: false, code: 'COMMIT_FAILED' } })
      .mockResolvedValueOnce({ ok: true });
    const result = await transaction.run({
      applyActions,
      forwardActions: [['forward']],
      rollbackActions: [['rollback']],
      targets: [target(4)],
      syncTaskDates
    });
    expect(result.ok).toBe(false);
    expect(result.datesRestored).toBe(true);
  });

  test('signale explicitement une restauration des dates impossible', async () => {
    const applyActions = jest.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('droits retirés'));
    const result = await transaction.run({
      applyActions,
      forwardActions: [['forward']],
      rollbackActions: [['rollback']],
      targets: [target(1)],
      syncTaskDates: jest.fn().mockResolvedValue({ ok: false })
    });
    expect(result.ok).toBe(false);
    expect(result.datesRestored).toBe(false);
    expect(result.rollbackErrors[0]).toContain('droits retirés');
  });
});
