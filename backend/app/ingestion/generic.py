"""Dispatcher générique d'ingestion : accepte n'importe quel carnet/fichier de
chants (.doc, .docx, .pdf) et choisit automatiquement la meilleure stratégie de
segmentation. Utilisé à la fois par l'import initial (import_chants.py) et par
l'upload depuis l'interface (routers/import_.py)."""
from pathlib import Path
from typing import Optional

from .common import RawChant, segment_paragraphs
from .parse_doc import iter_paragraphs_doc
from .parse_docx import iter_paragraphs_docx
from .parse_notre_modele import segment_notre_modele
from .parse_pdf import extract_text_pages, segment_by_font, segment_carnet_pages, segment_freeform_pdf, segment_booklet_layout

SUPPORTED_EXTENSIONS = {".doc", ".docx", ".pdf"}


def _qualite(resultats: list[tuple[str, RawChant]]) -> int:
    """Nombre d'entrées jugées fiables (confiance >= 0.7) — sert à comparer
    plusieurs stratégies de segmentation PDF et choisir la meilleure automatiquement."""
    return sum(1 for _, raw in resultats if raw.confiance >= 0.7)


def _appliquer_defaut(resultats: list[tuple[str, RawChant]], categorie_defaut: str) -> list[tuple[str, RawChant]]:
    return [(cat if cat and cat != "Autre" else categorie_defaut, raw) for cat, raw in resultats]


def parse_and_segment(path: Path, categorie_defaut: str = "Autre", word=None) -> list[tuple[str, RawChant]]:
    """Retourne une liste de (categorie, chant brut) pour n'importe quel fichier supporté."""
    suffix = path.suffix.lower()

    if suffix == ".docx":
        paragraphs = iter_paragraphs_docx(path)
        return [(categorie_defaut, raw) for raw in segment_paragraphs(paragraphs)]

    if suffix == ".doc":
        paragraphs = iter_paragraphs_doc(path, word=word)
        return [(categorie_defaut, raw) for raw in segment_paragraphs(paragraphs)]

    if suffix == ".pdf":
        notre_modele = segment_notre_modele(path)
        if notre_modele:
            return _appliquer_defaut(notre_modele, categorie_defaut)

        pages = extract_text_pages(path)
        candidats = [segment_carnet_pages(pages)]
        try:
            candidats.append(segment_by_font(path))
        except Exception:
            pass
        candidats.append(segment_freeform_pdf(pages))
        candidats.append(segment_booklet_layout(pages))
        meilleur = max(candidats, key=_qualite)
        return _appliquer_defaut(meilleur, categorie_defaut)

    raise ValueError(f"Format non supporté : {suffix} (formats acceptés : .doc, .docx, .pdf)")
