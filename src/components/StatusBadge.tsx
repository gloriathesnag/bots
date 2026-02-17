import { BotStatus } from "@/types/bot";

const STATUS_CONFIG: Record<
  BotStatus,
  { label: string; classes: string; dot: string }
> = {
  idle: {
    label: "Idle",
    classes: "bg-zinc-800 text-zinc-400 border border-zinc-700",
    dot: "bg-zinc-500",
  },
  running: {
    label: "Running",
    classes: "bg-blue-950 text-blue-300 border border-blue-700",
    dot: "bg-blue-400 animate-pulse",
  },
  success: {
    label: "Success",
    classes: "bg-emerald-950 text-emerald-300 border border-emerald-700",
    dot: "bg-emerald-400",
  },
  error: {
    label: "Error",
    classes: "bg-red-950 text-red-300 border border-red-700",
    dot: "bg-red-400",
  },
};

export default function StatusBadge({ status }: { status: BotStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.classes}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}
