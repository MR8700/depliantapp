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
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Format non supporté : {suffix}")

    occasions_list = [o.strip() for o in occasions.split(",") if o.strip()]

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
    saved_count = 0
    replaced_count = 0
    ignored_count = 0

    for item in payload.chants:
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
            crud.create_chant(chant, source_file="import_workspace", confiance=item.confiance)
            saved_count += 1
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
            crud.update_chant(item.replace_id, patch, mark_reviewed=True)
            replaced_count += 1
        else:
            ignored_count += 1

    return {
        "saved": saved_count,
        "replaced": replaced_count,
        "ignored": ignored_count,
    }
