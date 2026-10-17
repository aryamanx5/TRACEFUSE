"""Investigator challenge: checkpoints answered against prepared, sourced case labels (not live engine output)."""

from __future__ import annotations

import json
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from ..services import Services


def _path(s: Services, case_key: str, name: str) -> Path:
    if not re.fullmatch(r"[a-z0-9\-]+", case_key):
        raise KeyError(case_key)
    return Path(s.settings.tracefuse_data_dir) / "cases" / case_key / name


def list_challenges(s: Services) -> list[dict[str, Any]]:
    root = Path(s.settings.tracefuse_data_dir) / "cases"
    out = []
    for d in sorted(root.iterdir()) if root.exists() else []:
        f = d / "challenge.json"
        if f.exists():
            c = json.loads(f.read_text())
            out.append({"id": c["id"], "case_key": d.name, "title": c["title"], "checkpoints": len(c["checkpoints"])})
    return out


def load(s: Services, challenge_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    for c in list_challenges(s):
        if c["id"] == challenge_id:
            ch = json.loads(_path(s, c["case_key"], "challenge.json").read_text())
            labels = json.loads(_path(s, c["case_key"], "labels.json").read_text())
            ch["case_key"] = c["case_key"]
            return ch, labels
    raise KeyError(challenge_id)


def public_view(ch: dict[str, Any], progress: dict[str, dict[str, Any]]) -> dict[str, Any]:
    cps = []
    for cp in ch["checkpoints"]:
        p = progress.get(cp["id"], {})
        solved = bool(p.get("solved"))
        hints_used = int(p.get("hints_used", 0))
        cps.append({"id": cp["id"], "title": cp["title"], "prompt": cp["prompt"], "type": cp["type"],
                    "choices": cp.get("choices"), "hints_available": len(cp.get("hints", [])),
                    "hints": cp.get("hints", [])[:hints_used], "attempts": int(p.get("attempts", 0)), "solved": solved,
                    "explanation": cp.get("explanation") if solved else None,
                    "evidence": cp.get("evidence") if solved else None, "inspect": cp.get("inspect")})
    return {"id": ch["id"], "title": ch["title"], "intro": ch["intro"], "case_key": ch["case_key"], "checkpoints": cps,
            "solved": sum(1 for c in cps if c["solved"]), "total": len(cps)}


def _norm(v: str) -> str:
    return re.sub(r"\s+", " ", str(v).strip().lower())


def check(cp: dict[str, Any], labels: dict[str, Any], answer: str) -> bool:
    expected = cp["answer"]
    if isinstance(expected, str) and expected.startswith("label:"):
        lab = labels[expected[6:]]
        accepted = lab["values"] if "values" in lab else [lab["value"]]
    else:
        accepted = expected if isinstance(expected, list) else [expected]
    t = cp["type"]
    if t == "number":
        try:
            got = Decimal(str(answer).replace(",", "").replace("_", "").strip())
        except InvalidOperation:
            return False
        tol = Decimal(str(cp.get("tolerance", 0)))
        return any(abs(got - Decimal(str(a))) <= tol for a in accepted)
    return _norm(answer) in {_norm(a) for a in accepted}


def answer(s: Services, session_id: str, challenge_id: str, checkpoint_id: str, given: str) -> dict[str, Any]:
    ch, labels = load(s, challenge_id)
    cp = next((c for c in ch["checkpoints"] if c["id"] == checkpoint_id), None)
    if cp is None:
        raise KeyError(checkpoint_id)
    if len(given) > 300:
        raise ValueError("answer too long")
    ok = check(cp, labels, given)
    s.challenges.record(session_id, challenge_id, checkpoint_id, attempt=True, solved=ok or None)
    return {"correct": ok, "challenge": public_view(ch, s.challenges.get(session_id, challenge_id))}


def hint(s: Services, session_id: str, challenge_id: str, checkpoint_id: str) -> dict[str, Any]:
    ch, _ = load(s, challenge_id)
    cp = next((c for c in ch["checkpoints"] if c["id"] == checkpoint_id), None)
    if cp is None:
        raise KeyError(checkpoint_id)
    used = int(s.challenges.get(session_id, challenge_id).get(checkpoint_id, {}).get("hints_used", 0))
    if used < len(cp.get("hints", [])):
        s.challenges.record(session_id, challenge_id, checkpoint_id, hint=True)
    return public_view(ch, s.challenges.get(session_id, challenge_id))
