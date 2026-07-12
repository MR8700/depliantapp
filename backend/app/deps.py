"""Dépendances FastAPI partagées entre routeurs pour lire l'identité posée
par AuthMiddleware sur request.state.identite (voir main.py) — évite que
chaque routeur redécode le cookie de session lui-même."""
from fastapi import HTTPException, Request

from . import auth


def require_superadmin(request: Request) -> auth.Identite:
    identite: auth.Identite = request.state.identite
    if identite.type != "super":
        raise HTTPException(status_code=403, detail="Réservé au super-admin")
    return identite


def require_chorale(request: Request) -> auth.Identite:
    """Pour les routes propres à une chorale (réglages, dépliants, médias) —
    le super-admin n'a pas d'espace chorale et ne peut pas les utiliser."""
    identite: auth.Identite = request.state.identite
    if identite.type != "chorale":
        raise HTTPException(status_code=403, detail="Réservé à un compte chorale")
    return identite


def identite_courante(request: Request) -> auth.Identite:
    """N'importe quel compte authentifié (chorale ou super-admin) — pour les
    routes accessibles aux deux mais qui ont besoin de savoir laquelle."""
    return request.state.identite
