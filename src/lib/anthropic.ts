/**
 * Anthropic AI functions for Nova
 *
 * Provides three capabilities:
 *   1. researchPartnerAndGenerateQuestions — given a company name and the raw
 *      Slack deal post, returns a Slack-formatted string with a brief company
 *      overview and 2-3 follow-up questions for the sales rep.
 *
 *   2. decideAnnouncement — given the full thread context (original post +
 *      Nova's questions + rep's answers), decides whether the partnership
 *      warrants a public announcement and returns structured metadata.
 *
 *   3. parseCalendarCommand — interprets a natural-language Slack message into
 *      a structured action (reschedule / remove / add / unknown) that Nova
 *      can execute against the Notion calendar.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ContentCalendarItem } from "@/types/bot";

let _client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Phase 1 — Research partner and generate questions
// ---------------------------------------------------------------------------

/**
 * Uses Claude to research a partner company (from training knowledge) and
 * generate 2-3 focused follow-up questions for the sales rep.
 *
 * Returns Slack mrkdwn-formatted text ready to post in the thread.
 */
export async function researchPartnerAndGenerateQuestions(
  companyName: string,
  postText: string,
): Promise<string> {
  const client = getClient();

  const msg = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 800,
    messages: [
      {
        role: "user",
        content: `You are Nova, an AI content strategist for Snag Solutions — a Web3 loyalty platform that helps brands reward customers with NFTs, tokens, and digital collectibles.

A new partner deal has just been posted in #bot_announcements:

---
${postText}
---

Company identified: *${companyName}*

Step 1 — Use your training knowledge to assess *${companyName}*:
- Are they well-known in Web3, crypto, gaming, or consumer brands?
- What is their audience size, community strength, or cultural relevance?
- Is this the kind of name that would generate buzz if Snag announced it?

Step 2 — Write a 1–2 sentence company overview that reflects what you actually know. If they are prominent (e.g. a major NFT brand, a big consumer name, a widely-followed Web3 project), say so clearly — this context matters for the announcement decision.

Step 3 — Generate 2–3 follow-up questions using this rule:
- Question 1 is ALWAYS: "Is this partnership ready to be publicly announced, or is it still too early?" — use your own wording but keep this intent.
- Questions 2 (and optionally 3) must be *tailored to this specific company* based on what you know about them. Do NOT ask generic questions that could apply to any partner. Instead ask about things specific to *${companyName}*:
  - If they have a large existing community, ask how Snag is integrating with it.
  - If there's an obvious story angle (their audience, a product launch, a milestone), ask about that specifically.
  - Ask about early results or metrics if not already covered in the post.

Respond in Slack mrkdwn, using this structure exactly:

*${companyName} Partnership — Quick Review* 🔍

[1–2 sentence company overview that reflects your actual knowledge of this company]

Before I add this to the Mission Control calendar, I have a couple of questions for you:

1. [Always the "ready to announce?" question]
2. [Company-specific question]
3. [Second company-specific question — omit if one is enough]

_Once you reply I'll make a recommendation on whether to announce this. 🚀_`,
      },
    ],
  });

  const block = msg.content[0];
  return block.type === "text" ? block.text : "_(Nova could not generate questions — please check ANTHROPIC_API_KEY.)_";
}

// ---------------------------------------------------------------------------
// Phase 2 — Decide whether to announce
// ---------------------------------------------------------------------------

export interface AnnouncementDecision {
  shouldAnnounce: boolean;
  rationale: string;
  title: string;
  channels: string;
  description: string;
}

/**
 * Reads the full thread (original post + Nova's questions + rep's answers)
 * and returns a structured decision.
 */
export async function decideAnnouncement(
  companyName: string,
  threadContext: string,
): Promise<AnnouncementDecision> {
  const client = getClient();

  const msg = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 600,
    messages: [
      {
        role: "user",
        content: `You are Nova, an AI content strategist for Snag Solutions — a Web3 loyalty platform.

You previously asked follow-up questions about a potential partner announcement for *${companyName}*. Here is the full Slack thread:

---
${threadContext}
---

Based on the sales rep's replies, decide:

1. Should this partnership be publicly announced? Think about newsworthiness, story clarity, audience reach, and brand fit for Snag.
2. If yes, suggest announcement details.

Respond with **only** a valid JSON object — no markdown fences, no extra text:

{
  "shouldAnnounce": true,
  "rationale": "One or two sentences explaining your recommendation.",
  "title": "Catchy announcement headline (e.g. 'Acme Corp Launches Web3 Loyalty with Snag')",
  "channels": "All channels",
  "description": "1–2 sentence description for the content calendar entry."
}

For "channels" use exactly one of: All channels | Email + LinkedIn | Email + X | X + LinkedIn | Email only | X only | LinkedIn only

If shouldAnnounce is false, still return the JSON with empty strings for title/channels/description.`,
      },
    ],
  });

  const block = msg.content[0];
  if (block.type !== "text") {
    return fallbackDecision("AI response was not text.");
  }

  try {
    // Strip markdown code fences if the model adds them despite instructions
    const cleaned = block.text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    return JSON.parse(cleaned) as AnnouncementDecision;
  } catch {
    return fallbackDecision(`Could not parse AI response: ${block.text.slice(0, 80)}`);
  }
}

