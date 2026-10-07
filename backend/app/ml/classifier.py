"""Classifieur de catégorie liturgique robuste (modèle hybride : règles liturgiques expertes
+ Naive Bayes multinomial enrichi de n-grammes + corpus de référence initial + pré-entraînement chants.db
+ apprentissage continu persistant après chaque relecture/erreur).

Ce modèle est résistant au problème de "démarrage à froid" (cold-start) lorsque la base
de données est vide ou contient peu de chants validés. Il combine :
1. Une base de connaissances liturgiques canoniques (seed corpus de prières et chants catholiques)
2. La base pré-entraînée de plus de 550 chants canoniques de référence (seed_data/chants.db)
3. Des règles expertes de détection de formules canoniques (Kyrie, Gloria, Sanctus, Noel, Avent, etc.)
4. L'apprentissage continu (online learning) persistant (apprendre_chant / apprendre_correction)
5. Le ré-entraînement périodique ou à la demande depuis la base active (POST /ml/train)
6. La tokenisation avancée avec n-grammes (unigrammes + bigrammes) et normalisation sans accent.
"""
import json
import math
import os
import re
import sqlite3
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Optional

from ..paths import DATA_DIR
from ..db import get_connection

SEED_DB_PATH = Path(__file__).resolve().parent.parent.parent / "seed_data" / "chants.db"
LEARNED_JSON_PATH = DATA_DIR / "classifier_learned.json"

CATEGORY_MAPPINGS = {
    "Priere Universelle": "Priere_universelle",
    "Priere universelle": "Priere_universelle",
    "Prieres universelles": "Priere_universelle",
    "Action de grace": "Action_de_grace",
    "Pater": "Notre_Pere",
    "Pater noster": "Notre_Pere",
    "Bapteme et Confirmation": "Bapteme_Confirmation",
    "Bapteme": "Bapteme_Confirmation",
    "Confirmation": "Bapteme_Confirmation",
    "Passion": "Careme",
    "Paix": "Action_de_grace",
    "Marie": "Marial",
    "Chants mariaux": "Marial",
    "Chants de paques": "Paques",
    "Entree temps ordinaire": "Entree",
}

STOPWORDS = {
    "le", "la", "les", "de", "des", "du", "un", "une", "et", "en", "que", "qui",
    "je", "tu", "il", "elle", "nous", "vous", "ils", "elles", "ce", "ces", "ton",
    "ta", "tes", "mon", "ma", "mes", "son", "sa", "ses", "au", "aux", "pour",
    "par", "sur", "dans", "est", "sont", "avec", "ne", "pas", "plus", "bis", "ter",
    "qui", "que", "a", "d", "l", "s", "se", "qu", "ont", "nos", "vos", "leurs",
}

