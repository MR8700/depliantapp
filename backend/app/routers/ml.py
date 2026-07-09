from fastapi import APIRouter

from ..ml import classifier

router = APIRouter(prefix="/ml", tags=["ml"])


@router.post("/train")
def train():
    return classifier.train_from_db()
