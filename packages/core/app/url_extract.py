"""Extract usable video URLs from pasted share text."""

import re

DOUYIN_RE = re.compile(
    r"https?://(?:"
    r"v\.douyin\.com/[\w\-]+"
    r"|(?:www\.)?douyin\.com/video/\d+"
    r"|(?:www\.)?iesdouyin\.com/[\w\-/]+"
    r")/?",
    re.IGNORECASE,
)

ANY_URL_RE = re.compile(r"https?://[^\s]+", re.IGNORECASE)


def extract_url(text: str) -> str | None:
    if not text:
        return None
    m = DOUYIN_RE.search(text)
    if m:
        return _clean_url(m.group(0))
    m = ANY_URL_RE.search(text)
    if m:
        return _clean_url(m.group(0))
    return None


def _clean_url(url: str) -> str:
    return url.rstrip(".,;!?)]}>'\"")
