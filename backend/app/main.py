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
from .routers import chants, chorales, feuillets, import_, licences, messages, ml, moderation, parametres, statistiques

app = FastAPI(title="DepliantApp API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Chemins accessibles sans authentification : uniquement ce qu'il faut pour
# afficher la page de connexion elle-même (login.html est autonome, sans
# dépendance vers app.js/style.css qui restent, eux, protégés) — plus les
# fichiers d'installation de l'appli (manifest, icônes, service worker) :
# le navigateur doit pouvoir les récupérer AVANT toute connexion (prompt
# d'installation depuis login.html) ; ils ne contiennent aucune donnée, donc
# aucun risque à les laisser publics.
_CHEMINS_PUBLICS = {
    "/auth/login", "/auth/status", "/health", "/login.html", "/favicon.ico",
    "/manifest.json", "/sw.js", "/icon-192.png", "/icon-512.png",
    # Activation/vérification de licence mobile : appelées par l'app React
    # Native AVANT tout login (voir app/licences.py) -- protégées par leur
    # propre throttling anti brute-force, pas par la session web.
    "/licences/activer", "/licences/verifier",
}
# Accessibles dès qu'on est authentifié, même si le mot de passe par défaut
# doit encore être changé (sinon impossible de le changer...).
_CHEMINS_CHANGEMENT_MDP = {"/auth/logout", "/auth/change-password"}


class AuthMiddleware(BaseHTTPMiddleware):
    """Verrouille tout le site derrière une authentification obligatoire —
    soit un compte chorale, soit le compte super-admin unique. Le mot de
    passe par défaut doit être changé avant tout accès au reste du site
    (must_change_password), pas seulement conseillé. L'identité résolue est
    attachée à `request.state.identite` pour que les routeurs en aval sachent
    qui agit (chorale_id à filtrer, ou droits super-admin) sans redécoder le
    cookie eux-mêmes."""

    async def dispatch(self, request, call_next):
        path = request.url.path
        if path in _CHEMINS_PUBLICS:
            return await call_next(request)

        # Effacer les chorales expirées
        from . import db
        db.nettoyer_chorales_supprimees()

        identite = auth.identite_depuis_requete(request)
        if not identite:
            return self._refuser(request)
        request.state.identite = identite

        if path in _CHEMINS_CHANGEMENT_MDP:
            return await call_next(request)

        if identite.type == "super":
            compte = auth.get_account()
        else:
            compte = auth.get_chorale(identite.compte_id)
        if not compte:
            return self._refuser(request)
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


class NoCacheStaticMiddleware(BaseHTTPMiddleware):
    """Empêche le navigateur de garder une copie locale périmée d'app.js /
    style.css / index.html après un déploiement : ces fichiers changent de
    contenu sans que leur URL change, donc sans ce garde-fou un onglet resté
    ouvert (ou rouvert depuis l'historique) peut continuer à exécuter un
    JavaScript d'avant le déploiement pendant des heures, avec des
    fonctionnalités manquantes ou cassées. `no-cache` (pas `no-store`)
    autorise quand même une requête conditionnelle bon marché — 304 si le
    fichier n'a pas changé — au lieu d'un re-téléchargement complet à chaque
    chargement de page."""

    _EXTENSIONS = (".js", ".css", ".html")

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path == "/" or path.endswith(self._EXTENSIONS):
            response.headers["Cache-Control"] = "no-cache"
        return response


app.add_middleware(NoCacheStaticMiddleware)
app.add_middleware(AuthMiddleware)

app.include_router(auth_router.router)
app.include_router(chorales.router)
app.include_router(chants.router)
app.include_router(feuillets.router)
app.include_router(parametres.router)
app.include_router(moderation.router)
app.include_router(statistiques.router)
app.include_router(messages.router)
app.include_router(ml.router)
app.include_router(import_.router)
app.include_router(licences.router)


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


from typing import Optional
from fastapi import Depends
from .deps import identite_courante

def _categories_completes(chorale_id: Optional[int] = None) -> list[str]:
    """Liste fixe (constants.py) + catégories ajoutées via "Autre" -> saisie
    libre, persistées en base — "Autre" reste toujours en dernier, comme
    choix de repli pour en créer une nouvelle."""
    fixes = [c for c in CATEGORIES_CHANTS if c != "Autre"]
    personnalisees = [c for c in crud.list_categories_personnalisees(chorale_id) if c not in fixes]
    return fixes + personnalisees + ["Autre"]


@app.get("/meta")
def meta(identite: auth.Identite = Depends(identite_courante)):
    chorale_id = identite.compte_id if identite.type == "chorale" else None
    return {"moments": MOMENTS_LITURGIQUES, "categories": _categories_completes(chorale_id)}


@app.post("/categories")
def ajouter_categorie(payload: schemas.CategoriePersonnalisee, identite: auth.Identite = Depends(identite_courante)):
    nom = payload.nom.strip()
    if not nom or nom == "Autre":
        raise HTTPException(status_code=400, detail="Nom de catégorie invalide")
    
    cree_par = identite.compte_id if identite.type == "chorale" else None
    statut = "valide" if identite.type == "super" else "en_attente"
    
    crud.ajouter_categorie_personnalisee(nom, cree_par, statut)
    return {"categories": _categories_completes(cree_par)}


STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
