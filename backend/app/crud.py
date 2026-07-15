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
        mots_cles=json.loads(row["mots_cles"]) if "mots_cles" in list(row.keys()) and row["mots_cles"] else [],
        actif=bool(row["actif"]) if "actif" in list(row.keys()) and row["actif"] is not None else True,
        favori=bool(row["favori"]) if "favori" in list(row.keys()) and row["favori"] is not None else False,
        chant_principal=bool(row["chant_principal"]) if "chant_principal" in list(row.keys()) and row["chant_principal"] is not None else False,
        duree_estimee=row["duree_estimee"] if "duree_estimee" in list(row.keys()) else None,
        tonalite=row["tonalite"] if "tonalite" in list(row.keys()) else None,
        remarques=row["remarques"] if "remarques" in list(row.keys()) else None,
    )


def create_chant(chant: schemas.ChantCreate, source_file: Optional[str] = None, confiance: float = 1.0) -> schemas.Chant:
    with get_connection() as conn:
        base_slug = chant.slug.strip() if chant.slug and chant.slug.strip() else chant.titre
        slug = unique_slug(base_slug, _existing_slugs(conn))
        new_id = insert_returning_id(
            conn,
            """
            INSERT INTO chants (titre, slug, categorie, refrain, couplets, code_reference, langue, occasions, source_file, confiance, mots_cles, actif, favori, chant_principal, duree_estimee, tonalite, remarques)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                json.dumps(chant.mots_cles, ensure_ascii=False),
                1 if chant.actif else 0,
                1 if chant.favori else 0,
                1 if chant.chant_principal else 0,
                chant.duree_estimee,
                chant.tonalite,
                chant.remarques,
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
    champs_envoyes = patch.model_dump(exclude_unset=True)
    data = existing.model_dump()
    for field, value in champs_envoyes.items():
        data[field] = value
    confiance = 1.0 if mark_reviewed else existing.confiance
    with get_connection() as conn:
        # Le "mot clé" (slug) envoyé explicitement par l'éditeur de chant
        # prime toujours sur la dérivation automatique, même si le titre n'a
        # pas changé — c'est exactement ce qui le rend "modifiable" plutôt
        # que purement automatique. S'il est absent ou vide, on retombe sur
        # le comportement historique (re-dérivé du titre s'il a changé ou
        # si le chant n'en avait pas encore).
        slug_demande = (champs_envoyes.get("slug") or "").strip()
        if slug_demande:
            slug = unique_slug(slug_demande, _existing_slugs(conn, exclude_id=chant_id))
        else:
            slug = existing.slug
            if data["titre"] != existing.titre or not slug:
                slug = unique_slug(data["titre"], _existing_slugs(conn, exclude_id=chant_id))
        conn.execute(
            """
            UPDATE chants SET titre=?, slug=?, categorie=?, refrain=?, couplets=?, code_reference=?, langue=?, occasions=?, confiance=?, mots_cles=?, actif=?, favori=?, chant_principal=?, duree_estimee=?, tonalite=?, remarques=?
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
                json.dumps(data["mots_cles"], ensure_ascii=False),
                1 if data["actif"] else 0,
                1 if data["favori"] else 0,
                1 if data["chant_principal"] else 0,
                data["duree_estimee"],
                data["tonalite"],
                data["remarques"],
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
        one_page_mode=bool(row["one_page_mode"]),
        banniere_active=bool(row["banniere_active"]),
        chorale_id=row["chorale_id"],
        clone_de_id=row["clone_de_id"],
        chorale_nom=row["chorale_nom"],
    )


