import { apiFetch } from "./client";

export interface LectureAelf {
  type: string;
  ref: string;
  titre?: string;
  contenu?: string;
}

export interface MesseAelf {
  nom?: string;
  lectures: LectureAelf[];
}

export interface InformationsLiturgiques {
  fete?: string;
  degre?: string;
  couleur?: string;
  temps_liturgique?: string;
  semaine?: string;
  annee?: string;
  jour_liturgique_nom?: string;
  zone?: string;
}

export interface ReponseAelfJour {
  date: string;
  zone: string;
  informations: InformationsLiturgiques;
  messes: MesseAelf[];
}

export interface LecturesExtrait {
  premiereLecture: string;
  psaume: string;
  deuxiemeLecture: string;
  evangile: string;
  celebrationTitre: string;
}

/** Récupère les lectures liturgiques du jour depuis le serveur central / cache AELF */
export async function getLecturesAelf(jour?: string): Promise<ReponseAelfJour> {
  const param = jour ? `?jour=${encodeURIComponent(jour)}` : "";
  return apiFetch<ReponseAelfJour>(`/aelf/jour${param}`);
}

/** Extrait et normalise les références des lectures et le titre de la fête du jour */
export function extraireLecturesLiturgiques(donnees: ReponseAelfJour): LecturesExtrait {
  let premiereLecture = "";
  let psaume = "";
  let deuxiemeLecture = "";
  let evangile = "";

  const messes = donnees.messes || [];
  for (const messe of messes) {
    for (const l of messe.lectures || []) {
      const type = (l.type || "").toLowerCase();
      const ref = (l.ref || "").trim();
      if (!ref) continue;

      if (!premiereLecture && (type.includes("lecture_1") || type.includes("premiere") || type === "lecture")) {
        premiereLecture = ref;
      } else if (!psaume && (type.includes("psaume") || type.includes("cantique"))) {
        psaume = ref;
      } else if (!deuxiemeLecture && (type.includes("lecture_2") || type.includes("deuxieme"))) {
        deuxiemeLecture = ref;
      } else if (!evangile && type.includes("evangile")) {
        evangile = ref;
      }
    }
  }

  const celebrationTitre =
    donnees.informations?.fete ||
    donnees.informations?.jour_liturgique_nom ||
    donnees.informations?.temps_liturgique ||
    "";

  return {
    premiereLecture,
    psaume,
    deuxiemeLecture,
    evangile,
    celebrationTitre,
  };
}
