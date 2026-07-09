from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .constants import CATEGORIES_CHANTS, MOMENTS_LITURGIQUES
from .db import init_db
from .ml import classifier
from .routers import chants, feuillets, import_, ml, parametres

app = FastAPI(title="DepliantApp API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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


@app.get("/meta")
def meta():
    return {"moments": MOMENTS_LITURGIQUES, "categories": CATEGORIES_CHANTS}


STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
