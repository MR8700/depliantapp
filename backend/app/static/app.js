const LABELS_MOMENTS = {
  Entree: "Entrée",
  Kyrie: "Kyrie",
  Gloria: "Gloria",
  Psaume: "Psaume",
  Acclamation: "Acclamation",
  Credo: "Credo",
  Priere_universelle: "Prière universelle",
  Offertoire: "Offertoire",
  Sanctus: "Sanctus",
  Anamnese: "Anamnèse",
  Notre_Pere: "Notre Père",
  Agnus: "Agnus",
  Communion: "Communion",
  Action_de_grace: "Action de grâce",
  Sortie: "Sortie",
};

// --- Appli installable (PWA) : icône sur l'écran d'accueil, lancement en
// plein écran. Le service worker ne met en cache que la coquille statique
// (voir sw.js) — jamais les données, toujours récupérées en direct.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

let MOMENTS = [];
let CATEGORIES = [];
let IDENTITE = null; // { authenticated, type: "chorale"|"super", nom, must_change_password }
const momentsState = {}; // moment -> { type, chant_id, chant_titre, titre_libre, texte_libre, total_couplets, couplet_limit, refrain, couplets }
let pickerTargetMoment = null;
let pickerTargetInputId = null;
let searchTimer = null;
let feuilletCourantId = null;
let apercuTimer = null;
let importWorkspaceChants = [];
let editImportIndex = null;
let dernieresStats = null;
let editeurChantsCache = [];

// --- Bibliothèque State & Mappings ---
let vueBibliothequeMode = localStorage.getItem("vueBibliothequeMode") || "list"; // "list" | "grid"
let triBibliothequeKey = "titre"; // "titre" | "code" | "creation" | "confiance"
let triBibliothequeDirection = 1; // 1: asc, -1: desc
let pageBibliothequeIndex = 1;
let pageBibliothequeSize = Number(localStorage.getItem("pageBibliothequeSize")) || 20;
let listChantsCache = [];

const NOMS_LANGUES = {
  fr: "Français",
  moore: "Mooré",
  dioula: "Dioula",
  la: "Latin",
  en: "Anglais",
  dagara: "Dagara",
  bissa: "Bissa",
  gulmancema: "Gulmancema",
  lingala: "Lingala",
  autre: "Autre",
};

// --- navigation / menu burger ---
let vuePrecedente = "bibliotheque";
let bloqueNavigation = false;

function ouvrirMenu() {
  document.getElementById("menu-berger").classList.add("ouvert");
  document.getElementById("menu-overlay").classList.remove("hidden");
}
function fermerMenu() {
  document.getElementById("menu-berger").classList.remove("ouvert");
  document.getElementById("menu-overlay").classList.add("hidden");
}
document.getElementById("btn-menu").addEventListener("click", ouvrirMenu);
document.getElementById("menu-overlay").addEventListener("click", fermerMenu);
document.getElementById("btn-deconnexion").addEventListener("click", async (e) => {
  await avecChargement(e.currentTarget, async () => {
    await fetch("/auth/logout", { method: "POST" });
    window.location.href = "/login.html";
  });
});

// --- Profil ---
let activeProfilSection = "infos-personnelles";
let currentProfileAvatarBase64 = null;

function switcherSectionProfil(sectionName) {
  activeProfilSection = sectionName;
  document.querySelectorAll(".profil-nav-item").forEach((btn) => {
    const isActive = btn.dataset.section === sectionName;
    btn.classList.toggle("active", isActive);
    btn.style.color = isActive ? "#1F4A7C" : "#64748b";
    btn.style.background = isActive ? "#eaf0fa" : "none";
  });
  document.querySelectorAll(".profil-section-content").forEach((sec) => {
    sec.classList.toggle("hidden", sec.id !== `section-${sectionName}`);
  });

  const titleEl = document.getElementById("profil-body-title");
  const subtitleEl = document.getElementById("profil-body-subtitle");
  if (sectionName === "infos-personnelles") {
    titleEl.textContent = "Mon profil";
    subtitleEl.textContent = "Gérez les informations de votre compte.";
  } else if (sectionName === "securite") {
    titleEl.textContent = "Sécurité";
    subtitleEl.textContent = "Gérez votre mot de passe et vos sessions.";
  } else if (sectionName === "infos-compte") {
    titleEl.textContent = "Informations du compte";
    subtitleEl.textContent = "Détails de sécurité et d'historique de votre compte.";
  }
}

document.querySelectorAll(".profil-nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    switcherSectionProfil(btn.dataset.section);
    document.getElementById("profil-menu-dropdown").classList.add("hidden");
  });
});

// Gestion du menu burger
document.getElementById("profil-menu-burger").addEventListener("click", () => {
  document.getElementById("profil-menu-dropdown").classList.toggle("hidden");
});

async function ouvrirProfil() {
  switcherSectionProfil("infos-personnelles");
  document.getElementById("profil-menu-dropdown").classList.add("hidden");
  
  updateHeaderAndProfileAvatar();

  document.getElementById("profil-info-username").textContent = IDENTITE.username;
  document.getElementById("profil-info-role").textContent = IDENTITE.type === "super" ? "Super-admin" : "Compte chorale";
  document.getElementById("profil-info-last-login").textContent = new Date().toLocaleDateString("fr-FR", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Handle roles visibility
  const lblPrenom = document.getElementById("lbl-profil-prenom");
  const lblNomChorale = document.getElementById("lbl-profil-nom-chorale");
  
  if (IDENTITE.type === "super") {
    lblPrenom.classList.remove("hidden");
    lblNomChorale.classList.add("hidden");
  } else {
    lblPrenom.classList.add("hidden");
    lblNomChorale.classList.remove("hidden");
  }

  // Retrieve parameters (Nom, Paroisse, Telephone)
  let params = { chorale: "", paroisse: "", contact: "" };
  if (IDENTITE.type === "chorale") {
    try {
      params = await api("/parametres");
      document.getElementById("p-profil-nom-chorale").value = params.chorale || "";
      document.getElementById("p-profil-paroisse").value = params.paroisse || "";
      document.getElementById("p-profil-telephone").value = params.contact || "";
    } catch (e) {
      console.error("Error reading params", e);
    }
  }

  // Load localStorage data for extra details
  const extraInfos = JSON.parse(localStorage.getItem(`profil_extra_${IDENTITE.username}`) || "{}");
  document.getElementById("p-profil-nom-complet").value = extraInfos.nom_complet || IDENTITE.nom || "";
  document.getElementById("p-profil-prenom").value = extraInfos.prenom || "";
  document.getElementById("p-profil-ccb").value = extraInfos.ccb || "";
  document.getElementById("p-profil-email").value = extraInfos.email || "";
  document.getElementById("p-profil-langue").value = extraInfos.langue || "fr";
  document.getElementById("p-profil-fuseau").value = extraInfos.fuseau || "GMT";

  currentProfileAvatarBase64 = localStorage.getItem(`profil_avatar_${IDENTITE.username}`) || null;

  document.getElementById("profil-mdp-form").reset();
  document.getElementById("profil-mdp-status").textContent = "";
  updatePasswordStrengthAndCriteria();

  ouvrirModale("profil-modal");
  fermerMenu();
}

document.getElementById("btn-mon-profil").addEventListener("click", ouvrirProfil);

// Avatar changes
document.getElementById("btn-profil-avatar-upload").addEventListener("click", () => {
  document.getElementById("profil-avatar-input").click();
});

document.getElementById("profil-avatar-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    alert("Fichier trop grand (5 Mo maximum).");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result;
    currentProfileAvatarBase64 = base64;
    localStorage.setItem(`profil_avatar_${IDENTITE.username}`, base64);
    updateHeaderAndProfileAvatar();
  };
  reader.readAsDataURL(file);
});

document.getElementById("btn-profil-avatar-delete").addEventListener("click", () => {
  currentProfileAvatarBase64 = null;
  localStorage.removeItem(`profil_avatar_${IDENTITE.username}`);
  updateHeaderAndProfileAvatar();
});

// Show/hide eye password buttons
document.querySelectorAll(".btn-voyant-mdp").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = btn.previousElementSibling;
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    btn.textContent = visible ? "👁" : "🙈";
    btn.setAttribute("aria-label", visible ? "Afficher le mot de passe" : "Masquer le mot de passe");
  });
});

// Password strength & requirements check
document.getElementById("profil-mdp-nouveau").addEventListener("input", updatePasswordStrengthAndCriteria);

function updatePasswordStrengthAndCriteria() {
  const mdp = document.getElementById("profil-mdp-nouveau").value;
  const reqLength = document.getElementById("req-length");
  const reqUppercase = document.getElementById("req-uppercase");
  const reqLowercase = document.getElementById("req-lowercase");
  const reqDigit = document.getElementById("req-digit");
  const reqSpecial = document.getElementById("req-special");

  if (!reqLength) return; // safety

  const hasLength = mdp.length >= 8;
  const hasUppercase = /[A-Z]/.test(mdp);
  const hasLowercase = /[a-z]/.test(mdp);
  const hasDigit = /[0-9]/.test(mdp);
  const hasSpecial = /[^A-Za-z0-9]/.test(mdp);

  reqLength.innerHTML = hasLength ? "✅ minimum 8 caractères" : "❌ minimum 8 caractères";
  reqLength.className = "req-item " + (hasLength ? "met" : "");
  
  reqUppercase.innerHTML = hasUppercase ? "✅ une lettre majuscule" : "❌ une lettre majuscule";
  reqUppercase.className = "req-item " + (hasUppercase ? "met" : "");

  reqLowercase.innerHTML = hasLowercase ? "✅ une lettre minuscule" : "❌ une lettre minuscule";
  reqLowercase.className = "req-item " + (hasLowercase ? "met" : "");

  reqDigit.innerHTML = hasDigit ? "✅ un chiffre" : "❌ un chiffre";
  reqDigit.className = "req-item " + (hasDigit ? "met" : "");

  reqSpecial.innerHTML = hasSpecial ? "✅ un caractère spécial" : "❌ un caractère spécial";
  reqSpecial.className = "req-item " + (hasSpecial ? "met" : "");

  let score = 0;
  if (hasLength) score++;
  if (hasUppercase) score++;
  if (hasLowercase) score++;
  if (hasDigit) score++;
  if (hasSpecial) score++;

  const labelEl = document.getElementById("profil-mdp-strength-label");
  const barEl = document.getElementById("profil-mdp-strength-bar");
  
  if (mdp.length === 0) {
    labelEl.textContent = "Vide";
    labelEl.style.color = "#64748b";
    barEl.style.width = "0%";
    barEl.style.background = "#e2e8f0";
  } else if (score <= 2) {
    labelEl.textContent = "Faible";
    labelEl.style.color = "#ef4444";
    barEl.style.width = "20%";
    barEl.style.background = "#ef4444";
  } else if (score <= 4) {
    labelEl.textContent = "Moyen";
    labelEl.style.color = "#f59e0b";
    barEl.style.width = "60%";
    barEl.style.background = "#f59e0b";
  } else {
    labelEl.textContent = "Fort";
    labelEl.style.color = "#10b981";
    barEl.style.width = "100%";
    barEl.style.background = "#10b981";
  }
}

// Disconnect from all devices (mock action)
document.getElementById("btn-disconnect-all").addEventListener("click", () => {
  if (confirm("Voulez-vous vraiment déconnecter tous vos autres appareils connectés ?")) {
    alert("Tous vos autres appareils ont été déconnectés avec succès.");
  }
});

// Enregistrer les modifications
document.getElementById("btn-profil-enregistrer").addEventListener("click", async (e) => {
  if (activeProfilSection === "infos-personnelles") {
    const nomComplet = document.getElementById("p-profil-nom-complet").value;
    const prenom = document.getElementById("p-profil-prenom").value;
    const nomChorale = document.getElementById("p-profil-nom-chorale").value;
    const paroisse = document.getElementById("p-profil-paroisse").value;
    const ccb = document.getElementById("p-profil-ccb").value;
    const telephone = document.getElementById("p-profil-telephone").value;
    const email = document.getElementById("p-profil-email").value;
    const langue = document.getElementById("p-profil-langue").value;
    const fuseau = document.getElementById("p-profil-fuseau").value;

    // Save extra presentation fields in localStorage
    localStorage.setItem(`profil_extra_${IDENTITE.username}`, JSON.stringify({
      nom_complet: nomComplet,
      prenom: prenom,
      ccb: ccb,
      email: email,
      langue: langue,
      fuseau: fuseau
    }));

    // If chorale, persist standard params in the backend database too!
    if (IDENTITE.type === "chorale") {
      try {
        const curParams = await api("/parametres");
        await api("/parametres", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chorale: nomChorale || curParams.chorale,
            paroisse: paroisse || curParams.paroisse,
            contact: telephone || curParams.contact,
            annonce: curParams.annonce,
            priere_texte_defaut: curParams.priere_texte_defaut,
          }),
        });
        document.getElementById("app-title").textContent = nomChorale || "DepliantApp";
      } catch (err) {
        console.error("Error persisting profile params to DB", err);
      }
    }
    updateHeaderAndProfileAvatar();
    alert("Profil mis à jour.");
    fermerModale("profil-modal");

  } else if (activeProfilSection === "securite") {
    // Submit the password form
    const form = document.getElementById("profil-mdp-form");
    const statusEl = document.getElementById("profil-mdp-status");
    const actuel = document.getElementById("profil-mdp-actuel").value;
    const nouveau = document.getElementById("profil-mdp-nouveau").value;
    const confirme = document.getElementById("profil-mdp-confirme").value;

    if (!actuel || !nouveau || !confirme) {
      statusEl.textContent = "Veuillez remplir tous les champs.";
      return;
    }
    if (nouveau !== confirme) {
      statusEl.textContent = "Les deux nouveaux mots de passe ne correspondent pas.";
      return;
    }
    
    statusEl.textContent = "Changement du mot de passe en cours...";
    try {
      await api("/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mot_de_passe_actuel: actuel, nouveau_mot_de_passe: nouveau }),
      });
      statusEl.textContent = "";
      alert("Mot de passe changé.");
      form.reset();
      fermerModale("profil-modal");
    } catch (err) {
      statusEl.textContent = `Erreur : ${err.message}`;
    }
  } else {
    fermerModale("profil-modal");
  }
});

function afficherVueDirect(nomVue) {
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  const btn = document.querySelector(`.nav-btn[data-view="${nomVue}"]`);
  if (btn) btn.classList.add("active");
  const viewEl = document.getElementById(`view-${nomVue}`);
  if (viewEl) viewEl.classList.add("active");
  
  if (nomVue === "reglages") chargerParametres();
  if (nomVue === "editeur") actualiserEditeur();
  if (nomVue === "depliants") actualiserDepliants();
  if (nomVue === "admin") actualiserAdmin();
  if (nomVue === "statistiques") actualiserStatistiques();
  if (nomVue === "messagerie") demarrerMessagerie(); else arreterMessagerie();
}

function changerVue(nomVue) {
  window.location.hash = "#/" + nomVue;
}

document.querySelectorAll(".nav-btn[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    changerVue(btn.dataset.view);
    fermerMenu();
  });
});

function verifierModalesOuvertes() {
  const ceEl = document.getElementById("chant-editor");
  const ceOuvert = ceEl ? !ceEl.classList.contains("hidden") : false;
  const iwEl = document.getElementById("import-workspace-modal");
  const iwOuvert = iwEl ? !iwEl.classList.contains("hidden") : false;
  return ceOuvert || iwOuvert;
}

// Vues réservées au super-admin : le bouton correspondant est déjà masqué
// pour les comptes chorale (voir init()), mais un accès direct par hash
// (URL tapée à la main, favori, bouton précédent) doit être bloqué ici
// aussi — masquer le bouton seul ne suffit pas à protéger la vue.
const VUES_SUPERADMIN_UNIQUEMENT = new Set(["admin", "statistiques"]);

function gererNavigationHash() {
  if (bloqueNavigation) return;
  const hash = window.location.hash || "#/bibliotheque";
  const nomVue = hash.replace("#/", "");

  if (VUES_SUPERADMIN_UNIQUEMENT.has(nomVue) && IDENTITE && IDENTITE.type !== "super") {
    bloqueNavigation = true;
    window.location.hash = "#/bibliotheque";
    setTimeout(() => { bloqueNavigation = false; }, 50);
    return;
  }

  if (nomVue !== vuePrecedente && verifierModalesOuvertes()) {
    if (!confirm("Attention : des modifications sont en cours d'édition. Quitter sans enregistrer ?")) {
      bloqueNavigation = true;
      window.location.hash = "#/" + vuePrecedente;
      setTimeout(() => { bloqueNavigation = false; }, 50);
      return;
    } else {
      fermerModale("chant-editor");
      fermerModale("import-workspace-modal");
    }
  }
  
  vuePrecedente = nomVue;
  afficherVueDirect(nomVue);
}

window.addEventListener("hashchange", gererNavigationHash);

window.addEventListener("beforeunload", (e) => {
  if (verifierModalesOuvertes()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// Empêche la page principale de défiler pendant qu'une modale (détail/édition
// de chant, sélecteur de chant) est ouverte par-dessus.
function syncModalLock() {
  const edEl = document.getElementById("chant-editor");
  const editeurOuvert = edEl ? !edEl.classList.contains("hidden") : false;
  
  const pkEl = document.getElementById("chant-picker");
  const pickerOuvert = pkEl ? !pkEl.classList.contains("hidden") : false;
  
  const dtEl = document.getElementById("chant-detail-modal");
  const detailOuvert = dtEl ? !dtEl.classList.contains("hidden") : false;
  
  const wsEl = document.getElementById("import-workspace-modal");
  const workspaceOuvert = wsEl ? !wsEl.classList.contains("hidden") : false;
  
  const tgEl = document.getElementById("texte-grand-editor");
  const tgeOuvert = tgEl ? !tgEl.classList.contains("hidden") : false;
  
  document.body.classList.toggle("no-scroll", editeurOuvert || pickerOuvert || detailOuvert || workspaceOuvert || tgeOuvert);
}
["chant-editor", "chant-picker", "chant-detail-modal", "import-workspace-modal", "texte-grand-editor"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    new MutationObserver(syncModalLock).observe(el, {
      attributes: true, attributeFilter: ["class"],
    });
  }
});

// --- Modales : ouverture/fermeture animées + support du bouton retour
// (téléphone et navigateur). Chaque ouverture pousse une entrée d'historique
// (même URL, juste un marqueur) ; le bouton retour la dépile via popstate et
// referme la modale au lieu de faire quitter la page. Les modales protégeant
// une saisie en cours (chant-editor, import-workspace-modal) redemandent
// confirmation avant de se fermer, exactement comme leurs boutons "Annuler".
let modalStack = [];
const MODALS_AVEC_CONFIRMATION = new Set(["chant-editor", "import-workspace-modal"]);
const DUREE_TRANSITION_MODALE = 220;

function ouvrirModale(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!el.classList.contains("hidden")) return;
  el.classList.remove("hidden");
  requestAnimationFrame(() => el.classList.add("visible"));
  modalStack.push(id);
  history.pushState({ depliantModal: id }, "", location.href);
}

function fermerModale(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.classList.contains("hidden")) return;
  el.classList.remove("visible");
  modalStack = modalStack.filter((m) => m !== id);
  setTimeout(() => el.classList.add("hidden"), DUREE_TRANSITION_MODALE);
}

window.addEventListener("popstate", () => {
  if (modalStack.length === 0) return;
  const top = modalStack[modalStack.length - 1];
  if (top === "texte-grand-editor") {
    if (!fermerTexteGrandEditeur()) {
      history.pushState({ depliantModal: top }, "", location.href);
    }
    return;
  }
  if (MODALS_AVEC_CONFIRMATION.has(top) &&
      !confirm("Attention : des modifications sont en cours d'édition. Quitter sans enregistrer ?")) {
    history.pushState({ depliantModal: top }, "", location.href);
    return;
  }
  fermerModale(top);
});

const FERMETURE_X_DELEGUEE = {
  "chant-editor": "ce-fermer",
  "chant-picker": "picker-close",
  "import-workspace-modal": "iw-btn-annuler",
  "texte-grand-editor": "tge-annuler",
};
document.querySelectorAll(".modal-close-x").forEach((btn) => {
  btn.addEventListener("click", () => {
    const cibleId = FERMETURE_X_DELEGUEE[btn.dataset.close];
    const cible = cibleId && document.getElementById(cibleId);
    if (cible) cible.click();
    else fermerModale(btn.dataset.close);
  });
});

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    const texte = await res.text();
    let detail = texte;
    try { detail = JSON.parse(texte).detail; } catch (e) { /* pas du JSON */ }
    const message = typeof detail === "object" && detail !== null ? detail.message : detail;
    const erreur = new Error(message || `Erreur ${res.status}`);
    erreur.status = res.status;
    erreur.detail = detail;
    throw erreur;
  }
  return res.status === 204 ? null : res.json();
}

// --- Indicateur de chargement (cercle tournant) sur un bouton d'action ---
async function avecChargement(bouton, fn) {
  if (!bouton || bouton.disabled) return fn();
  const contenuOriginal = bouton.innerHTML;
  bouton.disabled = true;
  bouton.innerHTML = `<span class="spinner" aria-hidden="true"></span>${contenuOriginal}`;
  try {
    return await fn();
  } finally {
    bouton.disabled = false;
    bouton.innerHTML = contenuOriginal;
  }
}

// Variante pour un handler de soumission de formulaire : résout le bouton
// submit automatiquement (form.requestSubmit()/submit event -> e.submitter
// n'est pas fiable partout, on cherche simplement le bouton [type=submit]).
async function avecChargementSubmit(form, fn) {
  const bouton = form.querySelector('button[type="submit"]');
  return avecChargement(bouton, fn);
}

// Idem, pour le clic sur un chant dans une liste (bibliothèque, éditeur,
// sélecteur du composer) : ouvrir sa fiche déclenche une requête réseau
// (détails, suggestion de catégorie, doublons). On marque visuellement
// l'élément choisi et on verrouille le reste de la liste le temps du
// chargement, pour qu'un second clic (ailleurs dans la liste, ou répété
// sur le même chant) ne parte pas sur un état incohérent.
async function avecChargementChant(list, el, fn) {
  if (list.dataset.verrouillee) return;
  list.dataset.verrouillee = "1";
  list.classList.add("liste-verrouillee");
  el.classList.add("chant-item-chargement");
  try {
    await fn();
  } catch (err) {
    alert(`Erreur : ${err.message}`);
  } finally {
    delete list.dataset.verrouillee;
    list.classList.remove("liste-verrouillee");
    el.classList.remove("chant-item-chargement");
  }
}

// --- Bibliothèque ---
function slugifyClient(text) {
  return text.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function chantCardHtml(chant) {
  const catClass = `cat-pill-${(chant.categorie || "autre").toLowerCase()}`;
  
  const icons = {
    entree: "🎵",
    kyrie: "🙏",
    gloria: "✨",
    psaume: "📖",
    acclamation: "🎺",
    credo: "⛪",
    offertoire: "🍷",
    sanctus: "🔥",
    anamnese: "🙌",
    notre_pere: "🙏",
    agnus: "🐑",
    communion: "🍷",
    action_de_grace: "☀️",
    sortie: "🚶",
    autre: "🎵"
  };
  const icon = icons[(chant.categorie || "").toLowerCase()] || "🎵";
  
  let stateText = "Actif";
  let stateClass = "badge-actif";
  if (chant.actif === false) {
    stateText = "Archivé";
    stateClass = "badge-archive";
  } else if (chant.confiance < 0.7) {
    stateText = "À vérifier";
    stateClass = "badge-a-verifier";
  }
  
  const refrainApercu = chant.refrain ? chant.refrain.slice(0, 80) : (chant.couplets && chant.couplets[0] ? chant.couplets[0].slice(0, 80) : "");
  const occasionsText = (chant.occasions && chant.occasions.length > 0) ? chant.occasions.join(", ") : "N/A";
  const nomLangue = NOMS_LANGUES[chant.langue] || chant.langue || "Français";
  
  let tagsHtml = "";
  if (chant.mots_cles && chant.mots_cles.length > 0) {
    const visibleTags = chant.mots_cles.slice(0, 3);
    tagsHtml = visibleTags.map(t => `<span class="card-tag">${escapeHtml(t)}</span>`).join("");
    if (chant.mots_cles.length > 3) {
      tagsHtml += `<span class="card-tag card-tag-more">+${chant.mots_cles.length - 3}</span>`;
    }
  }
  
  let actionButtonsHtml = "";
  if (IDENTITE && IDENTITE.type === "super") {
    actionButtonsHtml = `
      <div class="card-actions-wrapper" onclick="event.stopPropagation();">
        <button type="button" class="btn-card-action btn-action-voir" title="Voir les détails">👁</button>
        <button type="button" class="btn-card-action btn-action-modifier" title="Modifier">✏</button>
        <button type="button" class="btn-card-action btn-action-dupliquer" title="Dupliquer">📄</button>
      </div>
    `;
  } else {
    const favIcon = chant.favori ? "★" : "☆";
    const addBtnHtml = pickerTargetMoment ? `<button type="button" class="btn-card-action btn-action-ajouter" title="Ajouter au dépliant">➕</button>` : "";
    actionButtonsHtml = `
      <div class="card-actions-wrapper" onclick="event.stopPropagation();">
        <button type="button" class="btn-card-action btn-action-voir" title="Voir les détails">👁</button>
        <button type="button" class="btn-card-action btn-action-favori" title="${chant.favori ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${favIcon}</button>
        ${addBtnHtml}
      </div>
    `;
  }
  
  return `
    <li class="chant-card" data-id="${chant.id}">
      <div class="card-icon-circle ${catClass}">${icon}</div>
      <div class="card-main-content">
        <div class="card-title-row">
          <span class="chant-categorie-pill ${catClass}">${categorieLabel(chant.categorie)}</span>
          <h3 class="card-title">${escapeHtml(chant.titre || "(sans titre)")}</h3>
          ${chant.code_reference ? `<span class="card-ref-badge">${escapeHtml(chant.code_reference)}</span>` : ""}
        </div>
        <p class="card-refrain-apercu">${escapeHtml(refrainApercu)}${refrainApercu.length >= 80 ? "..." : ""}</p>
        <div class="card-meta-line">
          <span>Langue : <strong>${escapeHtml(nomLangue)}</strong></span>
          <span>Occasions : <strong>${escapeHtml(occasionsText)}</strong></span>
        </div>
        ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ""}
      </div>
      <div class="card-right-aside">
        <span class="card-status-badge ${stateClass}">${stateText}</span>
        ${actionButtonsHtml}
      </div>
    </li>
  `;
}

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function etatVideHtml(icone, titre, sousTitre) {
  return `
    <li class="etat-vide">
      <div class="etat-vide-icone">${icone}</div>
      <p class="etat-vide-titre">${titre}</p>
      ${sousTitre ? `<p class="etat-vide-sous-titre">${sousTitre}</p>` : ""}
    </li>`;
}
let offlineIndicatorDismissed = false;

function afficherIndicateurHorsLigne() {
  if (offlineIndicatorDismissed) return;
  let indicator = document.getElementById("offline-mode-indicator");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = "offline-mode-indicator";
    indicator.style.cssText = "background: #f59e0b; color: white; text-align: center; font-size: 0.75rem; font-weight: 600; padding: 6px 12px; position: fixed; top: 0; left: 0; right: 0; z-index: 10000; box-shadow: 0 2px 4px rgba(0,0,0,0.1); display: flex; align-items: center; justify-content: space-between; gap: 12px;";
    indicator.innerHTML = `
      <span style="flex: 1; text-align: center;">⚠️ Mode hors-ligne actif (connexion faible ou inexistante) — Affichage des données en cache</span>
      <button type="button" id="close-offline-indicator" style="background: none; border: none; color: white; font-size: 1.25rem; cursor: pointer; font-weight: bold; padding: 0 4px; line-height: 1;">&times;</button>
    `;
    document.body.appendChild(indicator);
    document.body.style.paddingTop = `${indicator.offsetHeight || 28}px`;
    
    document.getElementById("close-offline-indicator").addEventListener("click", () => {
      offlineIndicatorDismissed = true;
      retirerIndicateurHorsLigne();
    });
  }
}

function retirerIndicateurHorsLigne() {
  const indicator = document.getElementById("offline-mode-indicator");
  if (indicator) {
    indicator.remove();
    document.body.style.paddingTop = "0";
  }
}

function sauvegarderChantsEnCacheLocaux(chants) {
  try {
    let cache = [];
    const stored = localStorage.getItem("depliantapp_chants_local_db");
    if (stored) {
      cache = JSON.parse(stored);
    }
    const map = new Map(cache.map(c => [c.id, c]));
    chants.forEach(c => map.set(c.id, c));
    localStorage.setItem("depliantapp_chants_local_db", JSON.stringify(Array.from(map.values())));
  } catch (e) {
    console.error("Erreur de sauvegarde cache", e);
  }
}

function rechercherChantsLocaux(q, categorie, occasion) {
  try {
    const stored = localStorage.getItem("depliantapp_chants_local_db");
    if (!stored) return [];
    let list = JSON.parse(stored);
    if (categorie) {
      list = list.filter(c => c.categorie === categorie);
    }
    if (occasion) {
      const occLower = occasion.toLowerCase();
      list = list.filter(c => c.occasions && c.occasions.some(o => o.toLowerCase().includes(occLower)));
    }
    if (q) {
      const qLower = q.toLowerCase();
      list = list.filter(c => {
        const titreMatch = c.titre && c.titre.toLowerCase().includes(qLower);
        const refrainMatch = c.refrain && c.refrain.toLowerCase().includes(qLower);
        const coupletsMatch = c.couplets && c.couplets.some(cp => cp.toLowerCase().includes(qLower));
        return titreMatch || refrainMatch || coupletsMatch;
      });
    }
    return list;
  } catch (e) {
    console.error("Erreur recherche locale", e);
    return [];
  }
}

async function rechercherChants(q, categorie, occasion) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (categorie) params.set("categorie", categorie);
  if (occasion) params.set("occasion", occasion);
  params.set("limit", "1000");

  const url = `/chants?${params.toString()}`;
  
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Timeout")), 3500)
  );

  try {
    const data = await Promise.race([
      api(url),
      timeoutPromise
    ]);
    sauvegarderChantsEnCacheLocaux(data);
    retirerIndicateurHorsLigne();
    return data;
  } catch (err) {
    console.warn("API/Fetch a échoué ou timeout, basculement en mode hors-ligne :", err);
    afficherIndicateurHorsLigne();
    return rechercherChantsLocaux(q, categorie, occasion);
  }
}

function actualiserBibliothequeHeaderActions() {
  const container = document.getElementById("library-header-role-actions");
  if (!container) return;
  container.innerHTML = "";
  
  if (IDENTITE && IDENTITE.type === "super") {
    const btnAjouter = document.createElement("button");
    btnAjouter.type = "button";
    btnAjouter.className = "btn-ouvrir btn-primary";
    btnAjouter.innerHTML = "➕ Ajouter un chant";
    btnAjouter.addEventListener("click", () => ouvrirEditeurChant(null));
    container.appendChild(btnAjouter);
    
    const btnImporter = document.createElement("button");
    btnImporter.type = "button";
    btnImporter.className = "btn-secondary";
    btnImporter.innerHTML = "📥 Importer";
    btnImporter.addEventListener("click", () => changerVue("importer"));
    container.appendChild(btnImporter);
    
    const btnAdmin = document.createElement("button");
    btnAdmin.type = "button";
    btnAdmin.className = "btn-secondary";
    btnAdmin.innerHTML = "🛡 Admin";
    btnAdmin.addEventListener("click", () => changerVue("admin"));
    container.appendChild(btnAdmin);
    
    const btnStats = document.createElement("button");
    btnStats.type = "button";
    btnStats.className = "btn-secondary";
    btnStats.innerHTML = "📊 Stats";
    btnStats.addEventListener("click", () => changerVue("statistiques"));
    container.appendChild(btnStats);
  } else {
    const btnComposer = document.createElement("button");
    btnComposer.type = "button";
    btnComposer.className = "btn-ouvrir btn-primary";
    btnComposer.innerHTML = "✍ Composer";
    btnComposer.addEventListener("click", () => changerVue("composer"));
    container.appendChild(btnComposer);
    
    const btnDepliants = document.createElement("button");
    btnDepliants.type = "button";
    btnDepliants.className = "btn-secondary";
    btnDepliants.innerHTML = "📂 Dépliants";
    btnDepliants.addEventListener("click", () => changerVue("depliants"));
    container.appendChild(btnDepliants);
    
    const btnReglages = document.createElement("button");
    btnReglages.type = "button";
    btnReglages.className = "btn-secondary";
    btnReglages.innerHTML = "⚙ Réglages";
    btnReglages.addEventListener("click", () => changerVue("reglages"));
    container.appendChild(btnReglages);
  }
}

