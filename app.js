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
const SANS_CATEGORIE = "Sans catégorie";      // exemplaires rangés dans aucun dossier Discogs
const ZOOM = 2.5;                             // grossissement de la visionneuse
const LIGNES_MIN_EDITION = 4;                 // hauteur minimale des zones de texte du formulaire
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

// Regroupement des formats Discogs pour le filtre et les statistiques (choix du 29/10/2026) :
// pas de DVD seul ni de vinyle dans la collection. Le JSON garde les formats exacts de Discogs.
const REGROUPEMENT_FORMATS = {
  "DVD": "CD + DVD",
  "All Media": "CD + DVD",
  "Vinyl": "CD",      // un CD que Discogs ne connaissait qu'en vinyle
};
const formatRegroupe = (nom) => REGROUPEMENT_FORMATS[nom] || nom;

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
  localisation: "",
  double: false,
  avecNotes: false,
  oeuvre: null,             // œuvre MusicBrainz choisie : { id, titre, compositeur }
  blocIndex: "compositeurs", // bloc affiché dans l'onglet Index
};

// Recherche et filtres remis à zéro (bouton « Tout effacer », clic dans l'index).
const FILTRES_VIDES = {
  categorie: "", genre: "", style: "", format: "", label: "", anneeMin: null, anneeMax: null,
  localisation: "", double: false, avecNotes: false, oeuvre: null, recherche: "", role: "partout",
};

// Raccourci pour trouver un élément de la page par son identifiant.
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Petits outils
// ---------------------------------------------------------------------------

