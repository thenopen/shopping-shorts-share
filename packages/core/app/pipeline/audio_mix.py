"""[7] BGM + 효과음 믹싱.

요구사항: 더빙된 TTS 음성 위에 배경음악(BGM)과 효과음(SFX)을 깔기.

소스: assets/bgm/, assets/sfx/ 의 무료 음원.

흐름:
  TTS 음성 (메인) + BGM (낮은 볼륨) + SFX (특정 시점) → ffmpeg amix
  - TTS는 또렷하게 (볼륨 100%)
  - BGM은 배경으로 (볼륨 15~25%), 영상길이에 맞춰 루프/페이드
  - SFX는 특정 타이밍에 1회 (선택)

난이도: 중.

구현(2026-08-09): ffmpeg filter_complex 로 TTS(메인) + BGM(루핑+볼륨+페이드) + SFX(adelay) 를
amix 한 트랙으로 합성. BGM/SFX 둘 다 없으면 no-op(voice 를 out 으로 복사).
실패 시 RuntimeError(stderr 마지막 1500자) — compose.py/burn_captions 패턴과 동일.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

from app.config import FFMPEG


def _ff_path(p: str) -> str:
    """ffmpeg 필터 인자용 경로 이스케이프(윈도우 콜론 회피). compose._ff_path 와 동일."""
    return p.replace("\\", "/").replace(":", "\\:")


def build_mix_args(
    voice_path: Path,
    out_path: Path,
    bgm_path: Path | None = None,
    bgm_volume: float = 0.2,
    sfx: list | None = None,
    duration: float | None = None,
) -> list[str] | None:
    """ffmpeg 인자 리스트 빌드(테스트용 — 실제 실행 안 함).

    반환 None = 믹싱 불필요(voice 만 있음) → 호출측이 no-op(복사) 처리.
    반환 list = ffmpeg 실행 인자(FFMPEG, 입력들, 필터, 출력).
    """
    bgm_path = Path(bgm_path) if bgm_path else None
    has_bgm = bgm_path is not None and bgm_path.exists()
    sfx_list = [(Path(p), float(t)) for p, t in (sfx or []) if Path(p).exists()]
    if not has_bgm and not sfx_list:
        return None   # 믹싱할 것 없음

    args: list[str] = [FFMPEG, "-hide_banner", "-y", "-loglevel", "error"]
    # 입력 0: voice(메인). 입력 1: bgm(루핑). 입력 2..: sfx 들.
    args += ["-i", str(voice_path)]
    if has_bgm:
        # BGM 을 voice 길이만큼 무한 반복(-stream_loop -1 는 입력 *전* 와야 함).
        args = args[:1] + ["-stream_loop", "-1"] + args[1:] + ["-i", str(bgm_path)]
    for sfx_path, _t in sfx_list:
        args += ["-i", str(sfx_path)]

    # filter_complex 구성 — voice[0:a] + bgm(볼륨+페이드) + sfx(adelay) → amix
    parts: list[str] = []
    inputs: list[str] = ["[0:a]"]   # voice 는 그대로
    ai = 1   # bgm/sfx 입력 인덱스(voice=0)
    if has_bgm:
        # 볼륨(15~25%) + 인트로 페이드(0.5s) + 아웃트로 페이드(마지막 0.5s).
        vol = max(0.0, min(1.0, float(bgm_volume)))
        fade_out = f":afade=t=out:st={max(0.0, (duration or 0) - 0.5):.2f}:d=0.5" if duration else ""
        parts.append(f"[{ai}:a]volume={vol:.2f},afade=t=in:st=0:d=0.5{fade_out}[bgm]")
        inputs.append("[bgm]")
        ai += 1
    for sfx_path, t in sfx_list:
        ms = max(0, int(round(t * 1000)))
        parts.append(f"[{ai}:a]adelay={ms}|{ms}[sfx{ai}]")
        inputs.append(f"[sfx{ai}]")
        ai += 1

    n = len(inputs)
    # amix: 입력 수만큼 normalize. duration=first → voice 길이 기준.
    mix_inputs = "".join(inputs)
    parts.append(f"{mix_inputs}amix=inputs={n}:duration=first:normalize=0[out]")
    filter_complex = ";".join(parts)
    args += ["-filter_complex", filter_complex, "-map", "[out]"]
    # 출력 — mp3(voice 가 mp3 라 가정, 기존 파이프라인과 일관).
    args += ["-c:a", "libmp3lame", "-b:a", "128k", str(out_path)]
    return args


def mix_audio(
    voice_path: Path,
    out_path: Path,
    bgm_path: Path | None = None,
    bgm_volume: float = 0.2,
    sfx: list | None = None,        # [(sfx_path, at_sec), ...]
    duration: float | None = None,
) -> Path:
    """TTS 음성 + BGM + 효과음 → 믹싱된 오디오 트랙.

    BGM/SFX 둘 다 없거나 파일이 없으면 voice_path 를 out_path 로 복사(no-op) 후 반환.
    ffmpeg 실패 시 RuntimeError(stderr 마지막 1500자 포함).
    """
    voice_path = Path(voice_path)
    out_path = Path(out_path)
    args = build_mix_args(voice_path, out_path, bgm_path, bgm_volume, sfx, duration)
    if args is None:
        # 믹싱 불필요 — 복사로 마무리(compose 가 이 파일을 쓰도록).
        out_path.parent.mkdir(parents=True, exist_ok=True)
        if voice_path.resolve() != out_path.resolve():
            shutil.copy2(voice_path, out_path)
        return out_path

    out_path.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(args, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(
            f"audio_mix ffmpeg 실패(rc={r.returncode}): {(r.stderr or '')[-1500:]}"
        )
    return out_path