SEED_DOCUMENTS = [
    # Entrée
    ("Peuple de Dieu en marche, chantons au Seigneur notre Dieu", "Entree"),
    ("Chantez au Seigneur un chant nouveau, bénissez son saint nom", "Entree"),
    ("Nous marchons vers toi, Seigneur, dans la joie et la paix", "Entree"),
    ("Jubilez, criez de joie, le Seigneur est au milieu de nous", "Entree"),
    ("Que vive mon âme à te louer, ô Seigneur mon Dieu rassemble-nous", "Entree"),
    ("Rassemblement, venez à la maison du Père, entrons dans sa présence", "Entree"),
    ("Dieu nous accueille en sa maison, Dieu nous invite à son festin", "Entree"),
    ("Approchons-nous de la table sainte pour célébrer le Seigneur", "Entree"),
    ("Acclamez le Seigneur terre entière, servez le Seigneur dans l'allégresse", "Entree"),
    
    # Kyrie / Pénitence
    ("Kyrie eleison, Christe eleison, Kyrie eleison", "Kyrie"),
    ("Seigneur prends pitié de nous, Ô Christ prends pitié de nous", "Kyrie"),
    ("Prends pitié de nous Seigneur car nous avons péché contre toi", "Kyrie"),
    ("Pardonne-nous Seigneur nos fautes et nos offenses, lave nos péchés", "Kyrie"),
    ("Seigneur Jésus envoyé par le Père pour guérir les cœurs blessés", "Kyrie"),
    ("Mendiez la paix du cœur, réconciliation et miséricorde, prends pitié", "Kyrie"),
    
    # Gloria
    ("Gloire à Dieu au plus haut des cieux et paix sur la terre aux hommes qu'il aime", "Gloria"),
    ("Gloria in excelsis Deo, et in terra pax hominibus bonae voluntatis", "Gloria"),
    ("Nous te louons, nous te bénissons, nous t'adorons, nous te glorifions", "Gloria"),
    ("Seigneur Dieu, Roi du ciel, Dieu le Père tout-puissant, gloire à Dieu", "Gloria"),
    ("Agneau de Dieu, le Fils du Père, toi qui enlèves le péché du monde, reçois notre prière", "Gloria"),
    
    # Psaume
    ("Psaume responsorial, le Seigneur est mon berger rien ne saurait me manquer", "Psaume"),
    ("Garde-moi mon Dieu, j'ai fait de toi mon refuge, psaume de David", "Psaume"),
    ("Le Seigneur est tendresse et pitié, lent à la colère et plein d'amour", "Psaume"),
    ("Chantez au Seigneur un cantique nouveau, car il a fait des merveilles", "Psaume"),
    
    # Acclamation
    ("Alléluia alléluia alléluia, parole de Dieu vivante et efficace", "Acclamation"),
    ("Alleluia, ta parole est la lumière sur ma route, acclamation de l'évangile", "Acclamation"),
    ("Gloire et louange à toi, Seigneur Jésus, parole éternelle du Père", "Acclamation"),
    ("Cherchez d'abord le royaume de Dieu et sa justice, alleluia", "Acclamation"),
    ("Acclamez la parole du salut, acclamation évangélique réjouis-toi", "Acclamation"),
    
    # Credo
    ("Je crois en un seul Dieu, le Père tout-puissant, créateur du ciel et de la terre", "Credo"),
    ("Credo in unum Deum, Patrem omnipotentem, factorem caeli et terrae", "Credo"),
    ("Profession de foi, je crois en Jésus Christ son Fils unique notre Seigneur", "Credo"),
    ("Je crois en l'Esprit Saint qui donne la vie, je crois en l'Église une sainte catholique", "Credo"),
    
    # Prière universelle
    ("Seigneur écoute-nous, Seigneur exauce-nous, prière universelle", "Priere_universelle"),
    ("O Seigneur, entends la prière qui monte de nos cœurs vers toi", "Priere_universelle"),
    ("Notre prière monte vers toi Seigneur, exauce tes enfants qui t'implorent", "Priere_universelle"),
    ("Pour le monde, pour l'Église, pour les malades et les affligés, nous te prions Seigneur", "Priere_universelle"),
    
    # Offertoire
    ("Voici nos dons, voici notre offrande, reçois Seigneur le pain et le vin", "Offertoire"),
    ("Fruit de la terre et du travail des hommes, nous te présentons ce pain", "Offertoire"),
    ("Reçois Seigneur les dons de ton peuple rassemblé, offrande sainte", "Offertoire"),
    ("Qu'exulte la terre, apportons nos présents à l'autel du Seigneur", "Offertoire"),
    ("Tu es béni, Dieu de l'univers, toi qui nous donnes ce pain et ce vin", "Offertoire"),
    ("Seigneur, nous t'offrons nos vies, notre travail, nos joies et nos peines", "Offertoire"),
    
    # Sanctus
    ("Saint, Saint, Saint, le Seigneur Dieu de l'univers", "Sanctus"),
    ("Sanctus, Sanctus, Sanctus Dominus Deus Sabaoth", "Sanctus"),
    ("Le ciel et la terre sont remplis de ta gloire, hosanna au plus haut des cieux", "Sanctus"),
    ("Béni soit celui qui vient au nom du Seigneur, hosanna au plus haut des cieux", "Sanctus"),
    
    # Anamnèse
    ("Il est grand le mystère de la foi, anamnèse eucharistique", "Anamnese"),
    ("Nous proclamons ta mort, Seigneur Jésus, nous célébrons ta résurrection", "Anamnese"),
    ("Christ est venu, Christ est mort, Christ est ressuscité, Christ reviendra", "Anamnese"),
    ("Gloire à toi qui étais mort, gloire à toi qui es vivant, notre Sauveur et notre Dieu", "Anamnese"),
    
    # Notre Père
    ("Notre Père qui es aux cieux, que ton nom soit sanctifié", "Notre_Pere"),
    ("Pater noster, qui es in caelis, sanctificetur nomen tuum", "Notre_Pere"),
    ("Que ton règne vienne, que ta volonté soit faite sur la terre comme au ciel", "Notre_Pere"),
    ("Donne-nous aujourd'hui notre pain de ce jour, pardonne-nous nos offenses", "Notre_Pere"),
    
    # Agnus
    ("Agneau de Dieu qui enlèves le péché du monde, prends pitié de nous", "Agnus"),
    ("Agnus Dei, qui tollis peccata mundi, miserere nobis, dona nobis pacem", "Agnus"),
    ("Donne-nous la paix Seigneur, Agneau immolé pour le salut des hommes", "Agnus"),
    
    # Communion
    ("Venez à la table du banquet, recevez le corps et le sang du Christ", "Communion"),
    ("Pain vivant descendu du ciel, celui qui mange de ce pain vivra éternellement", "Communion"),
    ("Prenez et mangez, ceci est mon corps livré pour vous", "Communion"),
    ("Prenez et buvez, ceci est la coupe de mon sang versé pour la multitude", "Communion"),
    ("Ô pain de vie, corps très saint de Jésus, nourriture céleste", "Communion"),
    ("Recevez le corps du Seigneur, source vivante de notre foi", "Communion"),
    ("Demeurez en mon amour, comme le Père m'a aimé, mangez ma chair", "Communion"),
    
    # Action de grâce
    ("Action de grâce, béni soit Dieu qui nous a comblés de ses biens", "Action_de_grace"),
    ("Rendons grâce au Seigneur notre Dieu, car il est bon et sa miséricorde est éternelle", "Action_de_grace"),
    ("Magnificat mon âme exalte le Seigneur, mon esprit exulte en Dieu mon Sauveur", "Action_de_grace"),
    ("Merci Seigneur pour tous tes bienfaits, louange à toi pour ton grand amour", "Action_de_grace"),
    
    # Sortie
    ("Allez dans la paix du Christ, annoncer l'Évangile à toute la création", "Sortie"),
    ("Envoyés dans le monde pour témoigner de ton amour et de ta paix", "Sortie"),
    ("Marchons ensemble dans la joie, témoins vivants de la résurrection", "Sortie"),
    ("Portez la bonne nouvelle aux pauvres, chant d'envoi et de mission", "Sortie"),
    ("Allez par toute la terre porter la lumière du Christ", "Sortie"),
    
    # Marie / Chants mariaux
    ("Je vous salue Marie pleine de grâce, le Seigneur est avec vous", "Marial"),
    ("Ave Maria gratia plena, Dominus tecum, benedicta tu in mulieribus", "Marial"),
    ("Sainte Vierge Marie, Mère de Dieu, priez pour nous pauvres pécheurs", "Marial"),
    ("Reine du ciel réjouis-toi, sous ton voile de tendresse nous cherchons refuge", "Marial"),
    ("Couronnée d'étoiles, Vierge immaculée, Mère de l'espérance", "Marial"),

    # Temps de Noël
    ("Il est né le divin enfant, jouez hautbois résonnez musettes", "Noel"),
    ("Les anges dans nos campagnes ont entonné l'hymne des cieux, Gloria in excelsis Deo", "Noel"),
    ("Douce nuit, sainte nuit, dans les cieux tout dort, Bethléem", "Noel"),
    ("Peuple fidèle, le Seigneur est né, accourez joyeux et triomphants", "Noel"),
    ("Noël, fête de lumière, Emmanuel Dieu avec nous", "Noel"),

    # Avent
    ("Viens Seigneur ne tarde plus, viens sauver ton peuple", "Avent"),
    ("Préparez le chemin du Seigneur, ouvrez les sentiers dans le désert", "Avent"),
    ("Veilleurs où en est la nuit, le Seigneur vient, tenez-vous prêts", "Avent"),
    ("Maranatha, viens Seigneur Jésus, l'espérance brille dans nos nuits", "Avent"),

    # Carême et Passion
    ("Seigneur avec toi nous irons au désert, quarante jours de prière et de jeûne", "Careme"),
    ("Changez vos cœurs, croyez à la Bonne Nouvelle, revenez à moi", "Careme"),
    ("Victoire, tu règneras, ô Croix, tu nous sauveras, calvaire et sacrifice", "Careme"),
    ("Voici le bois de la croix qui a porté le salut du monde", "Careme"),

    # Pâques
    ("Le Christ est ressuscité des morts, par sa mort il a vaincu la mort, alléluia", "Paques"),
    ("À toi la gloire, ô Ressuscité, à toi la victoire pour l'éternité", "Paques"),
    ("Jour de fête et jour de joie, le Seigneur est vraiment ressuscité", "Paques"),
    ("Sur les chemins d'Emmaüs, nous avons reconnu le Christ vivant", "Paques"),

    # Mariage
    ("Bénis Seigneur les époux, que leur amour soit fidèle et fécond", "Mariage"),
    ("Dans un même foyer unis par le Seigneur, alliance d'amour", "Mariage"),
    ("Que votre amour grandisse chaque jour dans la paix du Christ", "Mariage"),

    # Baptême et Confirmation
    ("Tu es devenu enfant de Dieu par l'eau et par l'Esprit Saint", "Bapteme_Confirmation"),
    ("Plongés dans l'eau du baptême, nous renaissons à la vie nouvelle", "Bapteme_Confirmation"),
    ("Esprit Saint descends sur nous, répands tes dons, huile sainte de force", "Bapteme_Confirmation"),

    # Défunts
    ("Donne-lui Seigneur le repos éternel, et que brille sur lui la lumière sans déclin", "Defunts"),
    ("Vers toi terre promise, nous marchons, accueille ton serviteur dans ta paix", "Defunts"),
    ("Je sais que mon Rédempteur est vivant, au dernier jour je me relèverai", "Defunts"),
]

