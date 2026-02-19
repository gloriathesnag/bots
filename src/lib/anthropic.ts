/**
 * Anthropic AI functions for Nova
 *
 * Provides two capabilities:
 *   1. researchPartnerAndGenerateQuestions — given a company name and the raw
 *      Slack deal post, returns a Slack-formatted string with a brief company
 *      overview and 2-3 follow-up questions for the sales rep.
 *
 *   2. decideAnnouncement — given the full thread context (original post +
 *      Nova's questions + rep's answers), decides whether the partnership
 *      warrants a public announcement and returns structured metadata.
 */

import Anthropic from "@anthropic-ai/sdk";

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

Step 3 — Generate exactly 2–3 follow-up questions *tailored to this specific company*. Do NOT ask generic questions that would apply to any partner. Instead, ask questions that are only relevant because of what you know about *${companyName}*. For example:
- If they have a large existing community, ask how Snag is integrating with it.
- If they are early-stage or niche, ask whether the deal is ready to be public.
- If there's an obvious story angle (their audience, a product launch, a milestone), ask about that specifically.
- Always include one question about early results or metrics if not already covered in the post.

Respond in Slack mrkdwn, using this structure exactly:

*${companyName} Partnership — Quick Review* 🔍

[1–2 sentence company overview that reflects your actual knowledge of this company]

Before I add this to the Mission Control calendar, I have a couple of questions for you:

1. [Tailored question one]
2. [Tailored question two]
3. [Tailored question three — omit if two strong questions are enough]

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
