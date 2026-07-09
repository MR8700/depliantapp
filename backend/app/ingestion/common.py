import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Optional

REF_RE = re.compile(r"^\s*(R[ée]f(?:rain)?\.?\s*\d*|R)\s*[:;]\s*(.*)$", re.IGNORECASE)
VERSE_RE = re.compile(r"^\s*(\d+(?:\s*&\s*\d+)?|[IVXivx]+)\s*[\.\-\)]\s*(.+)$")
INLINE_VERSE_SPLIT_RE = re.compile(r"(?=\b\d+(?:\s*&\s*\d+)?\s*[\.\-\)]\s)")
CODE_REFERENCE_RE = re.compile(r"^([A-Z]{1,2}\s?\d{1,3}\s?[a-z]?)\s+(.+)$")
CATEGORY_PREFIX_RE = re.compile(r"^([A-ZÉÈÀÂÎÔÛÇÏ][A-ZÉÈÀÂÎÔÛÇÏ \-]{2,25}?)\s*:\s*(.+)$")


@dataclass
class RawChant:
    titre: str
    refrain: Optional[str] = None
    couplets: list[str] = field(default_factory=list)
    code_reference: Optional[str] = None
    confiance: float = 1.0


def split_inline_verses(text: str) -> list[str]:
    """Sépare un paragraphe contenant plusieurs couplets numérotés collés
    (ex: PDF sans saut de ligne entre couplets)."""
    parts = INLINE_VERSE_SPLIT_RE.split(text)
    return [p.strip() for p in parts if p.strip()]


def _extract_code_reference(titre: str) -> tuple[Optional[str], str]:
    m = CODE_REFERENCE_RE.match(titre)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return None, titre


TITRE_LONGUEUR_SUSPECTE = 60


def finalize(chant: RawChant) -> RawChant:
    code, titre = _extract_code_reference(chant.titre)
    chant.titre = titre
    chant.code_reference = code
    if chant.refrain and chant.couplets:
        chant.confiance = 1.0
    elif len(chant.couplets) >= 2:
        chant.confiance = 0.7
    elif chant.refrain or chant.couplets:
        chant.confiance = 0.5
    else:
        chant.confiance = 0.3
    if len(chant.titre) > TITRE_LONGUEUR_SUSPECTE:
        # titre anormalement long : probablement plusieurs paragraphes fusionnés à tort
        chant.confiance = min(chant.confiance, 0.6)
    return chant


def _detect_consistent_prefix(paragraphs: list[str]) -> Optional[str]:
    """Détecte un préfixe de catégorie répété en tête de titre (ex: 'SORTIE: ...'),
    utilisé par certains fichiers pour marquer le début de chaque chant."""
    prefixes = []
    for p in paragraphs:
        if REF_RE.match(p) or VERSE_RE.match(p):
            continue
        m = CATEGORY_PREFIX_RE.match(p.strip())
        if m:
            prefixes.append(m.group(1).strip().upper())
    if len(prefixes) < 2:
        return None
    common, count = Counter(prefixes).most_common(1)[0]
    if count >= 2 and count >= len(prefixes) * 0.5:
        return common
    return None


def segment_paragraphs(paragraphs: list[str]) -> list[RawChant]:
    """Segmente une liste de paragraphes en chants individuels (titre, refrain, couplets).

    Deux styles de source observés dans CHANTS/ :
    - Style "préfixé" : chaque titre commence par 'CATEGORIE: Titre' (ex. SORTIE.docx) ;
      les couplets suivants ne sont pas numérotés.
    - Style "numéroté" : titre nu, puis 'Ref :'/'Réf :', puis couplets numérotés '1-', '2-'...
      (ex. DEFUNTS.docx, KYRIE.doc).
    """
    paragraphs = [p.strip() for p in paragraphs if p and p.strip()]
    prefix = _detect_consistent_prefix(paragraphs)
    chants: list[RawChant] = []
    current: Optional[RawChant] = None

    for para in paragraphs:
        ref_m = REF_RE.match(para)
        verse_m = VERSE_RE.match(para)
        prefix_m = CATEGORY_PREFIX_RE.match(para) if prefix else None
        is_boundary_title = bool(prefix_m and prefix_m.group(1).strip().upper() == prefix)

        if is_boundary_title:
            if current is not None:
                chants.append(finalize(current))
            current = RawChant(titre=prefix_m.group(2).strip())
            continue

        if ref_m:
            if current is None:
                current = RawChant(titre="(sans titre)")
            text = ref_m.group(2).strip()
            current.refrain = f"{current.refrain} / {text}" if current.refrain else text
            continue

        if verse_m:
            if current is None:
                current = RawChant(titre="(sans titre)")
            current.couplets.extend(split_inline_verses(para))
            continue

        # ligne "ordinaire" : couplet non numéroté (style préfixé) ou nouveau titre (style numéroté)
        if prefix:
            if current is None:
                current = RawChant(titre="(sans titre)")
            current.couplets.append(para)
        else:
            if current is not None and (
                current.refrain or current.couplets or len(current.titre) > TITRE_LONGUEUR_SUSPECTE
            ):
                chants.append(finalize(current))
                current = RawChant(titre=para)
            elif current is not None:
                current.titre = f"{current.titre} {para}".strip()
            else:
                current = RawChant(titre=para)

    if current is not None:
        chants.append(finalize(current))

    return chants
