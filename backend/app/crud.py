import json
import re
from typing import Optional

from . import db, schemas
from .db import get_connection, insert_returning_id
from .slugify import unique_slug


def _existing_slugs(conn, exclude_id: Optional[int] = None) -> set[str]:
    rows = conn.execute("SELECT id, slug FROM chants WHERE slug IS NOT NULL").fetchall()
    return {r["slug"] for r in rows if r["id"] != exclude_id}


def _fts_query(q: str) -> Optional[str]:
    """Transforme la saisie utilisateur en requête FTS5 (SQLite uniquement) :
    chaque mot devient un préfixe (ex. 'seign dieu' -> '"seign"* "dieu"*'),
    pour un rendu proche d'une recherche 'contient' tout en restant rapide
    sur un gros volume de paroles."""
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
        new_id = insert_returning_id(
            conn,
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
        row = conn.execute("SELECT * FROM chants WHERE id = ?", (new_id,)).fetchone()
        return _row_to_chant(row)


_MASQUE_CLAUSE = (
    "NOT EXISTS (SELECT 1 FROM masques_chorale mc "
    "WHERE mc.type_cible = ? AND mc.cible_id = {table}.id AND mc.chorale_id = ?)"
)


def get_chant(chant_id: int, chorale_id_appelant: Optional[int] = None) -> Optional[schemas.Chant]:
    """chorale_id_appelant est optionnel et laissé à None par tous les
    appels INTERNES (rendu d'un feuillet déjà composé, détection de
    doublons...) : le masquage (voir masques_chorale) n'affecte QUE la
    recherche/consultation dans la bibliothèque, jamais un chant déjà
    référencé par un dépliant existant."""
    with get_connection() as conn:
        if chorale_id_appelant is not None:
            row = conn.execute(
                f"SELECT * FROM chants WHERE id = ? AND {_MASQUE_CLAUSE.format(table='chants')}",
                (chant_id, "chant", chorale_id_appelant),
            ).fetchone()
        else:
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
    chorale_id_appelant: Optional[int] = None,
) -> list[schemas.Chant]:
    clauses = []
    params: list = []
    from_clause = "chants"
    fts_q = _fts_query(q) if (q and db.BACKEND == "sqlite") else None
    if fts_q:
        from_clause = "chants JOIN chants_fts ON chants.id = chants_fts.rowid"
        clauses.append("chants_fts MATCH ?")
        params.append(fts_q)
    elif q:
        # Postgres : pas de FTS5 disponible, recherche par sous-chaîne (ILIKE,
        # insensible à la casse/accents suffisant à l'échelle d'une seule
        # chorale) sur titre/refrain/couplets plutôt qu'un moteur plein texte.
        clauses.append("(chants.titre ILIKE ? OR chants.refrain ILIKE ? OR chants.couplets ILIKE ?)")
        motif = f"%{q}%"
        params.extend([motif, motif, motif])
    if categorie:
        clauses.append("chants.categorie = ?")
        params.append(categorie)
    if occasion:
        clauses.append("chants.occasions LIKE ?")
        params.append(f'%"{occasion}"%')
    if confiance_max is not None:
        clauses.append("chants.confiance < ?")
        params.append(confiance_max)
    if chorale_id_appelant is not None:
        clauses.append(_MASQUE_CLAUSE.format(table="chants"))
        params.extend(["chant", chorale_id_appelant])
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

_FEUILLET_SELECT = """
    SELECT f.*, c.nom AS chorale_nom
    FROM feuillets f
    LEFT JOIN chorales c ON c.id = f.chorale_id
"""


def _row_to_feuillet(row) -> schemas.Feuillet:
    return schemas.Feuillet(
        id=row["id"],
        date=row["date"],
        lieu=row["lieu"],
        lectures=schemas.Lectures(**json.loads(row["lectures"])),
        moments=[schemas.MomentContenu(**m) for m in json.loads(row["moments"])],
        priere_active=bool(row["priere_active"]),
        priere_texte=row["priere_texte"],
        taille_texte_manuelle=row["taille_texte_manuelle"],
        chorale_id=row["chorale_id"],
        clone_de_id=row["clone_de_id"],
        chorale_nom=row["chorale_nom"],
    )


