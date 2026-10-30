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
Elle se recharge alors d'elle-même au retour dans l'app (après la fermeture de la
fiche si une fiche est ouverte).

## En ligne : synchro automatique et site

- Le site est publié par GitHub Pages : https://sebstz33.github.io/ma-collection-cd/
  (public : toute personne qui a l'adresse peut le voir).
- Chaque nuit, `.github/workflows/synchro.yml` lance la synchro chez GitHub avec le
  token rangé dans le secret `DISCOGS_TOKEN`, puis enregistre `data/collection.json`
  dans le dépôt si la collection a changé. Le site se met alors à jour tout seul.
- Pour lancer une synchro tout de suite : onglet **Actions** > **Synchro Discogs** >
  **Run workflow**.
- Un champ perso à ne pas publier : ajouter son nom dans `CHAMPS_NON_PUBLIES`
  (scripts/sync.py). Seule la synchro de GitHub le retire.
- Deux champs perso ont leur propre bloc dans la fiche (noms définis en tête d'`app.js`) :
  **Notes personnelles** (texte libre, retours à la ligne gardés, adresses cliquables) et
  **Liens externes** (une adresse par ligne, avec un nom facultatif devant :
  `Diapason | https://…`). Discogs transforme les adresses en liens HTML : la page
  les relit sans jamais insérer ce HTML tel quel.

Comme c'est désormais le robot qui enregistre `data/collection.json`, une synchro
lancée sur le Mac modifie ce fichier : avant le `git pull` suivant, annuler ces
modifications avec `git checkout data/`.

## Modifier un disque depuis la page

- Sur chaque appareil (Mac, iPhone, iPad), une seule fois : bouton **⚙︎ Jeton Discogs**
  en bas des filtres, coller le jeton Discogs (Discogs > Paramètres > Développeurs).
  La page vérifie auprès de Discogs qu'il s'agit bien du compte de la collection.
- Le jeton reste dans le navigateur de l'appareil : il n'est ni dans le dépôt ni sur le
  site. Sans jeton (un ami à qui on montre la page), la page reste en lecture seule.
- Dans une fiche, **✎ Modifier** relit les valeurs du moment sur Discogs, puis envoie
  seulement les champs changés : champs perso (Localisation en liste, avec les choix
  définis sur Discogs) et ma note. Les adresses sont remises en texte simple dans le
  formulaire, pour ne pas réécrire les balises HTML ajoutées par Discogs.
- Les modifications s'affichent tout de suite sur l'appareil qui les a faites. Les autres
  appareils les voient après la synchro de la nuit (ou une synchro lancée à la main) ;
  l'appareil oublie alors sa copie locale.
