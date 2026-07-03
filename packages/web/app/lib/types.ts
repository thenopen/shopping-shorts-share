// 서버 API 응답/도메인 타입 모음.

export type JobState = {
  id: string;
  status: string;
  progress: number;
  stage: string;
  script: string;
  preview: string | null;
  output: string | null;
  output_dur?: number | null;            // 최종 영상 실측 길이(초) — 목표 대비 표시용
  has_speech: boolean | null;
  error: string | null;
  subtitle_engine?: string | null;       // "propainter_modal" | "lama" | "lama_fallback" | "cached" | "none"
  subtitle_engine_note?: string | null;  // 폴백 사유 등
  subtitle_debug?: string[] | null;      // 자막제거 판단/폴백 과정(F12 콘솔용)
  douyin_diag?: string[] | null;         // 도우인 다운로드 미디어 후보/트랙 진단(F12 콘솔용)
};

export type Usage = {
  gemini: { calls: number; tokens: number; model?: string | null; cooldown: number; limit: number; remaining: number; tpm_limit: number; rpm: number; rpm_limit: number; rpm_remaining: number; reset: string };
  tts: { chars: number; calls: number; limit: number; remaining: number; reset: string };
  modal: { jobs: number; seconds: number; cost: number; gpu?: string | null; limit: number; remaining: number; reset: string; accounts: number };
};

export type SettingsStatus = {
  gemini: { set: boolean; masked: string };
  google_tts: { set: boolean; email: string };
  modal: { set: boolean; masked: string; profile: string | null };
  limits: { gemini_rpd: number; gemini_tpm: number; tts_chars: number; modal_credit: number };
  download_dir: string;
};

// URL 확인(미리보기) 결과 + 라이브러리 항목
export type Stages = { source: boolean; nosub: boolean; script: boolean };

export type PreviewInfo = {
  url: string; in_library: boolean; reused: boolean;
  title?: string | null; duration?: number | null; platform?: string;
  thumb?: string | null; thumbnail?: string | null; stages?: Stages;
  note?: string; error?: string;
};

export type LibraryEntry = {
  key: string; url: string; title: string; duration?: number | null;
  platform: string; downloaded_at: number; size: number;
  has_thumb: boolean; stages: Stages;
};

export type TestResult = { ok: boolean; msg: string } | "loading";

export type ModalAcct = { label: string; masked: string; cost: number; remaining: number; deploy: string; deploy_msg: string };
