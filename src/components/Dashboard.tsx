"use client";

import { useState, useCallback } from "react";
import { Bot, BotLog, ContentCalendarItem, Task } from "@/types/bot";
import { BOT_REGISTRY, BOT_ORDER } from "@/lib/bots";
import BotCard from "@/components/BotCard";
import MissionControlHeader from "@/components/MissionControlHeader";
import KanbanBoard from "@/components/KanbanBoard";

function now(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export default function Dashboard() {
  const [bots, setBots] = useState<Record<string, Bot>>(() => ({
    ...BOT_REGISTRY,
  }));

  const [tasks, setTasks] = useState<Task[]>([]);

  const updateBot = useCallback(
    (id: string, patch: Partial<Bot>) =>
      setBots((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } })),
    [],
  );

  const appendLog = useCallback(
    (id: string, log: BotLog) =>
      setBots((prev) => ({
        ...prev,
        [id]: { ...prev[id], logs: [...prev[id].logs, log] },
      })),
    [],
  );

  const handleRun = useCallback(
    async (id: string) => {
      updateBot(id, { status: "running", lastRun: now() });
      appendLog(id, {
        timestamp: now(),
        level: "info",
        message: `Bot "${BOT_REGISTRY[id as keyof typeof BOT_REGISTRY].name}" started.`,
      });

      try {
        const res = await fetch(`/api/bots/${id}/run`, { method: "POST" });
        const data = await res.json();

        appendLog(id, {
          timestamp: now(),
          level: "info",
          message: "Execution complete.",
        });

        const patch: Partial<Bot> = { status: "success" };
        if (data.output?.calendar) {
          patch.calendarOutput = data.output.calendar as ContentCalendarItem[];
        }
        updateBot(id, patch);
      } catch (err) {
        appendLog(id, {
          timestamp: now(),
          level: "error",
          message: `Execution failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        });
        updateBot(id, { status: "error" });
      }
    },
    [updateBot, appendLog],
  );

  const handleAddTask = useCallback(
    (draft: Omit<Task, "id" | "createdAt">) => {
      setTasks((prev) => [
        ...prev,
        { ...draft, id: makeId(), createdAt: now() },
      ]);
    },
    [],
  );

  const handleUpdateTask = useCallback(
    (id: string, patch: Partial<Task>) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, ...patch } : t,
        ),
      );
    },
    [],
  );

  const orderedBots = BOT_ORDER.map((id) => bots[id]);
  const dinoBot = bots["bot-leader"];
  const workerBots = orderedBots.filter((b) => b.id !== "bot-leader");

  return (
    <div className="h-screen bg-zinc-950 text-white flex flex-col overflow-hidden">
      <MissionControlHeader bots={orderedBots} />

      <div className="flex flex-1 min-h-0">
        {/* ── Left sidebar ─────────────────────────────────────── */}
        <aside className="w-56 shrink-0 border-r border-zinc-800 flex flex-col overflow-y-auto bg-zinc-950">
          <div className="p-3 flex flex-col gap-3">
            {/* Dino */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500 mb-2 px-1">
                Bot Leader
              </p>
              <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-1">
                <BotCard bot={dinoBot} onRun={handleRun} compact />
              </div>
            </div>

            {/* Worker bots */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2 px-1">
                Agent Team
              </p>
              <div className="flex flex-col gap-2">
                {workerBots.map((bot) => (
                  <BotCard key={bot.id} bot={bot} onRun={handleRun} compact />
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* ── Main: Kanban ─────────────────────────────────────── */}
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden p-6">
          <div className="mb-5 shrink-0">
            <h2 className="text-lg font-bold text-white">Task Board</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Dino assigns work to the team — track every task from idea to done.
            </p>
          </div>

          <div className="flex-1 min-h-0">
            <KanbanBoard
              tasks={tasks}
              bots={orderedBots}
              onAddTask={handleAddTask}
              onUpdateTask={handleUpdateTask}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
