import io
import json
from pathlib import Path
from typing import Optional

from reportlab.lib.utils import ImageReader

from . import db
from .paths import DATA_DIR

CONFIG_PATH = DATA_DIR / "config.json"
UPLOADS_DIR = DATA_DIR / "uploads"

# Emplacements d'image configurables dans l'en-tête/pied de page du feuillet,
# calqués sur la mise en page réelle des dépliants (deux logos circulaires en
# en-tête + une bannière décorative en bas de page).
IMAGE_SLOTS = ["logo_gauche", "logo_droit", "banniere_bas"]

# priere_texte_defaut : texte par défaut du widget « Prière pour le Burkina
# Faso », utilisé quand un feuillet a priere_active=True sans texte
# personnalisé. Vide ici signifie : retomber sur le texte figé de
# widgets.py::DEFAULT_PRIERE_TEXTE.
DEFAULTS = {
    "chorale": "Chorale Sainte Cécile",
    "paroisse": "CCB St Thomas d'Aquin de la Cité Universitaire de Kossodo",
    "contact": "",
    "annonce": "",
    "priere_texte_defaut": "",
    **{f"{slot}_filename": None for slot in IMAGE_SLOTS},
}


def _lire_config_brute() -> dict:
    """Réglages tels qu'enregistrés (sans les DEFAULTS fusionnés par-dessus) —
    Postgres (table `parametres`, survit aux redéploiements) si disponible,
    sinon config.json sur disque local (suffisant pour le développement)."""
    if db.BACKEND == "postgres":
        with db.get_connection() as conn:
            row = conn.execute("SELECT donnees FROM parametres WHERE id = 1").fetchone()
        return json.loads(row["donnees"]) if row else {}
    if not CONFIG_PATH.exists():
        return {}
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def get_config() -> dict:
    return {**DEFAULTS, **_lire_config_brute()}


def save_config(data: dict) -> dict:
    """Fusionne `data` par-dessus la config existante (pas par-dessus les seuls
    DEFAULTS) pour qu'une sauvegarde partielle (ex: juste une image) n'efface pas
    le reste des réglages déjà personnalisés."""
    merged_brut = {**_lire_config_brute(), **data}
    if db.BACKEND == "postgres":
        with db.get_connection() as conn:
            conn.execute(
                "INSERT INTO parametres (id, donnees) VALUES (1, ?) "
                "ON CONFLICT (id) DO UPDATE SET donnees = EXCLUDED.donnees",
                (json.dumps(merged_brut, ensure_ascii=False),),
            )
    else:
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(json.dumps(merged_brut, ensure_ascii=False, indent=2), encoding="utf-8")
    return {**DEFAULTS, **merged_brut}


def _check_slot(slot: str) -> None:
    if slot not in IMAGE_SLOTS:
        raise ValueError(f"Emplacement d'image inconnu : {slot}")


def save_image(slot: str, filename: str, content: bytes, content_type: Optional[str] = None) -> dict:
    _check_slot(slot)
    if db.BACKEND == "postgres":
        with db.get_connection() as conn:
            conn.execute(
                "INSERT INTO medias (slot, filename, content_type, donnees, updated_at) "
                "VALUES (?, ?, ?, ?, now()) "
                "ON CONFLICT (slot) DO UPDATE SET filename=EXCLUDED.filename, "
                "content_type=EXCLUDED.content_type, donnees=EXCLUDED.donnees, updated_at=now()",
                (slot, filename, content_type, db.binary(content)),
            )
        return save_config({f"{slot}_filename": filename})

    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(filename).suffix.lower() or ".png"
    image_name = f"{slot}{suffix}"
    for old in UPLOADS_DIR.glob(f"{slot}.*"):
        old.unlink(missing_ok=True)
    (UPLOADS_DIR / image_name).write_bytes(content)
    return save_config({f"{slot}_filename": image_name})


def get_image_path(slot: str) -> Optional[Path]:
    """Chemin local de l'image (SQLite/développement uniquement — sur
    Postgres, voir get_image_bytes)."""
    _check_slot(slot)
    filename = get_config().get(f"{slot}_filename")
    if not filename:
        return None
    path = UPLOADS_DIR / filename
    return path if path.exists() else None


def get_image_bytes(slot: str) -> Optional[tuple[bytes, str]]:
    """(contenu, content_type) de l'image stockée en base (Postgres uniquement)."""
    _check_slot(slot)
    with db.get_connection() as conn:
        row = conn.execute("SELECT donnees, content_type FROM medias WHERE slot = ?", (slot,)).fetchone()
    if not row:
        return None
    return bytes(row["donnees"]), row["content_type"] or "application/octet-stream"


def get_image_reader(slot: str) -> Optional[ImageReader]:
    """Image prête à être dessinée par ReportLab (`canvas.drawImage`), quel
    que soit le backend de stockage — c'est le point d'entrée à utiliser
    pour le rendu PDF (contrairement à get_image_path, qui ne fonctionne
    qu'en SQLite : l'appeler directement depuis le rendu faisait
    disparaître logos/bannière en silence sur Postgres, get_image_path y
    renvoyant toujours None puisque save_image n'y écrit jamais sur
    disque)."""
    if db.BACKEND == "postgres":
        result = get_image_bytes(slot)
        if not result:
            return None
        content, _content_type = result
        return ImageReader(io.BytesIO(content))
    path = get_image_path(slot)
    return ImageReader(str(path)) if path else None


def delete_image(slot: str) -> dict:
    _check_slot(slot)
    if db.BACKEND == "postgres":
        with db.get_connection() as conn:
            conn.execute("DELETE FROM medias WHERE slot = ?", (slot,))
        return save_config({f"{slot}_filename": None})
    for old in UPLOADS_DIR.glob(f"{slot}.*"):
        old.unlink(missing_ok=True)
    return save_config({f"{slot}_filename": None})
