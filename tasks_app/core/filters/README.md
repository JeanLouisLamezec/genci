# TaskFlow - Tests du Système de Filtrage

Ce dossier contient les tests unitaires et d'intégration pour le système de filtrage TaskFlow, en particulier le filtre **Programmes**.

---

## 📁 Structure des Fichiers

```
core/filters/
├── filter-manager.js          # Implémentation principale
├── filter-manager.test.js     # Tests unitaires (Jest/Mocha)
├── test-runner.html           # Tests dans le browser
└── README.md                  # Ce fichier
```

---

## 🧪 Exécuter les Tests

```bash
# Installer Jest (si pas déjà fait)
npm install --save-dev jest

# Lancer les tests
npm test -- core/filters/filter-manager.test.js

# Mode watch (dev)
npm test -- --watch core/filters/filter-manager.test.js
```

**Configuration Jest requise** (`package.json`) :

```json
{
  "jest": {
    "testEnvironment": "jsdom",
    "testMatch": ["**/*.test.js"],
    "verbose": true
  }
}
```

---

## 📝 Couverture des Tests

### Tests Implémentés

| Catégorie | Nombre | Statut |
|-----------|--------|--------|
| Filtre Programme | 10 | ✅ |
| Gestion des erreurs | 4 | ✅ |
| Synchronisation UI | 4 | ✅ |
| Post-Filter Kanban | 1 | ✅ |
| **Total** | **19** | **✅** |

### Scénarios Testés

#### ✅ Filtre Programme
- Filtrage par ID (1 et 2)
- Aucun filtre (toutes les tâches)
- Rétrocompatibilité `portefeuille`
- Priorité `programme` sur `portefeuille`
- Tâches sans projet
- Projets sans programme
- Combinaison avec autres filtres (assignee, team)
- IDs string vs number

#### ✅ Gestion des Erreurs
- `filters[type]` undefined
- `data.projects` undefined
- Tâches sans champ projet
- UI non initialisée

#### ✅ UI
- Initialisation des sections
- Compteur de filtres
- Clear all
- Filtres externes (Grist)

#### ✅ Post-Filter
- Filtrage Kanban (Actions → Tasks)

---

## 🔧 Ajouter de Nouveaux Tests

### Template de Test

```javascript
describe('FilterManager - [Nouveau Feature]', () => {
  
  it('doit [comportement attendu]', () => {
    const fm = createFilterManager({
      initialFilters: { 
        // ...
      }
    });
    
    const result = fm.filterTasks(mockData.tasks);
    
    expect(result.length).to.equal(X);
    expect(result[0].id).to.equal(Y);
  });
});
```

### Mock Data

Utiliser `mockData` comme base et étendre si besoin :

```javascript
const extendedData = {
  ...mockData,
  programmes: [
    ...mockData.programmes,
    { id: 3, nom: 'Nouveau Programme' }
  ]
};
```

---

## 🐛 Debugging

### Console Debug

```javascript
// Dans filter-manager.test.js
console.log('Filters:', fm.filters);
console.log('Filtered tasks:', filtered.map(t => t.id));
```

### Browser DevTools

1. Ouvrir `test-runner.html`
2. F12 → Console
3. Inspecter `window.filterManager` (si exposé)

### Stats de Performance

```javascript
console.time('filter');
fm.filterTasks(mockData.tasks);
console.timeEnd('filter');
// Exemple: filter: 2.345ms
```

---

## 📊 Métriques

### Objectifs de Performance

| Métrique | Objectif | Actuel |
|----------|----------|--------|
| Temps de filtrage (1000 tâches) | < 10ms | ~5ms |
| Temps de render UI | < 50ms | ~30ms |
| Coverage tests | > 80% | ~75% |

### Comment Améliorer

1. **Performance** : Indexation des projects (voir `FILTER_SYSTEM.md`)
2. **Coverage** : Ajouter tests edge cases
3. **Maintenabilité** : Refactorer vers `FilterEngine`

---

## 🚀 Intégration Continue

### GitHub Actions

```yaml
# .github/workflows/tests.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v2
    
    - name: Setup Node
      uses: actions/setup-node@v2
      with:
        node-version: '18'
    
    - name: Install dependencies
      run: npm install
    
    - name: Run tests
      run: npm test -- core/filters/filter-manager.test.js
```

### Checks Requis

- [ ] Tous les tests passent
- [ ] Coverage > 80%
- [ ] Performance OK (benchmark)

---

## 📚 Ressources

- **Documentation** : `docs/FILTER_SYSTEM.md`
- **Refactoring** : `docs/FILTER_TESTS_REFACTOR.md`
- **Implémentation** : `filter-manager.js`

---

## ❓ FAQ

**Q: Pourquoi Mocha et pas Jest pour le browser ?**  
R: Mocha est plus léger en CDN et ne nécessite pas de bundler.

**Q: Comment tester dans Grist ?**  
R: Les tests sont unitaires. Pour l'intégration Grist, voir les tests manuels dans `FILTER_SYSTEM.md`.

**Q: Puis-je modifier `mockData` ?**  
R: Oui, mais attention à ne pas casser les tests existants. Créer un nouveau dataset si besoin.

---

*Dernière mise à jour : Juillet 2026*
