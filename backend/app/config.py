import io
import json
from pathlib import Path
from typing import Optional

from reportlab.lib.utils import ImageReader

from . import db
from .db import insert_returning_id
from .paths import DATA_DIR

# Historique, conservés uniquement pour la migration ponctuelle depuis
# l'ancien modèle mono-tenant (voir migrer_donnees_legacy_vers_chorale) —
# plus utilisés en fonctionnement normal, où réglages et médias vivent en
# base (tables `parametres`/`medias`, chorale_id) sur les deux backends.
CONFIG_PATH = DATA_DIR / "config.json"
UPLOADS_DIR = DATA_DIR / "uploads"

# Emplacements d'image configurables dans l'en-tête/pied de page du feuillet,
# calqués sur la mise en page réelle des dépliants (deux logos circulaires en
# en-tête + une bannière décorative en bas de page).
IMAGE_SLOTS = ["logo_gauche", "logo_droit", "banniere_bas"]
_SLOT_TYPE = {"logo_gauche": "logo", "logo_droit": "logo", "banniere_bas": "banniere"}

# priere_texte_defaut : texte par défaut du widget « Prière pour le Burkina
# Faso », utilisé quand un feuillet a priere_active=True sans texte
# personnalisé. Vide ici signifie : retomber sur le texte figé de
# widgets.py::DEFAULT_PRIERE_TEXTE. "chorale"/"paroisse" par défaut restent
# neutres : le nom réel de chaque chorale est fixé à sa création (voir
# routers/chorales.py) plutôt que codé en dur ici, qui n'a plus de sens
# unique dès lors que plusieurs chorales partagent l'application.
DEFAULTS = {
    "chorale": "",
    "paroisse": "",
    "contact": "",
    "annonce": "",
    "priere_texte_defaut": "",
    # Consentement de la chorale à la synchronisation hors-ligne de la
    # bibliothèque partagée de chants sur l'app mobile (voir storage/sync.ts
    # côté mobile) -- activé par défaut, réglable par chorale dans Réglages.
    "sync_bibliotheque_partagee": True,
    **{f"{slot}_media_id": None for slot in IMAGE_SLOTS},
    # GOT About Page parameters
    "got_nom_entreprise": "GO Technologie (GOT)",
    "got_logo": "/favicon.svg",
    "got_slogan": "Découvrez GO Technologie (GOT), notre vision, nos engagements et les principes qui guident le développement de cette application.",
    "got_presentation": "GO Technologie (GOT) est une entreprise spécialisée dans le développement de solutions informatiques innovantes, la conception de logiciels sur mesure et l'accompagnement des organisations dans leur transformation numérique.\n\nNous mettons la technologie au service des entreprises, des institutions, des associations et des communautés religieuses afin de simplifier leurs activités quotidiennes grâce à des applications fiables, intuitives et sécurisées.\n\nNotre ambition est de développer des solutions modernes qui répondent aux réalités africaines tout en respectant les standards internationaux de qualité.",
    "got_mission": "Concevoir des solutions numériques performantes qui améliorent la productivité, facilitent la gestion des informations et offrent une expérience utilisateur simple, sécurisée et durable.",
    "got_vision": "Devenir une référence africaine dans le développement de logiciels innovants, en proposant des produits fiables, accessibles et capables d'accompagner durablement la transformation numérique des organisations.",
    "got_valeurs": json.dumps([
        {"icon": "💡", "title": "Innovation", "desc": "Anticiper les besoins et concevoir des solutions avant-gardistes adaptées aux réalités de nos utilisateurs."},
        {"icon": "⭐", "title": "Excellence", "desc": "Garantir un standard supérieur de qualité, de performance et de rigueur technique dans toutes nos réalisations."},
        {"icon": "👁️", "title": "Transparence", "desc": "Bâtir des relations basées sur la clarté, l'intégrité et la communication ouverte avec nos partenaires."},
        {"icon": "🛡️", "title": "Sécurité", "desc": "Assurer la protection robuste et continue des systèmes et des données confiés par nos utilisateurs."},
        {"icon": "🍃", "title": "Simplicité", "desc": "Créer des interfaces épurées et intuitives qui rendent la technologie complexe accessible à tous."},
        {"icon": "🔒", "title": "Respect de la vie privée", "desc": "Placer la confidentialité au cœur du développement, en limitant la collecte au strict nécessaire."},
        {"icon": "❤️", "title": "Satisfaction client", "desc": "Placer l'humain et les retours utilisateurs au centre de notre processus d'amélioration continue."}
    ], ensure_ascii=False),
    "got_app_description": "Cette application accompagne les communautés chrétiennes dans la préparation des célébrations liturgiques.",
    "got_app_features": json.dumps([
        {"icon": "📄", "title": "Préparer des feuillets", "desc": "Mise en page rapide et structurée de vos livrets de messe."},
        {"icon": "📚", "title": "Bibliothèque de chants", "desc": "Accès instantané à un répertoire partagé et modifiable de chants liturgiques."},
        {"icon": "📅", "title": "Organisation des moments", "desc": "Planification précise des lectures, prières et chants moment par moment."},
        {"icon": "⚡", "title": "Génération automatique", "desc": "Création instantanée du livret final en format PDF optimisé."},
        {"icon": "👥", "title": "Collaboration des équipes", "desc": "Travail concerté entre animateurs, chorales et prêtres."}
    ], ensure_ascii=False),
    "got_why_timeline": json.dumps([
        {"title": "Difficultés passées", "desc": "Perte de temps en mise en page manuelle répétitive, erreurs de saisie dans les paroles et documents dispensés."},
        {"title": "Centralisation", "desc": "Création d'une bibliothèque partagée de chants pour harmoniser et conserver le répertoire commun."},
        {"title": "Automatisation", "desc": "Génération automatisée des feuillets PDF en un clic à partir des chants sélectionnés."},
        {"title": "Bénéfice & Gain de temps", "desc": "Réduction drastique du temps de préparation, permettant aux équipes de se concentrer pleinement sur la liturgie."}
    ], ensure_ascii=False),
    "got_engagements": json.dumps([
        {"icon": "🤝", "title": "Fiable", "desc": "Une plateforme stable, disponible et testée pour vos célébrations."},
        {"icon": "⚡", "title": "Rapide", "desc": "Des temps de réponse optimaux et des téléchargements instantanés."},
        {"icon": "🔒", "title": "Sécurisée", "desc": "Des protocoles de sécurité robustes pour protéger votre compte et vos données."},
        {"icon": "🔄", "title": "Mises à jour régulières", "desc": "Des améliorations continues basées sur les retours de la communauté."},
        {"icon": "🙌", "title": "Respect des utilisateurs", "desc": "Pas de publicité intrusive, pas de traçage abusif, respect total de votre attention."}
    ], ensure_ascii=False),
    "got_politique_confidentialite": "La protection de vos données constitue une priorité absolue pour GO Technologie (GOT). Nous collectons uniquement les informations nécessaires au fonctionnement normal et à la personnalisation de vos feuillets. Nous ne vendons jamais vos données personnelles à des tiers. Les informations de compte ne sont utilisées que pour fournir les services demandés et optimiser la qualité de l'application.",
    "got_securite": json.dumps([
        {"icon": "🔑", "title": "HTTPS / TLS", "desc": "Toutes les connexions et transferts de données sont chiffrés avec des certificats SSL/TLS sécurisés."},
        {"icon": "🛡️", "title": "Authentification sécurisée", "desc": "Mots de passe hachés avec des algorithmes sécurisés et gestion de session robuste."},
        {"icon": "👥", "title": "Gestion des rôles", "desc": "Permissions distinctes selon les rôles (chorale, modérateur, administrateur)."},
        {"icon": "💾", "title": "Sauvegardes régulières", "desc": "Base de données sauvegardée périodiquement pour éviter toute perte accidentelle."},
        {"icon": "📝", "title": "Journalisation", "desc": "Suivi des actions système critiques pour détecter les anomalies et tentatives d'intrusion."},
        {"icon": "🔄", "title": "Mises à jour de sécurité", "desc": "Application rapide des correctifs sur les serveurs et dépendances logicielles."}
    ], ensure_ascii=False),
    "got_utilisation_donnees": json.dumps([
        "Créer et authentifier le compte",
        "Gérer et personnaliser le profil",
        "Créer, enregistrer et éditer vos feuillets liturgiques",
        "Synchroniser vos modifications entre vos différents appareils",
        "Sécuriser l'accès et détecter les connexions suspectes",
        "Produire des statistiques d'utilisation anonymes pour améliorer l'application",
        "Assurer le support technique et répondre aux demandes d'assistance"
    ], ensure_ascii=False),
    "got_droits_utilisateurs": json.dumps([
        {"icon": "👁️", "title": "Consulter ses données", "desc": "Droit d'accéder à l'ensemble des informations de compte vous concernant."},
        {"icon": "✏️", "title": "Modifier ses données", "desc": "Droit de rectifier vos informations personnelles ou celles de votre chorale."},
        {"icon": "🗑️", "title": "Demander la suppression", "desc": "Droit de demander la fermeture de votre compte et la purge de vos données associées."},
        {"icon": "↩️", "title": "Retirer son consentement", "desc": "Droit de revenir sur vos autorisations d'utilisation à tout moment."},
        {"icon": "ℹ️", "title": "Demander des informations", "desc": "Droit d'obtenir des éclaircissements sur le traitement de vos informations personnelles."}
    ], ensure_ascii=False),
    "got_contact_email": "marerichard10@gmail.com",
    "got_contact_telephone": "",
    "got_contact_adresse": "Burkina Faso",
    "got_contact_siteweb": "",
    "got_contact_facebook": "",
    "got_contact_linkedin": "",
    "got_contact_github": "",
    "got_contact_whatsapp": "",
    "got_signature": "Chez GO Technologie (GOT), nous croyons que la technologie doit être simple, utile et accessible.\n\nChaque solution que nous développons est pensée pour répondre à des besoins concrets, avec une exigence constante de qualité, de sécurité et d'innovation.\n\nNotre objectif est de créer des outils qui font gagner du temps, renforcent la collaboration et accompagnent durablement la transformation numérique de nos utilisateurs."
}


