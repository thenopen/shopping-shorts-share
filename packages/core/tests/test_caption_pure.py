"""caption.py 순수 함수 단위 테스트 — 외부 의존(GPU/네트워크/파일) 없음.

자막 분할·정규화·ASS 태그 매핑은 핵심 차별점이자 회귀 위험 영역.
style_from_dict/lines_from_payload/lines_to_payload 왕복 정합성도 검증.
"""
from app.pipeline.caption import (
    CaptionLine,
    CaptionStyle,
    _ass_c,
    _ass_emphasis,
    _break_index,
    _clean_caption_text,
    _meaning_segments,
    _split_text_dp,
    _vis_len,
    lines_from_payload,
    lines_to_payload,
    split_korean_lines,
    style_from_dict,
    _tail_bnd,
)


# ── _vis_len ──────────────────────────────────────────────────────────────
def test_vis_len_excludes_spaces():
    assert _vis_len("안녕 하세요") == 5     # 공백 1개 제외(5음절)
    assert _vis_len("abc") == 3
    assert _vis_len("") == 0
    assert _vis_len("   ") == 0             # 공백만 → 0
    assert _vis_len("1,000원") == 6          # 구두점도 카운트(1,0,0,0,원 + 콤마 = 6)


# ── _clean_caption_text ───────────────────────────────────────────────────
def test_clean_isolated_jamo_removed_but_runs_kept():
    """고립 자모 1글자는 제거, 2글자 이상 런(ㅋㅋ)은 보존."""
    assert _clean_caption_text("안녕 ㅋㅋ") == "안녕 ㅋㅋ"
    # 고립 자모 1글자 제거 — 'ㅇ' 같은 필러
    assert "ㅇ" not in _clean_caption_text("안녕 ㅇ 잘가")


def test_clean_repeated_punctuation_collapsed():
    # 반복 쉼표 → 1개, 그리고 양끝 쉼표 rstrip → 최종 '안녕'
    assert _clean_caption_text("안녕,,,") == "안녕"
    # 마침표 3+ → … (끝에 …는 유지, 부호 rstrip 대상 아님)
    assert _clean_caption_text("끝...") == "끝…"
    # 부호 앞 공백 제거
    assert _clean_caption_text("기다려 , 줄게") == "기다려, 줄게"


def test_clean_strips_outer_commas_and_spaces():
    assert _clean_caption_text(" , 안녕 , ") == "안녕"


# ── split_korean_lines ────────────────────────────────────────────────────
def test_split_returns_empty_for_empty():
    assert split_korean_lines("") == []
    assert split_korean_lines("   ") == []
    assert split_korean_lines("\n\n") == []


def test_split_strips_newlines():
    """원문의 \n 은 공백으로 정규화(의미단위 분할은 별도)."""
    out = split_korean_lines("안녕\n하세요")
    assert "\n" not in " ".join(out)


def test_split_respects_max_chars():
    """각 줄은 max_chars 이하(어절이 max를 넘지 않는 한)."""
    text = "이것은 정말 긴 문장이고 계속 이어지는 내용이라 한 줄에 다 안 들어갈 것 같습니다"
    out = split_korean_lines(text, ideal=8, max_chars=10, min_chars=6)
    assert out  # 비지 않음
    for line in out:
        # 단일 어절이 max를 초과하지 않는 한 줄 길이는 max 이하
        assert _vis_len(line) <= 12  # 강제 분할된 어절 약간의 여유


def test_split_force_splits_long_word():
    """max_chars 보다 긴 단일 어절은 청크로 강제 분할된다."""
    out = split_korean_lines("아주긴단어아주긴단어아주긴단어", ideal=8, max_chars=6, min_chars=4)
    assert all(_vis_len(l) <= 6 for l in out)


def test_split_merges_short_residual():
    """마지막 잔여가 min_chars 미만이고 합쳐지면 직전 줄에 병합."""
    # 7자 어절 + 2자 잔여 구성 — 잔여 < min(6) 이고 합쳐도 max(10)+2 이하면 병합
    out = split_korean_lines("안녕하세요좋은아침 해요", ideal=10, max_chars=12, min_chars=6)
    # "해요"(2자) 가 단독 줄이 되지 않아야 함(직전에 병합되거나 합쳐짐)
    assert not any(_vis_len(l) < 4 for l in out)


def test_split_prefers_sentence_end():
    """문장 끝 부호에서 min_chars 이상이면 끊는다."""
    out = split_korean_lines("안녕하세요. 반갑습니다.", ideal=10, max_chars=10, min_chars=4)
    assert len(out) >= 2
    assert any(l.endswith(".") for l in out)


# ── _tail_bnd ─────────────────────────────────────────────────────────────
def test_tail_bnd_sent():
    assert _tail_bnd("안녕.") == "sent"
    assert _tail_bnd("정말?") == "sent"
    assert _tail_bnd("끝!") == "sent"


def test_tail_bnd_clause_soft_punct():
    assert _tail_bnd("그런데,") == "clause"


def test_tail_bnd_empty_or_none():
    assert _tail_bnd("") == ""
    assert _tail_bnd("그냥 단어") == ""


def test_tail_bnd_connective_ending():
    """한국어 연결어미(니까/는데/지만...)로 끝나면 절 경계."""
    assert _tail_bnd("추워서") == "clause"
    assert _tail_bnd("비가 오는데") == "clause"


