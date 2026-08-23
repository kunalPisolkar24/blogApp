import re
from html.parser import HTMLParser

_HIDDEN_TAGS = ("script", "style", "iframe", "noscript")


class _TextExtractor(HTMLParser):
    """Collects text content, skipping script/style/iframe/noscript blocks."""

    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []
        self._hidden = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in _HIDDEN_TAGS:
            self._hidden += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in _HIDDEN_TAGS and self._hidden:
            self._hidden -= 1

    def handle_data(self, data: str) -> None:
        if not self._hidden:
            self._parts.append(data)


def _collapse_whitespace(text: str) -> str:
    return " ".join(text.split())


def clean_html(html_text: str) -> str:
    """Extract plain text from HTML, dropping scripts, styles, and markup."""
    if not html_text.strip():
        return ""
    extractor = _TextExtractor()
    extractor.feed(html_text)
    return _collapse_whitespace(" ".join(extractor._parts))


_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(.+?)\s*```", re.DOTALL)


def extract_json(raw: str) -> str:
    """Strip markdown code fences around a JSON response."""
    match = _JSON_FENCE_RE.search(raw)
    return match.group(1).strip() if match else raw.strip()
