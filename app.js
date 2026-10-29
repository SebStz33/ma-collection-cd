/* ==========================================================================
   Ma collection de CD — le comportement de la page
   Lit data/collection.json (écrit par scripts/sync.py), puis affiche la grille,
   applique la recherche, les filtres et le tri, ouvre les fiches et calcule les
   statistiques. Tout se passe dans le navigateur, sans rappeler Discogs.
   ========================================================================== */

"use strict";

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

const FICHIER_COLLECTION = "data/collection.json";
const CHAMP_LOCALISATION = "Localisation";   // nom du champ personnalisé Discogs

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

// Formats Discogs qui sont des emballages et non des disques (pour le comptage).
const FORMATS_EMBALLAGE = ["Box Set", "All Media"];

// ---------------------------------------------------------------------------
// État de la page : les données et les choix de l'utilisateur
// ---------------------------------------------------------------------------

let editions = [];        // un élément par édition (release_id), exemplaires regroupés
let infosCollection = {}; // en-tête du fichier : utilisateur, date de génération…

const etat = {
  vue: "collection",
  recherche: "",
  role: "partout",
  tri: "artiste",
  genre: "",
  style: "",
  format: "",
  label: "",
  anneeMin: null,
  anneeMax: null,
  localisation: "",
  double: false,
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

/** Décrit les formats : « Box Set + 5 × CD (Album, Remastered) ». */
function decrireFormats(formats) {
  return (formats || []).map((f) => {
    const quantite = f.quantite > 1 ? f.quantite + " × " : "";
    const details = f.descriptions && f.descriptions.length ? " (" + f.descriptions.join(", ") + ")" : "";
    return quantite + f.nom + details;
  }).join(" + ");
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
    const exemplaire = {
      instance_id: disque.instance_id,
      champs: disque.champs || {},
      date_ajout: disque.date_ajout,
      note: disque.note,
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
    edition.localisations = [...new Set(
      edition.exemplaires.map((e) => (e.champs[CHAMP_LOCALISATION] || "").trim()).filter(Boolean)
    )];
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
  };
  for (const { cle } of CATEGORIES_PERSONNES) {
    index[cle] = normaliser((edition[cle] || []).join(" | "));
  }
  const notes = edition.exemplaires.map((e) => Object.values(e.champs).join(" ")).join(" ");
  index.partout = Object.values(index).join(" | ") + " | " + normaliser(notes);
  return index;
}

async function chargerCollection() {
  afficherMessage("Chargement de la collection…");
  try {
    // « no-cache » : le navigateur vérifie toujours s'il existe une version plus récente.
    const reponse = await fetch(FICHIER_COLLECTION, { cache: "no-cache" });
    if (!reponse.ok) throw new Error("code " + reponse.status);
    const donnees = await reponse.json();
    infosCollection = donnees;
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
  genre: (e) => e.genres || [],
  style: (e) => e.styles || [],
  format: (e) => (e.formats || []).map((f) => f.nom),
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
  ];
  $("role-recherche").replaceChildren(...roles.map(([v, t]) => creer("option", { value: v, texte: t })));
}

/** Lit les champs de la page et met à jour l'état. */
function lireControles() {
  etat.recherche = $("recherche").value.trim();
  etat.role = $("role-recherche").value;
  etat.tri = $("tri").value;
  etat.genre = $("filtre-genre").value;
  etat.style = $("filtre-style").value;
  etat.format = $("filtre-format").value;
  etat.label = $("filtre-label").value.trim();
  etat.anneeMin = parseInt($("filtre-annee-min").value, 10) || null;
  etat.anneeMax = parseInt($("filtre-annee-max").value, 10) || null;
  etat.localisation = $("filtre-localisation").value;
  etat.double = $("filtre-double").checked;
}

/** Recopie l'état dans les champs (quand le code change un filtre, par un clic sur un nom par ex.). */
function ecrireControles() {
  $("recherche").value = etat.recherche;
  $("role-recherche").value = etat.role;
  $("tri").value = etat.tri;
  $("filtre-genre").value = etat.genre;
  $("filtre-style").value = etat.style;
  $("filtre-format").value = etat.format;
  $("filtre-label").value = etat.label;
  $("filtre-annee-min").value = etat.anneeMin || "";
  $("filtre-annee-max").value = etat.anneeMax || "";
  $("filtre-localisation").value = etat.localisation;
  $("filtre-double").checked = etat.double;
}

function nombreDeFiltresActifs() {
  return [etat.genre, etat.style, etat.format, etat.label, etat.anneeMin, etat.anneeMax,
          etat.localisation, etat.double].filter(Boolean).length;
}

/** Vrai si l'édition passe la recherche et tous les filtres. */
function correspond(edition) {
  if (etat.recherche) {
    const texte = edition.index[etat.role] || "";
    // Chaque mot tapé doit être présent : « bach gould » trouve Bach joué par Gould.
    const mots = normaliser(etat.recherche).split(/\s+/);
    if (!mots.every((mot) => texte.includes(mot))) return false;
  }
  if (etat.genre && !(edition.genres || []).includes(etat.genre)) return false;
  if (etat.style && !(edition.styles || []).includes(etat.style)) return false;
  if (etat.format && !(edition.formats || []).some((f) => f.nom === etat.format)) return false;
  if (etat.label && !(edition.labels || []).some((l) => normaliser(l.nom).includes(normaliser(etat.label)))) return false;
  if ((etat.anneeMin || etat.anneeMax) && !edition.annee) return false;
  if (etat.anneeMin && edition.annee < etat.anneeMin) return false;
  if (etat.anneeMax && edition.annee > etat.anneeMax) return false;
  if (etat.localisation && !edition.localisations.includes(etat.localisation)) return false;
  if (etat.double && edition.exemplaires.length < 2) return false;
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

  $("vue-collection").hidden = etat.vue !== "collection";
  $("vue-statistiques").hidden = etat.vue !== "statistiques";
  document.querySelectorAll(".onglet").forEach((b) => b.classList.toggle("actif", b.dataset.vue === etat.vue));

  if (etat.vue === "collection") afficherGrille(resultats);
  else afficherStatistiques(resultats);
}

function afficherGrille(liste) {
  const cartes = liste.map((edition) => {
    const image = edition.pochette || edition.miniature;
    const nb = edition.exemplaires.length;
    return creer("button", { classe: "carte", type: "button", surclic: () => ouvrirFiche(edition) },
      creer("div", { classe: "pochette" },
        image
          ? creer("img", { src: image, alt: "", loading: "lazy", decoding: "async" })
          : creer("span", { classe: "sans-image", texte: "♪" }),
        nb > 1 ? creer("span", { classe: "badge", texte: "×" + nb, title: nb + " exemplaires" }) : null
      ),
      creer("p", { classe: "carte-titre", texte: edition.titre }),
      creer("p", { classe: "carte-artiste", texte: (edition.artistes_principaux || []).join(", ") })
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

  const grande = images.length ? creer("img", { classe: "grande", src: images[0].url, alt: "Pochette" }) : null;
  const vignettes = images.length > 1 ? creer("div", { classe: "vignettes" },
    images.map((image, numero) => creer("button", {
      type: "button", classe: numero === 0 ? "actif" : null, "aria-label": "Image " + (numero + 1),
      surclic: (evenement) => {
        grande.src = image.url;
        evenement.currentTarget.parentNode.querySelectorAll("button").forEach((b) => b.classList.remove("actif"));
        evenement.currentTarget.classList.add("actif");
      },
    }, creer("img", { src: image.miniature || image.url, alt: "", loading: "lazy" })))
  ) : null;

  const informations = [
    ["Année", edition.annee || "inconnue"],
    ["Label", (edition.labels || []).map((l) => l.nom + (l.catno ? " – " + l.catno : "")).join(" ; ")],
    ["Format", decrireFormats(edition.formats)],
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

  const exemplaires = edition.exemplaires.map((exemplaire, numero) => {
    const autresChamps = Object.entries(exemplaire.champs).filter(([nom]) => nom !== CHAMP_LOCALISATION);
    return creer("li", {},
      creer("strong", { texte: exemplaire.champs[CHAMP_LOCALISATION] || "Localisation non renseignée" }),
      edition.exemplaires.length > 1 ? creer("span", { classe: "discret", texte: "  (exemplaire " + (numero + 1) + ")" }) : null,
      autresChamps.map(([nom, valeur]) => creer("div", {}, creer("span", { classe: "discret", texte: nom + " : " }), valeur)),
      exemplaire.note ? creer("div", { classe: "discret", texte: "Ma note : " + "★".repeat(exemplaire.note) + "☆".repeat(5 - exemplaire.note) }) : null,
      exemplaire.date_ajout ? creer("div", { classe: "discret", texte: "Ajouté le " + formaterDate(exemplaire.date_ajout) }) : null
    );
  });

  $("fiche-contenu").replaceChildren(
    creer("div", { classe: "fiche-corps" },
      creer("div", { classe: "fiche-images" }, grande, vignettes),
      creer("div", {},
        creer("h2", { id: "fiche-titre", texte: edition.titre }),
        creer("p", { classe: "sous-titre" },
          (edition.artistes_principaux || []).map((nom, i) => [
            i ? ", " : "",
            creer("button", { type: "button", classe: "bouton-texte", texte: nom, surclic: () => chercherNom(nom, "artistes_principaux") }),
          ])
        ),
        creer("dl", {}, informations.map(([terme, valeur]) => [creer("dt", { texte: terme }), creer("dd", { texte: valeur })])),
        sectionsPersonnes,
        creer("h3", { texte: edition.exemplaires.length > 1 ? "Mes exemplaires" : "Mon exemplaire" }),
        creer("ul", { classe: "exemplaires" }, exemplaires),
        creer("a", { classe: "lien-discogs", href: edition.url_discogs, target: "_blank", rel: "noopener", texte: "Voir sur Discogs ↗" })
      )
    )
  );
  $("fiche").showModal();
  $("fiche").scrollTop = 0;
}

// ---------------------------------------------------------------------------
// Statistiques (calculées sur les disques affichés : filtres et recherche compris)
// ---------------------------------------------------------------------------

/** Carte de barres horizontales. Un clic sur une barre applique le filtre correspondant. */
function carteBarres(titre, note, compte, limite, auClic) {
  const lignes = [...compte.entries()].sort((a, b) => b[1] - a[1] || comparerTextes(a[0], b[0])).slice(0, limite);
  const maximum = lignes.length ? lignes[0][1] : 1;
  return creer("section", { classe: "carte-stat" },
    creer("h2", { texte: titre }),
    creer("p", { classe: "note-stat", texte: note }),
    lignes.length
      ? creer("div", { classe: "barres" }, lignes.map(([libelle, nombre]) =>
          creer("button", { type: "button", classe: "barre", title: libelle + " : " + nombre, surclic: () => auClic(libelle) },
            creer("span", { classe: "barre-libelle", texte: libelle }),
            creer("span", { classe: "barre-piste" },
              creer("span", { classe: "barre-remplie", style: "width:" + (100 * nombre / maximum).toFixed(1) + "%" }),
              creer("span", { classe: "barre-valeur", texte: nombre })
            )
          )))
      : creer("p", { classe: "note-stat", texte: "Aucune donnée." })
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
    carteBarres("Genres", "Nombre d'éditions par genre Discogs.", compter(liste, EXTRACTEURS.genre), 15, appliquer("genre")),
    carteBarres("Localisation", "Nombre d'éditions par lieu de rangement.", compter(liste, EXTRACTEURS.localisation), 15, appliquer("localisation")),
    carteBarres("Compositeurs les plus présents", "Les 10 premiers, en nombre d'éditions.", compositeurs, 10, (nom) => chercherNomSansFiche(nom, "compositeurs")),
    carteBarres("Interprètes les plus présents", "Les 10 premiers, en nombre d'éditions.", interpretes, 10, (nom) => chercherNomSansFiche(nom, "interpretes")),
    carteBarres("Labels", "Les 10 premiers, en nombre d'éditions.", compter(liste, EXTRACTEURS.label), 10, appliquer("label")),
    carteBarres("Formats", "Nombre d'éditions par format.", compter(liste, EXTRACTEURS.format), 10, appliquer("format"))
  );
}

function chercherNomSansFiche(nom, role) {
  Object.assign(etat, { recherche: nom, role, vue: "collection" });
  ecrireControles();
  afficher();
  window.scrollTo({ top: 0 });
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

  for (const id of ["role-recherche", "tri", "filtre-genre", "filtre-style", "filtre-format",
                    "filtre-label", "filtre-annee-min", "filtre-annee-max", "filtre-localisation", "filtre-double"]) {
    $(id).addEventListener("change", () => { lireControles(); afficher(); });
  }
  $("filtre-label").addEventListener("input", () => { lireControles(); afficher(); });

  $("effacer-filtres").addEventListener("click", () => {
    Object.assign(etat, { genre: "", style: "", format: "", label: "", anneeMin: null, anneeMax: null,
                          localisation: "", double: false, recherche: "", role: "partout" });
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
chargerCollection();

// Application installable (PWA) : le service worker n'est actif qu'en https,
// donc une fois le site en ligne sur GitHub Pages (étape 3), pas en test local.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("service-worker.js");
}
