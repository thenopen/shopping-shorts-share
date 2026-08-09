"""auth_token.py 단위 테스트 — 부팅 토큰 생성/영속/우회.

TOKEN_PATH 가 WORKDIR(=packages/core/workdir) 에 고정되어 있어, 테스트는 monkeypatch 로
임시 디렉토리로 돌려 기존 토큰 파일에 영향을 주지 않게 한다.
"""
from pathlib import Path

import pytest

from app import auth_token


@pytest.fixture
def isolated_token_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """TOKEN_PATH 를 tmp 디렉토리로 돌린다. 각 테스트마다 새 경로."""
    p = tmp_path / "auth_token.txt"
    monkeypatch.setattr(auth_token, "TOKEN_PATH", p)
    return p


def test_creates_token_when_absent(isolated_token_path: Path):
    t = auth_token.get_or_create_token()
    assert len(t) >= 24
    assert isolated_token_path.exists()
    assert isolated_token_path.read_text() == t


def test_reuses_existing_token(isolated_token_path: Path):
    """이미 저장된 유효 토큰이 있으면 새로 만들지 않고 그대로 반환."""
    isolated_token_path.parent.mkdir(parents=True, exist_ok=True)
    isolated_token_path.write_text("preserved_token_value_1234567890abcd")
    t = auth_token.get_or_create_token()
    assert t == "preserved_token_value_1234567890abcd"


def test_regenerates_when_too_short(isolated_token_path: Path):
    """저장값이 24자 미만(무효)이면 새로 발급."""
    isolated_token_path.parent.mkdir(parents=True, exist_ok=True)
    isolated_token_path.write_text("short")
    t = auth_token.get_or_create_token()
    assert len(t) >= 24
    assert t != "short"


def test_force_auth_token_env_overrides(monkeypatch: pytest.MonkeyPatch, isolated_token_path: Path):
    """FORCE_AUTH_TOKEN 환경변수가 파일/생성보다 우선(배포/CI용)."""
    monkeypatch.setenv("FORCE_AUTH_TOKEN", "my-fixed-deploy-token-xxxxxxx")
    t = auth_token.get_or_create_token()
    assert t == "my-fixed-deploy-token-xxxxxxx"
    # 파일은 쓰지 않아야 함(forced 우선 경로)
    assert not isolated_token_path.exists() or isolated_token_path.read_text() != t


def test_auth_disabled_default_false(monkeypatch: pytest.MonkeyPatch):
    """ALLOW_NO_AUTH 기본값 unset → False(인증 켜짐)."""
    monkeypatch.delenv("ALLOW_NO_AUTH", raising=False)
    assert auth_token.auth_disabled() is False


def test_auth_disabled_true_when_env_set(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ALLOW_NO_AUTH", "1")
    assert auth_token.auth_disabled() is True
    monkeypatch.setenv("ALLOW_NO_AUTH", "0")
    assert auth_token.auth_disabled() is False
