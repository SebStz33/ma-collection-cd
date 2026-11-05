"""
Années d'enregistrement : saisie manuelle, MusicBrainz, notes Discogs et titre ; disques « live »
(« Live » automatique d'après le titre ou les notes, quand le champ « Live / Studio » est vide).

Sources de l'année d'enregistrement, de la plus sûre à la moins sûre (la première trouvée gagne) :
  1. le champ perso Discogs « Année d’enregistrement (manuelle) », rempli à la main :
     « 1958 », « 1958-1961 » ou « à trouver » (l'année connue est fausse, la vraie reste à trouver) ;
  2. MusicBrainz, édition exacte (lien Discogs ou code-barre) ;
  3. MusicBrainz, autre édition du même album (trouvée par le master Discogs) ;
  4. le texte « Notes » de la fiche Discogs (« Recorded March 6, 1958 ») ;
  5. le titre du disque (« Bossa Nova 1958-1961 »), sauf en classique, où une année dans le titre
     est souvent celle de l'œuvre (« Requiem (Version 1893) »).

L'outil n'écrit jamais dans le champ manuel : vide, il laisse faire les autres sources.

Ce module n'utilise que la bibliothèque standard de Python.
"""

import re
import unicodedata
from datetime import date

# ---------------------------------------------------------------------------
# Saisie manuelle (champ perso Discogs)
# ---------------------------------------------------------------------------

CHAMP_MANUEL = "Année d’enregistrement (manuelle)"
CHAMP_LIVE = "Live / Studio"
NON_RENSEIGNE = "Non renseigné"
A_TROUVER = "à trouver"


def simplifier(texte):
    """Minuscules, sans accents, apostrophes droites : pour comparer des noms écrits un peu différemment."""
    texte = unicodedata.normalize("NFD", (texte or "").strip().lower())
    texte = "".join(c for c in texte if unicodedata.category(c) != "Mn")
    return re.sub(r"[’‘`´]", "'", texte)


def saisie_manuelle(champs):
    """
    Lit le champ manuel parmi les champs perso d'un exemplaire. Renvoie :
      ("annees", [première, dernière]) ; ("a_trouver", None) ; ("illisible", texte) ; ou None (champ vide).
    """
    valeur = next((v for nom, v in (champs or {}).items() if simplifier(nom) == simplifier(CHAMP_MANUEL)), "")
    valeur = (valeur or "").strip()
    if not valeur:
        return None
    if simplifier(valeur) == simplifier(A_TROUVER):
        return "a_trouver", None
    periode = re.fullmatch(r"(\d{4})(?:\s*[-–/]\s*(\d{4}))?", valeur)
    if periode:
        debut = int(periode.group(1))
        fin = int(periode.group(2) or debut)
        if PREMIERE_ANNEE_POSSIBLE <= debut <= fin <= date.today().year:
            return "annees", [debut, fin]
    return "illisible", valeur


# Premier enregistrement sonore (phonographe d'Edison) : une année plus ancienne n'est pas
# une année d'enregistrement (c'est souvent celle de la composition, ou une faute de frappe).
PREMIERE_ANNEE_POSSIBLE = 1877

# ---------------------------------------------------------------------------
# Repérage des années dans un texte
# ---------------------------------------------------------------------------

# Une année, ou une période : « 1958 », « 1958-1961 », « 1955-60 », « 1955/56 », « 1958 – 1961 ».
# « 1970s » (une décennie) et « 1958’s » ne comptent pas.
MOTIF_ANNEES = re.compile(r"(?<!\d)(1[89]\d\d|20\d\d)(?:\s*[-–/]\s*(\d{4}|\d{2}))?(?![\d]|['’]?s\b)")

# Mots qui annoncent un enregistrement, en plusieurs langues (texte mis en minuscules).
MOTS_ENREGISTREMENT = re.compile(
    r"recorded|recording|\brec\.|\brecs?\b|live at|live in|enregistr|aufgenommen|aufnahme"
    r"|registrat|registrazion|grabado|grabaci|opname|nagran|session"
)
# Mots qui annoncent une autre date (parution, remastérisation, droits…) : on s'arrête là.
MOTS_AUTRE_DATE = re.compile(
    r"remaster|mastered|mastering|℗|©|\(p\)|\(c\)|copyright|released|reissue|réédit|first published"
    r"|originally issued|parution|publié|digital transfer|transfert|compos"
)
# Longueur de texte lue après le mot « recorded » (une phrase courte).
LONGUEUR_APRES_MOT = 160


