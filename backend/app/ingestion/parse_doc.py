from pathlib import Path


def iter_paragraphs_doc(path: Path, word=None) -> list[str]:
    """Nécessite Windows + Microsoft Word (automation COM) : import différé pour
    que le reste de l'application (et son démarrage) fonctionne aussi sur un
    serveur Linux (Render, etc.) où seuls les .docx/.pdf restent importables."""
    try:
        import win32com.client
    except ImportError as exc:
        raise RuntimeError(
            "L'import de fichiers .doc nécessite Windows et Microsoft Word installés — "
            "indisponible sur ce serveur. Convertis le fichier en .docx ou .pdf avant de l'importer."
        ) from exc

    owns_word = word is None
    if owns_word:
        word = win32com.client.DispatchEx("Word.Application")
        word.Visible = False
        word.DisplayAlerts = 0
    try:
        doc = word.Documents.Open(str(path), False, True, False)
        try:
            paragraphs = []
            count = doc.Paragraphs.Count
            for i in range(1, count + 1):
                text = doc.Paragraphs.Item(i).Range.Text
                text = text.replace("\r", "").replace("\x07", "").strip()
                if text:
                    paragraphs.append(text)
            return paragraphs
        finally:
            doc.Close(False)
    finally:
        if owns_word:
            word.Quit()
