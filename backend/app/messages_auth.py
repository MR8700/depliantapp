"""Authentification dédiée aux appels chorale vers /messages/* -- seule
fonctionnalité qui a le droit d'exiger une connexion pour un compte chorale
100% hors-ligne (licence "essence vivante", voir app/licence_signature.py).
Un appareil chorale n'a plus jamais de session/jeton Bearer classique (plus
de login, voir App.tsx côté mobile) : il prouve son identité par possession
du `seed` de sa licence -- un secret symétrique connu uniquement de
l'appareil et de ce serveur (jamais transmis en clair sur le réseau, jamais
fourni par le client tel quel : ce serveur recalcule le HMAC lui-même à
partir de SA PROPRE copie du seed, stockée en base à la création de la
licence -- voir licences.py::creer_licence)."""
import hashlib
import hmac
import time

from . import auth, db
from .licences import _licence_expiree

_TOLERANCE_SECONDES = 300


def identite_depuis_preuve_chorale(request) -> auth.Identite | None:
    try:
        chorale_id = int(request.headers["x-chorale-id"])
        licence_id_ou_uid = request.headers["x-licence-id"]
        horodatage = int(request.headers["x-chorale-proof-timestamp"])
        nonce = request.headers["x-chorale-proof-nonce"]
        preuve = request.headers["x-chorale-proof"]
    except (KeyError, ValueError):
        return None
    # Un UUID v4 fait 36 caractères. Cette borne évite de transformer la
    # table anti-rejeu en stockage arbitraire via un en-tête surdimensionné.
    if not 16 <= len(nonce) <= 128:
        return None
    maintenant = int(time.time())
    if abs(maintenant - horodatage) > _TOLERANCE_SECONDES:
        return None
    # La preuve est liée à la méthode et au chemin : un en-tête capturé sur
    # une lecture ne peut pas être transformé en envoi ou suppression.
    message = f"messages:{chorale_id}:{licence_id_ou_uid}:{horodatage}:{nonce}:{request.method}:{request.url.path}"
    with db.get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM licences WHERE licence_uid = ? AND chorale_id = ? AND statut = 'active'",
            (licence_id_ou_uid, chorale_id),
        ).fetchone()
    if not row or not row["seed"]:
        return None
    # Messagerie est la seule fonctionnalité qui vérifie l'état de la
    # licence EN DIRECT (tout le reste est 100% hors-ligne, voir
    # licences.py::revoquer_licence) -- l'expiration doit donc être
    # appliquée ici, pas seulement affichée côté mobile.
    if _licence_expiree(dict(row)):
        return None
    attendu = hmac.new(
        bytes.fromhex(row["seed"]),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(attendu, preuve):
        return None
    # INSERT atomique : même si deux rejouements arrivent simultanément,
    # une seule transaction gagne. Le hash évite de stocker le nonce brut.
    nonce_hash = hashlib.sha256(nonce.encode("utf-8")).hexdigest()
    with db.get_connection() as conn:
        conn.execute("DELETE FROM message_proof_nonces WHERE expires_at < ?", (maintenant,))
        insertion = conn.execute(
            "INSERT INTO message_proof_nonces (nonce_hash, expires_at) VALUES (?, ?) ON CONFLICT (nonce_hash) DO NOTHING",
            (nonce_hash, maintenant + _TOLERANCE_SECONDES),
        )
        if insertion.rowcount != 1:
            return None
    chorale = auth.get_chorale(chorale_id)
    if not chorale:
        return None
    return auth.Identite(type="chorale", compte_id=chorale_id, username=chorale["username"])
