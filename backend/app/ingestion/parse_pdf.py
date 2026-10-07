from __future__ import annotations

import re
from collections import Counter
from pathlib import Path
from typing import Optional, Any

try:
    import fitz
except (ImportError, Exception):
    fitz = None

from .common import (
    RawChant, VERSE_RE, REF_RE, DIALOGUE_RE, BULLET_RE,
    finalize, normaliser, segment_paragraphs, split_inline_verses,
    SECTION_KEYWORDS, _match_section_header, _SECTION_MOMENTS_MAP
)

_NUMERO_PAGE_RE = re.compile(r"^\d{1,4}$")
# Ligne de sommaire à points de suite ("ENTREE.......................... 02")
# — jamais du contenu de chant, à exclure entièrement plutôt que de risquer
# qu'elle se glisse dans un couplet/refrain.
_LIGNE_SOMMAIRE_RE = re.compile(r"\.{3,}\s*\d*\s*$")

# Fraction de la largeur de page en dessous de laquelle une ligne est
# considérée "étroite" (donc représentative d'une vraie colonne) plutôt
# qu'un en-tête/pied de page pleine largeur (ex. "CHORALE SAINT AUGUSTIN"
# répété sur chaque page) qui fausserait sinon la détection des colonnes.
_LARGEUR_ETROITE_RATIO = 0.55
# Écart minimal (fraction de la largeur de page) entre deux bords gauches
# consécutifs pour le considérer comme une vraie séparation de colonnes,
# plutôt qu'une simple variation d'indentation à l'intérieur d'une colonne.
_SEUIL_COLONNE_RATIO = 0.08
# Un saut vertical supérieur à ce multiple de la hauteur de ligne courante
# marque une vraie coupure de paragraphe (ligne suivante = nouveau chant/
# nouveau bloc) plutôt qu'un simple retour à la ligne d'une phrase qui continue.
_SEUIL_SAUT_PARAGRAPHE = 1.6


def _colonnes_frontieres(lignes: list[tuple[float, float, float, float, str]], largeur_page: float) -> list[float]:
    """Déduit les frontières verticales séparant les colonnes réelles d'une
    page en regroupant les bords GAUCHES des lignes ÉTROITES (un bloc pleine
    largeur comme un en-tête ne doit pas fausser la détection). On ne se fie
    volontairement qu'aux bords gauches, pas à un intervalle [x0, x1] fusionné
    de proche en proche : une seule ligne un peu plus longue que la normale
    suffirait sinon à faire fusionner en chaîne deux colonnes pourtant bien
    distinctes. De nombreux carnets sont en A4/Lettre PORTRAIT à 2 colonnes,
    pas systématiquement 4 comme le supposait l'ancienne heuristique
    'largeur > 600 => 4 colonnes', qui découpait alors arbitrairement au
    milieu de paragraphes normaux sur n'importe quelle page assez large (dont
    une simple page Lettre US, déjà large de 612pt à elle seule)."""
    etroites = [l for l in lignes if (l[2] - l[0]) < largeur_page * _LARGEUR_ETROITE_RATIO]
    if len(etroites) < 3:
        return []
    x0s = sorted(l[0] for l in etroites)
    seuil = largeur_page * _SEUIL_COLONNE_RATIO
    return [(x0s[i - 1] + x0s[i]) / 2 for i in range(1, len(x0s)) if x0s[i] - x0s[i - 1] > seuil]


def _assigner_colonnes(lignes: list[tuple[float, float, float, float, str]], largeur_page: float) -> list[list]:
    """Affecte chaque ligne à une colonne d'après son bord GAUCHE (x0), pas
    son centre : dans du texte aligné à gauche, deux lignes d'une même
    colonne partagent le même x0 mais peuvent avoir une largeur très
    différente (un court dernier mot de couplet vs. une ligne pleine), donc
    des CENTRES très différents — les classer par centre les éclaterait à
    tort dans des colonnes différentes alors qu'elles partagent le même x0
    que _colonnes_frontieres a utilisé pour définir ces frontières."""
    frontieres = _colonnes_frontieres(lignes, largeur_page)
    colonnes: list[list] = [[] for _ in range(len(frontieres) + 1)]
    for ligne in lignes:
        x0 = ligne[0]
        idx = sum(1 for f in frontieres if x0 > f)
        colonnes[idx].append(ligne)
    return colonnes


