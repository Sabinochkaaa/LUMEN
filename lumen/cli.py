"""`lumen` CLI — one command: input requirements file → report file.

    python -m lumen --input docs/requirements.md --output reports/audit_report.md
    python -m lumen docs/requirements.pdf reports/audit_report.md --provider gemini
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from pathlib import Path

from . import PRODUCT_NAME, __version__
from .config import PROVIDER_LABELS, settings
from .engine.pipeline import STAGES, AuditError, finalize, run_audit
from .models import StageEvent

USE_COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def _c(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if USE_COLOR else text


def _progress(ev: StageEvent) -> None:
    bar_len = 24
    filled = int(bar_len * (ev.index - (0 if ev.status != "running" else 1)) / ev.total)
    bar = "█" * filled + "░" * (bar_len - filled)
    icon = {"running": _c("36", "▶"), "done": _c("32", "✔"), "skipped": _c("33", "⏭"), "error": _c("31", "✖")}[ev.status]
    tail = f" — {ev.message}" if ev.message else ""
    took = f" {_c('90', f'({ev.elapsed_ms / 1000:.1f} с)')}" if ev.status != "running" and ev.elapsed_ms > 300 else ""
    print(f"  {_c('90', bar)} {ev.index:>2}/{ev.total} {icon} {ev.title}{tail}{took}", flush=True)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="lumen",
        description=f"{PRODUCT_NAME} — статическая проверка документа требований (ISO/IEC/IEEE 29148, IEEE 830).",
    )
    ap.add_argument("input_pos", nargs="?", help="путь к документу требований (PDF, DOCX, MD, TXT, HTML, RTF, PNG/JPG)")
    ap.add_argument("output_pos", nargs="?", help="путь к файлу отчёта (.md/.html/.json)")
    ap.add_argument("-i", "--input", help="путь к документу требований")
    ap.add_argument("-o", "--output", help="путь к файлу отчёта (по умолчанию reports/audit_report.md)")
    ap.add_argument("-p", "--provider", help="anthropic | claude-cli | gemini | openai | offline | mock (по умолчанию auto)")
    ap.add_argument("-m", "--model", help="модель LLM (по умолчанию — из .env или рекомендуемая)")
    ap.add_argument("--formats", default="md,html,json", help="какие форматы записать: md,html,json,pdf,docx,xlsx")
    ap.add_argument("--demo", action="store_true", help="демонстрационный прогон на examples/demo_requirements.md")
    ap.add_argument("-q", "--quiet", action="store_true", help="без прогресса")
    ap.add_argument("-v", "--version", action="version", version=f"LÜMEN {__version__}")
    args = ap.parse_args(argv)
    logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO),
                        format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)

    src = args.input or args.input_pos
    out = args.output or args.output_pos or "reports/audit_report.md"
    provider = args.provider
    if args.demo:
        src = src or str(Path(__file__).resolve().parent.parent / "examples" / "demo_requirements.md")
        provider = provider or "mock"
    if not src:
        ap.print_usage()
        print("lumen: ошибка: укажите документ требований: --input путь/к/файлу", file=sys.stderr)
        return 2
    prov = settings.resolve_provider(provider)
    print(_c("1;34", f"\n  LÜMEN Requirements Intelligence · v{__version__}"))
    print(f"  Документ: {src}\n  Модель:   {settings.resolve_model(prov, args.model)} "
          f"({PROVIDER_LABELS.get(prov, prov)})\n")
    if prov == "offline":
        print(_c("33", "  ⚠ LLM-ключ не найден — запуск только на детерминированных правилах. "
                       "Добавьте ANTHROPIC_API_KEY или GEMINI_API_KEY в .env для полного анализа.\n"))
    responder = None
    if prov == "mock":
        from .demo import demo_responder

        responder = demo_responder
    t0 = time.time()
    try:
        result = run_audit(src, provider=prov, model=args.model, progress=None if args.quiet else _progress,
                           responder=responder, demo=args.demo)
        paths = finalize(result, out, progress=None if args.quiet else _progress,
                         formats=tuple(x.strip() for x in args.formats.split(",") if x.strip()))
    except AuditError as e:
        print(_c("31", f"\n  ✖ {e}"), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print(_c("31", "\n  ✖ Прервано пользователем"), file=sys.stderr)
        return 130
    s = result.scores
    color = {"NOT READY": "31", "READY WITH CONDITIONS": "33", "READY": "32"}.get(result.readiness, "37")
    print()
    print(f"  Требований: {s.total_requirements} · замечаний: {s.findings_total} "
          f"(CRITICAL {s.by_severity['CRITICAL']}, HIGH {s.by_severity['HIGH']}, MEDIUM {s.by_severity['MEDIUM']}, "
          f"LOW {s.by_severity['LOW']}) · вопросов: {len(result.questions)} · индекс качества {s.quality_index}/100")
    print("  Готовность: " + _c("1;" + color, result.readiness) + f" — {result.readiness_reason}")
    for fmt, pth in paths.items():
        print(f"  Отчёт {fmt.upper():4}: {pth}")
    print(_c("90", f"  Готово за {time.time() - t0:.1f} с\n"))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
