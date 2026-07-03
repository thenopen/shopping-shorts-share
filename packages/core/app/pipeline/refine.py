"""Gemini and Antigravity script refinement."""

from __future__ import annotations

import os

from app import gemini
from app.gemini import api_key as _api_key, available  # noqa: F401 (재export: 다른 모듈이 refine.available 사용)

MODEL = os.environ.get("GEMINI_REFINE_MODEL", "gemini-2.5-flash-lite")

# 쇼츠 공통 문장 규칙 — 대본이 이후 자막 줄(6~12자 호흡)로 분할되는 걸 전제로 작성.
SHORTS_RULES = """- 쇼츠 자막으로 잘리기 좋게: 한 문장 = 한 메시지, 한 호흡(대략 15자 안쪽)으로 짧게.
- 긴 문장은 둘로 쪼개고, 접속사로 길게 잇지 마라.
- 첫 문장은 3초 안에 시선을 잡는 도입(질문·반전·구체 숫자)."""

# 대본 AI 가공 8방향(8각 다이얼) — 프론트 ScriptStage와 키 동일.
# 각 방향 = 지시 + 잘된 변환 예시(before→after) 1개. 예시가 '잘함'의 기준을 보여준다.
SCRIPT_DIRECTIONS = {
    "hook": """도입부(첫 1~2문장)를 첫 3초에 시선을 강탈하는 훅으로 다시 써라. 본문 의미는 유지.
훅 유형: 질문형·반전형·구체숫자형·손해회피형·공감형 중 내용과 가장 잘 맞는 것.
예시) 전: "오늘은 쿠션 팩트를 소개할게요." → 후: "화장 무너지는 오후 2시, 다들 알죠?\"""",
    "impact": """짧고 강한 문장으로 바꿔라. 군더더기·수식어 제거, 단문 위주 펀치라인. 한 문장 = 한 방.
예시) 전: "이 제품은 흡수가 굉장히 빠르고 끈적임도 별로 없어서 좋아요." → 후: "바르면 3초 컷. 끈적임 제로.\"""",
    "urgency": """지금 봐야 할 이유가 느껴지는 긴박한 톤으로 바꿔라. 단, 원문에 없는 할인·한정수량·마감시한을 지어내지 마라.
'품절되기 전에' 같은 근거 없는 재촉 대신 '환절기 지나면 늦어요'처럼 상황 근거를 써라.
예시) 전: "겨울에 쓰기 좋은 크림이에요." → 후: "벌써 손 트기 시작했죠? 지금 안 챙기면 한 달 내내 고생해요.\"""",
    "humor": """가벼운 위트를 한 스푼 섞어라(과한 드립·유행어 남발 금지). 정보는 그대로.
자기고백·과장된 일상 비유가 안전하다.
예시) 전: "용량이 커서 오래 씁니다." → 후: "이 용량 실화예요? 다 쓰기 전에 계절이 먼저 바뀌어요.\"""",
    "story": """직접 써본 사람의 경험담 흐름(반신반의→써봄→구체 변화)으로 재구성해라. 1인칭.
예시) 전: "보습력이 뛰어난 제품입니다." → 후: "솔직히 반신반의로 샀거든요. 3일 쓰고 알았어요. 아, 이래서 다들 쟁이는구나.\"""",
    "friendly": """친한 친구가 알려주는 톤으로 바꿔라(반말 살짝, 과하지 않게). '~잖아', '~거든' 같은 구어 어미.
예시) 전: "성분이 순해서 민감성 피부에 적합합니다." → 후: "나 예민한 피부잖아. 근데 이건 뒤집어진 적이 없어.\"""",
    "trust": """담백하고 신뢰감 있는 정보 전달 톤으로 바꿔라. 감탄사 줄이고 사실·근거(수치·성분·사용 조건) 중심.
예시) 전: "진짜 대박 촉촉해요!!" → 후: "히알루론산 함량이 높아서, 세안 직후 한 번이면 아침까지 당김이 없어요.\"""",
    "concise": """핵심만 남기고 압축해라. 중복·군더더기 제거, 분량 30% 이상 줄이기. 훅과 핵심 소구 1~2개만 남긴다.
예시) 전: "이 제품은 정말 좋은데요, 왜냐하면 일단 가볍고, 그리고 또 흡수도 빠르고…" → 후: "가볍고, 빨리 스며들어요. 그게 다예요. 근데 그게 어려운 거거든요.\"""",
}