function initBibliothequeControles() {
  const btnAdvanced = document.getElementById("btn-filtres-avances");
  if (btnAdvanced) {
    btnAdvanced.addEventListener("click", () => {
      const block = document.getElementById("advanced-filters-block");
      block.classList.toggle("hidden");
    });
  }
  
  document.getElementById("search-q").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      pageBibliothequeIndex = 1;
      actualiserListeBibliotheque();
    }, 300);
  });
  
  document.getElementById("search-categorie").addEventListener("change", () => {
    pageBibliothequeIndex = 1;
    actualiserListeBibliotheque();
  });
  
  document.getElementById("search-langue").addEventListener("change", () => {
    pageBibliothequeIndex = 1;
    actualiserListeBibliotheque();
  });
  
  const inputOccasion = document.getElementById("search-occasion");
  if (inputOccasion) {
    inputOccasion.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        pageBibliothequeIndex = 1;
        actualiserListeBibliotheque();
      }, 300);
    });
  }
  
  const selectEtat = document.getElementById("search-etat");
  if (selectEtat) {
    selectEtat.addEventListener("change", () => {
      pageBibliothequeIndex = 1;
      actualiserListeBibliotheque();
    });
  }
  
  const btnList = document.getElementById("btn-view-list");
  const btnGrid = document.getElementById("btn-view-grid");
  const wrapper = document.getElementById("library-songs-wrapper");
  
  if (btnList && btnGrid) {
    btnList.addEventListener("click", () => {
      vueBibliothequeMode = "list";
      localStorage.setItem("vueBibliothequeMode", "list");
      btnList.classList.add("active");
      btnGrid.classList.remove("active");
      wrapper.className = "view-mode-list";
      actualiserListeBibliothequeRendering();
    });
    
    btnGrid.addEventListener("click", () => {
      vueBibliothequeMode = "grid";
      localStorage.setItem("vueBibliothequeMode", "grid");
      btnGrid.classList.add("active");
      btnList.classList.remove("active");
      wrapper.className = "view-mode-grid";
      actualiserListeBibliothequeRendering();
    });
    
    if (vueBibliothequeMode === "grid") {
      btnGrid.classList.add("active");
      btnList.classList.remove("active");
      wrapper.className = "view-mode-grid";
    } else {
      btnList.classList.add("active");
      btnGrid.classList.remove("active");
      wrapper.className = "view-mode-list";
    }
  }
  
  const selectSort = document.getElementById("library-sort-by");
  if (selectSort) {
    selectSort.addEventListener("change", () => {
      triBibliothequeKey = selectSort.value;
      actualiserListeBibliothequeRendering();
    });
  }
  
  const btnDirection = document.getElementById("btn-sort-direction");
  if (btnDirection) {
    btnDirection.addEventListener("click", () => {
      triBibliothequeDirection *= -1;
      actualiserListeBibliothequeRendering();
    });
  }
  
  const selectPageSize = document.getElementById("library-page-size");
  if (selectPageSize) {
    selectPageSize.value = pageBibliothequeSize;
    selectPageSize.addEventListener("change", () => {
      pageBibliothequeSize = Number(selectPageSize.value);
      localStorage.setItem("pageBibliothequeSize", pageBibliothequeSize);
      pageBibliothequeIndex = 1;
      actualiserListeBibliothequeRendering();
    });
  }
}

function actualiserListeBibliothequeRendering() {
  let list = [...listChantsCache];
  
  const langue = document.getElementById("search-langue").value;
  if (langue) {
    list = list.filter(c => c.langue === langue);
  }
  
  const etat = document.getElementById("search-etat") ? document.getElementById("search-etat").value : "";
  if (etat) {
    if (etat === "archive") {
      list = list.filter(c => c.actif === false);
    } else if (etat === "a-verifier") {
      list = list.filter(c => c.actif !== false && c.confiance < 0.7);
    } else if (etat === "actif") {
      list = list.filter(c => c.actif !== false && c.confiance >= 0.7);
    }
  }
  
  document.getElementById("library-total-badge").textContent = `${list.length} chant${list.length > 1 ? "s" : ""}`;
  
  list.sort((a, b) => {
    let valA = "", valB = "";
    if (triBibliothequeKey === "titre") {
      valA = (a.titre || "").toLowerCase();
      valB = (b.titre || "").toLowerCase();
    } else if (triBibliothequeKey === "code") {
      valA = (a.code_reference || "").toLowerCase();
      valB = (b.code_reference || "").toLowerCase();
    } else if (triBibliothequeKey === "creation") {
      valA = a.created_at || "";
      valB = b.created_at || "";
    } else if (triBibliothequeKey === "confiance") {
      const scoreA = a.confiance ?? 1.0;
      const scoreB = b.confiance ?? 1.0;
      return (scoreB - scoreA) * triBibliothequeDirection;
    }
    
    if (valA < valB) return -1 * triBibliothequeDirection;
    if (valA > valB) return 1 * triBibliothequeDirection;
    return 0;
  });
  
  const totalItems = list.length;
  const totalPages = Math.ceil(totalItems / pageBibliothequeSize) || 1;
  if (pageBibliothequeIndex > totalPages) pageBibliothequeIndex = totalPages;
  if (pageBibliothequeIndex < 1) pageBibliothequeIndex = 1;
  
  const startOffset = (pageBibliothequeIndex - 1) * pageBibliothequeSize;
  const endOffset = startOffset + pageBibliothequeSize;
  const paginatedList = list.slice(startOffset, endOffset);
  
  const listEl = document.getElementById("chant-list");
  if (paginatedList.length === 0) {
    const q = document.getElementById("search-q").value.trim();
    if (q) {
      listEl.innerHTML = etatVideHtml("🔍", `Aucun résultat pour « ${escapeHtml(q)} »`, "Essaie un autre mot.");
    } else {
      listEl.innerHTML = etatVideHtml("🎵", "Aucun chant disponible", "Vérifie tes filtres ou ajoute de nouveaux chants.");
    }
    document.getElementById("library-pagination-controls").innerHTML = "";
    return;
  }
  
  listEl.innerHTML = paginatedList.map(chantCardHtml).join("");
  
  listEl.querySelectorAll(".chant-card").forEach((el) => {
    const id = Number(el.dataset.id);
    const chant = listChantsCache.find((c) => c.id === id);
    
    el.addEventListener("click", () => avecChargementChant(listEl, el, () => ouvrirDetailChant(chant)));
    
    const btnVoir = el.querySelector(".btn-action-voir");
    if (btnVoir) {
      btnVoir.addEventListener("click", (e) => {
        e.stopPropagation();
        ouvrirDetailChant(chant);
      });
    }
    const btnModifier = el.querySelector(".btn-action-modifier");
    if (btnModifier) {
      btnModifier.addEventListener("click", (e) => {
        e.stopPropagation();
        ouvrirEditeurChant(chant.id);
      });
    }
    const btnDupliquer = el.querySelector(".btn-action-dupliquer");
    if (btnDupliquer) {
      btnDupliquer.addEventListener("click", async (e) => {
        e.stopPropagation();
        await dupliquerChant(chant);
      });
    }
    const btnFavori = el.querySelector(".btn-action-favori");
    if (btnFavori) {
      btnFavori.addEventListener("click", async (e) => {
        e.stopPropagation();
        await toggleFavoriChant(chant);
      });
    }
    const btnAjouter = el.querySelector(".btn-action-ajouter");
    if (btnAjouter) {
      btnAjouter.addEventListener("click", (e) => {
        e.stopPropagation();
        chantDetailCourant = chant;
        document.getElementById("cd-btn-ajouter").click();
      });
    }
  });
  
  const pagControls = document.getElementById("library-pagination-controls");
  pagControls.innerHTML = "";
  
  if (totalPages <= 1) return;
  
  const btnPrev = document.createElement("button");
  btnPrev.type = "button";
  btnPrev.className = "btn-page";
  btnPrev.textContent = "<";
  btnPrev.disabled = pageBibliothequeIndex === 1;
  btnPrev.addEventListener("click", () => {
    pageBibliothequeIndex--;
    actualiserListeBibliothequeRendering();
  });
  pagControls.appendChild(btnPrev);
  
  const maxVisiblePages = 5;
  let startPage = Math.max(1, pageBibliothequeIndex - 2);
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  if (endPage - startPage < maxVisiblePages - 1) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }
  
  if (startPage > 1) {
    const btnFirst = document.createElement("button");
    btnFirst.type = "button";
    btnFirst.className = "btn-page";
    btnFirst.textContent = "1";
    btnFirst.addEventListener("click", () => {
      pageBibliothequeIndex = 1;
      actualiserListeBibliothequeRendering();
    });
    pagControls.appendChild(btnFirst);
    
    if (startPage > 2) {
      const ellipsis = document.createElement("span");
      ellipsis.className = "pagination-ellipsis";
      ellipsis.textContent = "...";
      pagControls.appendChild(ellipsis);
    }
  }
  
  for (let i = startPage; i <= endPage; i++) {
    const btnNum = document.createElement("button");
    btnNum.type = "button";
    btnNum.className = `btn-page ${i === pageBibliothequeIndex ? 'active' : ''}`;
    btnNum.textContent = i;
    btnNum.addEventListener("click", () => {
      pageBibliothequeIndex = i;
      actualiserListeBibliothequeRendering();
    });
    pagControls.appendChild(btnNum);
  }
  
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      const ellipsis = document.createElement("span");
      ellipsis.className = "pagination-ellipsis";
      ellipsis.textContent = "...";
      pagControls.appendChild(ellipsis);
    }
    
    const btnLast = document.createElement("button");
    btnLast.type = "button";
    btnLast.className = "btn-page";
    btnLast.textContent = totalPages;
    btnLast.addEventListener("click", () => {
      pageBibliothequeIndex = totalPages;
      actualiserListeBibliothequeRendering();
    });
    pagControls.appendChild(btnLast);
  }
  
  const btnNext = document.createElement("button");
  btnNext.type = "button";
  btnNext.className = "btn-page";
  btnNext.textContent = ">";
  btnNext.disabled = pageBibliothequeIndex === totalPages;
  btnNext.addEventListener("click", () => {
    pageBibliothequeIndex++;
    actualiserListeBibliothequeRendering();
  });
  pagControls.appendChild(btnNext);
}

async function actualiserListeBibliotheque() {
  const q = document.getElementById("search-q").value.trim();
  const categorie = document.getElementById("search-categorie").value;
  const occasion = document.getElementById("search-occasion") ? document.getElementById("search-occasion").value.trim() : "";
  
  actualiserBibliothequeHeaderActions();
  
  try {
    listChantsCache = await rechercherChants(q, categorie, occasion);
    actualiserListeBibliothequeRendering();
  } catch (err) {
    const listEl = document.getElementById("chant-list");
    listEl.innerHTML = etatVideHtml("⚠️", "Impossible de charger la bibliothèque", err.message);
  }
}

// --- Composer ---
const MOMENT_COLORS = {
  Entree: "#1a7c3e",
  Kyrie: "#2a5a9e",
  Gloria: "#e65c00",
  Psaume: "#7c2a9e",
  Acclamation: "#b23b3b",
  Offertoire: "#009e96",
  Sanctus: "#8a8a00",
  Anamnese: "#b23b7d",
  Notre_Pere: "#4b0082",
  Agnus: "#666666",
  Communion: "#00bfff",
  Action_de_grace: "#32cd32",
  Sortie: "#000000"
};

function momentRowHtml(moment, index) {
  const label = LABELS_MOMENTS[moment] || moment;
  const color = MOMENT_COLORS[moment] || "#666666";
  
  return `
    <div class="moment-row" data-moment="${moment}" draggable="true">
      <div class="moment-color-stripe" style="background-color: ${color};"></div>
      
      <!-- Column 1: Order -->
      <div class="col-order">
        <input type="number" class="moment-ordre-input" value="${index * 10}" step="1">
      </div>
      
      <!-- Column 2: Moment name -->
      <div class="col-moment-name" style="color: ${color};">${label}</div>
      
      <!-- Column 3: Mode -->
      <div class="col-mode">
        <label class="mode-option">
          <input type="radio" name="mode-${moment}" class="moment-mode-radio" value="chant">
          <span class="radio-custom"></span>
          <span class="mode-text">Bibliothèque</span>
        </label>
        <label class="mode-option">
          <input type="radio" name="mode-${moment}" class="moment-mode-radio" value="texte_libre">
          <span class="radio-custom"></span>
          <span class="mode-text">Ajout manuel</span>
        </label>
        <select class="moment-type" style="display:none;">
          <option value="aucun">Aucun</option>
          <option value="chant">Chant</option>
          <option value="texte_libre">Texte libre</option>
        </select>
      </div>
      
      <!-- Column 4: Selection -->
      <div class="col-selection moment-body-selection"></div>
      
      <!-- Column 5: Resume -->
      <div class="col-resume moment-body-resume"></div>
      
      <!-- Column 6: Actions -->
      <div class="col-actions">
        <button type="button" class="btn-card-icon btn-action-eye" title="Aperçu du chant">👁</button>
        <button type="button" class="btn-card-icon btn-action-pencil" title="Modifier le chant/texte">✏</button>
        <button type="button" class="btn-card-icon btn-action-book" title="Choisir de la bibliothèque">📚</button>
        <button type="button" class="btn-card-icon btn-action-trash" title="Vider ce moment">🗑</button>
        <span class="moment-drag-handle" title="Déplacer">☰</span>
      </div>
      
      <!-- Collapsible Edit Panel (full width spanned in grid) -->
      <div class="moment-edit-panel collapsed" id="edit-panel-${moment}">
        <div class="edit-panel-grid">
          <div class="field-group">
            <label>Titre de l'élément (facultatif)</label>
            <input type="text" class="titre-libre" placeholder="Ex : Intention de prière">
          </div>
          <div class="edit-panel-textareas">
            <div class="field-group">
              <label>Refrain</label>
              <textarea class="refrain-libre" rows="3" placeholder="Saisir le refrain..."></textarea>
            </div>
            <div class="field-group">
              <label>Couplets</label>
              <textarea class="couplets-libre" rows="4" placeholder="Saisir les couplets..."></textarea>
            </div>
          </div>
          <textarea class="texte-libre" style="display:none;"></textarea>
          <div class="edit-panel-actions">
            <button type="button" class="btn-close-panel">Fermer</button>
          </div>
        </div>
      </div>
    </div>`;
}

function specialRowHtml(id, state) {
  const color = "#546e7a";
  return `
    <div class="moment-row special-row" data-moment="${id}">
      <div class="moment-color-stripe" style="background-color: ${color};"></div>
      
      <!-- Column 1: Order -->
      <div class="col-order">
        <input type="number" class="moment-ordre-input" value="${state.ordre}" step="1">
      </div>
      
      <!-- Column 2: Mode -->
      <div class="col-mode">
        <label class="mode-option">
          <input type="radio" name="mode-${id}" class="moment-mode-radio" value="chant">
          <span class="radio-custom"></span>
          <span class="mode-text">Bibliothèque</span>
        </label>
        <label class="mode-option">
          <input type="radio" name="mode-${id}" class="moment-mode-radio" value="texte_libre">
          <span class="radio-custom"></span>
          <span class="mode-text">Ajout manuel</span>
        </label>
        <select class="moment-type" style="display:none;">
          <option value="aucun">Aucun</option>
          <option value="chant">Chant</option>
          <option value="texte_libre">Texte libre</option>
        </select>
      </div>
      
      <!-- Column 3: Selection -->
      <div class="col-selection moment-body-selection"></div>
      
      <!-- Column 4: Resume -->
      <div class="col-resume moment-body-resume"></div>
      
      <!-- Column 5: Actions -->
      <div class="col-actions">
        <button type="button" class="btn-card-icon btn-action-eye" title="Aperçu du chant">👁</button>
        <button type="button" class="btn-card-icon btn-action-pencil" title="Modifier le chant/texte">✏</button>
        <button type="button" class="btn-card-icon btn-action-book" title="Choisir de la bibliothèque">📚</button>
        <button type="button" class="btn-card-icon btn-supprimer-special" title="Supprimer le chant spécial">🗑</button>
        <span class="moment-drag-handle" title="Déplacer">☰</span>
      </div>
      
      <!-- Collapsible Edit Panel (full width spanned in grid) -->
      <div class="moment-edit-panel collapsed" id="edit-panel-${id}">
        <div class="edit-panel-grid">
          <div class="field-group">
            <label>Nom du chant spécial (ex : Chant additionnel)</label>
            <input type="text" class="special-label" placeholder="Nom..." value="${escapeHtml(state.label || "")}">
          </div>
          <div class="field-group">
            <label>Titre de l'élément (facultatif)</label>
            <input type="text" class="titre-libre" placeholder="Titre..." value="${escapeHtml(state.titre_libre || "")}">
          </div>
          <div class="edit-panel-textareas">
            <div class="field-group">
              <label>Refrain</label>
              <textarea class="refrain-libre" rows="3" placeholder="Saisir le refrain..."></textarea>
            </div>
            <div class="field-group">
              <label>Couplets</label>
              <textarea class="couplets-libre" rows="4" placeholder="Saisir les couplets..."></textarea>
            </div>
          </div>
          <textarea class="texte-libre" style="display:none;"></textarea>
          <div class="edit-panel-actions">
            <button type="button" class="btn-close-panel">Fermer</button>
          </div>
        </div>
      </div>
    </div>`;
}

let specialCounter = 0;

function ajouterChantSpecial(initial = null) {
  const id = `special-${++specialCounter}`;
  const state = initial || { type: "aucun", ordre: (MOMENTS.length + specialCounter) * 10, label: "" };
  momentsState[id] = state;
  const container = document.getElementById("chants-speciaux-container");
  const wrapper = document.createElement("div");
  wrapper.innerHTML = specialRowHtml(id, state);
  const row = wrapper.firstElementChild;
  container.appendChild(row);
  bindMomentCardEvents(row, id);
  row.querySelector(".moment-type").value = state.type;
  renderMomentBody(row, id);
  return row;
}

function bindMomentCardEvents(row, id) {
  const select = row.querySelector(".moment-type");
  const editPanel = row.querySelector(".moment-edit-panel");
  
  // Radio modes triggers hidden select option
  row.querySelectorAll(".moment-mode-radio").forEach((radio) => {
    radio.addEventListener("change", () => {
      select.value = radio.value;
      momentsState[id] = { ...momentsState[id], type: radio.value };
      renderMomentBody(row, id);
      
      // Auto expand edit panel when switching to Ajout manuel
      if (radio.value === "texte_libre") {
        if (editPanel) editPanel.classList.remove("collapsed");
      } else {
        if (editPanel) editPanel.classList.add("collapsed");
      }
      regenererApercuSiPossible();
    });
  });
  
  row.querySelector(".moment-ordre-input").addEventListener("input", (e) => {
    momentsState[id].ordre = Number(e.target.value) || 0;
    regenererApercuSiPossible();
  });
  
  const btnEye = row.querySelector(".btn-action-eye");
  if (btnEye) {
    btnEye.addEventListener("click", () => {
      const state = momentsState[id];
      if (state && state.chant_id) {
        ouvrirDetailsChant(state.chant_id, false);
      }
    });
  }
  
  const btnPencil = row.querySelector(".btn-action-pencil");
  if (btnPencil) {
    btnPencil.addEventListener("click", () => {
      const state = momentsState[id];
      if (state && state.type === "chant" && state.chant_id) {
        ouvrirDetailsChant(state.chant_id, true);
      } else {
        if (editPanel) editPanel.classList.toggle("collapsed");
      }
    });
  }
  
  const btnBook = row.querySelector(".btn-action-book");
  if (btnBook) {
    btnBook.addEventListener("click", () => ouvrirPicker(id));
  }
  
  const btnTrash = row.querySelector(".btn-action-trash");
  if (btnTrash) {
    btnTrash.addEventListener("click", () => {
      momentsState[id] = { type: "aucun", ordre: momentsState[id].ordre };
      if (editPanel) editPanel.classList.add("collapsed");
      renderMomentBody(row, id);
      regenererApercuSiPossible();
    });
  }
  
  const btnDeleteSpecial = row.querySelector(".btn-supprimer-special");
  if (btnDeleteSpecial) {
    btnDeleteSpecial.addEventListener("click", () => {
      delete momentsState[id];
      row.remove();
      regenererApercuSiPossible();
      actualiserStatsBottomBar();
    });
  }
  
  // Bind input fields in the edit panel
  if (editPanel) {
    const inputTitre = editPanel.querySelector(".titre-libre");
    const inputRefrain = editPanel.querySelector(".refrain-libre");
    const inputCouplets = editPanel.querySelector(".couplets-libre");
    const hiddenTextarea = editPanel.querySelector(".texte-libre");
    const btnClose = editPanel.querySelector(".btn-close-panel");
    const specialLabel = editPanel.querySelector(".special-label");
    
    const syncText = () => {
      const refrain = inputRefrain.value.trim();
      const couplets = inputCouplets.value.trim();
      if (refrain) {
        hiddenTextarea.value = `Refrain:\n${refrain}\n\nCouplets:\n${couplets}`;
      } else {
        hiddenTextarea.value = couplets;
      }
      momentsState[id].texte_libre = hiddenTextarea.value;
      
      // Update the resume text in the row in real-time
      const colResume = row.querySelector(".col-resume");
      if (colResume) {
        const isFilled = !!(momentsState[id].texte_libre || momentsState[id].titre_libre);
        colResume.innerHTML = isFilled 
          ? `<strong>${escapeHtml(momentsState[id].titre_libre || "Texte manuel")}</strong>` 
          : `<span class="text-muted">Vide</span>`;
      }
      
      regenererApercuSiPossible();
      actualiserStatsBottomBar();
    };
    
    if (inputTitre) {
      inputTitre.addEventListener("input", (e) => {
        momentsState[id].titre_libre = e.target.value;
        const colResume = row.querySelector(".col-resume");
        if (colResume) {
          const isFilled = !!(momentsState[id].texte_libre || momentsState[id].titre_libre);
          colResume.innerHTML = isFilled 
            ? `<strong>${escapeHtml(momentsState[id].titre_libre || "Texte manuel")}</strong>` 
            : `<span class="text-muted">Vide</span>`;
        }
        regenererApercuSiPossible();
      });
    }
    
    if (inputRefrain) inputRefrain.addEventListener("input", syncText);
    if (inputCouplets) inputCouplets.addEventListener("input", syncText);
    
    if (btnClose) {
      btnClose.addEventListener("click", () => {
        editPanel.classList.add("collapsed");
      });
    }
    
    if (specialLabel) {
      specialLabel.addEventListener("input", (e) => {
        momentsState[id].label = e.target.value;
        regenererApercuSiPossible();
      });
    }
  }
}

function viderChantsSpeciaux() {
  document.getElementById("chants-speciaux-container").innerHTML = "";
  Object.keys(momentsState).forEach((k) => { if (k.startsWith("special-")) delete momentsState[k]; });
  actualiserStatsBottomBar();
}

function renderMomentBody(row, moment) {
  const state = momentsState[moment] || { type: "aucun" };
  const colSelection = row.querySelector(".col-selection");
  const colResume = row.querySelector(".col-resume");
  
  const select = row.querySelector(".moment-type");
  if (select) select.value = state.type;
  
  const checkedRadio = row.querySelector(`.moment-mode-radio[value="${state.type}"]`);
  if (checkedRadio) checkedRadio.checked = true;
  
  if (state.type === "chant") {
    const total = state.total_couplets || 0;
    const limiteHtml = total > 0 ? `
      <label class="couplet-limite">Couplets :
        <select class="select-couplet-limite">
          <option value="">Tous (${total})</option>
          <option value="0" ${state.couplet_limit === 0 ? "selected" : ""}>Aucun (0)</option>
          ${Array.from({ length: total }, (_, i) => i + 1).map((n) => `
            <option value="${n}" ${state.couplet_limit === n ? "selected" : ""}>${n}</option>
          `).join("")}
        </select>
      </label>` : "";
      
    if (state.chant_titre) {
      colSelection.innerHTML = `
        <div class="selection-input-wrapper select-song-trigger">
          <span class="selected-song-title">${escapeHtml(state.chant_titre)}</span>
          <span class="search-icon">🔍</span>
        </div>
        ${limiteHtml}
      `;
      colResume.innerHTML = `
        <div class="selection-status-success">
          <span class="chk-icon">✓</span> <span>${escapeHtml(state.chant_titre)}</span>
        </div>
      `;
    } else {
      colSelection.innerHTML = `
        <div class="selection-input-wrapper select-song-trigger">
          <span class="search-icon">🔍</span> <span class="text-muted" style="font-weight:normal;">Choisir un chant...</span>
        </div>
      `;
      colResume.innerHTML = `<span class="text-muted">—</span>`;
    }
    
    // Bind the song search click
    const trigger = colSelection.querySelector(".select-song-trigger");
    if (trigger) {
      trigger.addEventListener("click", () => ouvrirPicker(moment));
    }
    
    const selectLimite = colSelection.querySelector(".select-couplet-limite");
    if (selectLimite) selectLimite.addEventListener("change", () => {
      momentsState[moment].couplet_limit = selectLimite.value ? Number(selectLimite.value) : null;
      regenererApercuSiPossible();
    });
    
  } else if (state.type === "texte_libre") {
    const isFilled = !!(state.texte_libre || state.titre_libre);
    colSelection.innerHTML = `
      <button type="button" class="btn-add-manual">
        ✏️ ${isFilled ? "Modifier le texte" : "Saisir le texte"}
      </button>
    `;
    colResume.innerHTML = isFilled 
      ? `<strong>${escapeHtml(state.titre_libre || "Texte manuel")}</strong>` 
      : `<span class="text-muted">Vide</span>`;
      
    // Sync values to edit panel inputs
    const editPanel = row.querySelector(".moment-edit-panel");
    if (editPanel) {
      let refrainVal = "";
      let coupletsVal = state.texte_libre || "";
      const normalized = coupletsVal.replace(/\r\n/g, "\n");
      if (normalized.startsWith("Refrain:\n")) {
        const parts = normalized.split("\n\nCouplets:\n");
        if (parts.length === 2) {
          refrainVal = parts[0].substring("Refrain:\n".length);
          coupletsVal = parts[1];
        }
      }
      const inputTitre = editPanel.querySelector(".titre-libre");
      const inputRefrain = editPanel.querySelector(".refrain-libre");
      const inputCouplets = editPanel.querySelector(".couplets-libre");
      const hiddenTextarea = editPanel.querySelector(".texte-libre");
      
      if (inputTitre) inputTitre.value = state.titre_libre || "";
      if (inputRefrain) inputRefrain.value = refrainVal;
      if (inputCouplets) inputCouplets.value = coupletsVal;
      if (hiddenTextarea) hiddenTextarea.value = state.texte_libre || "";
    }
    
    const btnAddManual = colSelection.querySelector(".btn-add-manual");
    if (btnAddManual) {
      btnAddManual.addEventListener("click", () => {
        const editPanel = row.querySelector(".moment-edit-panel");
        if (editPanel) {
          editPanel.classList.toggle("collapsed");
        }
      });
    }
    
  } else {
    colSelection.innerHTML = `<span class="text-muted" style="font-size: 0.78rem;">Aucun chant sélectionné</span>`;
    colResume.innerHTML = `<span class="text-muted">—</span>`;
  }
  
  // Configure action icons visibility
  const btnEye = row.querySelector(".btn-action-eye");
  const btnPencil = row.querySelector(".btn-action-pencil");
  if (state.type === "chant" && state.chant_id) {
    if (btnEye) btnEye.style.display = "inline-flex";
    if (btnPencil) btnPencil.style.display = "inline-flex";
  } else {
    if (btnEye) btnEye.style.display = "none";
    if (btnPencil) {
      if (state.type === "texte_libre" || moment.startsWith("special-")) {
        btnPencil.style.display = "inline-flex";
      } else {
        btnPencil.style.display = "none";
      }
    }
  }
  
  actualiserStatsBottomBar();
}

function actualiserStatsBottomBar() {
  let chantsCount = 0;
  let momentsRemplis = 0;
  let totalMoments = 0;
  
  MOMENTS.forEach((m) => {
    const state = momentsState[m];
    totalMoments++;
    if (state) {
      if (state.type === "chant" && state.chant_id) {
        chantsCount++;
        momentsRemplis++;
      } else if (state.type === "texte_libre" && state.texte_libre) {
        momentsRemplis++;
      }
    }
  });
  
  document.querySelectorAll("#chants-speciaux-container .special-row").forEach((row) => {
    const id = row.dataset.moment;
    const state = momentsState[id];
    if (state) {
      if (state.type === "chant" && state.chant_id) {
        chantsCount++;
      }
    }
  });
  
  const countEl = document.getElementById("composer-bar-chants-count");
  if (countEl) countEl.textContent = `${chantsCount} chant${chantsCount !== 1 ? "s" : ""} sélectionné${chantsCount !== 1 ? "s" : ""}`;
  
  const checklistEl = document.getElementById("composer-bar-checklist");
  if (checklistEl) {
    if (momentsRemplis === totalMoments && totalMoments > 0) {
      checklistEl.innerHTML = "🟢 Tous les moments remplis";
    } else {
      checklistEl.innerHTML = `🟡 Moments remplis : ${momentsRemplis}/${totalMoments}`;
    }
  }
  
  const timeEl = document.getElementById("composer-bar-update-time");
  if (timeEl) {
    timeEl.textContent = "Mis à jour à l'instant";
  }
}

function trierMomentsVisuellement() {
  const container = document.getElementById("moments-container");
  if (!container) return;
  const cards = Array.from(container.children);
  cards.sort((a, b) => {
    const keyA = a.dataset.moment;
    const keyB = b.dataset.moment;
    const ordA = momentsState[keyA] ? momentsState[keyA].ordre : 999;
    const ordB = momentsState[keyB] ? momentsState[keyB].ordre : 999;
    return ordA - ordB;
  });
  cards.forEach((card) => container.appendChild(card));
}

function initDragAndDrop() {
  const container = document.getElementById("moments-container");
  if (!container) return;
  let dragEl = null;
  
  container.addEventListener("dragstart", (e) => {
    // Restrict drag start to drag handle
    if (!e.target.closest(".moment-drag-handle")) {
      e.preventDefault();
      return;
    }
    const card = e.target.closest(".moment-row");
    if (!card) {
      e.preventDefault();
      return;
    }
    dragEl = card;
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  
  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    
    const card = e.target.closest(".moment-row");
    if (card && card !== dragEl) {
      const rect = card.getBoundingClientRect();
      const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
      container.insertBefore(dragEl, next ? card.nextSibling : card);
    }
  });
  
  container.addEventListener("dragend", () => {
    if (dragEl) {
      dragEl.classList.remove("dragging");
      dragEl = null;
      
      const cards = Array.from(container.children);
      cards.forEach((card, index) => {
        const moment = card.dataset.moment;
        const inputOrdre = card.querySelector(".moment-ordre-input");
        const newOrdre = index * 10;
        if (inputOrdre) inputOrdre.value = newOrdre;
        if (momentsState[moment]) momentsState[moment].ordre = newOrdre;
      });
      
      regenererApercuSiPossible();
      actualiserStatsBottomBar();
      showToast("Ordre mis à jour");
    }
  });
}

function showToast(message, type = "success") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.style.cssText = "position: fixed; top: 24px; right: 24px; z-index: 9999; display: flex; flex-direction: column; gap: 10px; pointer-events: none;";
    document.body.appendChild(container);
  }
  
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.style.cssText = "background: #1e293b; color: white; padding: 12px 20px; border-radius: 8px; font-size: 0.88rem; font-weight: 600; box-shadow: 0 4px 12px rgba(0,0,0,0.15); opacity: 0; transform: translateY(-20px); transition: opacity 0.25s, transform 0.25s; pointer-events: auto; border-left: 4px solid #10b981;";
  if (type === "error") {
    toast.style.borderLeftColor = "#ef4444";
  }
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  }, 10);
  
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-20px)";
    setTimeout(() => { toast.remove(); }, 250);
  }, 3000);
}

function updatePriereStateBasedOnOnePageMode() {
  const onePageCheck = document.getElementById("f-one-page-mode");
  const priereCheck = document.getElementById("f-priere-active");
  const priereText = document.getElementById("f-priere-texte");
  if (onePageCheck && priereCheck) {
    if (onePageCheck.checked) {
      priereCheck.checked = false;
      priereCheck.disabled = true;
      if (priereText) {
        priereText.disabled = true;
        priereText.value = "";
      }
    } else {
      priereCheck.disabled = false;
      if (priereText) {
        priereText.disabled = false;
      }
    }
  }
}

