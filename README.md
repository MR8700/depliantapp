# depliantapp

Application de composition de feuillets de messe pour chorale : bibliothèque de chants,
composition par moment liturgique, génération PDF, import de carnets, classification automatique.

## Lancer en local

```
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Déploiement

Voir `render.yaml` — déployable sur Render via Blueprint.
