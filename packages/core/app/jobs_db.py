"""작업(job) 상태 SQLite 영속화 — PersistentJob 의 파일 기반 백업을 DB 로 교체.

기존: workdir/jobs/<id>.json 파일에 dict 를 원자적 저장.
지금: workdir/jobs.db SQLite 에 row 단위 저장. data 컬럼에 JSON 전체 dict.

설계:
  - 스키마: jobs(id PK, data TEXT, status, created, updated)
  - data 컬럼 = json.dumps(job_dict)(중첩 meta 포함). status/created/updated는 쿼리/정리용.
  - WAL 모드 + check_same_thread=False — 워커 스레드가 동시에 update.
  - 파일→DB 마이그레이션: 기존 workdir/jobs/*.json 이 있으면 부팅 시 1회 import.
  - dict 인터페이스 유지 — PersistentJob._save 가 JobsDB.update 를 호출(워커 코드 변경 0).

스레드 안전: sqlite3 connection 을 threading.Lock 으로 보호(단일 프로세스, 낮은 동시성).
WAL 모드라 읽기는 논블로킹이지만, 쓰기는 직렬화가 안전하다.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path


class JobsDB:
    """jobs 테이블 어댑터. 모든 쓰기는 _LOCK 으로 직렬화(스레드 안전)."""

    def __init__(self, path: Path):
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        # check_same_thread=False: 워커 스레드가 생성한 connection 을 다른 스레드가 쓰게.
        self._conn = sqlite3.connect(str(self._path), check_same_thread=False,
                                     isolation_level=None)   # autocommit
        # WAL — 읽기/쓰기 동시성. 동시 쓰기는 _LOCK 이 직렬화.
        try:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA synchronous=NORMAL")
        except Exception:
            pass
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                status TEXT,
                created REAL,
                updated REAL
            )
        """)
        self._conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)")
        self._conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created)")

    def insert(self, job: dict) -> None:
        jid = job.get("id")
        if not jid:
            return
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO jobs(id, data, status, created, updated) VALUES(?,?,?,?,?)",
                (jid, json.dumps(job, ensure_ascii=False), job.get("status"),
                 job.get("created", time.time()), time.time()),
            )

    def update(self, job: dict) -> None:
        jid = job.get("id")
        if not jid:
            return
        with self._lock:
            self._conn.execute(
                "UPDATE jobs SET data=?, status=?, updated=? WHERE id=?",
                (json.dumps(job, ensure_ascii=False), job.get("status"), time.time(), jid),
            )

    def get(self, jid: str) -> dict | None:
        with self._lock:
            row = self._conn.execute("SELECT data FROM jobs WHERE id=?", (jid,)).fetchone()
        if not row:
            return None
        try:
            return json.loads(row[0])
        except Exception:
            return None

    def all(self) -> list[dict]:
        with self._lock:
            rows = self._conn.execute("SELECT data FROM jobs").fetchall()
        out = []
        for (s,) in rows:
            try:
                d = json.loads(s)
                if d:
                    out.append(d)
            except Exception:
                pass
        return out

    def delete(self, jid: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM jobs WHERE id=?", (jid,))

    def prune(self, done_ttl: float, hard_ttl: float) -> list[str]:
        """TTL 만료 job 삭제. 삭제된 job id 리스트 반환(호출측이 workdir/<jid> 도 정리).

        - done/error 상태 + done_ttl(6h) 경과 → 삭제
        - 모든 job + hard_ttl(24h) 경과 → 강제 삭제(작업중 보호 상한)
        """
        now = time.time()
        with self._lock:
            rows = self._conn.execute("SELECT id, status, created FROM jobs").fetchall()
        to_delete = []
        for jid, status, created in rows:
            age = now - (created or now)
            if (status in ("done", "error") and age > done_ttl) or age > hard_ttl:
                to_delete.append(jid)
        if to_delete:
            with self._lock:
                self._conn.executemany("DELETE FROM jobs WHERE id=?",
                                       [(jid,) for jid in to_delete])
        return to_delete

    def migrate_from_json(self, jobs_dir: Path) -> int:
        """기존 workdir/jobs/*.json 파일을 DB 로 일회성 import. 이미 있는 id 는 스킵."""
        if not jobs_dir.exists():
            return 0
        n = 0
        with self._lock:
            existing = {r[0] for r in self._conn.execute("SELECT id FROM jobs").fetchall()}
        for f in jobs_dir.glob("*.json"):
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
                jid = d.get("id") or f.stem
                if jid in existing:
                    continue
                d["id"] = jid
                self.insert(d)
                n += 1
            except Exception:
                pass
        return n

    def close(self) -> None:
        with self._lock:
            try:
                self._conn.close()
            except Exception:
                pass
