"""Tests unitaires pour la détection automatique de la langue, des moments liturgiques
et la segmentation fine des refrains et couplets lors de l'importation de carnets.
"""
from backend.app.ml.languages import detecter_langue
from backend.app.ml.classifier import suggest_categorie
from backend.app.ingestion.common import segment_paragraphs, _match_section_header


def test_detecter_langue():
    # 1. Latin
    assert detecter_langue("Crucem tuam", "Crucem tuam adoramus, Jesu Christe", ["1- Salve rex noster"]) == "la"
    assert detecter_langue("Agnus Dei", "", ["1&2- Agnus Dei qui tollis peccata mundi, miserere nobis", "3- dona nobis pacem"]) == "la"
    assert detecter_langue("Kyrie eleison", "Kyrie eleison, Christe eleison", ["1- Miserere nobis Domine"]) == "la"
    assert detecter_langue("Sanctus", "Sanctus, Sanctus, Sanctus Dominus Deus Sabaoth", ["Pleni sunt caeli et terra"]) == "la"

    # 2. Lingala
    assert detecter_langue("Yondé Mosantu", "Mosantu eyo, mosantu olikolo", ["Likolo yemba yuda awa nanse toko yemba"]) == "lingala"
    assert detecter_langue("Kembo na Nzambe", "Kembo na Nzambe o likolo", ["Mokonzi Nzambe"]) == "lingala"

    # 3. Mooré
    assert detecter_langue("Sẽn ki-b ne Zezi nonglem", "Sẽn ki-b ne a Zezi nonglem ye b na lagem Wẽnd Biig", ["Sid sida wa la a Zezi"]) == "moore"
    assert detecter_langue("Wẽnnaam Pebila", "Wẽnnaam pebila fãag tõnd", ["Zoe tõnd nimbane"]) == "moore"

    # 4. Dioula
    assert detecter_langue("Alléluia (Dioula)", "Alléluia, allée, alléluia", ["1- Siyaw be k'a lon ko e kelen de ye Ala ye"]) == "dioula"
    assert detecter_langue("Matigi wili", "Matigi wili, wili k'i jo", ["Duyen man kene"]) == "dioula"

    # 5. Anglais
    assert detecter_langue("I love my God", "I love my God, praise the Lord", ["1- Come with me to sing for Jesus"]) == "en"

    # 6. Français
    assert detecter_langue("Venez chantons notre Dieu", "Venez chantons notre Dieu, crions de joie", ["1- Il est notre Seigneur et notre Sauveur"]) == "fr"


def test_detecter_moments_liturgiques_suggest():
    # Gloria
    cats = suggest_categorie("Gloire à Dieu", "Gloire à Dieu au plus haut des cieux", ["Et paix sur la terre aux hommes qu'il aime"])
    assert cats[0][0] == "Gloria"

    # Kyrie
    cats = suggest_categorie("Seigneur prends pitié", "Kyrie eleison, Christe eleison", ["Prends pitié de nous Seigneur"])
    assert cats[0][0] == "Kyrie"

    # Communion
    cats = suggest_categorie("Pain vivant", "Tu es le pain de vie, corps du Christ livré pour nous", ["Venez à la table du banquet"])
    assert cats[0][0] == "Communion"

    # Sanctus
    cats = suggest_categorie("Saint le Seigneur", "Saint, Saint, Saint le Seigneur Dieu de l'univers", ["Hosanna au plus haut des cieux"])
    assert cats[0][0] == "Sanctus"

    # Agnus
    cats = suggest_categorie("Agneau de Dieu", "Agneau de Dieu qui enlèves le péché du monde", ["Prends pitié de nous, donne-nous la paix"])
    assert cats[0][0] == "Agnus"

    # Marial
    cats = suggest_categorie("Je vous salue Marie", "Ave Maria gratia plena Dominus tecum", ["Sainte Marie, Mère de Dieu"])
    assert cats[0][0] == "Marial"

    # Sortie
    cats = suggest_categorie("Dans la paix du Christ", "Allez dans la paix du Christ porter sa bonne nouvelle", ["Témoins vivants de son amour"])
    assert cats[0][0] == "Sortie"


