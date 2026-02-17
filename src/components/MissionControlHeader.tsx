import { Bot } from "@/types/bot";

interface MissionControlHeaderProps {
  bots: Bot[];
}

export default function MissionControlHeader({
  bots,
}: MissionControlHeaderProps) {
  const counts = bots.reduce(
    (acc, bot) => {
      acc[bot.status] = (acc[bot.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <header className="border-b border-zinc-800 bg-zinc-950 px-6 py-4">
      <div className="mx-auto max-w-7xl flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-indigo-400 font-mono text-xs font-semibold tracking-widest uppercase">
              Snag Solutions
            </span>
          </div>
          <h1 className="text-xl font-bold text-white mt-0.5">
            Mission Control
          </h1>
        </div>

        <div className="flex items-center gap-4 text-xs text-zinc-400">
          {counts.running ? (
            <span className="flex items-center gap-1.5 text-blue-400">
              <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
              {counts.running} running
            </span>
          ) : null}
          <span>{bots.length} bots registered</span>
        </div>
      </div>
    </header>
  );
}
