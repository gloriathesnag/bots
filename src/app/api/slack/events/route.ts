/**
 * POST /api/slack/events
 *
 * Slack Events API webhook. Nova listens to #bot_announcements and:
 *
 *   1. New top-level message with a "Company:" field
 *      → researches the company, replies in-thread with 2-3 follow-up questions
 *
 *   2. Human reply in a thread where Nova previously asked questions
 *      → reads the full thread, decides if the launch should be announced,
 *        posts the decision, and (if yes) stores a structured payload that
 *        runContentStrategist() will pick up for the Mission Control calendar.
 *
 * Setup checklist (one-time, in api.slack.com/apps):
 *   • Enable Event Subscriptions → Request URL:
 *       https://bots-rouge-psi.vercel.app/api/slack/events
 *   • Subscribe to bot events: message.channels  (public channels)
 *                              message.groups    (private channels)
 *   • Invite the bot to #bot_announcements
 *   • Required OAuth scopes: channels:history, channels:read, groups:history,
 *                             groups:read, chat:write, users:read
 *   • Optional (recommended): set SLACK_SIGNING_SECRET for request verification
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import crypto from "crypto";
import {
  getSlackClient,
  findChannelId,
  getBotId,
  getBotUserId,
  getThreadMessages,
  findUserIdByName,
  logAllMemberNames,
  NOVA_APPROVED_PREFIX,
  NOVA_HOLD_PREFIX,
  type SlackMessage,
  type ApprovedAnnouncement,
} from "@/lib/slack";
import {
  researchPartnerAndGenerateQuestions,
  decideAnnouncement,
} from "@/lib/anthropic";

// ---------------------------------------------------------------------------
// Request signature verification (optional but recommended)
// ---------------------------------------------------------------------------

async function verifySlackSignature(req: NextRequest, rawBody: string): Promise<boolean> {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return true; // Skip if not configured

  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  if (!timestamp || !signature) return false;

  // Reject replays older than 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const sigBase = `v0:${timestamp}:${rawBody}`;
  const expected =
    "v0=" + crypto.createHmac("sha256", secret).update(sigBase).digest("hex");

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ---------------------------------------------------------------------------
// Deduplication (in-memory; protects against Slack's retry behaviour)
// ---------------------------------------------------------------------------

const processedEventIds = new Set<string>();

function markProcessed(eventId: string): boolean {
  if (processedEventIds.has(eventId)) return false; // already seen
  processedEventIds.add(eventId);
  if (processedEventIds.size > 2_000) {
    // Drain the oldest entry to cap memory usage
    processedEventIds.delete(processedEventIds.values().next().value!);
  }
  return true; // first time we've seen this event
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();

  const valid = await verifySlackSignature(req, rawBody);
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: SlackEventBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  // Slack URL verification challenge (one-time during app setup)
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  // Acknowledge immediately — Slack requires a 200 within 3 s.
  // waitUntil() tells Vercel to keep the function instance alive until the
  // promise settles, even though the response has already been sent.
  if (body.type === "event_callback" && body.event) {
    if (markProcessed(body.event_id)) {
      waitUntil(
        processSlackEvent(body.event).catch((err) =>
          console.error("[Nova/Slack] event processing error:", err),
        ),
      );
    }
  }

  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Event dispatching
// ---------------------------------------------------------------------------

interface SlackEventBody {
  type: string;
  challenge?: string;
  event_id: string;
  event?: RawSlackEvent;
}

interface RawSlackEvent {
  type: string;
  subtype?: string;
  bot_id?: string;
  channel?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  user?: string;
}

async function processSlackEvent(event: RawSlackEvent): Promise<void> {
  // Only handle message events
  if (event.type !== "message") return;

  // Skip Nova's own messages to prevent reply loops.
  // Do NOT skip all bot messages — Zapier posts as a bot and must be processed.
  const novaBotId = await getBotId();
  if (novaBotId && event.bot_id === novaBotId) return;

  // Confirm the message is in #bot_announcements
  const channelId = await findChannelId("bot_announcements");
  if (!channelId || event.channel !== channelId) return;

  const isThreadReply =
    !!event.thread_ts && event.thread_ts !== event.ts;

  if (!isThreadReply) {
    await handleNewDealPost(event, channelId);
  } else {
    await handleThreadReply(event, channelId);
  }
}

// ---------------------------------------------------------------------------
// Handler 1 — New deal post
// ---------------------------------------------------------------------------

async function handleNewDealPost(
  event: RawSlackEvent,
  channelId: string,
): Promise<void> {
  const text = event.text ?? "";

  // Only act on posts that contain a "Company:" field
  const companyMatch = text.match(/company\s*:\s*([^\n]+)/i);
  if (!companyMatch) return;

  const companyName = companyMatch[1].trim();

  let reply: string;
  try {
    reply = await researchPartnerAndGenerateQuestions(companyName, text);
  } catch (err) {
    console.error("[Nova] Anthropic call failed:", err);
    reply =
      `*${companyName} Partnership* 🔍\n\nHi! I'd love to learn more before recommending whether to announce this. A few quick questions:\n\n1. Should this be publicly announced, or is it still in early stages?\n2. What was ${companyName} struggling with before partnering with Snag?\n3. Are there any early success metrics we can point to?\n\n_Reply here and I'll make a recommendation!_`;
  }

  // Look up the deal owner from the Zapier post and tag them
  let dealOwnerTag = "";
  const ownerMatch = text.match(/deal\s*owner\s*:\s*([^\n]+)/i);
  if (ownerMatch) {
    const ownerName = ownerMatch[1].trim();
    try {
      const ownerId = await findUserIdByName(ownerName);
      if (ownerId) {
        dealOwnerTag = `<@${ownerId}> `;
      } else {
        console.warn(`[Nova] Could not find Slack user for deal owner: "${ownerName}"`);
        await logAllMemberNames();
      }
    } catch (err) {
      console.error(`[Nova] findUserIdByName failed for "${ownerName}" — is users:read scope granted?`, err);
    }
  }

  const slack = getSlackClient();
  await slack.chat.postMessage({
    channel: channelId,
    thread_ts: event.ts,
    text: `${dealOwnerTag}${reply}`,
  });
}

// ---------------------------------------------------------------------------
// Handler 2 — Thread reply (rep answered Nova's questions)
// ---------------------------------------------------------------------------

async function handleThreadReply(
  event: RawSlackEvent,
  channelId: string,
): Promise<void> {
  const thread_ts = event.thread_ts!;

  const messages = await getThreadMessages(channelId, thread_ts);

  // Determine our bot's user ID so we can identify Nova's messages
  const botUserId = await getBotUserId();

  const novaMessages = messages.filter(
    (m) => m.bot_id || (botUserId && m.user === botUserId),
  );

  // Nova hasn't spoken yet — not our thread
  if (novaMessages.length === 0) return;

  // Nova already made a final decision — don't process again
  const alreadyDecided = novaMessages.some(
    (m) =>
      m.text?.startsWith(NOVA_APPROVED_PREFIX) ||
      m.text?.startsWith(NOVA_HOLD_PREFIX),
  );
  if (alreadyDecided) return;

  // Only fire once there's at least one human reply after Nova's questions
  const humanReplies = messages.filter(
    (m) =>
      !m.bot_id &&
      !(botUserId && m.user === botUserId) &&
      m.ts !== messages[0]?.ts, // exclude original poster if desired
  );
  if (humanReplies.length === 0) return;

  // Extract company name from the original post
  const originalText = messages[0]?.text ?? "";
  const companyMatch = originalText.match(/company\s*:\s*([^\n]+)/i);
  if (!companyMatch) return;

  const companyName = companyMatch[1].trim();

  // Build thread context string for the AI
  const threadContext = messages
    .map((m: SlackMessage) => {
      const speaker =
        m.bot_id || (botUserId && m.user === botUserId) ? "Nova" : "Rep";
      return `[${speaker}]: ${m.text ?? "(no text)"}`;
    })
    .join("\n\n");

  const slack = getSlackClient();

  let decision;
  try {
    decision = await decideAnnouncement(companyName, threadContext);
  } catch (err) {
    console.error("[Nova] Anthropic decision call failed:", err);
    const errObj = err as { status?: number; error?: { type?: string; message?: string } };
    let errMsg = "⚠️ I couldn't process your response — the AI service is unavailable. Please try again shortly or tag me again when ready.";
    if (errObj?.error?.message?.toLowerCase().includes("credit balance")) {
      errMsg = "⚠️ I'm out of credits on the Anthropic API and can't process your response right now. Please ask your admin to top up the account at console.anthropic.com → Plans & Billing, then tag me again.";
    } else if (errObj?.status === 401) {
      errMsg = "⚠️ The Anthropic API key is invalid or missing. Please ask your admin to check the `ANTHROPIC_API_KEY` environment variable in Vercel, then tag me again.";
    } else if (errObj?.status === 429) {
      errMsg = "⚠️ The Anthropic API rate limit was hit. Please wait a minute and tag me again.";
    }
    await slack.chat.postMessage({
      channel: channelId,
      thread_ts,
      text: errMsg,
    });
    return;
  }

  if (decision.shouldAnnounce) {
    const payload: ApprovedAnnouncement = {
      company: companyName,
      title: decision.title,
      channels: decision.channels,
      description: decision.description,
      approvedAt: new Date().toISOString(),
    };

    // Human-readable blocks for Slack
    await slack.chat.postMessage({
      channel: channelId,
      thread_ts,
      // `text` is used for push notifications and—crucially—as our
      // machine-readable store that fetchApprovedAnnouncements() parses.
      text: `${NOVA_APPROVED_PREFIX}${JSON.stringify(payload)}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `✅ *Added to Mission Control calendar!*\n\nThe *${companyName}* partnership looks announcement-worthy. I've queued it for review.`,
          },
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Proposed title:*\n${decision.title}`,
            },
            {
              type: "mrkdwn",
              text: `*Channels:*\n${decision.channels}`,
            },
          ],
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `_${decision.rationale}_`,
            },
          ],
        },
      ],
    });

  } else {
    await slack.chat.postMessage({
      channel: channelId,
      thread_ts,
      text: `${NOVA_HOLD_PREFIX}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📋 *Hold for now*\n\n_${decision.rationale}_\n\nIf things change, tag me again and I'll take another look.`,
          },
        },
      ],
    });
  }
}