REFINE_PROMPT = """다음은 한국 쇼핑 숏츠용 한국어 대본입니다.
{instruction}

규칙:
- 원래 의미를 최대한 유지
- 원문에 없는 제품 속성, 색감, 효능, 가격, 할인, 수량, 성능 추가 금지
- "무조건 사야 한다", "꼭 사야 한다" 같은 강압/과장 표현 금지
{shorts_rules}
- 결과 대본만 출력(설명·머리말·마크다운 금지)

원본 대본:
{script}
"""

# direction 미지정 시 기본 가공(기존 동작): 번역투 정리 + 자연스러운 구어체.
DEFAULT_INSTRUCTION = "어색한 번역투를 고치고 자연스러운 한국어 구어체 대본으로 다듬어 주세요."


def _call_gemini(prompt: str, retries: int = 3) -> str:
    """Gemini(텍스트) 호출 — 과부하(503) 대비 모델 폴백 체인.

    flash-lite가 자주 503(모델 과부하)나서, 실패 시 flash·2.0-flash로 자동 강등.
    503은 모델별 용량 풀이 달라 다른 모델은 대개 뚫림(429 레이트 한도와는 다름).
    """
    return gemini.generate_fallback(prompt)


# 최초 대본 생성 전용 모델 체인 — 품질 민감(문장력·구성)이라 flash를 1순위로.
# 가공(refine)·자막 다듬기는 기존 lite 체인 유지(비용/속도). env로 상향 가능(예: gemini-2.5-pro).
SCRIPT_MODELS = [
    os.environ.get("GEMINI_SCRIPT_MODEL", "gemini-2.5-flash"),
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
]


def _call_gemini_script(prompt: str) -> str:
    """최초 대본 생성용 — 상위 모델 우선 체인."""
    return gemini.generate_fallback(prompt, models=SCRIPT_MODELS)


def refine_script(script: str, direction: str | None = None,
                  target_sec: float | None = None) -> str:
    """대본 AI 가공. direction(8방향 키) 지정 시 그 방향으로, 없으면 기본(번역투 정리).
    target_sec 주면 발화 길이를 그 초수에 맞추도록 분량 제약 추가(≈5.5자/초)."""
    script = (script or "").strip()
    if not script:
        return ""
    instruction = SCRIPT_DIRECTIONS.get(direction or "", DEFAULT_INSTRUCTION)
    if target_sec and target_sec > 0:
        chars = int(round(float(target_sec) * 5.5))
        instruction += (f"\n결과 대본은 소리 내어 읽었을 때 약 {int(round(float(target_sec)))}초"
                        f"(공백 제외 약 {chars}자 안팎)가 되도록 분량을 맞춰라. 핵심 소구는 유지.")
    try:
        out = _call_gemini(REFINE_PROMPT.format(
            instruction=instruction, shorts_rules=SHORTS_RULES, script=script))
        return _safe_refined_output(script, out) or script
    except Exception as e:
        print(f"  [Gemini refine failed, keeping original: {str(e)[:120]}]")
        return script


# 한국 쇼핑쇼츠 검증 훅 패턴 — 첫 1~2문장은 반드시 이 중 소구포인트와 가장 잘 맞는 유형으로.
HOOK_PATTERNS = """[훅 패턴 — 하나 골라 소구포인트에 맞게 변형]
- 질문형: "아직도 파운데이션 뭉치세요?" / "이거 없이 어떻게 살았지 싶은 거 있어요?"
- 반전형: "솔직히 기대 안 했거든요. 근데…" / "이거 사지 마세요. 하나만 사면 후회하니까."
- 숫자형: "3초면 각질 정리 끝" / "커피 두 잔 값으로 한 달을 버텨요"
- 손해회피형: "이거 모르고 사면 손해예요" / "환절기에 이것부터 챙겨야 돼요"
- 공감형: "화장 무너지는 오후 2시, 다들 알죠?" / "아침 5분이 아쉬운 사람 저만 아니죠?"
- 결과선공개형: "일주일 썼는데 피부결이 진짜 달라졌어요"
- 비교형: "비싼 거랑 뭐가 다른지 직접 비교해봤어요"
- 발견형: "마트에서 우연히 집었는데 이게 물건이네요\""""

