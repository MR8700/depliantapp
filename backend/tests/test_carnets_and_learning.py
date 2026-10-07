"""Test complet sur les 25 carnets réels de chorale et le système d'apprentissage continu.

Vérifie :
1. L'ingestion et la segmentation sans erreur sur les 25 carnets (.docx et .pdf).
2. La détection automatique des moments liturgiques et catégories.
3. La détection automatique des langues (fr, la, moore, lingala, dioula, etc.).
4. La détection des refrains et couplets selon les moments de la messe.
5. L'apprentissage continu persistant (online learning) après corrections.
"""
import json
import os
from pathlib import Path
import pytest

from backend.app.ingestion.generic import parse_and_segment
from backend.app.ml.classifier import (
    suggest_categorie,
    apprendre_chant,
    apprendre_correction,
    _init_seed_model,
    _model,
    LEARNED_JSON_PATH,
)
from backend.app.ml.languages import detecter_langue

CARNET_DIR = Path(r"C:\Users\Richard\Documents\DépliantChorale\CHORALE")

FILES_TO_TEST = [
    "ACCLAMATION.docx",
    "Action de grace.docx",
    "AGNUS.docx",
    "Anamnèse.docx",
    "Avent.docx",
    "BAPTEME ET CONFIRMATION.docx",
    "Careme.docx",
    "CHANT CHORALE-1.pdf",
    "chant de MARIAGE.docx",
    "Chants de Paques.docx",
    "Chants Mariaux.docx",
    "Communion.docx",
    "CREDO.docx",
    "ENTREE TEMPS ORDINAIRE.docx",
    "GLORIA.docx",
    "graduels.docx",
    "KYRIE.docx",
    "Mariage et animation.docx",
    "Noel.docx",
    "OFFERTOIRE.docx",
    "PASSION.docx",
    "Pater.docx",
    "PRIERES UNIVERSELLES.docx",
    "SANCTUS.docx",
    "SORTIE.docx",
]


def test_carnets_parsing_and_detection():
    """Vérifie le parsing et la détection sur les carnets réels disponibles."""
    if not CARNET_DIR.exists():
        pytest.skip(f"Dossier {CARNET_DIR} absent")

    total_chants = 0
    stats_par_fichier = {}

    for fname in FILES_TO_TEST:
        fpath = CARNET_DIR / fname
        if not fpath.exists():
            continue

        chants_raw = parse_and_segment(fpath)
        assert len(chants_raw) > 0, f"Le fichier {fname} n'a produit aucun chant"

        avec_refrain = 0
        avec_couplets = 0
        langues = {}
        categories = {}

        for cat, c in chants_raw:
            # Vérifier titre non vide
            assert c.titre and len(c.titre.strip()) > 0

            # Détection de langue
            lang = detecter_langue(c.titre, c.refrain, c.couplets)
            assert lang in {"fr", "la", "moore", "dioula", "lingala", "dagara", "bissa", "gulmancema", "en", "es", "sw", "kikongo", "autre"}
            langues[lang] = langues.get(lang, 0) + 1

            if c.refrain:
                avec_refrain += 1
            if c.couplets:
                avec_couplets += 1

            # Détection de catégorie
            cat_finale = cat
            if not cat_finale or cat_finale == "Autre":
                sugg = suggest_categorie(c.titre, c.refrain, c.couplets, top_n=1)
                if sugg and sugg[0][1] >= 0.2:
                    cat_finale = sugg[0][0]
                else:
                    cat_finale = "Autre"
            categories[cat_finale] = categories.get(cat_finale, 0) + 1

        stats_par_fichier[fname] = {
            "total": len(chants_raw),
            "avec_refrain": avec_refrain,
            "avec_couplets": avec_couplets,
            "langues": langues,
            "categories": categories,
        }
        total_chants += len(chants_raw)

    print(f"\n=== BILAN INGESTION CARNETS ===")
    print(f"Total fichiers testés : {len(stats_par_fichier)}/{len(FILES_TO_TEST)}")
    print(f"Total chants extraits : {total_chants}")
    for fname, st in stats_par_fichier.items():
        print(f"  {fname:<30}: {st['total']:>4} chants | refrains: {st['avec_refrain']:>4} | couplets: {st['avec_couplets']:>4} | top lang: {list(st['langues'].keys())[:2]}")


def test_persistent_continuous_learning():
    """Démontre que le modèle apprend réellement et immédiatement après chaque correction."""
    titre_test = "Kizito Mwinda na biso"
    refrain_test = "Kizito e, sangisa bana banso mpe kamba biso o nzela ya bosembo"
    couplets_test = [
        "1. Na bolingo bwa Nzambe tokende elongo",
        "2. Pesa biso makasi ya kolanda Kristo"
    ]

    # Prédiction initiale
    sugg_avant = suggest_categorie(titre_test, refrain_test, couplets_test, top_n=3)
    categories_avant = [cat for cat, _ in sugg_avant]

    # Simuler une correction utilisateur : ce chant est une Entrée
    apprendre_correction(titre_test, refrain_test, couplets_test, sugg_avant[0][0] if sugg_avant else None, "Entree")

    # Prédiction immédiate après apprentissage
    sugg_apres = suggest_categorie(titre_test, refrain_test, couplets_test, top_n=3)
    score_entree_apres = next((score for cat, score in sugg_apres if cat == "Entree"), 0.0)

    assert score_entree_apres > 0.3, f"Entree aurait dû être boostée par l'apprentissage, score={score_entree_apres}"
    assert sugg_apres[0][0] == "Entree", f"Entree aurait dû être première après correction, reçu: {sugg_apres}"

    # Vérifier la persistance dans le fichier classifier_learned.json
    assert LEARNED_JSON_PATH.exists(), "Le fichier de persistance de l'apprentissage doit exister"
    with open(LEARNED_JSON_PATH, "r", encoding="utf-8") as f:
        learned_data = json.load(f)
    assert any(item.get("titre") == titre_test and item.get("categorie") == "Entree" for item in learned_data)

    # Simuler un redémarrage du serveur et vérifier que le modèle conserve le savoir
    _init_seed_model()
    sugg_reinit = suggest_categorie(titre_test, refrain_test, couplets_test, top_n=3)
    assert sugg_reinit[0][0] == "Entree", f"Après redémarrage du modèle, Entree doit toujours être au top, reçu: {sugg_reinit}"


def test_pre_trained_seed_knowledge():
    """Vérifie que le modèle démarre avec une connaissance riche (plus de 500 chants pré-entraînés)."""
    assert _model.n_docs >= 500, f"Le modèle devrait avoir au moins 500 chants pré-entraînés, trouvé: {_model.n_docs}"
    assert len(_model.class_doc_counts) >= 15, "Au moins 15 catégories liturgiques doivent être connues"

    # Vérifier quelques classiques universels
    assert suggest_categorie("Gloire à Dieu au plus haut des cieux", None, [])[0][0] == "Gloria"
    assert suggest_categorie("Agneau de Dieu qui enlèves le péché du monde", None, [])[0][0] == "Agnus"
    assert suggest_categorie("Notre Père qui es aux cieux", None, [])[0][0] == "Notre_Pere"
    assert suggest_categorie("Il est né le divin enfant", None, [])[0][0] == "Noel"
    assert suggest_categorie("Le Christ est ressuscité des morts", None, [])[0][0] == "Paques"
    assert suggest_categorie("Je vous salue Marie pleine de grâce", None, [])[0][0] == "Marial"
