"""
Test de correspondance entre ma collection Discogs et MusicBrainz.

Ce script ne modifie rien : il lit data/collection.json et, pour chaque disque,
cherche l'édition correspondante sur MusicBrainz, de trois façons, de la plus
sûre à la moins sûre :
  1. par l'adresse Discogs de l'édition (MusicBrainz la garde souvent) : lien certain ;
  2. par l'adresse Discogs du « master » (le groupe des éditions) : bon album,
     mais l'édition exacte n'est pas connue ;
  3. par une recherche titre + artiste : simple candidat, à vérifier.

Pour les éditions trouvées par les méthodes 1, il regarde aussi ce que
MusicBrainz apporterait : plages reliées à une œuvre, compositeur de l'œuvre,
durées, pochette dans Cover Art Archive.

Le résultat est écrit dans data/rapport_musicbrainz.txt.

Utilisation (depuis le dossier du projet) :
    python3 scripts/test_musicbrainz.py              (toute la collection, environ 15 min)
    python3 scripts/test_musicbrainz.py --limite 30  (les 30 premiers disques, pour essayer)

Aucun jeton n'est nécessaire. MusicBrainz demande au plus une requête par
seconde et un « User-Agent » qui nomme l'application : le script respecte les deux.
Seule la bibliothèque standard de Python est utilisée (Python 3.9 et plus).
"""

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ADRESSE_API = "https://musicbrainz.org/ws/2"
NOM_APPLICATION = "MaCollectionCD/0.1 ( https://github.com/SebStz33/ma-collection-cd )"
PAUSE_ENTRE_REQUETES = 1.1  # secondes

RACINE = Path(__file__).resolve().parent.parent
FICHIER_COLLECTION = RACINE / "data" / "collection.json"
FICHIER_RAPPORT = RACINE / "data" / "rapport_musicbrainz.txt"

# Score minimal (sur 100) d'une recherche titre + artiste pour la retenir.
SCORE_MINIMAL = 90

_derniere_requete = 0.0


def appeler(chemin, parametres):
    """Appelle l'API MusicBrainz et renvoie la réponse JSON (None si introuvable)."""
    global _derniere_requete
    attente = PAUSE_ENTRE_REQUETES - (time.time() - _derniere_requete)
    if attente > 0:
        time.sleep(attente)
    parametres = dict(parametres, fmt="json")
    adresse = f"{ADRESSE_API}/{chemin}?{urllib.parse.urlencode(parametres)}"
    requete = urllib.request.Request(adresse, headers={"User-Agent": NOM_APPLICATION})
    for essai in range(3):
        _derniere_requete = time.time()
        try:
            with urllib.request.urlopen(requete, timeout=30) as reponse:
                return json.load(reponse)
        except urllib.error.HTTPError as erreur:
            if erreur.code == 404:
                return None
            if erreur.code == 503:  # trop de requêtes : on patiente
                time.sleep(5 * (essai + 1))
                continue
            raise
    return None


def chercher_par_url(url_discogs, cle):
    """Renvoie les identifiants MusicBrainz reliés à une adresse Discogs."""
    reponse = appeler("url", {"resource": url_discogs, "inc": f"{cle}-rels"})
    if not reponse:
        return []
    return [r[cle]["id"] for r in reponse.get("relations", []) if cle in r]


def chercher_par_texte(disque):
    """Recherche titre + artiste ; renvoie (identifiant, titre, score) ou None."""
    artiste = ", ".join(disque.get("artistes_principaux") or [])
    requete = f'release:"{disque["titre"]}"'
    if artiste:
        requete += f' AND artist:"{artiste}"'
    reponse = appeler("release", {"query": requete, "limit": 1})
    if not reponse or not reponse.get("releases"):
        return None
    meilleur = reponse["releases"][0]
    if meilleur.get("score", 0) < SCORE_MINIMAL:
        return None
    return meilleur["id"], meilleur.get("title", ""), meilleur["score"]


def analyser_edition(identifiant):
    """Lit une édition MusicBrainz et mesure ce qu'elle apporterait."""
    edition = appeler(f"release/{identifiant}", {
        "inc": "recordings+recording-level-rels+work-rels+work-level-rels+artist-rels",
    })
    if not edition:
        return None
    plages = avec_duree = avec_oeuvre = avec_compositeur = 0
    for support in edition.get("media", []):
        for plage in support.get("tracks", []):
            plages += 1
            if plage.get("length"):
                avec_duree += 1
            oeuvres = [r["work"] for r in plage.get("recording", {}).get("relations", [])
                       if r.get("type") == "performance" and "work" in r]
            if oeuvres:
                avec_oeuvre += 1
                if any(r.get("type") == "composer"
                       for o in oeuvres for r in o.get("relations", [])):
                    avec_compositeur += 1
    pochette = edition.get("cover-art-archive", {})
    return {
        "plages": plages,
        "avec_duree": avec_duree,
        "avec_oeuvre": avec_oeuvre,
        "avec_compositeur": avec_compositeur,
        "pochette": bool(pochette.get("front")),
        "nb_images": pochette.get("count", 0),
    }


