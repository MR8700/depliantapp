"""Licences mobiles : gate d'activation de l'app React Native, avant tout
login classique (voir routers/licences.py pour les endpoints). Une licence
est rattachée à une chorale et partagée par ses appareils jusqu'à
max_appareils. Jeton d'activation signé HMAC, même logique que les cookies
de session (voir auth.py) -- uniquement la bibliothèque standard."""
import base64
import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from . import auth, db
from .db import get_connection, insert_returning_id

# Alphabet sans 0/O/1/I/L (ambigus à recopier depuis un écran ou un papier).
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
ACTIVATION_TOKEN_DUREE_SECONDES = 90 * 24 * 3600  # 90 jours


def generer_code() -> str:
    groupes = ["".join(secrets.choice(_ALPHABET) for _ in range(4)) for _ in range(4)]
    return "-".join(groupes)


def creer_licence(chorale_id: Optional[int], max_appareils: int = 5, expire_le: Optional[str] = None) -> dict:
    code = generer_code()
    with get_connection() as conn:
        licence_id = insert_returning_id(
            conn,
            "INSERT INTO licences (code, chorale_id, max_appareils, expire_le) VALUES (?, ?, ?, ?)",
            (code, chorale_id, max_appareils, expire_le),
        )
    return get_licence(licence_id)


def get_licence(licence_id: int) -> Optional[dict]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM licences WHERE id = ?", (licence_id,)).fetchone()
        return dict(row) if row else None


def get_licence_par_code(code: str) -> Optional[dict]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM licences WHERE code = ?", (code.strip().upper(),)).fetchone()
        return dict(row) if row else None


def lister_licences(chorale_id: Optional[int] = None) -> list[dict]:
    with get_connection() as conn:
        if chorale_id is not None:
            rows = conn.execute(
                "SELECT l.*, c.nom AS chorale_nom FROM licences l "
                "LEFT JOIN chorales c ON c.id = l.chorale_id "
                "WHERE l.chorale_id = ? ORDER BY l.created_at DESC",
                (chorale_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT l.*, c.nom AS chorale_nom FROM licences l "
                "LEFT JOIN chorales c ON c.id = l.chorale_id "
                "ORDER BY l.created_at DESC"
            ).fetchall()
        return [dict(r) for r in rows]


def lister_activations(licence_id: int) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM licence_activations WHERE licence_id = ? ORDER BY active_le DESC", (licence_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def revoquer_licence(licence_id: int) -> None:
    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        conn.execute(f"UPDATE licences SET statut = 'revoquee', updated_at = {horodatage} WHERE id = ?", (licence_id,))


def reactiver_licence(licence_id: int) -> None:
    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        conn.execute(f"UPDATE licences SET statut = 'active', updated_at = {horodatage} WHERE id = ?", (licence_id,))


def regenerer_code(licence_id: int) -> str:
    """Change le code d'une licence existante (perte/fuite du code) sans
    toucher aux appareils déjà activés, rattachés à licence_id et non au
    code lui-même."""
    nouveau_code = generer_code()
    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        conn.execute(f"UPDATE licences SET code = ?, updated_at = {horodatage} WHERE id = ?", (nouveau_code, licence_id))
    return nouveau_code


def revoquer_activation(licence_id: int, appareil_id: str) -> None:
    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        conn.execute(
            f"UPDATE licence_activations SET revoque_le = {horodatage} WHERE licence_id = ? AND appareil_id = ?",
            (licence_id, appareil_id),
        )


def _licence_expiree(licence: dict) -> bool:
    if not licence.get("expire_le"):
        return False
    try:
        expire_le = datetime.fromisoformat(str(licence["expire_le"]).replace("Z", "+00:00"))
        if expire_le.tzinfo is None:
            expire_le = expire_le.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) > expire_le
    except ValueError:
        return False


@dataclass(frozen=True)
class ResultatActivation:
    ok: bool
    erreur: Optional[str] = None
    jeton: Optional[str] = None
    chorale_id: Optional[int] = None
    chorale_nom: Optional[str] = None


