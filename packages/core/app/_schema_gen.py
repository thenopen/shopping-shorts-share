"""공유 JSON 스키마 생성 로직(import 가능 모듈).

scripts/gen-schema.py(실행 스크립트)와 tests/test_schema_sync.py(정합성 테스트)가
공유. 하이픈이 있는 스크립트 파일명은 import 불가능하므로 로직을 이 모듈에 두고,
양쪽에서 import 한다.

하이브리드 스키마 = Pydantic 모델 뼈대(자동) + META(enum/description/constraint, 수동) +
JOB_STATE_SCHEMA(응답 상태 필드). 새 enum/constraint 가 코드에 추가되면 META 도 갱신.
"""
from __future__ import annotations

import json
from pathlib import Path

from app.server_api import (
    AnalyzeReq, CaptionEditReq, CaptionPreviewReq, LibraryLoadReq,
    PreviewUrlReq, ProductScriptReq, QualityReq, RefineMetricReq,
    RefineReq, RenderReq, TranscribeReq,
)
from app.voices import VOICES

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent   # app/ → core/ → packages/ → root
OUT_PATH = REPO_ROOT / "shared" / "schema" / "job.schema.json"

# codegen 대상 Pydantic 모델 — 엔드포인트 요청 바디들.
MODELS = {
    "AnalyzeReq": AnalyzeReq,
    "TranscribeReq": TranscribeReq,
    "RefineReq": RefineReq,
    "RenderReq": RenderReq,
    "CaptionPreviewReq": CaptionPreviewReq,
    "CaptionEditReq": CaptionEditReq,
    "ProductScriptReq": ProductScriptReq,
    "RefineMetricReq": RefineMetricReq,
    "QualityReq": QualityReq,
    "PreviewUrlReq": PreviewUrlReq,
    "LibraryLoadReq": LibraryLoadReq,
}

# ── 수동 메타데이터(하이브리드의 '수동' 부분) ──────────────────────────────
# Pydantic 베어 타입은 enum/description/constraint 를 못 내므로 여기서 보강.
# 새 enum/constraint 가 코드에 추가되면 이 dict 도 갱신.
ENUMS = {
    "engine": ["typecast", "elevenlabs", "google"],
    "emotion": ["smart", "happy", "sad", "angry", "whisper", "toneup", "tonedown", "normal"],
    "cta": ["comment", "profile", "link"],
    "subtitle_backend": ["modal", "local"],
    "status": [
        "queued", "downloading", "removing_subtitle", "waiting_gpu",
        "analyzed", "transcribing", "transcribed",
        "dubbing", "captioning", "composing", "overlaying",
        "done", "error",
    ],
    "subtitle_engine": ["propainter_modal", "propainter_local", "lama", "lama_fallback", "cached", "none"],
}

CONSTRAINTS = {
    "speaking_rate": {"minimum": 0.5, "maximum": 2.0},
    "emotion_intensity": {"minimum": 0, "maximum": 2},
    "cta_size": {"minimum": 16, "maximum": 120},
    "cta_pos": {"minimum": 0, "maximum": 1},
    "progress": {"minimum": 0, "maximum": 100},
}

DESCRIPTIONS = {
    "id": "작업 ID(uuid.uuid4().hex[:8])",
    "url": "원본 영상 링크(도우인/틱톡/일반)",
    "script": "한국어 대본(빈 값=원음 유지/무음)",
    "engine": "TTS 엔진. 기본 typecast.",
    "voice": "엔진별 voice_id. 빈 값=엔진 기본. 닉네임 기반 google 경로는 voices.py 23개 사용.",
    "speaking_rate": "TTS 배속(1.0=보통).",
    "emotion": "Typecast 감정 프리셋. smart=문맥 자동.",
    "emotion_intensity": "감정 강도(0~2).",
    "tts_opts": "엔진별 고급 옵션. elevenlabs: stability/similarity/style, google: pitch.",
    "subtitle_backend": "자막·워터마크 제거 백엔드. modal=클라우드(기본), local=로컬 GPU(ALLOW_LOCAL_GPU=1 필요).",
    "reuse_nosub": "캐시된 자막제거본 재사용(False=강제 재처리).",
    "reuse_script": "캐시된 대본 재사용(False=강제 재생성).",
    "subtitle_engine": "실제 자막제거에 쓰인 엔진(응답 전용).",
    "cta": "CTA 문구 프리셋. 사전 정의 외 문자열이면 그 텍스트 그대로 사용.",
    "cta_on": "CTA 자막 넣기/빼기.",
    "cta_size": "CTA 글자 크기(px).",
    "cta_pos": "CTA 세로 위치(0=위~1=아래).",
    "captions": "TTS 대본 자동자막 on/off.",
    "caption_style": "자막 기본 스타일(웹 CaptionStyle dict).",
    "caption_lines": "타임라인 편집기서 수정한 자막 줄들. 있으면 자동생성 대신 이걸 burn.",
    "overlays": "오버레이(말풍선·스티커·트랜지션) 목록.",
    "status": "작업 상태. waiting_gpu=GPU 대기. analyzed/transcribed=단계 완료(이어하기 가능).",
    "progress": "현재 단계 기준 0~100(전체 파이프라인 아님).",
    "stage": "현재 단계 표시용 한글 문구.",
    "preview": "분석 중간 결과 영상 URL.",
    "output": "최종 영상 URL.",
    "output_dur": "최종 영상 실측 길이(초).",
    "has_speech": "대본에 의미 있는 음성이 있는지(4자 이상).",
    "error": "오류 메시지(status=error 일 때).",
    "created": "생성 시각(unix epoch).",
    "reused": "라이브러리 캐시 재사용 여부.",
    "meta": "부가 메타(url/title/source/transcribe 진단 등).",
}

