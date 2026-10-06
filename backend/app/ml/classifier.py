"""Classifieur de catégorie liturgique, entraîné sur les chants déjà catalogués.

Volontairement pas de dépendance ML externe (scikit-learn, etc.) : avec quelques
milliers de chants seulement, un Naive Bayes multinomial "from scratch" (comptage
de mots + lissage de Laplace) est largement suffisant, reste explicable, et colle
à l'objectif "application légère". Le modèle est ré-entraîné à la demande
(POST /ml/train) à partir des chants dont la confiance a été validée (>= 0.7,
catégorie != "Autre") — donc il s'améliore au fur et à mesure que l'utilisateur
corrige/valide des chants dans l'éditeur : c'est la boucle d'apprentissage.
"""
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from typing import Optional

from ..db import get_connection

STOPWORDS = {
    "le", "la", "les", "de", "des", "du", "un", "une", "et", "en", "que", "qui",
    "je", "tu", "il", "elle", "nous", "vous", "ils", "elles", "ce", "ces", "ton",
    "ta", "tes", "mon", "ma", "mes", "son", "sa", "ses", "au", "aux", "pour",
    "par", "sur", "dans", "est", "sont", "avec", "ne", "pas", "plus", "bis", "ter",
}


def tokenize(text: str) -> list[str]:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode("ascii").lower()
    words = re.findall(r"[a-z]{3,}", text)
    return [w for w in words if w not in STOPWORDS]


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

    def predict(self, text: str, top_n: int = 3) -> list[tuple[str, float]]:
        if self.n_docs == 0 or not self.class_doc_counts:
            return []
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

        # softmax pour un score 0-1 lisible côté interface
        max_log = max(log_scores.values())
        exp_scores = {label: math.exp(score - max_log) for label, score in log_scores.items()}
        total_exp = sum(exp_scores.values())
        ranked = sorted(
            ((label, exp_score / total_exp) for label, exp_score in exp_scores.items()),
            key=lambda kv: kv[1],
            reverse=True,
        )
        return ranked[:top_n]


_model = NaiveBayesClassifier()
_trained = False


def train_from_db() -> dict:
    """Ré-entraîne le modèle à partir des chants validés (confiance >= 0.7, hors 'Autre')."""
    global _model, _trained
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT titre, refrain, couplets, categorie FROM chants WHERE confiance >= 0.7 AND categorie != 'Autre'"
        ).fetchall()

    documents = [
        (_chant_text(row["titre"], row["refrain"], json.loads(row["couplets"])), row["categorie"])
        for row in rows
    ]
    _model = NaiveBayesClassifier()
    _model.train(documents)
    _trained = True
    return {
        "exemples": len(documents),
        "categories": sorted(_model.class_doc_counts.keys()),
    }


def suggest_categorie(titre: str, refrain: Optional[str], couplets: list[str]) -> list[tuple[str, float]]:
    if not _trained:
        train_from_db()
    text = _chant_text(titre, refrain, couplets)
    return _model.predict(text)