def annees_du_texte(texte):
    """Toutes les années plausibles d'un texte, périodes dépliées en (première, dernière)."""
    trouvees = []
    for premiere, seconde in MOTIF_ANNEES.findall(texte or ""):
        debut = int(premiere)
        fin = debut
        if seconde:
            fin = int(seconde) if len(seconde) == 4 else int(premiere[:2] + seconde)
            if fin < debut:
                fin = debut  # « 1999-01 » mal compris : on garde la première année
        if PREMIERE_ANNEE_POSSIBLE <= debut and fin <= date.today().year:
            trouvees.append((debut, fin))
    return trouvees


def annees_des_notes(notes):
    """
    Années d'enregistrement repérées dans le texte « Notes » d'une fiche Discogs :
    renvoie ((première, dernière), [phrases d'origine]) ou (None, []).
    On ne lit que le bout de texte qui suit un mot comme « Recorded », jusqu'à un mot qui
    annonce une autre date (« Remastered », « ℗ »…) ou la fin de la ligne.
    """
    annees, phrases = [], []
    for ligne in (notes or "").splitlines():
        minuscule = ligne.lower()
        fin_precedente = 0
        for mot in MOTS_ENREGISTREMENT.finditer(minuscule):
            if mot.start() < fin_precedente:
                continue  # « Rec. live at… » : déjà lu avec le mot précédent
            morceau = minuscule[mot.start():mot.start() + LONGUEUR_APRES_MOT]
            autre = MOTS_AUTRE_DATE.search(morceau, len(mot.group()))
            if autre:
                morceau = morceau[:autre.start()]
            trouvees = annees_du_texte(morceau)
            if trouvees:
                fin_precedente = mot.start() + len(morceau)
                annees.extend(trouvees)
                phrase = ligne[mot.start():mot.start() + len(morceau)].strip()
                if phrase not in phrases:
                    phrases.append(phrase)
    if not annees:
        return None, []
    return (min(a for a, _ in annees), max(b for _, b in annees)), phrases


def annees_du_titre(titre):
    """Années écrites dans le titre (« Bossa Nova 1958-1961 ») : (première, dernière) ou None."""
    annees = annees_du_texte(titre)
    if not annees:
        return None
    return min(a for a, _ in annees), max(b for _, b in annees)


# ---------------------------------------------------------------------------
# Choix de l'année et disques live
# ---------------------------------------------------------------------------

def choisir_annees(disque, annees_mb, methode_mb, exactes, avec_manuelle=True):
    """
    Renvoie ([première, dernière] ou None, source) selon l'ordre de priorité ci-dessus
    (sans la saisie manuelle si avec_manuelle est faux : c'est l'année « automatique »).
    Sources : "manuelle", "a_trouver", "musicbrainz", "musicbrainz_album", "notes_discogs", "titre", ou None.
    `exactes` : méthodes MusicBrainz qui désignent l'édition exacte.
    """
    manuelle = saisie_manuelle(disque.get("champs")) if avec_manuelle else None
    if manuelle and manuelle[0] == "annees":
        return manuelle[1], "manuelle"
    if manuelle and manuelle[0] == "a_trouver":
        return None, "a_trouver"
    if annees_mb:
        return list(annees_mb), ("musicbrainz" if methode_mb in exactes else "musicbrainz_album")
    notes, _ = annees_des_notes(disque.get("notes_discogs"))
    if notes:
        return list(notes), "notes_discogs"
    if "Classical" not in (disque.get("genres") or []):
        titre = annees_du_titre(disque.get("titre"))
        if titre:
            return list(titre), "titre"
    return None, None


# Notes ou titre d'un disque enregistré en concert, en plusieurs langues. Des expressions entières :
# « Violin Concerto » ne contient pas « in concert » ; « recorded live to two-track » (jargon de
# studio : enregistré sans montage) n'est pas un concert.
MOTS_LIVE = re.compile(
    r"\b(?:recorded live(?!\s+to\b)|live recordings?|live at|live in|live from|enregistrement public"
    r"|enregistr[ée]+ en public|en concert|in concert|concert recordings?|live-aufnahme|konzertmitschnitt|mitschnitt"
    r"|en vivo|dal vivo)\b",
    re.IGNORECASE,
)


