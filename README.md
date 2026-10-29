# ma-collection-cd

Ma collection de CD depuis Discogs. Outil créé avec Claude.

## Fonctionnement

1. `scripts/sync.py` interroge l'API Discogs et écrit `data/collection.json`.
2. La page web (`index.html`, `style.css`, `app.js`) lit ce fichier et affiche la
   collection : grille de pochettes, recherche, filtres, tris, fiches et statistiques.
3. `manifest.json`, `service-worker.js` et `icones/` en font une application
   installable sur l'iPhone (PWA), active une fois le site en ligne (https).

## Lancer la synchro sur le Mac

1. Copier `.env.exemple` en `.env` et y coller son token Discogs
   (Discogs > Paramètres > Developers > Generate new token).
2. Depuis le dossier du projet :

```
python3 scripts/sync.py
```

La première fois, le script lit la fiche complète de chaque disque
(environ 1 seconde par disque). Les fois suivantes, seuls les nouveaux disques
sont lus, ainsi que les fiches de plus de 30 jours. Quand le script apprend
à garder une nouvelle information (par exemple les plages), il relit toutes
les fiches une fois.

La « Catégorie » d'un disque est le nom du dossier Discogs où il est rangé
(les disques non classés apparaissent en « Sans catégorie »).

## Voir la page sur le Mac

Un navigateur refuse qu'une page ouverte comme simple fichier aille lire
`data/collection.json`. On lance donc un petit serveur web local, depuis le
dossier du projet :

```
python3 -m http.server 8000
```

puis on ouvre http://localhost:8000 dans le navigateur. `Ctrl+C` dans le
Terminal arrête le serveur.

Après une modification de `index.html`, `style.css` ou `app.js`, augmenter
`VERSION` dans `service-worker.js` pour que l'application installée se mette à jour.
