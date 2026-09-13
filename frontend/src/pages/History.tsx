import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, CameraOff, Trash2 } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { fmtDateTime, fmtTime, minutes, mmss } from "@/lib/format";
import { navigate } from "@/lib/router";
import type { Session, SessionDetail, SessionPage } from "@/lib/types";

const STATUS: Record<Session["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  running: { label: "进行中", variant: "default" },
  paused: { label: "已暂停", variant: "outline" },
  completed: { label: "完成", variant: "secondary" },
  abandoned: { label: "放弃", variant: "destructive" },
};

function List() {
  const q = useQuery({ queryKey: ["sessions"], queryFn: () => api<SessionPage>("/sessions", { query: { size: 50 } }) });
  if (!q.data) return <Skeleton className="h-40 w-full" />;
  if (!q.data.items.length) return <p className="py-16 text-center text-sm text-muted-foreground">还没有番茄记录</p>;
  return (
    <div className="divide-y rounded-lg border">
      {q.data.items.map((s) => (
        <button key={s.id} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-accent/50" onClick={() => navigate({ page: "history", session: s.id })}>
          <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{fmtDateTime(s.started_at)}</span>
          <Badge variant={STATUS[s.status].variant}>{STATUS[s.status].label}</Badge>
          <span className="tabular-nums">{minutes(s.elapsed_seconds)} 分钟</span>
          <span className="text-muted-foreground">走神 {s.distraction_count} 次</span>
          <span className="ml-auto text-muted-foreground">{s.camera_status === "recording" ? <Camera className="h-4 w-4" /> : <CameraOff className="h-4 w-4" />}</span>
        </button>
      ))}
    </div>
  );
}

function Detail({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["session", id], queryFn: () => api<SessionDetail>(`/sessions/${id}`) });
  const del = useMutation({
    mutationFn: () => api(`/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => { void qc.invalidateQueries(); toast.success("已删除"); navigate({ page: "history" }); },
    onError: () => toast.error("删除失败"),
  });
  const video = useRef<HTMLVideoElement>(null);
  if (!q.data) return <Skeleton className="h-64 w-full" />;
  const s = q.data;
  const hasVideo = s.chunks.length > 0;
  const seek = (sec: number) => {
    if (video.current) { video.current.currentTime = sec; void video.current.play(); }
  };

  return (
    <div className="space-y-6 appear">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate({ page: "history" })}><ArrowLeft className="h-4 w-4" /></Button>
        <div>
          <div className="text-sm font-medium">{fmtDateTime(s.started_at)}{s.ended_at && ` – ${fmtTime(s.ended_at)}`}</div>
          <div className="text-xs text-muted-foreground">
            专注 {mmss(s.elapsed_seconds)} / 计划 {mmss(s.planned_seconds)} · 走神 {s.distraction_count} 次{s.paused_seconds > 0 && ` · 暂停 ${mmss(s.paused_seconds)}`}
          </div>
        </div>
        <Badge className="ml-auto" variant={STATUS[s.status].variant}>{STATUS[s.status].label}</Badge>
        <AlertDialog>
          <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除这次番茄？</AlertDialogTitle>
              <AlertDialogDescription>走神记录和视频文件会一起删除，无法恢复。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={() => del.mutate()}>删除</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {hasVideo ? (
        <video ref={video} controls playsInline className="w-full rounded-lg bg-black" src={`/api/sessions/${id}/video`} />
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground"><CameraOff className="h-4 w-4" /> 这次番茄没有视频记录</div>
      )}

      <Card>
        <CardContent className="p-4">
          <div className="eyebrow mb-3">走神时间轴</div>
          <div className="relative h-8 rounded bg-muted">
            <div className="absolute inset-y-0 left-0 rounded bg-primary/20" style={{ width: `${Math.min(100, (s.elapsed_seconds / s.planned_seconds) * 100)}%` }} />
            {s.distractions.map((d) => (
              <button
                key={d.id}
                title={`${mmss(d.offset_seconds)} 走神`}
                className="absolute top-0 h-full w-1 -translate-x-1/2 rounded bg-destructive hover:w-1.5"
                style={{ left: `${Math.min(100, (d.offset_seconds / s.planned_seconds) * 100)}%` }}
                onClick={() => hasVideo && seek(d.offset_seconds)}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>00:00</span><span>{mmss(s.planned_seconds)}</span></div>
          {s.distractions.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {s.distractions.map((d, i) => (
                <li key={d.id}>
                  <Button variant="outline" size="sm" className="tabular-nums" onClick={() => hasVideo && seek(d.offset_seconds)}>
                    #{i + 1} · {mmss(d.offset_seconds)}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {s.note && <p className="text-sm text-muted-foreground">备注：{s.note}</p>}
    </div>
  );
}

export default function History({ session }: { session?: string }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-8">
      {!session && <h1 className="text-lg font-medium">历史</h1>}
      {session ? <Detail id={session} /> : <List />}
    </div>
  );
}
