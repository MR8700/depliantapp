"""Licences mobiles : gestion (génération, révocation, suivi des appareils)
réservée au super-admin -- activer/verifier sont publics (appelés par l'app
mobile avant toute session, voir main.py::_CHEMINS_PUBLICS) mais protégés
par un throttling anti brute-force sur les codes."""
import time
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .. import auth
from .. import licences as licences_module
from ..deps import require_superadmin

router = APIRouter(prefix="/licences", tags=["licences"])

# --- Throttling anti brute-force sur /activer -----------------------------
# En mémoire, pas de dépendance supplémentaire pour une fonctionnalité de
# cette taille -- suffisant pour l'instance unique de ce service (voir
# render.yaml, un seul service web sur le plan gratuit).
_TENTATIVES_MAX = 10
_FENETRE_SECONDES = 3600
_tentatives_par_ip: dict[str, list[float]] = defaultdict(list)


def _throttle(ip: str) -> None:
    maintenant = time.time()
    tentatives = _tentatives_par_ip[ip]
    tentatives[:] = [t for t in tentatives if maintenant - t < _FENETRE_SECONDES]
    if len(tentatives) >= _TENTATIVES_MAX:
        raise HTTPException(status_code=429, detail="Trop de tentatives, réessaie plus tard")
    tentatives.append(maintenant)


class LicenceCreation(BaseModel):
    chorale_id: int
    max_appareils: int = 5
    expire_le: str | None = None


class ActivationPayload(BaseModel):
    code: str
    appareil_id: str
    appareil_nom: str | None = None


class VerificationPayload(BaseModel):
    jeton: str


@router.get("")
def lister(chorale_id: int | None = None, _identite: auth.Identite = Depends(require_superadmin)):
    return licences_module.lister_licences(chorale_id)


@router.post("")
def creer(payload: LicenceCreation, _identite: auth.Identite = Depends(require_superadmin)):
    if not auth.get_chorale(payload.chorale_id):
        raise HTTPException(status_code=404, detail="Chorale introuvable")
    return licences_module.creer_licence(payload.chorale_id, payload.max_appareils, payload.expire_le)


@router.get("/{licence_id}/activations")
def activations(licence_id: int, _identite: auth.Identite = Depends(require_superadmin)):
    if not licences_module.get_licence(licence_id):
        raise HTTPException(status_code=404, detail="Licence introuvable")
    return licences_module.lister_activations(licence_id)


@router.post("/{licence_id}/revoquer")
def revoquer(licence_id: int, _identite: auth.Identite = Depends(require_superadmin)):
    if not licences_module.get_licence(licence_id):
        raise HTTPException(status_code=404, detail="Licence introuvable")
    licences_module.revoquer_licence(licence_id)
    return {"ok": True}


@router.post("/{licence_id}/reactiver")
def reactiver(licence_id: int, _identite: auth.Identite = Depends(require_superadmin)):
    if not licences_module.get_licence(licence_id):
        raise HTTPException(status_code=404, detail="Licence introuvable")
    licences_module.reactiver_licence(licence_id)
    return {"ok": True}


@router.post("/{licence_id}/regenerer-code")
def regenerer(licence_id: int, _identite: auth.Identite = Depends(require_superadmin)):
    if not licences_module.get_licence(licence_id):
        raise HTTPException(status_code=404, detail="Licence introuvable")
    return {"code": licences_module.regenerer_code(licence_id)}


@router.delete("/{licence_id}/activations/{appareil_id}")
def revoquer_appareil(licence_id: int, appareil_id: str, _identite: auth.Identite = Depends(require_superadmin)):
    if not licences_module.get_licence(licence_id):
        raise HTTPException(status_code=404, detail="Licence introuvable")
    licences_module.revoquer_activation(licence_id, appareil_id)
    return {"ok": True}


@router.post("/activer")
def activer(payload: ActivationPayload, request: Request):
    _throttle(request.client.host if request.client else "inconnu")
    code = payload.code.strip()
    appareil_id = payload.appareil_id.strip()
    if not code or not appareil_id:
        raise HTTPException(status_code=400, detail="Code et identifiant d'appareil requis")
    resultat = licences_module.activer(code, appareil_id, payload.appareil_nom)
    if not resultat.ok:
        raise HTTPException(status_code=401, detail=resultat.erreur)
    return {
        "ok": True, "jeton": resultat.jeton,
        "chorale_id": resultat.chorale_id, "chorale_nom": resultat.chorale_nom,
    }


@router.post("/verifier")
def verifier(payload: VerificationPayload):
    resultat = licences_module.verifier_activation(payload.jeton)
    if not resultat:
        return {"valide": False}
    return {"valide": True, "chorale_id": resultat.chorale_id}