LITURGICAL_RULES = [
    # Ordinaire de la messe
    (re.compile(r"\b(kyrie\s+eleison|prends\s+pitie|christe\s+eleison|miserere\s+nobis|mokonzi\s+yoka\s+mawa|tuyambula\s+mambi)\b"), "Kyrie", 15.0),
    (re.compile(r"\b(gloria\s+in\s+excelsis|gloire\s+a\s+dieu|kembo\s+na\s+nzambe|in\s+terra\s+pax)\b"), "Gloria", 15.0),
    (re.compile(r"\b(sanctus|saint\s+le\s+seigneur|dieu\s+de\s+l\s*univers|hosanna\s+au\s+plus\s+haut|dominus\s+deus\s+sabaoth|mosantu\s+mosantu|benedictus\s+qui\s+venit)\b"), "Sanctus", 15.0),
    (re.compile(r"\b(anamnese|mystere\s+de\s+la\s+foi|proclamons\s+ta\s+mort|christ\s+est\s+venu|mysterium\s+fidei|mortem\s+tuam)\b"), "Anamnese", 15.0),
    (re.compile(r"\b(notre\s+pere|pater\s+noster|qui\s+es\s+aux\s+cieux|panem\s+nostrum|tata\s+wa\s+biso)\b"), "Notre_Pere", 15.0),
    (re.compile(r"\b(agneau\s+de\s+dieu|agnus\s+dei|qui\s+enleves\s+le\s+peche|tollis\s+peccata|mwana\s+mpate|dona\s+nobis\s+pacem)\b"), "Agnus", 15.0),
    (re.compile(r"\b(alleluia|all[eé]luia|acclamation|aleluya)\b"), "Acclamation", 12.0),
    (re.compile(r"\b(credo|je\s+crois\s+en\s+un\s+seul\s+dieu|profession\s+de\s+foi|credo\s+in\s+unum)\b"), "Credo", 15.0),
    (re.compile(r"\b(priere\s+universelle|entends\s+nos\s+prieres|exauce[\s\-]nous|ecoute\s+nos\s+prieres)\b"), "Priere_universelle", 12.0),
    (re.compile(r"\b(offrande|voici\s+nos\s+dons|recois\s+seigneur|pain\s+et\s+le?\s*vin|fruit\s+de\s+la\s+terre|mampa\s+na\s+vinu|nous\s+te\s+presentons)\b"), "Offertoire", 10.0),
    (re.compile(r"\b(pain\s+vivant|pain\s+de\s+vie|corps\s+du\s+christ|mangez\s+et\s+buvez|table\s+du\s+banquet|communion|panis\s+angelicus|corpus\s+christi)\b"), "Communion", 10.0),
    (re.compile(r"\b(action\s+de\s+grace|rendons\s+grace|merci\s+seigneur|gratias\s+agimus)\b"), "Action_de_grace", 10.0),
    (re.compile(r"\b(allez\s+dans\s+la\s+paix|envoyes\s+dans\s+le\s+monde|chant\s+d\s*envoi|bonne\s+nouvelle|ite\s+missa\s+est)\b"), "Sortie", 10.0),
    (re.compile(r"\b(ave\s+maria|je\s+vous\s+salue\s+marie|vierge\s+marie|sainte\s+mere|reine\s+du\s+ciel|salve\s+regina|couronnee\s+d\s*etoiles)\b"), "Marial", 12.0),
    (re.compile(r"\b(psaume|le\s+seigneur\s+est\s+mon\s+berger|graduel)\b"), "Psaume", 10.0),
    (re.compile(r"\b(peuple\s+de\s+dieu|chantez\s+au\s+seigneur|nous\s+marchons|entrons\s+dans\s+sa\s+maison|rassemblement)\b"), "Entree", 8.0),

    # Temps et célébrations liturgiques
    (re.compile(r"\b(noel|nativite|emmanuel|divin\s+enfant|les\s+anges\s+dans\s+nos\s+campagnes|bethleem|creche|nuit\s+de\s+lumiere|il\s+est\s+ne)\b"), "Noel", 15.0),
    (re.compile(r"\b(avent|viens\s+seigneur|preparez\s+le\s+chemin|veilleur|le\s+seigneur\s+est\s+proche|maranatha)\b"), "Avent", 14.0),
    (re.compile(r"\b(careme|quarante\s+jours|poussiere|jeune|chemin\s+de\s+croix|golgotha|calvaire|passion\s+du\s+christ|croix\s+glorieuse)\b"), "Careme", 14.0),
    (re.compile(r"\b(paques|resurrection|christ\s+est\s+ressuscite|le\s+christ\s+est\s+vivant|tombeau\s+vide|victoire\s+sur\s+la\s+mort|jour\s+de\s+paques)\b"), "Paques", 15.0),
    (re.compile(r"\b(mariage|fiancailles|epoux|alliance|foyer|benediction\s+nuptiale|deux\s+qui\s+ne\s+font\s+qu\s*un)\b"), "Mariage", 14.0),
    (re.compile(r"\b(bapteme|confirmation|plonge\s+dans\s+l\s*eau|eau\s+vive|baptise|huile\s+sainte|onction|esprit\s+de\s+force)\b"), "Bapteme_Confirmation", 14.0),
    (re.compile(r"\b(defunts|obseques|requiem|repos\s+eternel|vers\s+la\s+maison\s+du\s+pere|a\s+dieu|dors\s+en\s+paix)\b"), "Defunts", 14.0),
]