def create_feuillet(feuillet: schemas.FeuilletCreate, chorale_id: int, clone_de_id: Optional[int] = None) -> schemas.Feuillet:
    with get_connection() as conn:
        new_id = insert_returning_id(
            conn,
            "INSERT INTO feuillets "
            "(date, lieu, lectures, moments, priere_active, priere_texte, taille_texte_manuelle, chorale_id, clone_de_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                feuillet.date,
                feuillet.lieu,
                feuillet.lectures.model_dump_json(),
                json.dumps([m.model_dump() for m in feuillet.moments], ensure_ascii=False),
                int(feuillet.priere_active),
                feuillet.priere_texte,
                feuillet.taille_texte_manuelle,
                chorale_id,
                clone_de_id,
            ),
        )
        row = conn.execute(_FEUILLET_SELECT + " WHERE f.id = ?", (new_id,)).fetchone()
        return _row_to_feuillet(row)


def get_feuillet(feuillet_id: int, chorale_id_appelant: Optional[int] = None) -> Optional[schemas.Feuillet]:
    """chorale_id_appelant optionnel, laissé à None par les appels INTERNES
    (ex. vérification de propriété dans update_feuillet) — voir le
    commentaire équivalent sur get_chant."""
    with get_connection() as conn:
        if chorale_id_appelant is not None:
            row = conn.execute(
                _FEUILLET_SELECT + f" WHERE f.id = ? AND {_MASQUE_CLAUSE.format(table='f')}",
                (feuillet_id, "feuillet", chorale_id_appelant),
            ).fetchone()
        else:
            row = conn.execute(_FEUILLET_SELECT + " WHERE f.id = ?", (feuillet_id,)).fetchone()
        return _row_to_feuillet(row) if row else None


def update_feuillet(feuillet_id: int, feuillet: schemas.FeuilletCreate, chorale_id: int) -> Optional[schemas.Feuillet]:
    """Si le dépliant appartient déjà à `chorale_id`, mise à jour en place.
    Sinon, CLONE : un nouveau dépliant est créé pour `chorale_id` avec le
    contenu fourni et `clone_de_id` pointant vers l'original, qui n'est
    JAMAIS modifié — modifier le dépliant d'une autre chorale n'affecte
    donc jamais son auteure. Le PDF du clone se rend avec les
    logos/réglages de son NOUVEAU propriétaire (voir render/pdf.py, qui
    résout la config par feuillet.chorale_id)."""
    existant = get_feuillet(feuillet_id)
    if not existant:
        return None
    if existant.chorale_id != chorale_id:
        return create_feuillet(feuillet, chorale_id, clone_de_id=feuillet_id)

    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        conn.execute(
            f"""
            UPDATE feuillets SET date=?, lieu=?, lectures=?, moments=?, priere_active=?, priere_texte=?,
                taille_texte_manuelle=?, updated_at={horodatage}
            WHERE id=?
            """,
            (
                feuillet.date,
                feuillet.lieu,
                feuillet.lectures.model_dump_json(),
                json.dumps([m.model_dump() for m in feuillet.moments], ensure_ascii=False),
                int(feuillet.priere_active),
                feuillet.priere_texte,
                feuillet.taille_texte_manuelle,
                feuillet_id,
            ),
        )
    return get_feuillet(feuillet_id)


def list_feuillets(
    chorale_id: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
    chorale_id_appelant: Optional[int] = None,
) -> list[schemas.Feuillet]:
    """chorale_id fourni -> uniquement les dépliants de cette chorale ("Mes
    dépliants") ; chorale_id=None -> tous les dépliants, toutes chorales
    confondues ("Parcourir"), avec le nom de la chorale propriétaire pour
    l'affichage "composé par X". chorale_id_appelant (généralement identique
    à chorale_id en mode "Mes dépliants") exclut les dépliants que CETTE
    chorale a masqués (demande de suppression), y compris les siens."""
    clauses = []
    params: list = []
    if chorale_id is not None:
        clauses.append("f.chorale_id = ?")
        params.append(chorale_id)
    if chorale_id_appelant is not None:
        clauses.append(_MASQUE_CLAUSE.format(table="f"))
        params.extend(["feuillet", chorale_id_appelant])
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with get_connection() as conn:
        # tri par date de création (pas par `date`, qui est un texte libre du
        # style "Dimanche 21 Juin 2026" et ne trie pas chronologiquement)
        rows = conn.execute(
            _FEUILLET_SELECT + f" {where} ORDER BY f.created_at DESC LIMIT ? OFFSET ?",
            (*params, limit, offset),
        ).fetchall()
        return [_row_to_feuillet(r) for r in rows]


def delete_feuillet(feuillet_id: int) -> bool:
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM feuillets WHERE id = ?", (feuillet_id,))
        return cur.rowcount > 0


