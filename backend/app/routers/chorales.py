import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import auth, config
from ..deps import require_superadmin, require_chorale

router = APIRouter(prefix="/chorales", tags=["chorales"])


class ChoraleCreation(BaseModel):
    nom: str
    username: str
    mot_de_passe_initial: str | None = None


class ReinitialisationMotDePasse(BaseModel):
    nouveau_mot_de_passe: str | None = None


@router.get("")
def list_chorales():
    """Accessible à tout compte authentifié (chorale ou super-admin) :
    nécessaire pour l'attribution "composé par X" et le picker de
    dépliants — ne renvoie que id+nom, jamais les identifiants."""
    return [{"id": c["id"], "nom": c["nom"]} for c in auth.list_chorales()]


@router.get("/detail")
def list_chorales_detail(_identite: auth.Identite = Depends(require_superadmin)):
    """Liste complète (identifiants, must_change_password) — super-admin
    uniquement, pour le panneau Administration."""
    return auth.list_chorales()


@router.post("")
def creer_chorale(payload: ChoraleCreation, _identite: auth.Identite = Depends(require_superadmin)):
    nom = payload.nom.strip()
    username = payload.username.strip()
    if not nom or not username:
        raise HTTPException(status_code=400, detail="Nom et identifiant requis")
    if auth.username_deja_pris(username):
        raise HTTPException(status_code=409, detail="Cet identifiant est déjà utilisé")
    mot_de_passe = payload.mot_de_passe_initial or secrets.token_urlsafe(9)
    chorale = auth.creer_chorale(nom, username, mot_de_passe)
    # Réglages de départ : le nom du dépliant part du nom de la chorale
    # (personnalisable ensuite depuis Réglages, indépendamment du compte).
    config.save_config(chorale["id"], {"chorale": nom})
    return {**chorale, "mot_de_passe_initial": mot_de_passe}


@router.post("/{chorale_id}/reset-password")
def reset_password(
    chorale_id: int, payload: ReinitialisationMotDePasse, _identite: auth.Identite = Depends(require_superadmin)
):
    if not auth.get_chorale(chorale_id):
        raise HTTPException(status_code=404, detail="Chorale introuvable")
    mot_de_passe = payload.nouveau_mot_de_passe or secrets.token_urlsafe(9)
    auth.reinitialiser_mot_de_passe_chorale(chorale_id, mot_de_passe)
    return {"mot_de_passe_initial": mot_de_passe}


class PlanificationSuppression(BaseModel):
    raison: str
    delai_jours: int | None = None
    date_butoir: str | None = None


class AnnulationSuppression(BaseModel):
    raison_annulation: str


class DemandeRevision(BaseModel):
    raison_revision: str


@router.put("/{chorale_id}/planifier-suppression")
def planifier_suppression(
    chorale_id: int, payload: PlanificationSuppression, _identite: auth.Identite = Depends(require_superadmin)
):
    if not auth.get_chorale(chorale_id):
        raise HTTPException(status_code=404, detail="Chorale introuvable")
    auth.planifier_suppression_chorale(chorale_id, payload.delai_jours, payload.raison, payload.date_butoir)
    return {"message": "Suppression planifiée"}


@router.post("/{chorale_id}/annuler-suppression")
def annuler_suppression(
    chorale_id: int, payload: AnnulationSuppression, _identite: auth.Identite = Depends(require_superadmin)
):
    if not auth.get_chorale(chorale_id):
        raise HTTPException(status_code=404, detail="Chorale introuvable")
    auth.annuler_suppression_chorale(chorale_id, payload.raison_annulation)
    return {"message": "Suppression annulée"}


@router.post("/demande-revision")
def demander_revision(
    payload: DemandeRevision, identite: auth.Identite = Depends(require_chorale)
):
    compte_id = identite.compte_id
    if not auth.get_chorale(compte_id):
        raise HTTPException(status_code=404, detail="Chorale introuvable")
    auth.demander_revision_suppression(compte_id, payload.raison_revision)
    return {"message": "Demande de révision enregistrée"}
