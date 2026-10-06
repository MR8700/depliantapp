from fastapi import APIRouter, Depends

from .. import auth, crud
from ..deps import identite_courante

router = APIRouter(prefix="/statistiques", tags=["statistiques"])


@router.get("")
def statistiques(identite: auth.Identite = Depends(identite_courante)):
    if identite.type == "super":
        return crud.get_statistiques()
    return crud.get_statistiques_chorale(identite.compte_id)

