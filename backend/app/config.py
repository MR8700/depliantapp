import json
from pathlib import Path
from typing import Optional

from .paths import DATA_DIR

CONFIG_PATH = DATA_DIR / "config.json"
UPLOADS_DIR = DATA_DIR / "uploads"

# Emplacements d'image configurables dans l'en-tête/pied de page du feuillet,
# calqués sur la mise en page réelle des dépliants (deux logos circulaires en
# en-tête + une bannière décorative en bas de page).
IMAGE_SLOTS = ["logo_gauche", "logo_droit", "banniere_bas"]

DEFAULTS = {
    "chorale": "Chorale Sainte Cécile",
    "paroisse": "CCB St Thomas d'Aquin de la Cité Universitaire de Kossodo",
    "contact": "",
    **{f"{slot}_filename": None for slot in IMAGE_SLOTS},
}


def get_config() -> dict:
    if not CONFIG_PATH.exists():
        save_config(DEFAULTS)
        return dict(DEFAULTS)
    return {**DEFAULTS, **json.loads(CONFIG_PATH.read_text(encoding="utf-8"))}


def save_config(data: dict) -> dict:
    """Fusionne `data` par-dessus la config existante (pas par-dessus les seuls
    DEFAULTS) pour qu'une sauvegarde partielle (ex: juste une image) n'efface pas
    le reste des réglages déjà personnalisés."""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    existing = json.loads(CONFIG_PATH.read_text(encoding="utf-8")) if CONFIG_PATH.exists() else {}
    merged = {**DEFAULTS, **existing, **data}
    CONFIG_PATH.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    return merged


def _check_slot(slot: str) -> None:
    if slot not in IMAGE_SLOTS:
        raise ValueError(f"Emplacement d'image inconnu : {slot}")


def save_image(slot: str, filename: str, content: bytes) -> dict:
    _check_slot(slot)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(filename).suffix.lower() or ".png"
    image_name = f"{slot}{suffix}"
    for old in UPLOADS_DIR.glob(f"{slot}.*"):
        old.unlink(missing_ok=True)
    (UPLOADS_DIR / image_name).write_bytes(content)
    return save_config({f"{slot}_filename": image_name})


def get_image_path(slot: str) -> Optional[Path]:
    _check_slot(slot)
    filename = get_config().get(f"{slot}_filename")
    if not filename:
        return None
    path = UPLOADS_DIR / filename
    return path if path.exists() else None


def delete_image(slot: str) -> dict:
    _check_slot(slot)
    for old in UPLOADS_DIR.glob(f"{slot}.*"):
        old.unlink(missing_ok=True)
    return save_config({f"{slot}_filename": None})
