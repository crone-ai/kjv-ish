#!/usr/bin/env python3
"""Build and serve the static KJV-ish site from its Markdown and data."""
import argparse
from dataclasses import dataclass
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
import re
import threading
from urllib.parse import urlsplit, urlunsplit

from markdown_it import MarkdownIt
from public_reader import ReaderRoutes

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://kjvish.com"
REPO = "https://github.com/crone-ai/kjv-ish"
DOCUMENTS = {
    "/about/": ("README.md", "KJV-ish — The Autodidact’s Translation"),
    "/contributing/": ("CONTRIBUTING.md", "Contributing to KJV-ish"),
    "/attribution/": ("NOTICE.md", "KJV-ish license and attribution"),
}
ASSETS = {
    "/": ("reader/index.html", "text/html; charset=utf-8"),
    "/reader/reader.js": ("reader/reader.js", "text/javascript; charset=utf-8"),
    "/reader/reader.css": ("reader/reader.css", "text/css; charset=utf-8"),
    "/reader/type.css": ("reader/type.css", "text/css; charset=utf-8"),
    "/reader/library.json": ("reader/library.json", "application/json"),
    "/reader/commentaries.json": ("reader/commentaries.json", "application/json"),
    "/fonts/NotoSerif-Regular.woff": ("reader/fonts/NotoSerif-Regular.woff", "font/woff"),
    "/fonts/SILEOT.woff": ("reader/fonts/SILEOT.woff", "font/woff"),
    "/simple.min.css": ("site/vendor/simple.min.css", "text/css; charset=utf-8"),
    "/site.css": ("site/site.css", "text/css; charset=utf-8"),
    "/LICENSE": ("LICENSE", "text/plain; charset=utf-8"),
    "/tools/LICENSE": ("tools/LICENSE", "text/plain; charset=utf-8"),
    "/text/kjv-ish.tsv": ("text/kjv-ish.tsv", "text/tab-separated-values; charset=utf-8"),
    "/data/frequency.tsv": ("data/frequency.tsv", "text/tab-separated-values; charset=utf-8"),
    "/data/frequency-by-book.tsv": ("data/frequency-by-book.tsv", "text/tab-separated-values; charset=utf-8"),
    "/approved-edits.json": ("approved-edits.json", "application/json"),
    "/sources/akjv-1999.json": ("sources/akjv-1999.json", "application/json"),
    "/sources/kjv-comparison.json": ("sources/kjv-comparison.json", "application/json"),
}
LOCAL_LINKS = {source: route for route, (source, _) in {**DOCUMENTS, **ASSETS}.items()}
SOURCES = tuple(ROOT / source for source in LOCAL_LINKS)
HTML_TYPE = "text/html; charset=utf-8"


@dataclass(frozen=True)
class Page:
    data: bytes
    media_type: str


def read_public(path):
    source = (ROOT / path).resolve()
    if not source.is_relative_to(ROOT):
        raise ValueError("A site source points outside the checkout.")
    return source.read_bytes()


def public_link(href):
    url = urlsplit(href)
    if url.scheme or url.netloc or not url.path or url.path.startswith("/"):
        return href
    path = PurePosixPath(url.path)
    if ".." in path.parts:
        raise ValueError("A relative site link points outside the checkout.")
    route = LOCAL_LINKS.get(path.as_posix())
    if route is None:
        route = f"{REPO}/blob/main/{path.as_posix()}"
    target = urlsplit(route)
    return urlunsplit((target.scheme, target.netloc, target.path, url.query, url.fragment))


def markdown_body(text):
    parser = MarkdownIt("js-default", {"html": False})
    tokens = parser.parse(text)
    slugs = set()
    for index, token in enumerate(tokens):
        alignment = token.attrs.pop("style", "").removeprefix("text-align:")
        if alignment in {"left", "center", "right"}:
            token.attrJoin("class", f"align-{alignment}")
        if token.type == "heading_open":
            name = tokens[index + 1].content.casefold()
            slug = re.sub(r"[^\w\s-]", "", name)
            slug = re.sub(r"\s+", "-", slug.strip())
            base = slug
            suffix = 1
            while slug in slugs:
                slug = f"{base}-{suffix}"
                suffix += 1
            slugs.add(slug)
            token.attrSet("id", slug)
        for child in token.children or ():
            if child.type == "link_open":
                child.attrSet("href", public_link(child.attrGet("href")))
    return parser.renderer.render(tokens, parser.options, {})


