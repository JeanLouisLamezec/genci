# WikiChat — Instructions pour tasks_app

## Rôle du service WikiChat
WikiChat est l'infrastructure de coordination multi-agents pour tes projets Claude.
Le service gère la découverte de projets, la coordination des agents, et l'interface de visualisation.

## Mode connecté (MCP disponible)
Serveur MCP: http://localhost:3777/sse

Pour participer:
1. Utilise `register` avec ton nom et rôle
2. Utilise `declare_project` pour mettre à jour l'état de ce projet
3. Utilise `claim_task` / `release_task` pour gérer les tâches
4. Utilise `declare_storage_path` avec le chemin: C:\Users\Omen\.wikichat\projects\tasks-app

## Mode offline (MCP non disponible)
Écris dans `.wikichat/queue/<timestamp>-<ton-nom>.json`:
```json
{
  "type": "update" | "task_done" | "message" | "artifact",
  "agent": "<ton nom>",
  "project": "tasks-app",
  "ts": "<ISO timestamp>",
  "data": {}
}
```
Le service pickup les fichiers queue au prochain cycle (toutes les 2 minutes).

## Fichiers WikiChat dans ce projet
- `.wikichat/context.json` — état courant du projet (mis à jour par le service)
- `.wikichat/queue/` — messages offline à destination du service
- `C:\Users\Omen\.wikichat\projects\tasks-app/` — store central (artifacts, history, snapshots agents)

## Ce que le service attend de toi
- Décris tes tâches en cours avec `claim_task`
- Partage les livrables avec `share_artifact`
- Déclare tes blockers avec `update_project_state`
- Maintiens ton statut avec `set_status`

## Pattern poll_messages (résilient)

poll_messages est un long-poll (timeout 25s par défaut).
Si la connexion SSE tombe ou que le poll retourne une erreur:

1. Attendre 2s (backoff minimal)
2. Rappeler register() pour vérifier que la session est encore active
3. Si register() répond "nom déjà pris" → appeler resume_session()
4. Relancer poll_messages avec le dernier since_id connu

Boucle recommandée:
  loop:
    result = poll_messages(channel, since_id, timeout_ms=25000)
    if result.messages → traiter, mettre à jour since_id
    if result.timeout  → relancer directement (normal)
    if result.error    → backoff 2s → register/resume → relancer

## Pattern cron (résilient)

Un cron agent doit:
1. À chaque réveil: appeler ping() pour signaler qu'il est vivant
2. Appeler register_cron(job_id, purpose, interval_minutes) pour mettre à jour l'état
3. Effectuer son travail
4. Si le service MCP n'est pas joignable: écrire dans .wikichat/queue/ et réessayer

Si un cron agent ne se manifeste pas pendant 1.5x son intervalle,
le watchdog du service le signale comme potentiellement mort.
Le service peut alors déclencher un respawn automatique si autoRespawn=true.

## Pattern spawn/respawn (résilient)

spawn_session crée un processus enfant. En cas d'échec:
1. Le service retente jusqu'à 3 fois avec backoff exponentiel (2s, 4s, 8s)
2. Si le spawn échoue définitivement, l'entrée est marquée status="failed" dans spawn_registry.json
3. Pour respawn manuel: appeler respawn_session(name) — recrée le processus

Un agent spawné doit:
1. S'enregistrer avec register() immédiatement au démarrage
2. Appeler resume_session() pour récupérer le contexte précédent
3. Appeler ping() toutes les 10 minutes pour signaler sa présence
4. En fin de session: appeler set_status("terminé") avant de quitter

## Pattern wait (attente structurée)

Pour attendre un événement spécifique:
1. poll_messages(channel="coordination", timeout_ms=30000) — attend une notif
2. Si timeout sans message pertinent → vérifier via read_messages(since_minutes=1)
3. Maximum 5 polls consécutifs sans traitement → appeler get_context() pour réévaluer
4. Si attente > 5min sans activité → déclarer via declare_delay(eta, reason)

Ne jamais bloquer indéfiniment. Toujours avoir une action de sortie de boucle.
