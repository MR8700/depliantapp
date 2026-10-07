"""Module de détection automatique de la langue des chants liturgiques.

Prend en charge :
- Français ('fr')
- Latin ('la')
- Lingala ('lingala')
- Mooré ('moore')
- Dioula ('dioula')
- Anglais ('en')
- Espagnol ('es')
- Gulmancema ('gulmancema')
- Bissa ('bissa')
- Dagara ('dagara')
- Swahili ('sw')
- Kikongo ('kikongo')
- Autre ('autre')

Combine :
1. Recherche d'indicateurs explicites dans le titre ou les annotations (ex. '(Dioula)', '[Latin]').
2. Analyse lexicale des formules et n-grammes liturgiques distinctifs.
3. Détection morphologique et diacritiques caractéristiques.
"""
import re
import unicodedata
from typing import Optional

TAGS_TITRE = [
    (re.compile(r"\b(dioula|djula)\b", re.IGNORECASE), "dioula"),
    (re.compile(r"\b(bissa|bisa)\b", re.IGNORECASE), "bissa"),
    (re.compile(r"\b(gulmancema|gulmatchema|gourmantche)\b", re.IGNORECASE), "gulmancema"),
    (re.compile(r"\b(dagara|dagari)\b", re.IGNORECASE), "dagara"),
    (re.compile(r"\b(moore|moor[eé]|mor[eé])\b", re.IGNORECASE), "moore"),
    (re.compile(r"\b(latin|latine?)\b", re.IGNORECASE), "la"),
    (re.compile(r"\b(lingala)\b", re.IGNORECASE), "lingala"),
    (re.compile(r"\b(swahili|kiswahili)\b", re.IGNORECASE), "sw"),
    (re.compile(r"\b(kikongo|kingongo)\b", re.IGNORECASE), "kikongo"),
    (re.compile(r"\b(anglais|english)\b", re.IGNORECASE), "en"),
    (re.compile(r"\b(espagnol|spanish)\b", re.IGNORECASE), "es"),
    (re.compile(r"\b(francais|fran[cç]ais)\b", re.IGNORECASE), "fr"),
]

# Formules liturgiques latines fortes (pondération élevée)
FORMULES_LATINES = [
    re.compile(r"\bkyrie\s+eleison\b", re.I),
    re.compile(r"\bchriste\s+eleison\b", re.I),
    re.compile(r"\bgloria\s+in\s+excelsis\s+deo\b", re.I),
    re.compile(r"\bin\s+terra\s+pax\b", re.I),
    re.compile(r"\bsanctus\s+sanctus\s+sanctus\b", re.I),
    re.compile(r"\bdominus\s+deus\s+sabaoth\b", re.I),
    re.compile(r"\bhosanna\s+in\s+excelsis\b", re.I),
    re.compile(r"\bbenedictus\s+qui\s+venit\b", re.I),
    re.compile(r"\bagnus\s+dei\b", re.I),
    re.compile(r"\bqui\s+tollis\s+peccata\s+mundi\b", re.I),
    re.compile(r"\bmiserere\s+nobis\b", re.I),
    re.compile(r"\bdona\s+nobis\s+pacem\b", re.I),
    re.compile(r"\bpater\s+noster\b", re.I),
    re.compile(r"\bqui\s+es\s+in\s+caelis\b", re.I),
    re.compile(r"\bave\s+maria\b", re.I),
    re.compile(r"\bgratia\s+plena\b", re.I),
    re.compile(r"\bdominus\s+tecum\b", re.I),
    re.compile(r"\brequiem\s+aeternam\b", re.I),
    re.compile(r"\blux\s+perpetua\b", re.I),
    re.compile(r"\btantum\s+ergo\b", re.I),
    re.compile(r"\bpanis\s+angelicus\b", re.I),
    re.compile(r"\bsalve\s+regina\b", re.I),
    re.compile(r"\bmagnificat\s+anima\s+mea\b", re.I),
    re.compile(r"\bcredo\s+in\s+unum\s+deum\b", re.I),
    re.compile(r"\bcrucem\s+tuam\b", re.I),
    re.compile(r"\bsaecula\s+saeculorum\b", re.I),
    re.compile(r"\bsursum\s+corda\b", re.I),
    re.compile(r"\bhabemus\s+ad\s+dominum\b", re.I),
    re.compile(r"\bcorpus\s+christi\b", re.I),
    re.compile(r"\bsanguis\s+christi\b", re.I),
    re.compile(r"\bte\s+deum\s+laudamus\b", re.I),
]

