"""
Propose, pour chaque CD d'un coffret, le disque MusicBrainz séparé qui lui correspond (pour sa pochette),
avant de l'ajouter à data/musicbrainz_manuel.json.

Usage, sur le Mac, depuis le dossier du projet :
    python3 scripts/proposer_rattachements.py 2070889

Il faut que le coffret soit déjà relié à MusicBrainz (data/musicbrainz.json, après une synchro).
Rien n'est modifié dans le projet : le script écrit deux fichiers à vérifier, à la racine du projet
(ils ne sont pas enregistrés dans le dépôt, voir .gitignore) :
  - rattachements-<numéro>.html : la page de vérification, à ouvrir dans Safari (pochettes, liens) ;
  - rattachements-<numéro>.csv  : le tableau à corriger dans Excel, puis à renvoyer à Claude.

Comment le bon disque est trouvé : sur MusicBrainz, chaque plage du coffret est reliée à un
« enregistrement », et le même enregistrement figure sur d'autres parutions (l'album d'origine, ses
rééditions). Pour chaque CD, on garde les parutions qui contiennent TOUS ses enregistrements, sur un
même disque. Elles sont classées : avec pochette d'abord, puis la plus ancienne (l'album d'origine,
souvent le 33 tours), puis le label Deutsche Grammophon, puis celle dont le disque a le moins de
plages en trop. Aucun titre n'est comparé : la méthode ne se trompe pas de disque, mais elle peut ne
rien trouver (enregistrements jamais parus séparément, ou pas encore saisis sur MusicBrainz).
Durée : environ 8 requêtes par CD, une par seconde (règle de MusicBrainz) ; 55 CD = environ 8 minutes.
"""

import csv
import html
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import musicbrainz  # noqa: E402  (appeler, lire_position, plages_a_associer)

RACINE = Path(__file__).resolve().parent.parent
FICHIER_COLLECTION = RACINE / "data" / "collection.json"
FICHIER_MUSICBRAINZ = RACINE / "data" / "musicbrainz.json"

# Nombre d'enregistrements du CD utilisés pour chercher les parutions (le premier, celui du milieu,
# le dernier) ; chaque candidat est ensuite vérifié sur tous les enregistrements du CD.
ENREGISTREMENTS_TEMOINS = 3
CANDIDATS_VERIFIES = 6     # candidats lus en entier (une requête chacun), les plus prometteurs d'abord
CANDIDATS_GARDES = 3       # candidats montrés par CD
SUPPORTS_MAX = 6           # au-delà, la parution est un coffret : écartée
PAGES_MAX = 3              # un enregistrement très repris (« best of ») peut être sur des centaines de parutions


def nom_label(parution):
    return ", ".join(sorted({(i.get("label") or {}).get("name", "") for i in parution.get("label-info", [])} - {""}))


def a_pochette(parution):
    return bool((parution.get("cover-art-archive") or {}).get("front"))


def cle_de_tri(parution, plages_en_trop):
    """Avec pochette d'abord, puis la plus ancienne, puis Deutsche Grammophon, puis le disque le plus proche."""
    date = parution.get("date") or "9999"
    deutsche_grammophon = "deutsche grammophon" in nom_label(parution).lower()
    return (not a_pochette(parution), date, not deutsche_grammophon, plages_en_trop)


def disques_du_coffret(release_id):
    """{n° de CD: [identifiants d'enregistrement]} d'après l'édition MusicBrainz du coffret."""
    cache = json.loads(FICHIER_MUSICBRAINZ.read_text(encoding="utf-8"))
    entree = cache.get(str(release_id)) or {}
    if not entree.get("release"):
        sys.exit("Le coffret %s n'est pas relié à une édition MusicBrainz (data/musicbrainz.json)." % release_id)
    coffret = musicbrainz.appeler("release/%s" % entree["release"], {"inc": "recordings"})
    disques = {}
    for support in (coffret or {}).get("media", []):
        disques[support.get("position")] = [(p.get("recording") or {}).get("id") for p in support.get("tracks", [])]
    return entree["release"], disques


def resume_discogs(release_id):
    """{n° de CD: {"compositeurs", "oeuvres", "plages", "avec_oeuvre"}} d'après la tracklist Discogs."""
    collection = json.loads(FICHIER_COLLECTION.read_text(encoding="utf-8"))
    disque = next((d for d in collection["disques"] if d["release_id"] == int(release_id)), None)
    if not disque:
        sys.exit("Le disque %s n'est pas dans data/collection.json." % release_id)
    resume = {}

    def ajouter(liste, valeur):
        if valeur and valeur not in liste:
            liste.append(valeur)

    def parcourir(plages, titre_groupe=None):
        for plage in plages:
            if plage.get("sous_plages"):
                parcourir(plage["sous_plages"], plage.get("titre"))
                continue
            if plage.get("type") == "intertitre":
                continue
            position = musicbrainz.lire_position(plage.get("position"))
            if not position or position[0] is None:
                continue
            cd = resume.setdefault(position[0], {"compositeurs": [], "oeuvres": [], "plages": 0, "avec_oeuvre": 0})
            cd["plages"] += 1
            cd["avec_oeuvre"] += 1 if plage.get("oeuvre") else 0
            for credit in plage.get("credits", []):
                if "compos" in (credit.get("role") or "").lower():
                    ajouter(cd["compositeurs"], credit.get("nom"))
            ajouter(cd["compositeurs"], (plage.get("oeuvre") or {}).get("compositeur"))
            ajouter(cd["oeuvres"], titre_groupe or plage.get("titre"))

    parcourir(disque.get("plages_discogs") or disque.get("plages") or [])
    return disque.get("titre", ""), resume


