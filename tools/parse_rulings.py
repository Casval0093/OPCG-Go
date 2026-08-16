#!/usr/bin/env python3
"""Parse the official Simplified Chinese Q&A PDFs into machine-readable rulings.

These are the SC-official rulings documents from onepiece-cardgame.cn. They are the
*specification* for card-effect edge cases: what a threshold means, which of two
simultaneous effects resolves first, whether a keyword applies to one clause or both.
Anything encoding OP15/OP16 effects should consult them before choosing a DSL primitive.

Two rulings found on the first read, both of which change an encoding:

  OP16-001 Ace   the "8000 power or more" qualifier binds to BOTH the Monkey.D.Luffy
                 clause and the Whitebeard Pirates clause. A 7000-power Whitebeard
                 Character does NOT gain [Rush]. The English text is ambiguous here.
  OP16-002/003   "a Character card with 8000 power" means EXACTLY 8000 — not 7000 or
                 less, not 9000 or more. That is `eq`, not `gte`.

Usage:
    python3 tools/parse_rulings.py --check              # has anything been republished?
    python3 tools/parse_rulings.py --fetch              # download current PDFs and rebuild
    python3 tools/parse_rulings.py ~/Downloads/*QA*.pdf # build from local files
    python3 tools/parse_rulings.py --card OP16-001      # read back one card's rulings

Acquisition is automated and does NOT need a browser. `onepiece-cardgame.cn/rules` is a
JavaScript SPA whose HTML is an empty shell, but it is backed by a plain JSON API, and the
PDFs sit on an ordinary static host:

    list:  https://webadmin.windoent.com/op-public/rules/rulesinfo/webList
    pdfs:  https://source.windoent.com/OnePiecePc/Pdf/...

The list carries `updateTime` per document, which is what `--check` compares against the
`sources` block of the last build. That is the hook for detecting an OPC17 QA when OP17
lands — a new or restamped document shows up there before anyone notices it on the page.

Requires pypdf. The PDFs carry a real text layer, so no OCR is involved.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import os
import re
import ssl
import sys
import urllib.parse
import urllib.request

API_URL = "https://webadmin.windoent.com/op-public/rules/rulesinfo/webList"
CACHE_DIR = "data/qa-cache"

# The four PDFs use three different table schemas. Detect and dispatch rather than
# forcing one regex, which silently yielded 0 rulings for two of the four files.
#
#   A  booster / starter    <seq> <CARDID> <name> <type> <effect> <Q> <A>
#   B  basic rules          <seq> <major> <minor> <CARDID|全部> <Q> <A>
#   C  promotion cards      <P-NNN> <name> <type> <effect> <Q> <A>   (no seq)
ENTRY_RE = re.compile(r"(?m)^[ \t]*(\d{1,4})[ \t]+((?:OP|ST|EB|PRB)\d{2}-\d{3})[ \t]+")
RULES_RE = re.compile(
    r"(?m)^[ \t]*(\d{1,4})[ \t]+(\S+)[ \t]+(\S+)[ \t]+(全部|(?:OP|ST|EB|PRB)\d{2}-\d{3}|P-\d{3})[ \t]+"
)
PROMO_RE = re.compile(r"(?m)^[ \t]*(P-\d{3})[ \t]+")
CARD_ID_RE = re.compile(r"\b(?:(?:OP|ST|EB|PRB)\d{2}-\d{3}|P-\d{3})\b")

# card_id for rulings that bind to the rules themselves rather than to a printing.
GENERAL = "GENERAL"

DEFAULT_OUT = "data/rulings-sc.json"


def _ssl_context() -> ssl.SSLContext:
    """python.org macOS builds ship without root certs; fall back to certifi if present."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def _get(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "OPCG-Go/1.0", "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as resp:
        return resp.read()


def api_list() -> list[dict]:
    """Current rules documents, newest metadata straight from the site's own API."""
    payload = json.loads(_get(API_URL).decode("utf-8"))
    if payload.get("code") != 0:
        sys.exit(f"rules API returned code={payload.get('code')} msg={payload.get('msg')!r}")
    return [
        {"name": d["name"], "pdf_url": d["pdfUrl"], "update_time": d.get("updateTime", "")}
        for d in payload.get("list", [])
        if d.get("pdfUrl")
    ]


