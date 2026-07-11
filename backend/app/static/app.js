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

let MOMENTS = [];
let CATEGORIES = [];
const momentsState = {}; // moment -> { type, chant_id, chant_titre, titre_libre, texte_libre, total_couplets, couplet_limit, refrain, couplets }
let pickerTargetMoment = null;
let searchTimer = null;
let feuilletCourantId = null;
let apercuTimer = null;
let importWorkspaceChants = [];

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
document.getElementById("btn-deconnexion").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST" });
  window.location.href = "/login.html";
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
}

function changerVue(nomVue) {
  window.location.hash = "#/" + nomVue;
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    changerVue(btn.dataset.view);
    fermerMenu();
  });
});

function verifierModalesOuvertes() {
  const ceOuvert = !document.getElementById("chant-editor").classList.contains("hidden");
  const iwOuvert = !document.getElementById("import-workspace-modal").classList.contains("hidden");
  return ceOuvert || iwOuvert;
}

function gererNavigationHash() {
  if (bloqueNavigation) return;
  const hash = window.location.hash || "#/bibliotheque";
  const nomVue = hash.replace("#/", "");
  
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
  const editeurOuvert = !document.getElementById("chant-editor").classList.contains("hidden");
  const pickerOuvert = !document.getElementById("chant-picker").classList.contains("hidden");
  const detailOuvert = !document.getElementById("chant-detail-modal").classList.contains("hidden");
  const workspaceOuvert = !document.getElementById("import-workspace-modal").classList.contains("hidden");
  document.body.classList.toggle("no-scroll", editeurOuvert || pickerOuvert || detailOuvert || workspaceOuvert);
}
["chant-editor", "chant-picker", "chant-detail-modal", "import-workspace-modal"].forEach((id) => {
  new MutationObserver(syncModalLock).observe(document.getElementById(id), {
    attributes: true, attributeFilter: ["class"],
  });
});

function ouvrirModale(id) {
  document.getElementById(id).classList.remove("hidden");
}
function fermerModale(id) {
  document.getElementById(id).classList.add("hidden");
}

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

// --- Bibliothèque ---
function chantCardHtml(chant) {
  const badge = chant.confiance < 0.7 ? `<span class="badge-confiance">à vérifier</span>` : "";
  const refrainApercu = chant.refrain ? chant.refrain.slice(0, 60) : (chant.couplets[0] || "").slice(0, 60);
  return `
    <li class="chant-item" data-id="${chant.id}">
      <div class="chant-titre">
        <span class="chant-categorie-pill">${categorieLabel(chant.categorie)}</span>
        ${escapeHtml(chant.titre || "(sans titre)")}${badge}
      </div>
      <div class="chant-meta">${escapeHtml(refrainApercu)}</div>
    </li>`;
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

async function rechercherChants(q, categorie) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (categorie) params.set("categorie", categorie);
  params.set("limit", "50");
  return api(`/chants?${params.toString()}`);
}

document.getElementById("search-q").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(actualiserListeBibliotheque, 300);
});
document.getElementById("search-categorie").addEventListener("change", actualiserListeBibliotheque);

async function actualiserListeBibliotheque() {
  const q = document.getElementById("search-q").value.trim();
  const categorie = document.getElementById("search-categorie").value;
  const chants = await rechercherChants(q, categorie);
  const list = document.getElementById("chant-list");

  if (chants.length === 0) {
    if (q) {
      list.innerHTML = etatVideHtml("🔍", `Aucun résultat pour « ${escapeHtml(q)} »`,
        "Essaie un autre mot, vérifie l'orthographe, ou élargis la catégorie.");
    } else if (categorie) {
      list.innerHTML = etatVideHtml("📭", `Aucun chant dans « ${categorieLabel(categorie)} »`,
        "Choisis une autre catégorie, ou importe/ajoute des chants pour celle-ci.");
    } else {
      list.innerHTML = etatVideHtml("🎵", "Ta bibliothèque est vide",
        "Importe un carnet de chants ou ajoute un chant depuis l'Éditeur pour commencer.");
    }
    return;
  }

  list.innerHTML = chants.map(chantCardHtml).join("");
  list.querySelectorAll(".chant-item").forEach((el) => {
    el.addEventListener("click", () => ouvrirEditeurChant(Number(el.dataset.id)));
  });
}

// --- Composer ---
function momentRowHtml(moment, index) {
  const label = LABELS_MOMENTS[moment] || moment;
  return `
    <div class="moment-row" data-moment="${moment}">
      <span class="moment-label">${label}</span>
      <label class="moment-ordre">Ordre <input type="number" class="moment-ordre-input" value="${index * 10}" step="1"></label>
      <select class="moment-type">
        <option value="aucun">— Aucun —</option>
        <option value="chant">Chant de la bibliothèque</option>
        <option value="texte_libre">Texte libre</option>
      </select>
      <div class="moment-body"></div>
    </div>`;
}

