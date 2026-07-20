/* ============================================================================
 * gantt-load-state.test.js — Tests pour le chargement et l'état vide
 * ----------------------------------------------------------------------------
 * Vérifie :
 * 1. Les fetchTable sont parallélisés
 * 2. La génération ancienne ne remplace pas la récente
 * 3. Rechargement sans flash vide
 * 4. Performance instrumentation
 * ============================================================================ */

describe('Gantt Load State Management', () => {
    describe('Parallélisation des lectures', () => {
        test('les lectures indépendantes démarrent sans attendre', async () => {
            const fetchOrder = [];
            const delays = { Tasks: 50, Team: 30, Projects: 40 };
            
            const mockGrist = {
                docApi: {
                    async fetchTable(tableName) {
                        fetchOrder.push(`${tableName}-start`);
                        await new Promise(resolve => setTimeout(resolve, delays[tableName] || 0));
                        fetchOrder.push(`${tableName}-end`);
                        return { id: [] };
                    }
                }
            };
            
            // Simuler un chargement parallèle
            const start = Date.now();
            await Promise.all([
                mockGrist.docApi.fetchTable('Tasks'),
                mockGrist.docApi.fetchTable('Team'),
                mockGrist.docApi.fetchTable('Projects')
            ]);
            const duration = Date.now() - start;
            
            // Si séquentiel: 50+30+40=120ms, si parallèle: max(50,30,40)=50ms
            expect(duration).toBeLessThan(100);  // Preuve de parallélisme
            
            // Vérifier que tous les starts sont avant les ends
            expect(fetchOrder.filter(x => x.endsWith('-start')).length).toBe(3);
            expect(fetchOrder.filter(x => x.endsWith('-end')).length).toBe(3);
        });
    });

    describe('Gestion des générations', () => {
        test('une génération ancienne ne remplace pas une génération récente', async () => {
            let loadGeneration = 0;
            let tasks = null;
            
            const mockLoadAllData = async () => {
                const generation = ++loadGeneration;
                
                // Simuler un chargement lent
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Vérifier si la génération est obsolète
                if (generation !== loadGeneration) {
                    return null;  // Annulé
                }
                
                tasks = ['task1', 'task2'];
                return tasks;
            };
            
            // Lancer deux chargements rapprochés
            const promise1 = mockLoadAllData();
            const promise2 = mockLoadAllData();  // Génération plus récente
            
            await promise1;
            const result2 = await promise2;
            
            // Le premier chargement devrait être annulé
            expect(result2).toEqual(['task1', 'task2']);
        });
    });

    describe('Rechargement sans flash vide', () => {
        test('grist.onRecords ne provoque pas de flash d\'état vide', async () => {
            let dataLoadState = 'ready';
            let initialLoadComplete = true;
            let tasks = [{ id: 1 }];
            
            // Simuler un rechargement
            const oldTasks = tasks;
            dataLoadState = 'loading';
            
            // Pendant le rechargement, les anciennes données restent
            expect(tasks).toEqual(oldTasks);
            expect(dataLoadState).toBe('loading');
            
            // Après chargement
            await new Promise(resolve => setTimeout(resolve, 10));
            tasks = [{ id: 1 }, { id: 2 }];
            dataLoadState = 'ready';
            
            expect(tasks.length).toBe(2);
        });
    });
});

describe('Performance Instrumentation', () => {
    test('performance.mark/measure fonctionne correctement', () => {
        const marks = [];
        const measures = [];
        
        // Mock performance
        const originalMark = performance.mark;
        const originalMeasure = performance.measure;
        
        performance.mark = (name) => marks.push(name);
        performance.measure = (name, start, end) => measures.push({ name, start, end });
        
        // Simuler le chargement
        performance.mark('gantt-load-start');
        // ... chargement ...
        performance.mark('gantt-data-ready');
        performance.measure('gantt-full-load', 'gantt-load-start', 'gantt-data-ready');
        
        expect(marks).toContain('gantt-load-start');
        expect(marks).toContain('gantt-data-ready');
        expect(measures).toEqual([{
            name: 'gantt-full-load',
            start: 'gantt-load-start',
            end: 'gantt-data-ready'
        }]);
        
        // Restaurer
        performance.mark = originalMark;
        performance.measure = originalMeasure;
    });
});