function initComposer() {
  const container = document.getElementById("moments-container");
  container.innerHTML = MOMENTS.map((m, i) => momentRowHtml(m, i)).join("");
  container.querySelectorAll(".moment-row").forEach((row) => {
    const moment = row.dataset.moment;
    momentsState[moment] = { type: "aucun", ordre: Number(row.querySelector(".moment-ordre-input").value) };
    bindMomentCardEvents(row, moment);
  });
  
  // Custom celebration inputs
  ["f-type-celebration", "f-president", "f-animateur", "f-chorale-info"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.value = localStorage.getItem(id) || "";
      el.addEventListener("input", () => {
        localStorage.setItem(id, el.value);
        regenererApercuSiPossible();
      });
    }
  });

  // Default input fields sync
  ["f-date", "f-lieu", "f-lecture1", "f-psaume", "f-lecture2", "f-evangile"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", () => {
        regenererApercuSiPossible();
      });
    }
  });
  
  // Standard widgets
  const priereCheck = document.getElementById("f-priere-active");
  if (priereCheck) {
    priereCheck.addEventListener("change", () => {
      regenererApercuSiPossible();
    });
  }
  const priereText = document.getElementById("f-priere-texte");
  if (priereText) {
    priereText.addEventListener("input", () => {
      regenererApercuSiPossible();
    });
  }
  
  // Custom checkboxes widgets (saved to localStorage for workflow preservation)
  ["f-widget-info-chorale", "f-widget-ref-bibles"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.checked = localStorage.getItem(id) === "true";
      el.addEventListener("change", () => {
        localStorage.setItem(id, el.checked);
        regenererApercuSiPossible();
      });
    }
  });

  const onePageCheck = document.getElementById("f-one-page-mode");
  if (onePageCheck) {
    onePageCheck.checked = localStorage.getItem("f-one-page-mode") === "true";
    onePageCheck.addEventListener("change", () => {
      localStorage.setItem("f-one-page-mode", onePageCheck.checked);
      regenererApercuSiPossible();
    });
  }

  const banniereCheck = document.getElementById("f-banniere-active");
  if (banniereCheck) {
    const saved = localStorage.getItem("f-banniere-active");
    banniereCheck.checked = saved === null ? true : saved === "true";
    banniereCheck.addEventListener("change", () => {
      localStorage.setItem("f-banniere-active", banniereCheck.checked);
      regenererApercuSiPossible();
    });
  }
  
  // Lecture search button triggers picker
  document.querySelectorAll(".btn-search-lecture").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetInputId = btn.dataset.target;
      ouvrirPickerPourLecture(targetInputId);
    });
  });
  
  // Header buttons action
  const btnAjouterMoment = document.getElementById("btn-composer-ajouter-moment");
  if (btnAjouterMoment) {
    btnAjouterMoment.addEventListener("click", () => {
      ajouterChantSpecial();
    });
  }
  
  const btnReinit = document.getElementById("btn-composer-reinit-ordre");
  if (btnReinit) {
    btnReinit.addEventListener("click", () => {
      document.querySelectorAll("#moments-container .moment-row").forEach((row, i) => {
        const moment = row.dataset.moment;
        const newOrdre = i * 10;
        row.querySelector(".moment-ordre-input").value = newOrdre;
        if (momentsState[moment]) {
          momentsState[moment].ordre = newOrdre;
        }
      });
      trierMomentsVisuellement();
      regenererApercuSiPossible(true);
      showToast("Ordre réinitialisé !");
    });
  }
  
  const btnTri = document.getElementById("btn-composer-tri-auto");
  if (btnTri) {
    btnTri.addEventListener("click", () => {
      trierMomentsVisuellement();
      regenererApercuSiPossible(true);
      showToast("Tri automatique appliqué !");
    });
  }
  
  // Tool buttons actions
  const btnZoomOut = document.getElementById("pv-btn-zoom-out");
  if (btnZoomOut) {
    btnZoomOut.addEventListener("click", () => ajusterTailleTexte(-1));
  }
  const btnZoomIn = document.getElementById("pv-btn-zoom-in");
  if (btnZoomIn) {
    btnZoomIn.addEventListener("click", () => ajusterTailleTexte(1));
  }
  const btnZoom100 = document.getElementById("pv-btn-zoom-100");
  if (btnZoom100) {
    btnZoom100.addEventListener("click", () => resetTailleTexteAuto());
  }
  const btnDownload = document.getElementById("pv-btn-download");
  if (btnDownload) {
    btnDownload.addEventListener("click", () => {
      if (!feuilletCourantId) return;
      const a = document.createElement("a");
      a.href = `/feuillets/${feuilletCourantId}/pdf`;
      a.download = `feuillet-${feuilletCourantId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }
  const btnPrint = document.getElementById("pv-btn-print");
  if (btnPrint) {
    btnPrint.addEventListener("click", () => {
      if (!feuilletCourantId) return;
      const printWindow = window.open(`/feuillets/${feuilletCourantId}/pdf`, "_blank");
      printWindow.addEventListener("load", () => {
        printWindow.print();
      });
    });
  }
  const btnFullscreen = document.getElementById("pv-btn-fullscreen");
  if (btnFullscreen) {
    btnFullscreen.addEventListener("click", () => {
      const col = document.querySelector(".composer-preview-column");
      if (!col) return;
      if (!document.fullscreenElement) {
        col.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen();
      }
    });
  }
  const btnRefresh = document.getElementById("pv-btn-refresh");
  if (btnRefresh) {
    btnRefresh.addEventListener("click", () => {
      regenererApercuSiPossible(true);
    });
  }
  
  // Bottom bar buttons actions
  const btnSaveDraft = document.getElementById("btn-save-draft");
  if (btnSaveDraft) {
    btnSaveDraft.addEventListener("click", () => enregistrerBrouillon());
  }
  const btnGeneratePdfDirect = document.getElementById("btn-generate-pdf-direct");
  if (btnGeneratePdfDirect) {
    btnGeneratePdfDirect.addEventListener("click", () => regenererApercuSiPossible(true));
  }
  const btnSubmitComposer = document.getElementById("btn-submit-composer");
  if (btnSubmitComposer) {
    btnSubmitComposer.addEventListener("click", () => {
      const form = document.getElementById("feuillet-form");
      if (form.reportValidity()) {
        form.dispatchEvent(new Event("submit"));
      }
    });
  }
  
  // Mobile Tab toggle actions
  const btnCompTabForm = document.getElementById("btn-comp-tab-form");
  const btnCompTabPreview = document.getElementById("btn-comp-tab-preview");
  const formCol = document.querySelector(".composer-form-column");
  const previewCol = document.querySelector(".composer-preview-column");
  
  if (btnCompTabForm && btnCompTabPreview && formCol && previewCol) {
    btnCompTabForm.addEventListener("click", () => {
      btnCompTabForm.classList.add("active");
      btnCompTabPreview.classList.remove("active");
      formCol.classList.remove("inactive-tab");
      previewCol.classList.remove("active-tab");
    });
    
    btnCompTabPreview.addEventListener("click", () => {
      btnCompTabPreview.classList.add("active");
      btnCompTabForm.classList.remove("active");
      formCol.classList.add("inactive-tab");
      previewCol.classList.add("active-tab");
    });
  }
  
  initDragAndDrop();
  actualiserStatsBottomBar();
}

async function ajusterTailleTexte(delta) {
  const currentValSpan = document.getElementById("taille-texte-valeur");
  const currentSize = currentValSpan ? (parseFloat(currentValSpan.textContent) || 12) : 12;
  const base = tailleTexteManuelle !== null ? tailleTexteManuelle : currentSize;
  tailleTexteManuelle = Math.max(8, Math.min(32, base + delta));
  await regenererApercuSiPossible(true);
}

async function resetTailleTexteAuto() {
  tailleTexteManuelle = null;
  await regenererApercuSiPossible(true);
}

async function enregistrerBrouillon() {
  const payload = construirFeuilletPayload();
  if (!payload.date) {
    alert("Veuillez sélectionner une date pour enregistrer le brouillon.");
    return;
  }
  
  try {
    const btn = document.getElementById("btn-save-draft");
    await avecChargement(btn, async () => {
      const feuillet = feuilletCourantId
        ? await api(`/feuillets/${feuilletCourantId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await api("/feuillets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      feuilletCourantId = feuillet.id;
      await actualiserDepliants();
      await actualiserStatsBottomBar();
      showToast("💾 Brouillon enregistré avec succès !");
    });
  } catch (err) {
    alert(`Erreur d'enregistrement : ${err.message}`);
  }
}

function ouvrirPicker(moment) {
  pickerTargetMoment = moment;
  pickerTargetInputId = null;
  ouvrirModale("chant-picker");
  document.getElementById("picker-q").value = "";
  const categorieSelect = document.getElementById("picker-categorie");
  if ([...categorieSelect.options].some((o) => o.value === moment)) {
    categorieSelect.value = moment;
  } else {
    categorieSelect.value = "";
  }
  const hint = document.getElementById("picker-suggestion-hint");
  hint.textContent = categorieSelect.value
    ? `Suggestions pour « ${categorieLabel(moment)} » — change la catégorie pour voir autre chose.`
    : "";
  actualiserPicker();
}

function ouvrirPickerPourLecture(inputId) {
  pickerTargetMoment = null;
  pickerTargetInputId = inputId;
  ouvrirModale("chant-picker");
  document.getElementById("picker-q").value = "";
  document.getElementById("picker-categorie").value = "";
  document.getElementById("picker-suggestion-hint").textContent = "Sélectionnez un chant pour remplir le champ de lecture.";
  actualiserPicker();
}

document.getElementById("picker-close").addEventListener("click", () => {
  fermerModale("chant-picker");
});

document.getElementById("picker-q").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(actualiserPicker, 300);
});

document.getElementById("picker-categorie").addEventListener("change", () => {
  document.getElementById("picker-suggestion-hint").textContent = "";
  actualiserPicker();
});

async function actualiserPicker() {
  const q = document.getElementById("picker-q").value.trim();
  const categorie = document.getElementById("picker-categorie").value;
  const chants = await rechercherChants(q, categorie);
  const list = document.getElementById("picker-list");
  if (chants.length === 0) {
    const contexte = categorie ? ` dans « ${categorieLabel(categorie)} »` : "";
    list.innerHTML = etatVideHtml("🔍", `Aucun chant${contexte}${q ? ` pour « ${escapeHtml(q)} »` : ""}`,
      categorie ? "Choisis « Toutes catégories » pour élargir la recherche." : "Essaie un autre mot.");
  } else {
    list.innerHTML = chants.map(chantCardHtml).join("");
  }
  list.querySelectorAll(".chant-item").forEach((el) => {
    el.addEventListener("click", () => avecChargementChant(list, el, async () => {
      const id = Number(el.dataset.id);
      const chant = chants.find((c) => c.id === id);
      ouvrirDetailChant(chant);
    }));
  });
}

// --- Détail d'un chant avant ajout au feuillet (Composer) ---
let chantDetailCourant = null;

async function dupliquerChant(chant) {
  try {
    const payload = {
      titre: chant.titre + " - Copie",
      categorie: chant.categorie,
      refrain: chant.refrain,
      couplets: chant.couplets,
      code_reference: chant.code_reference ? chant.code_reference + " (copie)" : null,
      langue: chant.langue,
      occasions: chant.occasions,
      mots_cles: chant.mots_cles,
      actif: chant.actif,
      favori: chant.favori,
      chant_principal: chant.chant_principal,
      tonalite: chant.tonalite,
      duree_estimee: chant.duree_estimee,
      remarques: chant.remarques,
    };
    await api("/chants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    alert("Chant dupliqué avec succès !");
    await actualiserEditeur();
    await actualiserListeBibliotheque();
  } catch (err) {
    alert(`Erreur lors de la duplication : ${err.message}`);
  }
}

function exporterChant(chant) {
  const content = `Titre: ${chant.titre}\nCatégorie: ${categorieLabel(chant.categorie)}\nRéf: ${chant.code_reference || ""}\nLangue: ${chant.langue || ""}\nOccasions: ${(chant.occasions || []).join(", ")}\n\nRefrain:\n${chant.refrain || ""}\n\nCouplets:\n${(chant.couplets || []).join("\n\n")}`;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugifyClient(chant.titre)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function imprimerChant(chant) {
  const printWindow = window.open("", "_blank");
  printWindow.document.write(`
    <html>
      <head>
        <title>${escapeHtml(chant.titre)}</title>
        <style>
          body { font-family: sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; line-height: 1.6; }
          h1 { border-bottom: 2px solid #1a3c6e; padding-bottom: 10px; color: #1a3c6e; }
          .meta { font-size: 0.9rem; color: #666; margin-bottom: 20px; }
          .refrain { font-weight: bold; background: #f0f4fa; padding: 12px; border-left: 4px solid #1a3c6e; margin-bottom: 20px; white-space: pre-wrap; border-radius: 4px; }
          .couplet { margin-bottom: 15px; white-space: pre-wrap; }
          .couplet-num { font-weight: bold; color: #1a3c6e; margin-right: 5px; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(chant.titre)}</h1>
        <div class="meta">
          <strong>Catégorie :</strong> ${escapeHtml(categorieLabel(chant.categorie))} | 
          <strong>Référence :</strong> ${escapeHtml(chant.code_reference || "N/A")} | 
          <strong>Langue :</strong> ${escapeHtml(NOMS_LANGUES[chant.langue] || chant.langue || "Français")}
        </div>
        ${chant.refrain ? `<div class="refrain"><strong>Refrain :</strong><br>${escapeHtml(chant.refrain)}</div>` : ""}
        ${(chant.couplets || []).map((c, i) => `
          <div class="couplet">
            <span class="couplet-num">${i + 1}.</span>${escapeHtml(c)}
          </div>
        `).join("")}
        <script>
          window.onload = function() { window.print(); window.close(); }
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

async function toggleFavoriChant(chant) {
  try {
    chant.favori = !chant.favori;
    await api(`/chants/${chant.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favori: chant.favori }),
    });
    alert(chant.favori ? "Chant ajouté aux favoris !" : "Chant retiré des favoris.");
    await actualiserListeBibliotheque();
  } catch (err) {
    alert(`Erreur : ${err.message}`);
  }
}

async function supprimerChantDetail(id) {
  if (!id) return;
  if (!confirm("Demander la suppression de ce chant ? Il disparaîtra immédiatement de ta bibliothèque ; la décision finale revient au super-admin.")) return;
  try {
    await api("/moderation/demandes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type_cible: "chant", cible_id: Number(id) }),
    });
    alert("Demande de suppression envoyée !");
    await actualiserEditeur();
    await actualiserListeBibliotheque();
  } catch (err) {
    alert(`Erreur : ${err.message}`);
  }
}

function copierChantParoles(chant) {
  const text = `${chant.titre}\n\nRefrain:\n${chant.refrain || ""}\n\nCouplets:\n${(chant.couplets || []).join("\n\n")}`;
  navigator.clipboard.writeText(text);
  alert("Paroles copiées dans le presse-papiers !");
}

function ouvrirDetailChant(chant) {
  chantDetailCourant = chant;
  
  document.getElementById("cd-categorie").textContent = categorieLabel(chant.categorie);
  document.getElementById("cd-categorie").className = `cd-categorie-pill cat-pill-${(chant.categorie || "autre").toLowerCase()}`;
  document.getElementById("cd-titre").textContent = chant.titre || "(sans titre)";
  
  document.getElementById("cd-meta-ref").innerHTML = chant.code_reference ? `Réf : <strong>${escapeHtml(chant.code_reference)}</strong>` : "Pas de référence";
  
  const nomLangue = NOMS_LANGUES[chant.langue] || chant.langue || "Français";
  document.getElementById("cd-meta-langue").innerHTML = `Langue : <strong>${escapeHtml(nomLangue)}</strong>`;
  
  document.getElementById("cd-meta-occasions").innerHTML = (chant.occasions && chant.occasions.length > 0)
    ? `Occasions : <strong>${escapeHtml(chant.occasions.join(", "))}</strong>`
    : "";
    
  const refrainContainer = document.getElementById("cd-refrain-container");
  if (chant.refrain) {
    refrainContainer.classList.remove("hidden");
    document.getElementById("cd-refrain-text").textContent = chant.refrain;
  } else {
    refrainContainer.classList.add("hidden");
  }
  
  const coupletsList = document.getElementById("cd-couplets-list");
  coupletsList.innerHTML = "";
  if (chant.couplets && chant.couplets.length > 0) {
    chant.couplets.forEach((c, i) => {
      const p = document.createElement("p");
      p.className = "cd-couplet-text";
      p.innerHTML = `<span class="cd-couplet-num">${i + 1}</span>${escapeHtml(c)}`;
      coupletsList.appendChild(p);
    });
  } else {
    coupletsList.innerHTML = `<p class="hint">Aucun couplet enregistré.</p>`;
  }
  
  const tagsList = document.getElementById("cd-mots-cles-list");
  tagsList.innerHTML = "";
  if (chant.mots_cles && chant.mots_cles.length > 0) {
    chant.mots_cles.forEach(tag => {
      const span = document.createElement("span");
      span.className = "cd-tag-pill";
      span.textContent = tag;
      tagsList.appendChild(span);
    });
  } else {
    tagsList.innerHTML = `<span class="hint">Aucun mot-clé</span>`;
  }
  
  let stateText = "Actif";
  let etatClass = "badge-actif";
  if (chant.actif === false) {
    stateText = "Archivé";
    etatClass = "badge-archive";
  } else if (chant.confiance < 0.7) {
    stateText = "À vérifier";
    etatClass = "badge-a-verifier";
  }
  
  document.getElementById("cd-hist-etat").innerHTML = `<span class="cd-badge ${etatClass}">${stateText}</span>`;
  
  const dateCreation = chant.created_at ? new Date(chant.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "N/A";
  document.getElementById("cd-hist-creation").textContent = dateCreation;
  document.getElementById("cd-hist-modification").textContent = dateCreation;
  
  const auteur = chant.source_file ? chant.source_file.replace(/_/g, " ").replace(/\.[^/.]+$/, "") : "Système";
  document.getElementById("cd-hist-auteur").textContent = auteur;
  
  const footerActions = document.getElementById("cd-footer-actions");
  footerActions.innerHTML = "";
  
  if (IDENTITE && IDENTITE.type === "super") {
    const btnSupprimer = document.createElement("button");
    btnSupprimer.type = "button";
    btnSupprimer.className = "btn-effacer";
    btnSupprimer.innerHTML = "🗑 Supprimer";
    btnSupprimer.addEventListener("click", () => {
      fermerModale("chant-detail-modal");
      supprimerChantDetail(chant.id);
    });
    footerActions.appendChild(btnSupprimer);
    
    if (chant.actif !== false) {
      const btnArchiver = document.createElement("button");
      btnArchiver.type = "button";
      btnArchiver.className = "btn-secondary";
      btnArchiver.innerHTML = "📥 Archiver";
      btnArchiver.addEventListener("click", async () => {
        if (confirm("Archiver ce chant ? Il ne sera plus disponible par défaut.")) {
          await api(`/chants/${chant.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ actif: false }),
          });
          fermerModale("chant-detail-modal");
          await actualiserListeBibliotheque();
        }
      });
      footerActions.appendChild(btnArchiver);
    } else {
      const btnActiver = document.createElement("button");
      btnActiver.type = "button";
      btnActiver.className = "btn-secondary";
      btnActiver.innerHTML = "📤 Restaurer";
      btnActiver.addEventListener("click", async () => {
        await api(`/chants/${chant.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actif: true }),
        });
        fermerModale("chant-detail-modal");
        await actualiserListeBibliotheque();
      });
      footerActions.appendChild(btnActiver);
    }
    
    const btnDupliquer = document.createElement("button");
    btnDupliquer.type = "button";
    btnDupliquer.className = "btn-secondary";
    btnDupliquer.innerHTML = "📄 Dupliquer";
    btnDupliquer.addEventListener("click", async () => {
      fermerModale("chant-detail-modal");
      await dupliquerChant(chant);
    });
    footerActions.appendChild(btnDupliquer);
    
    const btnExporter = document.createElement("button");
    btnExporter.type = "button";
    btnExporter.className = "btn-secondary";
    btnExporter.innerHTML = "⬇ Exporter";
    btnExporter.addEventListener("click", () => exporterChant(chant));
    footerActions.appendChild(btnExporter);
    
    const btnImprimer = document.createElement("button");
    btnImprimer.type = "button";
    btnImprimer.className = "btn-secondary";
    btnImprimer.innerHTML = "🖨 Imprimer";
    btnImprimer.addEventListener("click", () => imprimerChant(chant));
    footerActions.appendChild(btnImprimer);

    const btnModifier = document.createElement("button");
    btnModifier.type = "button";
    btnModifier.className = "btn-primary";
    btnModifier.innerHTML = "✏ Modifier";
    btnModifier.addEventListener("click", () => {
      fermerModale("chant-detail-modal");
      ouvrirEditeurChant(chant.id);
    });
    footerActions.appendChild(btnModifier);
  } else {
    const btnFavori = document.createElement("button");
    btnFavori.type = "button";
    btnFavori.className = "btn-secondary";
    btnFavori.innerHTML = chant.favori ? "★ Retirer des favoris" : "☆ Ajouter aux favoris";
    btnFavori.addEventListener("click", async () => {
      fermerModale("chant-detail-modal");
      await toggleFavoriChant(chant);
    });
    footerActions.appendChild(btnFavori);
    
    if (pickerTargetMoment || pickerTargetInputId) {
      const btnAjouter = document.createElement("button");
      btnAjouter.type = "button";
      btnAjouter.className = "btn-primary";
      btnAjouter.innerHTML = "➕ Ajouter au dépliant";
      btnAjouter.addEventListener("click", () => {
        if (pickerTargetInputId) {
          const input = document.getElementById(pickerTargetInputId);
          if (input) {
            input.value = chant.titre;
            input.dispatchEvent(new Event("input"));
          }
          fermerModale("chant-detail-modal");
          fermerModale("chant-picker");
          pickerTargetInputId = null;
          return;
        }
        if (!chantDetailCourant || !pickerTargetMoment) return;
        momentsState[pickerTargetMoment] = {
          ...momentsState[pickerTargetMoment],
          type: "chant", chant_id: chant.id, chant_titre: chant.titre,
          total_couplets: (chant.couplets || []).length, couplet_limit: null,
          refrain: chant.refrain, couplets: chant.couplets,
        };
        const row = document.querySelector(`.moment-row[data-moment="${pickerTargetMoment}"]`);
        renderMomentBody(row, pickerTargetMoment);
        regenererApercuSiPossible();
        fermerModale("chant-detail-modal");
        fermerModale("chant-picker");
      });
      footerActions.appendChild(btnAjouter);
    } else {
      const btnComposer = document.createElement("button");
      btnComposer.type = "button";
      btnComposer.className = "btn-secondary";
      btnComposer.innerHTML = "Composer un dépliant";
      btnComposer.addEventListener("click", () => {
        fermerModale("chant-detail-modal");
        changerVue("composer");
      });
      footerActions.appendChild(btnComposer);
    }
    
    const btnCopier = document.createElement("button");
    btnCopier.type = "button";
    btnCopier.className = "btn-secondary";
    btnCopier.innerHTML = "📋 Copier paroles";
    btnCopier.addEventListener("click", () => copierChantParoles(chant));
    footerActions.appendChild(btnCopier);
    
    const btnImprimer = document.createElement("button");
    btnImprimer.type = "button";
    btnImprimer.className = "btn-secondary";
    btnImprimer.innerHTML = "🖨 Imprimer";
    btnImprimer.addEventListener("click", () => imprimerChant(chant));
    footerActions.appendChild(btnImprimer);
  }
  
  const btnFermer = document.createElement("button");
  btnFermer.type = "button";
  btnFermer.className = "btn-secondary";
  btnFermer.innerHTML = "Fermer";
  btnFermer.addEventListener("click", () => fermerModale("chant-detail-modal"));
  footerActions.appendChild(btnFermer);
  
  ouvrirModale("chant-detail-modal");
}

function construireFeuilletPayload() {
  const moments = [];
  for (const moment of MOMENTS) {
    const state = momentsState[moment];
    if (!state || state.type === "aucun") continue;
    if (state.type === "chant" && !state.chant_id) continue;
    if (state.type === "texte_libre" && !state.texte_libre) continue;
    moments.push({
      moment,
      type: state.type,
      chant_id: state.chant_id || null,
      titre_libre: state.titre_libre || null,
      texte_libre: state.texte_libre || null,
      couplet_limit: state.couplet_limit === 0 ? 0 : (state.couplet_limit || null),
      ordre: state.ordre != null ? state.ordre : null,
    });
  }
  document.querySelectorAll("#chants-speciaux-container .special-row").forEach((row) => {
    const id = row.dataset.moment;
    const state = momentsState[id];
    if (!state || state.type === "aucun") return;
    if (state.type === "chant" && !state.chant_id) return;
    if (state.type === "texte_libre" && !state.texte_libre) return;
    moments.push({
      moment: (state.label || "").trim() || "Chant spécial",
      type: state.type,
      chant_id: state.chant_id || null,
      titre_libre: state.titre_libre || null,
      texte_libre: state.texte_libre || null,
      couplet_limit: state.couplet_limit === 0 ? 0 : (state.couplet_limit || null),
      ordre: state.ordre != null ? state.ordre : null,
    });
  });
  return {
    date: document.getElementById("f-date").value,
    lieu: document.getElementById("f-lieu").value,
    lectures: {
      premiere_lecture: document.getElementById("f-lecture1").value,
      psaume: document.getElementById("f-psaume").value,
      deuxieme_lecture: document.getElementById("f-lecture2").value,
      evangile: document.getElementById("f-evangile").value,
    },
    moments,
    priere_active: document.getElementById("f-priere-active").checked,
    priere_texte: document.getElementById("f-priere-texte").value || null,
    taille_texte_manuelle: tailleTexteManuelle,
    one_page_mode: document.getElementById("f-one-page-mode").checked,
    banniere_active: document.getElementById("f-banniere-active").checked,
  };
}

function nettoyerMomentsEnCause() {
  document.querySelectorAll(".moment-row.moment-en-cause").forEach((row) => row.classList.remove("moment-en-cause"));
}

function afficherErreurDepassement(detail, resultDiv) {
  const message = typeof detail === "object" && detail !== null ? detail.message : String(detail || "Erreur inconnue");
  const moments = (typeof detail === "object" && detail !== null && detail.moments_en_cause) || [];
  
  let explications = "Certains moments débordent sur le feuillet imprimable (surlignés en rouge dans l'aperçu ci-dessous).<br/>" +
    "Pour faire tenir le document sur 2 pages, vous devez :<br/>" +
    "<ul>" +
    "  <li>Réduire le nombre de couplets à afficher pour les chants en cause (ex: afficher 2 couplets au lieu de 4).</li>" +
    "  <li>Ou raccourcir le texte libre / les paroles du chant.</li>" +
    "</ul>";
    
  resultDiv.innerHTML = `
    <div class="etat-vide" style="border: 2px solid var(--danger); background: #fdeaea; padding: 12px; border-radius: 8px;">
      <div class="etat-vide-icone">⚠️</div>
      <p class="etat-vide-titre" style="color: var(--danger); font-weight: bold; margin: 0 0 6px 0;">Le feuillet déborde du format</p>
      <p class="hint" style="text-align: left; line-height: 1.4; color: #555;">${explications}</p>
    </div>
  `;
  
  moments.forEach((m) => {
    const row = document.querySelector(`.moment-row[data-moment="${m}"]`);
    if (row) row.classList.add("moment-en-cause");
  });
  const premiereRow = document.querySelector(".moment-row.moment-en-cause");
  if (premiereRow) premiereRow.scrollIntoView({ behavior: "smooth", block: "center" });
}

let tailleTexteManuelle = null;
const PAS_TAILLE_TEXTE = 1;
const TAILLE_TEXTE_PLANCHER = 8;
const TAILLE_TEXTE_PLAFOND = 32;

async function afficherResultatFeuillet(feuilletId) {
  const resultDiv = document.getElementById("composer-result");
  nettoyerMomentsEnCause();
  resultDiv.innerHTML = `<p class="hint">Génération du PDF…</p>`;
  const pdfUrl = `/feuillets/${feuilletId}/pdf?t=${Date.now()}`;
  try {
    const res = await fetch(pdfUrl);
    if (!res.ok) {
      const texte = await res.text();
      let detail = texte;
      try { detail = JSON.parse(texte).detail; } catch (e) { /* non-JSON */ }
      afficherErreurDepassement(detail, resultDiv);
      return;
    }

    const tailleUtilisee = Number(res.headers.get("X-Taille-Texte-Pt")) || null;
    const zoomValEl = document.getElementById("pv-zoom-val");
    if (zoomValEl) {
      zoomValEl.textContent = tailleTexteManuelle !== null ? `${tailleTexteManuelle}pt` : (tailleUtilisee ? `Auto (${tailleUtilisee}pt)` : "Auto");
    }
    const timeEl = document.getElementById("composer-bar-update-time");
    if (timeEl) {
      const now = new Date();
      timeEl.textContent = `Mis à jour à ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }
    
    const blobUrl = URL.createObjectURL(await res.blob());
    resultDiv.innerHTML = `
      <div class="toolbar">
        <a href="${blobUrl}" target="_blank" class="btn-ouvrir">Ouvrir le PDF</a>
        <a href="${blobUrl}" download="feuillet-${feuilletId}.pdf" class="btn-enregistrer">Enregistrer le PDF</a>
        <button type="button" id="btn-partager-composer" class="btn-partager">Partager</button>
      </div>
      <div class="taille-texte-controle">
        <span class="taille-texte-label">Taille du texte des chants</span>
        <div class="taille-texte-boutons">
          <button type="button" id="taille-texte-moins" aria-label="Réduire">－</button>
          <span id="taille-texte-valeur">${tailleUtilisee ? `${tailleUtilisee}pt` : "…"}</span>
          <button type="button" id="taille-texte-plus" aria-label="Agrandir">＋</button>
          ${tailleTexteManuelle !== null ? `<button type="button" id="taille-texte-auto" class="taille-texte-reinit">↺ Auto</button>` : ""}
        </div>
      </div>
      <iframe class="pdf-preview" src="${blobUrl}" title="Aperçu du feuillet"></iframe>
    `;
    document.getElementById("btn-partager-composer").addEventListener("click", () => partagerPdf(feuilletId));

    const ajusterTaille = async (delta) => {
      const base = tailleTexteManuelle !== null ? tailleTexteManuelle : (tailleUtilisee || TAILLE_TEXTE_PLANCHER);
      tailleTexteManuelle = Math.max(TAILLE_TEXTE_PLANCHER, Math.min(TAILLE_TEXTE_PLAFOND, base + delta));
      await regenererApercuSiPossible(true);
    };
    document.getElementById("taille-texte-moins").addEventListener("click", () => ajusterTaille(-PAS_TAILLE_TEXTE));
    document.getElementById("taille-texte-plus").addEventListener("click", () => ajusterTaille(PAS_TAILLE_TEXTE));
    const btnAuto = document.getElementById("taille-texte-auto");
    if (btnAuto) btnAuto.addEventListener("click", async (e) => {
      await avecChargement(e.currentTarget, async () => {
        tailleTexteManuelle = null;
        await regenererApercuSiPossible(true);
      });
    });
  } catch (err) {
    resultDiv.innerHTML = `<p class="hint">Erreur : ${escapeHtml(err.message)}</p>`;
  }
}

async function partagerPdf(feuilletId) {
  const pdfUrl = `/feuillets/${feuilletId}/pdf`;
  try {
    if (navigator.share && navigator.canShare) {
      const res = await fetch(pdfUrl);
      const blob = await res.blob();
      const fichier = new File([blob], `feuillet-${feuilletId}.pdf`, { type: "application/pdf" });
      if (navigator.canShare({ files: [fichier] })) {
        await navigator.share({ files: [fichier], title: "Feuillet de messe" });
        return;
      }
    }
  } catch (err) { }
  window.open(pdfUrl, "_blank");
}

async function regenererApercuSiPossible(immediat = false) {
  if (!feuilletCourantId) return;
  clearTimeout(apercuTimer);
  const executer = async () => {
    try {
      const feuillet = await api(`/feuillets/${feuilletCourantId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(construireFeuilletPayload()),
      });
      // Si ce dépliant appartient à une autre chorale, chaque PUT le clone
      // (voir crud.update_feuillet) : adopter le nouvel id tout de suite,
      // sinon chaque frappe suivante recloncerait depuis l'id d'origine.
      feuilletCourantId = feuillet.id;
      await afficherResultatFeuillet(feuilletCourantId);
    } catch (err) { }
  };
  if (immediat) {
    await executer();
  } else {
    apercuTimer = setTimeout(executer, 400);
  }
}

document.getElementById("feuillet-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = construireFeuilletPayload();
  const resultDiv = document.getElementById("composer-result");
  resultDiv.textContent = "Génération en cours…";
  afficherSplashGeneration();
  try {
    await avecChargementSubmit(e.target, async () => {
    const idAvant = feuilletCourantId;
    const feuillet = feuilletCourantId
      ? await api(`/feuillets/${feuilletCourantId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await api("/feuillets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    const vientDetreClone = idAvant && feuillet.id !== idAvant;
    feuilletCourantId = feuillet.id;
    await afficherResultatFeuillet(feuillet.id);
    if (vientDetreClone) {
      resultDiv.insertAdjacentHTML(
        "afterbegin",
        `<p class="hint">Copié dans ton espace — le dépliant original n'a pas été modifié.</p>`
      );
    }
    });
  } catch (err) {
    resultDiv.textContent = `Erreur : ${err.message}`;
  } finally {
    masquerSplash();
  }
});

