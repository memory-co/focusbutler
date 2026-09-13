import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef } from "react";
import { usePreferences } from "@/lib/store";
import { cn } from "@/lib/utils";

export function CameraPreview({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const collapsed = usePreferences((s) => s.previewCollapsed);
  const toggle = usePreferences((s) => s.togglePreview);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  if (!stream) return null;
  return (
    <div className={cn("fixed bottom-20 right-3 z-30 overflow-hidden rounded-xl border bg-black shadow-lg sm:bottom-4 sm:right-4", collapsed ? "w-28" : "w-44 sm:w-56")}>
      <button className="flex w-full items-center justify-between bg-background/90 px-2 py-1 text-[11px] text-muted-foreground" onClick={toggle}>
        <span className="flex items-center gap-1.5"><span className="live-dot" /> 录制中</span>
        {collapsed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      <video ref={ref} autoPlay muted playsInline className={cn("w-full", collapsed && "hidden")} />
    </div>
  );
}
