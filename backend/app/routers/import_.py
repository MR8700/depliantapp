import tempfile
from pathlib import Path

from fastapi import APIRouter, Form, HTTPException, UploadFile

from .. import crud, schemas
from ..ingestion.generic import SUPPORTED_EXTENSIONS, parse_and_segment

router = APIRouter(prefix="/import", tags=["import"])


@router.post("/upload")
async def upload_carnet(
    fichier: UploadFile,
    categorie_defaut: str = Form("Autre"),
    occasions: str = Form(""),
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

    a_verifier = []
    for categorie, raw in resultats:
        chant = schemas.ChantCreate(
            titre=raw.titre or "(sans titre)",
            categorie=categorie,
            refrain=raw.refrain,
            couplets=raw.couplets,
            code_reference=raw.code_reference,
            occasions=occasions_list,
        )
        saved = crud.create_chant(chant, source_file=fichier.filename, confiance=raw.confiance)
        if raw.confiance < 0.7:
            a_verifier.append({"id": saved.id, "titre": saved.titre, "confiance": raw.confiance})

    return {
        "fichier": fichier.filename,
        "total_importes": len(resultats),
        "a_verifier": a_verifier,
    }