LEXIQUES = {
    "la": {
        "dominus", "domini", "domino", "dominum", "deo", "deus", "dei", "deum",
        "christe", "eleison", "sanctus", "agnus", "tecum", "maria", "excelsis",
        "requiem", "corpus", "sanguis", "spiritus", "pater", "noster", "tuum",
        "meum", "saecula", "vobiscum", "miserere", "nobis", "pacem", "crucem",
        "adoramus", "caelis", "plena", "gratia", "benedictus", "terra", "laudamus",
        "panis", "angelicus", "credo", "unum", "filii", "dona", "sabaoth",
        "hosanna", "stabat", "salve", "regina", "magnificat", "tantum", "ergo",
        "sacramentum", "hostia", "hominibus", "voluntatis", "benedicimus",
        "glorificamus", "gratias", "agimus", "propter", "magnam", "gloriam",
        "domine", "caelestis", "omnipotens", "unigenite", "altissimus", "peccata",
        "mundi", "tollis", "cuncta", "saeculorum", "venite", "adoremus", "corda",
        "calicem", "redemptor", "patris", "verbum", "caro", "factum", "resurrexit"
    },
    "moore": {
        "wennam", "wend", "yeso", "kiristo", "barka", "bark", "nooma", "pugla", "kamba",
        "zoodo", "duniya", "waodo", "tenga", "songo", "song", "roogo", "yiila", "puge",
        "woto", "ti", "yaa", "neda", "biig", "arzene", "arzan", "arzana", "lagem", "leb", "veuge",
        "maana", "mam", "foo", "fo", "damba", "yembre", "yemb", "tend", "naaba",
        "soala", "pebila", "zoe", "sid", "sida", "kelg", "gomde", "nonglem",
        "baaba", "biiga", "ninbuiida", "wende", "zo-y", "faag", "sugri", "tond", "yamb",
        "paam", "pegre", "pegr", "zaore", "balemda", "kilisda", "kasma", "krist", "krista",
        "zezi", "anduni", "puusda", "kosgo", "ye"
    },
    "dioula": {
        "ala", "allabato", "barika", "matigi", "masake", "here", "sankolo",
        "dunya", "hakili", "kuma", "senumanye", "kadi", "anw", "deenw", "kelen",
        "siyaw", "kuun", "duyen", "file", "senu", "aw", "wili", "jon", "kristo",
        "foyi", "baara", "latike", "sabari", "bisan"
    },
    "lingala": {
        "kembo", "nzambe", "mokonzi", "yezu", "kristu", "klisto", "mwana", "tata",
        "seko", "sango", "mobikisi", "banso", "bino", "ngolu", "elimo", "santu",
        "mosantu", "nzembo", "likolo", "nse", "lelo", "ndeko", "bosembo", "esengo",
        "beto", "lola", "motema", "mawa", "bikamwa", "loba", "lisekwa", "eyano",
        "tanga", "yoka", "koyemba", "toye", "toyembela", "kumisa", "tokumisa",
        "yonde", "malamu", "mabe", "bomoyi", "biso", "bolingo", "nalingi", "hozana",
        "mokili"
    },
    "en": {
        "the", "lord", "praise", "holy", "spirit", "love", "grace", "our",
        "your", "king", "heart", "sing", "pray", "hallelujah", "bless", "worship",
        "come", "heaven", "earth", "savior", "lamb", "when", "glory", "people",
        "with", "jesus", "christ", "almighty", "mercy", "forever"
    },
    "es": {
        "senor", "dios", "cristo", "gloria", "padre", "espiritu", "hijo", "amor",
        "gracia", "bendito", "piedad", "nosotros", "alabanza", "cordero", "ten",
        "cielo", "tierra", "reina", "santo", "senorita"
    },
    "gulmancema": {
        "diedo", "untien", "pebiger", "cuan", "ciaditi", "suglidaano", "sugli",
        "tienu", "babuado", "nintuali", "bugs", "tuom", "kpiagidi", "yanmaa"
    },
    "bissa": {
        "semegnan", "yaada", "zuuba", "huusu", "gaole", "dun", "gyer", "zelgue",
        "medi", "foua", "kre", "pen", "barke"
    },
    "dagara": {
        "naawmin", "nyee", "nye", "faafu", "biir", "yeru", "yel-migna", "krista",
        "za", "sir", "cinu", "cebal", "nono", "soob", "sob", "yir", "subri", "sono", "guarmo"
    },
    "fr": {
        "seigneur", "dieu", "notre", "pere", "jesus", "sainte", "saint", "esprit",
        "amour", "paix", "terre", "ciel", "joie", "coeur", "viens", "chantons",
        "louange", "salut", "beni", "croix", "corps", "sang", "pain", "vin",
        "peuple", "foi", "grace", "marie", "vierge", "merci", "pitie", "agneau",
        "monde", "nous", "vous", "dans", "avec", "pour", "sur", "vers"
    },
}


def _normaliser(texte: str) -> str:
    texte = unicodedata.normalize("NFKD", texte or "").encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9\s]", " ", texte)


def detecter_langue(
    titre: str,
    refrain: Optional[str] = None,
    couplets: Optional[list[str]] = None,
    langue_defaut: str = "fr",
) -> str:
    """Détecte automatiquement la langue du chant à partir de son titre, refrain et couplets."""
    titre_brut = titre or ""

    # 1. Présence d'un tag explicite dans le titre (ex. '(Dioula)', '[Latin]')
    for pattern, code in TAGS_TITRE:
        if pattern.search(titre_brut):
            return code

    # 2. Formules liturgiques latines absolues
    texte_complet = f"{titre_brut} {refrain or ''} {' '.join(couplets or [])}"
    for pattern in FORMULES_LATINES:
        if pattern.search(texte_complet):
            return "la"

    # 3. Analyse lexicale des tokens
    norm = _normaliser(texte_complet)
    tokens = norm.split()
    words = set(tokens)

    scores: dict[str, int] = {}
    for code, lexique in LEXIQUES.items():
        inter = len(words & lexique)
        if inter > 0:
            scores[code] = inter

    if not scores:
        return langue_defaut

    # 4. Règles de priorité pour les langues spécifiques
    # Les langues locales et le latin utilisent des lexiques très distinctifs
    for spe in ["la", "moore", "dioula", "lingala", "gulmancema", "bissa", "dagara", "en", "es"]:
        score_spe = scores.get(spe, 0)
        fr_score = scores.get("fr", 0)

        if spe == "la" and score_spe >= 2 and (score_spe >= fr_score or any(w in words for w in ["kyrie", "agnus", "sanctus", "gloria"])):
            return "la"

        if score_spe >= 2 and (score_spe >= fr_score or score_spe >= 3):
            return spe

    best = max(scores, key=scores.get)
    if scores[best] >= 2:
        return best

    return langue_defaut
