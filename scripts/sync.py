"""
Synchronisation de ma collection Discogs.

Ce script :
  1. lit la liste de mes champs personnalisés Discogs ;
  2. lit toute ma collection (par paquets de 100 disques) ;
  3. récupère la fiche complète des disques qu'il ne connaît pas encore
     (compositeurs, interprètes, paroliers, arrangeurs, producteurs... et images) ;
  4. écrit le résultat dans data/collection.json, dans notre propre format.

Utilisation (depuis le dossier du projet) :
    python3 scripts/sync.py
    python3 scripts/sync.py --relire-tout   (relit toutes les fiches complètes,
                                             utile après un changement des règles de classement)

Le token Discogs est lu dans la variable d'environnement DISCOGS_TOKEN,
ou à défaut dans un fichier .env à la racine du projet (jamais publié).

Le script n'utilise que la bibliothèque standard de Python (rien à installer)
et fonctionne avec Python 3.9 et plus.
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Réglages
# ---------------------------------------------------------------------------

UTILISATEUR = "SebSteinmetz"
ADRESSE_API = "https://api.discogs.com"
# Nom de notre application, envoyé à Discogs dans l'en-tête « User-Agent »
# de chaque appel (Discogs exige de savoir quelle application l'appelle).
NOM_APPLICATION = "MaCollectionCD/0.1 +https://github.com/SebStz33/ma-collection-cd"

# Dossier du projet = dossier parent de scripts/
RACINE = Path(__file__).resolve().parent.parent
FICHIER_SORTIE = RACINE / "data" / "collection.json"
FICHIER_RAPPORT_ROLES = RACINE / "data" / "rapport_roles.txt"

# Une fiche complète est relue au bout de ce nombre de jours
# (les adresses des images changent parfois).
JOURS_AVANT_RAFRAICHISSEMENT = 30

# Rôles Discogs regroupés en catégories (rôles écrits en minuscules).
# Les interprètes n'ont pas de liste : est interprète tout rôle qui n'est ni
# dans une de ces catégories, ni écarté (voir plus bas). Il y en a des centaines
# (instruments, voix, chef, ensemble...).
ROLES_PAR_CATEGORIE = {
    "compositeurs": {"composed by", "written-by", "written by", "music by", "composer", "songwriter"},
    "paroliers": {"lyrics by", "libretto by", "words by", "text by"},
    "arrangeurs": {
        "arranged by", "orchestrated by", "adapted by", "realization", "score editor",
    },
    "transcriptions": {"transcription by", "transcribed by"},
    "cadences": {"cadenza"},
    "producteurs": {
        "producer", "executive-producer", "executive producer", "co-producer", "art direction",
        "compilation producer", "reissue producer", "concept by", "production manager",
        "musical assistance", "creative director", "project manager", "supervised by", "a&r",
        "compiled by", "coordinator",
    },
    "ingenieurs_son": {
        "engineer", "recorded by", "mixed by", "recording supervisor", "sound designer",
        "edited by", "mastered by", "remastered by",
    },
    "photographes": {"photography by", "photography"},
    "artwork": {
        "artwork by", "artwork", "graphic design", "typography", "design", "cover",
        "painting", "illustration", "layout", "graphics", "lithography", "sleeve", "calligraphy",
        "design concept",
    },
    "textes_livret": {"liner notes", "booklet editor", "sleeve notes", "translated by"},
    "remix": {"remix", "remixed by"},
}

# Toutes les catégories gardées dans les données, dans l'ordre du rapport.
CATEGORIES = ["compositeurs", "paroliers", "arrangeurs", "transcriptions", "cadences",
              "interpretes", "remix", "producteurs", "ingenieurs_son", "photographes", "artwork",
              "textes_livret"]

# Mots qui signalent un rôle à écarter : technique ou éditorial, et absent
# des catégories ci-dessus (graphiste, éditeur, management...).
# Liste ajustée d'après le rapport des rôles de la collection (28/10/2026).
MOTS_NON_INTERPRETE = [
    "producer", "produced", "engineer", "recorded", "recording", "mixed", "mastered",
    "remastered", "lacquer", "liner notes", "notes", "design", "photograph", "artwork",
    "art direction", "layout", "painting", "illustration", "cover", "booklet", "edited",
    "editor", "executive", "supervis", "coordinat", "manag", "a&r", "translated",
    "text by", "lyrics by", "libretto", "words by", "arranged by", "orchestrated by",
    "transcribed by", "transcription", "copyist", "publisher", "copyright", "licensed",
    "distributed", "manufactured", "marketed", "technician", "tuned", "tuning", "tuner",
    "assistant", "assistance", "compiled", "collected by", "concept",
    "sleeve", "typography", "mastering", "remix", "adapted by", "realization", "cadenza",
    "research", "consultant", "contractor", "graphic", "creative director",
    "film director", "lithograph", "lighting", "make-up", "public relations", "cgi",
    "calligraph", "instrument builder", "repetiteur", "sequenced",
]

# Rôles écartés seulement s'ils sont exactement écrits ainsi
# (« other » ou « score » seuls ne disent pas ce que la personne a fait).
ROLES_NON_INTERPRETE_EXACTS = {"other", "score"}


# ---------------------------------------------------------------------------
# Lecture du token
# ---------------------------------------------------------------------------

def lire_token():
    """Renvoie le token Discogs, depuis l'environnement ou le fichier .env."""
    token = os.environ.get("DISCOGS_TOKEN", "").strip()
    if token:
        return token

    fichier_env = RACINE / ".env"
    if fichier_env.exists():
        for ligne in fichier_env.read_text(encoding="utf-8").splitlines():
            ligne = ligne.strip()
            if ligne.startswith("DISCOGS_TOKEN="):
                return ligne.split("=", 1)[1].strip().strip('"').strip("'")

    sys.exit(
        "Token Discogs introuvable.\n"
        "Crée un fichier .env à la racine du projet contenant la ligne :\n"
        "DISCOGS_TOKEN=ton_token"
    )


