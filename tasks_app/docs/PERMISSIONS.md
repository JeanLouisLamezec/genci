# Permissions TaskFlow

## Statut

Ce document décrit le contrat fonctionnel du runtime unifié d’identité et de
permissions. Les widgets sont prêts pour une recette sur une copie du document.
Ils ne sont pas encore certifiés pour une mise en production générale tant que
les ACL Grist n’ont pas été alignées et testées avec plusieurs vrais comptes.

La migration de schéma v6 `functional-permissions-admin-v6` est correcte : elle
ajoute notamment `Team.estAdmin`. Elle n’installe pas d’ACL et ne transforme
aucun utilisateur en administrateur.

## Les trois frontières

1. Grist attribue au compte un accès Owner, Editor ou Viewer au document.
2. Le runtime `TaskFlowPermissions` contrôle les actions émises par les widgets.
3. Les ACL Grist contrôlent les accès directs aux tables et à l’API.

Le point 2 apporte les règles métier et une défense en profondeur, mais seul le
point 3 constitue une frontière serveur contre le contournement des widgets.
Selon la documentation Grist, seul un Owner peut modifier les ACL ; un
administrateur TaskFlow n’acquiert pas cette capacité structurelle.

## Identité commune

La relation canonique est :

```text
Compte Grist (userId) -> Team.gristUserId -> Team.id
```

Tous les widgets utilisent `TaskFlowIdentityRuntime`. Le CRA ne possède plus de
fallback d’identification autonome par email.

- `gristUserId` doit être un entier positif et unique dans `Team` ;
- la ligne Team doit être active ;
- l’email sert uniquement à découvrir un candidat à l’association ;
- l’utilisateur doit confirmer cette association ;
- l’écriture autonome ne peut modifier que `Team.gristUserId` sur ce candidat ;
- après association, seul un administrateur peut transférer ou révoquer le lien ;
- un doublon de `gristUserId` ou d’email échoue fermé.

Si aucun candidat unique n’est trouvé, l’utilisateur reste non associé. Un
administrateur crée ou corrige son profil et son email dans l’Organigramme,
puis l’utilisateur clique de nouveau sur « Associer mon compte ».

## Rôles et sources de vérité

| Rôle | Source | Portée |
| --- | --- | --- |
| Administrateur | `Team.estAdmin = true` | Toutes les commandes fonctionnelles |
| Chef de projet | `Projects.responsable` | Son projet, ses tâches et actions |
| Chef d’équipe | `Team.responsable` | Projets de ses collaborateurs directs |
| Exécutant | `Tasks.assignees` | Tâches affectées et actions propres |
| Propriétaire d’action | `Actions.assignee` | Son action |
| Propriétaire CRA | `Feuilles.membre` | Sa feuille et ses saisies éditables |
| Valideur CRA | `Feuilles.responsableValidation` | La révision photographiée |

`Team.role` est descriptif. `Entites.chef` et `chaine_chefs` ne donnent pas de
droit fonctionnel v6. Le management projet utilise un seul niveau direct via
`Team.responsable`.

Un administrateur fonctionnel peut tout faire, y compris soumettre la feuille
d’un autre membre, s’auto-valider, rejeter hors périmètre et ouvrir ou éditer
une correction. Les invariants de données et les états du workflow restent
obligatoires.

## Projets, tâches et actions

### Référentiels

`Team`, `Entites`, `Programmes` et `KanbanSteps` sont administrateur uniquement.
L’Organigramme est le point d’administration des profils, emails, états actifs,
rôles admin et associations Grist.

### Projets

- admin : création, modification et suppression ;
- chef de projet : création pour lui-même et modification de son projet ;
- chef d’équipe direct : création et modification pour un collaborateur direct ;
- suppression et transfert de `Projects.responsable` : admin uniquement.

### Tâches

- admin, chef de projet et chef d’équipe du périmètre : création, modification,
  suppression et gestion des affectations ;
- exécutant affecté : modification des champs ordinaires ;
- l’exécutant ne peut pas modifier `projet`, `assignees`, `dependDe` ou
  `parentTask`, ni supprimer la tâche.

### Actions

