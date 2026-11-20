"""Public KJV-ish routes for STEP and the private pronunciation archive."""
from hmac import compare_digest, digest
from ipaddress import ip_address, ip_network
import base64
import json
from pathlib import Path
import re
import sqlite3
import threading
import time
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener

ROOT = Path(__file__).resolve().parents[1]
MODULES = frozenset(json.loads((ROOT / "reader/library.json").read_text()))
EDITIONS = frozenset(("KJVish", "KJV", "BSB"))
ORIGINALS = frozenset(("THOT", "SBLG_th"))
STRONG = re.compile(r"[HG]\d{4,5}[A-Za-z]*")
CLIP = re.compile(r"(?:(?:hebrew/h|greek/g)-[a-f0-9]{20}|word-forms/(?:Gen|John)/[a-f0-9]{24})\.mp3")
PER_CLIENT_LIMITS = ((60, 24), (600, 120), (86400, 450))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def step_route(path):
    parts = [unquote(part, errors="strict") for part in path.split("/")]
    if len(parts) < 4 or parts[:2] != ["", "rest"]:
        return None
    controller, method, *args = parts[2:]
    if any(len(arg) > 256 or any(c in arg for c in "/\\%?#\x00\r\n") or arg in {".", ".."} for arg in args):
        return None
    command = (controller, method)
    match command, args:
        case ("module", "getAllModules"), []:
            pass
        case ("module", "getInfo"), [edition, ref, tags, topic, "en"] if edition in EDITIONS | ORIGINALS and topic == " ":
            if not tags.split() or any(not re.fullmatch(r"[HG]\d{1,5}[A-Za-z]*", tag) for tag in tags.split()):
                return None
        case ("bible", "getBibleBookNames"), [name, edition] if edition in EDITIONS:
            pass
        case ("bible", "getKeyInfo" | "convertReferenceForBook"), [ref, first, second] if first in EDITIONS and second in EDITIONS:
            pass
        case ("bible", "getBibleText"), [edition, ref, "VN"] if edition in MODULES - EDITIONS - ORIGINALS:
            pass
        case ("bible", "getBibleText"), [edition, ref, "VNHUG"] if edition in EDITIONS | ORIGINALS:
            pass
        case ("bible", "getBibleText"), [edition, ref, "VNHUG", original, "INTERLEAVED"] if edition in EDITIONS and original in ORIGINALS:
            pass
        case ("search", "masterSearch"), [query]:
            match_query = re.fullmatch(r"version=([A-Za-z]+)\|text=([^|]+)", query)
            if not match_query or match_query[1] not in EDITIONS:
                return None
        case _:
            return None
    return "/".join(quote(part, safe="") for part in parts)


class Pronunciations:
    def __init__(self, config_path):
        data = json.loads(config_path.read_text())
        self.directory = Path(data["audioDirectory"]).resolve()
        self.hostname = data["cdnHostname"]
        self.signing_key = data["signingKey"].encode()
        self.origin_key = data["originKey"]
        if not re.fullmatch(r"kjvish-[a-z0-9-]+\.b-cdn\.net", self.hostname) or len(self.signing_key) < 16 or len(self.origin_key) < 32:
            raise ValueError("Invalid audio delivery configuration")
        self.lookup = {}
        self.by_base = {}
        self.forms = {}
        for language, edition in (("hebrew", "eleven-v4-erez"), ("greek", "eleven-v4-eleni")):
            folder = self.directory / language / edition
            entries = json.loads((folder / "index.json").read_text())["entries"]
            self.lookup.update({ident: f"{language}/{entry['file']}" for ident, entry in entries.items()})
            aliases = folder / "aliases.json"
            if aliases.exists():
                for ident, alias in json.loads(aliases.read_text())["entries"].items():
                    if alias["target"] in self.lookup:
                        self.lookup.setdefault(ident, self.lookup[alias["target"]])
        for ident, path in self.lookup.items():
            base = re.match(r"[HG]\d+", ident)[0]
            self.by_base.setdefault(base, path)
            if self.by_base[base] != path:
                self.by_base[base] = None
        for book, language in (("Gen", "hebrew"), ("John", "greek")):
            entries = self.directory / "word-forms/eleven-v4-turbo" / book / "index.json"
            self.forms[book] = {
                form: f"{language}/{entry['headwordFile']}" if "headwordFile" in entry else f"word-forms/{book}/{entry['file']}"
                for form, entry in json.loads(entries.read_text())["forms"].items()
            }
        self.clips = frozenset(self.lookup.values()) | frozenset(clip for book in self.forms.values() for clip in book.values())
        self.db = config_path.with_name("audio-limits.sqlite3")
        with sqlite3.connect(self.db) as db:
            db.execute("CREATE TABLE IF NOT EXISTS plays (client TEXT NOT NULL, played INTEGER NOT NULL)")
            db.execute("CREATE INDEX IF NOT EXISTS client_plays ON plays (client, played)")
            db.execute("CREATE INDEX IF NOT EXISTS play_expiration ON plays (played)")
        self.last_purge = 0
        self.lock = threading.Lock()

    def grant(self, client):
        now = int(time.time())
        with self.lock, sqlite3.connect(self.db, isolation_level="IMMEDIATE") as db:
            if now - self.last_purge >= 3600:
                db.execute("DELETE FROM plays WHERE played <= ?", (now - 86400,))
                self.last_purge = now
            timestamps = [row[0] for row in db.execute("SELECT played FROM plays WHERE client = ? AND played > ?", (client, now - 86400))]
            if any(sum(played > now - window for played in timestamps) >= maximum for window, maximum in PER_CLIENT_LIMITS):
                return False
            db.execute("INSERT INTO plays VALUES (?, ?)", (client, now))
        return True

    def resolve(self, query):
        tags = query.get("tags", [""])[0].split()
        book = query.get("book", [""])[0]
        form = unicodedata.normalize("NFC", query.get("form", [""])[0])
        if book in self.forms and form in self.forms[book]:
            return self.forms[book][form]
        if len(tags) > 12 or any(not STRONG.fullmatch(tag) for tag in tags):
            return None
        for tag in tags:
            clip = self.lookup.get(tag) or self.by_base.get(tag)
            if clip:
                return clip
        return None

    def signed_url(self, clip):
        path = "/" + clip
        expires = int(time.time()) + 45
        signed = digest(self.signing_key, f"{path}{expires}".encode(), "sha256")
        token = "HS256-" + base64.urlsafe_b64encode(signed).decode().rstrip("=")
        return f"https://{self.hostname}{path}?token={token}&expires={expires}"

    def origin_file(self, clip):
        if clip not in self.clips or not CLIP.fullmatch(clip):
            return None
        first, *parts = clip.split("/")
        version = {"hebrew": "eleven-v4-erez", "greek": "eleven-v4-eleni", "word-forms": "eleven-v4-turbo"}[first]
        return self.directory.joinpath(first, version, *parts)