# --- Réglages actifs, PAR CHORALE ------------------------------------------

def _lire_config_brute(chorale_id: int) -> dict:
    """Réglages actifs d'une chorale, tels qu'enregistrés (sans les DEFAULTS
    fusionnés par-dessus)."""
    with db.get_connection() as conn:
        row = conn.execute("SELECT donnees FROM parametres WHERE chorale_id = ?", (chorale_id,)).fetchone()
    return json.loads(row["donnees"]) if row else {}


def get_config(chorale_id: int) -> dict:
    return {**DEFAULTS, **_lire_config_brute(chorale_id)}


def save_config(chorale_id: int, data: dict) -> dict:
    """Fusionne `data` par-dessus la config existante de CETTE chorale
    uniquement (pas par-dessus les seuls DEFAULTS, pour qu'une sauvegarde
    partielle n'efface pas le reste des réglages déjà personnalisés ; pas
    sur la ligne d'une autre chorale, qui ne doit jamais être influencée)."""
    merged_brut = {**_lire_config_brute(chorale_id), **data}
    donnees_json = json.dumps(merged_brut, ensure_ascii=False)
    with db.get_connection() as conn:
        # UPSERT : syntaxe identique sur les deux backends (SQLite supporte
        # ON CONFLICT ... DO UPDATE depuis la 3.24, comme Postgres).
        conn.execute(
            "INSERT INTO parametres (chorale_id, donnees) VALUES (?, ?) "
            "ON CONFLICT (chorale_id) DO UPDATE SET donnees = excluded.donnees",
            (chorale_id, donnees_json),
        )
    return {**DEFAULTS, **merged_brut}


