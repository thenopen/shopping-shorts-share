# desktop — 데스크톱앱 (Tauri)

설치형 앱. 영상처리를 **로컬 PC에서** 직접 한다 (`packages/core`를 사이드카로 번들).

## 왜 Tauri
- 용량 ~10MB (Electron ~150MB 대비 가벼움)
- React UI 그대로 (web과 컴포넌트 공유)
- 로컬 파일/폴더 접근 쉬움 ("결과 폴더" 기능 필수)
- Windows 인스톨러(.msi/.exe) 빌드 → 더블클릭 배포

## 전제조건 (개발 시)
- Node ✓
- WebView2 ✓ (Win11 기본)
- **Rust** ← 설치 필요 (rustup). 아직 미설치.

## 구조 (예정)
```
desktop/
├── src/             ← React UI (web과 공유)
├── src-tauri/
│   ├── tauri.conf.json   ← 사이드카(core.exe)/번들 설정
│   ├── src/main.rs       ← Rust 셸
│   └── binaries/         ← core.exe, ffmpeg.exe 번들
└── package.json
```

## 배포 (Phase 4)
1. `packages/core` → PyInstaller로 `core.exe` 단일파일화
2. `ffmpeg.exe` + 폰트/BGM/SFX 에셋 번들
3. `npm run tauri build` → Windows 인스톨러 생성

## 상태: 미착수 (Phase 3). Rust 설치 후 시작.