# ---------------------------------------------------------------------------
# Appels à l'API Discogs
# ---------------------------------------------------------------------------

def appeler_api(chemin, token, parametres=None):
    """
    Fait un appel GET à l'API Discogs et renvoie la réponse JSON
    sous forme de dictionnaire Python.

    Respecte la limite de 60 appels par minute : si Discogs répond
    « trop de requêtes » (code 429), on attend une minute puis on réessaie.
    """
    url = ADRESSE_API + chemin
    if parametres:
        url += "?" + urllib.parse.urlencode(parametres)

    requete = urllib.request.Request(url, headers={
        "User-Agent": NOM_APPLICATION,
        "Authorization": "Discogs token=" + token,
    })

    for tentative in range(1, 6):
        try:
            with urllib.request.urlopen(requete, timeout=30) as reponse:
                donnees = json.loads(reponse.read().decode("utf-8"))
                # Discogs indique combien d'appels il nous reste pour la minute.
                restants = int(reponse.headers.get("X-Discogs-Ratelimit-Remaining", "60"))
                if restants <= 2:
                    time.sleep(10)
                return donnees
        except urllib.error.HTTPError as erreur:
            if erreur.code == 429:
                print("  Limite Discogs atteinte, pause d'une minute...")
                time.sleep(60)
            elif erreur.code >= 500 and tentative < 5:
                time.sleep(5 * tentative)
            else:
                raise
        except urllib.error.URLError:
            if tentative == 5:
                raise
            time.sleep(5 * tentative)

    raise RuntimeError("Échec répété de l'appel " + chemin)


def lire_champs_perso(token):
    """Renvoie la correspondance numéro -> nom de mes champs personnalisés."""
    reponse = appeler_api("/users/%s/collection/fields" % UTILISATEUR, token)
    return {champ["id"]: champ["name"].strip() for champ in reponse.get("fields", [])}


def lire_collection(token):
    """Renvoie la liste complète des disques de la collection (dossier « All »)."""
    disques = []
    page = 1
    while True:
        reponse = appeler_api(
            "/users/%s/collection/folders/0/releases" % UTILISATEUR,
            token,
            {"per_page": 100, "page": page},
        )
        disques.extend(reponse.get("releases", []))
        nb_pages = reponse.get("pagination", {}).get("pages", 1)
        print("  Page %d/%d lue (%d disques)" % (page, nb_pages, len(disques)))
        if page >= nb_pages:
            return disques
        page += 1


def lire_fiche_complete(release_id, token):
    """Renvoie la fiche complète d'une édition (crédits, morceaux, images)."""
    return appeler_api("/releases/%d" % release_id, token)


# ---------------------------------------------------------------------------
# Transformation des données Discogs vers notre format
# ---------------------------------------------------------------------------

def nettoyer_nom(nom):
    """
    Discogs ajoute « (2) », « (3) »... pour distinguer les homonymes :
    « John Williams (4) » devient « John Williams ».
    """
    return re.sub(r"\s*\(\d+\)$", "", nom or "").strip()


def ajouter_sans_doublon(liste, nom):
    if nom and nom not in liste:
        liste.append(nom)