function specialRowHtml(id, state) {
  return `
    <div class="moment-row special-row" data-moment="${id}">
      <input type="text" class="special-label" placeholder="Nom (ex : Chant additionnel)" value="${escapeHtml(state.label || "")}">
      <label class="moment-ordre">Ordre <input type="number" class="moment-ordre-input" value="${state.ordre}" step="1"></label>
      <select class="moment-type">
        <option value="aucun">— Aucun —</option>
        <option value="chant">Chant de la bibliothèque</option>
        <option value="texte_libre">Texte libre</option>
      </select>
      <button type="button" class="btn-effacer btn-supprimer-special">Supprimer</button>
      <div class="moment-body"></div>
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
  bindSpecialRow(row, id);
  row.querySelector(".moment-type").value = state.type;
  renderMomentBody(row, id);
  return row;
}

function bindSpecialRow(row, id) {
  const select = row.querySelector(".moment-type");
  select.addEventListener("change", () => {
    momentsState[id] = { ...momentsState[id], type: select.value };
    renderMomentBody(row, id);
    regenererApercuSiPossible();
  });
  row.querySelector(".moment-ordre-input").addEventListener("input", (e) => {
    momentsState[id].ordre = Number(e.target.value) || 0;
    regenererApercuSiPossible();
  });
  row.querySelector(".special-label").addEventListener("input", (e) => {
    momentsState[id].label = e.target.value;
    regenererApercuSiPossible();
  });
  row.querySelector(".btn-supprimer-special").addEventListener("click", () => {
    delete momentsState[id];
    row.remove();
    regenererApercuSiPossible();
  });
}

document.getElementById("btn-ajouter-special").addEventListener("click", () => ajouterChantSpecial());

function viderChantsSpeciaux() {
  document.getElementById("chants-speciaux-container").innerHTML = "";
  Object.keys(momentsState).forEach((k) => { if (k.startsWith("special-")) delete momentsState[k]; });
}

function renderMomentBody(row, moment) {
  const state = momentsState[moment] || { type: "aucun" };
  const body = row.querySelector(".moment-body");
  if (state.type === "chant") {
    const total = state.total_couplets || 0;
    const limiteHtml = total > 0 ? `
      <label class="couplet-limite">Couplets à afficher
        <select class="select-couplet-limite">
          <option value="">Tous (${total})</option>
          <option value="0" ${state.couplet_limit === 0 ? "selected" : ""}>Aucun (0)</option>
          ${Array.from({ length: total }, (_, i) => i + 1).map((n) => `
            <option value="${n}" ${state.couplet_limit === n ? "selected" : ""}>${n}</option>
          `).join("")}
        </select>
      </label>` : "";
    body.innerHTML = `
      <button type="button" class="btn-choisir">Choisir un chant</button>
      ${state.chant_titre ? `<div class="chant-choisi">${escapeHtml(state.chant_titre)} <button type="button" class="btn-effacer">retirer</button></div>` : ""}
      ${limiteHtml}
    `;
    body.querySelector(".btn-choisir").addEventListener("click", () => ouvrirPicker(moment));
    const btnEffacer = body.querySelector(".btn-effacer");
    if (btnEffacer) btnEffacer.addEventListener("click", () => {
      delete momentsState[moment].chant_id;
      delete momentsState[moment].chant_titre;
      delete momentsState[moment].refrain;
      delete momentsState[moment].couplets;
      renderMomentBody(row, moment);
      regenererApercuSiPossible();
    });
    const selectLimite = body.querySelector(".select-couplet-limite");
    if (selectLimite) selectLimite.addEventListener("change", () => {
      momentsState[moment].couplet_limit = selectLimite.value ? Number(selectLimite.value) : null;
      regenererApercuSiPossible();
    });
  } else if (state.type === "texte_libre") {
    body.innerHTML = `
      <input type="text" class="titre-libre" placeholder="Titre (optionnel)" value="${escapeHtml(state.titre_libre || "")}">
      <textarea class="texte-libre" rows="3" placeholder="Texte pour ce feuillet…">${escapeHtml(state.texte_libre || "")}</textarea>
    `;
    body.querySelector(".titre-libre").addEventListener("input", (e) => {
      momentsState[moment].titre_libre = e.target.value;
      regenererApercuSiPossible();
    });
    body.querySelector(".texte-libre").addEventListener("input", (e) => {
      momentsState[moment].texte_libre = e.target.value;
      regenererApercuSiPossible();
    });
  } else {
    body.innerHTML = "";
  }
}

function initComposer() {
  const container = document.getElementById("moments-container");
  container.innerHTML = MOMENTS.map((m, i) => momentRowHtml(m, i)).join("");
  container.querySelectorAll(".moment-row").forEach((row) => {
    const moment = row.dataset.moment;
    momentsState[moment] = { type: "aucun", ordre: Number(row.querySelector(".moment-ordre-input").value) };
    const select = row.querySelector(".moment-type");
    select.addEventListener("change", () => {
      momentsState[moment] = { ...momentsState[moment], type: select.value };
      renderMomentBody(row, moment);
      regenererApercuSiPossible();
    });
    row.querySelector(".moment-ordre-input").addEventListener("input", (e) => {
      momentsState[moment].ordre = Number(e.target.value) || 0;
      regenererApercuSiPossible();
    });
  });

  ["f-date", "f-lieu", "f-lecture1", "f-psaume", "f-lecture2", "f-evangile"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => {
      regenererApercuSiPossible();
    });
  });
  document.getElementById("f-priere-active").addEventListener("change", () => {
    regenererApercuSiPossible();
  });
  document.getElementById("f-priere-texte").addEventListener("input", () => {
    regenererApercuSiPossible();
  });
}

function ouvrirPicker(moment) {
  pickerTargetMoment = moment;
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
    el.addEventListener("click", () => {
      const id = Number(el.dataset.id);
      const chant = chants.find((c) => c.id === id);
      ouvrirDetailChant(chant);
    });
  });
}

// --- Détail d'un chant avant ajout au feuillet (Composer) ---
let chantDetailCourant = null;

function ouvrirDetailChant(chant) {
  chantDetailCourant = chant;
  document.getElementById("cd-categorie").textContent = categorieLabel(chant.categorie);
  document.getElementById("cd-titre").textContent = chant.titre || "(sans titre)";
  const refrainHtml = chant.refrain
    ? `<p class="chant-detail-refrain"><b>Réf :</b> ${escapeHtml(chant.refrain)}</p>` : "";
  const coupletsHtml = (chant.couplets || [])
    .map((c, i) => `<p class="chant-detail-couplet"><b>${i + 1}.</b> ${escapeHtml(c)}</p>`)
    .join("");
  document.getElementById("cd-corps").innerHTML = refrainHtml + coupletsHtml
    || `<p class="hint">Aucune parole enregistrée pour ce chant.</p>`;
  ouvrirModale("chant-detail-modal");
}

document.getElementById("cd-btn-annuler").addEventListener("click", () => {
  fermerModale("chant-detail-modal");
});

document.getElementById("cd-btn-modifier").addEventListener("click", () => {
  if (!chantDetailCourant) return;
  const id = chantDetailCourant.id;
  fermerModale("chant-detail-modal");
  fermerModale("chant-picker");
  changerVue("editeur");
  ouvrirEditeurChant(id);
});

document.getElementById("cd-btn-ajouter").addEventListener("click", () => {
  if (!chantDetailCourant || !pickerTargetMoment) return;
  const chant = chantDetailCourant;
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
    
    const blobUrl = URL.createObjectURL(await res.blob());
    resultDiv.innerHTML = `
      <div class="toolbar">
        <a href="${blobUrl}" target="_blank" class="btn-ouvrir">Ouvrir le PDF</a>
        <a href="${blobUrl}" download="feuillet-${feuilletId}.pdf" class="btn-enregistrer">Enregistrer le PDF</a>
        <button type="button" id="btn-partager-composer" class="btn-partager">Partager</button>
      </div>
      <iframe class="pdf-preview" src="${blobUrl}" title="Aperçu du feuillet"></iframe>
    `;
    document.getElementById("btn-partager-composer").addEventListener("click", () => partagerPdf(feuilletId));
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

async function regenererApercuSiPossible() {
  if (!feuilletCourantId) return;
  clearTimeout(apercuTimer);
  apercuTimer = setTimeout(async () => {
    try {
      await api(`/feuillets/${feuilletCourantId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(construireFeuilletPayload()),
      });
      await afficherResultatFeuillet(feuilletCourantId);
    } catch (err) { }
  }, 400);
}

