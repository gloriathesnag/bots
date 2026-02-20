import { NextRequest, NextResponse } from "next/server";
import { BotId } from "@/types/bot";

const VALID_BOT_IDS: BotId[] = [
  "bot-leader",
  "content-strategist",
  "content-writer",
  "hubspot-publisher",
  "performance-analyst",
];

/**
 * POST /api/bots/[id]/run
 *
 * Triggers the specified bot. Each bot's implementation lives in
 * src/bots/[id]/index.ts and will be wired up here as they are built out.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!VALID_BOT_IDS.includes(id as BotId)) {
    return NextResponse.json({ error: `Unknown bot: ${id}` }, { status: 404 });
  }

  if (id === "bot-leader") {
    const { runBotLeader } = await import("@/bots/bot-leader/index");
    const report = await runBotLeader();
    return NextResponse.json({ botId: id, output: { report } }, { status: 200 });
  }

  if (id === "content-strategist") {
    const { runContentStrategist } = await import(
      "@/bots/content-strategist/index"
    );
    const calendar = await runContentStrategist();

    // Sync the freshly generated calendar to Notion.
    // Runs after we have the full ordered list so week numbers are correct.
    // A Notion failure never breaks the dashboard response.
    try {
      const { isNotionConfigured, syncCalendarToNotion } = await import("@/lib/notion");
      if (isNotionConfigured()) {
        await syncCalendarToNotion(calendar);
      }
    } catch (err) {
      console.warn("[Nova] Notion calendar sync failed:", err);
    }

    return NextResponse.json(
      { botId: id, output: { calendar } },
      { status: 200 },
    );
  }

  if (id === "content-writer") {
    const { runContentWriter } = await import("@/bots/content-writer/index");
    const summary = await runContentWriter();
    return NextResponse.json(
      { botId: id, output: { summary } },
      { status: 200 },
    );
  }

  return NextResponse.json(
    {
      botId: id,
      message: `Bot "${id}" run endpoint registered. Implementation pending.`,
    },
    { status: 202 },
  );
}
