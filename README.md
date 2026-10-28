# ma-collection-cd

Ma collection de CD depuis Discogs. Outil créé avec Claude.

## Fonctionnement

1. `scripts/sync.py` interroge l'API Discogs et écrit `data/collection.json`.
2. Une page web (à venir) lit ce fichier et affiche la collection.

## Lancer la synchro sur le Mac

1. Copier `.env.exemple` en `.env` et y coller son token Discogs
   (Discogs > Paramètres > Developers > Generate new token).
2. Depuis le dossier du projet :

```
python3 scripts/sync.py
```

La première fois, le script lit la fiche complète de chaque disque
(environ 1 seconde par disque). Les fois suivantes, seuls les nouveaux disques
sont lus, ainsi que les fiches de plus de 30 jours.
