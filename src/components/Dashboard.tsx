"use client";

import { useState, useCallback } from "react";
import { Bot, BotLog, ContentCalendarItem } from "@/types/bot";
import { BOT_REGISTRY, BOT_ORDER } from "@/lib/bots";
import BotCard from "@/components/BotCard";
import MissionControlHeader from "@/components/MissionControlHeader";
import ContentCalendar from "@/components/ContentCalendar";

function now(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export default function Dashboard() {
  const [bots, setBots] = useState<Record<string, Bot>>(() => ({
    ...BOT_REGISTRY,
  }));

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

  const orderedBots = BOT_ORDER.map((id) => bots[id]);
  const contentCalendar = bots["content-strategist"].calendarOutput;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <MissionControlHeader bots={orderedBots} />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <p className="text-sm text-zinc-500 mb-6">
          Orchestrate your AI agent pipeline — from strategy to publish to
          analysis.
        </p>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {orderedBots.map((bot) => (
            <BotCard key={bot.id} bot={bot} onRun={handleRun} />
          ))}
        </div>

        {contentCalendar && <ContentCalendar items={contentCalendar} />}
      </main>
    </div>
  );
}
