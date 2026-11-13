# Mémo technique : ma collection de CD

> À jour au 13/11/2026 (Service Worker v99, après la PR n°46).
> Si ces numéros ne correspondent plus au code, le mémo est en retard : le mettre à jour dans la même PR.

Ce mémo explique le fonctionnement de l'outil et les gestes à faire. Il ne décrit pas l'utilisation
de la page. Il sert à se souvenir des étapes dans quelques mois.

---

## 1. Vue d'ensemble

```
Discogs (ma collection, mes champs perso)        MusicBrainz (œuvres, pochettes, années)
                \                                  /
                 scripts/sync.py  (+ musicbrainz.py, annees.py)
                                 |
                       data/collection.json  (+ data/musicbrainz.json)
                                 |
        page web : index.html, style.css, app.js  ->  GitHub Pages  ->  Mac, iPhone, iPad
```

- La **synchro** lit Discogs et MusicBrainz, puis écrit des fichiers JSON dans `data/`.
- La **page** ne fait que lire ces fichiers. Elle n'appelle Discogs ou GitHub qu'au moment d'une modification
  (voir partie 5).
- Le site public : https://sebstz33.github.io/ma-collection-cd/. GitHub le republie à chaque changement sur `main`.

### Quel fichier sert à quoi

| Fichier | Rôle | Qui l'écrit |
|---|---|---|
| `scripts/sync.py` | La synchro : lit Discogs, appelle MusicBrainz, écrit `data/collection.json` | Claude (code) |
| `scripts/musicbrainz.py` | La recherche MusicBrainz : œuvres, pochettes, compositeurs, durées, années | Claude (code) |
| `scripts/annees.py` | Calcule les années d'enregistrement, écrit le rapport des années | Claude (code) |
| `scripts/proposer_rattachements.py` | Propose les disques MusicBrainz des CD d'un coffret (partie 3) | Claude (code) |
| `scripts/test_musicbrainz.py` | Ancien test de correspondance, ne modifie rien | Claude (code) |
| `data/collection.json` | Toute la collection, lue par la page | la synchro |
| `data/musicbrainz.json` | Mémoire de la recherche MusicBrainz (pour ne pas tout rechercher chaque fois) | la synchro |
| `data/musicbrainz_manuel.json` | Coffrets rattachés à la main, CD par CD | Claude, d'après mes choix |
| `data/commentaires_oeuvres.json` | Mes commentaires sur les œuvres et les versions | la page (partie 5) |
| `data/rapport_annees.txt`, `data/rapport_roles.txt` | Rapports de contrôle | la synchro |
| `index.html`, `style.css`, `app.js` | La page | Claude (code) |
| `service-worker.js`, `manifest.json`, `icones/` | L'application installée sur l'iPhone (PWA) | Claude (code) |
| `.github/workflows/synchro.yml` | La synchro automatique chez GitHub | Claude (code) |
| `.env` (sur le Mac seulement) | Mon jeton Discogs pour une synchro locale. Ignoré par Git, jamais publié | moi |

---

## 2. La synchro

### Automatique

- Tous les **dimanches à 3 h 30 à Paris en hiver** (4 h 30 en été). GitHub compte en heure UTC :
  le réglage est `cron: "30 2 * * 0"` dans `.github/workflows/synchro.yml`.
- GitHub lance `scripts/sync.py` sur une de ses machines, puis enregistre `data/` dans le dépôt
  **seulement si quelque chose a changé**. Le site se met alors à jour tout seul.

### À la main

Sur github.com : onglet **Actions** › **Synchro Discogs et MusicBrainz** › **Run workflow**.

- Laisser la case « Éditions à relire » **vide** pour une synchro normale.
- Y mettre des n° Discogs d'éditions (`20144050` ou `20144050,123456`) pour **relire tout de suite** ces
  éditions sur Discogs et MusicBrainz, en plus de la synchro normale.
- Une synchro dure de 2 à 20 minutes. Deux synchros ne tournent jamais en même temps.

### Quand la lancer à la main

- Après avoir ajouté ou corrigé des disques sur Discogs, si je ne veux pas attendre dimanche.
- Après la fusion d'une PR qui modifie `sync.py`, `musicbrainz.py`, `annees.py` ou `data/musicbrainz_manuel.json`.
- Après une correction sur MusicBrainz ou Discogs pour une édition précise : la mettre dans « Éditions à relire ».

