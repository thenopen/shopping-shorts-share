#!/usr/bin/env python3
"""공유 JSON 스키마 자동 생성 스크립트(실행 진입점).

핵심 로직은 packages/core/app/_schema_gen.py(import 가능 모듈)에 있고,
이 스크립트는 그걸 호출해 shared/schema/job.schema.json 에 쓰는 얇은 래퍼.

실행: python scripts/gen-schema.py

스키마 = Pydantic 모델 뼈대(자동) + META(enum/description/constraint, 수동) 하이브리드.
새 enum/필드/제약이 코드에 추가되면:
  1) Pydantic 모델 수정(뼈대) — 자동 반영.
  2) enum/description 추가 시 — app/_schema_gen.py 의 ENUMS/DESCRIPTIONS dict 도 갱신(수동).
  3) python scripts/gen-schema.py 재실행 → 커밋.
"""
from __future__ import annotations

import sys
from pathlib import Path

_CORE = Path(__file__).resolve().parent.parent / "packages" / "core"
sys.path.insert(0, str(_CORE))

from app._schema_gen import build_schema, OUT_PATH, MODELS  # noqa: E402
import json  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    schema = build_schema()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(schema, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    vdef = schema["definitions"]["voice_nicknames_google_chirp3hd"]
    print(f"스키마 생성 → {OUT_PATH.relative_to(REPO_ROOT)}")
    print(f"  - $defs 모델: {len(schema['$defs'])}개")
    print(f"  - Job properties: {len(schema['properties'])}개")
    print(f"  - voice 정의: {vdef['total']}개 (여 {len(vdef['female'])} + 남 {len(vdef['male'])})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
