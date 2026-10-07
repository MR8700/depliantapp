"""Tests unitaires pour le workflow de versionnage des chants et de modération par l'admin.
"""
from backend.app import crud, db, schemas
from backend.app.db import get_connection


def test_chant_versioning_and_moderation():
    db.init_db(force=True)
    # 1. Créer une chorale de test si non existante
    with get_connection() as conn:
        chorale_row = conn.execute("SELECT id FROM chorales WHERE username = 'test-chorale'").fetchone()
        if not chorale_row:
            cur = conn.execute("INSERT INTO chorales (nom, username, password_hash) VALUES ('Chorale Test', 'test-chorale', 'hash')")
            chorale_id = cur.lastrowid
        else:
            chorale_id = chorale_row["id"]

    # 2. Créer un chant public d'origine
    payload_original = schemas.ChantCreate(
        titre="Chant Original Test",
        categorie="Entrée",
        refrain="Refrain original",
        couplets=["Couplet 1 original"],
        langue="fr",
    )
    original = crud.create_chant(payload_original, visibilite="publique")
    assert original.id is not None
    assert original.visibilite == "publique"

    # 3. La chorale modifie le chant (ce qui doit créer une version locale et une proposition)
    patch = schemas.ChantUpdate(
        refrain="Refrain modifié par la chorale",
        version_nom="Version Ste Cécile",
    )
    version_chorale = crud.creer_ou_mettre_a_jour_version_chorale(original.id, chorale_id, patch)
    assert version_chorale is not None
    assert version_chorale.id != original.id
    assert version_chorale.chant_parent_id == original.id
    assert version_chorale.chorale_proprietaire_id == chorale_id
    assert version_chorale.visibilite == "chorale"
    assert version_chorale.refrain == "Refrain modifié par la chorale"
    assert version_chorale.version_nom == "Version Ste Cécile"

    # 4. Vérifier que la proposition est bien présente dans la liste de modération
    propositions = crud.lister_propositions_chants(statut="en_attente")
    props_pour_ce_chant = [p for p in propositions if p["chant_original_id"] == original.id]
    assert len(props_pour_ce_chant) == 1
    prop = props_pour_ce_chant[0]
    assert prop["chant_modifie_id"] == version_chorale.id
    assert prop["chorale_id"] == chorale_id
    assert prop["statut"] == "en_attente"

    # 5. Vérifier la liste des versions pour cette chorale
    versions = crud.get_chant_versions(original.id, chorale_id_appelant=chorale_id)
    ids_versions = [v.id for v in versions]
    assert original.id in ids_versions
    assert version_chorale.id in ids_versions

    # 6. Vérifier le refus / annulation par l'admin
    # Quand l'admin annule, la version reste chez la chorale
    ok_annule = crud.annuler_proposition_chant(prop["id"], motif="Refrain non conforme")
    assert ok_annule is True
    # La chorale a toujours accès à sa propre version
    chorale_version_check = crud.get_chant(version_chorale.id, chorale_id_appelant=chorale_id)
    assert chorale_version_check is not None
    assert chorale_version_check.visibilite == "chorale"

    # 7. Deuxième test : versionnement officiel par l'admin
    # La chorale propose une nouvelle modif
    patch2 = schemas.ChantUpdate(
        refrain="Refrain officiel v2",
        version_nom="Version Harmonisée",
    )
    v2 = crud.creer_ou_mettre_a_jour_version_chorale(original.id, chorale_id, patch2)
    props2 = [p for p in crud.lister_propositions_chants(statut="en_attente") if p["chant_original_id"] == original.id]
    assert len(props2) == 1
    ok_versionne = crud.versionner_proposition_chant(props2[0]["id"], version_nom="Version Harmonisée Officielle")
    assert ok_versionne is True

    # Maintenant v2 est devenue publique !
    v2_public = crud.get_chant(v2.id)
    assert v2_public.visibilite == "publique"
    assert v2_public.version_nom == "Version Harmonisée Officielle"


def test_api_versioning_and_moderation_routes():
    from fastapi.testclient import TestClient
    from backend.app.main import app
    from backend.app.auth import Identite, create_session_token

    with get_connection() as conn:
        conn.execute("UPDATE auth SET must_change_password = 0 WHERE id = 1")
        conn.execute("UPDATE chorales SET must_change_password = 0 WHERE username = 'test-chorale'")

    client = TestClient(app)

    token_super = create_session_token(Identite(type="super", compte_id=0, username="admin"))
    token_chorale = create_session_token(Identite(type="chorale", compte_id=1, username="test-chorale"))

    # 1. Créer un chant par l'admin
    resp = client.post("/chants", json={
        "titre": "Chant Test Route",
        "categorie": "Entrée",
        "refrain": "Refrain de base",
        "couplets": ["Couplet 1"],
    }, headers={"Authorization": f"Bearer {token_super}"})
    assert resp.status_code == 200
    chant = resp.json()
    chant_id = chant["id"]

    # 2. La chorale modifie le chant via PATCH /chants/{id}
    resp = client.patch(f"/chants/{chant_id}", json={
        "refrain": "Refrain modifié par Ste Cécile",
        "version_nom": "Harmonisation 2026",
    }, headers={"Authorization": f"Bearer {token_chorale}"})
    assert resp.status_code == 200
    version_data = resp.json()
    assert version_data["id"] != chant_id
    assert version_data["chant_parent_id"] == chant_id
    assert version_data["refrain"] == "Refrain modifié par Ste Cécile"

    # 3. La chorale récupère les versions via GET /chants/{id}/versions
    resp = client.get(f"/chants/{chant_id}/versions", headers={"Authorization": f"Bearer {token_chorale}"})
    assert resp.status_code == 200
    versions = resp.json()
    assert len(versions) >= 2

    # 4. L'admin liste les propositions de modification
    resp = client.get("/moderation/propositions-chants", headers={"Authorization": f"Bearer {token_super}"})
    assert resp.status_code == 200
    props = resp.json()
    matching_props = [p for p in props if p["chant_original_id"] == chant_id]
    assert len(matching_props) == 1
    prop_id = matching_props[0]["id"]

    # 5. L'admin versionne la proposition
    resp = client.post(f"/moderation/propositions-chants/{prop_id}/versionner", json={
        "version_nom": "Version Officielle B",
    }, headers={"Authorization": f"Bearer {token_super}"})
    assert resp.status_code == 200
    assert resp.json()["statut"] == "accepte_versionne"

