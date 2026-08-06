"""Client pour l'API AELF (https://api.aelf.org/) -- lectures liturgiques
quotidiennes (messe du jour). Aucune dépendance HTTP supplémentaire
(urllib.request de la bibliothèque standard suffit pour de simples GET JSON,
même choix que licences.py pour rester sans dépendance).

Le cache (table `lectures_liturgiques`, voir db.py) est PARTAGÉ entre toutes
les chorales -- une lecture donnée pour une date et une zone est strictement
la même pour tout le monde, la stocker une seule fois évite de re-solliciter
AELF à chaque consultation ET permet un export en masse pour l'usage
hors-ligne mobile (voir routers/aelf.py::synchroniser/annee)."""
import json
import urllib.error
import urllib.request
from datetime import date, timedelta
from typing import Optional

from .db import get_connection

BASE_URL = "https://api.aelf.org/v1/messes"
ZONE_DEFAUT = "romain"
# Le "romain" (calendrier romain général) est valide dans tous les pays --
# choisi comme valeur par défaut plutôt qu'une zone géographique précise
# (l'app est utilisée par des chorales de diocèses différents, chacune peut
# préciser sa propre zone AELF dans les réglages si elle a des fêtes locales).

_TIMEOUT_SECONDES = 12


class ErreurAelf(Exception):
    pass


def _appeler_aelf(jour: str, zone: str) -> dict:
    url = f"{BASE_URL}/{jour}/{zone}"
    try:
        with urllib.request.urlopen(url, timeout=_TIMEOUT_SECONDES) as reponse:
            return json.loads(reponse.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise ErreurAelf(f"AELF a répondu {exc.code} pour {jour}/{zone}") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise ErreurAelf(f"Impossible de contacter AELF ({exc})") from exc


def get_depuis_cache(jour: str, zone: str) -> Optional[dict]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT informations, messes FROM lectures_liturgiques WHERE date = ? AND zone = ?",
            (jour, zone),
        ).fetchone()
    if not row:
        return None
    return {
        "informations": json.loads(row["informations"]),
        "messes": json.loads(row["messes"]),
    }


def _mettre_en_cache(jour: str, zone: str, donnees: dict) -> None:
    with get_connection() as conn:
        # INSERT OR REPLACE (SQLite) / ON CONFLICT (Postgres) diffèrent trop
        # pour un seul appel générique ici -- delete puis insert reste
        # correct et simple pour une écriture peu fréquente (une par jour et
        # par zone, jamais un chemin chaud).
        conn.execute("DELETE FROM lectures_liturgiques WHERE date = ? AND zone = ?", (jour, zone))
        conn.execute(
            "INSERT INTO lectures_liturgiques (date, zone, informations, messes) VALUES (?, ?, ?, ?)",
            (
                jour, zone,
                json.dumps(donnees.get("informations", {}), ensure_ascii=False),
                json.dumps(donnees.get("messes", []), ensure_ascii=False),
            ),
        )


def get_lectures_jour(jour: str, zone: str = ZONE_DEFAUT) -> dict:
    """Cache-first : ne sollicite AELF que si cette (date, zone) n'a jamais
    été demandée par personne auparavant."""
    en_cache = get_depuis_cache(jour, zone)
    if en_cache is not None:
        return en_cache
    donnees = _appeler_aelf(jour, zone)
    _mettre_en_cache(jour, zone, donnees)
    return donnees


def jours_manquants(depuis: str, nb_jours: int, zone: str) -> list[str]:
    """Parmi les `nb_jours` jours à partir de `depuis` (inclus), ceux qui ne
    sont pas encore en cache pour `zone` -- sert à ne resynchroniser que ce
    qui manque (voir routers/aelf.py::synchroniser, appelé en boucle par le
    mobile jusqu'à ce que la liste soit vide)."""
    debut = date.fromisoformat(depuis)
    toutes = [(debut + timedelta(days=i)).isoformat() for i in range(nb_jours)]
    with get_connection() as conn:
        placeholders = ",".join(["?"] * len(toutes))
        rows = conn.execute(
            f"SELECT date FROM lectures_liturgiques WHERE zone = ? AND date IN ({placeholders})",
            (zone, *toutes),
        ).fetchall()
    presents = {r["date"] for r in rows}
    return [j for j in toutes if j not in presents]


def synchroniser_jours(jours: list[str], zone: str) -> tuple[int, list[str]]:
    """Récupère et met en cache chaque jour de la liste -- renvoie (nombre
    réussis, dates en échec, ex. jour trop ancien/futur qu'AELF ne connaît
    pas). Les échecs n'interrompent jamais le lot : un jour introuvable ne
    doit pas bloquer la synchronisation des autres."""
    reussis = 0
    echecs: list[str] = []
    for jour in jours:
        try:
            donnees = _appeler_aelf(jour, zone)
            _mettre_en_cache(jour, zone, donnees)
            reussis += 1
        except ErreurAelf:
            echecs.append(jour)
    return reussis, echecs


def lister_cache(depuis: str, nb_jours: int, zone: str) -> list[dict]:
    """Tous les jours déjà en cache dans la fenêtre -- pour l'export en masse
    vers le mobile (voir routers/aelf.py::annee)."""
    debut = date.fromisoformat(depuis)
    fin = (debut + timedelta(days=nb_jours - 1)).isoformat()
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT date, informations, messes FROM lectures_liturgiques "
            "WHERE zone = ? AND date >= ? AND date <= ? ORDER BY date ASC",
            (zone, depuis, fin),
        ).fetchall()
    return [
        {
            "date": r["date"],
            "informations": json.loads(r["informations"]),
            "messes": json.loads(r["messes"]),
        }
        for r in rows
    ]
