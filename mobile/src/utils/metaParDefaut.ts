import { Meta } from "../types";

// Miroir statique de backend/app/constants.py -- sert de repli pour un
// compte chorale 100% local qui n'a jamais eu l'occasion de télécharger
// /meta (aucun serveur à contacter). À maintenir manuellement en phase avec
// le fichier backend si l'ordre/la liste des moments ou catégories change.
const MOMENTS_LITURGIQUES = [
  "Entree", "Kyrie", "Gloria", "Psaume", "Acclamation", "Credo", "Priere_universelle",
  "Offertoire", "Sanctus", "Anamnese", "Notre_Pere", "Agnus", "Communion", "Action_de_grace", "Sortie",
];

const CATEGORIES_CHANTS = [
  ...MOMENTS_LITURGIQUES,
  "Avent", "Careme", "Noel", "Paques", "Marial", "Mariage", "Bapteme_Confirmation", "Defunts", "Enfants", "Autre",
];

export const META_PAR_DEFAUT: Meta = {
  moments: MOMENTS_LITURGIQUES,
  categories: CATEGORIES_CHANTS,
};
