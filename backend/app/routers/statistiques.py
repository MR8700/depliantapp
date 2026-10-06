from fastapi import APIRouter, Depends

from .. import auth, crud
from ..deps import require_superadmin

router = APIRouter(prefix="/statistiques", tags=["statistiques"])


@router.get("")
def statistiques(_identite: auth.Identite = Depends(require_superadmin)):
    return crud.get_statistiques()