def normaliser_texte(texte: str) -> str:
    """Supprime les accents, ponctuation superflue et met en minuscules."""
    texte = unicodedata.normalize("NFKD", texte or "").encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9\s]", " ", texte)


def tokenize(text: str) -> list[str]:
    """Extrait unigrammes significatifs et bigrammes pertinents."""
    clean = normaliser_texte(text)
    words = [w for w in re.findall(r"[a-z]{3,}", clean) if w not in STOPWORDS]
    bigrams = [f"{words[i]}_{words[i+1]}" for i in range(len(words) - 1)]
    return words + bigrams


def _chant_text(titre: str, refrain: Optional[str], couplets: list[str]) -> str:
    return " ".join([titre or "", refrain or "", " ".join(couplets or [])])


class NaiveBayesClassifier:
    def __init__(self):
        self.class_word_counts: dict[str, Counter] = defaultdict(Counter)
        self.class_totals: dict[str, int] = defaultdict(int)
        self.class_doc_counts: dict[str, int] = defaultdict(int)
        self.vocab: set[str] = set()
        self.n_docs = 0

    def train(self, documents: list[tuple[str, str]]) -> None:
        for text, label in documents:
            tokens = tokenize(text)
            self.class_word_counts[label].update(tokens)
            self.class_totals[label] += len(tokens)
            self.class_doc_counts[label] += 1
            self.vocab.update(tokens)
        self.n_docs = len(documents)

    def learn_one(self, text: str, label: str, weight: int = 1) -> None:
        """Apprentissage en ligne continu (online learning) d'un nouvel exemple ou d'une correction."""
        if not text or not label or weight <= 0:
            return
        tokens = tokenize(text)
        if not tokens:
            return
        weighted = {t: c * weight for t, c in Counter(tokens).items()}
        self.class_word_counts[label].update(weighted)
        self.class_totals[label] += len(tokens) * weight
        self.class_doc_counts[label] += weight
        self.vocab.update(tokens)
        self.n_docs += weight

    def predict(self, text: str) -> dict[str, float]:
        if self.n_docs == 0 or not self.class_doc_counts:
            return {}
        tokens = tokenize(text)
        v = max(len(self.vocab), 1)
        log_scores: dict[str, float] = {}
        for label, doc_count in self.class_doc_counts.items():
            log_prob = math.log(doc_count / self.n_docs)
            total = self.class_totals[label]
            counts = self.class_word_counts[label]
            for token in tokens:
                log_prob += math.log((counts.get(token, 0) + 1) / (total + v))
            log_scores[label] = log_prob

        # Softmax pour normaliser entre 0 et 1
        max_log = max(log_scores.values())
        exp_scores = {label: math.exp(score - max_log) for label, score in log_scores.items()}
        total_exp = sum(exp_scores.values()) or 1.0
        return {label: exp_score / total_exp for label, exp_score in exp_scores.items()}


