/**
 * 回放时间线：横轴是专注秒数，点击哪里视频就跳到哪里。
 * 视频是分片拼成的，每片记了"从专注第几秒开始、长多少秒"，
 * 专注时间和视频时间之间靠分片表换算；没有分片覆盖的区间画成灰纹。
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { mmss } from "@/lib/format";
import type { Distraction, VideoChunk } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  video: RefObject<HTMLVideoElement>;
  hasVideo: boolean;
  chunks: VideoChunk[];
  distractions: Distraction[];
  plannedSeconds: number;
  elapsedSeconds: number;
}

interface Span {
  focusStart: number;
  focusEnd: number;
  videoStart: number;
}

/** 按 seq 排好的分片，算出每片在视频里的起点。 */
function buildSpans(chunks: VideoChunk[]): Span[] {
  let cursor = 0;
  return [...chunks]
    .sort((a, b) => a.seq - b.seq)
    .map((c) => {
      const span = { focusStart: c.offset_seconds, focusEnd: c.offset_seconds + c.duration_seconds, videoStart: cursor };
      cursor += c.duration_seconds;
      return span;
    });
}

/** 专注秒数 → 视频秒数。落在空隙里就取下一片的开头。 */
export function focusToVideo(spans: Span[], t: number): number | null {
  for (const s of spans) {
    if (t < s.focusStart) return s.videoStart;
    if (t < s.focusEnd) return s.videoStart + (t - s.focusStart);
  }
  const last = spans[spans.length - 1];
  return last ? last.videoStart + (last.focusEnd - last.focusStart) : null;
}

/** 视频秒数 → 专注秒数。 */
export function videoToFocus(spans: Span[], v: number): number {
  for (const s of spans) {
    const len = s.focusEnd - s.focusStart;
    if (v < s.videoStart + len) return s.focusStart + Math.max(0, v - s.videoStart);
  }
  const last = spans[spans.length - 1];
  return last ? last.focusEnd : 0;
}

export function VideoTimeline({ video, hasVideo, chunks, distractions, plannedSeconds, elapsedSeconds }: Props) {
  const spans = useMemo(() => buildSpans(chunks), [chunks]);
  const total = Math.max(plannedSeconds, elapsedSeconds, 1);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  // 视频播放时游标跟着走
  useEffect(() => {
    const el = video.current;
    if (!el || !hasVideo) return;
    const update = () => setPlayhead(videoToFocus(spans, el.currentTime));
    el.addEventListener("timeupdate", update);
    el.addEventListener("seeked", update);
    return () => {
      el.removeEventListener("timeupdate", update);
      el.removeEventListener("seeked", update);
    };
  }, [video, hasVideo, spans]);

  const seekTo = (focusSec: number) => {
    const el = video.current;
    const v = focusToVideo(spans, focusSec);
    if (!el || v === null) return;
    el.currentTime = v;
    void el.play().catch(() => undefined);
    setPlayhead(focusSec);
  };

  const onClick = (e: React.MouseEvent) => {
    if (!hasVideo || !bar.current) return;
    const rect = bar.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seekTo(ratio * total);
  };

  const pct = (sec: number) => `${Math.min(100, (sec / total) * 100)}%`;

  return (
    <div>
      <div
        ref={bar}
        onClick={onClick}
        className={cn("relative h-10 select-none overflow-hidden rounded bg-muted", hasVideo && "cursor-pointer")}
        title={hasVideo ? "点击跳到对应位置" : undefined}
        style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent 0 6px, hsl(var(--border)) 6px 7px)" }}
      >
        {/* 有视频覆盖的区间 */}
        {spans.map((s, i) => (
          <div key={i} className="absolute inset-y-0 bg-primary/20" style={{ left: pct(s.focusStart), width: pct(s.focusEnd - s.focusStart) }} />
        ))}
        {/* 计划时长刻度 */}
        {elapsedSeconds > plannedSeconds && (
          <div className="absolute inset-y-0 w-px border-l border-dashed border-foreground/50" style={{ left: pct(plannedSeconds) }} title={`计划 ${mmss(plannedSeconds)}`} />
        )}
        {/* 走神标记 */}
        {distractions.map((d) => (
          <div key={d.id} className="absolute top-0 h-full w-1 -translate-x-1/2 bg-destructive" style={{ left: pct(d.offset_seconds) }} title={`${mmss(d.offset_seconds)} 走神`} />
        ))}
        {/* 游标 */}
        {playhead !== null && hasVideo && (
          <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: pct(playhead) }}>
            <div className="absolute -top-0 left-1.5 rounded bg-foreground px-1 text-[10px] leading-4 text-background">{mmss(playhead)}</div>
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>00:00</span>
        {elapsedSeconds > plannedSeconds && <span>计划 {mmss(plannedSeconds)}</span>}
        <span>{mmss(total)}</span>
      </div>
      {distractions.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {distractions.map((d, i) => (
            <li key={d.id}>
              <button
                className={cn("rounded-md border px-2.5 py-1 text-xs tabular-nums", hasVideo ? "hover:bg-accent" : "cursor-default text-muted-foreground")}
                onClick={() => hasVideo && seekTo(d.offset_seconds)}
              >
                #{i + 1} · {mmss(d.offset_seconds)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
