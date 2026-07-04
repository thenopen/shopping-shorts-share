"""판단/폴백 과정 디버그 로거 — 여러 파이프라인이 공유.

sink(list)에 사람이 읽을 메시지를 쌓아 응답/job에 실어 웹 F12 콘솔에 노출하고,
동시에 서버 stdout에도 flush 출력(worker print는 버퍼링돼 안 보이므로 flush 필수).
"""

from __future__ import annotations

from typing import Callable


def make_dbg(sink: list | None = None, tag: str = "") -> Callable[[str], None]:
    prefix = f"[{tag}] " if tag else ""

    def _dbg(msg: str) -> None:
        if sink is not None:
            sink.append(msg)
        print(f"{prefix}{msg}", flush=True)

    return _dbg
