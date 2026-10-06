import os
from pathlib import Path

# Sur Render (ou tout hébergeur avec disque persistant), pointe DEPLIANTAPP_DATA_DIR
# vers le point de montage du disque pour que chants.db et les images uploadées
# survivent aux redéploiements. En local, retombe sur backend/data comme avant.
if os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
    _defaut = Path("/tmp/data")
else:
    _defaut = Path(__file__).resolve().parent.parent / "data"

DATA_DIR = Path(os.environ.get("DEPLIANTAPP_DATA_DIR", str(_defaut)))
try:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
except OSError:
    DATA_DIR = Path("/tmp/data")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
