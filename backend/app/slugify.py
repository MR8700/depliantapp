"""Génère des identifiants lisibles (slugs) à partir des titres de chants,
utilisés comme identifiant humain (ex. 'je-loue-ton-nom') à la place de simples
numéros. Unicité garantie par suffixe -2, -3... en cas de titres identiques."""
import re
import unicodedata


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or "chant"


def unique_slug(titre: str, existing: set[str]) -> str:
    base = slugify(titre)
    slug = base
    i = 2
    while slug in existing:
        slug = f"{base}-{i}"
        i += 1
    return slug
