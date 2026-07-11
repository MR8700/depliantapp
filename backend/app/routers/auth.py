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
    if not auth.verify_credentials(identifiants.username, identifiants.password):
        raise HTTPException(status_code=401, detail="Identifiant ou mot de passe incorrect")
    token = auth.create_session_token(identifiants.username)
    response.set_cookie(
        auth.COOKIE_NAME, token,
        max_age=auth.SESSION_DUREE_SECONDES, httponly=True, samesite="lax",
    )
    compte = auth.get_account()
    return {"ok": True, "must_change_password": bool(compte["must_change_password"])}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(auth.COOKIE_NAME)
    return {"ok": True}


@router.get("/status")
def status(request: Request):
    token = request.cookies.get(auth.COOKIE_NAME)
    username = auth.verify_session_token(token) if token else None
    if not username:
        return {"authenticated": False}
    compte = auth.get_account()
    return {"authenticated": True, "must_change_password": bool(compte["must_change_password"]) if compte else False}


@router.post("/change-password")
def changer_mot_de_passe(payload: ChangementMotDePasse, request: Request):
    token = request.cookies.get(auth.COOKIE_NAME)
    if not auth.verify_session_token(token):
        raise HTTPException(status_code=401, detail="Non authentifié")
    if len(payload.nouveau_mot_de_passe) < 8:
        raise HTTPException(status_code=400, detail="Le nouveau mot de passe doit faire au moins 8 caractères")
    if not auth.change_password(payload.mot_de_passe_actuel, payload.nouveau_mot_de_passe):
        raise HTTPException(status_code=401, detail="Mot de passe actuel incorrect")
    return {"ok": True}
