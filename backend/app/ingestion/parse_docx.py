import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_T = f"{W_NS}t"
_BR = f"{W_NS}br"
_TAB = f"{W_NS}tab"


def iter_paragraphs_docx(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as z:
        xml_bytes = z.read("word/document.xml")
    root = ET.fromstring(xml_bytes)
    paragraphs = []
    for p in root.iter(f"{W_NS}p"):
        # Un saut de ligne manuel (Maj+Entrée, <w:br/>) reste à l'intérieur du
        # même <w:p> — en ne prenant que les nœuds <w:t> (comme avant), ce
        # saut est invisible et deux couplets/refrain finissent collés sans
        # même un espace entre eux. On parcourt donc tous les descendants
        # dans l'ordre du document pour réinsérer une coupure à chaque <w:br/>.
        morceaux = []
        for el in p.iter():
            if el.tag == _T:
                morceaux.append(el.text or "")
            elif el.tag == _BR:
                morceaux.append("\n")
            elif el.tag == _TAB:
                morceaux.append("\t")
        texte_brut = "".join(morceaux)
        for sous_ligne in texte_brut.split("\n"):
            sous_ligne = sous_ligne.strip()
            if sous_ligne:
                paragraphs.append(sous_ligne)
    return paragraphs