def indice_live(disque):
    """
    Le disque semble « live » d'après son titre ou ses notes Discogs :
    renvoie (source, bout de texte) avec source "titre" ou "notes_discogs", ou None.
    """
    for source, texte in (("titre", disque.get("titre")), ("notes_discogs", disque.get("notes_discogs"))):
        trouve = MOTS_LIVE.search(texte or "")
        if trouve:
            debut = max(0, trouve.start() - 30)
            return source, " ".join((texte or "")[debut:trouve.end() + 50].split())
    return None


def source_live_auto(disque):
    """
    Source du « Live » automatique ("titre", "notes_discogs") ou None. La page ne l'applique que
    si le champ perso Discogs « Live / Studio » est vide : le champ reste toujours prioritaire.
    """
    indice = indice_live(disque)
    return indice[0] if indice else None


# ---------------------------------------------------------------------------
# Rapport
# ---------------------------------------------------------------------------

def texte_periode(annees):
    if not annees:
        return "—"
    return str(annees[0]) if annees[0] == annees[1] else "%d – %d" % tuple(annees)


def ecrire_rapport(fichier, disques):
    """
    Rapport de contrôle : années tirées des notes et des titres (affichées, à vérifier),
    saisies manuelles illisibles, et disques qui semblent « live » sans l'être dans Discogs.
    `disques` : les disques déjà construits (format de collection.json).
    """
    vus, editions = set(), []
    for disque in disques:
        if disque["release_id"] not in vus:  # un doublon (2 exemplaires) n'est listé qu'une fois
            vus.add(disque["release_id"])
            editions.append(disque)

    def nom(disque):
        artistes = ", ".join(disque.get("artistes_principaux") or [])
        return "%s — %s (édition %s)" % (artistes, disque.get("titre"), disque["release_id"])

    par_source = {}
    for disque in editions:
        par_source.setdefault(disque.get("annees_enregistrement_source"), []).append(disque)

    lignes = ["Rapport des années d'enregistrement et des disques live, le %s" % date.today().isoformat(), "",
              "Sources des années d'enregistrement (%d éditions) :" % len(editions)]
    libelles = [("manuelle", "saisie manuelle"), ("musicbrainz", "MB sur édition exacte"),
                ("musicbrainz_album", "MB sur autre édition de l'album"), ("notes_discogs", "notes Discogs"),
                ("titre", "titre"), ("a_trouver", "« à trouver »"), (None, "aucune année")]
    for cle, libelle in libelles:
        lignes.append("  %-34s %d" % (libelle, len(par_source.get(cle, []))))

    lignes += ["", "1. Années tirées des notes Discogs (affichées ; à corriger dans le champ manuel si besoin)", ""]
    for disque in par_source.get("notes_discogs", []):
        _, phrases = annees_des_notes(disque.get("notes_discogs"))
        lignes += [nom(disque), "    %s   « %s »" % (texte_periode(disque["annees_enregistrement"]), " / ".join(phrases)), ""]

    lignes += ["", "2. Années tirées du titre (affichées, hors classique)", ""]
    for disque in par_source.get("titre", []):
        lignes += [nom(disque), "    %s" % texte_periode(disque["annees_enregistrement"]), ""]

    illisibles = [(d, saisie_manuelle(d.get("champs"))[1]) for d in editions
                  if (saisie_manuelle(d.get("champs")) or ("",))[0] == "illisible"]
    lignes += ["", "3. Saisies manuelles illisibles (écrire « 1958 », « 1958-1961 » ou « à trouver ») : %d"
               % len(illisibles), ""]
    for disque, valeur in illisibles:
        lignes += [nom(disque), "    « %s »" % valeur, ""]

    def champ_live(disque):
        valeur = next((v for n, v in (disque.get("champs") or {}).items() if simplifier(n) == simplifier(CHAMP_LIVE)), "")
        return "" if simplifier(valeur) == simplifier(NON_RENSEIGNE) else (valeur or "").strip()

    live = [(d, indice_live(d)) for d in editions]
    sans_champ = [(d, i) for d, i in live if i and not champ_live(d)]
    lignes += ["", "4. « Live » automatique (notes ou titre, champ « Live / Studio » vide) : %d" % len(sans_champ),
               "   Affiché « Live » dans la page. Une erreur : choisir « Studio » ou « Live et Studio » dans Discogs.", ""]
    for disque, (source, extrait) in sans_champ:
        lignes += [nom(disque), "    %s : « %s »" % ("titre" if source == "titre" else "notes", extrait), ""]

    fichier.write_text("\n".join(lignes) + "\n", encoding="utf-8")
    print("  Rapport enregistré dans data/rapport_annees.txt")
