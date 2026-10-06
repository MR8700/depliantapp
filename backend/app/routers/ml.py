import time

from fastapi import APIRouter, Depends, HTTPException

from ..deps import require_superadmin
from ..ml import classifier

router = APIRouter(prefix="/ml", tags=["ml"])

# POST /train scanne toute la table `chants` et réentraîne le classifieur --
# coûteux en CPU, et affecte le classement de TOUTES les chorales à la fois
# (un modèle partagé, pas un par chorale) : réservé au super-admin, jamais
# une chorale (voir Réglages > "Ré-entraîner le modèle", masqué pour les
# comptes chorale côté mobile -- mais l'exécution réelle doit être bloquée
# ICI, pas seulement cachée dans l'UI). Le délai minimal entre deux appels
# reste utile même pour un admin unique (double-tap accidentel).
_DELAI_MIN_SECONDES = 30
_dernier_appel: float = 0.0


@router.post("/train")
def train(_identite=Depends(require_superadmin)):
    global _dernier_appel
    maintenant = time.time()
    if maintenant - _dernier_appel < _DELAI_MIN_SECONDES:
        raise HTTPException(status_code=429, detail="Réentraînement déjà en cours récemment, réessaie dans quelques instants")
    _dernier_appel = maintenant
    return classifier.train_from_db()
