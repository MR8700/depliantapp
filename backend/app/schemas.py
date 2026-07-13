from typing import Literal, Optional

from pydantic import BaseModel, Field


class ChantBase(BaseModel):
    titre: str
    categorie: str = "Autre"
    refrain: Optional[str] = None
    couplets: list[str] = Field(default_factory=list)
    code_reference: Optional[str] = None
    langue: str = "fr"
    occasions: list[str] = Field(default_factory=list)
    # "Mot clé" (identifiant lisible) : automatique à partir du titre par
    # défaut (voir crud.create_chant/update_chant + slugify.unique_slug),
    # mais l'éditeur de chant permet de le personnaliser — s'il est fourni
    # ici (non vide), il prime sur la dérivation automatique.
    slug: Optional[str] = None
    mots_cles: list[str] = Field(default_factory=list)
    actif: bool = True
    favori: bool = False
    chant_principal: bool = False
    duree_estimee: Optional[str] = None
    tonalite: Optional[str] = None
    remarques: Optional[str] = None


class ChantCreate(ChantBase):
    pass


class ChantUpdate(BaseModel):
    titre: Optional[str] = None
    categorie: Optional[str] = None
    refrain: Optional[str] = None
    couplets: Optional[list[str]] = None
    code_reference: Optional[str] = None
    langue: Optional[str] = None
    occasions: Optional[list[str]] = None
    slug: Optional[str] = None
    mots_cles: Optional[list[str]] = None
    actif: Optional[bool] = None
    favori: Optional[bool] = None
    chant_principal: Optional[bool] = None
    duree_estimee: Optional[str] = None
    tonalite: Optional[str] = None
    remarques: Optional[str] = None


class Chant(ChantBase):
    id: int
    source_file: Optional[str] = None
    confiance: float = 1.0


class BulkCategorize(BaseModel):
    ids: list[int]
    categorie: str


class BulkDelete(BaseModel):
    ids: list[int]


class Suggestion(BaseModel):
    categorie: str
    score: float


class Doublon(BaseModel):
    id: int
    titre: str
    similarite: float


# --- Feuillet (livret de messe) ---

class MomentContenu(BaseModel):
    """Contenu d'un moment liturgique dans un feuillet.

    type="chant"       -> chant_id référence un chant existant (paroles tirées de la bibliothèque)
    type="texte_libre"  -> texte saisi pour ce feuillet uniquement (ex: intentions de la Prière Universelle)
    type="reference"    -> pointe vers un autre chant par code_reference sans dupliquer le texte
    """

    moment: str
    type: Literal["chant", "texte_libre", "reference"]
    chant_id: Optional[int] = None
    code_reference: Optional[str] = None
    titre_libre: Optional[str] = None
    texte_libre: Optional[str] = None
    couplet_limit: Optional[int] = None
    """Limite le nombre de couplets affichés pour ce chant dans ce feuillet
    (sans modifier le chant dans la bibliothèque) — utile pour tenir sur 2 pages."""
    ordre: Optional[int] = None
    """Position explicite dans le flux de composition (drag&drop ou saisie
    numérique côté client). Si absent, l'ordre de la liste `moments` fait foi —
    permet d'insérer un chant spécial n'importe où sans toucher au moteur."""


class Lectures(BaseModel):
    premiere_lecture: Optional[str] = None
    psaume: Optional[str] = None
    deuxieme_lecture: Optional[str] = None
    evangile: Optional[str] = None


class FeuilletBase(BaseModel):
    date: str
    lieu: Optional[str] = None
    lectures: Lectures = Field(default_factory=Lectures)
    moments: list[MomentContenu] = Field(default_factory=list)
    priere_active: bool = False
    """Widget facultatif « Prière pour le Burkina Faso » : occupe toute la
    zone G2 de la page 1 quand actif ; sinon G2 rejoint le flux des chants."""
    priere_texte: Optional[str] = None
    """Texte de la prière ; si vide et priere_active=True, le texte par
    défaut (prière pour le Burkina Faso) est utilisé."""
    taille_texte_manuelle: Optional[float] = None
    """Taille de police du corps des chants choisie manuellement par
    l'utilisateur (voir render/typography.py::ECHELLES_CORPS pour les
    bornes) ; si None (par défaut), le moteur choisit automatiquement la
    plus grande taille qui remplit les zones sans déborder."""
    one_page_mode: bool = False
    """Si True, réduit le feuillet à 1 seule page paysage en combinant
    la moitié droite de la page 1 (Couverture) avec la partie gauche de la page 2 (C1/C2)."""
    banniere_active: bool = True
    """Si True, affiche la bannière Bon dimanche au bas du feuillet."""


class CategoriePersonnalisee(BaseModel):
    nom: str


class FeuilletCreate(FeuilletBase):
    pass


class Feuillet(FeuilletBase):
    id: int
    chorale_id: Optional[int] = None
    """Chorale propriétaire — toujours fixé côté serveur depuis l'identité de
    la requête, jamais depuis le payload client (voir routers/feuillets.py)."""
    clone_de_id: Optional[int] = None
    """Si ce dépliant est né du clonage d'un dépliant d'une autre chorale
    (modification d'un dépliant qu'on ne possède pas), id de l'original."""
    chorale_nom: Optional[str] = None
    """Nom de la chorale propriétaire — jointure en lecture seule, pour
    l'affichage "composé par X" ; jamais stocké tel quel en base."""
