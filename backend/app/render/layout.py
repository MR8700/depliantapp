"""Répartit les sections (mesurées) dans des colonnes de hauteur fixe, sans
jamais couper une section en deux colonnes (règle explicite du cahier des
charges) — une section trop haute pour une colonne signale que la typographie
courante ne convient pas (on réessaiera à une échelle plus petite, ou on
signalera un dépassement si c'est déjà la plus petite)."""
from dataclasses import dataclass
from typing import Callable

from .model import Section


@dataclass
class SectionTropHaute(Exception):
    section: Section
    hauteur: float
    hauteur_colonne: float


def assigner_colonnes(
    sections_mesurees: list[tuple[Section, float, list]],
    hauteur_pour_colonne: Callable[[int], float],
) -> list[list]:
    """sections_mesurees : liste de (section, hauteur, flowables).
    hauteur_pour_colonne(i) : hauteur disponible pour la colonne d'index i
    (la 1ère page a des colonnes plus courtes à cause de l'en-tête).
    Retourne une liste de colonnes (chacune = liste de flowables).
    Lève SectionTropHaute si une section, seule, dépasse déjà sa colonne."""
    colonnes: list[list] = []
    colonne_courante: list = []
    hauteur_courante = 0.0
    hauteur_colonne = hauteur_pour_colonne(0)

    for section, hauteur, flowables in sections_mesurees:
        if hauteur > hauteur_colonne:
            raise SectionTropHaute(section, hauteur, hauteur_colonne)

        if colonne_courante and hauteur_courante + hauteur > hauteur_colonne:
            colonnes.append(colonne_courante)
            colonne_courante = []
            hauteur_courante = 0.0
            hauteur_colonne = hauteur_pour_colonne(len(colonnes))
            if hauteur > hauteur_colonne:
                raise SectionTropHaute(section, hauteur, hauteur_colonne)

        colonne_courante.extend(flowables)
        hauteur_courante += hauteur

    if colonne_courante:
        colonnes.append(colonne_courante)

    return colonnes
