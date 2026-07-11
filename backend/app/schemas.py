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


class Chant(ChantBase):
    id: int
    slug: Optional[str] = None
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


class CategoriePersonnalisee(BaseModel):
    nom: str


class FeuilletCreate(FeuilletBase):
    pass


class Feuillet(FeuilletBase):
    id: int
