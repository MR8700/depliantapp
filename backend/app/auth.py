"""Authentification à compte unique partagé (pas de gestion multi-utilisateur) :
un identifiant/mot de passe protège tout le site, avec changement obligatoire du
mot de passe par défaut à la première connexion. Hachage PBKDF2 et cookies de
session signés en HMAC — uniquement la bibliothèque standard, pas de dépendance
supplémentaire pour une fonctionnalité de cette taille."""
import base64
import hashlib
import hmac
import os
import secrets
import time
from datetime import datetime, timezone
from typing import Optional

from .db import get_connection
from .paths import DATA_DIR

DEFAULT_USERNAME = "admin"

COOKIE_NAME = "depliantapp_session"
SESSION_DUREE_SECONDES = 30 * 24 * 3600  # 30 jours

_PBKDF2_ITERATIONS = 260_000
_SECRET_KEY_PATH = DATA_DIR / "secret_key.txt"
_MOT_DE_PASSE_INITIAL_PATH = DATA_DIR / "mot_de_passe_initial.txt"


def _secret_key() -> bytes:
    """Clé de signature des cookies de session. Priorité à la variable
    d'environnement DEPLIANTAPP_SECRET_KEY (recommandé en production, ex.
    Render : ne dépend d'aucun disque et survit donc à tout redéploiement).
    À défaut, une clé est générée une fois et persistée dans DATA_DIR."""
    env = os.environ.get("DEPLIANTAPP_SECRET_KEY")
    if env:
        return env.encode("utf-8")
    if _SECRET_KEY_PATH.exists():
        return _SECRET_KEY_PATH.read_text(encoding="utf-8").strip().encode("utf-8")
    cle = secrets.token_hex(32)
    _SECRET_KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    _SECRET_KEY_PATH.write_text(cle, encoding="utf-8")
    return cle.encode("utf-8")


def hash_password(mot_de_passe: str) -> str:
    sel = secrets.token_hex(16)
    empreinte = hashlib.pbkdf2_hmac("sha256", mot_de_passe.encode("utf-8"), sel.encode("utf-8"), _PBKDF2_ITERATIONS)
    return f"{sel}${empreinte.hex()}"


def verify_password(mot_de_passe: str, hash_stocke: str) -> bool:
    try:
        sel, empreinte_hex = hash_stocke.split("$", 1)
    except ValueError:
        return False
    empreinte = hashlib.pbkdf2_hmac("sha256", mot_de_passe.encode("utf-8"), sel.encode("utf-8"), _PBKDF2_ITERATIONS)
    return hmac.compare_digest(empreinte.hex(), empreinte_hex)