class ReaderRoutes:
    def __init__(self, engine_port, audio_config):
        self.engine = f"http://127.0.0.1:{engine_port}"
        self.backend = build_opener(ProxyHandler({}), NoRedirect())
        self.concurrent_requests = threading.BoundedSemaphore(12)
        self.audio = Pronunciations(audio_config) if audio_config and audio_config.is_file() else None

    def dispatch(self, handler, url):
        if url.path == "/listen":
            return self.listen(handler, url.query)
        if url.path.startswith("/_audio-origin/"):
            return self.origin(handler, url.path.removeprefix("/_audio-origin/"))
        if not url.path.startswith("/rest/"):
            return False
        try:
            path = step_route(url.path) if not url.query else None
        except UnicodeError:
            path = None
        if path is None:
            handler.send_error(404)
        elif not self.concurrent_requests.acquire(blocking=False):
            handler.send_error(503)
        else:
            try:
                with self.backend.open(self.engine + path, timeout=18) as response:
                    data = response.read(5_000_001)
                if len(data) > 5_000_000:
                    handler.send_error(413)
                else:
                    if path == "/rest/module/getAllModules":
                        data = json.dumps([module for module in json.loads(data) if module.get("initials") in MODULES]).encode()
                    handler.send_bytes(data, "application/json; charset=utf-8", cache="no-store")
            except (HTTPError, URLError, TimeoutError, ValueError):
                handler.send_error(502)
            finally:
                self.concurrent_requests.release()
        return True

    def listen(self, handler, query):
        if not self.audio or len(query) > 2048:
            handler.send_error(404)
            return True
        try:
            args = parse_qs(query, max_num_fields=3, strict_parsing=True)
            if args.keys() - {"tags", "form", "book"} or any(len(value) != 1 for value in args.values()):
                raise ValueError("Bad audio request")
            ip = ip_address(handler.headers.get("CF-Connecting-IP", handler.client_address[0]))
        except ValueError:
            handler.send_error(400)
            return True
        clip = self.audio.resolve(args)
        if not clip or not CLIP.fullmatch(clip):
            handler.send_error(404)
            return True
        client = str(ip_network(f"{ip}/64", strict=False)) if ip.version == 6 else str(ip)
        if not self.audio.grant(client):
            handler.send_response(429)
            handler.send_header("Retry-After", "60")
            handler.send_header("Cache-Control", "no-store")
            handler.send_header("Content-Length", "0")
            handler.end_headers()
            return True
        handler.send_response(302)
        handler.send_header("Location", self.audio.signed_url(clip))
        handler.send_header("Cache-Control", "no-store")
        handler.send_header("Content-Length", "0")
        handler.end_headers()
        return True

    def origin(self, handler, clip):
        valid = self.audio and compare_digest(handler.headers.get("X-KJVish-Origin", "").encode(), self.audio.origin_key.encode())
        source = self.audio.origin_file(clip) if valid else None
        if not source or not source.is_file():
            handler.send_error(404)
            return True
        handler.send_bytes(source.read_bytes(), "audio/mpeg", cache="public, max-age=86400",
                           extra={"Cloudflare-CDN-Cache-Control": "no-store"})
        return True
