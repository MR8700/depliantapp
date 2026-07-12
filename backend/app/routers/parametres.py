from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import Response

from .. import auth, config
from ..deps import require_chorale

router = APIRouter(prefix="/parametres", tags=["parametres"])


@router.get("")
def read_parametres(identite: auth.Identite = Depends(require_chorale)):
    return config.get_config(identite.compte_id)


@router.put("")
def write_parametres(data: dict, identite: auth.Identite = Depends(require_chorale)):
    return config.save_config(identite.compte_id, data)


# --- Pool partagé de médias (logos, bannières) : voir config.py -----------

@router.get("/medias")
def list_medias(type: Optional[str] = None):
    """Accessible à tout compte authentifié — pour le picker de médias
    (choisir une image déjà uploadée par n'importe quelle chorale)."""
    return config.list_medias(type)


@router.get("/medias/{media_id}/fichier")
def lire_media(media_id: int):
    resultat = config.get_media_bytes(media_id)
    if not resultat:
        raise HTTPException(status_code=404, detail="Image introuvable")
    contenu, content_type = resultat
    return Response(content=contenu, media_type=content_type)


@router.post("/medias")
async def uploader_media(type: str, fichier: UploadFile, identite: auth.Identite = Depends(require_chorale)):
    if type not in ("logo", "banniere"):
        raise HTTPException(status_code=400, detail="Type de média inconnu")
    if not (fichier.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Le fichier doit être une image")
    contenu = await fichier.read()
    return config.upload_media(identite.compte_id, type, fichier.filename, contenu, fichier.content_type)


# --- Emplacements actifs de LA chorale connectée (logo_gauche/logo_droit/banniere_bas) ---

@router.post("/image/{slot}")
async def uploader_et_activer_image(slot: str, fichier: UploadFile, identite: auth.Identite = Depends(require_chorale)):
    """Uploade une nouvelle image dans le pool partagé ET l'active
    immédiatement pour cette chorale — flux le plus simple (équivalent de
    l'ancien remplacement direct). Pour réutiliser une image déjà présente
    dans le pool, voir POST /parametres/image/{slot}/activer."""
    if slot not in config.IMAGE_SLOTS:
        raise HTTPException(status_code=404, detail="Emplacement d'image inconnu")
    if not (fichier.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Le fichier doit être une image")
    contenu = await fichier.read()
    return config.upload_and_activate_image(identite.compte_id, slot, fichier.filename, contenu, fichier.content_type)


@router.post("/image/{slot}/activer")
def activer_image(slot: str, payload: dict, identite: auth.Identite = Depends(require_chorale)):
    """Choisit, pour cet emplacement, une image déjà présente dans le pool
    partagé (uploadée par n'importe quelle chorale) plutôt que d'en
    uploader une nouvelle."""
    if slot not in config.IMAGE_SLOTS:
        raise HTTPException(status_code=404, detail="Emplacement d'image inconnu")
    media_id = payload.get("media_id")
    if not media_id or not config.get_media_bytes(media_id):
        raise HTTPException(status_code=404, detail="Image introuvable dans le pool partagé")
    return config.set_active_media(identite.compte_id, slot, media_id)


@router.get("/image/{slot}")
def lire_image_active(slot: str, identite: auth.Identite = Depends(require_chorale)):
    if slot not in config.IMAGE_SLOTS:
        raise HTTPException(status_code=404, detail="Emplacement d'image inconnu")
    media_id = config.get_config(identite.compte_id).get(f"{slot}_media_id")
    if not media_id:
        raise HTTPException(status_code=404, detail="Aucune image définie")
    resultat = config.get_media_bytes(media_id)
    if not resultat:
        raise HTTPException(status_code=404, detail="Aucune image définie")
    contenu, content_type = resultat
    return Response(content=contenu, media_type=content_type)


@router.delete("/image/{slot}")
def retirer_image(slot: str, identite: auth.Identite = Depends(require_chorale)):
    """Ne retire l'image QUE pour cette chorale (désélectionne
    l'emplacement) — l'image reste dans le pool partagé pour les autres."""
    if slot not in config.IMAGE_SLOTS:
        raise HTTPException(status_code=404, detail="Emplacement d'image inconnu")
    return config.set_active_media(identite.compte_id, slot, None)
