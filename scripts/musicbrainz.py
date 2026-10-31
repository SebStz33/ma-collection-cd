"""
Œuvres MusicBrainz : utilisé par sync.py.

Pour chaque disque, on cherche l'édition correspondante sur MusicBrainz :
  1. par l'adresse Discogs de l'édition (MusicBrainz la garde souvent) ;
  2. sinon par l'adresse Discogs du « master » (le groupe des éditions d'un même album) :
     de préférence l'édition de cet album qui a le même code-barre, sinon une
     édition qui a le même nombre de plages ;
  3. sinon par le code-barre seul (recherche MusicBrainz).
Une édition trouvée par son code-barre doit aussi avoir le même nombre de plages :
une réédition reprend parfois le code-barre de l'original.
Pas de recherche par titre et artiste : trop incertaine.

Pour une édition exacte (lien Discogs ou code-barre), on lit aussi la liste de ses
images dans la Cover Art Archive (pochettes et livrets scannés, souvent en haute
définition). Pas pour une édition trouvée par l'album : la pochette pourrait être
celle d'une autre édition.

Si on trouve, on lit pour chaque plage l'œuvre jouée (« Concerto RV 269, I. Allegro »),
son compositeur (à défaut, ses auteurs-compositeurs) et son œuvre parente (« Concerto RV 269 »). Les plages Discogs et
MusicBrainz sont associées dans l'ordre : seulement si elles sont aussi nombreuses
des deux côtés, pour ne jamais attribuer une œuvre à la mauvaise plage.

Les résultats sont gardés dans data/musicbrainz.json (le « cache ») et relus tous
les 30 jours. Aucun jeton n'est nécessaire. Règle de MusicBrainz : au plus une
requête par seconde, et une application qui se présente dans le « User-Agent ».
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date

ADRESSE_API = "https://musicbrainz.org/ws/2"
ADRESSE_IMAGES = "https://coverartarchive.org"
NOM_APPLICATION = "MaCollectionCD/0.1 ( https://github.com/SebStz33/ma-collection-cd )"
PAUSE_ENTRE_REQUETES = 1.1  # secondes : un peu plus que la limite d'une par seconde

# Une recherche (réussie ou non) est refaite au bout de ce nombre de jours :
# entre-temps, quelqu'un a pu ajouter le disque ou ses œuvres sur MusicBrainz.
JOURS_AVANT_RAFRAICHISSEMENT = 30

# Nombre maximal de disques cherchés par synchro, pour qu'elle reste courte
# (environ 4 requêtes par disque). Le reste est fait les nuits suivantes.
DISQUES_PAR_SYNCHRO = 200

# À augmenter quand la façon de chercher change : les disques cherchés avec une
# version plus ancienne sont alors cherchés à nouveau (après ceux jamais cherchés).
# Version 2 : codes-barres, auteurs-compositeurs.
VERSION_RECHERCHE = 2

# Méthodes qui désignent l'édition exacte (on prend alors aussi ses images).
METHODES_EXACTES = ("edition", "code_barre")

_derniere_requete = 0.0


def appeler(chemin, parametres, base=ADRESSE_API):
    """Appelle l'API MusicBrainz (ou la Cover Art Archive) et renvoie la réponse JSON (None si introuvable)."""
    global _derniere_requete
    parametres = dict(parametres, fmt="json") if base == ADRESSE_API else parametres
    adresse = "%s/%s" % (base, chemin)
    if parametres:
        adresse += "?" + urllib.parse.urlencode(parametres)
    requete = urllib.request.Request(adresse, headers={"User-Agent": NOM_APPLICATION})
    for tentative in range(1, 4):
        attente = PAUSE_ENTRE_REQUETES - (time.time() - _derniere_requete)
        if attente > 0:
            time.sleep(attente)
        _derniere_requete = time.time()
        try:
            with urllib.request.urlopen(requete, timeout=60) as reponse:
                return json.loads(reponse.read().decode("utf-8"))
        except urllib.error.HTTPError as erreur:
            if erreur.code == 404:
                return None
            if erreur.code == 503 and tentative < 3:  # trop de requêtes : on patiente
                time.sleep(5 * tentative)
                continue
            raise
    return None


