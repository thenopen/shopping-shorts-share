"""[4] 얼굴 전체샷 컷 제거.

요구사항: 사람 얼굴이 화면에 크게 잡힌 구간을 잘라내고,
제품샷 위주의 구간만 남겨 재연결한다.
(원본 인물이 그대로 드러나는 걸 피하려는 목적)

전략:
  1. mediapipe(또는 opencv haar)로 프레임별 얼굴 탐지
  2. 얼굴 bounding box가 화면대비 일정 비율(예: 25%) 이상이면 "전체샷"으로 판정
  3. 전체샷이 연속된 시간구간을 "잘라낼 구간"으로 묶음
  4. 남길 구간들만 ffmpeg로 잘라 이어붙임 (concat)

주의:
- 너무 많이 자르면 영상이 짧아짐 → 최소 길이 보장 로직 필요
- 컷 경계 자연스럽게 (장면전환 지점 우선)

난이도: 상.
"""
from pathlib import Path


def detect_face_segments(video_path: Path, face_ratio_threshold: float = 0.25):
    """얼굴이 크게 잡힌 시간구간 리스트 반환.

    Returns: [(start_sec, end_sec), ...]  ← 잘라낼 구간

    TODO: mediapipe face_detection으로 프레임 순회.
    TODO: 비율 임계값 튜닝.
    """
    raise NotImplementedError("Phase 2에서 구현")


def cut_face_segments(video_path: Path, out_path: Path,
                      face_ratio_threshold: float = 0.25,
                      min_output_sec: float = 5.0) -> Path:
    """얼굴 전체샷 구간을 제거하고 나머지를 이어붙인다.

    흐름:
      1. detect_face_segments로 잘라낼 구간 파악
      2. '남길 구간' = 전체길이 - 잘라낼구간
      3. ffmpeg trim + concat으로 재조립
      4. 결과가 min_output_sec보다 짧으면 컷 완화

    TODO: ffmpeg concat demuxer 또는 filter_complex.
    """
    raise NotImplementedError("Phase 2에서 구현")
