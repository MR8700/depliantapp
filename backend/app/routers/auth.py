from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from .. import auth

router = APIRouter(prefix="/auth", tags=["auth"])


class Identifiants(BaseModel):
    username: str
    password: str


class ChangementMotDePasse(BaseModel):
    mot_de_passe_actuel: str
    nouveau_mot_de_passe: str


@router.post("/login")
def login(identifiants: Identifiants, response: Response):
    identite = auth.verify_credentials_toute_source(identifiants.username, identifiants.password)
    if not identite:
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
    return {"ok": True, "must_change_password": bool(compte["must_change_password"])}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(auth.COOKIE_NAME)
    return {"ok": True}


@router.get("/status")
def status(request: Request):
    token = request.cookies.get(auth.COOKIE_NAME)
    identite = auth.verify_session_token(token) if token else None
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
    token = request.cookies.get(auth.COOKIE_NAME)
    identite = auth.verify_session_token(token) if token else None
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