def test_segmentation_carnet_avec_sections_et_refrains():
    carnet = [
        "I. CHANTS D'ENTRÉE",
        "Venez chantons notre Dieu",
        "Ref : Venez chantons notre Dieu, crions de joie pour notre Sauveur",
        "1- Il est notre Dieu et nous sommes le peuple de son pâturage",
        "2- Entrez dans sa maison avec des louanges",
        "Jubilez cri de joie",
        "Ref : Jubilez, criez de joie",
        "1- Acclamez le Seigneur",
        "II. KYRIE",
        "Seigneur prends pitié",
        "Kyrie eleison, Christe eleison",
        "1- Seigneur Jésus envoyé par le Père",
        "III. GLOIRE À DIEU",
        "Gloire à Dieu au plus haut des cieux",
        "Ref : Gloire à Dieu au plus haut des cieux, paix sur la terre",
        "1- Nous te louons, nous te bénissons",
        "IV. CHANTS DE COMMUNION",
        "Pain de vie",
        "Ref : Tu es le pain vivant venu du ciel",
        "1- Quiconque mange de ce pain vivra pour toujours",
        "Venez à la table",
        "Antienne : Recevez le corps du Seigneur",
        "Couplet 1 : Il nous donne sa vie",
        "Couplet 2 : Il nous donne sa paix",
    ]

    chants = segment_paragraphs(carnet)
    assert len(chants) == 6

    # 1. Venez chantons notre Dieu
    assert chants[0].titre == "Venez chantons notre Dieu"
    assert chants[0].categorie_detectee == "Entree"
    assert chants[0].refrain == "Venez chantons notre Dieu, crions de joie pour notre Sauveur"
    assert len(chants[0].couplets) == 2

    # 2. Jubilez cri de joie (reste bien dans Entrée grâce au maintien de la section !)
    assert chants[1].titre == "Jubilez cri de joie"
    assert chants[1].categorie_detectee == "Entree"
    assert chants[1].refrain == "Jubilez, criez de joie"
    assert len(chants[1].couplets) == 1

    # 3. Seigneur prends pitié
    assert chants[2].titre == "Seigneur prends pitié"
    assert chants[2].categorie_detectee == "Kyrie"
    assert chants[2].refrain == "Kyrie eleison, Christe eleison"
    assert len(chants[2].couplets) == 1

    # 4. Gloire à Dieu
    assert chants[3].titre == "Gloire à Dieu au plus haut des cieux"
    assert chants[3].categorie_detectee == "Gloria"
    assert chants[3].refrain == "Gloire à Dieu au plus haut des cieux, paix sur la terre"
    assert len(chants[3].couplets) == 1

    # 5. Pain de vie
    assert chants[4].titre == "Pain de vie"
    assert chants[4].categorie_detectee == "Communion"
    assert chants[4].refrain == "Tu es le pain vivant venu du ciel"
    assert len(chants[4].couplets) == 1

    # 6. Venez à la table
    assert chants[5].titre == "Venez à la table"
    assert chants[5].categorie_detectee == "Communion"
    assert chants[5].refrain == "Recevez le corps du Seigneur"
    assert len(chants[5].couplets) == 2


def test_category_protection_against_overrides():
    # 1. Anamnèse avec alléluia ne doit pas devenir une Acclamation
    anam_titre = "Mystère de la foi"
    anam_ref = "Il est grand le mystère de la foi"
    anam_couplets = ["Nous proclamons ta mort Seigneur Jésus, nous célébrons ta résurrection, alléluia"]
    cats = suggest_categorie(anam_titre, anam_ref, anam_couplets, top_n=2)
    assert cats[0][0] == "Anamnese", f"Devrait être Anamnese mais obtenu {cats[0][0]}"

    # 2. Entrée avec victoire ne doit pas devenir Pâques
    entree_titre = "Peuple en marche"
    entree_ref = "Peuple de Dieu en marche, chantons au Seigneur notre Dieu"
    entree_couplets = ["À toi la victoire et la gloire dans les siècles des siècles"]
    cats_e = suggest_categorie(entree_titre, entree_ref, entree_couplets, top_n=2)
    assert cats_e[0][0] == "Entree", f"Devrait être Entree mais obtenu {cats_e[0][0]}"


def test_chant_chorale_pdf_no_explosion():
    from pathlib import Path
    from backend.app.ingestion.generic import parse_and_segment

    pdf_path = Path(r"C:\Users\Richard\Documents\DépliantChorale\CHORALE\CHANT CHORALE-1.pdf")
    if not pdf_path.exists():
        return

    resultats = parse_and_segment(pdf_path)
    # Vérifier que le PDF ne produit pas 2193 mini-fragments
    assert 400 <= len(resultats) <= 750, f"Nombre anormal de chants: {len(resultats)}"

    # Vérifier qu'il n'y a pas d'explosion d'échecs (< 0.40)
    echecs = [c for cat, c in resultats if c.confiance < 0.4]
    assert len(echecs) == 0, f"Il ne devrait y avoir aucun échec (< 40%), trouvé {len(echecs)}"

    # Vérifier la présence des sections liturgiques majeures
    categories_presentes = {cat for cat, c in resultats}
    for moment in ["Entree", "Kyrie", "Gloria", "Sanctus", "Anamnese", "Communion", "Sortie"]:
        assert moment in categories_presentes, f"Moment liturgique {moment} manquant dans les chants extraits"


if __name__ == "__main__":
    test_detecter_langue()
    test_detecter_moments_liturgiques_suggest()
    test_segmentation_carnet_avec_sections_et_refrains()
    test_category_protection_against_overrides()
    test_chant_chorale_pdf_no_explosion()
    print("Tous les tests d'analyse et d'importation ont réussi avec succès !")
