/**
 * 番茄会话的运行时状态：当前会话、计时校准、走神按钮队列、摄像头录制器。
 * 计时以服务端 elapsed_seconds 为准，本地只做插值；切回标签页会重新校准。
 */
import { create } from "zustand";
import { api } from "./api";
import { ChunkRecorder, requestCamera } from "./recorder";
import { useAuth } from "./store";
import type { CameraStatus, Distraction, Session } from "./types";

const QUEUE_KEY = "focusbutler.distraction-queue.v1";

interface UploadStatus {
  uploading: number;
  failed: number;
  uploaded: number;
}

interface FocusState {
  session: Session | null | undefined;
  /** 服务端给的 elapsed 和收到它时的本地时间，用于插值 */
  baseElapsed: number;
  baseAt: number;
  recorder: ChunkRecorder | null;
  stream: MediaStream | null;
  cameraStatus: CameraStatus | null;
  upload: UploadStatus;
  lastDistraction: Distraction | null;
  pendingDistractions: number;
  busy: boolean;

  elapsed: () => number;
  remaining: () => number;
  loadCurrent: () => Promise<Session | null>;
  start: () => Promise<Session>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  finish: (kind: "complete" | "abandon", note?: string) => Promise<Session>;
  distract: () => Promise<void>;
  undoLast: () => Promise<void>;
  flushQueue: () => Promise<void>;
  attachCamera: () => Promise<void>;
  detachCamera: () => Promise<void>;
}

function readQueue(): string[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}
function writeQueue(q: string[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* ignore */
  }
}

export const useFocus = create<FocusState>()((set, get) => {
  const apply = (session: Session | null) => {
    set({ session, baseElapsed: session?.elapsed_seconds ?? 0, baseAt: Date.now() });
    return session;
  };

  return {
    session: undefined,
    baseElapsed: 0,
    baseAt: Date.now(),
    recorder: null,
    stream: null,
    cameraStatus: null,
    upload: { uploading: 0, failed: 0, uploaded: 0 },
    lastDistraction: null,
    pendingDistractions: readQueue().length,
    busy: false,

    elapsed: () => {
      const { session, baseElapsed, baseAt } = get();
      if (!session) return 0;
      if (session.status !== "running") return baseElapsed;
      return baseElapsed + (Date.now() - baseAt) / 1000;
    },
    remaining: () => {
      const s = get().session;
      return s ? s.planned_seconds - get().elapsed() : 0;
    },

    loadCurrent: async () => {
      const s = (await api<Session | undefined>("/sessions/current")) ?? null;
      return apply(s);
    },

    start: async () => {
      const settings = useAuth.getState().user?.settings;
      const { stream, status } = await requestCamera(settings?.video_width ?? 640, settings?.video_height ?? 480);
      set({ stream, cameraStatus: status });
      const s = await api<Session>("/sessions", { method: "POST", body: { camera_status: status } });
      apply(s);
      if (stream) await get().attachCamera();
      return s;
    },

    attachCamera: async () => {
      const { session, stream } = get();
      const settings = useAuth.getState().user?.settings;
      if (!session) return;
      let s = stream;
      if (!s) {
        const r = await requestCamera(settings?.video_width ?? 640, settings?.video_height ?? 480);
        s = r.stream;
        set({ stream: s, cameraStatus: r.status });
        if (!s) return;
      }
      const recorder = new ChunkRecorder(s, {
        sessionId: session.id,
        chunkSeconds: settings?.video_chunk_seconds ?? 10,
        width: settings?.video_width ?? 640,
        height: settings?.video_height ?? 480,
        getElapsed: () => get().elapsed(),
        onStatus: (upload) => set({ upload }),
      });
      await recorder.start();
      if (session.status === "paused") recorder.pause();
      set({ recorder });
    },

    detachCamera: async () => {
      const { recorder, stream } = get();
      if (recorder) await recorder.stop();
      else stream?.getTracks().forEach((t) => t.stop());
      set({ recorder: null, stream: null });
    },

    pause: async () => {
      const s = get().session;
      if (!s) return;
      apply(await api<Session>(`/sessions/${s.id}/pause`, { method: "POST" }));
      get().recorder?.pause();
    },

    resume: async () => {
      const s = get().session;
      if (!s) return;
      apply(await api<Session>(`/sessions/${s.id}/resume`, { method: "POST" }));
      get().recorder?.resume();
    },

    finish: async (kind, note) => {
      const s = get().session;
      if (!s) throw new Error("没有进行中的番茄");
      set({ busy: true });
      try {
        await get().flushQueue();
        await get().detachCamera(); // 先传完最后一片，再结束会话
        const done = await api<Session>(`/sessions/${s.id}/${kind}`, { method: "POST", body: { note } });
        apply(null);
        set({ lastDistraction: null, cameraStatus: null });
        return done;
      } finally {
        set({ busy: false });
      }
    },

    distract: async () => {
      const s = get().session;
      if (!s || (s.status !== "running" && s.status !== "paused")) return;
      // 先本地计数再发请求，网络失败进队列
      set({ session: { ...s, distraction_count: s.distraction_count + 1 } });
      try {
        const ev = await api<Distraction>(`/sessions/${s.id}/distractions`, { method: "POST" });
        set({ lastDistraction: ev });
      } catch {
        const q = readQueue();
        q.push(s.id);
        writeQueue(q);
        set({ pendingDistractions: q.length });
      }
    },

    undoLast: async () => {
      const { lastDistraction, session } = get();
      if (!lastDistraction || !session) return;
      await api(`/distractions/${lastDistraction.id}`, { method: "DELETE" });
      set({ lastDistraction: null, session: { ...session, distraction_count: Math.max(0, session.distraction_count - 1) } });
    },

    flushQueue: async () => {
      let q = readQueue();
      while (q.length) {
        const id = q[0];
        try {
          await api(`/sessions/${id}/distractions`, { method: "POST" });
        } catch (e) {
          // 会话已结束或不存在，丢弃；网络错误则保留
          if (!(e instanceof Error && "status" in e && (e as { status: number }).status >= 400)) break;
        }
        q = q.slice(1);
        writeQueue(q);
      }
      set({ pendingDistractions: q.length });
    },
  };
});
