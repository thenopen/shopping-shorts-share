"""스키마-코드 정합성 테스트 — shared/schema/job.schema.json 이 코드와 동기화됐는지 검증.

과거 스키마는 코드 어디서도 참조되지 않아 "거짓 계약"이었음(2026-08-09 재분석 발견).
이제 gen-schema.py 가 코드에서 스키마를 자동 생성하므로, 이 테스트가
"스키마를 재생성 안 하고 코드를 바꿨다"는 회귀를 잡음.

실패 시: python scripts/gen-schema.py 재실행 후 커밋.
"""
import json
from pathlib import Path

from app._schema_gen import build_schema, ENUMS, OUT_PATH

SCHEMA_PATH = OUT_PATH


def test_schema_file_exists_and_valid_json():
    """스키마 파일 존재 + 유효 JSON."""
    assert SCHEMA_PATH.exists(), f"스키마 파일 없음: {SCHEMA_PATH}"
    data = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    assert data.get("title") == "ShortsJob"
    assert "properties" in data


def test_schema_in_sync_with_code():
    """디스크의 스키마가 build_schema() 결과와 일치하는지.

    코드(Pydantic 모델/voices.py)를 바꾸고 스키마 재생성을 까먹으면 여기서 실패.
    """
    expected = build_schema()
    actual = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    if expected != actual:
        exp_props = set(expected.get("properties", {}).keys())
        act_props = set(actual.get("properties", {}).keys())
        diff_added = exp_props - act_props
        diff_removed = act_props - exp_props
        msg = ["스키마가 코드와 동기화되지 않음 — `python scripts/gen-schema.py` 재실행 후 커밋."]
        if diff_added:
            msg.append(f"코드엔 있고 스키마엔 없는 필드: {sorted(diff_added)}")
        if diff_removed:
            msg.append(f"스키마엔 있고 코드엔 없는 필드: {sorted(diff_removed)}")
        if not diff_added and not diff_removed:
            msg.append("필드 구성은 같으나 값(default/enum/description 등)이 다름.")
        msg.append(f"$defs 모델 수: 기대 {len(expected.get('$defs', {}))}, "
                   f"실제 {len(actual.get('$defs', {}))}")
        assert False, "\n".join(msg)


def test_schema_voice_definitions_match_code():
    """스키마의 voice 23개 정의가 app/voices.py 와 일치하는지."""
    from app.voices import VOICES

    data = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    voice_def = data.get("definitions", {}).get("voice_nicknames_google_chirp3hd", {})
    assert voice_def.get("total") == len(VOICES), f"voice 총 수 불일치: 스키마 {voice_def.get('total')} vs 코드 {len(VOICES)}"

    expected = build_schema()["definitions"]["voice_nicknames_google_chirp3hd"]
    assert set(voice_def.get("female", [])) == set(expected["female"]), "여성 voice 목록 불일치"
    assert set(voice_def.get("male", [])) == set(expected["male"]), "남성 voice 목록 불일치"


def test_schema_render_req_has_all_fields():
    """$defs.RenderReq 가 코드의 RenderReq 필드 전부를 커버하는지."""
    from app.server_api import RenderReq
    data = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    render_def = data.get("$defs", {}).get("RenderReq", {})
    schema_fields = set(render_def.get("properties", {}).keys())
    code_fields = set(RenderReq.model_fields.keys())
    missing = code_fields - schema_fields
    assert not missing, f"RenderReq 필드가 스키마에 누락: {sorted(missing)} — python scripts/gen-schema.py 재실행"


def test_schema_enums_present():
    """핵심 enum(engine/emotion/cta/status)이 스키마에 반영됐는지."""
    data = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    status_prop = data["properties"].get("status", {})
    assert "enum" in status_prop, "status enum 누락"
    assert "waiting_gpu" in status_prop["enum"], "status enum 에 waiting_gpu 없음(회귀)"
    engine_prop = data["$defs"]["RenderReq"]["properties"].get("engine", {})
    assert "enum" in engine_prop, "engine enum 누락"
    assert engine_prop["enum"] == ENUMS["engine"]