_model = NaiveBayesClassifier()
_trained = False


def _sauvegarder_apprentissage(item: dict) -> None:
    """Enregistre de manière persistante sur disque chaque chant appris/corrigé."""
    try:
        LEARNED_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
        items = []
        if LEARNED_JSON_PATH.exists():
            try:
                with open(LEARNED_JSON_PATH, "r", encoding="utf-8") as f:
                    items = json.load(f)
            except Exception:
                items = []
        items.append(item)
        if len(items) > 5000:
            items = items[-5000:]
        with open(LEARNED_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _init_seed_model() -> None:
    """Initialise le modèle avec les données canoniques + chants pré-entraînés + deltas persistés."""
    global _model, _trained
    _model = NaiveBayesClassifier()
    _model.train(SEED_DOCUMENTS)

    # 1. Pré-entraînement à partir des 557 chants de référence de la base canonique
    if SEED_DB_PATH.exists():
        try:
            conn = sqlite3.connect(str(SEED_DB_PATH))
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT titre, refrain, couplets, categorie FROM chants WHERE categorie IS NOT NULL AND categorie != 'Autre'"
            ).fetchall()
            for row in rows:
                c_raw = row["couplets"]
                couplets = []
                if c_raw:
                    try:
                        couplets = json.loads(c_raw)
                    except Exception:
                        pass
                cat = CATEGORY_MAPPINGS.get(row["categorie"], row["categorie"])
                text = _chant_text(row["titre"], row["refrain"], couplets)
                _model.learn_one(text, cat, weight=1)
            conn.close()
        except Exception:
            pass

    # 2. Restauration des apprentissages dynamiques persistés
    if LEARNED_JSON_PATH.exists():
        try:
            with open(LEARNED_JSON_PATH, "r", encoding="utf-8") as f:
                learned = json.load(f)
            for item in learned:
                text = item.get("text") or _chant_text(item.get("titre", ""), item.get("refrain"), item.get("couplets", []))
                cat = CATEGORY_MAPPINGS.get(item.get("categorie", ""), item.get("categorie", ""))
                poids = item.get("poids", 2)
                if text and cat and cat != "Autre":
                    _model.learn_one(text, cat, weight=poids)
        except Exception:
            pass

    _trained = True


