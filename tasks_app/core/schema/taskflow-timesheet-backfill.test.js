/**
 * Tests unitaires pour taskflow-timesheet-backfill.js
 * 
 * Tests du module pur de planification du rattachement TimeEntries → Feuilles
 */

'use strict';

const TaskFlowBackfill = require('./taskflow-timesheet-backfill.js');

describe('TaskFlow Timesheet Backfill - Helpers', () => {
    
    describe('normalizeId', () => {
        test('normalise un ID numérique', () => {
            expect(TaskFlowBackfill.normalizeId(1)).toBe(1);
            expect(TaskFlowBackfill.normalizeId(123)).toBe(123);
        });

        test('normalise un ID string', () => {
            expect(TaskFlowBackfill.normalizeId('1')).toBe(1);
            expect(TaskFlowBackfill.normalizeId('123')).toBe(123);
        });

        test('retourne null pour les valeurs nulles', () => {
            expect(TaskFlowBackfill.normalizeId(null)).toBe(null);
            expect(TaskFlowBackfill.normalizeId(undefined)).toBe(null);
            expect(TaskFlowBackfill.normalizeId('')).toBe(null);
        });

        test('retourne null pour les valeurs non numériques', () => {
            expect(TaskFlowBackfill.normalizeId('abc')).toBe(null);
            expect(TaskFlowBackfill.normalizeId({})).toBe(null);
        });
    });

    describe('normalizeDateValue', () => {
        test('normalise une date Grist en secondes', () => {
            // 1719792000 = 2024-07-01 00:00:00 UTC
            const result = TaskFlowBackfill.normalizeDateValue(1719792000);
            expect(result instanceof Date).toBe(true);
            expect(result.getUTCFullYear()).toBe(2024);
            expect(result.getUTCMonth()).toBe(6); // Juillet (0-indexed)
            expect(result.getUTCDate()).toBe(1);
        });

        test('normalise une date Grist en millisecondes', () => {
            const ms = 1719792000000;
            const result = TaskFlowBackfill.normalizeDateValue(ms);
            expect(result instanceof Date).toBe(true);
            expect(result.getUTCDate()).toBe(1);
        });

        test('normalise une date ISO', () => {
            const result = TaskFlowBackfill.normalizeDateValue('2024-07-01');
            expect(result instanceof Date).toBe(true);
            expect(result.getUTCFullYear()).toBe(2024);
            expect(result.getUTCMonth()).toBe(6);
            expect(result.getUTCDate()).toBe(1);
        });

        test('retourne null pour les valeurs nulles', () => {
            expect(TaskFlowBackfill.normalizeDateValue(null)).toBe(null);
            expect(TaskFlowBackfill.normalizeDateValue(undefined)).toBe(null);
            expect(TaskFlowBackfill.normalizeDateValue('')).toBe(null);
        });
    });

    describe('getWeekStart', () => {
        test('lundi → retourne le même jour', () => {
            // 2024-07-01 est un lundi
            const monday = new Date(Date.UTC(2024, 6, 1));
            const result = TaskFlowBackfill.getWeekStart(monday);
            expect(formatDateKey(result)).toBe('2024-07-01');
        });

        test('mardi → retourne le lundi précédent', () => {
            // 2024-07-02 est un mardi
            const tuesday = new Date(Date.UTC(2024, 6, 2));
            const result = TaskFlowBackfill.getWeekStart(tuesday);
            expect(formatDateKey(result)).toBe('2024-07-01');
        });

        test('dimanche → retourne le lundi précédent', () => {
            // 2024-06-30 est un dimanche
            const sunday = new Date(Date.UTC(2024, 5, 30));
            const result = TaskFlowBackfill.getWeekStart(sunday);
            expect(formatDateKey(result)).toBe('2024-06-24');
        });

        test('gère le passage à l\'heure d\'été', () => {
            // 2024-03-31 est un dimanche (passage heure d'été en France : 31 mars 2024)
            const sunday = new Date(Date.UTC(2024, 2, 31));
            const result = TaskFlowBackfill.getWeekStart(sunday);
            // Lundi précédent : 25 mars 2024
            expect(formatDateKey(result)).toBe('2024-03-25');
        });

        test('gère le passage à l\'heure d\'hiver', () => {
            // 2024-10-27 est un dimanche (passage heure d'hiver en France : 27 octobre 2024)
            const sunday = new Date(Date.UTC(2024, 9, 27));
            const result = TaskFlowBackfill.getWeekStart(sunday);
            // Lundi précédent : 21 octobre 2024
            expect(formatDateKey(result)).toBe('2024-10-21');
        });

        test('retourne null pour une date invalide', () => {
            expect(TaskFlowBackfill.getWeekStart(null)).toBe(null);
            expect(TaskFlowBackfill.getWeekStart(new Date(NaN))).toBe(null);
        });

        test('ne dépend pas de l\'heure actuelle', () => {
            const date1 = new Date(Date.UTC(2024, 6, 1, 0, 0, 0));
            const date2 = new Date(Date.UTC(2024, 6, 1, 23, 59, 59));
            const result1 = TaskFlowBackfill.getWeekStart(date1);
            const result2 = TaskFlowBackfill.getWeekStart(date2);
            expect(formatDateKey(result1)).toBe(formatDateKey(result2));
        });
    });

    describe('buildSheetKey', () => {
        test('construit une clé canonique', () => {
            const weekStart = new Date(Date.UTC(2024, 6, 1));
            const key = TaskFlowBackfill.buildSheetKey(2, weekStart);
            expect(key).toBe('2:2024-07-01');
        });

        test('retourne null si membre invalide', () => {
            const weekStart = new Date(Date.UTC(2024, 6, 1));
            const key = TaskFlowBackfill.buildSheetKey(null, weekStart);
            expect(key).toBe(null);
        });

        test('retourne null si semaine invalide', () => {
            const key = TaskFlowBackfill.buildSheetKey(2, null);
            expect(key).toBe(null);
        });
    });
});

