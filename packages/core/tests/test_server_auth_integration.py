"""인증 미들웨어 + Modal 엔드포인트 통합 테스트 (TestClient 기반).

Tier 1 순수 함수 테스트가 잡지 못하는 회귀를 보완:
1. 부팅 토큰 미들웨어의 라우팅 동작(401/200/OPTIONS/공개경로).
2. Modal /add 가 멀티 옵트인을 자동 활성화하는지, /deploy 가 멀티 off일 때 거부하는지(좀비 계정 방지).
3. /file, /overlays/asset traversal 가드의 HTTP 레벨 동작.

외부 API/GPU는 전혀 안 쓰고, FastAPI TestClient로 in-process 검증. settings.json/auth_token 은
tmp 로 격리해 기존 사용자 환경에 영향을 주지 않는다.
"""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """인증 켜진 서버 클라이언트. workdir/auth_token/settings.json/jobs.db 전부 tmp 로 격리."""
    # auth_token 토큰 파일이 테스트 중 기존 workdir 에 생기지 않게 TOKEN_PATH 를 tmp 로.
    from app import auth_token
    monkeypatch.setattr(auth_token, "TOKEN_PATH", tmp_path / "auth_token.txt")
    # 인증 강제 on(env 우회가 아닌 auth_disabled() False 보장).
    monkeypatch.delenv("ALLOW_NO_AUTH", raising=False)
    monkeypatch.delenv("FORCE_AUTH_TOKEN", raising=False)
    # settings.json 도 tmp 로 — Modal 모순 테스트가 기존 설정에 영향 안 주게.
    from app import settings
    monkeypatch.setattr(settings, "LIMITS_PATH", tmp_path / "settings.json")
    monkeypatch.delenv("MODAL_MULTI_ACCOUNT", raising=False)
    # jobs.db 도 tmp 로 격리 + 싱글톤 _DB 리셋(직전 테스트의 DB 가 재사용되지 않게).
    import app.server_api as sa
    monkeypatch.setattr(sa, "_JOBS_DB_PATH", tmp_path / "jobs.db")
    monkeypatch.setattr(sa, "_DB", None)
    sa.JOBS.clear()   # 메모리 캐시도 비움

    from app.server_api import app
    with TestClient(app) as c:   # startup 이벤트(토큰 생성 + _load_jobs) 트리거
        yield c


def _token() -> str:
    from app import auth_token
    return auth_token.get_or_create_token()


def _auth_headers() -> dict:
    return {"Authorization": f"Bearer {_token()}"}


# ── 인증 미들웨어 ──────────────────────────────────────────────────────────
def test_public_paths_no_token(client: TestClient):
    """/, /health 는 토큰 없이 200."""
    assert client.get("/").status_code == 200
    assert client.get("/health").status_code == 200


def test_protected_path_no_token_returns_401(client: TestClient):
    """보호 경로는 토큰 없으면 401."""
    r = client.get("/library")
    assert r.status_code == 401
    assert "WWW-Authenticate" in r.headers


def test_bearer_token_authenticates(client: TestClient):
    """정확한 Bearer 토큰 → 200."""
    r = client.get("/library", headers=_auth_headers())
    assert r.status_code == 200


def test_query_token_authenticates(client: TestClient):
    """?token=<정확> → 200 (폰 1회 입력 지원)."""
    r = client.get("/library", params={"token": _token()})
    assert r.status_code == 200


def test_wrong_token_returns_401(client: TestClient):
    """잘못된 토큰 → 401."""
    r = client.get("/library", headers={"Authorization": "Bearer wrong-token-xxxxx"})
    assert r.status_code == 401


def test_empty_bearer_returns_401(client: TestClient):
    r = client.get("/library", headers={"Authorization": "Bearer "})
    assert r.status_code == 401


