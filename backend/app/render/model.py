"""Modèle de composition partagé : résout un feuillet en une liste de sections
ordonnées (chaque section = un chant/texte résolu), indépendamment du moteur de
rendu. Le moteur ne connaît aucun nom de moment liturgique fixe : il reçoit une
liste triée de sections et compose. Un chant spécial ajouté par l'utilisateur
se place exactement comme les autres, selon son "ordre"."""
from dataclasses import dataclass, field
from typing import Optional

from .. import crud, schemas
from .labels import label_for


@dataclass
class Song:
    titre: Optional[str]
    refrain: Optional[str]
    couplets: list[str] = field(default_factory=list)


@dataclass
class Section:
    moment: str
    label: str
    song: Song
    ordre: int = 0


def _resolve_song(moment: schemas.MomentContenu) -> Song:
    chant = None
    if moment.type == "chant" and moment.chant_id is not None:
        chant = crud.get_chant(moment.chant_id)
    elif moment.type == "reference" and moment.code_reference:
        chant = crud.get_chant_by_reference(moment.code_reference)

    if chant:
        couplets = chant.couplets
        if moment.couplet_limit is not None:
            couplets = couplets[: moment.couplet_limit]
        return Song(titre=chant.titre, refrain=chant.refrain, couplets=couplets)

    return Song(
        titre=moment.titre_libre,
        refrain=None,
        couplets=[moment.texte_libre] if moment.texte_libre else [],
    )


def build_sections(feuillet: schemas.Feuillet) -> list[Section]:
    """Trie les moments par `ordre` explicite (drag&drop / saisie numérique) ;
    à défaut, l'ordre de la liste `moments` fait foi (index stable)."""
    indexed = list(enumerate(feuillet.moments))
    indexed.sort(key=lambda pair: pair[1].ordre if pair[1].ordre is not None else pair[0])
    return [
        Section(moment=m.moment, label=label_for(m.moment), song=_resolve_song(m), ordre=i)
        for i, (_, m) in enumerate(indexed)
    ]