describe('TaskFlow Timesheet Backfill - Inspection', () => {
    
    test('aucune donnée', () => {
        const result = TaskFlowBackfill.inspect({ team: [], sheets: [], entries: [] });
        expect(result.conflicts.length).toBe(0);
        expect(result.summary.teamCount).toBe(0);
        expect(result.summary.sheetCount).toBe(0);
        expect(result.summary.entryCount).toBe(0);
    });

    test('une entrée sans feuille', () => {
        const result = TaskFlowBackfill.inspect({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [],
            entries: [{
                id: 1,
                membre: 1,
                date: 1719792000, // 2024-07-01
                heures: 3.5
            }]
        });
        
        expect(result.conflicts.length).toBe(0);
        expect(result.warnings.length).toBe(0);
        expect(Object.keys(result.entriesBySheetKey).length).toBe(1);
    });

    test('membre absent', () => {
        const result = TaskFlowBackfill.inspect({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [],
            entries: [{
                id: 1,
                membre: 999, // Membre inexistant
                date: 1719792000,
                heures: 3.5
            }]
        });
        
        expect(result.conflicts.length).toBe(1);
        expect(result.conflicts[0].code).toBe('TIME_ENTRY_MEMBER_INVALID');
    });

    test('date absente', () => {
        const result = TaskFlowBackfill.inspect({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [],
            entries: [{
                id: 1,
                membre: 1,
                date: null,
                heures: 3.5
            }]
        });
        
        expect(result.conflicts.length).toBe(1);
        expect(result.conflicts[0].code).toBe('TIME_ENTRY_DATE_INVALID');
    });

    test('feuille sans membre', () => {
        const result = TaskFlowBackfill.inspect({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [{
                id: 1,
                membre: null,
                semaine: 1719792000,
                statut: 'brouillon'
            }],
            entries: []
        });
        
        expect(result.conflicts.length).toBe(1);
        expect(result.conflicts[0].code).toBe('SHEET_MEMBER_INVALID');
    });

    test('feuille avec semaine non canonique', () => {
        // 2024-07-02 est un mardi, pas un lundi
        const result = TaskFlowBackfill.inspect({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [{
                id: 1,
                membre: 1,
                semaine: 1719878400, // 2024-07-02 (mardi)
                statut: 'brouillon'
            }],
            entries: []
        });
        
        expect(result.warnings.length).toBe(1);
        expect(result.warnings[0].code).toBe('SHEET_WEEK_NOT_CANONICAL');
    });

    test('doublon de feuilles', () => {
        const result = TaskFlowBackfill.inspect({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [
                {
                    id: 1,
                    membre: 1,
                    semaine: 1719792000, // 2024-07-01 (lundi)
                    statut: 'brouillon'
                },
                {
                    id: 2,
                    membre: 1,
                    semaine: 1719792000, // Même semaine
                    statut: 'brouillon'
                }
            ],
            entries: []
        });
        
        expect(result.conflicts.length).toBe(1);
        expect(result.conflicts[0].code).toBe('DUPLICATE_SHEETS');
        expect(result.conflicts[0].sheetIds).toContain(1);
        expect(result.conflicts[0].sheetIds).toContain(2);
    });

    test('lien vers une feuille absente', () => {
        const result = TaskFlowBackfill.inspect({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [],
            entries: [{
                id: 1,
                membre: 1,
                date: 1719792000,
                heures: 3.5,
                feuille: 999 // Feuille inexistante
            }]
        });
        
        expect(result.conflicts.length).toBe(1);
        expect(result.conflicts[0].code).toBe('TIME_ENTRY_SHEET_NOT_FOUND');
    });

    test('mismatch membre', () => {
        const result = TaskFlowBackfill.inspect({
            team: [
                { id: 1, nom: 'Alice' },
                { id: 2, nom: 'Bob' }
            ],
            sheets: [{
                id: 1,
                membre: 1, // Alice
                semaine: 1719792000,
                statut: 'brouillon'
            }],
            entries: [{
                id: 1,
                membre: 2, // Bob
                date: 1719792000,
                heures: 3.5,
                feuille: 1 // Lie à la feuille d'Alice
            }]
        });
        
        expect(result.conflicts.length).toBe(1);
        expect(result.conflicts[0].code).toBe('TIME_ENTRY_SHEET_MEMBER_MISMATCH');
    });

    test('mismatch semaine', () => {
        const result = TaskFlowBackfill.inspect({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [{
                id: 1,
                membre: 1,
                semaine: 1719792000, // Semaine du 2024-07-01
                statut: 'brouillon'
            }],
            entries: [{
                id: 1,
                membre: 1,
                date: 1720396800, // 2024-07-08 (semaine suivante)
                heures: 3.5,
                feuille: 1
            }]
        });
        
        expect(result.conflicts.length).toBe(1);
        expect(result.conflicts[0].code).toBe('TIME_ENTRY_SHEET_WEEK_MISMATCH');
    });

    test('lien existant correct', () => {
        const result = TaskFlowBackfill.inspect({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [{
                id: 1,
                membre: 1,
                semaine: 1719792000,
                statut: 'brouillon'
            }],
            entries: [{
                id: 1,
                membre: 1,
                date: 1719792000,
                heures: 3.5,
                feuille: 1 // Lien correct
            }]
        });
        
        expect(result.conflicts.length).toBe(0);
        expect(result.warnings.length).toBe(0);
    });
});