# ---------------------------------------------------------------------------
# Correspondance Discogs -> MusicBrainz
# ---------------------------------------------------------------------------

def chercher_par_url(url_discogs, cle):
    """Renvoie les identifiants MusicBrainz reliés à une adresse Discogs."""
    # Dans le paramètre « inc », MusicBrainz écrit release-group avec un tiret,
    # mais la réponse JSON utilise release_group avec un tiret bas.
    reponse = appeler("url", {"resource": url_discogs, "inc": cle.replace("_", "-") + "-rels"})
    if not reponse:
        return []
    return [r[cle]["id"] for r in reponse.get("relations", []) if cle in r]


def code_simple(code):
    """
    Code-barre comparable : chiffres seuls, sans les zéros de tête
    (le même code s'écrit sur 12 chiffres en Amérique, 13 en Europe avec un 0 devant).
    """
    return "".join(c for c in code or "" if c.isdigit()).lstrip("0")


def nombre_de_plages(edition):
    """Nombre de plages d'une édition MusicBrainz, tous supports confondus."""
    supports = edition.get("media") or []
    if supports:
        return sum(support.get("track-count", 0) for support in supports)
    return edition.get("track-count", 0)


def edition_de_l_album(groupe, nb_plages, codes):
    """
    Dans un album MusicBrainz, renvoie (identifiant, méthode) : l'édition qui a le même
    code-barre et le même nombre de plages ("code_barre"), sinon une édition qui a
    le même nombre de plages ("album"), sinon (None, "aucune").
    """
    reponse = appeler("release", {"release-group": groupe, "inc": "media", "limit": 100})
    editions = [e for e in (reponse or {}).get("releases", []) if nombre_de_plages(e) == nb_plages]
    for edition in editions:
        if code_simple(edition.get("barcode")) in codes:
            return edition["id"], "code_barre"
    if editions:
        return editions[0]["id"], "album"
    return None, "aucune"


def chercher_par_code_barre(codes, nb_plages):
    """Renvoie l'identifiant de l'édition MusicBrainz qui a l'un de ces codes-barres et nb_plages plages (ou None)."""
    for code in codes:
        # La recherche compare le texte exact : on essaie les écritures sur 12 et 13 chiffres.
        ecritures = sorted({code, code.zfill(12), code.zfill(13)})
        reponse = appeler("release", {"query": "barcode:(%s)" % " OR ".join(ecritures), "limit": 10})
        for edition in (reponse or {}).get("releases", []):
            if code_simple(edition.get("barcode")) == code and nombre_de_plages(edition) == nb_plages:
                return edition["id"]
    return None


def trouver_edition(release_id, master_id, nb_plages, codes_barres=()):
    """Renvoie (identifiant MusicBrainz, méthode) ou (None, "aucune")."""
    ids = chercher_par_url("https://www.discogs.com/release/%s" % release_id, "release")
    if ids:
        return ids[0], "edition"
    codes = [c for c in (code_simple(code) for code in codes_barres) if c]
    if master_id:
        for groupe in chercher_par_url("https://www.discogs.com/master/%s" % master_id, "release_group"):
            identifiant, methode = edition_de_l_album(groupe, nb_plages, codes)
            if identifiant:
                return identifiant, methode
    identifiant = chercher_par_code_barre(codes, nb_plages)
    if identifiant:
        return identifiant, "code_barre"
    return None, "aucune"


# ---------------------------------------------------------------------------
# Œuvres des plages
# ---------------------------------------------------------------------------

