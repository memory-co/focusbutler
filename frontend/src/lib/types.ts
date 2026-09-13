export type CameraStatus = "recording" | "unavailable" | "denied";
export type SessionStatus = "running" | "paused" | "completed" | "abandoned";

export interface UserSettings {
  focus_minutes: number;
  short_break_minutes: number;
  long_break_minutes: number;
  long_break_every: number;
  video_chunk_seconds: number;
  video_width: number;
  video_height: number;
}

export interface User {
  id: string;
  username: string;
  settings: UserSettings;
  created_at: string;
}

export interface Session {
  id: string;
  camera_status: CameraStatus;
  planned_seconds: number;
  started_at: string;
  ended_at: string | null;
  status: SessionStatus;
  paused_seconds: number;
  paused_at: string | null;
  note: string | null;
  distraction_count: number;
  elapsed_seconds: number;
  server_now: string;
}

export interface Distraction {
  id: string;
  session_id: string;
  occurred_at: string;
  offset_seconds: number;
  source: "button" | "auto";
}

export interface VideoChunk {
  id: string;
  seq: number;
  offset_seconds: number;
  duration_seconds: number;
  size_bytes: number;
  mime_type: string;
}

export interface SessionDetail extends Session {
  distractions: Distraction[];
  chunks: VideoChunk[];
}

export interface SessionPage {
  items: Session[];
  page: number;
  size: number;
  total: number;
}

export interface StatsSummary {
  days: number;
  completed_sessions: number;
  abandoned_sessions: number;
  focus_minutes: number;
  distractions: number;
  distractions_per_session: number;
}

export interface DailyStat {
  date: string;
  completed_sessions: number;
  focus_minutes: number;
  distractions: number;
}

export interface HeatmapBucket {
  minute: number;
  count: number;
}