describe('TaskFlow Timesheet Backfill - Build Plan', () => {
    
    test('aucune donnée', () => {
        const plan = TaskFlowBackfill.buildPlan({ team: [], sheets: [], entries: [] });
        expect(plan.valid).toBe(true);
        expect(plan.creates.length).toBe(0);
        expect(plan.linksToExistingSheets.length).toBe(0);
        expect(plan.preservedLinks.length).toBe(0);
        expect(plan.conflicts.length).toBe(0);
    });

    test('une entrée sans feuille → création d\'une feuille', () => {
        const plan = TaskFlowBackfill.buildPlan({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [],
            entries: [{
                id: 1,
                membre: 1,
                date: 1719792000, // 2024-07-01 (lundi)
                heures: 3.5
            }]
        });
        
        expect(plan.valid).toBe(true);
        expect(plan.creates.length).toBe(1);
        expect(plan.creates[0].key).toBe('1:2024-07-01');
        expect(plan.creates[0].membre).toBe(1);
        expect(plan.creates[0].statut).toBe('brouillon');
        expect(plan.creates[0].entryIds).toContain(1);
    });

    test('plusieurs entrées de la même semaine → une seule feuille', () => {
        const plan = TaskFlowBackfill.buildPlan({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [],
            entries: [
                { id: 1, membre: 1, date: 1719792000, heures: 3.5 }, // Lundi
                { id: 2, membre: 1, date: 1719878400, heures: 2.0 }, // Mardi
                { id: 3, membre: 1, date: 1719964800, heures: 4.0 }  // Mercredi
            ]
        });
        
        expect(plan.valid).toBe(true);
        expect(plan.creates.length).toBe(1);
        expect(plan.creates[0].entryIds.length).toBe(3);
        expect(plan.linksToExistingSheets.length).toBe(3);
    });

    test('deux membres sur la même semaine → deux feuilles', () => {
        const plan = TaskFlowBackfill.buildPlan({
            team: [
                { id: 1, nom: 'Alice' },
                { id: 2, nom: 'Bob' }
            ],
            sheets: [],
            entries: [
                { id: 1, membre: 1, date: 1719792000, heures: 3.5 },
                { id: 2, membre: 2, date: 1719792000, heures: 2.0 }
            ]
        });
        
        expect(plan.valid).toBe(true);
        expect(plan.creates.length).toBe(2);
        expect(plan.creates[0].key).toBe('1:2024-07-01');
        expect(plan.creates[1].key).toBe('2:2024-07-01');
    });

    test('feuille existante → rattachement sans création', () => {
        const plan = TaskFlowBackfill.buildPlan({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [{
                id: 10,
                membre: 1,
                semaine: 1719792000,
                statut: 'brouillon'
            }],
            entries: [{
                id: 1,
                membre: 1,
                date: 1719792000,
                heures: 3.5
            }]
        });
        
        expect(plan.valid).toBe(true);
        expect(plan.creates.length).toBe(0);
        expect(plan.linksToExistingSheets.length).toBe(1);
        expect(plan.linksToExistingSheets[0].entryId).toBe(1);
        expect(plan.linksToExistingSheets[0].sheetId).toBe(10);
    });

    test('lien existant correct → préservé', () => {
        const plan = TaskFlowBackfill.buildPlan({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [{
                id: 10,
                membre: 1,
                semaine: 1719792000,
                statut: 'brouillon'
            }],
            entries: [{
                id: 1,
                membre: 1,
                date: 1719792000,
                heures: 3.5,
                feuille: 10
            }]
        });
        
        expect(plan.valid).toBe(true);
        expect(plan.creates.length).toBe(0);
        expect(plan.linksToExistingSheets.length).toBe(0);
        expect(plan.preservedLinks.length).toBe(1);
        expect(plan.preservedLinks[0].entryId).toBe(1);
        expect(plan.preservedLinks[0].sheetId).toBe(10);
    });

    test('conflit de doublon → plan invalide', () => {
        const plan = TaskFlowBackfill.buildPlan({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [
                { id: 1, membre: 1, semaine: 1719792000, statut: 'brouillon' },
                { id: 2, membre: 1, semaine: 1719792000, statut: 'brouillon' }
            ],
            entries: [{
                id: 1,
                membre: 1,
                date: 1719792000,
                heures: 3.5
            }]
        });
        
        expect(plan.valid).toBe(false);
        expect(plan.conflicts.length).toBeGreaterThan(0);
        expect(plan.conflicts.some(c => c.code === 'DUPLICATE_SHEETS')).toBe(true);
    });

    test('ordre d\'entrée différent → même plan', () => {
        const entries1 = [
            { id: 1, membre: 1, date: 1719792000, heures: 3.5 },
            { id: 2, membre: 1, date: 1719878400, heures: 2.0 }
        ];
        
        const entries2 = [
            { id: 2, membre: 1, date: 1719878400, heures: 2.0 },
            { id: 1, membre: 1, date: 1719792000, heures: 3.5 }
        ];
        
        const plan1 = TaskFlowBackfill.buildPlan({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [],
            entries: entries1
        });
        
        const plan2 = TaskFlowBackfill.buildPlan({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [],
            entries: entries2
        });
        
        // Les créations doivent être identiques (triées)
        expect(plan1.creates.length).toBe(plan2.creates.length);
        expect(JSON.stringify(plan1.creates.map(c => c.key)))
            .toBe(JSON.stringify(plan2.creates.map(c => c.key)));
    });

    test('immuabilité : ne modifie pas les données reçues', () => {
        const entries = [
            { id: 1, membre: 1, date: 1719792000, heures: 3.5 }
        ];
        
        const entriesCopy = JSON.parse(JSON.stringify(entries));
        
        TaskFlowBackfill.buildPlan({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [],
            entries: entries
        });
        
        expect(JSON.stringify(entries)).toBe(JSON.stringify(entriesCopy));
    });
});

