import os
import sys
from pathlib import Path

# Ajouter backend et racine au sys.path pour les imports relatifs
racine = Path(__file__).resolve().parent.parent
backend_dir = racine / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))
if str(racine) not in sys.path:
    sys.path.insert(0, str(racine))

from backend.app.main import app
from backend.app.db import init_db

# Initialisation préventive au démarrage du conteneur Vercel
try:
    init_db()
except Exception as e:
    print("Vercel init_db error:", e)