def parutions_de(enregistrement):
    """Parutions qui contiennent cet enregistrement (au plus PAGES_MAX pages de 100)."""
    parutions, decalage = [], 0
    for _ in range(PAGES_MAX):
        reponse = musicbrainz.appeler("release", {"recording": enregistrement, "inc": "labels",
                                                  "limit": 100, "offset": decalage}) or {}
        paquet = reponse.get("releases", [])
        parutions.extend(paquet)
        decalage += len(paquet)
        if not paquet or decalage >= reponse.get("release-count", 0):
            break
    return parutions


def chercher_candidats(enregistrements, coffret):
    """Parutions qui contiennent tous ces enregistrements sur un même disque, les meilleures d'abord."""
    enregistrements = [e for e in enregistrements if e]
    if not enregistrements:
        return []
    rangs = sorted({0, len(enregistrements) // 2, len(enregistrements) - 1})[:ENREGISTREMENTS_TEMOINS]
    communes = None
    for rang in rangs:
        parutions = {p["id"]: p for p in parutions_de(enregistrements[rang]) if p["id"] != coffret}
        communes = parutions if communes is None else {i: p for i, p in communes.items() if i in parutions}
    if not communes:
        return []
    # Les plus prometteuses d'abord (pochette, ancienneté, label), puis vérification complète.
    a_verifier = sorted(communes.values(), key=lambda p: cle_de_tri(p, 0))[:CANDIDATS_VERIFIES]
    voulus = set(enregistrements)
    candidats = []
    for parution in a_verifier:
        complete = musicbrainz.appeler("release/%s" % parution["id"], {"inc": "recordings+labels"}) or {}
        if len(complete.get("media", [])) > SUPPORTS_MAX:
            continue  # un autre coffret (une autre édition du même coffret, par exemple) : sa pochette ne convient pas
        for support in complete.get("media", []):
            presents = {(p.get("recording") or {}).get("id") for p in support.get("tracks", [])}
            if voulus <= presents:
                nb_supports = len(complete.get("media", []))
                candidats.append({
                    "id": complete["id"],
                    "titre": complete.get("title", ""),
                    "date": complete.get("date") or "",
                    "label": nom_label(complete),
                    "pochette": a_pochette(complete),
                    "disque": support.get("position") if nb_supports > 1 else None,
                    "nb_supports": nb_supports,
                    "format": support.get("format") or "",
                    "plages_en_trop": len(presents) - len(voulus),
                    "parution": complete,
                })
                break
    candidats.sort(key=lambda c: cle_de_tri(c["parution"], c["plages_en_trop"]))
    return candidats[:CANDIDATS_GARDES]


def lien(candidat):
    return "https://musicbrainz.org/release/%s" % candidat["id"]


def reference(candidat):
    """Valeur pour data/musicbrainz_manuel.json : le lien, suivi de #n pour le n-ième disque d'une parution."""
    return lien(candidat) + ("#%d" % candidat["disque"] if candidat["disque"] else "")


def description(candidat):
    morceaux = [candidat["titre"], candidat["date"][:4] or "année ?", candidat["label"] or "label ?",
                candidat["format"] or "", "disque %d sur %d" % (candidat["disque"], candidat["nb_supports"]) if candidat["disque"] else "",
                "sans pochette" if not candidat["pochette"] else ""]
    return " · ".join(m for m in morceaux if m)


def ecrire_csv(fichier, lignes):
    """Point-virgule et BOM UTF-8 : Excel en français l'ouvre directement, accents compris."""
    with open(fichier, "w", encoding="utf-8-sig", newline="") as sortie:
        ecrivain = csv.writer(sortie, delimiter=";")
        ecrivain.writerow(["CD", "Compositeurs (Discogs)", "Œuvres (Discogs)", "Plages", "Plages avec œuvre aujourd'hui",
                           "Référence MusicBrainz retenue (lien ou ID de disque)", "N° du CD dans la parution",
                           "Candidat 1", "Candidat 2", "Candidat 3", "Remarque"])
        for cd, discogs, candidats in lignes:
            premier = candidats[0] if candidats else None
            colonnes = [lien(c) + " — " + description(c) for c in candidats] + [""] * (3 - len(candidats))
            ecrivain.writerow([cd, ", ".join(discogs.get("compositeurs", [])), " · ".join(discogs.get("oeuvres", [])[:4]),
                               discogs.get("plages", ""), discogs.get("avec_oeuvre", ""),
                               lien(premier) if premier else "", (premier["disque"] or "") if premier else "",
                               *colonnes, "" if candidats else "aucun candidat trouvé"])


def ecrire_html(fichier, titre, release_id, lignes):
    e = html.escape
    rangées = []
    for cd, discogs, candidats in lignes:
        cases = []
        for rang, c in enumerate(candidats, start=1):
            image = ('<img src="https://coverartarchive.org/release/%s/front-250" alt="" loading="lazy">' % c["id"]
                     if c["pochette"] else '<div class="vide">pas de pochette</div>')
            cases.append('<a class="candidat%s" href="%s" target="_blank">%s<span>%d. %s</span></a>'
                         % (" premier" if rang == 1 else "", e(lien(c)), image, rang, e(description(c))))
        rangées.append(
            '<tr><th>CD %s</th><td class="discogs"><b>%s</b><br>%s<br><small>%s plages · %s avec œuvre</small></td>'
            '<td class="candidats">%s</td></tr>'
            % (cd, e(", ".join(discogs.get("compositeurs", [])) or "—"), e(" · ".join(discogs.get("oeuvres", [])[:4])),
               discogs.get("plages", "?"), discogs.get("avec_oeuvre", "?"),
               "".join(cases) or '<span class="aucun">aucun candidat trouvé</span>'))
    page = """<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Rattachements %s</title>
<style>
body { background: #111; color: #ddd; font: 14px -apple-system, sans-serif; margin: 16px; }
h1 { font-size: 18px; } p { color: #999; max-width: 900px; }
table { border-collapse: collapse; width: 100%%; }
th, td { border-top: 1px solid #333; padding: 10px 8px; vertical-align: top; text-align: left; }
th { white-space: nowrap; color: #f0b429; width: 60px; }
td.discogs { width: 32%%; }
.candidats { display: flex; gap: 12px; flex-wrap: wrap; }
.candidat { display: flex; flex-direction: column; width: 170px; color: #ddd; text-decoration: none; font-size: 12px; }
.candidat img, .vide { width: 170px; height: 170px; object-fit: cover; border: 2px solid #333; border-radius: 4px; background: #222; }
.vide { display: flex; align-items: center; justify-content: center; color: #777; }
.candidat.premier img, .candidat.premier .vide { border-color: #f0b429; }
.candidat span { margin-top: 4px; }
.aucun { color: #c66; }
</style></head><body>
<h1>%s — rattachement des CD à MusicBrainz (Discogs %s)</h1>
<p>Pour chaque CD : à gauche ce que dit Discogs, à droite les parutions MusicBrainz qui contiennent tous ses
enregistrements, la meilleure d'abord (cadre ambre : celle déjà mise dans le tableau .csv). Clic sur une
pochette : la parution sur MusicBrainz. Les candidats sont sûrs quant au contenu ; reste à choisir la pochette.</p>
<table>%s</table></body></html>""" % (e(str(release_id)), e(titre), e(str(release_id)), "\n".join(rangées))
    Path(fichier).write_text(page, encoding="utf-8")


def main():
    if len(sys.argv) < 2 or not sys.argv[1].isdigit():
        sys.exit("Usage : python3 scripts/proposer_rattachements.py <numéro Discogs du coffret>  (ex. 2070889)")
    release_id = sys.argv[1]
    titre, discogs = resume_discogs(release_id)
    coffret, disques = disques_du_coffret(release_id)
    print("%s : %d CD sur MusicBrainz. Recherche des parutions séparées (environ %d minutes)…"
          % (titre, len(disques), max(1, len(disques) * 9 // 60)))
    lignes = []
    for cd in sorted(disques):
        try:
            candidats = chercher_candidats(disques[cd], coffret)
        except (OSError, ValueError) as erreur:
            print("  CD %s : erreur (%s), ignoré" % (cd, erreur))
            candidats = []
        lignes.append((cd, discogs.get(cd, {}), candidats))
        print("  CD %s : %s" % (cd, description(candidats[0]) if candidats else "aucun candidat"))
    ecrire_csv(RACINE / ("rattachements-%s.csv" % release_id), lignes)
    ecrire_html(RACINE / ("rattachements-%s.html" % release_id), titre, release_id, lignes)
    trouves = sum(1 for _, _, c in lignes if c)
    print("\n%d CD sur %d avec au moins un candidat." % (trouves, len(lignes)))
    print("Page de vérification : open rattachements-%s.html" % release_id)
    print("Tableau pour Excel   : open rattachements-%s.csv" % release_id)


if __name__ == "__main__":
    main()
