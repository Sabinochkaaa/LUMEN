"""LÜMEN security layer: upload validation, rate limiting, security headers, token checks, encryption at rest.

* Encryption at rest — AES-256-GCM (authenticated encryption) for stored audit results (local files and Supabase),
  key from LUMEN_ENCRYPTION_KEY (base64 32 bytes or any passphrase → scrypt).
* Uploads are validated by content (magic bytes), not by extension; DOCX zip bombs and oversized PDFs/images are refused.
* Sliding-window rate limits per client IP (API) and per chat (Telegram bot).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import os
import threading
import time
import zipfile
from collections import defaultdict, deque
from typing import Optional

MAX_UPLOAD = 20 * 1024 * 1024
MAX_DOCX_UNCOMPRESSED = 150 * 1024 * 1024
MAX_PDF_PAGES = 400
MAX_IMAGE_PIXELS = 40_000_000
ENC_PREFIX = b"LUMENENC1:"


class UploadRejected(ValueError):
    """User-facing upload rejection (Russian message)."""


# ------------------------------------------------------------------ tokens
def token_ok(given: Optional[str], expected: str) -> bool:
    if not expected:
        return True
    return bool(given) and hmac.compare_digest(given.encode(), expected.encode())


# ------------------------------------------------------------------ upload validation
def validate_upload(name: str, data: bytes) -> None:
    ext = os.path.splitext(name)[1].lower()
    if len(data) > MAX_UPLOAD:
        raise UploadRejected("Файл больше 20 МБ.")
    if not data.strip():
        raise UploadRejected("Файл пуст.")
    head = data[:16]
    if data[:2] == b"MZ" or data[:4] in (b"\x7fELF", b"\xca\xfe\xba\xbe") or data[:2] == b"#!":
        raise UploadRejected("Исполняемые файлы и скрипты не принимаются.")
    if ext == ".pdf":
        if b"%PDF-" not in data[:1024]:
            raise UploadRejected("Файл называется .pdf, но не является PDF.")
        try:
            import pymupdf  # type: ignore

            with pymupdf.open(stream=data, filetype="pdf") as d:
                if d.page_count > MAX_PDF_PAGES:
                    raise UploadRejected(f"PDF длиннее {MAX_PDF_PAGES} страниц — разделите документ.")
        except UploadRejected:
            raise
        except Exception:
            pass  # unreadable PDFs get a precise message from the parser
    elif ext == ".docx":
        if head[:2] != b"PK":
            raise UploadRejected("Файл называется .docx, но не является документом Word.")
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                names = z.namelist()
                if "word/document.xml" not in names:
                    raise UploadRejected("В DOCX нет основного документа (word/document.xml).")
                total = sum(i.file_size for i in z.infolist())
                if total > MAX_DOCX_UNCOMPRESSED or len(names) > 5000:
                    raise UploadRejected("DOCX подозрительно велик после распаковки (возможна zip-бомба).")
                if any(n.lower().endswith(("vbaproject.bin",)) for n in names):
                    raise UploadRejected("Документы с макросами не принимаются.")
        except zipfile.BadZipFile:
            raise UploadRejected("DOCX повреждён.") from None
    elif ext == ".rtf":
        if not data.lstrip()[:5] == b"{\\rtf":
            raise UploadRejected("Файл называется .rtf, но не является RTF.")
    elif ext in (".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"):
        sigs = (b"\x89PNG", b"\xff\xd8\xff", b"RIFF", b"II*\x00", b"MM\x00*", b"BM")
        if not any(head.startswith(s) for s in sigs):
            raise UploadRejected("Файл не похож на изображение.")
        try:
            from PIL import Image  # type: ignore

            Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
            with Image.open(io.BytesIO(data)) as im:
                if im.width * im.height > MAX_IMAGE_PIXELS:
                    raise UploadRejected("Изображение слишком большое.")
        except UploadRejected:
            raise
        except Exception:
            raise UploadRejected("Изображение повреждено или слишком большое.") from None
    elif ext in (".md", ".markdown", ".txt", ".html", ".htm"):
        if b"\x00" in data[:4096]:
            raise UploadRejected("Текстовый файл содержит двоичные данные.")


# ------------------------------------------------------------------ rate limiting
class RateLimiter:
    def __init__(self):
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window_s: int) -> tuple[bool, int]:
        """Returns (allowed, retry_after_seconds)."""
        if limit <= 0:
            return True, 0
        now = time.time()
        with self._lock:
            q = self._hits[key]
            while q and q[0] <= now - window_s:
                q.popleft()
            if len(q) >= limit:
                return False, int(q[0] + window_s - now) + 1
            q.append(now)
            if len(self._hits) > 50_000:  # memory guard
                for k in list(self._hits)[:10_000]:
                    if not self._hits[k]:
                        del self._hits[k]
            return True, 0


limiter = RateLimiter()


def client_ip(headers, fallback: str = "unknown") -> str:
    fwd = headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return headers.get("x-real-ip") or fallback


# ------------------------------------------------------------------ security headers
SPA_CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
           "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; "
           "frame-ancestors 'none'")
REPORT_CSP = ("default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; "
              "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
DOCS_CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://fastapi.tiangolo.com; "
            "frame-ancestors 'none'")


def security_headers(path: str, https: bool) -> dict[str, str]:
    h = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
        "Cross-Origin-Opener-Policy": "same-origin",
    }
    if https:
        h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    if path.endswith("/report.html"):
        h["Content-Security-Policy"] = REPORT_CSP
    elif path.startswith(("/docs", "/redoc", "/openapi.json")):
        h["Content-Security-Policy"] = DOCS_CSP
    else:
        h["Content-Security-Policy"] = SPA_CSP
    if path.startswith("/api/"):
        h["Cache-Control"] = "no-store"
    return h


# ------------------------------------------------------------------ encryption at rest (AES-256-GCM)
class Cipher:
    def __init__(self, secret: str):
        self.key = self._derive(secret)

    @staticmethod
    def _derive(secret: str) -> bytes:
        try:
            raw = base64.urlsafe_b64decode(secret + "=" * (-len(secret) % 4))
            if len(raw) == 32:
                return raw
        except Exception:
            pass
        return hashlib.scrypt(secret.encode(), salt=b"lumen-at-rest-v1", n=2 ** 14, r=8, p=1, dklen=32)

    def encrypt(self, plaintext: bytes) -> bytes:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        nonce = os.urandom(12)
        return nonce + AESGCM(self.key).encrypt(nonce, plaintext, b"lumen")

    def decrypt(self, blob: bytes) -> bytes:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        return AESGCM(self.key).decrypt(blob[:12], blob[12:], b"lumen")

    # text-safe wrappers
    def seal(self, text: str) -> str:
        return base64.b64encode(self.encrypt(text.encode("utf-8"))).decode()

    def open(self, token: str) -> str:
        return self.decrypt(base64.b64decode(token)).decode("utf-8")


def make_cipher(secret: str) -> Optional[Cipher]:
    return Cipher(secret) if secret else None


def new_key() -> str:
    return base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")


def dumps_sealed(cipher: Optional[Cipher], payload: str) -> bytes:
    return ENC_PREFIX + cipher.seal(payload).encode() if cipher else payload.encode("utf-8")


def loads_sealed(cipher: Optional[Cipher], blob: bytes) -> str:
    if blob.startswith(ENC_PREFIX):
        if not cipher:
            raise RuntimeError("Данные зашифрованы, но LUMEN_ENCRYPTION_KEY не задан.")
        return cipher.open(blob[len(ENC_PREFIX):].decode())
    return blob.decode("utf-8")


def sealed_json(cipher: Optional[Cipher], payload: str) -> dict:
    return {"enc": "aes-256-gcm-v1", "data": cipher.seal(payload)} if cipher else json.loads(payload)


def open_json(cipher: Optional[Cipher], obj: dict) -> str:
    if isinstance(obj, dict) and obj.get("enc") == "aes-256-gcm-v1":
        if not cipher:
            raise RuntimeError("Данные зашифрованы, но LUMEN_ENCRYPTION_KEY не задан.")
        return cipher.open(obj["data"])
    return json.dumps(obj, ensure_ascii=False)


# ------------------------------------------------------------------ admin sessions (signed, HttpOnly cookie)
SESSION_COOKIE = "lumen_session"
SESSION_TTL = 12 * 3600


def _session_key(secret: str) -> bytes:
    return hashlib.sha256(b"lumen-session-v1|" + secret.encode()).digest()


def make_session(secret: str, ttl: int = SESSION_TTL) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"r": "admin", "exp": int(time.time()) + ttl}).encode()).decode().rstrip("=")
    sig = hmac.new(_session_key(secret), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def check_session(secret: str, token: Optional[str]) -> bool:
    if not secret or not token or "." not in token:
        return False
    payload, sig = token.rsplit(".", 1)
    good = hmac.new(_session_key(secret), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, good):
        return False
    try:
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except Exception:
        return False
    return data.get("r") == "admin" and int(data.get("exp", 0)) > time.time()
