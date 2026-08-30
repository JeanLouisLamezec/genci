'use strict';

const userFilters = require('./user-filter-store.js');

function createGrist(rows = []) {
  let data = rows.map(row => ({ ...row }));
  let nextId = data.reduce((max, row) => Math.max(max, row.id || 0), 0) + 1;
  const actions = [];
  return {
    actions,
    rows: () => data,
    docApi: {
      listTables: async () => ['UserFilters'],
      fetchTable: async () => ({
        id: data.map(row => row.id),
        gristUserId: data.map(row => row.gristUserId),
        filters: data.map(row => row.filters),
        updatedAt: data.map(row => row.updatedAt),
        sourceWidget: data.map(row => row.sourceWidget)
      }),
      applyUserActions: async batch => {
        actions.push(...batch);
        batch.forEach(action => {
          if (action[0] === 'AddRecord') data.push({ id: nextId++, ...action[3] });
          if (action[0] === 'UpdateRecord') {
            const index = data.findIndex(row => row.id === action[2]);
            data[index] = { ...data[index], ...action[3] };
          }
        });
      }
    }
  };
}

describe('UserFilterStore', () => {
  test('charge uniquement la ligne du gristUserId courant', async () => {
    const grist = createGrist([
      { id: 1, gristUserId: 10, filters: JSON.stringify({ project: [2] }), updatedAt: 1 },
      { id: 2, gristUserId: 20, filters: JSON.stringify({ project: [9] }), updatedAt: 1 }
    ]);
    const store = userFilters.createStore(grist, { gristUserId: 10 });
    await expect(store.load()).resolves.toEqual({ assignee: [], team: [], project: ['2'], programme: [], task: [] });
  });

  test('crée puis met à jour une seule ligne personnelle', async () => {
    const grist = createGrist();
    const store = userFilters.createStore(grist, { gristUserId: 10, sourceWidget: 'kanban', debounceMs: 0 });
    await store.load();
    store.scheduleSave({ assignee: [3], project: [2] });
    await store.flush();
    store.scheduleSave({ assignee: [3, 4], project: [2] });
    await store.flush();
    expect(grist.rows()).toHaveLength(1);
    expect(grist.rows()[0].gristUserId).toBe(10);
    expect(userFilters.parseFilters(grist.rows()[0].filters).assignee).toEqual(['3', '4']);
    expect(grist.actions.map(action => action[0])).toEqual(['AddRecord', 'UpdateRecord']);
  });

  test('ne réécrit pas une signature inchangée', async () => {
    const filters = userFilters.signature({ task: [5] });
    const grist = createGrist([{ id: 1, gristUserId: 10, filters, updatedAt: 1 }]);
    const store = userFilters.createStore(grist, { gristUserId: 10, debounceMs: 0 });
    await store.load();
    store.scheduleSave({ task: ['5'] });
    await store.flush();
    expect(grist.actions).toHaveLength(0);
  });

  test('un autre widget recharge le dernier état écrit', async () => {
    const grist = createGrist();
    const kanbanStore = userFilters.createStore(grist, { gristUserId: 10, sourceWidget: 'kanban', debounceMs: 0 });
    kanbanStore.scheduleSave({ team: [4], programme: [8], task: [12] });
    await kanbanStore.flush();

    const craStore = userFilters.createStore(grist, { gristUserId: 10, sourceWidget: 'cra' });
    await expect(craStore.load()).resolves.toEqual({
      assignee: [], team: ['4'], project: [], programme: ['8'], task: ['12']
    });
  });
});