// --- Réglages ---
const IMAGE_SLOTS = {
  logo_gauche: "Logo (gauche)",
  logo_droit: "Logo (droite)",
  banniere_bas: "Bannière de bas de page",
};

let activeSettingsMedias = {
  logo_gauche_media_id: null,
  logo_droit_media_id: null,
  banniere_bas_media_id: null
};

let settingsPdfDebounceTimeout = null;
function debouncedRegenererSettingsPdf() {
  clearTimeout(settingsPdfDebounceTimeout);
  settingsPdfDebounceTimeout = setTimeout(regenererSettingsPdf, 600);
}

let settingsSaveDebounceTimeout = null;
function debouncedPersisterSettings() {
  clearTimeout(settingsSaveDebounceTimeout);
  settingsSaveDebounceTimeout = setTimeout(persisterSettings, 1000);
}

async function persisterSettings() {
  const statusEl = document.getElementById("parametres-status");
  if (statusEl) statusEl.textContent = "Sauvegarde automatique...";
  try {
    await api("/parametres", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chorale: document.getElementById("p-chorale").value,
        paroisse: document.getElementById("p-paroisse").value,
        contact: document.getElementById("p-contact").value,
        annonce: document.getElementById("p-annonce").value,
        priere_texte_defaut: document.getElementById("p-priere-defaut").value,
      }),
    });
    if (statusEl) statusEl.textContent = "Modifications enregistrées automatiquement.";
    document.getElementById("app-title").textContent = document.getElementById("p-chorale").value || "DepliantApp";
  } catch (err) {
    if (statusEl) statusEl.textContent = `Erreur de sauvegarde automatique : ${err.message}`;
  }
}

