LABELS_MOMENTS = {
    "Entree": "ENTRÉE",
    "Kyrie": "KYRIE",
    "Gloria": "GLORIA",
    "Psaume": "PSAUME",
    "Acclamation": "ACCLAMATION",
    "Credo": "CREDO",
    "Priere_universelle": "PRIÈRE UNIVERSELLE",
    "Offertoire": "OFFERTOIRE",
    "Sanctus": "SANCTUS",
    "Anamnese": "ANAMNÈSE",
    "Notre_Pere": "NOTRE PÈRE",
    "Agnus": "AGNUS",
    "Communion": "COMMUNION",
    "Action_de_grace": "ACTION DE GRÂCE",
    "Sortie": "SORTIE",
}


def label_for(moment: str) -> str:
    return LABELS_MOMENTS.get(moment, moment.replace("_", " ").upper())