def _lignes_page(page: fitz.Page) -> list[tuple[float, float, float, float, str]]:
    """Une entrée par ligne visuelle (niveau le plus fin de get_text('dict')),
    pas par bloc PyMuPDF : sur un même document, PyMuPDF regroupe tantôt tout
    un chant en un seul bloc, tantôt une seule ligne par bloc, selon
    l'espacement — trop irrégulier pour s'y fier. On reconstruit nous-mêmes
    les paragraphes ensuite à partir des coordonnées (voir _regrouper)."""
    lignes = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            texte = "".join(s["text"] for s in spans).strip()
            if not texte:
                continue
            x0, y0, x1, y1 = line["bbox"]
            lignes.append((x0, y0, x1, y1, texte))
    return lignes


def _regrouper(lignes_colonne: list[tuple[float, float, float, float, str]]) -> list[str]:
    """Reconstruit des paragraphes à partir de lignes visuelles triées
    verticalement : un petit saut vertical (retour à la ligne d'une phrase
    qui continue) rejoint le paragraphe courant, un grand saut (ligne vide
    dans le PDF d'origine) en démarre un nouveau."""
    paragraphes: list[str] = []
    courant: list[str] = []
    dernier_y1: Optional[float] = None
    dernier_h: float = 0.0
    for x0, y0, x1, y1, texte in lignes_colonne:
        hauteur = max(y1 - y0, 1.0)
        if dernier_y1 is not None and (y0 - dernier_y1) > max(dernier_h, hauteur) * _SEUIL_SAUT_PARAGRAPHE:
            if courant:
                paragraphes.append(" ".join(courant))
            courant = []
        courant.append(texte)
        dernier_y1 = y1
        dernier_h = hauteur
    if courant:
        paragraphes.append(" ".join(courant))
    return paragraphes


# Fraction de la hauteur de page, depuis le haut/le bas, où un en-tête/pied
# de page peut physiquement se trouver. Restreindre la DÉTECTION à cette
# marge (plutôt que chercher un texte répété n'importe où sur la page) évite
# qu'un mot ou une courte formule qui revient par coïncidence dans plusieurs
# chants du carnet (ex. un mot de refrain fréquent) ne soit pris à tort pour
# un en-tête et supprimé partout dans le document.
_MARGE_ENTETE_PIED_RATIO = 0.1


def _entetes_pieds_de_page(
    pages: list[tuple[float, float, list[tuple[float, float, float, float, str]]]]
) -> set[str]:
    """Détecte les en-têtes/pieds de page répétés sur (presque) chaque page
    d'un carnet (ex. 'CHORALE SAINT AUGUSTIN ... PAROISSE DE POUYTENGA')
    pour les exclure : sinon ce texte, réinjecté à chaque page au milieu du
    flux d'une colonne, se glisse comme un faux couplet/refrain en plein
    milieu d'un chant. Seules les lignes situées dans la marge haute/basse de
    la page sont candidates (voir _MARGE_ENTETE_PIED_RATIO)."""
    n_pages = len(pages)
    if n_pages < 3:
        return set()
    compteur: Counter[str] = Counter()
    for _largeur, hauteur, lignes in pages:
        marge = hauteur * _MARGE_ENTETE_PIED_RATIO
        vus = set()
        for _x0, y0, _x1, y1, texte in lignes:
            if y0 > marge and y1 < hauteur - marge:
                continue
            cle = normaliser(texte)
            if cle and cle not in vus:
                compteur[cle] += 1
                vus.add(cle)
    seuil_repetition = max(4, int(n_pages * 0.2))
    return {cle for cle, n in compteur.items() if n >= seuil_repetition and len(cle) < 80}


def extract_paragraphs_pdf(path: Path) -> list[str]:
    """Extrait les paragraphes d'un PDF dans l'ordre de lecture réel, colonne
    par colonne (nombre de colonnes détecté dynamiquement page par page, pas
    figé à 4) puis page par page — reproduit ainsi l'ordre 'colonne 1 de haut
    en bas, puis colonne 2, puis page suivante colonne 1...' des livrets
    pliés, quel que soit leur nombre réel de colonnes (1, 2 ou 4)."""
    if fitz is None:
        raise RuntimeError("PyMuPDF (fitz) n'est pas disponible dans cet environnement.")
    doc = fitz.open(path)
    try:
        pages = [(page.rect.width, page.rect.height, _lignes_page(page)) for page in doc]
    finally:
        doc.close()

    entetes_pieds = _entetes_pieds_de_page(pages)

    paragraphes: list[str] = []
    for largeur_page, _hauteur, lignes in pages:
        lignes_utiles = [
            l for l in lignes
            if normaliser(l[4]) not in entetes_pieds
            and not _NUMERO_PAGE_RE.match(l[4].strip())
            and not _LIGNE_SOMMAIRE_RE.search(l[4].strip())
        ]
        if not lignes_utiles:
            continue
        for colonne in _assigner_colonnes(lignes_utiles, largeur_page):
            colonne.sort(key=lambda l: l[1])
            paragraphes.extend(_regrouper(colonne))
    return paragraphes