# --- Pool partagé de médias (logos, bannières) ------------------------------
# Toute chorale peut uploader, toutes peuvent réutiliser : contrairement aux
# réglages ci-dessus, la lecture n'est jamais filtrée par chorale — seul
# l'upload retient le chorale_id de l'uploadeur, pour attribution.

def _check_slot(slot: str) -> None:
    if slot not in IMAGE_SLOTS:
        raise ValueError(f"Emplacement d'image inconnu : {slot}")


def list_medias(type_: Optional[str] = None) -> list[dict]:
    """Métadonnées seules (jamais les octets — voir get_media_bytes), pour
    le picker de médias : id/type/nom/filename/content_type/size/chorale_id/created_at."""
    with db.get_connection() as conn:
        if type_:
            rows = conn.execute(
                "SELECT id, type, nom, filename, content_type, LENGTH(donnees) AS size, chorale_id, created_at "
                "FROM medias WHERE type = ? ORDER BY created_at DESC",
                (type_,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, type, nom, filename, content_type, LENGTH(donnees) AS size, chorale_id, created_at "
                "FROM medias ORDER BY created_at DESC"
            ).fetchall()
    return [dict(r) for r in rows]


def upload_media(chorale_id: int, type_: str, filename: str, content: bytes, content_type: Optional[str] = None, nom: Optional[str] = None) -> dict:
    with db.get_connection() as conn:
        media_id = insert_returning_id(
            conn,
            "INSERT INTO medias (type, nom, filename, content_type, donnees, chorale_id) VALUES (?, ?, ?, ?, ?, ?)",
            (type_, nom, filename, content_type, db.binary(content), chorale_id),
        )
    return {"id": media_id, "type": type_, "nom": nom, "filename": filename, "content_type": content_type, "chorale_id": chorale_id}


def get_media_bytes(media_id: int) -> Optional[tuple[bytes, str]]:
    """(contenu, content_type) d'une image du pool partagé."""
    with db.get_connection() as conn:
        row = conn.execute("SELECT donnees, content_type FROM medias WHERE id = ?", (media_id,)).fetchone()
    if not row:
        return None
    return bytes(row["donnees"]), row["content_type"] or "application/octet-stream"


def get_active_image_reader(chorale_id: int, slot: str) -> Optional[ImageReader]:
    """Image actuellement choisie par une chorale pour un emplacement donné
    (logo_gauche/logo_droit/banniere_bas), prête à être dessinée par
    ReportLab — c'est le point d'entrée à utiliser pour le rendu PDF. Résout
    `parametres.donnees[f"{slot}_media_id"]` puis charge l'image
    correspondante dans le pool partagé."""
    _check_slot(slot)
    media_id = get_config(chorale_id).get(f"{slot}_media_id")
    if not media_id:
        return None
    result = get_media_bytes(media_id)
    if not result:
        return None
    content, _content_type = result
    return ImageReader(io.BytesIO(content))


def set_active_media(chorale_id: int, slot: str, media_id: Optional[int]) -> dict:
    """Change quelle image du pool partagé une chorale utilise pour un
    emplacement — n'affecte que cette chorale, jamais le pool lui-même ni
    les autres chorales qui auraient choisi la même image."""
    _check_slot(slot)
    return save_config(chorale_id, {f"{slot}_media_id": media_id})


def upload_and_activate_image(chorale_id: int, slot: str, filename: str, content: bytes, content_type: Optional[str] = None) -> dict:
    """Raccourci pour le flux "réglages" existant : uploade une nouvelle
    image dans le pool partagé ET l'active immédiatement pour cette
    chorale, en une seule étape (équivalent de l'ancien save_image à un
    seul slot global)."""
    _check_slot(slot)
    media = upload_media(chorale_id, _SLOT_TYPE[slot], filename, content, content_type, nom=slot)
    return set_active_media(chorale_id, slot, media["id"])


# --- Migration depuis l'ancien modèle mono-tenant --------------------------

def _lire_legacy_config_sqlite() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def _lire_legacy_images_sqlite() -> dict:
    resultat = {}
    if not UPLOADS_DIR.exists():
        return resultat
    for slot in IMAGE_SLOTS:
        matches = list(UPLOADS_DIR.glob(f"{slot}.*"))
        if matches:
            chemin = matches[0]
            resultat[slot] = (chemin.read_bytes(), None, chemin.name)
    return resultat


def _lire_legacy_config_postgres(conn) -> dict:
    try:
        row = conn.execute("SELECT donnees FROM parametres_legacy_singleton WHERE id = 1").fetchone()
    except Exception:
        return {}
    return json.loads(row["donnees"]) if row else {}


def _lire_legacy_images_postgres(conn) -> dict:
    try:
        rows = conn.execute("SELECT slot, filename, content_type, donnees FROM medias_legacy_slot").fetchall()
    except Exception:
        return {}
    return {r["slot"]: (bytes(r["donnees"]), r["content_type"], r["filename"]) for r in rows}


def migrer_donnees_legacy_vers_chorale(conn, chorale_id: int) -> None:
    """Migration unique (appelée depuis db.py::_migrer_vers_multi_chorale) :
    reprend les réglages/images d'avant le modèle multi-chorale (ligne
    globale unique côté Postgres — voir db.py::_renommer_tables_legacy_postgres
    pour la conservation des anciennes tables sous un autre nom — ou
    config.json/UPLOADS_DIR côté SQLite) et les rattache à la première
    chorale créée par la migration."""
    if db.BACKEND == "postgres":
        legacy_config = _lire_legacy_config_postgres(conn)
        legacy_images = _lire_legacy_images_postgres(conn)
    else:
        legacy_config = _lire_legacy_config_sqlite()
        legacy_images = _lire_legacy_images_sqlite()

    donnees = {k: v for k, v in legacy_config.items() if k in {"chorale", "paroisse", "contact", "annonce", "priere_texte_defaut"}}
    for slot, (contenu, content_type, filename) in legacy_images.items():
        media_id = insert_returning_id(
            conn,
            "INSERT INTO medias (type, nom, filename, content_type, donnees, chorale_id) VALUES (?, ?, ?, ?, ?, ?)",
            (_SLOT_TYPE[slot], slot, filename, content_type, db.binary(contenu), chorale_id),
        )
        donnees[f"{slot}_media_id"] = media_id

    conn.execute(
        "INSERT INTO parametres (chorale_id, donnees) VALUES (?, ?) ON CONFLICT (chorale_id) DO NOTHING",
        (chorale_id, json.dumps(donnees, ensure_ascii=False)),
    )
