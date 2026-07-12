from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.responses import Response

from .. import auth, crud
from ..deps import identite_courante, require_superadmin

router = APIRouter(prefix="/messages", tags=["messages"])


def _chorale_id_du_fil(identite: auth.Identite, chorale_id_param: Optional[int]) -> int:
    """Une chorale ne consulte/écrit jamais que SON PROPRE fil — le
    chorale_id vient toujours de la session, jamais du client, même si le
    paramètre est fourni. Le super-admin doit préciser quel fil il consulte."""
    if identite.type == "chorale":
        return identite.compte_id
    if not chorale_id_param:
        raise HTTPException(status_code=400, detail="chorale_id requis pour le super-admin")
    return chorale_id_param


def _verifier_acces_chorale(identite: auth.Identite, chorale_id: int) -> None:
    """Vérifie qu'une identité a le droit de voir une ressource déjà
    résolue pour une chorale donnée (ex. pièce jointe) — le super-admin
    voit tout, une chorale seulement les siennes."""
    if identite.type == "chorale" and identite.compte_id != chorale_id:
        raise HTTPException(status_code=403, detail="Accès refusé")


@router.get("/chorales")
def inbox(_identite: auth.Identite = Depends(require_superadmin)):
    return crud.list_message_threads()


@router.get("")
def get_fil(chorale_id: Optional[int] = None, identite: auth.Identite = Depends(identite_courante)):
    cid = _chorale_id_du_fil(identite, chorale_id)
    return crud.list_messages(cid)


@router.post("")
async def envoyer(
    chorale_id: Optional[int] = Form(None),
    texte: Optional[str] = Form(None),
    piece_jointe: Optional[UploadFile] = None,
    identite: auth.Identite = Depends(identite_courante),
):
    cid = _chorale_id_du_fil(identite, chorale_id)
    piece = None
    if piece_jointe:
        if not (piece_jointe.content_type or "").startswith("image/"):
            raise HTTPException(status_code=400, detail="La pièce jointe doit être une image")
        contenu = await piece_jointe.read()
        # Un fichier vide (0 octet) ne compte pas comme une vraie pièce
        # jointe : sans ce garde-fou le message serait accepté sans texte
        # ni contenu, avec une image cassée dans le fil.
        if contenu:
            piece = (contenu, piece_jointe.content_type, piece_jointe.filename)
    if not (texte and texte.strip()) and not piece:
        raise HTTPException(status_code=400, detail="Message vide")
    return crud.creer_message(cid, identite.type, texte.strip() if texte else None, piece)


@router.post("/lu")
def marquer_lu(chorale_id: Optional[int] = None, identite: auth.Identite = Depends(identite_courante)):
    cid = _chorale_id_du_fil(identite, chorale_id)
    crud.marquer_lus(cid, identite.type)
    return {"ok": True}


@router.get("/non-lus")
def non_lus(chorale_id: Optional[int] = None, identite: auth.Identite = Depends(identite_courante)):
    if identite.type == "super":
        return {"non_lus": crud.compter_non_lus_total_super()}
    return {"non_lus": crud.compter_non_lus(identite.compte_id, "chorale")}


@router.get("/{message_id}/piece-jointe")
def piece_jointe(message_id: int, identite: auth.Identite = Depends(identite_courante)):
    resultat = crud.get_piece_jointe_message(message_id)
    if not resultat:
        raise HTTPException(status_code=404, detail="Pièce jointe introuvable")
    contenu, content_type, chorale_id = resultat
    # Pièce jointe privée au fil : jamais accessible en dehors de la
    # chorale concernée ou du super-admin (contrairement au pool `medias`
    # partagé, qui lui est public à tout compte authentifié).
    _verifier_acces_chorale(identite, chorale_id)
    return Response(content=contenu, media_type=content_type)
