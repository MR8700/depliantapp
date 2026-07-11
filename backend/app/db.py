"""Accès base de données — SQLite en local (aucune installation requise pour
développer), PostgreSQL en production dès que DATABASE_URL est définie (ex:
Render, dont le disque du service web est éphémère et efface SQLite à chaque
redéploiement — voir memory project_depliantapp_render_engine).

Le reste du code (crud.py, auth.py, ml/*.py) continue à écrire des requêtes
avec des `?` comme sous SQLite : `get_connection()` renvoie un objet qui
traduit automatiquement vers `%s` et adapte l'accès aux lignes quand on tourne
sur Postgres, pour éviter de dupliquer chaque requête dans les deux dialectes.
Les rares différences non réductibles à une simple traduction de syntaxe
(AUTOINCREMENT/SERIAL, PRAGMA, INSERT OR IGNORE, recherche plein texte FTS5)
sont gérées explicitement, au cas par cas, plutôt que masquées."""
import os
import re
import shutil
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

from .paths import DATA_DIR
from .slugify import unique_slug

DATABASE_URL = os.environ.get("DATABASE_URL")
BACKEND = "postgres" if DATABASE_URL else "sqlite"

DB_PATH = DATA_DIR / "chants.db"
SEED_DB_PATH = Path(__file__).resolve().parent.parent / "seed_data" / "chants.db"

if BACKEND == "postgres":
    import psycopg2
    import psycopg2.extras

_PLACEHOLDER_RE = re.compile(r"\?")


class _PgCursorWrapper:
    def __init__(self, cur):
        self._cur = cur

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    @property
    def rowcount(self):
        return self._cur.rowcount


class _PgConnWrapper:
    """Fait ressembler une connexion psycopg2 à une connexion sqlite3 pour le
    reste du code : mêmes méthodes (execute/executemany/executescript), même
    accès aux colonnes par nom (RealDictCursor), pour ne pas avoir à réécrire
    toutes les requêtes existantes pour un second dialecte SQL."""

    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql: str, params=()) -> _PgCursorWrapper:
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(_PLACEHOLDER_RE.sub("%s", sql), tuple(params))
        return _PgCursorWrapper(cur)

    def executemany(self, sql: str, seq_of_params) -> None:
        cur = self._conn.cursor()
        cur.executemany(_PLACEHOLDER_RE.sub("%s", sql), seq_of_params)

    def executescript(self, sql: str) -> None:
        cur = self._conn.cursor()
        cur.execute(sql)

    def commit(self) -> None:
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()


def insert_returning_id(conn, sql: str, params: tuple) -> int:
    """Exécute un INSERT et retourne l'id généré. SQLite expose cur.lastrowid ;
    Postgres n'a pas d'équivalent sur le curseur et exige un RETURNING id
    explicite dans la requête — cette fonction est le seul endroit du code
    (create_chant, create_feuillet) qui a besoin de connaître cette différence."""
    if BACKEND == "postgres":
        sql_avec_returning = sql.rstrip().rstrip(";") + " RETURNING id"
        row = conn.execute(sql_avec_returning, params).fetchone()
        return row["id"]
    cur = conn.execute(sql, params)
    return cur.lastrowid


def binary(data: bytes):
    """Enveloppe des données binaires pour un BYTEA Postgres (psycopg2.Binary) ;
    no-op ailleurs. Centralisé ici pour que seul db.py ait besoin d'importer
    psycopg2 directement."""
    if BACKEND == "postgres":
        return psycopg2.Binary(data)
    return data


def table_columns(conn, table_name: str) -> set[str]:
    """Colonnes existantes d'une table — équivalent portable de
    `PRAGMA table_info` (SQLite uniquement)."""
    if BACKEND == "postgres":
        rows = conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = ?", (table_name,)
        ).fetchall()
        return {r["column_name"] for r in rows}
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {r["name"] for r in rows}


