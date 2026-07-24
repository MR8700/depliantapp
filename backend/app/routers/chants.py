from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from .. import auth, crud, schemas
from ..deps import identite_courante, require_superadmin
from ..ml import classifier, duplicates

router = APIRouter(prefix="/chants", tags=["chants"])


def _chorale_id_pour_masquage(identite: auth.Identite) -> Optional[int]:
    """Le masquage (voir masques_chorale) ne s'applique qu'aux chorales — le
    super-admin doit tout voir pour pouvoir modérer."""
    return identite.compte_id if identite.type == "chorale" else None


@router.get("", response_model=list[schemas.Chant])
def search_chants(
    q: Optional[str] = None,
    categorie: Optional[str] = None,
    occasion: Optional[str] = None,
    confiance_max: Optional[float] = None,
    resume: bool = False,
    limit: int = 100,
    offset: int = 0,
    identite: auth.Identite = Depends(identite_courante),
):
    """`resume=true` : réponse allégée pour peupler une grille/liste de
    cartes (tronque les couplets au premier seul, jamais affiché en entier
    sur une carte -- voir chantCardHtml()/ChantCard.tsx). Ne jamais l'utiliser
    pour un export/sauvegarde qui a besoin du contenu complet."""
    return crud.list_chants(
        q=q, categorie=categorie, occasion=occasion, confiance_max=confiance_max, limit=limit, offset=offset,
        chorale_id_appelant=_chorale_id_pour_masquage(identite), resume=resume,
    )


@router.post("", response_model=schemas.Chant)
def create_chant(chant: schemas.ChantCreate):
    return crud.create_chant(chant)


@router.post("/bulk_categorize")
def bulk_categorize(payload: schemas.BulkCategorize):
    updated = crud.bulk_update_categorie(payload.ids, payload.categorie)
    return {"updated": updated}


@router.post("/bulk_delete")
def bulk_delete(payload: schemas.BulkDelete, _identite: auth.Identite = Depends(require_superadmin)):
    deleted = crud.bulk_delete_chants(payload.ids)
    return {"deleted": deleted}


@router.delete("/all")
def delete_all_chants(confirmation: str, _identite: auth.Identite = Depends(require_superadmin)):
    if confirmation != "SUPPRIMER":
        raise HTTPException(status_code=400, detail="Confirmation invalide")
    return {"deleted": crud.delete_all_chants()}


@router.get("/slug/{slug}", response_model=schemas.Chant)
def get_chant_by_slug(slug: str):
    chant = crud.get_chant_by_slug(slug)
    if not chant:
        raise HTTPException(status_code=404, detail="Chant introuvable")
    return chant


@router.get("/{chant_id}", response_model=schemas.Chant)
def get_chant(chant_id: int, identite: auth.Identite = Depends(identite_courante)):
    chant = crud.get_chant(chant_id, chorale_id_appelant=_chorale_id_pour_masquage(identite))
    if not chant:
        raise HTTPException(status_code=404, detail="Chant introuvable")
    return chant


@router.patch("/{chant_id}", response_model=schemas.Chant)
def update_chant(chant_id: int, patch: schemas.ChantUpdate):
    chant = crud.update_chant(chant_id, patch)
    if not chant:
        raise HTTPException(status_code=404, detail="Chant introuvable")
    return chant


@router.delete("/{chant_id}")
def delete_chant(chant_id: int, _identite: auth.Identite = Depends(require_superadmin)):
    """Réservé au super-admin — une chorale passe par POST /moderation/demandes
    (voir routers/moderation.py) pour demander une suppression, jamais un
    DELETE direct sur la bibliothèque partagée."""
    if not crud.delete_chant(chant_id):
        raise HTTPException(status_code=404, detail="Chant introuvable")
    return {"ok": True}


@router.get("/{chant_id}/suggestion", response_model=Optional[schemas.Suggestion])
def suggestion_categorie(chant_id: int):
    chant = crud.get_chant(chant_id)
    if not chant:
        raise HTTPException(status_code=404, detail="Chant introuvable")
    ranked = classifier.suggest_categorie(chant.titre, chant.refrain, chant.couplets)
    if not ranked:
        return None
    categorie, score = ranked[0]
    return schemas.Suggestion(categorie=categorie, score=round(score, 2))


@router.get("/{chant_id}/doublons", response_model=list[schemas.Doublon])
def doublons_possibles(chant_id: int):
    chant = crud.get_chant(chant_id)
    if not chant:
        raise HTTPException(status_code=404, detail="Chant introuvable")
    return duplicates.find_duplicates(chant.titre, exclude_id=chant_id)
