#!/usr/bin/env python3
"""ep-agentic-orca-team hook shim (managed file). Finds team-setup.py and forwards one CLI hook event.

No-op ({}) when the skill cannot be found, so a missing install never breaks a session.
"""
import os
from pathlib import Path
import subprocess
import sys

SKILL = 'ep-agentic-orca-team/scripts/team-setup.py'
DIRS = ('.agents/skills', '.claude/skills', '.copilot/skills', '.codex/skills', '.gemini/skills',
        '.gemini/antigravity/skills')


def project_root():
    here = Path(__file__).resolve().parent
    for p in [here, *here.parents]:
        if (p / '.git').exists():
            return p
    return Path.cwd()


def main():
    root = project_root()
    candidates = [os.environ.get('ORCA_TEAM_SETUP')] + [str(root / d / SKILL) for d in DIRS] + \
                 [str(Path.home() / '.skills-manager/skills' / SKILL)]
    script = next((c for c in candidates if c and Path(c).is_file()), None)
    if not script:
        print('{}')
        return 0
    payload = sys.stdin.read() if not sys.stdin.isatty() else ''
    r = subprocess.run([sys.executable, script, '--project', str(root), 'hook', *sys.argv[1:]],
                       input=payload, capture_output=True, text=True)
    print(r.stdout.strip() or '{}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
