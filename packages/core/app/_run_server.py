import sys
import os
sys._base_executable = sys.executable
# packages/core 를 sys.path 에 추가 (python app/_run_server.py 직접 실행 대응)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import uvicorn
from app.server_api import app
# Server.run() 직접 호출 = 단일 프로세스, 자식 워커 스폰 안함 (글로벌 python 폴백 원천차단)
config = uvicorn.Config(app, host="0.0.0.0", port=8000, log_level="info")
server = uvicorn.Server(config)
server.run()
