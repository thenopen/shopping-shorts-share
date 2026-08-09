"""jobs_db.py 단위 테스트 — SQLite 영속화 어댑터.

insert/get/update/delete/prune, 중첩 dict(meta) JSON 왕복, 마이그레이션,
간단한 동시 쓰기(스레드 안전성) 검증.
"""
import json
import threading
from pathlib import Path

import pytest

from app.jobs_db import JobsDB


@pytest.fixture
def db(tmp_path: Path) -> JobsDB:
    return JobsDB(tmp_path / "jobs.db")


def test_insert_and_get(db: JobsDB):
    db.insert({"id": "abc1", "status": "queued", "progress": 0, "created": 1000.0, "meta": {"url": "x"}})
    got = db.get("abc1")
    assert got is not None
    assert got["status"] == "queued"
    assert got["meta"] == {"url": "x"}


def test_get_nonexistent_returns_none(db: JobsDB):
    assert db.get("nope") is None


def test_update_overwrites(db: JobsDB):
    db.insert({"id": "u1", "status": "queued", "created": 1.0})
    db.update({"id": "u1", "status": "done", "progress": 100, "created": 1.0})
    got = db.get("u1")
    assert got["status"] == "done"
    assert got["progress"] == 100


def test_nested_dict_roundtrip(db: JobsDB):
    """중첩 dict(meta.transcribe.segments 등)가 JSON 왕복에서 보존되는지."""
    nested = {"id": "n1", "status": "transcribed", "created": 1.0,
              "meta": {"url": "https://x", "transcribe": {"segments": [{"start": 0.5, "text": "안녕"}]}}}
    db.insert(nested)
    got = db.get("n1")
    assert got["meta"]["transcribe"]["segments"][0]["text"] == "안녕"


def test_all_returns_every_row(db: JobsDB):
    db.insert({"id": "a1", "status": "done", "created": 1.0})
    db.insert({"id": "a2", "status": "error", "created": 2.0})
    all_jobs = db.all()
    ids = {j["id"] for j in all_jobs}
    assert ids == {"a1", "a2"}


def test_delete(db: JobsDB):
    db.insert({"id": "d1", "status": "done", "created": 1.0})
    db.delete("d1")
    assert db.get("d1") is None


def test_prune_done_ttl(db: JobsDB):
    """done/error + done_ttl 경과 → 삭제. 진행중은 남음."""
    import time
    now = time.time()
    db.insert({"id": "old_done", "status": "done", "created": now - 100000})   # 27시간 전
    db.insert({"id": "recent_done", "status": "done", "created": now})          # 방금
    db.insert({"id": "inprogress", "status": "transcribed", "created": now})   # 진행(종료 아님)
    deleted = db.prune(done_ttl=6 * 3600, hard_ttl=24 * 3600)
    assert "old_done" in deleted
    assert "recent_done" not in deleted
    assert "inprogress" not in deleted
    assert db.get("old_done") is None
    assert db.get("recent_done") is not None


def test_prune_hard_ttl_force_deletes(db: JobsDB):
    """hard_ttl 경과하면 진행중 상태도 강제 삭제."""
    import time
    now = time.time()
    db.insert({"id": "ancient", "status": "transcribed", "created": now - 100000})
    deleted = db.prune(done_ttl=6 * 3600, hard_ttl=24 * 3600)
    assert "ancient" in deleted
    assert db.get("ancient") is None


def test_migrate_from_json(db: JobsDB, tmp_path: Path):
    """기존 workdir/jobs/*.json 을 DB 로 import."""
    jobs_dir = tmp_path / "old_jobs"
    jobs_dir.mkdir()
    (jobs_dir / "j1.json").write_text(json.dumps({"id": "j1", "status": "done", "created": 1.0}), encoding="utf-8")
    (jobs_dir / "j2.json").write_text(json.dumps({"id": "j2", "status": "error", "created": 2.0}), encoding="utf-8")
    n = db.migrate_from_json(jobs_dir)
    assert n == 2
    assert db.get("j1")["status"] == "done"
    assert db.get("j2")["status"] == "error"
    # 두 번째 마이그레이션은 스킵(이미 있음).
    assert db.migrate_from_json(jobs_dir) == 0


def test_concurrent_writes_thread_safety(db: JobsDB):
    """여러 스레드가 동시에 insert/update 해도 데이터 무결성 유지(_LOCK 검증)."""
    errors = []

    def writer(prefix: str):
        try:
            for i in range(20):
                jid = f"{prefix}{i}"
                db.insert({"id": jid, "status": "queued", "created": 1.0})
                db.update({"id": jid, "status": "done", "created": 1.0})
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=writer, args=(f"t{n}_",)) for n in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors, f"동시 쓰기 중 에러: {errors}"
    # 4 스레드 × 20 = 80 row 전부 done 상태여야
    all_jobs = db.all()
    assert len(all_jobs) == 80
    assert all(j["status"] == "done" for j in all_jobs)
