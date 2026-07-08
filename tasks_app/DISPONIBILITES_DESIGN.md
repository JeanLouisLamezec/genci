# Design figé — table `Disponibilites` (historique de capacité du Plan)

Statut : **conçu, non implémenté**. Spec prête à coder quand décidé.
Objectif : remplacer le JSON embarqué `Team.indispos` (sans historique) par une **table datée**, pour
(1) un **historique correct** (les semaines passées se calculent sur les disponibilités *qui s'appliquaient alors*),
(2) gérer les **variations semaine à semaine** sans toucher la capacité nominale,
(3) servir de **socle à un futur module congés/absences** (une UI dédiée se branchera sur la même table).

## Modèle de données

`capaciteHebdo` (Team) reste la **capacité nominale** (baseline stable, scalaire). La variation datée vit dans une table à part :

```
Disponibilites:                 # créée par le widget Plan (opt-in, comme charges/capaciteHebdo)
  membre       Ref:Team         # qui
  type         Choice           # congé / maladie / férié / formation / temps partiel / autre
  dateDebut    Date             # Unix secondes (convention de toute l'app)
  dateFin      Date
  dispo        Numeric          # taux de disponibilité 0..1 sur la période — 0 = absent, 0.5 = mi-temps. Défaut 0
  commentaire  Text             # optionnel
```

Sémantique d'une ligne : « du `dateDebut` au `dateFin`, `membre` est disponible à `dispo` (nature = `type`) ».
- Congé / férié → `dispo = 0` (cas par défaut).
- Mi-temps ponctuel ou durable → `dispo = 0.5` (plage longue/ouverte pour un changement durable).

## Intégration aux calculs existants (contenue au Plan)

Le seul point de lecture/écriture de `indispos` aujourd'hui est le **Plan** (vérifié : Kanban/Gantt/Calendar ne le citent qu'en commentaire de schéma, Dashboard ne lit que `capaciteHebdo`). Donc le remplacement est **sans impact** sur les 4 autres widgets.

1. **Chargement** (`loadGrist`) : `fetchTable('Disponibilites')` → index `dispoByMember[id] = [{start, end, dispo}]` (dates en secondes).
2. **`indispoFrac(member, periodStart)`** — signature **inchangée**, on change la source :
   ```
   // pour chaque jour de la période : reduction_jour = max(1 - dispo) des lignes couvrant ce jour (0 si aucune)
   // indispoFrac = Σ reduction_jour / nb_jours   (plafonné [0,1])
   ```
   `capPeriod`, le footer (`capTeam`), `capForRow`, le drill, `rowReduced` ne bougent pas (ils consomment `indispoFrac`).
   Capacité effective d'une période = `capPeriod(capaciteHebdo) × (1 − indispoFrac)` — formule inchangée.
3. **Panneau ressource** (`openResource`) : les ajouts/suppressions écrivent des **lignes `Disponibilites`** (AddRecord/RemoveRecord) au lieu du JSON ; la liste lit la table filtrée par `membre`.

## Dates

Les colonnes `dateDebut`/`dateFin` sont des **Date Grist (Unix secondes)** — aligné sur `dateDebut`/`dateEcheance`/`dateCloture` du reste de l'app. C'est plus cohérent que l'ISO `yyyy-mm-dd` du JSON actuel ; `indispoFrac` indexe les jours via `÷86400` (au lieu de parser l'ISO).

## Compatibilité / migration

- `Team.indispos` (JSON) reste **lu en fallback** pendant la transition → zéro casse pour un doc existant.
- Migration douce optionnelle : à la 1ʳᵉ ouverture, convertir le JSON `indispos` existant → lignes `Disponibilites` (ISO → secondes, `dispo = 0`), puis vider le JSON.

## Opt-in (sweet spot)

La table `Disponibilites` est **créée par le widget Plan** (`AddTable` si absente, dans `ensurePlanColumns` ou équivalent). Un doc qui n'ouvre jamais le Plan reste sans empreinte. Un futur **module congés** = un widget de plus sur la **même table**.

## Hors scope (pour rester lean)

- Pas de table séparée d'historique de la **capacité nominale** : un changement nominal durable se modélise par une ligne `type = temps partiel`, `dispo` réduit, plage ouverte.
- Pas de validation/workflow de congés, soldes, calendrier d'équipe → ce sera le **module** futur, sur cette table.