def oeuvre_de_plage(plage_mb):
    """
    Œuvre jouée sur une plage MusicBrainz :
    {"id", "titre", "compositeur", "parente": {"id", "titre"} ou None}, ou None.
    """
    relations = (plage_mb.get("recording") or {}).get("relations", [])
    oeuvres = [r["work"] for r in relations if r.get("type") == "performance" and r.get("work")]
    if not oeuvres:
        return None
    oeuvre = oeuvres[0]  # un pot-pourri peut en avoir plusieurs : on garde la première
    # Compositeurs ; à défaut (fréquent pour une chanson), auteurs-compositeurs (« writer »).
    noms = {"composer": [], "writer": []}
    parente = None
    for relation in oeuvre.get("relations", []):
        if relation.get("type") in noms and relation.get("artist"):
            nom = relation["artist"].get("name")
            if nom and nom not in noms[relation["type"]]:
                noms[relation["type"]].append(nom)
        # « parts » vers l'arrière : l'œuvre dont celle-ci est une partie (le mouvement -> le concerto).
        if relation.get("type") == "parts" and relation.get("direction") == "backward" \
                and relation.get("work") and not parente:
            parente = {"id": relation["work"]["id"], "titre": relation["work"].get("title", "")}
    compositeur = ", ".join(noms["composer"] or noms["writer"]) or None
    return {"id": oeuvre["id"], "titre": oeuvre.get("title", ""), "compositeur": compositeur, "parente": parente}


def lire_oeuvres(identifiant):
    """Renvoie la liste des œuvres (ou None) de chaque plage d'une édition MusicBrainz, dans l'ordre."""
    edition = appeler("release/%s" % identifiant, {
        "inc": "recordings+recording-level-rels+work-rels+work-level-rels+artist-rels",
    })
    if not edition:
        return None
    return [oeuvre_de_plage(plage) for support in edition.get("media", []) for plage in support.get("tracks", [])]


def en_https(adresse):
    """La Cover Art Archive donne des adresses en http : la page publiée (en https) les refuserait."""
    return "https://" + adresse[len("http://"):] if adresse and adresse.startswith("http://") else adresse


def lire_images(identifiant):
    """
    Images d'une édition dans la Cover Art Archive, la pochette d'abord :
    [{"type", "url" (1 200 px), "original" (pleine taille), "miniature" (250 px)}].
    """
    reponse = appeler("release/%s" % identifiant, {}, base=ADRESSE_IMAGES)
    images = []
    for image in (reponse or {}).get("images", []):
        vignettes = image.get("thumbnails") or {}
        original = en_https(image.get("image"))
        if not original:
            continue
        images.append({
            "type": "musicbrainz",
            "url": en_https(vignettes.get("1200") or vignettes.get("large")) or original,
            "original": original,
            "miniature": en_https(vignettes.get("250") or vignettes.get("small")) or original,
            "pochette": bool(image.get("front")),
        })
    images.sort(key=lambda i: not i["pochette"])  # la pochette en premier
    for image in images:
        del image["pochette"]
    return images


# ---------------------------------------------------------------------------
# Plages Discogs à associer
# ---------------------------------------------------------------------------

def plages_a_associer(plages):
    """
    Plages Discogs qui correspondent à une plage du disque, dans l'ordre :
    les intertitres sont écartés, et une œuvre en plusieurs mouvements compte
    pour ses mouvements.
    """
    resultat = []
    for plage in plages or []:
        if plage.get("type") == "intertitre":
            continue
        if plage.get("sous_plages"):
            resultat.extend(plages_a_associer(plage["sous_plages"]))
        else:
            resultat.append(plage)
    return resultat


def ajouter_oeuvres(plages, oeuvres, avec_parente=True):
    """
    Renvoie une copie des plages Discogs où chaque plage reçoit sa clé « oeuvre » (ou aucune).
    Sans avec_parente, l'œuvre parente est retirée.
    """
    copie = json.loads(json.dumps(plages or []))
    a_associer = plages_a_associer(copie)
    for plage in a_associer:
        plage.pop("oeuvre", None)
    if oeuvres and len(oeuvres) == len(a_associer):
        for plage, oeuvre in zip(a_associer, oeuvres):
            if oeuvre:
                plage["oeuvre"] = oeuvre if avec_parente else dict(oeuvre, parente=None)
    return copie