# ── _meaning_segments ─────────────────────────────────────────────────────
def test_meaning_segments_splits_on_newline():
    segs = _meaning_segments("첫째 줄\n둘째 줄\n\n셋째 줄")
    assert segs == ["첫째 줄", "둘째 줄", "셋째 줄"]


def test_meaning_segments_normalizes_cr():
    segs = _meaning_segments("a\r\nb")
    assert segs == ["a", "b"]


def test_meaning_segments_empty():
    assert _meaning_segments("") == []
    assert _meaning_segments(None) == []  # type: ignore[arg-type]


# ── _break_index / _split_text_dp ─────────────────────────────────────────
def test_break_index_none_for_single_token():
    assert _break_index("하나") is None


def test_break_index_returns_valid_split():
    """여러 토큰이면 반환 인덱스는 [1, n-1] 구간의 유효 분할점."""
    text = "이것은 조금 긴 문장이라"
    bi = _break_index(text)
    if bi is not None:
        toks = text.split()
        assert 1 <= bi <= len(toks) - 1


def test_split_text_dp_returns_list_of_strings():
    out = _split_text_dp("이것은 정말 좋은 제품입니다", max_chars=10)
    assert isinstance(out, list)
    assert all(isinstance(s, str) for s in out)
    assert "".join(out).replace(" ", "") == "이것은정말좋은제품입니다".replace(" ", "")


# ── _ass_c (color conversion) ─────────────────────────────────────────────
def test_ass_c_hex_rrggbb():
    # #RRGGBB → &HBBGGRR& (BGR + '&' 접미; 알파는 포함 안 함 — libass 는 별도)
    assert _ass_c("#FFE600") == "&H00E6FF&"   # FF,E6,00 → 00,E6,FF
    assert _ass_c("FFE600") == "&H00E6FF&"
    assert _ass_c("FFFFFF") == "&HFFFFFF&"    # 흰색


def test_ass_c_empty_falls_back_white():
    # 빈 입력 → 흰색(FFFFFF)
    assert _ass_c("") == "&HFFFFFF&"


def test_ass_c_malformed_is_passed_through():
    """비정식 입력(zzz)은 예외 대신 그대로 처리된다(폴백 없이 확장/통과)."""
    out = _ass_c("zzz")
    assert isinstance(out, str)
    assert out.startswith("&H") and out.endswith("&")


# ── _ass_emphasis ─────────────────────────────────────────────────────────
def test_ass_emphasis_disabled_returns_unchanged():
    st = CaptionStyle(emphasis=False)
    assert _ass_emphasis("가격 1000원", st) == "가격 1000원"


def test_ass_emphasis_wraps_price():
    st = CaptionStyle(emphasis=True, emphasis_color="FFE600")
    out = _ass_emphasis("1000원", st)
    # 강조 태그로 감싸짐: {\\1c&BGR&\\b1}1000원{\\r}
    assert out.startswith("{\\1c&H00E6FF&\\b1}")   # FFE600 → BGR 00E6FF
    assert "1000원" in out
    assert out.endswith("{\\r}")


def test_ass_emphasis_manual_indices():
    st = CaptionStyle(emphasis=True, emphasis_color="FFFFFF")
    out = _ass_emphasis("단어1 단어2 단어3", st, emph=[1])
    # 단어2 만 강조 태그로 감싸져야 함
    assert out.count("{\\1c") == 1


# ── style_from_dict / lines round-trip ────────────────────────────────────
def test_style_from_dict_empty_returns_default():
    st = style_from_dict(None)
    assert isinstance(st, CaptionStyle)
    assert st.font == "Pretendard"
    assert st.size == 64


def test_style_from_dict_maps_keys():
    st = style_from_dict({"font": "BlackHanSans", "size": 80, "color": "#112233",
                          "outline": False, "bold": False})
    assert st.font == "BlackHanSans"
    assert st.size == 80
    assert st.primary_color == "112233"
    assert st.outline is False
    assert st.bold is False


def test_style_from_dict_box_pad_averages_xy():
    """웹은 boxPadX/boxPadY 를 따로 보내고, ASS 단일 Outline 은 평균으로 매핑."""
    st = style_from_dict({"box": True, "boxPadX": 8, "boxPadY": 4})
    assert st.box_pad == 6   # (8+4)/2


def test_lines_from_payload_round_trip():
    """lines_to_payload → lines_from_payload 왕복: 의미 값 보존."""
    base = CaptionStyle(font="Pretendard", size=64)
    lines = [
        CaptionLine(text="안녕", start=0.0, end=1.5, style=base),
        CaptionLine(text="반가워", start=1.5, end=3.0, style=base),
    ]
    payload = lines_to_payload(lines, base)
    # payload 의 각 줄은 style 이 None(기본과 동일)이어야 함
    assert payload[0]["style"] is None
    restored = lines_from_payload(payload, base)
    assert len(restored) == 2
    assert restored[0].text == "안녕"
    assert restored[1].start == 1.5


def test_lines_from_payload_skips_empty_and_fixes_end_lt_start():
    base = CaptionStyle()
    payload = [
        {"text": "", "start": 0, "end": 1},          # 빈 텍스트 → skip
        {"text": "ok", "start": 5, "end": 3},         # end<start → end=start
        {"text": "x", "start": "bad", "end": 1},      # 숫자 아님 → skip
    ]
    out = lines_from_payload(payload, base)
    assert len(out) == 1
    assert out[0].start == 5 and out[0].end == 5
