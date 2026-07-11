from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response

from .. import config, db

router = APIRouter(prefix="/parametres", tags=["parametres"])


@router.get("")
def read_parametres():
    return config.get_config()


@router.put("")
def write_parametres(data: dict):
    return config.save_config(data)


@router.post("/image/{slot}")
async def upload_image(slot: str, fichier: UploadFile):
    if slot not in config.IMAGE_SLOTS:
        raise HTTPException(status_code=404, detail="Emplacement d'image inconnu")
    if not (fichier.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Le fichier doit être une image")
    contenu = await fichier.read()
    return config.save_image(slot, fichier.filename, contenu, fichier.content_type)


@router.get("/image/{slot}")
def read_image(slot: str):
    if slot not in config.IMAGE_SLOTS:
        raise HTTPException(status_code=404, detail="Emplacement d'image inconnu")
    if db.BACKEND == "postgres":
        resultat = config.get_image_bytes(slot)
        if not resultat:
            raise HTTPException(status_code=404, detail="Aucune image définie")
        contenu, content_type = resultat
        return Response(content=contenu, media_type=content_type)
    path = config.get_image_path(slot)
    if not path:
        raise HTTPException(status_code=404, detail="Aucune image définie")
    return FileResponse(path)


@router.delete("/image/{slot}")
def remove_image(slot: str):
    if slot not in config.IMAGE_SLOTS:
        raise HTTPException(status_code=404, detail="Emplacement d'image inconnu")
    return config.delete_image(slot)
