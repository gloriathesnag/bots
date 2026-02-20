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

// ---------------------------------------------------------------------------
// Dino — Bot leader orchestration
// ---------------------------------------------------------------------------

const BOT_CAPABILITIES = `
- *Nova* (content-strategist): Manages the 12-week content calendar, approves partnership announcements from #bot_announcements, pulls product signals from Linear, and handles calendar commands like rescheduling or adding entries.
- *Piggy* (content-writer): Conversational Web3 content writer. Triggered when a Notion calendar item is marked Draft. Writes blog first, then adapts to newsletter → X thread → LinkedIn — each awaiting explicit approval in #bot_communication.
- *HubSpot Publisher* (hubspot-publisher): Publishes approved, written content directly to HubSpot CMS — sets metadata, schedules posts, and manages workflow states.
- *Performance Analyst* (performance-analyst): Pulls HubSpot analytics and on-chain engagement metrics to score content performance and surface optimisation insights.
`.trim();

export interface DinoRouting {
  messageType: "task" | "idea" | "question" | "update" | "general";
  assignedBot:
    | "content-strategist"
    | "content-writer"
    | "hubspot-publisher"
    | "performance-analyst"
    | null;
  assignedBotName: string | null;
  response: string;
}

/**
 * Analyzes a message posted in #bot_communication and returns Dino's routing
 * decision: which bot to assign it to (if any) and what Dino should reply.
 */
export async function analyzeBotCommunicationMessage(
  message: string,
  senderName: string,
  calendarSummary: string,
): Promise<DinoRouting> {
  const client = getClient();

  const msg = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `You are Dino, the bot leader and orchestrator for Snag Solutions' content bot team.

Your team's capabilities:
${BOT_CAPABILITIES}

Current content calendar:
${calendarSummary || "(calendar not available)"}

A team member named "${senderName}" just posted in #bot_communication:
"${message}"

Analyze their message and respond with ONLY a valid JSON object (no markdown fences):

{
  "messageType": "task" | "idea" | "question" | "update" | "general",
  "assignedBot": "content-strategist" | "content-writer" | "hubspot-publisher" | "performance-analyst" | null,
  "assignedBotName": "Nova" | "Piggy" | "HubSpot Publisher" | "Performance Analyst" | null,
  "response": "What Dino posts back in #bot_communication. Use Slack mrkdwn. Be concise, direct, and action-oriented. If assigning a task to a bot, clearly state the bot's name and what they should do. If it's an idea or general comment, acknowledge it and note any relevant context or gaps."
}

Rules:
- Assign to a bot only if the message clearly maps to that bot's capabilities
- If the message is an idea or general discussion, set assignedBot to null and respond thoughtfully
- If a requested bot is not yet implemented (Content Writer, HubSpot Publisher, Performance Analyst), mention that in your response but still assign it so the team knows who owns it
- Always be helpful and keep the team informed`,
      },
    ],
  });

  const block = msg.content[0];
  if (block.type !== "text") {
    return {
      messageType: "general",
      assignedBot: null,
      assignedBotName: null,
      response: "Got it — I'll keep that in mind.",
    };
  }

  try {
    const cleaned = block.text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    return JSON.parse(cleaned) as DinoRouting;
  } catch {
    return {
      messageType: "general",
      assignedBot: null,
      assignedBotName: null,
      response: "Got it — I'll keep that in mind.",
    };
  }
}

/**
 * Generates a team-wide status report for Dino to post in #bot_communication.
 */
export async function generateDinoStatusReport(
  calendarSummary: string,
  linearSummary: string,
): Promise<string> {
  const client = getClient();

  const msg = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 600,
    messages: [
      {
        role: "user",
        content: `You are Dino, the bot leader for Snag Solutions' content bot team.

Your team:
${BOT_CAPABILITIES}

Current content calendar:
${calendarSummary || "(calendar not available)"}

Recent Linear signals:
${linearSummary || "(no Linear data available)"}

Generate a concise, friendly status report to post in #bot_communication. Cover:
- Quick snapshot of the content calendar (highlight any gaps or upcoming weeks without content)
- Notable Linear items the team should know about
- What each bot should be focused on right now
- Any gaps or things missing that the team should address

Use Slack mrkdwn with bold headers and bullet points. Start with "📊 *Team Status — Dino*". Keep it scannable.`,
      },
    ],
  });

  const block = msg.content[0];
  return block.type === "text"
    ? block.text
    : "📊 *Team Status — Dino*\n\nAll systems running. I'll post a fuller update shortly.";
}

// ---------------------------------------------------------------------------
// Piggy — Content Writer
// ---------------------------------------------------------------------------

const PIGGY_SYSTEM = `You are Piggy, Snag Solutions' content writer. Write in Snag's exact voice — the one real humans at Snag have used and readers recognise.

SNAG SOLUTIONS CONTEXT:
- Web3 loyalty and incentives infrastructure — the "OS for Onchain Growth"
- Products: social questing, claims protocol, Snag Stratus, admin tools
- Case studies you can reference: ApeChain (250k+ participants), Voyager (7x community growth), Camp Network (masterclass TGE execution), Flow blockchain, Pudgy Penguins, Chimpers
- Target readers: crypto-native founders, growth leads, and community managers — NOT general audiences

VOICE (match this precisely):
- Confident, direct, insider-casual. Think "smart operator who's seen what fails" not "startup blog"
- Jargon-fluent — use freely without defining: onchain (one word), TGE, sybil, mindshare, incentive flywheel, token economy, sell pressure, first-party, points-to-token, dev lift, airdrop, floor price
- Structure: identify the problem → build tension → present solution → prove with data/case studies
- Address readers as "you" — make it feel like advice from a peer, not a press release
- Short sentences for impact. Medium sentences for nuance. No corporate padding
- Opinionated: say things plainly. "Most incentive programs flop" not "There can be challenges with incentive programs"

RULES (non-negotiable):
1. Never fabricate metrics, statistics, or partner quotes
2. Use [INSERT METRIC: brief description] where real data should go
3. Use [INSERT PARTNER QUOTE: who/topic] where a quote should go
4. Flag any case study details you're unsure about as [VERIFY: detail]
5. Blog posts are the master — newsletters, threads, and LinkedIn adapt from the approved blog`;

