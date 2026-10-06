"""Rapproche les lectures liturgiques du jour (AELF, voir aelf.py) de la
bibliothèque de chants -- deux signaux combinés, comme demandé :

1. Référence biblique EXACTE (chants.references_bibliques, saisie manuelle
   par la chorale) : si un chant est explicitement tagué "Mt 17" et que la
   lecture du jour est "Mt 17, 1-9", correspondance certaine (score 1.0).
2. Contenu textuel : le texte de la lecture (mots significatifs) comparé aux
   paroles du chant (titre/refrain/couplets/mots_cles) -- correspondance
   thématique approximative, jamais garantie, mais utile en l'absence de
   toute référence saisie (score entre 0 et 1).

Ce module ne dépend d'AUCUNE donnée réseau lui-même : il prend en entrée les
lectures déjà résolues (cache ou réponse AELF) et une liste de chants, pour
pouvoir tourner aussi bien côté serveur que -- porté fidèlement en
TypeScript, voir mobile/src/aelf/matching.ts -- hors-ligne sur mobile."""
import re
import unicodedata
from dataclasses import dataclass
from typing import Optional

# --- Normalisation ---------------------------------------------------------

_DIACRITIQUES_RE = re.compile("[̀-ͯ]")
_BALISES_HTML_RE = re.compile(r"<[^>]+>")
_NON_LETTRE_RE = re.compile(r"[^a-z0-9\s]")
_ESPACES_RE = re.compile(r"\s+")

_MOTS_VIDES = {
    "le", "la", "les", "un", "une", "des", "de", "du", "au", "aux", "et", "ou", "a", "à",
    "en", "que", "qui", "qu", "ce", "cet", "cette", "ces", "il", "elle", "ils", "elles",
    "je", "tu", "nous", "vous", "on", "se", "sa", "son", "ses", "leur", "leurs", "pour",
    "par", "dans", "sur", "sous", "avec", "sans", "pas", "ne", "plus", "moins", "est",
    "sont", "sera", "seront", "été", "être", "avoir", "ai", "as", "avons", "avez", "ont",
    "mais", "donc", "car", "si", "tout", "tous", "toute", "toutes", "comme", "quand",
}


def normaliser(texte: str) -> str:
    texte = unicodedata.normalize("NFKD", texte)
    texte = _DIACRITIQUES_RE.sub("", texte)
    texte = texte.lower()
    texte = _NON_LETTRE_RE.sub(" ", texte)
    texte = _ESPACES_RE.sub(" ", texte).strip()
    return texte


def _texte_sans_html(html: Optional[str]) -> str:
    if not html:
        return ""
    return _BALISES_HTML_RE.sub(" ", html)


def mots_significatifs(texte: str) -> set[str]:
    return {m for m in normaliser(texte).split(" ") if len(m) >= 4 and m not in _MOTS_VIDES}


# --- Références bibliques ---------------------------------------------------

# Table volontairement large plutôt qu'exhaustive : les abréviations les plus
# courantes en français, chaque variante pointant vers une clé canonique.
# Un livre absent de cette table n'empêche jamais le rapprochement PAR
# CONTENU (seul le rapprochement par référence exacte le nécessite).
_LIVRES: dict[str, str] = {}


def _enregistrer(cle: str, *variantes: str) -> None:
    for v in variantes:
        _LIVRES[normaliser(v).replace(" ", "")] = cle


