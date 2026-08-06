"""Lectures liturgiques du jour (AELF) + rapprochement avec la bibliothèque
de chants -- voir aelf.py (client + cache) et aelf_matching.py (scoring)."""
from datetime import date as date_cls

from fastapi import APIRouter, Depends, HTTPException

from .. import aelf, aelf_matching, auth, config, crud
from ..deps import identite_courante

router = APIRouter(prefix="/aelf", tags=["aelf"])

_MAX_JOURS_SYNCHRO_PAR_APPEL = 20
"""Chaque appel à /synchroniser ne traite qu'un lot borné de jours manquants
-- une synchronisation sur 365 jours ferait, au premier appel, 365 requêtes
HTTP séquentielles vers AELF dans une seule requête FastAPI (risque de
timeout côté client/proxy) ; le mobile boucle sur cet endpoint jusqu'à ce que
`restants` tombe à 0 (voir mobile/src/api/aelf.ts), avec une barre de
progression."""
_FENETRE_ANNEE_JOURS = 366  # marge pour les années bissextiles


def _zone(identite: auth.Identite) -> str:
    return config.get_config(0).get("aelf_zone") or aelf.ZONE_DEFAUT


@router.get("/jour")
def lectures_du_jour(jour: str | None = None, identite: auth.Identite = Depends(identite_courante)):
    """jour au format AAAA-MM-JJ, défaut aujourd'hui. Cache-first (voir
    aelf.py) -- ne sollicite AELF que si personne ne l'a encore demandé."""
    jour_cible = jour or date_cls.today().isoformat()
    try:
        date_cls.fromisoformat(jour_cible)
    except ValueError:
        raise HTTPException(status_code=400, detail="Date invalide (attendu AAAA-MM-JJ)")
    zone = _zone(identite)
    try:
        donnees = aelf.get_lectures_jour(jour_cible, zone)
    except aelf.ErreurAelf as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"date": jour_cible, "zone": zone, **donnees}


@router.post("/synchroniser")
def synchroniser(depuis: str | None = None, identite: auth.Identite = Depends(identite_courante)):
    """Récupère un lot de jours manquants à partir de `depuis` (défaut
    aujourd'hui) sur la fenêtre d'une année liturgique complète -- à
    rappeler en boucle (voir mobile) jusqu'à ce que "restants" atteigne 0.
    Ouvert à toute chorale (pas de coût par appelant : le cache est
    partagé, la 2e chorale à synchroniser ne refait aucun travail)."""
    jour_depart = depuis or date_cls.today().isoformat()
    try:
        date_cls.fromisoformat(jour_depart)
    except ValueError:
        raise HTTPException(status_code=400, detail="Date invalide (attendu AAAA-MM-JJ)")
    zone = _zone(identite)
    manquants = aelf.jours_manquants(jour_depart, _FENETRE_ANNEE_JOURS, zone)
    lot = manquants[:_MAX_JOURS_SYNCHRO_PAR_APPEL]
    reussis, echecs = aelf.synchroniser_jours(lot, zone)
    return {
        "traites": reussis,
        "echecs": echecs,
        "restants": max(0, len(manquants) - len(lot)),
    }


@router.get("/annee")
def annee_en_cache(depuis: str | None = None, identite: auth.Identite = Depends(identite_courante)):
    """Export en masse de tout ce qui est déjà en cache sur la fenêtre d'une
    année liturgique -- le mobile l'appelle après avoir bouclé sur
    /synchroniser, pour rapatrier le tout en un seul téléchargement plutôt
    qu'un GET /jour par date."""
    jour_depart = depuis or date_cls.today().isoformat()
    zone = _zone(identite)
    return {"zone": zone, "jours": aelf.lister_cache(jour_depart, _FENETRE_ANNEE_JOURS, zone)}


@router.get("/chants-du-jour")
def chants_du_jour(jour: str | None = None, identite: auth.Identite = Depends(identite_courante)):
    """Bibliothèque de chants ENTIÈRE (respecte le masquage/visibilité
    habituels de l'appelant), chaque chant annoté d'un score de
    correspondance avec les lectures du jour (0 = aucun rapport, 1 =
    référence biblique exacte) -- le tri par moment liturgique et
    l'affichage "en avant" des meilleurs scores restent la responsabilité du
    client (mobile/web), ce endpoint fournit juste le signal."""
    jour_cible = jour or date_cls.today().isoformat()
    zone = _zone(identite)
    try:
        donnees = aelf.get_lectures_jour(jour_cible, zone)
    except aelf.ErreurAelf as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    lectures = aelf_matching.extraire_lectures(donnees)

    chorale_id_appelant = identite.compte_id if identite.type == "chorale" else None
    chants = crud.list_chants(chorale_id_appelant=chorale_id_appelant, limit=100000)

    resultats = []
    for chant in chants:
        cible = aelf_matching.ChantPourRapprochement(
            id=chant.id, titre=chant.titre, refrain=chant.refrain, couplets=chant.couplets,
            mots_cles=chant.mots_cles, references_bibliques=chant.references_bibliques,
        )
        score = aelf_matching.score_chant_pour_lectures(cible, lectures)
        resultats.append({**chant.model_dump(), "correspondance": round(score, 3)})

    resultats.sort(key=lambda r: r["correspondance"], reverse=True)
    return {"date": jour_cible, "informations": donnees.get("informations", {}), "chants": resultats}
