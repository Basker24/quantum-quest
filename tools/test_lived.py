#!/usr/bin/env python3
"""Тест честной модели мета-слоя в validate.ev (P1 аудита 17.11).

lived(ID) — «сцена ID прожита в прошлой жизни» (как vlife в engine.js): истинна ТОЛЬКО когда
ID ∈ meta (Журнал: id смертей и посещённых сцен), ложна при пустом Журнале, None и маркере GATES.
Раньше считался истинным при ЛЮБОМ непустом Журнале — не отличал «прожита A» от «прожита B».
Запуск: python3 tools/test_lived.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from validate import GATES, META_MAX, ev

def lived(sid):
    return {"op": "lived", "id": sid}

def seen(sid, life=False):
    return {"op": "seen", "id": sid, **({"life": True} if life else {})}

# Журналы прошлых жизней: одна и та же смерть, но разные посещённые сцены
J_A = frozenset({"✝X1", "A-01"})
J_B = frozenset({"✝X1", "B-02"})

checks = []
def check(name, cond):
    checks.append((name, cond))
    print(("✅" if cond else "❌"), name)

st = {}
# --- главное из аудита: «посещена A, не посещена B → lived(A) истинно, lived(B) ложно»
check("lived(A) истинна, когда A в Журнале", ev(lived("A-01"), st, frozenset(), J_A) is True)
check("lived(B) ложна, когда в Журнале A, а не B", ev(lived("B-02"), st, frozenset(), J_A) is False)
check("lived(B) истинна, когда B в Журнале", ev(lived("B-02"), st, frozenset(), J_B) is True)
check("lived(A) ложна, когда в Журнале B, а не A", ev(lived("A-01"), st, frozenset(), J_B) is False)
# --- пустой Журнал / без Журнала / маркер свидетелей
check("lived(A) ложна при пустом Журнале", ev(lived("A-01"), st, frozenset(), frozenset()) is False)
check("lived(A) ложна при meta=None (Журнал = эта жизнь)", ev(lived("A-01"), st) is False)
check("lived(A) ложна при маркере GATES", ev(lived("A-01"), st, frozenset(), GATES) is False)
# --- мета-гейты не изменились: маркер и полный Журнал открывают, пустой — нет
check("kinds() при GATES — максимум", ev({"op": "kinds"}, st, frozenset(), GATES) == META_MAX["kinds"])
check("kinds() при полном Журнале — максимум", ev({"op": "kinds"}, st, frozenset(), J_A) == META_MAX["kinds"])
check("kinds() при пустом Журнале — 0", ev({"op": "kinds"}, st, frozenset(), frozenset()) == 0)
check("branches() при None — 0", ev({"op": "branches"}, st) == 0)
# --- seen: смерти Журнала и этой жизни
check("seen(✝X1) истинна по Журналу", ev(seen("✝X1"), st, frozenset(), J_A) is True)
check("seen(✝X2) ложна, чужой смерти нет в Журнале", ev(seen("✝X2"), st, frozenset(), J_A) is False)
check("seen(✝X2, life) читает смерти этой жизни", ev(seen("✝X2", life=True), st, frozenset({"✝X2"}), J_A) is True)

fail = [n for n, c in checks if not c]
if fail:
    print(f"провалено проверок: {len(fail)}")
    sys.exit(1)
print(f"все {len(checks)} проверок пройдены")
