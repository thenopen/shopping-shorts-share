"""[이동됨] 실제 서버 코드는 packages/core/app/server_api.py 에 있음.

이유: server와 core가 둘 다 `app` 패키지라 이름충돌.
core 안에 두면 app.* (config/pipeline/...)를 그대로 import 가능.

실행:
  cd packages/core
  .venv/Scripts/python -m uvicorn app.server_api:app --port 8000
"""
