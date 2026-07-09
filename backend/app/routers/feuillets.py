from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from .. import config, crud, schemas
from ..render.pdf import render_feuillet_pdf_auto

router = APIRouter(prefix="/feuillets", tags=["feuillets"])


@router.get("", response_model=list[schemas.Feuillet])
def list_feuillets(limit: int = 50, offset: int = 0):
    return crud.list_feuillets(limit=limit, offset=offset)


@router.post("", response_model=schemas.Feuillet)
def create_feuillet(feuillet: schemas.FeuilletCreate):
    return crud.create_feuillet(feuillet)


@router.get("/{feuillet_id}", response_model=schemas.Feuillet)
def get_feuillet(feuillet_id: int):
    feuillet = crud.get_feuillet(feuillet_id)
    if not feuillet:
        raise HTTPException(status_code=404, detail="Feuillet introuvable")
    return feuillet


@router.put("/{feuillet_id}", response_model=schemas.Feuillet)
def update_feuillet(feuillet_id: int, feuillet: schemas.FeuilletCreate):
    updated = crud.update_feuillet(feuillet_id, feuillet)
    if not updated:
        raise HTTPException(status_code=404, detail="Feuillet introuvable")
    return updated


@router.delete("/{feuillet_id}")
def delete_feuillet(feuillet_id: int):
    if not crud.delete_feuillet(feuillet_id):
        raise HTTPException(status_code=404, detail="Feuillet introuvable")
    return {"ok": True}


@router.get("/{feuillet_id}/pdf")
def get_feuillet_pdf(feuillet_id: int):
    feuillet = crud.get_feuillet(feuillet_id)
    if not feuillet:
        raise HTTPException(status_code=404, detail="Feuillet introuvable")
    images = {slot: config.get_image_path(slot) for slot in config.IMAGE_SLOTS}
    pdf_bytes = render_feuillet_pdf_auto(feuillet, config.get_config(), images=images)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="feuillet_{feuillet.date}.pdf"'},
    )