def segment_pdf_paragraphs(path: Path) -> list[tuple[str, RawChant]]:
    """Segmentation générique d'un PDF quelconque : extraction en paragraphes
    dans le bon ordre de lecture, puis même moteur multi-indices à score de
    confiance que les carnets .doc/.docx (common.segment_paragraphs)."""
    paragraphes = extract_paragraphs_pdf(path)
    return [
        (chant.categorie_detectee or "Autre", chant)
        for chant in segment_paragraphs(paragraphes)
    ]


def segment_by_font(path: Path, title_min_size: float = 17.0) -> list[tuple[str, RawChant]]:
    """Segmentation intelligente des carnets PDF par hiérarchie typographique
    (titre = grande taille/gras, refrain = gras, couplet = texte normal numéroté ou non),
    avec prise en compte des sections liturgiques (Entrée, Kyrie, Gloria, etc.).
    """
    if fitz is None:
        return []
    doc = fitz.open(path)
    try:
        # 1. Analyse préalable de la distribution des tailles de police pour calibrer le seuil
        sizes_counter: Counter[float] = Counter()
        for p_idx in range(min(len(doc), 30)):
            for block in doc[p_idx].get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    for s in line.get("spans", []):
                        t = s.get("text", "").strip()
                        if t and len(t) > 2:
                            sizes_counter[round(s.get("size", 0.0), 1)] += 1

        body_size = 14.0
        if sizes_counter:
            body_size = sizes_counter.most_common(1)[0][0]

        # Détermination dynamique du seuil de titre
        if body_size <= 12.0:
            title_threshold = body_size + 2.0
        elif body_size <= 15.0:
            title_threshold = 19.0
        else:
            title_threshold = max(19.5, body_size + 1.5)

        results: list[tuple[str, RawChant]] = []
        current: Optional[RawChant] = None
        active: Optional[str] = None
        current_section: str = "Autre"

        def is_title_line(size: float, is_bold: bool, text: str) -> bool:
            if VERSE_RE.match(text):
                return False
            if REF_RE.match(text):
                return False
            if DIALOGUE_RE.match(text):
                return False
            if BULLET_RE.match(text):
                return False
            if re.search(r"\(\s*(?:bis|ter|\d+\s*fois)\s*\)\s*$", text, re.I):
                return False
            if re.search(r"\.{3,}", text):
                return False
            if len(text) > 90:
                return False
            if size >= title_threshold and is_bold:
                return True
            if size >= max(21.5, title_threshold + 1.0):
                return True
            return False

        def flush():
            nonlocal current
            if current is not None:
                has_content = bool(current.refrain or current.couplets)
                if has_content or (current.titre and current.titre not in ("(sans titre)", "Sans titre")):
                    final = finalize(current)
                    cat = final.categorie_detectee or current_section
                    if not final.categorie_detectee and current_section != "Autre":
                        final.categorie_detectee = current_section
                    results.append((cat, final))
            current = None

        for page in doc:
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    spans = line.get("spans", [])
                    text = "".join(s["text"] for s in spans).strip()
                    if not text:
                        continue
                    if _NUMERO_PAGE_RE.match(text) or _LIGNE_SOMMAIRE_RE.search(text):
                        continue

                    max_size = max((s["size"] for s in spans), default=0)
                    is_bold = any(s.get("flags", 0) & 16 or "Bold" in s.get("font", "") for s in spans)

                    # 1. Vérification si la ligne est un en-tête de section liturgique
                    sec = _match_section_header(text)
                    if sec and (max_size >= title_threshold or (is_bold and len(text) < 30) or max_size >= 18.0):
                        if current and not current.refrain and not current.couplets:
                            current = None
                        else:
                            flush()
                        current_section = sec
                        current = RawChant(titre=text.capitalize(), categorie_detectee=sec)
                        active = "titre"
                        continue

                    # 2. Vérification si c'est un titre de chant
                    if is_title_line(max_size, is_bold, text):
                        if current and not current.refrain and not current.couplets:
                            current.titre = f"{current.titre} {text}".strip()
                        else:
                            flush()
                            current = RawChant(titre=text, categorie_detectee=current_section)
                        active = "titre"
                        continue

                    if current is None:
                        current = RawChant(titre="(sans titre)", categorie_detectee=current_section)

                    # 3. Refrain explicite ou en gras
                    ref_m = REF_RE.match(text)
                    if is_bold or ref_m:
                        ref_text = ref_m.group(2).strip() if ref_m and ref_m.group(2) else text
                        if ref_text:
                            current.refrain = f"{current.refrain} {ref_text}".strip() if current.refrain else ref_text
                        active = "refrain"
                        continue

                    # 4. Couplets / versets
                    verse_m = VERSE_RE.match(text)
                    if verse_m or active != "couplet" or not current.couplets:
                        current.couplets.extend(split_inline_verses(text))
                    else:
                        current.couplets[-1] = f"{current.couplets[-1]} {text}".strip()
                    active = "couplet"

        flush()
        return results
    finally:
        doc.close()


