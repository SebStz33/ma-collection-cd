/* ==========================================================================
   Ma collection de CD — le comportement de la page
   Lit data/collection.json (écrit par scripts/sync.py), puis affiche la grille,
   applique la recherche, les filtres et le tri, ouvre les fiches et calcule les
   statistiques. Tout se passe dans le navigateur, sans rappeler Discogs, sauf
   pour modifier un disque sur un appareil où le jeton Discogs est enregistré.
   ========================================================================== */

"use strict";

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

const FICHIER_COLLECTION = "data/collection.json";
const CHAMP_LOCALISATION = "Localisation";   // noms des champs personnalisés Discogs
const CHAMP_NOTES_PERSO = "Notes personnelles";
const CHAMP_LIENS = "Liens externes";
const CHAMP_DESCRIPTION = "Description";
const CHAMP_FAVORIS = "Pistes favorites";    // numéros des plages favorites, tels que Discogs les écrit : « 1, 8 »
const CHAMP_STATUT = "Statut d’écoute";       // champ liste Discogs : « À écouter », « Favori »… ou « Aucun »
const STATUT_NEUTRE = "Aucun";                // option de « Statut » qui démarque (Discogs refuse de vider une liste)
const SANS_STATUT = "Sans statut";            // filtre et stats : « Aucun » ou champ vide
const STATUTS_CONNUS = ["À écouter", "Favori", "À chercher"];         // boutons proposés si la synchro n'a pas encore lu la liste
const REPERES_STATUT = { "a ecouter": "🎧", favori: "★", "a chercher": "🔍" }; // repère par statut (clé sans accents ni majuscules)
// « À chercher » : disque physique égaré (la Localisation dit où chercher), à distinguer de la localisation « Introuvable ».
const BLOCS_STATUT = { favori: "Favoris" };                // nom du bloc de l'index, s'il diffère du statut
const CHAMP_ANNEE_MANUELLE = "Année d’enregistrement (manuelle)";  // champ texte : « 1958 », « 1958-1961 » ou « à trouver »
const A_TROUVER = "à trouver";
const CHAMP_PHOTO = "Photo principale";        // champ liste Discogs : « Automatique » (MusicBrainz d'abord) ou « Discogs »
const PHOTO_DISCOGS = "Discogs";
const PHOTO_AUTOMATIQUE = "Automatique";
const CHAMP_LIVE = "Live / Studio";           // champ liste Discogs : « Live », « Live et Studio », « Studio » ou vide
const LIVE = "Live";                           // option de « Live / Studio » donnée automatiquement
const NON_PRECISE = "Non renseigné";          // « Live / Studio » vide, ou option « Non renseigné » sur Discogs
const SANS_CATEGORIE = "Sans catégorie";      // exemplaires rangés dans aucun dossier Discogs
const CATEGORIE_A_VENDRE = "À Vendre";        // dossier Discogs rangé en dernier (casse et accents ignorés)
// Méta-catégories : chaque dossier Discogs (catégorie) est rangé dans une seule méta-catégorie.
// Rien n'est écrit sur Discogs : la table est ici. Un dossier absent de la table va dans META_PAR_DEFAUT.
// Les noms des dossiers sont comparés sans tenir compte des majuscules ni des accents.
const META_CATEGORIES = {
  Chanson: ["Chanson française", "Chanson internationale"],
  Classique: ["Classique divers", "Classique Orchestre", "Classique Voix", "Clavecin et Orgue", "Guitare classique",
              "Opéra - Lyrique", "Piano Classique", "Piano et Orchestre", "String quartet", "Violon"],
  Divers: ["Electronic", "Pop Rock Folk", "Soull Funk R&B GBM", "Soundtrack B.O.", SANS_CATEGORIE, CATEGORIE_A_VENDRE],
  Jazz: ["Blues", "Jazz", "Jazz Big Band", "Jazz Guitar", "Jazz piano trio", "Jazz vocal", "Latin Jazz", "Piano solo"],
  World: ["Brazil", "Flamenco", "India", "World"],
};
const META_PAR_DEFAUT = "Divers";             // méta-catégorie d'un nouveau dossier, tant qu'il n'est pas dans la table
const META_CLASSIQUE = "Classique";           // sert aussi à séparer compositeurs et œuvres « classiques / autres »
const PREFIXE_META = "méta:";                 // valeur du filtre Catégorie pour une méta-catégorie (« méta:Jazz »)
const VIGNETTES_VISIBLES = 14;                // vignettes par source de photos, avant « Voir les N photos restantes »
const ZOOM = 2.5;                             // grossissement de la visionneuse
const LIGNES_MIN_EDITION = 4;                 // hauteur minimale des zones de texte du formulaire
const LONGUEUR_MAX_CHAMP = 255;               // Discogs refuse un champ texte plus long (constaté le 31/10/2026)
const API_DISCOGS = "https://api.discogs.com";
const CLE_JETON = "jeton-discogs";            // noms des réglages rangés dans le navigateur
const CLE_MODIFICATIONS = "modifications-en-attente";

// Les catégories de personnes produites par le script, dans l'ordre d'affichage.
const CATEGORIES_PERSONNES = [
  { cle: "compositeurs", libelle: "Compositeurs" },
  { cle: "paroliers", libelle: "Paroliers" },
  { cle: "arrangeurs", libelle: "Arrangeurs" },
  { cle: "transcriptions", libelle: "Transcriptions" },
  { cle: "cadences", libelle: "Cadences" },
  { cle: "interpretes", libelle: "Interprètes" },
  { cle: "remix", libelle: "Remix" },
  { cle: "producteurs", libelle: "Producteurs" },
  { cle: "ingenieurs_son", libelle: "Ingénieurs du son" },
  { cle: "photographes", libelle: "Photographes" },
  { cle: "artwork", libelle: "Artwork" },
  { cle: "textes_livret", libelle: "Textes du livret" },
];

// Crédits toujours visibles dans la fiche ; les autres sont sous « Voir les autres crédits ».
const CREDITS_VISIBLES = ["compositeurs", "paroliers", "arrangeurs", "transcriptions", "cadences", "interpretes"];

// Regroupement des formats Discogs pour le filtre et les statistiques (choix du 29/10/2026) :
// pas de DVD seul dans la collection. Le JSON garde les formats exacts de Discogs.
// « Vinyl » et « Cassette » restent tels quels (02/11/2026) : ils signalent une fiche Discogs à corriger.
const REGROUPEMENT_FORMATS = {
  "DVD": "CD + DVD",
  "All Media": "CD + DVD",
};
const formatRegroupe = (nom) => REGROUPEMENT_FORMATS[nom] || nom;

// Coffret (« Box Set » sur Discogs) : affiché en français, avec le type de disques qu'il contient.
const FORMAT_COFFRET = "Box Set";
const NOMS_DISQUES = { Vinyl: ["Vinyle", "Vinyles"], LP: ["Vinyle", "Vinyles"] };   // CD, DVD… restent tels quels
const nomDeDisque = (nom, nombre) => (NOMS_DISQUES[nom] || [nom, nom])[nombre > 1 ? 1 : 0];

/** Formats d'une édition pour le filtre et les stats : « Coffret CD » plutôt que « Box Set » + « CD ». */
function formatsAffiches(formats) {
  formats = formats || [];
  if (!formats.some((f) => f.nom === FORMAT_COFFRET)) return formats.map((f) => formatRegroupe(f.nom));
  const contenu = formats.find((f) => !FORMATS_EMBALLAGE.includes(f.nom));
  return ["Coffret " + (contenu ? nomDeDisque(contenu.nom, 2) : "")].map((t) => t.trim());
}

// Formats Discogs qui sont des emballages et non des disques (pour le comptage).
const FORMATS_EMBALLAGE = ["Box Set", "All Media"];

// ---------------------------------------------------------------------------
// État de la page : les données et les choix de l'utilisateur
// ---------------------------------------------------------------------------

let editions = [];        // un élément par édition (release_id), exemplaires regroupés
let infosCollection = {}; // en-tête du fichier : utilisateur, date de génération…
let modifications = {};   // modifications faites ici, en attente de la synchro (par instance_id)

const etat = {
  vue: "collection",
  recherche: "",
  role: "partout",
  tri: "artiste",
  categorie: "",
  genre: "",
  style: "",
  format: "",
  label: "",
  anneeMin: null,
  anneeMax: null,
  enregMin: null,           // années d'enregistrement (MusicBrainz), « de… à… »
  enregMax: null,
  localisation: "",
  double: false,
  avecNotes: false,
  correspondanceMB: "",     // "", "exacte", "album" ou "aucune"
  avecOeuvres: false,
  oeuvresIncompletes: false,
  avecFavoris: false,
  statut: "",               // "" (tous), "À écouter", "Favori"…, ou SANS_STATUT
  enregistrement: "",       // "" (tous), "Live", "Live et Studio", "Studio"…
  oeuvre: null,             // œuvre MusicBrainz choisie : { id, titre, compositeur }
  blocIndex: "compositeurs_classiques", // bloc affiché dans l'onglet Index
};

// Filtres remis à zéro (boutons « Effacer les filtres » et « Effacer ») : la recherche reste.
const FILTRES_SEULS_VIDES = {
  categorie: "", genre: "", style: "", format: "", label: "", anneeMin: null, anneeMax: null,
  enregMin: null, enregMax: null,
  localisation: "", double: false, avecNotes: false, correspondanceMB: "", avecOeuvres: false, oeuvresIncompletes: false,
  avecFavoris: false,
  statut: "", enregistrement: "", oeuvre: null,
};
// Recherche et filtres remis à zéro (clic dans l'index).
const FILTRES_VIDES = { ...FILTRES_SEULS_VIDES, recherche: "", role: "partout" };

/**
 * Ajoute une croix ✕ à droite, dans une case de recherche : visible quand la case
 * contient du texte ; un clic l'efface et relance la recherche (événements input et change).
 * Renvoie l'enveloppe (case + croix), à placer là où était la case.
 */
function ajouterCroix(champ) {
  const croix = creer("button", { type: "button", classe: "effacer-champ", texte: "✕",
    title: "Effacer", "aria-label": "Effacer" });
  const enveloppe = creer("span", { classe: "case-effacable" });
  if (champ.parentNode) champ.replaceWith(enveloppe);
  enveloppe.append(champ, croix);
  const montrer = () => { croix.hidden = !champ.value; };
  champ.addEventListener("input", montrer);
  croix.addEventListener("click", () => {
    champ.value = "";
    champ.dispatchEvent(new Event("input", { bubbles: true }));
    champ.dispatchEvent(new Event("change", { bubbles: true }));
    champ.dispatchEvent(new Event("efface"));   // pour relancer la recherche sans attendre la pause
    montrer();
    champ.focus();
  });
  montrer();
  enveloppe.montrer = montrer;   // à rappeler quand le code change la valeur
  return enveloppe;
}

// Raccourci pour trouver un élément de la page par son identifiant.
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Petits outils
// ---------------------------------------------------------------------------

