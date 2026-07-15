from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import auth, crud
from ..deps import require_chorale, require_superadmin

router = APIRouter(prefix="/moderation", tags=["moderation"])


class DemandeSuppressionCreation(BaseModel):
    type_cible: str  # "chant" | "feuillet"
    cible_id: int


def _apercu_cible(type_cible: str, cible_id: int) -> Optional[dict]:
    """Contenu de la cible pour l'affichage dans le panneau de modération —
    None si elle a déjà été supprimée entre-temps (demande orpheline)."""
    if type_cible == "chant":
        chant = crud.get_chant(cible_id)
        return {"titre": chant.titre, "categorie": chant.categorie} if chant else None
    feuillet = crud.get_feuillet(cible_id)
    return {"date": feuillet.date, "lieu": feuillet.lieu, "chorale_nom": feuillet.chorale_nom} if feuillet else None


@router.post("/demandes")
def creer_demande(payload: DemandeSuppressionCreation, identite: auth.Identite = Depends(require_chorale)):
    if payload.type_cible not in ("chant", "feuillet"):
        raise HTTPException(status_code=400, detail="type_cible invalide")
    cible_existe = (
        crud.get_chant(payload.cible_id) if payload.type_cible == "chant" else crud.get_feuillet(payload.cible_id)
    )
    if not cible_existe:
        raise HTTPException(status_code=404, detail="Ressource introuvable")
    demande = crud.creer_demande_suppression(payload.type_cible, payload.cible_id, identite.compte_id)
    return demande


@router.get("/demandes")
def list_demandes(statut: Optional[str] = "en_attente", _identite: auth.Identite = Depends(require_superadmin)):
    demandes = crud.list_demandes_suppression(statut)
    for d in demandes:
        d["apercu"] = _apercu_cible(d["type_cible"], d["cible_id"])
    return demandes


@router.post("/demandes/{demande_id}/valider")
def valider(demande_id: int, _identite: auth.Identite = Depends(require_superadmin)):
    if not crud.valider_demande_suppression(demande_id):
        raise HTTPException(status_code=404, detail="Demande introuvable ou déjà traitée")
    return {"ok": True}


@router.post("/demandes/{demande_id}/annuler")
def annuler(demande_id: int, _identite: auth.Identite = Depends(require_superadmin)):
    if not crud.annuler_demande_suppression(demande_id):
        raise HTTPException(status_code=404, detail="Demande introuvable ou déjà traitée")
    return {"ok": True}


@router.get("/masques")
def list_masques(_identite: auth.Identite = Depends(require_superadmin)):
    masques = crud.list_masques()
    for m in masques:
        m["apercu"] = _apercu_cible(m["type_cible"], m["cible_id"])
    return masques


@router.delete("/masques/{masque_id}")
def restaurer(masque_id: int, _identite: auth.Identite = Depends(require_superadmin)):
    if not crud.restaurer_masque(masque_id):
        raise HTTPException(status_code=404, detail="Masque introuvable")
    return {"ok": True}


@router.get("/categories")
def list_categories_moderation(statut: Optional[str] = "en_attente", _identite: auth.Identite = Depends(require_superadmin)):
    with crud.get_connection() as conn:
        rows = conn.execute(
            "SELECT cp.id, cp.nom, cp.statut, cp.motif_rejet, cp.created_at, c.nom as chorale_nom "
            "FROM categories_personnalisees cp "
            "LEFT JOIN chorales c ON cp.cree_par = c.id "
            "WHERE cp.statut = ? ORDER BY cp.created_at DESC",
            (statut,)
        ).fetchall()
        return [dict(r) for r in rows]


class RejetCategoriePayload(BaseModel):
    motif: str


@router.post("/categories/{id}/valider")
def valider_categorie(id: int, _identite: auth.Identite = Depends(require_superadmin)):
    with crud.get_connection() as conn:
        conn.execute("UPDATE categories_personnalisees SET statut = 'valide', motif_rejet = NULL WHERE id = ?", (id,))
    return {"ok": True}


@router.post("/categories/{id}/rejeter")
def rejeter_categorie(id: int, payload: RejetCategoriePayload, _identite: auth.Identite = Depends(require_superadmin)):
    with crud.get_connection() as conn:
        cp = conn.execute("SELECT nom, cree_par FROM categories_personnalisees WHERE id = ?", (id,)).fetchone()
        if not cp:
            raise HTTPException(status_code=404, detail="Catégorie introuvable")
        conn.execute("UPDATE categories_personnalisees SET statut = 'rejete', motif_rejet = ? WHERE id = ?", (payload.motif, id))
        
        # Send system notification message to the creator chorale
        if cp["cree_par"]:
            crud.creer_message(
                chorale_id=cp["cree_par"],
                expediteur_type="super",
                texte=f"Votre demande d'ajout de la catégorie '{cp['nom']}' a été rejetée par l'administrateur. Motif : {payload.motif}"
            )
    return {"ok": True}
