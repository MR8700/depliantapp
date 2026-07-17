import tempfile
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel

from fastapi import APIRouter, Form, HTTPException, UploadFile

from .. import crud, schemas
from ..ingestion.generic import SUPPORTED_EXTENSIONS, parse_and_segment
from ..ml import duplicates

router = APIRouter(prefix="/import", tags=["import"])


class ImportedChantFinalize(BaseModel):
    action: str  # "save", "replace", "ignore"
    replace_id: Optional[int] = None
    titre: str
    refrain: Optional[str] = None
    couplets: List[str]
    code_reference: Optional[str] = None
    categorie: str
    occasions: List[str]
    confiance: float
    langue: Optional[str] = "fr"


class FinalizeImportPayload(BaseModel):
    chants: List[ImportedChantFinalize]


@router.post("/upload")
async def upload_carnet(
    fichier: UploadFile,
    categorie_defaut: str = Form("Autre"),
    occasions: str = Form(""),
    langue: str = Form("fr"),
):
    suffix = Path(fichier.filename).suffix.lower()
    if suffix != ".json" and suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Format non supporté : {suffix}")

    occasions_list = [o.strip() for o in occasions.split(",") if o.strip()]

    if suffix == ".json":
        import json
        try:
            content = await fichier.read()
            data = json.loads(content)
            if not isinstance(data, list):
                raise ValueError("Le fichier JSON doit être une liste de chants")
            parsed_chants = []
            for item in data:
                parsed_chants.append({
                    "titre": item.get("titre") or "",
                    "refrain": item.get("refrain") or "",
                    "couplets": item.get("couplets") or [],
                    "code_reference": item.get("code_reference") or item.get("slug") or "",
                    "confiance": item.get("confiance") or 1.0,
                    "categorie": item.get("categorie") or "Autre",
                    "langue": item.get("langue") or "fr",
                    "auteur": item.get("auteur") or "",
                    "compositeur": item.get("compositeur") or "",
                    "tonalite": item.get("tonalite") or "",
                    "duree_estimee": item.get("duree_estimee") or "",
                    "remarques": item.get("remarques") or "",
                    "actif": item.get("actif") != False,
                    "doublons": []
                })
            return parsed_chants
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Fichier de sauvegarde JSON invalide : {exc}")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp) / fichier.filename
        tmp_path.write_bytes(await fichier.read())

        try:
            resultats = parse_and_segment(tmp_path, categorie_defaut=categorie_defaut)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Échec de l'analyse du fichier : {exc}") from exc

    # Charger les candidats de la base de données une seule fois
    from ..db import get_connection
    with get_connection() as conn:
        rows = conn.execute("SELECT id, titre FROM chants").fetchall()
    candidates = [{"id": r["id"], "titre": r["titre"]} for r in rows]

    parsed_chants = []
    for categorie, raw in resultats:
        # Recherche de doublons potentiels dans la base
        doublons = duplicates.find_duplicates(raw.titre or "", candidates=candidates)
        parsed_chants.append({
            "titre": raw.titre or "",
            "refrain": raw.refrain or "",
            "couplets": raw.couplets,
            "code_reference": raw.code_reference,
            "confiance": raw.confiance,
            "categorie": categorie,
            "occasions": occasions_list,
            "langue": langue,
            "doublons": doublons,
            "avertissements": raw.avertissements,
        })

    return {
        "fichier": fichier.filename,
        "chants": parsed_chants
    }


@router.post("/finalize")
async def finalize_import(payload: FinalizeImportPayload):
    import concurrent.futures

    payload_chants = payload.chants
    N = len(payload_chants)
    if N == 0:
        return {"saved": 0, "replaced": 0, "ignored": 0}

    M1 = N // 4
    M2 = N // 2
    M3 = (3 * N) // 4

    prepared_ops = [None] * N

    def worker_range(start, end, step):
        for i in range(start, end, step):
            item = payload_chants[i]
            if item.action == "save":
                chant = schemas.ChantCreate(
                    titre=item.titre or "(sans titre)",
                    categorie=item.categorie,
                    refrain=item.refrain,
                    couplets=item.couplets,
                    code_reference=item.code_reference,
                    occasions=item.occasions,
                    langue=item.langue or "fr",
                )
                prepared_ops[i] = {"type": "save", "chant": chant, "confiance": item.confiance}
            elif item.action == "replace" and item.replace_id is not None:
                patch = schemas.ChantUpdate(
                    titre=item.titre,
                    categorie=item.categorie,
                    refrain=item.refrain,
                    couplets=item.couplets,
                    code_reference=item.code_reference,
                    occasions=item.occasions,
                    langue=item.langue,
                )
                prepared_ops[i] = {"type": "replace", "id": item.replace_id, "patch": patch}
            else:
                prepared_ops[i] = {"type": "ignore"}

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [
            executor.submit(worker_range, 0, M1, 1),
            executor.submit(worker_range, M2 - 1, M1 - 1, -1),
            executor.submit(worker_range, M2, M3, 1),
            executor.submit(worker_range, N - 1, M3 - 1, -1)
        ]
        concurrent.futures.wait(futures)

    saved, replaced, ignored = crud.bulk_import_chants(prepared_ops)

    return {
        "saved": saved,
        "replaced": replaced,
        "ignored": ignored,
    }
