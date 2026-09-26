"""docs/API.md as test data: its JSON examples, and a check that a payload has the documented shape."""

import json
import re
from pathlib import Path

API_MD = Path(__file__).resolve().parents[2] / "docs" / "API.md"


def example(heading, n=0):
    """The n-th ```json block after `heading` in docs/API.md."""
    text = API_MD.read_text()
    return json.loads(re.findall(r"```json\n(.*?)```", text[text.index(heading):], re.S)[n])


def _template(items):
    """One example item from a list: per key, the first value that isn't null or empty."""
    if not isinstance(items[0], dict):
        return next((i for i in items if i is not None), None)
    return {k: next((i[k] for i in items if i.get(k) not in (None, [], {})), items[0][k]) for k in items[0]}


def shape_errors(ex, act, path="$", free=("$.net",)):
    """How `act` differs from the documented example `ex` in keys and types. null matches anything.
    `free` paths are objects keyed by data (interface names): only their values are checked."""
    if ex is None or act is None:
        return []
    if isinstance(ex, dict):
        if not isinstance(act, dict):
            return [f"{path}: expected an object, got {act!r}"]
        if ex.get("available") is True and act.get("available") is False:
            ok = set(act) == {"available", "error"} and isinstance(act["error"], str)
            return [] if ok else [f"{path}: an unavailable section must be exactly {{available, error}}: {act}"]
        if path in free:
            tmpl = next(iter(ex.values()))
            return [e for k, v in act.items() for e in shape_errors(tmpl, v, f"{path}.{k}", free)]
        errs = [] if set(ex) == set(act) else [
            f"{path}: missing {sorted(set(ex) - set(act))}, unexpected {sorted(set(act) - set(ex))}"]
        return errs + [e for k in sorted(set(ex) & set(act)) for e in shape_errors(ex[k], act[k], f"{path}.{k}", free)]
    if isinstance(ex, list):
        if not isinstance(act, list):
            return [f"{path}: expected a list, got {act!r}"]
        tmpl = _template(ex) if ex else None
        return [e for i, a in enumerate(act) for e in shape_errors(tmpl, a, f"{path}[{i}]", free)]
    if isinstance(ex, bool):
        ok = isinstance(act, bool)
    elif isinstance(ex, int):  # documented as an integer: must stay one
        ok = isinstance(act, int) and not isinstance(act, bool)
    elif isinstance(ex, float):
        ok = isinstance(act, (int, float)) and not isinstance(act, bool)
    else:
        ok = isinstance(act, type(ex))
    return [] if ok else [f"{path}: expected {type(ex).__name__} like {ex!r}, got {act!r}"]
