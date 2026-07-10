import shutil
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .paths import DATA_DIR
from .slugify import unique_slug

DB_PATH = DATA_DIR / "chants.db"
SEED_DB_PATH = Path(__file__).resolve().parent.parent / "seed_data" / "chants.db"

SCHEMA = """
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
-- paroles) : table FTS5 tenue à jour automatiquement par triggers.
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
"""


def init_db() -> None:
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

        conn.executescript(SCHEMA)

        # migration : ajoute les colonnes du widget Prière si la base existait
        # avant son introduction (le CREATE TABLE IF NOT EXISTS ci-dessus ne
        # touche pas une table déjà créée).
        colonnes_feuillets = {row["name"] for row in conn.execute("PRAGMA table_info(feuillets)").fetchall()}
        if "priere_active" not in colonnes_feuillets:
            conn.execute("ALTER TABLE feuillets ADD COLUMN priere_active INTEGER NOT NULL DEFAULT 0")
        if "priere_texte" not in colonnes_feuillets:
            conn.execute("ALTER TABLE feuillets ADD COLUMN priere_texte TEXT")

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


@contextmanager
def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