document.getElementById("feuillet-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = construireFeuilletPayload();
  const resultDiv = document.getElementById("composer-result");
  resultDiv.textContent = "Génération en cours…";
  afficherSplashGeneration();
  try {
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
    await afficherResultatFeuillet(feuillet.id);
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

async function chargerParametres() {
  const params = await api("/parametres");
  document.getElementById("p-chorale").value = params.chorale || "";
  document.getElementById("p-paroisse").value = params.paroisse || "";
  document.getElementById("p-contact").value = params.contact || "";
  document.getElementById("p-annonce").value = params.annonce || "";
  initImageSlots(params);
}

function initImageSlots(params) {
  const container = document.getElementById("image-slots");
  if (!container.dataset.init) {
    container.innerHTML = Object.entries(IMAGE_SLOTS).map(([slot, label]) => `
      <div class="image-slot" data-slot="${slot}">
        <p><b>${label}</b></p>
        <img class="logo-preview hidden" alt="${label}">
        <p class="slot-status hint"></p>
        <label>Choisir une image <input type="file" accept="image/*" class="slot-fichier"></label>
        <div class="toolbar">
          <button type="button" class="slot-upload">Enregistrer</button>
          <button type="button" class="slot-supprimer btn-effacer">Supprimer</button>
        </div>
      </div>`).join("");
    container.dataset.init = "1";

    container.querySelectorAll(".image-slot").forEach((el) => {
      const slot = el.dataset.slot;
      el.querySelector(".slot-upload").addEventListener("click", async () => {
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
          const res = await fetch(`/parametres/image/${slot}`, { method: "POST", body: formData });
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          afficherImageSlot(slot, data[`${slot}_filename`]);
          input.value = "";
        } catch (err) {
          statusEl.textContent = `Erreur : ${err.message}`;
        }
      });
      el.querySelector(".slot-supprimer").addEventListener("click", async () => {
        await api(`/parametres/image/${slot}`, { method: "DELETE" });
        afficherImageSlot(slot, null);
      });
    });
  }

  Object.keys(IMAGE_SLOTS).forEach((slot) => afficherImageSlot(slot, params[`${slot}_filename`]));
}

function afficherImageSlot(slot, filename) {
  const el = document.querySelector(`.image-slot[data-slot="${slot}"]`);
  if (!el) return;
  const img = el.querySelector(".logo-preview");
  const statusEl = el.querySelector(".slot-status");
  if (filename) {
    img.src = `/parametres/image/${slot}?t=${Date.now()}`;
    img.classList.remove("hidden");
    statusEl.textContent = "Utilisée sur tous les prochains feuillets.";
  } else {
    img.classList.add("hidden");
    statusEl.textContent = "Aucune image définie.";
  }
}

document.getElementById("parametres-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("parametres-status");
  try {
    await api("/parametres", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chorale: document.getElementById("p-chorale").value,
        paroisse: document.getElementById("p-paroisse").value,
        contact: document.getElementById("p-contact").value,
        annonce: document.getElementById("p-annonce").value,
      }),
    });
    statusEl.textContent = "Enregistré.";
    document.getElementById("app-title").textContent = document.getElementById("p-chorale").value || "DepliantApp";
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

