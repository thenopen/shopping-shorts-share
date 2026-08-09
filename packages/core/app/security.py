"""경로 보안 공용 가드 — 파일 서빙 엔드포인트의 path traversal 통일 방어.

과거에는 /file, /overlays/asset, overlays.resolve_file 세 곳이 각자 다른 가드를 썼다
(정규식 화이트리스트 / 부분문자열 ".." 검사 / resolve+is_relative_to 만). 여기선 하나의
safe_path()로 통일: 세그먼트 화이트리스트 + ".." 차단 + is_relative_to 이중 검증.

is_relative_to가 최종 방어선이지만, 세그먼트 정규식이 먼저 명백한 악성 입력
(URL 인코딩 %2e%2e, 절대경로, 제어문자)을 걸러 디스크 resolve 자체를 피한다.
"""
from __future__ import annotations

import re
from pathlib import Path

# 파일명 세그먼트 화이트리스트 — 유니코드 글자(한글 성우명 등) 허용,
# 경로 구분자(/ \)·공백·제어문자 불허. ".." 는 별도로도 차단.
SAFE_SEG = re.compile(r"^[^\s/\\\x00-\x1f]+$")


def safe_path(base: Path, *segments: str, must_exist: bool = True) -> Path | None:
    """base 아래의 안전한 경로를 반환. 탈출/비정상 세그먼트면 None.

    각 segment를 SAFE_SEG 로 검사하고 ".." 를 배제한 뒤, 최종 resolved 경로가
    base 아래인지(is_relative_to) 이중 검증한다. must_exist=True(기본)면 존재까지 확인.

    빈 세그먼트는 무시(중간 슬래시 대응). 어느 하나라도 정규식 불통/포함 ".." 이면 즉시 None.
    """
    for s in segments:
        if s is None:
            return None
        if not SAFE_SEG.match(s) or ".." in s:
            return None
    base_r = base.resolve()
    try:
        resolved = base_r.joinpath(*[s for s in segments if s]).resolve()
        inside = resolved.is_relative_to(base_r)
    except (OSError, ValueError):
        return None
    if not inside:
        return None
    if must_exist and not resolved.exists():
        return None
    return resolved
