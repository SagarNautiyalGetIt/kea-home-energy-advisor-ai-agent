"""Every module must import cleanly on its own.

## Why this test exists

A circular import only fails for *some* entry orders. `app.alerts` re-exported `service`
from its `__init__`, so importing any module in that package pulled `service` → `render` →
`analytics.billshock`, and `billshock` imports `app.alerts.preferences` for the confidence
floors. A cycle — and an invisible one:

* the whole test suite passed, because pytest's collection order happened to import
  `app.analytics.billshock` after something had already finished initialising `app.alerts`;
* `uvicorn app.main:app` was fine, for the same reason;
* the first caller to import `app.analytics` *first* was the scheduled job, and on Lambda
  that is a cold-start crash at 3am, not a red build.

The fix was to stop re-exporting. This test is what stops it coming back, and it has to
run each module in a **fresh interpreter** — inside one process, `sys.modules` carries the
lucky order from whatever imported first, which is exactly the condition that hid the bug.

## Why a subprocess per module rather than importlib.reload

`reload` does not clear the transitive graph, so a module whose dependency is already in
`sys.modules` still gets the cached one. The only faithful reproduction of "this is the
first thing the process imports" is a process where it is.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1] / "app"

#: Every importable module under app/, as a dotted name. Discovered rather than listed:
#: a hand-maintained list is a list that stops including new modules, and the module
#: somebody adds next week is the one most likely to introduce a cycle.
def _dotted(path: Path) -> str:
    relative = str(path.relative_to(APP)).removesuffix(".py").replace("/", ".")
    return "app." + relative.removesuffix(".__init__")


MODULES = sorted(
    _dotted(path) for path in APP.rglob("*.py") if "__pycache__" not in path.parts
)


@pytest.mark.parametrize("module", MODULES)
def test_module_imports_first(module: str) -> None:
    """Import this module into an interpreter that has imported nothing else."""
    result = subprocess.run(
        [sys.executable, "-c", f"import {module}"],
        capture_output=True,
        text=True,
        cwd=APP.parent,
        timeout=60,
    )
    assert result.returncode == 0, (
        f"{module} cannot be imported first:\n{result.stderr}\n\n"
        "This is almost always a package __init__ re-exporting a heavy submodule. "
        "See app/alerts/__init__.py for the one this test was written after."
    )


def test_the_alerts_package_root_imports_nothing() -> None:
    """The specific regression, pinned directly as well as by the sweep above.

    Asserted on the source rather than on behaviour because the sweep would still pass if
    someone re-added a re-export that happened not to cycle *today* — and the next module
    added to the package would then cycle, with the blame landing on the wrong change.
    """
    source = (APP / "alerts" / "__init__.py").read_text()
    code_lines = [
        line
        for line in source.splitlines()
        if line.strip().startswith(("import ", "from "))
    ]
    assert not code_lines, (
        "app/alerts/__init__.py must stay import-free — see its docstring. "
        f"Found: {code_lines}"
    )