function editeurItemHtml(chant) {
  const badge = chant.confiance < 0.7 ? `<span class="badge-confiance">confiance ${chant.confiance.toFixed(1)}</span>` : "";
  const refrainApercu = chant.refrain ? chant.refrain.slice(0, 60) : (chant.couplets[0] || "").slice(0, 60);
  return `
    <li>
      <div class="editeur-row">
        <input type="checkbox" class="chant-checkbox" data-id="${chant.id}" ${selectionEditeur.has(chant.id) ? "checked" : ""}>
        <div class="chant-item" data-id="${chant.id}">
          <div class="chant-titre">
            <span class="chant-categorie-pill">${categorieLabel(chant.categorie)}</span>
            ${escapeHtml(chant.titre || "(sans titre)")}${badge}
          </div>
          <div class="chant-meta">${escapeHtml(refrainApercu)}</div>
        </div>
      </div>
    </li>`;
}

async function actualiserEditeur() {
  const q = document.getElementById("edit-q").value.trim();
  const filtre = document.getElementById("edit-filtre").value;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (filtre === "a-verifier") params.set("confiance_max", "0.7");
  params.set("limit", "200");
  const chants = await api(`/chants?${params.toString()}`);
  const list = document.getElementById("editeur-list");
  if (chants.length === 0) {
    if (q) {
      list.innerHTML = etatVideHtml("🔍", `Aucun résultat pour « ${escapeHtml(q)} »`, "Essaie un autre mot.");
    } else if (filtre === "a-verifier") {
      list.innerHTML = etatVideHtml("✅", "Rien à vérifier !", "Tous les chants de ta bibliothèque sont validés.");
    } else {
      list.innerHTML = etatVideHtml("🎵", "Ta bibliothèque est vide",
        "Importe un carnet de chants ou clique sur « + Ajouter un chant ».");
    }
  } else {
    list.innerHTML = chants.map(editeurItemHtml).join("");
  }
  idsAffichesEditeur = chants.map((c) => c.id);

  list.querySelectorAll(".chant-checkbox").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = Number(cb.dataset.id);
      if (cb.checked) selectionEditeur.add(id); else selectionEditeur.delete(id);
      majBulkBar();
      majSelectAllEtat();
    });
  });
  list.querySelectorAll(".chant-item").forEach((el) => {
    el.addEventListener("click", () => ouvrirEditeurChant(Number(el.dataset.id)));
  });
  majSelectAllEtat();
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
  document.querySelectorAll("#editeur-list .chant-checkbox").forEach((cb) => {
    cb.checked = selectionEditeur.has(Number(cb.dataset.id));
  });
  majBulkBar();
});

