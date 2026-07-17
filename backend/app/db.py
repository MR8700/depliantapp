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
    mots_cles TEXT NOT NULL DEFAULT '[]',
    actif INTEGER NOT NULL DEFAULT 1,
    favori INTEGER NOT NULL DEFAULT 0,
    chant_principal INTEGER NOT NULL DEFAULT 0,
    duree_estimee TEXT,
    tonalite TEXT,
    remarques TEXT,
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

-- Comptes chorale : un identifiant/mot de passe par chorale, créés
-- uniquement par le super-admin (pas d'auto-inscription) — même logique de
-- hachage/changement obligatoire que la table `auth` ci-dessous, en
-- multi-lignes. Définie avant `feuillets`/`medias`/`parametres` puisqu'ils
-- la référencent.
CREATE TABLE IF NOT EXISTS chorales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    suppression_date_butoir TEXT,
    suppression_raison TEXT,
    suppression_delai_jours INTEGER,
    suppression_demande_revision INTEGER NOT NULL DEFAULT 0,
    suppression_revision_raison TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chorales_username ON chorales(username);

CREATE TABLE IF NOT EXISTS feuillets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    lieu TEXT,
    lectures TEXT NOT NULL DEFAULT '{}',
    moments TEXT NOT NULL DEFAULT '[]',
    priere_active INTEGER NOT NULL DEFAULT 0,
    priere_texte TEXT,
    chorale_id INTEGER REFERENCES chorales(id),
    clone_de_id INTEGER REFERENCES feuillets(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Authentification : un compte unique partagé (pas de gestion multi-utilisateur).
-- La ligne id=1 est créée avec des identifiants par défaut au premier démarrage
-- (voir auth.py) et must_change_password=1 force le changement avant tout accès.
-- Depuis l'introduction des comptes chorale (table `chorales` ci-dessus),
-- cette table `auth` à ligne unique désigne le compte SUPER-ADMIN — même
-- logique, juste un rôle différent, aucun changement de schéma nécessaire.
CREATE TABLE IF NOT EXISTS auth (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pool partagé de médias (logos, bannières) : n'importe quelle chorale peut
-- en uploader, toutes peuvent les réutiliser dans leurs réglages actifs
-- (table `parametres` ci-dessous). Remplace l'ancienne table à un logo par
-- emplacement, globale et unique.
CREATE TABLE IF NOT EXISTS medias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    nom TEXT,
    filename TEXT NOT NULL,
    content_type TEXT,
    donnees BLOB NOT NULL,
    chorale_id INTEGER REFERENCES chorales(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Réglages actifs PAR CHORALE (nom affiché, paroisse, contact, quelles
-- images du pool `medias` ci-dessus sont utilisées pour chaque
-- emplacement) — remplace l'ancienne ligne singleton partagée par tout le
-- site : modifier ses réglages n'influence plus les autres chorales.
CREATE TABLE IF NOT EXISTS parametres (
    chorale_id INTEGER PRIMARY KEY REFERENCES chorales(id),
    donnees TEXT NOT NULL DEFAULT '{}'
);

-- File de modération : une chorale ne supprime jamais directement un chant
-- (bibliothèque partagée par tous) ou un dépliant, elle en fait la demande ;
-- le super-admin valide (suppression réelle) ou annule (la ressource reste
-- en base mais demeure masquée pour la chorale demandeuse, voir
-- masques_chorale ci-dessous).
CREATE TABLE IF NOT EXISTS demandes_suppression (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_cible TEXT NOT NULL,
    cible_id INTEGER NOT NULL,
    chorale_demandeuse_id INTEGER NOT NULL REFERENCES chorales(id),
    statut TEXT NOT NULL DEFAULT 'en_attente',
    raison TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    traite_at TEXT
);

-- Visibilité par chorale : une ligne ici = cette chorale ne voit plus cette
-- ressource dans ses listes. Créée automatiquement dès la demande de
-- suppression (masquage immédiat, indépendant de la décision du
-- super-admin) ; retirée uniquement par une restauration explicite du
-- super-admin pour CETTE chorale précise — la bibliothèque garde la
-- ressource pour toutes les autres dans tous les cas.
CREATE TABLE IF NOT EXISTS masques_chorale (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chorale_id INTEGER NOT NULL REFERENCES chorales(id),
    type_cible TEXT NOT NULL,
    cible_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_masques_unique ON masques_chorale(chorale_id, type_cible, cible_id);

-- Messagerie privée : un seul fil par chorale, toujours avec le super-admin
-- (pas de messagerie entre chorales). Pièce jointe stockée directement sur
-- la ligne (pas le pool `medias`, qui reste réservé aux logos/bannières
-- partagés — une pièce jointe de chat est privée au fil).
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chorale_id INTEGER NOT NULL REFERENCES chorales(id),
    expediteur_type TEXT NOT NULL,
    texte TEXT,
    piece_jointe_donnees BLOB,
    piece_jointe_content_type TEXT,
    piece_jointe_filename TEXT,
    lu INTEGER NOT NULL DEFAULT 0,
    parent_id INTEGER REFERENCES messages(id),
    reactions TEXT NOT NULL DEFAULT '{}',
    modifie INTEGER NOT NULL DEFAULT 0,
    supprime INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_chorale ON messages(chorale_id, created_at);

-- Catégories de chants ajoutées par les utilisateurs (via "Autre" -> saisie
-- libre) en plus de la liste fixe CATEGORIES_CHANTS (constants.py) — pour
-- qu'une nouvelle catégorie devienne utilisable partout et persiste, comme
-- les catégories intégrées.
CREATE TABLE IF NOT EXISTS categories_personnalisees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL UNIQUE,
    cree_par INTEGER REFERENCES chorales(id),
    statut TEXT NOT NULL DEFAULT 'en_attente',
    motif_rejet TEXT,
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
    mots_cles TEXT NOT NULL DEFAULT '[]',
    actif INTEGER NOT NULL DEFAULT 1,
    favori INTEGER NOT NULL DEFAULT 0,
    chant_principal INTEGER NOT NULL DEFAULT 0,
    duree_estimee TEXT,
    tonalite TEXT,
    remarques TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chants_titre ON chants(titre);
CREATE INDEX IF NOT EXISTS idx_chants_categorie ON chants(categorie);
CREATE INDEX IF NOT EXISTS idx_chants_code_reference ON chants(code_reference);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chants_slug ON chants(slug);

-- Comptes chorale : voir le commentaire équivalent dans SCHEMA_SQLITE.
-- Définie avant `feuillets`/`medias`/`parametres` puisqu'ils la référencent.
CREATE TABLE IF NOT EXISTS chorales (
    id SERIAL PRIMARY KEY,
    nom TEXT NOT NULL,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    suppression_date_butoir TEXT,
    suppression_raison TEXT,
    suppression_delai_jours INTEGER,
    suppression_demande_revision INTEGER NOT NULL DEFAULT 0,
    suppression_revision_raison TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chorales_username ON chorales(username);

CREATE TABLE IF NOT EXISTS feuillets (
    id SERIAL PRIMARY KEY,
    date TEXT NOT NULL,
    lieu TEXT,
    lectures TEXT NOT NULL DEFAULT '{}',
    moments TEXT NOT NULL DEFAULT '[]',
    priere_active INTEGER NOT NULL DEFAULT 0,
    priere_texte TEXT,
    taille_texte_manuelle REAL,
    one_page_mode INTEGER NOT NULL DEFAULT 0,
    banniere_active INTEGER NOT NULL DEFAULT 1,
    chorale_id INTEGER REFERENCES chorales(id),
    clone_de_id INTEGER REFERENCES feuillets(id),
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
    cree_par INTEGER REFERENCES chorales(id),
    statut TEXT NOT NULL DEFAULT 'en_attente',
    motif_rejet TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Pool partagé de médias (logos, bannières) : voir le commentaire équivalent
-- dans SCHEMA_SQLITE. Remplace l'ancienne table à un logo par emplacement,
-- globale et unique (colonne `slot` PRIMARY KEY) — voir
-- _renommer_tables_legacy_postgres() pour la migration de l'ancienne table.
CREATE TABLE IF NOT EXISTS medias (
    id SERIAL PRIMARY KEY,
    type TEXT NOT NULL,
    nom TEXT,
    filename TEXT NOT NULL,
    content_type TEXT,
    donnees BYTEA NOT NULL,
    chorale_id INTEGER REFERENCES chorales(id),
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Réglages actifs PAR CHORALE — voir le commentaire équivalent dans
-- SCHEMA_SQLITE. Remplace l'ancienne ligne singleton id=1 partagée par tout
-- le site.
CREATE TABLE IF NOT EXISTS parametres (
    chorale_id INTEGER PRIMARY KEY REFERENCES chorales(id),
    donnees TEXT NOT NULL DEFAULT '{}'
);

-- File de modération / visibilité par chorale — voir le commentaire
-- équivalent dans SCHEMA_SQLITE.
CREATE TABLE IF NOT EXISTS demandes_suppression (
    id SERIAL PRIMARY KEY,
    type_cible TEXT NOT NULL,
    cible_id INTEGER NOT NULL,
    chorale_demandeuse_id INTEGER NOT NULL REFERENCES chorales(id),
    statut TEXT NOT NULL DEFAULT 'en_attente',
    raison TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    traite_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS masques_chorale (
    id SERIAL PRIMARY KEY,
    chorale_id INTEGER NOT NULL REFERENCES chorales(id),
    type_cible TEXT NOT NULL,
    cible_id INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_masques_unique ON masques_chorale(chorale_id, type_cible, cible_id);

CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    chorale_id INTEGER NOT NULL REFERENCES chorales(id),
    expediteur_type TEXT NOT NULL,
    texte TEXT,
    piece_jointe_donnees BYTEA,
    piece_jointe_content_type TEXT,
    piece_jointe_filename TEXT,
    lu INTEGER NOT NULL DEFAULT 0,
    parent_id INTEGER REFERENCES messages(id),
    reactions TEXT NOT NULL DEFAULT '{}',
    modifie INTEGER NOT NULL DEFAULT 0,
    supprime INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_chorale ON messages(chorale_id, created_at);

ALTER TABLE feuillets ADD COLUMN IF NOT EXISTS priere_active INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feuillets ADD COLUMN IF NOT EXISTS priere_texte TEXT;
ALTER TABLE feuillets ADD COLUMN IF NOT EXISTS taille_texte_manuelle REAL;
ALTER TABLE feuillets ADD COLUMN IF NOT EXISTS chorale_id INTEGER REFERENCES chorales(id);
ALTER TABLE feuillets ADD COLUMN IF NOT EXISTS clone_de_id INTEGER REFERENCES feuillets(id);
ALTER TABLE chants ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE chants ADD COLUMN IF NOT EXISTS mots_cles TEXT NOT NULL DEFAULT '[]';
ALTER TABLE chants ADD COLUMN IF NOT EXISTS actif INTEGER NOT NULL DEFAULT 1;
ALTER TABLE chants ADD COLUMN IF NOT EXISTS favori INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chants ADD COLUMN IF NOT EXISTS chant_principal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chants ADD COLUMN IF NOT EXISTS duree_estimee TEXT;
ALTER TABLE chants ADD COLUMN IF NOT EXISTS tonalite TEXT;
ALTER TABLE chants ADD COLUMN IF NOT EXISTS remarques TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES messages(id);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reactions TEXT NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS modifie INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS supprime INTEGER NOT NULL DEFAULT 0;
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
        if colonnes:
            if "slug" not in colonnes:
                conn.execute("ALTER TABLE chants ADD COLUMN slug TEXT")
            if "mots_cles" not in colonnes:
                conn.execute("ALTER TABLE chants ADD COLUMN mots_cles TEXT NOT NULL DEFAULT '[]'")
            if "actif" not in colonnes:
                conn.execute("ALTER TABLE chants ADD COLUMN actif INTEGER NOT NULL DEFAULT 1")
            if "favori" not in colonnes:
                conn.execute("ALTER TABLE chants ADD COLUMN favori INTEGER NOT NULL DEFAULT 0")
            if "chant_principal" not in colonnes:
                conn.execute("ALTER TABLE chants ADD COLUMN chant_principal INTEGER NOT NULL DEFAULT 0")
            if "duree_estimee" not in colonnes:
                conn.execute("ALTER TABLE chants ADD COLUMN duree_estimee TEXT")
            if "tonalite" not in colonnes:
                conn.execute("ALTER TABLE chants ADD COLUMN tonalite TEXT")
            if "remarques" not in colonnes:
                conn.execute("ALTER TABLE chants ADD COLUMN remarques TEXT")

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
        if "one_page_mode" not in colonnes_feuillets:
            conn.execute("ALTER TABLE feuillets ADD COLUMN one_page_mode INTEGER NOT NULL DEFAULT 0")
        if "banniere_active" not in colonnes_feuillets:
            conn.execute("ALTER TABLE feuillets ADD COLUMN banniere_active INTEGER NOT NULL DEFAULT 1")
        if "chorale_id" not in colonnes_feuillets:
            conn.execute("ALTER TABLE feuillets ADD COLUMN chorale_id INTEGER REFERENCES chorales(id)")
        if "clone_de_id" not in colonnes_feuillets:
            conn.execute("ALTER TABLE feuillets ADD COLUMN clone_de_id INTEGER REFERENCES feuillets(id)")

        colonnes_messages = {row["name"] for row in conn.execute("PRAGMA table_info(messages)").fetchall()}
        if "parent_id" not in colonnes_messages:
            conn.execute("ALTER TABLE messages ADD COLUMN parent_id INTEGER REFERENCES messages(id)")
        if "reactions" not in colonnes_messages:
            conn.execute("ALTER TABLE messages ADD COLUMN reactions TEXT NOT NULL DEFAULT '{}'")
        if "modifie" not in colonnes_messages:
            conn.execute("ALTER TABLE messages ADD COLUMN modifie INTEGER NOT NULL DEFAULT 0")
        if "supprime" not in colonnes_messages:
            conn.execute("ALTER TABLE messages ADD COLUMN supprime INTEGER NOT NULL DEFAULT 0")

        colonnes_categories = {row["name"] for row in conn.execute("PRAGMA table_info(categories_personnalisees)").fetchall()}
        if colonnes_categories:
            if "cree_par" not in colonnes_categories:
                conn.execute("ALTER TABLE categories_personnalisees ADD COLUMN cree_par INTEGER REFERENCES chorales(id)")
            if "statut" not in colonnes_categories:
                conn.execute("ALTER TABLE categories_personnalisees ADD COLUMN statut TEXT NOT NULL DEFAULT 'en_attente'")
            if "motif_rejet" not in colonnes_categories:
                conn.execute("ALTER TABLE categories_personnalisees ADD COLUMN motif_rejet TEXT")

        colonnes_demandes = {row["name"] for row in conn.execute("PRAGMA table_info(demandes_suppression)").fetchall()}
        if colonnes_demandes and "raison" not in colonnes_demandes:
            conn.execute("ALTER TABLE demandes_suppression ADD COLUMN raison TEXT")

        colonnes_chorales = {row["name"] for row in conn.execute("PRAGMA table_info(chorales)").fetchall()}
        if colonnes_chorales:
            if "suppression_date_butoir" not in colonnes_chorales:
                conn.execute("ALTER TABLE chorales ADD COLUMN suppression_date_butoir TEXT")
            if "suppression_raison" not in colonnes_chorales:
                conn.execute("ALTER TABLE chorales ADD COLUMN suppression_raison TEXT")
            if "suppression_delai_jours" not in colonnes_chorales:
                conn.execute("ALTER TABLE chorales ADD COLUMN suppression_delai_jours INTEGER")
            if "suppression_demande_revision" not in colonnes_chorales:
                conn.execute("ALTER TABLE chorales ADD COLUMN suppression_demande_revision INTEGER NOT NULL DEFAULT 0")
            if "suppression_revision_raison" not in colonnes_chorales:
                conn.execute("ALTER TABLE chorales ADD COLUMN suppression_revision_raison TEXT")

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

        _migrer_vers_multi_chorale(conn)


def _renommer_tables_legacy_postgres(conn) -> None:
    """Avant la création du nouveau schéma multi-chorale : si `medias`/
    `parametres` existent encore avec leur ANCIENNE structure (mono-tenant,
    une ligne/slot globale — colonne `chorale_id` absente), on les renomme
    de côté plutôt que de les laisser bloquer silencieusement la création
    des nouvelles tables du même nom (CREATE TABLE IF NOT EXISTS ne touche
    pas une table déjà là, même de structure différente). Sur une base
    neuve qui n'a jamais connu l'ancien modèle, ces tables n'existent pas
    encore : `table_columns` renvoie alors un ensemble vide et rien ne se
    passe — idempotent par construction, pas besoin de flag séparé."""
    colonnes_parametres = table_columns(conn, "parametres")
    if colonnes_parametres and "chorale_id" not in colonnes_parametres:
        conn.execute("ALTER TABLE parametres RENAME TO parametres_legacy_singleton")
    colonnes_medias = table_columns(conn, "medias")
    if colonnes_medias and "chorale_id" not in colonnes_medias:
        conn.execute("ALTER TABLE medias RENAME TO medias_legacy_slot")


def _migrer_vers_multi_chorale(conn) -> None:
    """Migration unique, idempotente (ne fait rien si une chorale existe déjà) :
    bascule le modèle mono-tenant historique vers le modèle multi-chorale —
    crée une première chorale "Chorale Sainte Cécile" et lui rattache toutes
    les données existantes (dépliants, réglages, logos/bannière)."""
    if conn.execute("SELECT 1 FROM chorales LIMIT 1").fetchone():
        return

    import secrets

    from . import auth as auth_module  # import différé, même raison qu'ailleurs dans ce module

    mot_de_passe = secrets.token_urlsafe(12)
    chorale_id = insert_returning_id(
        conn,
        "INSERT INTO chorales (nom, username, password_hash, must_change_password) VALUES (?, ?, ?, 1)",
        ("Chorale Sainte Cécile", "chorale-sainte-cecile", auth_module.hash_password(mot_de_passe)),
    )
    print(
        "\n" + "=" * 60 +
        "\nMigration multi-chorale : première chorale créée automatiquement"
        "\nNom : Chorale Sainte Cécile"
        "\nIdentifiant : chorale-sainte-cecile"
        f"\nMot de passe initial (à changer immédiatement) : {mot_de_passe}"
        "\n(les dépliants/réglages/logos existants lui ont été rattachés)"
        "\n" + "=" * 60 + "\n"
    )

    conn.execute("UPDATE feuillets SET chorale_id = ? WHERE chorale_id IS NULL", (chorale_id,))

    from . import config as config_module  # import différé : config.py importe get_connection depuis ce module

    config_module.migrer_donnees_legacy_vers_chorale(conn, chorale_id)


def _init_postgres() -> None:
    with get_connection() as conn:
        _renommer_tables_legacy_postgres(conn)
        
        # Postgres category moderation columns migration
        conn.execute("ALTER TABLE categories_personnalisees ADD COLUMN IF NOT EXISTS cree_par INTEGER REFERENCES chorales(id)")
        conn.execute("ALTER TABLE categories_personnalisees ADD COLUMN IF NOT EXISTS statut TEXT NOT NULL DEFAULT 'en_attente'")
        conn.execute("ALTER TABLE categories_personnalisees ADD COLUMN IF NOT EXISTS motif_rejet TEXT")
        conn.execute("ALTER TABLE demandes_suppression ADD COLUMN IF NOT EXISTS raison TEXT")

        conn.execute("ALTER TABLE chorales ADD COLUMN IF NOT EXISTS suppression_date_butoir TEXT")
        conn.execute("ALTER TABLE chorales ADD COLUMN IF NOT EXISTS suppression_raison TEXT")
        conn.execute("ALTER TABLE chorales ADD COLUMN IF NOT EXISTS suppression_delai_jours INTEGER")
        conn.execute("ALTER TABLE chorales ADD COLUMN IF NOT EXISTS suppression_demande_revision INTEGER NOT NULL DEFAULT 0")
        conn.execute("ALTER TABLE chorales ADD COLUMN IF NOT EXISTS suppression_revision_raison TEXT")

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

        _migrer_vers_multi_chorale(conn)


@contextmanager
def get_connection():
    if BACKEND == "postgres":
        import time
        max_retries = 5
        delay = 1.0
        for attempt in range(max_retries):
            try:
                conn = psycopg2.connect(DATABASE_URL)
                break
            except psycopg2.OperationalError as e:
                if attempt == max_retries - 1:
                    raise e
                time.sleep(delay)
                delay *= 2
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


def definitivement_supprimer_chorale(chorale_id: int) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM feuillets WHERE chorale_id = ?", (chorale_id,))
        conn.execute("DELETE FROM parametres WHERE chorale_id = ?", (chorale_id,))
        conn.execute("DELETE FROM categories_personnalisees WHERE cree_par = ?", (chorale_id,))
        conn.execute("DELETE FROM messages WHERE chorale_id = ?", (chorale_id,))
        conn.execute("DELETE FROM chorales WHERE id = ?", (chorale_id,))


def nettoyer_chorales_supprimees() -> None:
    from datetime import datetime, timezone
    now_str = datetime.now(timezone.utc).isoformat()
    with get_connection() as conn:
        try:
            rows = conn.execute(
                "SELECT id FROM chorales WHERE suppression_date_butoir IS NOT NULL AND suppression_date_butoir <= ?",
                (now_str,)
            ).fetchall()
        except Exception:
            return
        for r in rows:
            definitivement_supprimer_chorale(r["id"])
