"""Authentification multi-comptes : un compte SUPER-ADMIN unique (table `auth`,
historique — protégeait tout le site avant l'introduction des chorales) plus
un compte par CHORALE (table `chorales`, créés uniquement par le super-admin).
Même logique de hachage/session/changement obligatoire du mot de passe par
défaut pour les deux types de compte. Hachage PBKDF2 et cookies de session
signés en HMAC — uniquement la bibliothèque standard, pas de dépendance
supplémentaire pour une fonctionnalité de cette taille."""
import base64
import hashlib
import hmac
import os
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal, Optional

from . import db
from .db import get_connection, insert_returning_id
from .paths import DATA_DIR

DEFAULT_USERNAME = "admin"


@dataclass(frozen=True)
class Identite:
    """Identité résolue à partir d'un jeton de session valide."""

    type: Literal["super", "chorale"]
    compte_id: int
    """Id de la ligne `chorales` pour type="chorale" ; toujours 0 pour
    type="super" (compte unique, pas d'id à proprement parler)."""
    username: str

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
        # Crée le compte placeholder chorale id=0 pour l'application / admin
        # (permet de stocker des livrets liturgiques et réglages au niveau global/application
        # en respectant toutes les contraintes de clés étrangères)
        conn.execute(
            "INSERT INTO chorales (id, nom, username, password_hash, must_change_password) "
            "VALUES (0, 'Application', 'admin-app-settings-placeholder', '', 0) "
            "ON CONFLICT(id) DO NOTHING"
        )
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
    """Le compte SUPER-ADMIN (ligne unique historique — voir docstring de module)."""
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM auth WHERE id = 1").fetchone()
        return dict(row) if row else None


def _verify_credentials_super(username: str, mot_de_passe: str) -> bool:
    compte = get_account()
    if not compte:
        return False
    return hmac.compare_digest(username, compte["username"]) and verify_password(mot_de_passe, compte["password_hash"])


def change_password(mot_de_passe_actuel: str, nouveau_mot_de_passe: str) -> bool:
    """Changement de mot de passe du compte SUPER-ADMIN (auto-service, comme
    avant) — voir changer_mot_de_passe_chorale pour l'équivalent chorale."""
    compte = get_account()
    if not compte or not verify_password(mot_de_passe_actuel, compte["password_hash"]):
        return False
    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        conn.execute(
            f"UPDATE auth SET password_hash = ?, must_change_password = 0, updated_at = {horodatage} WHERE id = 1",
            (hash_password(nouveau_mot_de_passe),),
        )
    return True


# --- Comptes chorale ------------------------------------------------------

def get_chorale(chorale_id: int) -> Optional[dict]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM chorales WHERE id = ?", (chorale_id,)).fetchone()
        return dict(row) if row else None


def get_chorale_by_username(username: str) -> Optional[dict]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM chorales WHERE username = ?", (username,)).fetchone()
        return dict(row) if row else None


def list_chorales() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, nom, username, must_change_password, created_at, "
            "       suppression_date_butoir, suppression_raison, suppression_delai_jours, "
            "       suppression_demande_revision, suppression_revision_raison "
            "FROM chorales WHERE id <> 0 ORDER BY nom"
        ).fetchall()
        return [dict(r) for r in rows]


def username_deja_pris(username: str) -> bool:
    """Unicité imposée entre les deux tables de comptes (chorale + super-admin)
    puisqu'un même formulaire de connexion sert aux deux."""
    if get_chorale_by_username(username):
        return True
    compte_super = get_account()
    return bool(compte_super and hmac.compare_digest(username, compte_super["username"]))


def creer_chorale(nom: str, username: str, mot_de_passe_initial: str) -> dict:
    with get_connection() as conn:
        chorale_id = insert_returning_id(
            conn,
            "INSERT INTO chorales (nom, username, password_hash, must_change_password) VALUES (?, ?, ?, 1)",
            (nom, username, hash_password(mot_de_passe_initial)),
        )
    return get_chorale(chorale_id)


def changer_mot_de_passe_chorale(chorale_id: int, mot_de_passe_actuel: str, nouveau_mot_de_passe: str) -> bool:
    """Auto-service, en miroir de change_password() pour le super-admin."""
    compte = get_chorale(chorale_id)
    if not compte or not verify_password(mot_de_passe_actuel, compte["password_hash"]):
        return False
    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        conn.execute(
            f"UPDATE chorales SET password_hash = ?, must_change_password = 0, updated_at = {horodatage} WHERE id = ?",
            (hash_password(nouveau_mot_de_passe), chorale_id),
        )
    return True


def reinitialiser_mot_de_passe_chorale(chorale_id: int, nouveau_mot_de_passe: str) -> None:
    """Action SUPER-ADMIN (pas d'auto-service) : force un nouveau mot de
    passe et remet must_change_password à 1 pour que la chorale doive le
    changer à sa prochaine connexion."""
    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        conn.execute(
            f"UPDATE chorales SET password_hash = ?, must_change_password = 1, updated_at = {horodatage} WHERE id = ?",
            (hash_password(nouveau_mot_de_passe), chorale_id),
        )


