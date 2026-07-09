"""Import ponctuel de C:\\dev\\Projet_IA\\CHANTS\\ dans chants.db.

Usage (depuis backend/):
    python -m app.ingestion.import_chants
"""
import sys
from pathlib import Path

import win32com.client

from .. import crud, schemas
from ..db import init_db
from .parse_doc import iter_paragraphs_doc
from .parse_docx import iter_paragraphs_docx
from .parse_pdf import extract_text_pages, segment_by_font, segment_pdf_auto
from .common import segment_paragraphs, RawChant

DEFAULT_CHANTS_DIR = Path(r"C:\dev\Projet_IA\CHANTS")

# fichier -> (categorie par défaut, occasions additionnelles)
CATEGORY_FILE_MAP = {
    "ACCLAMATION.doc": ("Acclamation", []),
    "Action de grace.docx": ("Action_de_grace", []),
    "AGNUS.doc": ("Agnus", []),
    "Anamnèse.doc": ("Anamnese", []),
    "Avent.doc": ("Avent", ["Avent"]),
    "BAPTEME ET CONFIRMATION.docx": ("Bapteme_Confirmation", []),
    "Careme.doc": ("Careme", ["Careme"]),
    "Chants de Paques.doc": ("Paques", ["Paques"]),
    "Chants Mariaux.doc": ("Marial", []),
    "Communion.doc": ("Communion", []),
    "CREDO.doc": ("Credo", []),
    "DEFUNTS.docx": ("Defunts", []),
    "ENTREE TEMPS ORDINAIRE.doc": ("Entree", []),
    "GLORIA.docx": ("Gloria", []),
    "graduels.doc": ("Psaume", []),
    "KYRIE.doc": ("Kyrie", []),
    "Mariage et animation.docx": ("Mariage", []),
    "Mariage.doc": ("Mariage", []),
    "DADA MARIAGE.docx": ("Mariage", []),
    "Noel.doc": ("Noel", ["Noel"]),
    "OFFERTOIRE.doc": ("Offertoire", []),
    "Paix.doc": ("Autre", ["Paix"]),
    "PASSION.docx": ("Careme", ["Passion"]),
    "Pater.doc": ("Notre_Pere", []),
    "PRIERES UNIVERSELLES.doc": ("Priere_universelle", []),
    "Prières avant et après communion.docx": ("Communion", []),
    "Réf.docx": ("Autre", []),
    "SANCTUS.doc": ("Sanctus", []),
    "SORTIE.docx": ("Sortie", []),
}

SKIP_FILES = {"Cliparts.docx"}

# Carnets structurés en "CATEGORIE N : Titre" (segment_pdf_auto s'en sort bien).
STRUCTURED_CARNETS = {
    "CARNET DE CHANT-1(1)(2).pdf",
    "CARNET NEW VERSION-2-1.pdf",
}

# Carnets sans numérotation : seule la mise en forme (taille/gras) distingue les chants.
# Le seuil de confiance est plus strict ici car ces carnets contiennent des sections
# (psaumes, mariage...) où la mise en forme casse l'heuristique et produit des fragments.
FONT_BASED_CARNETS = {
    "CHANT CHORALE.pdf",
    "chant pour les enfants.pdf",
}
FONT_BASED_MIN_CONFIANCE = 0.7

# Carnet au calque texte corrompu (mots collés sans espaces) : illisible par extraction
# automatique, quel que soit l'algorithme de segmentation. À reprendre manuellement.
UNUSABLE_TEXT_LAYER = {"CHORALE1.pdf"}


def _store(
    raw: RawChant,
    categorie: str,
    occasions: list[str],
    source_file: str,
    report: list[dict],
    min_confiance: float = 0.0,
) -> None:
    if raw.confiance < min_confiance:
        return
    chant = schemas.ChantCreate(
        titre=raw.titre or "(sans titre)",
        categorie=categorie,
        refrain=raw.refrain,
        couplets=raw.couplets,
        code_reference=raw.code_reference,
        occasions=occasions,
    )
    saved = crud.create_chant(chant, source_file=source_file, confiance=raw.confiance)
    if raw.confiance < 0.7:
        report.append({
            "id": saved.id,
            "titre": saved.titre,
            "source_file": source_file,
            "confiance": raw.confiance,
        })


def import_all(chants_dir: Path = DEFAULT_CHANTS_DIR) -> list[dict]:
    init_db()
    report: list[dict] = []
    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    try:
        for path in sorted(chants_dir.iterdir()):
            name = path.name
            if name in SKIP_FILES or name in UNUSABLE_TEXT_LAYER or path.is_dir():
                continue

            if name in STRUCTURED_CARNETS:
                pages = extract_text_pages(path)
                for categorie, raw in segment_pdf_auto(pages):
                    _store(raw, categorie, [], name, report)
                continue

            if name in FONT_BASED_CARNETS:
                for categorie, raw in segment_by_font(path):
                    _store(raw, categorie, [], name, report, min_confiance=FONT_BASED_MIN_CONFIANCE)
                continue

            if name not in CATEGORY_FILE_MAP:
                print(f"[avertissement] fichier non reconnu, ignoré : {name}", file=sys.stderr)
                continue

            categorie, occasions = CATEGORY_FILE_MAP[name]
            if path.suffix.lower() == ".docx":
                paragraphs = iter_paragraphs_docx(path)
            elif path.suffix.lower() == ".doc":
                paragraphs = iter_paragraphs_doc(path, word=word)
            else:
                continue

            for raw in segment_paragraphs(paragraphs):
                _store(raw, categorie, occasions, name, report)
    finally:
        word.Quit()

    return report


if __name__ == "__main__":
    low_confidence = import_all()
    total = len(crud.list_chants(limit=100000))

    report_lines = [
        f"Import terminé : {total} chants en base.",
        f"{len(low_confidence)} chants à confiance faible (<0.7) à relire :",
    ]
    for entry in low_confidence:
        report_lines.append(
            f"  #{entry['id']:>5}  [{entry['confiance']:.1f}]  {entry['source_file']:<45}  {entry['titre']}"
        )

    report_path = Path(__file__).resolve().parent.parent.parent / "data" / "rapport_import.txt"
    report_path.write_text("\n".join(report_lines), encoding="utf-8")

    # stdout : pas d'accents pour éviter un crash sur les consoles non-UTF-8
    print(f"Import termine : {total} chants en base.")
    print(f"{len(low_confidence)} chants a confiance faible (<0.7) a relire.")
    print(f"Rapport detaille : {report_path}")