describe('TaskFlow Timesheet Backfill - Verify Final State', () => {
    
    test('état valide', () => {
        const result = TaskFlowBackfill.verifyFinalState({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [{
                id: 1,
                membre: 1,
                semaine: 1719792000,
                statut: 'brouillon'
            }],
            entries: [{
                id: 1,
                membre: 1,
                date: 1719792000,
                heures: 3.5,
                feuille: 1
            }]
        });
        
        expect(result.valid).toBe(true);
        expect(result.conflicts.length).toBe(0);
    });

    test('TimeEntry sans feuille', () => {
        const result = TaskFlowBackfill.verifyFinalState({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [],
            entries: [{
                id: 1,
                membre: 1,
                date: 1719792000,
                heures: 3.5
            }]
        });
        
        expect(result.valid).toBe(false);
        expect(result.conflicts.some(c => c.code === 'TIME_ENTRY_WITHOUT_SHEET')).toBe(true);
    });

    test('doublon de feuilles', () => {
        const result = TaskFlowBackfill.verifyFinalState({
            team: [{ id: 1, nom: 'Alice' }],
            sheets: [
                { id: 1, membre: 1, semaine: 1719792000, statut: 'brouillon' },
                { id: 2, membre: 1, semaine: 1719792000, statut: 'brouillon' }
            ],
            entries: []
        });
        
        expect(result.valid).toBe(false);
        expect(result.conflicts.some(c => c.code === 'DUPLICATE_SHEETS')).toBe(true);
    });
});

// Helper pour formater les dates dans les tests
function formatDateKey(date) {
    if (!date) return null;
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
}
