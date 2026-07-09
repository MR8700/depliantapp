import re
from pathlib import Path
from typing import Optional

import fitz

from .common import REF_RE, VERSE_RE, TITRE_LONGUEUR_SUSPECTE, RawChant, finalize, split_inline_verses

CARNET_TITLE_RE = re.compile(r"^([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ]{3,20})\s*(\d{1,3})\s*[:.\-]\s*(.+)$")
SECTION_HEADER_RE = re.compile(r"^[A-Z]\.\s*([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ ]{3,30})$")

# Mot-clé de section (tel qu'il apparaît dans les carnets, sans accent) -> catégorie interne
CARNET_CATEGORY_MAP = {
    "ENTREE": "Entree",
    "KYRIE": "Kyrie",
    "GLORIA": "Gloria",
    "PSAUME": "Psaume",
    "ACCLAMATION": "Acclamation",
    "CREDO": "Credo",
    "PRIERE UNIVERSELLE": "Priere_universelle",
    "OFFERTOIRE": "Offertoire",
    "SANCTUS": "Sanctus",
    "ANAMNESE": "Anamnese",
    "NOTRE PERE": "Notre_Pere",
    "PATER": "Notre_Pere",
    "AGNUS": "Agnus",
    "COMMUNION": "Communion",
    "ACTION DE GRACE": "Action_de_grace",
    "SORTIE": "Sortie",
}


def extract_text_pages(path: Path) -> list[str]:
    doc = fitz.open(path)
    try:
        return [page.get_text() for page in doc]
    finally:
        doc.close()


def segment_carnet_pages(pages: list[str]) -> list[tuple[str, RawChant]]:
    lines = [line.strip() for page in pages for line in page.split("\n") if line.strip()]

    results: list[tuple[str, RawChant]] = []
    current: Optional[RawChant] = None
    current_categorie: Optional[str] = None
    active: Optional[str] = None

    def flush():
        nonlocal current
        if current is not None:
            results.append((current_categorie or "Autre", finalize(current)))
        current = None

    for line in lines:
        section_m = SECTION_HEADER_RE.match(line)
        title_m = CARNET_TITLE_RE.match(line)
        ref_m = REF_RE.match(line)
        verse_m = VERSE_RE.match(line)

        if section_m:
            current_categorie = CARNET_CATEGORY_MAP.get(section_m.group(1).strip()) or current_categorie
            active = None
            continue

        if title_m:
            flush()
            cat_word = title_m.group(1).strip()
            current_categorie = CARNET_CATEGORY_MAP.get(cat_word, current_categorie)
            current = RawChant(titre=title_m.group(3).strip())
            active = "titre"
            continue

        if ref_m:
            if current is None:
                current = RawChant(titre="(sans titre)")
            text = ref_m.group(2).strip()
            current.refrain = f"{current.refrain} {text}".strip() if current.refrain else text
            active = "refrain"
            continue

        if verse_m:
            if current is None:
                current = RawChant(titre="(sans titre)")
            current.couplets.extend(split_inline_verses(line))
            active = "couplet"
            continue

        if current is None or active is None:
            continue
        if active == "titre":
            current.titre = f"{current.titre} {line}".strip()
        elif active == "refrain":
            current.refrain = f"{current.refrain} {line}".strip()
        elif active == "couplet" and current.couplets:
            current.couplets[-1] = f"{current.couplets[-1]} {line}".strip()

    flush()
    return results


def segment_freeform_pdf(pages: list[str]) -> list[tuple[str, RawChant]]:
    """Repli pour les carnets qui n'utilisent pas l'en-tête 'CATEGORIE N : Titre'
    (ex. CHANT CHORALE.pdf) : mêmes règles que segment_carnet_pages, mais la limite
    entre deux chants est détectée génériquement (ligne non-ref/non-couplet qui suit
    un chant déjà rempli), comme pour les fichiers .doc/.docx sans préfixe."""
    lines = [line.strip() for page in pages for line in page.split("\n") if line.strip()]

    results: list[tuple[str, RawChant]] = []
    current: Optional[RawChant] = None
    active: Optional[str] = None

    def flush():
        nonlocal current
        if current is not None:
            results.append(("Autre", finalize(current)))
        current = None

    for line in lines:
        ref_m = REF_RE.match(line)
        verse_m = VERSE_RE.match(line)

        if not ref_m and not verse_m and current is not None and (
            current.refrain or current.couplets or len(current.titre) > TITRE_LONGUEUR_SUSPECTE
        ):
            flush()

        if ref_m:
            if current is None:
                current = RawChant(titre="(sans titre)")
            text = ref_m.group(2).strip()
            current.refrain = f"{current.refrain} {text}".strip() if current.refrain else text
            active = "refrain"
            continue

        if verse_m:
            if current is None:
                current = RawChant(titre="(sans titre)")
            current.couplets.extend(split_inline_verses(line))
            active = "couplet"
            continue

        if current is None:
            current = RawChant(titre=line)
            active = "titre"
            continue

        if active == "titre":
            current.titre = f"{current.titre} {line}".strip()
        elif active == "refrain":
            current.refrain = f"{current.refrain} {line}".strip()
        elif active == "couplet" and current.couplets:
            current.couplets[-1] = f"{current.couplets[-1]} {line}".strip()

    flush()
    return results


def segment_pdf_auto(pages: list[str]) -> list[tuple[str, RawChant]]:
    """Essaie d'abord le format 'CATEGORIE N : Titre' (gros carnets structurés) ;
    si trop peu de chants en ressortent, retombe sur la segmentation générique."""
    structured = segment_carnet_pages(pages)
    if len(structured) >= 10:
        return structured
    return segment_freeform_pdf(pages)


def segment_by_font(path: Path, title_min_size: float = 17.0) -> list[tuple[str, RawChant]]:
    """Segmentation pour les carnets sans numérotation ni en-tête de catégorie
    (ex. CHANT CHORALE.pdf), où seule la mise en forme distingue titre / refrain / couplet :
    titre = grande taille, refrain = gras, couplet = texte normal (numéroté ou non)."""
    doc = fitz.open(path)
    try:
        results: list[tuple[str, RawChant]] = []
        current: Optional[RawChant] = None
        active: Optional[str] = None

        def flush():
            nonlocal current
            if current is not None:
                results.append(("Autre", finalize(current)))
            current = None

        for page in doc:
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    spans = line.get("spans", [])
                    text = "".join(s["text"] for s in spans).strip()
                    if not text:
                        continue
                    max_size = max((s["size"] for s in spans), default=0)
                    is_bold = any(s["flags"] & 16 or "Bold" in s.get("font", "") for s in spans)

                    if max_size >= title_min_size:
                        flush()
                        current = RawChant(titre=text)
                        active = "titre"
                        continue

                    if current is None:
                        current = RawChant(titre="(sans titre)")

                    if is_bold:
                        current.refrain = f"{current.refrain} {text}".strip() if current.refrain else text
                        active = "refrain"
                        continue

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