def create_feuillet(feuillet: schemas.FeuilletCreate, chorale_id: int, clone_de_id: Optional[int] = None) -> schemas.Feuillet:
    with get_connection() as conn:
        new_id = insert_returning_id(
            conn,
            "INSERT INTO feuillets "
            "(date, lieu, lectures, moments, priere_active, priere_texte, taille_texte_manuelle, one_page_mode, banniere_active, chorale_id, clone_de_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                feuillet.date,
                feuillet.lieu,
                feuillet.lectures.model_dump_json(),
                json.dumps([m.model_dump() for m in feuillet.moments], ensure_ascii=False),
                int(feuillet.priere_active),
                feuillet.priere_texte,
                feuillet.taille_texte_manuelle,
                int(feuillet.one_page_mode),
                int(feuillet.banniere_active),
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
                taille_texte_manuelle=?, one_page_mode=?, banniere_active=?, updated_at={horodatage}
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
                int(feuillet.one_page_mode),
                int(feuillet.banniere_active),
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


# --- Statistiques (super-admin) ---

def get_statistiques() -> dict:
    """Vue d'ensemble chiffrée pour le panneau Administration — agrégations
    pures sur les tables existantes, aucune donnée dupliquée/mise en cache."""
    with get_connection() as conn:
        total_chants = conn.execute("SELECT COUNT(*) AS n FROM chants").fetchone()["n"]
        total_feuillets = conn.execute("SELECT COUNT(*) AS n FROM feuillets").fetchone()["n"]
        total_chorales = conn.execute("SELECT COUNT(*) AS n FROM chorales").fetchone()["n"]

        chants_par_categorie = [
            dict(r) for r in conn.execute(
                "SELECT categorie, COUNT(*) AS nombre FROM chants GROUP BY categorie ORDER BY nombre DESC"
            ).fetchall()
        ]

        feuillets_par_chorale = [
            dict(r) for r in conn.execute(
                "SELECT c.nom AS chorale_nom, COUNT(f.id) AS nombre, MAX(f.created_at) AS dernier "
                "FROM chorales c LEFT JOIN feuillets f ON f.chorale_id = c.id "
                "GROUP BY c.id, c.nom ORDER BY nombre DESC"
            ).fetchall()
        ]

        demandes_en_attente = conn.execute(
            "SELECT COUNT(*) AS n FROM demandes_suppression WHERE statut = 'en_attente'"
        ).fetchone()["n"]
        demandes_validees = conn.execute(
            "SELECT COUNT(*) AS n FROM demandes_suppression WHERE statut = 'validee'"
        ).fetchone()["n"]
        masques_actifs = conn.execute("SELECT COUNT(*) AS n FROM masques_chorale").fetchone()["n"]

        feuillets_recents = [
            dict(r) for r in conn.execute(
                "SELECT f.date, f.lieu, c.nom AS chorale_nom, f.created_at "
                "FROM feuillets f LEFT JOIN chorales c ON c.id = f.chorale_id "
                "ORDER BY f.created_at DESC LIMIT 10"
            ).fetchall()
        ]
        chants_recents = [
            dict(r) for r in conn.execute(
                "SELECT titre, categorie, created_at FROM chants ORDER BY created_at DESC LIMIT 10"
            ).fetchall()
        ]

    return {
        "total_chants": total_chants,
        "total_feuillets": total_feuillets,
        "total_chorales": total_chorales,
        "chants_par_categorie": chants_par_categorie,
        "feuillets_par_chorale": feuillets_par_chorale,
        "demandes_en_attente": demandes_en_attente,
        "demandes_validees": demandes_validees,
        "masques_actifs": masques_actifs,
        "feuillets_recents": feuillets_recents,
        "chants_recents": chants_recents,
    }


# --- Messagerie privée (chorale <-> super-admin, un seul fil par chorale) ---

def list_message_threads() -> list[dict]:
    """Boîte de réception du super-admin : une entrée par chorale, avec le
    dernier message et le nombre de non-lus envoyés par la chorale. 3
    requêtes au total quel que soit le nombre de chorales (au lieu d'une
    requête par chorale) : une pour la liste, une pour le dernier message de
    chaque fil (fenêtrage), une pour les compteurs de non-lus (agrégation)."""
    with get_connection() as conn:
        chorales = conn.execute("SELECT id, nom FROM chorales ORDER BY nom").fetchall()
        derniers = {
            r["chorale_id"]: r for r in conn.execute(
                "SELECT chorale_id, texte, expediteur_type, created_at FROM ("
                "  SELECT chorale_id, texte, expediteur_type, created_at,"
                "  ROW_NUMBER() OVER (PARTITION BY chorale_id ORDER BY created_at DESC) AS rang"
                "  FROM messages"
                ") t WHERE rang = 1"
            ).fetchall()
        }
        non_lus_par_chorale = {
            r["chorale_id"]: r["n"] for r in conn.execute(
                "SELECT chorale_id, COUNT(*) AS n FROM messages "
                "WHERE expediteur_type = 'chorale' AND lu = 0 GROUP BY chorale_id"
            ).fetchall()
        }
        return [
            {
                "chorale_id": c["id"], "chorale_nom": c["nom"],
                "dernier_message": dict(derniers[c["id"]]) if c["id"] in derniers else None,
                "non_lus": non_lus_par_chorale.get(c["id"], 0),
            }
            for c in chorales
        ]


def list_messages(chorale_id: int) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, chorale_id, expediteur_type, texte, "
            "piece_jointe_content_type, piece_jointe_filename, "
            "LENGTH(piece_jointe_donnees) AS piece_jointe_size, lu, "
            "parent_id, reactions, modifie, supprime, created_at "
            "FROM messages WHERE chorale_id = ? ORDER BY created_at ASC",
            (chorale_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_message(message_id: int) -> Optional[dict]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, chorale_id, expediteur_type, texte, piece_jointe_content_type, "
            "piece_jointe_filename, LENGTH(piece_jointe_donnees) AS piece_jointe_size, lu, "
            "parent_id, reactions, modifie, supprime, created_at FROM messages WHERE id = ?",
            (message_id,),
        ).fetchone()
        return dict(row) if row else None


def creer_message(
    chorale_id: int, expediteur_type: str, texte: Optional[str],
    piece_jointe: Optional[tuple[bytes, str, str]] = None,
    parent_id: Optional[int] = None,
) -> dict:
    """piece_jointe = (donnees, content_type, filename) si un fichier est
    joint, sinon None. parent_id = id du message parent en cas de réponse."""
    donnees, content_type, filename = piece_jointe if piece_jointe else (None, None, None)
    with get_connection() as conn:
        message_id = insert_returning_id(
            conn,
            "INSERT INTO messages (chorale_id, expediteur_type, texte, piece_jointe_donnees, "
            "piece_jointe_content_type, piece_jointe_filename, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (chorale_id, expediteur_type, texte, db.binary(donnees) if donnees is not None else None, content_type, filename, parent_id),
        )
        row = conn.execute(
            "SELECT id, chorale_id, expediteur_type, texte, piece_jointe_content_type, "
            "piece_jointe_filename, LENGTH(piece_jointe_donnees) AS piece_jointe_size, lu, "
            "parent_id, reactions, modifie, supprime, created_at FROM messages WHERE id = ?",
            (message_id,),
        ).fetchone()
        return dict(row)


def modifier_message(message_id: int, texte: str) -> Optional[dict]:
    with get_connection() as conn:
        conn.execute(
            "UPDATE messages SET texte = ?, modifie = 1 WHERE id = ?",
            (texte, message_id)
        )
        row = conn.execute(
            "SELECT id, chorale_id, expediteur_type, texte, piece_jointe_content_type, "
            "piece_jointe_filename, LENGTH(piece_jointe_donnees) AS piece_jointe_size, lu, "
            "parent_id, reactions, modifie, supprime, created_at FROM messages WHERE id = ?",
            (message_id,),
        ).fetchone()
        return dict(row) if row else None


def supprimer_message(message_id: int) -> Optional[dict]:
    with get_connection() as conn:
        conn.execute(
            "UPDATE messages SET texte = NULL, piece_jointe_donnees = NULL, "
            "piece_jointe_content_type = NULL, piece_jointe_filename = NULL, "
            "supprime = 1 WHERE id = ?",
            (message_id,)
        )
        row = conn.execute(
            "SELECT id, chorale_id, expediteur_type, texte, piece_jointe_content_type, "
            "piece_jointe_filename, LENGTH(piece_jointe_donnees) AS piece_jointe_size, lu, "
            "parent_id, reactions, modifie, supprime, created_at FROM messages WHERE id = ?",
            (message_id,),
        ).fetchone()
        return dict(row) if row else None


def toggle_reaction_message(message_id: int, username: str, emoji: str) -> Optional[dict]:
    with get_connection() as conn:
        row = conn.execute("SELECT reactions FROM messages WHERE id = ?", (message_id,)).fetchone()
        if not row:
            return None
        reactions_str = row["reactions"] or "{}"
        try:
            reactions = json.loads(reactions_str)
        except Exception:
            reactions = {}
        
        if emoji not in reactions:
            reactions[emoji] = []
        
        if username in reactions[emoji]:
            reactions[emoji].remove(username)
            if not reactions[emoji]:
                del reactions[emoji]
        else:
            reactions[emoji].append(username)
            
        new_reactions_str = json.dumps(reactions, ensure_ascii=False)
        conn.execute("UPDATE messages SET reactions = ? WHERE id = ?", (new_reactions_str, message_id))
        
        updated_row = conn.execute(
            "SELECT id, chorale_id, expediteur_type, texte, piece_jointe_content_type, "
            "piece_jointe_filename, LENGTH(piece_jointe_donnees) AS piece_jointe_size, lu, "
            "parent_id, reactions, modifie, supprime, created_at FROM messages WHERE id = ?",
            (message_id,),
        ).fetchone()
        return dict(updated_row) if updated_row else None


def marquer_lus(chorale_id: int, lecteur_type: str) -> None:
    """lecteur_type = qui vient d'ouvrir le fil ('chorale' ou 'super') ->
    marque comme lus les messages envoyés par L'AUTRE partie."""
    autre = "super" if lecteur_type == "chorale" else "chorale"
    with get_connection() as conn:
        conn.execute(
            "UPDATE messages SET lu = 1 WHERE chorale_id = ? AND expediteur_type = ? AND lu = 0",
            (chorale_id, autre),
        )


def compter_non_lus(chorale_id: int, lecteur_type: str) -> int:
    autre = "super" if lecteur_type == "chorale" else "chorale"
    with get_connection() as conn:
        return conn.execute(
            "SELECT COUNT(*) AS n FROM messages WHERE chorale_id = ? AND expediteur_type = ? AND lu = 0",
            (chorale_id, autre),
        ).fetchone()["n"]


def compter_non_lus_total_super() -> int:
    with get_connection() as conn:
        return conn.execute(
            "SELECT COUNT(*) AS n FROM messages WHERE expediteur_type = 'chorale' AND lu = 0"
        ).fetchone()["n"]


def get_piece_jointe_message(message_id: int) -> Optional[tuple[bytes, str, int]]:
    """Retourne aussi chorale_id pour que l'appelant vérifie que l'identité
    a le droit de voir CE fil avant de servir l'image (pièce jointe privée,
    pas le pool `medias` partagé)."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT piece_jointe_donnees, piece_jointe_content_type, chorale_id FROM messages WHERE id = ?",
            (message_id,),
        ).fetchone()
    if not row or not row["piece_jointe_donnees"]:
        return None
    return bytes(row["piece_jointe_donnees"]), row["piece_jointe_content_type"] or "application/octet-stream", row["chorale_id"]


# --- Catégories personnalisées ---

def list_categories_personnalisees(chorale_id: Optional[int] = None) -> list[str]:
    with get_connection() as conn:
        if chorale_id is not None:
            rows = conn.execute(
                "SELECT nom FROM categories_personnalisees WHERE statut = 'valide' OR (cree_par = ? AND statut = 'en_attente') ORDER BY nom",
                (chorale_id,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT nom FROM categories_personnalisees WHERE statut = 'valide' ORDER BY nom"
            ).fetchall()
        return [r["nom"] for r in rows]


def ajouter_categorie_personnalisee(nom: str, cree_par: Optional[int] = None, statut: str = "en_attente") -> str:
    nom = nom.strip()
    with get_connection() as conn:
        existing = conn.execute("SELECT nom, statut, cree_par FROM categories_personnalisees WHERE nom = ?", (nom,)).fetchone()
        if existing:
            return nom
        requete = (
            "INSERT INTO categories_personnalisees (nom, cree_par, statut) VALUES (?, ?, ?)"
        )
        conn.execute(requete, (nom, cree_par, statut))
    return nom