# --- Modération (suppression chants/dépliants) ---
# Une chorale ne supprime jamais directement un chant (bibliothèque
# partagée) ou un dépliant : elle en fait la demande, masquée aussitôt pour
# elle-même (voir _MASQUE_CLAUSE ci-dessus, appliqué dans list_chants/
# get_chant/list_feuillets/get_feuillet), en attendant la décision du
# super-admin.

def creer_demande_suppression(type_cible: str, cible_id: int, chorale_demandeuse_id: int) -> dict:
    with get_connection() as conn:
        demande_id = insert_returning_id(
            conn,
            "INSERT INTO demandes_suppression (type_cible, cible_id, chorale_demandeuse_id) VALUES (?, ?, ?)",
            (type_cible, cible_id, chorale_demandeuse_id),
        )
        conn.execute(
            "INSERT INTO masques_chorale (chorale_id, type_cible, cible_id) VALUES (?, ?, ?) "
            "ON CONFLICT (chorale_id, type_cible, cible_id) DO NOTHING",
            (chorale_demandeuse_id, type_cible, cible_id),
        )
        row = conn.execute("SELECT * FROM demandes_suppression WHERE id = ?", (demande_id,)).fetchone()
        return dict(row)


def list_demandes_suppression(statut: Optional[str] = None) -> list[dict]:
    with get_connection() as conn:
        if statut:
            rows = conn.execute(
                "SELECT d.*, c.nom AS chorale_nom FROM demandes_suppression d "
                "JOIN chorales c ON c.id = d.chorale_demandeuse_id "
                "WHERE d.statut = ? ORDER BY d.created_at DESC",
                (statut,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT d.*, c.nom AS chorale_nom FROM demandes_suppression d "
                "JOIN chorales c ON c.id = d.chorale_demandeuse_id "
                "ORDER BY d.created_at DESC"
            ).fetchall()
        return [dict(r) for r in rows]


def get_demande_suppression(demande_id: int) -> Optional[dict]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM demandes_suppression WHERE id = ?", (demande_id,)).fetchone()
        return dict(row) if row else None


def valider_demande_suppression(demande_id: int) -> bool:
    """Supprime réellement la cible (chant ou dépliant partagé par tous) et
    marque la demande comme validée."""
    demande = get_demande_suppression(demande_id)
    if not demande or demande["statut"] != "en_attente":
        return False
    if demande["type_cible"] == "chant":
        delete_chant(demande["cible_id"])
    else:
        delete_feuillet(demande["cible_id"])
    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        conn.execute(
            f"UPDATE demandes_suppression SET statut = 'validee', traite_at = {horodatage} WHERE id = ?",
            (demande_id,),
        )
    return True


def annuler_demande_suppression(demande_id: int) -> bool:
    """Ne touche PAS la cible ni le masque déjà posé pour la chorale
    demandeuse : la bibliothèque garde la ressource, mais cette chorale
    précise continue de ne plus la voir (restauration séparée, voir
    restaurer_masque) — exactement le comportement demandé."""
    demande = get_demande_suppression(demande_id)
    if not demande or demande["statut"] != "en_attente":
        return False
    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        conn.execute(
            f"UPDATE demandes_suppression SET statut = 'annulee', traite_at = {horodatage} WHERE id = ?",
            (demande_id,),
        )
    return True


def list_masques() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT m.*, c.nom AS chorale_nom FROM masques_chorale m "
            "JOIN chorales c ON c.id = m.chorale_id ORDER BY m.created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def restaurer_masque(masque_id: int) -> bool:
    """Action super-admin : rend la ressource de nouveau visible pour CETTE
    chorale précise (les autres chorales n'ont jamais cessé de la voir)."""
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM masques_chorale WHERE id = ?", (masque_id,))
        return cur.rowcount > 0


# --- Catégories personnalisées ---

def list_categories_personnalisees() -> list[str]:
    with get_connection() as conn:
        rows = conn.execute("SELECT nom FROM categories_personnalisees ORDER BY nom").fetchall()
        return [r["nom"] for r in rows]


def ajouter_categorie_personnalisee(nom: str) -> str:
    nom = nom.strip()
    requete = (
        "INSERT INTO categories_personnalisees (nom) VALUES (?) ON CONFLICT (nom) DO NOTHING"
        if db.BACKEND == "postgres" else
        "INSERT OR IGNORE INTO categories_personnalisees (nom) VALUES (?)"
    )
    with get_connection() as conn:
        conn.execute(requete, (nom,))
    return nom
