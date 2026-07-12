from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from .. import auth, config, crud, schemas
from ..deps import identite_courante, require_chorale, require_superadmin
from ..render.pdf import DepassementImpossible, render_feuillet_pdf_auto

router = APIRouter(prefix="/feuillets", tags=["feuillets"])


@router.get("", response_model=list[schemas.Feuillet])
def list_feuillets(mine: bool = False, limit: int = 50, offset: int = 0, identite: auth.Identite = Depends(require_chorale)):
    """mine=True -> uniquement les dépliants de la chorale connectée ("Mes
    dépliants") ; mine=False (défaut) -> tous les dépliants, toutes
    chorales confondues ("Parcourir"), avec l'attribution "composé par X".
    Dans les deux cas, les dépliants que cette chorale a masqués (demande
    de suppression en cours ou refusée) restent invisibles pour elle."""
    chorale_id = identite.compte_id if mine else None
    return crud.list_feuillets(chorale_id=chorale_id, limit=limit, offset=offset, chorale_id_appelant=identite.compte_id)


@router.post("", response_model=schemas.Feuillet)
def create_feuillet(feuillet: schemas.FeuilletCreate, identite: auth.Identite = Depends(require_chorale)):
    return crud.create_feuillet(feuillet, chorale_id=identite.compte_id)


@router.get("/{feuillet_id}", response_model=schemas.Feuillet)
def get_feuillet(feuillet_id: int, identite: auth.Identite = Depends(identite_courante)):
    """Ouvert à tout compte authentifié (chorale ou super-admin) — les
    dépliants sont cherchables/consultables par toutes les chorales, sauf
    ceux que L'APPELANTE a masqués (le super-admin voit tout, nécessaire
    pour la modération)."""
    chorale_id_appelant = identite.compte_id if identite.type == "chorale" else None
    feuillet = crud.get_feuillet(feuillet_id, chorale_id_appelant=chorale_id_appelant)
    if not feuillet:
        raise HTTPException(status_code=404, detail="Feuillet introuvable")
    return feuillet


@router.put("/{feuillet_id}", response_model=schemas.Feuillet)
def update_feuillet(feuillet_id: int, feuillet: schemas.FeuilletCreate, identite: auth.Identite = Depends(require_chorale)):
    """Si le dépliant appartient à la chorale connectée, mise à jour en
    place. Sinon, un CLONE est créé pour elle (voir crud.update_feuillet) —
    la réponse peut donc porter un id différent de `feuillet_id` : le
    frontend doit adopter ce nouvel id."""
    updated = crud.update_feuillet(feuillet_id, feuillet, chorale_id=identite.compte_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Feuillet introuvable")
    return updated


@router.delete("/{feuillet_id}")
def delete_feuillet(feuillet_id: int, _identite: auth.Identite = Depends(require_superadmin)):
    """Réservé au super-admin — une chorale passe par POST /moderation/demandes
    pour demander une suppression, jamais un DELETE direct."""
    if not crud.delete_feuillet(feuillet_id):
        raise HTTPException(status_code=404, detail="Feuillet introuvable")
    return {"ok": True}


@router.get("/{feuillet_id}/pdf")
def get_feuillet_pdf(feuillet_id: int):
    feuillet = crud.get_feuillet(feuillet_id)
    if not feuillet:
        raise HTTPException(status_code=404, detail="Feuillet introuvable")
    # Résolu par la chorale PROPRIÉTAIRE du dépliant consulté, jamais celle
    # actuellement connectée -- c'est ce qui fait qu'un dépliant cloné se
    # met à utiliser les logos/nom de son nouveau propriétaire sans jamais
    # toucher à l'original (voir crud.update_feuillet).
    images = {slot: config.get_active_image_reader(feuillet.chorale_id, slot) for slot in config.IMAGE_SLOTS}
    try:
        pdf_bytes, taille_texte = render_feuillet_pdf_auto(
            feuillet, config.get_config(feuillet.chorale_id), images=images
        )
    except DepassementImpossible as exc:
        raise HTTPException(
            status_code=409,
            detail={"message": str(exc), "moments_en_cause": exc.moments_en_cause},
        ) from exc
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="feuillet_{feuillet.date}.pdf"',
            "X-Taille-Texte-Pt": str(taille_texte),
            "Access-Control-Expose-Headers": "X-Taille-Texte-Pt",
        },
    )
