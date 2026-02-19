/**
 * Notion integration for Nova's content calendar
 *
 * The calendar lives in a Notion database. Nova is the only writer — humans
 * request changes by @mentioning her in Slack.
 *
 * Required database properties (create these once in Notion):
 *   Name        — Title (built-in)
 *   Date        — Date
 *   Week        — Number
 *   Type        — Select  (options: product-launch, partner-launch, thought-leadership, other)
 *   Channels    — Select  (options: All channels, Email + LinkedIn, Email + X,
 *                           X + LinkedIn, Email only, X only, LinkedIn only)
 *   Description — Text (rich text)
 *   Source      — Select  (options: Nova, Linear)
 *
 * Environment variables required:
 *   NOTION_API_KEY      — from notion.so/my-integrations
 *   NOTION_DATABASE_ID  — the database ID from the page URL
 */

import { Client } from "@notionhq/client";
import type { ContentCalendarItem } from "@/types/bot";

let _client: Client | undefined;

function getClient(): Client {
  if (!_client) {
    _client = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return _client;
}

function getDatabaseId(): string {
  const id = process.env.NOTION_DATABASE_ID;
  if (!id) throw new Error("NOTION_DATABASE_ID is not set");
  return id;
}

/** Returns true when Notion env vars are present. */
export function isNotionConfigured(): boolean {
  return !!(process.env.NOTION_API_KEY && process.env.NOTION_DATABASE_ID);
}

// ---------------------------------------------------------------------------
// Property helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function itemToProperties(item: ContentCalendarItem): Record<string, any> {
  return {
    Name: {
      title: [{ text: { content: item.title } }],
    },
    Date: {
      date: { start: item.date },
    },
    Week: {
      number: item.week,
    },
    Type: {
      select: { name: item.type },
    },
    Channels: {
      select: { name: item.channels },
    },
    Description: {
      rich_text: [{ text: { content: item.description ?? "" } }],
    },
    Source: {
      select: { name: item.fromLinear ? "Linear" : "Nova" },
    },
  };
}

// ---------------------------------------------------------------------------
// Internal: build a title → pageId map for the whole database
// ---------------------------------------------------------------------------

async function getExistingPagesByTitle(): Promise<Map<string, string>> {
  const client = getClient();
  const db = getDatabaseId();
  const map = new Map<string, string>();
  let cursor: string | undefined;

  do {
    const res = await client.databases.query({
      database_id: db,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of res.results) {
      if (page.object !== "page") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const props = (page as any).properties;
      const titleArr: { plain_text: string }[] = props?.Name?.title ?? [];
      const title = titleArr.map((t) => t.plain_text).join("").trim();
      if (title) map.set(title, page.id);
    }

    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return map;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates or updates a single calendar item without touching any other pages.
 * Used for immediate Notion updates (e.g. right after Nova approves an announcement).
 */
export async function upsertCalendarItem(
  item: ContentCalendarItem,
): Promise<void> {
  const client = getClient();
  const db = getDatabaseId();
  const existing = await getExistingPagesByTitle();
  const pageId = existing.get(item.title);

  if (pageId) {
    await client.pages.update({
      page_id: pageId,
      properties: itemToProperties(item),
    });
  } else {
    await client.pages.create({
      parent: { database_id: db },
      properties: itemToProperties(item),
    });
  }
}

/**
 * Full sync: upserts every item in the list and archives any Notion pages
 * whose titles are no longer present. Called by "Run Bot".
 */
export async function syncCalendarToNotion(
  items: ContentCalendarItem[],
): Promise<void> {
  const client = getClient();
  const db = getDatabaseId();
  const existing = await getExistingPagesByTitle();
  const incomingTitles = new Set(items.map((i) => i.title));

  // Upsert all incoming items
  for (const item of items) {
    const pageId = existing.get(item.title);
    if (pageId) {
      await client.pages.update({
        page_id: pageId,
        properties: itemToProperties(item),
      });
    } else {
      await client.pages.create({
        parent: { database_id: db },
        properties: itemToProperties(item),
      });
    }
  }

  // Archive pages no longer in the calendar
  for (const [title, pageId] of existing.entries()) {
    if (!incomingTitles.has(title)) {
      await client.pages.update({ page_id: pageId, archived: true });
    }
  }
}

/**
 * Reads the full calendar from Notion, sorted by week number ascending.
 * Used to give Nova context when handling Slack calendar commands.
 */
export async function fetchNotionCalendar(): Promise<ContentCalendarItem[]> {
  const client = getClient();
  const db = getDatabaseId();
  const items: ContentCalendarItem[] = [];
  let cursor: string | undefined;

  do {
    const res = await client.databases.query({
      database_id: db,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of res.results) {
      if (page.object !== "page") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const props = (page as any).properties;

      const title = ((props?.Name?.title ?? []) as { plain_text: string }[])
        .map((t) => t.plain_text)
        .join("")
        .trim();

      if (!title) continue;

      const date: string = props?.Date?.date?.start ?? "";
      const week: number = props?.Week?.number ?? 0;
      const type = props?.Type?.select?.name ?? "other";
      const channels = props?.Channels?.select?.name ?? "All channels";
      const description = (
        (props?.Description?.rich_text ?? []) as { plain_text: string }[]
      )
        .map((t) => t.plain_text)
        .join("")
        .trim();
      const fromLinear: boolean =
        props?.Source?.select?.name === "Linear";

      items.push({
        week,
        date,
        title,
        type,
        description,
        channels,
        fromLinear,
      } as ContentCalendarItem);
    }

    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return items.sort((a, b) => a.week - b.week);
}

/**
 * Archives (soft-deletes) a Notion page by exact title.
 * Returns true if found and archived, false if not found.
 */
export async function removeCalendarItemByTitle(
  title: string,
): Promise<boolean> {
  const client = getClient();
  const existing = await getExistingPagesByTitle();
  const pageId = existing.get(title);
  if (!pageId) return false;
  await client.pages.update({ page_id: pageId, archived: true });
  return true;
}

/**
 * Updates a calendar item's week and date, found by matching title.
 * Returns the updated item or null if not found.
 */
export async function rescheduleCalendarItem(
  matchTitle: string,
  newWeek: number,
  newDate: string,
): Promise<boolean> {
  const client = getClient();
  const db = getDatabaseId();
  const existing = await getExistingPagesByTitle();

  // Case-insensitive partial match
  const key = matchTitle.toLowerCase();
  let pageId: string | undefined;
  for (const [title, id] of existing.entries()) {
    if (title.toLowerCase().includes(key)) {
      pageId = id;
      break;
    }
  }
  if (!pageId) return false;

  await client.pages.update({
    page_id: pageId,
    properties: {
      Week: { number: newWeek },
      Date: { date: { start: newDate } },
    },
  });
  void db; // getDatabaseId already validated
  return true;
}
