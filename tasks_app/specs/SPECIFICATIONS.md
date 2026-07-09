# TaskFlow v6 - Spécifications d'Amélioration

## 🎯 Objectifs Principaux

### 1. Architecture Grist Partagée
- Synchronisation de sélection entre widgets sur une même page
- Configuration centralisée des colonnes via widget options
- Schéma de tables optimal et documenté
- Mode autonome + mode intégré

### 2. Améliorations par Widget

---

## 📋 Schéma de Tables Grist Optimal

### Table `Tasks` (principale)
```
| Colonne       | Type                  | Description                    | Obligatoire |
|---------------|----------------------|--------------------------------|-------------|
| id            | Integer (auto)        | ID unique                      | ✓           |
| titre         | Text                  | Nom de la tâche               | ✓           |
| description   | Text (long)           | Description détaillée          |             |
| dateDebut     | Date                  | Date de début                  | ✓           |
| dateEcheance  | Date                  | Date d'échéance               | ✓           |
| priorite      | Choice (1,2,3,4)      | 1=Critique, 4=Basse           | ✓           |
| statut        | Choice                | À faire, En cours, En revue, Terminé | ✓    |
| progression   | Integer (0-100)       | Pourcentage d'avancement      |             |
| projet        | Reference (Projects)  | Lien vers projet               |             |
| assignees     | Reference List (Team) | Liste des assignés            |             |
| type          | Choice                | tache, jalon, reunion          |             |
| dependDe      | Reference List (Tasks)| Tâches prédécesseurs          |             |
| tags          | Choice List           | Étiquettes                     |             |
| estimationH   | Numeric               | Heures estimées               |             |
| tempsPasse    | Numeric               | Heures passées                |             |
| couleur       | Text                  | Couleur personnalisée (#hex)  |             |
```

### Table `Team` (équipe)
```
| Colonne       | Type           | Description              |
|---------------|----------------|--------------------------|
| id            | Integer (auto) | ID unique                |
| nom           | Text           | Nom complet              |
| email         | Text           | Email                    |
| avatar        | Text           | URL ou initiales         |
| role          | Choice         | Rôle dans l'équipe       |
| actif         | Bool           | Membre actif             |
```

### Table `Projects` (projets)
```
| Colonne       | Type           | Description              |
|---------------|----------------|--------------------------|
| id            | Integer (auto) | ID unique                |
| nom           | Text           | Nom du projet            |
| couleur       | Text           | Couleur (#hex)           |
| dateDebut     | Date           | Date de début projet     |
| dateFin       | Date           | Date de fin prévue       |
| responsable   | Reference(Team)| Chef de projet           |
| actif         | Bool           | Projet actif             |
```

### Table `StatusConfig` (configuration statuts - pour Kanban)
```
| Colonne       | Type           | Description              |
|---------------|----------------|--------------------------|
| id            | Integer (auto) | ID unique                |
| nom           | Text           | Nom du statut            |
| couleur       | Text           | Couleur (#hex)           |
| ordre         | Integer        | Position dans le kanban  |
| icone         | Text           | Emoji ou icône           |
```

---

## 🔗 Synchronisation Grist Inter-Widgets

### Mécanisme de sélection partagée
```javascript
// Chaque widget écoute les changements de sélection
grist.onRecord((record) => {
    // Mise à jour de la sélection locale
    selectedTaskId = record?.id || null;
    highlightSelectedTask();
});

// Chaque widget notifie Grist de sa sélection
function selectTask(taskId) {
    selectedTaskId = taskId;
    grist.setSelectedRows([taskId]);
    highlightSelectedTask();
}
```

### Configuration via Widget Options
```javascript
grist.onOptions((options) => {
    // Kanban: champ de catégorie
    config.groupByColumn = options?.groupByColumn || 'statut';
    
    // Gantt: affichage
    config.showDependencies = options?.showDependencies !== false;
    config.defaultView = options?.defaultView || 'month';
    
    // Tous: filtres par défaut
    config.defaultProject = options?.defaultProject || null;
});
```

---

## 📊 KANBAN - Améliorations v6

### 1. Colonnes Configurables
- **Champ de regroupement** : Sélectionnable (statut, projet, priorité, assigné, tag)
- **Ajout de colonne** : Bouton "+" discret pour créer une nouvelle valeur
- **Réorganisation** : Drag & drop des colonnes entières

### 2. Modale de Création/Édition
```
┌─────────────────────────────────────────────────┐
│ ✏️ Nouvelle tâche                          [×] │
├─────────────────────────────────────────────────┤
│ Titre *                                         │
│ [___________________________________________]   │
│                                                 │
│ Description                                     │
│ [___________________________________________]   │
│ [___________________________________________]   │
│                                                 │
│ ┌─────────────┐ ┌─────────────┐                │
│ │ Dates       │ │ Affectation │                │
│ │ Début: [__] │ │ [Assignés ▼]│                │
│ │ Fin:   [__] │ │ [Projet   ▼]│                │
│ └─────────────┘ └─────────────┘                │
│                                                 │
│ ┌─────────────┐ ┌─────────────┐                │
│ │ Priorité    │ │ Type        │                │
│ │ [●○○○ Crit.]│ │ [Tâche    ▼]│                │
│ └─────────────┘ └─────────────┘                │
│                                                 │
│ Progression    [====____] 40%                   │
│                                                 │
│ Tags  [Backend] [+]                             │
│                                                 │
├─────────────────────────────────────────────────┤
│                      [Annuler]  [💾 Enregistrer]│
└─────────────────────────────────────────────────┘
```