/** Met en minuscules et retire les accents : « Dvořák » -> « dvorak ». */
function normaliser(texte) {
  return String(texte || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Méta-catégorie d'une catégorie (dossier Discogs), d'après la table META_CATEGORIES. */
function metaDeCategorie(categorie) {
  for (const [meta, categories] of Object.entries(META_CATEGORIES)) {
    if (categories.some((c) => normaliser(c) === normaliser(categorie))) return meta;
  }
  return META_PAR_DEFAUT;
}

/** Vrai si la catégorie est « Sans catégorie » ou « À Vendre » : elle ne dit rien du genre de musique. */
function categorieNeutre(categorie) {
  return categorie === SANS_CATEGORIE || normaliser(categorie) === normaliser(CATEGORIE_A_VENDRE);
}

/** Ordre des catégories : alphabétique, puis « Sans catégorie », puis « À Vendre » en dernier. */
function comparerCategories(a, b) {
  const rang = (c) => normaliser(c) === normaliser(CATEGORIE_A_VENDRE) ? 2 : c === SANS_CATEGORIE ? 1 : 0;
  return rang(a) - rang(b) || comparerTextes(a, b);
}

/** Compare deux textes dans l'ordre alphabétique français (accents et majuscules ignorés). */
function comparerTextes(a, b) {
  return String(a || "").localeCompare(String(b || ""), "fr", { sensitivity: "base" });
}

/**
 * Crée un élément HTML. Le texte passe toujours par textContent :
 * un titre contenant « < » ou « & » ne peut donc pas casser la page.
 */
function creer(balise, attributs = {}, ...enfants) {
  const element = document.createElement(balise);
  for (const [nom, valeur] of Object.entries(attributs)) {
    if (valeur === null || valeur === undefined || valeur === false) continue;
    if (nom === "classe") element.className = valeur;
    else if (nom === "texte") element.textContent = valeur;
    else if (nom === "surclic") element.addEventListener("click", valeur);
    else element.setAttribute(nom, valeur === true ? "" : valeur);
  }
  for (const enfant of enfants.flat(Infinity)) {
    if (enfant === null || enfant === undefined || enfant === false) continue;
    element.append(enfant instanceof Node ? enfant : document.createTextNode(String(enfant)));
  }
  return element;
}

function formaterDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function pluriel(nombre, singulier, plurielTexte) {
  return nombre + " " + (nombre > 1 ? plurielTexte || singulier + "s" : singulier);
}

/**
 * Discogs transforme les adresses des champs personnalisés en liens HTML :
 * « <a href="https://…" rel="nofollow" target="_blank">https://…</a> ».
 * On lit ce texte avec DOMParser, qui le découpe sans jamais l'exécuter,
 * puis on reconstruit nous-mêmes du texte et des liens : aucune balise venue
 * de Discogs n'entre telle quelle dans la page.
 */
function lireHtmlDiscogs(texte) {
  return new DOMParser().parseFromString(String(texte || ""), "text/html").body;
}

/** Le texte d'un champ sans les balises : pour la recherche. */
function texteSansBalises(texte) {
  return lireHtmlDiscogs(texte).textContent;
}

/** Vrai pour une adresse web (http ou https) : on n'accepte pas d'autres liens. */
function estAdresseWeb(adresse) {
  return /^https?:\/\//i.test(adresse || "");
}

function creerLien(adresse, texte) {
  return creer("a", { href: adresse, target: "_blank", rel: "noopener", texte: texte || adresse });
}

/**
 * Transforme un champ en texte et liens cliquables : les liens de Discogs,
 * et aussi les adresses restées en clair (« voir https://… »).
 */
function texteAvecLiens(texte) {
  const morceaux = [];
  for (const noeud of lireHtmlDiscogs(texte).childNodes) {
    const adresse = noeud.nodeName === "A" ? noeud.getAttribute("href") : null;
    if (estAdresseWeb(adresse)) {
      morceaux.push(creerLien(adresse, noeud.textContent));
      continue;
    }
    // Texte ordinaire : on découpe autour des adresses écrites en clair.
    for (const partie of noeud.textContent.split(/(https?:\/\/\S+)/)) {
      if (partie) morceaux.push(estAdresseWeb(partie) ? creerLien(partie) : partie);
    }
  }
  return morceaux;
}

/**
 * Lit le champ « Liens externes » : une adresse par ligne, avec un nom facultatif
 * devant (« Diapason | https://… »). Sans nom, on affiche le nom du site.
 */
function lireLiensExternes(texte) {
  return String(texte || "").split(/\r?\n/).map((ligne) => {
    const corps = lireHtmlDiscogs(ligne);
    const lien = corps.querySelector("a[href]");
    let adresse = lien ? lien.getAttribute("href") : null;
    let reste = corps.textContent;
    if (lien) reste = reste.replace(lien.textContent, "");
    if (!estAdresseWeb(adresse)) {
      adresse = (reste.match(/https?:\/\/\S+/) || [null])[0];
      if (adresse) reste = reste.replace(adresse, "");
    }
    if (!adresse) return null;
    const nom = reste.replace(/[|:–-]\s*$/, "").trim();
    return { adresse, nom: nom || nomDuSite(adresse) };
  }).filter(Boolean);
}

/** « https://www.pitchfork.com/reviews/… » -> « pitchfork.com ». */
function nomDuSite(adresse) {
  try {
    return new URL(adresse).hostname.replace(/^www\./, "");
  } catch (erreur) {
    return adresse;
  }
}

/** Vrai si l'édition a une Description ou des Notes personnelles (repère ✎ et filtre). */
function aDesTextes(edition) {
  return edition.descriptions.length > 0 || edition.notesPerso.length > 0;
}

/** Vrai si deux noms de champ sont les mêmes, sans tenir compte de la casse ni des accents (« A ecouter » = « À écouter »). */
function memeNom(a, b) {
  // L'apostrophe droite ' et l'apostrophe typographique ’ comptent pareil.
  const nettoyer = (texte) => normaliser(String(texte).trim().replace(/[’‘`´]/g, "'"));
  return nettoyer(a) === nettoyer(b);
}

/** Comme valeursDuChamp, mais le nom du champ est reconnu sans tenir compte de la casse ni des accents. */
function valeursDuChampSouple(edition, nomChamp) {
  return [...new Set(edition.exemplaires.flatMap((e) => Object.entries(e.champs)
    .filter(([nom]) => memeNom(nom, nomChamp))
    .map(([, valeur]) => String(valeur || "").trim())).filter(Boolean))];
}

/** Valeurs d'un champ pour tous les exemplaires d'une édition, sans répétition. */
function valeursDuChamp(edition, nomChamp) {
  return [...new Set(edition.exemplaires.map((e) => (e.champs[nomChamp] || "").trim()).filter(Boolean))];
}

/** « 1, 8 » -> ["1", "8"] : positions de plages écrites dans le champ « Pistes favorites ». */
function lirePositions(texte) {
  return String(texte || "").split(/[,;\n]/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Toutes les plages réelles d'une tracklist, mouvements compris, dans l'ordre du disque.
 * Chaque plage est donnée avec son titre complet : « Symphony No. 7 – II. Allegretto » pour un mouvement.
 */
function toutesLesPlages(plages, parent = "") {
  return (plages || []).flatMap((plage) => {
    if (plage.type === "intertitre") return [];
    const titre = parent ? parent + " – " + plage.titre : plage.titre;
    return (plage.sous_plages || []).length ? toutesLesPlages(plage.sous_plages, titre) : [{ plage, titre }];
  });
}

/** Plages favorites d'une édition, dans l'ordre du disque : [{ plage, titre }]. */
function plagesFavorites(edition) {
  return toutesLesPlages(edition.plages).filter(({ plage }) => plage.position && edition.favoris.has(plage.position));
}

/** « ★★★★☆ » pour une note sur 5. */
function etoiles(note) {
  return "★".repeat(note) + "☆".repeat(5 - note);
}

/**
 * Ligne « Année d'enregistrement : 1958 », « Années d'enregistrement : 1958 – 1963 »
 * ou « Année d'enregistrement : à trouver » ; rien si on ne la connaît pas.
 * La provenance est dans le bloc « Sources » en fin de fiche.
 */
function anneesEnregistrement(edition) {
  if (edition.annees_enregistrement_source === "a_trouver") return [["Année d'enregistrement", A_TROUVER]];
  const annees = edition.annees_enregistrement;
  if (!annees || !annees.length) return [];
  const [premiere, derniere] = annees;
  return premiere === derniere
    ? [["Année d'enregistrement", String(premiere)]]
    : [["Années d'enregistrement", premiere + " – " + derniere]];
}

/** Texte d'une période : « 1958 » ou « 1958 – 1963 ». */
function textePeriode(annees) {
  return annees[0] === annees[1] ? String(annees[0]) : annees[0] + " – " + annees[1];
}

// Provenance des années d'enregistrement (clé écrite par la synchro, voir scripts/annees.py).
const SOURCES_ANNEES = {
  manuelle: "correction manuelle",
  a_trouver: "« à trouver » (saisie manuelle)",
  musicbrainz: "MB sur édition exacte",
  musicbrainz_album: "MB sur autre édition de l'album",
  notes_discogs: "notes Discogs",
  titre: "titre",
};

/**
 * Lit le champ manuel « Année d’enregistrement (manuelle) » : { annees: [a, b] }, { aTrouver: true },
 * ou null (vide ou illisible). Même règle que scripts/annees.py.
 */
function saisieAnneesManuelle(edition) {
  const valeur = valeursDuChampSouple(edition, CHAMP_ANNEE_MANUELLE)[0] || "";
  if (!valeur) return null;
  if (memeNom(valeur, A_TROUVER)) return { aTrouver: true };
  const periode = valeur.match(/^(\d{4})(?:\s*[-–/]\s*(\d{4}))?$/);
  if (!periode) return null;
  const debut = Number(periode[1]);
  const fin = Number(periode[2] || debut);
  return debut <= fin ? { annees: [debut, fin] } : null;
}

/**
 * Années d'enregistrement de l'édition : la saisie manuelle si elle existe (y compris une modification
 * faite depuis la page, avant la synchro), sinon l'année trouvée automatiquement par la synchro.
 */
function appliquerAnneesManuelles(edition) {
  const [anneesAuto, sourceAuto] = edition.annees_enregistrement_auto
    || [edition.annees_enregistrement, edition.annees_enregistrement_source];
  const manuelle = saisieAnneesManuelle(edition);
  if (manuelle && manuelle.annees) {
    edition.annees_enregistrement = manuelle.annees;
    edition.annees_enregistrement_source = "manuelle";
  } else if (manuelle && manuelle.aTrouver) {
    edition.annees_enregistrement = null;
    edition.annees_enregistrement_source = "a_trouver";
  } else {
    edition.annees_enregistrement = anneesAuto || null;
    edition.annees_enregistrement_source = anneesAuto ? sourceAuto : null;
  }
}

/** Plages de l'édition (mouvements compris) : { total, avecOeuvre }. */
function compterOeuvres(edition) {
  const plages = toutesLesPlages(edition.plages);
  return { total: plages.length, avecOeuvre: plages.filter(({ plage }) => plage.oeuvre).length };
}

/** Vrai si MusicBrainz n'a donné une œuvre qu'à une partie des plages. */
function oeuvresIncompletes(edition) {
  const { total, avecOeuvre } = compterOeuvres(edition);
  return avecOeuvre > 0 && avecOeuvre < total;
}

/** Décrit les formats : « 2 × CD (Album, Remastered) », ou pour un coffret « Coffret 5 CD (Compilation, Remastered) ». */
function decrireFormats(formats) {
  if ((formats || []).some((f) => f.nom === FORMAT_COFFRET)) {
    // Nombre de disques par type (CD, Vinyle…), puis les précisions de Discogs, sans répétition.
    const parType = new Map();
    for (const f of formats.filter((f) => !FORMATS_EMBALLAGE.includes(f.nom))) {
      parType.set(f.nom, (parType.get(f.nom) || 0) + (f.quantite || 1));
    }
    const contenu = [...parType].map(([nom, nombre]) => nombre + " " + nomDeDisque(nom, nombre)).join(" + ");
    const details = [...new Set(formats.flatMap((f) => f.descriptions || []))];
    return "Coffret " + contenu + (details.length ? " (" + details.join(", ") + ")" : "");
  }
  return (formats || []).map((f) => {
    const quantite = f.quantite > 1 ? f.quantite + " × " : "";
    const details = f.descriptions && f.descriptions.length ? " (" + f.descriptions.join(", ") + ")" : "";
    return quantite + f.nom + details;
  }).join(" + ");
}

/**
 * Format affiché dans la fiche : tel quel, sauf si un format a été regroupé.
 * Alors : « CD + DVD (Discogs : 2 × CD + DVD (Album)) ».
 */
function decrireFormatsFiche(formats) {
  const detail = decrireFormats(formats);
  if (!(formats || []).some((f) => f.nom in REGROUPEMENT_FORMATS)) return detail;
  const regroupes = new Set(formats.map((f) => formatRegroupe(f.nom)));
  if (regroupes.has("CD + DVD")) regroupes.delete("CD");   // « CD + DVD » dit déjà qu'il y a un CD
  return [...regroupes].join(" · ") + " (Discogs : " + detail + ")";
}

/** Nombre de disques physiques d'une édition (un coffret de 5 CD compte pour 5). */
function nombreDeDisques(edition) {
  const disques = (edition.formats || [])
    .filter((f) => !FORMATS_EMBALLAGE.includes(f.nom))
    .reduce((total, f) => total + (f.quantite || 1), 0);
  return disques || 1;
}

// ---------------------------------------------------------------------------
// Chargement et préparation des données
// ---------------------------------------------------------------------------

/**
 * Le fichier contient une fiche par exemplaire. On regroupe les exemplaires
 * d'une même édition (même release_id) : une seule vignette, badge « ×2 ».
 */
function regrouperParEdition(disques) {
  const parEdition = new Map();
  for (const disque of disques) {
    const modif = modifications[disque.instance_id];
    const exemplaire = {
      instance_id: disque.instance_id,
      champs: appliquerModification(disque.champs || {}, modif),
      categorie_perso: disque.categorie_perso || null,
      date_ajout: disque.date_ajout,
      note: modif && "note" in modif ? modif.note || null : disque.note,
      modifie_le: modif ? modif.quand : null,
    };
    if (parEdition.has(disque.release_id)) {
      parEdition.get(disque.release_id).exemplaires.push(exemplaire);
    } else {
      parEdition.set(disque.release_id, { ...disque, exemplaires: [exemplaire] });
    }
  }

  return [...parEdition.values()].map((edition) => {
    // Date d'ajout de l'édition = celle du premier exemplaire ajouté.
    edition.date_ajout = edition.exemplaires.map((e) => e.date_ajout).filter(Boolean).sort()[0] || null;
    edition.localisations = valeursDuChamp(edition, CHAMP_LOCALISATION);
    edition.notesPerso = valeursDuChamp(edition, CHAMP_NOTES_PERSO);
    edition.descriptions = valeursDuChamp(edition, CHAMP_DESCRIPTION);
    edition.favoris = new Set(valeursDuChamp(edition, CHAMP_FAVORIS).flatMap(lirePositions));
    edition.statut = valeursDuChampSouple(edition, CHAMP_STATUT).find((v) => !memeNom(v, STATUT_NEUTRE)) || "";
    // « Live / Studio » : le champ perso Discogs s'il est rempli, sinon « Live » si le titre ou les notes
    // Discogs le disent (live_auto_source, calculé par la synchro), sinon « Non renseigné ».
    const live = valeursDuChampSouple(edition, CHAMP_LIVE).find((v) => !memeNom(v, NON_PRECISE));
    edition.liveAuto = !live && Boolean(edition.live_auto_source);
    edition.enregistrement = live || (edition.liveAuto ? LIVE : NON_PRECISE);
    // « Photo principale » = « Discogs » : la grande photo de la fiche est celle de Discogs, pas celle de MusicBrainz.
    edition.photoDiscogs = valeursDuChampSouple(edition, CHAMP_PHOTO).some((v) => memeNom(v, PHOTO_DISCOGS));
    // Catégories (dossiers Discogs) des exemplaires : en général une seule.
    edition.categories = [...new Set(edition.exemplaires.map((e) => e.categorie_perso || SANS_CATEGORIE))];
    edition.metas = [...new Set(edition.categories.map(metaDeCategorie))];
    edition.oeuvres = oeuvresDeLEdition(edition.plages || []);
    appliquerAnneesManuelles(edition);
    // Clés de tri par nom de famille, comme dans l'index : « Glenn Gould » est rangé à Gould.
    edition.cleArtiste = (edition.artistes_principaux || []).length ? cleDeTri(edition.artistes_principaux[0], true) : "";
    // Compositeur principal : le plus présent sur les plages (Discogs ne cite pas toujours le principal en
    // premier, surtout dans un coffret). Il sert au tri par compositeur et à la valeur affichée au-dessus de la photo.
    edition.presence = presenceDesNoms(edition);
    edition.compositeurPrincipal = parPresence(edition, edition.compositeurs)[0] || "";
    edition.cleCompositeur = edition.compositeurPrincipal ? cleDeTri(edition.compositeurPrincipal, true) : "";
    edition.index = construireIndexRecherche(edition);
    return edition;
  });
}

/**
 * Nombre de plages où chaque nom est crédité : { compte: Map(nom normalisé -> plages), total }.
 * Un crédit posé sur un groupe de plages (une œuvre et ses mouvements) compte pour chacune ;
 * le compositeur de l'œuvre trouvé par MusicBrainz compte aussi.
 */
function presenceDesNoms(edition) {
  const compte = new Map();
  let total = 0;
  const parcourir = (plages, herites) => {
    for (const plage of plages || []) {
      if (plage.type === "intertitre") continue;
      const noms = new Set(herites);
      for (const nom of plage.artistes || []) noms.add(normaliser(nom));
      for (const credit of plage.credits || []) noms.add(normaliser(credit.nom));
      if ((plage.sous_plages || []).length) {
        parcourir(plage.sous_plages, noms);
        continue;
      }
      if (plage.oeuvre && plage.oeuvre.compositeur) {
        for (const nom of plage.oeuvre.compositeur.split(", ")) noms.add(normaliser(nom));
      }
      total += 1;
      for (const nom of noms) compte.set(nom, (compte.get(nom) || 0) + 1);
    }
  };
  parcourir(edition.plages, new Set());
  return { compte, total };
}

/**
 * Les noms rangés du plus présent sur les plages au moins présent (ordre de Discogs à égalité).
 * Un nom crédité seulement sur le disque entier, sans plage précise, vaut pour toutes les plages.
 */
function parPresence(edition, noms) {
  const { compte, total } = edition.presence || { compte: new Map(), total: 0 };
  const poids = (nom) => compte.get(normaliser(nom)) || total;
  return (noms || []).map((nom, rang) => [nom, poids(nom), rang])
    .sort((a, b) => b[1] - a[1] || a[2] - b[2])
    .map(([nom]) => nom);
}

/** Prépare, pour chaque édition, les textes dans lesquels la recherche cherchera. */
function construireIndexRecherche(edition) {
  const index = {
    titre: normaliser(edition.titre),
    artistes_principaux: normaliser((edition.artistes_principaux || []).join(" | ")),
    labels: normaliser((edition.labels || []).map((l) => l.nom + " " + (l.catno || "")).join(" | ")),
    plages: normaliser(textesDesPlages(edition.plages || []).join(" | ")),
    oeuvres: normaliser([...edition.oeuvres.values()].map((o) => o.titre).join(" | ")),
    categorie: normaliser(edition.categories.join(" | ")),
  };
  for (const { cle } of CATEGORIES_PERSONNES) {
    index[cle] = normaliser((edition[cle] || []).join(" | "));
  }
  const notes = edition.exemplaires.map((e) => Object.values(e.champs).map(texteSansBalises).join(" ")).join(" ");
  index.partout = Object.values(index).join(" | ") + " | " + normaliser(notes);
  return index;
}

/** Titres et artistes de toutes les plages, mouvements compris. */
function textesDesPlages(plages) {
  return plages.flatMap((plage) => [plage.titre, ...(plage.artistes || []), ...textesDesPlages(plage.sous_plages || [])]);
}

/**
 * Œuvres MusicBrainz d'une édition : Map id -> { id, titre, compositeur }.
 * Comme dans la fiche, on garde l'œuvre parente quand il y en a une : le concerto,
 * et non chacun de ses mouvements.
 */
function oeuvresDeLEdition(plages) {
  const oeuvres = new Map();
  for (const plage of plages) {
    if (plage.oeuvre) {
      const o = oeuvreDeReference(plage.oeuvre);
      if (!oeuvres.has(o.id)) oeuvres.set(o.id, o);
    }
    for (const [id, o] of oeuvresDeLEdition(plage.sous_plages || [])) {
      if (!oeuvres.has(id)) oeuvres.set(id, o);
    }
  }
  return oeuvres;
}

// MusicBrainz a parfois deux fiches pour la même œuvre (« Iberia, B. 47 » : Ciccolini d'un côté,
// un disque de guitare de l'autre). On les regroupe quand le titre et le compositeur sont identiques :
// id MusicBrainz -> id retenu (le premier rencontré).
let idsCanoniques = new Map();

/** Remplit idsCanoniques à partir des plages de tous les disques (à faire avant de regrouper les éditions). */
function regrouperOeuvresJumelles(disques) {
  const parCle = new Map();
  idsCanoniques = new Map();
  const parcourir = (plages) => {
    for (const plage of plages || []) {
      if (plage.oeuvre) {
        const reference = plage.oeuvre.parente || plage.oeuvre;
        const cle = normaliser(plage.oeuvre.compositeur) + "|" + normaliser(reference.titre).replace(/\s+/g, " ").trim();
        if (!parCle.has(cle)) parCle.set(cle, reference.id);
        else if (parCle.get(cle) !== reference.id) idsCanoniques.set(reference.id, parCle.get(cle));
      }
      parcourir(plage.sous_plages);
    }
  };
  for (const disque of disques) parcourir(disque.plages);
}

/** L'œuvre à afficher pour une plage : l'œuvre parente s'il y en a une (le concerto plutôt que le mouvement). */
function oeuvreDeReference(oeuvre) {
  const reference = oeuvre.parente || oeuvre;
  return { id: idsCanoniques.get(reference.id) || reference.id, titre: reference.titre, compositeur: oeuvre.compositeur };
}

/** « Le quattro stagioni (Antonio Vivaldi) » */
function nomOeuvre(oeuvre) {
  return oeuvre.titre + (oeuvre.compositeur ? " (" + oeuvre.compositeur + ")" : "");
}

async function chargerCollection() {
  afficherMessage("Chargement de la collection…");
  try {
    // « no-cache » : le navigateur vérifie toujours s'il existe une version plus récente.
    const reponse = await fetch(FICHIER_COLLECTION, { cache: "no-cache" });
    if (!reponse.ok) throw new Error("code " + reponse.status);
    const donnees = await reponse.json();
    infosCollection = donnees;
    modifications = modificationsEnAttente(donnees.genere_le);
    regrouperOeuvresJumelles(donnees.disques || []);
    editions = regrouperParEdition(donnees.disques || []);
  } catch (erreur) {
    afficherMessage(
      "Impossible de lire " + FICHIER_COLLECTION + " (" + erreur.message + "). " +
      "Lance d'abord la synchro, puis ouvre la page via un serveur local (voir le README)."
    );
    return;
  }
  remplirFiltres();
  afficher();
}

// ---------------------------------------------------------------------------
// Filtres : listes de choix, lecture et application
// ---------------------------------------------------------------------------

/** Compte les valeurs d'une liste d'éditions : { "Jazz": 54, "Classical": 210, … }. */
function compter(liste, extraireValeurs) {
  const compte = new Map();
  for (const edition of liste) {
    for (const valeur of new Set(extraireValeurs(edition))) {
      if (valeur) compte.set(valeur, (compte.get(valeur) || 0) + 1);
    }
  }
  return compte;
}

const EXTRACTEURS = {
  categorie: (e) => e.categories,
  genre: (e) => e.genres || [],
  style: (e) => e.styles || [],
  format: (e) => formatsAffiches(e.formats),
  label: (e) => (e.labels || []).map((l) => l.nom),
  localisation: (e) => e.localisations,
  enregistrement: (e) => [e.enregistrement],
  statut: (e) => [e.statut || SANS_STATUT],
};

/** Ordre des statuts : dans l'ordre de la liste Discogs, « Sans statut » en dernier. */
function comparerStatuts(a, b) {
  const ordre = optionsStatut();
  const rang = (v) => (v === SANS_STATUT ? 1e6 : (ordre.findIndex((o) => memeNom(o, v)) + 1 || 1e5));
  return rang(a) - rang(b) || comparerTextes(a, b);
}

/** Choix de « Statut » proposés en boutons (sans l'option neutre) : ceux de la liste Discogs lue par la synchro. */
function optionsStatut() {
  const listes = infosCollection.options_listes || {};
  const nom = Object.keys(listes).find((n) => memeNom(n, CHAMP_STATUT));
  const options = nom ? listes[nom] : STATUTS_CONNUS;
  return options.filter((o) => !memeNom(o, STATUT_NEUTRE));
}

/** Repère d'un statut : 🎧, ★, ou, pour un statut ajouté plus tard sur Discogs, son nom. */
function repereStatut(statut) {
  return REPERES_STATUT[normaliser(statut)] || null;
}

/** Ordre des choix « Live / Studio » : alphabétique, « Non renseigné » (champ vide) en dernier. */
function comparerEnregistrements(a, b) {
  return (a === NON_PRECISE) - (b === NON_PRECISE) || comparerTextes(a, b);
}

function remplirListe(select, compte, libelleTous, comparer = comparerTextes) {
  const valeurs = [...compte.keys()].sort(comparer);
  select.replaceChildren(
    creer("option", { value: "", texte: libelleTous }),
    ...valeurs.map((v) => creer("option", { value: v, texte: v + " (" + compte.get(v) + ")" }))
  );
}

/**
 * Liste « Catégorie » : chaque méta-catégorie (« Jazz (115) », qui prend tous ses dossiers),
 * suivie de ses catégories en retrait. Les valeurs des méta-catégories commencent par PREFIXE_META,
 * pour ne pas confondre la méta « Jazz » et le dossier « Jazz ».
 */
function remplirFiltreCategorie() {
  const parMeta = compter(editions, (e) => e.metas);
  const parCategorie = compter(editions, EXTRACTEURS.categorie);
  const retrait = "\u00a0\u00a0\u00a0\u00a0";
  $("filtre-categorie").replaceChildren(
    creer("option", { value: "", texte: "Toutes" }),
    ...[...parMeta.keys()].sort(comparerTextes).flatMap((meta) => [
      creer("option", { value: PREFIXE_META + meta, classe: "option-meta", texte: meta + " (" + parMeta.get(meta) + ")" }),
      ...[...parCategorie.keys()].filter((c) => metaDeCategorie(c) === meta).sort(comparerCategories)
        .map((c) => creer("option", { value: c, texte: retrait + c + " (" + parCategorie.get(c) + ")" })),
    ])
  );
}

function remplirFiltres() {
  remplirFiltreCategorie();
  remplirListe($("filtre-genre"), compter(editions, EXTRACTEURS.genre), "Tous");
  remplirListe($("filtre-style"), compter(editions, EXTRACTEURS.style), "Tous");
  remplirListe($("filtre-format"), compter(editions, EXTRACTEURS.format), "Tous");
  remplirListe($("filtre-localisation"), compter(editions, EXTRACTEURS.localisation), "Toutes");
  remplirListe($("filtre-enregistrement"), compter(editions, EXTRACTEURS.enregistrement), "Tous", comparerEnregistrements);
  remplirListe($("filtre-statut"), compter(editions, EXTRACTEURS.statut), "Tous", comparerStatuts);

  // Nombre d'éditions de toute la collection, à côté des choix fixes et des cases à cocher.
  const nombre = (test) => " (" + editions.filter(test).length + ")";
  for (const option of $("filtre-musicbrainz").options) {
    if (option.value) {
      option.textContent = option.dataset.libelle + nombre((e) => correspondanceMB(e) === option.value);
    }
  }
  const libelleCase = (id, texte, test) => { $(id).nextElementSibling.textContent = texte + nombre(test); };
  libelleCase("filtre-double", "En double ou plus", (e) => e.exemplaires.length >= 2);
  libelleCase("filtre-notes", "Description ou notes", aDesTextes);
  libelleCase("filtre-oeuvres", "Avec œuvres identifiées", (e) => e.oeuvres.size > 0);
  libelleCase("filtre-oeuvres-incompletes", "Œuvres incomplètes", oeuvresIncompletes);
  libelleCase("filtre-favoris", "Avec pistes favorites", (e) => e.favoris.size > 0);

  // Les labels sont nombreux : liste de suggestions pour la saisie.
  const labels = [...compter(editions, EXTRACTEURS.label).keys()].sort(comparerTextes);
  $("liste-labels").replaceChildren(...labels.map((l) => creer("option", { value: l })));

  // Sélecteur « Chercher dans » : seulement les catégories présentes dans la collection.
  // « Partout » en premier, puis les autres par ordre alphabétique.
  const roles = [
    ["titre", "Titre"],
    ["artistes_principaux", "Artiste principal"],
    ...CATEGORIES_PERSONNES
      .filter(({ cle }) => editions.some((e) => (e[cle] || []).length))
      .map(({ cle, libelle }) => [cle, libelle]),
    ["labels", "Label"],
    ...(editions.some((e) => (e.plages || []).length) ? [["plages", "Titres des plages"]] : []),
    ...(editions.some((e) => e.oeuvres.size) ? [["oeuvres", "Œuvres"]] : []),
  ].sort((a, b) => comparerTextes(a[1], b[1]));
  roles.unshift(["partout", "Partout"]);
  $("role-recherche").replaceChildren(...roles.map(([v, t]) => creer("option", { value: v, texte: t })));
}

/** Lit les champs de la page et met à jour l'état. */
function lireControles() {
  etat.recherche = $("recherche").value.trim();
  etat.role = $("role-recherche").value;
  etat.tri = $("tri").value;
  etat.categorie = $("filtre-categorie").value;
  etat.genre = $("filtre-genre").value;
  etat.style = $("filtre-style").value;
  etat.format = $("filtre-format").value;
  etat.label = $("filtre-label").value.trim();
  etat.anneeMin = parseInt($("filtre-annee-min").value, 10) || null;
  etat.anneeMax = parseInt($("filtre-annee-max").value, 10) || null;
  etat.enregMin = parseInt($("filtre-enreg-min").value, 10) || null;
  etat.enregMax = parseInt($("filtre-enreg-max").value, 10) || null;
  etat.localisation = $("filtre-localisation").value;
  etat.double = $("filtre-double").checked;
  etat.avecNotes = $("filtre-notes").checked;
  etat.correspondanceMB = $("filtre-musicbrainz").value;
  etat.avecOeuvres = $("filtre-oeuvres").checked;
  etat.oeuvresIncompletes = $("filtre-oeuvres-incompletes").checked;
  etat.avecFavoris = $("filtre-favoris").checked;
  etat.statut = $("filtre-statut").value;
  etat.enregistrement = $("filtre-enregistrement").value;
}

/** Recopie l'état dans les champs (quand le code change un filtre, par un clic sur un nom par ex.). */
function ecrireControles() {
  $("recherche").value = etat.recherche;
  $("role-recherche").value = etat.role;
  $("tri").value = etat.tri;
  $("filtre-categorie").value = etat.categorie;
  $("filtre-genre").value = etat.genre;
  $("filtre-style").value = etat.style;
  $("filtre-format").value = etat.format;
  $("filtre-label").value = etat.label;
  $("filtre-annee-min").value = etat.anneeMin || "";
  $("filtre-annee-max").value = etat.anneeMax || "";
  $("filtre-enreg-min").value = etat.enregMin || "";
  $("filtre-enreg-max").value = etat.enregMax || "";
  $("filtre-localisation").value = etat.localisation;
  $("filtre-double").checked = etat.double;
  $("filtre-notes").checked = etat.avecNotes;
  $("filtre-musicbrainz").value = etat.correspondanceMB;
  $("filtre-oeuvres").checked = etat.avecOeuvres;
  $("filtre-oeuvres-incompletes").checked = etat.oeuvresIncompletes;
  $("filtre-favoris").checked = etat.avecFavoris;
  $("filtre-statut").value = etat.statut;
  $("filtre-enregistrement").value = etat.enregistrement;
  // Les croix ✕ suivent les valeurs écrites par le code.
  for (const enveloppe of document.querySelectorAll(".case-effacable")) if (enveloppe.montrer) enveloppe.montrer();
}

function nombreDeFiltresActifs() {
  return [etat.categorie, etat.genre, etat.style, etat.format, etat.label, etat.anneeMin, etat.anneeMax,
          etat.enregMin, etat.enregMax, etat.localisation, etat.double, etat.avecNotes, etat.correspondanceMB, etat.avecOeuvres, etat.oeuvresIncompletes,
          etat.avecFavoris, etat.statut, etat.enregistrement, etat.oeuvre].filter(Boolean).length;
}

/**
 * Correspondance MusicBrainz de l'édition, regroupée comme dans le filtre : "exacte"
 * (lien Discogs ou code-barre), "album", "aucune", ou "" si elle n'a pas encore été cherchée.
 */
function correspondanceMB(edition) {
  const methode = edition.musicbrainz_methode;
  if (methode === "edition" || methode === "code_barre") return "exacte";
  return methode || "";
}

/** Vrai si l'édition passe la recherche et tous les filtres. */
// ---------------------------------------------------------------------------
// Recherche « intelligente » : un petit analyseur à descente récursive
// ---------------------------------------------------------------------------
// Syntaxe (convention de Google, opérateurs en MAJUSCULES seulement) :
//   bach gould            les deux mots, n'importe où (ET implicite)
//   "glenn gould"         l'expression entière (guillemets droits, “ ” ou « »)
//   bach OU haendel       l'un ou l'autre
//   chopin SAUF nocturnes exclure
//   (bach OU haendel) gould   parenthèses pour combiner
//   K. 386, BWV 1007, op. 27  un numéro de catalogue compte comme un tout
// Priorités, comme × avant + en calcul : SAUF, puis ET, puis OU.

const DELAI_RECHERCHE = 300;   // ms de pause dans la frappe avant de chercher (Entrée : tout de suite)
const TYPES_CATALOGUE = "bwv|buxwv|hwv|twv|rv|kv|k|hob|woo|op|d|s|l|sv|sz|bb|fp|cd|b|kk|z|wq|h|no|nr|n°";
// Un jeton : parenthèse, expression entre guillemets, numéro de catalogue, ou mot.
const RE_JETON = new RegExp(
  "[()]" +
  "|[\"“”«»„][^\"“”«»„]*[\"“”«»„]?" +
  "|(?:" + TYPES_CATALOGUE + ")\\.?\\s*\\d+[a-z]?(?![0-9])(?=[\\s()\"“”«»„,;]|$)" +
  "|[^\\s()\"“”«»„]+", "gi");
const OPERATEURS = { ET: "et", OU: "ou", SAUF: "sauf" };

const echapperRegex = (texte) => texte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Feuille de l'arbre : une expression régulière sur le texte normalisé, dont le 2e groupe
 * est le passage trouvé (pour le surlignage).
 */
function feuille(jeton) {
  if (/^["“”«»„]/.test(jeton)) {
    const expression = normaliser(jeton.replace(/["“”«»„]/g, "")).trim();
    if (!expression) return null;
    return { feuille: new RegExp("()(" + echapperRegex(expression).replace(/\s+/g, "\\s+") + ")", "g") };
  }
  const numero = new RegExp("^(" + TYPES_CATALOGUE + ")\\.?\\s*(\\d+[a-z]?)$", "i").exec(normaliser(jeton));
  if (numero) {
    const type = numero[1].toLowerCase();
    const types = type === "k" || type === "kv" ? "kv?" : ["no", "nr", "n°"].includes(type) ? "(?:no|nr|n°)" : echapperRegex(type);
    return { feuille: new RegExp("(^|[^a-z0-9])(" + types + "\\.?\\s*" + echapperRegex(numero[2]) + ")(?![0-9])", "g") };
  }
  return { feuille: new RegExp("()(" + echapperRegex(normaliser(jeton)) + ")", "g") };
}

/** Arbre de la recherche : { et: [...] }, { ou: [...] }, { non: … } ou { feuille: RegExp } ; null si vide. */
function analyserRecherche(recherche) {
  const jetons = String(recherche || "").match(RE_JETON) || [];
  let i = 0;
  const regarder = () => jetons[i];
  const estOperateur = (j) => Object.prototype.hasOwnProperty.call(OPERATEURS, j);

  // ou := et ( OU et )*
  const lireOu = () => {
    const membres = [lireEt()];
    while (regarder() === "OU") { i++; membres.push(lireEt()); }
    const utiles = membres.filter(Boolean);
    return utiles.length > 1 ? { ou: utiles } : utiles[0] || null;
  };
  // et := sauf ( [ET] sauf )*   (le ET est implicite entre deux termes)
  const lireEt = () => {
    const membres = [];
    while (i < jetons.length && regarder() !== "OU" && regarder() !== ")") {
      if (regarder() === "ET") { i++; continue; }
      membres.push(lireSauf());
    }
    const utiles = membres.filter(Boolean);
    return utiles.length > 1 ? { et: utiles } : utiles[0] || null;
  };
  // sauf := SAUF sauf | primaire
  const lireSauf = () => {
    if (regarder() === "SAUF") {
      i++;
      const terme = i < jetons.length && !estOperateur(regarder()) && regarder() !== ")" ? lireSauf() : null;
      return terme ? { non: terme } : null;
    }
    return lirePrimaire();
  };
  // primaire := ( ou ) | feuille   (une parenthèse non fermée est fermée d'office)
  const lirePrimaire = () => {
    const jeton = jetons[i++];
    if (jeton === "(") {
      const dedans = lireOu();
      if (regarder() === ")") i++;
      return dedans;
    }
    return feuille(jeton);
  };

  const arbre = lireOu();
  while (i < jetons.length) {   // parenthèse fermante en trop : on l'ignore et on continue
    i++;
    const suite = lireOu();
    if (suite) return arbre ? { et: [arbre, suite] } : suite;
  }
  return arbre;
}

// La même recherche est évaluée pour chaque disque : on garde le dernier arbre construit.
let derniereRecherche = { texte: null, arbre: null };
function arbreDe(recherche) {
  // Un seul caractère ne trie rien d'utile (« b » est partout) : on attend le deuxième.
  if (String(recherche || "").trim().length < 2) return null;
  if (derniereRecherche.texte !== recherche) derniereRecherche = { texte: recherche, arbre: analyserRecherche(recherche) };
  return derniereRecherche.arbre;
}

/** Petit bouton « ? » à côté d'un champ de recherche : il ouvre l'aide sur la syntaxe. */
function boutonAide() {
  return creer("button", { type: "button", classe: "bouton-aide", "aria-label": "Syntaxe de la recherche", texte: "?",
    surclic: () => $("aide-recherche").showModal() });
}

function evaluer(arbre, texte) {
  if (!arbre) return true;
  if (arbre.feuille) { arbre.feuille.lastIndex = 0; return arbre.feuille.test(texte); }
  if (arbre.non) return !evaluer(arbre.non, texte);
  if (arbre.et) return arbre.et.every((a) => evaluer(a, texte));
  return arbre.ou.some((a) => evaluer(a, texte));
}

/** Vrai si `texte` (déjà normalisé) répond à la recherche. */
function rechercheTrouvee(texte, recherche) {
  return evaluer(arbreDe(recherche), texte);
}

/** Expressions à surligner : toutes les feuilles, sauf celles qu'on exclut (SAUF). */
function motifsDeRecherche(recherche) {
  const motifs = [];
  const parcourir = (arbre) => {
    if (!arbre || arbre.non) return;
    if (arbre.feuille) motifs.push(arbre.feuille);
    else (arbre.et || arbre.ou).forEach(parcourir);
  };
  parcourir(arbreDe(recherche));
  return motifs;
}

function correspond(edition) {
  if (etat.recherche) {
    if (!rechercheTrouvee(edition.index[etat.role] || "", etat.recherche)) return false;
  }
  if (etat.categorie && !(etat.categorie.startsWith(PREFIXE_META)
    ? edition.metas.includes(etat.categorie.slice(PREFIXE_META.length))
    : edition.categories.includes(etat.categorie))) return false;
  if (etat.genre && !(edition.genres || []).includes(etat.genre)) return false;
  if (etat.style && !(edition.styles || []).includes(etat.style)) return false;
  if (etat.format && !formatsAffiches(edition.formats).includes(etat.format)) return false;
  if (etat.label && !(edition.labels || []).some((l) => normaliser(l.nom).includes(normaliser(etat.label)))) return false;
  if ((etat.anneeMin || etat.anneeMax) && !edition.annee) return false;
  if (etat.anneeMin && edition.annee < etat.anneeMin) return false;
  if (etat.anneeMax && edition.annee > etat.anneeMax) return false;
  if (etat.enregMin || etat.enregMax) {
    // L'édition passe si sa période d'enregistrement [première, dernière] touche les années choisies.
    const annees = edition.annees_enregistrement;
    if (!annees || !annees.length) return false;
    if (etat.enregMin && annees[1] < etat.enregMin) return false;
    if (etat.enregMax && annees[0] > etat.enregMax) return false;
  }
  if (etat.localisation && !edition.localisations.includes(etat.localisation)) return false;
  if (etat.double && edition.exemplaires.length < 2) return false;
  if (etat.avecNotes && !aDesTextes(edition)) return false;
  if (etat.correspondanceMB && correspondanceMB(edition) !== etat.correspondanceMB) return false;
  if (etat.avecOeuvres && !edition.oeuvres.size) return false;
  if (etat.oeuvresIncompletes && !oeuvresIncompletes(edition)) return false;
  if (etat.avecFavoris && !edition.favoris.size) return false;
  if (etat.statut && (edition.statut || SANS_STATUT) !== etat.statut) return false;
  if (etat.enregistrement && edition.enregistrement !== etat.enregistrement) return false;
  if (etat.oeuvre && !edition.oeuvres.has(etat.oeuvre.id)) return false;
  return true;
}

/**
 * Pour chaque tri : la valeur montrée au-dessus de la photo (rien pour Artiste principal et Titre,
 * déjà écrits sous la photo) et l'intertitre des éditions qui n'ont pas cette valeur (rangées à la fin).
 */
const INFOS_DE_TRI = {
  artiste: { sans: "Sans artiste principal", manque: (e) => !e.cleArtiste },
  compositeur: { sans: "Sans compositeur", manque: (e) => !e.cleCompositeur,
    valeur: (e) => e.compositeurPrincipal || "" },
  annee: { sans: "Sans année de parution", manque: (e) => !e.annee, valeur: (e) => (e.annee ? String(e.annee) : "") },
  enregistrement: { sans: "Sans année d'enregistrement", manque: (e) => !(e.annees_enregistrement || []).length,
    valeur: (e) => {
      const annees = e.annees_enregistrement;
      if (!annees || !annees.length) return "";
      return annees[0] === annees[1] ? String(annees[0]) : annees[0] + " – " + annees[1];
    } },
  ajout: { sans: "Sans date d'ajout", manque: (e) => !e.date_ajout,
    valeur: (e) => (e.date_ajout ? new Date(e.date_ajout).toLocaleDateString("fr-FR") : "") },
};

/** Ordre d'affichage selon le tri choisi. Les valeurs manquantes vont à la fin. */
function trier(liste) {
  const avecVide = (a, b, comparer) => (!a && !b ? 0 : !a ? 1 : !b ? -1 : comparer(a, b));
  const parTitre = (a, b) => comparerTextes(a.titre, b.titre);

  const comparateurs = {
    artiste: (a, b) => avecVide(a.cleArtiste, b.cleArtiste, comparerTextes) || parTitre(a, b),
    compositeur: (a, b) => avecVide(a.cleCompositeur, b.cleCompositeur, comparerTextes) || parTitre(a, b),
    titre: parTitre,
    annee: (a, b) => avecVide(a.annee, b.annee, (x, y) => x - y) || parTitre(a, b),
    // Première année d'enregistrement, puis la dernière (1958 avant 1958 – 1963).
    enregistrement: (a, b) => avecVide(a.annees_enregistrement, b.annees_enregistrement,
      (x, y) => x[0] - y[0] || x[1] - y[1]) || parTitre(a, b),
    ajout: (a, b) => avecVide(b.date_ajout, a.date_ajout, comparerTextes),  // plus récents d'abord
  };
  return [...liste].sort(comparateurs[etat.tri] || comparateurs.artiste);
}

// ---------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------

function afficherMessage(texte) {
  $("message").textContent = texte;
  $("message").hidden = !texte;
}

function afficher() {
  tourDAffichage++;
  const resultats = trier(editions.filter(correspond));

  // Compteur en haut : « 42 éditions sur 355 · 358 exemplaires »
  const nbExemplaires = editions.reduce((total, e) => total + e.exemplaires.length, 0);
  $("compteur").textContent = resultats.length === editions.length
    ? pluriel(editions.length, "édition") + " · " + pluriel(nbExemplaires, "exemplaire")
    : resultats.length + " sur " + pluriel(editions.length, "édition");

  const nbFiltres = nombreDeFiltresActifs();
  $("nb-filtres").textContent = nbFiltres;
  $("nb-filtres").hidden = nbFiltres === 0;
  // Bouton « Effacer les filtres » à droite du compteur : sans repasser par le panneau des filtres.
  $("effacer-filtres-entete").hidden = nbFiltres === 0 || etat.vue !== "collection";

  // Le tirage au hasard porte sur toute la collection : le message des filtres n'y a pas de sens.
  afficherMessage(resultats.length || etat.vue === "hasard" ? "" : "Aucun disque ne correspond à ces critères.");
  afficherBandeau(resultats.length);

  $("vue-collection").hidden = etat.vue !== "collection";
  $("vue-statistiques").hidden = etat.vue !== "statistiques";
  $("vue-index").hidden = etat.vue !== "index";
  $("vue-hasard").hidden = etat.vue !== "hasard";
  $("vue-oeuvres").hidden = etat.vue !== "oeuvres";
  // La feuille de style masque ce qui n'agit pas sur la vue : tout l'outillage dans l'index
  // et dans « Au hasard », le tri dans les statistiques.
  document.body.dataset.vue = etat.vue;
  document.querySelectorAll(".onglet").forEach((b) => b.classList.toggle("actif", b.dataset.vue === etat.vue));

  if (etat.vue === "collection") (etat.oeuvre ? afficherPageOeuvre : afficherGrille)(resultats);
  else if (etat.vue === "statistiques") afficherStatistiques(resultats);
  else if (etat.vue === "index") afficherIndex();
  else if (etat.vue === "oeuvres") afficherOeuvres();
  else afficherHasard();
}

// D'où l'on vient quand on clique sur une œuvre ou un nom (une fiche, les statistiques
// ou l'index), pour que le bouton « Revenir » y ramène :
// { etat, defilement, edition, libelle, apres }. `apres` : l'état juste après le clic ;
// dès que l'utilisateur change autre chose, le retour n'a plus de sens et disparaît.
let retour = null;

/** Bandeau au-dessus de la grille : l'œuvre choisie et/ou le bouton « Revenir ». */
function afficherBandeau(nombre) {
  if (retour && JSON.stringify(etat) !== retour.apres) retour = null;
  const visible = etat.vue === "collection" && Boolean(etat.oeuvre || retour);
  $("bandeau-oeuvre").hidden = !visible;
  if (!visible) return;
  const origine = retour && (retour.edition ? "à la fiche" : retour.etat.vue === "index" ? "à l'index"
    : retour.etat.vue === "oeuvres" ? "à la liste des œuvres" : retour.etat.vue === "hasard" ? "au tirage" : "aux statistiques");
  $("bandeau-oeuvre").replaceChildren(
    retour ? creer("button", { type: "button", classe: "bouton bouton-revenir", texte: "← Revenir " + origine, surclic: revenir }) : null,
    // Page Œuvre : son titre est dans la page ; sans « Revenir », un bouton pour retrouver la collection.
    ...(etat.oeuvre
      ? (retour ? [] : [creer("button", { type: "button", classe: "bouton bouton-revenir", texte: "← Toute la collection",
          surclic: () => { etat.oeuvre = null; ecrireControles(); afficher(); } })])
      : [creer("strong", { texte: retour.libelle }),
        creer("span", { classe: "discret", texte: " · " + pluriel(nombre, "édition") + " dans ma cédéthèque" })])
  );
}

/** Bouton « Revenir » : on retrouve la page d'avant (filtres, défilement, et la fiche ouverte). */
function revenir() {
  const precedent = retour;
  retour = null;
  Object.assign(etat, precedent.etat);
  ecrireControles();
  afficher();
  window.scrollTo({ top: precedent.defilement });
  if (precedent.edition) ouvrirFiche(precedent.edition);
}

/**
 * Affiche les disques correspondant à `changements` (une œuvre, une recherche…) en gardant
 * de quoi revenir. `edition` : la fiche d'où l'on vient ; `libelle` : texte du bandeau.
 */
function allerVers(changements, edition = null, libelle = "") {
  retour = { etat: { ...etat }, defilement: window.scrollY, edition, libelle };
  Object.assign(etat, changements, { vue: "collection" });
  retour.apres = JSON.stringify(etat);
  ecrireControles();
  if ($("fiche").open) $("fiche").close();
  afficher();
  window.scrollTo({ top: 0 });
}

/** Clic sur une œuvre : on affiche les disques qui la contiennent. `edition` : la fiche d'où l'on vient. */
function choisirOeuvre(oeuvre, edition = null) {
  allerVers({ oeuvre, recherche: "", role: "partout" }, edition);
}

// ---------------------------------------------------------------------------
// Page Œuvre : toutes mes versions d'une œuvre MusicBrainz
// ---------------------------------------------------------------------------

const INTERPRETES_VISIBLES = 3;                 // noms par version, avant « +N »
const ADRESSE_MB_OEUVRE = "https://musicbrainz.org/work/";
const API_MB = "https://musicbrainz.org/ws/2/work/";
const API_WIKIDATA = "https://www.wikidata.org/w/api.php";
const CLE_WIKIPEDIA = "wikipedia-oeuvres";      // réglage du navigateur : id d'œuvre -> { url, langue, date }
const JOURS_SANS_ARTICLE = 30;                  // « pas d'article » : on redemande à MusicBrainz au bout de 30 jours

/** Vrai si les deux noms désignent la même personne : même nom de famille (« Frédéric » / « Fryderyk » Chopin). */
function memePersonne(a, b) {
  const nomDeFamille = (nom) => normaliser(nom).split(/[\s,]+/).filter(Boolean).pop() || "";
  return normaliser(a) === normaliser(b) || (nomDeFamille(a).length > 2 && nomDeFamille(a) === nomDeFamille(b));
}

/**
 * Interprètes d'une version : les noms crédités sur ses plages (piano, direction, orchestre…),
 * sinon les artistes principaux de l'édition, sans les compositeurs.
 */
function interpretesDeLaVersion(edition, plages, oeuvre) {
  // Seulement les compositeurs de cette œuvre : une interprète qui compose d'autres plages du disque
  // (Eliane Elias) reste l'interprète de celle-ci.
  const compositeurs = [
    ...String(oeuvre.compositeur || "").split(/,\s*/),
    ...plages.flatMap(({ plage, groupes }) => [plage, ...groupes]
      .flatMap((p) => (p.credits || []).filter(estCreditDeCompositeur).map((c) => c.nom))),
  ].filter(Boolean);
  const pasCompositeur = (nom) => nom && !/^various$/i.test(nom) && !compositeurs.some((c) => memePersonne(c, nom));
  const surLesPlages = plages.flatMap(({ plage, groupes }) => [plage, ...groupes].flatMap((p) => [
    ...(p.artistes || []),
    ...(p.credits || []).filter((c) => !estCreditDeCompositeur(c)).map((c) => c.nom),
  ]));
  const noms = surLesPlages.filter(pasCompositeur);
  if (noms.length) return [...new Set(noms)];
  // Discogs ne dit rien sur les plages : artistes de l'enregistrement d'après MusicBrainz
  // (coffret « Various » : Academy of Ancient Music, Richard Egarr).
  const selonMusicBrainz = plages.flatMap(({ plage }) => (plage.oeuvre && plage.oeuvre.artistes) || []).filter(pasCompositeur);
  if (selonMusicBrainz.length) return [...new Set(selonMusicBrainz)];
  // Artistes principaux : on retire aussi les compositeurs des autres plages (John Field sur un disque
  // de nocturnes de Chopin et Field), sauf s'il ne reste personne (Eliane Elias, qui compose et joue).
  const principaux = (edition.artistes_principaux || []).filter(pasCompositeur);
  const sansAutresCompositeurs = principaux.filter((nom) => !(edition.compositeurs || []).some((c) => memePersonne(c, nom)));
  if (principaux.length) return [...new Set(sansAutresCompositeurs.length ? sansAutresCompositeurs : principaux)];
  // Toujours personne : l'artiste du disque compose ce qu'il joue (Amy Winehouse, John Coltrane).
  return [...new Set((edition.artistes_principaux || []).filter((nom) => nom && !/^various$/i.test(nom)))];
}

/**
 * Plages réelles avec les groupes qui les contiennent ({ plage, groupes }) : dans une compilation,
 * l'interprète est souvent crédité sur le titre de l'œuvre (le groupe), pas sur chaque mouvement.
 */
function plagesAvecHeritage(plages, groupes = []) {
  return (plages || []).flatMap((plage) => {
    if (plage.type === "intertitre") return [];
    return (plage.sous_plages || []).length
      ? plagesAvecHeritage(plage.sous_plages, [plage, ...groupes])
      : [{ plage, groupes }];
  });
}

/**
 * Clé d'une partie : son titre (sans celui de l'œuvre), et non son id MusicBrainz, pour que les
 * mouvements de deux fiches jumelles (voir regrouperOeuvresJumelles) tombent sur la même ligne.
 */
function idDeLaPartie(plage, oeuvre) {
  return plage.oeuvre.parente ? normaliser(titreDeLaPartie(plage.oeuvre.titre, oeuvre.titre)) : "entiere";
}

/** Titre d'une partie sans le titre de l'œuvre devant : « Selva morale e spirituale: Gloria » -> « Gloria ». */
function titreDeLaPartie(titre, titreOeuvre) {
  // « : » ou « : » à la française (espace avant) selon la langue du titre MusicBrainz.
  if (!titre.startsWith(titreOeuvre)) return titre;
  const reste = titre.slice(titreOeuvre.length).match(/^\s*:\s*(.+)$/);
  return reste ? reste[1] : titre;
}

/**
 * Mes versions de l'œuvre, parmi les éditions `liste` : une par édition, avec ses plages,
 * sa durée, ses interprètes et ses parties (mouvements ou pièces : id -> { titre, secondes }).
 */
function versionsDeLOeuvre(oeuvre, liste) {
  return liste.filter((e) => e.oeuvres.has(oeuvre.id)).flatMap((edition) => {
    const plages = plagesAvecHeritage(edition.plages).map((element, rang) => ({ ...element, rang }))
      .filter(({ plage }) => plage.oeuvre && oeuvreDeReference(plage.oeuvre).id === oeuvre.id);
    // Un coffret peut contenir plusieurs enregistrements de la même œuvre (Ciccolini : quatre Suite bergamasque).
    // Une partie déjà vue ouvre une nouvelle version quand l'œuvre recommence : après une coupure (autre
    // disque, autres plages entre deux), si la partie avait été entendue avant une coupure (Clair de lune
    // seul au CD 20, puis toute la suite au CD 21), ou si la plage suivante répète aussi une partie (Gould :
    // Contrapunctus I, II… à l'orgue, puis au piano). Sinon elle reste dans la version : un mouvement
    // en deux plages (Saint-Saëns, 3e symphonie), une reprise (Grande Ritournelle de La Belle Excentrique),
    // les deux états du Canon XIV (Emerson), ou une erreur de rattachement sur MusicBrainz.
    // La nouvelle version reprend les plages qui la précèdent sans interruption sur le même disque,
    // si elles suivent une coupure (Prélude et Menuet en tête du CD 21, après un Clair de lune seul au CD 20).
    const idDe = ({ plage }) => idDeLaPartie(plage, oeuvre);
    const disqueDe = ({ plage }) => disqueDeLaPosition(plage.position);
    const contigues = (avant, apres) => avant.rang === apres.rang - 1 && disqueDe(avant) === disqueDe(apres);
    const occurrences = [];
    plages.forEach((element, i) => {
      const courante = occurrences[occurrences.length - 1];
      const derniere = courante && courante[courante.length - 1];
      const suivante = plages[i + 1];
      const dejaVue = (e) => courante.some((x) => idDe(x) === idDe(e));
      // Œuvre entière découpée en plages sans mouvements MB (Le Mandarin merveilleux : 11 plages
      // reliées chacune à l'œuvre) : les plages qui se suivent sur le même disque forment une seule version.
      const suiteDeLOeuvre = derniere && idDe(element) === "entiere" && idDe(derniere) === "entiere"
        && derniere.rang === element.rang - 1
        && disqueDeLaPosition(derniere.plage.position) === disqueDeLaPosition(element.plage.position);
      // Début de la dernière suite sans coupure (autre disque, ou plage non contiguë) de la version en cours.
      let coupure = courante ? courante.length - 1 : 0;
      while (coupure > 0 && contigues(courante[coupure - 1], courante[coupure])) coupure--;
      // Même partie que la plage juste avant : un mouvement en plusieurs plages (Magnificat en 13 plages).
      const memePartie = derniere && idDe(element) !== "entiere" && idDe(derniere) === idDe(element)
        && contigues(derniere, element);
      const recommence = courante && !suiteDeLOeuvre && !memePartie && dejaVue(element)
        && (!contigues(derniere, element)
          || (suivante && contigues(element, suivante) && idDe(suivante) !== idDe(element) && dejaVue(suivante))
          || courante.slice(0, coupure).some((x) => idDe(x) === idDe(element)));
      if (!courante || recommence) {
        const reprises = [];
        // Plages reprenables : celles qui suivent la dernière coupure ; aucune s'il n'y en a pas.
        if (coupure === 0) coupure = courante ? courante.length : 0;
        while (courante && courante.length > coupure) {
          const derniere = courante[courante.length - 1];
          const suivante = reprises[0] || element;
          if (derniere.rang !== suivante.rang - 1
            || disqueDeLaPosition(derniere.plage.position) !== disqueDeLaPosition(element.plage.position)
            || reprises.some((e) => idDe(e) === idDe(derniere)) || idDe(derniere) === idDe(element)) break;
          reprises.unshift(courante.pop());
        }
        if (courante && !courante.length) occurrences.pop();
        occurrences.push(reprises);
      }
      occurrences[occurrences.length - 1].push(element);
    });
    return occurrences.map((plagesVersion) => {
      const parties = new Map();
      for (const { plage } of plagesVersion) {
        const id = idDeLaPartie(plage, oeuvre);
        const titre = plage.oeuvre.parente ? titreDeLaPartie(plage.oeuvre.titre, oeuvre.titre) : "Œuvre entière";
        if (!parties.has(id)) parties.set(id, { titre, secondes: 0, durees: [] });
        parties.get(id).secondes += secondesDe(plage.duree) || 0;
        parties.get(id).durees.push(secondesDe(plage.duree) || 0);   // 2 plages ou plus : rattachement à vérifier
      }
      return {
        edition, parties, plages: plagesVersion,
        // Plusieurs versions dans la même édition : on dit sur quel disque est chacune (« CD 12 »).
        disque: occurrences.length > 1 ? disqueDeLaPosition(plagesVersion[0].plage.position) : null,
        duree: dureeTotale(plagesVersion.map(({ plage }) => plage)),
        interpretes: interpretesDeLaVersion(edition, plagesVersion, oeuvre),
        annees: edition.annees_enregistrement && edition.annees_enregistrement.length ? edition.annees_enregistrement : null,
      };
    });
  });
}

/** Ordre des versions : par année d'enregistrement, puis de parution ; sans année à la fin. */
function comparerVersions(a, b) {
  const annee = (v) => (v.annees ? v.annees[0] : v.edition.annee) || Infinity;
  return annee(a) - annee(b) || comparerTextes(a.edition.titre, b.edition.titre);
}

/** « 23 min » ou « 23 min 40 s » sous l'heure : la comparaison des versions a besoin des secondes. */
function texteDureeFine({ secondes, complete }) {
  if (!secondes) return "";
  if (secondes >= 3600) return texteDuree({ secondes, complete });
  const texte = Math.floor(secondes / 60) + " min " + String(secondes % 60).padStart(2, "0") + " s";
  return complete ? texte : "au moins " + texte;
}

/** « 4:05 » pour une case du tableau des parties. */
function texteMinutes(secondes) {
  return secondes ? Math.floor(secondes / 60) + ":" + String(secondes % 60).padStart(2, "0") : "";
}

/** Nom court d'une version (tête de colonne) : son premier interprète, ou le titre du disque. */
function nomCourtDeLaVersion(version) {
  return (version.interpretes[0] || version.edition.titre) + (version.disque ? " (" + version.disque + ")" : "");
}

function afficherPageOeuvre(liste) {
  const oeuvre = etat.oeuvre;
  // Rangées par catégorie (ordre habituel), puis par année d'enregistrement dans chaque catégorie.
  const versions = versionsDeLOeuvre(oeuvre, liste).map((v) => ({ ...v, categorie: categorieDeLaVersion(v) }))
    .sort((a, b) => comparerCategoriesParMeta(a.categorie, b.categorie) || comparerVersions(a, b));
  const parCategorie = new Map();
  for (const v of versions) {
    if (!parCategorie.has(v.categorie)) parCategorie.set(v.categorie, []);
    parCategorie.get(v.categorie).push(v);
  }
  const dureeMax = Math.max(...versions.map((v) => v.duree.secondes), 1);
  const liens = creer("p", { classe: "oeuvre-liens" },
    creerLien(ADRESSE_MB_OEUVRE + oeuvre.id, "MusicBrainz"));
  ajouterLienWikipedia(liens, oeuvre.id);
  $("vue-collection").replaceChildren(creer("article", { classe: "page-oeuvre" },
    creer("p", { classe: "oeuvre-surtitre", texte: "Œuvre" }),
    creer("h2", { classe: "oeuvre-titre", texte: oeuvre.titre }),
    oeuvre.compositeur ? creer("p", { classe: "oeuvre-compositeur", texte: oeuvre.compositeur }) : null,
    liens,
    creer("h3", { classe: "oeuvre-intertitre" }, pluriel(versions.length, "version") + " dans ma cédéthèque",
      creer("span", { classe: "discret", texte: " · par catégorie, puis par année d'enregistrement" })),
    [...parCategorie].map(([categorie, liste]) => [
      creer("p", { classe: "versions-categorie", texte: categorie }),
      creer("ol", { classe: "versions" }, liste.map((v) => ligneVersion(v, dureeMax))),
    ]),
    tableauDesParties(versions)
  ));
}

/** Catégorie d'une version : celle de son disque (la première dans l'ordre habituel s'il y en a plusieurs). */
function categorieDeLaVersion(version) {
  return [...version.edition.categories].sort(comparerCategoriesParMeta)[0] || SANS_CATEGORIE;
}

/** Une version : pochette, interprètes, disque, années, durée (avec une barre pour comparer). */
function ligneVersion(version, dureeMax) {
  const { edition, interpretes, annees, duree, parties } = version;
  const image = edition.miniature || edition.pochette;
  const enPlus = interpretes.length - INTERPRETES_VISIBLES;
  const dates = [
    annees ? (annees[0] === annees[1] ? "Enregistré en " : "Enregistré de ") + textePeriode(annees).replace(" – ", " à ") : null,
    edition.annee ? "parution " + edition.annee : null,
    (edition.labels || [])[0] ? edition.labels[0].nom : null,
  ].filter(Boolean).join(" · ");
  const nbParties = [...parties.keys()].filter((id) => id !== "entiere").length;
  return creer("li", {},
    creer("button", { type: "button", classe: "version",
      // La fiche s'ouvre sur l'œuvre (dans son CD pour un coffret), surlignée un instant.
      surclic: () => ouvrirFiche(edition, { position: version.plages[0].plage.position }),
      title: "Ouvrir la fiche du disque, sur cette œuvre" },
      creer("span", { classe: "version-pochette" },
        image ? creer("img", { src: image, alt: "", loading: "lazy", decoding: "async" })
          : creer("span", { classe: "sans-image", texte: "♪" })),
      creer("span", { classe: "version-texte" },
        creer("span", { classe: "version-interpretes",
          texte: (interpretes.slice(0, INTERPRETES_VISIBLES).join(", ") || "Interprètes non indiqués")
            + (enPlus > 0 ? " +" + enPlus : "") }),
        creer("span", { classe: "version-disque", texte: edition.titre + (version.disque ? " · " + version.disque : "") }),
        dates ? creer("span", { classe: "version-dates", texte: dates }) : null,
        creer("span", { classe: "version-duree" },
          creer("span", { classe: "version-barre", style: "width:" + Math.round(duree.secondes / dureeMax * 100) + "%" }),
          creer("span", { texte: [texteDureeFine(duree) || "durée inconnue",
            nbParties ? pluriel(nbParties, "partie") : version.plages.length > 1 ? pluriel(version.plages.length, "plage") : null]
            .filter(Boolean).join(" · ") })))));
}

/**
 * Tableau des parties (mouvements ou pièces) : une ligne par partie, une colonne par version,
 * avec la durée dans chaque case. Seulement pour une œuvre en plusieurs parties et au moins 2 versions.
 */
function tableauDesParties(versions) {
  const toutes = new Map();   // id -> titre, dans l'ordre de la version qui en a le plus
  const parNombre = [...versions].sort((a, b) => b.parties.size - a.parties.size);
  for (const v of parNombre) for (const [id, partie] of v.parties) if (!toutes.has(id)) toutes.set(id, partie.titre);
  // Dès 2 parties, même pour une seule version : durée de chaque mouvement et plages en double.
  if (!versions.length || [...toutes.keys()].filter((id) => id !== "entiere").length < 2) return null;
  const tableau = creer("table", { classe: "tableau-parties" + (versions.length === 1 ? " une-version" : "") },
    creer("thead", {}, creer("tr", {},
      creer("th", { texte: "Partie" }),
      versions.map((v) => creer("th", { title: v.interpretes.join(", ") + " · " + v.edition.titre },
        nomCourtDeLaVersion(v), creer("span", { classe: "colonne-categorie", texte: v.categorie }),
        creer("span", { classe: "colonne-duree", texte: texteMinutes(v.duree.secondes) }))))),
    creer("tbody", {}, [...toutes].map(([id, titre]) => creer("tr", {},
      creer("th", { texte: titre }),
      versions.map((v) => {
        const partie = v.parties.get(id);
        if (partie && partie.durees.length > 1) {
          // Plusieurs plages reliées à la même partie : souvent une erreur de rattachement sur MusicBrainz.
          return creer("td", { classe: "doublee", title: "Plusieurs plages reliées à cette partie sur MusicBrainz : à vérifier" },
            "⚠ " + partie.durees.length + " plages",
            creer("span", { classe: "durees-doublees", texte: partie.durees.map((d) => texteMinutes(d) || "?").join(" + ") }));
        }
        return creer("td", { texte: partie ? texteMinutes(partie.secondes) || "✓" : "–",
          classe: partie ? null : "absente" });
      })))));
  return creer("section", { classe: "parties" },
    creer("h3", { classe: "oeuvre-intertitre" }, "Parties",
      versions.length > 1 ? creer("span", { classe: "discret", texte: " · « – » : absente de cette version" }) : null),
    creer("div", { classe: "tableau-defilant" }, tableau));
}

/**
 * Ajoute le lien Wikipédia de l'œuvre (article en français, sinon en anglais), trouvé par
 * MusicBrainz -> Wikidata au moment où l'on ouvre la page, puis gardé dans le navigateur.
 */
async function ajouterLienWikipedia(liens, id) {
  const reserve = lireStockage(CLE_WIKIPEDIA, {});
  let article = reserve[id];
  const perime = article && !article.url && Date.now() - article.date > JOURS_SANS_ARTICLE * 86400000;
  if (!article || perime) {
    const attente = creer("span", { classe: "discret", texte: "Wikipédia : recherche…" });
    liens.append(attente);
    try {
      article = { ...(await chercherArticle(id)), date: Date.now() };
      ecrireStockage(CLE_WIKIPEDIA, { ...lireStockage(CLE_WIKIPEDIA, {}), [id]: article });
    } catch (erreur) {
      article = null;   // hors connexion ou service indisponible : on réessaiera à la prochaine visite
    }
    attente.remove();
  }
  if (article && article.url) {
    liens.append(creerLien(article.url, "Wikipédia" + (article.langue === "fr" ? "" : " (" + article.langue + ")")));
  } else {
    liens.append(creer("span", { classe: "discret", texte: article ? "Pas d'article Wikipédia" : "Wikipédia indisponible" }));
  }
}

/** { url, langue } de l'article Wikipédia de l'œuvre MusicBrainz, ou { url: null }. */
async function chercherArticle(id) {
  const reponse = await fetch(API_MB + encodeURIComponent(id) + "?inc=url-rels&fmt=json", { headers: { Accept: "application/json" } });
  if (!reponse.ok) throw new Error("MusicBrainz : code " + reponse.status);
  const relations = (await reponse.json()).relations || [];
  const adresse = (type) => (relations.find((r) => r.type === type && r.url) || { url: {} }).url.resource;
  const wikidata = (adresse("wikidata") || "").match(/Q\d+/);
  if (wikidata) {
    const parametres = new URLSearchParams({ action: "wbgetentities", ids: wikidata[0], props: "sitelinks/urls",
      sitefilter: "frwiki|enwiki", format: "json", origin: "*" });
    const reponseWd = await fetch(API_WIKIDATA + "?" + parametres);
    if (!reponseWd.ok) throw new Error("Wikidata : code " + reponseWd.status);
    const liensWd = (((await reponseWd.json()).entities || {})[wikidata[0]] || {}).sitelinks || {};
    for (const langue of ["fr", "en"]) {
      if (liensWd[langue + "wiki"]) return { url: liensWd[langue + "wiki"].url, langue };
    }
  }
  // Ancien type de lien : MusicBrainz pointe directement vers un article.
  const direct = adresse("wikipedia");
  if (direct) return { url: direct, langue: (direct.match(/^https?:\/\/(\w+)\./) || [, "?"])[1] };
  return { url: null };
}

// ---------------------------------------------------------------------------
// Onglet « Œuvres » : les œuvres MusicBrainz, par compositeur puis par catalogue
// ---------------------------------------------------------------------------

// Numéro de catalogue dans un titre MusicBrainz : « BWV 772 », « K. 475 », « op. 27 », « Hob. XVI:52 », « CD 82 »…
const RE_CATALOGUE = /\b(BuxWV|BWV|HWV|TWV|RV|KV|K|Hob|WoO|op|D|S|L|SV|Sz|BB|FP|CD|B|KK|Z|Wq|H)\.?\s*(?:[IVXL]+[a-z]?\s*:\s*)?(\d+)([a-z]?)/i;

// Réglages de l'onglet, gardés pendant la visite (retour depuis une page Œuvre).
// `categorie` : comme le filtre Catégorie de la Collection (« méta:Classique », un dossier, ou "" pour toutes).
const ongletOeuvres = { recherche: "", plusieurs: false, categorie: "méta:Classique", alphabetique: false, ouverts: new Set(),
  categoriesOuvertes: new Set() };   // « compositeur|catégorie » dépliés chez les compositeurs d'au moins SEUIL_CATEGORIES œuvres
const SEUIL_CATEGORIES = 12;   // à partir de ce nombre d'œuvres, un compositeur montre d'abord ses catégories, repliées

/** { type: "BWV", numero: 772, suffixe: "" } ou null. « KV » et « K » comptent comme un seul catalogue. */
function catalogueDe(titre) {
  const m = RE_CATALOGUE.exec(titre);
  if (!m) return null;
  const type = m[1].toUpperCase() === "KV" ? "K" : m[1].toUpperCase();
  return { type, numero: Number(m[2]), suffixe: m[3].toLowerCase() };
}

/**
 * Les œuvres de la collection, groupées par compositeur : [{ compositeur, oeuvres: [{ oeuvre, versions }] }].
 * Dans un compositeur, ordre du catalogue le plus fréquent chez lui (BWV chez Bach, op. chez Chopin),
 * puis des autres catalogues, puis les œuvres sans numéro, par titre.
 */
// Calculé une fois par collection (le regroupement compte les versions de chaque œuvre : ~0,3 s).
let groupesEnReserve = { editions: null, groupes: null };

/** Toutes les œuvres ; avec `classiques` (vrai ou faux), seulement les classiques ou seulement les autres. */
function oeuvresParCompositeur(classiques) {
  if (groupesEnReserve.editions !== editions) {
    groupesEnReserve = { editions, groupes: calculerOeuvresParCompositeur() };
  }
  const groupes = groupesEnReserve.groupes;
  if (classiques === undefined) return groupes;
  return groupes.map(({ compositeur, oeuvres }) => ({ compositeur, oeuvres: oeuvres.filter((o) => o.classique === classiques) }))
    .filter(({ oeuvres }) => oeuvres.length);
}

function calculerOeuvresParCompositeur() {
  const cotes = cotesClassiques().oeuvres;
  const parId = new Map();
  for (const edition of editions) {
    for (const oeuvre of edition.oeuvres.values()) {
      if (!parId.has(oeuvre.id)) parId.set(oeuvre.id, { oeuvre, editions: [] });
      parId.get(oeuvre.id).editions.push(edition);
    }
  }
  const parCompositeur = new Map();
  for (const { oeuvre, editions: liste } of parId.values()) {
    const nom = oeuvre.compositeur || "Compositeur inconnu";
    if (!parCompositeur.has(nom)) parCompositeur.set(nom, []);
    const versions = versionsDeLOeuvre(oeuvre, liste);
    // Texte où chercher : titre, compositeur et interprètes de toutes les versions (calculé une fois).
    const interpretes = [...new Set(versions.flatMap((v) => v.interpretes))];
    parCompositeur.get(nom).push({ oeuvre, editions: liste, versions: versions.length, catalogue: catalogueDe(oeuvre.titre),
      classique: cotes.get(oeuvre.id), categorieParLeNom: cotes.get(oeuvre.id) ? categorieParLeNom(oeuvre.titre) : null,
      texte: normaliser([oeuvre.titre, nom, ...interpretes].join(" ")) });
  }
  return [...parCompositeur].map(([compositeur, oeuvres]) => {
    const frequence = new Map();
    for (const { catalogue } of oeuvres) if (catalogue) frequence.set(catalogue.type, (frequence.get(catalogue.type) || 0) + 1);
    const rangs = [...frequence].sort((a, b) => b[1] - a[1]).map(([type]) => type);
    const rang = (c) => c ? rangs.indexOf(c.type) : rangs.length;
    oeuvres.sort((a, b) => rang(a.catalogue) - rang(b.catalogue)
      || (a.catalogue && b.catalogue ? a.catalogue.numero - b.catalogue.numero || a.catalogue.suffixe.localeCompare(b.catalogue.suffixe) : 0)
      || comparerTextes(a.oeuvre.titre, b.oeuvre.titre));
    return { compositeur, oeuvres };
  }).sort((a, b) => comparerTextes(cleDeTri(a.compositeur.split(",")[0], true), cleDeTri(b.compositeur.split(",")[0], true)));
}

function afficherOeuvres() {
  const recherche = creer("input", { type: "search", classe: "oeuvres-recherche", autocomplete: "off", value: ongletOeuvres.recherche,
    placeholder: "Ex. titre, compositeur, interprète, n° de catalogue…", "aria-label": "Rechercher une œuvre" });
  // Pendant la frappe, seule la liste est redessinée (le champ garde le curseur), après une pause.
  let minuterie = null;
  const lancer = () => { clearTimeout(minuterie); ongletOeuvres.recherche = recherche.value; afficherListeOeuvres(); };
  recherche.addEventListener("input", () => { clearTimeout(minuterie); minuterie = setTimeout(lancer, DELAI_RECHERCHE); });
  recherche.addEventListener("keydown", (e) => { if (e.key === "Enter") lancer(); });
  recherche.addEventListener("efface", lancer);
  const genre = menuCategoriesOeuvres();
  genre.addEventListener("change", () => { ongletOeuvres.categorie = genre.value; afficherListeOeuvres(); });
  const plusieurs = creer("input", { type: "checkbox", checked: ongletOeuvres.plusieurs });
  plusieurs.addEventListener("change", () => { ongletOeuvres.plusieurs = plusieurs.checked; afficherListeOeuvres(); });

  $("vue-oeuvres").replaceChildren(
    creer("div", { classe: "oeuvres-outils" },
      creer("span", { classe: "oeuvres-champ" }, ajouterCroix(recherche), boutonAide()), genre,
      creer("label", { classe: "case" }, plusieurs, " Au moins 2 versions")),
    creer("div", { id: "oeuvres-resultats" })
  );
  afficherListeOeuvres();
}

/** Vrai si l'édition est dans la catégorie choisie (« méta:Jazz », un dossier, ou "" pour toutes). */
function editionDansCategorie(edition, categorie) {
  if (!categorie) return true;
  return categorie.startsWith(PREFIXE_META) ? edition.metas.includes(categorie.slice(PREFIXE_META.length))
    : edition.categories.includes(categorie);
}

/** Menu « Catégorie » de l'onglet Œuvres : méta-catégories, puis leurs dossiers en retrait, avec le nombre d'œuvres. */
function menuCategoriesOeuvres() {
  const toutes = oeuvresParCompositeur().flatMap((g) => g.oeuvres);
  const compte = new Map();
  for (const { editions: liste, categorieParLeNom: parLeNom } of toutes) {
    const parLeNomCles = parLeNom ? [PREFIXE_META + metaDeCategorie(parLeNom), parLeNom] : [];
    for (const cle of new Set([...liste.flatMap((e) => [...e.metas.map((m) => PREFIXE_META + m), ...e.categories]), ...parLeNomCles])) {
      compte.set(cle, (compte.get(cle) || 0) + 1);
    }
  }
  const retrait = "\u00a0\u00a0\u00a0\u00a0";
  const option = (value, texte) => creer("option", { value, texte: texte + " (" + compte.get(value) + ")",
    selected: ongletOeuvres.categorie === value, classe: value.startsWith(PREFIXE_META) ? "option-meta" : null });
  const metas = [...compte.keys()].filter((c) => c.startsWith(PREFIXE_META)).map((c) => c.slice(PREFIXE_META.length));
  return creer("select", { "aria-label": "Catégorie" },
    creer("option", { value: "", selected: !ongletOeuvres.categorie, texte: "Toutes (" + toutes.length + ")" }),
    ...metas.sort(comparerTextes).flatMap((meta) => [
      option(PREFIXE_META + meta, meta),
      ...[...compte.keys()].filter((c) => !c.startsWith(PREFIXE_META) && metaDeCategorie(c) === meta).sort(comparerCategories)
        .map((c) => option(c, retrait + c)),
    ]));
}

// Règles simples sur le nom d'une œuvre classique, prioritaires sur la catégorie de ses disques : un concerto
// pour piano va dans « Piano et Orchestre » même si tous ses disques sont rangés dans « Piano Classique ».
// Volontairement étroites : « Sinfonia » (Bach, clavier), « piano » seul (sonate pour flûte et piano) ou
// « Lieder » (Lieder ohne Worte, pour piano) se tromperaient trop souvent. Titres sans accents, en minuscules.
// « sauf » : un motif qui écarte la règle (le violoncelle n'est pas le violon ; une fugue sur le Magnificat
// est pour orgue ; les Études symphoniques sont pour piano seul).
// La voix d'abord : un air pour soprano, piano et orchestre est une œuvre vocale. Pas « aria », « air » ni
// « chant » (Aria BWV 587 pour orgue, Airs à faire fuir de Satie, Chant de Linos pour flûte).
const REGLES_CATEGORIE_PAR_NOM = [
  { categorie: "Classique Voix", motifs: [/\b(soprano|mezzo|tenor|tenore|baritone?|bariton|voice|voices|voix|singstimme|recitati\w*)\b|airs chantes/] },
  { categorie: "Piano et Orchestre", motifs: [/\bconcert|\bconcierto/, /piano|klavier/] },
  { categorie: "Piano et Orchestre", motifs: [/piano (et|and|&) orchest|klavier und orchester/] },
  { categorie: "Violon", motifs: [/\bconcert|\bconcierto/, /violin|\bviolons?\b/] },
  { categorie: "Classique Orchestre", motifs: [/\bsymphon(y|ie|ies)\b|\bsinfonie\b/] },
  { categorie: "String quartet", motifs: [/string quartet|quatuor a cordes|streichquartett|quartetto per archi/] },
  { categorie: "Classique Voix", motifs: [/\bmass\b|\bmesse\b|\bmissa\b|requiem|\bcantat|\bkantate|magnificat|stabat mater|passion\b|oratori/],
    sauf: /\bfuga\b|meditations/ },
];

/** Catégorie d'une œuvre d'après son nom (voir REGLES_CATEGORIE_PAR_NOM), ou null. */
function categorieParLeNom(titre) {
  const texte = normaliser(titre);
  const regle = REGLES_CATEGORIE_PAR_NOM.find(({ motifs, sauf }) => motifs.every((motif) => motif.test(texte))
    && !(sauf && sauf.test(texte)));
  return regle ? regle.categorie : null;
}

/** Vrai si une catégorie (dossier) répond au choix du menu (« méta:Classique », un dossier, ou "" pour toutes). */
function categorieRepondAuChoix(c, categorie) {
  return editionDansCategorie({ metas: [metaDeCategorie(c)], categories: [c] }, categorie);
}

/**
 * Catégorie où ranger l'œuvre chez son compositeur : celle que donne son nom (voir REGLES_CATEGORIE_PAR_NOM),
 * sinon celle de la plupart de ses disques, parmi les catégories qui répondent au choix du menu
 * (à égalité : l'ordre habituel des catégories).
 */
function categorieDeLOeuvre(liste, categorie, parLeNom = null) {
  if (parLeNom && categorieRepondAuChoix(parLeNom, categorie)) return parLeNom;
  const compte = new Map();
  for (const edition of liste) {
    if (!editionDansCategorie(edition, categorie)) continue;
    for (const c of edition.categories) {
      if (categorie && !categorieRepondAuChoix(c, categorie)) continue;
      compte.set(c, (compte.get(c) || 0) + 1);
    }
  }
  return [...compte].sort((a, b) => b[1] - a[1] || comparerCategories(a[0], b[0]))[0]?.[0] || SANS_CATEGORIE;
}

/**
 * Œuvres d'un compositeur, sous un intertitre par catégorie. À partir de SEUIL_CATEGORIES œuvres,
 * chaque catégorie est un bloc repliable (déplié pendant une recherche).
 */
function listeOeuvresDuCompositeur(oeuvres, compositeur, cherche) {
  const ligne = ({ oeuvre, versions }) => creer("li", {},
    creer("button", { type: "button", classe: "index-nom", surclic: () => allerVers({ ...FILTRES_VIDES, oeuvre }) },
      oeuvre.titre,
      versions > 1 ? creer("span", { classe: "oeuvres-versions", texte: " · " + versions + " versions" }) : null));
  const parCategorie = new Map();
  for (const o of oeuvres) {
    const c = categorieDeLOeuvre(o.editions, ongletOeuvres.categorie, o.categorieParLeNom);
    if (!parCategorie.has(c)) parCategorie.set(c, []);
    parCategorie.get(c).push(o);   // l'ordre du catalogue est gardé dans chaque catégorie
  }
  const categories = [...parCategorie].sort((a, b) => comparerCategoriesParMeta(a[0], b[0]));
  if (oeuvres.length < SEUIL_CATEGORIES) {
    return categories.flatMap(([c, liste]) => [
      creer("p", { classe: "oeuvres-categorie", texte: c }),
      creer("ul", { classe: "oeuvres-liste" }, liste.map(ligne)),
    ]);
  }
  return categories.map(([c, liste]) => {
    const cle = compositeur + "|" + c;
    const bloc = creer("details", { classe: "oeuvres-bloc-categorie", open: cherche || ongletOeuvres.categoriesOuvertes.has(cle) },
      creer("summary", { classe: "oeuvres-categorie" }, c, creer("span", { classe: "discret", texte: " (" + liste.length + ")" })),
      creer("ul", { classe: "oeuvres-liste" }, liste.map(ligne)));
    bloc.addEventListener("toggle", () => {
      if (cherche) return;
      if (bloc.open) ongletOeuvres.categoriesOuvertes.add(cle); else ongletOeuvres.categoriesOuvertes.delete(cle);
    });
    return bloc;
  });
}

/** Compte et compositeurs de l'onglet Œuvres, d'après la recherche et les réglages. */
function afficherListeOeuvres() {
  const groupes = oeuvresParCompositeur();
  const cherche = arbreDe(ongletOeuvres.recherche) !== null;
  const garde = ({ versions, texte, editions: liste, categorieParLeNom: parLeNom }) => (!ongletOeuvres.plusieurs || versions > 1)
    && (!ongletOeuvres.categorie || liste.some((e) => editionDansCategorie(e, ongletOeuvres.categorie))
      || (parLeNom && categorieRepondAuChoix(parLeNom, ongletOeuvres.categorie)))
    && (!cherche || rechercheTrouvee(texte, ongletOeuvres.recherche));
  const visibles = groupes.map(({ compositeur, oeuvres }) => ({ compositeur, oeuvres: oeuvres.filter(garde) }))
    .filter(({ oeuvres }) => oeuvres.length);
  // Par défaut, les compositeurs les plus représentés d'abord (à égalité : ordre alphabétique, celui des groupes).
  if (!ongletOeuvres.alphabetique) visibles.sort((a, b) => b.oeuvres.length - a.oeuvres.length);
  const nbOeuvres = visibles.reduce((total, g) => total + g.oeuvres.length, 0);

  $("oeuvres-resultats").replaceChildren(
    creer("p", { classe: "oeuvres-compte discret", texte: pluriel(nbOeuvres, "œuvre") + " · " + pluriel(visibles.length, "compositeur")
 }),
    creer("p", { classe: "oeuvres-tri discret" }, "Compositeurs : ",
      ...[[false, "par nombre d'œuvres"], [true, "alphabétique"]].flatMap(([alpha, texte], i) => [i ? " · " : "",
        ongletOeuvres.alphabetique === alpha ? creer("span", { classe: "tri-actif", texte })
          : creer("button", { type: "button", classe: "bouton-texte", texte,
              surclic: () => { ongletOeuvres.alphabetique = alpha; afficherListeOeuvres(); } })])),
    creer("p", { classe: "oeuvres-explication discret",
      texte: "Une œuvre est placée dans la catégorie de la majorité de ses disques, sauf quand son nom la désigne (voix, concerto pour piano ou pour violon, symphonie, quatuor à cordes, messe, cantate…). Sur sa page, chaque version porte la catégorie de son disque." }),
    ...(nbOeuvres ? [] : [creer("p", { classe: "discret", texte: "Aucune œuvre ne correspond." })]),
    ...visibles.map(({ compositeur, oeuvres }) => {
      // Ouvert si l'on cherche quelque chose, ou si on l'avait ouvert (retour depuis une page Œuvre).
      const bloc = creer("details", { classe: "oeuvres-compositeur", open: cherche || ongletOeuvres.ouverts.has(compositeur) },
        creer("summary", {}, compositeur, creer("span", { classe: "discret", texte: " (" + oeuvres.length + ")" })),
        ...listeOeuvresDuCompositeur(oeuvres, compositeur, cherche));
      bloc.addEventListener("toggle", () => {
        if (cherche) return;
        if (bloc.open) ongletOeuvres.ouverts.add(compositeur); else ongletOeuvres.ouverts.delete(compositeur);
      });
      return bloc;
    })
  );
}

/** Catégories à afficher : on ne montre pas « Sans catégorie » sur les vignettes et la fiche. */
function categoriesChoisies(edition) {
  return edition.categories.filter((c) => c !== SANS_CATEGORIE);
}

/** Ordre des catégories dans la vue Collection : par méta-catégorie (alphabétique), puis comme comparerCategories. */
function comparerCategoriesParMeta(a, b) {
  return comparerTextes(metaDeCategorie(a), metaDeCategorie(b)) || comparerCategories(a, b);
}

/**
 * Boutons « Tout · Chanson · Classique… » en haut de la vue Collection. Ils règlent le filtre
 * Catégorie sur une méta-catégorie (comme la liste des filtres) ; un clic sur le bouton actif revient à « Tout ».
 */
function boutonsMetas() {
  const metas = [...new Set(editions.flatMap((e) => e.metas))].sort(comparerTextes);
  if (metas.length < 2) return null;
  const choisir = (valeur) => {
    etat.categorie = etat.categorie === valeur ? "" : valeur;
    ecrireControles();
    afficher();
    window.scrollTo({ top: 0 });
  };
  return creer("nav", { classe: "boutons-metas", "aria-label": "Méta-catégories" },
    creer("button", { type: "button", classe: "bouton-meta" + (etat.categorie ? "" : " actif"), texte: "Tout",
      surclic: () => choisir("") }),
    metas.map((meta) => creer("button", { type: "button",
      classe: "bouton-meta" + (etat.categorie === PREFIXE_META + meta ? " actif" : ""), texte: meta,
      surclic: () => choisir(PREFIXE_META + meta) })));
}

/**
 * Vignettes regroupées par catégorie (dossier Discogs), elles-mêmes rangées par méta-catégorie
 * (ordre alphabétique), avec le nom de la méta-catégorie au-dessus de ses catégories. Dans une
 * méta-catégorie, ordre de comparerCategories (« Sans catégorie » puis « À Vendre » à la fin).
 * Dans chaque groupe, les disques gardent l'ordre du tri choisi. Une édition dont les
 * exemplaires sont rangés dans deux dossiers apparaît dans les deux.
 */
function afficherGrille(liste) {
  const parCategorie = new Map();
  const parMeta = new Map();   // méta-catégorie -> éditions (sans doublon)
  for (const edition of liste) {
    for (const categorie of edition.categories) {
      if (!parCategorie.has(categorie)) parCategorie.set(categorie, []);
      parCategorie.get(categorie).push(edition);
      const meta = metaDeCategorie(categorie);
      if (!parMeta.has(meta)) parMeta.set(meta, new Set());
      parMeta.get(meta).add(edition);
    }
  }
  const categories = [...parCategorie.keys()].sort(comparerCategoriesParMeta);
  const metas = [...parMeta.keys()].sort(comparerTextes);
  const groupes = categories.map(() => creer("section", { classe: "groupe-categorie" }));
  const titresMetas = new Map(metas.map((meta) => [meta,
    creer("h2", { classe: "titre-meta" }, meta, creer("span", { classe: "discret", texte: " (" + parMeta.get(meta).size + ")" }))]));
  const allerA = (element) => element.scrollIntoView({ behavior: "smooth", block: "start" });
  const allerAuGroupe = (numero) => allerA(groupes[numero]);
  const nombre = (n) => creer("span", { classe: "discret", texte: " (" + n + ")" });

  // Sommaire à deux niveaux (s'il y a plusieurs catégories) : une ligne par méta-catégorie, puis ses catégories.
  // Un clic descend jusqu'à la méta-catégorie ou jusqu'à la catégorie.
  const sommaire = categories.length > 1 ? creer("nav", { classe: "sommaire-categories", "aria-label": "Catégories" },
    metas.map((meta) => {
      const siennes = categories.filter((c) => metaDeCategorie(c) === meta);
      return creer("p", { classe: "sommaire-meta" },
        creer("button", { type: "button", classe: "bouton-texte sommaire-nom-meta", surclic: () => allerA(titresMetas.get(meta)) },
          meta, nombre(parMeta.get(meta).size)),
        creer("span", { classe: "index-separateur", texte: " : " }),
        // Le point de séparation suit le nom, pour qu'une ligne ne commence jamais par « · ».
        siennes.map((categorie, rang) => [
          creer("span", { classe: "sommaire-element" },
            creer("button", { type: "button", classe: "bouton-texte", surclic: () => allerAuGroupe(categories.indexOf(categorie)) },
              categorie, nombre(parCategorie.get(categorie).length)),
            rang < siennes.length - 1 ? creer("span", { classe: "index-separateur", texte: " ·" }) : null),
          " ",
        ]));
    })) : null;

  groupes.forEach((groupe, numero) => groupe.append(
    // Titre qui reste en haut de l'écran pendant qu'on fait défiler les vignettes de la catégorie.
    creer("h3", { classe: "titre-categorie" },
      categories[numero],
      nombre(parCategorie.get(categories[numero]).length),
      // Rappel du tri choisi : le titre reste en haut de l'écran pendant le défilement.
      creer("span", { classe: "tri-categorie", texte: "· tri par " + libelleDuTri() }),
      categories.length > 1 ? creer("span", { classe: "navigation-categories" },
        creer("button", { type: "button", classe: "bouton-texte", texte: "↑ Haut", surclic: () => window.scrollTo({ top: 0, behavior: "smooth" }) }),
        numero < groupes.length - 1
          ? creer("button", { type: "button", classe: "bouton-texte", texte: "↓ Suivante", surclic: () => allerAuGroupe(numero + 1) })
          : null,
        numero > 0
          ? creer("button", { type: "button", classe: "bouton-texte", texte: "↑ Précédente", surclic: () => allerAuGroupe(numero - 1) })
          : null
      ) : null
    ),
    creer("div", { classe: "grille" }, cartesAvecIntertitre(parCategorie.get(categories[numero])))
  ));

  // Nom de la méta-catégorie juste avant sa première catégorie.
  const contenu = [];
  categories.forEach((categorie, numero) => {
    const meta = metaDeCategorie(categorie);
    if (numero === 0 || metaDeCategorie(categories[numero - 1]) !== meta) contenu.push(titresMetas.get(meta));
    contenu.push(groupes[numero]);
  });
  $("vue-collection").replaceChildren(boutonsMetas() || "", sommaire || "", ...contenu);
}

/** Libellé du tri choisi, en minuscule : « année d'enregistrement ». */
function libelleDuTri() {
  const option = $("tri").selectedOptions[0];
  const texte = option ? option.textContent : "";
  return texte.charAt(0).toLowerCase() + texte.slice(1);
}

/** Hauteur de l'en-tête collant, pour placer les titres de catégorie juste en dessous. */
function noterHauteurEntete() {
  document.documentElement.style.setProperty("--hauteur-entete", document.querySelector(".entete").offsetHeight + "px");
}

/**
 * Vignettes de la vue Collection : valeur du tri au-dessus de chaque photo, et intertitre
 * « Sans … (N) » sur toute la largeur avant les éditions qui n'ont pas cette valeur (rangées à la fin).
 */
function cartesAvecIntertitre(liste) {
  const infos = INFOS_DE_TRI[etat.tri] || {};
  const cartes = cartesDesEditions(liste, infos.valeur);
  const premierManquant = infos.manque ? liste.findIndex(infos.manque) : -1;
  if (premierManquant < 0) return cartes;
  const intertitre = creer("h3", { classe: "intertitre-tri",
    texte: infos.sans + " (" + (liste.length - premierManquant) + ")" });
  return [...cartes.slice(0, premierManquant), intertitre, ...cartes.slice(premierManquant)];
}

/** `valeurDeTri` (facultatif) : texte écrit au-dessus de la photo (rien si l'édition n'en a pas). */
// Vignettes déjà construites, réutilisées d'un affichage à l'autre : pendant la frappe d'une recherche,
// le navigateur n'a pas à recréer (et redécoder) des centaines d'images. Clé : ce qui change sur la vignette.
let cartesEnReserve = new WeakMap();   // édition -> Map(clé -> élément)
let tourDAffichage = 0;                 // une vignette déjà placée dans ce tour est recréée (édition dans deux catégories)

function cartesDesEditions(liste, valeurDeTri) {
  return liste.map((edition) => {
    const cle = [valeurDeTri ? valeurDeTri(edition) : "", edition.statut || "", aDesTextes(edition),
      edition.exemplaires.length, categoriesChoisies(edition).join("|"), edition.pochette || edition.miniature || ""].join("\u0001");
    if (!cartesEnReserve.has(edition)) cartesEnReserve.set(edition, new Map());
    const reserve = cartesEnReserve.get(edition);
    const carte = reserve.get(cle);
    if (carte && carte.tour !== tourDAffichage) { carte.tour = tourDAffichage; return carte; }
    const nouvelle = carteDeLEdition(edition, valeurDeTri);
    nouvelle.tour = tourDAffichage;
    if (!carte) reserve.set(cle, nouvelle);
    return nouvelle;
  });
}

/** Une vignette : pochette, repères, titre, artistes, catégories. */
function carteDeLEdition(edition, valeurDeTri) {
  const image = edition.pochette || edition.miniature;
  const nb = edition.exemplaires.length;
  const categories = categoriesChoisies(edition);
  return creer("button", { classe: "carte", type: "button", surclic: () => ouvrirFiche(edition) },
    // Pas de ligne pour une édition sans valeur : elles sont toutes sous l'intertitre « Sans … ».
    valeurDeTri && valeurDeTri(edition) ? creer("p", { classe: "carte-tri", texte: valeurDeTri(edition) }) : null,
    creer("div", { classe: "pochette" },
      image
        ? creer("img", { src: image, alt: "", loading: "lazy", decoding: "async" })
        : creer("span", { classe: "sans-image", texte: "♪" }),
      nb > 1 ? creer("span", { classe: "badge", texte: "×" + nb, title: nb + " exemplaires" }) : null,
      aDesTextes(edition) ? creer("span", { classe: "repere-notes", texte: "✎", title: "Description ou notes personnelles" }) : null,
      edition.statut ? creer("span", { classe: "repere-statut", texte: repereStatut(edition.statut) || edition.statut,
        title: edition.statut }) : null
    ),
    creer("p", { classe: "carte-titre", texte: edition.titre }),
    creer("p", { classe: "carte-artiste", texte: (edition.artistes_principaux || []).join(", ") }),
    categories.length ? creer("p", { classe: "carte-categorie", texte: categories.join(" · ") }) : null
  );
}

// ---------------------------------------------------------------------------
// Au hasard : quelques éditions tirées au sort
// ---------------------------------------------------------------------------

const NOMBRE_MINIMUM = 9;        // au moins 9 disques (carré 3 × 3 sur iPhone), en rangées complètes
const NOMBRE_PREPARE = 40;       // vignettes préparées (plus qu'une rangée sur le plus grand écran)
const LIEN_FISHER_YATES = "https://fr.wikipedia.org/wiki/M%C3%A9lange_de_Fisher-Yates";

let tirage = null;   // éditions mélangées ; null = à tirer de nouveau (à chaque clic sur l'onglet)
let tirageOeuvres = null;   // { classiques, autres } : NOMBRE_OEUVRES œuvres de chaque sorte, tirées en même temps
const NOMBRE_OEUVRES = 10;

/**
 * Mélange de Fisher-Yates : renvoie une copie de la liste dans un ordre au hasard,
 * chaque ordre ayant exactement la même chance de sortir.
 * On part de la fin : pour chaque place i, on tire au sort une place j entre 0 et i
 * (i compris) et on échange les deux disques. La partie après i est déjà mélangée.
 */
function melanger(liste) {
  const copie = [...liste];
  for (let i = copie.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));   // entier au hasard de 0 à i
    [copie[i], copie[j]] = [copie[j], copie[i]];      // échange des deux disques
  }
  return copie;
}

/** Une édition est « à vendre » quand tous ses exemplaires sont dans le dossier « À Vendre ». */
function estAVendre(edition) {
  return edition.categories.every((c) => normaliser(c) === normaliser(CATEGORIE_A_VENDRE));
}

/**
 * Nombre de disques à montrer : des rangées complètes, et au moins NOMBRE_MINIMUM.
 * 3 par rangée (iPhone) → 9 ; 4 → 12 ; 5 → 10 ; 6 → 12 ; 7 → 14 ; 9 → 9 ; 12 → 12.
 */
function nombreAMontrer(colonnes) {
  return colonnes * Math.ceil(NOMBRE_MINIMUM / colonnes);
}

/** Montre juste assez de vignettes pour remplir les rangées de la grille (appelé aussi quand la fenêtre change de taille). */
function ajusterHasard() {
  const grille = document.querySelector("#vue-hasard .grille");
  if (!grille || $("vue-hasard").hidden) return;
  // La feuille de style décide du nombre de colonnes selon la largeur : on le relit.
  const colonnes = getComputedStyle(grille).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
  const nombre = nombreAMontrer(colonnes);
  [...grille.children].forEach((carte, rang) => { carte.hidden = rang >= nombre; });
}

function afficherHasard() {
  if (!tirage) {
    tirage = melanger(editions.filter((e) => !estAVendre(e))).slice(0, NOMBRE_PREPARE);
    // Œuvres présentes sur au moins un disque qui n'est pas à vendre.
    const tirer = (classiques) => melanger(oeuvresParCompositeur(classiques).flatMap((g) => g.oeuvres)
      .filter((o) => !o.editions.every(estAVendre))).slice(0, NOMBRE_OEUVRES);
    tirageOeuvres = { classiques: tirer(true), autres: tirer(false) };
  }
  const listeOeuvres = (titre, oeuvres) => creer("section", { classe: "hasard-oeuvres-bloc" },
    creer("h3", { texte: titre }),
    creer("ul", { classe: "hasard-oeuvres-liste" }, oeuvres.map(({ oeuvre, versions }) => creer("li", {},
      creer("button", { type: "button", classe: "index-nom", surclic: () => allerVers({ ...FILTRES_VIDES, oeuvre }) },
        oeuvre.titre,
        creer("span", { classe: "discret", texte: " · " + (oeuvre.compositeur || "Compositeur inconnu") }),
        versions > 1 ? creer("span", { classe: "oeuvres-versions", texte: " · " + versions + " versions" }) : null)))));
  $("vue-hasard").replaceChildren(
    creer("p", { classe: "hasard-haut" },
      creer("button", { type: "button", classe: "bouton", texte: "Nouveau tirage",
        surclic: () => { tirage = null; afficher(); } })),
    creer("div", { classe: "grille" }, cartesDesEditions(tirage)),
    creer("div", { classe: "hasard-oeuvres" },
      listeOeuvres(NOMBRE_OEUVRES + " œuvres classiques", tirageOeuvres.classiques),
      listeOeuvres(NOMBRE_OEUVRES + " autres œuvres", tirageOeuvres.autres)),
    creer("hr", { classe: "hasard-trait" }),
    creer("p", { classe: "hasard-methode" },
      "Tirage réalisé par la méthode de ",
      creer("a", { href: LIEN_FISHER_YATES, target: "_blank", rel: "noopener", texte: "Fisher-Yates" }))
  );
  ajusterHasard();
}

// ---------------------------------------------------------------------------
// Fiche détaillée
// ---------------------------------------------------------------------------

/** Fait défiler la fiche jusqu'à cet élément, en douceur. */
function defilerFicheVers(element) {
  if (element) element.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Fiche ouverte depuis la page d'une œuvre : on descend jusqu'à cette plage (ou jusqu'à l'œuvre en mouvements
 * qui la contient) et on la surligne un instant.
 */
function montrerPlageDansLaFiche(position) {
  const plage = [...$("fiche").querySelectorAll("li[data-position]")].find((li) => li.dataset.position === position);
  if (!plage) return;
  const cible = plage.parentElement.closest("li.plage-oeuvre") || plage;
  cible.scrollIntoView({ block: "center" });
  cible.classList.add("plage-montree");
  setTimeout(() => cible.classList.remove("plage-montree"), 2500);
}

/** Clic sur un nom dans une fiche : on lance la recherche sur ce nom, dans ce rôle. */
function chercherNom(nom, role) {
  Object.assign(etat, { recherche: nom, role, vue: "collection" });
  ecrireControles();
  $("fiche").close();
  afficher();
  window.scrollTo({ top: 0 });
}

/**
 * Vignettes d'une source de photos : les VIGNETTES_VISIBLES premières, puis un lien
 * « Voir les N photos restantes » pour déplier les autres (les coffrets en ont parfois des centaines).
 * Les vignettes repliées sont seulement cachées : la visionneuse les parcourt toujours.
 */
// Jusqu'à 5 photos en tout (une ligne sur iPhone), MusicBrainz et Discogs sont côte à côte.
const PHOTOS_SUR_UNE_LIGNE = 5;

function vignettesRepliables(boutons) {
  const bloc = creer("div", { classe: "vignettes" }, boutons);
  let visibles = VIGNETTES_VISIBLES;
  let deroule = false;
  const texte = () => deroule ? "Replier" : "Voir les " + (boutons.length - visibles) + " photos restantes";
  const lien = creer("button", { type: "button", classe: "bouton-texte voir-plus",
    surclic: () => { deroule = !deroule; montrer(); } });
  const montrer = () => {
    boutons.forEach((b, numero) => { b.hidden = !deroule && numero >= visibles; });
    lien.hidden = boutons.length <= visibles;
    lien.textContent = texte();
  };
  // Sur téléphone, une seule rangée par source : autant de vignettes que la largeur en laisse passer.
  // Appelé une fois la fiche affichée (il faut connaître la largeur).
  bloc.ajuster = () => {
    if (!window.matchMedia("(max-width: 700px)").matches || !boutons.length) return;
    const largeurVignette = boutons[0].getBoundingClientRect().width + 6;   // vignette + écart (6 px)
    visibles = Math.max(1, Math.floor((bloc.clientWidth + 6) / largeurVignette));
    montrer();
  };
  montrer();
  return [bloc, lien];
}

/**
 * Bloc des photos de la fiche : la grande photo, puis les miniatures par source.
 * MusicBrainz d'abord (souvent en meilleure définition), sauf si « Photo principale » vaut « Discogs ».
 */
function blocPhotos(edition) {
  // Images : celles de la fiche complète, sinon la pochette seule.
  const toutes = (edition.images && edition.images.length)
    ? edition.images
    : [{ url: edition.pochette, miniature: edition.miniature }].filter((i) => i.url);
  const deMusicBrainz = toutes.filter((image) => image.type === "musicbrainz");
  const deDiscogs = toutes.filter((image) => image.type !== "musicbrainz");
  const images = edition.photoDiscogs && deDiscogs.length ? [...deDiscogs, ...deMusicBrainz] : [...deMusicBrainz, ...deDiscogs];

  // Un clic sur la grande image l'ouvre en plein écran, sur l'image affichée.
  let numeroAffiche = 0;
  const grande = images.length ? creer("img", {
    classe: "grande", src: images[0].url, alt: "Pochette", title: "Agrandir",
    surclic: () => ouvrirVisionneuse(images, numeroAffiche),
  }) : null;
  const vignette = (image, numero) => creer("button", {
    type: "button", classe: numero === 0 ? "actif" : null, "aria-label": "Image " + (numero + 1),
    surclic: (evenement) => {
      grande.src = image.url;
      numeroAffiche = numero;
      evenement.currentTarget.closest(".fiche-images").querySelectorAll(".vignettes button").forEach((b) => b.classList.remove("actif"));
      evenement.currentTarget.classList.add("actif");
    },
  }, creer("img", { src: image.miniature || image.url, alt: "", loading: "lazy" }));

  // Les images par source, chacune avec sa légende, dans l'ordre de la grande photo.
  // Une seule image en tout : pas de miniatures, juste la légende sous la grande image.
  const sources = [
    ["MusicBrainz", images.map((image, numero) => [image, numero]).filter(([image]) => image.type === "musicbrainz")],
    ["Discogs", images.map((image, numero) => [image, numero]).filter(([image]) => image.type !== "musicbrainz")],
  ].filter(([, liste]) => liste.length);
  if (images.length && images[0].type !== "musicbrainz") sources.reverse();
  // Peu de photos (PHOTOS_SUR_UNE_LIGNE au plus, toutes sources) : les deux groupes côte à côte, sur une ligne,
  // avec une légende courte (« MusicBrainz », « Discogs ») qui ne force pas la largeur du groupe.
  const surUneLigne = sources.length > 1 && images.length <= PHOTOS_SUR_UNE_LIGNE;
  const groupesImages = sources.map(([source, liste]) => creer("div", { classe: "groupe-photos" },
    creer("p", { classe: "legende-photos", texte: (surUneLigne ? "" : "photos ") + source }),
    images.length > 1 ? vignettesRepliables(liste.map(([image, numero]) => vignette(image, numero))) : null,
  ));
  return creer("div", { classe: "fiche-images" }, grande,
    creer("div", { classe: surUneLigne ? "groupes-photos sur-une-ligne" : "groupes-photos" }, groupesImages));
}

/** Vrai si l'édition a des photos des deux sources : le choix de la grande photo a alors un sens. */
function aDeuxSourcesDePhotos(edition) {
  const images = edition.images || [];
  return images.some((i) => i.type === "musicbrainz") && images.some((i) => i.type !== "musicbrainz");
}

function ouvrirFiche(edition, { position = null } = {}) {

  const informations = [
    ["Catégorie", categoriesChoisies(edition).join(" · ")],
    ...anneesEnregistrement(edition),
    ["Live / Studio", edition.enregistrement === NON_PRECISE ? "" : edition.enregistrement],
    ["Label", (edition.labels || []).map((l) => l.nom + (l.catno ? " – " + l.catno : "")).join(" ; ")],
    ["Année de parution", edition.annee || "inconnue"],
    ["Format", decrireFormatsFiche(edition.formats)],
    ["Durée", texteDuree(dureeTotale(edition.plages || []))],
    ["Genres", (edition.genres || []).join(", ")],
    ["Styles", (edition.styles || []).join(", ")],
    [(edition.codes_barres || []).length > 1 ? "Codes-barres" : "Code-barre", (edition.codes_barres || []).join(", ")],
  ].filter(([, valeur]) => valeur);

  // Les noms les plus présents sur les plages d'abord ; une seule ligne affichée, « Voir les N » pour le reste.
  const sectionPersonnes = ({ cle, libelle }) => [
      creer("h3", { texte: libelle }),
      nomsSurUneLigne(parPresence(edition, edition[cle]).map((nom) => creer("button", {
          type: "button", classe: "nom", texte: nom, title: "Chercher " + nom + " (" + libelle.toLowerCase() + ")",
          surclic: () => chercherNom(nom, cle),
        }))
      ),
    ];
  const presentes = CATEGORIES_PERSONNES.filter(({ cle }) => (edition[cle] || []).length);
  const sectionsPersonnes = presentes.filter(({ cle }) => CREDITS_VISIBLES.includes(cle)).map(sectionPersonnes);
  // Les autres crédits (producteurs, ingénieurs du son…) sont repliés sous un lien.
  const autresCategories = presentes.filter(({ cle }) => !CREDITS_VISIBLES.includes(cle));
  const autresCredits = autresCategories.length
    ? repliable("Voir les autres crédits (" + autresCategories.reduce((n, { cle }) => n + edition[cle].length, 0) + ")",
      autresCategories.map(sectionPersonnes),
      // Déjà ouvert si l'on arrive en cherchant dans un de ces rôles.
      Boolean(etat.recherche) && autresCategories.some(({ cle }) => cle === etat.role))
    : null;

  // Texte « Notes » de la fiche Discogs (souvent un vrai livret : lieux, dates, musiciens), replié.
  const notesDiscogs = edition.notes_discogs
    ? repliable("Voir les notes Discogs", creer("div", { classe: "notes-perso cadre notes-discogs" },
      texteAvecLiens(nettoyerNotesDiscogs(edition.notes_discogs))), false, "Replier les notes Discogs")
    : null;

  // Ma note (la première donnée, si j'ai plusieurs exemplaires) et celle des membres de Discogs.
  const maNote = edition.exemplaires.map((e) => e.note).find(Boolean);
  const communaute = edition.note_communaute;
  const notes = [
    maNote ? "Ma note " + etoiles(maNote) : null,
    communaute ? "Communauté Discogs " + communaute.moyenne.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + "/5 ("
      + pluriel(communaute.votes, "vote") + ")" : null,
  ].filter(Boolean);

  const liens = valeursDuChamp(edition, CHAMP_LIENS).flatMap(lireLiensExternes);

  // Les champs qui ont leur propre place dans la fiche ne sont pas répétés dans « Mon exemplaire ».
  const champsAPart = [CHAMP_LOCALISATION, CHAMP_DESCRIPTION, CHAMP_NOTES_PERSO, CHAMP_LIENS, CHAMP_FAVORIS,
    CHAMP_STATUT, CHAMP_LIVE, CHAMP_ANNEE_MANUELLE, CHAMP_PHOTO];
  const exemplaires = edition.exemplaires.map((exemplaire, numero) => {
    const autresChamps = Object.entries(exemplaire.champs).filter(([nom]) => !champsAPart.some((c) => memeNom(c, nom)));
    return creer("li", {},
      creer("strong", { texte: exemplaire.champs[CHAMP_LOCALISATION] || "Localisation non renseignée" }),
      edition.exemplaires.length > 1 ? creer("span", { classe: "discret", texte: "  (exemplaire " + (numero + 1) + ")" }) : null,
      autresChamps.map(([nom, valeur]) => creer("div", {}, creer("span", { classe: "discret", texte: nom + " : " }), texteAvecLiens(valeur))),
      exemplaire.date_ajout ? creer("div", { classe: "discret", texte: "Ajouté le " + formaterDate(exemplaire.date_ajout) }) : null,
      exemplaire.modifie_le ? creer("div", { classe: "discret", texte: "Modifié ici le " + formaterDate(exemplaire.modifie_le)
        + " : visible sur les autres appareils après la synchro de la nuit" }) : null
    );
  });

  // Plages, avec un intertitre et un lien par disque pour un coffret.
  const titrePlages = creer("h3", { texte: "Plages" });
  const tracklist = listePlagesParDisque(edition.plages || [], { precedente: null, edition });

  // Recherche dans la fiche : pré-remplie avec la recherche de la collection.
  const champRecherche = creer("input", { type: "search", classe: "recherche-fiche", placeholder: "Chercher (ET, OU, SAUF…)",
    "aria-label": "Chercher dans la fiche", value: etat.recherche, autocomplete: "off" });
  const caseRecherche = ajouterCroix(champRecherche);
  const resultats = creer("span", { classe: "discret resultats-fiche" });

  const texteFiche = creer("div", {},
    creer("h2", { id: "fiche-titre", texte: edition.titre }),
    creer("p", { classe: "sous-titre" },
      (edition.artistes_principaux || []).map((nom, i) => [
        i ? ", " : "",
        creer("button", { type: "button", classe: "bouton-texte", texte: nom, surclic: () => chercherNom(nom, "artistes_principaux") }),
      ])
    ),
    creer("p", { classe: "ligne-recherche-fiche" }, caseRecherche, boutonAide(), resultats,
      (edition.plages || []).length ? creer("button", { type: "button", classe: "bouton-texte lien-fiche lien-plages",
        texte: "↓ Plages", surclic: () => defilerFicheVers(titrePlages) }) : null,
      creer("button", { type: "button", classe: "bouton-texte lien-fiche", texte: "↓ Fin",
        surclic: () => $("fiche").scrollTo({ top: $("fiche").scrollHeight, behavior: "smooth" }) })),
    notes.length ? creer("p", { classe: "notes-album", texte: notes.join("  ·  ") }) : null,
    // Boutons visibles seulement sur un appareil où le jeton Discogs est enregistré.
    jeton() ? creer("p", { classe: "boutons-fiche" }, boutonsStatut(edition),
      creer("button", { type: "button", classe: "bouton-texte lien-fiche lien-modifier", texte: "✎ Modifier mes Custom Fields Discogs",
        surclic: () => ouvrirEdition(edition) }))
      : edition.statut ? creer("p", {}, creer("span", { classe: "etiquette-statut", texte: libelleStatut(edition.statut) })) : null,
    creer("dl", {}, informations.map(([terme, valeur]) => [creer("dt", { texte: terme }), creer("dd", { texte: valeur })])),
    edition.descriptions.length ? [
      creer("h3", { texte: "Description" }),
      edition.descriptions.map((texte) => creer("div", { classe: "notes-perso cadre" }, texteAvecLiens(texte))),
    ] : null,
    edition.notesPerso.length ? [
      creer("h3", { texte: "Notes personnelles" }),
      edition.notesPerso.map((texte) => creer("div", { classe: "notes-perso cadre" }, texteAvecLiens(texte))),
    ] : null,
    liens.length ? [
      creer("h3", { texte: "Liens externes" }),
      creer("ul", { classe: "liens-externes" }, liens.map((l) => creer("li", {}, creerLien(l.adresse, l.nom + " ↗")))),
    ] : null,
    sectionsPersonnes,
    autresCredits ? autresCredits.element : null,
    creer("h3", { texte: edition.exemplaires.length > 1 ? "Mes exemplaires" : "Mon exemplaire" }),
    creer("ul", { classe: "exemplaires" }, exemplaires),
    (edition.plages || []).length ? [
      titrePlages,
      tracklist.disques.length ? creer("p", { classe: "liens-disques" }, tracklist.disques.map((disque, numero) => [
        numero ? creer("span", { classe: "discret", texte: " · " }) : null,
        creer("button", { type: "button", classe: "bouton-texte lien-fiche", texte: disque,
          surclic: () => defilerFicheVers(tracklist.liste.querySelector('[data-disque="' + disque + '"]')) }),
      ])) : null,
      tracklist.liste,
    ] : null,
    notesDiscogs ? notesDiscogs.element : null,
    creer("p", { classe: "liens-bases" },
      creer("a", { classe: "lien-discogs", href: edition.url_discogs, target: "_blank", rel: "noopener", texte: "Voir sur Discogs ↗" }),
      edition.musicbrainz ? creer("a", { classe: "lien-discogs", href: edition.musicbrainz, target: "_blank", rel: "noopener",
        texte: "Voir sur MusicBrainz ↗" }) : null
    ),
    blocSources(edition),
    jeton() && aDeuxSourcesDePhotos(edition) ? creer("p", { classe: "boutons-fiche" }, interrupteurPhoto(edition)) : null,
    creer("p", { classe: "fin-fiche" },
      creer("button", { type: "button", classe: "bouton-texte lien-fiche", texte: "↑ Début",
        surclic: () => $("fiche").scrollTo({ top: 0, behavior: "smooth" }) }))
  );

  $("fiche-contenu").replaceChildren(
    creer("div", { classe: "fiche-corps" },
      blocPhotos(edition),
      texteFiche
    )
  );
  $("fiche").showModal();
  $("fiche").scrollTop = 0;
  if (position) montrerPlageDansLaFiche(position);
  document.querySelectorAll("#fiche .vignettes").forEach((bloc) => bloc.ajuster && bloc.ajuster());
  ajusterNoms($("fiche"));
  // Autres crédits dépliés : leurs rubriques se mesurent à ce moment-là.
  if (autresCredits) autresCredits.element.firstChild.addEventListener("click", () => ajusterNoms(autresCredits.contenu));

  let minuterie = null;
  let numeroResultat = 0;
  const chercher = () => {
    const nombre = surligner(texteFiche, champRecherche.value);
    // Un nom trouvé dans les crédits repliés : on les ouvre pour le montrer.
    if (autresCredits && autresCredits.contenu.querySelector("mark.trouve")) {
      autresCredits.ouvrir();
      ajusterNoms(autresCredits.contenu);
    }
    // Un nom trouvé dans une rubrique limitée à une ligne : on la déplie.
    texteFiche.querySelectorAll(".noms-ligne").forEach((bloc) => {
      if (bloc.querySelector("mark.trouve") && bloc.ouvrir) bloc.ouvrir();
    });
    if (notesDiscogs && notesDiscogs.contenu.querySelector("mark.trouve")) notesDiscogs.ouvrir();
    numeroResultat = 0;
    resultats.textContent = !champRecherche.value.trim() ? ""
      : nombre ? nombre + (nombre > 1 ? " résultats" : " résultat") : "Aucun résultat";
    resultats.classList.toggle("avec-resultats", nombre > 0);
    allerAuResultat(texteFiche, 0);
  };
  champRecherche.addEventListener("input", () => { clearTimeout(minuterie); minuterie = setTimeout(chercher, DELAI_RECHERCHE); });
  // Entrée : résultat suivant (et retour au premier après le dernier).
  champRecherche.addEventListener("keydown", (evenement) => {
    if (evenement.key !== "Enter") return;
    evenement.preventDefault();
    numeroResultat += 1;
    numeroResultat = allerAuResultat(texteFiche, numeroResultat);
  });
  if (champRecherche.value) chercher();
}

/**
 * Notes Discogs sans leurs balises : « [a=Glenn Gould] » -> « Glenn Gould », « [url=https://…]texte[/url] » -> « texte »,
 * « [b]…[/b] » -> « … ». Les identifiants seuls (« [r123456] », « [l789] ») sont retirés.
 */
function nettoyerNotesDiscogs(texte) {
  return String(texte)
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, "$2 ($1)")
    .replace(/\[[almr]=([^\]]+)\]/gi, "$1")
    .replace(/\[[almr]\d+\]/gi, "")
    .replace(/\[\/?[biu]\]/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * Bloc « Sources » en fin de fiche : d'où viennent les informations (MusicBrainz, Discogs, saisie).
 * En petit et en gris, pour rester discret.
 */
function blocSources(edition) {
  const methodes = {
    edition: "édition exacte (lien Discogs sur MusicBrainz)",
    code_barre: "édition exacte (code-barre)",
    album: "par le master Discogs de l'album",
    aucune: "aucune",
  };
  const { total, avecOeuvre } = compterOeuvres(edition);
  const oeuvres = !total ? null
    : avecOeuvre === total ? "toutes les plages (" + total + ")"
    : avecOeuvre ? avecOeuvre + " plages sur " + total
    : "aucune";
  const anneesSource = SOURCES_ANNEES[edition.annees_enregistrement_source];
  const parution = !edition.annee ? null
    : edition.annee_source === "musicbrainz" ? "MusicBrainz (absente de Discogs)" : "Discogs";
  const images = edition.images || [];
  const nbMB = images.filter((i) => i.type === "musicbrainz").length;
  const photos = images.length
    ? [nbMB ? nbMB + " MusicBrainz (HD)" : null, images.length - nbMB ? (images.length - nbMB) + " Discogs" : null]
      .filter(Boolean).join(" + ")
    : null;
  const lignes = [
    ["Correspondance MusicBrainz", methodes[edition.musicbrainz_methode] || "pas encore cherchée"],
    ["Œuvres identifiées (MusicBrainz)", edition.musicbrainz_methode && edition.musicbrainz_methode !== "aucune" ? oeuvres : null],
    ["Année d'enregistrement", anneesSource],
    ["Live / Studio", edition.liveAuto ? SOURCES_ANNEES[edition.live_auto_source] : null],
    ["Année de parution", parution],
    ["Durées", (() => {
      const reelles = (edition.plages || []).flatMap(plagesReelles);
      const mb = reelles.filter((p) => p.duree_source === "musicbrainz").length;
      return mb ? (mb === reelles.length ? "MusicBrainz" : "Discogs, et MusicBrainz pour " + mb + " plage" + (mb > 1 ? "s" : "")) : null;
    })()],
    ["Photos", photos],
    ["Mise à jour", edition.details_maj ? "fiche Discogs relue le " + formaterDate(edition.details_maj) : null],
  ].filter(([, valeur]) => valeur);
  return creer("div", { classe: "sources-fiche" },
    creer("h3", { texte: "Sources" }),
    creer("dl", {}, lignes.map(([terme, valeur]) => [creer("dt", { texte: terme }), creer("dd", { texte: valeur })])));
}

/**
 * Noms d'une rubrique de crédits sur une seule ligne, avec « Voir les N » / « Replier » s'il en reste
 * de cachés. La hauteur d'une ligne se mesure une fois la fiche affichée : appeler ajusterNoms(fiche).
 */
function nomsSurUneLigne(boutons) {
  const noms = creer("div", { classe: "noms noms-replies" }, boutons);
  const lien = creer("button", { type: "button", classe: "bouton-texte voir-plus voir-noms" });
  lien.hidden = true;
  let ouvert = false;
  const montrer = () => {
    noms.classList.toggle("noms-replies", !ouvert);
    lien.textContent = ouvert ? "Replier" : "Voir les " + boutons.length;
  };
  lien.addEventListener("click", () => { ouvert = !ouvert; montrer(); });
  const bloc = creer("div", { classe: "noms-ligne" }, noms, lien);
  bloc.ajuster = () => {
    if (!noms.offsetParent) return;            // rubrique repliée : mesurée quand elle s'ouvre
    const ligne = boutons.length ? boutons[0].offsetHeight : 0;
    noms.style.setProperty("--hauteur-ligne", ligne + "px");
    const deborde = boutons.some((b) => b.offsetTop - boutons[0].offsetTop > ligne / 2);
    lien.hidden = !deborde;
    if (!deborde) ouvert = false;
    montrer();
  };
  bloc.ouvrir = () => { ouvert = true; montrer(); };
  return bloc;
}

/** Mesure les rubriques de noms affichées (voir nomsSurUneLigne). */
function ajusterNoms(racine) {
  racine.querySelectorAll(".noms-ligne").forEach((bloc) => bloc.ajuster && bloc.ajuster());
}

/**
 * Bloc replié sous un lien (« Voir les autres crédits (12) » / « Replier »).
 * Renvoie { element, contenu, ouvrir } : `ouvrir()` le déplie (recherche dans la fiche).
 */
function repliable(texteFerme, enfants, ouvert = false, texteOuvert = "Replier les autres crédits") {
  const contenu = creer("div", { classe: "repliable" }, enfants);
  const lien = creer("button", { type: "button", classe: "bouton-texte voir-plus" });
  const montrer = (oui) => {
    contenu.hidden = !oui;
    lien.textContent = oui ? texteOuvert : texteFerme;
  };
  lien.addEventListener("click", () => montrer(contenu.hidden));
  montrer(ouvert);
  return { element: creer("div", {}, lien, contenu), contenu, ouvrir: () => montrer(true) };
}

/**
 * Surligne dans `bloc` tous les passages qui correspondent à un des mots de `recherche`,
 * sans tenir compte des majuscules ni des accents. Renvoie le nombre de passages.
 */
function surligner(bloc, recherche) {
  // On enlève d'abord le surlignage précédent.
  for (const marque of bloc.querySelectorAll("mark.trouve")) marque.replaceWith(marque.textContent);
  bloc.normalize();
  const motifs = motifsDeRecherche(recherche);
  if (!motifs.length) return 0;

  const noeuds = [];
  const parcours = document.createTreeWalker(bloc, NodeFilter.SHOW_TEXT);
  while (parcours.nextNode()) noeuds.push(parcours.currentNode);

  let nombre = 0;
  for (const noeud of noeuds) {
    // Texte simplifié lettre par lettre, en gardant la position de chaque lettre dans le texte d'origine.
    const original = noeud.textContent;
    let simple = "";
    const position = [];
    for (let i = 0; i < original.length; i++) {
      const lettre = normaliser(original[i]);
      simple += lettre;
      for (let j = 0; j < lettre.length; j++) position.push(i);
    }
    // Passages trouvés, dans l'ordre et sans chevauchement : [début, fin] dans le texte d'origine.
    const passages = [];
    for (const motif of motifs) {
      for (const trouve of simple.matchAll(motif)) {
        const debut = trouve.index + trouve[1].length;
        passages.push([position[debut], position[debut + trouve[2].length - 1] + 1]);
      }
    }
    passages.sort((a, b) => a[0] - b[0]);
    const retenus = passages.filter((p, i) => i === 0 || p[0] >= passages[i - 1][1]);
    if (!retenus.length) continue;
    const morceaux = [];
    let curseur = 0;
    for (const [debut, fin] of retenus) {
      morceaux.push(original.slice(curseur, debut), creer("mark", { classe: "trouve", texte: original.slice(debut, fin) }));
      curseur = fin;
    }
    morceaux.push(original.slice(curseur));
    noeud.replaceWith(...morceaux.filter((m) => m !== ""));
    nombre += retenus.length;
  }
  return nombre;
}

/** Fait défiler la fiche jusqu'au résultat `numero` (le premier après le dernier). Renvoie le numéro affiché. */
function allerAuResultat(bloc, numero) {
  const marques = [...bloc.querySelectorAll("mark.trouve")];
  marques.forEach((m) => m.classList.remove("actuel"));
  if (!marques.length) return 0;
  const n = numero % marques.length;
  marques[n].classList.add("actuel");
  marques[n].scrollIntoView({ block: "center", behavior: "smooth" });
  return n;
}

/**
 * Tracklist : intertitres, plages, et mouvements d'une œuvre en retrait.
 * `suivi.precedente` : identifiant de la dernière œuvre MusicBrainz affichée, pour ne
 * l'écrire qu'une fois sur une suite de mouvements de la même œuvre ; `suivi.edition` : la fiche.
 */
/** « 4:20 » ou « 1:02:05 » -> secondes ; null si la durée est absente ou illisible. */
function secondesDe(duree) {
  const parties = String(duree || "").trim().split(":");
  if (parties.length < 2 || parties.some((p) => !/^\d+$/.test(p))) return null;
  return parties.reduce((total, partie) => total * 60 + Number(partie), 0);
}

/** Durée totale de plages : { secondes, complete } (complete faux si une plage n'a pas de durée). */
function dureeTotale(plages) {
  const durees = plages.flatMap(plagesReelles).map((p) => secondesDe(p.duree));
  return { secondes: durees.reduce((t, d) => t + (d || 0), 0), complete: durees.every((d) => d !== null) };
}

/** « 47 min », « 1 h 12 min », « au moins 1 h 10 min » ; "" si aucune durée connue. */
function texteDuree({ secondes, complete }) {
  if (!secondes) return "";
  const minutes = Math.round(secondes / 60);
  const heures = Math.floor(minutes / 60);
  const texte = heures ? heures + " h " + String(minutes % 60).padStart(2, "0") + " min" : Math.max(minutes, 1) + " min";
  return complete ? texte : "au moins " + texte;
}

function listePlages(plages, suivi) {
  return creer("ol", { classe: "plages" }, plages.map((plage) => lignePlage(plage, suivi)));
}

/**
 * Disque d'un coffret d'après la position Discogs : « 2-5 » ou « CD2-5 » -> « CD 2 »,
 * « DVD1-3 » -> « DVD 1 », « DVD-3 » -> « DVD ». Null pour une position sans numéro de disque (« 5 », « A2 »).
 */
function disqueDeLaPosition(position) {
  const m = /^(?:(CD|DVD|SACD|BD)(\d*)|(\d+))-\d/i.exec((position || "").trim());
  if (!m) return null;
  if (m[3]) return "CD " + Number(m[3]);
  return m[1].toUpperCase() + (m[2] ? " " + Number(m[2]) : "");   // « DVD-2 » : le seul DVD du coffret
}

/** Disque d'une plage (pour une œuvre en mouvements : celui de son premier mouvement). */
function disqueDeLaPlage(plage) {
  const premiere = plagesReelles(plage)[0];
  return premiere ? disqueDeLaPosition(premiere.position) : null;
}

/**
 * Tracklist d'un coffret : un intertitre « CD 2 » au début de chaque disque, avec un ancre
 * pour les liens « CD 1 · CD 2… ». Renvoie { liste, disques } ; disques est vide pour un seul disque.
 */
function listePlagesParDisque(plages, suivi) {
  const disques = [...new Set(plages.map(disqueDeLaPlage).filter(Boolean))];
  const edition = suivi.edition;
  // Interprètes affichés en plus de Discogs : seulement dans un coffret ou une compilation (« Various »),
  // où ils changent d'un disque ou d'une œuvre à l'autre.
  const compilation = (edition.artistes_principaux || []).some((nom) => /^various$/i.test(nom));
  const avecInterpretes = disques.length > 1 || compilation;
  const ligne = (plage, dejaDits) => lignePlage(plage, suivi,
    avecInterpretes ? ligneInterpretesDeLOeuvre(plage, edition, dejaDits) : null);
  if (disques.length < 2) return { liste: creer("ol", { classe: "plages" }, plages.map((plage) => ligne(plage, []))), disques: [] };
  const vus = new Set();
  const enTete = new Map(disques.map((disque) => [disque,
    interpretesCommuns(plages.filter((p) => disqueDeLaPlage(p) === disque), edition)]));
  const lignes = plages.flatMap((plage) => {
    const disque = disqueDeLaPlage(plage);
    const debut = disque && !vus.has(disque);
    if (debut) vus.add(disque);
    return [
      debut ? intertitreDisque(disques, disque, texteDuree(dureeTotale(plages.filter((p) => disqueDeLaPlage(p) === disque))),
        enTete.get(disque)) : null,
      ligne(plage, (enTete.get(disque) || []).map((i) => i.nom)),
    ];
  });
  return { liste: creer("ol", { classe: "plages" }, lignes), disques };
}

// Rôles d'interprètes (MusicBrainz et Discogs, en anglais) -> français. Un rôle absent garde son nom anglais.
const ROLES_EN_FRANCAIS = {
  piano: "piano", harpsichord: "clavecin", organ: "orgue", "pipe organ": "orgue", fortepiano: "pianoforte",
  violin: "violon", "baroque violin": "violon", viola: "alto", cello: "violoncelle", violoncello: "violoncelle",
  "baroque cello": "violoncelle", "double bass": "contrebasse", contrabass: "contrebasse", "viola da gamba": "viole de gambe",
  "bass viol": "viole de gambe", flute: "flûte", "transverse flute": "flûte", "baroque flute": "flûte", traverso: "flûte",
  recorder: "flûte à bec", oboe: "hautbois", "oboe d'amore": "hautbois d'amour", clarinet: "clarinette",
  bassoon: "basson", horn: "cor", "french horn": "cor", "natural horn": "cor naturel", trumpet: "trompette",
  "natural trumpet": "trompette naturelle", trombone: "trombone", tuba: "tuba", guitar: "guitare",
  "acoustic guitar": "guitare acoustique", "electric guitar": "guitare électrique", "bass guitar": "basse",
  "electric bass guitar": "basse", lute: "luth", theorbo: "théorbe", harp: "harpe", mandolin: "mandoline",
  percussion: "percussions", timpani: "timbales", drums: "batterie", "drums (drum set)": "batterie",
  vibraphone: "vibraphone", accordion: "accordéon", bandoneon: "bandonéon", keyboard: "claviers", keyboards: "claviers",
  saxophone: "saxophone", "alto saxophone": "saxophone alto", "tenor saxophone": "saxophone ténor",
  "soprano saxophone": "saxophone soprano", "baritone saxophone": "saxophone baryton", "basso continuo": "continuo",
  continuo: "continuo", vocals: "voix", vocal: "voix", voice: "voix", "lead vocals": "chant", "spoken vocals": "récitant",
  narrator: "récitant", soprano: "soprano", "soprano vocals": "soprano", "mezzo-soprano": "mezzo-soprano",
  "mezzo-soprano vocals": "mezzo-soprano", alto: "alto", "alto vocals": "alto", contralto: "contralto",
  "contralto vocals": "contralto", countertenor: "contre-ténor", "countertenor vocals": "contre-ténor",
  tenor: "ténor", "tenor vocals": "ténor", baritone: "baryton", "baritone vocals": "baryton", bass: "basse",
  "bass vocals": "basse", "bass-baritone": "baryton-basse", "bass-baritone vocals": "baryton-basse",
  conductor: "direction", "chorus master": "chef de chœur", "choir vocals": "chœur", "background vocals": "chœurs",
  archlute: "archiluth", reeds: "anches", "string quartet": "quatuor à cordes", "piano trio": "trio avec piano",
};
// Rôles qui ne disent rien de plus que le nom (un orchestre, un ensemble) : on ne les affiche pas.
const ROLES_SANS_PRECISION = ["orchestra", "ensemble", "choir", "chorus", "performer", "soloist", "featuring", "band", "performing orchestra"];

/** « Soprano Vocals, Piano [Steinway] » -> « soprano, piano » ; null si rien d'utile. */
function roleEnFrancais(role) {
  const roles = String(role || "").split(/,\s*/).map((r) => r.replace(/\s*\[.*?\]/g, "").trim().toLowerCase())
    .filter((r) => r && !ROLES_SANS_PRECISION.includes(r)).map((r) => ROLES_EN_FRANCAIS[r] || r);
  return [...new Set(roles)].join(", ") || null;
}

/**
 * Interprètes d'une plage réelle : [{ nom, role, source }]. D'abord Discogs (artistes de la plage et crédits
 * d'interprètes, sur elle ou sur son œuvre), sinon MusicBrainz (artistes de l'enregistrement, avec leur rôle).
 * Jamais le compositeur de l'œuvre.
 */
function interpretesDeLaPlage({ plage, groupes }, edition) {
  const oeuvre = plage.oeuvre || {};
  const compositeurs = [...String(oeuvre.compositeur || "").split(/,\s*/),
    ...[plage, ...groupes].flatMap((p) => (p.credits || []).filter(estCreditDeCompositeur).map((c) => c.nom))].filter(Boolean);
  const retenu = (nom) => nom && !/^various$/i.test(nom) && !compositeurs.some((c) => memePersonne(c, nom));
  const interpretesConnus = edition.interpretes || [];
  const selonDiscogs = [plage, ...groupes].flatMap((p) => [
    ...(p.artistes || []).map((nom) => ({ nom, role: null, source: "discogs" })),
    ...(p.credits || []).filter((c) => !estCreditDeCompositeur(c) && interpretesConnus.includes(c.nom))
      .map((c) => ({ nom: c.nom, role: roleEnFrancais(c.role), source: "discogs" })),
  ]).filter((i) => retenu(i.nom));
  const liste = selonDiscogs.length ? selonDiscogs
    : (oeuvre.artistes || []).filter(retenu).map((nom) => ({ nom, role: roleEnFrancais((oeuvre.roles || {})[nom]), source: "musicbrainz" }));
  const parNom = new Map();
  for (const i of liste) if (!parNom.has(i.nom) || (!parNom.get(i.nom).role && i.role)) parNom.set(i.nom, i);
  return [...parNom.values()];
}

/** Interprètes présents sur toutes les plages de ces lignes (en-tête d'un disque), sauf l'artiste du disque. */
function interpretesCommuns(plages, edition) {
  const listes = plagesAvecHeritage(plages).map((p) => interpretesDeLaPlage(p, edition));
  if (!listes.length) return [];
  const principaux = edition.artistes_principaux || [];
  return listes[0].filter((i) => listes.every((l) => l.some((x) => x.nom === i.nom))
    && !principaux.some((nom) => memePersonne(nom, i.nom)))
    .map((i) => listes.map((l) => l.find((x) => x.nom === i.nom)).find((x) => x.role) || i);
}

// Au-delà, une liste d'interprètes est coupée (« … et 6 autres ») : la liste entière est dans l'infobulle.
const INTERPRETES_AFFICHES = 5;

/** « Alain Planès, piano · Freiburger Barockorchester » */
function texteInterpretes(interpretes, tous = false) {
  const textes = interpretes.map((i) => i.nom + (i.role ? ", " + i.role : ""));
  if (tous || textes.length <= INTERPRETES_AFFICHES + 1) return textes.join(" · ");
  return textes.slice(0, INTERPRETES_AFFICHES).join(" · ") + " … et " + (textes.length - INTERPRETES_AFFICHES) + " autres";
}

/**
 * Ligne grise sous une œuvre (ou une plage) d'un coffret ou d'une compilation : ses interprètes selon
 * MusicBrainz (ceux de Discogs sont déjà dans ses crédits), sauf ceux déjà dans l'en-tête du disque
 * et l'artiste du disque.
 */
function ligneInterpretesDeLOeuvre(plage, edition, dejaDits) {
  if (plage.type === "intertitre") return null;
  const principaux = edition.artistes_principaux || [];
  const parNom = new Map();
  for (const reelle of plagesAvecHeritage([plage])) {
    for (const i of interpretesDeLaPlage(reelle, edition)) {
      if (i.source !== "musicbrainz" || dejaDits.includes(i.nom) || principaux.some((nom) => memePersonne(nom, i.nom))) continue;
      if (!parNom.has(i.nom) || (!parNom.get(i.nom).role && i.role)) parNom.set(i.nom, i);
    }
  }
  const liste = [...parNom.values()];
  return liste.length ? creer("div", { classe: "plage-interpretes", title: "Selon MusicBrainz : " + texteInterpretes(liste, true),
    texte: texteInterpretes(liste) }) : null;
}

/**
 * Intertitre « CD 2 » d'un coffret, avec à droite « ↑↑ ↑ Préc. » (sauf au début)
 * et « ↓ Suiv. ↓↓ » (sauf à la fin), pour passer d'un disque à l'autre ou aller au premier / dernier.
 */
function intertitreDisque(disques, disque, duree = "", interpretes = []) {
  const numero = disques.indexOf(disque);
  const aller = (cible) => (evenement) => {
    const liste = evenement.currentTarget.closest(".plages");
    defilerFicheVers(liste.querySelector('[data-disque="' + cible + '"]'));
  };
  const lien = (texte, cible, titre, classe = "") => creer("button", { type: "button", classe: ("bouton-texte lien-fiche " + classe).trim(),
    texte, title: titre + " : " + cible, surclic: aller(cible) });
  return creer("li", { classe: "plage-intertitre plage-disque", "data-disque": disque },
    creer("span", { texte: disque }),
    duree ? creer("span", { classe: "duree-disque", texte: duree }) : null,
    interpretes && interpretes.length ? creer("span", { classe: "interpretes-disque", texte: texteInterpretes(interpretes),
      title: "Sur tout le disque : " + texteInterpretes(interpretes, true) }) : null,
    // ↑↑ (premier disque) et ↓↓ (dernier) seulement s'ils mènent ailleurs que « Préc. » et « Suiv. ».
    creer("span", { classe: "navigation-disques" },
      numero > 1 ? lien("↑↑", disques[0], "Premier disque", "fleche-double") : null,
      numero > 0 ? lien("↑ Préc.", disques[numero - 1], "Disque précédent") : null,
      numero < disques.length - 1 ? lien("↓ Suiv.", disques[numero + 1], "Disque suivant") : null,
      numero < disques.length - 2 ? lien("↓↓", disques[disques.length - 1], "Dernier disque", "fleche-double") : null));
}

/** Les plages réelles du disque sous une plage : elle-même, ou ses mouvements. */
function plagesReelles(plage) {
  if (plage.type === "intertitre") return [];
  const sousPlages = plage.sous_plages || [];
  return sousPlages.length ? sousPlages.flatMap(plagesReelles) : [plage];
}

/**
 * L'œuvre MusicBrainz d'une plage. Pour un groupe de mouvements (« Symphony No. 7 »),
 * l'œuvre commune à tous ses mouvements, ou null s'ils ne mènent pas tous à la même.
 */
function oeuvreDeLaPlage(plage) {
  const reelles = plagesReelles(plage);
  if (!reelles.length || !reelles.every((p) => p.oeuvre)) return null;
  const oeuvres = reelles.map((p) => oeuvreDeReference(p.oeuvre));
  return oeuvres.every((o) => o.id === oeuvres[0].id) ? oeuvres[0] : null;
}

// Rôles Discogs d'un compositeur (les mêmes que dans scripts/sync.py).
const ROLES_COMPOSITEUR = ["composed by", "written-by", "written by", "music by", "composer", "songwriter"];

/** Vrai si le crédit Discogs ne dit que « compositeur » (« Composed By », « Written-By »…). */
function estCreditDeCompositeur(credit) {
  const roles = credit.role.replace(/\[[^\]]*\]/g, "").split(",").map((r) => r.trim().toLowerCase()).filter(Boolean);
  return roles.length > 0 && roles.every((r) => ROLES_COMPOSITEUR.includes(r));
}

/** Ligne « Œuvre : … » sous une plage, ou rien si c'est la même œuvre qu'à la plage précédente. */
function ligneOeuvre(plage, suivi) {
  if (plage.type === "intertitre") return null;
  const oeuvre = oeuvreDeLaPlage(plage);
  if (!oeuvre) {
    suivi.precedente = null;
    return null;
  }
  if (oeuvre.id === suivi.precedente) return null;
  suivi.precedente = oeuvre.id;
  const versions = editions.filter((e) => e.oeuvres.has(oeuvre.id)).length;
  return creer("div", { classe: "plage-reference" },
    "Œuvre : ",
    creer("button", { type: "button", classe: "bouton-texte", texte: nomOeuvre(oeuvre),
      title: versions > 1 ? "Mes " + versions + " éditions avec cette œuvre" : "Seule édition de ma cédéthèque avec cette œuvre",
      surclic: () => choisirOeuvre(oeuvre, suivi.edition) }),
    versions > 1 ? creer("span", { classe: "discret", texte: " · " + versions + " éditions dans ma cédéthèque" }) : null
  );
}

/**
 * Crédits d'une plage regroupés par rôle, dans l'ordre de Discogs :
 * « Written-By – A, B · Piano – C » plutôt que « Written-By – A · Written-By – B · Piano – C ».
 */
function creditsParRole(credits) {
  const parRole = new Map();
  for (const { role, nom } of credits) {
    if (!parRole.has(role)) parRole.set(role, []);
    if (!parRole.get(role).includes(nom)) parRole.get(role).push(nom);
  }
  return [...parRole].map(([role, noms]) => role + " – " + noms.join(", ")).join(" · ");
}

function lignePlage(plage, suivi, interpretes = null) {
  if (plage.type === "intertitre") return creer("li", { classe: "plage-intertitre", texte: plage.titre });
  const artistes = plage.artistes || [];
  // Le compositeur est déjà dans la ligne de l'œuvre MusicBrainz : on ne le répète pas dans les crédits.
  const oeuvre = oeuvreDeLaPlage(plage);
  const credits = (plage.credits || []).filter((c) => !(oeuvre && oeuvre.compositeur && estCreditDeCompositeur(c)));
  return creer("li", { classe: plage.type === "oeuvre" ? "plage plage-oeuvre" : "plage", "data-position": plage.position || null },
    creer("span", { classe: "plage-position", texte: plage.position }),
    creer("div", {},
      creer("div", { classe: "plage-titre", texte: plage.titre }),
      artistes.length ? creer("div", { classe: "plage-artistes", texte: artistes.join(", ") }) : null,
      // Crédits au format Discogs : « Piano – Glenn Gould · Conductor – Herbert von Karajan »
      credits.length ? creer("div", { classe: "plage-credits", texte: creditsParRole(credits) }) : null,
      interpretes,
      ligneOeuvre(plage, suivi)
    ),
    // Une œuvre en plusieurs mouvements : la durée totale de ses mouvements.
    (plage.sous_plages || []).length && !plage.duree
      ? creer("span", { classe: "plage-duree duree-oeuvre", texte: texteDuree(dureeTotale(plage.sous_plages)) })
      : creer("span", { classe: "plage-duree", texte: plage.duree,
        title: plage.duree_source === "musicbrainz" ? "Durée MusicBrainz (absente de Discogs)" : null }),
    // Un cœur par plage ; sur une œuvre à mouvements, un cœur qui coche ou décoche tous ses mouvements.
    !suivi.edition ? creer("span")
      : (plage.sous_plages || []).length ? boutonFavoriGroupe(plage, suivi.edition)
      : plage.position ? boutonFavori(plage, suivi.edition) : creer("span"),
    (plage.sous_plages || []).length ? listePlages(plage.sous_plages, suivi) : null
  );
}

// ---------------------------------------------------------------------------
// Visionneuse : une image en plein écran. Un clic (ou un toucher) zoome à cet
// endroit ; on se promène ensuite dans l'image en bougeant la souris ou le doigt.
// Sur iPhone et iPad, le pincement à deux doigts marche aussi.
// ---------------------------------------------------------------------------

const visionneuse = { images: [], numero: 0, zoom: false, geste: null, doigts: 0 };

function ouvrirVisionneuse(images, numero) {
  visionneuse.images = images;
  montrerImage(numero);
  $("visionneuse").showModal();
}

function montrerImage(numero) {
  const total = visionneuse.images.length;
  visionneuse.numero = (numero + total) % total;   // après la dernière, on revient à la première
  zoomer(false);
  // Images MusicBrainz : la pleine taille, pour un zoom net.
  const image = visionneuse.images[visionneuse.numero];
  $("visionneuse-image").src = image.original || image.url;
  $("visionneuse-compteur").textContent = total > 1 ? (visionneuse.numero + 1) + " / " + total : "";
  $("visionneuse-precedente").hidden = total < 2;
  $("visionneuse-suivante").hidden = total < 2;
}

function zoomer(actif, x, y) {
  visionneuse.zoom = actif;
  const image = $("visionneuse-image");
  image.style.transform = actif ? "scale(" + ZOOM + ")" : "";
  image.classList.toggle("zoomee", actif);
  if (actif) placerZoom(x, y);
}

/** Le point (x, y) de l'écran sert de centre au grossissement. */
function placerZoom(x, y) {
  const image = $("visionneuse-image");
  // offsetLeft/offsetWidth : position de l'image avant grossissement.
  const px = Math.min(Math.max((x - image.offsetLeft) / image.offsetWidth, 0), 1);
  const py = Math.min(Math.max((y - image.offsetTop) / image.offsetHeight, 0), 1);
  image.style.transformOrigin = (px * 100).toFixed(1) + "% " + (py * 100).toFixed(1) + "%";
}

function brancherVisionneuse() {
  const boite = $("visionneuse");
  const image = $("visionneuse-image");

  $("visionneuse-fermer").addEventListener("click", () => boite.close());
  $("visionneuse-precedente").addEventListener("click", () => montrerImage(visionneuse.numero - 1));
  $("visionneuse-suivante").addEventListener("click", () => montrerImage(visionneuse.numero + 1));
  boite.addEventListener("click", (evenement) => { if (evenement.target === boite) boite.close(); });
  boite.addEventListener("close", () => zoomer(false));
  boite.addEventListener("keydown", (evenement) => {
    if (evenement.key === "ArrowLeft") montrerImage(visionneuse.numero - 1);
    if (evenement.key === "ArrowRight") montrerImage(visionneuse.numero + 1);
  });

  // Gestes sur l'image : clic ou toucher = zoom ; glisser = image suivante (sans zoom)
  // ou promenade dans l'image (avec zoom). À deux doigts, on laisse faire le navigateur.
  image.addEventListener("pointerdown", (evenement) => {
    // L'image reçoit la fin du geste, même si le doigt ou la souris sort de l'image.
    try { image.setPointerCapture(evenement.pointerId); } catch (erreur) { /* pointeur déjà relâché */ }
    visionneuse.doigts++;
    visionneuse.geste = visionneuse.doigts === 1
      ? { x: evenement.clientX, y: evenement.clientY, bouge: false }
      : null;
  });
  image.addEventListener("pointermove", (evenement) => {
    const geste = visionneuse.geste;
    if (geste && Math.hypot(evenement.clientX - geste.x, evenement.clientY - geste.y) > 10) geste.bouge = true;
    // Souris : le zoom suit le pointeur. Doigt : seulement pendant qu'il touche l'écran.
    if (visionneuse.zoom && (evenement.pointerType === "mouse" || geste)) placerZoom(evenement.clientX, evenement.clientY);
  });
  const finDuGeste = (evenement) => {
    visionneuse.doigts = Math.max(visionneuse.doigts - 1, 0);
    const geste = visionneuse.geste;
    visionneuse.geste = null;
    if (!geste || evenement.type === "pointercancel") return;
    const dx = evenement.clientX - geste.x;
    const dy = evenement.clientY - geste.y;
    if (!geste.bouge) zoomer(!visionneuse.zoom, evenement.clientX, evenement.clientY);
    else if (!visionneuse.zoom && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      montrerImage(visionneuse.numero + (dx < 0 ? 1 : -1));
    }
  };
  image.addEventListener("pointerup", finDuGeste);
  image.addEventListener("pointercancel", finDuGeste);
}

// ---------------------------------------------------------------------------
// Index : toute la collection par ordre alphabétique, un bloc à la fois
// (compositeurs, interprètes, œuvres, labels…). Indépendant des filtres.
// ---------------------------------------------------------------------------

// Mots qui signalent un ensemble et non une personne : classé à son premier mot.
const MOTS_ENSEMBLE = /\band\b|\bcoro\b|orchest|orkest|ensemble|quartet|quatuor|quartett|trio\b|quintet|choir|chœur|choeur|chorus|\bchor\b|\bkor\b|koren|band\b|philharm|symphon|sinfon|consort|players|soloists|camerata|academy|akademie|singers|kammer|musici|group|brothers|sisters|opera|ballet|baroque|collegium|capella|cappella|voices|\bduo\b/i;
// Articles ignorés au début d'un titre ou d'un nom d'ensemble.
const ARTICLES = ["the", "le", "la", "les", "l", "i", "il", "lo", "gli", "die", "der", "das", "el", "los", "las", "a", "an"];
// Suffixes ignorés à la fin d'un nom de personne : « Johann Strauss Jr. » est rangé à Strauss.
const SUFFIXES = /^(jr|sr|ii|iii|iv)\.?$/;

/**
 * Clé de tri d'un nom : « Antonín Dvořák » -> « dvorak antonin » (nom de famille d'abord),
 * « The English Concert » -> « english concert » (premier mot, sans l'article).
 */
function cleDeTri(nom, personne) {
  // L'apostrophe est collée pour une personne (« Ed O'Brien » -> obrien), séparée sinon (« L'Arpeggiata » -> l arpeggiata).
  const texte = normaliser(nom).replace(/['’]/g, personne ? "" : " ");
  const mots = texte.replace(/[,."«»“”()\[\]]/g, " ").split(/\s+/).filter(Boolean);
  // Une personne : plusieurs mots, aucun mot d'ensemble, et pas d'article au début (« Les Demoiselles… »).
  if (personne && mots.length > 1 && !MOTS_ENSEMBLE.test(nom) && !ARTICLES.includes(mots[0])) {
    while (mots.length > 2 && SUFFIXES.test(mots[mots.length - 1])) mots.pop();
    return [mots[mots.length - 1], ...mots.slice(0, -1)].join(" ");
  }
  while (mots.length > 1 && ARTICLES.includes(mots[0])) mots.shift();
  return mots.join(" ");
}

/** Les blocs de l'index présents dans la collection : [clé, libellé]. */
function blocsIndex() {
  // Compositeurs et œuvres en deux blocs : classiques, puis autres (rangés juste après).
  const enDeux = (cle, libelle, classiques, autres) => [
    [cle + "_classiques", classiques, libelle + " 1"],
    [cle + "_autres", autres, libelle + " 2"],
  ];
  const blocs = [
    ["titre", "Titres"],
    ["artistes_principaux", "Artistes principaux"],
    ...CATEGORIES_PERSONNES.filter(({ cle }) => editions.some((e) => (e[cle] || []).length)).flatMap(({ cle, libelle }) =>
      cle === "compositeurs" ? enDeux(cle, libelle, "Compositeurs classiques", "Autres compositeurs") : [[cle, libelle]]),
    ...(editions.some((e) => e.oeuvres.size) ? enDeux("oeuvres", "Œuvres", "Œuvres classiques", "Autres œuvres") : []),
    ["labels", "Labels"],
    ["categories", "Catégories"],
    ...(editions.some((e) => e.favoris.size) ? [["pistes_favorites", "Pistes favorites"]] : []),
    // Un bloc par statut présent (« Favoris », « À écouter »…) : les albums, par titre.
    ...[...new Set(editions.map((e) => e.statut).filter(Boolean))].map((statut) =>
      ["statut:" + statut, BLOCS_STATUT[normaliser(statut)] || statut]),
  ];
  return blocs
    .filter(([cle]) => !/_(classiques|autres)$/.test(cle) || entreesIndex(cle).length)  // moitié vide : pas de bloc
    .sort((a, b) => comparerTextes(a[2] || a[1], b[2] || b[1]))
    .map(([cle, libelle]) => [cle, libelle]);
}

/**
 * Vrai si l'édition est classique : rangée dans un dossier de la méta-catégorie « Classique ».
 * Seulement « Sans catégorie » ou « À Vendre » : on se fie au genre « Classical » de Discogs.
 */
function estClassique(edition) {
  const rangees = edition.categories.filter((c) => !categorieNeutre(c));
  if (!rangees.length) return (edition.genres || []).includes("Classical");
  return rangees.some((c) => metaDeCategorie(c) === META_CLASSIQUE);
}

/**
 * Pour un bloc coupé en deux (« compositeurs_classiques »…) : vrai si l'entrée va dans ce bloc.
 * Chaque nom va dans un seul bloc, celui de la majorité de ses éditions (classique en cas d'égalité).
 */
function dansLaMoitie(bloc, editionsDuNom) {
  const classique = majoritairementClassique(editionsDuNom);
  return bloc.endsWith("_classiques") ? classique : !classique;
}

/** Vrai si au moins la moitié de ces éditions sont classiques (voir estClassique). */
function majoritairementClassique(editionsDuNom) {
  return editionsDuNom.filter(estClassique).length * 2 >= editionsDuNom.length;
}

/**
 * Côté de chaque compositeur et de chaque œuvre (id), d'après toute la collection,
 * pour que le classement ne change pas avec les filtres : Map -> vrai si classique.
 */
function cotesClassiques() {
  const parCompositeur = new Map();
  const parOeuvre = new Map();
  const ajouter = (carte, cle, edition) => {
    if (!carte.has(cle)) carte.set(cle, []);
    carte.get(cle).push(edition);
  };
  for (const edition of editions) {
    for (const nom of new Set(edition.compositeurs || [])) ajouter(parCompositeur, nom, edition);
    for (const id of edition.oeuvres.keys()) ajouter(parOeuvre, id, edition);
  }
  const cotes = (carte) => new Map([...carte].map(([cle, liste]) => [cle, majoritairementClassique(liste)]));
  return { compositeurs: cotes(parCompositeur), oeuvres: cotes(parOeuvre) };
}

/** Entrées d'un bloc : [{ libelle, nombre, cle, clic }]. */
function entreesIndex(bloc) {
  if (bloc === "categories") {
    // Rangées par méta-catégorie (champ `groupe`), pas par lettre ; un clic montre la catégorie dans la Collection.
    const compte = compter(editions, EXTRACTEURS.categorie);
    return [...compte].map(([categorie, nombre]) => ({
      libelle: categorie, nombre, cle: categorie, groupe: metaDeCategorie(categorie),
      clic: () => allerVers({ ...FILTRES_VIDES, categorie }, null, "Catégorie : " + categorie),
    }));
  }
  if (bloc === "titre" || bloc.startsWith("statut:")) {
    const statut = bloc.slice("statut:".length);
    return editions.filter((e) => bloc === "titre" || e.statut === statut).map((edition) => ({
      libelle: edition.titre, nombre: null, cle: cleDeTri(edition.titre, false),
      detail: (edition.artistes_principaux || []).join(", "), clic: () => ouvrirFiche(edition),
    }));
  }
  if (bloc === "pistes_favorites") {
    // Une entrée par plage favorite : son titre, puis le disque.
    return editions.flatMap((edition) => plagesFavorites(edition).map(({ titre }) => ({
      libelle: titre, nombre: null, cle: cleDeTri(titre, false),
      detail: edition.titre + ((edition.artistes_principaux || []).length ? " (" + edition.artistes_principaux.join(", ") + ")" : ""),
      clic: () => ouvrirFiche(edition),
    })));
  }
  if (bloc.startsWith("oeuvres_")) {
    const parId = new Map();
    for (const edition of editions) {
      for (const oeuvre of edition.oeuvres.values()) {
        if (!parId.has(oeuvre.id)) parId.set(oeuvre.id, { oeuvre, liste: [] });
        parId.get(oeuvre.id).liste.push(edition);
      }
    }
    return [...parId.values()].filter(({ liste }) => dansLaMoitie(bloc, liste)).map(({ oeuvre, liste }) => ({
      libelle: nomOeuvre(oeuvre), nombre: liste.length, cle: cleDeTri(oeuvre.titre, false),
      clic: () => allerVers({ ...FILTRES_VIDES, oeuvre }),
    }));
  }
  if (bloc.startsWith("compositeurs_")) {
    const parNom = new Map();
    for (const edition of editions) {
      for (const nom of new Set(edition.compositeurs || [])) {
        if (!parNom.has(nom)) parNom.set(nom, []);
        parNom.get(nom).push(edition);
      }
    }
    return [...parNom].filter(([, liste]) => dansLaMoitie(bloc, liste)).map(([nom, liste]) => ({
      libelle: nom, nombre: liste.length, cle: cleDeTri(nom, true),
      clic: () => allerVers({ ...FILTRES_VIDES, recherche: nom, role: "compositeurs" }, null, "Compositeurs : " + nom),
    }));
  }
  if (bloc === "labels") {
    return [...compter(editions, EXTRACTEURS.label)].map(([nom, nombre]) => ({
      libelle: nom, nombre, cle: cleDeTri(nom, false),
      clic: () => allerVers({ ...FILTRES_VIDES, recherche: nom, role: "labels" }, null, "Label : " + nom),
    }));
  }
  const libelleBloc = (blocsIndex().find(([cle]) => cle === bloc) || [, ""])[1];
  return [...compter(editions, (e) => e[bloc] || [])].map(([nom, nombre]) => ({
    libelle: nom, nombre, cle: cleDeTri(nom, true),
    clic: () => allerVers({ ...FILTRES_VIDES, recherche: nom, role: bloc }, null, libelleBloc + " : " + nom),
  }));
}

/** Première lettre de la clé de tri, ou « # » pour un chiffre ou un signe. */
function lettreIndex(cle) {
  const lettre = (cle || "").charAt(0).toUpperCase();
  return /[A-Z]/.test(lettre) ? lettre : "#";
}

function afficherIndex() {
  const blocs = blocsIndex();
  if (!blocs.some(([cle]) => cle === etat.blocIndex)) etat.blocIndex = blocs[0][0];
  const parMeta = etat.blocIndex === "categories";
  const entrees = entreesIndex(etat.blocIndex).sort(parMeta ? (a, b) => comparerCategories(a.cle, b.cle)
    : (a, b) => comparerTextes(a.cle, b.cle) || comparerTextes(a.libelle, b.libelle));

  // Regroupement par lettre, dans l'ordre : « # » d'abord, puis A à Z.
  // Bloc « Catégories » : regroupement par méta-catégorie (ordre alphabétique) à la place des lettres.
  const parLettre = new Map();
  for (const entree of entrees) {
    const lettre = entree.groupe || lettreIndex(entree.cle);
    if (!parLettre.has(lettre)) parLettre.set(lettre, []);
    parLettre.get(lettre).push(entree);
  }
  const lettres = [...parLettre.keys()].sort(parMeta ? comparerTextes
    : (a, b) => (a === "#" ? -1 : b === "#" ? 1 : a.localeCompare(b)));
  // Titre d'une méta-catégorie : cliquable, il montre toute la méta-catégorie dans la Collection.
  const nbParMeta = parMeta ? compter(editions, (e) => e.metas) : null;
  const titreGroupe = (lettre) => parMeta
    ? creer("h3", { id: "lettre-" + lettre },
        creer("button", { type: "button", classe: "index-nom index-meta",
          surclic: () => allerVers({ ...FILTRES_VIDES, categorie: PREFIXE_META + lettre }, null, "Méta-catégorie : " + lettre) },
          lettre, creer("span", { classe: "discret", texte: " (" + nbParMeta.get(lettre) + ")" })))
    : creer("h3", { id: "lettre-" + lettre, texte: lettre });

  const choix = creer("select", { id: "bloc-index", "aria-label": "Bloc de l'index" },
    blocs.map(([cle, libelle]) => creer("option", { value: cle, selected: cle === etat.blocIndex,
      texte: libelle + " (" + entreesIndex(cle).length.toLocaleString("fr-FR") + ")" })));
  choix.addEventListener("change", () => { etat.blocIndex = choix.value; afficher(); window.scrollTo({ top: 0 }); });

  // La ligne du sélecteur et des lettres reste sous l'en-tête : la lettre choisie arrive juste en dessous.
  const enteteIndex = creer("div", { classe: "index-entete" },
    choix,
    creer("nav", { classe: "index-lettres", "aria-label": "Lettres" }, lettres.map((lettre) =>
      creer("button", { type: "button", classe: "bouton-texte", texte: lettre,
        surclic: () => window.scrollTo({ behavior: "smooth",
          top: $("lettre-" + lettre).getBoundingClientRect().top + window.scrollY - enteteIndex.getBoundingClientRect().bottom - 4 }) })))
  );

  $("vue-index").replaceChildren(
    enteteIndex,
    ...lettres.map((lettre) => creer("section", { classe: "index-lettre" },
      titreGroupe(lettre),
      // Le point de séparation suit le nom, pour qu'une ligne ne commence jamais par « · ».
      creer("p", { classe: "index-noms" }, parLettre.get(lettre).map((entree, numero, liste) => [
        creer("span", { classe: "index-element" },
          creer("button", { type: "button", classe: "index-nom", surclic: entree.clic,
            title: entree.detail || null },
            entree.libelle,
            entree.nombre > 1 || (parMeta && entree.nombre) ? creer("span", { classe: "discret", texte: " (" + entree.nombre + ")" }) : null,
            entree.detail ? creer("span", { classe: "discret", texte: " – " + entree.detail }) : null),
          numero < liste.length - 1 ? creer("span", { classe: "index-separateur", texte: " ·" }) : null),
        " ",
      ]))
    ))
  );
}

// ---------------------------------------------------------------------------
// Statistiques (calculées sur les disques affichés : filtres et recherche compris)
// ---------------------------------------------------------------------------

/**
 * Carte de barres horizontales. Un clic sur une barre applique le filtre correspondant.
 * `voirPlus(n)` (facultatif) : texte d'un bouton qui déroule toutes les valeurs présentes
 * sur au moins 2 éditions, quand il y en a plus que `limite`.
 */
function carteBarres(titre, note, compte, limite, auClic, voirPlus = null) {
  const toutes = [...compte.entries()].sort((a, b) => b[1] - a[1] || comparerTextes(a[0], b[0]));
  const maximum = toutes.length ? toutes[0][1] : 1;
  const barre = ([libelle, nombre]) =>
    creer("button", { type: "button", classe: "barre", title: libelle + " : " + nombre, surclic: () => auClic(libelle) },
      creer("span", { classe: "barre-libelle", texte: libelle }),
      creer("span", { classe: "barre-piste" },
        creer("span", { classe: "barre-remplie", style: "width:" + (100 * nombre / maximum).toFixed(1) + "%" }),
        creer("span", { classe: "barre-valeur", texte: nombre })
      )
    );

  const barres = creer("div", { classe: "barres" }, toutes.slice(0, limite).map(barre));
  const auMoinsDeux = toutes.filter(([, nombre]) => nombre >= 2);
  let bouton = null;
  if (voirPlus && auMoinsDeux.length > limite) {
    let deroule = false;
    bouton = creer("button", { type: "button", classe: "bouton-texte voir-plus", texte: voirPlus(auMoinsDeux.length),
      surclic: () => {
        deroule = !deroule;
        barres.replaceChildren(...(deroule ? auMoinsDeux : toutes.slice(0, limite)).map(barre));
        bouton.textContent = deroule ? "Replier" : voirPlus(auMoinsDeux.length);
      } });
  }

  return creer("section", { classe: "carte-stat" },
    creer("h2", { texte: titre }),
    // Sous-titre vide gardé (espace insécable) : les barres de toutes les cartes commencent à la même hauteur.
    creer("p", { classe: "note-stat", texte: note || "\u00a0" }),
    toutes.length ? [barres, bouton] : creer("p", { classe: "note-stat", texte: "Aucune donnée." })
  );
}

/** Histogramme des années de parution (année de ton édition), une colonne par année. */
function carteAnnees(liste) {
  return carteHistogramme(liste, {
    titre: "Années de parution",
    explication: "Année de ton édition, pas de l'œuvre. ",
    anneesDe: (e) => (e.annee ? [e.annee] : []),
    filtrer: (annee) => ({ anneeMin: annee, anneeMax: annee }),
  });
}

/**
 * Histogramme des années d'enregistrement (MusicBrainz). Une édition enregistrée de 1956 à 1958
 * compte dans chacune de ces trois années, comme le filtre « de… à… » qui la retrouve pour 1957.
 */
function carteAnneesEnregistrement(liste) {
  return carteHistogramme(liste, {
    titre: "Années d'enregistrement",
    explication: "D'après MusicBrainz, les notes Discogs, le titre ou ta saisie. Un enregistrement sur plusieurs années compte dans chacune. ",
    anneesDe: (e) => {
      const annees = e.annees_enregistrement;
      if (!annees || !annees.length) return [];
      const liste = [];
      for (let annee = annees[0]; annee <= annees[1]; annee++) liste.push(annee);
      return liste;
    },
    filtrer: (annee) => ({ enregMin: annee, enregMax: annee }),
  });
}

/** Histogramme d'années, une colonne par année ; un clic sur une colonne filtre la collection. */
function carteHistogramme(liste, { titre, explication, anneesDe, filtrer }) {
  const compte = compter(liste, anneesDe);
  const sansAnnee = liste.filter((e) => !anneesDe(e).length).length;
  const annees = [...compte.keys()];
  const carte = creer("section", { classe: "carte-stat large" },
    creer("h2", { texte: titre }),
    creer("p", { classe: "note-stat", texte: explication +
      (sansAnnee ? pluriel(sansAnnee, "édition") + " sans année. " : "") + "Clic sur une colonne pour filtrer." })
  );
  if (!annees.length) return carte;

  const debut = Math.min(...annees);
  const fin = Math.max(...annees);
  const maximum = Math.max(...compte.values());
  const colonnes = [];
  for (let annee = debut; annee <= fin; annee++) {
    const nombre = compte.get(annee) || 0;
    colonnes.push(creer("button", {
      type: "button", classe: "colonne", "aria-label": annee + " : " + nombre,
      "data-infobulle": annee + " · " + pluriel(nombre, "édition"),
      disabled: nombre === 0,
      surclic: () => { Object.assign(etat, filtrer(annee), { vue: "collection" }); ecrireControles(); afficher(); },
    }, creer("span", { classe: "colonne-remplie", style: "height:" + (100 * nombre / maximum).toFixed(1) + "%" })));
  }
  const infobulle = creer("div", { classe: "infobulle", hidden: true });
  const zone = creer("div", { classe: "histogramme" }, creer("div", { classe: "colonnes" }, colonnes), infobulle,
    creer("div", { classe: "axe-annees" }, creer("span", { texte: debut }), creer("span", { texte: fin })));

  // Infobulle au survol d'une colonne
  zone.addEventListener("pointerover", (evenement) => {
    const colonne = evenement.target.closest(".colonne");
    if (!colonne) return;
    const cadreZone = zone.getBoundingClientRect();
    const cadre = colonne.getBoundingClientRect();
    infobulle.textContent = colonne.dataset.infobulle;
    infobulle.style.left = (cadre.left + cadre.width / 2 - cadreZone.left) + "px";
    infobulle.style.top = "-6px";
    infobulle.hidden = false;
  });
  zone.addEventListener("pointerleave", () => { infobulle.hidden = true; });
  carte.append(zone);
  return carte;
}

function afficherStatistiques(liste) {
  const nbExemplaires = liste.reduce((total, e) => total + e.exemplaires.length, 0);
  const nbDisques = liste.reduce((total, e) => total + nombreDeDisques(e) * e.exemplaires.length, 0);
  const compositeurs = compter(liste, (e) => e.compositeurs || []);
  const interpretes = compter(liste, (e) => e.interpretes || []);

  // Œuvres présentes sur au moins deux éditions. Les barres sont nommées « titre (compositeur) ».
  const oeuvresParNom = new Map();
  const comptesOeuvres = compter(liste, (e) => [...e.oeuvres.values()].map((o) => {
    const nom = nomOeuvre(o);
    if (!oeuvresParNom.has(nom)) oeuvresParNom.set(nom, o);
    return nom;
  }));
  const oeuvresEnPlusieursVersions = new Map([...comptesOeuvres].filter(([, nombre]) => nombre > 1));

  // Compositeurs et œuvres, chacun en deux cartes : classiques et autres (même classement que l'index).
  const cotes = cotesClassiques();
  const partager = (compte, estClassiqueNom) => [true, false].map((classique) =>
    new Map([...compte].filter(([nom]) => estClassiqueNom(nom) === classique)));
  const [compositeursClassiques, autresCompositeurs] = partager(compositeurs, (nom) => cotes.compositeurs.get(nom));
  const [oeuvresClassiques, autresOeuvres] = partager(oeuvresEnPlusieursVersions,
    (nom) => cotes.oeuvres.get(oeuvresParNom.get(nom).id));
  // Nombre d'œuvres différentes (toutes, pas seulement celles en plusieurs versions), de chaque côté.
  const idsOeuvres = new Set(liste.flatMap((e) => [...e.oeuvres.keys()]));
  const nbOeuvresClassiques = [...idsOeuvres].filter((id) => cotes.oeuvres.get(id)).length;
  const carteCompositeurs = (titre, compte) => compte.size ? carteBarres(titre, "Les 15 premiers", compte, 15,
    (nom) => chercherNomSansFiche(nom, "compositeurs"),
    (n) => "Voir les " + n + " compositeurs présents sur au moins 2 éditions") : "";
  const carteOeuvres = (titre, compte) => compte.size ? carteBarres(titre, "Les 15 premières, d'après MusicBrainz", compte, 15,
    (nom) => choisirOeuvre(oeuvresParNom.get(nom)),
    (n) => "Voir les " + n + " œuvres présentes sur au moins 2 éditions") : "";

  const chiffre = (valeur, libelle) => creer("div", { classe: "chiffre" },
    creer("div", { classe: "valeur", texte: valeur.toLocaleString("fr-FR") }),
    creer("div", { classe: "libelle", texte: libelle }));

  const appliquer = (cle) => (valeur) => {
    Object.assign(etat, { [cle]: valeur, vue: "collection" });
    ecrireControles();
    afficher();
  };

  const synchro = infosCollection.genere_le ? "Synchronisé avec Discogs le " + formaterDate(infosCollection.genere_le) + "." : "";

  $("vue-statistiques").replaceChildren(
    creer("section", { classe: "carte-stat large" },
      creer("div", { classe: "chiffres" },
        chiffre(liste.length, "éditions"),
        chiffre(nbExemplaires, "exemplaires"),
        chiffre(nbDisques, "disques physiques"),
        chiffre(compositeursClassiques.size, "compositeurs classiques"),
        chiffre(nbOeuvresClassiques, "œuvres classiques"),
        chiffre(autresCompositeurs.size, "autres compositeurs"),
        chiffre(idsOeuvres.size - nbOeuvresClassiques, "autres œuvres"),
        chiffre(interpretes.size, "interprètes")
      ),
      creer("p", { classe: "note-stat note-synchro", texte: synchro + " Les statistiques portent sur les disques affichés (filtres et recherche compris)." })
    ),
    carteAnnees(liste),
    carteAnneesEnregistrement(liste),
    carteBarres("Méta-catégories", "Regroupement des dossiers Discogs", compter(liste, (e) => e.metas), 10,
      (meta) => appliquer("categorie")(PREFIXE_META + meta)),
    carteBarres("Catégories", "Dossier Discogs (Custom Field)", compter(liste, EXTRACTEURS.categorie), 20, appliquer("categorie")),
    carteBarres("Genres", "Genres Discogs", compter(liste, EXTRACTEURS.genre), 15, appliquer("genre")),
    carteBarres("Localisation", "", compter(liste, EXTRACTEURS.localisation), 15, appliquer("localisation")),
    carteBarres("Formats", "", compter(liste, EXTRACTEURS.format), 10, appliquer("format")),
    carteBarres("Statut d’écoute", "Custom Field Discogs « " + CHAMP_STATUT + " »", compter(liste, EXTRACTEURS.statut), 10, appliquer("statut")),
    carteBarres("Live / Studio", "Custom Field Discogs « " + CHAMP_LIVE + " », sinon « Live » d’après le titre ou les notes Discogs", compter(liste, EXTRACTEURS.enregistrement), 10,
      appliquer("enregistrement")),
    carteCompositeurs("Compositeurs classiques les plus présents", compositeursClassiques),
    carteCompositeurs("Autres compositeurs les plus présents", autresCompositeurs),
    carteBarres("Interprètes les plus présents", "Les 15 premiers", interpretes, 15, (nom) => chercherNomSansFiche(nom, "interpretes"),
      (n) => "Voir les " + n + " interprètes présents sur au moins 2 éditions"),
    carteOeuvres("Œuvres classiques en plusieurs versions", oeuvresClassiques),
    carteOeuvres("Autres œuvres en plusieurs versions", autresOeuvres),
    carteBarres("Labels", "Les 15 premiers", compter(liste, EXTRACTEURS.label), 15, appliquer("label"),
      (n) => "Voir les " + n + " labels ayant au moins 2 éditions"),
    blocVerificationsMusicBrainz()
  );
}

// ---------------------------------------------------------------------------
// À vérifier sur MusicBrainz : rattachements plage -> œuvre qui semblent faux.
// Calculé sur toute la collection ; une ligne disparaît à la synchro qui suit sa correction sur MusicBrainz.
// ---------------------------------------------------------------------------

const VALEURS_ROMAINES = { i: 1, v: 5, x: 10, l: 50, c: 100 };

/** Valeur d'un chiffre romain en minuscules (« xiv » -> 14). */
function valeurRomaine(texte) {
  let total = 0;
  for (let k = 0; k < texte.length; k++) {
    const valeur = VALEURS_ROMAINES[texte[k]], suivante = VALEURS_ROMAINES[texte[k + 1]] || 0;
    total += valeur < suivante ? -valeur : valeur;
  }
  return total;
}

/** Numéros d'un titre, arabes ou romains : « 3. Menuetto » et « III. Minuetto » donnent tous deux 3. */
function numerosDuTitre(titre) {
  return new Set((normaliser(titre).match(/\b(\d+|[ivxlc]{2,}|i|v|x)\b/g) || [])
    .map((m) => (/\d/.test(m) ? Number(m) : valeurRomaine(m))));
}

/** Mots de 4 lettres ou plus d'un titre (sans les chiffres romains). */
function motsDuTitre(titre) {
  return normaliser(titre).split(/[^a-z]+/).filter((m) => m.length >= 4 && !/^[ivxlc]+$/.test(m));
}

/** Deux mots « se ressemblent » : mêmes 3 premières lettres, ou mêmes consonnes (Menuetto / Minuetto, Rondo / Rondeau). */
function motsSemblables(a, b) {
  const consonnes = (m) => m.replace(/[aeiouy]/g, "").replace(/(.)\1+/g, "$1").slice(0, 4);
  return a.slice(0, 3) === b.slice(0, 3) || consonnes(a) === consonnes(b);
}

let verificationsEnReserve = { editions: null, types: null };

/** { trous, doubles, titres } : listes de { edition, plage, texte }. */
function rattachementsSuspects() {
  if (verificationsEnReserve.editions === editions) return verificationsEnReserve.types;
  const types = { trous: [], doubles: [], titres: [] };
  const nomDePlage = (plage) => "plage " + plage.position + " · « " + plage.titre + " »";

  // 1. Plage sans œuvre entre deux plages de la même œuvre.
  for (const edition of editions) {
    const plages = plagesAvecHeritage(edition.plages).map(({ plage }) => plage);
    plages.forEach((plage, i) => {
      const avant = plages[i - 1], apres = plages[i + 1];
      if (plage.oeuvre || !avant || !apres || !avant.oeuvre || !apres.oeuvre) return;
      const oeuvre = oeuvreDeReference(avant.oeuvre);
      if (oeuvre.id !== oeuvreDeReference(apres.oeuvre).id) return;
      types.trous.push({ edition, plage, texte: nomDePlage(plage) + " : reliée à rien, entre deux plages de « " + oeuvre.titre + " »" });
    });
  }

  for (const { oeuvres } of oeuvresParCompositeur()) {
    for (const { oeuvre, editions: liste } of oeuvres) {
      for (const version of versionsDeLOeuvre(oeuvre, liste)) {
        // 2. Partie reliée deux fois dans la même version (pas à la suite : un mouvement en deux plages est normal).
        const ids = version.plages.map(({ plage }) => idDeLaPartie(plage, oeuvre));
        version.plages.forEach(({ plage }, i) => {
          if (ids[i] === "entiere" || ids[i - 1] === ids[i] || ids.indexOf(ids[i]) === i) return;
          types.doubles.push({ edition: version.edition, plage,
            texte: nomDePlage(plage) + " → « " + titreDeLaPartie(plage.oeuvre.titre, oeuvre.titre) + " », déjà reliée à la plage "
              + version.plages[ids.indexOf(ids[i])].plage.position });
        });

        // 3. Titre MusicBrainz sans rapport avec le titre Discogs : ni mot semblable ni numéro commun.
        // Seulement dans une version où la plupart des titres se ressemblent (même langue, mêmes conventions).
        const lignes = version.plages.filter(({ plage }) => plage.oeuvre.parente).map(({ plage }) => {
          const partie = titreDeLaPartie(plage.oeuvre.titre, oeuvre.titre);
          const a = motsDuTitre(plage.titre), b = motsDuTitre(partie);
          const numeros = numerosDuTitre(partie);
          const proche = a.some((m) => b.some((n) => motsSemblables(m, n))) || [...numerosDuTitre(plage.titre)].some((n) => numeros.has(n));
          return { plage, partie, proche, comparable: a.length && b.length };
        });
        if (lignes.length < 3 || lignes.filter((l) => l.proche).length < 0.6 * lignes.length) continue;
        for (const { plage, partie, proche, comparable } of lignes) {
          if (!proche && comparable) types.titres.push({ edition: version.edition, plage, texte: nomDePlage(plage) + " → « " + partie + " »" });
        }
      }
    }
  }
  verificationsEnReserve = { editions, types };
  return types;
}

/** Bloc replié en bas des statistiques : un sous-bloc replié par type de problème, les plages groupées par disque. */
function blocVerificationsMusicBrainz() {
  const types = rattachementsSuspects();
  const sections = [
    ["trous", "Plage sans œuvre entre deux plages de la même œuvre"],
    ["doubles", "Partie reliée deux fois dans la même version"],
    ["titres", "Titre MusicBrainz très différent du titre Discogs (peut être une fausse alerte)"],
  ];
  const total = sections.reduce((n, [cle]) => n + types[cle].length, 0);
  if (!total) return null;
  return creer("details", { classe: "carte-stat large verifications-mb" },
    creer("summary", {}, creer("h2", { texte: "⚠ À vérifier sur MusicBrainz (" + total + ")" })),
    creer("p", { classe: "note-stat", texte: "Rattachements plage → œuvre qui semblent faux. Une ligne disparaît à la synchro qui suit sa correction sur MusicBrainz." }),
    ...sections.filter(([cle]) => types[cle].length).map(([cle, titre]) => {
      const parEdition = new Map();
      for (const ligne of types[cle]) {
        if (!parEdition.has(ligne.edition)) parEdition.set(ligne.edition, []);
        parEdition.get(ligne.edition).push(ligne);
      }
      return creer("details", { classe: "verifications-type" },
        creer("summary", {}, titre, creer("span", { classe: "discret", texte: " (" + types[cle].length + ")" })),
        ...[...parEdition].map(([edition, lignes]) => creer("div", { classe: "verifications-disque" },
          creer("p", {},
            creer("button", { type: "button", classe: "bouton-texte", texte: edition.titre, surclic: () => ouvrirFiche(edition) }),
            edition.musicbrainz ? creer("a", { href: edition.musicbrainz, target: "_blank", rel: "noopener", texte: " MusicBrainz ↗" }) : null),
          creer("ul", {}, lignes.map(({ texte }) => creer("li", { texte }))))));
    })
  );
}

function chercherNomSansFiche(nom, role) {
  Object.assign(etat, { recherche: nom, role, vue: "collection" });
  ecrireControles();
  afficher();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------------
// Modification sur Discogs
// La page écrit directement chez Discogs avec le jeton Discogs, rangé dans le
// navigateur de chaque appareil : jamais dans le dépôt ni sur le site publié.
// Sans jeton (un ami à qui je montre la page), tout reste en lecture seule.
// ---------------------------------------------------------------------------

/** Lit un réglage du navigateur. Le stockage peut être bloqué (navigation privée) : on ne plante pas. */
function lireStockage(cle, parDefaut) {
  try {
    const valeur = localStorage.getItem(cle);
    return valeur === null ? parDefaut : JSON.parse(valeur);
  } catch (erreur) {
    return parDefaut;
  }
}

/** Range un réglage dans le navigateur (null l'efface). Renvoie faux si c'est impossible. */
function ecrireStockage(cle, valeur) {
  try {
    if (valeur === null) localStorage.removeItem(cle);
    else localStorage.setItem(cle, JSON.stringify(valeur));
    return true;
  } catch (erreur) {
    return false;
  }
}

const jeton = () => lireStockage(CLE_JETON, null);
const cheminCollection = () => "/users/" + encodeURIComponent(infosCollection.utilisateur) + "/collection";

/** Appelle l'API Discogs avec le jeton. Renvoie la réponse lue, ou lève une erreur en clair. */
async function appelerDiscogs(chemin, options = {}, jetonAEssayer = jeton()) {
  const entetes = { Authorization: "Discogs token=" + jetonAEssayer };
  if (options.body) entetes["Content-Type"] = "application/json";
  let reponse;
  try {
    reponse = await fetch(API_DISCOGS + chemin, { ...options, headers: entetes, cache: "no-store" });
  } catch (erreur) {
    throw new Error("Discogs ne répond pas (pas de connexion ?).");
  }
  if (reponse.status === 401 || reponse.status === 403) throw new Error("Discogs refuse le jeton (code " + reponse.status + ").");
  if (reponse.status === 429) throw new Error("Trop de demandes envoyées à Discogs : réessaie dans une minute.");
  if (!reponse.ok) {
    // Discogs joint en général son explication : { "message": "…" }, parfois avec des détails.
    let explication = "";
    try {
      const corps = await reponse.json();
      explication = [corps.message, typeof corps.detail === "string" ? corps.detail : corps.detail && JSON.stringify(corps.detail)]
        .filter(Boolean).join(" ").replace(/\.\s*$/, "");
    } catch (erreur) { /* réponse sans explication */ }
    throw new Error("Discogs a refusé (code " + reponse.status + ")" + (explication ? " : « " + explication + " »" : "") + ".");
  }
  return reponse.status === 204 ? null : reponse.json();
}

/**
 * Valeur d'un champ telle qu'on l'a tapée : Discogs renvoie les adresses
 * entourées de balises <a>, qu'il ne faut pas réécrire à l'enregistrement.
 */
function texteBrut(texte) {
  const corps = lireHtmlDiscogs(texte);
  corps.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return corps.textContent;
}

/**
 * Modifications faites sur cet appareil. Celles d'avant la dernière synchro
 * sont déjà dans data/collection.json : on les oublie.
 */
function modificationsEnAttente(dateSynchro) {
  const toutes = lireStockage(CLE_MODIFICATIONS, {});
  const restantes = {};
  for (const [instance, modif] of Object.entries(toutes)) {
    if (!dateSynchro || new Date(modif.quand) > new Date(dateSynchro)) restantes[instance] = modif;
  }
  ecrireStockage(CLE_MODIFICATIONS, restantes);
  return restantes;
}

/** Champs d'un exemplaire, modifications en attente comprises (un champ vidé disparaît). */
function appliquerModification(champs, modif) {
  if (!modif) return champs;
  const resultat = { ...champs, ...modif.champs };
  for (const [nom, valeur] of Object.entries(resultat)) {
    if (!String(valeur).trim()) delete resultat[nom];
  }
  return resultat;
}

/** Recalcule la page après une modification, en gardant les filtres choisis. */
function reconstruire() {
  editions = regrouperParEdition(infosCollection.disques || []);
  remplirFiltres();
  ecrireControles();
  afficher();
}

/** Liste de choix (Localisation, ma note). La valeur actuelle est gardée même si elle n'est plus proposée. */
function creerListe(choix, valeurActuelle) {
  const valeurs = [...choix];
  if (!valeurs.some(([valeur]) => valeur === valeurActuelle)) valeurs.push([valeurActuelle, valeurActuelle]);
  const liste = creer("select", {}, valeurs.map(([valeur, texte]) => creer("option", { value: valeur, texte })));
  liste.value = valeurActuelle;
  return liste;
}

/** Nombre de caractères tel que Discogs le compte (un emoji compte pour un). */
function longueurTexte(texte) {
  return [...texte].length;
}

/**
 * La zone de texte grandit avec son contenu : sur iPhone, on ne peut pas
 * l'agrandir à la main comme sur le Mac.
 */
function ajusterHauteur(zoneTexte) {
  zoneTexte.style.height = "auto";   // on la laisse d'abord revenir à sa hauteur minimale
  zoneTexte.style.height = (zoneTexte.scrollHeight + 2) + "px";
}

/** Texte grisé du champ manuel : « auto : 1958 (notes Discogs) — ou 1958, 1958-1961, à trouver ». */
function indicationAnneeAuto(edition) {
  const [annees, source] = edition.annees_enregistrement_auto || [];
  const formats = "1958, 1958-1961 ou « à trouver »";
  return annees ? "auto : " + textePeriode(annees) + " (" + SOURCES_ANNEES[source] + ") — sinon " + formats
    : "aucune année trouvée automatiquement — " + formats;
}

/** Remplace la fiche par le formulaire de modification, rempli avec les valeurs lues sur Discogs. */
async function ouvrirEdition(edition) {
  const message = creer("p", { classe: "message-edition", texte: "Lecture des valeurs actuelles sur Discogs…" });
  const zone = creer("form", { classe: "edition" },
    creer("h2", { id: "fiche-titre", texte: edition.titre }),
    creer("p", { classe: "sous-titre", texte: (edition.artistes_principaux || []).join(", ") }),
    message
  );
  $("fiche-contenu").replaceChildren(zone);
  $("fiche").scrollTop = 0;

  // On relit Discogs plutôt que le JSON : les valeurs sont celles du moment,
  // y compris celles changées sur Discogs depuis la dernière synchro.
  let definitions, exemplaires;
  try {
    [definitions, exemplaires] = await Promise.all([
      appelerDiscogs(cheminCollection() + "/fields"),
      appelerDiscogs(cheminCollection() + "/releases/" + edition.release_id),
    ]);
  } catch (erreur) {
    message.textContent = erreur.message;
    zone.append(creer("button", { type: "button", classe: "bouton", texte: "Retour", surclic: () => ouvrirFiche(edition) }));
    return;
  }

  const champs = (definitions.fields || []).slice().sort((a, b) => a.position - b.position);
  const choixNotes = [["0", "Pas de note"], ...[1, 2, 3, 4, 5].map((n) => [String(n), etoiles(n)])];
  const saisies = [];   // { instance, champ, controle, avant } : un par champ de chaque exemplaire
  const blocs = (exemplaires.releases || []).map((instance, numero, liste) => {
    const valeurs = {};
    for (const note of instance.notes || []) valeurs[note.field_id] = texteBrut(note.value);

    const lignes = champs.map((champ) => {
      const avant = valeurs[champ.id] || "";
      const controle = champ.type === "dropdown"
        // Discogs refuse de vider une liste par l'API (« not a valid option », 422, constaté le 3/11/2026) :
        // « — » n'est proposé que tant que la liste est vide.
        ? creerListe([...(avant ? [] : [["", "—"]]), ...(champ.options || []).map((o) => [o, o])], avant)
        : creer("textarea", { rows: Math.max(champ.lines || 0, LIGNES_MIN_EDITION) });
      // Champ « Année d’enregistrement (manuelle) » : l'année trouvée automatiquement, en grisé.
      if (memeNom(champ.name, CHAMP_ANNEE_MANUELLE)) controle.placeholder = indicationAnneeAuto(edition);
      // Compteur sous les zones de texte : « 212 / 255 », en rouge au-delà de la limite de Discogs.
      const compteur = champ.type === "dropdown" ? null : creer("span", { classe: "compteur-caracteres" });
      if (compteur) {
        controle.value = avant;
        const compter = () => {
          const longueur = longueurTexte(controle.value);
          compteur.textContent = longueur + " / " + LONGUEUR_MAX_CHAMP;
          compteur.classList.toggle("trop-long", longueur > LONGUEUR_MAX_CHAMP);
        };
        controle.addEventListener("input", () => { ajusterHauteur(controle); compter(); });
        compter();
      }
      saisies.push({ instance, champ: { id: champ.id, nom: champ.name.trim() }, controle, avant });
      return creer("label", { classe: "champ-edition" }, creer("span", { texte: champ.name.trim() }), controle, compteur);
    });

    const avantNote = String(instance.rating || 0);
    const note = creerListe(choixNotes, avantNote);
    saisies.push({ instance, champ: null, controle: note, avant: avantNote });

    return creer("fieldset", {},
      liste.length > 1 ? creer("legend", { texte: "Exemplaire " + (numero + 1) }) : null,
      creer("label", { classe: "champ-edition" }, creer("span", { texte: "Ma note" }), note),
      lignes
    );
  });

  const enregistrer = creer("button", { type: "submit", classe: "bouton bouton-principal", texte: "Enregistrer sur Discogs" });
  message.textContent = "Liens externes : une adresse par ligne, avec un nom facultatif devant (« Diapason | https://… »).";
  zone.append(...blocs, message, creer("div", { classe: "boutons" },
    creer("button", { type: "button", classe: "bouton", texte: "Annuler", surclic: () => ouvrirFiche(edition) }),
    enregistrer
  ));
  zone.querySelectorAll("textarea").forEach(ajusterHauteur);   // un texte déjà long est affiché en entier

  zone.addEventListener("submit", async (evenement) => {
    evenement.preventDefault();
    // Un texte trop long serait refusé par Discogs : on prévient avant d'envoyer quoi que ce soit.
    const tropLongs = saisies.filter((s) => s.champ && longueurTexte(s.controle.value) > LONGUEUR_MAX_CHAMP);
    if (tropLongs.length) {
      message.textContent = "Trop long pour Discogs (" + LONGUEUR_MAX_CHAMP + " caractères au plus) : "
        + [...new Set(tropLongs.map((s) => s.champ.nom))].join(", ") + ". Rien n'a été envoyé.";
      return;
    }
    enregistrer.disabled = true;
    message.textContent = "Enregistrement sur Discogs…";
    const toutes = lireStockage(CLE_MODIFICATIONS, {});
    let erreurEnvoi = null;
    let nbEnvoyes = 0;

    // Seuls les champs changés sont envoyés, un par un (c'est ainsi que Discogs les reçoit).
    for (const saisie of saisies) {
      const valeur = saisie.controle.value;
      if (valeur === saisie.avant) continue;
      const { instance } = saisie;
      const cheminExemplaire = cheminCollection() + "/folders/" + instance.folder_id + "/releases/"
        + edition.release_id + "/instances/" + instance.instance_id;
      try {
        if (saisie.champ) {
          await appelerDiscogs(cheminExemplaire + "/fields/" + saisie.champ.id,
            { method: "POST", body: JSON.stringify({ value: valeur }) });
        } else {
          await appelerDiscogs(cheminExemplaire, { method: "POST", body: JSON.stringify({ rating: Number(valeur) }) });
        }
      } catch (erreur) {
        erreurEnvoi = new Error((saisie.champ ? saisie.champ.nom : "Ma note") + " : " + erreur.message);
        break;
      }
      // On garde la modification sur cet appareil jusqu'à la prochaine synchro.
      const modif = toutes[instance.instance_id] || { champs: {} };
      modif.quand = new Date().toISOString();
      if (saisie.champ) modif.champs[saisie.champ.nom] = valeur;
      else modif.note = Number(valeur);
      toutes[instance.instance_id] = modif;
      saisie.avant = valeur;
      nbEnvoyes++;
    }

    ecrireStockage(CLE_MODIFICATIONS, toutes);
    modifications = toutes;
    if (nbEnvoyes) reconstruire();
    if (erreurEnvoi) {
      message.textContent = erreurEnvoi.message + (nbEnvoyes ? " Les " + nbEnvoyes + " premiers changements sont enregistrés." : "");
      enregistrer.disabled = false;
      return;
    }
    ouvrirFiche(editions.find((e) => e.release_id === edition.release_id) || edition);
  });
}

// ---------------------------------------------------------------------------
// Pistes favorites : un cœur par plage, enregistré dans le champ Discogs « Pistes favorites »
// du premier exemplaire (numéros de plages séparés par des virgules : « 1, 8 »).
// ---------------------------------------------------------------------------

/** ♡ / ♥ d'une plage. Cliquable seulement sur un appareil où le jeton Discogs est enregistré. */
function boutonFavori(plage, edition) {
  return coeur(edition, [plage.position], "Piste favorite");
}

/**
 * ♡ / ♥ d'une œuvre à mouvements (un concerto, une sonate) : plein quand tous ses mouvements sont
 * favoris ; un clic les ajoute tous (ou les retire tous). Seuls les mouvements sont enregistrés.
 */
function boutonFavoriGroupe(groupe, edition) {
  const positions = toutesLesPlages(groupe.sous_plages).map(({ plage }) => plage.position).filter(Boolean);
  return positions.length ? coeur(edition, positions, "Tous les mouvements en favoris") : creer("span");
}

/** Cœur pour une ou plusieurs positions de plages : plein si elles sont toutes favorites. */
function coeur(edition, positions, titreFixe) {
  const tous = (favoris) => positions.every((p) => favoris.has(p));
  if (!jeton()) {
    return tous(edition.favoris) ? creer("span", { classe: "favori actif", texte: "♥", title: titreFixe }) : creer("span");
  }
  const bouton = creer("button", { type: "button", classe: "favori", "data-positions": positions.join("|") });
  const montrer = (oui) => montrerFavori(bouton, oui, positions.length > 1);
  montrer(tous(edition.favoris));
  bouton.addEventListener("click", async () => {
    const voulu = !bouton.classList.contains("actif");
    montrer(voulu);              // réponse immédiate à l'écran…
    bouton.disabled = true;
    try {
      const favoris = await basculerFavori(edition, positions, voulu);
      // Discogs a pu avoir d'autres plages favorites (ajoutées sur un autre appareil) : tous les cœurs suivent,
      // ceux des plages comme ceux des œuvres.
      for (const autre of document.querySelectorAll("#fiche-contenu .favori[data-positions]")) {
        const liste = autre.dataset.positions.split("|");
        montrerFavori(autre, liste.every((p) => favoris.has(p)), liste.length > 1);
      }
    } catch (erreur) {
      montrer(!voulu);           // … annulée si Discogs refuse
      window.alert("Pistes favorites : " + erreur.message);
    }
    bouton.disabled = false;
  });
  return bouton;
}

function montrerFavori(bouton, oui, groupe = false) {
  bouton.textContent = oui ? "♥" : "♡";
  bouton.classList.toggle("actif", oui);
  bouton.title = groupe
    ? (oui ? "Retirer tous les mouvements des pistes favorites" : "Ajouter tous les mouvements aux pistes favorites")
    : (oui ? "Retirer des pistes favorites" : "Ajouter aux pistes favorites");
  bouton.setAttribute("aria-label", bouton.title);
}

let definitionsChamps = null;   // champs personnalisés Discogs, lus une fois par session

/** Ajoute ou retire des plages (une liste de positions) du champ « Pistes favorites » sur Discogs, puis met la page à jour. */
async function basculerFavori(edition, aChanger, ajouter) {
  const { champ, instance, valeurActuelle } = await lireChampDiscogs(edition, CHAMP_FAVORIS);
  const positions = new Set(lirePositions(valeurActuelle));
  for (const position of aChanger) {
    if (ajouter) positions.add(position);
    else positions.delete(position);
  }
  // Rangées dans l'ordre du disque ; une position inconnue de la tracklist reste, à la fin.
  const ordre = toutesLesPlages(edition.plages).map(({ plage }) => plage.position);
  const valeur = [...positions]
    .sort((a, b) => (ordre.indexOf(a) + 1 || 1e6) - (ordre.indexOf(b) + 1 || 1e6))
    .join(", ");
  if (longueurTexte(valeur) > LONGUEUR_MAX_CHAMP) throw new Error("trop de plages pour un champ Discogs (" + LONGUEUR_MAX_CHAMP + " caractères).");

  await ecrireChampDiscogs(edition, champ, instance, valeur);
  // La fiche ouverte garde son objet : on met à jour ses favoris pour les cœurs suivants.
  edition.favoris = new Set(lirePositions(valeur));
  return edition.favoris;
}

/**
 * Relit sur Discogs un champ personnalisé du premier exemplaire d'une édition : la valeur du moment,
 * même si elle a changé depuis la synchro. Renvoie { champ, instance, valeurActuelle }.
 */
async function lireChampDiscogs(edition, nomChamp) {
  const [definitions, exemplaires] = await Promise.all([
    definitionsChamps || appelerDiscogs(cheminCollection() + "/fields"),
    appelerDiscogs(cheminCollection() + "/releases/" + edition.release_id),
  ]);
  definitionsChamps = definitions;
  const champ = (definitions.fields || []).find((c) => memeNom(c.name, nomChamp));
  if (!champ) throw new Error("le champ « " + nomChamp + " » n'existe pas dans tes Custom Fields Discogs.");
  // Le premier exemplaire de l'édition (celui de la fiche, sinon le premier rendu par Discogs).
  const liste = exemplaires.releases || [];
  const instance = liste.find((i) => i.instance_id === edition.exemplaires[0].instance_id) || liste[0];
  if (!instance) throw new Error("exemplaire introuvable sur Discogs.");
  const note = (instance.notes || []).find((n) => n.field_id === champ.id);
  return { champ, instance, valeurActuelle: note ? texteBrut(note.value) : "" };
}

/** Écrit la valeur d'un champ sur Discogs, la garde sur cet appareil jusqu'à la synchro, puis recalcule la page. */
async function ecrireChampDiscogs(edition, champ, instance, valeur) {
  await appelerDiscogs(cheminCollection() + "/folders/" + instance.folder_id + "/releases/" + edition.release_id
    + "/instances/" + instance.instance_id + "/fields/" + champ.id,
    { method: "POST", body: JSON.stringify({ value: valeur }) });

  // Gardée sur cet appareil jusqu'à la prochaine synchro, comme les autres modifications.
  // Rangée sous le nom du champ tel que la synchro l'écrit (celui de Discogs).
  const toutes = lireStockage(CLE_MODIFICATIONS, {});
  const modif = toutes[instance.instance_id] || { champs: {} };
  modif.quand = new Date().toISOString();
  modif.champs[champ.name.trim()] = valeur;
  toutes[instance.instance_id] = modif;
  ecrireStockage(CLE_MODIFICATIONS, toutes);
  modifications = toutes;
  reconstruire();
}

// ---------------------------------------------------------------------------
// Statut : un bouton par choix de la liste Discogs « Statut » (🎧 À écouter, ★ Favori…),
// enregistré sur le premier exemplaire. Un clic sur le bouton actif remet « Aucun ».
// ---------------------------------------------------------------------------

function libelleStatut(statut) {
  const repere = repereStatut(statut);
  return repere ? repere + " " + statut : statut;
}

function boutonsStatut(edition) {
  const boutons = optionsStatut().map((statut) => {
    const bouton = creer("button", { type: "button", classe: "bouton bouton-petit bouton-statut", texte: libelleStatut(statut) });
    bouton.dataset.statut = statut;
    return bouton;
  });
  const montrer = (statut) => {
    for (const bouton of boutons) {
      const actif = memeNom(bouton.dataset.statut, statut);
      bouton.classList.toggle("actif", actif);
      bouton.setAttribute("aria-pressed", actif ? "true" : "false");
      bouton.title = actif ? "Retirer « " + bouton.dataset.statut + " »" : "Marquer « " + bouton.dataset.statut + " »";
    }
  };
  montrer(edition.statut);
  for (const bouton of boutons) {
    bouton.addEventListener("click", async () => {
      const avant = edition.statut;
      const voulu = memeNom(bouton.dataset.statut, avant) ? "" : bouton.dataset.statut;
      montrer(voulu);            // réponse immédiate à l'écran…
      boutons.forEach((b) => { b.disabled = true; });
      try {
        await changerStatut(edition, voulu);
      } catch (erreur) {
        montrer(avant);          // … annulée si Discogs refuse
        window.alert("Statut : " + erreur.message);
      }
      boutons.forEach((b) => { b.disabled = false; });
    });
  }
  return boutons;
}

/** Écrit le statut voulu (ou « Aucun » pour "") dans le champ « Statut » du premier exemplaire. */
async function changerStatut(edition, statut) {
  const resultat = await lireChampDiscogs(edition, CHAMP_STATUT);
  const options = resultat.champ.options || [];
  // La valeur écrite est l'option telle qu'elle est écrite sur Discogs (Discogs n'accepte que ses options).
  const option = options.find((o) => memeNom(o, statut || STATUT_NEUTRE));
  if (!option) {
    throw new Error("l'option « " + (statut || STATUT_NEUTRE) + " » n'existe pas dans la liste « " + CHAMP_STATUT + " » sur Discogs.");
  }
  await ecrireChampDiscogs(edition, resultat.champ, resultat.instance, option);
  edition.statut = statut;       // la fiche ouverte garde son objet
}

// ---------------------------------------------------------------------------
// Grande photo : interrupteur « Grande photo : Discogs » en fin de fiche, enregistré dans le
// champ liste Discogs « Photo principale » (« Discogs » ou « Automatique » : l'API ne sait pas vider une liste).
// ---------------------------------------------------------------------------

function interrupteurPhoto(edition) {
  const bouton = creer("button", { type: "button", classe: "bouton bouton-petit bouton-statut", texte: "Grande photo : Discogs" });
  const montrer = (oui) => {
    bouton.classList.toggle("actif", oui);
    bouton.setAttribute("aria-pressed", oui ? "true" : "false");
    bouton.title = oui ? "Revenir à la photo MusicBrainz en grand" : "Afficher la photo Discogs en grand";
  };
  const remplacerPhotos = () => {
    const ancien = $("fiche").querySelector(".fiche-images");
    const nouveau = blocPhotos(edition);
    ancien.replaceWith(nouveau);
    nouveau.querySelectorAll(".vignettes").forEach((bloc) => bloc.ajuster && bloc.ajuster());
  };
  montrer(edition.photoDiscogs);
  bouton.addEventListener("click", async () => {
    const avant = edition.photoDiscogs;
    const voulu = !avant;
    montrer(voulu);
    bouton.disabled = true;
    try {
      const { champ, instance } = await lireChampDiscogs(edition, CHAMP_PHOTO);
      const option = (champ.options || []).find((o) => memeNom(o, voulu ? PHOTO_DISCOGS : PHOTO_AUTOMATIQUE));
      if (!option) {
        throw new Error("l'option « " + (voulu ? PHOTO_DISCOGS : PHOTO_AUTOMATIQUE) + " » n'existe pas dans la liste « "
          + CHAMP_PHOTO + " » sur Discogs.");
      }
      await ecrireChampDiscogs(edition, champ, instance, option);
      edition.photoDiscogs = voulu;   // la fiche ouverte garde son objet
      remplacerPhotos();
    } catch (erreur) {
      montrer(avant);
      window.alert("Grande photo : " + erreur.message);
    }
    bouton.disabled = false;
  });
  return bouton;
}

/** Réglage du jeton sur cet appareil : on le vérifie auprès de Discogs avant de le garder. */
function brancherReglageJeton() {
  const boite = $("reglage-jeton");
  const saisie = $("jeton-saisie");
  const etatJeton = $("jeton-etat");
  const decrire = () => {
    // Le rappel « Ne pas changer sur Discogs » ne concerne que les appareils qui peuvent modifier.
    $("rappel-discogs").hidden = !jeton();
    etatJeton.textContent = jeton()
      ? "Un jeton est enregistré sur cet appareil : le bouton « Modifier mes Custom Fields Discogs » apparaît dans les fiches."
      : "Aucun jeton sur cet appareil : la page est en lecture seule.";
  };

  $("ouvrir-jeton").addEventListener("click", () => {
    $("filtres").classList.remove("ouvert");   // sur téléphone, on referme le panneau des filtres
    saisie.value = "";
    decrire();
    boite.showModal();
  });
  $("jeton-fermer").addEventListener("click", () => boite.close());
  // Aide de la recherche : bouton « ? » de l'en-tête (ceux de la fiche et de l'onglet Œuvres sont créés avec eux).
  document.querySelectorAll("[data-aide-recherche]").forEach((b) => b.addEventListener("click", () => $("aide-recherche").showModal()));
  $("aide-fermer").addEventListener("click", () => $("aide-recherche").close());
  $("aide-recherche").addEventListener("click", (e) => { if (e.target === $("aide-recherche")) $("aide-recherche").close(); });
  $("jeton-effacer").addEventListener("click", () => {
    ecrireStockage(CLE_JETON, null);
    decrire();
  });
  $("formulaire-jeton").addEventListener("submit", async (evenement) => {
    evenement.preventDefault();
    const essai = saisie.value.trim();
    if (!essai) return;
    etatJeton.textContent = "Vérification auprès de Discogs…";
    try {
      const identite = await appelerDiscogs("/oauth/identity", {}, essai);
      if (identite.username !== infosCollection.utilisateur) {
        etatJeton.textContent = "Ce jeton est celui de « " + identite.username + " », pas de " + infosCollection.utilisateur + ".";
        return;
      }
    } catch (erreur) {
      etatJeton.textContent = erreur.message;
      return;
    }
    if (!ecrireStockage(CLE_JETON, essai)) {
      etatJeton.textContent = "Ce navigateur refuse de garder le jeton (navigation privée ?).";
      return;
    }
    saisie.value = "";
    decrire();
  });
}

// ---------------------------------------------------------------------------
// Branchement des événements
// ---------------------------------------------------------------------------

function brancherEvenements() {
  // Recherche : on attend une pause dans la frappe (DELAI_RECHERCHE) avant de recalculer ;
  // la touche Entrée lance la recherche tout de suite.
  let minuterie = null;
  const lancer = () => { clearTimeout(minuterie); lireControles(); afficher(); };
  $("recherche").addEventListener("input", () => {
    clearTimeout(minuterie);
    minuterie = setTimeout(lancer, DELAI_RECHERCHE);
  });
  $("recherche").addEventListener("keydown", (e) => { if (e.key === "Enter") lancer(); });
  $("recherche").addEventListener("efface", lancer);

  for (const id of ["role-recherche", "tri", "filtre-categorie", "filtre-genre", "filtre-style", "filtre-format",
                    "filtre-label", "filtre-annee-min", "filtre-annee-max", "filtre-enreg-min", "filtre-enreg-max", "filtre-localisation", "filtre-double",
                    "filtre-notes", "filtre-musicbrainz", "filtre-oeuvres", "filtre-oeuvres-incompletes", "filtre-favoris",
                    "filtre-statut", "filtre-enregistrement"]) {
    $(id).addEventListener("change", () => { lireControles(); afficher(); });
  }
  $("filtre-label").addEventListener("input", () => { lireControles(); afficher(); });

  for (const id of ["effacer-filtres", "effacer-filtres-haut", "effacer-filtres-entete"]) {
    $(id).addEventListener("click", () => {
      Object.assign(etat, FILTRES_SEULS_VIDES);
      ecrireControles();
      afficher();
    });
  }

  document.querySelectorAll(".onglet").forEach((bouton) => bouton.addEventListener("click", () => {
    etat.vue = bouton.dataset.vue;
    if (etat.vue === "hasard") tirage = null;   // chaque ouverture de l'onglet = un nouveau tirage
    afficher();
  }));
  // Fenêtre redimensionnée : même tirage, seul le nombre de disques montrés s'adapte.
  window.addEventListener("resize", ajusterHasard);

  // Panneau des filtres sur téléphone
  $("ouvrir-filtres").addEventListener("click", () => $("filtres").classList.add("ouvert"));
  $("fermer-filtres").addEventListener("click", () => $("filtres").classList.remove("ouvert"));
  document.querySelector(".contenu").addEventListener("click", () => $("filtres").classList.remove("ouvert"));

  // Fiche : bouton de fermeture, et clic sur le fond sombre autour
  $("fermer-fiche").addEventListener("click", () => $("fiche").close());
  $("fiche").addEventListener("click", (evenement) => {
    if (evenement.target === $("fiche")) $("fiche").close();
  });
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

brancherEvenements();
brancherVisionneuse();
// L'en-tête change de hauteur selon la largeur de l'écran (une ou deux lignes).
new ResizeObserver(noterHauteurEntete).observe(document.querySelector(".entete"));
brancherReglageJeton();
for (const id of ["recherche", "filtre-label"]) ajouterCroix($(id));
$("rappel-discogs").hidden = !jeton();   // rappel visible seulement avec un jeton
chargerCollection();

// Application installable (PWA) : le service worker n'est actif qu'en https,
// donc une fois le site en ligne sur GitHub Pages (étape 3), pas en test local.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("service-worker.js").then((inscription) => {
    // Sur iPhone, l'app de l'écran d'accueil est souvent reprise là où on l'avait
    // laissée, sans être relancée : à chaque retour, on demande s'il y a du nouveau.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") inscription.update();
    });
  });

  // Quand une nouvelle version prend le relais, on recharge la page pour l'afficher.
  // Pas au tout premier lancement (rien à remplacer), et pas en pleine fiche :
  // on attend qu'elle soit fermée, pour ne pas perdre une modification en cours.
  let dejaControlee = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!dejaControlee) {
      dejaControlee = true;
      return;
    }
    if ($("fiche").open) $("fiche").addEventListener("close", () => location.reload(), { once: true });
    else location.reload();
  });
}