PRODUCT_SCRIPT_PROMPT = """너는 조회수 잘 나오는 한국 쇼핑 숏츠 대본을 쓰는 카피라이터다.
아래 (A)영상에서 추출한 내용과 (B)제품 상세페이지 소구포인트를 결합해
한국어 쇼츠 내레이션 대본을 작성해라.

구성(이 순서를 지켜라):
1) 훅 — 첫 1~2문장. 아래 훅 패턴 중 소구포인트와 가장 잘 맞는 유형 하나로. 제품 소개로 시작 금지.
2) 공감/문제 — 시청자가 겪는 불편·고민 한 문장.
3) 제품 등장 — 지시어("요거", "이 제품")로 자연스럽게. 브랜드·상품명 직접 언급 금지.
4) 구체 증거 — 소구포인트 중 가장 강한 수치·사용감·특징 1~2개. 두루뭉술("좋아요") 금지, 구체적으로.
5) 마무리 — 부담 없는 행동 유도 한 문장(강매 금지).

{hooks}

규칙:
- 영상의 흐름·장면에 소구포인트를 자연스럽게 녹여라(나열 금지).
- 소구포인트에 있는 사실만 사용. 없는 효능·가격·할인·수량·성능을 지어내지 마라.
- "무조건 사라", "꼭 사야 한다" 같은 강압·과장 금지.
- 짧고 말하기 좋은 구어체 — 소리 내어 읽었을 때 리듬이 살아야 한다. 문어체·번역투 금지.
- 숫자는 TTS가 읽기 좋게(예: "9900원"→"구천구백 원"처럼 읽혀도 어색하지 않게 단위 포함). {length}
{category_rules}
{shorts_rules}
- **오직 입으로 읽을 내레이션 문장만** 출력해라. 장면 지시(괄호 콘티), 마크다운 기호(**, [영상 끝] 등), 머리말·설명은 절대 넣지 마라. 문장(의미단위)마다 줄바꿈으로 구분 — 이 줄바꿈이 그대로 자막 경계가 된다.
{examples}
(A) 영상 내용:
{video}

(B) 제품 소구포인트:
{points}
"""


# 영상 길이(초) → 대본 분량 지시. 한국어 TTS 1.0x ≈ 초당 5.5자(공백 제외) — 웹 duration.ts와 동일 기준.
def _length_hint(target_seconds: float | None) -> str:
    if not target_seconds or target_seconds < 3:
        return "20~45초 분량."
    sec = int(round(target_seconds))
    chars = int(round(target_seconds * 5.5))
    return (f"목표 길이 약 {sec}초에 맞춰라 — 한국어 내레이션 초당 약 5.5자(공백 제외) 기준 "
            f"총 {chars}자 내외(±15%). 목표보다 길거나 짧지 않게.")


# 카테고리별 소구 문법 — 소구포인트 텍스트에서 카테고리를 추정해 생성 지침에 추가.
CATEGORY_GUIDES = {
    "뷰티": "- 뷰티: 발림성·흡수·지속력 같은 '사용감'을 감각 언어로. 피부 타입(민감성·건성) 언급. 사용 전후 변화 강조.",
    "식품": "- 식품: 맛·식감·간편함(조리 시간)을 '한 입 순간' 묘사로. 구성(몇 팩·몇 인분)과 보관 팁.",
    "가전": "- 가전: 스펙을 생활 이득으로 번역해라('무선 40분' → '계단까지 한 번에'). 소음·크기·관리 편의.",
    "패션": "- 패션: 핏·소재·계절감. 코디 제안 한 줄. 사이즈 선택 팁.",
    "유아": "- 유아: 안전·성분이 최우선. 부모의 걱정에 공감하는 훅.",
    "생활": "- 생활용품: 사용 전/후의 불편→해결 대비. 내구성·세척 편의·가성비 맥락.",
}
_CAT_KEYWORDS = {
    "뷰티": ("뷰티", "화장", "스킨", "크림", "세럼", "쿠션", "마스크팩", "샴푸", "헤어"),
    "식품": ("식품", "간식", "음료", "도시락", "밀키트", "과자", "커피", "차 ", "맛"),
    "가전": ("가전", "전자", "충전", "무선", "배터리", "모터", "디지털"),
    "패션": ("패션", "의류", "니트", "팬츠", "원피스", "신발", "가방"),
    "유아": ("유아", "아기", "키즈", "베이비", "장난감"),
}