_enregistrer("genese", "Genèse", "Gn", "Gen")
_enregistrer("exode", "Exode", "Ex")
_enregistrer("levitique", "Lévitique", "Lv")
_enregistrer("nombres", "Nombres", "Nb")
_enregistrer("deuteronome", "Deutéronome", "Dt")
_enregistrer("josue", "Josué", "Jos")
_enregistrer("juges", "Juges", "Jg")
_enregistrer("ruth", "Ruth", "Rt")
_enregistrer("samuel1", "1 Samuel", "1S", "1 S")
_enregistrer("samuel2", "2 Samuel", "2S", "2 S")
_enregistrer("rois1", "1 Rois", "1R", "1 R")
_enregistrer("rois2", "2 Rois", "2R", "2 R")
_enregistrer("chroniques1", "1 Chroniques", "1Ch", "1 Ch")
_enregistrer("chroniques2", "2 Chroniques", "2Ch", "2 Ch")
_enregistrer("esdras", "Esdras", "Esd")
_enregistrer("nehemie", "Néhémie", "Ne")
_enregistrer("tobie", "Tobie", "Tb")
_enregistrer("judith", "Judith", "Jdt")
_enregistrer("esther", "Esther", "Est")
_enregistrer("maccabees1", "1 Maccabées", "1M", "1 M")
_enregistrer("maccabees2", "2 Maccabées", "2M", "2 M")
_enregistrer("job", "Job", "Jb")
_enregistrer("psaumes", "Psaume", "Psaumes", "Ps")
_enregistrer("proverbes", "Proverbes", "Pr")
_enregistrer("ecclesiaste", "Ecclésiaste", "Qo", "Eccl")
_enregistrer("cantique", "Cantique des cantiques", "Ct")
_enregistrer("sagesse", "Sagesse", "Sg")
_enregistrer("siracide", "Siracide", "Si", "Ecclésiastique")
_enregistrer("isaie", "Isaïe", "Is")
_enregistrer("jeremie", "Jérémie", "Jr")
_enregistrer("lamentations", "Lamentations", "Lm")
_enregistrer("baruch", "Baruch", "Ba")
_enregistrer("ezechiel", "Ézéchiel", "Ez")
_enregistrer("daniel", "Daniel", "Dn")
_enregistrer("osee", "Osée", "Os")
_enregistrer("joel", "Joël", "Jl")
_enregistrer("amos", "Amos", "Am")
_enregistrer("abdias", "Abdias", "Ab")
_enregistrer("jonas", "Jonas", "Jon")
_enregistrer("michee", "Michée", "Mi")
_enregistrer("nahum", "Nahum", "Na")
_enregistrer("habacuc", "Habacuc", "Ha")
_enregistrer("sophonie", "Sophonie", "So")
_enregistrer("aggee", "Aggée", "Ag")
_enregistrer("zacharie", "Zacharie", "Za")
_enregistrer("malachie", "Malachie", "Ml")
_enregistrer("matthieu", "Matthieu", "Mt")
_enregistrer("marc", "Marc", "Mc")
_enregistrer("luc", "Luc", "Lc")
_enregistrer("jean", "Jean", "Jn")
_enregistrer("actes", "Actes des Apôtres", "Actes", "Ac")
_enregistrer("romains", "Romains", "Rm")
_enregistrer("corinthiens1", "1 Corinthiens", "1Co", "1 Co")
_enregistrer("corinthiens2", "2 Corinthiens", "2Co", "2 Co")
_enregistrer("galates", "Galates", "Ga")
_enregistrer("ephesiens", "Éphésiens", "Ep")
_enregistrer("philippiens", "Philippiens", "Ph")
_enregistrer("colossiens", "Colossiens", "Col")
_enregistrer("thessaloniciens1", "1 Thessaloniciens", "1Th", "1 Th")
_enregistrer("thessaloniciens2", "2 Thessaloniciens", "2Th", "2 Th")
_enregistrer("timothee1", "1 Timothée", "1Tm", "1 Tm")
_enregistrer("timothee2", "2 Timothée", "2Tm", "2 Tm")
_enregistrer("tite", "Tite", "Tt")
_enregistrer("philemon", "Philémon", "Phm")
_enregistrer("hebreux", "Hébreux", "He")
_enregistrer("jacques", "Jacques", "Jc")
_enregistrer("pierre1", "1 Pierre", "1P", "1 P")
_enregistrer("pierre2", "2 Pierre", "2P", "2 P")
_enregistrer("jean1", "1 Jean", "1Jn", "1 Jn")
_enregistrer("jean2", "2 Jean", "2Jn", "2 Jn")
_enregistrer("jean3", "3 Jean", "3Jn", "3 Jn")
_enregistrer("jude", "Jude", "Jd")
_enregistrer("apocalypse", "Apocalypse", "Ap")


@dataclass(frozen=True)
class ReferenceParsee:
    livre: str  # clé canonique (voir _LIVRES), ou "" si non reconnu
    chapitre: Optional[int]


# "Mt 17, 1-9" / "1 P 1, 16-19" / "Ps 96, 1-2, 4-5, 6.9" / "Dn 7, 9-10.13-14"
_REFERENCE_RE = re.compile(r"^\s*((?:[123]\s?)?[A-Za-zÀ-ÿ.]+)\s*(\d+)?")