async function regenererSettingsPdf() {
  const iframe = document.getElementById("reglages-pdf-iframe");
  if (!iframe) return;
  
  const payload = {
    chorale: document.getElementById("p-chorale").value,
    paroisse: document.getElementById("p-paroisse").value,
    contact: document.getElementById("p-contact").value,
    annonce: document.getElementById("p-annonce").value,
    priere_texte_defaut: document.getElementById("p-priere-defaut").value,
    logo_gauche_media_id: activeSettingsMedias.logo_gauche_media_id,
    logo_droit_media_id: activeSettingsMedias.logo_droit_media_id,
    banniere_bas_media_id: activeSettingsMedias.banniere_bas_media_id,
    one_page_mode: document.getElementById("choice-one-page").checked,
  };
  
  try {
    const res = await fetch("/parametres/preview-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    
    if (iframe.dataset.blobUrl) {
      URL.revokeObjectURL(iframe.dataset.blobUrl);
    }
    iframe.src = blobUrl;
    iframe.dataset.blobUrl = blobUrl;
    
    // Apply visual scale
    appliquerZoomApercu(document.getElementById("preview-zoom-select").value);
  } catch (err) {
    console.error("Erreur de génération d'aperçu :", err);
  }
}

window.appliquerZoomApercu = function(zoomVal) {
  const iframe = document.getElementById("reglages-pdf-iframe");
  if (!iframe) return;
  
  if (zoomVal === "width") {
    const containerWidth = iframe.parentElement.clientWidth || 400;
    const scale = containerWidth / 1122; // A4 landscape width factor
    iframe.style.transform = `scale(${scale})`;
    iframe.style.width = `${100 / scale}%`;
    iframe.style.height = `${100 / scale}%`;
  } else {
    const scale = parseFloat(zoomVal);
    iframe.style.transform = `scale(${scale})`;
    iframe.style.width = `${100 / scale}%`;
    iframe.style.height = `${100 / scale}%`;
  }
};

async function chargerParametres() {
  const params = await api("/parametres");
  document.getElementById("p-chorale").value = params.chorale || "";
  document.getElementById("p-paroisse").value = params.paroisse || "";
  document.getElementById("p-contact").value = params.contact || "";
  document.getElementById("p-annonce").value = params.annonce || "";
  document.getElementById("p-priere-defaut").value = params.priere_texte_defaut || "";
  
  activeSettingsMedias.logo_gauche_media_id = params.logo_gauche_media_id;
  activeSettingsMedias.logo_droit_media_id = params.logo_droit_media_id;
  activeSettingsMedias.banniere_bas_media_id = params.banniere_bas_media_id;
  
  document.getElementById("p-priere-char-count").textContent = params.priere_texte_defaut ? params.priere_texte_defaut.length : 0;
  
  initImageSlots(params);
  actualiserApercuEntete();
  actualiserApercuBanniere();
  actualiserApercuPriere();
  
  // Rendu de l'aperçu PDF
  debouncedRegenererSettingsPdf();
}

const PRIERE_TEXTE_STANDARD =
  "Dieu notre père ce qu'il y a de meilleur dans ta création c'est l'homme…";

function actualiserApercuEntete() {
  document.getElementById("apercu-paroisse").textContent =
    document.getElementById("p-paroisse").value || "Paroisse / CCB";
  document.getElementById("apercu-chorale").textContent =
    document.getElementById("p-chorale").value || "Nom de la chorale";
}

function actualiserApercuBanniere() {
  const annonce = document.getElementById("p-annonce").value;
  const contact = document.getElementById("p-contact").value;
  const annonceEl = document.getElementById("apercu-annonce");
  annonceEl.textContent = annonce;
  annonceEl.classList.toggle("apercu-vide", !annonce);
  if (!annonce) annonceEl.textContent = "(aucune annonce)";
  const contactEl = document.getElementById("apercu-contact");
  contactEl.textContent = contact
    ? `Pour de plus amples informations sur votre chorale, veuillez nous contacter au : ${contact}`
    : "(aucun contact)";
  contactEl.classList.toggle("apercu-vide", !contact);
}

function actualiserApercuPriere() {
  const texte = document.getElementById("p-priere-defaut").value;
  document.getElementById("apercu-priere-texte").textContent = texte || PRIERE_TEXTE_STANDARD;
  document.getElementById("p-priere-char-count").textContent = texte.length;
}

// Attach listeners to input fields
["p-chorale", "p-paroisse"].forEach((id) => {
  document.getElementById(id).addEventListener("input", () => {
    actualiserApercuEntete();
    debouncedRegenererSettingsPdf();
    debouncedPersisterSettings();
  });
});
["p-annonce", "p-contact"].forEach((id) => {
  document.getElementById(id).addEventListener("input", () => {
    actualiserApercuBanniere();
    debouncedRegenererSettingsPdf();
    debouncedPersisterSettings();
  });
});
document.getElementById("p-priere-defaut").addEventListener("input", () => {
  actualiserApercuPriere();
  debouncedRegenererSettingsPdf();
  debouncedPersisterSettings();
});

const SLOT_TYPE_MEDIA = { logo_gauche: "logo", logo_droit: "logo", banniere_bas: "banniere" };

function initImageSlots(params) {
  const container = document.getElementById("image-slots");
  if (!container.dataset.init) {
    container.innerHTML = Object.entries(IMAGE_SLOTS).map(([slot, label]) => `
      <div class="image-slot" data-slot="${slot}">
        <p><b>${label}</b></p>
        <img class="logo-preview hidden" alt="${label}">
        <p class="slot-status hint"></p>
        <label>Envoyer une nouvelle image <input type="file" accept="image/*" class="slot-fichier"></label>
        <div class="toolbar">
          <button type="button" class="slot-upload">Envoyer et utiliser</button>
          <button type="button" class="slot-choisir">Choisir dans la bibliothèque</button>
          <button type="button" class="slot-supprimer btn-effacer">Retirer</button>
        </div>
      </div>`).join("");
    container.dataset.init = "1";

    container.querySelectorAll(".image-slot").forEach((el) => {
      const slot = el.dataset.slot;
      el.querySelector(".slot-upload").addEventListener("click", async (e) => {
        const input = el.querySelector(".slot-fichier");
        const statusEl = el.querySelector(".slot-status");
        if (!input.files.length) {
          statusEl.textContent = "Choisis d'abord une image.";
          return;
        }
        const formData = new FormData();
        formData.append("fichier", input.files[0]);
        statusEl.textContent = "Envoi…";
        try {
          let resMetadata = null;
          await avecChargement(e.currentTarget, async () => {
            const res = await fetch(`/parametres/image/${slot}`, { method: "POST", body: formData });
            if (!res.ok) throw new Error(await res.text());
            resMetadata = await res.json();
          });
          
          input.value = "";
          const activeId = resMetadata[`${slot}_media_id`];
          
          // Get filename and size from medias
          const medias = await api("/parametres/medias");
          const media = medias.find(m => m.id === activeId);
          afficherImageSlot(slot, true, activeId, media ? media.filename : "", media ? media.size : 0);
        } catch (err) {
          statusEl.textContent = `Erreur : ${err.message}`;
        }
      });
      el.querySelector(".slot-choisir").addEventListener("click", () => ouvrirMediaPicker(slot));
      el.querySelector(".slot-supprimer").addEventListener("click", async (e) => {
        await avecChargement(e.currentTarget, () => api(`/parametres/image/${slot}`, { method: "DELETE" }));
        afficherImageSlot(slot, false);
      });
    });
  }

  // Populate initially
  (async () => {
    const medias = await api("/parametres/medias");
    Object.keys(IMAGE_SLOTS).forEach((slot) => {
      const mId = params[`${slot}_media_id`];
      const media = medias.find(m => m.id === mId);
      afficherImageSlot(slot, !!mId, mId, media ? media.filename : "", media ? media.size : 0);
    });
  })();
}

const APERCU_IMG_PAR_SLOT = {
  logo_gauche: "apercu-logo-gauche", logo_droit: "apercu-logo-droit", banniere_bas: "apercu-banniere-img",
};

function afficherImageSlot(slot, presente, mediaId, filename, size) {
  const el = document.querySelector(`.image-slot[data-slot="${slot}"]`);
  if (!el) return;
  const img = el.querySelector(".logo-preview");
  const statusEl = el.querySelector(".slot-status");
  const apercuImg = document.getElementById(APERCU_IMG_PAR_SLOT[slot]);
  
  if (presente) {
    if (mediaId !== undefined) {
      activeSettingsMedias[`${slot}_media_id`] = mediaId;
    }
    img.src = `/parametres/image/${slot}?t=${Date.now()}`;
    img.classList.remove("hidden");
    const nameStr = filename ? `${filename}` : "image";
    const sizeStr = size ? ` (${formatBytes(size)})` : "";
    statusEl.textContent = `${nameStr}${sizeStr}`;
    
    if (apercuImg) { 
      apercuImg.src = img.src; 
      apercuImg.classList.remove("hidden"); 
    }
  } else {
    activeSettingsMedias[`${slot}_media_id`] = null;
    img.classList.add("hidden");
    statusEl.textContent = "Aucune image choisie.";
    if (apercuImg) apercuImg.classList.add("hidden");
  }
  
  debouncedRegenererSettingsPdf();
}

// Media Picker
let mediaPickerSlot = null;
function ouvrirMediaPicker(slot) {
  mediaPickerSlot = slot;
  const type = SLOT_TYPE_MEDIA[slot];
  const modal = document.getElementById("media-picker-modal");
  
  if (!modal) {
    const div = document.createElement("div");
    div.id = "media-picker-modal";
    div.className = "modal hidden";
    div.innerHTML = `
      <div class="modal-content">
        <button type="button" class="modal-close-x" onclick="fermerModale('media-picker-modal')">&times;</button>
        <h3>Choisir une image</h3>
        <div id="media-picker-list" class="grid-picker" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(120px, 1fr));gap:12px;max-height:400px;overflow-y:auto;margin:15px 0;"></div>
      </div>`;
    document.body.appendChild(div);
  }
  
  (async () => {
    const listEl = document.getElementById("media-picker-list");
    listEl.innerHTML = "Chargement...";
    const medias = await api(`/parametres/medias?type=${type}`);
    if (!medias.length) {
      listEl.innerHTML = "<p>Aucune image dans la bibliothèque.</p>";
      return;
    }
    
    listEl.innerHTML = medias.map(m => `
      <div class="media-card" style="border:1px solid #ddd;border-radius:8px;padding:8px;text-align:center;cursor:pointer;" onclick="selectMediaFromPicker(${m.id}, '${escapeHtml(m.filename)}', ${m.size})">
        <img src="/parametres/medias/${m.id}/fichier" style="max-width:100%;max-height:80px;object-fit:contain;margin-bottom:6px;">
        <p style="font-size:0.75rem;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(m.filename)}</p>
      </div>`).join("");
  })();
  
  ouvrirModale("media-picker-modal");
}

window.selectMediaFromPicker = async function(mediaId, filename, size) {
  await avecChargement(document.querySelector(".modal-close-x"), () => api(`/parametres/image/${mediaPickerSlot}/activer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: mediaId })
  }));
  afficherImageSlot(mediaPickerSlot, true, mediaId, filename, size);
  fermerModale("media-picker-modal");
};

// Event listeners for layout choice change
["choice-two-pages", "choice-one-page"].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("change", debouncedRegenererSettingsPdf);
  }
});

// Setup settings zoom listeners
const settingsZoomSelect = document.getElementById("preview-zoom-select");
if (settingsZoomSelect) {
  settingsZoomSelect.addEventListener("change", (e) => {
    appliquerZoomApercu(e.target.value);
  });
}
const sBtnZoomIn = document.getElementById("btn-zoom-in");
const sBtnZoomOut = document.getElementById("btn-zoom-out");
if (sBtnZoomIn && sBtnZoomOut && settingsZoomSelect) {
  sBtnZoomIn.addEventListener("click", () => {
    let idx = settingsZoomSelect.selectedIndex;
    if (idx < settingsZoomSelect.options.length - 1) {
      settingsZoomSelect.selectedIndex = idx + 1;
      appliquerZoomApercu(settingsZoomSelect.value);
    }
  });
  sBtnZoomOut.addEventListener("click", () => {
    let idx = settingsZoomSelect.selectedIndex;
    if (idx > 0) {
      settingsZoomSelect.selectedIndex = idx - 1;
      appliquerZoomApercu(settingsZoomSelect.value);
    }
  });
}

// Setup settings quick actions
const sBtnFullscreen = document.getElementById("btn-preview-fullscreen");
if (sBtnFullscreen) {
  sBtnFullscreen.addEventListener("click", () => {
    const iframe = document.getElementById("reglages-pdf-iframe");
    if (iframe && iframe.src && iframe.src !== "about:blank") {
      window.open(iframe.src, "_blank");
    }
  });
}

const sBtnPrint = document.getElementById("btn-preview-print");
if (sBtnPrint) {
  sBtnPrint.addEventListener("click", () => {
    const iframe = document.getElementById("reglages-pdf-iframe");
    if (iframe) {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    }
  });
}

const sBtnDownload = document.getElementById("btn-preview-download");
if (sBtnDownload) {
  sBtnDownload.addEventListener("click", () => {
    const iframe = document.getElementById("reglages-pdf-iframe");
    if (iframe && iframe.src && iframe.src !== "about:blank") {
      const a = document.createElement("a");
      a.href = iframe.src;
      a.download = "apercu_depliant.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  });
}

// Mobile layout tabs for Settings
const sTabForm = document.getElementById("tab-reglages-form");
const sTabPreview = document.getElementById("tab-reglages-preview");
const sParamsCol = document.querySelector(".reglages-params-column");
const sPreviewCol = document.querySelector(".reglages-preview-column");

if (sTabForm && sTabPreview && sParamsCol && sPreviewCol) {
  sTabForm.addEventListener("click", () => {
    sTabForm.classList.add("active");
    sTabPreview.classList.remove("active");
    sParamsCol.classList.remove("inactive-tab");
    sPreviewCol.classList.remove("active-tab");
  });
  sTabPreview.addEventListener("click", () => {
    sTabPreview.classList.add("active");
    sTabForm.classList.remove("active");
    sParamsCol.classList.add("inactive-tab");
    sPreviewCol.classList.add("active-tab");
    appliquerZoomApercu(settingsZoomSelect.value);
  });
}

document.getElementById("parametres-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("parametres-status");
  try {
    await avecChargementSubmit(e.target, () => api("/parametres", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chorale: document.getElementById("p-chorale").value,
        paroisse: document.getElementById("p-paroisse").value,
        contact: document.getElementById("p-contact").value,
        annonce: document.getElementById("p-annonce").value,
        priere_texte_defaut: document.getElementById("p-priere-defaut").value,
      }),
    }));
    statusEl.textContent = "Enregistré.";
    document.getElementById("app-title").textContent = document.getElementById("p-chorale").value || "DepliantApp";
    debouncedRegenererSettingsPdf();
  } catch (err) {
    statusEl.textContent = `Erreur : ${err.message}`;
  }
});

// --- Éditeur ---
const selectionEditeur = new Set();
let idsAffichesEditeur = [];

function categorieLabel(c) {
  return LABELS_MOMENTS[c] || c.replace(/_/g, " ");
}

let editeurPageCurrent = 1;
let editeurLimit = 20;
let editeurStatFilter = "tous";

let editeurFilterDrawerOpen = false;

function initEditeurListenersOnce() {
  const tableContainer = document.querySelector(".editeur-table-container");
  if (!tableContainer || tableContainer.dataset.init) return;
  tableContainer.dataset.init = "1";

  // Top header actions
  document.getElementById("btn-editeur-importer").addEventListener("click", () => {
    changerVue("importer");
  });
  document.getElementById("btn-ajouter-chant-top").addEventListener("click", () => {
    ouvrirEditeurNouveauChant();
  });

  // Search input with debounce
  const editQ = document.getElementById("edit-q");
  if (editQ) {
    let searchTimer = null;
    editQ.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        editeurPageCurrent = 1;
        actualiserEditeur();
      }, 300);
    });
  }

  // Statistics cards click to filter
  document.querySelectorAll(".editeur-stat-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".editeur-stat-card").forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
      editeurStatFilter = card.dataset.filter;
      editeurPageCurrent = 1;
      actualiserEditeur();
    });
  });

  // Open Advanced Filters Drawer
  document.getElementById("btn-open-filters-drawer").addEventListener("click", () => {
    const drawer = document.getElementById("editeur-filter-drawer");
    drawer.classList.remove("hidden");
  });

  // Apply filters from drawer
  document.getElementById("btn-appliquer-filtres-tiroir").addEventListener("click", () => {
    document.getElementById("editeur-filter-drawer").classList.add("hidden");
    editeurPageCurrent = 1;
    actualiserEditeur();
  });

  // Close advanced filters drawer
  const btnCloseFilters = document.getElementById("btn-close-filters-drawer");
  if (btnCloseFilters) {
    btnCloseFilters.addEventListener("click", () => {
      document.getElementById("editeur-filter-drawer").classList.add("hidden");
    });
  }

  // Close import details drawer
  const btnCloseImportDetails = document.getElementById("btn-close-import-detail-drawer");
  if (btnCloseImportDetails) {
    btnCloseImportDetails.addEventListener("click", () => {
      document.getElementById("import-detail-drawer").classList.add("hidden");
    });
  }

  // Pagination limit selector
  document.getElementById("pagination-limit").addEventListener("change", (e) => {
    editeurLimit = Number(e.target.value);
    editeurPageCurrent = 1;
    actualiserEditeur();
  });

  // Pagination buttons
  document.getElementById("btn-pagination-prev").addEventListener("click", () => {
    if (editeurPageCurrent > 1) {
      editeurPageCurrent--;
      actualiserEditeur();
    }
  });

  document.getElementById("btn-pagination-next").addEventListener("click", () => {
    editeurPageCurrent++;
    actualiserEditeur();
  });

  // Bulk actions - Move/Retag
  document.getElementById("bulk-appliquer").addEventListener("click", async (e) => {
    const category = document.getElementById("bulk-categorie").value;
    await avecChargement(e.currentTarget, () => api("/chants/bulk_categorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectionEditeur], categorie: category }),
    }));
    selectionEditeur.clear();
    majBulkBar();
    await actualiserEditeur();
  });

  // Bulk actions - Make Public
  document.getElementById("bulk-rendre-public").addEventListener("click", async (e) => {
    for (const id of selectionEditeur) {
      try {
        const c = await api(`/chants/${id}`);
        await api(`/chants/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...c, actif: true }),
        });
      } catch (err) { }
    }
    selectionEditeur.clear();
    majBulkBar();
    await actualiserEditeur();
  });

  // Bulk actions - Make Private
  document.getElementById("bulk-rendre-prive").addEventListener("click", async (e) => {
    for (const id of selectionEditeur) {
      try {
        const c = await api(`/chants/${id}`);
        await api(`/chants/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...c, actif: false }),
        });
      } catch (err) { }
    }
    selectionEditeur.clear();
    majBulkBar();
    await actualiserEditeur();
  });

  // Bulk actions - Export
  document.getElementById("bulk-exporter").addEventListener("click", () => {
    alert("Export en cours pour " + selectionEditeur.size + " chants sélectionnés...");
  });

  // Bulk actions - Supprimer
  document.getElementById("bulk-supprimer").addEventListener("click", async (e) => {
    if (IDENTITE.type === "super") {
      if (!confirm(`Supprimer définitivement ${selectionEditeur.size} chant(s) sélectionnés ?`)) return;
    } else {
      if (!confirm(`Demander la suppression de ${selectionEditeur.size} chant(s) sélectionnés ?`)) return;
    }
    await avecChargement(e.currentTarget, async () => {
      if (IDENTITE.type === "super") {
        await api("/chants/bulk_delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [...selectionEditeur] }),
        });
      } else {
        // Send moderation request for each
        for (const id of selectionEditeur) {
          await api("/moderation/demandes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type_cible: "chant", cible_id: id }),
          });
        }
      }
    });
    selectionEditeur.clear();
    majBulkBar();
    await actualiserEditeur();
  });
}

function editeurRowHtml(chant) {
  const refrainApercu = chant.refrain ? chant.refrain.slice(0, 45) : (chant.couplets[0] || "").slice(0, 45);
  const titleEsc = escapeHtml(chant.titre || "(sans titre)");
  
  // Progress bar of confidence score
  const pct = Math.round((chant.confiance ?? 1) * 100);
  let confClass = "low";
  let statusBadge = `<span class="status-badge status-danger">Échec</span>`;
  if ((chant.confiance ?? 1) >= 0.8) {
    confClass = "high";
    statusBadge = `<span class="status-badge status-success">Importé</span>`;
  } else if ((chant.confiance ?? 1) >= 0.4) {
    confClass = "medium";
    statusBadge = `<span class="status-badge status-warning">À vérifier</span>`;
  }
  
  const progressHtml = `
    <div class="progress-bar-cell">
      <div class="progress-bar-wrapper">
        <div class="progress-bar-fill ${confClass}" style="width: ${pct}%"></div>
      </div>
      <span style="font-size:0.75rem;font-weight:600;">${pct}%</span>
    </div>
  `;
  
  const vis = chant.actif !== false ? "public" : "prive";
  const visBadge = vis === "public" 
    ? `<span class="visibility-badge public">Public</span>` 
    : `<span class="visibility-badge">Privé</span>`;

  const dateMod = chant.created_at ? new Date(chant.created_at).toLocaleDateString("fr-FR") : "-";

  return `
    <tr data-id="${chant.id}">
      <td><input type="checkbox" class="chant-checkbox" data-id="${chant.id}" ${selectionEditeur.has(chant.id) ? "checked" : ""}></td>
      <td>
        <div style="font-weight: 600; color: #1F4A7C; cursor: pointer;" class="chant-click-target">${titleEsc}</div>
        <div style="font-size: 0.75rem; color: #666; font-style: italic;">${escapeHtml(refrainApercu)}...</div>
      </td>
      <td><span class="chant-categorie-pill" style="font-size:0.75rem; background:#f1f5f9; padding:2px 6px; border-radius:4px;">${categorieLabel(chant.categorie)}</span></td>
      <td><span style="text-transform: uppercase; font-size:0.75rem; font-weight:600;">${chant.langue || "fr"}</span></td>
      <td><span style="font-size:0.8rem;color:#475569;">${escapeHtml(chant.auteur || chant.compositeur || "-")}</span></td>
      <td>${visBadge}</td>
      <td>${progressHtml}</td>
      <td>${statusBadge}</td>
      <td style="font-size:0.75rem;color:#64748b;">${dateMod}</td>
      <td>
        <div style="display:flex;gap:6px;">
          <button type="button" class="depliant-action-icon-btn btn-edit-song" title="Modifier">✏️</button>
          <button type="button" class="depliant-action-icon-btn btn-delete-song" title="Supprimer">🗑️</button>
          <button type="button" class="depliant-action-icon-btn btn-details-song" title="Détails de l'import">🔍</button>
        </div>
      </td>
    </tr>
  `;
}

async function actualiserEditeur() {
  initEditeurListenersOnce();

  // Populate categories dropdowns dynamically if not already done
  const categoryFilters = document.getElementById("filter-categorie");
  if (categoryFilters && categoryFilters.children.length <= 1) {
    categoryFilters.innerHTML = `<option value="">Toutes</option>` + 
      CATEGORIES.map(c => `<option value="${c}">${categorieLabel(c)}</option>`).join("");
    
    // Set up bulk categories dropdown too
    document.getElementById("bulk-categorie").innerHTML = 
      CATEGORIES.map(c => `<option value="${c}">${categorieLabel(c)}</option>`).join("");
  }

  const q = document.getElementById("edit-q").value.trim().toLowerCase();
  
  // Load full chants list (increase limit to 500 to fetch them all)
  const chants = await api(`/chants?limit=500`);
  editeurChantsCache = chants;
  idsAffichesEditeur = chants.map((c) => c.id);

  // 1. Calculate Stats Card values BEFORE filters
  const totalCount = chants.length;
  const successCount = chants.filter(c => (c.confiance ?? 1) >= 0.8).length;
  const warningCount = chants.filter(c => (c.confiance ?? 1) >= 0.4 && (c.confiance ?? 1) < 0.8).length;
  const dangerCount = chants.filter(c => (c.confiance ?? 1) < 0.4).length;
  const pctSuccess = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;

  document.getElementById("stat-count-total").textContent = totalCount;
  document.getElementById("stat-count-importes").textContent = successCount;
  document.getElementById("stat-pct-importes").textContent = `${pctSuccess}%`;
  document.getElementById("stat-count-verifier").textContent = warningCount;
  document.getElementById("stat-count-echecs").textContent = dangerCount;

  // 2. Local Filtering
  let filtered = chants;

  // Search filter
  if (q) {
    filtered = filtered.filter(c => 
      (c.titre || "").toLowerCase().includes(q) ||
      (c.refrain || "").toLowerCase().includes(q) ||
      (c.auteur || "").toLowerCase().includes(q) ||
      (c.couplets || []).some(cp => cp.toLowerCase().includes(q))
    );
  }

  // Card filter (Total / Success / Warning / Danger)
  if (editeurStatFilter === "importes") {
    filtered = filtered.filter(c => (c.confiance ?? 1) >= 0.8);
  } else if (editeurStatFilter === "a-verifier") {
    filtered = filtered.filter(c => (c.confiance ?? 1) >= 0.4 && (c.confiance ?? 1) < 0.8);
  } else if (editeurStatFilter === "echecs") {
    filtered = filtered.filter(c => (c.confiance ?? 1) < 0.4);
  }

  // Drawer advanced filters
  const filterCat = document.getElementById("filter-categorie").value;
  if (filterCat) {
    filtered = filtered.filter(c => c.categorie === filterCat);
  }
  const filterLangue = document.getElementById("filter-langue").value;
  if (filterLangue) {
    filtered = filtered.filter(c => c.langue === filterLangue);
  }
  const filterVis = document.getElementById("filter-visibilite").value;
  if (filterVis) {
    filtered = filtered.filter(c => (filterVis === "public" ? c.actif !== false : c.actif === false));
  }
  const filterStatut = document.getElementById("filter-statut").value;
  if (filterStatut) {
    if (filterStatut === "importes") filtered = filtered.filter(c => (c.confiance ?? 1) >= 0.8);
    else if (filterStatut === "verifier") filtered = filtered.filter(c => (c.confiance ?? 1) >= 0.4 && (c.confiance ?? 1) < 0.8);
    else if (filterStatut === "echecs") filtered = filtered.filter(c => (c.confiance ?? 1) < 0.4);
    else if (filterStatut === "manuel") filtered = filtered.filter(c => c.confiance === null || c.confiance === undefined);
  }
  const filterOrig = document.getElementById("filter-origine").value;
  if (filterOrig) {
    if (filterOrig === "manuel") filtered = filtered.filter(c => c.confiance === null || c.confiance === undefined);
    else if (filterOrig === "import") filtered = filtered.filter(c => c.confiance !== null && c.confiance !== undefined);
  }

  // 3. Local Sorting
  const filterTri = document.getElementById("filter-tri").value;
  filtered.sort((a, b) => {
    if (filterTri === "recent") return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    if (filterTri === "creation") return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    if (filterTri === "titre") return (a.titre || "").localeCompare(b.titre || "");
    if (filterTri === "auteur") return (a.auteur || "").localeCompare(b.auteur || "");
    if (filterTri === "confiance") return (b.confiance ?? 1) - (a.confiance ?? 1);
    return 0;
  });

  // 4. Pagination slicing
  const start = (editeurPageCurrent - 1) * editeurLimit;
  const end = Math.min(start + editeurLimit, filtered.length);
  const pageChants = filtered.slice(start, end);

  // Update pagination info labels
  document.getElementById("pagination-current-range").textContent = 
    filtered.length > 0 ? `${start + 1}-${end} sur ${filtered.length}` : "0-0 sur 0";
  
  document.getElementById("btn-pagination-prev").disabled = editeurPageCurrent === 1;
  document.getElementById("btn-pagination-next").disabled = end >= filtered.length;

  const tableBody = document.getElementById("editeur-table-body");
  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding: 40px 0;">
      <div style="font-size: 2rem;">🎵</div>
      <div style="font-weight: 600; margin-top:8px; color: #475569;">Aucun chant dans votre bibliothèque.</div>
      <div style="font-size:0.8rem; color:#888; margin-top:4px;">Essayez de réinitialiser vos filtres ou d'ajouter un nouveau chant.</div>
    </td></tr>`;
  } else {
    tableBody.innerHTML = pageChants.map(editeurRowHtml).join("");
  }

  // Re-bind listeners for table rows
  tableBody.querySelectorAll("tr").forEach((row) => {
    const id = Number(row.dataset.id);
    const chant = chants.find(c => c.id === id);

    // Row Click to Open details modal
    row.querySelector(".chant-click-target").addEventListener("click", () => {
      ouvrirDetailsChant(id);
    });

    // Checkbox selector
    row.querySelector(".chant-checkbox").addEventListener("change", (e) => {
      if (e.target.checked) selectionEditeur.add(id); else selectionEditeur.delete(id);
      majBulkBar();
      majSelectAllEtat();
    });

    // Action Modifier
    row.querySelector(".btn-edit-song").addEventListener("click", () => {
      ouvrirEditeurChant(id);
    });

    // Action Supprimer
    row.querySelector(".btn-delete-song").addEventListener("click", async (e) => {
      if (!confirm(`Supprimer ce chant "${chant.titre}" ?`)) return;
      await avecChargement(e.currentTarget, async () => {
        if (IDENTITE.type === "super") {
          await api(`/chants/${id}`, { method: "DELETE" });
        } else {
          await api("/moderation/demandes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type_cible: "chant", cible_id: id }),
          });
        }
      });
      await actualiserEditeur();
    });

    // Action Details
    row.querySelector(".btn-details-song").addEventListener("click", () => {
      ouvrirImportDetails(chant);
    });
  });

  majSelectAllEtat();
}

function ouvrirImportDetails(chant) {
  const contentEl = document.getElementById("import-detail-content");
  const pct = Math.round((chant.confiance ?? 1) * 100);
  let badge = `<span class="status-badge status-danger">Échec</span>`;
  let advice = "L'import de ce chant est considéré comme incomplet. Une relecture complète est recommandée.";
  if ((chant.confiance ?? 1) >= 0.8) {
    badge = `<span class="status-badge status-success">Importé</span>`;
    advice = "Le parser a extrait avec succès le titre, le refrain et les couplets du chant.";
  } else if ((chant.confiance ?? 1) >= 0.4) {
    badge = `<span class="status-badge status-warning">À vérifier</span>`;
    advice = "Certaines anomalies mineures de structure ont été détectées (ex: couplets fusionnés ou absence de refrain explicite).";
  }

  contentEl.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:12px;">
        <span style="font-weight:600; color:#64748b; font-size:0.8rem;">Score de confiance</span>
        <span style="font-size:1.4rem; font-weight:700; color:#1F4A7C;">${pct}%</span>
      </div>
      <div style="border-bottom:1px solid #eee; padding-bottom:12px;">
        <span style="font-weight:600; color:#64748b; font-size:0.8rem; display:block; margin-bottom:4px;">Statut détecté</span>
        ${badge}
      </div>
      <div style="border-bottom:1px solid #eee; padding-bottom:12px;">
        <span style="font-weight:600; color:#64748b; font-size:0.8rem; display:block; margin-bottom:4px;">Titre détecté</span>
        <p style="margin:0; font-weight:600; color:#1e293b;">${escapeHtml(chant.titre || "(sans titre)")}</p>
      </div>
      <div style="border-bottom:1px solid #eee; padding-bottom:12px;">
        <span style="font-weight:600; color:#64748b; font-size:0.8rem; display:block; margin-bottom:4px;">Refrain détecté</span>
        <p style="margin:0; font-size:0.85rem; color:#475569; font-style:italic; background:#f8fafc; padding:8px; border-radius:6px; white-space:pre-line;">
          ${escapeHtml(chant.refrain || "Aucun refrain détecté")}</p>
      </div>
      <div style="border-bottom:1px solid #eee; padding-bottom:12px;">
        <span style="font-weight:600; color:#64748b; font-size:0.8rem; display:block; margin-bottom:4px;">Structure détectée</span>
        <p style="margin:0; font-size:0.85rem; color:#475569;">${chant.couplets ? chant.couplets.length : 0} couplet(s) extrait(s)</p>
      </div>
      <div style="background:#f0fdf4; border-radius:8px; padding:12px; color:#15803d; font-size:0.8rem;">
        <span style="font-weight:700; display:block; margin-bottom:4px;">Anomalies &amp; Diagnostic :</span>
        <p style="margin:0; line-height:1.4;">${advice}</p>
      </div>
    </div>
  `;

  document.getElementById("import-detail-drawer").classList.remove("hidden");
}

function majBulkBar() {
  const bar = document.getElementById("bulk-bar");
  if (selectionEditeur.size === 0) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  document.getElementById("bulk-count").textContent = `${selectionEditeur.size} sélectionné(s)`;
}

function majSelectAllEtat() {
  const caseTout = document.getElementById("editeur-select-all");
  const total = idsAffichesEditeur.length;
  const selectionnes = idsAffichesEditeur.filter((id) => selectionEditeur.has(id)).length;
  caseTout.checked = total > 0 && selectionnes === total;
  caseTout.indeterminate = selectionnes > 0 && selectionnes < total;
}

document.getElementById("editeur-select-all").addEventListener("change", (e) => {
  if (e.target.checked) {
    idsAffichesEditeur.forEach((id) => selectionEditeur.add(id));
  } else {
    idsAffichesEditeur.forEach((id) => selectionEditeur.delete(id));
  }
  document.querySelectorAll("#editeur-table-body .chant-checkbox").forEach((cb) => {
    cb.checked = selectionEditeur.has(Number(cb.dataset.id));
  });
  majBulkBar();
});
// Découpe un texte en couplets séparés par une ligne vide — règle unique
// appliquée partout où des couplets sont saisis : la modale d'édition de
// chant (#ce-couplets, ajout ET modification puisqu'elles partagent la même
// modale) et l'assistant d'import (.iw-couplets).
function cleanCoupletPrefix(texte) {
  const prefixRegex = /^\s*(?:(?:[0-9]+|[ivxldcm]+)\s*[-.)]|\b(?:couplet|verse|strophe)\s*(?:[0-9]+|[ivxldcm]+)?\s*[-.)]?|\b(?:premier|premiere|première|deuxieme|deuxième|troisieme|troisième|quatrieme|quatrième|cinquieme|cinquième|sixieme|sixième|septieme|septième|huitieme|huitième|neuvieme|neuvième|dixieme|dixième)\s*(?:couplet|verse|strophe)?\s*[-.)]?)/i;
  return texte.replace(prefixRegex, "").trim();
}

function splitTexteEnCouplets(texte) {
  return texte.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean).map(cleanCoupletPrefix);
}

function setCoupletsTexte(couplets) {
  const formatted = (couplets || []).map((c, i) => `${i + 1}- ${c}`).join("\n\n");
  document.getElementById("ce-couplets").value = formatted;
}

function getCoupletsFromFields() {
  return splitTexteEnCouplets(document.getElementById("ce-couplets").value);
}

// --- Grande modale de saisie de texte (refrain / couplets) : les champs
// d'origine sont trop étroits pour écrire ou parcourir un long texte, donc
// on les rend en lecture seule et on ouvre cette modale plein écran au clic.
let tgeOnValider = null;
let tgeValeurInitiale = "";
function ouvrirTexteGrandEditeur(titre, valeurInitiale, avecAstuceCouplets, onValider) {
  document.getElementById("tge-titre").textContent = titre;
  document.getElementById("tge-astuce").classList.toggle("hidden", !avecAstuceCouplets);
  const zone = document.getElementById("tge-textarea");
  zone.value = valeurInitiale || "";
  tgeValeurInitiale = zone.value;
  tgeOnValider = onValider;
  ouvrirModale("texte-grand-editor");
  setTimeout(() => zone.focus(), 250);
}
document.getElementById("tge-inserer").addEventListener("click", () => {
  const valeur = document.getElementById("tge-textarea").value;
  const callback = tgeOnValider;
  tgeOnValider = null;
  fermerModale("texte-grand-editor");
  if (callback) callback(valeur);
});
// Ferme la grande modale de texte ; si son contenu a été modifié depuis
// l'ouverture, redemande confirmation (bouton "Annuler", "×" et bouton
// retour passent tous par ici) pour ne pas perdre un long texte par erreur.
// Retourne false si l'utilisateur a choisi de rester dans la modale.
function fermerTexteGrandEditeur() {
  const valeurActuelle = document.getElementById("tge-textarea").value;
  if (valeurActuelle !== tgeValeurInitiale &&
      !confirm("Abandonner les modifications de ce texte ?")) {
    return false;
  }
  tgeOnValider = null;
  fermerModale("texte-grand-editor");
  return true;
}
document.getElementById("tge-annuler").addEventListener("click", () => {
  fermerTexteGrandEditeur();
});

function syncChampNouvelleCategorie() {
  const estAutre = document.getElementById("ce-categorie").value === "Autre";
  document.getElementById("ce-nouvelle-categorie-champ").classList.toggle("hidden", !estAutre);
  if (!estAutre) document.getElementById("ce-nouvelle-categorie").value = "";
}
document.getElementById("ce-categorie").addEventListener("change", syncChampNouvelleCategorie);

// --- Mot clé (slug) : automatique à partir du titre, mais modifiable —
// reproduit côté client la même règle que slugify.py (accents retirés,
// minuscules, tout ce qui n'est pas alphanumérique devient un tiret) pour
// que l'aperçu affiché corresponde exactement à ce que le serveur
// calculerait si le champ était laissé vide. Suit le titre en direct tant
// que l'utilisateur n'a pas lui-même touché le champ mot-clé ; dès qu'il le
// modifie à la main, sa valeur prime et n'est plus jamais écrasée.
function slugifyClient(texte) {
  return (texte || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "";
}
document.getElementById("ce-titre").addEventListener("input", (e) => {
  const champSlug = document.getElementById("ce-slug");
  if (champSlug.dataset.modifieManuel === "1") return;
  champSlug.value = slugifyClient(e.target.value);
});
document.getElementById("ce-slug").addEventListener("input", (e) => {
  e.target.dataset.modifieManuel = "1";
});

// --- Générateur de mots-clés ---
function genererMotsCles() {
  const titre = document.getElementById("ce-titre").value;
  const refrain = document.getElementById("ce-refrain").value;
  const couplets = document.getElementById("ce-couplets").value;
  const selectCat = document.getElementById("ce-categorie");
  const categorie = selectCat.options[selectCat.selectedIndex] ? selectCat.options[selectCat.selectedIndex].text : "";
  
  const texteComplet = `${titre} ${categorie} ${refrain} ${couplets}`;
  
  const mots = texteComplet
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/);
  
  const stopWords = new Set([
    "le", "la", "les", "de", "du", "des", "un", "une", "et", "en", "pour", "dans", "sur", "par", 
    "avec", "ce", "ces", "cette", "mon", "ton", "son", "notre", "votre", "leur", "nos", "vos", "leurs",
    "aux", "au", "je", "tu", "il", "elle", "nous", "vous", "ils", "elles", "est", "sont", "ont", "a", 
    "ai", "as", "avez", "suis", "es", "sommes", "etes", "l", "d", "s", "c", "j", "m", "t", "qu", "y",
    "qui", "que", "quoi", "dont", "ou", "où", "mais", "donc", "or", "ni", "car", "ne", "pas", "plus", "tout",
    "tous", "toutes", "chaque", "autre", "autres", "sans", "sous", "vers", "chez"
  ]);
  
  const occurrences = {};
  for (let m of mots) {
    if (m.length < 3) continue;
    if (stopWords.has(m)) continue;
    occurrences[m] = (occurrences[m] || 0) + 1;
  }
  
  const tries = Object.keys(occurrences).sort((a, b) => occurrences[b] - occurrences[a]);
  const keywords = tries.slice(0, 12);
  
  const originalWords = texteComplet
    .toLowerCase()
    .replace(/[^a-z0-9àâäéèêëîïôöùûüçœæ]+/gi, " ")
    .split(/\s+/);
  
  const mapNormalize = {};
  for (let w of originalWords) {
    const norm = w.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    if (!mapNormalize[norm] || w.length > mapNormalize[norm].length) {
      mapNormalize[norm] = w;
    }
  }
  
  const keywordsAccented = keywords.map(k => mapNormalize[k] || k);
  document.getElementById("ce-mots-cles").value = keywordsAccented.join(", ");
}

function autoGenererMotsClesSiNonModifie() {
  const ceMots = document.getElementById("ce-mots-cles");
  if (ceMots.dataset.modifieManuel === "1") return;
  genererMotsCles();
}

let currentDetailChant = null;
let currentDetailSource = null;
let currentDetailIndexOrId = null;

function ouvrirDetailsChantDynamique(chant, source, indexOrId, startInEditMode = false) {
  currentDetailChant = chant;
  currentDetailSource = source;
  currentDetailIndexOrId = indexOrId;
  
  if (startInEditMode) {
    afficherDetailsChantModification();
  } else {
    afficherDetailsChantLecture();
  }
  ouvrirModale("chant-details-modal");
}

function afficherDetailsChantLecture() {
  const chant = currentDetailChant;
  const modalContent = document.querySelector("#chant-details-modal .modal-content");
  
  const coupletsHtml = (chant.couplets || []).map((c, idx) => `
    <div style="display:flex; gap:12px;">
      <span style="font-weight:700; color:#2563eb; font-size:0.95rem;">${idx + 1}.</span>
      <p style="margin:0; font-size:0.95rem; line-height:1.6; color:#334155; white-space:pre-line;">${escapeHtml(c)}</p>
    </div>
  `).join("");

  const vis = chant.actif !== false ? "public" : "prive";
  const visText = vis === "public" ? "Rendre privé" : "Rendre public";
  
  const isImport = currentDetailSource === "import";
  const scoreBadge = isImport 
    ? `<span style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; background: rgba(255,255,255,0.2); padding: 4px 8px; border-radius: 4px; display: inline-block; margin-bottom: 8px; margin-right: 8px;">Confiance: ${Math.round((chant.confiance ?? 1) * 100)}%</span>`
    : "";

  modalContent.innerHTML = `
    <div style="background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); color: white; padding: 20px; position: relative; flex-shrink: 0;">
      <div style="display:flex; align-items:center; flex-wrap:wrap;">
        <span style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; background: rgba(255,255,255,0.2); padding: 4px 8px; border-radius: 4px; display: inline-block; margin-bottom: 8px; margin-right: 8px;">${categorieLabel(chant.categorie)}</span>
        ${scoreBadge}
      </div>
      <h2 style="margin: 0; font-size: 1.4rem; font-weight: 700;">${escapeHtml(chant.titre || "(sans titre)")}</h2>
      <p style="margin: 4px 0 0 0; font-size: 0.85rem; opacity: 0.9; font-style: italic;">Auteur : ${escapeHtml(chant.auteur || chant.compositeur || "Inconnu")}</p>
      <button type="button" style="position: absolute; top: 16px; right: 16px; background: none; border: none; color: white; font-size: 1.5rem; cursor: pointer;" onclick="fermerModale('chant-details-modal')">&times;</button>
    </div>
    
    <div style="padding: 24px; display: flex; flex-direction: column; gap: 20px; flex: 1; overflow-y: auto; background: #F8FAFC;">
      ${chant.refrain ? `
        <div style="background: white; border-radius: 12px; padding: 16px; border: 1px solid #E2E8F0;">
          <h4 style="margin: 0 0 8px 0; color: #1e3a8a; font-size: 0.85rem; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em;">Refrain</h4>
          <p style="margin: 0; font-size: 0.95rem; line-height: 1.6; color: #1e293b; font-style: italic; white-space: pre-line;">${escapeHtml(chant.refrain)}</p>
        </div>
      ` : ""}
      
      ${chant.couplets && chant.couplets.length > 0 ? `
        <div style="background: white; border-radius: 12px; padding: 16px; border: 1px solid #E2E8F0;">
          <h4 style="margin: 0 0 12px 0; color: #1e3a8a; font-size: 0.85rem; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em;">Couplets</h4>
          <div style="display: flex; flex-direction: column; gap: 16px;">${coupletsHtml}</div>
        </div>
      ` : ""}
      
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px;">
        <div style="background: white; border-radius: 10px; padding: 12px; border: 1px solid #E2E8F0; text-align: center;">
          <span style="font-size: 0.75rem; color: #64748B; display: block; font-weight: 600;">Langue</span>
          <span style="font-size: 0.95rem; font-weight: 700; color: #0F172A; text-transform: uppercase;">${escapeHtml(chant.langue || "fr")}</span>
        </div>
        <div style="background: white; border-radius: 10px; padding: 12px; border: 1px solid #E2E8F0; text-align: center;">
          <span style="font-size: 0.75rem; color: #64748B; display: block; font-weight: 600;">Tonalité</span>
          <span style="font-size: 0.95rem; font-weight: 700; color: #0F172A;">${escapeHtml(chant.tonalite || "-")}</span>
        </div>
        <div style="background: white; border-radius: 10px; padding: 12px; border: 1px solid #E2E8F0; text-align: center;">
          <span style="font-size: 0.75rem; color: #64748B; display: block; font-weight: 600;">Durée</span>
          <span style="font-size: 0.95rem; font-weight: 700; color: #0F172A;">${escapeHtml(chant.duree_estimee || "-")}</span>
        </div>
      </div>
      
      ${chant.remarques ? `
        <div style="background: #FFFBEB; border-radius: 12px; padding: 16px; border: 1px solid #FDE68A;">
          <h4 style="margin: 0 0 6px 0; color: #b45309; font-size: 0.8rem; text-transform: uppercase; font-weight: 700;">Remarques</h4>
          <p style="margin: 0; font-size: 0.85rem; color: #78350f;">${escapeHtml(chant.remarques)}</p>
        </div>
      ` : ""}
    </div>
    
    <div style="background: white; border-top: 1px solid #E2E8F0; padding: 16px 24px; display: flex; justify-content: flex-end; gap: 12px; align-items: center; flex-shrink: 0; flex-wrap: wrap;">
      <span style="font-size: 0.75rem; color: #64748B; margin-right: auto;">ID: #${chant.id || "Nouveau"}</span>
      ${!isImport ? `
        <button type="button" id="det-btn-public-dyn" class="btn-secondary" style="padding: 8px 16px; border-radius: 8px; font-size: 0.85rem; cursor:pointer;">${visText}</button>
        <button type="button" id="det-btn-supprimer-dyn" class="btn-danger" style="padding: 8px 16px; border-radius: 8px; font-size: 0.85rem; background: #ef4444; color: white; border: none; cursor: pointer;">Supprimer</button>
      ` : ""}
      <button type="button" id="det-btn-modifier-dyn" class="btn-primary" style="padding: 8px 16px; border-radius: 8px; font-size: 0.85rem; background: #2563eb; color: white; border: none; cursor: pointer;">Modifier</button>
    </div>
  `;

  if (!isImport) {
    document.getElementById("det-btn-public-dyn").addEventListener("click", async (e) => {
      await avecChargement(e.currentTarget, async () => {
        const toggledActif = chant.actif === false;
        await api(`/chants/${chant.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actif: toggledActif }),
        });
        currentDetailChant.actif = toggledActif;
        afficherDetailsChantLecture();
        await actualiserEditeur();
      });
    });

    document.getElementById("det-btn-supprimer-dyn").addEventListener("click", async (e) => {
      if (!confirm(`Supprimer ce chant "${chant.titre}" ?`)) return;
      await avecChargement(e.currentTarget, async () => {
        if (IDENTITE.type === "super") {
          await api(`/chants/${chant.id}`, { method: "DELETE" });
        } else {
          await api("/moderation/demandes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type_cible: "chant", cible_id: chant.id }),
          });
        }
      });
      fermerModale("chant-details-modal");
      await actualiserEditeur();
    });
  }

  document.getElementById("det-btn-modifier-dyn").addEventListener("click", () => {
    afficherDetailsChantModification();
  });
}

function afficherDetailsChantModification() {
  const chant = currentDetailChant;
  const modalContent = document.querySelector("#chant-details-modal .modal-content");
  
  const coupletsTexte = (chant.couplets || []).join("\n\n");
  
  const categoriesHtml = CATEGORIES.map(c => `
    <option value="${c}" ${c === chant.categorie ? "selected" : ""}>${categorieLabel(c)}</option>
  `).join("");
  
  const languesHtml = Object.entries(NOMS_LANGUES).map(([code, name]) => `
    <option value="${code}" ${code === (chant.langue || "fr") ? "selected" : ""}>${name}</option>
  `).join("");

  modalContent.innerHTML = `
    <div style="background: #1e293b; color: white; padding: 20px; position: relative; flex-shrink: 0;">
      <h2 style="margin: 0; font-size: 1.2rem; font-weight: 700;">Modifier le chant</h2>
      <button type="button" style="position: absolute; top: 16px; right: 16px; background: none; border: none; color: white; font-size: 1.5rem; cursor: pointer;" onclick="fermerModale('chant-details-modal')">&times;</button>
    </div>
    
    <div style="padding: 20px; display: flex; flex-direction: column; gap: 16px; flex: 1; overflow-y: auto; background: white;">
      <div>
        <label style="display:block; font-size:0.8rem; font-weight:600; color:#475569; margin-bottom:4px;">Titre *</label>
        <input type="text" id="edit-dyn-titre" value="${escapeHtml(chant.titre || "")}" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem;" required>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
        <div>
          <label style="display:block; font-size:0.8rem; font-weight:600; color:#475569; margin-bottom:4px;">Catégorie</label>
          <select id="edit-dyn-categorie" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; background:white;">
            ${categoriesHtml}
          </select>
        </div>
        <div>
          <label style="display:block; font-size:0.8rem; font-weight:600; color:#475569; margin-bottom:4px;">Langue</label>
          <select id="edit-dyn-langue" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; background:white;">
            ${languesHtml}
          </select>
        </div>
      </div>

      <div>
        <label style="display:block; font-size:0.8rem; font-weight:600; color:#475569; margin-bottom:4px;">Auteur / Compositeur</label>
        <input type="text" id="edit-dyn-auteur" value="${escapeHtml(chant.auteur || chant.compositeur || "")}" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem;">
      </div>

      <div>
        <label style="display:block; font-size:0.8rem; font-weight:600; color:#475569; margin-bottom:4px;">Refrain</label>
        <textarea id="edit-dyn-refrain" style="width:100%; height:80px; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; resize:vertical; font-family:inherit;">${escapeHtml(chant.refrain || "")}</textarea>
      </div>

      <div>
        <label style="display:block; font-size:0.8rem; font-weight:600; color:#475569; margin-bottom:4px;">Couplets</label>
        <span style="font-size:0.75rem; color:#64748b; display:block; margin-bottom:4px;">Astuce : Séparez chaque couplet par une ligne vide (des espaces).</span>
        <textarea id="edit-dyn-couplets" style="width:100%; height:180px; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; resize:vertical; font-family:inherit;" placeholder="Couplet 1...&#10;&#10;Couplet 2..."></textarea>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
        <div>
          <label style="display:block; font-size:0.8rem; font-weight:600; color:#475569; margin-bottom:4px;">Tonalité</label>
          <input type="text" id="edit-dyn-tonalite" value="${escapeHtml(chant.tonalite || "")}" placeholder="Ex: Do M" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem;">
        </div>
        <div>
          <label style="display:block; font-size:0.8rem; font-weight:600; color:#475569; margin-bottom:4px;">Durée estimée</label>
          <input type="text" id="edit-dyn-duree" value="${escapeHtml(chant.duree_estimee || "")}" placeholder="Ex: 3:30" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem;">
        </div>
      </div>

      <div>
        <label style="display:block; font-size:0.8rem; font-weight:600; color:#475569; margin-bottom:4px;">Remarques</label>
        <textarea id="edit-dyn-remarques" style="width:100%; height:60px; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; resize:vertical; font-family:inherit;">${escapeHtml(chant.remarques || "")}</textarea>
      </div>
    </div>
    
    <div style="background: #f8fafc; border-top: 1px solid #cbd5e1; padding: 16px 24px; display: flex; justify-content: flex-end; gap: 12px; align-items: center; flex-shrink: 0;">
      <button type="button" id="edit-dyn-btn-annuler" class="btn-secondary" style="padding: 8px 16px; border-radius: 8px; font-size: 0.85rem; cursor:pointer;">Annuler</button>
      <button type="button" id="edit-dyn-btn-enregistrer" class="btn-primary" style="padding: 8px 24px; border-radius: 8px; font-size: 0.85rem; background: #16a34a; color: white; border: none; cursor: pointer; font-weight:600;">Enregistrer</button>
    </div>
  `;

  document.getElementById("edit-dyn-couplets").value = coupletsTexte;

  // Prompt category creation on selecting "Autre"
  const dynSelectCat = document.getElementById("edit-dyn-categorie");
  if (dynSelectCat) {
    dynSelectCat.addEventListener("change", async () => {
      if (dynSelectCat.value === "Autre") {
        const nouvelle = prompt("Saisissez le nom de la nouvelle catégorie liturgique à créer :");
        if (nouvelle && nouvelle.trim()) {
          const nomNettoye = nouvelle.trim();
          try {
            const res = await api("/categories", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ nom: nomNettoye }),
            });
            CATEGORIES = res.categories;
            
            // Re-populate and select newly created category
            dynSelectCat.innerHTML = CATEGORIES.map(c => `
              <option value="${c}" ${c === nomNettoye ? "selected" : ""}>${categorieLabel(c)}</option>
            `).join("");
            
            alert(`La catégorie "${nomNettoye}" a été créée et envoyée à l'administrateur pour validation. Elle est utilisable immédiatement.`);
          } catch (err) {
            alert("Erreur de création de la catégorie: " + err.message);
            dynSelectCat.value = CATEGORIES[0] || "";
          }
        } else {
          dynSelectCat.value = CATEGORIES[0] || "";
        }
      }
    });
  }

  document.getElementById("edit-dyn-btn-annuler").addEventListener("click", () => {
    if (currentDetailSource === "editeur" && !currentDetailIndexOrId) {
      fermerModale("chant-details-modal");
    } else {
      afficherDetailsChantLecture();
    }
  });

  document.getElementById("edit-dyn-btn-enregistrer").addEventListener("click", async (e) => {
    const titre = document.getElementById("edit-dyn-titre").value.trim();
    if (!titre) {
      alert("Le titre est requis.");
      return;
    }

    const coupletsBruts = document.getElementById("edit-dyn-couplets").value;
    const coupletsList = coupletsBruts.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean).map(cleanCoupletPrefix);

    const modifications = {
      titre: titre,
      categorie: document.getElementById("edit-dyn-categorie").value,
      langue: document.getElementById("edit-dyn-langue").value,
      auteur: document.getElementById("edit-dyn-auteur").value.trim(),
      compositeur: document.getElementById("edit-dyn-auteur").value.trim(),
      refrain: document.getElementById("edit-dyn-refrain").value.trim() || null,
      couplets: coupletsList,
      tonalite: document.getElementById("edit-dyn-tonalite").value.trim() || null,
      duree_estimee: document.getElementById("edit-dyn-duree").value.trim() || null,
      remarques: document.getElementById("edit-dyn-remarques").value.trim() || null,
    };

    const isImport = currentDetailSource === "import";
    if (isImport) {
      const idx = currentDetailIndexOrId;
      importWorkspaceChants[idx] = {
        ...importWorkspaceChants[idx],
        ...modifications,
      };
      currentDetailChant = importWorkspaceChants[idx];
      afficherImportWorkspace(importWorkspaceChants);
      afficherDetailsChantLecture();
    } else {
      await avecChargement(e.currentTarget, async () => {
        let chantModifie;
        if (currentDetailIndexOrId) {
          chantModifie = await api(`/chants/${currentDetailIndexOrId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(modifications),
          });
        } else {
          chantModifie = await api(`/chants`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(modifications),
          });
          currentDetailIndexOrId = chantModifie.id;
        }
        currentDetailChant = chantModifie;

        // Synchronize local caches
        if (window.editeurChantsCache) {
          const idx = window.editeurChantsCache.findIndex(c => c.id === chantModifie.id);
          if (idx !== -1) {
            window.editeurChantsCache[idx] = chantModifie;
          } else {
            window.editeurChantsCache.push(chantModifie);
          }
        }
        if (window.listChantsCache) {
          const idx = window.listChantsCache.findIndex(c => c.id === chantModifie.id);
          if (idx !== -1) window.listChantsCache[idx] = chantModifie;
        }

        // Dynamically propagate update to active booklet composer rows
        Object.keys(momentsState).forEach(momentKey => {
          const state = momentsState[momentKey];
          if (state && state.type === "chant" && state.chant_id === chantModifie.id) {
            state.chant_titre = chantModifie.titre;
            state.refrain = chantModifie.refrain;
            state.couplets = chantModifie.couplets;
            state.total_couplets = chantModifie.couplets ? chantModifie.couplets.length : 0;
            
            const row = document.querySelector(`.moment-row[data-moment="${momentKey}"]`);
            if (row) {
              renderMomentBody(row, momentKey);
            }
          }
        });

        await actualiserEditeur();
        if (typeof regenererApercuSiPossible === "function") {
          regenererApercuSiPossible();
        }
        
        afficherDetailsChantLecture();
      });
    }
  });
}

async function ouvrirDetailsChant(id, startInEditMode = false) {
  let chant = null;
  if (window.listChantsCache) {
    chant = window.listChantsCache.find(c => c.id === id);
  }
  if (!chant && window.editeurChantsCache) {
    chant = window.editeurChantsCache.find(c => c.id === id);
  }
  
  if (chant) {
    ouvrirDetailsChantDynamique(chant, "editeur", id, startInEditMode);
  } else {
    chant = await api(`/chants/${id}`);
    ouvrirDetailsChantDynamique(chant, "editeur", id, startInEditMode);
  }
}

async function ouvrirEditeurChant(id, isImport = false, importIndex = null) {
  if (isImport && importIndex !== null) {
    const chant = importWorkspaceChants[importIndex];
    ouvrirDetailsChantDynamique(chant, "import", importIndex, true);
  } else if (id) {
    ouvrirDetailsChant(id, true);
  } else {
    const blankChant = {
      titre: "",
      categorie: CATEGORIES[0] || "Autre",
      langue: "fr",
      auteur: "",
      compositeur: "",
      refrain: "",
      couplets: [],
      tonalite: "",
      duree_estimee: "",
      remarques: "",
      actif: true
    };
    ouvrirDetailsChantDynamique(blankChant, "editeur", null, true);
  }
}

function ouvrirEditeurNouveauChant() {
  ouvrirEditeurChant(null);
}

document.getElementById("btn-ajouter-chant").addEventListener("click", ouvrirEditeurNouveauChant);
document.getElementById("ce-fermer").addEventListener("click", () => {
  fermerModale("chant-editor");
});

document.getElementById("chant-editor-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await avecChargementSubmit(e.target, async () => {
  const id = document.getElementById("ce-id").value;
  let titre = document.getElementById("ce-titre").value.trim();
  const refrain = document.getElementById("ce-refrain").value.trim();
  const couplets = getCoupletsFromFields();

  if (!titre) {
    if (refrain) {
      titre = refrain.slice(0, 30) + "...";
    } else if (couplets.length > 0) {
      titre = couplets[0].slice(0, 30) + "...";
    } else {
      titre = "Chant sans titre";
    }
  }

  let categorie = document.getElementById("ce-categorie").value;
  if (categorie === "Autre") {
    const nouvelleCategorie = document.getElementById("ce-nouvelle-categorie").value.trim();
    if (nouvelleCategorie) {
      const res = await api("/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nom: nouvelleCategorie }),
      });
      CATEGORIES = res.categories;
      peuplerSelectsCategories();
      categorie = nouvelleCategorie;
    }
  }

  const payload = {
    titre,
    categorie,
    refrain: refrain || null,
    couplets,
    code_reference: document.getElementById("ce-code").value || null,
    occasions: document.getElementById("ce-occasions").value.split(",").map((s) => s.trim()).filter(Boolean),
    slug: document.getElementById("ce-slug").value.trim() || null,
    langue: document.getElementById("ce-langue").value,
    mots_cles: document.getElementById("ce-mots-cles").value.split(",").map((s) => s.trim()).filter(Boolean),
    actif: document.getElementById("ce-actif").checked,
    favori: document.getElementById("ce-favori").checked,
    chant_principal: document.getElementById("ce-chant-principal").checked,
    tonalite: document.getElementById("ce-tonalite").value.trim() || null,
    duree_estimee: document.getElementById("ce-duree-estimee").value.trim() || null,
    remarques: document.getElementById("ce-remarques").value.trim() || null,
  };
  
  if (editImportIndex !== null) {
    const chosenAction = document.querySelector('input[name="ce-iw-action"]:checked')?.value || "save";
    const chosenReplaceSelect = document.getElementById("ce-iw-replace-select");
    const chosenReplaceId = chosenReplaceSelect ? Number(chosenReplaceSelect.value) : null;
    
    const item = importWorkspaceChants[editImportIndex];
    Object.assign(item, payload);
    item.action = chosenAction;
    item.replace_id = chosenReplaceId;
    
    afficherImportWorkspace(importWorkspaceChants);
    fermerModale("chant-editor");
    editImportIndex = null;
    return;
  }

  if (id) {
    await api(`/chants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } else {
    await api("/chants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }
  fermerModale("chant-editor");
  await actualiserEditeur();
  });
});

document.getElementById("ce-supprimer").addEventListener("click", async (e) => {
  const id = document.getElementById("ce-id").value;
  if (!id) return;
  if (!confirm("Demander la suppression de ce chant ? Il disparaîtra immédiatement de ta bibliothèque ; la décision finale revient au super-admin.")) return;
  await avecChargement(e.currentTarget, () => api("/moderation/demandes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type_cible: "chant", cible_id: Number(id) }),
  }));
  fermerModale("chant-editor");
  await actualiserEditeur();
  await actualiserListeBibliotheque();
});

// --- Importer (Interactive Workspace) ---

// Setup Drag & Drop listeners on initialization
function initImportDragDrop() {
  const zone = document.getElementById("import-dropzone");
  const fileInput = document.getElementById("import-fichier");
  const selectBtn = document.getElementById("btn-select-file");
  const fileInfo = document.getElementById("selected-file-info");
  const fileName = document.getElementById("selected-file-name");
  const fileSize = document.getElementById("selected-file-size");
  const removeBtn = document.getElementById("btn-remove-file");
  const zoneTitle = document.getElementById("import-dropzone-title");

  if (!zone) return;

  const triggerInputClick = (e) => {
    if (e.target !== removeBtn && !fileInfo.contains(e.target)) {
      fileInput.click();
    }
  };

  zone.addEventListener("click", triggerInputClick);

  selectBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  fileInput.addEventListener("change", () => {
    updateFileInputDisplay();
  });

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("dragover");
  });

  zone.addEventListener("dragenter", (e) => {
    e.preventDefault();
    zone.classList.add("dragover");
  });

  zone.addEventListener("dragleave", () => {
    zone.classList.remove("dragover");
  });

  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
    if (e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      updateFileInputDisplay();
    }
  });

  removeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    fileInput.value = "";
    fileInfo.classList.add("hidden");
    selectBtn.style.display = "inline-block";
    zoneTitle.style.display = "block";
  });

  function updateFileInputDisplay() {
    if (fileInput.files.length > 0) {
      const f = fileInput.files[0];
      fileName.textContent = f.name;
      fileSize.textContent = (f.size / (1024 * 1024)).toFixed(2) + " Mo";
      fileInfo.classList.remove("hidden");
      selectBtn.style.display = "none";
      zoneTitle.style.display = "none";
    } else {
      fileInfo.classList.add("hidden");
      selectBtn.style.display = "inline-block";
      zoneTitle.style.display = "block";
    }
  }
}

function resetFileInputRepresentation() {
  const fileInput = document.getElementById("import-fichier");
  if (fileInput) fileInput.value = "";
  const fileInfo = document.getElementById("selected-file-info");
  if (fileInfo) fileInfo.classList.add("hidden");
  const selectBtn = document.getElementById("btn-select-file");
  if (selectBtn) selectBtn.style.display = "inline-block";
  const zoneTitle = document.getElementById("import-dropzone-title");
  if (zoneTitle) zoneTitle.style.display = "block";
}

