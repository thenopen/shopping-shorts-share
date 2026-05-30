"""공유 텍스트에서 도우인 URL 추출.

도우인 "공유" 누르면 잡소리+해시태그+URL이 섞인 텍스트가 복사됨. 예:
  4.64 L@w.fO ... 春夏纯欲水光肌... # NANbeauty https://v.douyin.com/yNTN8V35B9g/ 复制此链接...

이 텍스트를 통째로 붙여넣어도 URL만 뽑아낸다.
"""
import re

# 도우인 단축/풀 URL 모두 매칭
DOUYIN_RE = re.compile(
    r"https?://(?:"
    r"v\.douyin\.com/[\w\-]+"            # 단축: v.douyin.com/xxxx
    r"|(?:www\.)?douyin\.com/video/\d+"  # 풀: douyin.com/video/123
    r"|(?:www\.)?iesdouyin\.com/[\w\-/]+"
    r")/?",
    re.IGNORECASE,
)
# 일반 URL (유튜브 등 다른 플랫폼도 허용)
ANY_URL_RE = re.compile(r"https?://[^\s]+", re.IGNORECASE)


def extract_url(text: str) -> str | None:
    """공유 텍스트에서 첫 도우인 URL 추출. 없으면 일반 URL.

    >>> extract_url("4.64 ... https://v.douyin.com/yNTN8V35B9g/ 复制此链接")
    'https://v.douyin.com/yNTN8V35B9g/'
    """
    if not text:
        return None
    m = DOUYIN_RE.search(text)
    if m:
        return m.group(0)
    m = ANY_URL_RE.search(text)
    if m:
        # 끝의 구두점/중국어 제거
        return m.group(0).rstrip(".,。，、")
    return None


if __name__ == "__main__":
    sample = ("4.64 L@w.fO BGi:/ :4pm 08/18 春夏纯欲水光肌这不是手拿把掐了！"
              "# NANbeauty# 高光# 水光腮红 https://v.douyin.com/yNTN8V35B9g/ "
              "复制此链接，打开Dou音搜索，直接观看视频！")
    print(extract_url(sample))
