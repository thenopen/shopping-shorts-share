"""Modal 멀티계정 풀 — 여러 계정을 돌려 자막제거(ProPainter)를 실행.

계정마다 modal.Client.from_credentials로 별도 클라이언트를 만들어(스레드-세이프),
Function.from_name(client=...)로 그 계정 워크스페이스의 배포 함수를 호출한다.
- 선택: 이번 달 잔여 크레딧이 가장 많은 계정 우선(usage 집계 기반).
- 페일오버: 크레딧 소진·오류 시 다음 계정으로 자동 재시도.
- 계정별 사용량(GPU초·비용)을 usage에 계정 키로 기록.

운영 방침:
  · 지금(개발): Modal 여러 계정을 돌려 쓴다(로테이션 — 크레딧 분산·병렬 처리).
  · 실제 서비스 배포 시: 단일(대표) 계정으로 통일한다. (이 '배포'는 제품 프로덕션
    배포를 뜻하며, 아래 modal deploy와는 별개다.)

Modal Function 배포(`modal deploy infra/modal_propainter.py`) — 기술적 함수배포:
  · from_name이 되려면 호출하려는 계정의 워크스페이스에 shorts-propainter가
    deploy 돼 있어야 한다. 배포 없는 계정 클라이언트는 실패→다음 계정 페일오버.
  · 그래서 풀의 각 계정으로 실제 compute를 분산하려면 계정마다(활성 프로필 전환)
    modal deploy를 1회씩 해줘야 한다. 풀이 비면 기본 계정(~/.modal.toml)으로 폴백.
계정 목록은 설정(settings)에서 관리.

주의(ToS): 무료 크레딧을 불리려 무료계정을 다수 돌리는 것은 provider 약관상
멀티어카운팅에 걸릴 수 있음(계정 정지 위험). 사용자 책임.
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
from pathlib import Path

from app import settings, usage

APP_NAME = "shorts-propainter"
FN_NAME = "run_propainter"

_CLIENTS: dict[str, object] = {}   # token_id -> modal.Client (재사용)
_LOCK = threading.Lock()


def _client(token_id: str, token_secret: str):
    with _LOCK:
        c = _CLIENTS.get(token_id)
        if c is None:
            import modal
            c = modal.Client.from_credentials(token_id, token_secret)
            _CLIENTS[token_id] = c
        return c


def _pick_order(accts: list[dict]) -> list[dict]:
    """잔여 크레딧(한도 − 이번달 사용) 많은 순. 소진(≤0.5$ 남음)은 뒤로."""
    limit = settings.get_limits().get("modal_credit", 30.0)

    def remaining(a):
        return limit - usage.modal_account_cost(a["token_id"])

    ranked = sorted(accts, key=remaining, reverse=True)
    live = [a for a in ranked if remaining(a) > 0.5]
    return live + [a for a in ranked if a not in live]  # 소진분도 최후 시도용으로 유지


def available() -> bool:
    return bool(settings.effective_accounts())


def run_propainter(frames_tar: bytes, masks_tar: bytes, **kwargs) -> dict:
    """풀에서 계정을 골라 run_propainter 실행. 실패 시 다음 계정으로 페일오버.

    계정 목록이 비면 기본 클라이언트(~/.modal.toml 활성 프로필)로 1회 시도.
    """
    import modal

    accts = settings.effective_accounts()   # 풀 + 기존(대표) 계정 로테이션
    if not accts:
        fn = modal.Function.from_name(APP_NAME, FN_NAME)
        res = fn.remote(frames_tar, masks_tar, **kwargs)
        try:
            usage.record_modal(res.get("seconds", 0), res.get("gpu", ""), account_id="default")
        except Exception:
            pass
        return res

    last_err = None
    for acct in _pick_order(accts):
        label = acct.get("label") or acct["token_id"][:8]
        try:
            cli = _client(acct["token_id"], acct["token_secret"])
            fn = modal.Function.from_name(APP_NAME, FN_NAME, client=cli)
            res = fn.remote(frames_tar, masks_tar, **kwargs)
            try:
                usage.record_modal(res.get("seconds", 0), res.get("gpu", ""),
                                   account_id=acct["token_id"])
            except Exception:
                pass
            print(f"[modal_pool] '{label}' 계정으로 처리 완료")
            return res
        except Exception as e:
            last_err = e
            print(f"[modal_pool] '{label}' 실패 → 다음 계정: {str(e)[:120]}")
            continue
    raise RuntimeError(f"모든 Modal 계정 실패: {str(last_err)[:200]}")


# ---- 계정 활성화(배포) — 사용자가 추가한 계정 워크스페이스에 shorts-propainter를
#      서버가 대신 `modal deploy`. 첫 배포는 이미지 빌드(torch+가중치)로 수 분.
_DEPLOY: dict[str, dict] = {}   # token_id -> {"state": queued|deploying|done|error, "msg"}


def _modal_exe() -> str:
    p = Path(sys.executable).parent / "modal.exe"
    return str(p) if p.exists() else "modal"


def deploy_status(token_id: str) -> dict:
    return _DEPLOY.get(token_id, {"state": "unknown", "msg": ""})


def deploy_account(token_id: str, token_secret: str) -> None:
    """그 계정으로 shorts-propainter 배포(백그라운드 스레드). 상태는 deploy_status로 조회.

    토큰은 서브프로세스 env(MODAL_TOKEN_ID/SECRET)로만 전달 — stdout에 노출하지 않음.
    """
    token_id, token_secret = (token_id or "").strip(), (token_secret or "").strip()
    if not (token_id and token_secret):
        return
    _DEPLOY[token_id] = {"state": "deploying", "msg": ""}
    core_root = str(Path(__file__).resolve().parent.parent)   # packages/core

    def _run():
        env = dict(os.environ)
        env["MODAL_TOKEN_ID"] = token_id
        env["MODAL_TOKEN_SECRET"] = token_secret
        env.pop("MODAL_PROFILE", None)          # 프로필 대신 env 토큰 우선
        env["PYTHONUTF8"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        try:
            r = subprocess.run(
                [_modal_exe(), "deploy", "infra/modal_propainter.py"],
                cwd=core_root, env=env, capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=1800)
            ok = r.returncode == 0
            tail = ((r.stdout or "") + "\n" + (r.stderr or "")).strip()[-400:]
            _DEPLOY[token_id] = {"state": "done" if ok else "error", "msg": tail}
            if ok:
                try:
                    settings.set_account_deployed(token_id, True)   # 재시작에도 유지
                except Exception:
                    pass
        except Exception as e:
            _DEPLOY[token_id] = {"state": "error", "msg": str(e)[:200]}

    threading.Thread(target=_run, daemon=True).start()


def test_account(token_id: str, token_secret: str) -> dict:
    """계정 하나 검증 — 토큰 + shorts-propainter 배포 확인(실행 안 함).

    from_name은 지연(lazy)이라 핸들만 만든다 → hydrate로 서버 조회를 강제해야
    토큰·배포 유효성이 실제로 검증된다(안 하면 가짜 토큰도 통과).
    """
    try:
        import modal
        cli = _client(token_id, token_secret)
        modal.Function.from_name(APP_NAME, FN_NAME, client=cli).hydrate(client=cli)
        return {"ok": True, "msg": "토큰·배포 확인"}
    except Exception as e:
        return {"ok": False, "msg": str(e)[:160]}