# Initialise le modèle immédiatement
_init_seed_model()


def apprendre_chant(
    titre: str,
    refrain: Optional[str],
    couplets: list[str],
    categorie: str,
    poids: int = 2,
) -> None:
    """Apprend immédiatement un chant nouvellement validé, importé ou créé."""
    if not categorie or categorie == "Autre":
        return
    cat_norm = CATEGORY_MAPPINGS.get(categorie, categorie)
    text = _chant_text(titre, refrain, couplets)
    _model.learn_one(text, cat_norm, weight=poids)
    _sauvegarder_apprentissage({
        "titre": titre,
        "refrain": refrain,
        "couplets": couplets,
        "text": text,
        "categorie": cat_norm,
        "poids": poids,
    })


def apprendre_correction(
    titre: str,
    refrain: Optional[str],
    couplets: list[str],
    ancienne_cat: Optional[str],
    nouvelle_cat: str,
) -> None:
    """Apprend avec un poids renforcé (poids=4) lorsqu'un utilisateur corrige une mauvaise classification."""
    if not nouvelle_cat or nouvelle_cat == "Autre" or nouvelle_cat == ancienne_cat:
        return
    cat_norm = CATEGORY_MAPPINGS.get(nouvelle_cat, nouvelle_cat)
    apprendre_chant(titre, refrain, couplets, cat_norm, poids=4)