// Add DOMContentLoaded hook or direct call
setTimeout(initImportDragDrop, 1000);

document.getElementById("import-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const resultDiv = document.getElementById("import-result");
  const fichierInput = document.getElementById("import-fichier");
  if (!fichierInput.files.length) return;

  const formData = new FormData();
  formData.append("fichier", fichierInput.files[0]);
  formData.append("categorie_defaut", document.getElementById("import-categorie").value);
  formData.append("occasions", document.getElementById("import-occasions").value);
  formData.append("langue", document.getElementById("import-langue").value);
  formData.append("auteur", document.getElementById("import-auteur").value);

  resultDiv.innerHTML = `
    <div class="import-progression" style="margin-top:20px;">
      <div class="import-progression-barre"><div class="import-progression-remplissage" style="width: 50%;"></div></div>
      <p class="hint">Analyse et découpage du fichier en cours…</p>
    </div>
  `;
  try {
    await avecChargementSubmit(e.target, async () => {
      const res = await fetch("/import/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      resultDiv.textContent = "";
      afficherImportWorkspace(data.chants);
    });
  } catch (err) {
    resultDiv.innerHTML = `
      <div style="background:#fef2f2; border:1px solid #fca5a5; border-radius:12px; padding:16px; color:#b91c1c; margin-top:20px;">
        Erreur : ${err.message}
      </div>
    `;
  }
});

function afficherImportWorkspace(chants) {
  importWorkspaceChants = chants;
  
  document.getElementById("import-setup-section").style.display = "none";
  const resultDiv = document.getElementById("import-result");
  
  if (!chants || chants.length === 0) {
    resultDiv.innerHTML = `
      <div style="text-align:center; padding: 40px; background:white; border-radius:16px; border:1px solid #e2e8f0;">
        <div style="font-size: 3rem;">🔍</div>
        <h3 style="margin: 12px 0 4px 0; color: #0f172a;">Aucun chant détecté</h3>
        <p style="margin: 0 0 16px 0; color: #64748b; font-size:0.85rem;">Le document ne contient aucun chant exploitable.</p>
        <button type="button" onclick="annulerImportWorkspace()" class="btn-secondary" style="padding: 8px 16px; border-radius:8px;">Retourner</button>
      </div>
    `;
    return;
  }

  const totalCount = chants.length;
  const successCount = chants.filter(c => (c.confiance ?? 1) >= 0.8).length;
  const warningCount = chants.filter(c => (c.confiance ?? 1) >= 0.4 && (c.confiance ?? 1) < 0.8).length;
  const dangerCount = chants.filter(c => (c.confiance ?? 1) < 0.4).length;

  let cardsHtml = `
    <div class="saas-stats-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px;">
      <div class="stat-metric-card" style="border-left: 4px solid #2563eb;">
        <div style="font-size: 0.75rem; color:#64748B; font-weight:600; text-transform:uppercase;">Total détectés</div>
        <div style="font-size: 1.8rem; font-weight:800; color:#0F172A; margin: 4px 0;">${totalCount}</div>
      </div>
      <div class="stat-metric-card" style="border-left: 4px solid #10b981;">
        <div style="font-size: 0.75rem; color:#64748B; font-weight:600; text-transform:uppercase;">Importés (Haut)</div>
        <div style="font-size: 1.8rem; font-weight:800; color:#0F172A; margin: 4px 0;">${successCount}</div>
      </div>
      <div class="stat-metric-card" style="border-left: 4px solid #f59e0b;">
        <div style="font-size: 0.75rem; color:#64748B; font-weight:600; text-transform:uppercase;">À vérifier (Moyen)</div>
        <div style="font-size: 1.8rem; font-weight:800; color:#0F172A; margin: 4px 0;">${warningCount}</div>
      </div>
      <div class="stat-metric-card" style="border-left: 4px solid #ef4444;">
        <div style="font-size: 0.75rem; color:#64748B; font-weight:600; text-transform:uppercase;">Échecs (Faible)</div>
        <div style="font-size: 1.8rem; font-weight:800; color:#0F172A; margin: 4px 0;">${dangerCount}</div>
      </div>
    </div>
  `;

  let tableRowsHtml = chants.map((c, index) => {
    const isDuplicate = c.doublons && c.doublons.length > 0;
    const isIgnored = c.action === "ignore";
    const badge = isDuplicate ? `<span class="status-badge status-warning" style="margin-left: 6px;">Doublon</span>` : "";
    
    const pct = Math.round((c.confiance ?? 1) * 100);
    let confClass = "low";
    let statusBadge = `<span class="status-badge status-danger">Échec</span>`;
    if (isIgnored) {
      statusBadge = `<span class="status-badge" style="background:#cbd5e1; color:#475569;">Ignoré</span>`;
    } else if ((c.confiance ?? 1) >= 0.8) {
      confClass = "high";
      statusBadge = `<span class="status-badge status-success">Importé</span>`;
    } else if ((c.confiance ?? 1) >= 0.4) {
      confClass = "medium";
      statusBadge = `<span class="status-badge status-warning">À vérifier</span>`;
    }

    const progressHtml = `
      <div class="progress-bar-cell">
        <div class="progress-bar-wrapper" style="width: 100px;">
          <div class="progress-bar-fill ${confClass}" style="width: ${pct}%"></div>
        </div>
        <span style="font-size:0.75rem;font-weight:600;">${pct}%</span>
      </div>
    `;

    return `
      <tr data-index="${index}" style="${isIgnored ? 'opacity: 0.5;' : ''}">
        <td><input type="checkbox" class="iw-row-checkbox" data-index="${index}" ${isIgnored ? '' : 'checked'}></td>
        <td>
          <div style="font-weight: 600; color: #1F4A7C; cursor: pointer;" class="iw-click-target">${escapeHtml(c.titre || "(sans titre)")}</div>
          <div style="font-size: 0.75rem; color: #64748b; font-style: italic;">${escapeHtml(c.refrain ? c.refrain.slice(0, 45) : (c.couplets[0] || "").slice(0, 45))}...</div>
        </td>
        <td><span class="chant-categorie-pill" style="font-size:0.75rem; background:#f1f5f9; padding:2px 6px; border-radius:4px;">${categorieLabel(c.categorie)}</span></td>
        <td><span style="text-transform: uppercase; font-size:0.75rem; font-weight:600;">${c.langue || "fr"}</span></td>
        <td>${progressHtml}</td>
        <td>${statusBadge}${badge}</td>
        <td>
          <div style="display:flex;gap:6px;">
            <button type="button" class="depliant-action-icon-btn btn-edit-iw" title="Modifier">✏️</button>
            <button type="button" class="depliant-action-icon-btn btn-delete-iw" title="Supprimer">🗑️</button>
            <button type="button" class="depliant-action-icon-btn btn-details-iw" title="Détails">🔍</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  let workspaceHtml = `
    <div style="background: white; border: 1px solid #E2E8F0; border-radius: 16px; padding: 24px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; flex-wrap:wrap; gap:12px;">
        <div>
          <h3 style="margin: 0; font-size: 1.1rem; color: #1F4A7C;">Résultats de l'importation</h3>
          <p style="margin: 4px 0 0 0; font-size: 0.85rem; color: #64748B;">Modifiez les textes extraits et choisissez l'action appropriée pour chaque chant avant d'enregistrer.</p>
        </div>
        <div style="display:flex; gap:12px;">
          <button type="button" id="iw-btn-annuler" class="btn-secondary" style="padding: 8px 16px; border-radius: 8px; font-weight:600; cursor:pointer;">Annuler l'import</button>
          <button type="button" id="iw-btn-confirmer" class="btn-primary" style="padding: 8px 16px; border-radius: 8px; background: #2563eb; color:white; border:none; font-weight:600; cursor:pointer;">Valider l'importation</button>
        </div>
      </div>

      ${cardsHtml}

      <div class="editeur-table-container">
        <table class="saas-table">
          <thead>
            <tr>
              <th width="30"><input type="checkbox" id="iw-select-all" checked></th>
              <th>Chant</th>
              <th>Catégorie</th>
              <th>Langue</th>
              <th>Confiance</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="iw-table-body">
            ${tableRowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;

  resultDiv.innerHTML = workspaceHtml;

  // Bind Listeners
  document.getElementById("iw-btn-annuler").addEventListener("click", annulerImportWorkspace);
  document.getElementById("iw-btn-confirmer").addEventListener("click", confirmerImportWorkspace);
  
  const selectAll = document.getElementById("iw-select-all");
  selectAll.addEventListener("change", (e) => {
    document.querySelectorAll(".iw-row-checkbox").forEach(cb => {
      cb.checked = e.target.checked;
      const idx = Number(cb.dataset.index);
      importWorkspaceChants[idx].action = e.target.checked ? null : "ignore";
      const tr = cb.closest("tr");
      if (tr) tr.style.opacity = e.target.checked ? "1" : "0.5";
    });
  });

  const bodyEl = document.getElementById("iw-table-body");
  bodyEl.querySelectorAll("tr").forEach((row) => {
    const idx = Number(row.dataset.index);
    const c = chants[idx];

    row.querySelector(".iw-click-target").addEventListener("click", () => ouvrirDetailsChantDynamique(c, "import", idx, false));
    row.querySelector(".btn-edit-iw").addEventListener("click", () => ouvrirDetailsChantDynamique(c, "import", idx, true));
    
    row.querySelector(".iw-row-checkbox").addEventListener("change", (e) => {
      c.action = e.target.checked ? null : "ignore";
      row.style.opacity = e.target.checked ? "1" : "0.5";
    });

    row.querySelector(".btn-delete-iw").addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm("Retirer ce chant de la liste d'importation ?")) {
        importWorkspaceChants.splice(idx, 1);
        afficherImportWorkspace(importWorkspaceChants);
      }
    });

    row.querySelector(".btn-details-iw").addEventListener("click", (e) => {
      e.stopPropagation();
      ouvrirDetailsChantDynamique(c, "import", idx, false);
    });
  });
}

function ouvrirEditeurImportChant(index) {
  ouvrirEditeurChant(null, true, index);
}

function annulerImportWorkspace() {
  if (confirm("Annuler l'importation ? Toutes les données extraites seront perdues.")) {
    importWorkspaceChants = [];
    document.getElementById("import-result").innerHTML = "";
    document.getElementById("import-setup-section").style.display = "block";
    document.getElementById("import-form").reset();
    resetFileInputRepresentation();
  }
}

async function confirmerImportWorkspace() {
  const payloadChants = importWorkspaceChants.map((item, index) => {
    const row = document.querySelector(`#iw-table-body tr[data-index="${index}"]`);
    const isChecked = row ? row.querySelector(".iw-row-checkbox").checked : true;
    
    // Action overrides: if unchecked, ignore!
    let finalAction = item.action || (item.doublons && item.doublons.length > 0 ? "replace" : "save");
    if (!isChecked) {
      finalAction = "ignore";
    }

    return {
      action: finalAction,
      replace_id: item.replace_id || null,
      titre: item.titre,
      refrain: item.refrain || null,
      couplets: item.couplets || [],
      code_reference: item.code_reference || item.code || null,
      categorie: item.categorie,
      occasions: item.occasions || [],
      confiance: item.confiance || 1.0,
      langue: item.langue || "fr"
    };
  });

  const resultDiv = document.getElementById("import-result");
  resultDiv.innerHTML = `
    <div class="import-progression" style="margin-top:20px;">
      <div class="import-progression-barre"><div class="import-progression-remplissage" style="width: 75%;"></div></div>
      <p class="hint">Enregistrement des chants en cours…</p>
    </div>
  `;

  try {
    const res = await api("/import/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chants: payloadChants }),
    });
    alert(`Importation finalisée : ${res.saved} ajoutés, ${res.replaced} remplacés, ${res.ignored} ignorés.`);
    importWorkspaceChants = [];
    resultDiv.innerHTML = "";
    document.getElementById("import-setup-section").style.display = "block";
    document.getElementById("import-form").reset();
    resetFileInputRepresentation();
    await actualiserListeBibliotheque();
    await actualiserEditeur();
  } catch (err) {
    alert("Erreur lors de la finalisation: " + err.message);
    afficherImportWorkspace(importWorkspaceChants);
  }
}

function ouvrirImportDetails(chant) {
  const contentEl = document.getElementById("import-detail-content");
  
  const trust = typeof chant.confiance === "number" ? chant.confiance : 1;
  const pct = Math.round(trust * 100);
  let statusBadge = `<span class="status-badge status-danger" style="display:inline-block; margin-bottom:8px;">Confiance Faible</span>`;
  if (trust >= 0.8) {
    statusBadge = `<span class="status-badge status-success" style="display:inline-block; margin-bottom:8px;">Confiance Haute</span>`;
  } else if (trust >= 0.4) {
    statusBadge = `<span class="status-badge status-warning" style="display:inline-block; margin-bottom:8px;">Confiance Moyenne</span>`;
  }

  const warningsHtml = chant.avertissements && chant.avertissements.length > 0
    ? `<div style="background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:12px; margin-top:16px;">
        <h5 style="margin:0 0 6px 0; color:#b45309; font-size:0.8rem; text-transform:uppercase;">⚠️ Recommandations</h5>
        <ul style="margin:0; padding-left:20px; font-size:0.8rem; color:#78350f; line-height:1.4;">
          ${chant.avertissements.map(a => `<li>${escapeHtml(a)}</li>`).join("")}
        </ul>
       </div>`
    : `<div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:12px; margin-top:16px; color:#15803d; font-size:0.8rem;">
        ✓ L'analyse n'a détecté aucune anomalie majeure sur ce chant.
       </div>`;

  contentEl.innerHTML = `
    <div style="padding: 16px; display:flex; flex-direction:column; gap:16px;">
      <div>
        ${statusBadge}
        <h3 style="margin:0; font-size:1.2rem; color:#1F4A7C;">${escapeHtml(chant.titre || "(sans titre)")}</h3>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
        <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:12px; border-radius:8px;">
          <span style="font-size:0.75rem; color:#64748b; display:block;">Couplets détectés</span>
          <span style="font-size:1.1rem; font-weight:700; color:#0f172a;">${chant.couplets ? chant.couplets.length : 0}</span>
        </div>
        <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:12px; border-radius:8px;">
          <span style="font-size:0.75rem; color:#64748b; display:block;">Refrain détecté</span>
          <span style="font-size:1.1rem; font-weight:700; color:#0f172a;">${chant.refrain ? "Oui" : "Non"}</span>
        </div>
        <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:12px; border-radius:8px;">
          <span style="font-size:0.75rem; color:#64748b; display:block;">Catégorie</span>
          <span style="font-size:0.85rem; font-weight:700; color:#0f172a;">${categorieLabel(chant.categorie)}</span>
        </div>
        <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:12px; border-radius:8px;">
          <span style="font-size:0.75rem; color:#64748b; display:block;">Langue</span>
          <span style="font-size:0.85rem; font-weight:700; color:#0f172a; text-transform:uppercase;">${chant.langue || "fr"}</span>
        </div>
      </div>

      <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:16px; border-radius:8px;">
        <span style="font-size:0.75rem; color:#64748b; display:block; margin-bottom:4px;">Score de confiance</span>
        <div class="progress-bar-cell" style="justify-content:flex-start; gap:12px;">
          <div class="progress-bar-wrapper" style="flex:1; max-width:200px;">
            <div class="progress-bar-fill ${trust >= 0.8 ? 'high' : trust >= 0.4 ? 'medium' : 'low'}" style="width: ${pct}%"></div>
          </div>
          <span style="font-weight:700; color:#0f172a;">${pct}%</span>
        </div>
      </div>

      ${warningsHtml}

      <div style="margin-top: 16px; border-top:1px solid #e2e8f0; padding-top:16px; display:flex; justify-content:flex-end;">
        <button type="button" class="btn-secondary" onclick="document.getElementById('import-detail-drawer').classList.add('hidden')" style="padding:8px 16px;">Fermer</button>
      </div>
    </div>
  `;
  document.getElementById("import-detail-drawer").classList.remove("hidden");
}

// --- Réglages : entraînement du modèle ---
document.getElementById("btn-train").addEventListener("click", async (e) => {
  const statusEl = document.getElementById("train-status");
  statusEl.textContent = "Entraînement…";
  try {
    const res = await avecChargement(e.currentTarget, () => api("/ml/train", { method: "POST" }));
    statusEl.textContent = `Modèle entraîné sur ${res.exemples} chants, ${res.categories.length} catégories.`;
  } catch (err) {
    statusEl.textContent = `Erreur : ${err.message}`;
  }
});

document.getElementById("btn-reset-bibliotheque").addEventListener("click", async (e) => {
  const statusEl = document.getElementById("reset-status");
  const confirmation = document.getElementById("reset-confirmation").value;
  if (confirmation !== "SUPPRIMER") {
    statusEl.textContent = "Tape exactement SUPPRIMER dans le champ pour confirmer.";
    return;
  }
  if (!confirm("Vraiment tout supprimer ? Cette action est irréversible.")) return;
  try {
    const res = await avecChargement(e.currentTarget, () => api(`/chants/all?confirmation=${encodeURIComponent(confirmation)}`, { method: "DELETE" }));
    statusEl.textContent = `${res.deleted} chant(s) supprimé(s). Bibliothèque vide.`;
    document.getElementById("reset-confirmation").value = "";
    await actualiserListeBibliotheque();
    await actualiserEditeur();
  } catch (err) {
    statusEl.textContent = `Erreur : ${err.message}`;
  }
});

// --- Les dépliants ---
const JOURS_FR = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function formaterDateAffichage(valeur) {
  // Idem render/widgets.py::formater_date_affichage : essaie un parsing ISO
  // (saisi via le sélecteur de date natif) ; sinon renvoie tel quel (anciens
  // feuillets dont la date est encore une chaîne libre déjà formatée).
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur || "");
  if (!m) return valeur || "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return valeur;
  const jour = JOURS_FR[(d.getDay() + 6) % 7];
  return `${jour.charAt(0).toUpperCase()}${jour.slice(1)} ${d.getDate()} ${MOIS_FR[d.getMonth()]} ${d.getFullYear()}`;
}

function depliantCardHtml(feuillet) {
  const dateAffichee = formaterDateAffichage(feuillet.date);
  const sousTitre = feuillet.lieu ? `${escapeHtml(dateAffichee)} — ${escapeHtml(feuillet.lieu)}` : escapeHtml(dateAffichee);
  const pdfUrl = `/feuillets/${feuillet.id}/pdf`;
  const estAMoi = feuillet.chorale_id === IDENTITE.compte_id;
  const attribution = !estAMoi && feuillet.chorale_nom
    ? `<div class="depliant-card-attribution">Composé par ${escapeHtml(feuillet.chorale_nom)}</div>` : "";
  
  const format = feuillet.one_page_mode ? "1 page paysage" : "2 pages paysage";
  const nbChants = feuillet.moments ? feuillet.moments.filter(m => m.type === "chant").length : 0;
  
  const favorisIds = JSON.parse(localStorage.getItem("depliants_favoris") || "[]");
  const estFavori = favorisIds.includes(feuillet.id);

  const badgeHtml = estAMoi 
    ? `<span class="depliant-badge badge-prive">Privé</span>`
    : `<span class="depliant-badge badge-public">Communauté</span>`;

  return `
    <li class="depliant-card" data-id="${feuillet.id}">
      ${badgeHtml}
      
      <div class="depliant-thumbnail-container" data-src="${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0">
        <div class="pdf-thumbnail-placeholder" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#94a3b8; font-size:2.2rem; background:#f8fafc; font-weight:bold; border-radius:8px;">
          📄
          <span style="font-size:0.7rem; color:#94a3b8; font-weight:500; margin-top:8px; text-transform:uppercase; letter-spacing:0.05em;">Aperçu PDF</span>
        </div>
      </div>
      
      <div class="depliant-card-info">
        <h4 class="depliant-card-title">${sousTitre}</h4>
        ${attribution}
        <div class="depliant-card-meta">
          <span>🎵 ${nbChants} chant(s)</span>
          <span>📄 ${format}</span>
        </div>
      </div>
      
      <div class="depliant-card-actions">
        <div class="depliant-icon-buttons-group">
          <a href="${pdfUrl}" target="_blank" class="depliant-action-icon-btn" title="Ouvrir">👁️</a>
          <button type="button" class="depliant-action-icon-btn btn-favorite ${estFavori ? "active" : ""}" data-action="favori" title="Favori">⭐</button>
          <button type="button" class="depliant-action-icon-btn" data-action="partager" title="Partager">🔗</button>
          <button type="button" class="depliant-action-icon-btn" data-action="modifier" title="Modifier">✏️</button>
          ${estAMoi ? `<button type="button" class="depliant-action-icon-btn btn-delete" data-action="supprimer" title="Supprimer">🗑️</button>` : ""}
        </div>
        <button type="button" class="depliant-menu-dots-btn" data-action="dots">⋮</button>
      </div>
    </li>
  `;
}

let currentDepliantsTab = "mine";
let currentDepliantsSearch = "";
let currentDepliantsSort = "recent";

function initDepliantsListenersOnce() {
  const actionsBar = document.querySelector(".depliants-actions-bar");
  if (!actionsBar || actionsBar.dataset.init) return;
  actionsBar.dataset.init = "1";

  // Tab filters
  document.querySelectorAll(".tab-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentDepliantsTab = btn.dataset.tab;
      
      const porteeSelect = document.getElementById("depliants-portee");
      if (porteeSelect) {
        porteeSelect.value = (currentDepliantsTab === "mine" ? "mine" : "tous");
      }
      
      actualiserDepliants();
    });
  });

  // Search input
  const searchInput = document.getElementById("search-depliant");
  if (searchInput) {
    let timer = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        currentDepliantsSearch = searchInput.value.trim().toLowerCase();
        actualiserDepliants();
      }, 300);
    });
  }

  // Sort dropdown
  const sortSelect = document.getElementById("depliants-sort");
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      currentDepliantsSort = sortSelect.value;
      actualiserDepliants();
    });
  }
}

async function actualiserDepliants() {
  initDepliantsListenersOnce();
  
  // Close any remaining context menu
  const oldMenu = document.querySelector(".context-menu-popover");
  if (oldMenu) oldMenu.remove();

  // Load all leaflets for local filtering
  const feuillets = await api("/feuillets?mine=false");

  // Local Filtering
  let filtered = feuillets.filter((f) => {
    // 1. Tab filter
    if (currentDepliantsTab === "mine") {
      return f.chorale_id === IDENTITE.compte_id;
    }
    if (currentDepliantsTab === "publics") {
      return f.chorale_id !== IDENTITE.compte_id;
    }
    if (currentDepliantsTab === "favoris") {
      const favorisIds = JSON.parse(localStorage.getItem("depliants_favoris") || "[]");
      return favorisIds.includes(f.id);
    }
    if (currentDepliantsTab === "sauvegardes") {
      const sauvegardesIds = JSON.parse(localStorage.getItem("depliants_sauvegardes") || "[]");
      return sauvegardesIds.includes(f.id) || f.chorale_id === IDENTITE.compte_id;
    }
    // "tous" or "recents" returns all
    return true;
  });

  // 2. Search filter
  if (currentDepliantsSearch) {
    filtered = filtered.filter((f) => {
      const dateStr = formaterDateAffichage(f.date).toLowerCase();
      const lieuStr = (f.lieu || "").toLowerCase();
      const choraleStr = (f.chorale_nom || "").toLowerCase();
      
      // Check if any chant title inside moments matches search
      const matchesChants = f.moments && f.moments.some((m) => {
        if (m.type === "chant" && m.chant_titre) {
          return m.chant_titre.toLowerCase().includes(currentDepliantsSearch);
        }
        return false;
      });

      return dateStr.includes(currentDepliantsSearch) || 
             lieuStr.includes(currentDepliantsSearch) || 
             choraleStr.includes(currentDepliantsSearch) ||
             matchesChants;
    });
  }

  // Local Sorting
  filtered.sort((a, b) => {
    if (currentDepliantsSort === "recent" || currentDepliantsSort === "modification") {
      return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    }
    if (currentDepliantsSort === "ancien") {
      return new Date(a.updated_at || 0) - new Date(b.updated_at || 0);
    }
    if (currentDepliantsSort === "creation") {
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    }
    if (currentDepliantsSort === "nom-asc") {
      return a.date.localeCompare(b.date);
    }
    if (currentDepliantsSort === "nom-desc") {
      return b.date.localeCompare(a.date);
    }
    if (currentDepliantsSort === "chants") {
      const nbA = a.moments ? a.moments.filter(m => m.type === "chant").length : 0;
      const nbB = b.moments ? b.moments.filter(m => m.type === "chant").length : 0;
      return nbB - nbA;
    }
    if (currentDepliantsSort === "auteur") {
      const autA = (a.chorale_nom || "Ma chorale").toLowerCase();
      const autB = (b.chorale_nom || "Ma chorale").toLowerCase();
      return autA.localeCompare(autB);
    }
    return 0;
  });

  // Results Count Badge
  document.getElementById("depliants-count-badge").textContent = `${filtered.length} résultat(s)`;

  // Partition into Groups (Mes créations first, then Feuillets publics)
  const mineList = filtered.filter((f) => f.chorale_id === IDENTITE.compte_id);
  const publicsList = filtered.filter((f) => f.chorale_id !== IDENTITE.compte_id);

  // Group count badges
  document.getElementById("group-mine-badge").textContent = mineList.length;
  document.getElementById("group-publics-badge").textContent = publicsList.length;

  const mineContainer = document.getElementById("group-mine-container");
  const publicsContainer = document.getElementById("group-publics-container");
  const mineListEl = document.getElementById("depliants-mine-list");
  const publicsListEl = document.getElementById("depliants-publics-list");

  // Show/Hide group headers based on contents
  mineContainer.style.display = mineList.length > 0 ? "block" : "none";
  publicsContainer.style.display = publicsList.length > 0 ? "block" : "none";

  mineListEl.innerHTML = mineList.map(depliantCardHtml).join("");
  publicsListEl.innerHTML = publicsList.map(depliantCardHtml).join("");

  // Entirely Empty State
  if (filtered.length === 0) {
    mineContainer.style.display = "none";
    publicsContainer.style.display = "none";
    
    const container = document.querySelector(".depliants-groups-container");
    if (currentDepliantsTab === "mine" && feuillets.filter(f => f.chorale_id === IDENTITE.compte_id).length === 0) {
      container.innerHTML = etatVideHtml("📄", "Vous n'avez encore créé aucun feuillet.",
        `<button type="button" id="btn-creer-premier-depliant" class="btn-primary" style="margin-top: 12px; padding:8px 16px; border-radius:8px; border:none; background:#1F4A7C; color:white; cursor:pointer;">Créer mon premier feuillet</button>`);
      
      const btn = document.getElementById("btn-creer-premier-depliant");
      if (btn) {
        btn.addEventListener("click", () => document.getElementById("btn-nouveau-depliant").click());
      }
    } else {
      container.innerHTML = etatVideHtml("🔍", "Aucun dépliant ne correspond à vos filtres",
        "Essayez de modifier votre recherche ou vos critères de tri.");
    }
  } else {
    // If not empty, restore default structural wrappers if they were overwritten by empty state
    const groupsContainer = document.querySelector(".depliants-groups-container");
    if (!document.getElementById("depliants-mine-list")) {
      groupsContainer.innerHTML = `
        <div id="group-mine-container" class="depliants-group-section">
          <div class="group-header">
            <h3>⭐ MES CRÉATIONS <span id="group-mine-badge" class="group-badge">0</span></h3>
          </div>
          <ul id="depliants-mine-list" class="depliants-grid"></ul>
        </div>
        <div id="group-publics-container" class="depliants-group-section">
          <div class="group-header">
            <h3>👥 FEUILLETS PUBLICS <span id="group-publics-badge" class="group-badge">0</span></h3>
          </div>
          <ul id="depliants-publics-list" class="depliants-grid"></ul>
        </div>
      `;
      // Run actualiser again to populate them
      actualiserDepliants();
      return;
    }
  }

  // Register interactive listeners on cards
  const allCardLists = [mineListEl, publicsListEl];
  allCardLists.forEach((listEl) => {
    if (!listEl) return;
    listEl.querySelectorAll(".depliant-card").forEach((card) => {
      const id = Number(card.dataset.id);
      const f = feuillets.find((x) => x.id === id);

      // Lazy load iframe on hover (prevent server freeze)
      card.addEventListener("mouseenter", () => {
        const container = card.querySelector(".depliant-thumbnail-container");
        if (container && !container.querySelector("iframe")) {
          const src = container.dataset.src;
          container.innerHTML = `<iframe src="${src}" class="depliant-pdf-thumbnail" loading="lazy"></iframe>`;
        }
      });

      // Favorite toggle
      card.querySelector('[data-action="favori"]').addEventListener("click", (e) => {
        const btn = e.currentTarget;
        let favoris = JSON.parse(localStorage.getItem("depliants_favoris") || "[]");
        const idx = favoris.indexOf(id);
        if (idx !== -1) {
          favoris.splice(idx, 1);
          btn.classList.remove("active");
        } else {
          favoris.push(id);
          btn.classList.add("active");
        }
        localStorage.setItem("depliants_favoris", JSON.stringify(favoris));
        // Soft refresh counts
        actualiserDepliants();
      });

      // Share
      card.querySelector('[data-action="partager"]').addEventListener("click", () => partagerPdf(id));
      
      // Modifier
      card.querySelector('[data-action="modifier"]').addEventListener("click", () => modifierDepliant(id));

      // Supprimer
      const btnDel = card.querySelector('[data-action="supprimer"]');
      if (btnDel) {
        btnDel.addEventListener("click", async (e) => {
          if (!confirm("Voulez-vous supprimer ce feuillet ? Cette action est irréversible.")) return;
          await avecChargement(e.currentTarget, () => api("/moderation/demandes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type_cible: "feuillet", cible_id: id }),
          }));
          await actualiserDepliants();
        });
      }

      // Dots menu (popover)
      card.querySelector('[data-action="dots"]').addEventListener("click", (e) => {
        e.stopPropagation();
        
        // Remove previous popovers
        const existing = document.querySelector(".context-menu-popover");
        if (existing) existing.remove();

        const rect = e.currentTarget.getBoundingClientRect();
        const popover = document.createElement("div");
        popover.className = "context-menu-popover";
        popover.style.position = "fixed";
        popover.style.top = `${rect.bottom}px`;
        popover.style.left = `${Math.max(10, Math.min(window.innerWidth - 190, rect.left - 130))}px`;

        const isMine = f.chorale_id === IDENTITE.compte_id;
        const favoris = JSON.parse(localStorage.getItem("depliants_favoris") || "[]");
        const inFavs = favoris.includes(id);

        popover.innerHTML = `
          <button type="button" class="context-menu-item" data-menu="ouvrir">👁️ Ouvrir le PDF</button>
          <button type="button" class="context-menu-item" data-menu="modifier">✏️ ${isMine ? "Modifier" : "Copier et modifier"}</button>
          <button type="button" class="context-menu-item" data-menu="cloner">💾 Créer une copie</button>
          <button type="button" class="context-menu-item" data-menu="favori">⭐ ${inFavs ? "Retirer des favoris" : "Ajouter aux favoris"}</button>
          <button type="button" class="context-menu-item" data-menu="renommer">🏷️ Renommer (Date)</button>
          <button type="button" class="context-menu-item" data-menu="info">ℹ️ Voir les informations</button>
          <button type="button" class="context-menu-item" data-menu="download-pdf">📥 Télécharger le PDF</button>
          <button type="button" class="context-menu-item" data-menu="download-docx">📝 Télécharger en DOCX</button>
          ${isMine ? `<button type="button" class="context-menu-item danger-item" data-menu="supprimer">🗑️ Supprimer</button>` : ""}
        `;

        document.body.appendChild(popover);

        // Bind popover actions
        popover.querySelectorAll(".context-menu-item").forEach((item) => {
          item.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            popover.remove();
            
            const action = item.dataset.menu;
            if (action === "ouvrir") {
              window.open(`/feuillets/${id}/pdf`, "_blank");
            } else if (action === "modifier") {
              modifierDepliant(id);
            } else if (action === "cloner") {
              clonerDepliant(id);
            } else if (action === "favori") {
              let favs = JSON.parse(localStorage.getItem("depliants_favoris") || "[]");
              const idx = favs.indexOf(id);
              if (idx !== -1) favs.splice(idx, 1); else favs.push(id);
              localStorage.setItem("depliants_favoris", JSON.stringify(favs));
              actualiserDepliants();
            } else if (action === "renommer") {
              renommerDepliant(id, f.date);
            } else if (action === "info") {
              voirInfosDepliant(f);
            } else if (action === "download-pdf") {
              const a = document.createElement("a");
              a.href = `/feuillets/${id}/pdf`;
              a.download = `feuillet-${id}.pdf`;
              a.click();
            } else if (action === "download-docx") {
              alert("Bientôt disponible — L'export Word sera activé lors d'une prochaine mise à jour.");
            } else if (action === "supprimer") {
              if (confirm("Supprimer ce feuillet ?")) {
                await api("/moderation/demandes", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ type_cible: "feuillet", cible_id: id }),
                });
                actualiserDepliants();
              }
            }
          });
        });

        // Close popover when clicking anywhere else
        const closeHandler = () => {
          popover.remove();
          document.removeEventListener("click", closeHandler);
        };
        setTimeout(() => document.addEventListener("click", closeHandler), 10);
      });
    });
  });
}