def _mot_de_passe_mensuel() -> str:
    """Mot de passe par défaut dérivé de la clé secrète + du mois calendaire
    courant (AAAA-MM). Tant qu'on reste dans le même mois, ce mot de passe
    est TOUJOURS LE MÊME, même après un redéploiement Render qui repart
    d'une base vide — inutile d'aller consulter les logs à chaque
    redémarrage. Il change automatiquement au mois suivant (sans jamais
    revenir à un mot de passe déjà utilisé). Reste imprévisible pour qui
    n'a pas la clé secrète.

    ATTENTION : ceci ne fonctionne que si _secret_key() est stable elle
    aussi, c'est-à-dire si DEPLIANTAPP_SECRET_KEY est définie comme
    variable d'environnement Render (pas seulement le fichier local,
    lui-même effacé à chaque redéploiement sur le plan gratuit)."""
    bucket = datetime.now(timezone.utc).strftime("%Y-%m")
    empreinte = hmac.new(_secret_key(), bucket.encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(empreinte).decode("ascii").rstrip("=")[:16]


def ensure_default_account() -> None:
    """Crée le compte unique s'il n'existe pas encore — appelé au démarrage
    (init_db). Le mot de passe initial n'est JAMAIS codé en dur dans le
    dépôt (visible publiquement dans git sinon) : il vient de la variable
    d'environnement DEPLIANTAPP_DEFAULT_PASSWORD si définie, sinon il est
    dérivé de manière déterministe (voir _mot_de_passe_mensuel) pour rester
    stable tout le mois plutôt que de changer à chaque redéploiement — il
    est malgré tout affiché une seule fois dans les logs de démarrage et
    écrit dans DATA_DIR/mot_de_passe_initial.txt, à changer dès que possible."""
    with get_connection() as conn:
        existe = conn.execute("SELECT 1 FROM auth WHERE id = 1").fetchone()
        if existe:
            return
        mot_de_passe = os.environ.get("DEPLIANTAPP_DEFAULT_PASSWORD") or _mot_de_passe_mensuel()
        conn.execute(
            "INSERT INTO auth (id, username, password_hash, must_change_password) VALUES (1, ?, ?, 1)",
            (DEFAULT_USERNAME, hash_password(mot_de_passe)),
        )
        _MOT_DE_PASSE_INITIAL_PATH.parent.mkdir(parents=True, exist_ok=True)
        _MOT_DE_PASSE_INITIAL_PATH.write_text(mot_de_passe, encoding="utf-8")
        stable = "DEPLIANTAPP_DEFAULT_PASSWORD" not in os.environ and "DEPLIANTAPP_SECRET_KEY" in os.environ
        note = (
            "(stable ce mois-ci : identique à chaque redémarrage tant qu'on ne change pas de mois)"
            if stable else
            "(ATTENTION : DEPLIANTAPP_SECRET_KEY n'est pas définie comme variable d'environnement "
            "Render -- ce mot de passe va donc changer à CHAQUE redémarrage, pas seulement chaque "
            "mois. Définis DEPLIANTAPP_SECRET_KEY dans les réglages du service Render pour le stabiliser.)"
        )
        print(
            "\n" + "=" * 60 +
            f"\nCompte DepliantApp créé — identifiant : {DEFAULT_USERNAME}"
            f"\nMot de passe initial (à changer immédiatement) : {mot_de_passe}"
            f"\n{note}"
            f"\n(aussi écrit dans {_MOT_DE_PASSE_INITIAL_PATH})"
            "\n" + "=" * 60 + "\n"
        )


def get_account() -> Optional[dict]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM auth WHERE id = 1").fetchone()
        return dict(row) if row else None


def verify_credentials(username: str, mot_de_passe: str) -> bool:
    compte = get_account()
    if not compte:
        return False
    return hmac.compare_digest(username, compte["username"]) and verify_password(mot_de_passe, compte["password_hash"])


def change_password(mot_de_passe_actuel: str, nouveau_mot_de_passe: str) -> bool:
    compte = get_account()
    if not compte or not verify_password(mot_de_passe_actuel, compte["password_hash"]):
        return False
    with get_connection() as conn:
        conn.execute(
            "UPDATE auth SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = 1",
            (hash_password(nouveau_mot_de_passe),),
        )
    return True


def _sign(payload: str) -> str:
    return hmac.new(_secret_key(), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def create_session_token(username: str) -> str:
    expiration = int(time.time()) + SESSION_DUREE_SECONDES
    payload = f"{username}:{expiration}"
    signature = _sign(payload)
    brut = f"{payload}:{signature}"
    return base64.urlsafe_b64encode(brut.encode("utf-8")).decode("ascii")


def verify_session_token(token: str) -> Optional[str]:
    """Retourne le nom d'utilisateur si le jeton est valide (signature intacte,
    non expiré), sinon None."""
    try:
        brut = base64.urlsafe_b64decode(token.encode("ascii")).decode("utf-8")
        username, expiration_str, signature = brut.rsplit(":", 2)
        expiration = int(expiration_str)
    except (ValueError, UnicodeDecodeError):
        return None
    payload = f"{username}:{expiration}"
    if not hmac.compare_digest(_sign(payload), signature):
        return None
    if time.time() > expiration:
        return None
    return username
