"""Détection de doublons probables entre chants (titres/refrains proches),
robuste aux inversions de mots, variations de ponctuation, et sous-titres.
Combine difflib.SequenceMatcher, Token Sort Ratio et Token Set Ratio."""
import re
import unicodedata
from difflib import SequenceMatcher
from typing import Optional

from ..db import get_connection


def _normalise(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode("ascii").lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return " ".join(text.split())


def _calculer_similarite(cible: str, cand: str) -> float:
    if not cible or not cand:
        return 0.0
    if cible == cand:
        return 1.0

    # 1. Ratio classique caractère par caractère
    seq_ratio = SequenceMatcher(None, cible, cand).ratio()

    # 2. Token Sort Ratio (résiste aux inversions de mots)
    tokens_cible = sorted(cible.split())
    tokens_cand = sorted(cand.split())
    cible_sorted = " ".join(tokens_cible)
    cand_sorted = " ".join(tokens_cand)
    sort_ratio = SequenceMatcher(None, cible_sorted, cand_sorted).ratio()

    # 3. Token Set Ratio (résiste aux mots supplémentaires comme "ô", "du Christ", etc.)
    set_cible = set(tokens_cible)
    set_cand = set(tokens_cand)
    if set_cible and set_cand:
        intersection = set_cible & set_cand
        diff_cible = set_cible - set_cand
        diff_cand = set_cand - set_cible

        sorted_inter = " ".join(sorted(intersection))
        sorted_inter_cible = " ".join(sorted(intersection | diff_cible))
        sorted_inter_cand = " ".join(sorted(intersection | diff_cand))

        if sorted_inter:
            r1 = SequenceMatcher(None, sorted_inter, sorted_inter_cible).ratio()
            r2 = SequenceMatcher(None, sorted_inter, sorted_inter_cand).ratio()
            r3 = SequenceMatcher(None, sorted_inter_cible, sorted_inter_cand).ratio()
            set_ratio = max(r1, r2, r3)
        else:
            set_ratio = 0.0
    else:
        set_ratio = 0.0

    # 4. Bonus sous-chaîne complète si le titre est suffisamment long
    inclusion_ratio = 0.0
    min_len = min(len(cible), len(cand))
    max_len = max(len(cible), len(cand))
    if min_len >= 8 and (cible in cand or cand in cible):
        inclusion_ratio = min_len / max_len

    return max(seq_ratio, sort_ratio, set_ratio, inclusion_ratio)


def find_duplicates(
    titre: str,
    exclude_id: Optional[int] = None,
    seuil: float = 0.72,
    limite: int = 5,
    candidates: Optional[list[dict]] = None,
) -> list[dict]:
    cible = _normalise(titre)
    if not cible:
        return []

    if candidates is None:
        with get_connection() as conn:
            rows = conn.execute("SELECT id, titre FROM chants").fetchall()
        candidates = [{"id": r["id"], "titre": r["titre"]} for r in rows]

    resultats = []
    for row in candidates:
        if exclude_id is not None and row["id"] == exclude_id:
            continue
        cand = _normalise(row["titre"])
        if not cand:
            continue

        sim = _calculer_similarite(cible, cand)
        if sim >= seuil:
            resultats.append({"id": row["id"], "titre": row["titre"], "similarite": round(sim, 2)})

    resultats.sort(key=lambda r: r["similarite"], reverse=True)
    return resultats[:limite]
