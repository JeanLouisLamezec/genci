# Permissions TaskFlow

## Statut

Ce document décrit le contrat fonctionnel du runtime unifié d’identité et de
permissions. Les widgets sont prêts pour une recette sur une copie du document.
Ils ne sont pas encore certifiés pour une mise en production générale tant que
les ACL Grist n’ont pas été alignées et testées avec plusieurs vrais comptes.

La migration de schéma v6 `functional-permissions-admin-v6` ajoute notamment
`Team.estAdmin`. La migration v7 `user-filters-v7` ajoute la table additive
`UserFilters`. La migration v8 `identity-probe-v8` ajoute la table technique
`TaskFlowIdentityProbe`. Ces migrations n’installent pas d’ACL et ne
transforment aucun utilisateur en administrateur.

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
- le widget récupère le `userId` authentifié depuis le jeton documentaire ;
- si ce `userId` n’est pas encore associé, il crée une ligne transitoire dans
  `TaskFlowIdentityProbe` avec un nonce aléatoire ;
- deux formules de déclenchement évaluées par Grist utilisent `user.Email` pour
  retrouver l’unique profil Team actif portant la même adresse ; l’adresse
  elle-même n’est jamais écrite dans la sonde ni demandée à l’utilisateur ;
- le widget relit uniquement sa sonde, récupère la référence `teamCandidate`,
  puis supprime la sonde au mieux ;
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
- exécutant affecté : modification des champs opérationnels ordinaires, comme
  le statut ou la progression ;
- l’exécutant ne peut pas modifier `dateDebut`, `dateEcheance`, `projet`,
  `assignees`, `dependDe` ou `parentTask`, ni supprimer la tâche. Les dates de
  planification sont réservées à l’administrateur et au périmètre projet.

### Actions

- le périmètre projet peut gérer les actions du projet ;
- l’exécutant crée une action pour lui-même sur une tâche affectée ;
- le propriétaire peut modifier ou supprimer son action ;
- il ne peut ni la réassigner, ni la déplacer vers une tâche étrangère.

Dans le panneau de création ou d’édition d’une action du Kanban, le sélecteur de
tâche applique ce même périmètre avant l’écriture :

- l’administrateur voit toutes les tâches ;
- le chef de projet voit toutes les tâches des projets dont il est responsable ;
- le chef d’équipe voit toutes les tâches des projets de ses collaborateurs
  directs ;
- l’exécutant ne voit que les tâches auxquelles il est affecté.

La recherche porte sur le titre de la tâche et le nom du projet. Ce préfiltrage
est une aide UX pour les gros volumes ; il ne remplace ni la garde d’écriture du
widget ni les ACL Grist. Le bouton d’ajout d’une colonne regroupée par projet
resserre en plus la liste sur ce projet. Une tâche déjà liée à une action reste affichée pendant
l’édition, même si le périmètre de l’utilisateur a changé, afin de ne pas masquer
la valeur existante ; toute nouvelle destination demeure contrôlée à l’écriture.

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

La décision d’écriture distingue deux cas, dans cet ordre :

1. une ligne `TimeEntries` existe déjà pour le membre, la tâche et la date :
   elle peut être corrigée même si son affectation historique est désormais
   inactive, terminée ou absente ;
2. aucune ligne n’existe : une affectation active couvrant exactement la date
   reste obligatoire avant toute création.

Une feuille hebdomadaire absente est matérialisée en brouillon lors de la
première saisie autorisée. Une ligne historique sans feuille est d’abord
rattachée à cette feuille, puis ses heures sont modifiées dans le même lot ACL.
Les doublons de feuilles, les rattachements vers une autre semaine ou un autre
membre et les références vers une feuille introuvable restent bloquants.

Le responsable du projet et son manager direct peuvent recalculer les lignes
prévisionnelles issues d'une `TaskAssignment` active. Cette autorisation est
limitée à `heuresPrevues`, aux instantanés de capacité, à `capaciteJour` et à
`revisionPlan`. Elle n'autorise jamais la modification de `heures`, de
`description`, d'`imputation` ni la suppression d'une saisie réalisée.

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

L’administrateur peut saisir directement dans le brouillon ou la feuille
rejetée de n’importe quel membre, puis soumettre ou retirer cette feuille au
nom du membre tout en restant l’acteur technique de l’opération. Une feuille
soumise, validée ou en `correction_manager` demeure verrouillée dans la grille
ordinaire : l’administrateur passe alors par les commandes de rejet, validation
ou correction manager afin de préserver l’historique et les révisions du
workflow. Le statut `correction_manager` n’est éditable que lorsque ce mode a
été explicitement ouvert, et uniquement sur les entrées existantes.

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

## Filtres personnels

Tout utilisateur associé peut créer, modifier et supprimer uniquement la ligne
`UserFilters` portant son propre `gristUserId`. L’administrateur conserve son
override global. Les filtres ne donnent jamais accès à des données
supplémentaires : ils réduisent seulement les données déjà accessibles.

## ACL Grist et limite de mise en production

Les anciennes ACL de l’Organigramme sont masquées et ne doivent pas être
réactivées : elles utilisent l’email et `chaine_chefs`, ne couvrent que trois
tables et ne protègent pas suffisamment les champs système CRA.

L’ACL cible doit utiliser l’attribut Grist `user.UserID` relié à
`Team.gristUserId`, des règles de colonnes avec `rec`/`newRec`, et un cas minimal
pour la première association. `TaskFlowIdentityProbe` doit en plus être limitée
au propriétaire de chaque sonde : création avec
`newRec.gristUserId == user.UserID`, lecture et suppression avec
`rec.gristUserId == user.UserID`, et mise à jour refusée. Elle doit également
retirer aux Editors le droit de modifier la structure. Cette ACL doit être
posée par un Owner et testée avec « View As » puis avec de vrais comptes.

Tant que cette recette n’est pas passée, les widgets sont qualifiables en
préproduction fonctionnelle, mais le document n’est pas certifié contre une
écriture directe via une table native ou un autre client API.

## Recette obligatoire

- compte non associé avec profil Team actif portant le même email ;
- migration v8 absente et ACL de sonde volontairement refusée ;
- compte sans profil, puis nouvelle tentative après création Team ;
- email absent, email dupliqué, `gristUserId` dupliqué et membre inactif ;
- exécutant, chef d’équipe, chef de projet et administrateur ;
- soumission, retrait, validation, rejet, correction et revalidation ;
- tentative de forger chaque champ système ;
- accès direct aux tables sans passer par les widgets ;
- sauvegarde de la copie et procédure de retour arrière.
