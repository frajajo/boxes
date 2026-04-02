# CLAUDE.md

## Contexte du projet
Ce projet est une application desktop Windows développée avec Electron et JavaScript.

La plateforme prioritaire est Windows.
Toutes les propositions, correctifs, refactorings et nouvelles fonctionnalités doivent être pensés d’abord pour un fonctionnement fiable sous Windows.

## Priorités
Toujours prioriser dans cet ordre :
1. stabilité
2. sécurité
3. lisibilité
4. simplicité
5. maintenabilité
6. performance

## Style de travail attendu
- Répondre en français.
- Avant de proposer un changement non trivial, résumer brièvement le problème.
- Toujours privilégier le plus petit changement utile.
- Éviter les gros refactorings non demandés.
- Expliquer la cause probable d’un bug avant de proposer un correctif.
- Indiquer clairement les hypothèses lorsqu’il en existe.
- Pour toute modification importante, préciser :
  - les fichiers concernés
  - le changement proposé
  - les risques éventuels
  - comment tester

## Règles générales de code
- Écrire du JavaScript clair, explicite et maintenable.
- Préférer `const`, puis `let`. Ne pas utiliser `var`.
- Utiliser des noms de variables, fonctions et classes explicites.
- Éviter les fonctions trop longues.
- Éviter la duplication inutile.
- Préférer la clarté à l’astuce.
- Ajouter des commentaires seulement quand ils apportent une vraie information utile.
- Ne pas laisser de code mort, de logs inutiles, ni de TODO vagues.

## Architecture Electron
Toujours respecter la séparation entre :
- `main`
- `preload`
- `renderer`

Règles :
- Ne pas mélanger les responsabilités entre `main`, `preload` et `renderer`.
- Garder la logique système et les accès natifs dans `main`.
- Utiliser `preload` comme couche d’exposition minimale et sécurisée.
- Garder `renderer` centré sur l’interface utilisateur.
- Ne jamais exposer directement des APIs Node.js dangereuses au `renderer`.
- Minimiser la surface d’exposition via `contextBridge`.
- Utiliser des canaux IPC explicites, limités et nommés clairement.

## Sécurité Electron
- Toujours adopter une approche défensive.
- Préférer `contextIsolation: true`.
- Préférer `nodeIntegration: false` sauf justification explicite.
- Ne pas exposer d’objets globaux inutiles au `renderer`.
- Valider toutes les données reçues via IPC.
- Ne jamais faire confiance aux entrées venant de l’interface.
- Éviter l’exécution dynamique de code.
- Signaler explicitement toute zone à risque.
- Ne jamais hardcoder de secrets, tokens, mots de passe ou clés API.

## Windows : exigences spécifiques
Windows est la plateforme principale.

Toujours faire attention à :
- `path.join()` / `path.resolve()` pour les chemins
- les chemins contenant des espaces
- les séparateurs de chemin Windows
- les permissions d’accès
- l’encodage
- les noms de fichiers réservés
- les comportements spécifiques aux dossiers utilisateur AppData, Desktop, Documents, Temp
- l’installation, la mise à jour et la désinstallation si concerné

Règles :
- Éviter toute hypothèse Unix-only.
- Si une commande terminal est proposée, fournir une version compatible Windows.
- Si un comportement peut varier entre Windows et Unix, le signaler explicitement.
- Être prudent avec les chemins absolus et relatifs.

## Fichiers et système
- Être prudent avec toute opération sur les fichiers.
- Ne jamais supprimer ou écraser un fichier sans raison claire.
- Pour les écritures importantes, préférer une écriture sûre si possible.
- Vérifier l’existence des fichiers et dossiers lorsque nécessaire.
- Gérer proprement les erreurs de lecture/écriture disque.
- Isoler les accès système dans des fonctions ou modules dédiés.

## Gestion des erreurs
- Gérer explicitement les erreurs.
- Ne pas masquer silencieusement une erreur.
- Retourner ou journaliser des messages exploitables.
- Pour un bug, toujours structurer la réponse ainsi :
  1. symptôme
  2. cause probable
  3. correctif minimal
  4. méthode de vérification

## Interface utilisateur
- Préférer une interface simple, claire et cohérente.
- Éviter les changements visuels inutiles.
- Prévoir des messages d’erreur compréhensibles.
- Éviter de bloquer le thread UI.
- Garder une UX compatible clavier lorsque c’est pertinent.
- Séparer la logique d’interface de la logique métier.

## Performance
- Ne pas optimiser prématurément.
- Prioriser la stabilité et la simplicité.
- En cas de problème de performance, commencer par identifier le goulot d’étranglement.
- Éviter les traitements lourds au démarrage si non nécessaires.
- Limiter les accès disque et calculs répétés inutiles.

## Dépendances
- Ne pas ajouter de dépendance sans justification claire.
- Avant d’ajouter une librairie, vérifier si le besoin peut être couvert simplement avec l’existant.
- Toute nouvelle dépendance doit apporter un vrai gain.
- Éviter les dépendances lourdes pour un besoin simple.

## Tests
- Pour toute logique non triviale, proposer au moins un test.
- Prioriser les tests sur :
  - logique métier
  - validation
  - parsing
  - erreurs
  - cas limites
- Si aucun test automatisé n’existe, proposer une procédure de test manuel claire.
- Après un correctif, expliquer comment vérifier que le bug est bien résolu.

## Documentation
- Documenter seulement ce qui aide réellement à maintenir le projet.
- Mettre à jour la documentation si une commande, une convention ou un comportement important change.
- Préférer une documentation courte, concrète et utile.

## Format de réponse attendu
Quand tu proposes une modification sur ce projet :
- répondre en français
- être concret
- proposer le plus petit changement utile
- éviter les gros refactorings non demandés
- montrer le code complet seulement si nécessaire
- sinon préférer un patch ciblé ou un extrait précis
- préciser :
  - le résumé du changement
  - les fichiers à modifier
  - les risques éventuels
  - les tests à effectuer

## Ce qu’il faut éviter
- gros refactoring non demandé
- changements de style massifs
- dépendances inutiles
- abstractions prématurées
- hacks non signalés
- solutions orientées Linux/macOS sans adaptation Windows
- exposition excessive d’APIs Electron au renderer
- code spéculatif non demandé