SCHEMA_SQLITE = """
CREATE TABLE IF NOT EXISTS chants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titre TEXT NOT NULL,
    slug TEXT,
    categorie TEXT NOT NULL DEFAULT 'Autre',
    refrain TEXT,
    couplets TEXT NOT NULL DEFAULT '[]',
    code_reference TEXT,
    langue TEXT NOT NULL DEFAULT 'fr',
    source_file TEXT,
    occasions TEXT NOT NULL DEFAULT '[]',
    confiance REAL NOT NULL DEFAULT 1.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chants_titre ON chants(titre);
CREATE INDEX IF NOT EXISTS idx_chants_categorie ON chants(categorie);
CREATE INDEX IF NOT EXISTS idx_chants_code_reference ON chants(code_reference);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chants_slug ON chants(slug);

-- Recherche plein texte (bien plus rapide que LIKE '%mot%' sur un gros volume de
-- paroles) : table FTS5 tenue à jour automatiquement par triggers. N'existe que
-- côté SQLite (Postgres n'a pas FTS5) — voir crud.list_chants pour l'équivalent
-- ILIKE utilisé côté Postgres.
CREATE VIRTUAL TABLE IF NOT EXISTS chants_fts USING fts5(
    titre, refrain, couplets, content='chants', content_rowid='id',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS chants_fts_ai AFTER INSERT ON chants BEGIN
    INSERT INTO chants_fts(rowid, titre, refrain, couplets) VALUES (new.id, new.titre, new.refrain, new.couplets);
END;

CREATE TRIGGER IF NOT EXISTS chants_fts_ad AFTER DELETE ON chants BEGIN
    INSERT INTO chants_fts(chants_fts, rowid, titre, refrain, couplets) VALUES ('delete', old.id, old.titre, old.refrain, old.couplets);
END;

CREATE TRIGGER IF NOT EXISTS chants_fts_au AFTER UPDATE ON chants BEGIN
    INSERT INTO chants_fts(chants_fts, rowid, titre, refrain, couplets) VALUES ('delete', old.id, old.titre, old.refrain, old.couplets);
    INSERT INTO chants_fts(rowid, titre, refrain, couplets) VALUES (new.id, new.titre, new.refrain, new.couplets);
END;

CREATE TABLE IF NOT EXISTS feuillets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    lieu TEXT,
    lectures TEXT NOT NULL DEFAULT '{}',
    moments TEXT NOT NULL DEFAULT '[]',
    priere_active INTEGER NOT NULL DEFAULT 0,
    priere_texte TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Authentification : un compte unique partagé (pas de gestion multi-utilisateur).
-- La ligne id=1 est créée avec des identifiants par défaut au premier démarrage
-- (voir auth.py) et must_change_password=1 force le changement avant tout accès.
CREATE TABLE IF NOT EXISTS auth (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Catégories de chants ajoutées par les utilisateurs (via "Autre" -> saisie
-- libre) en plus de la liste fixe CATEGORIES_CHANTS (constants.py) — pour
-- qu'une nouvelle catégorie devienne utilisable partout et persiste, comme
-- les catégories intégrées.
CREATE TABLE IF NOT EXISTS categories_personnalisees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

# Équivalent Postgres : mêmes tables/colonnes, mais SERIAL (pas AUTOINCREMENT),
# TIMESTAMP + now() (pas datetime('now')), et sans FTS5 (voir plus haut). Les
# ALTER TABLE ... ADD COLUMN IF NOT EXISTS remplacent les migrations
# conditionnelles nécessaires côté SQLite (Postgres gère IF NOT EXISTS
# nativement sur ADD COLUMN, donc pas besoin de vérifier table_columns() ici).
SCHEMA_POSTGRES = """
CREATE TABLE IF NOT EXISTS chants (
    id SERIAL PRIMARY KEY,
    titre TEXT NOT NULL,
    slug TEXT,
    categorie TEXT NOT NULL DEFAULT 'Autre',
    refrain TEXT,
    couplets TEXT NOT NULL DEFAULT '[]',
    code_reference TEXT,
    langue TEXT NOT NULL DEFAULT 'fr',
    source_file TEXT,
    occasions TEXT NOT NULL DEFAULT '[]',
    confiance REAL NOT NULL DEFAULT 1.0,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chants_titre ON chants(titre);
CREATE INDEX IF NOT EXISTS idx_chants_categorie ON chants(categorie);
CREATE INDEX IF NOT EXISTS idx_chants_code_reference ON chants(code_reference);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chants_slug ON chants(slug);

CREATE TABLE IF NOT EXISTS feuillets (
    id SERIAL PRIMARY KEY,
    date TEXT NOT NULL,
    lieu TEXT,
    lectures TEXT NOT NULL DEFAULT '{}',
    moments TEXT NOT NULL DEFAULT '[]',
    priere_active INTEGER NOT NULL DEFAULT 0,
    priere_texte TEXT,
    taille_texte_manuelle REAL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories_personnalisees (
    id SERIAL PRIMARY KEY,
    nom TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Médias uploadés (logos, bannière, plus tard audio/vidéo des chants) stockés
-- en base plutôt que sur le disque du service web (éphémère sur Render) —
-- une seule base Postgres suffit à tout persister, sans service de stockage
-- externe séparé.
CREATE TABLE IF NOT EXISTS medias (
    slot TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    content_type TEXT,
    donnees BYTEA NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Réglages généraux (chorale, paroisse, annonce, etc.) — équivalent Postgres
-- de config.json, lui aussi sur le disque éphémère du service web.
CREATE TABLE IF NOT EXISTS parametres (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    donnees TEXT NOT NULL DEFAULT '{}'
);

ALTER TABLE feuillets ADD COLUMN IF NOT EXISTS priere_active INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feuillets ADD COLUMN IF NOT EXISTS priere_texte TEXT;
ALTER TABLE feuillets ADD COLUMN IF NOT EXISTS taille_texte_manuelle REAL;
ALTER TABLE chants ADD COLUMN IF NOT EXISTS slug TEXT;
"""


def init_db() -> None:
    if BACKEND == "postgres":
        _init_postgres()
    else:
        _init_sqlite()

    from . import auth  # import différé : auth.py importe get_connection depuis ce module
    auth.ensure_default_account()


def _init_sqlite() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Premier démarrage sur un disque persistant vierge (ex: Render) : réamorce
    # la bibliothèque à partir du jeu de données figé plutôt que de démarrer vide.
    if not DB_PATH.exists() and SEED_DB_PATH.exists():
        shutil.copy(SEED_DB_PATH, DB_PATH)

    with get_connection() as conn:
        # migration : ajoute la colonne slug si la base existait avant son introduction
        colonnes = {row["name"] for row in conn.execute("PRAGMA table_info(chants)").fetchall()}
        if colonnes and "slug" not in colonnes:
            conn.execute("ALTER TABLE chants ADD COLUMN slug TEXT")

        conn.executescript(SCHEMA_SQLITE)

        # migration : ajoute les colonnes ajoutées après la création initiale de
        # la table (le CREATE TABLE IF NOT EXISTS ci-dessus ne touche pas une
        # table déjà créée).
        colonnes_feuillets = {row["name"] for row in conn.execute("PRAGMA table_info(feuillets)").fetchall()}
        if "priere_active" not in colonnes_feuillets:
            conn.execute("ALTER TABLE feuillets ADD COLUMN priere_active INTEGER NOT NULL DEFAULT 0")
        if "priere_texte" not in colonnes_feuillets:
            conn.execute("ALTER TABLE feuillets ADD COLUMN priere_texte TEXT")
        if "taille_texte_manuelle" not in colonnes_feuillets:
            conn.execute("ALTER TABLE feuillets ADD COLUMN taille_texte_manuelle REAL")

        # backfill ponctuel : génère un slug pour les chants qui n'en ont pas encore
        # (import initial, chants créés avant l'ajout de cette colonne)
        sans_slug = conn.execute("SELECT id, titre FROM chants WHERE slug IS NULL").fetchall()
        if sans_slug:
            existants = {
                row["slug"] for row in conn.execute("SELECT slug FROM chants WHERE slug IS NOT NULL").fetchall()
            }
            for row in sans_slug:
                slug = unique_slug(row["titre"], existants)
                existants.add(slug)
                conn.execute("UPDATE chants SET slug = ? WHERE id = ?", (slug, row["id"]))
        # backfill ponctuel : peuple l'index plein texte pour les chants déjà
        # présents avant la création de la table FTS5 (les triggers ne couvrent
        # que les écritures futures). NB: SELECT COUNT(*) FROM chants_fts (table à
        # contenu externe) reflète le nombre de lignes de `chants`, pas l'état réel
        # de l'index — on vérifie donc la table shadow `chants_fts_docsize` à la
        # place, et on peuple ligne par ligne (un INSERT...SELECT groupé ne
        # déclenche pas l'indexation correctement sur une table à contenu externe).
        (n_chants,) = conn.execute("SELECT COUNT(*) FROM chants").fetchone()
        (n_indexed,) = conn.execute("SELECT COUNT(*) FROM chants_fts_docsize").fetchone()
        if n_chants > 0 and n_indexed == 0:
            rows = conn.execute("SELECT id, titre, refrain, couplets FROM chants").fetchall()
            conn.executemany(
                "INSERT INTO chants_fts(rowid, titre, refrain, couplets) VALUES (?, ?, ?, ?)",
                [(r["id"], r["titre"], r["refrain"], r["couplets"]) for r in rows],
            )


def _init_postgres() -> None:
    with get_connection() as conn:
        conn.executescript(SCHEMA_POSTGRES)

        sans_slug = conn.execute("SELECT id, titre FROM chants WHERE slug IS NULL").fetchall()
        if sans_slug:
            existants = {
                row["slug"] for row in conn.execute("SELECT slug FROM chants WHERE slug IS NOT NULL").fetchall()
            }
            for row in sans_slug:
                slug = unique_slug(row["titre"], existants)
                existants.add(slug)
                conn.execute("UPDATE chants SET slug = ? WHERE id = ?", (slug, row["id"]))


@contextmanager
def get_connection():
    if BACKEND == "postgres":
        conn = psycopg2.connect(DATABASE_URL)
        wrapped = _PgConnWrapper(conn)
        try:
            yield wrapped
            wrapped.commit()
        finally:
            wrapped.close()
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
