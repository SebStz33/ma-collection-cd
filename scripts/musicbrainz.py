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
des deux côtés, pour ne jamais attribuer une œuvre à la mauvaise plage. Sinon, deuxième
essai : une œuvre que Discogs découpe en mouvements (7.1, 7.2…) compte pour une seule
plage, comme sur MusicBrainz quand la suite y tient en une plage ; chaque mouvement
reçoit alors l'œuvre de cette plage. Sinon, troisième essai : association par position
(« 10-3 » = plage 3 du CD 10), CD par CD ; voir associer_par_position.

Pour une édition exacte, on lit aussi les dates d'enregistrement des plages, quand
MusicBrainz les a (« enregistré en Autriche, 1958-02 », dates des interprètes…) :
on en garde la première et la dernière année.

Les résultats sont gardés dans data/musicbrainz.json (le « cache ») et relus tous
les 30 jours. Aucun jeton n'est nécessaire. Règle de MusicBrainz : au plus une
requête par seconde, et une application qui se présente dans le « User-Agent ».
"""

import json
import re
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
# Version 3 : deuxième essai d'association (mouvements Discogs = une plage MusicBrainz) ;
#             seuls les disques trouvés sans œuvres sont revus (voir a_chercher).
# Version 4 : années d'enregistrement ; seules les éditions exactes sont revues.
# Version 5 : année de parution de l'édition (quand Discogs n'en a pas) ; seules les éditions
#             exactes sans année Discogs sont revues.
# Version 9 : éditions de plus de 500 enregistrements (gros coffrets) : œuvres et années lues par paquets
#             (voir lire_relations_par_paquets) ; seules ces éditions sont revues.
# Version 10 : durées des plages (en millisecondes) des éditions exactes ; seules les éditions exactes
#              dont une plage n'a pas de durée sur Discogs sont revues.
# Version 11 : association par position (numéro de CD + numéro de plage) quand les nombres de plages
#              diffèrent (voir associer_par_position) ; seules les éditions trouvées sans œuvres sont revues.
# Version 12 : artistes de l'enregistrement de chaque plage (« Academy of Ancient Music, Richard Egarr »),
#              gardés avec son œuvre ; seules les compilations (« Various ») trouvées avec œuvres sont revues.
# Version 13 : ces artistes viennent d'abord de l'enregistrement et de ses interprètes reliés (la plage
#              d'une compilation classique ne crédite que le compositeur) ; mêmes éditions revues.
# Version 14 : rôle de chaque interprète (instrument, voix, direction) ; mêmes éditions revues.
# (La tracklist MusicBrainz pour une tracklist Discogs trop sommaire, voir tracklist_sommaire, n'a pas
#  demandé de nouvelle version : un seul disque concerné, relu avec --relire.)
VERSION_RECHERCHE = 14

# Au-delà de ce nombre d'enregistrements, le serveur MusicBrainz ne renvoie plus les relations (œuvres,
# dates) dans la lecture d'une édition, pour ne pas saturer : on les lit alors par paquets de 100.
MAX_RELATIONS_PAR_EDITION = 500
TAILLE_PAQUET = 100

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
    resultat = {"id": oeuvre["id"], "titre": oeuvre.get("title", ""), "compositeur": compositeur, "parente": parente}
    artistes, roles = artistes_de_plage(plage_mb)
    if artistes:
        resultat["artistes"] = artistes
    if roles:
        resultat["roles"] = roles
    return resultat


# Relations d'un enregistrement qui désignent ses interprètes, dans l'ordre où on les affiche.
RELATIONS_INTERPRETES = ("conductor", "performing orchestra", "performer", "instrument", "vocal", "chorus master")


def role_de_relation(relation):
    """
    Rôle d'un interprète d'après sa relation MusicBrainz, en anglais comme sur MusicBrainz
    (la page le traduit) : « piano », « soprano vocals », « conductor »… ; None pour un orchestre,
    un ensemble ou un interprète sans précision.
    """
    type_relation = relation.get("type")
    attributs = [a for a in relation.get("attributes") or [] if a not in ("additional", "guest", "solo")]
    if type_relation in ("instrument", "vocal"):
        return ", ".join(attributs) or ("vocals" if type_relation == "vocal" else None)
    if type_relation in ("conductor", "chorus master"):
        return type_relation
    return None


def artistes_de_plage(plage_mb):
    """
    Interprètes d'une plage MusicBrainz : (liste de noms, {nom: rôle}), vides si MusicBrainz n'en a pas.
    Les noms :
      1. l'« Artiste de l'enregistrement » (« Academy of Ancient Music, Richard Egarr ») ;
      2. les interprètes reliés à l'enregistrement (chef, orchestre, soliste…) ;
      3. à défaut, l'artiste de la plage, qui dans une compilation classique est souvent le compositeur.
    Le compositeur peut y figurer : la page le retire elle-même.
    """
    enregistrement = plage_mb.get("recording") or {}
    noms = []

    def ajouter(nom):
        if nom and nom.lower() not in ("various artists", "[unknown]", "[dialogue]") and nom not in noms:
            noms.append(nom)

    for credit in enregistrement.get("artist-credit") or []:
        ajouter((credit.get("artist") or {}).get("name") or credit.get("name"))
    relations = enregistrement.get("relations") or []
    roles = {}
    for type_relation in RELATIONS_INTERPRETES:
        for relation in relations:
            if relation.get("type") == type_relation and relation.get("artist"):
                nom = relation["artist"].get("name")
                ajouter(nom)
                role = role_de_relation(relation)
                if nom and role and nom not in roles:
                    roles[nom] = role
    if not noms:
        for credit in plage_mb.get("artist-credit") or []:
            ajouter((credit.get("artist") or {}).get("name") or credit.get("name"))
    return noms, {nom: role for nom, role in roles.items() if nom in noms}


# Relations d'un enregistrement dont la date est celle de l'enregistrement : le lieu, l'œuvre
# jouée et les interprètes. Pas le mixage ni le mastering, souvent refaits des années plus tard.
RELATIONS_DATEES = {
    "recorded at", "recorded in", "performance", "performer", "instrument", "vocal",
    "conductor", "performing orchestra", "chorus master", "concertmaster",
}

# Premier enregistrement sonore (phonographe d'Edison) : une date plus ancienne est une erreur de
# saisie sur MusicBrainz (1772 pour 1972, par exemple) et n'est pas gardée.
PREMIERE_ANNEE_POSSIBLE = 1877


def annees_de_plage(plage_mb):
    """Années d'enregistrement d'une plage MusicBrainz (ensemble, vide si MusicBrainz n'en a pas)."""
    annees = set()
    for relation in (plage_mb.get("recording") or {}).get("relations", []):
        if relation.get("type") not in RELATIONS_DATEES:
            continue
        for cle in ("begin", "end"):
            date_texte = relation.get(cle) or ""
            if len(date_texte) >= 4 and date_texte[:4].isdigit():
                annee = int(date_texte[:4])
                if PREMIERE_ANNEE_POSSIBLE <= annee <= date.today().year:
                    annees.add(annee)
    return annees


def lire_relations_par_paquets(identifiant):
    """
    Enregistrements d'une très grosse édition, avec leurs relations, lus par paquets de 100 :
    {identifiant d'enregistrement: enregistrement}. Si MusicBrainz refuse les relations des œuvres
    (compositeur, œuvre parente) dans ce type de lecture, on se contente des œuvres elles-mêmes.
    """
    inclusions = ["artist-credits+work-rels+work-level-rels+artist-rels+place-rels+area-rels",
                  "artist-credits+work-rels+artist-rels+place-rels+area-rels"]
    for inc in inclusions:
        enregistrements, decalage = {}, 0
        try:
            while True:
                reponse = appeler("recording", {"release": identifiant, "inc": inc,
                                                "limit": TAILLE_PAQUET, "offset": decalage}) or {}
                paquet = reponse.get("recordings", [])
                enregistrements.update((r["id"], r) for r in paquet)
                decalage += len(paquet)
                if not paquet or decalage >= reponse.get("recording-count", 0):
                    return enregistrements
        except urllib.error.HTTPError as erreur:
            if erreur.code != 400 or inc == inclusions[-1]:
                raise
    return {}


def lire_edition_mb(identifiant):
    """
    Lit une édition MusicBrainz. Renvoie (œuvres, années, année de parution, durées, positions, titres) : la liste
    des œuvres (ou None) de chaque plage, dans l'ordre, [première, dernière] année d'enregistrement (ou None),
    l'année de parution de l'édition (ou None), la durée de chaque plage en millisecondes (ou None)
    et la position de chaque plage : (numéro du disque, numéro de la plage sur ce disque), puis le titre de chaque plage.
    """
    edition = appeler("release/%s" % identifiant, {
        "inc": "recordings+artist-credits+recording-level-rels+work-rels+work-level-rels+artist-rels+place-rels+area-rels",
    })
    if not edition:
        return None, None, None, None, None, None
    plages = [plage for support in edition.get("media", []) for plage in support.get("tracks", [])]
    positions = [(support.get("position"), plage.get("position"))
                 for support in edition.get("media", []) for plage in support.get("tracks", [])]
    if len(plages) > MAX_RELATIONS_PAR_EDITION:
        # Gros coffret : les relations manquent dans la réponse ; on les lit à part et on les rattache
        # à chaque plage par l'identifiant de son enregistrement.
        enregistrements = lire_relations_par_paquets(identifiant)
        for plage in plages:
            complet = enregistrements.get((plage.get("recording") or {}).get("id"))
            if complet:
                plage["recording"] = complet
    annees = set().union(*(annees_de_plage(plage) for plage in plages)) if plages else set()
    # Date de l'édition : « 1994-05-02 », « 1994 » ou absente.
    date_edition = edition.get("date") or ""
    annee_parution = int(date_edition[:4]) if date_edition[:4].isdigit() else None
    durees = [plage.get("length") or (plage.get("recording") or {}).get("length") for plage in plages]
    return ([oeuvre_de_plage(plage) for plage in plages], ([min(annees), max(annees)] if annees else None),
            annee_parution, durees, positions, [plage.get("title") or "" for plage in plages])


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


def numero_de_plage(position):
    """
    Numéro de la plage du disque pour une position Discogs de mouvement :
    « 7.2 » -> « 7 », « 7b » -> « 7 » ; une position simple (« 7 », « 1-3 ») reste telle quelle.
    """
    position = (position or "").strip()
    debut, _, fin = position.rpartition(".")
    if debut and fin.isdigit():
        return debut
    if len(position) > 1 and position[-1].isalpha() and position[-2].isdigit():
        return position[:-1]
    return position


def blocs_a_associer(plages):
    """
    Deuxième façon de compter : des mouvements qui partagent un même numéro de plage
    (7.1, 7.2… ou 7a, 7b…, ou la même position répétée : 5-3, 5-3…) comptent pour une seule plage, comme sur MusicBrainz quand
    la suite y tient en une plage. Des mouvements numérotés chacun (1, 2… 6 sous
    « Háry János Suite ») restent des plages séparées. Renvoie une liste de blocs,
    chacun étant la liste de ses plages Discogs.
    """
    blocs = []
    for plage in plages or []:
        if plage.get("type") == "intertitre":
            continue
        sous_plages = [p for p in plage.get("sous_plages") or [] if p.get("type") != "intertitre"]
        if not sous_plages:
            blocs.append([plage])
            continue
        numeros = {numero_de_plage(p.get("position")) for p in sous_plages}
        positions = {(p.get("position") or "").strip() for p in sous_plages}
        meme_position = len(positions) == 1 and len(sous_plages) > 1  # 5-3, 5-3, 5-3… : une seule plage
        if (len(numeros) == 1 and not numeros & positions) or meme_position:
            blocs.append(plages_a_associer(sous_plages))  # 7.1 à 7.5 : une seule plage du disque
        else:
            blocs.extend(blocs_a_associer(sous_plages))
    return blocs


def a_mouvements_meme_position(plages):
    """Vrai si une œuvre a plusieurs mouvements à la même position (5-3, 5-3… : une seule plage du disque)."""
    for plage in plages or []:
        sous_plages = plage.get("sous_plages") or []
        if len(sous_plages) > 1 and len({(p.get("position") or "").strip() for p in sous_plages}) == 1:
            return True
    return False


def nombres_acceptes(plages):
    """Nombres de plages MusicBrainz qu'on sait associer : plage par plage, ou mouvements groupés."""
    return {len(plages_a_associer(plages)), len(blocs_a_associer(plages))}


def ajouter_oeuvres(plages, oeuvres, avec_parente=True):
    """
    Renvoie une copie des plages Discogs où chaque plage reçoit sa clé « oeuvre » (ou aucune).
    Sans avec_parente, l'œuvre parente est retirée.
    """
    copie = json.loads(json.dumps(plages or []))
    a_associer = plages_a_associer(copie)
    for plage in a_associer:
        plage.pop("oeuvre", None)
    if not oeuvres:
        return copie
    if len(oeuvres) == len(a_associer):
        paires = [([plage], oeuvre) for plage, oeuvre in zip(a_associer, oeuvres)]
    else:
        blocs = blocs_a_associer(copie)
        paires = list(zip(blocs, oeuvres)) if len(oeuvres) == len(blocs) else []
    for bloc, oeuvre in paires:
        if oeuvre:
            for plage in bloc:
                plage["oeuvre"] = oeuvre if avec_parente else dict(oeuvre, parente=None)
    return copie


# Position Discogs d'une plage : « 10-3 », « 3 », un mouvement « 19-3.1 » ou « 6-24.a » (sur la plage 3
# ou 24 du disque), ou plusieurs plages du disque regroupées en une ligne : « 10-1 : 15 », « 28- 1 : 13 ».
MOTIF_POSITION = re.compile(
    r"^(?:(?:CD)?(\d+)\s*-\s*)?(\d+)\s*(?::\s*(\d+)|\.\s*\d+|\.?\s*[a-z])?$", re.IGNORECASE)


def lire_position(position):
    """(disque ou None, première plage, dernière plage) d'une position Discogs, ou None si illisible."""
    trouve = MOTIF_POSITION.match((position or "").strip())
    if not trouve:
        return None
    disque, debut, fin = trouve.groups()
    debut = int(debut)
    fin = int(fin) if fin else debut
    if fin < debut:
        return None
    return (int(disque) if disque else None, debut, fin)


def oeuvre_commune(oeuvres):
    """
    Œuvre de plusieurs plages MusicBrainz regroupées en une ligne Discogs (« 10-1 : 15 ») : leur œuvre
    chapeau (ou leur œuvre) si c'est la même pour toutes, sinon None.
    """
    if not oeuvres or not all(oeuvres):
        return None
    references = [o.get("parente") or o for o in oeuvres]
    if len({r["id"] for r in references}) != 1:
        return None
    if len(oeuvres) == 1:
        return oeuvres[0]
    return {"id": references[0]["id"], "titre": references[0].get("titre", ""),
            "compositeur": oeuvres[0].get("compositeur"), "parente": None}


def associer_par_position(plages, oeuvres, durees, positions):
    """
    Troisième essai, quand les nombres de plages diffèrent : chaque plage Discogs est associée à la plage
    MusicBrainz de même position (numéro de CD + numéro de plage), disque par disque.
      - « 10-3 » : plage 3 du CD 10 ;
      - « 19-3.1 » … « 19-3.13 » : mouvements sur la plage 3 du CD 19, ils en reçoivent tous l'œuvre ;
      - « 10-1 : 15 » : plages 1 à 15 du CD 10, on donne leur œuvre chapeau commune s'il y en a une.
    Sécurité : un disque n'est associé que si ses positions Discogs couvrent exactement toutes les plages
    de ce disque sur MusicBrainz ; sinon on essaie associer_par_intertitre, et à défaut ses plages
    ne reçoivent rien (les autres disques, si).
    Renvoie (œuvres, durées) alignées sur plages_a_associer(plages), ou (None, None).
    Une durée n'est donnée que pour une plage Discogs qui correspond à une seule plage MusicBrainz entière.
    """
    if not positions or not oeuvres or len(positions) != len(oeuvres):
        return None, None
    durees = durees if durees and len(durees) == len(oeuvres) else [None] * len(oeuvres)
    a_associer = plages_a_associer(plages)
    un_seul_disque = len({d for d, _ in positions}) == 1
    index_mb = {}
    for rang, (disque, numero) in enumerate(positions):
        index_mb[(disque, numero)] = rang
    lues = [lire_position(p.get("position")) for p in a_associer]
    # Plages MusicBrainz couvertes, disque par disque, et nombre de lignes Discogs par plage MusicBrainz.
    couvertes, lignes_par_plage = {}, {}
    for lue in lues:
        if not lue:
            continue
        disque = lue[0] if lue[0] is not None else (positions[0][0] if un_seul_disque else None)
        if disque is None:
            continue
        for numero in range(lue[1], lue[2] + 1):
            couvertes.setdefault(disque, set()).add(numero)
            lignes_par_plage[(disque, numero)] = lignes_par_plage.get((disque, numero), 0) + 1
    attendues = {}
    for disque, numero in positions:
        attendues.setdefault(disque, set()).add(numero)
    disques_ok = {d for d in attendues if couvertes.get(d) == attendues[d]}
    rang_par_intertitre = associer_par_intertitre(plages, attendues, disques_ok, index_mb,
                                                  positions[0][0] if un_seul_disque else None)
    resultat_oeuvres, resultat_durees = [], []
    for plage, lue in zip(a_associer, lues):
        oeuvre = duree = None
        disque = None
        if lue:
            disque = lue[0] if lue[0] is not None else (positions[0][0] if un_seul_disque else None)
        if id(plage) in rang_par_intertitre:
            oeuvre = oeuvres[rang_par_intertitre[id(plage)]]
        elif disque in disques_ok:
            rangs = [index_mb[(disque, n)] for n in range(lue[1], lue[2] + 1)]
            oeuvre = oeuvre_commune([oeuvres[r] for r in rangs])
            if len(rangs) == 1 and lignes_par_plage.get((disque, lue[1])) == 1:
                duree = durees[rangs[0]]
        resultat_oeuvres.append(oeuvre)
        resultat_durees.append(duree)
    if not any(resultat_oeuvres) and not any(resultat_durees):
        return None, None
    return resultat_oeuvres, resultat_durees


def associer_par_intertitre(plages, attendues, disques_ok, index_mb, disque_unique):
    """
    Dernier essai, pour un disque que associer_par_position n'a pas pu associer : toutes ses plages
    Discogs sont rangées sous des intertitres, et il y a autant d'intertitres que de plages MusicBrainz
    sur ce disque (111 DG, CD 8 : 26 plages Discogs sous 6 intertitres, les 4 tableaux de Petrouchka
    et les 2 parties du Sacre ; 6 plages MusicBrainz). Le 1er intertitre va avec la plage MusicBrainz 1,
    le 2e avec la 2e, etc. ; ses plages reçoivent l'œuvre de cette plage MusicBrainz.
    Renvoie {id(plage Discogs): rang de la plage MusicBrainz}.
    """
    def disque_de(plage):
        lue = lire_position(plage.get("position"))
        if not lue:
            return None
        return lue[0] if lue[0] is not None else disque_unique

    groupes, isolees = {}, set()
    for plage in plages or []:
        if plage.get("type") == "intertitre":
            continue
        if not plage.get("sous_plages"):
            isolees.add(disque_de(plage))  # plage hors intertitre : ce disque ne convient pas
            continue
        reelles = plages_a_associer(plage["sous_plages"])
        disques = {disque_de(p) for p in reelles}
        if len(disques) != 1:
            isolees.update(disques)  # intertitre à cheval sur deux disques, ou position illisible
            continue
        groupes.setdefault(disques.pop(), []).append(reelles)
    resultat = {}
    for disque, numeros in attendues.items():
        if disque in disques_ok or disque in isolees or disque not in groupes:
            continue
        if len(groupes[disque]) != len(numeros):
            continue
        for reelles, numero in zip(groupes[disque], sorted(numeros)):
            for plage in reelles:
                resultat[id(plage)] = index_mb[(disque, numero)]
    return resultat


def tracklist_sommaire(plages, positions):
    """
    Vrai si la tracklist Discogs est trop sommaire pour y relier les œuvres : au plus une plage par disque
    (« 1-1 Chopin », « 2-1 Schumann »…) alors que l'édition MusicBrainz en a davantage.
    """
    nb_discogs = len(plages_a_associer(plages))
    return bool(positions) and len(positions) > nb_discogs and nb_discogs <= len({d for d, _ in positions})


def plages_de_musicbrainz(titres, durees, positions, oeuvres=None):
    """
    Tracklist de l'édition MusicBrainz dans le format de sync.py : « 1-1 », « 1-2 »… (« 1 », « 2 »…
    pour un seul disque), titre et durée. Les œuvres sont ajoutées ensuite par sync.py (ajouter_oeuvres).
    Comme les « index tracks » de Discogs, les plages consécutives d'une même œuvre parente, sur un même
    disque, sont regroupées sous une plage « oeuvre » à son titre (« Carnaval, op. 9 » et ses mouvements).
    """
    un_seul_disque = len({d for d, _ in positions}) == 1
    oeuvres = oeuvres or [None] * len(positions)
    plages, groupe_en_cours = [], None
    for (disque, numero), titre, duree, oeuvre in zip(positions, titres, durees or [None] * len(positions), oeuvres):
        plage = {"position": str(numero) if un_seul_disque else "%s-%s" % (disque, numero), "titre": titre,
                 "duree": texte_duree(duree) if duree else "", "type": "plage", "artistes": [], "credits": []}
        if duree:
            plage["duree_source"] = "musicbrainz"
        parente = (oeuvre or {}).get("parente")
        cle = (disque, parente["id"]) if parente else None
        if cle and groupe_en_cours and groupe_en_cours[0] == cle:
            groupe_en_cours[1].append(plage)
        else:
            groupe_en_cours = [cle, [plage], parente]
            plages.append(groupe_en_cours)
    resultat = []
    for cle, groupe, parente in plages:
        if cle and len(groupe) > 1:
            resultat.append({"position": "", "titre": parente.get("titre", ""), "duree": "", "type": "oeuvre",
                             "artistes": [], "credits": [], "sous_plages": groupe})
        else:
            resultat.extend(groupe)
    return resultat


def texte_duree(millisecondes):
    """Durée MusicBrainz (millisecondes) écrite comme Discogs : « 4:20 », « 1:02:05 »."""
    secondes = int(round(millisecondes / 1000))
    heures, reste = divmod(secondes, 3600)
    minutes, secondes = divmod(reste, 60)
    return "%d:%02d:%02d" % (heures, minutes, secondes) if heures else "%d:%02d" % (minutes, secondes)


def ajouter_durees(plages, durees):
    """
    Complète les plages Discogs sans durée avec celles de MusicBrainz (clé « duree_source » :
    "musicbrainz"). Seulement plage par plage : si des mouvements Discogs sont groupés en une
    plage MusicBrainz, on ne sait pas répartir la durée, et on n'ajoute rien.
    """
    a_associer = plages_a_associer(plages)
    if not durees or len(durees) != len(a_associer):
        return plages
    for plage, duree in zip(a_associer, durees):
        if not plage.get("duree") and duree:
            plage["duree"] = texte_duree(duree)
            plage["duree_source"] = "musicbrainz"
    return plages


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


# ---------------------------------------------------------------------------
# Rattachement manuel : un coffret absent de MusicBrainz, dont les disques y sont séparément
# (data/musicbrainz_manuel.json : {"13301735": {"1": "T3DV0ZJ6EcUi83z3suZYSaBfFnQ-", "2": …}}).
# ---------------------------------------------------------------------------

MOTIF_MBID = re.compile(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\s*#\s*(\d+))?", re.IGNORECASE)


def trouver_disque_manuel(reference):
    """
    Disque MusicBrainz désigné à la main : un ID de disque (« T3DV0ZJ6EcUi83z3suZYSaBfFnQ- », l'empreinte
    du CD, onglet « ID de disque » sur MusicBrainz), ou une parution (lien ou identifiant), suivie de « #2 »
    pour son 2e CD. Renvoie (identifiant de la parution, numéro du CD dans la parution, titre) ou (None, None, None).
    """
    reference = (reference or "").strip()
    trouve = MOTIF_MBID.search(reference)
    if trouve:
        parution = appeler("release/%s" % trouve.group(1).lower(), {})
        if not parution:
            return None, None, None
        return parution["id"], int(trouve.group(2) or 1), parution.get("title", "")
    if not reference:
        return None, None, None
    reponse = appeler("discid/%s" % urllib.parse.quote(reference, safe=".-_"), {"cdstubs": "no"})
    for parution in (reponse or {}).get("releases", []):
        for support in parution.get("media", []):
            if any(d.get("id") == reference for d in support.get("discs", [])):
                return parution["id"], support.get("position"), parution.get("title", "")
    return None, None, None


def lire_disques_manuels(plages, manuel):
    """
    Lit sur MusicBrainz chaque disque désigné à la main et l'associe au CD du coffret par position
    (même sécurité que associer_par_position : un CD n'est relié que si ses plages Discogs couvrent
    exactement celles du disque MusicBrainz). Renvoie (œuvres, durées, années, détails par CD) ; détails :
    {"1": {"reference", "release", "titre", "plages_mb", "plages_discogs", "reliees"}}.
    """
    oeuvres, durees, positions, annees, details = [], [], [], [], {}
    for cd in sorted(manuel, key=lambda n: int(n) if str(n).isdigit() else 0):
        reference = manuel[cd]
        release, support, titre = trouver_disque_manuel(reference)
        details[str(cd)] = {"reference": reference, "release": release, "titre": titre, "plages_mb": 0}
        if not release or not str(cd).isdigit():
            continue
        oeuvres_mb, annees_mb, _, durees_mb, positions_mb, _ = lire_edition_mb(release)
        rangs = [i for i, (d, _) in enumerate(positions_mb or []) if d == support]
        details[str(cd)]["plages_mb"] = len(rangs)
        for i in rangs:
            oeuvres.append(oeuvres_mb[i])
            durees.append(durees_mb[i] if durees_mb else None)
            positions.append((int(cd), positions_mb[i][1]))
        if rangs and annees_mb:
            annees.extend(annees_mb)
    a_associer = plages_a_associer(plages)
    resultat_oeuvres, resultat_durees = associer_par_position(plages, oeuvres, durees, positions)
    for cd, detail in details.items():
        rangs = [i for i, p in enumerate(a_associer)
                 if (lire_position(p.get("position")) or (None,))[0] == (int(cd) if cd.isdigit() else None)]
        detail["plages_discogs"] = len(rangs)
        detail["reliees"] = sum(1 for i in rangs if resultat_oeuvres and resultat_oeuvres[i]) if resultat_oeuvres else 0
    return resultat_oeuvres, resultat_durees, ([min(annees), max(annees)] if annees else None), details


def a_chercher(entree, nb_plages, sans_annee=False, meme_position=False, sans_duree=False, compilation=False,
               force=False, manuel=None):
    """
    Vrai si ce disque doit être (re)cherché sur MusicBrainz. `sans_annee` : Discogs n'a pas son année.
    `compilation` : disque crédité à « Various » sur Discogs. `force` : demandé avec --relire.
    """
    if force:
        return True
    if entree and (entree.get("manuel") or None) != (manuel or None):
        return True  # rattachement manuel ajouté, modifié ou retiré (data/musicbrainz_manuel.json)
    if not entree or entree.get("nb_plages") != nb_plages:
        return True  # jamais cherché, ou tracklist Discogs modifiée depuis
    version = entree.get("version", 1)
    if version < 2:
        return True  # cherché avant les codes-barres : tout est à revoir
    if version < 3 and entree.get("release") and not entree.get("oeuvres"):
        return True  # trouvé sans œuvres : le deuxième essai d'association peut aider
    if version < 4 and entree.get("methode") in METHODES_EXACTES:
        return True  # édition exacte : on lit en plus ses années d'enregistrement
    if version < 5 and sans_annee and entree.get("methode") in METHODES_EXACTES:
        return True  # pas d'année sur Discogs : on lit celle de l'édition MusicBrainz
    annees = entree.get("annees_enregistrement")
    if version < 6 and annees and annees[0] < PREMIERE_ANNEE_POSSIBLE:
        return True  # année d'enregistrement impossible (erreur MusicBrainz) : on relit sans elle
    if version < 7 and entree.get("methode") == "album":
        return True  # trouvé par l'album : on lit en plus les années d'enregistrement de cette édition
    if version < 8 and meme_position and entree.get("release") and not entree.get("oeuvres"):
        return True  # mouvements à la même position (5-3, 5-3…) : désormais comptés pour une plage
    if version < 9 and nb_plages > MAX_RELATIONS_PAR_EDITION and entree.get("release") and not entree.get("oeuvres"):
        return True  # gros coffret trouvé sans œuvres : on lit désormais ses relations par paquets
    if version < 10 and sans_duree and entree.get("methode") in METHODES_EXACTES:
        return True  # une plage sans durée sur Discogs : on lit les durées de l'édition MusicBrainz
    if version < 11 and entree.get("release") and not entree.get("oeuvres"):
        return True  # trouvé sans œuvres : l'association par position (CD + plage) peut aider
    if version < 14 and compilation and entree.get("oeuvres"):
        return True  # compilation : on lit en plus les artistes de l'enregistrement de chaque plage
    age = (date.today() - date.fromisoformat(entree["maj"])).days
    return age >= JOURS_AVANT_RAFRAICHISSEMENT


def mettre_a_jour(fichier, disques, tout=False, sans_annee=(), compilations=(), forces=(), manuels=None):
    """
    Cherche sur MusicBrainz les disques qui ne sont pas encore dans le cache
    (ou dont la recherche est ancienne), au plus DISQUES_PAR_SYNCHRO, sauf si
    tout est vrai. `disques` : liste de (release_id, master_id, plages Discogs, codes-barres).
    `sans_annee` : release_id des disques sans année sur Discogs. `compilations` : ceux crédités à « Various ».
    `forces` : ceux demandés avec --relire, cherchés en premier même s'ils sont à jour.
    `manuels` : {release_id (texte): {n° de CD: disque MusicBrainz}} (data/musicbrainz_manuel.json).
    Renvoie le cache : {release_id (texte): {"maj", "version", "nb_plages", "methode", "release", "oeuvres", "images"}},
    plus « plages » (la tracklist MusicBrainz) quand celle de Discogs est trop sommaire.
    """
    cache = lire_cache(fichier)
    manuels = manuels or {}
    a_faire = [d for d in disques
               if a_chercher(cache.get(str(d[0])), len(plages_a_associer(d[2])), d[0] in sans_annee,
                             a_mouvements_meme_position(d[2]),
                             any(not p.get("duree") for p in plages_a_associer(d[2])), d[0] in compilations,
                             d[0] in forces, manuels.get(str(d[0])))]
    # Les disques demandés avec --relire d'abord, puis ceux jamais cherchés, puis les recherches les plus anciennes.
    a_faire.sort(key=lambda d: (d[0] not in forces and str(d[0]) not in manuels, str(d[0]) in cache, (cache.get(str(d[0])) or {}).get("version", 1),
                                (cache.get(str(d[0])) or {}).get("maj", "")))
    if not tout:
        a_faire = a_faire[:DISQUES_PAR_SYNCHRO]
    print("  %d disques à chercher sur MusicBrainz (les autres sont déjà connus)" % len(a_faire))

    for numero, (release_id, master_id, plages, codes_barres) in enumerate(a_faire, start=1):
        nb_plages = len(plages_a_associer(plages))
        manuel = manuels.get(str(release_id))
        if manuel:
            # Coffret rattaché à la main, disque par disque : pas de recherche automatique.
            try:
                oeuvres, durees, annees, details = lire_disques_manuels(plages, manuel)
            except (urllib.error.URLError, ValueError, OSError) as erreur:
                print("  Disque %s ignoré pour MusicBrainz (%s)" % (release_id, erreur))
                continue
            cache[str(release_id)] = {
                "maj": date.today().isoformat(), "version": VERSION_RECHERCHE, "nb_plages": nb_plages,
                "methode": "manuel", "release": None, "manuel": manuel, "disques_mb": details,
                "oeuvres": oeuvres if oeuvres and any(oeuvres) else None, "images": [],
                "annees_enregistrement": annees if oeuvres and any(oeuvres) else None, "annee_parution": None,
                "durees": durees if durees and any(durees) else None,
            }
            print("  Disque %s rattaché à la main : %s" % (release_id, ", ".join(
                "CD %s %s" % (cd, "%d/%d plages" % (d["reliees"], d["plages_discogs"]) if d["release"] else "introuvable sur MusicBrainz")
                for cd, d in details.items())))
            continue
        try:
            identifiant, methode = trouver_edition(release_id, master_id, nb_plages, codes_barres)
            oeuvres, annees, annee_parution, durees, positions, titres = (
                lire_edition_mb(identifiant) if identifiant else (None, None, None, None, None, None))
            images = lire_images(identifiant) if methode in METHODES_EXACTES else []
        except (urllib.error.URLError, ValueError, OSError) as erreur:
            # Un disque en erreur ne doit pas bloquer la synchro : il sera repris la prochaine fois.
            print("  Disque %s ignoré pour MusicBrainz (%s)" % (release_id, erreur))
            continue
        # Tracklist Discogs trop sommaire (une plage par disque) et édition exacte : on prend celle de
        # MusicBrainz. Une fois choisie, elle reste, même si la tracklist Discogs est complétée ensuite.
        precedente = cache.get(str(release_id)) or {}
        plages_mb = None
        if oeuvres is not None and methode in METHODES_EXACTES and (
                tracklist_sommaire(plages, positions) or precedente.get("plages")):
            plages_mb = plages_de_musicbrainz(titres, durees, positions, oeuvres)
            durees = None  # déjà dans les plages
        elif oeuvres is not None and len(oeuvres) not in nombres_acceptes(plages):
            # Nombre de plages différent, même en groupant les mouvements : on associe par position
            # (CD + plage) ; les listes gardées sont alors alignées sur les plages Discogs.
            oeuvres, durees = associer_par_position(plages, oeuvres, durees, positions)
        cache[str(release_id)] = {
            "maj": date.today().isoformat(),
            "version": VERSION_RECHERCHE,
            "nb_plages": nb_plages,
            "methode": methode,
            "release": identifiant,
            "oeuvres": oeuvres if oeuvres and any(oeuvres) else None,
            "images": images,
            # Années d'enregistrement : aussi pour une autre édition du même album (les enregistrements
            # sont en général les mêmes d'une réédition à l'autre) ; sync.py en note la source.
            "annees_enregistrement": annees if methode in METHODES_EXACTES + ("album",) else None,
            "annee_parution": annee_parution if methode in METHODES_EXACTES else None,
            # Durées des plages : seulement pour l'édition exacte (une réédition peut avoir d'autres durées).
            "durees": durees if methode in METHODES_EXACTES and durees and any(durees) else None,
        }
        if plages_mb:
            cache[str(release_id)]["plages"] = plages_mb
        if numero % 25 == 0 or numero == len(a_faire):
            print("  %d/%d" % (numero, len(a_faire)))
            ecrire_cache(fichier, cache)  # enregistré en route : rien de perdu si la synchro s'arrête

    # On oublie les disques qui ne sont plus dans la collection.
    presents = {str(d[0]) for d in disques}
    cache = {cle: valeur for cle, valeur in cache.items() if cle in presents}
    ecrire_cache(fichier, cache)
    return cache
