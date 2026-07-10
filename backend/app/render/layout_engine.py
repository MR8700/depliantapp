"""LayoutEngine : ne connaît que des zones. Il ne pense jamais en pages, ni
en sections liturgiques — seulement en une file d'unités atomiques (titre,
refrain, couplet) à distribuer dans un ordre de zones fixe (FLOW_ORDER).

Règle absolue : une unité ne se coupe jamais. Si elle ne rentre pas dans la
zone courante, elle passe entièrement à la zone suivante. Si elle ne rentre
dans AUCUNE zone restante, le moteur ne réduit jamais la police et ne crée
jamais de 3e page : il signale l'impossibilité (DepassementImpossible)."""
from .measure import Unite
from .model import Section
from .zones import Zone


class DepassementImpossible(Exception):
    """Levée quand le contenu ne tient dans aucune combinaison de zones,
    même en respectant strictement l'atomicité des couplets. Le moteur ne
    supprime jamais de contenu automatiquement ; il signale les moments à
    réduire (via la limite de couplets déjà existante côté Composer)."""

    def __init__(self, message: str, moments_en_cause: list[str]):
        super().__init__(message)
        self.moments_en_cause = moments_en_cause


class LayoutEngine:
    def __init__(self, flow_order: list[Zone]):
        self.flow_order = flow_order

    def distribuer(self, unites: list[Unite], sections: list[Section]) -> dict[str, list]:
        """Retourne {nom_de_zone: [flowables]}. Lève DepassementImpossible
        si toutes les zones du FLOW_ORDER sont épuisées avant la fin de la
        file d'unités."""
        assignation: dict[str, list] = {zone.nom: [] for zone in self.flow_order}

        if not unites:
            return assignation
        if not self.flow_order:
            raise DepassementImpossible(
                "Aucune zone disponible pour composer le feuillet.",
                moments_en_cause=[s.moment for s in sections],
            )

        idx = 0
        zone = self.flow_order[0]
        restante = zone.hauteur - 2 * zone.padding

        for unite in unites:
            while unite.hauteur > restante:
                idx += 1
                if idx >= len(self.flow_order):
                    section = self._section_pour(unite, sections)
                    nom = section.song.titre or section.label if section else "?"
                    raise DepassementImpossible(
                        f"Le contenu ne tient pas dans les zones disponibles (bloqué sur "
                        f"« {nom} »). Réduis le nombre de couplets d'un ou plusieurs chants.",
                        moments_en_cause=[s.moment for s in sections],
                    )
                zone = self.flow_order[idx]
                restante = zone.hauteur - 2 * zone.padding

            assignation[zone.nom].append(unite.flowable)
            restante -= unite.hauteur

        return assignation

    @staticmethod
    def _section_pour(unite: Unite, sections: list[Section]) -> Section | None:
        for section in sections:
            if section.ordre == unite.section_ordre:
                return section
        return None
