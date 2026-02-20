/**
 * Dino — Bot Leader
 *
 * Orchestrates the entire content bot team. Dino has full visibility across
 * all bots, the Notion content calendar, Linear signals, and Slack. His two
 * main jobs:
 *
 *   1. runBotLeader() — Generates a team-wide status report and posts it to
 *      #bot_communication. Triggered from the Mission Control dashboard.
 *
 *   2. handleBotCommunicationMessage() — Called by the Slack events handler
 *      whenever a human posts in #bot_communication. Dino analyzes the message
 *      with Claude, decides which bot should handle it, and replies in-thread
 *      with a clear assignment or response.
 */

import {
  getSlackClient,
  getUserDisplayName,
  postToBotCommunication,
} from "@/lib/slack";
import {
  analyzeBotCommunicationMessage,
  generateDinoStatusReport,
} from "@/lib/anthropic";

// ---------------------------------------------------------------------------
// Run — status report posted to #bot_communication
// ---------------------------------------------------------------------------

/**
 * Fetches the latest state from Notion and Linear, asks Claude to draft a
 * team status briefing, and posts it to #bot_communication.
 *
 * Returns the text of the report so the Dashboard can display it in the logs.
 */
export async function runBotLeader(): Promise<string> {
  let calendarSummary = "(calendar not available)";
  let linearSummary = "(no Linear data)";

  // Fetch Notion calendar
  try {
    const { isNotionConfigured, fetchNotionCalendar } = await import(
      "@/lib/notion"
    );
    if (isNotionConfigured()) {
      const calendar = await fetchNotionCalendar();
      calendarSummary = calendar.length
        ? calendar
            .map(
              (i) => `  Week ${i.week} (${i.date}): "${i.title}" [${i.type}]`,
            )
            .join("\n")
        : "(calendar is empty)";
    }
  } catch (err) {
    console.warn("[Dino] Could not fetch Notion calendar:", err);
  }

  // Fetch Linear signals
  try {
    const { fetchLinearSignals } = await import("@/lib/linear");
    const signals = await fetchLinearSignals();
    linearSummary = signals.length
      ? signals
          .map((s) => `  - ${s.title} [${s.type}] (${s.state})`)
          .join("\n")
      : "(no active signals)";
  } catch (err) {
    console.warn("[Dino] Could not fetch Linear signals:", err);
  }

  const report = await generateDinoStatusReport(calendarSummary, linearSummary);

  await postToBotCommunication("Dino", report);

  return report;
}

// ---------------------------------------------------------------------------
// Message handler — routes human messages in #bot_communication
// ---------------------------------------------------------------------------

/**
 * Called when a human posts a message in #bot_communication. Dino analyzes
 * the message, picks the right bot to own it, and replies in-thread.
 *
 * @param userId     Slack user ID of the person who posted
 * @param text       Raw message text (may include @mention tags)
 * @param channelId  ID of #bot_communication
 * @param ts         Timestamp of the original message (used for threading)
 */
export async function handleBotCommunicationMessage(
  userId: string,
  text: string,
  channelId: string,
  ts: string,
): Promise<void> {
  const senderName = await getUserDisplayName(userId);

  // Fetch calendar context so Dino can make informed routing decisions
  let calendarSummary = "(calendar not available)";
  try {
    const { isNotionConfigured, fetchNotionCalendar } = await import(
      "@/lib/notion"
    );
    if (isNotionConfigured()) {
      const calendar = await fetchNotionCalendar();
      calendarSummary = calendar.length
        ? calendar
            .map(
              (i) => `  Week ${i.week} (${i.date}): "${i.title}" [${i.type}]`,
            )
            .join("\n")
        : "(calendar is empty)";
    }
  } catch (err) {
    console.warn("[Dino] Could not fetch Notion calendar for routing:", err);
  }

  // Strip @mention tags so Claude sees clean natural language
  const cleanText = text.replace(/<@[A-Z0-9]+>/g, "").trim();

  let routing;
  try {
    routing = await analyzeBotCommunicationMessage(
      cleanText,
      senderName,
      calendarSummary,
    );
  } catch (err) {
    console.error("[Dino] analyzeBotCommunicationMessage failed:", err);
    const slack = getSlackClient();
    await slack.chat.postMessage({
      channel: channelId,
      thread_ts: ts,
      text: "⚠️ I hit a snag analyzing that message. Could you try again shortly?",
    });
    return;
  }

  const slack = getSlackClient();
  await slack.chat.postMessage({
    channel: channelId,
    thread_ts: ts,
    text: routing.response,
  });
}
