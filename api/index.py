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


class AsgiExceptionCapture:
    """Intercepteur global d'exceptions ASGI pour Vercel Serverless.
    Garantit qu'aucune exception non interceptée ne s'échappe du callable ASGI,
    ce qui provoquerait l'erreur opaque Vercel '500 FUNCTION_INVOCATION_FAILED'.
    Capture toute erreur et renvoie un rapport d'erreur complet (HTML ou JSON)."""

    def __init__(self, asgi_app):
        self.asgi_app = asgi_app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.asgi_app(scope, receive, send)

        response_started = False

        async def send_wrapper(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.asgi_app(scope, receive, send_wrapper)
        except Exception as exc:
            err_tb = traceback.format_exc()
            print("CAPTURED UNHANDLED REQUEST EXCEPTION:\n", err_tb, file=sys.stderr)
            if not response_started:
                req_path = scope.get("path", "")
                headers = dict(scope.get("headers", []))
                accept = headers.get(b"accept", b"").decode("latin-1", "ignore").lower()

                if "application/json" in accept or req_path.startswith(("/auth/", "/chants", "/feuillets", "/parametres", "/meta", "/statistiques", "/messages", "/ml")):
                    import json
                    content = json.dumps({
                        "error": "InternalServerError",
                        "detail": str(exc),
                        "path": req_path,
                        "traceback": err_tb
                    }).encode("utf-8")
                    content_type = b"application/json; charset=utf-8"
                else:
                    content = (
                        f"<!DOCTYPE html><html><head><meta charset='utf-8'><title>Erreur 500 - DepliantApp</title>"
                        f"<style>body{{font-family:system-ui,sans-serif;padding:2rem;background:#0f172a;color:#f8fafc}}"
                        f"h1{{color:#f43f5e;font-size:1.5rem}}pre{{background:#1e293b;color:#e2e8f0;padding:1.25rem;"
                        f"border-radius:8px;overflow:auto;line-height:1.5;font-size:0.9rem;border:1px solid #334155}}"
                        f"</style></head><body>"
                        f"<h1>Erreur interne lors du traitement de la requête</h1>"
                        f"<p><strong>URL demandée :</strong> {req_path}</p>"
                        f"<p><strong>Détail :</strong> {exc}</p>"
                        f"<pre>{err_tb}</pre>"
                        f"</body></html>"
                    ).encode("utf-8")
                    content_type = b"text/html; charset=utf-8"

                await send({
                    "type": "http.response.start",
                    "status": 500,
                    "headers": [
                        (b"content-type", content_type),
                        (b"content-length", str(len(content)).encode("ascii")),
                    ],
                })
                await send({
                    "type": "http.response.body",
                    "body": content,
                })
            else:
                raise


try:
    from backend.app.main import app as _fastapi_app
    from backend.app.db import init_db

    # Initialisation préventive pour Vercel serverless
    try:
        init_db()
    except Exception as e:
        print("Vercel init_db error:", e, file=sys.stderr)

    app = AsgiExceptionCapture(_fastapi_app)

except Exception as err:
    err_tb = traceback.format_exc()
    print("Vercel startup failure:\n", err_tb, file=sys.stderr)

    async def fallback_app(scope, receive, send):
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

    app = fallback_app
