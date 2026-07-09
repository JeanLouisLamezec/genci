# Setup de développement — GenciWidget / TaskFlow

## Prérequis

- Python 3 (serveur HTTP)
- Google Chrome installé (`/usr/bin/google-chrome`)
- Accès à un document Grist nommé **GENCI** (instance `docs.getgrist.com`)
- Le MCP Grist configuré pour accéder au document GENCI
- Le MCP Chrome DevTools configuré (port 9222)

## Lancement (à faire AVANT toute session)

### 1. Serveur HTTP (depuis `tasks_app/`)

Dans un terminal dédié :

```bash
cd /home/jeanlouis/PycharmProjects/GenciWidget/tasks_app
python3 -m http.server 8092
```

Sert `tasks_app/` sur `http://localhost:8092`. Les widgets sont servis directement depuis les fichiers du projet → toute modification d'un `.html` est immédiate au refresh du navigateur.

URLs widgets (à coller dans Grist comme Custom URL) :
- Kanban   : `http://localhost:8092/kanban.html`
- Gantt    : `http://localhost:8092/gantt.html`
- Calendar : `http://localhost:8092/calendar.html`
- Dashboard: `http://localhost:8092/dashboard.html`
- Plan     : `http://localhost:8092/plan.html`
- CRA      : `http://localhost:8092/cra.html`

### 2. Chrome en mode debug (dans un AUTRE terminal, AVANT la session)

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-grist-agent \
  --no-first-run \
  --no-default-browser-check
```

> Obligatoire : le MCP Chrome DevTools écoute sur le port 9222. Sans cette commande lancée, les outils Chrome DevTools MCP échouent avec `Could not connect to Chrome`. Le `--user-data-dir` isole le profil pour éviter les conflits avec une Chrome personnelle déjà ouverte.

### 3. Ouvrir le document Grist GENCI dans Chrome

Dans la fenêtre Chrome lancée à l'étape 2, ouvrir :

```
https://docs.getgrist.com/<doc-id>/GENCI
```

(document déjà ouvert dans la session testée : `https://docs.getgrist.com/bitvLdYCnewu/GENCI`)

> L'onglet Grist doit rester ouvert pour que le MCP puisse interagir avec la page.

## Vérification du setup par la session

La session (opencode) peut vérifier l'ensemble en appelant ces outils :

1. **Serveur HTTP vivant** :
   ```
   curl -sI http://localhost:8092/kanban.html → HTTP/1.0 200 OK
   ```
2. **Chrome debug vivant** :
   ```
   curl -s http://127.0.0.1:9222/json/version → JSON avec "Browser"
   ```
3. **MCP Chrome DevTools joignable** :
   - `chrome-devtools_list_pages` → doit retourner au moins l'onglet GENCI
4. **MCP Grist joignable** :
   - `grist_grist_list_docs` → doit contenir le document **GENCI**
5. **Onglet GENCI ouvert dans Chrome** :
   - via `chrome-devtools_list_pages`, vérifier qu'une page contient `GENCI` et `getgrist.com`

Si une étape échoue → demander à l'utilisateur de lancer la commande manquante.

## Points d'attention

- **Mixed content** : Grist est en HTTPS, le serveur HTTP local peut être bloqué par Chrome en "Mixed Content". Si le widget ne se charge pas dans Grist, servir en HTTPS local ou bypasser via les flags Chrome.
- **Pas de build nécessaire** : `core/taskflow-core.js` est déjà inliné dans chaque widget HTML (marqueurs `// <taskflow-core>` / `// </taskflow-core>`). Le dossier `scripts/build-taskflow.js` mentionné dans CLAUDE.md n'existe pas dans ce dépôt.
- **Identité de profil Chrome** : utiliser `/tmp/chrome-grist-agent` (profil dédié) pour ne pas polluer le Chrome personnel.

## Arrêt

```bash
# Serveur HTTP
pkill -f "http.server 8092"

# Chrome debug
pkill -f "remote-debugging-port=9222"
```
