import io
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import Response

from .. import auth, config, schemas, crud, pdf_cache
from ..deps import identite_courante, require_superadmin

router = APIRouter(prefix="/parametres", tags=["parametres"])


@router.get("")
def read_parametres(identite: auth.Identite = Depends(identite_courante)):
    chorale_id = identite.compte_id if identite.type == "chorale" else 0
    return config.get_config(chorale_id)


@router.put("")
def write_parametres(data: dict, identite: auth.Identite = Depends(identite_courante)):
    chorale_id = identite.compte_id if identite.type == "chorale" else 0
    res = config.save_config(chorale_id, data)
    pdf_cache.invalidate_chorale_cache(chorale_id)
    return res


@router.get("/global")
def read_global_parametres(identite: auth.Identite = Depends(identite_courante)):
    """Retourne la configuration globale de l'application (chorale_id = 0),
    notamment pour afficher les informations de GO Technologie sur la page À propos,
    quel que soit l'utilisateur connecté."""
    return config.get_config(0)



# --- Pool partagé de médias (logos, bannières) : voir config.py -----------

@router.post("/medias/recompresser")
def recompresser_medias(_identite: auth.Identite = Depends(require_superadmin)):
    """Rattrapage ponctuel : recompresse toutes les images du pool partagé
    déjà stockées (uploadées avant l'ajout de la compression automatique
    dans config.upload_media), puis vide le cache PDF de toutes les
    chorales pour qu'elles régénèrent avec les images allégées."""
    resultat = config.recompresser_medias_existants()
    pdf_cache.invalidate_all_cache()
    return resultat


@router.get("/medias")
def list_medias(type: Optional[str] = None):
    """Accessible à tout compte authentifié — pour le picker de médias
    (choisir une image déjà uploadée par n'importe quelle chorale)."""
    return config.list_medias(type)


@router.get("/medias/{media_id}/fichier")
def lire_media(media_id: int):
    resultat = config.get_media_bytes(media_id)
    if not resultat:
        raise HTTPException(status_code=404, detail="Image introuvable")
    contenu, content_type = resultat
    return Response(content=contenu, media_type=content_type)


