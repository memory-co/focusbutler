/**
 * 摄像头录制：getUserMedia + MediaRecorder 按固定时长切片，顺序上传到后端。
 * 上传串行、失败退避重试；stop() 会等最后一片上传完再返回。
 */
import { api } from "./api";
import type { CameraStatus, VideoChunk } from "./types";

export interface RecorderOptions {
  sessionId: string;
  chunkSeconds: number;
  width: number;
  height: number;
  /** 当前已专注秒数（去掉暂停），由会话 store 提供 */
  getElapsed: () => number;
  onStatus?: (s: { uploading: number; failed: number; uploaded: number }) => void;
}

const MIME_CANDIDATES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

export async function requestCamera(width: number, height: number): Promise<{ stream: MediaStream | null; status: CameraStatus }> {
  if (!navigator.mediaDevices?.getUserMedia) return { stream: null, status: "unavailable" };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 15 } },
      audio: false,
    });
    return { stream, status: "recording" };
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    return { stream: null, status: name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable" };
  }
}

export class ChunkRecorder {
  private recorder: MediaRecorder | null = null;
  private queue: Promise<void> = Promise.resolve();
  private seq = 0;
  private chunkStart = 0;
  private uploading = 0;
  private failed = 0;
  private uploaded = 0;
  private stopped = false;

  constructor(public readonly stream: MediaStream, private opts: RecorderOptions) {}

  async start() {
    // 页面刷新后继续录，seq 接在已有分片后面
    const existing = await api<VideoChunk[]>(`/sessions/${this.opts.sessionId}/video/chunks`).catch(() => []);
    this.seq = existing.length ? Math.max(...existing.map((c) => c.seq)) + 1 : 0;
    const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
    this.recorder = new MediaRecorder(this.stream, { mimeType, videoBitsPerSecond: 400_000 });
    this.recorder.ondataavailable = (ev) => this.handleChunk(ev.data);
    this.chunkStart = this.opts.getElapsed();
    this.recorder.start(this.opts.chunkSeconds * 1000);
  }

  pause() {
    if (this.recorder?.state === "recording") this.recorder.pause();
  }

  resume() {
    if (this.recorder?.state === "paused") this.recorder.resume();
  }

  /** 停止录制并等待所有分片上传完成。 */
  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    const rec = this.recorder;
    if (rec && rec.state !== "inactive") {
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        rec.stop();
      });
    }
    this.stream.getTracks().forEach((t) => t.stop());
    await this.queue;
  }

  private handleChunk(blob: Blob) {
    if (!blob.size) return;
    const seq = this.seq++;
    const offset = this.chunkStart;
    const now = this.opts.getElapsed();
    const duration = Math.max(0, now - offset);
    this.chunkStart = now;
    this.uploading++;
    this.emit();
    this.queue = this.queue.then(() => this.upload(seq, offset, duration, blob));
  }

  private async upload(seq: number, offset: number, duration: number, blob: Blob) {
    const form = new FormData();
    form.set("seq", String(seq));
    form.set("offset_seconds", String(Math.floor(offset)));
    form.set("duration_seconds", duration.toFixed(2));
    form.set("file", blob, `${String(seq).padStart(5, "0")}.webm`);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await api(`/sessions/${this.opts.sessionId}/video/chunks`, { method: "POST", form });
        this.uploading--;
        this.uploaded++;
        this.emit();
        return;
      } catch (e) {
        // 会话已结束(409)就别再试了
        if (e instanceof Error && "status" in e && (e as { status: number }).status === 409) break;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    this.uploading--;
    this.failed++;
    this.emit();
  }

  private emit() {
    this.opts.onStatus?.({ uploading: this.uploading, failed: this.failed, uploaded: this.uploaded });
  }
}
