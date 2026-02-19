/**
 * Slack client utilities for Nova
 *
 * Wraps @slack/web-api for posting messages, reading threads, and fetching
 * approved announcements that Nova has stored in #bot_announcements.
 */

import { WebClient } from "@slack/web-api";
import type { ContentCalendarItem } from "@/types/bot";

// Singleton client — reused across requests within the same serverless instance
let _client: WebClient | undefined;

export function getSlackClient(): WebClient {
  if (!_client) {
    _client = new WebClient(process.env.SLACK_BOT_TOKEN, {
      timeout: 30_000,
    });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Channel resolution
// ---------------------------------------------------------------------------

/** Cache: channel name → channel ID */
const channelIdCache = new Map<string, string>();

/**
 * Resolves a channel name (without #) to its ID.
 * Paginates through conversations.list so it works on large workspaces.
 */
export async function findChannelId(name: string): Promise<string | undefined> {
  const cached = channelIdCache.get(name);
  if (cached) return cached;

  const slack = getSlackClient();
  let cursor: string | undefined;

  do {
    const result = await slack.conversations.list({
      types: "public_channel,private_channel",
      limit: 200,
      cursor,
    });

    for (const ch of result.channels ?? []) {
      if (ch.name === name && ch.id) {
        channelIdCache.set(name, ch.id);
        return ch.id;
      }
    }

    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return undefined;
}

// ---------------------------------------------------------------------------
// Bot identity
// ---------------------------------------------------------------------------

let _botUserId: string | undefined;
let _botId: string | undefined;

/** Returns the bot's own Slack user ID (cached after first call). */
export async function getBotUserId(): Promise<string | undefined> {
  if (_botUserId) return _botUserId;
  const slack = getSlackClient();
  const result = await slack.auth.test();
  _botUserId = result.user_id as string | undefined;
  _botId = result.bot_id as string | undefined;
  return _botUserId;
}

/**
 * Returns the bot's Slack bot_id (the B-prefixed ID that appears in
 * event.bot_id). Used to distinguish Nova's own messages from other bots
 * (e.g. Zapier) so we don't suppress incoming deal posts.
 */
export async function getBotId(): Promise<string | undefined> {
  if (_botId) return _botId;
  await getBotUserId(); // populates both _botUserId and _botId
  return _botId;
}

// ---------------------------------------------------------------------------
// User lookup
// ---------------------------------------------------------------------------

/** Cache: lowercased real name → Slack user ID */
const userIdByNameCache = new Map<string, string>();

/**
 * Finds a Slack user ID by their real name (case-insensitive).
 * Paginates through users.list so it works on large workspaces.
 * Returns undefined if no match is found.
 */
export async function findUserIdByName(name: string): Promise<string | undefined> {
  const key = name.toLowerCase().trim();
  const cached = userIdByNameCache.get(key);
  if (cached) return cached;

  const slack = getSlackClient();
  let cursor: string | undefined;

  // Collect all active human members first, then rank matches
  type Candidate = { id: string; score: number };
  const candidates: Candidate[] = [];

  do {
    const result = await slack.users.list({ limit: 200, cursor });
    for (const member of (result.members ?? [])) {
      if (member.deleted || member.is_bot || !member.id) continue;

      const profile = member.profile as
        | { real_name?: string; display_name?: string }
        | undefined;

      const names = [
        member.real_name ?? "",
        profile?.real_name ?? "",
        profile?.display_name ?? "",
      ].map((n) => n.toLowerCase().trim()).filter(Boolean);

      // Exact match on any name field — highest priority
      if (names.some((n) => n === key)) {
        userIdByNameCache.set(key, member.id);
        return member.id;
      }

      // Partial match: all words in `key` appear somewhere in a name field
      const keyWords = key.split(/\s+/);
      if (names.some((n) => keyWords.every((w) => n.includes(w)))) {
        candidates.push({ id: member.id, score: 1 });
      }
    }
    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);

  if (candidates.length > 0) {
    const id = candidates[0].id;
    userIdByNameCache.set(key, id);
    return id;
  }

  // Last resort: match on first name only (e.g. "Gloria Gerngross" → "Gloria")
  const firstName = key.split(/\s+/)[0];
  if (firstName) {
    const slack2 = getSlackClient();
    let cursor2: string | undefined;
    do {
      const result2 = await slack2.users.list({ limit: 200, cursor: cursor2 });
      for (const member of (result2.members ?? [])) {
        if (member.deleted || member.is_bot || !member.id) continue;
        const profile = member.profile as { real_name?: string; display_name?: string } | undefined;
        const names = [
          member.real_name ?? "",
          profile?.real_name ?? "",
          profile?.display_name ?? "",
        ].map((n) => n.toLowerCase().trim()).filter(Boolean);
        if (names.some((n) => n.startsWith(firstName))) {
          userIdByNameCache.set(key, member.id);
          return member.id;
        }
      }
      cursor2 = result2.response_metadata?.next_cursor || undefined;
    } while (cursor2);
  }

  return undefined;
}

/**
 * Debug helper: logs all active member names so you can spot mismatches
 * in Vercel logs. Call once from handleNewDealPost when lookup fails.
 */
export async function logAllMemberNames(): Promise<void> {
  const slack = getSlackClient();
  let cursor: string | undefined;
  const names: string[] = [];
  do {
    const result = await slack.users.list({ limit: 200, cursor });
    for (const member of (result.members ?? [])) {
      if (member.deleted || member.is_bot || !member.id) continue;
      const profile = member.profile as { real_name?: string; display_name?: string } | undefined;
      names.push([member.real_name, profile?.real_name, profile?.display_name].filter(Boolean).join(" | "));
    }
    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);
  console.log("[Nova] Workspace members:", names.join("\n"));
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export interface SlackMessage {
  ts?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  thread_ts?: string;
  blocks?: unknown[];
}

/** Fetches all messages in a thread, oldest first. */
export async function getThreadMessages(
  channel: string,
  thread_ts: string,
): Promise<SlackMessage[]> {
  const slack = getSlackClient();
  const result = await slack.conversations.replies({
    channel,
    ts: thread_ts,
    limit: 30,
  });
  return (result.messages as SlackMessage[]) ?? [];
}

// ---------------------------------------------------------------------------
// Nova-approved announcement storage
//
// When Nova approves a partner announcement it posts a message with a JSON
// payload in the `text` field prefixed with "nova:approved:". Slack renders
// the `blocks` array for human readers; the `text` is only shown in
// notifications — making it a clean machine-readable store without requiring
// an external database.
// ---------------------------------------------------------------------------

export const NOVA_APPROVED_PREFIX = "nova:approved:";
export const NOVA_HOLD_PREFIX = "nova:hold";

export interface ApprovedAnnouncement {
  company: string;
  title: string;
  channels: string;
  description: string;
  approvedAt: string; // ISO date string
}

/**
 * Reads #bot_announcements and returns all partnerships Nova has approved.
 * Results are sorted newest-first.
 */
export async function fetchApprovedAnnouncements(
  channelId: string,
): Promise<ContentCalendarItem[]> {
  const slack = getSlackClient();

  const result = await slack.conversations.history({
    channel: channelId,
    limit: 100,
  });

  const items: ContentCalendarItem[] = [];

  for (const msg of (result.messages as SlackMessage[]) ?? []) {
    const text = msg.text ?? "";
    if (!text.startsWith(NOVA_APPROVED_PREFIX)) continue;

    try {
      const data: ApprovedAnnouncement = JSON.parse(
        text.slice(NOVA_APPROVED_PREFIX.length),
      );

      // week/date are filled in by runContentStrategist — use placeholders
      items.push({
        week: 0,
        date: data.approvedAt.slice(0, 10),
        title: data.title,
        type: "partner-launch",
        description: data.description,
        channels: normaliseChannel(data.channels),
        fromLinear: false,
      });
    } catch {
      // Malformed entry — skip
    }
  }

  return items;
}

/**
 * Maps AI-generated channel strings to the canonical Channel union type.
 * Falls back to "All channels" if unrecognised.
 */
function normaliseChannel(raw: string): ContentCalendarItem["channels"] {
  const map: Record<string, ContentCalendarItem["channels"]> = {
    "all channels": "All channels",
    "email + linkedin": "Email + LinkedIn",
    "email + x": "Email + X",
    "x + linkedin": "X + LinkedIn",
    "linkedin only": "LinkedIn only",
    "email only": "Email only",
    "x only": "X only",
  };
  return map[raw.toLowerCase().trim()] ?? "All channels";
}
