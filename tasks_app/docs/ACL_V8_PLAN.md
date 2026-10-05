# Plan ACL Grist v8 — identité et permissions unifiées

## Pourquoi ce lot est séparé

Les règles des widgets ne protègent pas une modification faite depuis une table
native ou un autre client API. L’ACL doit donc reproduire les invariants
critiques côté serveur. Seul un Owner Grist peut la poser ou la modifier.

Référence officielle : [Règles d’accès Grist](https://support.getgrist.com/fr/access-rules/).
Grist expose notamment `user.UserID`, `user.Email`, `rec` et `newRec`, et évalue
les règles de colonnes avant les règles de table.

## Préconditions bloquantes

- copie et sauvegarde restaurable du document ;
- aucun doublon `Team.gristUserId` ;
- aucun doublon d’email parmi les profils candidats ;
- au moins un Owner Grist conservé hors des tests ;
- au moins un profil Team actif avec `estAdmin = true` ;
- tests avec de vrais comptes, pas uniquement le mode « View As ».

## Attributs utilisateur

Créer deux attributs dans la page des règles d’accès :

| Nom | Table | Propriété utilisateur | Colonne de recherche |
| --- | --- | --- | --- |
| `TaskFlowMember` | `Team` | `user.UserID` | `gristUserId` |
| `TaskFlowEmailCandidate` | `Team` | `user.Email` | `email` |

Le premier est la source de vérité permanente. Le second sécurise l’écriture
finale de la première association dans `Team`. La découverte du candidat par le
widget passe désormais par la sonde serveur v8 décrite ci-dessous.

## Sonde d’identité v8

La migration `identity-probe-v8` crée `TaskFlowIdentityProbe` avec :

```text
gristUserId, nonce, teamCandidate, matchStatus
```

`teamCandidate` et `matchStatus` sont des colonnes de données avec formules de
déclenchement. À la création, Grist évalue `user.Email`, recherche l’unique
ligne Team active portant cet email et produit soit `matched`, soit
`duplicate`, soit `not_found`. La table ne conserve jamais l’adresse email.

Poser les règles de table dans cet ordre :

1. Owner : autoriser tous les accès nécessaires ;
2. création : autoriser `C` si
   `newRec.gristUserId == user.UserID` et `newRec.nonce` est non vide ;
3. lecture : autoriser `R` si `rec.gristUserId == user.UserID` ;
4. suppression : autoriser `D` si `rec.gristUserId == user.UserID` ;
5. refuser `U` aux utilisateurs ordinaires ;
6. refuser le reste.

Les clients doivent omettre `teamCandidate` et `matchStatus` à la création.
Les formules de déclenchement les recalculent côté serveur. L’ACL de
`Team.gristUserId` ci-dessous reste la barrière finale : une référence de sonde
forgée ne peut jamais associer un autre email ou un autre compte.

## Règle globale administrateur

Dans chaque groupe de règles TaskFlow, placer en tête :

```python
user.Access == OWNER or (
  user.TaskFlowMember and
  user.TaskFlowMember.actif and
  user.TaskFlowMember.estAdmin
)
```

Cette condition autorise les permissions de données nécessaires. Elle ne donne
jamais la permission structurelle `S` à un Editor.

## Première association

Ajouter sur `Team` une formule booléenne `associationEligible` : profil actif,
email non vide et unique, `gristUserId` vide.

Créer une règle de colonne limitée à `Team.gristUserId` :

1. Owner ou administrateur : autoriser `U` ;
2. première association exacte : autoriser `U` avec la condition suivante ;
3. tout le monde : refuser `U`.

```python
not user.TaskFlowMember and
user.TaskFlowEmailCandidate and
rec.id == user.TaskFlowEmailCandidate.id and
rec.associationEligible and
not rec.gristUserId and
newRec.gristUserId == user.UserID
```

La règle de table `Team` refuse ensuite `U/C/D` aux non-administrateurs. Une
action essayant de modifier `gristUserId` et un autre champ doit donc échouer.

## Référentiels

Pour `Team`, `Entites`, `Programmes` et `KanbanSteps` :

- Owner/admin : autoriser `U/C/D` ;
- tous les autres : refuser `U/C/D` ;
- lecture selon le besoin de confidentialité choisi séparément.

## Projets, tâches et actions

Créer des colonnes-formules de périmètre en `RefList:Team`, calculées depuis :

- `Projects.responsable` et son `Team.responsable` direct ;
- `Tasks.projet`, `Tasks.assignees` ;
- `Actions.task`, son projet et `Actions.assignee`.

Les règles d’update utilisent l’état courant `rec`. Les règles de création
utilisent `newRec` et doivent refuser qu’un utilisateur se donne lui-même un
périmètre en forgeant les affectations. Le transfert de
`Projects.responsable`, les champs de portée d’une tâche et les suppressions de
projet restent admin uniquement.

## Filtres personnels

Pour `UserFilters`, autoriser `C/U/D` lorsque
`rec.gristUserId == user.UserID` et imposer à la création
`newRec.gristUserId == user.UserID`. Refuser à un non-administrateur toute
modification de `gristUserId`. La lecture peut être limitée à la même condition ;
l’administrateur conserve l’override global.

## Feuilles CRA

Créer une règle de colonnes couvrant au minimum :

```text
statut, responsableValidation, soumisPar, dateSoumission,
validePar, dateValidation, revisionValidation, motifRejet, motifCorrection
```

Autoriser uniquement les transitions canoniques décrites dans
`PERMISSIONS.md`, avec `rec` pour l’état initial et `newRec` pour l’état final.
Une dernière règle refuse `U` sur ces colonnes. La suppression d’une feuille
est admin uniquement ; la création ordinaire impose membre courant, brouillon
et révision zéro.

## Saisies CRA

Protéger par règle de colonnes :

```text
membre, tache, date, affectation, feuille, heuresPrevues,
capaciteTheorique, capaciteDisponible, revisionPlan, capaciteJour
```

L’exécutant ne modifie que ses heures dans une feuille éditable. Le valideur
photographié ne modifie que `heures` en `correction_manager`. La création exige
une affectation active du même membre et de la même tâche. Les écritures de
planification doivent avoir leur propre règle de service ou rester réservées à
l’administrateur.

## Ordre de déploiement

1. Créer les attributs et colonnes-formules sur la copie.
2. Poser d’abord les règles admin et conserver une session Owner ouverte.
3. Poser les règles des référentiels, puis Projects/Tasks/Actions.
4. Poser les règles CRA de table et enfin de colonnes.
5. Tester « View As » pour chaque rôle.
6. Refaire les mêmes tests avec les comptes réels et depuis les tables natives.
7. Enregistrer `aclVersion = 8`, `aclStatus = ready` et
   `lastAclMigration = unified-identity-permissions-acl-v8` seulement après
   succès complet.

## Retour arrière

Le retour arrière consiste à restaurer la copie sauvegardée ou à retirer les
règles v8 depuis une session Owner. Ne jamais supprimer le dernier accès Owner
ni activer ces règles directement sur le document de production.