### 3. Filtres Avancés
- Recherche textuelle (titre, description)
- Multi-filtres combinables (projet + priorité + assigné)
- Sauvegarde des filtres favoris
- Indicateur visuel des filtres actifs

### 4. Carte de Tâche Optimisée
```
┌────────────────────────────────────┐
│ │ Titre de la tâche               │ ← Barre de priorité
│ │                                 │
│ │ [Critique] [Backend]            │ ← Badges
│ │                                 │
│ │ 📅 14 févr. ━━━━━━ 60%    👤👤 │ ← Date, progress, avatars
│ │                                 │
│ │ ◆ Jalon (si applicable)        │
└────────────────────────────────────┘
```

---

## 📈 GANTT - Améliorations v6

### 1. Scroll Continu (Infinite Scroll)
- Pas de "période" fixe - navigation fluide
- Chargement dynamique des cellules
- Performance optimisée (virtual scrolling)

### 2. Dépendances Visuelles Améliorées
```
Types de liaisons:
- Fin → Début (FS) : Standard
- Début → Début (SS)
- Fin → Fin (FF)
- Début → Fin (SF)

Affichage:
- Lignes courbes Bézier
- Flèches directionnelles
- Surlignage au hover
- Clic pour sélectionner la liaison
```

### 3. Jalons Distincts
- Diamant plus visible
- Label toujours affiché
- Icône différenciée (★ pour release, ◆ pour review, etc.)

### 4. Modale Gantt Complète
```
┌─────────────────────────────────────────────────────┐
│ 📊 Détails de la tâche                        [×]  │
├─────────────────────────────────────────────────────┤
│ [Dev Frontend]                                      │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 40%                  │
│                                                     │
│ ┌─────────────────┬─────────────────┐              │
│ │ 📅 Dates        │ 👥 Équipe       │              │
│ │ Début: 04 févr. │ Alice Martin    │              │
│ │ Fin:   19 févr. │ Bob Durant      │              │
│ │ Durée: 15 jours │                 │              │
│ └─────────────────┴─────────────────┘              │
│                                                     │
│ 🔗 Dépendances                                      │
│ ← Design UI (doit finir avant)                     │
│ → Tests QA (attend cette tâche)                    │
│                                                     │
│ 📝 Notes                                            │
│ [_____________________________________________]     │
│                                                     │
├─────────────────────────────────────────────────────┤
│ [Éditer dans Grist]              [Fermer]          │
└─────────────────────────────────────────────────────┘
```

### 5. Suggestions d'Optimisation
- ⚠️ Tâche en retard (échéance dépassée, progression < 100%)
- 🔄 Conflit de ressources (même assigné, même période)
- 📊 Chemin critique (tâches impactant la date de fin)

---

## 📅 CALENDAR - Améliorations v6

### 1. Types d'Événements
- **Tâche** : Avec durée (barre sur plusieurs jours)
- **Jalon** : Ponctuel (diamant)
- **Réunion** : Créneau horaire (pour vue semaine)

### 2. Modale de Création Rapide
```
┌─────────────────────────────────────────┐
│ + Nouvel événement              [×]     │
├─────────────────────────────────────────┤
│ Type: [● Tâche] [○ Jalon] [○ Réunion]  │
│                                         │
│ Titre *                                 │
│ [________________________________]      │
│                                         │
│ 📅 04 février 2026                      │
│                                         │
│ [+ Ajouter une heure de fin]            │
│                                         │
│ [Voir plus d'options...]                │
├─────────────────────────────────────────┤
│                    [Annuler] [Créer]    │
└─────────────────────────────────────────┘
```

### 3. Vue Semaine avec Heures
```
         Lun 3    Mar 4    Mer 5    Jeu 6    Ven 7
      ┌────────┬────────┬────────┬────────┬────────┐
08:00 │        │        │        │        │        │
09:00 │ ██████ │        │        │        │        │ ← Réunion
10:00 │        │        │ ██████████████████████  │ ← Tâche multi-jours
11:00 │        │        │        │        │        │
...   │        │        │ ◆      │        │        │ ← Jalon
```

### 4. Navigation Optimisée
- Swipe mobile (gauche/droite)
- Raccourcis clavier (←/→, T pour today)
- Mini-calendrier pour navigation rapide

---

## 🔧 Implémentation Technique

### Ordre d'implémentation
1. **Core partagé** : Schéma, sync Grist, modales communes
2. **Kanban v6** : Colonnes dynamiques, création rapide
3. **Gantt v6** : Scroll infini, dépendances
4. **Calendar v6** : Modales, vue semaine

### Fichiers à créer
```
/home/claude/taskflow/v6/
├── shared/
│   ├── grist-sync.js      # Synchronisation Grist
│   ├── modal-system.js    # Système de modales
│   └── styles-common.css  # Styles partagés
├── kanban.html
├── gantt.html
├── calendar.html
└── dashboard.html
```

### Performance
- Virtual scrolling pour grandes listes
- Debounce sur les événements scroll/resize
- Lazy loading des données
- Cache local (localStorage)

---

## 📦 Livraisons

### Phase 1 : Core + Kanban (priorité haute)
- [ ] Système de modales unifié
- [ ] Kanban avec colonnes configurables
- [ ] Création de tâches depuis Kanban

### Phase 2 : Gantt avancé
- [ ] Scroll continu
- [ ] Dépendances visuelles
- [ ] Modale complète

### Phase 3 : Calendar complet
- [ ] Vue mois + semaine avec heures
- [ ] Création rapide d'événements
- [ ] Drag & drop pour déplacer
