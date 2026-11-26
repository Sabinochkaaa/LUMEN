"""LÜMEN REST API (FastAPI): upload → background audit → live SSE progress → results, reports, clarifications.

    uvicorn lumen.api.app:app --port 8000
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .. import PRODUCT_NAME, __version__
from ..config import PROVIDER_LABELS, agent_version, settings
from ..parsing.loader import FORMATS, SUPPORTED
from ..report.render import render_html, render_markdown
from ..service import get_service
from ..security import (SESSION_COOKIE, SESSION_TTL, UploadRejected, check_session, client_ip, edit_key, edit_key_ok,
                        limiter, make_session, safe_filename, security_headers, token_ok, validate_upload)
from ..storage.store import summary

log = logging.getLogger("lumen.api")
logging.getLogger("httpx").setLevel(logging.WARNING)  # httpx logs full URLs (Telegram token is in the URL)
MAX_UPLOAD = 20 * 1024 * 1024
MAX_BODY = MAX_UPLOAD + 1024 * 1024  # multipart overhead
SSE_MAX_S = 30 * 60
AUDIT_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
WEB_DIST = Path(__file__).resolve().parent.parent.parent / "web" / "dist"

@asynccontextmanager
async def lifespan(_app):
    if settings.telegram_token and os.environ.get("LUMEN_BOT_IN_API", "1") == "1":
        from ..bot.telegram import TelegramBot

        threading.Thread(target=TelegramBot(settings.telegram_token, get_service()).run_forever, daemon=True,
                         name="lumen-telegram").start()
        log.info("Telegram-бот запущен внутри API")
    support_token = os.environ.get("LUMEN_SUPPORT_BOT_TOKEN", "")
    if support_token and settings.telegram_token and support_token != settings.telegram_token:
        from ..bot.support_bot import SupportDesk

        threading.Thread(target=SupportDesk(support_token, settings.telegram_token).run_forever, daemon=True,
                         name="lumen-support-desk").start()
        log.info("Бот службы поддержки запущен")
    yield


app = FastAPI(title=f"{PRODUCT_NAME} API", version=__version__, lifespan=lifespan,
              description="AI-Powered Requirements Quality & Compliance Platform")
_cors = os.environ.get("LUMEN_CORS", "" if settings.production else "*")
if _cors:
    app.add_middleware(CORSMiddleware, allow_origins=[x.strip() for x in _cors.split(",") if x.strip()],
                       allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["X-API-Token", "Content-Type", "X-Edit-Key", "X-Requested-With"])


@app.middleware("http")
async def guard(request: Request, call_next):
    path = request.url.path
    try:
        too_big = int(request.headers.get("content-length") or 0) > MAX_BODY
    except ValueError:
        too_big = True
    if too_big:  # refuse before Starlette spools a huge body to disk
        return JSONResponse({"detail": "Запрос больше 20 МБ"}, status_code=413)
    if path.startswith("/api/") and path != "/api/health":
        ip = client_ip(request.headers, request.client.host if request.client else "unknown")
        ok, retry = limiter.allow(f"req:{ip}", settings.rate_requests_per_min, 60)
        if not ok:
            return JSONResponse({"detail": f"Слишком много запросов. Повторите через {retry} с."}, status_code=429,
                                headers={"Retry-After": str(retry)})
    response = await call_next(request)
    https = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    for k, v in security_headers(path, https).items():
        response.headers.setdefault(k, v)
    return response


def is_admin(request: Request) -> bool:
    """Admin = valid signed session cookie (browser) or X-API-Token header (scripts, CI, bots)."""
    secret = settings.admin_password
    if not secret:
        return not settings.production  # local development without a password: everything is allowed
    header = request.headers.get("x-api-token")
    if header and token_ok(header, secret):
        return True
    if check_session(secret, request.cookies.get(SESSION_COOKIE)):
        # CSRF guard: cookie-authenticated writes must come from our own frontend (custom header, SameSite=Strict)
        return request.method in ("GET", "HEAD") or request.headers.get("x-requested-with") == "lumen"
    return False


def require_admin(request: Request) -> None:
    if not is_admin(request):
        if not settings.admin_password:
            raise HTTPException(403, "Действие доступно администратору: задайте LUMEN_ADMIN_PASSWORD на сервере")
        raise HTTPException(401, "Требуется вход администратора (Настройки → Вход администратора)")


def require_run(request: Request) -> None:
    """Running an audit/translation: open to everyone in public mode (rate-limited), otherwise admin only."""
    if not settings.public_audits:
        require_admin(request)


# backward-compatible name used by older dependencies
require_token = require_run


def require_read(request: Request) -> None:
    if settings.private_mode:
        require_admin(request)


def limit_audits(request: Request) -> None:
    if is_admin(request) and settings.admin_password:
        return  # administrators are not rate-limited
    ip = client_ip(request.headers, request.client.host if request.client else "unknown")
    ok, retry = limiter.allow(f"audit:{ip}", settings.rate_audits_per_hour, 3600)
    if not ok:
        raise HTTPException(429, f"Лимит запусков анализа исчерпан. Повторите через {retry // 60 + 1} мин.",
                            headers={"Retry-After": str(retry)})


class LoginBody(BaseModel):
    password: str


@app.post("/api/auth/login")
def login(body: LoginBody, request: Request):
    from fastapi.responses import JSONResponse as J

    ip = client_ip(request.headers, request.client.host if request.client else "unknown")
    ok, retry = limiter.allow(f"login:{ip}", 5, 900)
    if not ok:
        raise HTTPException(429, f"Слишком много попыток входа. Повторите через {retry // 60 + 1} мин.")
    secret = settings.admin_password
    if not secret:
        raise HTTPException(403, "Вход администратора не настроен: задайте LUMEN_ADMIN_PASSWORD на сервере")
    if not token_ok(body.password[:256], secret):
        raise HTTPException(401, "Неверный пароль")
    https = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    resp = J({"admin": True, "expires_in": SESSION_TTL})
    resp.set_cookie(SESSION_COOKIE, make_session(secret), max_age=SESSION_TTL, httponly=True, secure=https,
                    samesite="strict", path="/")
    return resp


@app.post("/api/auth/logout")
def logout():
    from fastapi.responses import JSONResponse as J

    resp = J({"admin": False})
    resp.delete_cookie(SESSION_COOKIE, path="/")
    return resp


@app.get("/api/auth/me")
def me(request: Request):
    return {"admin": is_admin(request) and bool(settings.admin_password), "login_enabled": bool(settings.admin_password),
            "public_audits": settings.public_audits}


class SupportBody(BaseModel):
    message: str
    history: list[dict] = []
    lang: str = "ru"
    audit_id: Optional[str] = None


def _support_limit(request: Request, key: str, limit: int) -> None:
    ip = client_ip(request.headers, request.client.host if request.client else "unknown")
    ok, retry = limiter.allow(f"{key}:{ip}", limit, 3600)
    if not ok:
        raise HTTPException(429, f"Слишком много сообщений. Повторите через {retry // 60 + 1} мин.",
                            headers={"Retry-After": str(retry)})


@app.post("/api/support")
def support_chat(body: SupportBody, request: Request):
    """The support agent: answers about LÜMEN and, when given an audit id, about that report."""
    from ..support import answer

    if not body.message.strip() or len(body.message) > 2000:
        raise HTTPException(422, "Сообщение пустое или длиннее 2000 символов")
    _support_limit(request, "support", 60)
    svc = get_service()
    audit = None
    if body.audit_id and AUDIT_ID.match(body.audit_id):
        try:
            audit = svc.store.get(body.audit_id)
        except Exception:
            audit = None
    prov = settings.resolve_provider()
    client = None
    if prov not in ("offline", "mock"):
        from ..llm.client import make_chain

        client = make_chain(prov, settings.resolve_model(prov), settings)
    return answer(body.message, body.history[-8:], body.lang, audit, client).as_dict()


@app.post("/api/voice")
async def voice_to_text(request: Request, file: UploadFile = File(...), lang: str = Form("ru")):
    """A spoken question → text (Whisper). The audio is not stored."""
    from ..voice import MAX_BYTES, VoiceError, transcribe

    _support_limit(request, "voice", 30)
    data = await file.read(MAX_BYTES + 1)
    try:
        text = await run_in_threadpool(transcribe, data, file.filename or "voice.webm", lang)
    except VoiceError as e:
        raise HTTPException(422, str(e)) from None
    return {"text": text}


class TicketBody(BaseModel):
    message: str
    contact: str = ""
    history: list[dict] = []
    audit_id: Optional[str] = None


@app.post("/api/support/ticket")
def support_ticket(body: TicketBody, request: Request):
    from ..support import save_ticket

    if not body.message.strip() or len(body.message) > 2000 or len(body.contact) > 200:
        raise HTTPException(422, "Опишите вопрос (до 2000 символов)")
    _support_limit(request, "ticket", 5)
    t = save_ticket(settings.data_dir, body.message, body.history, body.contact, "site", body.audit_id or "", cfg=settings)
    return {"id": t["id"], "ok": True}


@app.get("/api/support/tickets", dependencies=[Depends(require_admin)])
def support_tickets():
    from ..support import list_tickets

    return {"items": list_tickets(settings.data_dir, cfg=settings)}


@app.get("/api/health")
def health():
    svc = get_service()
    prov = settings.resolve_provider()
    return {
        "status": "ok", "product": PRODUCT_NAME, **agent_version(), "provider": prov,
        "provider_label": PROVIDER_LABELS.get(prov, prov), "model": settings.resolve_model(prov),
        "providers": settings.available_providers(), "storage": svc.store.kind,
        "storage_degraded": getattr(svc.store, "degraded", False),
        "storage_error": getattr(svc.store, "last_error", None),
        "storage_key": getattr(getattr(svc.store, "primary", svc.store), "key_kind", None),
        "voice": bool(settings.groq_api_key or settings.openai_api_key),
        "auth_required": not settings.public_audits and bool(settings.admin_password),
        "public_audits": settings.public_audits, "login_enabled": bool(settings.admin_password),
        "private_mode": settings.private_mode, "public_demo": settings.public_demo,
        "encryption": bool(settings.encryption_key),
        "telegram": bool(settings.telegram_token), "formats": FORMATS,
    }


@app.post("/api/audits", dependencies=[Depends(require_run), Depends(limit_audits)])
async def create_audit(file: UploadFile = File(...), provider: Optional[str] = Form(None), model: Optional[str] = Form(None)):
    name = Path(file.filename or "document").name
    ext = Path(name).suffix.lower()
    if ext not in SUPPORTED:
        raise HTTPException(415, f"Формат «{ext or '?'}» не поддерживается. Допустимо: PDF, DOCX, MD, TXT, HTML, RTF, PNG, JPG.")
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Файл больше 20 МБ")
    if not data.strip():
        raise HTTPException(422, "Файл пуст")
    try:
        validate_upload(name, data)
    except UploadRejected as e:
        raise HTTPException(422, str(e)) from None
    if provider and provider not in PROVIDER_LABELS and provider not in ("auto", "claude"):
        raise HTTPException(422, f"Неизвестный провайдер: {provider}")
    svc = get_service()
    safe = safe_filename(name)
    import uuid as _uuid

    path = svc.uploads / f"{_uuid.uuid4().hex}_{safe}"
    path.write_bytes(data)
    job = svc.submit(path, name, provider=None if provider in (None, "", "auto") else provider, model=model or None)
    return {"job_id": job.id, "audit_id": job.id, "events": f"/api/audits/{job.id}/events", "edit_key": edit_key(job.id)}


def demo_access(request: Request) -> None:
    if not settings.public_demo:  # demo uses scripted answers, no model cost — public by default
        require_admin(request)


@app.post("/api/demo", dependencies=[Depends(demo_access), Depends(limit_audits)])
def create_demo():
    job = get_service().submit_demo()
    return {"job_id": job.id, "audit_id": job.id, "events": f"/api/audits/{job.id}/events", "demo": True,
            "edit_key": edit_key(job.id)}


@app.get("/api/demo/document", dependencies=[Depends(demo_access)])
def demo_document():
    from ..service import DEMO_DOC

    return PlainTextResponse(DEMO_DOC.read_text(encoding="utf-8"), media_type="text/markdown; charset=utf-8")


@app.get("/api/audits/{audit_id}/events", dependencies=[Depends(require_read)])
async def events(audit_id: str):
    if not AUDIT_ID.match(audit_id):
        raise HTTPException(404, "Прогон не найден")
    job = get_service().jobs.get(audit_id)
    if job is None:
        r = get_service().store.get(audit_id)
        if r is None:
            raise HTTPException(404, "Прогон не найден")

        async def done_stream():
            for ev in r.stages:
                yield f"event: stage\ndata: {ev.model_dump_json()}\n\n"
            yield f"event: result\ndata: {json.dumps({'id': r.id, 'readiness': r.readiness})}\n\n"

        return StreamingResponse(done_stream(), media_type="text/event-stream")

    async def stream():
        sent, started = 0, asyncio.get_running_loop().time()
        while asyncio.get_running_loop().time() - started < SSE_MAX_S:
            with job.cond:
                batch = job.events[sent:]
            for ev in batch:
                yield f"event: {ev['type']}\ndata: {json.dumps(ev['data'], ensure_ascii=False)}\n\n"
            sent += len(batch)
            if job.status in ("done", "error") and sent >= len(job.events):
                break
            if not batch:
                yield ": keep-alive\n\n"
            await asyncio.sleep(0.25)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"cache-control": "no-cache", "x-accel-buffering": "no"})


@app.get("/api/audits", dependencies=[Depends(require_read)])
def list_audits(limit: int = Query(100, ge=1, le=500)):
    svc = get_service()
    items = svc.store.list(limit)
    running = [{"id": j.id, "document_name": j.name, "status": j.status} for j in svc.jobs.values()
               if j.status in ("queued", "running") and not j.private]
    return {"items": items, "running": running}


def _get(audit_id: str):
    if not AUDIT_ID.match(audit_id):
        raise HTTPException(404, "Прогон не найден")
    r = get_service().store.get(audit_id)
    if r is None:
        job = get_service().jobs.get(audit_id)
        if job and job.status == "error":
            raise HTTPException(422, job.error)
        if job:
            raise HTTPException(409, "Анализ ещё выполняется")
        raise HTTPException(404, "Прогон не найден")
    return r


@app.get("/api/audits/{audit_id}", dependencies=[Depends(require_read)])
def get_audit(audit_id: str):
    r = _get(audit_id)
    return JSONResponse(json.loads(r.model_dump_json()) | {"summary": summary(r)})


@app.get("/api/audits/{audit_id}/report.{fmt}", dependencies=[Depends(require_read)])
def report(audit_id: str, fmt: Literal["md", "html", "json", "pdf", "docx", "xlsx"], download: bool = False):
    from fastapi.responses import Response

    from ..report.export import MIME, render as export_render

    r = _get(audit_id)
    base = re.sub(r"[^\w\-]+", "_", Path(r.passport.document_name).stem)[:60] or "report"
    fname = f"lumen_audit_{base}_{r.id}.{fmt}"
    headers = {"content-disposition": f'attachment; filename="{fname}"'} if download else {}
    if fmt in MIME:
        if fmt != "pdf":
            headers = {"content-disposition": f'attachment; filename="{fname}"'}
        try:
            return Response(export_render(r, fmt), media_type=MIME[fmt], headers=headers)
        except Exception:
            log.exception("report export failed: %s %s", audit_id, fmt)
            raise HTTPException(500, f"Не удалось сформировать {fmt.upper()}. Скачайте HTML или Markdown.") from None
    if fmt == "md":
        return PlainTextResponse(render_markdown(r), media_type="text/markdown; charset=utf-8", headers=headers)
    if fmt == "html":
        return HTMLResponse(render_html(r), headers=headers)
    return JSONResponse(json.loads(r.model_dump_json()), headers=headers)


class QuestionPatch(BaseModel):
    status: Optional[Literal["open", "clarified", "rejected"]] = None
    answer: Optional[str] = None


def require_editor(audit_id: str, request: Request) -> None:
    """Answers change readiness, so only the author of the audit (edit key from the upload response) or an admin."""
    if is_admin(request) or edit_key_ok(audit_id, request.headers.get("x-edit-key")):
        return
    raise HTTPException(403, "Отвечать на вопросы может автор проверки (с этого браузера) или администратор")


@app.patch("/api/audits/{audit_id}/questions/{qid}", dependencies=[Depends(require_editor)])
def patch_question(audit_id: str, qid: str, body: QuestionPatch):
    if body.answer is not None and len(body.answer) > 4000:
        raise HTTPException(422, "Ответ длиннее 4000 символов")
    try:
        r = get_service().update_question(audit_id, qid, body.status, body.answer)
    except KeyError:
        raise HTTPException(404, "Вопрос или прогон не найден") from None
    q = next(x for x in r.questions if x.id == qid)
    return {"question": q.model_dump(), "scores": r.scores.model_dump(), "readiness": r.readiness,
            "readiness_reason": r.readiness_reason}


@app.delete("/api/audits/{audit_id}", dependencies=[Depends(require_admin)])
def delete_audit(audit_id: str):
    get_service().jobs.pop(audit_id, None)
    return {"deleted": get_service().store.delete(audit_id)}


@app.get("/api/compare", dependencies=[Depends(require_read)])
def compare_audits(base: str, new: str):
    from ..compare import compare

    a, b = _get(base), _get(new)
    return compare(a, b)


@app.post("/api/translate", dependencies=[Depends(require_run), Depends(limit_audits)])
async def translate(file: UploadFile = File(...), target: str = Form(...)):
    from fastapi.concurrency import run_in_threadpool

    from ..llm.client import LLMError
    from ..parsing.loader import DocumentError
    from ..translate import LANGS, translate_document

    if target not in LANGS:
        raise HTTPException(422, "Язык перевода: ru, kk или en")
    name = Path(file.filename or "document").name
    if Path(name).suffix.lower() not in SUPPORTED:
        raise HTTPException(415, "Формат не поддерживается")
    data = await file.read(MAX_UPLOAD + 1)
    try:
        validate_upload(name, data)
    except UploadRejected as e:
        raise HTTPException(422, str(e)) from None
    import uuid as _uuid

    svc = get_service()
    path = svc.uploads / f"tr_{_uuid.uuid4().hex}_{safe_filename(name)}"
    path.write_bytes(data)
    try:
        tr = await run_in_threadpool(translate_document, path, target, display_name=name, cfg=svc.cfg)
    except (LLMError, DocumentError, ValueError) as e:
        raise HTTPException(422, str(e)) from None
    finally:
        path.unlink(missing_ok=True)
    return {"source_name": tr.source_name, "target": tr.target, "markdown": tr.markdown, "chunks": tr.chunks,
            "model": tr.model, "provider": tr.provider, "source_text": tr.source_text, "overlay": tr.overlay,
            "warnings": tr.warnings}


class DocxBody(BaseModel):
    markdown: str
    title: str = ""


class GenerateBody(BaseModel):
    idea: str
    lang: str = "ru"


@app.post("/api/generate", dependencies=[Depends(require_run)])
async def generate(body: GenerateBody, request: Request):
    """LÜMEN Author: a spec draft from a short idea, in the bank template, with gaps marked «[уточнить]»."""
    from fastapi.concurrency import run_in_threadpool

    from ..generate import generate_spec
    from ..llm.client import LLMError

    if not 10 <= len(body.idea.strip()) <= 4000:
        raise HTTPException(422, "Опишите идею: от 10 до 4000 символов")
    _support_limit(request, "generate", 20)
    try:
        res = await run_in_threadpool(generate_spec, body.idea, body.lang)
    except LLMError as e:
        raise HTTPException(503, f"Модель ИИ сейчас недоступна, попробуйте через минуту ({str(e)[:120]})") from None
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    return {"title": res.title, "markdown": res.markdown}


@app.post("/api/translate/docx", dependencies=[Depends(require_run)])
def translate_docx(body: DocxBody):
    from fastapi.responses import Response

    from ..report.export import MIME
    from ..translate import markdown_to_docx

    if len(body.markdown) > 1_000_000:
        raise HTTPException(413, "Слишком большой текст")
    return Response(markdown_to_docx(body.markdown, body.title), media_type=MIME["docx"],
                    headers={"content-disposition": 'attachment; filename="lumen_translation.docx"'})


@app.get("/api/criteria")
def criteria():
    from ..engine.criteria import REQUIREMENT_CRITERIA, SET_CRITERIA
    from ..engine.fintech import ASPECTS

    return {
        "requirement": [{"key": k, "name": v[0], "ref": v[1], "definition": v[2], "basis": v[3]} for k, v in REQUIREMENT_CRITERIA.items()],
        "set": [{"key": k, "name": v[0], "ref": v[1], "definition": v[2], "basis": v[3]} for k, v in SET_CRITERIA.items()],
        "fintech": [{"key": k, "name": n} for k, n, _ in ASPECTS],
    }


# ---------------------------------------------------------------- frontend (built React app)
if WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):  # unknown API routes are JSON 404, not the HTML app
            raise HTTPException(404, "Метод API не найден")
        target = WEB_DIST / path
        if path and target.is_file() and WEB_DIST in target.resolve().parents:
            return FileResponse(target)
        return FileResponse(WEB_DIST / "index.html")
else:
    @app.get("/", include_in_schema=False)
    def root():
        return {"product": PRODUCT_NAME, "docs": "/docs", "hint": "Соберите dashboard: cd web && npm i && npm run build"}
