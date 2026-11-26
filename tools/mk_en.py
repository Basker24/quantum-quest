"""Черновик EN (текстовые ключи шапки + тело) + логика шапки из RU → scenes_en/<file>.md. Запуск: cd папка_черновиков && python3 /path/tools/mk_en.py X.md …"""
import sys, pathlib, re
ROOT = pathlib.Path(__file__).resolve().parent.parent
TEXT = ("title", "date", "photo_caption", "clock_label", "lesson", "epitaph", "mourner")
for d in sys.argv[1:]:
    d = pathlib.Path(d)
    _, h, body = d.read_text(encoding="utf-8").split("---", 2)
    en = dict((k.strip(), v.strip()) for k, _, v in (l.partition(":") for l in h.strip().splitlines() if l.strip()))
    ru = (ROOT / "scenes" / d.name).read_text(encoding="utf-8")
    _, rh, _ = ru.split("---", 2)
    lines = []
    for l in rh.strip().splitlines():
        k = l.partition(":")[0].strip()
        if k in TEXT:
            if k not in en:
                sys.exit(f"{d.name}: нет {k}")
            lines.append(f"{k}: {en[k]}")
        else:
            lines.append(l)
    import hashlib
    lines.append("src_sha: " + hashlib.sha1((ROOT / "scenes" / d.name).read_bytes()).hexdigest()[:12])
    extra = set(en) - set(TEXT) - {"id", "src_sha", "en_status"}
    if extra:
        sys.exit(f"{d.name}: лишние ключи {extra}")
    (ROOT / "scenes_en" / d.name).write_text("---\n" + "\n".join(lines) + "\n---" + body, encoding="utf-8")
    print("ok", d.name)
