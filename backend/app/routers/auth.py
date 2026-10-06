import time
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from .. import auth

router = APIRouter(prefix="/auth", tags=["auth"])

# --- Throttling anti brute-force sur /login ---------------------------------
# Même mécanisme que routers/licences.py::_throttle (en mémoire, suffisant
# pour l'instance unique de ce service, voir render.yaml) -- /auth/login
# n'avait jusqu'ici AUCUNE limite, contrairement à l'activation de licence :
# un attaquant pouvait tenter un nombre illimité de mots de passe contre
# n'importe quel compte chorale (identifiants souvent peu secrets, proches du
# nom de la chorale) sans aucun ralentissement.
_TENTATIVES_MAX = 10
_FENETRE_SECONDES = 900
_echecs_par_cle: dict[str, list[float]] = defaultdict(list)


def _verifier_throttle(cle: str) -> None:
    """Ne compte que les ÉCHECS (voir _enregistrer_echec) -- un utilisateur
    légitime qui retape son mot de passe correct plusieurs fois (autre
    appareil, etc.) ne doit jamais être bloqué, seul un enchaînement
    d'échecs le doit."""
    maintenant = time.time()
    echecs = _echecs_par_cle[cle]
    echecs[:] = [t for t in echecs if maintenant - t < _FENETRE_SECONDES]
    if len(echecs) >= _TENTATIVES_MAX:
        raise HTTPException(status_code=429, detail="Trop de tentatives de connexion, réessaie plus tard")


def _enregistrer_echec(cle: str) -> None:
    _echecs_par_cle[cle].append(time.time())


class Identifiants(BaseModel):
    username: str
    password: str


class ChangementMotDePasse(BaseModel):
    mot_de_passe_actuel: str
    nouveau_mot_de_passe: str


@router.post("/login")
def login(identifiants: Identifiants, request: Request, response: Response):
    ip = request.client.host if request.client else "inconnu"
    cle = f"{ip}:{identifiants.username.strip().lower()}"
    _verifier_throttle(cle)
    identite = auth.verify_credentials_toute_source(identifiants.username, identifiants.password)
    if not identite:
        _enregistrer_echec(cle)
        raise HTTPException(status_code=401, detail="Identifiant ou mot de passe incorrect")
    token = auth.create_session_token(identite)
    response.set_cookie(
        auth.COOKIE_NAME, token,
        max_age=auth.SESSION_DUREE_SECONDES, httponly=True, samesite="lax",
    )
    if identite.type == "super":
        compte = auth.get_account()
    else:
        compte = auth.get_chorale(identite.compte_id)
    # `jeton` en plus du cookie : l'app mobile React Native (offline-first,
    # voir memory project_depliantapp_mobile_licence) ne peut pas compter sur
    # la persistance du cookie entre deux lancements -- elle stocke ce jeton
    # elle-même (SecureStore) et le renvoie via `Authorization: Bearer` (voir
    # AuthMiddleware dans main.py). Inoffensif pour le client web, qui l'ignore.
    return {"ok": True, "must_change_password": bool(compte["must_change_password"]), "jeton": token}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(auth.COOKIE_NAME)
    return {"ok": True}


@router.get("/status")
def status(request: Request):
    identite = auth.identite_depuis_requete(request)
    if not identite:
        return {"authenticated": False}
    if identite.type == "super":
        compte = auth.get_account()
        nom = "Super-admin"
    else:
        compte = auth.get_chorale(identite.compte_id)
        nom = compte["nom"] if compte else identite.username
    return {
        "authenticated": True,
        "type": identite.type,
        "compte_id": identite.compte_id,
        "nom": nom,
        "username": identite.username,
        "must_change_password": bool(compte["must_change_password"]) if compte else False,
        "suppression_date_butoir": compte.get("suppression_date_butoir") if identite.type == "chorale" and compte else None,
        "suppression_raison": compte.get("suppression_raison") if identite.type == "chorale" and compte else None,
        "suppression_delai_jours": compte.get("suppression_delai_jours") if identite.type == "chorale" and compte else None,
        "suppression_demande_revision": compte.get("suppression_demande_revision", 0) if identite.type == "chorale" and compte else 0,
        "suppression_revision_raison": compte.get("suppression_revision_raison") if identite.type == "chorale" and compte else None,
    }


@router.post("/change-password")
def changer_mot_de_passe(payload: ChangementMotDePasse, request: Request):
    identite = auth.identite_depuis_requete(request)
    if not identite:
        raise HTTPException(status_code=401, detail="Non authentifié")
    if len(payload.nouveau_mot_de_passe) < 8:
        raise HTTPException(status_code=400, detail="Le nouveau mot de passe doit faire au moins 8 caractères")
    if identite.type == "super":
        ok = auth.change_password(payload.mot_de_passe_actuel, payload.nouveau_mot_de_passe)
    else:
        ok = auth.changer_mot_de_passe_chorale(identite.compte_id, payload.mot_de_passe_actuel, payload.nouveau_mot_de_passe)
    if not ok:
        raise HTTPException(status_code=401, detail="Mot de passe actuel incorrect")
    return {"ok": True}