def load_prior_sources(out_path: str) -> dict[str, dict]:
    if not os.path.exists(out_path):
        return {}
    try:
        doc = json.load(open(out_path, encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {s["name"]: s for s in doc.get("sources", []) if isinstance(s, dict) and "name" in s}


def check(out_path: str) -> int:
    """Compare the live list against the last build. Exit 1 if anything changed."""
    live = api_list()
    prior = load_prior_sources(out_path)
    changed = []
    for doc in live:
        was = prior.get(doc["name"])
        if was is None:
            changed.append((doc, "NEW DOCUMENT"))
        elif was.get("update_time") != doc["update_time"]:
            changed.append((doc, f"republished ({was.get('update_time')} -> {doc['update_time']})"))
    for doc in live:
        print(f"  {doc['name']:<20} {doc['update_time']}")
    missing = sorted(set(prior) - {d["name"] for d in live})
    if missing:
        print(f"\nno longer listed: {', '.join(missing)}")
    if not changed:
        print("\nno changes since the last build")
        return 0
    print("\nCHANGED:")
    for doc, why in changed:
        print(f"  {doc['name']} — {why}")
    print(f"\nrebuild with: python3 {sys.argv[0]} --fetch -o {out_path}")
    return 1


def fetch(cache_dir: str) -> tuple[list[str], list[dict]]:
    """Download every current PDF into the cache. Returns (paths, source metadata)."""
    os.makedirs(cache_dir, exist_ok=True)
    paths, sources = [], []
    for doc in api_list():
        fname = os.path.basename(urllib.parse.unquote(urllib.parse.urlparse(doc["pdf_url"]).path))
        dest = os.path.join(cache_dir, fname)
        blob = _get(doc["pdf_url"])
        with open(dest, "wb") as fh:
            fh.write(blob)
        digest = hashlib.sha256(blob).hexdigest()
        print(f"  {doc['name']:<20} {doc['update_time']}  {len(blob) / 1024:>7.0f} KB  {digest[:12]}")
        paths.append(dest)
        sources.append({**doc, "file": fname, "sha256": digest})
    return paths, sources


def extract_text(pdf_path: str) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        sys.exit("pypdf is required: ./.venv/bin/pip install pypdf")
    reader = PdfReader(pdf_path)
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def normalize(text: str) -> str:
    """Collapse the layout noise PDF extraction leaves behind.

    The source is CJK, where a space between characters is layout, not language.
    A space between a CJK character and an ASCII digit/letter is dropped too — the
    PDFs render "力量为 8000" and "OP15-119 蒙奇" with spacing that is purely visual.
    """
    text = text.replace("　", " ")
    text = re.sub(r"[ \t]*\n[ \t]*", "\n", text)
    text = re.sub(r"(?<=[一-鿿])[ \t]+(?=[一-鿿])", "", text)
    text = re.sub(r"(?<=[一-鿿])[ \t]+(?=[0-9A-Za-z])", "", text)
    text = re.sub(r"(?<=[0-9A-Za-z])[ \t]+(?=[一-鿿])", "", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text


def _slice_bodies(text: str, matches: list[re.Match]) -> list[str]:
    """Each entry's body runs from its header to the start of the next header."""
    out = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        out.append(normalize(text[m.end() : end]).strip())
    return out


def _entry(card_id: str, body: str, source: str, **extra) -> dict:
    # Cards referenced in the body other than the subject — the interaction partners.
    related = sorted({c for c in CARD_ID_RE.findall(body) if c != card_id})
    return {
        "card_id": card_id,
        "set": card_id[:4] if card_id not in (GENERAL,) else GENERAL,
        "text": body,
        "related_cards": related,
        "source": source,
        **extra,
    }


def parse(text: str, source: str) -> list[dict]:
    """Detect which of the three table schemas this document uses, then split it."""
    per_card = list(ENTRY_RE.finditer(text))
    rules = list(RULES_RE.finditer(text))
    promo = list(PROMO_RE.finditer(text))

    # Schema B's header also satisfies schema A's pattern in principle, so prefer
    # whichever matched more — a document is one schema, not a blend.
    if per_card and len(per_card) >= len(rules):
        return [
            _entry(m.group(2), body, source, seq=int(m.group(1)))
            for m, body in zip(per_card, _slice_bodies(text, per_card))
        ]

    if rules:
        entries = []
        for m, body in zip(rules, _slice_bodies(text, rules)):
            subject = m.group(4)
            entries.append(
                _entry(
                    GENERAL if subject == "全部" else subject,
                    body,
                    source,
                    seq=int(m.group(1)),
                    category=m.group(2),
                    subcategory=m.group(3),
                )
            )
        return entries

    if promo:
        return [
            _entry(m.group(1), body, source)
            for m, body in zip(promo, _slice_bodies(text, promo))
        ]

    return []


def build(pdf_paths: list[str], out_path: str, sources: list[dict] | None = None) -> dict:
    all_entries: list[dict] = []
    for path in pdf_paths:
        raw = extract_text(path)
        found = parse(raw, os.path.basename(path))
        all_entries.extend(found)
        print(f"  {os.path.basename(path)[:44]:<46} {len(found):>5} rulings")

    by_card: dict[str, list[dict]] = collections.defaultdict(list)
    for e in all_entries:
        by_card[e["card_id"]].append(e)

    doc = {
        "_note": (
            "Official Simplified Chinese Q&A, parsed from the PDFs on onepiece-cardgame.cn. "
            "These are rulings, i.e. the specification for effect edge cases. Consult before "
            "encoding a card's effects. Text is verbatim SC; no translation is applied."
        ),
        # When built via --fetch this carries each document's updateTime and sha256, which is
        # what --check diffs against to notice a republished or newly added QA.
        "sources": sources
        if sources
        else [{"name": os.path.basename(p), "file": os.path.basename(p)} for p in sorted(pdf_paths)],
        "ruling_count": len(all_entries),
        "cards_covered": len(by_card),
        "by_card": {k: by_card[k] for k in sorted(by_card)},
    }
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
    return doc


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdfs", nargs="*", help="Q&A PDF paths (omit when using --fetch)")
    ap.add_argument("-o", "--out", default=DEFAULT_OUT)
    ap.add_argument("--card", help="print the stored rulings for one card ID and exit")
    ap.add_argument(
        "--check",
        action="store_true",
        help="ask the official API whether any QA was republished; exit 1 if so",
    )
    ap.add_argument("--fetch", action="store_true", help="download the current PDFs, then rebuild")
    ap.add_argument("--cache-dir", default=CACHE_DIR, help="where --fetch stores PDFs")
    args = ap.parse_args()

    if args.check:
        print("official SC rules documents:")
        sys.exit(check(args.out))

    if args.card:
        if not os.path.exists(args.out):
            sys.exit(f"{args.out} not found — build it first by passing the PDF paths")
        doc = json.load(open(args.out, encoding="utf-8"))
        rulings = doc["by_card"].get(args.card.upper())
        if not rulings:
            print(f"no rulings for {args.card.upper()}")
            return
        for r in rulings:
            print(f"--- #{r['seq']} ({r['source']}) ---\n{r['text']}\n")
        return

    sources = None
    pdfs = args.pdfs
    if args.fetch:
        print("downloading current PDFs:")
        pdfs, sources = fetch(args.cache_dir)
        print()
    elif not pdfs:
        ap.error("pass PDF paths, or --fetch to download them, or --card to read back")

    print("parsing:")
    doc = build(pdfs, args.out, sources)
    counts = collections.Counter(c[:4] for c in doc["by_card"])
    print(f"\n{doc['ruling_count']} rulings over {doc['cards_covered']} cards -> {args.out}")
    focus = {s: counts.get(s, 0) for s in ("OP15", "OP16", "OP17")}
    print(f"sets being encoded: {focus}")


if __name__ == "__main__":
    main()
