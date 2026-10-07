import tempfile
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile

from .. import auth, config, crud, schemas
from ..deps import identite_courante
from ..ingestion.generic import SUPPORTED_EXTENSIONS, parse_and_segment
from ..ingestion.parse_pdf import detecter_marqueur_reimport
from ..ml import duplicates
from ..ml.classifier import suggest_categorie
from ..ml.languages import detecter_langue

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
    auteur: Optional[str] = None
    compositeur: Optional[str] = None


class FinalizeImportPayload(BaseModel):
    chants: List[ImportedChantFinalize]


@router.post("/upload")
async def upload_carnet(
    fichier: UploadFile,
    categorie_defaut: str = Form("Autre"),
    occasions: str = Form(""),
    langue: str = Form("fr"),
    auteur: str = Form(""),
    _identite: auth.Identite = Depends(identite_courante),
):
    suffix = Path(fichier.filename).suffix.lower()
    if suffix != ".json" and suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Format non supporté : {suffix}")

    occasions_list = [o.strip() for o in occasions.split(",") if o.strip()]

    from ..ingestion.common import _match_section_header
    nom_stem = Path(fichier.filename).stem
    cat_fichier = _match_section_header(nom_stem)
    if cat_fichier and (not categorie_defaut or categorie_defaut == "Autre"):
        categorie_defaut = cat_fichier

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
            # Message client volontairement générique -- le détail complet
            # (potentiellement un chemin de fichier temporaire ou une trace
            # interne de la bibliothèque d'analyse) part uniquement dans les
            # logs serveur, jamais au client (voir audit de sécurité).
            print(f"[import/upload] JSON invalide : {exc!r}")
            raise HTTPException(status_code=400, detail="Fichier de sauvegarde JSON invalide ou mal formé")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp) / fichier.filename
        tmp_path.write_bytes(await fichier.read())

        try:
            resultats = parse_and_segment(tmp_path, categorie_defaut=categorie_defaut)
        except Exception as exc:
            print(f"[import/upload] échec analyse {fichier.filename!r} : {exc!r}")
            raise HTTPException(
                status_code=422,
                detail="Échec de l'analyse du fichier -- vérifie qu'il n'est pas corrompu ou protégé par mot de passe",
            ) from exc

        # Reconnaissance d'un PDF DepliantApp réimporté (voir render/pdf.py::
        # _dessiner_marqueur_reimport) : l'analyse structurelle ci-dessus
        # (parse_and_segment / segment_notre_modele) a DÉJÀ reconstruit le
        # contenu depuis le PDF lui-même, elle marche même si le feuillet ou
        # les chants d'origine ont depuis été supprimés -- ce marqueur sert
        # seulement à transformer un rapprochement par SIMILARITÉ DE TITRE
        # (find_duplicates, flou) en correspondance EXACTE quand les chants
        # d'origine existent toujours, pour ne jamais recréer un doublon d'un
        # chant déjà connu avec certitude.
        ids_marqueur = detecter_marqueur_reimport(tmp_path) if suffix == ".pdf" else []

    # Charger les candidats de la base de données une seule fois
    from ..db import get_connection
    with get_connection() as conn:
        rows = conn.execute("SELECT id, titre FROM chants").fetchall()
    candidates = [{"id": r["id"], "titre": r["titre"]} for r in rows]
    titres_par_id = {c["id"]: c["titre"] for c in candidates}
    titres_connus_normalises = {
        (titres_par_id[i] or "").strip().lower(): i for i in ids_marqueur if i in titres_par_id
    }

    parsed_chants = []
    for categorie, raw in resultats:
        # Recherche de doublons potentiels dans la base
        doublons = duplicates.find_duplicates(raw.titre or "", candidates=candidates)
        id_connu = titres_connus_normalises.get((raw.titre or "").strip().lower())
        if id_connu is not None and not any(d["id"] == id_connu for d in doublons):
            doublons = [{"id": id_connu, "titre": titres_par_id[id_connu], "similarite": 1.0}] + doublons

        # Détection de la catégorie liturgique :
        # Priorité 1 : Catégorie explicitement détectée sur le chant (ex. en-tête de section du carnet, titre codé)
        # Priorité 2 : Catégorie déduite du nom du fichier ou spécifiée à l'import (si spécifique et non 'Autre')
        # Priorité 3 : Suggestion IA par le classifieur liturgique (uniquement si aucune catégorie spécifique n'est établie)
        categorie_finale = raw.categorie_detectee or categorie
        if not categorie_finale or categorie_finale == "Autre":
            if categorie_defaut and categorie_defaut != "Autre":
                categorie_finale = categorie_defaut
            else:
                suggestions = suggest_categorie(raw.titre or "", raw.refrain, raw.couplets)
                if suggestions:
                    top_cat, top_score = suggestions[0]
                    if top_score >= 0.40 and top_cat != "Autre":
                        categorie_finale = top_cat
        if not categorie_finale:
            categorie_finale = "Autre"

        # Détection automatique de la langue de chaque chant (latin, mooré, dioula, lingala, etc.)
        langue_chant = detecter_langue(raw.titre or "", raw.refrain, raw.couplets, langue_defaut=langue or "fr")

        # Occasions spécifiques (ex. Marial)
        occasions_chant = list(occasions_list)
        if categorie_finale == "Marial" and "Marial" not in occasions_chant:
            occasions_chant.append("Marial")

        parsed_chants.append({
            "titre": raw.titre or "",
            "refrain": raw.refrain or "",
            "couplets": raw.couplets,
            "code_reference": raw.code_reference,
            "confiance": raw.confiance,
            "categorie": categorie_finale,
            "occasions": occasions_chant,
            "langue": langue_chant,
            "auteur": auteur or None,
            "doublons": doublons,
            "avertissements": raw.avertissements,
        })

    return {
        "fichier": fichier.filename,
        "chants": parsed_chants
    }