def _detect_category(points: str) -> str:
    t = (points or "")[:600]
    for cat, kws in _CAT_KEYWORDS.items():
        if any(k in t for k in kws):
            return cat
    return "생활"


def _bank_examples(category: str, limit: int = 2) -> str:
    """레퍼런스 뱅크(assets/script_bank.json)에서 카테고리 매칭 예시 → few-shot 블록.
    파일 없거나 매칭 없으면 빈 문자열(프롬프트에서 생략)."""
    try:
        import json
        from app.config import BACKEND_ROOT
        data = json.loads((BACKEND_ROOT / "assets" / "script_bank.json").read_text(encoding="utf-8"))
        ex = [e for e in data.get("examples", []) if e.get("category") == category]
        if not ex:
            ex = data.get("examples", [])[:1]     # 카테고리 없으면 아무거나 1개
        ex = ex[:limit]
        if not ex:
            return ""
        body = "\n\n".join(f"[예시 — {e['category']}·{e.get('hook_type', '')}]\n{e['script']}" for e in ex)
        return f"\n[잘 쓴 대본 예시 — 스타일·리듬만 참고, 문장 복사 금지]\n{body}\n"
    except Exception:
        return ""


# best-of-N: 후보 수(1이면 단발 생성 = 이전 동작). 후보들은 flash 기본 온도의 자연 다양성 사용.
N_CANDIDATES = max(1, int(os.environ.get("GEMINI_SCRIPT_CANDIDATES", "3")))

RUBRIC_PROMPT = """다음은 같은 제품으로 쓴 한국 쇼핑 숏츠 대본 후보 {n}개다.
평가 기준(각 0~5점):
① 훅 강도 — 첫 문장이 스크롤을 멈추게 하는가
② 구체성 — 수치·사용감 등 증거가 뚜렷한가
③ 구어체 리듬 — 소리 내어 읽었을 때 자연스러운가
④ 분량 적합 — {target_note}
⑤ 사실성 — 소구포인트에 없는 효능·가격을 지어내지 않았는가(위반이면 총점 무관 탈락)

총점이 가장 높은 후보의 번호 **하나만** 출력해라. 설명 금지. 예: 2

{candidates}

(참고) 제품 소구포인트:
{points}
"""


def _pick_best(cands: list, points: str, target_seconds: float | None, _d) -> str:
    """후보 여러 개 → 루브릭 LLM 채점으로 1개 선택. 판정 실패 시 첫 후보."""
    if len(cands) == 1:
        return cands[0]
    target_note = (f"약 {int(round(target_seconds))}초(공백 제외 {int(round(target_seconds * 5.5))}자 내외)인가"
                   if target_seconds else "20~45초 분량인가")
    body = "\n\n".join(f"[후보 {i + 1}]\n{c}" for i, c in enumerate(cands))
    try:
        out = _call_gemini(RUBRIC_PROMPT.format(
            n=len(cands), target_note=target_note, candidates=body, points=points[:2000]))
        m = _re.search(r"\d+", out or "")
        idx = int(m.group(0)) - 1 if m else 0
        if 0 <= idx < len(cands):
            _d(f"루브릭 채점 → 후보 {idx + 1} 선택")
            return cands[idx]
    except Exception as e:
        _d(f"루브릭 채점 실패, 첫 후보 사용: {str(e)[:80]}")
    return cands[0]


