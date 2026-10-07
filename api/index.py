import os
import sys
import traceback
from pathlib import Path

# Ajouter backend et racine au sys.path pour les imports relatifs
racine = Path(__file__).resolve().parent.parent
backend_dir = racine / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))
if str(racine) not in sys.path:
    sys.path.insert(0, str(racine))

try:
    from backend.app.main import app
    from backend.app.db import init_db

    # Initialisation préventive pour Vercel serverless
    try:
        init_db()
    except Exception as e:
        print("Vercel init_db error:", e)

except Exception as err:
    err_tb = traceback.format_exc()
    print("Vercel startup failure:\n", err_tb)

    async def app(scope, receive, send):
        if scope["type"] == "http":
            body = (
                f"<!DOCTYPE html><html><head><meta charset='utf-8'><title>Erreur 500 - DepliantApp</title>"
                f"<style>body{{font-family:system-ui,sans-serif;padding:2rem;background:#0f172a;color:#f8fafc}}"
                f"h1{{color:#f43f5e;font-size:1.5rem}}pre{{background:#1e293b;color:#e2e8f0;padding:1.25rem;"
                f"border-radius:8px;overflow:auto;line-height:1.5;font-size:0.9rem;border:1px solid #334155}}"
                f"</style></head><body>"
                f"<h1>Erreur critique au chargement de l'application (Vercel Serverless)</h1>"
                f"<p>Le module Python principal n'a pas pu s'initialiser. Traceback :</p>"
                f"<pre>{err_tb}</pre>"
                f"</body></html>"
            ).encode("utf-8")
            await send({
                "type": "http.response.start",
                "status": 500,
                "headers": [
                    (b"content-type", b"text/html; charset=utf-8"),
                    (b"content-length", str(len(body)).encode("ascii")),
                ],
            })
            await send({
                "type": "http.response.body",
                "body": body,
            })
        elif scope["type"] == "lifespan":
            while True:
                message = await receive()
                if message["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif message["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    break
