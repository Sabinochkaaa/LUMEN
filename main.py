"""Запуск агента LÜMEN одной командой (то же, что `python -m lumen`).

    python main.py --input docs/requirements.md --output reports/audit_report.md
"""
import sys

from lumen.cli import main

if __name__ == "__main__":
    sys.exit(main())