def product_script(video_content: str, selling_points: str, debug: list | None = None,
                   target_seconds: float | None = None) -> str:
    """영상내용 + 제품 소구포인트 → 결합 대본(제품명 직접언급 회피).

    target_seconds: 영상 길이(초). 주면 그 분량에 맞춰 대본 길이 지시.
    제품 상세페이지 정보를 의도적으로 주입하는 경로라 refine_script의
    '원문에 없는 속성 추가 금지' 안전필터를 적용하지 않는다(소구포인트는
    실제 상세페이지 근거가 있는 사실). debug(list)면 단계 append.
    """
    from app.debuglog import make_dbg
    _d = make_dbg(debug, "제품대본")

    video_content = (video_content or "").strip()
    selling_points = (selling_points or "").strip()
    if not selling_points:
        _d("대본 결합 생략: 소구포인트 없음 → 영상내용 그대로")
        return video_content
    key = _api_key()
    if not key:
        _d("대본 결합 생략: Gemini 키 없음 → 영상내용 그대로")
        return video_content
    _d(f"대본 결합(Gemini {MODEL}): 영상내용 {len(video_content)}자 + 소구포인트 {len(selling_points)}자")
    try:
        cat = _detect_category(selling_points)
        _d(f"카테고리 추정: {cat}")
        prompt = PRODUCT_SCRIPT_PROMPT.format(
            video=video_content or "(영상 내용 없음 — 소구포인트 중심으로 작성)",
            points=selling_points,
            hooks=HOOK_PATTERNS,
            shorts_rules=SHORTS_RULES,
            length=_length_hint(target_seconds),
            category_rules=CATEGORY_GUIDES.get(cat, CATEGORY_GUIDES["생활"]),
            examples=_bank_examples(cat),
        )
        if target_seconds:
            _d(f"목표 길이 {target_seconds:.1f}초 → 대본 목표 {int(target_seconds*5.5)}자 내외")
        # best-of-N: 상위 모델로 후보 N개 생성(기본 온도의 자연 다양성) → 루브릭 채점으로 선택.
        cands: list[str] = []
        for k in range(N_CANDIDATES):
            try:
                c = _narration_only(_call_gemini_script(prompt))
                if c and c not in cands:
                    cands.append(c)
            except Exception as e:
                _d(f"후보 {k + 1} 생성 실패: {str(e)[:80]}")
                if not cands:
                    raise                      # 첫 후보부터 실패면 기존 폴백 경로로
                break                          # 일부 성공했으면 그걸로 진행(추가 호출 낭비 방지)
        if not cands:
            _d("✗ 후보 없음, 영상내용 유지")
            return video_content
        _d(f"후보 {len(cands)}개 생성" + (f" → 루브릭 채점" if len(cands) > 1 else ""))
        result = _pick_best(cands, selling_points, target_seconds, _d)
        _d(f"→ 결합 대본 생성 성공: {len(result)}자")
        return result
    except Exception as e:
        _d(f"✗ 대본 생성 실패, 영상내용 유지: {str(e)[:120]}")
        return video_content


HOOKS_PROMPT = """너는 한국 쇼핑 숏츠 카피라이터다.
아래 대본의 도입부를 대체할 **첫 문장(훅) 후보 3개**를 써라.
서로 다른 유형(질문형·반전형·숫자형·공감형·손해회피형 중 3가지)으로 하나씩.

{hooks}

규칙:
- 대본에 있는 사실만 사용. 없는 수치·할인·효능을 지어내지 마라.
- 한 후보 = 한 줄, 한 호흡(15자 안팎). TTS로 읽기 좋게.
- 번호·유형명·설명 없이 후보 문장만 3줄 출력.

대본:
{script}
"""


def hook_candidates(script: str) -> list:
    """현재 대본의 훅(첫 문장) 대안 3개 생성 — 유저가 택1해 교체."""
    script = (script or "").strip()
    if not script:
        return []
    out = _call_gemini(HOOKS_PROMPT.format(hooks=HOOK_PATTERNS, script=script[:3000]))
    lines = [ln.strip().lstrip("-•*0123456789.) ") for ln in (out or "").splitlines()]
    return [ln for ln in lines if ln][:3]


CAPTION_DIRECTIONS = {
    "natural": "어색한 번역투를 자연스러운 한국어 구어체로 다듬어라. 원래 의미는 유지.",
    "impact": "짧고 강한 후킹 문장으로 바꿔라. 첫 문장은 강한 관심유도, 군더더기 제거.",
    "friendly": "친근한 구어체 톤으로 바꿔라(과하지 않게, 반말 살짝).",
    "concise": "핵심만 남기고 압축해라. 불필요한 수식어·중복 제거.",
}

