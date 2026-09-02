"""Vérification (jamais signature) des licences mobiles hors-ligne
("essence vivante") -- la clé privée Ed25519 vit uniquement sur l'appareil
de l'admin (voir mobile/src/licence/adminSignature.ts), jamais sur ce
serveur. Ce module ne détient que la clé PUBLIQUE correspondante, utilisée
pour re-vérifier un blob déjà signé par le client à l'ingestion (défense en
profondeur -- l'autorité réelle reste toujours l'appli mobile de la
chorale, qui revérifie le même blob entièrement en local avant d'y faire
confiance, indépendamment de ce que ce serveur en pense).

Format du blob (doit rester identique à mobile/src/licence/verification.ts) :
  base64url(JSON des champs, ordre fixe) + "." + base64url(signature Ed25519)
  champs = [v, licence_uid, chorale_id, chorale_nom, dev_max, quota_feuillets,
            expire_le, seed, issued_at]
"""
import base64
import json
import os
from dataclasses import dataclass
from typing import Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from .db import get_connection

# Valeur par défaut à remplacer par la clé publique réellement générée sur
# l'appareil admin (écran "Clé d'administration" côté mobile, rôle super) --
# voir mobile/src/licence/adminSignature.ts::genererCleAdmin. Peut aussi être
# fournie via la variable d'environnement DEPLIANTAPP_LICENCE_CLE_PUBLIQUE
# pour éviter un déploiement rien que pour ça.
_CLE_PUBLIQUE_B64_PAR_DEFAUT = "REMPLACER_PAR_LA_CLE_PUBLIQUE_ADMIN_BASE64"


def _cle_publique_b64() -> str:
    configured = os.environ.get("DEPLIANTAPP_LICENCE_CLE_PUBLIQUE")
    if configured:
        return configured
    with get_connection() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS licence_cle_publique (id INTEGER PRIMARY KEY, cle_publique TEXT NOT NULL)")
        row = conn.execute("SELECT cle_publique FROM licence_cle_publique WHERE id = 1").fetchone()
    return row["cle_publique"] if row else _CLE_PUBLIQUE_B64_PAR_DEFAUT


def enregistrer_cle_publique(cle_publique_b64: str) -> None:
    """Ancre la clé de signature choisie par le super-admin dans la base."""
    try:
        if len(base64.b64decode(cle_publique_b64, validate=True)) != 32:
            raise ValueError
    except ValueError as exc:
        raise ValueError("Clé publique Ed25519 invalide") from exc
    with get_connection() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS licence_cle_publique (id INTEGER PRIMARY KEY, cle_publique TEXT NOT NULL)")
        row = conn.execute("SELECT cle_publique FROM licence_cle_publique WHERE id = 1").fetchone()
        if row and row["cle_publique"] != cle_publique_b64:
            raise ValueError("Une autre clé de licence est déjà enregistrée sur le serveur")
        if not row:
            conn.execute("INSERT INTO licence_cle_publique (id, cle_publique) VALUES (1, ?)", (cle_publique_b64,))


def cle_publique_active() -> str:
    return _cle_publique_b64()


def _b64url_decode(valeur: str) -> bytes:
    valeur += "=" * (-len(valeur) % 4)
    return base64.urlsafe_b64decode(valeur)


@dataclass(frozen=True)
class LicenceVerifiee:
    licence_uid: str
    chorale_id: int
    chorale_nom: str
    dev_max: int
    quota_feuillets: Optional[int]
    expire_le: Optional[str]
    seed: str
    issued_at: int


def verifier_blob(blob: str) -> Optional[LicenceVerifiee]:
    """Décode + vérifie la signature Ed25519 d'un blob de licence produit par
    l'appli admin. Renvoie None pour tout échec (format invalide, signature
    ne correspondant pas, clé publique pas encore configurée) -- jamais
    d'exception : ce n'est qu'une vérification de bookkeeping, pas
    l'autorité qui décide si la chorale peut utiliser l'appli."""
    cle_publique_b64 = _cle_publique_b64()
    if not cle_publique_b64 or cle_publique_b64 == _CLE_PUBLIQUE_B64_PAR_DEFAUT:
        return None
    try:
        payload_b64, signature_b64 = blob.split(".", 1)
        payload_bytes = _b64url_decode(payload_b64)
        signature = _b64url_decode(signature_b64)
        cle_publique = Ed25519PublicKey.from_public_bytes(base64.b64decode(cle_publique_b64))
        cle_publique.verify(signature, payload_bytes)
        champs = json.loads(payload_bytes)
        v, licence_uid, chorale_id, chorale_nom, dev_max, quota_feuillets, expire_le, seed, issued_at = champs
    except (ValueError, InvalidSignature, TypeError, KeyError):
        return None
    if v != 1 or not isinstance(licence_uid, str) or not isinstance(seed, str):
        return None
    return LicenceVerifiee(
        licence_uid=licence_uid, chorale_id=chorale_id, chorale_nom=chorale_nom, dev_max=dev_max,
        quota_feuillets=quota_feuillets, expire_le=expire_le, seed=seed, issued_at=issued_at,
    )
