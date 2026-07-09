import json
import re
from typing import Optional

from . import schemas
from .db import get_connection
from .slugify import unique_slug


def _existing_slugs(conn, exclude_id: Optional[int] = None) -> set[str]:
    rows = conn.execute("SELECT id, slug FROM chants WHERE slug IS NOT NULL").fetchall()
    return {r["slug"] for r in rows if r["id"] != exclude_id}


def _fts_query(q: str) -> Optional[str]:
    """Transforme la saisie utilisateur en requête FTS5 : chaque mot devient un
    préfixe (ex. 'seign dieu' -> '"seign"* "dieu"*'), pour un rendu proche d'une
    recherche 'contient' tout en restant rapide sur un gros volume de paroles."""
    tokens = re.findall(r"\w+", q, re.UNICODE)
    if not tokens:
        return None
    return " ".join(f'"{t}"*' for t in tokens)


def _row_to_chant(row) -> schemas.Chant:
    return schemas.Chant(
        id=row["id"],
        slug=row["slug"],
        titre=row["titre"],
        categorie=row["categorie"],
        refrain=row["refrain"],
        couplets=json.loads(row["couplets"]),
        code_reference=row["code_reference"],
        langue=row["langue"],
        occasions=json.loads(row["occasions"]),
        source_file=row["source_file"],
        confiance=row["confiance"],
    )


