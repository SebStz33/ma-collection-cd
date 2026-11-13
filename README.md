# ma-collection-cd

Ma collection de CD depuis Discogs, enrichie avec MusicBrainz. Outil créé avec Claude.

- Le site : https://sebstz33.github.io/ma-collection-cd/ (public : toute personne qui a l'adresse peut le voir).
- `scripts/sync.py` lit Discogs et MusicBrainz et écrit `data/collection.json`. La page web
  (`index.html`, `style.css`, `app.js`) affiche ce fichier. Elle s'installe aussi comme application sur l'iPhone.
- La synchro tourne automatiquement chez GitHub chaque dimanche, ou à la main depuis l'onglet **Actions**.

Tout le fonctionnement technique (synchro, coffrets MusicBrainz, champs perso, jetons, Service Worker,
routine sur le Mac, pannes) est dans le **[mémo technique](docs/MEMO-TECHNIQUE.md)**.
