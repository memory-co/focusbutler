import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, tzOffset } from "@/lib/api";
import { useFocus } from "@/lib/focus-store";
import { navigate } from "@/lib/router";
import type { DailyStat, StatsSummary } from "@/lib/types";

function Stat({ label, value, unit }: { label: string; value: number | string; unit?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="eyebrow">{label}</div>
        <div className="mt-1 text-2xl font-medium tabular-nums">
          {value}
          {unit && <span className="ml-1 text-sm text-muted-foreground">{unit}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function Week({ data }: { data: DailyStat[] }) {
  const max = Math.max(1, ...data.map((d) => d.completed_sessions));
  return (
    <div className="flex items-end gap-2" style={{ height: 96 }}>
      {data.map((d) => (
        <div key={d.date} className="flex flex-1 flex-col items-center gap-1" title={`${d.date}：${d.completed_sessions} 个番茄，走神 ${d.distractions} 次`}>
          <div className="w-full rounded-t bg-primary/80" style={{ height: `${(d.completed_sessions / max) * 72}px` }} />
          <div className="text-[10px] text-muted-foreground">{d.date.slice(5)}</div>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const tz = tzOffset();
  const today = useQuery({ queryKey: ["summary", 1], queryFn: () => api<StatsSummary>("/stats/summary", { query: { days: 1, tz_offset: tz } }) });
  const week = useQuery({ queryKey: ["daily", 7], queryFn: () => api<DailyStat[]>("/stats/daily", { query: { days: 7, tz_offset: tz } }) });
  const session = useFocus((s) => s.session);
  const loadCurrent = useFocus((s) => s.loadCurrent);
  useEffect(() => {
    if (session === undefined) void loadCurrent();
  }, [session, loadCurrent]);

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 sm:p-8 appear">
      <section className="flex flex-col items-center gap-4 py-8 text-center">
        <h1 className="text-2xl font-medium">{session ? "有一个番茄正在进行" : "准备好专注了吗？"}</h1>
        <p className="text-sm text-muted-foreground">开始后摄像头会自动录制，走神时按大按钮。</p>
        <Button size="lg" className="h-14 px-10 text-base" onClick={() => navigate({ page: "focus" })}>
          <Play className="mr-2 h-5 w-5" /> {session ? "回到番茄" : "开始番茄"}
        </Button>
      </section>

      <section className="space-y-3">
        <div className="eyebrow">今日</div>
        {today.data ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="完成番茄" value={today.data.completed_sessions} unit="个" />
            <Stat label="专注" value={today.data.focus_minutes} unit="分钟" />
            <Stat label="走神" value={today.data.distractions} unit="次" />
            <Stat label="平均每番茄" value={today.data.distractions_per_session} unit="次" />
          </div>
        ) : (
          <Skeleton className="h-20 w-full" />
        )}
      </section>

      <section className="space-y-3">
        <div className="eyebrow">最近 7 天</div>
        <Card>
          <CardContent className="p-4">{week.data ? <Week data={week.data} /> : <Skeleton className="h-24 w-full" />}</CardContent>
        </Card>
      </section>
    </div>
  );
}