document.getElementById("edit-q").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(actualiserEditeur, 300);
});
document.getElementById("edit-filtre").addEventListener("change", actualiserEditeur);

document.getElementById("bulk-appliquer").addEventListener("click", async () => {
  const categorie = document.getElementById("bulk-categorie").value;
  await api("/chants/bulk_categorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [...selectionEditeur], categorie }),
  });
  selectionEditeur.clear();
  majBulkBar();
  await actualiserEditeur();
});

document.getElementById("bulk-supprimer").addEventListener("click", async () => {
  if (!confirm(`Supprimer ${selectionEditeur.size} chant(s) sélectionné(s) ?`)) return;
  await api("/chants/bulk_delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [...selectionEditeur] }),
  });
  selectionEditeur.clear();
  majBulkBar();
  await actualiserEditeur();
});

function renderCoupletsFields(couplets) {
  const container = document.getElementById("ce-couplets-container");
  container.innerHTML = "";
  (couplets && couplets.length ? couplets : [""]).forEach((texte) => ajouterCoupletField(texte));
}

function ajouterCoupletField(texte) {
  const container = document.getElementById("ce-couplets-container");
  const row = document.createElement("div");
  row.className = "couplet-field-row";
  row.innerHTML = `
    <span class="couplet-numero"></span>
    <textarea rows="2"></textarea>
    <button type="button" class="btn-supprimer-couplet" title="Supprimer ce couplet">✕</button>
  `;
  row.querySelector("textarea").value = texte || "";
  row.querySelector(".btn-supprimer-couplet").addEventListener("click", () => {
    row.remove();
    numeroterCoupletsFields();
  });
  container.appendChild(row);
  numeroterCoupletsFields();
}

function numeroterCoupletsFields() {
  document.querySelectorAll("#ce-couplets-container .couplet-numero").forEach((el, i) => {
    el.textContent = i + 1;
  });
}

function getCoupletsFromFields() {
  return [...document.querySelectorAll("#ce-couplets-container textarea")]
    .map((t) => t.value.trim())
    .filter(Boolean);
}

document.getElementById("ce-ajouter-couplet").addEventListener("click", () => ajouterCoupletField(""));

async function ouvrirEditeurChant(id) {
  const chant = await api(`/chants/${id}`);
  document.getElementById("ce-id").value = chant.id;
  document.getElementById("ce-titre").value = chant.titre || "";
  document.getElementById("ce-categorie").value = chant.categorie;
  document.getElementById("ce-refrain").value = chant.refrain || "";
  renderCoupletsFields(chant.couplets);
  document.getElementById("ce-code").value = chant.code_reference || "";
  document.getElementById("ce-occasions").value = (chant.occasions || []).join(", ");
  document.getElementById("ce-supprimer").classList.remove("hidden");

  const suggestionEl = document.getElementById("ce-suggestion");
  suggestionEl.classList.add("hidden");
  try {
    const suggestion = await api(`/chants/${id}/suggestion`);
    if (suggestion && suggestion.categorie !== chant.categorie) {
      suggestionEl.classList.remove("hidden");
      suggestionEl.innerHTML = `Catégorie suggérée : <b>${categorieLabel(suggestion.categorie)}</b> (${Math.round(suggestion.score * 100)}%)
        <button type="button" id="ce-appliquer-suggestion">Appliquer</button>`;
      document.getElementById("ce-appliquer-suggestion").addEventListener("click", () => {
        document.getElementById("ce-categorie").value = suggestion.categorie;
        suggestionEl.classList.add("hidden");
      });
    }
  } catch (e) { }

  const doublonsEl = document.getElementById("ce-doublons");
  doublonsEl.classList.add("hidden");
  try {
    const doublons = await api(`/chants/${id}/doublons`);
    if (doublons.length > 0) {
      doublonsEl.classList.remove("hidden");
      doublonsEl.innerHTML = "Doublons possibles : " + doublons.map((d) => escapeHtml(d.titre)).join(", ");
    }
  } catch (e) { }

  ouvrirModale("chant-editor");
}