Après une synchro : dans GitHub Desktop, **Fetch origin** puis **Pull** sur `main` pour récupérer les nouvelles
données sur le Mac.

### Ce que la synchro relit

- Les **nouveaux disques**, et les fiches Discogs de plus de **30 jours** (`JOURS_AVANT_RAFRAICHISSEMENT`).
- Sur MusicBrainz, seulement ce qui n'a pas encore été trouvé, sauf si l'on augmente `VERSION_RECHERCHE`
  dans `musicbrainz.py` (14 aujourd'hui). Dans ce cas, toute la collection est recherchée une fois de plus,
  ce qui prend une vingtaine de minutes.

### Les options du script

À utiliser sur le Mac (`python3 scripts/sync.py …`) ou, pour `--relire`, par la case « Éditions à relire ».

| Option | Effet |
|---|---|
| *(aucune)* | Synchro normale |
| `--relire 20144050,123456` | Relit ces éditions sur Discogs et MusicBrainz tout de suite |
| `--relire-tout` | Relit toutes les fiches Discogs (environ 1 seconde par disque) |
| `--musicbrainz-tout` | Refait la recherche MusicBrainz de toute la collection |

### Le secret DISCOGS_TOKEN

- La synchro de GitHub utilise mon jeton Discogs, rangé dans le secret `DISCOGS_TOKEN`
  (dépôt › **Settings** › **Secrets and variables** › **Actions**). Il n'est jamais écrit en clair.
- Pour le changer : Discogs › Paramètres › Developers › **Generate new token**, puis **Update** sur le secret.
- Sur le Mac, le même jeton est dans le fichier `.env` (modèle : `.env.exemple`).

---

## 3. MusicBrainz et les coffrets

### La recherche automatique

Pour chaque édition, `musicbrainz.py` cherche la parution MusicBrainz correspondante (par le lien Discogs,
par le master, par le code-barres…). Elle en tire les œuvres, les compositeurs, la pochette (Cover Art Archive),
les années d'enregistrement, les durées (si Discogs n'en a pas) et « Live » d'après les notes.
Dans un coffret, chaque plage est rapprochée par n° de CD et de plage, ou par intitulé.

### Le rattachement manuel, CD par CD

Certains coffrets n'existent sur MusicBrainz que comme un bloc, sans pochette par CD. On rattache alors
chaque CD du coffret à un disque MusicBrainz séparé, dans `data/musicbrainz_manuel.json` :

```json
"2070889": {
  "1": "https://musicbrainz.org/release/2331d5ea-…",
  "2": "https://musicbrainz.org/release/…#2"
}
```

- La clé est le n° Discogs du coffret, puis le n° de chaque CD.
- La valeur est un **ID de disque** MusicBrainz (onglet « ID de disque »), ou un **lien de parution**.
  `#2` à la fin veut dire « son 2e CD ».
- C'est un **complément** : la recherche automatique se fait quand même. Les CD rattachés apportent
  pochette, œuvres et durées, et l'emportent sur l'automatique pour leur CD.
- Si le nombre de plages diffère entre le CD et le disque rattaché, ce CD garde les œuvres de l'automatique.

### Le circuit pour un nouveau coffret

1. Le coffret doit déjà être relié à MusicBrainz (une synchro faite).
2. Sur le Mac, depuis le dossier du projet : `python3 scripts/proposer_rattachements.py <n° Discogs>`.
   Environ 8 secondes par CD.
3. Le script écrit à la racine `rattachements-<n°>.html` (vérification dans Safari) et `rattachements-<n°>.csv`
   (à corriger dans Excel). Ces fichiers ne sont pas enregistrés dans le dépôt.
4. Je renvoie le `.csv` à Claude, qui le convertit dans `data/musicbrainz_manuel.json`.
5. PR fusionnée, puis une synchro (dimanche ou à la main).

---

## 4. Les champs perso Discogs

Les noms ci-dessous sont **écrits en dur** en tête d'`app.js`. Si je renomme un champ sur Discogs, il faut
renommer la constante dans le code, sinon la page ne le trouve plus.