def train_from_db() -> dict:
    """Ré-entraîne le modèle à partir du corpus complet (seed + DB active + apprentissages)."""
    global _model, _trained
    _init_seed_model()

    db_count = 0
    try:
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT titre, refrain, couplets, categorie FROM chants WHERE confiance >= 0.7 AND categorie != 'Autre'"
            ).fetchall()

        for row in rows:
            c_raw = row["couplets"]
            couplets = []
            if c_raw:
                try:
                    couplets = json.loads(c_raw)
                except Exception:
                    pass
            cat = CATEGORY_MAPPINGS.get(row["categorie"], row["categorie"])
            text = _chant_text(row["titre"], row["refrain"], couplets)
            _model.learn_one(text, cat, weight=2)
            db_count += 1
    except Exception:
        pass

    return {
        "exemples_db": db_count,
        "exemples_totaux": _model.n_docs,
        "categories": sorted(_model.class_doc_counts.keys()),
    }


def suggest_categorie(titre: str, refrain: Optional[str], couplets: list[str], top_n: int = 3) -> list[tuple[str, float]]:
    """Prédit les catégories liturgiques les plus probables avec scores hybrides (Règles + Bayes)."""
    text = _chant_text(titre, refrain, couplets)
    clean_text = normaliser_texte(text)

    # 1. Scores des règles expertes
    rule_scores: dict[str, float] = defaultdict(float)
    rule_hit = False
    clean_titre_ref = normaliser_texte(f"{titre or ''} {refrain or ''}")

    for pattern, categorie, weight in LITURGICAL_RULES:
        if categorie == "Acclamation":
            # Pour l'acclamation : alléluia/acclamation doit figurer dans le titre, le refrain ou le chant doit être bref
            if pattern.search(clean_titre_ref) or (pattern.search(clean_text) and len(couplets) <= 2):
                rule_scores[categorie] += weight
                rule_hit = True
        else:
            if pattern.search(clean_text):
                rule_scores[categorie] += weight
                rule_hit = True

    # 2. Scores Naive Bayes (enrichi de seed_data/chants.db et apprentissages continus)
    bayes_scores = _model.predict(text)

    # 3. Fusion hybride
    toutes_categories = set(bayes_scores.keys()) | set(rule_scores.keys())
    scores_finaux: dict[str, float] = {}

    for cat in toutes_categories:
        b_score = bayes_scores.get(cat, 0.0)
        r_score = rule_scores.get(cat, 0.0)
        if rule_hit:
            score_combine = (b_score * 0.3) + (min(r_score / 15.0, 1.0) * 0.7)
        else:
            score_combine = b_score
        scores_finaux[cat] = score_combine

    # Normalisation finale
    total = sum(scores_finaux.values()) or 1.0
    ranked = sorted(
        ((CATEGORY_MAPPINGS.get(cat, cat), round(score / total, 3)) for cat, score in scores_finaux.items()),
        key=lambda kv: kv[1],
        reverse=True,
    )
    return ranked[:top_n]
