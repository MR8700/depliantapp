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

from . import auth, db, licence_signature
from .db import get_connection, insert_returning_id

# Alphabet sans 0/O/1/I/L (ambigus à recopier depuis un écran ou un papier).
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
ACTIVATION_TOKEN_DUREE_SECONDES = 90 * 24 * 3600  # 90 jours


def generer_code() -> str:
    """Non utilisé par le flux de licence hors-ligne (voir creer_licence
    ci-dessous) -- conservé sans appelant, comme le reste du code devenu mort
    avec ce chantier (activer/verifier_activation/verifier_licence_appareil),
    au cas où un flux de code lisible reviendrait un jour."""
    groupes = ["".join(secrets.choice(_ALPHABET) for _ in range(4)) for _ in range(4)]
    return "-".join(groupes)


class LicenceInvalide(Exception):
    """Levée quand un blob reçu du client (censé être déjà signé par l'appli
    admin, voir mobile/src/licence/adminSignature.ts) ne passe pas la
    vérification Ed25519 -- signature corrompue/falsifiée, format
    inattendu, ou clé publique pas encore configurée côté serveur (voir
    licence_signature.py)."""


def creer_licence(code: str) -> dict:
    """Enregistre le bookkeeping d'une licence déjà signée HORS-LIGNE par
    l'appli admin -- ce serveur ne signe jamais rien lui-même (pas de clé
    privée détenue ici), il vérifie (défense en profondeur) et stocke tel
    quel pour l'affichage/le suivi dans AdministrationScreen. La validité de
    la licence côté chorale ne dépend jamais de cet enregistrement : le blob
    est valide dès sa signature, indépendamment de ce serveur."""
    verifie = licence_signature.verifier_blob(code)
    if not verifie:
        raise LicenceInvalide("Signature de licence invalide")
    if not auth.get_chorale(verifie.chorale_id):
        raise LicenceInvalide("Chorale introuvable")
    with get_connection() as conn:
        licence_id = insert_returning_id(
            conn,
            "INSERT INTO licences (code, chorale_id, max_appareils, expire_le, quota_feuillets, seed, licence_uid) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (code, verifie.chorale_id, verifie.dev_max, verifie.expire_le, verifie.quota_feuillets, verifie.seed, verifie.licence_uid),
        )
    return get_licence(licence_id)


def modifier_licence(licence_id: int, code: str) -> None:
    """Reconfiguration complète : l'appelant (AdministrationScreen, via
    l'appli admin qui détient la clé privée) a déjà signé un NOUVEAU blob
    portant les valeurs voulues -- ce serveur vérifie et remplace
    code/seed/licence_uid/max_appareils/expire_le/quota_feuillets en base.
    Comme pour revoquer_licence/reactiver_licence ci-dessous : sans effet
    immédiat sur un appareil chorale déjà activé avec l'ancien blob (il ne
    revérifie jamais rien côté serveur) -- tradeoff accepté du modèle
    100% hors-ligne."""
    verifie = licence_signature.verifier_blob(code)
    if not verifie:
        raise LicenceInvalide("Signature de licence invalide")
    existante = get_licence(licence_id)
    if existante and existante["chorale_id"] is not None and verifie.chorale_id != existante["chorale_id"]:
        # Ce blob ne touche jamais la colonne chorale_id (voir l'UPDATE
        # ci-dessous) -- sans ce contrôle, un blob signé pour une AUTRE
        # chorale que celle d'origine désynchroniserait silencieusement le
        # bookkeeping (chorale_id en base) du contenu réellement signé, et
        # cette licence deviendrait introuvable par Messagerie (qui filtre
        # sur chorale_id + licence_uid ensemble).
        raise LicenceInvalide("Le blob fourni correspond à une autre chorale que celle de la licence d'origine")
    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        conn.execute(
            f"UPDATE licences SET code = ?, max_appareils = ?, expire_le = ?, quota_feuillets = ?, seed = ?, licence_uid = ?, "
            f"updated_at = {horodatage} WHERE id = ?",
            (code, verifie.dev_max, verifie.expire_le, verifie.quota_feuillets, verifie.seed, verifie.licence_uid, licence_id),
        )


def get_licence(licence_id: int) -> Optional[dict]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM licences WHERE id = ?", (licence_id,)).fetchone()
        return dict(row) if row else None


def get_licence_par_code(code: str) -> Optional[dict]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM licences WHERE code = ?", (code.strip().upper(),)).fetchone()
        return dict(row) if row else None


def get_licence_active_pour_chorale(chorale_id: int) -> Optional[dict]:
    """La licence active la plus récente d'une chorale -- une chorale ne
    devrait normalement en avoir qu'une, mais rien n'empêche l'admin d'en
    recréer une (perte, renouvellement) sans révoquer l'ancienne."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM licences WHERE chorale_id = ? AND statut = 'active' ORDER BY created_at DESC LIMIT 1",
            (chorale_id,),
        ).fetchone()
        return dict(row) if row else None


class QuotaFeuilletsAtteint(Exception):
    """Levée par consommer_quota_feuillet() quand la licence active de la
    chorale a atteint son quota_feuillets configuré par l'admin."""

    def __init__(self, quota: int):
        self.quota = quota
        super().__init__(f"Quota de {quota} feuillet(s) atteint pour votre licence. Contactez l'administrateur.")