def create_chant(chant: schemas.ChantCreate, source_file: Optional[str] = None, confiance: float = 1.0) -> schemas.Chant:
    with get_connection() as conn:
        slug = unique_slug(chant.titre, _existing_slugs(conn))
        cur = conn.execute(
            """
            INSERT INTO chants (titre, slug, categorie, refrain, couplets, code_reference, langue, occasions, source_file, confiance)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                chant.titre,
                slug,
                chant.categorie,
                chant.refrain,
                json.dumps(chant.couplets, ensure_ascii=False),
                chant.code_reference,
                chant.langue,
                json.dumps(chant.occasions, ensure_ascii=False),
                source_file,
                confiance,
            ),
        )
        row = conn.execute("SELECT * FROM chants WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _row_to_chant(row)


def get_chant(chant_id: int) -> Optional[schemas.Chant]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM chants WHERE id = ?", (chant_id,)).fetchone()
        return _row_to_chant(row) if row else None


def get_chant_by_reference(code_reference: str) -> Optional[schemas.Chant]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM chants WHERE code_reference = ?", (code_reference,)).fetchone()
        return _row_to_chant(row) if row else None


def get_chant_by_slug(slug: str) -> Optional[schemas.Chant]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM chants WHERE slug = ?", (slug,)).fetchone()
        return _row_to_chant(row) if row else None


def list_chants(
    q: Optional[str] = None,
    categorie: Optional[str] = None,
    occasion: Optional[str] = None,
    confiance_max: Optional[float] = None,
    limit: int = 100,
    offset: int = 0,
) -> list[schemas.Chant]:
    clauses = []
    params: list = []
    from_clause = "chants"
    fts_q = _fts_query(q) if q else None
    if fts_q:
        from_clause = "chants JOIN chants_fts ON chants.id = chants_fts.rowid"
        clauses.append("chants_fts MATCH ?")
        params.append(fts_q)
    if categorie:
        clauses.append("chants.categorie = ?")
        params.append(categorie)
    if occasion:
        clauses.append("chants.occasions LIKE ?")
        params.append(f'%"{occasion}"%')
    if confiance_max is not None:
        clauses.append("chants.confiance < ?")
        params.append(confiance_max)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    if confiance_max is not None:
        order = "chants.confiance ASC, chants.titre"
    elif fts_q:
        order = "rank"
    else:
        order = "chants.titre"
    with get_connection() as conn:
        rows = conn.execute(
            f"SELECT chants.* FROM {from_clause} {where} ORDER BY {order} LIMIT ? OFFSET ?",
            (*params, limit, offset),
        ).fetchall()
        return [_row_to_chant(r) for r in rows]


def bulk_update_categorie(ids: list[int], categorie: str) -> int:
    if not ids:
        return 0
    with get_connection() as conn:
        placeholders = ",".join("?" for _ in ids)
        cur = conn.execute(
            f"UPDATE chants SET categorie = ? WHERE id IN ({placeholders})",
            (categorie, *ids),
        )
        return cur.rowcount


def bulk_delete_chants(ids: list[int]) -> int:
    if not ids:
        return 0
    with get_connection() as conn:
        placeholders = ",".join("?" for _ in ids)
        cur = conn.execute(f"DELETE FROM chants WHERE id IN ({placeholders})", ids)
        return cur.rowcount


def delete_all_chants() -> int:
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM chants")
        return cur.rowcount


def count_chants() -> int:
    with get_connection() as conn:
        return conn.execute("SELECT COUNT(*) c FROM chants").fetchone()["c"]


def update_chant(chant_id: int, patch: schemas.ChantUpdate, mark_reviewed: bool = True) -> Optional[schemas.Chant]:
    """mark_reviewed=True fait passer confiance à 1.0 : une modification explicite via
    l'éditeur vaut relecture humaine, donc le chant sort de la liste "à vérifier"."""
    existing = get_chant(chant_id)
    if not existing:
        return None
    data = existing.model_dump()
    for field, value in patch.model_dump(exclude_unset=True).items():
        data[field] = value
    confiance = 1.0 if mark_reviewed else existing.confiance
    with get_connection() as conn:
        slug = existing.slug
        if data["titre"] != existing.titre or not slug:
            slug = unique_slug(data["titre"], _existing_slugs(conn, exclude_id=chant_id))
        conn.execute(
            """
            UPDATE chants SET titre=?, slug=?, categorie=?, refrain=?, couplets=?, code_reference=?, langue=?, occasions=?, confiance=?
            WHERE id=?
            """,
            (
                data["titre"],
                slug,
                data["categorie"],
                data["refrain"],
                json.dumps(data["couplets"], ensure_ascii=False),
                data["code_reference"],
                data["langue"],
                json.dumps(data["occasions"], ensure_ascii=False),
                confiance,
                chant_id,
            ),
        )
    return get_chant(chant_id)


def delete_chant(chant_id: int) -> bool:
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM chants WHERE id = ?", (chant_id,))
        return cur.rowcount > 0


# --- Feuillets ---

def _row_to_feuillet(row) -> schemas.Feuillet:
    return schemas.Feuillet(
        id=row["id"],
        date=row["date"],
        lieu=row["lieu"],
        lectures=schemas.Lectures(**json.loads(row["lectures"])),
        moments=[schemas.MomentContenu(**m) for m in json.loads(row["moments"])],
    )


def create_feuillet(feuillet: schemas.FeuilletCreate) -> schemas.Feuillet:
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO feuillets (date, lieu, lectures, moments) VALUES (?, ?, ?, ?)",
            (
                feuillet.date,
                feuillet.lieu,
                feuillet.lectures.model_dump_json(),
                json.dumps([m.model_dump() for m in feuillet.moments], ensure_ascii=False),
            ),
        )
        row = conn.execute("SELECT * FROM feuillets WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _row_to_feuillet(row)


def get_feuillet(feuillet_id: int) -> Optional[schemas.Feuillet]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM feuillets WHERE id = ?", (feuillet_id,)).fetchone()
        return _row_to_feuillet(row) if row else None


def update_feuillet(feuillet_id: int, feuillet: schemas.FeuilletCreate) -> Optional[schemas.Feuillet]:
    if not get_feuillet(feuillet_id):
        return None
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE feuillets SET date=?, lieu=?, lectures=?, moments=?, updated_at=datetime('now')
            WHERE id=?
            """,
            (
                feuillet.date,
                feuillet.lieu,
                feuillet.lectures.model_dump_json(),
                json.dumps([m.model_dump() for m in feuillet.moments], ensure_ascii=False),
                feuillet_id,
            ),
        )
    return get_feuillet(feuillet_id)


def list_feuillets(limit: int = 50, offset: int = 0) -> list[schemas.Feuillet]:
    with get_connection() as conn:
        # tri par date de création (pas par `date`, qui est un texte libre du
        # style "Dimanche 21 Juin 2026" et ne trie pas chronologiquement)
        rows = conn.execute(
            "SELECT * FROM feuillets ORDER BY created_at DESC LIMIT ? OFFSET ?", (limit, offset)
        ).fetchall()
        return [_row_to_feuillet(r) for r in rows]


def delete_feuillet(feuillet_id: int) -> bool:
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM feuillets WHERE id = ?", (feuillet_id,))
        return cur.rowcount > 0