@router.post("/medias")
async def uploader_media(type: str, fichier: UploadFile, identite: auth.Identite = Depends(identite_courante)):
    if type not in ("logo", "banniere"):
        raise HTTPException(status_code=400, detail="Type de média inconnu")
    if not (fichier.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Le fichier doit être une image")
    contenu = await fichier.read()
    chorale_id = identite.compte_id if identite.type == "chorale" else 0
    return config.upload_media(chorale_id, type, fichier.filename, contenu, fichier.content_type)


# --- Emplacements actifs de LA chorale connectée (logo_gauche/logo_droit/banniere_bas) ---

@router.post("/image/{slot}")
async def uploader_et_activer_image(slot: str, fichier: UploadFile, identite: auth.Identite = Depends(identite_courante)):
    """Uploade une nouvelle image dans le pool partagé ET l'active
    immédiatement pour cette chorale — flux le plus simple (équivalent de
    l'ancien remplacement direct). Pour réutiliser une image déjà présente
    dans le pool, voir POST /parametres/image/{slot}/activer."""
    if slot not in config.IMAGE_SLOTS:
        raise HTTPException(status_code=404, detail="Emplacement d'image inconnu")
    if not (fichier.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Le fichier doit être une image")
    contenu = await fichier.read()
    chorale_id = identite.compte_id if identite.type == "chorale" else 0
    res = config.upload_and_activate_image(chorale_id, slot, fichier.filename, contenu, fichier.content_type)
    pdf_cache.invalidate_chorale_cache(chorale_id)
    return res


@router.post("/image/{slot}/activer")
def activer_image(slot: str, payload: dict, identite: auth.Identite = Depends(identite_courante)):
    """Choisit, pour cet emplacement, une image déjà présente dans le pool
    partagé (uploadée par n'importe quelle chorale) plutôt que d'en
    uploader une nouvelle."""
    if slot not in config.IMAGE_SLOTS:
        raise HTTPException(status_code=404, detail="Emplacement d'image inconnu")
    media_id = payload.get("media_id")
    if not media_id or not config.get_media_bytes(media_id):
        raise HTTPException(status_code=404, detail="Image introuvable dans le pool partagé")
    chorale_id = identite.compte_id if identite.type == "chorale" else 0
    res = config.set_active_media(chorale_id, slot, media_id)
    pdf_cache.invalidate_chorale_cache(chorale_id)
    return res


@router.get("/image/{slot}")
def lire_image_active(slot: str, identite: auth.Identite = Depends(identite_courante)):
    if slot not in config.IMAGE_SLOTS:
        raise HTTPException(status_code=404, detail="Emplacement d'image inconnu")
    chorale_id = identite.compte_id if identite.type == "chorale" else 0
    media_id = config.get_config(chorale_id).get(f"{slot}_media_id")
    if not media_id:
        raise HTTPException(status_code=404, detail="Aucune image définie")
    resultat = config.get_media_bytes(media_id)
    if not resultat:
        raise HTTPException(status_code=404, detail="Aucune image définie")
    contenu, content_type = resultat
    return Response(content=contenu, media_type=content_type)


@router.delete("/image/{slot}")
def retirer_image(slot: str, identite: auth.Identite = Depends(identite_courante)):
    """Ne retire l'image QUE pour cette chorale (désélectionne
    l'emplacement) — l'image reste dans le pool partagé pour les autres."""
    if slot not in config.IMAGE_SLOTS:
        raise HTTPException(status_code=404, detail="Emplacement d'image inconnu")
    chorale_id = identite.compte_id if identite.type == "chorale" else 0
    res = config.set_active_media(chorale_id, slot, None)
    pdf_cache.invalidate_chorale_cache(chorale_id)
    return res


@router.post("/preview-pdf")
def preview_settings_pdf(
    data: dict,
    identite: auth.Identite = Depends(identite_courante)
):
    """Génère un PDF d'aperçu dynamique basé sur les réglages temporaires fournis
    dans le corps de la requête, appliqués sur le dernier dépliant de la chorale
    (ou un dépliant factice)."""
    chorale_id = identite.compte_id if identite.type == "chorale" else 0
    # 1. Récupérer le dernier dépliant de la chorale, ou en fabriquer un factice si vide
    feuillets_existants = crud.list_feuillets(chorale_id=chorale_id, limit=1)
    if feuillets_existants:
        feuillet = crud.get_feuillet(feuillets_existants[0].id)
    else:
        # Création d'un feuillet factice par défaut pour l'aperçu avec des moments typiques de chants
        moments_factices = [
            schemas.MomentContenu(moment="Entrée", type="texte_libre", titre_libre="Chant d'Entrée", texte_libre="Refrain :\nPrends Seigneur et reçois,\ntoutes nos vies et nos joies.\n\nCouplet 1 :\nVoici le pain et le vin de nos terres.\nVoici le fruit de notre travail."),
            schemas.MomentContenu(moment="Kyrie", type="texte_libre", titre_libre="Kyrie eleison", texte_libre="Kyrie eleison, Christe eleison, Kyrie eleison."),
            schemas.MomentContenu(moment="Offertoire", type="texte_libre", titre_libre="Apporte ton offrande", texte_libre="Refrain :\nApporte ton offrande, devant l'autel,\ncar le Seigneur t'appelle à partager."),
            schemas.MomentContenu(moment="Communion", type="texte_libre", titre_libre="Pain de Vie", texte_libre="Refrain :\nPain de Vie, Sang de l'Alliance,\nforce et joie de notre marche.\n\nCouplet 1 :\nTu nous donnes ta vie en partage.\nTu nous donnes ton pain pour la route."),
            schemas.MomentContenu(moment="Envoi", type="texte_libre", titre_libre="Vierge Marie", texte_libre="Refrain :\nRegarde l'étoile, invoque Marie,\nsi tu la suis, tu ne crains rien.")
        ]
        feuillet = schemas.Feuillet(
            id=0,
            date="2026-07-13",
            lieu="Paroisse Saint Esprit",
            lectures=schemas.Lectures(premiere_lecture="1 Co 12, 12-31", psaume="Ps 99", deuxieme_lecture=None, evangile="Lc 4, 14-21"),
            moments=moments_factices,
            priere_active=True,
            priere_texte="Seigneur, nous te prions pour la paix dans notre pays et dans le monde entier.",
            taille_texte_manuelle=None,
            one_page_mode=False,
            banniere_active=True,
            chorale_id=chorale_id
        )

    # 2. Remplacer one_page_mode, priere_active, priere_texte et banniere_active
    if "one_page_mode" in data:
        feuillet.one_page_mode = bool(data["one_page_mode"])
    if "priere_active" in data:
        feuillet.priere_active = bool(data["priere_active"])
    if "priere_texte" in data:
        feuillet.priere_texte = data["priere_texte"]
    if "banniere_active" in data:
        feuillet.banniere_active = bool(data["banniere_active"])

    # 3. Construire le config_dict temporaire
    config_actuelle = config.get_config(chorale_id)
    config_temporaire = {**config_actuelle, **data}

    # 4. Construire l'images dict temporaire
    images = {}
    for slot in config.IMAGE_SLOTS:
        key = f"{slot}_media_id"
        media_id = data.get(key) if key in data else config_actuelle.get(key)
        if media_id:
            res = config.get_media_bytes(media_id)
            if res:
                content, _ = res
                images[slot] = config.ImageReader(io.BytesIO(content))
            else:
                images[slot] = None
        else:
            images[slot] = None

    # 5. Rendre le PDF à la volée
    from ..render.pdf import DepassementImpossible, render_feuillet_pdf_auto
    try:
        pdf_bytes, _ = render_feuillet_pdf_auto(feuillet, config_temporaire, images=images)
    except DepassementImpossible as exc:
        raise HTTPException(
            status_code=409,
            detail={"message": str(exc), "moments_en_cause": exc.moments_en_cause},
        )
    return Response(content=pdf_bytes, media_type="application/pdf")
