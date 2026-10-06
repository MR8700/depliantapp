import os
import sys
from pathlib import Path

# Ajouter backend au PYTHONPATH pour que les imports relatifs fonctionnent
racine = Path(__file__).resolve().parent.parent
backend_dir = racine / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))
if str(racine) not in sys.path:
    sys.path.insert(0, str(racine))

from backend.app.main import app

# Export de l'application ASGI pour Vercel
# Vercel Serverless Python détecte la variable 'app'
