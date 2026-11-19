#!/usr/bin/env python3
"""Build the KJV-ish text, find an edit span, or count exact wording."""
import argparse
from collections import Counter, defaultdict
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import re
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "sources"
EXPORT = ROOT / "text/kjv-ish.tsv"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def read_akjv():
    source = read_json(SOURCES / "akjv-1999.json")
    canon = read_json(SOURCES / "verse-keys.json")
    archive_bytes = (SOURCES / "akj.zip").read_bytes()
    if sha256(archive_bytes).hexdigest() != source["sha256"]:
        raise ValueError("The plain AKJV archive differs from the pinned source.")
    with ZipFile(BytesIO(archive_bytes)) as archive:
        plain = archive.read(source["file"]).decode("utf-8-sig")

    books = {entry["source"]: entry["osis"] for entry in canon}
    observed_books = []
    rows = {}
    book = verse = None
    for line in plain.splitlines():
        line = line.strip()
        if not line:
            continue
        header = re.fullmatch(r"\[([A-Za-z0-9 ]+)\]\s+.+", line)
        verse_line = re.fullmatch(r"(\d+):(\d+)\s+(.+)", line)
        if header:
            book = books[header[1]]
            observed_books.append(book)
            verse = None
        elif verse_line and book:
            chapter, number, text = verse_line.groups()
            verse = f"{book}.{chapter}.{number}"
            if verse in rows:
                raise ValueError(f"Duplicate verse {verse}.")
            rows[verse] = text
        elif verse:
            rows[verse] += " " + line
        else:
            raise ValueError("Unexpected line outside a verse.")

    expected = [
        f"{entry['osis']}.{chapter}.{verse}"
        for entry in canon
        for chapter, last in enumerate(entry["chapterLengths"], 1)
        for verse in range(1, last + 1)
    ]
    if (observed_books != [entry["osis"] for entry in canon]
            or rows.keys() != set(expected) or len(rows) != source["verseCount"]):
        raise ValueError("The AKJV text differs from the pinned verse keys.")
    return source, {verse: rows[verse] for verse in expected}


def apply_edits(verses, manifest, source_sha):
    if manifest["sourceSha256"] != source_sha:
        raise ValueError("The edit file targets a different edition of the AKJV.")
    groups = defaultdict(list)
    for edit in manifest["edits"]:
        verse, start, end, before, after, reviewer = (
            edit[field] for field in ("verse", "start", "end", "before", "after", "approvedBy")
        )
        base = verses.get(verse)
        if (base is None or type(start) is not int or type(end) is not int
                or not isinstance(before, str) or not isinstance(after, str)
                or not isinstance(reviewer, str) or not reviewer.strip()):
            raise ValueError(f"Invalid edit record for {verse}.")
        if (not 0 <= start < end <= len(base) or base[start:end] != before
                or before == after or any(char in after for char in "\t\n\r")):
            raise ValueError(f"Stale or invalid wording in {verse}.")
        groups[verse].append((start, end, after))

    edited = verses.copy()
    for verse, replacements in groups.items():
        base = verses[verse]
        cursor = 0
        parts = []
        for start, end, after in sorted(replacements):
            if start < cursor:
                raise ValueError(f"Overlapping edits in {verse}.")
            parts.extend((base[cursor:start], after))
            cursor = end
        parts.append(base[cursor:])
        edited[verse] = "".join(parts)
        if not edited[verse].strip():
            raise ValueError(f"Edit would leave {verse} empty.")
    return edited


def tsv(headers, rows):
    return "\n".join("\t".join(map(str, row)) for row in (headers, *rows)) + "\n"


def locate(verses, ref, before, after):
    if not before or not before.strip() or before == after:
        raise ValueError("Supply the exact source wording and a different replacement.")
    matches = list(re.finditer(re.escape(before), verses[ref]))
    if len(matches) != 1:
        raise ValueError("Use a longer exact phrase that occurs once in the base verse.")
    start, end = matches[0].span()
    return {"verse": ref, "start": start, "end": end, "before": before, "after": after, "approvedBy": ""}


