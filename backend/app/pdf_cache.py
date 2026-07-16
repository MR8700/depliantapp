import shutil
from pathlib import Path
from typing import Optional, Tuple

CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "pdf_cache"

def get_cached_pdf(chorale_id: int, feuillet_id: int) -> Optional[Tuple[bytes, float]]:
    """Retourne (pdf_bytes, taille_texte) si présent dans le cache, sinon None."""
    pdf_path = CACHE_DIR / str(chorale_id) / f"{feuillet_id}.pdf"
    meta_path = CACHE_DIR / str(chorale_id) / f"{feuillet_id}.meta"
    
    if pdf_path.exists() and meta_path.exists():
        try:
            pdf_bytes = pdf_path.read_bytes()
            taille_texte = float(meta_path.read_text(encoding="utf-8").strip())
            return pdf_bytes, taille_texte
        except Exception:
            return None
    return None

def set_cached_pdf(chorale_id: int, feuillet_id: int, pdf_bytes: bytes, taille_texte: float) -> None:
    """Enregistre le PDF et sa taille de texte associée dans le cache."""
    try:
        dir_path = CACHE_DIR / str(chorale_id)
        dir_path.mkdir(parents=True, exist_ok=True)
        
        pdf_path = dir_path / f"{feuillet_id}.pdf"
        meta_path = dir_path / f"{feuillet_id}.meta"
        
        pdf_path.write_bytes(pdf_bytes)
        meta_path.write_text(str(taille_texte), encoding="utf-8")
    except Exception:
        pass

def invalidate_feuillet_cache(chorale_id: int, feuillet_id: int) -> None:
    """Invalide le cache pour un feuillet précis."""
    try:
        pdf_path = CACHE_DIR / str(chorale_id) / f"{feuillet_id}.pdf"
        meta_path = CACHE_DIR / str(chorale_id) / f"{feuillet_id}.meta"
        if pdf_path.exists():
            pdf_path.unlink()
        if meta_path.exists():
            meta_path.unlink()
    except Exception:
        pass

def invalidate_chorale_cache(chorale_id: int) -> None:
    """Invalide tous les PDFs en cache associés à une chorale (ex: après changement de réglages/logo)."""
    try:
        dir_path = CACHE_DIR / str(chorale_id)
        if dir_path.exists():
            shutil.rmtree(dir_path)
    except Exception:
        pass