def activer(code: str, appareil_id: str, appareil_nom: Optional[str]) -> ResultatActivation:
    licence = get_licence_par_code(code)
    if not licence:
        return ResultatActivation(ok=False, erreur="Code de licence invalide")
    if licence["statut"] != "active":
        return ResultatActivation(ok=False, erreur="Licence révoquée")
    if _licence_expiree(licence):
        return ResultatActivation(ok=False, erreur="Licence expirée")
    if not licence["chorale_id"]:
        return ResultatActivation(ok=False, erreur="Licence pas encore attribuée à une chorale")

    activations = [a for a in lister_activations(licence["id"]) if not a["revoque_le"]]
    deja_active = next((a for a in activations if a["appareil_id"] == appareil_id), None)
    if not deja_active and len(activations) >= licence["max_appareils"]:
        return ResultatActivation(ok=False, erreur="Nombre maximal d'appareils atteint pour cette licence")

    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        if deja_active:
            conn.execute(
                f"UPDATE licence_activations SET dernier_contact_le = {horodatage}, appareil_nom = ? "
                f"WHERE licence_id = ? AND appareil_id = ?",
                (appareil_nom, licence["id"], appareil_id),
            )
        else:
            insert_returning_id(
                conn,
                "INSERT INTO licence_activations (licence_id, appareil_id, appareil_nom) VALUES (?, ?, ?)",
                (licence["id"], appareil_id, appareil_nom),
            )

    chorale = auth.get_chorale(licence["chorale_id"])
    jeton = create_activation_token(licence["id"], licence["chorale_id"], appareil_id)
    return ResultatActivation(
        ok=True, jeton=jeton, chorale_id=licence["chorale_id"],
        chorale_nom=chorale["nom"] if chorale else None,
    )


# --- Jeton d'activation -----------------------------------------------

def _sign(payload: str) -> str:
    return hmac.new(auth._secret_key(), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def create_activation_token(licence_id: int, chorale_id: int, appareil_id: str) -> str:
    expiration = int(time.time()) + ACTIVATION_TOKEN_DUREE_SECONDES
    payload = f"licence:{licence_id}:{chorale_id}:{appareil_id}:{expiration}"
    signature = _sign(payload)
    brut = f"{payload}:{signature}"
    return base64.urlsafe_b64encode(brut.encode("utf-8")).decode("ascii")


@dataclass(frozen=True)
class ActivationValidee:
    licence_id: int
    chorale_id: int
    appareil_id: str


def _decode_token(jeton: str) -> Optional[ActivationValidee]:
    try:
        brut = base64.urlsafe_b64decode(jeton.encode("ascii")).decode("utf-8")
        avant_signature, signature = brut.rsplit(":", 1)
        prefixe, licence_id_str, chorale_id_str, appareil_id, expiration_str = avant_signature.split(":", 4)
        licence_id = int(licence_id_str)
        chorale_id = int(chorale_id_str)
        expiration = int(expiration_str)
    except (ValueError, UnicodeDecodeError):
        return None
    if prefixe != "licence":
        return None
    payload = f"{prefixe}:{licence_id}:{chorale_id}:{appareil_id}:{expiration}"
    if not hmac.compare_digest(_sign(payload), signature):
        return None
    if time.time() > expiration:
        return None
    return ActivationValidee(licence_id=licence_id, chorale_id=chorale_id, appareil_id=appareil_id)


def verifier_activation(jeton: str) -> Optional[ActivationValidee]:
    """Valide le jeton ET son état actuel en base : une révocation doit
    prendre effet avant l'expiration naturelle du jeton (90 jours), sinon un
    appareil perdu/volé resterait actif jusqu'à cette échéance malgré la
    révocation côté admin."""
    decode = _decode_token(jeton)
    if not decode:
        return None
    licence = get_licence(decode.licence_id)
    if not licence or licence["statut"] != "active" or licence["chorale_id"] != decode.chorale_id:
        return None
    if _licence_expiree(licence):
        return None
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM licence_activations WHERE licence_id = ? AND appareil_id = ?",
            (decode.licence_id, decode.appareil_id),
        ).fetchone()
    if not row or row["revoque_le"]:
        return None
    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        conn.execute(
            f"UPDATE licence_activations SET dernier_contact_le = {horodatage} WHERE licence_id = ? AND appareil_id = ?",
            (decode.licence_id, decode.appareil_id),
        )
    return decode