/** Met en minuscules et retire les accents : « Dvořák » -> « dvorak ». */
function normaliser(texte) {
  return String(texte || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
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

/** Valeurs d'un champ pour tous les exemplaires d'une édition, sans répétition. */
function valeursDuChamp(edition, nomChamp) {
  return [...new Set(edition.exemplaires.map((e) => (e.champs[nomChamp] || "").trim()).filter(Boolean))];
}

/** « ★★★★☆ » pour une note sur 5. */
function etoiles(note) {
  return "★".repeat(note) + "☆".repeat(5 - note);
}

/** Décrit les formats : « Box Set + 5 × CD (Album, Remastered) ». */
function decrireFormats(formats) {
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
    // Catégories (dossiers Discogs) des exemplaires : en général une seule.
    edition.categories = [...new Set(edition.exemplaires.map((e) => e.categorie_perso || SANS_CATEGORIE))];
    edition.oeuvres = oeuvresDeLEdition(edition.plages || []);
    edition.index = construireIndexRecherche(edition);
    return edition;
  });
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
 * On garde l'œuvre de chaque plage (le mouvement) et son œuvre parente (le concerto) :
 * selon les disques, MusicBrainz relie la plage à l'une ou à l'autre.
 */
function oeuvresDeLEdition(plages) {
  const oeuvres = new Map();
  for (const plage of plages) {
    if (plage.oeuvre) {
      for (const o of [plage.oeuvre, plage.oeuvre.parente].filter(Boolean)) {
        if (!oeuvres.has(o.id)) oeuvres.set(o.id, { id: o.id, titre: o.titre, compositeur: plage.oeuvre.compositeur });
      }
    }
    for (const [id, o] of oeuvresDeLEdition(plage.sous_plages || [])) {
      if (!oeuvres.has(id)) oeuvres.set(id, o);
    }
  }
  return oeuvres;
}

/** L'œuvre à afficher pour une plage : l'œuvre parente s'il y en a une (le concerto plutôt que le mouvement). */
function oeuvreDeReference(oeuvre) {
  const reference = oeuvre.parente || oeuvre;
  return { id: reference.id, titre: reference.titre, compositeur: oeuvre.compositeur };
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
  format: (e) => (e.formats || []).map((f) => formatRegroupe(f.nom)),
  label: (e) => (e.labels || []).map((l) => l.nom),
  localisation: (e) => e.localisations,
};

function remplirListe(select, compte, libelleTous) {
  const valeurs = [...compte.keys()].sort(comparerTextes);
  select.replaceChildren(
    creer("option", { value: "", texte: libelleTous }),
    ...valeurs.map((v) => creer("option", { value: v, texte: v + " (" + compte.get(v) + ")" }))
  );
}

function remplirFiltres() {
  remplirListe($("filtre-categorie"), compter(editions, EXTRACTEURS.categorie), "Toutes");
  remplirListe($("filtre-genre"), compter(editions, EXTRACTEURS.genre), "Tous");
  remplirListe($("filtre-style"), compter(editions, EXTRACTEURS.style), "Tous");
  remplirListe($("filtre-format"), compter(editions, EXTRACTEURS.format), "Tous");
  remplirListe($("filtre-localisation"), compter(editions, EXTRACTEURS.localisation), "Toutes");

  // Les labels sont nombreux : liste de suggestions pour la saisie.
  const labels = [...compter(editions, EXTRACTEURS.label).keys()].sort(comparerTextes);
  $("liste-labels").replaceChildren(...labels.map((l) => creer("option", { value: l })));

  // Sélecteur « Chercher dans » : seulement les catégories présentes dans la collection.
  const roles = [
    ["partout", "Partout"],
    ["titre", "Titre"],
    ["artistes_principaux", "Artiste principal"],
    ...CATEGORIES_PERSONNES
      .filter(({ cle }) => editions.some((e) => (e[cle] || []).length))
      .map(({ cle, libelle }) => [cle, libelle]),
    ["labels", "Label"],
    ...(editions.some((e) => (e.plages || []).length) ? [["plages", "Titres des plages"]] : []),
    ...(editions.some((e) => e.oeuvres.size) ? [["oeuvres", "Œuvres"]] : []),
  ];
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
  etat.localisation = $("filtre-localisation").value;
  etat.double = $("filtre-double").checked;
  etat.avecNotes = $("filtre-notes").checked;
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
  $("filtre-localisation").value = etat.localisation;
  $("filtre-double").checked = etat.double;
  $("filtre-notes").checked = etat.avecNotes;
}

function nombreDeFiltresActifs() {
  return [etat.categorie, etat.genre, etat.style, etat.format, etat.label, etat.anneeMin, etat.anneeMax,
          etat.localisation, etat.double, etat.avecNotes, etat.oeuvre].filter(Boolean).length;
}

/** Vrai si l'édition passe la recherche et tous les filtres. */
function correspond(edition) {
  if (etat.recherche) {
    const texte = edition.index[etat.role] || "";
    // Chaque mot tapé doit être présent : « bach gould » trouve Bach joué par Gould.
    const mots = normaliser(etat.recherche).split(/\s+/);
    if (!mots.every((mot) => texte.includes(mot))) return false;
  }
  if (etat.categorie && !edition.categories.includes(etat.categorie)) return false;
  if (etat.genre && !(edition.genres || []).includes(etat.genre)) return false;
  if (etat.style && !(edition.styles || []).includes(etat.style)) return false;
  if (etat.format && !(edition.formats || []).some((f) => formatRegroupe(f.nom) === etat.format)) return false;
  if (etat.label && !(edition.labels || []).some((l) => normaliser(l.nom).includes(normaliser(etat.label)))) return false;
  if ((etat.anneeMin || etat.anneeMax) && !edition.annee) return false;
  if (etat.anneeMin && edition.annee < etat.anneeMin) return false;
  if (etat.anneeMax && edition.annee > etat.anneeMax) return false;
  if (etat.localisation && !edition.localisations.includes(etat.localisation)) return false;
  if (etat.double && edition.exemplaires.length < 2) return false;
  if (etat.avecNotes && !edition.notesPerso.length) return false;
  if (etat.oeuvre && !edition.oeuvres.has(etat.oeuvre.id)) return false;
  return true;
}

/** Ordre d'affichage selon le tri choisi. Les valeurs manquantes vont à la fin. */
function trier(liste) {
  const premier = (valeurs) => (valeurs && valeurs[0]) || "";
  const avecVide = (a, b, comparer) => (!a && !b ? 0 : !a ? 1 : !b ? -1 : comparer(a, b));
  const parTitre = (a, b) => comparerTextes(a.titre, b.titre);

  const comparateurs = {
    artiste: (a, b) => avecVide(premier(a.artistes_principaux), premier(b.artistes_principaux), comparerTextes) || parTitre(a, b),
    compositeur: (a, b) => avecVide(premier(a.compositeurs), premier(b.compositeurs), comparerTextes) || parTitre(a, b),
    titre: parTitre,
    annee: (a, b) => avecVide(a.annee, b.annee, (x, y) => x - y) || parTitre(a, b),
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
  const resultats = trier(editions.filter(correspond));

  // Compteur en haut : « 42 éditions sur 355 · 358 exemplaires »
  const nbExemplaires = editions.reduce((total, e) => total + e.exemplaires.length, 0);
  $("compteur").textContent = resultats.length === editions.length
    ? pluriel(editions.length, "édition") + " · " + pluriel(nbExemplaires, "exemplaire")
    : resultats.length + " sur " + pluriel(editions.length, "édition");

  const nbFiltres = nombreDeFiltresActifs();
  $("nb-filtres").textContent = nbFiltres;
  $("nb-filtres").hidden = nbFiltres === 0;

  afficherMessage(resultats.length ? "" : "Aucun disque ne correspond à ces critères.");
  afficherBandeau(resultats.length);

  $("vue-collection").hidden = etat.vue !== "collection";
  $("vue-statistiques").hidden = etat.vue !== "statistiques";
  $("vue-index").hidden = etat.vue !== "index";
  document.querySelectorAll(".onglet").forEach((b) => b.classList.toggle("actif", b.dataset.vue === etat.vue));

  if (etat.vue === "collection") afficherGrille(resultats);
  else if (etat.vue === "statistiques") afficherStatistiques(resultats);
  else afficherIndex();
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
  const origine = retour && (retour.edition ? "à la fiche" : retour.etat.vue === "index" ? "à l'index" : "aux statistiques");
  $("bandeau-oeuvre").replaceChildren(
    retour ? creer("button", { type: "button", classe: "bouton bouton-revenir", texte: "← Revenir " + origine, surclic: revenir }) : null,
    ...(etat.oeuvre
      ? [creer("span", { texte: "Œuvre : " }), creer("strong", { texte: nomOeuvre(etat.oeuvre) })]
      : [creer("strong", { texte: retour.libelle })]),
    creer("span", { classe: "discret", texte: " · " + pluriel(nombre, "édition") + " dans ma cédéthèque" })
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

/** Catégories à afficher : on ne montre pas « Sans catégorie » sur les vignettes et la fiche. */
function categoriesChoisies(edition) {
  return edition.categories.filter((c) => c !== SANS_CATEGORIE);
}

function afficherGrille(liste) {
  const cartes = liste.map((edition) => {
    const image = edition.pochette || edition.miniature;
    const nb = edition.exemplaires.length;
    const categories = categoriesChoisies(edition);
    return creer("button", { classe: "carte", type: "button", surclic: () => ouvrirFiche(edition) },
      creer("div", { classe: "pochette" },
        image
          ? creer("img", { src: image, alt: "", loading: "lazy", decoding: "async" })
          : creer("span", { classe: "sans-image", texte: "♪" }),
        nb > 1 ? creer("span", { classe: "badge", texte: "×" + nb, title: nb + " exemplaires" }) : null,
        edition.notesPerso.length ? creer("span", { classe: "repere-notes", texte: "✎", title: "Notes personnelles" }) : null
      ),
      creer("p", { classe: "carte-titre", texte: edition.titre }),
      creer("p", { classe: "carte-artiste", texte: (edition.artistes_principaux || []).join(", ") }),
      categories.length ? creer("p", { classe: "carte-categorie", texte: categories.join(" · ") }) : null
    );
  });
  $("vue-collection").replaceChildren(...cartes);
}

// ---------------------------------------------------------------------------
// Fiche détaillée
// ---------------------------------------------------------------------------

/** Clic sur un nom dans une fiche : on lance la recherche sur ce nom, dans ce rôle. */
function chercherNom(nom, role) {
  Object.assign(etat, { recherche: nom, role, vue: "collection" });
  ecrireControles();
  $("fiche").close();
  afficher();
  window.scrollTo({ top: 0 });
}

function ouvrirFiche(edition) {
  // Images : celles de la fiche complète, sinon la pochette seule.
  const images = (edition.images && edition.images.length)
    ? edition.images
    : [{ url: edition.pochette, miniature: edition.miniature }].filter((i) => i.url);

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

  // Les images par source, chacune avec sa légende : MusicBrainz d'abord, puis Discogs.
  // Une seule image en tout : pas de miniatures, juste la légende sous la grande image.
  const sources = [
    ["MusicBrainz", images.map((image, numero) => [image, numero]).filter(([image]) => image.type === "musicbrainz")],
    ["Discogs", images.map((image, numero) => [image, numero]).filter(([image]) => image.type !== "musicbrainz")],
  ].filter(([, liste]) => liste.length);
  const groupesImages = sources.map(([source, liste]) => [
    creer("p", { classe: "legende-photos", texte: "photos " + source }),
    images.length > 1 ? creer("div", { classe: "vignettes" }, liste.map(([image, numero]) => vignette(image, numero))) : null,
  ]);

  const informations = [
    ["Catégorie", categoriesChoisies(edition).join(" · ")],
    ["Année", edition.annee || "inconnue"],
    ["Label", (edition.labels || []).map((l) => l.nom + (l.catno ? " – " + l.catno : "")).join(" ; ")],
    ["Format", decrireFormatsFiche(edition.formats)],
    ["Genres", (edition.genres || []).join(", ")],
    ["Styles", (edition.styles || []).join(", ")],
  ].filter(([, valeur]) => valeur);

  const sectionsPersonnes = CATEGORIES_PERSONNES
    .filter(({ cle }) => (edition[cle] || []).length)
    .map(({ cle, libelle }) => [
      creer("h3", { texte: libelle }),
      creer("div", { classe: "noms" },
        edition[cle].map((nom) => creer("button", {
          type: "button", classe: "nom", texte: nom, title: "Chercher " + nom + " (" + libelle.toLowerCase() + ")",
          surclic: () => chercherNom(nom, cle),
        }))
      ),
    ]);

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
  const champsAPart = [CHAMP_LOCALISATION, CHAMP_NOTES_PERSO, CHAMP_LIENS];
  const exemplaires = edition.exemplaires.map((exemplaire, numero) => {
    const autresChamps = Object.entries(exemplaire.champs).filter(([nom]) => !champsAPart.includes(nom));
    return creer("li", {},
      creer("strong", { texte: exemplaire.champs[CHAMP_LOCALISATION] || "Localisation non renseignée" }),
      edition.exemplaires.length > 1 ? creer("span", { classe: "discret", texte: "  (exemplaire " + (numero + 1) + ")" }) : null,
      autresChamps.map(([nom, valeur]) => creer("div", {}, creer("span", { classe: "discret", texte: nom + " : " }), texteAvecLiens(valeur))),
      exemplaire.date_ajout ? creer("div", { classe: "discret", texte: "Ajouté le " + formaterDate(exemplaire.date_ajout) }) : null,
      exemplaire.modifie_le ? creer("div", { classe: "discret", texte: "Modifié ici le " + formaterDate(exemplaire.modifie_le)
        + " : visible sur les autres appareils après la synchro de la nuit" }) : null
    );
  });

  $("fiche-contenu").replaceChildren(
    creer("div", { classe: "fiche-corps" },
      creer("div", { classe: "fiche-images" }, grande, groupesImages),
      creer("div", {},
        creer("h2", { id: "fiche-titre", texte: edition.titre }),
        creer("p", { classe: "sous-titre" },
          (edition.artistes_principaux || []).map((nom, i) => [
            i ? ", " : "",
            creer("button", { type: "button", classe: "bouton-texte", texte: nom, surclic: () => chercherNom(nom, "artistes_principaux") }),
          ])
        ),
        notes.length ? creer("p", { classe: "notes-album", texte: notes.join("  ·  ") }) : null,
        // Bouton visible seulement sur un appareil où le jeton Discogs est enregistré.
        jeton() ? creer("p", {}, creer("button", { type: "button", classe: "bouton", texte: "✎ Modifier",
          surclic: () => ouvrirEdition(edition) })) : null,
        creer("dl", {}, informations.map(([terme, valeur]) => [creer("dt", { texte: terme }), creer("dd", { texte: valeur })])),
        edition.notesPerso.length ? [
          creer("h3", { texte: "Notes personnelles" }),
          edition.notesPerso.map((texte) => creer("div", { classe: "notes-perso" }, texteAvecLiens(texte))),
        ] : null,
        liens.length ? [
          creer("h3", { texte: "Liens externes" }),
          creer("ul", { classe: "liens-externes" }, liens.map((l) => creer("li", {}, creerLien(l.adresse, l.nom + " ↗")))),
        ] : null,
        sectionsPersonnes,
        creer("h3", { texte: edition.exemplaires.length > 1 ? "Mes exemplaires" : "Mon exemplaire" }),
        creer("ul", { classe: "exemplaires" }, exemplaires),
        (edition.plages || []).length ? [creer("h3", { texte: "Plages" }), listePlages(edition.plages, { precedente: null, edition })] : null,
        creer("p", { classe: "liens-bases" },
          creer("a", { classe: "lien-discogs", href: edition.url_discogs, target: "_blank", rel: "noopener", texte: "Voir sur Discogs ↗" }),
          edition.musicbrainz ? creer("a", { classe: "lien-discogs", href: edition.musicbrainz, target: "_blank", rel: "noopener",
            texte: "Voir sur MusicBrainz ↗" }) : null
        )
      )
    )
  );
  $("fiche").showModal();
  $("fiche").scrollTop = 0;
}

/**
 * Tracklist : intertitres, plages, et mouvements d'une œuvre en retrait.
 * `suivi.precedente` : identifiant de la dernière œuvre MusicBrainz affichée, pour ne
 * l'écrire qu'une fois sur une suite de mouvements de la même œuvre ; `suivi.edition` : la fiche.
 */
function listePlages(plages, suivi) {
  return creer("ol", { classe: "plages" }, plages.map((plage) => lignePlage(plage, suivi)));
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

function lignePlage(plage, suivi) {
  if (plage.type === "intertitre") return creer("li", { classe: "plage-intertitre", texte: plage.titre });
  const artistes = plage.artistes || [];
  // Le compositeur est déjà dans la ligne de l'œuvre MusicBrainz : on ne le répète pas dans les crédits.
  const oeuvre = oeuvreDeLaPlage(plage);
  const credits = (plage.credits || []).filter((c) => !(oeuvre && oeuvre.compositeur && estCreditDeCompositeur(c)));
  return creer("li", { classe: plage.type === "oeuvre" ? "plage plage-oeuvre" : "plage" },
    creer("span", { classe: "plage-position", texte: plage.position }),
    creer("div", {},
      creer("div", { classe: "plage-titre", texte: plage.titre }),
      artistes.length ? creer("div", { classe: "plage-artistes", texte: artistes.join(", ") }) : null,
      // Crédits au format Discogs : « Piano – Glenn Gould · Conductor – Herbert von Karajan »
      credits.length ? creer("div", { classe: "plage-credits", texte: credits.map((c) => c.role + " – " + c.nom).join(" · ") }) : null,
      ligneOeuvre(plage, suivi)
    ),
    creer("span", { classe: "plage-duree", texte: plage.duree }),
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
  return [
    ["titre", "Titres"],
    ["artistes_principaux", "Artistes principaux"],
    ...CATEGORIES_PERSONNES.filter(({ cle }) => editions.some((e) => (e[cle] || []).length)).map(({ cle, libelle }) => [cle, libelle]),
    ...(editions.some((e) => e.oeuvres.size) ? [["oeuvres", "Œuvres"]] : []),
    ["labels", "Labels"],
  ];
}

/** Entrées d'un bloc : [{ libelle, nombre, cle, clic }]. */
function entreesIndex(bloc) {
  if (bloc === "titre") {
    return editions.map((edition) => ({
      libelle: edition.titre, nombre: null, cle: cleDeTri(edition.titre, false),
      detail: (edition.artistes_principaux || []).join(", "), clic: () => ouvrirFiche(edition),
    }));
  }
  if (bloc === "oeuvres") {
    const parId = new Map();
    for (const edition of editions) {
      for (const oeuvre of edition.oeuvres.values()) {
        if (!parId.has(oeuvre.id)) parId.set(oeuvre.id, { oeuvre, nombre: 0 });
        parId.get(oeuvre.id).nombre += 1;
      }
    }
    return [...parId.values()].map(({ oeuvre, nombre }) => ({
      libelle: nomOeuvre(oeuvre), nombre, cle: cleDeTri(oeuvre.titre, false),
      clic: () => allerVers({ ...FILTRES_VIDES, oeuvre }),
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
  if (!blocs.some(([cle]) => cle === etat.blocIndex)) etat.blocIndex = "compositeurs";
  const entrees = entreesIndex(etat.blocIndex).sort((a, b) => comparerTextes(a.cle, b.cle) || comparerTextes(a.libelle, b.libelle));

  // Regroupement par lettre, dans l'ordre : « # » d'abord, puis A à Z.
  const parLettre = new Map();
  for (const entree of entrees) {
    const lettre = lettreIndex(entree.cle);
    if (!parLettre.has(lettre)) parLettre.set(lettre, []);
    parLettre.get(lettre).push(entree);
  }
  const lettres = [...parLettre.keys()].sort((a, b) => (a === "#" ? -1 : b === "#" ? 1 : a.localeCompare(b)));

  const choix = creer("select", { id: "bloc-index", "aria-label": "Bloc de l'index" },
    blocs.map(([cle, libelle]) => creer("option", { value: cle, selected: cle === etat.blocIndex,
      texte: libelle + " (" + entreesIndex(cle).length.toLocaleString("fr-FR") + ")" })));
  choix.addEventListener("change", () => { etat.blocIndex = choix.value; afficher(); window.scrollTo({ top: 0 }); });

  $("vue-index").replaceChildren(
    creer("div", { classe: "index-entete" },
      choix,
      creer("nav", { classe: "index-lettres", "aria-label": "Lettres" }, lettres.map((lettre) =>
        creer("button", { type: "button", classe: "bouton-texte", texte: lettre,
          surclic: () => $("lettre-" + lettre).scrollIntoView({ behavior: "smooth", block: "start" }) })))
    ),
    ...lettres.map((lettre) => creer("section", { classe: "index-lettre" },
      creer("h3", { id: "lettre-" + lettre, texte: lettre }),
      creer("p", { classe: "index-noms" }, parLettre.get(lettre).map((entree, numero) => [
        numero ? creer("span", { classe: "index-separateur", texte: " · " }) : null,
        creer("button", { type: "button", classe: "index-nom", surclic: entree.clic,
          title: entree.detail || null },
          entree.libelle,
          entree.nombre ? creer("span", { classe: "discret", texte: " (" + entree.nombre + ")" }) : null,
          entree.detail ? creer("span", { classe: "discret", texte: " – " + entree.detail }) : null),
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
    note ? creer("p", { classe: "note-stat", texte: note }) : null,
    toutes.length ? [barres, bouton] : creer("p", { classe: "note-stat", texte: "Aucune donnée." })
  );
}

/** Histogramme des années d'édition, une colonne par année. */
function carteAnnees(liste) {
  const compte = compter(liste, (e) => (e.annee ? [e.annee] : []));
  const sansAnnee = liste.filter((e) => !e.annee).length;
  const annees = [...compte.keys()];
  const carte = creer("section", { classe: "carte-stat large" },
    creer("h2", { texte: "Années d'édition" }),
    creer("p", { classe: "note-stat", texte: "Année de ton édition, pas de l'œuvre. " +
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
      surclic: () => { Object.assign(etat, { anneeMin: annee, anneeMax: annee, vue: "collection" }); ecrireControles(); afficher(); },
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
        chiffre(compositeurs.size, "compositeurs"),
        chiffre(interpretes.size, "interprètes")
      ),
      creer("p", { classe: "note-stat", texte: synchro + " Les statistiques portent sur les disques affichés (filtres et recherche compris)." })
    ),
    carteAnnees(liste),
    carteBarres("Catégories", "Dossier Discogs (Custom Field)", compter(liste, EXTRACTEURS.categorie), 20, appliquer("categorie")),
    carteBarres("Genres", "Genres Discogs", compter(liste, EXTRACTEURS.genre), 15, appliquer("genre")),
    carteBarres("Localisation", "", compter(liste, EXTRACTEURS.localisation), 15, appliquer("localisation")),
    carteBarres("Formats", "", compter(liste, EXTRACTEURS.format), 10, appliquer("format")),
    carteBarres("Compositeurs les plus présents", "Les 15 premiers", compositeurs, 15, (nom) => chercherNomSansFiche(nom, "compositeurs"),
      (n) => "Voir les " + n + " compositeurs présents sur au moins 2 éditions"),
    carteBarres("Interprètes les plus présents", "Les 15 premiers", interpretes, 15, (nom) => chercherNomSansFiche(nom, "interpretes"),
      (n) => "Voir les " + n + " interprètes présents sur au moins 2 éditions"),
    ...(oeuvresEnPlusieursVersions.size ? [carteBarres("Œuvres en plusieurs versions", "Les 15 premières, d'après MusicBrainz",
      oeuvresEnPlusieursVersions, 15, (nom) => choisirOeuvre(oeuvresParNom.get(nom)),
      (n) => "Voir les " + n + " œuvres présentes sur au moins 2 éditions")] : []),
    carteBarres("Labels", "Les 15 premiers", compter(liste, EXTRACTEURS.label), 15, appliquer("label"),
      (n) => "Voir les " + n + " labels ayant au moins 2 éditions")
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
  if (!reponse.ok) throw new Error("Discogs a répondu par une erreur (code " + reponse.status + ").");
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

/**
 * La zone de texte grandit avec son contenu : sur iPhone, on ne peut pas
 * l'agrandir à la main comme sur le Mac.
 */
function ajusterHauteur(zoneTexte) {
  zoneTexte.style.height = "auto";   // on la laisse d'abord revenir à sa hauteur minimale
  zoneTexte.style.height = (zoneTexte.scrollHeight + 2) + "px";
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
        ? creerListe([["", "—"], ...(champ.options || []).map((o) => [o, o])], avant)
        : creer("textarea", { rows: Math.max(champ.lines || 0, LIGNES_MIN_EDITION) });
      if (champ.type !== "dropdown") controle.addEventListener("input", () => ajusterHauteur(controle));
      if (champ.type !== "dropdown") controle.value = avant;
      saisies.push({ instance, champ: { id: champ.id, nom: champ.name.trim() }, controle, avant });
      return creer("label", { classe: "champ-edition" }, creer("span", { texte: champ.name.trim() }), controle);
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
        erreurEnvoi = erreur;
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

/** Réglage du jeton sur cet appareil : on le vérifie auprès de Discogs avant de le garder. */
function brancherReglageJeton() {
  const boite = $("reglage-jeton");
  const saisie = $("jeton-saisie");
  const etatJeton = $("jeton-etat");
  const decrire = () => {
    etatJeton.textContent = jeton()
      ? "Un jeton est enregistré sur cet appareil : le bouton « Modifier » apparaît dans les fiches."
      : "Aucun jeton sur cet appareil : la page est en lecture seule.";
  };

  $("ouvrir-jeton").addEventListener("click", () => {
    $("filtres").classList.remove("ouvert");   // sur téléphone, on referme le panneau des filtres
    saisie.value = "";
    decrire();
    boite.showModal();
  });
  $("jeton-fermer").addEventListener("click", () => boite.close());
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
  // Recherche : on attend une courte pause dans la frappe avant de recalculer.
  let minuterie = null;
  $("recherche").addEventListener("input", () => {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => { lireControles(); afficher(); }, 150);
  });

  for (const id of ["role-recherche", "tri", "filtre-categorie", "filtre-genre", "filtre-style", "filtre-format",
                    "filtre-label", "filtre-annee-min", "filtre-annee-max", "filtre-localisation", "filtre-double",
                    "filtre-notes"]) {
    $(id).addEventListener("change", () => { lireControles(); afficher(); });
  }
  $("filtre-label").addEventListener("input", () => { lireControles(); afficher(); });

  $("effacer-filtres").addEventListener("click", () => {
    Object.assign(etat, FILTRES_VIDES);
    ecrireControles();
    afficher();
  });

  document.querySelectorAll(".onglet").forEach((bouton) => bouton.addEventListener("click", () => {
    etat.vue = bouton.dataset.vue;
    afficher();
  }));

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
brancherReglageJeton();
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