def render(route, title, body):
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="KJV-ish is The Autodidact’s Translation, an English Bible revision based on the American King James Version.">
  <link rel="canonical" href="{SITE}{route}">
  <link rel="stylesheet" href="/simple.min.css">
  <link rel="stylesheet" href="/site.css">
  <title>{escape(title)}</title>
</head>
<body{(' class="home"' if route == "/about/" else '')}>
  <a class="skip-link" href="#content">Skip to content</a>
  <header class="site-header">
    <a class="wordmark" href="/">KJV-ish</a>
    <nav aria-label="Main navigation">
      <a href="/">Reader</a>
      <a href="/contributing/">Contribute</a>
      <a href="{REPO}">GitHub</a>
    </nav>
  </header>
  <main id="content">{body}</main>
  <footer><a href="/attribution/">License and attribution</a> · <a href="{REPO}">Translation repository</a></footer>
</body>
</html>
"""


def build():
    pages = {route: Page(read_public(file), media) for route, (file, media) in ASSETS.items()}
    for route, (file, title) in DOCUMENTS.items():
        body = markdown_body(read_public(file).decode("utf-8"))
        pages[route] = Page(render(route, title, body).encode("utf-8"), HTML_TYPE)
    return pages


def write_static(output, pages):
    for route, page in pages.items():
        path = output / route.lstrip("/")
        if route.endswith("/"):
            path /= "index.html"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(page.data)


def source_versions():
    return tuple(path.stat().st_mtime_ns for path in SOURCES)


class StaticSite(ThreadingHTTPServer):
    def __init__(self, port, engine_port, audio_config):
        self.pages = build()
        self.reader = ReaderRoutes(engine_port, audio_config)
        super().__init__(("127.0.0.1", port), Handler)
        self.stop_watch = threading.Event()
        threading.Thread(target=self.watch, daemon=True).start()

    def watch(self):
        versions = source_versions()
        while not self.stop_watch.wait(2):
            try:
                updated = source_versions()
                if updated != versions:
                    self.pages = build()
                    versions = updated
            except (OSError, ValueError, UnicodeError):
                # Git can briefly replace files during a checkout. Keep the last complete site.
                continue

    def server_close(self):
        if hasattr(self, "stop_watch"):
            self.stop_watch.set()
        super().server_close()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.serve_page()

    def do_HEAD(self):
        self.serve_page()

    def log_message(self, *_):
        pass

    def serve_page(self):
        url = urlsplit(self.path)
        path = url.path
        if self.server.reader.dispatch(self, url):
            return
        if path == "/reader.html":
            self.send_response(308)
            self.send_header("Location", "/")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        page = self.server.pages.get(path)
        if page is None and path + "/" in self.server.pages:
            self.send_response(308)
            self.send_header("Location", path + "/")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if page is None:
            self.send_error(404)
            return
        self.send_bytes(page.data, page.media_type)

    def send_bytes(self, data, media_type, cache="no-cache", extra=None):
        policy = "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        if urlsplit(self.path).path == "/":
            policy += "; script-src 'self'; font-src 'self'; connect-src 'self'; media-src 'self' https://kjvish-audio.b-cdn.net"
        self.send_response(200)
        self.send_header("Content-Type", media_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Content-Security-Policy", policy)
        for name, value in (extra or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if self.command == "GET":
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    offline = commands.add_parser("build")
    offline.add_argument("--out", type=Path, default=ROOT / ".site-build")
    online = commands.add_parser("serve")
    online.add_argument("--port", type=int, default=8993)
    online.add_argument("--engine-port", type=int, default=8994)
    online.add_argument("--audio-config", type=Path, default=ROOT / ".site-runtime/audio.json")
    args = parser.parse_args()
    if args.command == "build":
        write_static(args.out, build())
    else:
        with StaticSite(args.port, args.engine_port, args.audio_config) as server:
            server.serve_forever()


if __name__ == "__main__":
    main()