def verify_credentials_toute_source(username: str, mot_de_passe: str) -> Optional[Identite]:
    """Essaie d'abord les comptes chorale, puis le compte super-admin unique
    (unicité de username garantie à la création, voir username_deja_pris)."""
    chorale = get_chorale_by_username(username)
    if chorale and verify_password(mot_de_passe, chorale["password_hash"]):
        return Identite(type="chorale", compte_id=chorale["id"], username=chorale["username"])
    if _verify_credentials_super(username, mot_de_passe):
        return Identite(type="super", compte_id=0, username=username)
    return None


# --- Session ----------------------------------------------------------

def _sign(payload: str) -> str:
    return hmac.new(_secret_key(), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def create_session_token(identite: Identite) -> str:
    expiration = int(time.time()) + SESSION_DUREE_SECONDES
    payload = f"{identite.type}:{identite.compte_id}:{identite.username}:{expiration}"
    signature = _sign(payload)
    brut = f"{payload}:{signature}"
    return base64.urlsafe_b64encode(brut.encode("utf-8")).decode("ascii")


def identite_depuis_requete(request) -> Optional[Identite]:
    """Résout l'identité depuis une requête Starlette/FastAPI : cookie de
    session (client web) ou header ``Authorization: Bearer`` (app mobile
    React Native, qui ne persiste pas les cookies entre deux lancements --
    voir routers/auth.py::login et memory project_depliantapp_mobile_licence).
    Centralisé ici pour que le middleware ET les routes qui redécodent
    l'identité elles-mêmes (status, change-password) restent cohérents."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        entete = request.headers.get("authorization", "")
        if entete.lower().startswith("bearer "):
            token = entete[7:].strip()
    return verify_session_token(token) if token else None


def verify_session_token(token: str) -> Optional[Identite]:
    """Retourne l'identité résolue si le jeton est valide (signature intacte,
    non expiré), sinon None. Le username est extrait en 3 temps (signature
    dépouillée par la droite, type/compte_id par la gauche, expiration par
    la droite du reste) plutôt qu'un simple rsplit à 5 parties, pour rester
    correct même si un username venait à contenir ":" (comme le faisait déjà
    l'ancien format à 3 champs)."""
    try:
        brut = base64.urlsafe_b64decode(token.encode("ascii")).decode("utf-8")
        avant_signature, signature = brut.rsplit(":", 1)
        type_compte, compte_id_str, reste = avant_signature.split(":", 2)
        username, expiration_str = reste.rsplit(":", 1)
        compte_id = int(compte_id_str)
        expiration = int(expiration_str)
    except (ValueError, UnicodeDecodeError):
        return None
    payload = f"{type_compte}:{compte_id}:{username}:{expiration}"
    if not hmac.compare_digest(_sign(payload), signature):
        return None
    if time.time() > expiration:
        return None
    if type_compte not in ("super", "chorale"):
        return None
    return Identite(type=type_compte, compte_id=compte_id, username=username)


def planifier_suppression_chorale(chorale_id: int, delai_jours: Optional[int], raison: str, date_butoir: Optional[str] = None) -> None:
    from datetime import datetime, timezone, timedelta
    
    if date_butoir:
        if len(date_butoir) == 10:  # YYYY-MM-DD
            try:
                date_butoir_dt = datetime.strptime(date_butoir, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                # Set to end of day to give full time
                date_butoir_dt = date_butoir_dt.replace(hour=23, minute=59, second=59)
                date_butoir = date_butoir_dt.isoformat()
            except Exception:
                pass
        try:
            target_dt = datetime.fromisoformat(date_butoir.replace("Z", "+00:00"))
            now_dt = datetime.now(timezone.utc)
            diff = target_dt - now_dt
            delai_jours = max(1, diff.days)
        except Exception:
            delai_jours = delai_jours or 15
    else:
        delai_jours = delai_jours or 15
        date_butoir = (datetime.now(timezone.utc) + timedelta(days=delai_jours)).isoformat()

    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        conn.execute(
            f"UPDATE chorales SET "
            f"  suppression_date_butoir = ?, "
            f"  suppression_raison = ?, "
            f"  suppression_delai_jours = ?, "
            f"  suppression_demande_revision = 0, "
            f"  suppression_revision_raison = NULL, "
            f"  updated_at = {horodatage} "
            f"WHERE id = ?",
            (date_butoir, raison, delai_jours, chorale_id)
        )


def demander_revision_suppression(chorale_id: int, raison_revision: str) -> None:
    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        conn.execute(
            f"UPDATE chorales SET "
            f"  suppression_demande_revision = 1, "
            f"  suppression_revision_raison = ?, "
            f"  updated_at = {horodatage} "
            f"WHERE id = ?",
            (raison_revision, chorale_id)
        )


def annuler_suppression_chorale(chorale_id: int, raison_annulation: str) -> None:
    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        conn.execute(
            f"UPDATE chorales SET "
            f"  suppression_date_butoir = NULL, "
            f"  suppression_raison = NULL, "
            f"  suppression_delai_jours = NULL, "
            f"  suppression_demande_revision = 0, "
            f"  suppression_revision_raison = NULL, "
            f"  updated_at = {horodatage} "
            f"WHERE id = ?",
            (chorale_id,)
        )
        
        from . import crud
        texte_message = f"📢 [Annulation de planification de suppression]\nMotif d'annulation : {raison_annulation}"
        crud.creer_message(chorale_id, "super", texte_message)
