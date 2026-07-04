"""한국어 TTS 입력 정규화 — 숫자·금액·단위·기호를 '읽는 형태'로 치환.

TTS 엔진(Chirp3-HD/Edge)이 자주 틀리는 것 교정:
  - 분류사 앞 고유어 수사: 3개→"세 개"(✗삼 개), 2병→"두 병", 25살→"스물다섯 살"
  - 마케팅 표기: 1+1→"원 플러스 원", 2+1→"투 플러스 원"
  - 단위 철자읽기 방지: 500g→"오백 그램"(✗오백 지), 1.5L→"일 점 오 리터"
  - 금액/일반 수: 25,900원→"이만오천구백 원"

주의: **오디오 합성 입력에만** 적용한다. 자막 텍스트엔 쓰지 말 것
(화면=대본 원문 "3개" 유지, 소리만 "세 개"). caption의 단어정렬이 이를 전제로 동작.
Chirp3-HD·edge-tts 둘 다 SSML을 못 받으므로 이 텍스트 정규화가 발음 교정의 유일한 레버다.
"""
import re

# ── 한자어(Sino) 수 ─────────────────────────────────────────────
_SINO = ["영", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"]
_BIG = ["", "만", "억", "조", "경"]


def _sino_under_10000(n: int) -> str:
    """1..9999 → 한자어(예: 5900→오천구백). 자리값 1은 일십/일백/일천에서 '일' 생략."""
    r = ""
    for place, unit in ((1000, "천"), (100, "백"), (10, "십"), (1, "")):
        d = (n // place) % 10
        if d == 0:
            continue
        r += (unit if d == 1 and place != 1 else _SINO[d] + unit)
    return r


def sino(n: int) -> str:
    """정수 → 한자어 수사(가격·단위·날짜용). '만' 자리 값 1은 '만'(일만 아님)."""
    if n == 0:
        return "영"
    neg = n < 0
    n = abs(n)
    groups = []
    while n > 0:
        groups.append(n % 10000)
        n //= 10000
    out = ""
    for gi in range(len(groups) - 1, -1, -1):
        g = groups[gi]
        if g == 0:
            continue
        gs = "" if (gi == 1 and g == 1) else _sino_under_10000(g)  # 일만→만
        out += gs + _BIG[gi]
    return ("마이너스 " + out) if neg else out


# ── 고유어(Native) 수 — 분류사 앞 관형형 ───────────────────────────
_NAT_ONES = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉"]
_NAT_TENS = ["", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"]


def native_attr(n: int):
    """분류사 앞 고유어 관형형(1..99). 범위 밖이면 None(→한자어 사용). 20 단독=스무."""
    if n < 1 or n > 99:
        return None
    t, o = divmod(n, 10)
    tens = "스무" if (t == 2 and o == 0) else _NAT_TENS[t]
    return tens + _NAT_ONES[o]


# ── 계량 단위(숫자 뒤 알파벳/기호) — 철자읽기 방지 ─────────────────
# 순서 중요: 긴 토큰 먼저(kcal 전에 k/cal 안 잡히게). 정규식에서 alternation 순서로 처리.
_UNITS = [
    ("kcal", "킬로칼로리"), ("km", "킬로미터"), ("kg", "킬로그램"),
    ("mm", "밀리미터"), ("cm", "센티미터"), ("ml", "밀리리터"), ("mL", "밀리리터"),
    ("GB", "기가바이트"), ("MB", "메가바이트"), ("TB", "테라바이트"), ("Hz", "헤르츠"),
    ("g", "그램"), ("L", "리터"), ("W", "와트"), ("V", "볼트"),
]
_UNIT_MAP = dict(_UNITS)

# 고유어로 읽는 분류사(숫자 1..99일 때) — 쇼핑에서 흔하고 모호성 낮은 것만.
# 제외: 분(시간)/배(과일·倍)/대(세대) 등 한자어와 충돌 큰 것.
_NATIVE_COUNTERS = ("개", "명", "살", "마리", "병", "잔", "켤레", "벌", "판",
                    "봉지", "통", "갑", "송이", "권", "그루", "자루", "판",
                    "가지", "군데", "대", "채", "조각", "줄", "그릇", "컵")

# 1+1 등에서 숫자 영어식 읽기(마케팅 관용: "원 플러스 원")
_ENG = {"1": "원", "2": "투", "3": "쓰리", "4": "포", "5": "파이브"}


def _read_number(s: str) -> str:
    """콤마/소수 포함 숫자 문자열 → 한자어(예: '1,500'→천오백, '1.5'→일 점 오)."""
    s = s.replace(",", "")
    if "." in s:
        ip, fp = s.split(".", 1)
        head = sino(int(ip)) if ip else "영"
        return head + " 점 " + " ".join(_SINO[int(d)] for d in fp if d.isdigit())
    return sino(int(s))


def _read_counter(n: int, counter: str) -> str:
    nat = native_attr(n)          # 1..99만 고유어, 그 외 None→한자어
    return (nat if nat else sino(n)) + " " + counter


def _eng_digit(d: str) -> str:
    return _ENG.get(d, sino(int(d)))


def normalize_ko_reading(text: str) -> str:
    """숫자·금액·단위·기호를 한국어로 읽히도록 치환한 텍스트(오디오 합성 입력용)."""
    if not text:
        return text
    t = text
    # 1) 1+1 / 2+1 (마케팅) — 다른 숫자 처리보다 먼저
    t = re.sub(r"(\d)\s*\+\s*(\d)",
               lambda m: f"{_eng_digit(m.group(1))} 플러스 {_eng_digit(m.group(2))}", t)
    # 2) 퍼센트
    t = re.sub(r"(\d+(?:\.\d+)?)\s*%", lambda m: _read_number(m.group(1)) + " 퍼센트", t)
    # 3) 단위 알파벳(숫자 뒤) → 한자어 수 + 한글 단위.
    # 뒤에 '영문자'만 오면 제외(500grams의 g 오탐 방지). 한글 조사(1.5kg인데)는 허용.
    unit_pat = "|".join(re.escape(u) for u, _ in _UNITS)
    t = re.sub(r"(\d+(?:\.\d+)?)\s*(" + unit_pat + r")(?![A-Za-z])",
               lambda m: _read_number(m.group(1)) + " " + _UNIT_MAP[m.group(2)], t)
    # 4) 숫자 + 고유어 분류사(1..99 고유어, 그 외 한자어).
    # 뒤에 조사(도/는/을…)는 허용하되, 복합단위 만드는 음절(개월/개국/개년/개소)만 차단.
    cnt_pat = "|".join(sorted(set(_NATIVE_COUNTERS), key=len, reverse=True))
    t = re.sub(r"(\d{1,3})\s*(" + cnt_pat + r")(?![월년국소])",
               lambda m: _read_counter(int(m.group(1)), m.group(2)), t)
    # 5) 금액(원)
    t = re.sub(r"(\d[\d,]*(?:\.\d+)?)\s*원",
               lambda m: _read_number(m.group(1)) + " 원", t)
    # 6) 남은 일반 숫자(콤마·소수 포함) → 한자어
    t = re.sub(r"\d[\d,]*(?:\.\d+)?", lambda m: _read_number(m.group(0)), t)
    return t