def main():
    limite = None
    if "--limite" in sys.argv:
        limite = int(sys.argv[sys.argv.index("--limite") + 1])

    collection = json.loads(FICHIER_COLLECTION.read_text(encoding="utf-8"))
    disques = collection["disques"]
    # Une seule fois par édition (les doublons ont le même release_id).
    vus, uniques = set(), []
    for d in disques:
        if d["release_id"] not in vus:
            vus.add(d["release_id"])
            uniques.append(d)
    if limite:
        uniques = uniques[:limite]

    resultats = []
    for numero, disque in enumerate(uniques, 1):
        titre = disque["titre"]
        print(f"[{numero}/{len(uniques)}] {titre[:60]}", flush=True)
        r = {"disque": disque, "methode": "absent", "detail": None, "candidat": None}

        ids = chercher_par_url(f"https://www.discogs.com/release/{disque['release_id']}", "release")
        if ids:
            r["methode"] = "edition"
            r["detail"] = analyser_edition(ids[0])
        elif disque.get("master_id"):
            if chercher_par_url(f"https://www.discogs.com/master/{disque['master_id']}", "release_group"):
                r["methode"] = "master"
        if r["methode"] == "absent":
            candidat = chercher_par_texte(disque)
            if candidat:
                r["methode"] = "texte"
                r["candidat"] = candidat
        resultats.append(r)

    ecrire_rapport(resultats)
    print("\nRapport écrit dans data/rapport_musicbrainz.txt")


def pourcent(n, total):
    return f"{n} ({round(100 * n / total) if total else 0} %)"


def ecrire_rapport(resultats):
    total = len(resultats)
    par_methode = {m: [r for r in resultats if r["methode"] == m]
                   for m in ("edition", "master", "texte", "absent")}
    details = [r["detail"] for r in par_methode["edition"] if r["detail"]]
    plages = sum(d["plages"] for d in details)

    lignes = [
        "Test de correspondance Discogs -> MusicBrainz",
        f"Éditions testées : {total}",
        "",
        "Correspondance",
        f"  1. Édition exacte (lien Discogs)   : {pourcent(len(par_methode['edition']), total)}",
        f"  2. Album seulement (lien master)   : {pourcent(len(par_methode['master']), total)}",
        f"  3. Candidat titre + artiste        : {pourcent(len(par_methode['texte']), total)}",
        f"     Introuvable                     : {pourcent(len(par_methode['absent']), total)}",
        "",
        "Apport pour les éditions exactes",
        f"  Plages                             : {plages}",
        f"  … avec durée                       : {pourcent(sum(d['avec_duree'] for d in details), plages)}",
        f"  … reliées à une œuvre              : {pourcent(sum(d['avec_oeuvre'] for d in details), plages)}",
        f"  … œuvre avec compositeur           : {pourcent(sum(d['avec_compositeur'] for d in details), plages)}",
        f"  Éditions avec pochette (CAA)       : {pourcent(sum(d['pochette'] for d in details), len(details))}",
        f"  Éditions avec livret ou + d'images : {pourcent(sum(d['nb_images'] > 1 for d in details), len(details))}",
        "",
        "Par catégorie (édition exacte / total)",
    ]
    categories = {}
    for r in resultats:
        cat = r["disque"].get("categorie_perso") or "(sans catégorie)"
        trouve, nb = categories.get(cat, (0, 0))
        categories[cat] = (trouve + (r["methode"] == "edition"), nb + 1)
    for cat, (trouve, nb) in sorted(categories.items(), key=lambda c: -c[1][1]):
        lignes.append(f"  {cat:<30} {trouve:>3} / {nb:<3}")

    noms = {"edition": "Édition exacte", "master": "Album seulement",
            "texte": "Candidat titre + artiste (à vérifier)", "absent": "Introuvable"}
    for methode, nom in noms.items():
        lignes += ["", f"{nom} ({len(par_methode[methode])})"]
        for r in par_methode[methode]:
            d = r["disque"]
            ligne = f"  - {', '.join(d.get('artistes_principaux') or [])} — {d['titre']}"
            if r["candidat"]:
                ligne += f"  [MB : {r['candidat'][1]}, score {r['candidat'][2]}]"
            if r["detail"]:
                ligne += f"  [{r['detail']['avec_oeuvre']}/{r['detail']['plages']} plages avec œuvre]"
            lignes.append(ligne)

    FICHIER_RAPPORT.write_text("\n".join(lignes) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