function fallbackDecision(reason: string): AnnouncementDecision {
  return {
    shouldAnnounce: false,
    rationale: reason,
    title: "",
    channels: "",
    description: "",
  };
}

// ---------------------------------------------------------------------------
// Calendar command parsing
// ---------------------------------------------------------------------------

export interface CalendarAction {
  /** What Nova should do. */
  type: "reschedule" | "remove" | "add" | "unknown";
  /** Title (or partial title) of the entry to act on (reschedule / remove). */
  targetTitle?: string;
  /** New week number (reschedule / add). */
  newWeek?: number;
  /** New date in YYYY-MM-DD format (reschedule / add). */
  newDate?: string;
  /** Full entry details when adding a new item. */
  newEntry?: {
    title: string;
    type: string;
    channels: string;
    description: string;
  };
  /** Message Nova posts back to Slack confirming the action (or explaining why she can't). */
  slackReply: string;
}

/**
 * Interprets a natural-language Slack message directed at Nova and returns
 * a structured calendar action to execute against Notion.
 *
 * @param userMessage  The raw text the user sent (with @Nova mention stripped).
 * @param calendar     Current state of the Notion calendar for context.
 * @param baseDate     ISO date of week 1 (defaults to today).
 */
export async function parseCalendarCommand(
  userMessage: string,
  calendar: ContentCalendarItem[],
  baseDate?: string,
): Promise<CalendarAction> {
  const client = getClient();
  const today = baseDate ?? new Date().toISOString().slice(0, 10);

  const calendarSummary = calendar.length
    ? calendar
        .map(
          (i) =>
            `  Week ${i.week} (${i.date}): "${i.title}" [${i.type}]`,
        )
        .join("\n")
    : "  (calendar is empty)";

  const msg = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: `You are Nova, an AI content strategist for Snag Solutions. You manage a 12-week content calendar stored in Notion.

Today is ${today}. Week 1 starts on ${today}. Each subsequent week is 7 days later.

Current calendar:
${calendarSummary}

A team member sent you this Slack message:
"${userMessage}"

Parse their request and respond with **only** a valid JSON object (no markdown):

{
  "type": "reschedule" | "remove" | "add" | "unknown",
  "targetTitle": "exact or partial title of entry to act on (omit for add/unknown)",
  "newWeek": 3,
  "newDate": "YYYY-MM-DD",
  "newEntry": {
    "title": "...",
    "type": "product-launch" | "partner-launch" | "thought-leadership" | "other",
    "channels": "All channels" | "Email + LinkedIn" | "Email + X" | "X + LinkedIn" | "Email only" | "X only" | "LinkedIn only",
    "description": "1-2 sentence description"
  },
  "slackReply": "Friendly 1-sentence confirmation of what you did, or a clear explanation if you couldn't understand the request."
}

Rules:
- For "reschedule": set targetTitle, newWeek, and newDate. Compute newDate by adding (newWeek - 1) * 7 days to ${today}.
- For "remove": set only targetTitle. slackReply should confirm deletion.
- For "add": set newWeek, newDate, and newEntry. Leave targetTitle empty.
- For "unknown": only set slackReply asking for clarification.
- targetTitle should match the most likely calendar entry (partial/fuzzy match is fine).
- Always fill slackReply — it is posted directly to Slack.`,
      },
    ],
  });

  const block = msg.content[0];
  if (block.type !== "text") {
    return unknownAction("I had trouble understanding that — could you rephrase?");
  }

  try {
    const cleaned = block.text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    return JSON.parse(cleaned) as CalendarAction;
  } catch {
    return unknownAction("I had trouble understanding that — could you rephrase?");
  }
}

function unknownAction(reply: string): CalendarAction {
  return { type: "unknown", slackReply: reply };
}