def detect_pdf_strategy(path: Path) -> str:
    """Parcourt de manière avancée et ultra-rapide le début, le milieu et la fin
    du document PDF pour détecter le meilleur parseur à appliquer.
    Retourne: 'notre_modele' | 'font_based' | 'generic'
    """
    if fitz is None:
        return "generic"
    doc = fitz.open(path)
    try:
        n = doc.page_count
        if n == 0:
            return "generic"
        
        check_pages = [0]
        if n > 2:
            check_pages.append(n // 2)
        if n > 1:
            check_pages.append(n - 1)
            
        # 1. Test 'notre_modele' (A4 Paysage, max 2 pages, et mots-clés de section liturgique)
        is_landscape_a4 = True
        for p_idx in check_pages:
            p = doc[p_idx]
            # ReportLab landscape A4 = 841.89 x 595.27 points
            if abs(p.rect.width - 841.89) > 10.0 or abs(p.rect.height - 595.27) > 10.0:
                is_landscape_a4 = False
                break
                
        if is_landscape_a4 and n <= 2:
            sections_found = 0
            for p_idx in check_pages:
                for block in doc[p_idx].get_text("dict")["blocks"]:
                    for line in block.get("lines", []):
                        spans = line.get("spans", [])
                        text = "".join(s["text"] for s in spans).strip()
                        tout_gras = bool(spans) and all("Bold" in s.get("font", "") for s in spans)
                        if tout_gras and text.upper() == text and text in SECTION_KEYWORDS:
                            sections_found += 1
            if sections_found >= 1: # Si au moins une section liturgique typique est trouvée
                return "notre_modele"
                
        # 2. Test 'font_based' (Titre en police >= 17pt)
        has_large_fonts = False
        for p_idx in check_pages:
            for block in doc[p_idx].get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    spans = line.get("spans", [])
                    for s in spans:
                        if s.get("size", 0) >= 17.0:
                            has_large_fonts = True
                            break
                    if has_large_fonts:
                        break
                if has_large_fonts:
                    break
                    
        if has_large_fonts:
            return "font_based"
            
        return "generic"
    except Exception:
        return "generic"


_MARQUEUR_PREFIXE = "DEPLIANTAPP-CHANTS-V1:"


def detecter_marqueur_reimport(path) -> list[int]:
    """Cherche le marqueur de réimport embarqué dans les métadonnées du
    document (mot-clé "Keywords") par render/pdf.py::_dessiner_marqueur_
    reimport -- jamais dans le contenu d'une page, pour ne structurellement
    jamais pouvoir interférer avec l'extraction de texte (segment_notre_
    modele en dépend pour reconstruire les chants).

    Renvoie la liste ordonnée des chant_id du feuillet d'ORIGINE si trouvé,
    sinon []. Ne remplace JAMAIS l'analyse structurelle de segment_notre_
    modele (qui reconstruit le contenu depuis le PDF lui-même et fonctionne
    même si ces chant_id ne référencent plus rien) -- sert seulement à
    transformer une correspondance de titre FLOUE (find_duplicates,
    similarité texte) en correspondance EXACTE quand elle est disponible
    (voir routers/import_.py::upload_carnet). Si le chant d'origine a depuis
    été supprimé de la base, l'id ne matchera simplement plus rien lors de la
    résolution -- pas d'erreur, juste un repli silencieux sur le
    rapprochement flou habituel."""
    if fitz is None:
        return []
    try:
        doc = fitz.open(path)
    except Exception:
        return []
    try:
        mots_cles = (doc.metadata or {}).get("keywords") or ""
        idx = mots_cles.find(_MARQUEUR_PREFIXE)
        if idx == -1:
            return []
        brut = mots_cles[idx + len(_MARQUEUR_PREFIXE):]
        ids = []
        for morceau in brut.split(","):
            morceau = morceau.strip()
            if morceau.isdigit():
                ids.append(int(morceau))
        return ids
    finally:
        doc.close()