def consommer_quota_feuillet(chorale_id: int) -> None:
    """Incrémente feuillets_produits pour la licence active de `chorale_id`
    après vérification du quota (None = illimité, voir schéma). Sans effet
    si la chorale n'a pas (ou plus) de licence active -- comptes créés avant
    l'introduction du système de licences, ou super-admin (chorale_id=0,
    jamais rattaché à une licence)."""
    if not chorale_id:
        return
    licence = get_licence_active_pour_chorale(chorale_id)
    if not licence:
        return
    quota = licence["quota_feuillets"]
    if quota is not None and licence["feuillets_produits"] >= quota:
        raise QuotaFeuilletsAtteint(quota)
    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        conn.execute(
            f"UPDATE licences SET feuillets_produits = feuillets_produits + 1, updated_at = {horodatage} WHERE id = ?",
            (licence["id"],),
        )


def _derniere_licence_pour_chorale(chorale_id: int) -> Optional[dict]:
    """La licence la plus récente d'une chorale, QUEL QUE SOIT son statut --
    contrairement à get_licence_active_pour_chorale ci-dessus (qui filtre
    statut='active' et renvoie donc None aussi bien pour "jamais eu de
    licence" que pour "licence révoquée", deux cas qu'on doit distinguer
    ici : voir verifier_licence_appareil)."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM licences WHERE chorale_id = ? ORDER BY created_at DESC LIMIT 1", (chorale_id,),
        ).fetchone()
        return dict(row) if row else None


def verifier_licence_appareil(chorale_id: int, appareil_id: Optional[str]) -> Optional[str]:
    """DEVENUE INUTILISÉE (plus jamais appelée par AuthMiddleware) depuis le
    passage au modèle de licence 100% hors-ligne -- un appareil chorale ne
    présente plus jamais de session/Bearer classique, donc plus jamais ce
    contrôle par requête. Conservée sans appelant, comme le reste du flux
    HMAC devenu mort avec ce chantier (activer/verifier_activation), au cas
    où elle redeviendrait utile. Contrôle CONTINU (pas seulement à
    l'activation) du droit d'accès d'un appareil mobile déjà connecté --
    appelé par AuthMiddleware à CHAQUE requête d'un compte chorale portant un
    en-tête X-Appareil-Id (voir
    main.py). Sans ce contrôle, le jeton de SESSION classique (30 jours,
    voir auth.py::create_session_token) restait valide même après que
    l'admin révoque la licence, la laisse expirer, ou révoque cet appareil
    précis : le device count/l'expiration n'étaient alors vérifiés qu'une
    seule fois, au moment de l'activation.

    Renvoie None si l'accès reste autorisé (pas de licence associée à cette
    chorale -- comptes antérieurs au système de licences -- ou licence
    valide et cet appareil toujours actif), sinon un message d'erreur clair
    à afficher à l'utilisateur.

    appareil_id=None (web, ou vieille version de l'app qui n'envoie pas
    encore l'en-tête) : seul l'état de la licence est vérifié, jamais la
    liste des appareils -- le web n'a pas de notion d'appareil."""
    licence = _derniere_licence_pour_chorale(chorale_id)
    if not licence:
        return None  # jamais eu de licence -- système pas utilisé pour cette chorale
    if licence["statut"] != "active":
        return "Licence révoquée. Contactez l'administrateur pour la réactiver."
    if _licence_expiree(licence):
        return "Licence expirée. Contactez l'administrateur pour la renouveler."
    if appareil_id:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT revoque_le FROM licence_activations WHERE licence_id = ? AND appareil_id = ?",
                (licence["id"], appareil_id),
            ).fetchone()
        if not row or row["revoque_le"]:
            return "Cet appareil n'est plus autorisé sur cette licence. Contactez l'administrateur."
    return None


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
    """Marque la licence révoquée pour le bookkeeping/affichage admin
    uniquement -- SANS EFFET IMMÉDIAT sur un appareil chorale déjà activé,
    qui ne recontacte jamais ce serveur pour revérifier son statut (modèle
    100% hors-ligne). Seule la Messagerie consulte ce statut en direct (voir
    messages_auth.py) ; tout le reste continue de fonctionner localement
    jusqu'à ce que la chorale reçoive et active un nouveau blob."""
    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        conn.execute(f"UPDATE licences SET statut = 'revoquee', updated_at = {horodatage} WHERE id = ?", (licence_id,))


def reactiver_licence(licence_id: int) -> None:
    """Symétrique de revoquer_licence -- mêmes limites (pas d'effet immédiat
    hors Messagerie)."""
    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        conn.execute(f"UPDATE licences SET statut = 'active', updated_at = {horodatage} WHERE id = ?", (licence_id,))


def regenerer_code(licence_id: int, code: str) -> str:
    """Remplace le blob d'une licence existante (perte/fuite du code) par un
    nouveau, RE-SIGNÉ côté admin -- contrairement à l'ancienne version
    (génération aléatoire faite ici), la re-signature exige la clé privée,
    qui ne vit que sur l'appareil admin. Ne touche pas aux appareils déjà
    activés (rattachés à licence_id/licence_uid, pas au blob lui-même)."""
    verifie = licence_signature.verifier_blob(code)
    if not verifie:
        raise LicenceInvalide("Signature de licence invalide")
    existante = get_licence(licence_id)
    if existante and existante["chorale_id"] is not None and verifie.chorale_id != existante["chorale_id"]:
        raise LicenceInvalide("Le blob fourni correspond à une autre chorale que celle de la licence d'origine")
    horodatage = "now()" if db.BACKEND == "postgres" else "datetime('now')"
    with get_connection() as conn:
        conn.execute(
            f"UPDATE licences SET code = ?, seed = ?, licence_uid = ?, updated_at = {horodatage} WHERE id = ?",
            (code, verifie.seed, verifie.licence_uid, licence_id),
        )
    return code


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