def read_kjv_books(root, verse_keys):
    comparison = read_json(SOURCES / "kjv-comparison.json")
    manifest = read_json(root / "source/manifest.json")
    raw = (root / "source/kjv-project-gutenberg-10.txt").read_bytes()
    if sha256(raw).hexdigest() != comparison["source_sha256"]:
        raise ValueError("The KJV source differs from the pinned Gutenberg copy.")
    canon = read_json(SOURCES / "verse-keys.json")
    rows = {}
    for entry, book in zip(manifest["contents"], canon, strict=True):
        markdown = (root / entry["file"]).read_text(encoding="utf-8")
        for chapter, verse, text in re.findall(r"^\*\*(\d+):(\d+)\*\* (.+)$", markdown, re.MULTILINE):
            ref = f"{book['osis']}.{chapter}.{verse}"
            if ref in rows:
                raise ValueError(f"Duplicate KJV verse {ref}.")
            rows[ref] = text
    if rows.keys() != verse_keys or len(rows) != comparison["verses"]:
        raise ValueError("The KJV Markdown source has different verse keys.")
    return rows


def profile(verses, term):
    pattern = re.compile(r"(?<!\w)" + re.escape(term) + r"(?!\w)")
    count, verse_count, by_book = 0, 0, Counter()
    for ref, text in verses.items():
        matches = len(pattern.findall(text))
        if matches:
            count += matches
            verse_count += 1
            by_book[ref.split(".", 1)[0]] += matches
    return count, verse_count, by_book


def write_frequencies(akjv, kjv):
    term_rows, book_rows = [], []
    canon = [entry["osis"] for entry in read_json(SOURCES / "verse-keys.json")]
    normalized = [{ref: text.casefold() for ref, text in verses.items()} for verses in (akjv, kjv)]
    for term in read_json(SOURCES / "frequency-terms.json"):
        ak_count, ak_verses, ak_books = profile(normalized[0], term)
        kj_count, kj_verses, kj_books = profile(normalized[1], term)
        peak = max(ak_books.values(), default=0)
        peak_books = ", ".join(book for book in canon if peak and ak_books[book] == peak)
        term_rows.append((term, ak_count, ak_verses, len(ak_books), peak, peak_books,
                          kj_count, kj_verses, len(kj_books)))
        for book in canon:
            if ak_books[book] or kj_books[book]:
                book_rows.append((term, book, ak_books[book], kj_books[book]))
    term_rows.sort(key=lambda row: (-row[1], row[0]))
    fields = ("term", "akjv_occurrences", "akjv_verses", "akjv_books", "akjv_peak_count",
              "akjv_peak_books", "kjv_occurrences", "kjv_verses", "kjv_books")
    (ROOT / "data/frequency.tsv").write_text(tsv(fields, term_rows), encoding="utf-8")
    (ROOT / "data/frequency-by-book.tsv").write_text(
        tsv(("term", "book", "akjv_occurrences", "kjv_occurrences"), book_rows), encoding="utf-8")
    print(f"Wrote frequencies for {len(term_rows)} exact forms.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("build", help="Generate the verse TSV from approved edits.")
    commands.add_parser("check", help="Verify the approved edits and the generated TSV.")
    span = commands.add_parser("span", help="Find the original character span for a proposed edit.")
    span.add_argument("verse", help="Verse reference such as 1Thess.4.15")
    span.add_argument("before", help="Exact text from the pinned AKJV")
    span.add_argument("after", help="Proposed replacement")
    frequencies = commands.add_parser("frequency", help="Rebuild the edition comparison tables.")
    frequencies.add_argument("--kjv-markdown", type=Path, required=True)
    args = parser.parse_args()

    try:
        source, verses = read_akjv()
        if args.command == "span":
            print(json.dumps(locate(verses, args.verse, args.before, args.after), ensure_ascii=False, indent=2))
            return
        if args.command == "frequency":
            write_frequencies(verses, read_kjv_books(args.kjv_markdown, verses.keys()))
            return
        manifest = read_json(ROOT / "approved-edits.json")
        edited = apply_edits(verses, manifest, source["sha256"])
        rendered = tsv(("verse", "text"), edited.items())
        if args.command == "build":
            EXPORT.write_text(rendered, encoding="utf-8")
        elif EXPORT.read_bytes() != rendered.encode("utf-8"):
            raise ValueError("The verse TSV differs from the approved edits. Run build.")
        print(f"Verified {len(edited):,} verses and {len(manifest['edits'])} approved edits.")
    except (ValueError, KeyError, OSError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