function ouvrirEditeurNouveauChant() {
  document.getElementById("ce-id").value = "";
  document.getElementById("ce-titre").value = "";
  document.getElementById("ce-categorie").value = CATEGORIES[0] || "";
  document.getElementById("ce-refrain").value = "";
  renderCoupletsFields([]);
  document.getElementById("ce-code").value = "";
  document.getElementById("ce-occasions").value = "";
  document.getElementById("ce-suggestion").classList.add("hidden");
  document.getElementById("ce-doublons").classList.add("hidden");
  document.getElementById("ce-supprimer").classList.add("hidden");
  ouvrirModale("chant-editor");
}

document.getElementById("btn-ajouter-chant").addEventListener("click", ouvrirEditeurNouveauChant);
document.getElementById("ce-fermer").addEventListener("click", () => {
  fermerModale("chant-editor");
});

document.getElementById("chant-editor-form").addEventListener("submit", async (e) => {
  e.preventDefault();
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

  const payload = {
    titre,
    categorie: document.getElementById("ce-categorie").value,
    refrain: refrain || null,
    couplets,
    code_reference: document.getElementById("ce-code").value || null,
    occasions: document.getElementById("ce-occasions").value.split(",").map((s) => s.trim()).filter(Boolean),
  };
  
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

document.getElementById("ce-supprimer").addEventListener("click", async () => {
  const id = document.getElementById("ce-id").value;
  if (!id) return;
  if (!confirm("Supprimer ce chant ?")) return;
  await api(`/chants/${id}`, { method: "DELETE" });
  fermerModale("chant-editor");
  await actualiserEditeur();
});

// --- Importer (Interactive Workspace) ---
document.getElementById("import-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const resultDiv = document.getElementById("import-result");
  const fichierInput = document.getElementById("import-fichier");
  if (!fichierInput.files.length) return;

  const formData = new FormData();
  formData.append("fichier", fichierInput.files[0]);
  formData.append("categorie_defaut", document.getElementById("import-categorie").value);
  formData.append("occasions", document.getElementById("import-occasions").value);

  resultDiv.textContent = "Analyse et découpage du fichier en cours…";
  try {
    const res = await fetch("/import/upload", { method: "POST", body: formData });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    
    resultDiv.textContent = "";
    fichierInput.value = ""; // reset
    
    afficherImportWorkspace(data.chants);
  } catch (err) {
    resultDiv.textContent = `Erreur : ${err.message}`;
  }
});

function afficherImportWorkspace(chants) {
  importWorkspaceChants = chants;
  const container = document.getElementById("import-workspace-container");
  
  if (!chants || chants.length === 0) {
    container.innerHTML = `<p class="hint">Aucun chant n'a été détecté dans ce document. Réessayez.</p>`;
    ouvrirModale("import-workspace-modal");
    return;
  }
  
  container.innerHTML = chants.map((c, index) => {
    const isDuplicate = c.doublons && c.doublons.length > 0;
    const badge = isDuplicate ? `<span class="iw-badge-duplicate">Doublon Détecté (${Math.round(c.doublons[0].similarite * 100)}%)</span>` : "";
    const defaultAction = isDuplicate ? "replace" : "save";
    const replaceOptions = isDuplicate
      ? c.doublons.map((d) => `<option value="${d.id}">Remplacer : ${escapeHtml(d.titre)} (sim. ${Math.round(d.similarite * 100)}%)</option>`).join("")
      : "";
      
    return `
      <div class="iw-card ${isDuplicate ? "duplicate-detected" : ""}" data-index="${index}">
        <div class="iw-card-header">
          <h4 style="margin:0; font-size:0.95rem; color:var(--bleu);">Chant #${index + 1}</h4>
          ${badge}
        </div>
        <div class="iw-fields" style="margin-top:10px;">
          <div>
            <label>Titre</label>
            <input type="text" class="iw-titre" value="${escapeHtml(c.titre)}">
          </div>
          <div style="margin-top:6px;">
            <label>Refrain</label>
            <textarea class="iw-refrain" rows="2">${escapeHtml(c.refrain)}</textarea>
          </div>
          <div style="margin-top:6px;">
            <label>Couplets (séparez les couplets par des lignes vides)</label>
            <textarea class="iw-couplets" rows="4">${escapeHtml(c.couplets.join("\n\n"))}</textarea>
          </div>
          <div style="margin-top:6px;">
            <label>Catégorie</label>
            <select class="iw-categorie">
              ${CATEGORIES.map((cat) => `<option value="${cat}" ${cat === c.categorie ? "selected" : ""}>${categorieLabel(cat)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="iw-action-selector" style="margin-top:10px;">
          <p>Importer en tant que :</p>
          <div class="iw-options">
            <label class="iw-option-label">
              <input type="radio" name="iw-action-${index}" value="save" ${defaultAction === "save" ? "checked" : ""}>
              Nouveau chant
            </label>
            <label class="iw-option-label">
              <input type="radio" name="iw-action-${index}" value="replace" ${defaultAction === "replace" ? "checked" : ""} ${!isDuplicate ? "disabled" : ""}>
              Remplacer le doublon
            </label>
            <label class="iw-option-label">
              <input type="radio" name="iw-action-${index}" value="ignore" ${defaultAction === "ignore" ? "checked" : ""}>
              Ignorer
            </label>
          </div>
          ${isDuplicate ? `
            <select class="iw-replace-select">
              ${replaceOptions}
            </select>
          ` : ""}
        </div>
      </div>
    `;
  }).join("");

  // Bind inputs on change
  container.querySelectorAll(".iw-card").forEach((card) => {
    const idx = Number(card.dataset.index);
    const item = importWorkspaceChants[idx];
    
    card.querySelector(".iw-titre").addEventListener("input", (e) => { item.titre = e.target.value; });
    card.querySelector(".iw-refrain").addEventListener("input", (e) => { item.refrain = e.target.value; });
    card.querySelector(".iw-couplets").addEventListener("input", (e) => {
      item.couplets = e.target.value.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    });
    card.querySelector(".iw-categorie").addEventListener("change", (e) => { item.categorie = e.target.value; });
  });

  ouvrirModale("import-workspace-modal");
}

document.getElementById("iw-btn-annuler").addEventListener("click", () => {
  if (confirm("Abandonner l'importation ? Toutes les modifications non enregistrées seront perdues.")) {
    fermerModale("import-workspace-modal");
  }
});

document.getElementById("iw-btn-confirmer").addEventListener("click", async () => {
  const container = document.getElementById("import-workspace-container");
  const cards = container.querySelectorAll(".iw-card");
  
  const payloadChants = importWorkspaceChants.map((item, index) => {
    const card = cards[index];
    const action = card.querySelector(`input[name="iw-action-${index}"]:checked`).value;
    const replaceSelect = card.querySelector(`.iw-replace-select`);
    const replace_id = replaceSelect ? Number(replaceSelect.value) : null;
    
    return {
      action,
      replace_id,
      titre: item.titre,
      refrain: item.refrain || null,
      couplets: item.couplets,
      code_reference: item.code_reference || null,
      categorie: item.categorie,
      occasions: item.occasions || [],
      confiance: item.confiance || 1.0
    };
  });
  
  try {
    const res = await api("/import/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chants: payloadChants }),
    });
    alert(`Importation finalisée : ${res.saved} ajoutés, ${res.replaced} remplacés, ${res.ignored} ignorés.`);
    fermerModale("import-workspace-modal");
    await actualiserListeBibliotheque();
    await actualiserEditeur();
  } catch (err) {
    alert("Erreur lors de la finalisation: " + err.message);
  }
});

// --- Réglages : entraînement du modèle ---
document.getElementById("btn-train").addEventListener("click", async () => {
  const statusEl = document.getElementById("train-status");
  statusEl.textContent = "Entraînement…";
  try {
    const res = await api("/ml/train", { method: "POST" });
    statusEl.textContent = `Modèle entraîné sur ${res.exemples} chants, ${res.categories.length} catégories.`;
  } catch (err) {
    statusEl.textContent = `Erreur : ${err.message}`;
  }
});

document.getElementById("btn-reset-bibliotheque").addEventListener("click", async () => {
  const statusEl = document.getElementById("reset-status");
  const confirmation = document.getElementById("reset-confirmation").value;
  if (confirmation !== "SUPPRIMER") {
    statusEl.textContent = "Tape exactement SUPPRIMER dans le champ pour confirmer.";
    return;
  }
  if (!confirm("Vraiment tout supprimer ? Cette action est irréversible.")) return;
  try {
    const res = await api(`/chants/all?confirmation=${encodeURIComponent(confirmation)}`, { method: "DELETE" });
    statusEl.textContent = `${res.deleted} chant(s) supprimé(s). Bibliothèque vide.`;
    document.getElementById("reset-confirmation").value = "";
    await actualiserListeBibliotheque();
    await actualiserEditeur();
  } catch (err) {
    statusEl.textContent = `Erreur : ${err.message}`;
  }
});

// --- Les dépliants ---
function depliantCardHtml(feuillet) {
  const sousTitre = feuillet.lieu ? `${escapeHtml(feuillet.date)} — ${escapeHtml(feuillet.lieu)}` : escapeHtml(feuillet.date);
  const pdfUrl = `/feuillets/${feuillet.id}/pdf`;
  return `
    <li class="depliant-card" data-id="${feuillet.id}">
      <div class="chant-titre">${sousTitre}</div>
      <div class="chant-meta">${feuillet.moments.length} moment(s) renseigné(s)</div>
      <div class="toolbar depliant-actions">
        <a href="${pdfUrl}" target="_blank" class="btn-ouvrir">Ouvrir</a>
        <a href="${pdfUrl}" download="feuillet-${feuillet.id}.pdf" class="btn-enregistrer">Enregistrer</a>
        <button type="button" class="btn-partager" data-action="partager">Partager</button>
        <button type="button" class="btn-modifier" data-action="modifier">Modifier</button>
        <button type="button" class="btn-effacer" data-action="supprimer">Supprimer</button>
      </div>
    </li>`;
}

async function actualiserDepliants() {
  const feuillets = await api("/feuillets");
  const list = document.getElementById("depliants-list");
  if (feuillets.length === 0) {
    list.innerHTML = etatVideHtml("📄", "Aucun feuillet créé pour l'instant",
      "Clique sur « + Nouveau feuillet » pour composer ton premier feuillet de messe.");
  } else {
    list.innerHTML = feuillets.map(depliantCardHtml).join("");
  }

  list.querySelectorAll(".depliant-card").forEach((el) => {
    const id = Number(el.dataset.id);
    el.querySelector('[data-action="partager"]').addEventListener("click", () => partagerPdf(id));
    el.querySelector('[data-action="modifier"]').addEventListener("click", () => modifierDepliant(id));
    el.querySelector('[data-action="supprimer"]').addEventListener("click", async () => {
      if (!confirm("Supprimer ce feuillet ?")) return;
      await api(`/feuillets/${id}`, { method: "DELETE" });
      await actualiserDepliants();
    });
  });
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
  document.getElementById("feuillet-form").reset();
  document.getElementById("composer-result").innerHTML = indiceComposerHtml();
  viderChantsSpeciaux();
  document.querySelectorAll("#moments-container .moment-row").forEach((row, i) => {
    const moment = row.dataset.moment;
    momentsState[moment] = { type: "aucun", ordre: i * 10 };
    row.querySelector(".moment-type").value = "aucun";
    row.querySelector(".moment-ordre-input").value = i * 10;
    renderMomentBody(row, moment);
  });
  changerVue("composer");
});

// --- Splash ---
function afficherSplashGeneration() {
  document.getElementById("splash-message").textContent = "Génération du feuillet…";
  document.getElementById("splash").classList.remove("hidden");
}

function masquerSplash() {
  document.getElementById("splash").classList.add("hidden");
}

// --- init ---
async function init() {
  const debutChargement = Date.now();
  const meta = await api("/meta");
  MOMENTS = meta.moments;
  CATEGORIES = meta.categories;

  const categorieOptionsAvecToutes = `<option value="">Toutes catégories</option>` +
    CATEGORIES.map((c) => `<option value="${c}">${categorieLabel(c)}</option>`).join("");
  document.getElementById("search-categorie").innerHTML = categorieOptionsAvecToutes;
  document.getElementById("picker-categorie").innerHTML = categorieOptionsAvecToutes;

  const categorieOptions = CATEGORIES.map((c) => `<option value="${c}">${categorieLabel(c)}</option>`).join("");
  document.getElementById("ce-categorie").innerHTML = categorieOptions;
  document.getElementById("bulk-categorie").innerHTML = categorieOptions;
  document.getElementById("import-categorie").innerHTML = categorieOptions;

  initComposer();
  document.getElementById("composer-result").innerHTML = indiceComposerHtml();
  await actualiserListeBibliotheque();
  await actualiserEditeur();
  const params = await api("/parametres");
  document.getElementById("app-title").textContent = params.chorale || "DepliantApp";
  document.getElementById("splash-titre").textContent = params.chorale || "DepliantApp";

  // Initialisation à partir du hash courant ou de la bibliothèque par défaut
  gererNavigationHash();

  const tempsRestant = 700 - (Date.now() - debutChargement);
  setTimeout(masquerSplash, Math.max(0, tempsRestant));
}

init();