async function clonerDepliant(id) {
  try {
    const orig = await api(`/feuillets/${id}`);
    await api("/feuillets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: orig.date + " (Copie)",
        lieu: orig.lieu,
        lectures: orig.lectures,
        moments: orig.moments,
        priere_active: orig.priere_active,
        priere_texte: orig.priere_texte,
        taille_texte_manuelle: orig.taille_texte_manuelle,
        one_page_mode: orig.one_page_mode,
        banniere_active: orig.banniere_active
      })
    });
    alert("Copie créée avec succès !");
    await actualiserDepliants();
  } catch (err) {
    alert("Erreur lors de la copie : " + err.message);
  }
}

async function renommerDepliant(id, ancienneDate) {
  const nouvelleDate = prompt("Nouveau nom (Date de la célébration) :", ancienneDate);
  if (!nouvelleDate || nouvelleDate.trim() === "" || nouvelleDate === ancienneDate) return;
  
  try {
    const orig = await api(`/feuillets/${id}`);
    await api(`/feuillets/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: nouvelleDate.trim(),
        lieu: orig.lieu,
        lectures: orig.lectures,
        moments: orig.moments,
        priere_active: orig.priere_active,
        priere_texte: orig.priere_texte,
        taille_texte_manuelle: orig.taille_texte_manuelle,
        one_page_mode: orig.one_page_mode,
        banniere_active: orig.banniere_active
      })
    });
    await actualiserDepliants();
  } catch (err) {
    alert("Erreur lors du renommage : " + err.message);
  }
}

function voirInfosDepliant(f) {
  const format = f.one_page_mode ? "1 page paysage" : "2 pages paysage";
  const nbChants = f.moments ? f.moments.filter(m => m.type === "chant").length : 0;
  alert(`Fiche technique du feuillet :
-------------------------------------
Titre/Date : ${formaterDateAffichage(f.date)}
Lieu : ${f.lieu || "Non précisé"}
Auteur/Chorale : ${f.chorale_nom || "Ma chorale"}
Créé le : ${new Date(f.created_at).toLocaleDateString("fr-FR")}
Format du feuillet : ${format}
Nombre de chants : ${nbChants} chant(s)
Visibilité : Public (Communauté)`);
}

async function modifierDepliant(id) {
  const feuillet = await api(`/feuillets/${id}`);
  feuilletCourantId = feuillet.id;
  document.getElementById("f-date").value = feuillet.date || "";
  document.getElementById("f-lieu").value = feuillet.lieu || "";
  document.getElementById("f-lecture1").value = feuillet.lectures.premiere_lecture || "";
  document.getElementById("f-psaume").value = feuillet.lectures.psaume || "";
  document.getElementById("f-lecture2").value = feuillet.lectures.deuxieme_lecture || "";
  document.getElementById("f-evangile").value = feuillet.lectures.evangile || "";
  document.getElementById("f-priere-active").checked = !!feuillet.priere_active;
  document.getElementById("f-priere-texte").value = feuillet.priere_texte || "";
  tailleTexteManuelle = feuillet.taille_texte_manuelle ?? null;
  const onePageCheck = document.getElementById("f-one-page-mode");
  if (onePageCheck) {
    onePageCheck.checked = !!feuillet.one_page_mode;
  }
  const banniereCheck = document.getElementById("f-banniere-active");
  if (banniereCheck) {
    banniereCheck.checked = feuillet.banniere_active !== false;
  }

  MOMENTS.forEach((m, i) => { momentsState[m] = { type: "aucun", ordre: i * 10 }; });
  viderChantsSpeciaux();

  for (const m of feuillet.moments) {
    const estMomentFixe = MOMENTS.includes(m.moment);
    let etat = { type: "aucun" };
    if (m.type === "chant" && m.chant_id) {
      try {
        const chant = await api(`/chants/${m.chant_id}`);
        etat = {
          type: "chant", chant_id: chant.id, chant_titre: chant.titre,
          total_couplets: (chant.couplets || []).length, couplet_limit: m.couplet_limit === 0 ? 0 : (m.couplet_limit || null),
          refrain: chant.refrain, couplets: chant.couplets,
        };
      } catch (e) {
        etat = { type: "aucun" };
      }
    } else if (m.type === "texte_libre") {
      etat = { type: "texte_libre", titre_libre: m.titre_libre, texte_libre: m.texte_libre };
    }
    if (estMomentFixe) {
      etat.ordre = m.ordre != null ? m.ordre : momentsState[m.moment].ordre;
      momentsState[m.moment] = etat;
    } else {
      etat.ordre = m.ordre != null ? m.ordre : (MOMENTS.length + specialCounter) * 10;
      etat.label = m.moment;
      ajouterChantSpecial(etat);
    }
  }
  document.querySelectorAll("#moments-container .moment-row").forEach((row) => {
    const moment = row.dataset.moment;
    const state = momentsState[moment] || { type: "aucun", ordre: 0 };
    row.querySelector(".moment-type").value = state.type;
    row.querySelector(".moment-ordre-input").value = state.ordre;
    renderMomentBody(row, moment);
  });

  afficherResultatFeuillet(feuillet.id);
  changerVue("composer");
}

function indiceComposerHtml() {
  return `<p class="hint">💡 Renseigne la date, choisis au moins un chant, puis clique sur
    « Créer le feuillet et générer le PDF ». L'aperçu s'affichera ici.</p>`;
}

document.getElementById("btn-nouveau-depliant").addEventListener("click", () => {
  feuilletCourantId = null;
  tailleTexteManuelle = null;
  document.getElementById("feuillet-form").reset();
  
  // Restore localStorage parameters after form reset
  ["f-type-celebration", "f-president", "f-animateur", "f-chorale-info"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = localStorage.getItem(id) || "";
  });
  
  const onePageCheck = document.getElementById("f-one-page-mode");
  if (onePageCheck) {
    onePageCheck.checked = localStorage.getItem("f-one-page-mode") === "true";
  }
  const banniereCheck = document.getElementById("f-banniere-active");
  if (banniereCheck) {
    const saved = localStorage.getItem("f-banniere-active");
    banniereCheck.checked = saved === null ? true : saved === "true";
  }
  
  document.getElementById("composer-result").innerHTML = indiceComposerHtml();
  viderChantsSpeciaux();
  document.querySelectorAll("#moments-container .moment-row").forEach((row, i) => {
    const moment = row.dataset.moment;
    momentsState[moment] = { type: "aucun", ordre: i * 10 };
    row.querySelector(".moment-type").value = "aucun";
    row.querySelector(".moment-ordre-input").value = i * 10;
    
    // Also make sure all radios are unchecked
    row.querySelectorAll(".moment-mode-radio").forEach((r) => r.checked = false);
    // Collapse the edit panel
    const editPanel = row.querySelector(".moment-edit-panel");
    if (editPanel) editPanel.classList.add("collapsed");
    
    renderMomentBody(row, moment);
  });
  changerVue("composer");
});

document.getElementById("depliants-portee").addEventListener("change", actualiserDepliants);

// --- Splash ---
function afficherSplashGeneration() {
  document.getElementById("splash-message").textContent = "Génération du feuillet…";
  document.getElementById("splash").classList.remove("hidden");
}

function masquerSplash() {
  document.getElementById("splash").classList.add("hidden");
}

function peuplerSelectsCategories() {
  const categorieOptionsAvecToutes = `<option value="">Toutes catégories</option>` +
    CATEGORIES.map((c) => `<option value="${c}">${categorieLabel(c)}</option>`).join("");
  document.getElementById("search-categorie").innerHTML = categorieOptionsAvecToutes;
  document.getElementById("picker-categorie").innerHTML = categorieOptionsAvecToutes;

  const categorieOptions = CATEGORIES.map((c) => `<option value="${c}">${categorieLabel(c)}</option>`).join("");
  document.getElementById("ce-categorie").innerHTML = categorieOptions;
  document.getElementById("bulk-categorie").innerHTML = categorieOptions;
  document.getElementById("import-categorie").innerHTML = categorieOptions;
}

// --- Administration (super-admin) ---

function choraleCardHtml(chorale) {
  return `
    <li class="chorale-card" data-id="${chorale.id}">
      <div class="chant-titre">${escapeHtml(chorale.nom)}</div>
      <div class="chant-meta">Identifiant : ${escapeHtml(chorale.username)}${chorale.must_change_password ? " — mot de passe pas encore défini" : ""}</div>
      <div class="toolbar">
        <button type="button" class="btn-secondary btn-reset-mdp" style="font-size: 0.8rem; padding: 6px 12px;">Réinitialiser le mot de passe</button>
      </div>
    </li>`;
}

async function actualiserAdminChorales() {
  const chorales = await api("/chorales/detail");
  const list = document.getElementById("admin-chorales-list");
  list.innerHTML = chorales.length
    ? chorales.map(choraleCardHtml).join("")
    : `<p class="hint">Aucune chorale créée pour l'instant.</p>`;
  list.querySelectorAll(".chorale-card").forEach((el) => {
    const id = Number(el.dataset.id);
    const chorale = chorales.find(c => c.id === id);
    el.querySelector(".btn-reset-mdp").addEventListener("click", async (e) => {
      try {
        if (!confirm(`Réinitialiser le mot de passe de la chorale "${chorale ? chorale.nom : ''}" ? Elle devra en définir un nouveau à sa prochaine connexion.`)) return;
        const res = await avecChargement(e.currentTarget, () => api(`/chorales/${id}/reset-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }));
        
        document.getElementById("reset-modal-nom").textContent = chorale ? chorale.nom : "Chorale";
        document.getElementById("reset-modal-mdp").textContent = res.mot_de_passe_initial;
        
        document.getElementById("btn-copy-reset-mdp").onclick = () => {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(res.mot_de_passe_initial);
          } else {
            // Fallback pour les contextes non sécurisés (HTTP)
            const tempEl = document.createElement("textarea");
            tempEl.value = res.mot_de_passe_initial;
            document.body.appendChild(tempEl);
            tempEl.select();
            document.execCommand("copy");
            document.body.removeChild(tempEl);
          }
          const copyBtn = document.getElementById("btn-copy-reset-mdp");
          copyBtn.innerHTML = "<span>✓</span> Copié !";
          setTimeout(() => { copyBtn.innerHTML = "<span>📋</span> Copier"; }, 2000);
        };
        
        ouvrirModale("admin-reset-modal");
        await actualiserAdminChorales();
      } catch (err) {
        console.error("Failed to reset password:", err);
        alert("Erreur de réinitialisation : " + err.message);
      }
    });
  });
}

function demandeCardHtml(demande) {
  const apercu = demande.apercu
    ? (demande.type_cible === "chant" ? escapeHtml(demande.apercu.titre) : `${escapeHtml(demande.apercu.date)}${demande.apercu.lieu ? " — " + escapeHtml(demande.apercu.lieu) : ""}`)
    : "(ressource déjà supprimée entre-temps)";
  return `
    <li class="demande-card" data-id="${demande.id}">
      <div class="chant-titre">${demande.type_cible === "chant" ? "Chant" : "Dépliant"} : ${apercu}</div>
      <div class="chant-meta">Demandé par ${escapeHtml(demande.chorale_nom)}</div>
      <div class="toolbar">
        <button type="button" class="btn-valider btn-effacer">Valider (supprimer définitivement)</button>
        <button type="button" class="btn-annuler-demande">Annuler (conserver)</button>
      </div>
    </li>`;
}

async function actualiserAdminDemandes() {
  const demandes = await api("/moderation/demandes?statut=en_attente");
  const list = document.getElementById("admin-demandes-list");
  list.innerHTML = demandes.length
    ? demandes.map(demandeCardHtml).join("")
    : `<p class="hint">Aucune demande en attente.</p>`;
  list.querySelectorAll(".demande-card").forEach((el) => {
    const id = Number(el.dataset.id);
    el.querySelector(".btn-valider").addEventListener("click", async (e) => {
      if (!confirm("Supprimer définitivement cette ressource pour toutes les chorales ? Action irréversible.")) return;
      await avecChargement(e.currentTarget, () => api(`/moderation/demandes/${id}/valider`, { method: "POST" }));
      await actualiserAdminDemandes();
      await actualiserAdminMasques();
    });
    el.querySelector(".btn-annuler-demande").addEventListener("click", async (e) => {
      await avecChargement(e.currentTarget, () => api(`/moderation/demandes/${id}/annuler`, { method: "POST" }));
      await actualiserAdminDemandes();
      await actualiserAdminMasques();
    });
  });
}

function masqueCardHtml(masque) {
  const apercu = masque.apercu
    ? (masque.type_cible === "chant" ? escapeHtml(masque.apercu.titre) : `${escapeHtml(masque.apercu.date)}${masque.apercu.lieu ? " — " + escapeHtml(masque.apercu.lieu) : ""}`)
    : "(ressource supprimée)";
  return `
    <li class="masque-card" data-id="${masque.id}">
      <div class="chant-titre">${masque.type_cible === "chant" ? "Chant" : "Dépliant"} : ${apercu}</div>
      <div class="chant-meta">Masqué pour ${escapeHtml(masque.chorale_nom)}</div>
      <div class="toolbar">
        <button type="button" class="btn-restaurer">Restaurer pour cette chorale</button>
      </div>
    </li>`;
}

async function actualiserAdminMasques() {
  const masques = await api("/moderation/masques");
  const list = document.getElementById("admin-masques-list");
  list.innerHTML = masques.length
    ? masques.map(masqueCardHtml).join("")
    : `<p class="hint">Aucune ressource masquée pour l'instant.</p>`;
  list.querySelectorAll(".masque-card").forEach((el) => {
    const id = Number(el.dataset.id);
    el.querySelector(".btn-restaurer").addEventListener("click", async (e) => {
      await avecChargement(e.currentTarget, () => api(`/moderation/masques/${id}`, { method: "DELETE" }));
      await actualiserAdminMasques();
    });
  });
}

async function actualiserAdmin() {
  await actualiserAdminChorales();
  await actualiserAdminDemandes();
  await actualiserAdminMasques();
  await actualiserAdminCategories();
}

function adminCategorieCardHtml(cat) {
  return `
    <li class="demande-card" data-id="${cat.id}">
      <div class="chant-titre" style="font-weight: 600;">Catégorie : <span style="color: #1F4A7C;">${escapeHtml(cat.nom)}</span></div>
      <div class="chant-meta" style="font-size: 0.8rem; color: #64748B;">Créée par : ${escapeHtml(cat.chorale_nom || "Système")}</div>
      <div class="toolbar" style="margin-top: 8px; display: flex; gap: 8px;">
        <button type="button" class="btn-valider" style="background: #16a34a; border-radius: 6px; padding: 6px 12px; font-size: 0.8rem; font-weight: 600; color: white; border: none; cursor: pointer;">Valider</button>
        <button type="button" class="btn-rejeter" style="background: #dc2626; border-radius: 6px; padding: 6px 12px; font-size: 0.8rem; font-weight: 600; color: white; border: none; cursor: pointer;">Rejeter</button>
      </div>
    </li>`;
}

async function actualiserAdminCategories() {
  const categories = await api("/moderation/categories?statut=en_attente");
  const list = document.getElementById("admin-categories-list");
  if (!list) return;
  list.innerHTML = categories.length
    ? categories.map(adminCategorieCardHtml).join("")
    : `<p class="hint">Aucune catégorie en attente de validation.</p>`;
  
  list.querySelectorAll(".demande-card").forEach((el) => {
    const id = Number(el.dataset.id);
    el.querySelector(".btn-valider").addEventListener("click", async (e) => {
      if (!confirm("Valider cette catégorie pour tout le monde ?")) return;
      await avecChargement(e.currentTarget, () => api(`/moderation/categories/${id}/valider`, { method: "POST" }));
      await actualiserAdminCategories();
      // Force reload category list on metadata cache
      const res = await api("/meta");
      CATEGORIES = res.categories;
    });
    
    el.querySelector(".btn-rejeter").addEventListener("click", async (e) => {
      const motif = prompt("Saisissez le motif de rejet (qui sera envoyé par message au créateur) :");
      if (motif === null) return; // Cancelled
      if (!motif.trim()) {
        alert("Le motif de rejet est obligatoire.");
        return;
      }
      await avecChargement(e.currentTarget, () => api(`/moderation/categories/${id}/rejeter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motif: motif.trim() })
      }));
      await actualiserAdminCategories();
    });
  });
}

// --- Statistiques ---

async function actualiserStatistiques() {
  const el = document.getElementById("stats-contenu");
  if (!el) return;

  // Show loading spinner
  el.innerHTML = `
    <div class="spinner-container">
      <div class="spinner-loader"></div>
      <p style="margin-top: 16px; color: #64748b; font-size: 0.9rem; font-weight: 500;">Chargement et compilation des statistiques de la plateforme...</p>
    </div>
  `;

  try {
    const s = await api("/statistiques");
    dernieresStats = s;

    // Render modern UI
    const totalChorales = s.total_chorales;
    const totalChants = s.total_chants;
    const totalFeuillets = s.total_feuillets;
    const demandesEnAttente = s.demandes_en_attente;
    const masquesActifs = s.masques_actifs;
    const demandesValidees = s.demandes_validees;

    // Table rows
    const feuilletsParChoraleLignes = s.feuillets_par_chorale.map((f) => `
      <tr>
        <td style="font-weight:600; color:#1e293b;">${escapeHtml(f.chorale_nom)}</td>
        <td><span style="background:#eff6ff; color:#2563eb; font-weight:700; padding:2px 8px; border-radius:12px; font-size:0.8rem;">${f.nombre} dépliants</span></td>
        <td style="color:#64748b; font-size:0.8rem;">${f.dernier ? formaterDateAffichage(f.dernier.slice(0, 10)) : "—"}</td>
      </tr>
    `).join("");

    const categoriesLignes = s.chants_par_categorie.map((c) => `
      <tr>
        <td><span class="chant-categorie-pill" style="font-size:0.8rem; background:#f1f5f9; padding:2px 6px; border-radius:4px;">${categorieLabel(c.categorie)}</span></td>
        <td style="font-weight:700; color:#1e293b;">${c.nombre} chants</td>
      </tr>
    `).join("");

    const feuilletsRecentsLignes = s.feuillets_recents.map((f) => `
      <tr>
        <td style="font-weight:600; color:#1e293b;">${escapeHtml(formaterDateAffichage(f.date))}${f.lieu ? " — " + escapeHtml(f.lieu) : ""}</td>
        <td style="color:#64748b; font-size:0.8rem;">${escapeHtml(f.chorale_nom || "—")}</td>
      </tr>
    `).join("");

    const chantsRecentsLignes = s.chants_recents.map((c) => `
      <tr>
        <td style="font-weight:600; color:#1e293b;">${escapeHtml(c.titre)}</td>
        <td><span class="chant-categorie-pill" style="font-size:0.8rem; background:#f1f5f9; padding:2px 6px; border-radius:4px;">${categorieLabel(c.categorie)}</span></td>
      </tr>
    `).join("");

    el.innerHTML = `
      <!-- Cards grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px;">
        <div class="stat-metric-card" style="border-left: 4px solid #2563eb;">
          <div style="font-size: 0.75rem; color:#64748B; font-weight:600; text-transform:uppercase;">Chorales actives</div>
          <div style="font-size: 1.8rem; font-weight:800; color:#0F172A; margin: 4px 0;">${totalChorales}</div>
          <div style="font-size: 0.7rem; color:#10B981;">Utilisateurs enregistrés</div>
        </div>
        <div class="stat-metric-card" style="border-left: 4px solid #10b981;">
          <div style="font-size: 0.75rem; color:#64748B; font-weight:600; text-transform:uppercase;">Chants totaux</div>
          <div style="font-size: 1.8rem; font-weight:800; color:#0F172A; margin: 4px 0;">${totalChants}</div>
          <div style="font-size: 0.7rem; color:#64748b;">Bibliothèque partagée</div>
        </div>
        <div class="stat-metric-card" style="border-left: 4px solid #f59e0b;">
          <div style="font-size: 0.75rem; color:#64748B; font-weight:600; text-transform:uppercase;">Dépliants créés</div>
          <div style="font-size: 1.8rem; font-weight:800; color:#0F172A; margin: 4px 0;">${totalFeuillets}</div>
          <div style="font-size: 0.7rem; color:#64748b;">Générations PDF réussies</div>
        </div>
        <div class="stat-metric-card" style="border-left: 4px solid #ef4444;">
          <div style="font-size: 0.75rem; color:#64748B; font-weight:600; text-transform:uppercase;">En attente</div>
          <div style="font-size: 1.8rem; font-weight:800; color:#0F172A; margin: 4px 0;">${demandesEnAttente}</div>
          <div style="font-size: 0.7rem; color:#ef4444; font-weight:600;">Demandes de suppression</div>
        </div>
        <div class="stat-metric-card" style="border-left: 4px solid #6366f1;">
          <div style="font-size: 0.75rem; color:#64748B; font-weight:600; text-transform:uppercase;">Masques actifs</div>
          <div style="font-size: 1.8rem; font-weight:800; color:#0F172A; margin: 4px 0;">${masquesActifs}</div>
          <div style="font-size: 0.7rem; color:#64748b;">Ressources privées</div>
        </div>
        <div class="stat-metric-card" style="border-left: 4px solid #8b5cf6;">
          <div style="font-size: 0.75rem; color:#64748B; font-weight:600; text-transform:uppercase;">Supprimés</div>
          <div style="font-size: 1.8rem; font-weight:800; color:#0F172A; margin: 4px 0;">${demandesValidees}</div>
          <div style="font-size: 0.7rem; color:#64748b;">Total archivé</div>
        </div>
      </div>

      <!-- Main statistics layout -->
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 24px;">
        
        <div class="settings-card" style="background: white; border-radius:16px;">
          <div class="settings-card-header">
            <h4 style="margin:0; font-size:1rem; color:#1F4A7C;">Dépliants par chorale</h4>
          </div>
          <div class="settings-card-body" style="padding-top: 16px;">
            <table class="saas-table">
              <thead>
                <tr>
                  <th>Chorale</th>
                  <th>Total Dépliants</th>
                  <th>Dernier dépliant</th>
                </tr>
              </thead>
              <tbody>
                ${feuilletsParChoraleLignes || '<tr><td colspan="3" style="text-align:center; color:#64748b;">Aucune donnée disponible</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>

        <div class="settings-card" style="background: white; border-radius:16px;">
          <div class="settings-card-header">
            <h4 style="margin:0; font-size:1rem; color:#1F4A7C;">Répartition des chants par catégorie</h4>
          </div>
          <div class="settings-card-body" style="padding-top: 16px;">
            <table class="saas-table">
              <thead>
                <tr>
                  <th>Catégorie liturgique</th>
                  <th>Nombre de chants</th>
                </tr>
              </thead>
              <tbody>
                ${categoriesLignes || '<tr><td colspan="2" style="text-align:center; color:#64748b;">Aucune donnée disponible</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>

        <div class="settings-card" style="background: white; border-radius:16px;">
          <div class="settings-card-header">
            <h4 style="margin:0; font-size:1rem; color:#1F4A7C;">Derniers dépliants composés</h4>
          </div>
          <div class="settings-card-body" style="padding-top: 16px;">
            <table class="saas-table">
              <thead>
                <tr>
                  <th>Date &amp; Lieu</th>
                  <th>Chorale</th>
                </tr>
              </thead>
              <tbody>
                ${feuilletsRecentsLignes || '<tr><td colspan="2" style="text-align:center; color:#64748b;">Aucune donnée disponible</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>

        <div class="settings-card" style="background: white; border-radius:16px;">
          <div class="settings-card-header">
            <h4 style="margin:0; font-size:1rem; color:#1F4A7C;">Chants récemment ajoutés</h4>
          </div>
          <div class="settings-card-body" style="padding-top: 16px;">
            <table class="saas-table">
              <thead>
                <tr>
                  <th>Titre du chant</th>
                  <th>Catégorie</th>
                </tr>
              </thead>
              <tbody>
                ${chantsRecentsLignes || '<tr><td colspan="2" style="text-align:center; color:#64748b;">Aucune donnée disponible</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    `;

  } catch (err) {
    el.innerHTML = `
      <div style="text-align:center; padding: 40px; background:white; border-radius:16px; border: 1px solid #fca5a5;">
        <div style="font-size:2.5rem;">⚠️</div>
        <h3 style="color:#ef4444; margin:12px 0 4px 0;">Erreur lors du chargement des statistiques</h3>
        <p style="color:#64748b; font-size:0.85rem; margin:0;">${err.message}</p>
      </div>
    `;
  }
}

function exporterPVStatistiques() {
  if (!dernieresStats) {
    alert("Aucune statistique chargée à exporter.");
    return;
  }
  const s = dernieresStats;
  const timestamp = new Date().toLocaleString("fr-FR");
  const isoDate = new Date().toISOString().slice(0, 10);
  
  let report = `================================================================================
PROCÈS-VERBAL TECHNIQUE - AUDIT ET STATISTIQUES DE LA PLATEFORME DEPLIANTAPP
================================================================================
Généré le : ${timestamp}
Auditeur/Rôle : Super-administrateur
Status Système : Opérationnel
--------------------------------------------------------------------------------

1. RAPPORT SYNTHÉTIQUE DES MÉTRIQUES CLÉS
--------------------------------------------------------------------------------
- Nombre total de Chorales enregistrées : ${s.total_chorales}
- Nombre total de Chants en bibliothèque : ${s.total_chants}
- Nombre total de Dépliants (Feuillets) générés : ${s.total_feuillets}
- Demandes de suppression en attente de modération : ${s.demandes_en_attente}
- Ressources masquées actives (Accès privé) : ${s.masques_actifs}
- Historique des suppressions validées : ${s.demandes_validees}

2. ANALYSE ET ACTIVITÉ PAR CHORALE
--------------------------------------------------------------------------------
Chorales actives et volume de production de dépliants :
${s.feuillets_par_chorale.map(f => {
  return `* ${f.chorale_nom.padEnd(35)} : ${String(f.nombre).padStart(4)} dépliants (Dernier en date : ${f.dernier ? f.dernier.slice(0, 10) : 'Aucun'})`;
}).join('\n')}

3. STATISTIQUES D'ORGANISATION LITURGIQUE
--------------------------------------------------------------------------------
Répartition de la bibliothèque globale par catégorie liturgique :
${s.chants_par_categorie.map(c => {
  return `* ${categorieLabel(c.categorie).padEnd(35)} : ${String(c.nombre).padStart(4)} chants`;
}).join('\n')}

4. COMPILATION DE L'ACTIVITÉ RÉCENTE
--------------------------------------------------------------------------------
Derniers dépliants générés sur la plateforme :
${s.feuillets_recents.map(f => {
  const dateStr = f.date ? f.date.slice(0, 10) : '—';
  return `* Le ${dateStr} à ${f.lieu || '—'} par [${f.chorale_nom || 'Inconnue'}]`;
}).join('\n')}

Derniers chants ajoutés à la bibliothèque commune :
${s.chants_recents.map(c => {
  return `* "${c.titre}" [Catégorie: ${categorieLabel(c.categorie)}]`;
}).join('\n')}

--------------------------------------------------------------------------------
5. RECOMMANDATIONS ET AIDE À LA DÉCISION
--------------------------------------------------------------------------------
- Taux de rotation de la bibliothèque : L'activité est équilibrée.
- Recommandation technique : Penser à relancer les chorales inactives depuis plus de 6 mois.
- Modération : ${s.demandes_en_attente > 0 ? `Il reste ${s.demandes_en_attente} demandes de suppression à valider dans l'onglet Administration.` : 'Aucune action de modération requise actuellement.'}

================================================================================
FIN DU RAPPORT TECHNIQUE - HORODATAGE VALIDÉ : ${timestamp}
================================================================================`;

  const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `PV_Technique_Statistiques_${isoDate}.txt`;
  a.click();
}

// Bind button listener
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "btn-export-stats") {
    exporterPVStatistiques();
  }
});

// --- Messagerie (implémentation complète type Discord/WhatsApp Web) ---
let messagerieIntervalle = null;
let messagerieChoraleActive = null;
let activeReplyMessageId = null;
let activeEditMessageId = null;
let piecJointeSelectionnee = null;
let globalThreads = [];

// Stockage client des conversations archivées
function getArchivedThreads() {
  return JSON.parse(localStorage.getItem("messagerie_archived_threads") || "[]");
}

window.isConversationArchived = function() {
  if (IDENTITE.type === "super" && messagerieChoraleActive) {
    return getArchivedThreads().includes(messagerieChoraleActive);
  }
  return false;
};

window.basculerArchiveConversation = function() {
  if (IDENTITE.type !== "super" || !messagerieChoraleActive) return;
  const list = getArchivedThreads();
  const idx = list.indexOf(messagerieChoraleActive);
  if (idx > -1) {
    list.splice(idx, 1);
  } else {
    list.push(messagerieChoraleActive);
  }
  localStorage.setItem("messagerie_archived_threads", JSON.stringify(list));
  chargerInboxSuperAdmin();
  actualiserInfoPanel(document.querySelectorAll("#messagerie-fil .message-attachment-card, #messagerie-fil .message-image-preview").length);
};

function formatGroupDate(dateStr) {
  const d = new Date(dateStr.replace(" ", "T") + "Z");
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  if (d.toDateString() === today.toDateString()) {
    return "Aujourd'hui";
  } else if (d.toDateString() === yesterday.toDateString()) {
    return "Hier";
  } else {
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  }
}

function formatTime(dateStr) {
  const d = new Date(dateStr.replace(" ", "T") + "Z");
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function formatBytes(bytes) {
  if (!bytes) return "0 octet";
  if (bytes < 1024) return bytes + " octets";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " Ko";
  return (bytes / 1048576).toFixed(1) + " Mo";
}

function getAttachmentIcon(filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  if (["pdf"].includes(ext)) return "📄";
  if (["doc", "docx"].includes(ext)) return "📝";
  if (["xls", "xlsx"].includes(ext)) return "📊";
  if (["ppt", "pptx"].includes(ext)) return "📉";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "📦";
  return "📁";
}

function messageBulleHtml(m, allMessages) {
  const deMoi = m.expediteur_type === IDENTITE.type;
  
  // Citations / Réponses
  let replyHtml = "";
  if (m.parent_id) {
    const parentMsg = allMessages.find(msg => msg.id === m.parent_id);
    if (parentMsg) {
      const parentAuthor = parentMsg.expediteur_type === "super" ? "Admin" : "Chorale";
      const excerpt = parentMsg.texte ? parentMsg.texte.substring(0, 40) + (parentMsg.texte.length > 40 ? "..." : "") : "Fichier joint";
      replyHtml = `<div class="message-reply-ref">↩️ Réponse à ${parentAuthor} : ${escapeHtml(excerpt)}</div>`;
    } else {
      replyHtml = `<div class="message-reply-ref">↩️ Message d'origine supprimé</div>`;
    }
  }
  
  // Pièces jointes
  let mediaHtml = "";
  if (m.piece_jointe_filename) {
    const isImage = (m.piece_jointe_content_type || "").startsWith("image/");
    const isVideo = (m.piece_jointe_content_type || "").startsWith("video/");
    const isAudio = (m.piece_jointe_content_type || "").startsWith("audio/");
    
    if (isImage) {
      mediaHtml = `<img class="message-image-preview" src="/messages/${m.id}/piece-jointe" alt="${escapeHtml(m.piece_jointe_filename)}" onclick="window.open(this.src)">`;
    } else if (isVideo) {
      mediaHtml = `<video class="message-video-preview" controls src="/messages/${m.id}/piece-jointe"></video>`;
    } else if (isAudio) {
      mediaHtml = `<audio class="message-audio-preview" controls src="/messages/${m.id}/piece-jointe"></audio>`;
    } else {
      const sizeStr = formatBytes(m.piece_jointe_size);
      const icon = getAttachmentIcon(m.piece_jointe_filename);
      mediaHtml = `
        <div class="message-attachment-card">
          <span class="attachment-icon">${icon}</span>
          <div class="attachment-info">
            <p class="attachment-name">${escapeHtml(m.piece_jointe_filename)}</p>
            <p class="attachment-size">${sizeStr}</p>
          </div>
          <button type="button" class="attachment-download-btn" onclick="window.open('/messages/${m.id}/piece-jointe')" title="Télécharger">📥</button>
        </div>`;
    }
  }
  
  // Statut de lecture
  let statusIcon = "✓"; // Envoyé
  if (m.lu) statusIcon = "✓✓"; // Lu
  
  // Reac icons
  let reacHtml = "";
  if (m.reactions) {
    try {
      const reactions = JSON.parse(m.reactions);
      if (Object.keys(reactions).length > 0) {
        reacHtml = `<div class="message-reactions">` + Object.entries(reactions).map(([emoji, users]) => {
          const hasReacted = users.includes(IDENTITE.username);
          return `<button type="button" class="reaction-badge ${hasReacted ? "my-reaction" : ""}" onclick="reactToMessage(${m.id}, '${emoji}')">${emoji} <span class="reaction-count">${users.length}</span></button>`;
        }).join("") + `</div>`;
      }
    } catch(e) {}
  }
  
  // Menu contextuel au survol
  const authorName = m.expediteur_type === "super" ? "Admin" : "Chorale";
  let hoverMenu = `
    <div class="message-hover-menu">
      <div class="reaction-quick-select">
        <span class="quick-emoji" onclick="reactToMessage(${m.id}, '❤️')">❤️</span>
        <span class="quick-emoji" onclick="reactToMessage(${m.id}, '👍')">👍</span>
        <span class="quick-emoji" onclick="reactToMessage(${m.id}, '👏')">👏</span>
        <span class="quick-emoji" onclick="reactToMessage(${m.id}, '🙏')">🙏</span>
        <span class="quick-emoji" onclick="reactToMessage(${m.id}, '😂')">😂</span>
        <span class="quick-emoji" onclick="reactToMessage(${m.id}, '🎵')">🎵</span>
      </div>
      <button class="hover-menu-btn" type="button" onclick="replyToMessage(${m.id}, '${escapeHtml(authorName)}', '${escapeHtml(m.texte || 'Fichier')}')" title="Répondre">↩️</button>
  `;
  if (deMoi && !m.supprime) {
    hoverMenu += `<button class="hover-menu-btn" type="button" onclick="editMessage(${m.id}, ${JSON.stringify(m.texte || '')})" title="Modifier">✏️</button>`;
  }
  if (!m.supprime && (deMoi || IDENTITE.type === "super")) {
    hoverMenu += `<button class="hover-menu-btn" type="button" onclick="deleteMessage(${m.id})" title="Supprimer">🗑️</button>`;
  }
  hoverMenu += `</div>`;
  
  const formattedText = m.supprime
    ? `<span style="font-style: italic; color: #94a3b8;">Ce message a été supprimé.</span>`
    : (m.texte ? escapeHtml(m.texte).replace(/\n/g, "<br>") : "");
  
  const editBadge = (m.modifie && !m.supprime) ? ` <span style="font-size:0.7rem;opacity:0.7;">(modifié)</span>` : "";
  
  return `
    <div class="message-item ${deMoi ? "sent" : "received"}" data-id="${m.id}">
      ${hoverMenu}
      <div class="message-bubble">
        ${replyHtml}
        <p class="message-text">${formattedText}${editBadge}</p>
        ${mediaHtml}
        <div class="message-meta">
          <span>${formatTime(m.created_at)}</span>
          ${deMoi ? `<span class="sent-status" style="color: ${m.lu ? '#3b82f6' : '#94a3b8'};">${statusIcon}</span>` : ""}
        </div>
      </div>
      ${reacHtml}
    </div>`;
}

window.replyToMessage = function(id, author, text) {
  activeReplyMessageId = id;
  const replyBar = document.getElementById("reply-preview-bar");
  document.getElementById("reply-preview-author").textContent = author;
  document.getElementById("reply-preview-text").textContent = text;
  replyBar.classList.remove("hidden");
};

window.editMessage = function(id, text) {
  activeEditMessageId = id;
  const input = document.getElementById("messagerie-texte");
  input.value = text;
  input.focus();
  document.getElementById("btn-messagerie-send").disabled = false;
};

window.deleteMessage = async function(id) {
  if (!confirm("Voulez-vous vraiment supprimer ce message ?")) return;
  try {
    await api(`/messages/${id}`, { method: "DELETE" });
    await chargerFilMessagerie();
  } catch (err) {
    alert("Erreur de suppression: " + err.message);
  }
};

window.reactToMessage = async function(id, emoji) {
  try {
    const formData = new FormData();
    formData.append("emoji", emoji);
    await api(`/messages/${id}/reactions`, { method: "POST", body: formData });
    await chargerFilMessagerie();
  } catch (err) {
    alert("Erreur de réaction: " + err.message);
  }
};

async function chargerFilMessagerie() {
  const fil = document.getElementById("messagerie-fil");
  if (!fil) return;
  
  if (IDENTITE.type === "super" && !messagerieChoraleActive) {
    fil.innerHTML = `
      <div class="empty-chat-state">
        <div class="empty-illustration">💬</div>
        <p>Sélectionnez une chorale dans la liste de gauche pour commencer.</p>
      </div>`;
    return;
  }
  
  const url = IDENTITE.type === "super" ? `/messages?chorale_id=${messagerieChoraleActive}` : "/messages";
  const messages = await api(url);
  
  if (!messages.length) {
    fil.innerHTML = `
      <div class="empty-chat-state">
        <div class="empty-illustration">💬</div>
        <p>Aucun message pour l'instant. Envoyez le premier message !</p>
      </div>`;
    // Update headers and details pane
    actualiserChatHeader();
    actualiserInfoPanel(0);
    return;
  }
  
  // Group and render messages
  let html = "";
  let lastGroupDate = "";
  messages.forEach(m => {
    const groupDate = formatGroupDate(m.created_at);
    if (groupDate !== lastGroupDate) {
      html += `<div class="date-divider"><span>${groupDate}</span></div>`;
      lastGroupDate = groupDate;
    }
    html += messageBulleHtml(m, messages);
  });
  
  fil.innerHTML = html;
  fil.scrollTop = fil.scrollHeight;
  
  actualiserChatHeader();
  
  // Compter le nombre de fichiers joints
  const fileCount = messages.filter(m => m.piece_jointe_filename).length;
  actualiserInfoPanel(fileCount);
  
  // Marquer comme lu
  const urlLu = IDENTITE.type === "super" ? `/messages/lu?chorale_id=${messagerieChoraleActive}` : "/messages/lu";
  await api(urlLu, { method: "POST" });
  await actualiserBadgeMessagerie();
}

function actualiserChatHeader() {
  const nameEl = document.getElementById("chat-header-name");
  const statusEl = document.getElementById("chat-header-status");
  const avatarEl = document.getElementById("chat-header-avatar");
  
  if (IDENTITE.type === "super" && messagerieChoraleActive) {
    const activeThread = globalThreads.find(t => t.chorale_id === messagerieChoraleActive);
    if (activeThread) {
      nameEl.textContent = activeThread.chorale_nom;
      avatarEl.textContent = activeThread.chorale_nom.charAt(0).toUpperCase();
      statusEl.textContent = activeThread.dernier_message ? `Dernière activité le ${new Date(activeThread.dernier_message.created_at.replace(" ", "T") + "Z").toLocaleDateString()}` : "Aucune activité";
    }
  } else if (IDENTITE.type === "chorale") {
    nameEl.textContent = "Administrateur";
    avatarEl.textContent = "A";
    statusEl.textContent = "En ligne";
  }
}

function actualiserInfoPanel(nombreFichiers) {
  const container = document.getElementById("info-panel-details");
  if (!container) return;
  
  let nom = "Administrateur";
  let role = "Super-admin";
  if (IDENTITE.type === "super" && messagerieChoraleActive) {
    const activeThread = globalThreads.find(t => t.chorale_id === messagerieChoraleActive);
    if (activeThread) {
      nom = activeThread.chorale_nom;
      role = "Chorale";
    }
  }
  
  container.innerHTML = `
    <div class="info-avatar">${nom.charAt(0).toUpperCase()}</div>
    <h5 class="info-name">${escapeHtml(nom)}</h5>
    <span class="info-badge">${role}</span>
    
    <div class="info-section">
      <div class="info-section-title">Fichiers partagés</div>
      <div class="info-detail-item">📂 ${nombreFichiers} fichier${nombreFichiers > 1 ? "s" : ""} partagé${nombreFichiers > 1 ? "s" : ""}</div>
    </div>
    
    ${IDENTITE.type === "super" && messagerieChoraleActive ? `
    <div class="info-section">
      <div class="info-section-title">Actions rapides</div>
      <button type="button" class="action-btn-test" style="width:100%;margin-bottom:8px;padding:8px;" onclick="basculerArchiveConversation()">
        📦 ${isConversationArchived() ? 'Désarchiver la conversation' : 'Archiver la conversation'}
      </button>
    </div>
    ` : ""}
  `;
}

window.selectConversation = function(choraleId, choraleNom) {
  messagerieChoraleActive = choraleId;
  document.querySelectorAll(".conversation-item").forEach(item => {
    item.classList.toggle("active", Number(item.dataset.id) === choraleId);
  });
  
  // En mobile, on bascule vers la zone de chat
  if (window.innerWidth <= 768) {
    document.querySelector(".messagerie-sidebar").classList.add("inactive-tab");
    document.querySelector(".messagerie-chat-area").classList.add("active-tab");
  }
  
  chargerFilMessagerie();
};

async function actualiserBadgeMessagerie() {
  const { non_lus } = await api("/messages/non-lus");
  const badge = document.getElementById("badge-messagerie");
  if (badge) {
    badge.textContent = non_lus > 0 ? non_lus : "";
    badge.classList.toggle("hidden", non_lus === 0);
  }
}

async function chargerInboxSuperAdmin() {
  const threads = await api("/messages/chorales");
  globalThreads = threads;
  
  const container = document.getElementById("conversations-list");
  if (!container) return;
  
  const searchVal = document.getElementById("messagerie-search").value.toLowerCase();
  const filterVal = document.querySelector(".filter-tab.active") ? document.querySelector(".filter-tab.active").dataset.filter : "all";
  const archivedList = getArchivedThreads();
  
  let filtered = threads.filter(t => t.chorale_nom.toLowerCase().includes(searchVal));
  
  if (filterVal === "unread") {
    filtered = filtered.filter(t => t.non_lus > 0);
  } else if (filterVal === "archived") {
    filtered = filtered.filter(t => archivedList.includes(t.chorale_id));
  } else {
    filtered = filtered.filter(t => !archivedList.includes(t.chorale_id));
  }
  
  if (!filtered.length) {
    container.innerHTML = `<p class="hint" style="text-align:center;padding:20px;">Aucune conversation.</p>`;
    if (!messagerieChoraleActive) {
      document.getElementById("messagerie-fil").innerHTML = `
        <div class="empty-chat-state">
          <div class="empty-illustration">💬</div>
          <p>Aucune conversation sélectionnée.</p>
        </div>`;
    }
    return;
  }
  
  container.innerHTML = filtered.map(t => {
    const activeClass = t.chorale_id === messagerieChoraleActive ? "active" : "";
    const unreadBadge = t.non_lus > 0 ? `<span class="unread-badge">${t.non_lus}</span>` : "";
    
    // Simule la présence en ligne si dernière activité de moins d'1h
    const isOnline = t.dernier_message ? (Date.now() - new Date(t.dernier_message.created_at.replace(" ", "T")+"Z").getTime() < 3600000) : false;
    
    let lastMsgPreview = "Aucun message";
    let lastMsgTime = "";
    if (t.dernier_message) {
      lastMsgPreview = t.dernier_message.texte || "Fichier joint";
      lastMsgTime = new Date(t.dernier_message.created_at.replace(" ", "T")+"Z").toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    }
    
    return `
      <div class="conversation-item ${activeClass}" data-id="${t.chorale_id}" onclick="selectConversation(${t.chorale_id}, '${escapeHtml(t.chorale_nom)}')">
        <div class="conversation-avatar">
          ${t.chorale_nom.charAt(0).toUpperCase()}
          <span class="status-indicator ${isOnline ? "online" : ""}"></span>
        </div>
        <div class="conversation-details">
          <div class="conversation-meta-top">
            <h5 class="conversation-name">${escapeHtml(t.chorale_nom)}</h5>
            <span class="conversation-time">${lastMsgTime}</span>
          </div>
          <div class="conversation-preview">
            <p class="preview-text">${escapeHtml(lastMsgPreview)}</p>
            ${unreadBadge}
          </div>
        </div>
      </div>`;
  }).join("");
  
  if (!messagerieChoraleActive && filtered.length) {
    selectConversation(filtered[0].chorale_id, filtered[0].chorale_nom);
  }
}

// Configurer les écouteurs de la Messagerie
function initMessagerieEventListeners() {
  const fileInput = document.getElementById("messagerie-piece-jointe");
  const attachMenu = document.getElementById("btn-attach-menu");
  const attachPopover = document.getElementById("attach-popover");
  
  if (attachMenu && attachPopover && fileInput) {
    attachMenu.addEventListener("click", (e) => {
      e.stopPropagation();
      attachPopover.classList.toggle("hidden");
    });
    
    document.addEventListener("click", () => {
      attachPopover.classList.add("hidden");
    });
    
    attachPopover.querySelectorAll(".attach-item").forEach(item => {
      item.addEventListener("click", () => {
        const type = item.dataset.type;
        if (type === "image") fileInput.accept = "image/*";
        else if (type === "video") fileInput.accept = "video/*";
        else if (type === "audio") fileInput.accept = "audio/*";
        else fileInput.removeAttribute("accept");
        
        fileInput.click();
        attachPopover.classList.add("hidden");
      });
    });
  }
  
  // Nom du fichier et validation d'envoi
  const sendBtn = document.getElementById("btn-messagerie-send");
  const msgText = document.getElementById("messagerie-texte");
  const fileLabel = document.getElementById("messagerie-piece-jointe-nom");
  
  function updateSendButtonState() {
    const hasText = msgText.value.trim().length > 0;
    const hasFile = fileInput.files && fileInput.files.length > 0;
    if (sendBtn) sendBtn.disabled = !(hasText || hasFile);
  }
  
  if (msgText) msgText.addEventListener("input", updateSendButtonState);
  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      piecJointeSelectionnee = e.target.files[0] || null;
      if (fileLabel) {
        fileLabel.textContent = piecJointeSelectionnee ? `Fichier prêt : ${piecJointeSelectionnee.name} (${formatBytes(piecJointeSelectionnee.size)})` : "";
      }
      updateSendButtonState();
    });
  }
  
  // Emoji Picker
  const emojiBtn = document.getElementById("btn-emoji-picker");
  if (emojiBtn && msgText) {
    emojiBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const emojis = ["😀", "😂", "❤️", "👍", "👏", "🙏", "🎵", "🎉", "🔥", "✨"];
      let popover = document.getElementById("emoji-popover");
      if (!popover) {
        popover = document.createElement("div");
        popover.id = "emoji-popover";
        popover.className = "attach-popover";
        popover.style.width = "200px";
        popover.style.display = "flex";
        popover.style.flexWrap = "wrap";
        popover.style.gap = "6px";
        popover.style.padding = "10px";
        popover.innerHTML = emojis.map(em => `<span class="quick-emoji" style="font-size:1.3rem;cursor:pointer;">${em}</span>`).join("");
        emojiBtn.parentElement.appendChild(popover);
        popover.querySelectorAll(".quick-emoji").forEach(span => {
          span.addEventListener("click", () => {
            msgText.value += span.textContent;
            msgText.focus();
            popover.classList.add("hidden");
            updateSendButtonState();
          });
        });
      } else {
        popover.classList.toggle("hidden");
      }
    });
    
    document.addEventListener("click", () => {
      const pop = document.getElementById("emoji-popover");
      if (pop) pop.classList.add("hidden");
    });
  }
  
  // Annulation réponse (citation)
  const btnCloseReply = document.getElementById("btn-close-reply-preview");
  if (btnCloseReply) {
    btnCloseReply.addEventListener("click", () => {
      activeReplyMessageId = null;
      document.getElementById("reply-preview-bar").classList.add("hidden");
    });
  }
  
  // Envoi Formulaire
  const msgForm = document.getElementById("messagerie-form");
  if (msgForm) {
    msgForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const texte = msgText.value.trim();
      if (!texte && !piecJointeSelectionnee) return;
      
      const statusEl = document.getElementById("btn-messagerie-send");
      
      try {
        if (activeEditMessageId) {
          // Mode modification
          const formData = new FormData();
          formData.append("texte", texte);
          await avecChargementSubmit(statusEl, () => fetch(`/messages/${activeEditMessageId}`, { method: "PUT", body: formData }));
          activeEditMessageId = null;
        } else {
          // Mode création
          const formData = new FormData();
          if (texte) formData.append("texte", texte);
          if (piecJointeSelectionnee) formData.append("piece_jointe", piecJointeSelectionnee);
          if (activeReplyMessageId) formData.append("parent_id", activeReplyMessageId);
          if (IDENTITE.type === "super" && messagerieChoraleActive) {
            formData.append("chorale_id", messagerieChoraleActive);
          }
          
          await avecChargementSubmit(statusEl, () => fetch("/messages", { method: "POST", body: formData }));
          activeReplyMessageId = null;
          document.getElementById("reply-preview-bar").classList.add("hidden");
        }
        
        msgText.value = "";
        piecJointeSelectionnee = null;
        if (fileInput) fileInput.value = "";
        if (fileLabel) fileLabel.textContent = "";
        updateSendButtonState();
        
        await chargerFilMessagerie();
        if (IDENTITE.type === "super") await chargerInboxSuperAdmin();
      } catch(err) {
        alert("Erreur lors de l'action : " + err.message);
      }
    });
  }
  
  // Recherche et filtres sidebar
  const searchInput = document.getElementById("messagerie-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      if (IDENTITE.type === "super") chargerSidebarMessagerie(globalThreads);
    });
  }
  
  const filtersContainer = document.getElementById("messagerie-filters");
  if (filtersContainer) {
    filtersContainer.querySelectorAll(".filter-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        filtersContainer.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        if (IDENTITE.type === "super") chargerSidebarMessagerie(globalThreads);
      });
    });
  }
  
  // Toggle info panel
  const btnToggleInfo = document.getElementById("btn-toggle-info-panel");
  const infoPanel = document.getElementById("messagerie-info-panel");
  if (btnToggleInfo && infoPanel) {
    btnToggleInfo.addEventListener("click", () => {
      infoPanel.classList.toggle("hidden");
    });
    
    const btnCloseInfo = document.getElementById("btn-close-info-panel");
    if (btnCloseInfo) {
      btnCloseInfo.addEventListener("click", () => {
        infoPanel.classList.add("hidden");
      });
    }
  }

  // Bouton retour messagerie mobile
  const btnBackMessagerie = document.getElementById("btn-back-messagerie-mobile");
  if (btnBackMessagerie) {
    btnBackMessagerie.addEventListener("click", () => {
      document.querySelector(".messagerie-sidebar").classList.remove("inactive-tab");
      document.querySelector(".messagerie-chat-area").classList.remove("active-tab");
    });
  }
}

// Fonction de recherche alias local pour filtrer threads
function chargerSidebarMessagerie(threads) {
  const container = document.getElementById("conversations-list");
  if (!container) return;
  
  const searchVal = document.getElementById("messagerie-search").value.toLowerCase();
  const activeFilterTab = document.querySelector(".filter-tab.active");
  const filterVal = activeFilterTab ? activeFilterTab.dataset.filter : "all";
  const archivedList = getArchivedThreads();
  
  let filtered = threads.filter(t => t.chorale_nom.toLowerCase().includes(searchVal));
  
  if (filterVal === "unread") {
    filtered = filtered.filter(t => t.non_lus > 0);
  } else if (filterVal === "archived") {
    filtered = filtered.filter(t => archivedList.includes(t.chorale_id));
  } else {
    filtered = filtered.filter(t => !archivedList.includes(t.chorale_id));
  }
  
  if (!filtered.length) {
    container.innerHTML = `<p class="hint" style="text-align:center;padding:20px;">Aucune conversation.</p>`;
    return;
  }
  
  container.innerHTML = filtered.map(t => {
    const activeClass = t.chorale_id === messagerieChoraleActive ? "active" : "";
    const unreadBadge = t.non_lus > 0 ? `<span class="unread-badge">${t.non_lus}</span>` : "";
    const isOnline = t.dernier_message ? (Date.now() - new Date(t.dernier_message.created_at.replace(" ", "T")+"Z").getTime() < 3600000) : false;
    
    let lastMsgPreview = "Aucun message";
    let lastMsgTime = "";
    if (t.dernier_message) {
      lastMsgPreview = t.dernier_message.texte || "Fichier joint";
      lastMsgTime = new Date(t.dernier_message.created_at.replace(" ", "T")+"Z").toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    }
    
    return `
      <div class="conversation-item ${activeClass}" data-id="${t.chorale_id}" onclick="selectConversation(${t.chorale_id}, '${escapeHtml(t.chorale_nom)}')">
        <div class="conversation-avatar">
          ${t.chorale_nom.charAt(0).toUpperCase()}
          <span class="status-indicator ${isOnline ? "online" : ""}"></span>
        </div>
        <div class="conversation-details">
          <div class="conversation-meta-top">
            <h5 class="conversation-name">${escapeHtml(t.chorale_nom)}</h5>
            <span class="conversation-time">${lastMsgTime}</span>
          </div>
          <div class="conversation-preview">
            <p class="preview-text">${escapeHtml(lastMsgPreview)}</p>
            ${unreadBadge}
          </div>
        </div>
      </div>`;
  }).join("");
}

async function demarrerMessagerie() {
  initMessagerieEventListeners();
  
  if (IDENTITE.type === "super") {
    // Admin : Affiche recherche + filtres
    document.getElementById("messagerie-search-wrapper").style.display = "flex";
    document.getElementById("messagerie-filters").style.display = "flex";
    await chargerInboxSuperAdmin();
  } else {
    // Chorale : Masque recherche + filtres
    document.getElementById("messagerie-search-wrapper").style.display = "none";
    document.getElementById("messagerie-filters").style.display = "none";
    
    // Rôle Chorale : Une seule conversation avec l'Administrateur
    const container = document.getElementById("conversations-list");
    if (container) {
      container.innerHTML = `
        <div class="conversation-item active" onclick="selectConversation(null, 'Administrateur')">
          <div class="conversation-avatar">
            A
            <span class="status-indicator online"></span>
          </div>
          <div class="conversation-details">
            <div class="conversation-meta-top">
              <h5 class="conversation-name">Administrateur</h5>
            </div>
            <div class="conversation-preview">
              <p class="preview-text">Discuter avec le super-admin</p>
            </div>
          </div>
        </div>`;
    }
  }
  
  await chargerFilMessagerie();
  arreterMessagerie();
  messagerieIntervalle = setInterval(async () => {
    if (IDENTITE.type === "super") {
      // Met à jour la liste sans perturber la sélection
      const threads = await api("/messages/chorales");
      globalThreads = threads;
      chargerSidebarMessagerie(threads);
    }
    await chargerFilMessagerie();
  }, 8000);
}

function arreterMessagerie() {
  if (messagerieIntervalle) { clearInterval(messagerieIntervalle); messagerieIntervalle = null; }
}

document.getElementById("admin-chorale-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("admin-chorale-status");
  const nom = document.getElementById("admin-chorale-nom").value.trim();
  const username = document.getElementById("admin-chorale-username").value.trim();
  const successContainer = document.getElementById("admin-chorale-success-container");
  
  statusEl.textContent = "Création de la chorale en cours…";
  successContainer.classList.add("hidden");
  
  try {
    const res = await avecChargementSubmit(e.target, () => api("/chorales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nom, username }),
    }));
    
    statusEl.textContent = "";
    document.getElementById("admin-chorale-form").reset();
    
    // Render Success Card
    successContainer.innerHTML = `
      <div class="settings-card admin-card-success" style="padding: 20px; border-radius: 16px; display: flex; align-items: center; justify-content: space-between; gap: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); margin-bottom: 24px;">
        <div style="flex: 1;">
          <span class="success-badge" style="display:inline-block; margin-bottom:8px;">✅ Chorale récemment créée</span>
          <h3 style="margin: 0 0 6px 0; font-size: 1.15rem; color: #0f172a;">${escapeHtml(res.nom)}</h3>
          <p style="margin: 0; font-size: 0.85rem; color: #64748b; line-height: 1.5;">
            Identifiant de connexion : <strong style="color:#0f172a;">${escapeHtml(res.username)}</strong><br>
            Mot de passe initial : <strong style="color: #10b981; font-size: 1.05rem; background:#ecfdf5; padding:2px 6px; border-radius:4px; border:1px solid #a7f3d0; font-family:monospace;">${res.mot_de_passe_initial}</strong>
          </p>
          <div style="margin-top: 16px; display:flex; gap:12px;">
            <button type="button" id="btn-reset-pw-success" class="admin-action-btn-outline" data-id="${res.id}">Réinitialiser le mot de passe</button>
            <button type="button" onclick="document.getElementById('admin-chorale-success-container').classList.add('hidden')" class="btn-secondary" style="padding:8px 16px; border-radius:8px; font-size:0.85rem;">Masquer l'alerte</button>
          </div>
        </div>
        <div style="width: 52px; height: 52px; border-radius: 50%; background: #dcfce7; color: #10b981; display: flex; align-items: center; justify-content: center; font-size: 1.8rem; font-weight:bold; flex-shrink:0;">
          ✓
        </div>
      </div>
    `;
    successContainer.classList.remove("hidden");
    
    // Bind reset password click
    document.getElementById("btn-reset-pw-success").addEventListener("click", async (btnEvent) => {
      const id = Number(btnEvent.currentTarget.dataset.id);
      if (!confirm("Voulez-vous réinitialiser le mot de passe de cette chorale ?")) return;
      try {
        const resetRes = await avecChargement(btnEvent.currentTarget, () => api(`/chorales/${id}/reset-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }));
        alert(`Nouveau mot de passe généré : ${resetRes.mot_de_passe_initial}`);
        const pwEl = successContainer.querySelector("strong[style*='monospace']");
        if (pwEl) pwEl.textContent = resetRes.mot_de_passe_initial;
      } catch (pwErr) {
        alert("Erreur lors de la réinitialisation: " + pwErr.message);
      }
    });

    await actualiserAdminChorales();
  } catch (err) {
    statusEl.textContent = `Erreur : ${err.message}`;
  }
});

// --- Tirer pour rafraîchir (mobile uniquement) : sur les pages qui
// affichent des données récupérées par fetch, tirer l'écran vers le bas en
// haut de page relance uniquement la récupération des données de la vue
// active — jamais un rechargement complet du site (pas de window.location
// .reload()). Complète l'actualisation automatique de la messagerie pour
// les cas où elle n'a pas encore tourné, ou pour forcer un état à jour tout
// de suite après une action faite ailleurs (autre appareil, autre onglet).
function rafraichisseurVueActive() {
  const rafraichisseurs = {
    bibliotheque: actualiserListeBibliotheque,
    editeur: actualiserEditeur,
    depliants: actualiserDepliants,
    reglages: chargerParametres,
    admin: actualiserAdmin,
    statistiques: actualiserStatistiques,
    messagerie: async () => {
      if (IDENTITE.type === "super") await chargerInboxSuperAdmin();
      await chargerFilMessagerie();
    },
  };
  return rafraichisseurs[vuePrecedente] || null;
}

function initTirerPourRafraichir() {
  const tactile = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  if (!tactile) return;

  const indicateur = document.getElementById("ptr-indicateur");
  const SEUIL = 68;
  let depart = null;
  let distance = 0;
  let enCours = false;

  const reinitialiser = () => {
    depart = null;
    distance = 0;
    indicateur.classList.remove("visible", "pret");
    indicateur.style.transform = "";
  };

  document.addEventListener("touchstart", (e) => {
    const modaleOuverte = !!document.querySelector(".modal.visible");
    const menuOuvert = document.getElementById("menu-berger").classList.contains("ouvert");
    if (enCours || !rafraichisseurVueActive() || modaleOuverte || menuOuvert || window.scrollY > 0) {
      depart = null;
      return;
    }
    depart = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (depart === null || enCours) return;
    if (window.scrollY > 0) { reinitialiser(); return; }
    const brut = e.touches[0].clientY - depart;
    if (brut <= 0) { reinitialiser(); return; }
    distance = Math.min(brut * 0.5, SEUIL * 1.4);
    indicateur.classList.add("visible");
    indicateur.classList.toggle("pret", distance >= SEUIL);
    indicateur.style.transform = `translate(-50%, ${distance - 60}px)`;
  }, { passive: true });

  document.addEventListener("touchend", async () => {
    if (depart === null || enCours) { reinitialiser(); return; }
    const declenche = distance >= SEUIL;
    const fn = rafraichisseurVueActive();
    depart = null;
    if (!declenche || !fn) { reinitialiser(); return; }
    enCours = true;
    indicateur.classList.add("chargement");
    indicateur.style.transform = `translate(-50%, ${SEUIL - 60}px)`;
    try {
      await fn();
    } catch (err) { /* la vue affiche déjà son propre état d'erreur le cas échéant */ }
    enCours = false;
    indicateur.classList.remove("chargement");
    reinitialiser();
  });
}

function updateHeaderAndProfileAvatar() {
  const badge = document.getElementById("identite-badge");
  const headerAvatar = document.getElementById("header-user-avatar");
  const profileAvatar = document.getElementById("profil-avatar");
  
  if (!IDENTITE.authenticated) return;
  
  // Set badge name
  let displayName = IDENTITE.type === "super" ? "Super-admin" : IDENTITE.nom;
  
  // Check if there are saved extra info for nom_complet
  const extraInfos = JSON.parse(localStorage.getItem(`profil_extra_${IDENTITE.username}`) || "{}");
  if (extraInfos.nom_complet) {
    displayName = extraInfos.nom_complet;
  }
  
  if (badge) badge.textContent = displayName;
  
  // Initials
  const initials = (displayName || "?").charAt(0).toUpperCase();
  
  // Avatar image
  const storedAvatar = localStorage.getItem(`profil_avatar_${IDENTITE.username}`);
  if (storedAvatar) {
    const imgHtml = `<img src="${storedAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    if (headerAvatar) headerAvatar.innerHTML = imgHtml;
    if (profileAvatar) profileAvatar.innerHTML = imgHtml;
  } else {
    if (headerAvatar) {
      headerAvatar.innerHTML = "";
      headerAvatar.textContent = initials;
    }
    if (profileAvatar) {
      profileAvatar.innerHTML = "";
      profileAvatar.textContent = initials;
    }
    
    // Fallback to chorale logo if active
    if (IDENTITE.type === "chorale") {
      api("/parametres").then(params => {
        if (params && params.logo_gauche_media_id && !localStorage.getItem(`profil_avatar_${IDENTITE.username}`)) {
          const imgHtml = `<img src="/parametres/image/logo_gauche?t=${Date.now()}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
          if (headerAvatar) headerAvatar.innerHTML = imgHtml;
          if (profileAvatar) profileAvatar.innerHTML = imgHtml;
        }
      }).catch(err => {});
    }
  }
}

// --- init ---
async function init() {
  const debutChargement = Date.now();

  try {
    const [identiteRes, metaRes] = await Promise.all([
      api("/auth/status"),
      api("/meta")
    ]);
    IDENTITE = identiteRes;
    const meta = metaRes;

    updateHeaderAndProfileAvatar();

    document.getElementById("nav-admin").classList.toggle("hidden", IDENTITE.type !== "super");
    document.getElementById("nav-statistiques").classList.toggle("hidden", IDENTITE.type !== "super");
    if (IDENTITE.type === "super") {
      // Le super-admin n'a pas d'espace chorale : ces vues (composition,
      // dépliants, réglages) supposent toutes une chorale connectée.
      ["composer", "depliants", "reglages"].forEach((v) => {
        document.querySelector(`.nav-btn[data-view="${v}"]`).classList.add("hidden");
      });
    }

    MOMENTS = meta.moments;
    CATEGORIES = meta.categories;
    peuplerSelectsCategories();
    initBibliothequeControles();

    if (IDENTITE.type === "super") {
      // Le super-admin n'a pas d'espace chorale (pas de dépliants/réglages
      // propres) : atterrit directement sur l'administration plutôt que sur
      // la bibliothèque, qui reste néanmoins consultable pour la modération.
      await Promise.all([
        actualiserBadgeMessagerie().catch(e => console.error("Badge error:", e)),
        actualiserListeBibliotheque().catch(e => console.error("Library error:", e)),
        actualiserAdmin().catch(e => console.error("Admin error:", e))
      ]);
      changerVue("admin");
    } else {
      initComposer();
      document.getElementById("composer-result").innerHTML = indiceComposerHtml();
      
      const promises = [
        actualiserBadgeMessagerie().catch(e => console.error("Badge error:", e)),
        actualiserListeBibliotheque().catch(e => console.error("Library error:", e)),
        actualiserEditeur().catch(e => console.error("Editor error:", e)),
        api("/parametres").catch(e => {
          console.error("Params error:", e);
          return { chorale: "DepliantApp" };
        })
      ];
      
      const [_, __, ___, params] = await Promise.all(promises);
      document.getElementById("app-title").textContent = params.chorale || "DepliantApp";
    }

    // Initialisation à partir du hash courant ou de la bibliothèque par défaut
    gererNavigationHash();
    initTirerPourRafraichir();

  } catch (err) {
    console.error("Critical initialization failure:", err);
  } finally {
    const tempsRestant = 150 - (Date.now() - debutChargement);
    setTimeout(masquerSplash, Math.max(0, tempsRestant));
  }
}

init();
