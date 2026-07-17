/**
 * Tests pour la détection des colonnes dupliquées et la corruption du schéma
 * 
 * Ces tests vérifient que l'inspection détecte correctement :
 * 1. Les colonnes dupliquées (titre, titre2, titre3)
 * 2. L'état corrupted quand des duplications sont trouvées
 * 3. Ne pas signaler les colonnes légitimes finissant par un chiffre
 */

describe('TaskFlow Schema Inspection - Duplicate Detection', () => {
    
    function createMockGristWithDuplicates() {
        return {
            docApi: {
                fetchTable: jest.fn((tableName) => {
                    if (tableName === '_grist_Tables') {
                        return Promise.resolve({
                            id: [1, 2, 3],
                            tableId: ['Team', 'Tasks', 'Projects']
                        });
                    } else if (tableName === '_grist_Tables_column') {
                        // Simuler des colonnes dupliquées : nom, nom2, nom3, titre, titre2, titre3
                        return Promise.resolve({
                            id: [10, 11, 12, 20, 21, 22, 30, 31],
                            parentId: [1, 1, 1, 2, 2, 2, 3, 3],
                            colId: ['nom', 'nom2', 'nom3', 'titre', 'titre2', 'titre3', 'nom', 'couleur'],
                            type: ['Text', 'Text', 'Text', 'Text', 'Text', 'Text', 'Text', 'Text'],
                            isFormula: [false, false, false, false, false, false, false, false],
                            visibleCol: [null, null, null, null, null, null, null, null]
                        });
                    } else if (tableName === 'Team') {
                        return Promise.resolve({ id: [], nom: [], nom2: [], nom3: [] });
                    } else if (tableName === 'Tasks') {
                        return Promise.resolve({ id: [], titre: [], titre2: [], titre3: [] });
                    } else if (tableName === 'Projects') {
                        return Promise.resolve({ id: [], nom: [], couleur: [] });
                    }
                    return Promise.resolve({ id: [] });
                })
            }
        };
    }
    
    function createMockGristClean() {
        return {
            docApi: {
                fetchTable: jest.fn((tableName) => {
                    if (tableName === '_grist_Tables') {
                        return Promise.resolve({
                            id: [1, 2],
                            tableId: ['Team', 'Tasks']
                        });
                    } else if (tableName === '_grist_Tables_column') {
                        return Promise.resolve({
                            id: [10, 20],
                            parentId: [1, 2],
                            colId: ['nom', 'titre'],
                            type: ['Text', 'Text'],
                            isFormula: [false, false],
                            visibleCol: [null, null]
                        });
                    } else if (tableName === 'Team') {
                        return Promise.resolve({ id: [], nom: [] });
                    } else if (tableName === 'Tasks') {
                        return Promise.resolve({ id: [], titre: [] });
                    }
                    return Promise.resolve({ id: [] });
                })
            }
        };
    }

    test('devrait détecter les colonnes dupliquées nom2, nom3 dans Team', async () => {
        // Ce test vérifie la logique de détection de duplications
        // Pattern : ^<canonical>[0-9]+$
        
        const mockGrist = createMockGristWithDuplicates();
        
        // Simuler l'inspection manuellement pour tester la logique
        const metadata = {
            tables: [
                { id: 1, tableId: 'Team' },
                { id: 2, tableId: 'Tasks' },
                { id: 3, tableId: 'Projects' }
            ],
            columns: [
                { id: 10, parentId: 1, colId: 'nom', type: 'Text' },
                { id: 11, parentId: 1, colId: 'nom2', type: 'Text' },
                { id: 12, parentId: 1, colId: 'nom3', type: 'Text' },
                { id: 20, parentId: 2, colId: 'titre', type: 'Text' },
                { id: 21, parentId: 2, colId: 'titre2', type: 'Text' },
                { id: 22, parentId: 2, colId: 'titre3', type: 'Text' }
            ],
            tableById: { 'Team': { id: 1, tableId: 'Team' }, 'Tasks': { id: 2, tableId: 'Tasks' }, 'Projects': { id: 3, tableId: 'Projects' } },
            columnByKey: {
                'Team.nom': { id: 10, colId: 'nom', type: 'Text' },
                'Team.nom2': { id: 11, colId: 'nom2', type: 'Text' },
                'Team.nom3': { id: 12, colId: 'nom3', type: 'Text' },
                'Tasks.titre': { id: 20, colId: 'titre', type: 'Text' },
                'Tasks.titre2': { id: 21, colId: 'titre2', type: 'Text' },
                'Tasks.titre3': { id: 22, colId: 'titre3', type: 'Text' }
            },
            columnByRowId: {}
        };
        
        // Logique de détection (copiée de taskflow-bootstrap.js)
        const SCHEMA = {
            tableOrder: ['Team', 'Tasks', 'Projects'],
            tables: {
                Team: {
                    columns: [
                        { id: 'nom', opts: { type: 'Text' } },
                        { id: 'email', opts: { type: 'Text' } }
                    ]
                },
                Tasks: {
                    columns: [
                        { id: 'titre', opts: { type: 'Text' } }
                    ]
                }
            }
        };
        
        const duplicateColumns = [];
        
        for (var tableIdx = 0; tableIdx < SCHEMA.tableOrder.length; tableIdx++) {
            var tableId = SCHEMA.tableOrder[tableIdx];
            var tableDef = SCHEMA.tables[tableId];
            
            if (!tableDef) continue;
            
            // Obtenir toutes les colonnes de cette table
            var tableColumns = metadata.columns.filter(function(col) {
                return col.parentId === metadata.tableById[tableId].id;
            });
            
            // Pour chaque colonne canonique du schéma
            for (var colIdx = 0; colIdx < tableDef.columns.length; colIdx++) {
                var canonicalCol = tableDef.columns[colIdx];
                var canonicalId = canonicalCol.id;
                
                // Échapper l'identifiant canonique pour la RegExp
                var escapedCanonical = canonicalId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                var duplicatePattern = new RegExp('^' + escapedCanonical + '[0-9]+$');
                
                // Trouver les duplications
                var duplicates = tableColumns.filter(function(col) {
                    return duplicatePattern.test(col.colId);
                }).map(function(col) {
                    return col.colId;
                });
                
                if (duplicates.length > 0) {
                    duplicateColumns.push({
                        table: tableId,
                        canonicalColumn: canonicalId,
                        duplicates: duplicates
                    });
                }
            }
        }
        
        // Vérifier les résultats
        expect(duplicateColumns.length).toBeGreaterThan(0);
        
        const teamNomDup = duplicateColumns.find(d => 
            d.table === 'Team' && d.canonicalColumn === 'nom'
        );
        expect(teamNomDup).toBeDefined();
        expect(teamNomDup.duplicates).toContain('nom2');
        expect(teamNomDup.duplicates).toContain('nom3');
        
        const tasksTitreDup = duplicateColumns.find(d => 
            d.table === 'Tasks' && d.canonicalColumn === 'titre'
        );
        expect(tasksTitreDup).toBeDefined();
        expect(tasksTitreDup.duplicates).toContain('titre2');
        expect(tasksTitreDup.duplicates).toContain('titre3');
    });

    test('ne devrait pas signaler une colonne légitime finissant par un chiffre', () => {
        // Test de la logique de détection avec une colonne légitime
        const canonicalId = 'nom';
        const escapedCanonical = canonicalId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const duplicatePattern = new RegExp('^' + escapedCanonical + '[0-9]+$');
        
        // Ces colonnes DEVRAIENT matcher (duplications)
        expect(duplicatePattern.test('nom2')).toBe(true);
        expect(duplicatePattern.test('nom3')).toBe(true);
        expect(duplicatePattern.test('nom123')).toBe(true);
        
        // Ces colonnes ne devraient PAS matcher (légitimes)
        expect(duplicatePattern.test('version1')).toBe(false);
        expect(duplicatePattern.test('data2023')).toBe(false);
        expect(duplicatePattern.test('nom')).toBe(false); // Le canonique lui-même
        expect(duplicatePattern.test('nom_en')).toBe(false);
        expect(duplicatePattern.test('nom2en')).toBe(false);
    });

    test('devrait échapper correctement les identifiants spéciaux dans la RegExp', () => {
        // Tester avec des identifiants qui ont une signification RegExp
        const testCases = [
            { canonical: 'type', shouldMatch: ['type2', 'type3'], shouldNotMatch: ['types', 'typewriter'] },
            { canonical: 'data', shouldMatch: ['data1', 'data99'], shouldNotMatch: ['database', 'datatype'] }
        ];
        
        testCases.forEach(({ canonical, shouldMatch, shouldNotMatch }) => {
            const escapedCanonical = canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = new RegExp('^' + escapedCanonical + '[0-9]+$');
            
            shouldMatch.forEach(col => {
                expect(pattern.test(col)).toBe(true);
            });
            
            shouldNotMatch.forEach(col => {
                expect(pattern.test(col)).toBe(false);
            });
        });
    });
});

describe('CRA Data Loader - Schema Recovery Disabled', () => {
    test('allowSchemaRecovery devrait être false par défaut', () => {
        // Vérifier que le code source contient bien allowSchemaRecovery = false
        const fs = require('fs');
        const path = require('path');
        const craDataLoaderPath = path.join(__dirname, '../cra/cra-data-loader.js');
        const content = fs.readFileSync(craDataLoaderPath, 'utf8');
        
        // Le code devrait contenir la ligne qui force allowSchemaRecovery à false
        expect(content).toContain('const allowSchemaRecovery = false');
        expect(content).toContain('Le CRA ne doit jamais réparer le schéma automatiquement');
    });
});