export interface ContentBrief {
  title: string;
  type: string; // "product-launch" | "partner-launch" | "thought-leadership" | "other"
  description: string;
  channels: string;
  date?: string;
}

/**
 * Generates a full blog post from a content brief.
 * Returns structured plain text with clear section headers.
 */
export async function generateBlogPost(brief: ContentBrief): Promise<string> {
  const client = getClient();

  const msg = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 2000,
    system: PIGGY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Write a blog post for Snag Solutions based on this brief:

Title: ${brief.title}
Content type: ${brief.type}
Target channels: ${brief.channels}
Brief / rationale:
${brief.description}

STRUCTURE (follow exactly):
1. Title (H1)
2. Hook (1–2 punchy sentences that make a crypto-native reader stop scrolling)
3. Why This Matters (sets up the problem or tension — 1 paragraph)
4. [2–4 section headers with body copy — use H2 headers]
5. The Proof (case study or data point — use [INSERT METRIC] and [INSERT PARTNER QUOTE] placeholders where real data belongs)
6. Key Takeaway (1 short paragraph)
7. CTA (1 sentence pointing to Snag)

Format as clean plain text with "# " for H1, "## " for H2. Total length: 600–900 words.
Mark every placeholder in [SQUARE BRACKETS].`,
      },
    ],
  });

  const block = msg.content[0];
  return block.type === "text" ? block.text : "[Blog post generation failed]";
}

/**
 * Adapts an approved blog post into a newsletter.
 */
export async function generateNewsletter(
  blogContent: string,
  brief: ContentBrief,
): Promise<string> {
  const client = getClient();

  const msg = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1000,
    system: PIGGY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Adapt this approved Snag blog post into a newsletter.

APPROVED BLOG POST:
---
${blogContent}
---

BRIEF:
Title: ${brief.title}
Channels: ${brief.channels}

NEWSLETTER RULES:
- Subject line: punchy, under 60 characters, no clickbait
- Opening: one personal, conversational sentence (as if from a person, not a brand)
- Body: condensed version of the blog's core argument — ~200 words, hit the 3 most important points
- Keep all [INSERT METRIC] and [INSERT PARTNER QUOTE] placeholders
- CTA: one clear action (read the full post / book a demo / etc.)

FORMAT:
Subject: [subject line]

[opening line]

[condensed body]

[CTA]`,
      },
    ],
  });

  const block = msg.content[0];
  return block.type === "text"
    ? block.text
    : "[Newsletter generation failed]";
}

/**
 * Adapts an approved blog post into an X (Twitter) thread.
 * Max 8 tweets, each under 280 characters, hook in tweet 1.
 */
export async function generateXThread(
  blogContent: string,
  brief: ContentBrief,
): Promise<string> {
  const client = getClient();

  const msg = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 800,
    system: PIGGY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Adapt this approved Snag blog post into an X thread.

APPROVED BLOG POST:
---
${blogContent}
---

BRIEF:
Title: ${brief.title}

X THREAD RULES:
- Max 8 tweets
- Every tweet must be under 280 characters (count carefully)
- Tweet 1: the hook — a bold, counterintuitive, or surprising statement that makes someone stop
- Tweets 2–7: one crisp insight per tweet, build the argument
- Tweet 8 (final): CTA or key takeaway + tag @snagsolutions
- Keep all [INSERT METRIC] placeholders — they count toward char limit, plan accordingly
- No hashtag spam — max 1–2 relevant hashtags in the whole thread
- Number each tweet: "1/" "2/" etc.

FORMAT: list each tweet on its own line, numbered.`,
      },
    ],
  });

  const block = msg.content[0];
  return block.type === "text" ? block.text : "[X thread generation failed]";
}

/**
 * Adapts an approved blog post into a LinkedIn post.
 * 150–300 words, one key insight, soft CTA at end.
 */
export async function generateLinkedInPost(
  blogContent: string,
  brief: ContentBrief,
): Promise<string> {
  const client = getClient();

  const msg = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 600,
    system: PIGGY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Adapt this approved Snag blog post into a LinkedIn post.

APPROVED BLOG POST:
---
${blogContent}
---

BRIEF:
Title: ${brief.title}

LINKEDIN RULES:
- 150–300 words total
- Opening line must hook — no "I'm excited to share" or "Today we announced"
- Pick ONE key insight from the blog and build the post around it
- Conversational but professional — same Snag voice, slightly less jargon-heavy than the blog
- Keep [INSERT METRIC] placeholders
- Soft CTA at the end: invite to read, comment, or connect — no hard sell
- 2–4 line breaks between paragraphs for readability in the LinkedIn feed
- End with 3–5 relevant hashtags (no more)`,
      },
    ],
  });

  const block = msg.content[0];
  return block.type === "text"
    ? block.text
    : "[LinkedIn post generation failed]";
}
