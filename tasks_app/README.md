# TaskFlow v6 - Guide d'Initialisation et Schéma Grist

## 📋 Vue d'Ensemble

TaskFlow v6 est une suite de widgets Grist pour la gestion de projets comprenant :
- **Kanban** : Gestion visuelle par colonnes configurables
- **Gantt** : Timeline avec dépendances et jalons
- **Calendar** : Vue calendrier avec création rapide
- **Dashboard** : Vue synthétique (à venir)

## 🗄️ Schéma de Tables Grist

### Table Principale : `Tasks`

Cette table est **obligatoire** pour le fonctionnement des widgets.

```
┌─────────────────┬──────────────────────┬─────────────────────────────────────────┬───────────┐
│ Colonne         │ Type Grist           │ Description                             │ Requis    │
├─────────────────┼──────────────────────┼─────────────────────────────────────────┼───────────┤
│ id              │ Integer (auto)       │ ID unique (généré automatiquement)      │ ✓ auto    │
│ titre           │ Text                 │ Nom de la tâche                         │ ✓         │
│ description     │ Text (long)          │ Description détaillée                   │           │
│ dateDebut       │ Date                 │ Date de début                           │ ✓         │
│ dateEcheance    │ Date                 │ Date d'échéance                         │ ✓         │
│ priorite        │ Choice               │ 1=Critique, 2=Haute, 3=Moyenne, 4=Basse │ ✓         │
│ statut          │ Choice               │ todo, inprogress, review, done          │ ✓         │
│ progression     │ Numeric (0-100)      │ Pourcentage d'avancement                │           │
│ projet          │ Reference (Projects) │ Lien vers table Projects                │           │
│ assignees       │ Reference List (Team)│ Liste des assignés                      │           │
│ type            │ Choice               │ tache, jalon, reunion                   │           │
│ dependDe        │ Reference List (Tasks)│ Tâches prédécesseurs                   │           │
│ tags            │ Choice List          │ Étiquettes                              │           │
│ estimationH     │ Numeric              │ Heures estimées                         │           │
│ tempsPasse      │ Numeric              │ Heures passées                          │           │
│ couleur         │ Text                 │ Couleur personnalisée (#hex)            │           │
└─────────────────┴──────────────────────┴─────────────────────────────────────────┴───────────┘
```

**Configuration des Choices :**

```
priorite:
  - 1 (Critique)
  - 2 (Haute)
  - 3 (Moyenne)
  - 4 (Basse)

statut:
  - todo (À faire)
  - inprogress (En cours)
  - review (En revue)
  - done (Terminé)

type:
  - tache (Tâche standard)
  - jalon (Jalon/Milestone)
  - reunion (Réunion)
```

### Table Secondaire : `Team` (Optionnelle)

Pour l'affichage des avatars et filtrage par assigné.

```
┌─────────────────┬──────────────────────┬─────────────────────────────────────────┬───────────┐
│ Colonne         │ Type Grist           │ Description                             │ Requis    │
├─────────────────┼──────────────────────┼─────────────────────────────────────────┼───────────┤
│ id              │ Integer (auto)       │ ID unique                               │ ✓ auto    │
│ nom             │ Text                 │ Nom complet                             │ ✓         │
│ email           │ Text                 │ Email                                   │           │
│ avatar          │ Text                 │ URL ou initiales                        │           │
│ role            │ Choice               │ Rôle dans l'équipe                      │           │
│ actif           │ Bool                 │ Membre actif                            │           │
└─────────────────┴──────────────────────┴─────────────────────────────────────────┴───────────┘
```

### Table Secondaire : `Projects` (Optionnelle)

Pour la gestion multi-projets et couleurs.

```
┌─────────────────┬──────────────────────┬─────────────────────────────────────────┬───────────┐
│ Colonne         │ Type Grist           │ Description                             │ Requis    │
├─────────────────┼──────────────────────┼─────────────────────────────────────────┼───────────┤
│ id              │ Integer (auto)       │ ID unique                               │ ✓ auto    │
│ nom             │ Text                 │ Nom du projet                           │ ✓         │
│ couleur         │ Text                 │ Couleur (#hex)                          │           │
│ dateDebut       │ Date                 │ Date de début projet                    │           │
│ dateFin         │ Date                 │ Date de fin prévue                      │           │
│ responsable     │ Reference (Team)     │ Chef de projet                          │           │
│ actif           │ Bool                 │ Projet actif                            │           │
└─────────────────┴──────────────────────┴─────────────────────────────────────────┴───────────┘
```

## 🔧 Installation

### 1. Créer les Tables

1. Dans Grist, créer une nouvelle table `Tasks`
2. Ajouter les colonnes selon le schéma ci-dessus
3. (Optionnel) Créer les tables `Team` et `Projects`

### 2. Ajouter les Widgets

1. Cliquer sur "Add New" → "Add widget to page"
2. Sélectionner "Custom" widget
3. Dans la configuration du widget, entrer l'URL du fichier HTML :
   - Pour GitHub : `https://raw.githubusercontent.com/VOTRE_USER/grist-taskflow/main/kanban.html`
   - Pour fichier local : chemin vers le fichier

### 3. Configuration Recommandée

**Page Layout Suggéré :**

```
┌────────────────────────────────────────────────────────────────────┐
│ [Table Tasks]                           [Kanban Custom Widget]     │
├────────────────────────────────────────────────────────────────────┤
│ [Gantt Custom Widget - Full Width]                                 │
├────────────────────────────────────────────────────────────────────┤
│ [Calendar Custom Widget]                [Dashboard Widget]         │
└────────────────────────────────────────────────────────────────────┘
```