| Champ Discogs | Type | Contenu attendu |
|---|---|---|
| Localisation | liste | Où est le disque (« Introuvable » = perdu pour de bon) |
| Description | texte | Texte libre, retours à la ligne gardés |
| Notes personnelles | texte | Texte libre |
| Liens externes | texte | Une adresse par ligne, nom facultatif devant : `Diapason \| https://…` |
| Pistes favorites | texte | Positions des plages : `1, 8` (rempli par les cœurs de la page) |
| Statut d’écoute | liste | À écouter 🎧, Favori ★, À chercher 🔍 (égaré), ou Aucun |
| Live / Studio | liste | Live, Live et Studio, Studio, ou vide (alors « Live » automatique d'après le titre ou les notes) |
| Photo principale | liste | Automatique (MusicBrainz d'abord) ou Discogs |
| Année d’enregistrement (manuelle) | texte | `1958`, `1958-1961`, `1958, 1960-1961 & 1963` ou `à trouver`. Prioritaire sur les années trouvées, jamais écrit par l'outil |

Les autres champs perso (Source…) sont affichés tels quels dans la fiche, sans traitement particulier. « Ma note » (les étoiles) n'est pas un champ perso mais la note Discogs.

À savoir :

- Discogs refuse un texte de plus de **255 caractères**. Le formulaire de la page affiche un compteur.
- L'API Discogs **ne sait pas vider une liste** : d'où l'option « Aucun » du Statut d’écoute.
- Le nom contient une apostrophe typographique (`’`), pas une apostrophe droite (`'`).

### CHAMPS_NON_PUBLIES

Le site est public. Pour qu'un champ perso ne soit jamais publié, ajouter son nom dans
`CHAMPS_NON_PUBLIES` en tête de `scripts/sync.py`, par exemple `{"Notes confidentielles"}`.
Seule la synchro de GitHub retire ce champ : une synchro lancée sur le Mac le garde.
Aujourd'hui la liste est vide (tout est publié, par choix).

---

## 5. Modifier depuis la page : les deux jetons

Chaque jeton se colle **une fois par appareil** (Mac, iPhone, iPad), en bas des filtres. Il reste dans le
navigateur de l'appareil, il n'est ni dans le dépôt ni sur le site. Sans jeton, la page est en lecture seule.

### Jeton Discogs (bouton « ⚙︎ Jeton Discogs »)

- Sert à **✎ Modifier** une fiche et aux cœurs des pistes favorites.
- La page vérifie auprès de Discogs qu'il s'agit bien de mon compte.
- Une modification se voit tout de suite sur l'appareil qui l'a faite, et sur les autres après la synchro suivante.

### Jeton GitHub (commentaires sur les œuvres)

- Sert à écrire `data/commentaires_oeuvres.json` depuis la page Œuvre. Chaque enregistrement est un commit
  sur `main`, visible sur le site une minute plus tard.
- Jeton **fine-grained** : github.com › Settings › Developer settings › Personal access tokens ›
  **Fine-grained tokens** › Generate new token.
  - Repository access : **Only select repositories** › `ma-collection-cd`.
  - Permissions › Repository › **Contents : Read and write**.
  - Noter sa **date d'expiration** : à cette date, il faut en créer un nouveau et le recoller sur chaque appareil.
- Format du fichier : `"oeuvres"` (clé = ID MusicBrainz de l'œuvre) et `"versions"`
  (clé = `<œuvre>|<n° Discogs>` ou `<œuvre>|<n° Discogs>|<CD>`).

---

## 6. Le Service Worker (l'application iPhone)

`service-worker.js` garde une copie de la page sur l'appareil, pour qu'elle s'ouvre vite et sans réseau.

- **Règle** : après toute modification de `index.html`, `style.css`, `app.js` ou `manifest.json`, augmenter
  `VERSION` en tête de `service-worker.js` (`"v99"` → `"v100"`). Sans cela, l'iPhone garde l'ancienne page.
- L'application se recharge d'elle-même au retour dans l'app (après fermeture de la fiche si une fiche est ouverte).
- Les **données** (`collection.json`, `commentaires_oeuvres.json`) ne demandent pas de changer la version : elles sont lues d'abord sur le réseau, la copie gardée ne sert que hors connexion.
- Le Service Worker ne marche qu'en https, donc pas en test local sur `localhost` : là, seul Cmd+Option+R compte.
- Les pochettes sont gardées à part (réserve « pochettes ») : elles ne se rechargent pas à chaque version.

---

## 7. La routine sur le Mac

Dossier : `~/Code/ma-collection-cd`. Python 3.9.

### Voir la page en local

1. Dans le Terminal, depuis le dossier : `serveur` (alias de `python3 -m http.server 8000`).
2. Ouvrir http://localhost:8000 dans Safari.
3. Après chaque changement de fichier : **Cmd+Option+R** (rechargement forcé). Attention, Cmd+Maj+R ouvre le mode Lecture.
4. `Ctrl+C` dans le Terminal arrête le serveur.

### Un chantier, de bout en bout (GitHub Desktop)

1. Branche `main`, **Fetch origin** puis **Pull origin** : partir de la dernière version.
2. **Branch › New Branch** : une branche par chantier, nommée simplement (`memo-technique`, `tri-oeuvres`…).
3. Claude modifie les fichiers dans le dossier. Je teste avec `serveur`.
4. Dans GitHub Desktop : cocher les fichiers, écrire un résumé, **Commit to <branche>**.
5. **Publish branch** la première fois, puis **Push origin**.
6. **Create Pull Request** : coller le titre et la description donnés par Claude.
7. Sur github.com : **Merge pull request** › **Confirm merge**.
8. Retour sur `main` dans GitHub Desktop, **Pull origin**.

### Les données sur le Mac

- **Ne pas committer `data/`** après une synchro faite sur le Mac : c'est la synchro de GitHub qui fait foi,
  sinon conflit sur `collection.json`. Dans GitHub Desktop : clic droit sur les fichiers `data/` › **Discard Changes**
  (ou `git checkout data/` dans le Terminal).
- Exception : `data/musicbrainz_manuel.json`, que l'on modifie exprès.
- Pour récupérer une synchro de GitHub sur une branche de travail : Pull sur `main`, puis sur la branche
  **Branch › Update from main**.

---

## 8. En cas de panne

| Symptôme | Cause probable | Que faire |
|---|---|---|
| Synchro en rouge dans Actions, « HTTP Error 500 » de MusicBrainz | Le serveur MusicBrainz a eu un raté (le script ne réessaie que sur 503) | Relancer la synchro un peu plus tard. Si ça se répète, demander à Claude de réessayer aussi sur 500 dans `musicbrainz.appeler` |
| « Fiche … ignorée (erreur …) » dans le journal de synchro | Une fiche Discogs n'a pas répondu | Rien de grave : elle sera relue la prochaine fois, ou avec « Éditions à relire » |
| Synchro en rouge, erreur 401 de Discogs | Jeton `DISCOGS_TOKEN` révoqué ou changé | Générer un nouveau jeton Discogs, mettre à jour le secret (partie 2) et le `.env` du Mac |
| Page : « Discogs refuse le jeton (code 401/403) » | Jeton Discogs de l'appareil périmé | Recoller un jeton valide (⚙︎ Jeton Discogs) |
| Page : « GitHub refuse le jeton (code 401) » | Jeton GitHub expiré | Créer un nouveau jeton fine-grained (partie 5) et le recoller |
| Page : « GitHub refuse (code 403) » | Le jeton n'a pas le droit Contents : Read and write sur ce dépôt | Corriger les droits du jeton sur github.com, ou en créer un nouveau |
| Un commentaire n'apparaît pas sur un autre appareil | Le site met environ une minute à se republier | Attendre, puis recharger |
| L'iPhone montre l'ancienne page | `VERSION` du Service Worker pas augmentée, ou app pas encore relancée | Vérifier `VERSION` ; fermer l'app et la rouvrir |
| Le Mac montre l'ancienne page | Cache de Safari | Cmd+Option+R |
| Une modification faite sur la page n'est pas sur les autres appareils | Normal : elle arrive avec la synchro suivante | Attendre dimanche, ou lancer la synchro |
| Push refusé dans GitHub Desktop (« rejected ») | Le robot de synchro a écrit sur GitHub entre-temps | **Fetch origin**, puis **Pull**, puis **Push** |
| Conflit sur `data/collection.json` | `data/` modifié sur le Mac et sur GitHub | Garder la version de GitHub : Discard sur le Mac, puis Pull |
| Site injoignable ou pas à jour après une fusion | GitHub Pages en cours de publication (ou en panne) | Onglet **Actions** › « pages build and deployment » : attendre qu'il soit vert |
| Un coffret sans pochettes par CD | Absent ou incomplet sur MusicBrainz | Rattachement manuel (partie 3) |