- le périmètre projet peut gérer les actions du projet ;
- l’exécutant crée une action pour lui-même sur une tâche affectée ;
- le propriétaire peut modifier ou supprimer son action ;
- il ne peut ni la réassigner, ni la déplacer vers une tâche étrangère.

Les lots sont contrôlés séquentiellement sur un snapshot. Au premier refus, le
lot entier n’est pas transmis à Grist.

## CRA

### Saisie

Une `TimeEntry` créée par un exécutant doit :

- lui appartenir ;
- viser sa feuille en brouillon ou rejetée ;
- référencer une `TaskAssignment` active du même membre et de la même tâche ;
- n’utiliser que les champs prévus par la commande de saisie.

En modification ordinaire, seuls `heures` et le rattachement contrôlé à la
feuille sont acceptés. Dans `correction_manager`, le valideur photographié ne
peut modifier que `heures`. Un administrateur possède le passe-droit complet.

### Feuille

La création autonome accepte exactement `membre`, `semaine`, `statut` et
`revisionValidation`, pour sa propre feuille en brouillon à révision zéro.

Les mises à jour non administrateur doivent correspondre exactement à une
commande reconnue :

| Transition | Acteur |
| --- | --- |
| brouillon/rejeté -> soumis | propriétaire |
| soumis -> brouillon | propriétaire |
| soumis -> validé | `responsableValidation` |
| soumis -> rejeté | `responsableValidation`, motif obligatoire |
| validé -> correction manager | `responsableValidation`, motif obligatoire |
| correction manager -> validé | `responsableValidation` |
| brouillon -> correction rétroactive | responsable direct |

La soumission photographie le responsable direct dans
`responsableValidation`. Un changement ultérieur d’annuaire ne transfère pas
la révision déjà soumise. Les révisions, dates, `soumisPar`, `validePar` et
motifs sont contrôlés dans les ensembles exacts de champs de chaque transition.

## Widgets

| Widget | Runtime commun | Particularité |
| --- | ---: | --- |
| Kanban | Oui | projets, tâches, actions et étapes |
| Gantt | Oui | tâches et planification |
| Plan | Oui | tâches, affectations et capacités |
| CRA | Oui | acteur commun + workflow CRA |
| Calendrier | Oui | tâches et actions |
| Dashboard | Oui | écritures ponctuelles sur les tâches |
| Organigramme | Oui | référentiels et administration d’identité |

`IdentityGate` est injecté dans les sept widgets. Un échec d’association laisse
le widget dans son état de base et permet une nouvelle tentative après
correction du profil Team.

## Administration des identités

Dans le panneau d’une personne de l’Organigramme, un administrateur voit :

- l’état associé, non associé, inactif ou en conflit ;
- `gristUserId` ;
- `actif` ;
- `estAdmin`.

Une association, un transfert ou une révocation demande confirmation et motif.
La mutation est enregistrée dans l’historique Grist. Le motif est actuellement
journalisé côté widget, pas persisté dans une table métier.

## ACL Grist et limite de mise en production

Les anciennes ACL de l’Organigramme sont masquées et ne doivent pas être
réactivées : elles utilisent l’email et `chaine_chefs`, ne couvrent que trois
tables et ne protègent pas suffisamment les champs système CRA.

L’ACL cible doit utiliser l’attribut Grist `user.UserID` relié à
`Team.gristUserId`, des règles de colonnes avec `rec`/`newRec`, et un cas minimal
pour la première association. Elle doit également retirer aux Editors le droit
de modifier la structure. Cette ACL doit être posée par un Owner et testée avec
« View As » puis avec de vrais comptes.

Tant que cette recette n’est pas passée, les widgets sont qualifiables en
préproduction fonctionnelle, mais le document n’est pas certifié contre une
écriture directe via une table native ou un autre client API.

## Recette obligatoire

- compte sans profil, puis nouvelle tentative après création Team ;
- email absent, email dupliqué, `gristUserId` dupliqué et membre inactif ;
- exécutant, chef d’équipe, chef de projet et administrateur ;
- soumission, retrait, validation, rejet, correction et revalidation ;
- tentative de forger chaque champ système ;
- accès direct aux tables sans passer par les widgets ;
- sauvegarde de la copie et procédure de retour arrière.
