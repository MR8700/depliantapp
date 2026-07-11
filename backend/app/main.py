from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from . import auth, crud, schemas
from .constants import CATEGORIES_CHANTS, MOMENTS_LITURGIQUES
from .db import init_db
from .ml import classifier
from .routers import auth as auth_router
from .routers import chants, feuillets, import_, ml, parametres

app = FastAPI(title="DepliantApp API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Chemins accessibles sans authentification : uniquement ce qu'il faut pour
# afficher la page de connexion elle-même (login.html est autonome, sans
# dépendance vers app.js/style.css qui restent, eux, protégés).
_CHEMINS_PUBLICS = {"/auth/login", "/auth/status", "/health", "/login.html", "/favicon.ico"}
# Accessibles dès qu'on est authentifié, même si le mot de passe par défaut
# doit encore être changé (sinon impossible de le changer...).
_CHEMINS_CHANGEMENT_MDP = {"/auth/logout", "/auth/change-password"}


class AuthMiddleware(BaseHTTPMiddleware):
    """Verrouille tout le site derrière un compte unique partagé. Le mot de
    passe par défaut doit être changé avant tout accès au reste du site
    (must_change_password), pas seulement conseillé."""

    async def dispatch(self, request, call_next):
        path = request.url.path
        if path in _CHEMINS_PUBLICS:
            return await call_next(request)

        token = request.cookies.get(auth.COOKIE_NAME)
        username = auth.verify_session_token(token) if token else None
        if not username:
            return self._refuser(request)

        if path in _CHEMINS_CHANGEMENT_MDP:
            return await call_next(request)

        compte = auth.get_account()
        if compte and compte["must_change_password"]:
            return self._refuser(request)

        return await call_next(request)

    @staticmethod
    def _refuser(request):
        path = request.url.path
        est_page = path == "/" or path.endswith(".html")
        if est_page:
            return RedirectResponse(url="/login.html", status_code=303)
        return JSONResponse(status_code=401, content={"detail": "Authentification requise"})


app.add_middleware(AuthMiddleware)

app.include_router(auth_router.router)
app.include_router(chants.router)
app.include_router(feuillets.router)
app.include_router(parametres.router)
app.include_router(ml.router)
app.include_router(import_.router)


@app.on_event("startup")
def on_startup():
    init_db()
    try:
        classifier.train_from_db()
    except Exception:
        pass  # base vide au premier lancement : rien à entraîner encore


@app.get("/health")
def health():
    return {"status": "ok"}


def _categories_completes() -> list[str]:
    """Liste fixe (constants.py) + catégories ajoutées via "Autre" -> saisie
    libre, persistées en base — "Autre" reste toujours en dernier, comme
    choix de repli pour en créer une nouvelle."""
    fixes = [c for c in CATEGORIES_CHANTS if c != "Autre"]
    personnalisees = [c for c in crud.list_categories_personnalisees() if c not in fixes]
    return fixes + personnalisees + ["Autre"]


@app.get("/meta")
def meta():
    return {"moments": MOMENTS_LITURGIQUES, "categories": _categories_completes()}


@app.post("/categories")
def ajouter_categorie(payload: schemas.CategoriePersonnalisee):
    nom = payload.nom.strip()
    if not nom or nom == "Autre":
        raise HTTPException(status_code=400, detail="Nom de catégorie invalide")
    crud.ajouter_categorie_personnalisee(nom)
    return {"categories": _categories_completes()}


STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
