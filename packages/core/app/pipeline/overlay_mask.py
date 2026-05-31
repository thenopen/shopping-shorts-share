"""도우인 고정 UI 오버레이 영역 마스크.

도우인 앱 UI는 화면상 위치가 거의 고정(우측 버튼열, 좌하단 아이디/음표,
상단 탭/검색). OCR로 글자 없는 로고·아이콘·하트버튼은 못 잡으므로,
플랫폼별 알려진 고정영역을 해상도 비례 박스로 미리 덮어 inpaint.

좌표 = 9:16 세로영상 기준 비율(0~1). (rx, ry, rw, rh).
실제 영상 W,H 곱해 픽셀 박스로 변환.

NOTE: 도우인 워터마크/UI가 없는 클린 소스(직접 추출본)면 마스크가
사람·배경을 덮을 수 있음 → enabled 플래그로 끄거나 보수적 영역만 사용.
"""
from __future__ import annotations

# 도우인 세로영상(9:16) UI 고정영역 비율. 보수적으로 가장자리만 잡음.
# (사람은 보통 화면 중앙. 가장자리 오버레이만 덮어 본체 손상 방지.)
DOUYIN_REGIONS: list[tuple[float, float, float, float]] = [
    # 우측 버튼열 (프로필/하트/댓글/공유/음반 회전판) — 우측 가장자리 세로 중하단
    (0.86, 0.42, 0.14, 0.46),
    # 좌하단 아이디/캡션/음표 라인 — 좌하단 (자막보다 더 아래·왼쪽)
    (0.0, 0.80, 0.70, 0.14),
    # 상단 좌측 '팔로잉/추천' 탭 + 검색 아이콘 영역
    (0.0, 0.0, 1.0, 0.07),
]

# 알려진 워터마크(떠다니는 아이디 음표) — 위치 가변이라 OCR/로고검출에 맡기고
# 여기선 포함 안 함. 고정영역만.

PLATFORM_REGIONS = {
    "douyin": DOUYIN_REGIONS,
    "tiktok": DOUYIN_REGIONS,  # 레이아웃 거의 동일
}


def fixed_overlay_boxes(
    width: int,
    height: int,
    platform: str = "douyin",
    enabled: bool = True,
) -> list[tuple[int, int, int, int]]:
    """플랫폼 고정 UI 영역을 (x, y, w, h) 픽셀 박스 리스트로 반환.

    enabled=False면 빈 리스트(클린 소스용 — 마스크가 본체 덮는 것 방지).
    """
    if not enabled:
        return []
    regions = PLATFORM_REGIONS.get(platform)
    if not regions:
        return []
    boxes = []
    for rx, ry, rw, rh in regions:
        x = int(rx * width)
        y = int(ry * height)
        w = int(rw * width)
        h = int(rh * height)
        x = max(0, min(x, width - 2))
        y = max(0, min(y, height - 2))
        w = max(1, min(w, width - x))
        h = max(1, min(h, height - y))
        boxes.append((x, y, w, h))
    return boxes
