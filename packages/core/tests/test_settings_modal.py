"""settings.py Modal 멀티계정 옵트인 단위 테스트 — Phase 4 보안 개선 검증.

multi_account_enabled() 와 effective_accounts() 가 기본(단일) 동작을 하는지,
옵트인 시에만 풀이 확장되는지 검증. ~/.modal.toml·settings.json 은 monkeypatch 로 격리.
"""
from pathlib import Path

import pytest

from app import settings


@pytest.fixture
def isolated_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """settings.json 을 tmp 로 돌리고 env 초기화 — 테스트 간 독립성 보장."""
    limits_path = tmp_path / "settings.json"
    monkeypatch.setattr(settings, "LIMITS_PATH", limits_path)
    monkeypatch.delenv("MODAL_MULTI_ACCOUNT", raising=False)
    return limits_path


def test_multi_account_disabled_by_default(isolated_settings, monkeypatch):
    """기본: MODAL_MULTI_ACCOUNT·allow_multi_account 둘 다 없으면 False."""
    assert settings.multi_account_enabled() is False


def test_multi_account_enabled_by_env(isolated_settings, monkeypatch):
    monkeypatch.setenv("MODAL_MULTI_ACCOUNT", "1")
    assert settings.multi_account_enabled() is True


def test_multi_account_enabled_by_settings_flag(isolated_settings, monkeypatch):
    isolated_settings.write_text('{"allow_multi_account": true}', encoding="utf-8")
    assert settings.multi_account_enabled() is True


def test_multi_account_disabled_when_flag_false(isolated_settings, monkeypatch):
    isolated_settings.write_text('{"allow_multi_account": false}', encoding="utf-8")
    assert settings.multi_account_enabled() is False


def test_effective_accounts_default_single(isolated_settings, monkeypatch):
    """옵트인 없을 때 ~/.modal.toml 대표 프로필 1개만 반환(풀 데이터 있어도 무시).

    _read_modal 을 stub 해서 대표 1개가 있는 상황을 시뮬레이션.
    """
    monkeypatch.setattr(settings, "_read_modal", lambda: ("default", {
        "default": {"token_id": "tid-main", "token_secret": "tsec-main", "active": True}
    }))
    # 풀에 계정 2개가 있어도…
    settings.set_modal_accounts([
        {"token_id": "tid-pool1", "token_secret": "tsec-pool1", "label": "a"},
        {"token_id": "tid-pool2", "token_secret": "tsec-pool2", "label": "b"},
    ])
    out = settings.effective_accounts()
    # 기본은 단일: 대표 1개만
    assert len(out) == 1
    assert out[0]["token_id"] == "tid-main"
    assert out[0].get("default") is True


def test_effective_accounts_multi_includes_pool(isolated_settings, monkeypatch):
    """옵트인(MODAL_MULTI_ACCOUNT=1) 시 풀 + 대표 모두 포함(중복 제거)."""
    monkeypatch.setenv("MODAL_MULTI_ACCOUNT", "1")
    monkeypatch.setattr(settings, "_read_modal", lambda: ("default", {
        "default": {"token_id": "tid-main", "token_secret": "tsec-main", "active": True}
    }))
    settings.set_modal_accounts([
        {"token_id": "tid-pool1", "token_secret": "tsec-pool1", "label": "a"},
        # 대표와 같은 token_id → 중복 제거 대상
        {"token_id": "tid-main", "token_secret": "tsec-main", "label": "dup"},
    ])
    out = settings.effective_accounts()
    ids = [a["token_id"] for a in out]
    assert "tid-pool1" in ids
    assert ids.count("tid-main") == 1   # 중복 없음


def test_effective_accounts_empty_when_no_modal(isolated_settings, monkeypatch):
    """~/.modal.toml 도 없고 풀도 비었으면 빈 리스트(멀티 옵트인 여부 무관)."""
    monkeypatch.setattr(settings, "_read_modal", lambda: ("default", {}))
    assert settings.effective_accounts() == []