def decouper_roles(role):
    """
    Un rôle Discogs peut en contenir plusieurs, avec des précisions entre crochets :
    « Piano [Steinway], Conductor » -> ["piano", "conductor"].
    """
    sans_crochets = re.sub(r"\[[^\]]*\]", "", role or "")
    return [r.strip().lower() for r in sans_crochets.split(",") if r.strip()]


# Compteur des rôles rencontrés pendant la synchro, pour le rapport final :
# {(rôle, catégorie): nombre de fois}
ROLES_RENCONTRES = {}


def categorie_du_role(role):
    """Renvoie la catégorie d'un rôle, ou « ecartes » s'il ne nous intéresse pas."""
    for categorie, roles in ROLES_PAR_CATEGORIE.items():
        if role in roles:
            return categorie
    if role in ROLES_NON_INTERPRETE_EXACTS or any(mot in role for mot in MOTS_NON_INTERPRETE):
        return "ecartes"
    return "interpretes"


def classer_credits(credits, personnes):
    """
    Range les personnes d'une liste de crédits Discogs dans leurs catégories.
    `personnes` est un dictionnaire {catégorie: liste de noms}, complété au fur et à mesure.
    """
    for credit in credits or []:
        nom = nettoyer_nom(credit.get("name"))
        for role in decouper_roles(credit.get("role")):
            categorie = categorie_du_role(role)
            if categorie != "ecartes":
                ajouter_sans_doublon(personnes[categorie], nom)
            cle = (role, categorie)
            ROLES_RENCONTRES[cle] = ROLES_RENCONTRES.get(cle, 0) + 1


def rapport_roles():
    """Renvoie le texte du rapport : rôles regroupés par catégorie, du plus fréquent au moins fréquent."""
    lignes = []
    for classement in CATEGORIES + ["ecartes"]:
        roles = [(nb, role) for (role, cl), nb in ROLES_RENCONTRES.items() if cl == classement]
        roles.sort(reverse=True)
        lignes.append("  %s (%d rôles différents) :" % (classement.upper(), len(roles)))
        for nb, role in roles:
            lignes.append("    %5d  %s" % (nb, role))
    return "\n".join(lignes)


def afficher_rapport_roles(collection_complete):
    """
    Affiche le rapport des rôles. Si toutes les fiches ont été lues pendant
    cette synchro, il est complet : on l'enregistre aussi dans data/rapport_roles.txt.
    """
    if not ROLES_RENCONTRES:
        print("Rapport des rôles : aucune fiche lue pendant cette synchro.")
        return
    texte = rapport_roles()
    print("Rapport des rôles (fiches lues pendant cette synchro) :")
    print(texte)
    if collection_complete:
        entete = "Rapport des rôles de toute la collection, établi le %s\n\n" % date.today().isoformat()
        FICHIER_RAPPORT_ROLES.write_text(entete + texte + "\n", encoding="utf-8")
        print("\nRapport enregistré dans data/rapport_roles.txt")


def extraire_details(fiche):
    """Extrait de la fiche complète ce qui nous intéresse."""
    personnes = {categorie: [] for categorie in CATEGORIES}

    # Crédits au niveau du disque entier...
    classer_credits(fiche.get("extraartists"), personnes)

    # ... et au niveau de chaque morceau (fréquent pour les récitals et compilations).
    for morceau in fiche.get("tracklist", []):
        classer_credits(morceau.get("extraartists"), personnes)
        # Pour une œuvre en plusieurs mouvements, les crédits peuvent être sur l'œuvre.
        for sous_morceau in morceau.get("sub_tracks", []) or []:
            classer_credits(sous_morceau.get("extraartists"), personnes)

    images = [
        {"type": img.get("type"), "url": img.get("uri"), "miniature": img.get("uri150")}
        for img in fiche.get("images", [])
        if img.get("uri")
    ]

    details = dict(personnes)
    details["images"] = images
    details["details_maj"] = date.today().isoformat()
    return details


