"""Détection de doublons probables entre chants (titres/refrains proches),
utile quand on importe un nouveau carnet qui recouvre en partie la bibliothèque
existante. Similarité texte via difflib (stdlib) — pas besoin d'embeddings pour
comparer quelques milliers de titres courts."""
import unicodedata
from difflib import SequenceMatcher

from ..db import get_connection


def _normalise(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode("ascii").lower()
    return " ".join(text.split())


def find_duplicates(titre: str, exclude_id: int = None, seuil: float = 0.72, limite: int = 5) -> list[dict]:
    cible = _normalise(titre)
    if not cible:
        return []
    with get_connection() as conn:
        rows = conn.execute("SELECT id, titre FROM chants").fetchall()

    resultats = []
    for row in rows:
        if exclude_id is not None and row["id"] == exclude_id:
            continue
        ratio = SequenceMatcher(None, cible, _normalise(row["titre"])).ratio()
        if ratio >= seuil:
            resultats.append({"id": row["id"], "titre": row["titre"], "similarite": round(ratio, 2)})

    resultats.sort(key=lambda r: r["similarite"], reverse=True)
    return resultats[:limite]