# ---------------------------------------------------------------------------
# Cache et mise à jour
# ---------------------------------------------------------------------------

def lire_cache(fichier):
    if not fichier.exists():
        return {}
    try:
        return json.loads(fichier.read_text(encoding="utf-8"))
    except ValueError:
        return {}


def ecrire_cache(fichier, cache):
    temporaire = fichier.with_suffix(".tmp")
    temporaire.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    temporaire.replace(fichier)


def a_chercher(entree, nb_plages):
    """Vrai si ce disque doit être (re)cherché sur MusicBrainz."""
    if not entree or entree.get("nb_plages") != nb_plages:
        return True  # jamais cherché, ou tracklist Discogs modifiée depuis
    if entree.get("version", 1) < VERSION_RECHERCHE:
        return True  # cherché avant un changement de la façon de chercher
    age = (date.today() - date.fromisoformat(entree["maj"])).days
    return age >= JOURS_AVANT_RAFRAICHISSEMENT


def mettre_a_jour(fichier, disques, tout=False):
    """
    Cherche sur MusicBrainz les disques qui ne sont pas encore dans le cache
    (ou dont la recherche est ancienne), au plus DISQUES_PAR_SYNCHRO, sauf si
    tout est vrai. `disques` : liste de (release_id, master_id, plages Discogs, codes-barres).
    Renvoie le cache : {release_id (texte): {"maj", "version", "nb_plages", "methode", "release", "oeuvres", "images"}}.
    """
    cache = lire_cache(fichier)
    a_faire = [d for d in disques if a_chercher(cache.get(str(d[0])), len(plages_a_associer(d[2])))]
    # Les disques jamais cherchés d'abord, puis les recherches les plus anciennes.
    a_faire.sort(key=lambda d: (str(d[0]) in cache, (cache.get(str(d[0])) or {}).get("version", 1),
                                (cache.get(str(d[0])) or {}).get("maj", "")))
    if not tout:
        a_faire = a_faire[:DISQUES_PAR_SYNCHRO]
    print("  %d disques à chercher sur MusicBrainz (les autres sont déjà connus)" % len(a_faire))

    for numero, (release_id, master_id, plages, codes_barres) in enumerate(a_faire, start=1):
        nb_plages = len(plages_a_associer(plages))
        try:
            identifiant, methode = trouver_edition(release_id, master_id, nb_plages, codes_barres)
            oeuvres = lire_oeuvres(identifiant) if identifiant else None
            images = lire_images(identifiant) if methode in METHODES_EXACTES else []
        except (urllib.error.URLError, ValueError, OSError) as erreur:
            # Un disque en erreur ne doit pas bloquer la synchro : il sera repris la prochaine fois.
            print("  Disque %s ignoré pour MusicBrainz (%s)" % (release_id, erreur))
            continue
        if oeuvres is not None and len(oeuvres) != nb_plages:
            oeuvres = None  # nombre de plages différent : on n'associe rien
        cache[str(release_id)] = {
            "maj": date.today().isoformat(),
            "version": VERSION_RECHERCHE,
            "nb_plages": nb_plages,
            "methode": methode,
            "release": identifiant,
            "oeuvres": oeuvres if oeuvres and any(oeuvres) else None,
            "images": images,
        }
        if numero % 25 == 0 or numero == len(a_faire):
            print("  %d/%d" % (numero, len(a_faire)))
            ecrire_cache(fichier, cache)  # enregistré en route : rien de perdu si la synchro s'arrête

    # On oublie les disques qui ne sont plus dans la collection.
    presents = {str(d[0]) for d in disques}
    cache = {cle: valeur for cle, valeur in cache.items() if cle in presents}
    ecrire_cache(fichier, cache)
    return cache