@router.post("/finalize")
async def finalize_import(payload: FinalizeImportPayload, identite: auth.Identite = Depends(identite_courante)):
    import concurrent.futures

    payload_chants = payload.chants
    N = len(payload_chants)
    if N == 0:
        return {"saved": 0, "replaced": 0, "ignored": 0}

    chorale_id_appelant = identite.compte_id if identite.type == "chorale" else None

    if chorale_id_appelant is not None:
        # Une chorale ne peut "replace" (écraser le contenu) que SES PROPRES
        # chants -- sans ce contrôle, n'importe quel compte chorale pouvait
        # écraser titre/paroles/auteur de n'importe quel chant existant
        # (y compris d'une autre chorale ou déjà validé par l'admin) via un
        # import. Toute demande de remplacement sur un chant non possédé est
        # ramenée à une simple création plutôt que rejetée en bloc, pour ne
        # pas perdre le reste d'un import par ailleurs légitime.
        ids_replace = [c.replace_id for c in payload_chants if c.action == "replace" and c.replace_id is not None]
        proprietaires = crud.get_chants_proprietaires(ids_replace)
        for item in payload_chants:
            if item.action == "replace" and item.replace_id is not None:
                if proprietaires.get(item.replace_id) != chorale_id_appelant:
                    item.action = "save"
                    item.replace_id = None
        # Même règle de visibilité que la création directe (voir
        # routers/chants.py::create_chant) : un chant importé par une
        # chorale reste privé tant qu'un administrateur ne l'a pas publié,
        # sauf publication automatique activée.
        publication_auto = bool(config.get_config(0).get("chants_publication_auto"))
        visibilite = "publique" if publication_auto else "chorale"
    else:
        visibilite = "publique"

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
                    auteur=item.auteur,
                    compositeur=item.compositeur,
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
                    auteur=item.auteur,
                    compositeur=item.compositeur,
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

    saved, replaced, ignored = crud.bulk_import_chants(
        prepared_ops, chorale_proprietaire_id=chorale_id_appelant, visibilite=visibilite,
    )

    return {
        "saved": saved,
        "replaced": replaced,
        "ignored": ignored,
    }