def parser_reference(ref: str) -> Optional[ReferenceParsee]:
    """Extrait (livre, PREMIER chapitre mentionné) -- volontairement
    approximatif (jamais la plage de versets exacte, format trop hétérogène
    d'une source à l'autre : "9-10.13-14", "1-2, 4-5, 6.9"...) : suffisant
    pour un rapprochement thématique par chapitre, pas pour une citation
    savante verset par verset."""
    if not ref:
        return None
    m = _REFERENCE_RE.match(ref)
    if not m:
        return None
    livre_brut = m.group(1).strip().rstrip(".")
    cle = _LIVRES.get(normaliser(livre_brut).replace(" ", ""))
    if cle is None:
        return None
    chapitre = int(m.group(2)) if m.group(2) else None
    return ReferenceParsee(livre=cle, chapitre=chapitre)


def references_se_recoupent(a: str, b: str) -> bool:
    """Même livre, et même chapitre dès que les deux le précisent (un chant
    tagué juste "Psaumes", sans chapitre, correspond à N'IMPORTE quel psaume
    du jour -- rester permissif plutôt que de rater une correspondance
    évidente faute d'un chapitre précis dans la saisie de la chorale)."""
    pa, pb = parser_reference(a), parser_reference(b)
    if not pa or not pb or pa.livre != pb.livre:
        return False
    if pa.chapitre is not None and pb.chapitre is not None:
        return pa.chapitre == pb.chapitre
    return True


# --- Rapprochement chant <-> lecture ----------------------------------------

@dataclass(frozen=True)
class LectureJour:
    type: str  # "lecture_1" | "lecture_2" | "psaume" | "evangile"
    ref: str
    contenu: str


@dataclass(frozen=True)
class ChantPourRapprochement:
    id: int
    titre: str
    refrain: Optional[str]
    couplets: list[str]
    mots_cles: list[str]
    references_bibliques: list[str]


def extraire_lectures(donnees_aelf: dict) -> list[LectureJour]:
    """Aplati la réponse AELF (informations + messes[].lectures[]) en une
    liste plate -- une messe par jour dans l'immense majorité des cas, mais
    on ne suppose jamais qu'il n'y en a qu'une (ex. plusieurs formulaires un
    même jour)."""
    lectures: list[LectureJour] = []
    for messe in donnees_aelf.get("messes", []):
        for l in messe.get("lectures", []):
            ref = l.get("ref") or ""
            if not ref:
                continue
            contenu = _texte_sans_html(l.get("contenu"))
            lectures.append(LectureJour(type=l.get("type", ""), ref=ref, contenu=contenu))
    return lectures


_SEUIL_TEXTE_MIN = 0.06
"""En dessous de ce ratio de mots partagés, la correspondance textuelle est
trop faible pour être un signal utile (bruit) -- ignorée plutôt qu'affichée
comme un faux rapprochement."""


def score_chant_pour_lectures(chant: ChantPourRapprochement, lectures: list[LectureJour]) -> float:
    """0.0 (aucun rapprochement) à 1.0 (référence biblique exacte). Le texte
    du chant est comparé à CHAQUE lecture, seul le meilleur score est
    conservé (un chant peut coller à l'évangile sans avoir de rapport avec
    la première lecture, ça reste une correspondance)."""
    meilleur = 0.0

    for ref_chant in chant.references_bibliques:
        for lecture in lectures:
            if references_se_recoupent(ref_chant, lecture.ref):
                return 1.0  # certitude maximale, inutile de continuer

    mots_chant = mots_significatifs(
        " ".join([chant.titre, chant.refrain or "", *chant.couplets, *chant.mots_cles])
    )
    if not mots_chant:
        return meilleur

    for lecture in lectures:
        mots_lecture = mots_significatifs(lecture.contenu)
        if not mots_lecture:
            continue
        intersection = mots_chant & mots_lecture
        if not intersection:
            continue
        # Dice : 2 * |A∩B| / (|A|+|B|) -- symétrique, ne favorise ni un texte
        # de lecture très long (l'évangile) ni un chant très court (refrain seul).
        ratio = (2 * len(intersection)) / (len(mots_chant) + len(mots_lecture))
        meilleur = max(meilleur, ratio)

    return meilleur if meilleur >= _SEUIL_TEXTE_MIN else 0.0
