"""테스트 전역 설정.

packages/core 를 sys.path 에 넣어 `from app.pipeline.caption import ...` 형태의
import 가 테스트 어디서든 동작하게 한다. (runtime 패키지 설치 없이 소스 트리 그대로)
"""
import os
import sys
from pathlib import Path

_CORE_ROOT = Path(__file__).resolve().parent.parent
if str(_CORE_ROOT) not in sys.path:
    sys.path.insert(0, str(_CORE_ROOT))

# WORKDIR 가 테스트 중 임시 파일을 쓰지 않도록 tmp 로 돌린다(auth_token 테스트 등).
# 단, 실제 config.WORKDIR import 를 피하려면 각 테스트가 직접 tmp 경로를 쓴다.
os.environ.setdefault("PYTEST_RUNNING", "1")