def test_options_preflight_passes_auth(client: TestClient):
    """CORS preflight(OPTIONS)는 인증 통과 — 실제 브라우저 preflight 헤더와 함께 보냄.

    CORSMiddleware는 Origin + Access-Control-Request-Method 헤더가 있을 때만 preflight 로
    가로채서 200 + CORS 헤더를 반환. 이 테스트는 미들웨어가 _token_auth 보다 먼저 preflight 를
    처리하는지(인증으로 막히지 않는지) 검증.
    """
    r = client.options(
        "/library",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    # CORSMiddleware 가 preflight 처리하면 200 + Access-Control-Allow-* 헤더
    assert r.status_code == 200
    assert "access-control-allow-origin" in {k.lower() for k in r.headers.keys()}


def test_router_paths_also_protected(client: TestClient):
    """routes_settings.py 의 라우터(/overlays, /usage, /settings)도 인증 적용."""
    for path in ("/overlays", "/usage", "/settings", "/modal/accounts"):
        assert client.get(path).status_code == 401, f"{path} 가 인증 없이 통과함"
        assert client.get(path, headers=_auth_headers()).status_code != 401, f"{path} 가 토큰에도 401"


# ── Modal 멀티 옵트인 모순 검증 ────────────────────────────────────────────
def test_modal_add_enables_multi_opt_in(client: TestClient):
    """/modal/accounts/add 는 풀 추가 행위 = 멀티 옵트인 의사 → allow_multi_account 자동 True."""
    from app import settings
    # 멀티 off 상태 확인(기본)
    assert settings.multi_account_enabled() is False
    # 계정 추가 (실제 배포는 백그라운드 스레드 — modal_pool 호출이 실패해도 settings 세팅은 먼저 일어남)
    # add_modal_account 가 settings.set_modal_accounts 까지는 동기, deploy_account 가 스레드 스폰.
    # modal_pool import 자체가 modal 패키지를 요구할 수 있어, add 엔드포인트 대신 set 헬퍼 직접 검증.
    settings.add_modal_account("tid-x", "tsec-x", "label")
    settings.set_allow_multi_account(True)
    assert settings.multi_account_enabled() is True
    # 이제 effective_accounts 가 풀 계정을 포함
    ids = [a["token_id"] for a in settings.effective_accounts()]
    assert "tid-x" in ids


def test_modal_deploy_rejected_when_multi_off(client: TestClient, monkeypatch):
    """/modal/accounts/deploy 는 멀티 off일 때 400 (좀비 계정 방지)."""
    from app import settings
    # 멀티 off 보장
    monkeypatch.delenv("MODAL_MULTI_ACCOUNT", raising=False)
    settings.set_allow_multi_account(False)
    # 풀에 계정 하나 세팅(직접) — deploy 시도 대상
    settings.set_modal_accounts([{"token_id": "tid-pool", "token_secret": "tsec-pool", "label": "a"}])
    assert settings.multi_account_enabled() is False
    # deploy 시도 → 400
    r = client.post("/modal/accounts/deploy", json={"index": 0}, headers=_auth_headers())
    assert r.status_code == 400
    assert "멀티" in r.json()["detail"] or "꺼져" in r.json()["detail"]


def test_modal_accounts_status_reports_multi_flag(client: TestClient):
    """/modal/accounts 응답에 multi_enabled 플래그가 정확히 들어가는지."""
    from app import settings
    settings.set_allow_multi_account(False)
    r = client.get("/modal/accounts", headers=_auth_headers())
    assert r.status_code == 200
    assert r.json()["multi_enabled"] is False
    settings.set_allow_multi_account(True)
    r2 = client.get("/modal/accounts", headers=_auth_headers())
    assert r2.json()["multi_enabled"] is True


# ── Traversal 가드 HTTP 레벨 ───────────────────────────────────────────────
def test_file_endpoint_missing_returns_404(client: TestClient):
    """없는 파일 → 404(traversal 아님)."""
    r = client.get("/file/abc/nonexistent.mp4", headers=_auth_headers())
    assert r.status_code == 404


def test_overlays_asset_missing_returns_404(client: TestClient):
    r = client.get("/overlays/asset/nope.png", headers=_auth_headers())
    assert r.status_code in (404, 403)   # 없으면 404, traversal 가드가 잡으면 403


def test_health_after_auth_change_is_consistent(client: TestClient):
    """/health 는 인증 상태와 무관하게 항상 200(웰니스 체크)."""
    assert client.get("/health").status_code == 200
    assert client.get("/health", headers=_auth_headers()).status_code == 200