# 응답/상태 전용 필드(Pydantic 요청 모델엔 없음) — job dict(_new_job)이 갖는 필드들.
JOB_STATE_SCHEMA = {
    "id": {"type": "string"},
    "status": {"type": "string"},
    "progress": {"type": "integer"},
    "stage": {"type": "string"},
    "preview": {"type": ["string", "null"]},
    "output": {"type": ["string", "null"]},
    "output_dur": {"type": ["number", "null"]},
    "has_speech": {"type": ["boolean", "null"]},
    "error": {"type": ["string", "null"]},
    "created": {"type": "number"},
    "reused": {"type": "boolean"},
    "meta": {"type": "object"},
}


def _model_props(model_cls) -> dict:
    """Pydantic model_json_schema() → properties 만 추출."""
    sch = model_cls.model_json_schema()
    return sch.get("properties", {})


def _apply_meta(props: dict) -> dict:
    """Pydantic 뼈대 properties 에 enum/description/constraint 보강."""
    out = {}
    for name, prop in props.items():
        p = dict(prop)
        p.pop("title", None)   # Pydantic 자동 title("Job Id" 등) 노이즈 제거
        if name in ENUMS:
            p["enum"] = ENUMS[name]
        if name in DESCRIPTIONS:
            p["description"] = DESCRIPTIONS[name]
        if name in CONSTRAINTS:
            p.update(CONSTRAINTS[name])
        out[name] = p
    return out


def build_schema() -> dict:
    """하이브리드 스키마 빌드 — codegen 핵심 로직(test_schema_sync 가 재사용)."""
    defs = {}
    for name, cls in MODELS.items():
        defs[name] = {"type": "object", "properties": _apply_meta(_model_props(cls))}

    job_props = {}
    for name, prop in JOB_STATE_SCHEMA.items():
        p = dict(prop)
        if name in DESCRIPTIONS:
            p["description"] = DESCRIPTIONS[name]
        if name in ENUMS:
            p["enum"] = ENUMS[name]
        if name in CONSTRAINTS:
            p.update(CONSTRAINTS[name])
        job_props[name] = p
    # 핵심 요청 필드(url/script/engine/voice 등)도 Job 에 포함(공유 식별용).
    for fld in ("url", "script", "engine", "voice", "speaking_rate", "emotion",
                "cta", "subtitle_backend", "subtitle_engine"):
        job_props[fld] = _apply_meta({fld: _model_props(RenderReq).get(fld) or
                                      _model_props(AnalyzeReq).get(fld) or {"type": "string"}})[fld]

    female = [n for n, v in VOICES.items() if v.gender == "F"]
    male = [n for n, v in VOICES.items() if v.gender == "M"]

    return {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "$comment": ("AUTO-GENERATED by scripts/gen-schema.py — 수동 수정 금지. "
                     "진실 소스 = packages/core/app/server_api.py Pydantic 모델 + app/voices.py. "
                     "코드 변경 후 python scripts/gen-schema.py 재실행."),
        "title": "ShortsJob",
        "description": "쇼츠 변환 작업 요청/상태. 웹·데스크톱·서버·core 공유. 요청 모델별 스키마는 $defs 참조.",
        "type": "object",
        "properties": job_props,
        "required": ["id", "status"],
        "$defs": defs,
        "definitions": {
            "voice_nicknames_google_chirp3hd": {
                "$comment": "app/voices.py 의 23개 voice(진실 소스). 스키마 생성 시 자동 추출.",
                "female": female,
                "male": male,
                "total": len(VOICES),
            },
        },
    }


def write_schema() -> Path:
    """스키마 빌드 + 디스크에 쓰기. gen-schema.py 스크립트가 호출."""
    schema = build_schema()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(schema, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return OUT_PATH
