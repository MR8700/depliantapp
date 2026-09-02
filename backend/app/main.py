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
from .routers import aelf, chants, chorales, feuillets, import_, licences, messages, ml, moderation, parametres, statistiques

app = FastAPI(title="DepliantApp API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    # Explicite plutôt qu'implicite : la combinaison origines="*" +
    # credentials=True est ce que les navigateurs bloquent de toute façon
    # (et ce qui rendrait le cookie de session lisible cross-origin) --
    # fixé à False ici pour qu'un futur changement ne l'active jamais par
    # inadvertance en même temps qu'un allow_origins encore large.
    allow_credentials=False,
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
_CHEMINS_CHANGEMENT_MDP = {"/auth/logout", "/auth/change-password", "/acces-refuse-chorale.html"}
# Seuls chemins qu'une chorale garde sur le web (voir le blocage plus bas) :
# la page qui explique la situation, la déconnexion pour repartir sur
# login.html, et les quelques fichiers statiques dont cette page a besoin --
# sans /auth/logout ici, une chorale bloquée resterait bloquée pour toujours,
# incapable même de se déconnecter.
_CHEMINS_ACCES_REFUSE_CHORALE = {"/acces-refuse-chorale.html", "/auth/logout", "/favicon.ico"}


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

        # Carve-out Messagerie : un appareil chorale (licence 100% hors-ligne,
        # voir app/licence_signature.py) n'a plus jamais de session/Bearer
        # classique -- il prouve son identité par possession du `seed` de sa
        # licence (voir app/messages_auth.py). Volontairement restreint à
        # /messages/* hors /messages/chorales (boîte de réception admin, qui
        # garde le chemin session/cookie normal ci-dessous, inchangé) et
        # déclenché UNIQUEMENT par la présence de l'en-tête dédié -- toute
        # requête sans cet en-tête (web, ou mobile super-admin) retombe sur
        # la résolution identite_depuis_requete normale, sans aucun impact.
        if (path.startswith("/messages") and path != "/messages/chorales" or path == "/licences/synchroniser-usage") and "x-chorale-proof" in request.headers:
            from . import messages_auth
            identite_chorale = messages_auth.identite_depuis_preuve_chorale(request)
            if not identite_chorale:
                return self._refuser(request)
            request.state.identite = identite_chorale
            return await call_next(request)

        identite = auth.identite_depuis_requete(request)
        if not identite:
            return self._refuser(request)
        request.state.identite = identite

        # Le site web est désormais réservé au super-admin -- une chorale
        # gère tout depuis l'app mobile. On distingue une session NAVIGATEUR
        # (cookie) d'une session MOBILE (Bearer, voir api/client.ts::jeton())
        # par la présence de l'en-tête Authorization : app.js n'en envoie
        # jamais (repose entièrement sur le cookie), donc son absence
        # signale de façon fiable un accès web, jamais l'app mobile -- même
        # si un cookie traînait par accident côté mobile, la présence de son
        # en-tête Bearer sur CETTE requête suffit à l'exempter. Une chorale
        # authentifiée par cookie ne perd donc RIEN côté mobile (API
        # inchangée), seul l'accès au site web lui est fermé.
        if identite.type == "chorale" and "authorization" not in request.headers and path not in _CHEMINS_ACCES_REFUSE_CHORALE:
            return self._refuser_web_chorale(request)

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

        if identite.type == "chorale":
            from . import licences as licences_module
            appareil_id = request.headers.get("x-appareil-id") or None
            erreur_licence = licences_module.verifier_licence_appareil(identite.compte_id, appareil_id)
            if erreur_licence:
                return self._refuser_licence(request, erreur_licence)

        return await call_next(request)

    @staticmethod
    def _refuser(request):
        path = request.url.path
        est_page = path == "/" or path.endswith(".html")
        if est_page:
            return RedirectResponse(url="/login.html", status_code=303)
        return JSONResponse(status_code=401, content={"detail": "Authentification requise"})

    @staticmethod
    def _refuser_web_chorale(request):
        """Le site web est réservé au super-admin -- une chorale connectée
        par cookie (voir le commentaire au point d'appel) est renvoyée vers
        une page dédiée qui explique la situation plutôt qu'un 401 muet ou
        une redirection vers login.html (qui la ramènerait juste ici en
        boucle après une nouvelle connexion)."""
        path = request.url.path
        est_page = path == "/" or path.endswith(".html")
        if est_page:
            return RedirectResponse(url="/acces-refuse-chorale.html", status_code=303)
        return JSONResponse(
            status_code=403,
            content={"detail": "Le site web est réservé aux administrateurs -- utilisez l'application mobile DepliantApp."},
        )

    @staticmethod
    def _refuser_licence(request, message: str):
        """Distinct de _refuser (401 générique) : un code dédié ("licence_
        invalide") que le client mobile reconnaît spécifiquement pour effacer
        la session ET l'activation locale, puis renvoyer sur l'écran
        d'activation avec ce message clair -- pas juste "reconnecte-toi",
        qui laisserait croire qu'un simple nouveau login suffirait alors que
        la licence elle-même doit être réglée par l'admin (voir App.tsx /
        api/client.ts côté mobile)."""
        path = request.url.path
        est_page = path == "/" or path.endswith(".html")
        if est_page:
            return RedirectResponse(url="/login.html", status_code=303)
        return JSONResponse(status_code=403, content={"detail": message, "code": "licence_invalide"})


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


class EnTetesSecuriteMiddleware(BaseHTTPMiddleware):
    """En-têtes de sécurité de base, absents jusqu'ici :
    - X-Frame-Options / frame-ancestors (CSP) : empêche un site tiers
      d'encapsuler l'application dans une <iframe> invisible pour piéger un
      utilisateur déjà connecté (clickjacking) -- le cookie de session est
      SameSite=Lax, ce qui réduit déjà le risque, mais ne l'élimine pas pour
      les actions déclenchées par un simple clic (GET).
    - X-Content-Type-Options: nosniff : empêche le navigateur de deviner un
      type de contenu différent de celui déclaré (ex: interpréter un média
      uploadé comme du HTML/JS exécutable).
    - Strict-Transport-Security : sans effet sur une réponse HTTP (les
      navigateurs l'ignorent hors HTTPS), donc sans risque en local ; agit
      dès que le service est servi en HTTPS (Render, par défaut)."""

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = "frame-ancestors 'none'"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


app.add_middleware(NoCacheStaticMiddleware)
app.add_middleware(EnTetesSecuriteMiddleware)
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
app.include_router(aelf.router)


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
