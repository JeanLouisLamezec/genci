/**
 * Tests pour mock-grist.js
 */

'use strict';

const { createMockGrist } = require('./mock-grist.js');

describe('createMockGrist', () => {
  let mock;
  
  beforeEach(() => {
    mock = createMockGrist();
  });
  
  describe('Initialisation', () => {
    it('devrait créer un mock avec docApi', () => {
      expect(mock.docApi).toBeDefined();
      expect(typeof mock.fetchTable).toBe('function');
      expect(typeof mock.applyUserActions).toBe('function');
    });
    
    it('devrait initialiser avec des données', async () => {
      mock = createMockGrist({
        initialData: {
          Tasks: [
            { id: 1, titre: 'Tâche 1' },
            { id: 2, titre: 'Tâche 2' }
          ]
        }
      });
      
      const tasks = await mock.fetchTable('Tasks');
      expect(tasks.id).toEqual([1, 2]);
      expect(tasks.titre).toEqual(['Tâche 1', 'Tâche 2']);
    });
  });
  
  describe('Gestion des IDs', () => {
    it('devrait utiliser un compteur par table', async () => {
      await mock.applyUserActions([
        ['AddTable', 'Table1', [{ id: 'name', type: 'Text' }]],
        ['AddRecord', 'Table1', null, { name: 'A' }],
        ['AddRecord', 'Table1', null, { name: 'B' }]
      ]);
      
      const table1 = await mock.fetchTable('Table1');
      expect(table1.id).toEqual([1, 2]);
      
      await mock.applyUserActions([
        ['AddTable', 'Table2', [{ id: 'name', type: 'Text' }]],
        ['AddRecord', 'Table2', null, { name: 'C' }]
      ]);
      
      const table2 = await mock.fetchTable('Table2');
      expect(table2.id).toEqual([1]);
    });
    
    it('ne devrait pas écraser une ligne existante', async () => {
      mock = createMockGrist({
        initialData: {
          Tasks: [
            { id: 5, titre: 'Tâche 5' }
          ]
        }
      });
      
      await mock.applyUserActions([
        ['AddRecord', 'Tasks', null, { titre: 'Nouvelle' }]
      ]);
      
      const tasks = await mock.fetchTable('Tasks');
      expect(tasks.id).toEqual([5, 6]);
      expect(tasks.titre).toEqual(['Tâche 5', 'Nouvelle']);
    });
    
    it('devrait coexister deux lignes dans la même table', async () => {
      await mock.applyUserActions([
        ['AddTable', 'Test', [{ id: 'name', type: 'Text' }]],
        ['AddRecord', 'Test', null, { name: 'A' }],
        ['AddRecord', 'Test', null, { name: 'B' }]
      ]);
      
      const test = await mock.fetchTable('Test');
      expect(test.id.length).toBe(2);
      expect(test.name).toEqual(['A', 'B']);
    });
  });
  
  describe('Suppression avec alignement', () => {
    it('devrait supprimer une ligne et aligner les colonnes', async () => {
      await mock.applyUserActions([
        ['AddTable', 'Test', [{ id: 'name', type: 'Text' }]],
        ['AddRecord', 'Test', null, { name: 'A' }],
        ['AddRecord', 'Test', null, { name: 'B' }],
        ['AddRecord', 'Test', null, { name: 'C' }]
      ]);
      
      const before = await mock.fetchTable('Test');
      expect(before.id).toEqual([1, 2, 3]);
      expect(before.name).toEqual(['A', 'B', 'C']);
      
      await mock.applyUserActions([
        ['RemoveRecord', 'Test', 2]
      ]);
      
      const after = await mock.fetchTable('Test');
      expect(after.id).toEqual([1, 3]);
      expect(after.name).toEqual(['A', 'C']);
    });
  });
  
  describe('Ajout de colonne sur table remplie', () => {
    it('devrait ajouter une colonne avec nulls', async () => {
      await mock.applyUserActions([
        ['AddTable', 'Test', [{ id: 'name', type: 'Text' }]],
        ['AddRecord', 'Test', null, { name: 'A' }],
        ['AddRecord', 'Test', null, { name: 'B' }],
        ['AddColumn', 'Test', 'value', { type: 'Numeric' }]
      ]);
      
      const test = await mock.fetchTable('Test');
      expect(test.id).toEqual([1, 2]);
      expect(test.name).toEqual(['A', 'B']);
      expect(test.value).toEqual([null, null]);
    });
  });
  
  describe('Métadonnées Grist', () => {
    it('devrait exposer _grist_Tables', async () => {
      await mock.applyUserActions([
        ['AddTable', 'Test', [{ id: 'name', type: 'Text' }]]
      ]);
      
      const tables = await mock.fetchTable('_grist_Tables');
      expect(tables.id.length).toBeGreaterThan(0);
      expect(tables.tableId).toContain('Test');
    });
    
    it('devrait exposer _grist_Tables_column', async () => {
      await mock.applyUserActions([
        ['AddTable', 'Test', [{ id: 'name', type: 'Text' }]]
      ]);
      
      const columns = await mock.fetchTable('_grist_Tables_column');
      expect(columns.id.length).toBeGreaterThan(0);
      expect(columns.colId).toContain('name');
    });
    
    it('devrait mettre à jour les métadonnées lors de ModifyColumn', async () => {
      await mock.applyUserActions([
        ['AddTable', 'Test', [{ id: 'name', type: 'Text' }]],
        ['ModifyColumn', 'Test', 'name', { type: 'Numeric' }]
      ]);
      
      const columns = await mock.fetchTable('_grist_Tables_column');
      const nameCol = columns.colId.indexOf('name');
      expect(columns.type[nameCol]).toBe('Numeric');
    });
  });
  
  describe('Échecs injectables', () => {
    it('devrait échouer sur une action configurée', async () => {
      let actionCount = 0;
      mock = createMockGrist({
        shouldFailAction: (action, index) => {
          actionCount++;
          return actionCount === 2; // Échouer sur la 2ème action
        }
      });
      
      await expect(mock.applyUserActions([
        ['AddTable', 'Test1', [{ id: 'name', type: 'Text' }]],
        ['AddTable', 'Test2', [{ id: 'name', type: 'Text' }]]
      ])).rejects.toThrow('ACTION_FAILED');
      
      // Vérifier que Test1 a été créé mais pas Test2 (rollback)
      const tables = await mock.listTables();
      expect(tables).not.toContain('Test2');
    });
    
    it('devrait restaurer l\'état en cas d\'échec', async () => {
      let callIndex = 0;
      mock = createMockGrist({
        shouldFailAction: (action, index) => {
          return index === 1; // Échouer sur la 2ème action du batch
        }
      });
      
      const initialState = {
        Existing: [{ id: 1, name: 'Initial' }]
      };
      
      mock = createMockGrist({
        initialData: initialState,
        shouldFailAction: (action, index) => index === 1
      });
      
      await expect(mock.applyUserActions([
        ['AddTable', 'NewTable', [{ id: 'name', type: 'Text' }]],
        ['AddRecord', 'NewTable', null, { name: 'Test' }]
      ])).rejects.toThrow();
      
      // Après rollback, NewTable ne devrait pas exister
      const tables = await mock.listTables();
      expect(tables).toContain('Existing');
      expect(tables).not.toContain('NewTable');
    });
  });
  
  describe('Idempotence', () => {
    it('devrait être idempotent pour AddTable', async () => {
      await mock.applyUserActions([
        ['AddTable', 'Test', [{ id: 'name', type: 'Text' }]]
      ]);
      
      await expect(mock.applyUserActions([
        ['AddTable', 'Test', [{ id: 'name', type: 'Text' }]]
      ])).resolves.toBeDefined();
      
      const tables = await mock.listTables();
      expect(tables.filter(t => t === 'Test').length).toBe(1);
    });
    
    it('devrait être idempotent pour AddColumn', async () => {
      await mock.applyUserActions([
        ['AddTable', 'Test', [{ id: 'name', type: 'Text' }]],
        ['AddColumn', 'Test', 'value', { type: 'Numeric' }]
      ]);
      
      await expect(mock.applyUserActions([
        ['AddColumn', 'Test', 'value', { type: 'Numeric' }]
      ])).resolves.toBeDefined();
      
      const test = await mock.fetchTable('Test');
      expect(test.value).toBeDefined();
    });
  });
  
  describe('Rollback avec erreur naturelle', () => {
    it('devrait restaurer l\'état complet quand une action lève naturellement', async () => {
      const initialState = {
        Existing: [{ id: 1, name: 'Initial' }]
      };
      
      mock = createMockGrist({
        initialData: initialState
      });
      
      // Première action réussit, deuxième action lève naturellement (RemoveRecord sur ligne inexistante)
      await expect(mock.applyUserActions([
        ['AddTable', 'NewTable', [{ id: 'name', type: 'Text' }]],
        ['AddRecord', 'NewTable', null, { name: 'Test' }],
        ['RemoveRecord', 'NewTable', 999] // Cette ligne n'existe pas -> erreur
      ])).rejects.toThrow();
      
      // Après rollback, NewTable ne devrait pas exister
      const tables = await mock.listTables();
      expect(tables).toContain('Existing');
      expect(tables).not.toContain('NewTable');
      
      // Vérifier que les données existantes sont intactes
      const existing = await mock.fetchTable('Existing');
      expect(existing.id).toEqual([1]);
      expect(existing.name).toEqual(['Initial']);
    });
    
    it('devrait préserver types et métadonnées après rollback', async () => {
      const initialState = {
        Typed: [{ id: 1, value: 42 }]
      };
      
      mock = createMockGrist({
        initialData: initialState
      });
      
      // Obtenir l'état initial des métadonnées
      const initialColumns = await mock.fetchTable('_grist_Tables_column');
      const initialTypedCol = initialColumns.colId.indexOf('value');
      const initialType = initialColumns.type[initialTypedCol];
      
      // Tenter une opération qui échoue
      await expect(mock.applyUserActions([
        ['AddColumn', 'Typed', 'newCol', { type: 'Text' }],
        ['RemoveRecord', 'Typed', 999] // Erreur
      ])).rejects.toThrow();
      
      // Vérifier que les métadonnées sont restaurées
      const afterColumns = await mock.fetchTable('_grist_Tables_column');
      const afterTypedCol = afterColumns.colId.indexOf('value');
      const afterType = afterColumns.type[afterTypedCol];
      
      expect(afterType).toBe(initialType);
    });
  });
});
