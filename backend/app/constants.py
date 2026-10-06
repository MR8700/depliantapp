# Ordre canonique des moments liturgiques d'une messe, tel qu'observé dans les
# feuillets existants (C:\dev\Projet_IA\depliants\*.pub). Modifiable/réordonnable
# par feuillet côté API : ceci n'est que l'ordre par défaut proposé.
MOMENTS_LITURGIQUES = [
    "Entree",
    "Kyrie",
    "Gloria",
    "Psaume",
    "Acclamation",
    "Credo",
    "Priere_universelle",
    "Offertoire",
    "Sanctus",
    "Anamnese",
    "Notre_Pere",
    "Agnus",
    "Communion",
    "Action_de_grace",
    "Sortie",
]

# Catégories utilisées pour classer les chants importés depuis CHANTS/.
CATEGORIES_CHANTS = MOMENTS_LITURGIQUES + [
    "Avent",
    "Careme",
    "Noel",
    "Paques",
    "Marial",
    "Mariage",
    "Bapteme_Confirmation",
    "Defunts",
    "Enfants",
    "Autre",
]
