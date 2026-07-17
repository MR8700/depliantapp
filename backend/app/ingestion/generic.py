"""Dispatcher générique d'ingestion : accepte n'importe quel carnet/fichier de
chants (.doc, .docx, .pdf) et choisit automatiquement la meilleure stratégie de
segmentation. Utilisé à la fois par l'import initial (import_chants.py) et par
l'upload depuis l'interface (routers/import_.py)."""
import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

from .common import RawChant, segment_paragraphs
from .parse_doc import iter_paragraphs_doc
from .parse_docx import iter_paragraphs_docx
from .parse_notre_modele import segment_notre_modele
from .parse_pdf import segment_by_font, segment_pdf_paragraphs, detect_pdf_strategy

SUPPORTED_EXTENSIONS = {".doc", ".docx", ".pdf"}


def _detect_real_format(path: Path) -> str:
    """Détecte le format réel du fichier par sa signature binaire plutôt que
    par son extension déclarée : très fréquent qu'un ancien fichier .doc
    (format binaire OLE2) soit nommé/renommé en .docx (ou l'inverse), ce qui
    provoque sinon une erreur cryptique côté zipfile/XML ('no item named
    word/document.xml') au lieu d'être simplement pris en charge."""
    with open(path, "rb") as f:
        tete = f.read(8)
    if tete.startswith(b"PK\x03\x04"):
        return ".docx"
    if tete.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return ".doc"
    if tete.startswith(b"%PDF"):
        return ".pdf"
    return path.suffix.lower()


_TAILLE_CARNET_IMPLAUSIBLE = 500


def _qualite(resultats: list[tuple[str, RawChant]]) -> float:
    """Nombre d'entrées jugées fiables (confiance >= 0.7) — sert à comparer
    plusieurs stratégies de segmentation PDF et choisir la meilleure
    automatiquement.

    Ni un compte brut, ni une simple moyenne ne suffisent seuls : un compte
    brut est gagné à tort par une stratégie qui fragmente le document en
    centaines de mini-entrées (aucun carnet réel n'atteint plusieurs
    centaines de chants) — même une faible fraction de faux positifs parmi
    un très grand nombre d'entrées peut alors dépasser en compte absolu une
    segmentation bien plus juste mais moins nombreuse. À l'inverse, une
    simple moyenne favorise à tort une stratégie qui n'extrait presque rien
    (quelques chants bien reconnus, tout le reste silencieusement perdu) au
    détriment d'une segmentation qui couvre effectivement tout le document.
    On garde donc le compte brut tant que la taille du résultat reste
    plausible pour un carnet réel, et on ne pénalise QUE le cas clairement
    aberrant (fragmentation massive)."""
    n = len(resultats)
    confiants = sum(1 for _, raw in resultats if raw.confiance >= 0.7)
    if n > _TAILLE_CARNET_IMPLAUSIBLE:
        return confiants / n
    return float(confiants)


def _appliquer_defaut(resultats: list[tuple[str, RawChant]], categorie_defaut: str) -> list[tuple[str, RawChant]]:
    return [(cat if cat and cat != "Autre" else categorie_defaut, raw) for cat, raw in resultats]


@contextmanager
def _chemin_avec_bonne_extension(path: Path, suffix_attendu: str):
    """Word (COM) refuse d'ouvrir un fichier si son extension déclarée ne
    correspond pas à son contenu réel, même quand on sait déjà que le
    contenu est bien un .doc classique — il faut donc lui présenter une
    copie temporaire portant la bonne extension plutôt que le fichier
    original mal nommé."""
    if path.suffix.lower() == suffix_attendu:
        yield path
        return
    with tempfile.TemporaryDirectory() as tmp:
        chemin_corrige = Path(tmp) / (path.stem + suffix_attendu)
        shutil.copy(path, chemin_corrige)
        yield chemin_corrige


def parse_and_segment(path: Path, categorie_defaut: str = "Autre", word=None) -> list[tuple[str, RawChant]]:
    """Retourne une liste de (categorie, chant brut) pour n'importe quel fichier supporté."""
    suffix = path.suffix.lower()
    format_reel = _detect_real_format(path)
    if format_reel != suffix and format_reel in SUPPORTED_EXTENSIONS:
        suffix = format_reel

    if suffix == ".docx":
        with _chemin_avec_bonne_extension(path, ".docx") as chemin:
            paragraphs = iter_paragraphs_docx(chemin)
        return [(raw.categorie_detectee or categorie_defaut, raw) for raw in segment_paragraphs(paragraphs, is_clean_paragraphs=True)]

    if suffix == ".doc":
        with _chemin_avec_bonne_extension(path, ".doc") as chemin:
            paragraphs = iter_paragraphs_doc(chemin, word=word)
        return [(raw.categorie_detectee or categorie_defaut, raw) for raw in segment_paragraphs(paragraphs, is_clean_paragraphs=True)]

    if suffix == ".pdf":
        strat = detect_pdf_strategy(path)
        if strat == "notre_modele":
            notre_modele = segment_notre_modele(path)
            if notre_modele:
                return _appliquer_defaut(notre_modele, categorie_defaut)

        if strat == "font_based":
            try:
                font_res = segment_by_font(path)
                if font_res:
                    return _appliquer_defaut(font_res, categorie_defaut)
            except Exception:
                pass

        # Stratégie générique par défaut
        return _appliquer_defaut(segment_pdf_paragraphs(path), categorie_defaut)

    raise ValueError(f"Format non supporté : {suffix} (formats acceptés : .doc, .docx, .pdf)")