### 4. Lier les Widgets

Pour que la sélection soit synchronisée entre widgets :
1. S'assurer que tous les widgets sont liés à la table `Tasks`
2. Dans les options de chaque widget, sélectionner "Select By" → Table Tasks
3. Les clics dans un widget sélectionneront automatiquement la ligne dans les autres

## 🔄 Synchronisation Grist

### Mécanisme de Sélection

Les widgets utilisent l'API Grist pour :
- **Recevoir les données** : `grist.onRecords()` - appelé quand les données changent
- **Recevoir la sélection** : `grist.onRecord()` - appelé quand une ligne est sélectionnée ailleurs
- **Envoyer la sélection** : `grist.setSelectedRows([id])` - sélectionne une ligne

### Code de Synchronisation (dans chaque widget)

```javascript
// Initialisation
grist.ready({ requiredAccess: 'full' });

// Réception des données
grist.onRecords(async (data) => {
    tasks = convertGristToRecords(data);
    render();
});

// Réception de sélection externe
grist.onRecord((record) => {
    if (record?.id) {
        selectedTaskId = record.id;
        highlightSelectedTask();
    }
});

// Envoi de sélection
function selectTask(taskId) {
    selectedTaskId = taskId;
    grist.setSelectedRows([taskId]);
    highlightSelectedTask();
}
```

## 📊 Configuration par Widget

### Kanban

**Groupement configurable :**
- Par `statut` (défaut) : Colonnes todo, inprogress, review, done
- Par `priorite` : Colonnes Critique, Haute, Moyenne, Basse
- Par `projet` : Une colonne par projet
- Par `assignee` : Une colonne par membre d'équipe

**Ajout de colonne :**
- Bouton "+" en fin de colonnes (mode statut uniquement)
- Ajoute une nouvelle valeur au Choice `statut`

### Gantt

**Tri configurable :**
- Par priorité (défaut)
- Par date de début
- Manuel (drag & drop)

**Dépendances :**
- Colonne `dependDe` : Reference List vers d'autres tâches
- Affichage : Flèches courbes entre les barres
- Types supportés : Fin → Début

**Navigation :**
- Vues : Semaine, Mois, Trimestre, Année
- Scroll horizontal continu
- Boutons précédent/suivant

### Calendar

**Vues :**
- Mois : Grille classique 7×6
- Semaine : Timeline horaire

**Types d'événements :**
- `tache` : Barre colorée sur plusieurs jours
- `jalon` : Diamant avec bordure
- `reunion` : Événement avec heure

## 🎨 Personnalisation

### Couleurs par Priorité

```css
--danger: #ef4444;   /* Critique (1) */
--warning: #f59e0b;  /* Haute (2) */
--info: #3b82f6;     /* Moyenne (3) */
--text-muted: #64748b; /* Basse (4) */
```

### Thème

Modifier les variables CSS dans `:root` pour personnaliser :

```css
:root {
    --primary: #4f46e5;      /* Couleur principale */
    --primary-light: #e0e7ff; /* Fond sélection */
    --bg: #f8fafc;           /* Fond page */
    --card-bg: #ffffff;      /* Fond cartes */
    --text: #1e293b;         /* Texte principal */
    --border: #e2e8f0;       /* Bordures */
}
```

## 🚀 Mode Démo

Les widgets fonctionnent sans Grist avec des données de démonstration :
- Badge "Démo" affiché
- Données générées automatiquement
- Toutes les fonctionnalités disponibles (sauf persistance)

Pour forcer le mode démo, ouvrir le fichier HTML directement dans un navigateur.

## 📁 Fichiers

```
taskflow/v6/
├── kanban.html      # Widget Kanban
├── gantt.html       # Widget Gantt
├── calendar.html    # Widget Calendar
├── SPECIFICATIONS.md # Spécifications détaillées
└── README.md        # Ce fichier
```

## ✅ Checklist d'Installation

- [ ] Table `Tasks` créée avec colonnes obligatoires
- [ ] Choices configurés (priorite, statut, type)
- [ ] (Optionnel) Table `Team` créée
- [ ] (Optionnel) Table `Projects` créée
- [ ] Widget Kanban ajouté et lié à Tasks
- [ ] Widget Gantt ajouté et lié à Tasks
- [ ] Widget Calendar ajouté et lié à Tasks
- [ ] Test de sélection croisée entre widgets

## 🐛 Dépannage

**Les données ne s'affichent pas :**
- Vérifier que le widget est lié à la table `Tasks`
- Vérifier les noms de colonnes (sensibles à la casse)
- Ouvrir la console navigateur (F12) pour les erreurs

**La sélection n'est pas synchronisée :**
- Vérifier "Select By" dans les options du widget
- S'assurer que tous les widgets pointent vers `Tasks`

**Le widget affiche "Démo" :**
- Le widget n'est pas intégré à Grist correctement
- Vérifier l'URL du widget dans la configuration

## 📝 Changelog

### v6.0.0
- Colonnes Kanban configurables (statut/priorité/projet/assigné)
- Création de tâches avec modale contextuelle
- Gantt avec scroll continu
- Dépendances visuelles améliorées
- Calendar avec création rapide au clic
- Modales détaillées pour tous les widgets
- Filtres avancés avec persistance localStorage
- Synchronisation Grist optimisée