def construire_disque(element, champs_perso, details):
    """Construit la fiche d'un disque dans notre format, à partir de la liste Discogs."""
    info = element.get("basic_information", {})

    # Valeurs de mes champs personnalisés, avec leur nom en clair.
    champs = {}
    for note in element.get("notes", []) or []:
        nom_champ = champs_perso.get(note.get("field_id"), "Champ %s" % note.get("field_id"))
        if note.get("value"):
            champs[nom_champ] = note["value"]

    disque = {
        "instance_id": element.get("instance_id"),
        "release_id": element.get("id"),
        "master_id": info.get("master_id") or None,  # regroupe les éditions d'un même album
        "titre": info.get("title", ""),
        "artistes": [nettoyer_nom(a.get("name")) for a in info.get("artists", [])],
        "annee": info.get("year") or None,  # Discogs met 0 quand l'année est inconnue
        "labels": [{"nom": l.get("name"), "catno": l.get("catno")} for l in info.get("labels", [])],
        "formats": [f.get("name") for f in info.get("formats", [])],
        "genres": info.get("genres", []),
        "styles": info.get("styles", []),
        "pochette": info.get("cover_image"),
        "miniature": info.get("thumb"),
        "note": element.get("rating") or None,
        "date_ajout": element.get("date_added"),
        "champs": champs,
        "url_discogs": "https://www.discogs.com/release/%s" % element.get("id"),
    }
    if details is None:
        details = {categorie: [] for categorie in CATEGORIES}
        details.update({"images": [], "details_maj": None})
    disque.update(details)
    return disque


# ---------------------------------------------------------------------------
# Lecture de la synchro précédente (le « cache »)
# ---------------------------------------------------------------------------

def lire_details_connus():
    """
    Relit le fichier de la synchro précédente pour ne pas redemander à Discogs
    les fiches complètes déjà récupérées. Renvoie {release_id: détails}.
    """
    if not FICHIER_SORTIE.exists():
        return {}
    try:
        precedent = json.loads(FICHIER_SORTIE.read_text(encoding="utf-8"))
    except ValueError:
        return {}
    connus = {}
    for disque in precedent.get("disques", []):
        # Une fiche lue avant l'ajout d'une catégorie est considérée comme à relire.
        if disque.get("details_maj") and all(cat in disque for cat in CATEGORIES):
            connus[disque["release_id"]] = {
                cle: disque.get(cle) for cle in CATEGORIES + ["images", "details_maj"]
            }
    return connus


def doit_rafraichir(details):
    if not details:
        return True
    age = (date.today() - date.fromisoformat(details["details_maj"])).days
    return age >= JOURS_AVANT_RAFRAICHISSEMENT


# ---------------------------------------------------------------------------
# Programme principal
# ---------------------------------------------------------------------------

def main():
    token = lire_token()

    print("1/4 Lecture des champs personnalisés...")
    champs_perso = lire_champs_perso(token)
    print("  %d champs : %s" % (len(champs_perso), ", ".join(champs_perso.values()) or "aucun"))

    print("2/4 Lecture de la collection...")
    elements = lire_collection(token)

    print("3/4 Fiches complètes...")
    details_connus = lire_details_connus()
    relire_tout = "--relire-tout" in sys.argv
    a_lire = sorted({
        e["id"] for e in elements
        if relire_tout or doit_rafraichir(details_connus.get(e["id"]))
    })
    print("  %d fiches à lire (les autres sont déjà connues)" % len(a_lire))
    for numero, release_id in enumerate(a_lire, start=1):
        try:
            details_connus[release_id] = extraire_details(lire_fiche_complete(release_id, token))
        except urllib.error.HTTPError as erreur:
            # Une fiche en erreur ne doit pas bloquer toute la synchro.
            print("  Fiche %d ignorée (erreur %d)" % (release_id, erreur.code))
        if numero % 25 == 0 or numero == len(a_lire):
            print("  %d/%d" % (numero, len(a_lire)))

    print("4/4 Écriture de data/collection.json...")
    disques = [construire_disque(e, champs_perso, details_connus.get(e["id"])) for e in elements]
    disques.sort(key=lambda d: ((d["artistes"] or [""])[0].lower(), d["titre"].lower()))

    resultat = {
        "utilisateur": UTILISATEUR,
        "genere_le": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "nb_disques": len(disques),
        "champs_perso": list(champs_perso.values()),
        "disques": disques,
    }

    # On écrit d'abord dans un fichier temporaire, puis on le renomme :
    # si le script plante au milieu, l'ancien fichier reste intact.
    FICHIER_SORTIE.parent.mkdir(exist_ok=True)
    temporaire = FICHIER_SORTIE.with_suffix(".tmp")
    temporaire.write_text(json.dumps(resultat, ensure_ascii=False, indent=2), encoding="utf-8")
    temporaire.replace(FICHIER_SORTIE)

    print("Terminé : %d disques enregistrés." % len(disques))
    print()
    toutes_les_fiches = {e["id"] for e in elements}
    afficher_rapport_roles(collection_complete=set(a_lire) == toutes_les_fiches)


if __name__ == "__main__":
    main()
