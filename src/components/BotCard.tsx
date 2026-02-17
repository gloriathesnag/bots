"use client";

import { Bot } from "@/types/bot";
import StatusBadge from "@/components/StatusBadge";

const BOT_ICONS: Record<string, string> = {
  "content-strategist": "🧠",
  "content-writer": "✍️",
  "hubspot-publisher": "🚀",
  "performance-analyst": "📊",
};

interface BotCardProps {
  bot: Bot;
  onRun: (id: string) => void;
}

export default function BotCard({ bot, onRun }: BotCardProps) {
  const isRunning = bot.status === "running";

  return (
    <div className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900 p-5 gap-4 hover:border-zinc-600 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">
            {BOT_ICONS[bot.id] ?? "🤖"}
          </span>
          <div>
            <h2 className="text-sm font-semibold text-white">{bot.name}</h2>
            {bot.lastRun && (
              <p className="text-xs text-zinc-500 mt-0.5">
                Last run: {bot.lastRun}
              </p>
            )}
          </div>
        </div>
        <StatusBadge status={bot.status} />
      </div>

      {/* Description */}
      <p className="text-xs text-zinc-400 leading-relaxed">{bot.description}</p>

      {/* Log preview */}
      {bot.logs.length > 0 && (
        <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-3 font-mono text-xs text-zinc-400 max-h-28 overflow-y-auto space-y-1">
          {bot.logs.slice(-5).map((log, i) => (
            <div
              key={i}
              className={
                log.level === "error"
                  ? "text-red-400"
                  : log.level === "warn"
                    ? "text-yellow-400"
                    : "text-zinc-400"
              }
            >
              <span className="text-zinc-600">{log.timestamp}</span>{" "}
              <span className="uppercase text-[10px] font-bold opacity-60">
                [{log.level}]
              </span>{" "}
              {log.message}
            </div>
          ))}
        </div>
      )}

      {/* Run button */}
      <button
        onClick={() => onRun(bot.id)}
        disabled={isRunning}
        className="mt-auto w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white transition-colors"
      >
        {isRunning ? "Running…" : "Run Bot"}
      </button>
    </div>
  );
}