CAPTION_REWRITE_PROMPT = """너는 한국 쇼핑 숏츠 자막 편집자다.
아래 자막 텍스트를 다음 방향으로 다시 써라.
방향: {instruction}

규칙:
- 원문에 없는 제품 속성·효능·가격·할인·수량·성능을 지어내지 마라.
- 강압적 구매 표현("무조건 사라" 등) 금지.
- 쇼츠 자막이라 한 줄은 짧게(8자 안팎). 줄바꿈으로 구분.
- 오직 자막 문장만 출력(설명·머리말·마크다운·콘티 금지).

자막:
{text}
"""


def rewrite_caption_text(text: str, direction: str = "natural") -> str:
    """현재 자막 텍스트를 방향(natural/impact/friendly/concise)대로 Gemini 재작성.

    키 없거나 실패 시 원문 그대로 반환(폴백). 결과는 줄바꿈 구분 내레이션.
    """
    text = (text or "").strip()
    if not text:
        return ""
    instr = CAPTION_DIRECTIONS.get(direction, CAPTION_DIRECTIONS["natural"])
    key = _api_key()
    if not key:
        return text
    try:
        prompt = CAPTION_REWRITE_PROMPT.format(instruction=instr, text=text)
        out = _narration_only(_call_gemini(prompt))
        return out or text
    except Exception as e:
        print(f"  [caption rewrite failed, keeping original: {str(e)[:120]}]")
        return text


def _narration_only(text: str) -> str:
    """콘티 지시·마크다운·머리말 제거 → 순수 내레이션 줄만 남김."""
    import re
    keep = []
    for ln in (text or "").splitlines():
        s = ln.strip()
        if not s:
            continue
        # 장면 지시 줄: (…)만 있거나 [영상 끝] 류
        if re.fullmatch(r"[\(\[].*[\)\]]", s):
            continue
        s = s.replace("**", "").replace("##", "")
        # "내레이션:", "나레이션:" 머리말 제거
        s = re.sub(r"^(내레이션|나레이션|대본|narration)\s*[:：]\s*", "", s, flags=re.I)
        # 줄 끝 괄호 콘티 제거: "문장 (장면설명)"
        s = re.sub(r"\s*[\(（][^\)）]*[\)）]\s*$", "", s).strip()
        if s:
            keep.append(s)
    return "\n".join(keep)


import re as _re


def _nums_with_units(text: str) -> set:
    """가격·수치 주장 추출 — '9,900원' '30%' '500ml' 등. 콤마 제거해 정규화."""
    out = set()
    for m in _re.finditer(r"(\d[\d,\.]*)\s*(원|만원|천원|%|퍼센트|ml|mL|g|kg|개입|매|정|배)", text or ""):
        out.add(m.group(1).replace(",", "") + m.group(2).lower())
    return out


def _safe_refined_output(source: str, refined: str) -> str:
    """가공 결과 안전 검증 — '사실 날조'만 잡는다.

    과거엔 단어 블랙리스트(예쁘/효과/최고…)로 전체 폴백했는데, humor/story처럼
    표현을 바꾸는 방향이 자꾸 걸려 좋은 결과를 조용히 버렸다(체감 '가공 안 됨').
    이제는 ① 원문에 없는 가격/수치 주장 신규 등장 ② 강압 구매 문구 신규 등장
    ③ 비정상 분량 폭증만 검사한다. 톤·수사 변화는 가공의 목적이므로 허용.
    """
    refined = (refined or "").strip()
    if not refined:
        return source
    # ① 원문에 없는 숫자+단위(가격·퍼센트·용량 등) 등장 = 날조 위험 → 폴백
    new_claims = _nums_with_units(refined) - _nums_with_units(source)
    if new_claims:
        print(f"  [refine safety fallback: 신규 수치 주장 {sorted(new_claims)[:3]}]")
        return source
    # ② 강압 구매 문구가 새로 생기면 폴백(원문에 있었다면 통과 — 원문 책임)
    for term in ("무조건 사", "꼭 사야", "안 사면 바보", "당장 구매"):
        if term in refined and term not in source:
            print(f"  [refine safety fallback: 강압 문구 '{term}']")
            return source
    # ③ 비정상 분량 폭증(3배↑) — 프롬프트 붕괴 신호
    if len(refined) > max(120, len(source) * 3):
        print("  [refine safety fallback: output too long]")
        return source
    return refined
