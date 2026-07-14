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


def find_duplicates(titre: str, exclude_id: int = None, seuil: float = 0.72, limite: int = 5, candidates: list[dict] = None) -> list[dict]:
    cible = _normalise(titre)
    if not cible:
        return []
    
    if candidates is None:
        with get_connection() as conn:
            rows = conn.execute("SELECT id, titre FROM chants").fetchall()
        candidates = [{"id": r["id"], "titre": r["titre"]} for r in rows]

    l_cible = len(cible)
    resultats = []
    for row in candidates:
        if exclude_id is not None and row["id"] == exclude_id:
            continue
        cand = _normalise(row["titre"])
        l_cand = len(cand)
        if not cand:
            continue
        
        # Pruning rapide sur le ratio théorique maximal de similarité par longueur
        if (l_cible + l_cand) > 0:
            max_ratio = 2.0 * min(l_cible, l_cand) / (l_cible + l_cand)
            if max_ratio < seuil:
                continue
                
        ratio = SequenceMatcher(None, cible, cand).ratio()
        if ratio >= seuil:
            resultats.append({"id": row["id"], "titre": row["titre"], "similarite": round(ratio, 2)})

    resultats.sort(key=lambda r: r["similarite"], reverse=True)
    return resultats[:limite]
