"""
Années d'enregistrement : corrections à la main, et repérage dans les textes Discogs.

Sources, de la plus sûre à la moins sûre :
  1. ANNEES_CORRIGEES ci-dessous (écrites à la main) : elles l'emportent sur tout ;
  2. MusicBrainz, édition exacte (lien Discogs ou code-barre) ;
  3. MusicBrainz, autre édition du même album (même nombre de plages) ;
  4. le texte « Notes » de la fiche Discogs et le titre du disque : pour l'instant,
     seulement dans le rapport data/rapport_annees.txt, à relire avant de les afficher.

Ce module n'utilise que la bibliothèque standard de Python.
"""

import re
from datetime import date

# ---------------------------------------------------------------------------
# Corrections à la main
# ---------------------------------------------------------------------------

# Numéro de l'édition Discogs (le nombre à la fin de l'adresse discogs.com/release/…)
#   -> (première année, dernière année) : c'est elle qui s'affiche ;
#   -> None : aucune année d'enregistrement ne s'affiche (aucune source n'est fiable).
# Exemple :
#   1234567: (1994, 1995),   # Flûte Panorama : années de composition dans le titre
#   7654321: None,
ANNEES_CORRIGEES = {
}

# Premier enregistrement sonore (phonographe d'Edison) : une année plus ancienne n'est pas
# une année d'enregistrement (c'est souvent celle de la composition, ou une faute de frappe).
PREMIERE_ANNEE_POSSIBLE = 1877

# ---------------------------------------------------------------------------
# Repérage des années dans un texte
# ---------------------------------------------------------------------------

# Une année, ou une période : « 1958 », « 1958-1961 », « 1955-60 », « 1955/56 », « 1958 – 1961 ».
MOTIF_ANNEES = re.compile(r"(?<!\d)(1[89]\d\d|20\d\d)(?:\s*[-–/]\s*(\d{4}|\d{2}))?(?!\d)")

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
# Rapport
# ---------------------------------------------------------------------------

def texte_periode(annees):
    if not annees:
        return "—"
    return str(annees[0]) if annees[0] == annees[1] else "%d – %d" % tuple(annees)


def ecrire_rapport(fichier, disques):
    """
    Rapport des années trouvées dans les notes Discogs et les titres, pour les relire
    avant de les afficher. `disques` : les disques déjà construits (format de collection.json).
    """
    vus = set()
    nouvelles, comparaisons = [], []
    for disque in disques:
        if disque["release_id"] in vus:
            continue  # un doublon (2 exemplaires) n'est listé qu'une fois
        vus.add(disque["release_id"])
        notes, phrases = annees_des_notes(disque.get("notes_discogs"))
        titre = annees_du_titre(disque.get("titre"))
        if not notes and not titre:
            continue
        ligne = (disque, notes, phrases, titre)
        if disque.get("annees_enregistrement"):
            comparaisons.append(ligne)
        else:
            nouvelles.append(ligne)

    def decrire(disque, notes, phrases, titre):
        artistes = ", ".join(disque.get("artistes_principaux") or [])
        lignes = ["%s — %s (édition %s)" % (artistes, disque.get("titre"), disque["release_id"])]
        if titre:
            lignes.append("    titre : %s" % texte_periode(titre))
        if notes:
            lignes.append("    notes : %s   « %s »" % (texte_periode(notes), " / ".join(phrases)))
        if disque.get("annees_enregistrement"):
            lignes.append("    déjà connu : %s (%s)" % (texte_periode(disque["annees_enregistrement"]),
                                                       disque.get("annees_enregistrement_source")))
        return "\n".join(lignes)

    # Pour juger la méthode : là où une année est déjà connue, la trouvée concorde-t-elle ?
    def concorde(trouvee, connue):
        return trouvee and connue and trouvee[0] <= connue[1] and connue[0] <= trouvee[1]
    accords = sum(1 for d, n, _, t in comparaisons
                  if all(concorde(x, d["annees_enregistrement"]) for x in (n, t) if x))

    sans_notes = sum(1 for d in disques if "notes_discogs" not in d)
    texte = [
        "Années d'enregistrement trouvées dans les notes Discogs et les titres, le %s" % date.today().isoformat(),
        "Rien de ceci n'est affiché : à relire, puis à corriger dans scripts/annees.py (ANNEES_CORRIGEES).",
        "",
        "1. Éditions SANS année d'enregistrement : %d gagneraient une année" % len(nouvelles),
        "",
    ] + [decrire(*l) + "\n" for l in nouvelles] + [
        "",
        "2. Éditions qui ont DÉJÀ une année (contrôle de la méthode) : %d sur %d concordent"
        % (accords, len(comparaisons)),
        "",
    ] + [decrire(*l) + "\n" for l in comparaisons]
    if sans_notes:
        texte.insert(2, "(%d disques dont les notes Discogs n'ont pas encore été lues.)" % sans_notes)
    fichier.write_text("\n".join(texte) + "\n", encoding="utf-8")
    print("  Rapport des années enregistré dans data/rapport_annees.txt (%d nouvelles)" % len(nouvelles))
