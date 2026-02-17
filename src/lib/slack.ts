import { WebClient } from "@slack/web-api";

export interface SlackSignal {
  ts: string; // Slack timestamp
  date: string; // YYYY-MM-DD
  text: string;
  type: "product-launch" | "partner-launch" | "other";
}

const PARTNER_KEYWORDS = [
  "partner",
  "partnership",
  "integration",
  "collaboration",
  "collaborating",
  "announcing our",
  "new partner",
  "joined forces",
  "teaming up",
  "working with",
];

const PRODUCT_KEYWORDS = [
  "launched",
  "shipped",
  "released",
  "now live",
  "new feature",
  "product update",
  "just dropped",
  "rolling out",
  "introducing",
  "we built",
  "available now",
];

function classifyMessage(text: string): SlackSignal["type"] {
  const lower = text.toLowerCase();
  if (PARTNER_KEYWORDS.some((kw) => lower.includes(kw))) return "partner-launch";
  if (PRODUCT_KEYWORDS.some((kw) => lower.includes(kw))) return "product-launch";
  return "other";
}

function slackTsToDate(ts: string): string {
  return new Date(parseFloat(ts) * 1000).toISOString().slice(0, 10);
}

/**
 * Fetch recent messages from a Slack channel and classify them as
 * product-launch, partner-launch, or other signals.
 */
export async function fetchAnnouncementSignals(): Promise<SlackSignal[]> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_ID;

  if (!token || !channelId) {
    throw new Error(
      "Missing SLACK_BOT_TOKEN or SLACK_CHANNEL_ID environment variables.",
    );
  }

  const client = new WebClient(token);

  // Fetch the last 90 days of messages
  const oldest = String(Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60);

  const result = await client.conversations.history({
    channel: channelId,
    oldest,
    limit: 200,
  });

  const messages = result.messages ?? [];

  return messages
    .filter(
      (m) =>
        m.type === "message" &&
        !m.subtype && // exclude joins, topic changes, etc.
        m.text &&
        m.text.trim().length > 20,
    )
    .map((m) => ({
      ts: m.ts!,
      date: slackTsToDate(m.ts!),
      text: m.text!,
      type: classifyMessage(m.text!),
    }))
    .filter((s) => s.type !== "other"); // only keep actionable signals
}
