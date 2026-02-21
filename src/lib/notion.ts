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

/** A ContentCalendarItem that also carries the Notion page ID and Status. */
export interface ContentCalendarItemWithId extends ContentCalendarItem {
  notionPageId: string;
  notionStatus?: string;
}

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

/**
 * Query a Notion database using a direct fetch to the stable 2022-06-28 API.
 * The @notionhq/client v5 SDK ships with Notion-Version: 2025-09-03 which may
 * not be live yet; using fetch guarantees we hit the stable endpoint.
 */
async function notionQuery(
  db: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, unknown> = {},
): Promise<{ results: any[]; has_more: boolean; next_cursor: string | null }> {
  const key = process.env.NOTION_API_KEY;
  if (!key) throw new Error("NOTION_API_KEY is not set");

  const res = await fetch(`https://api.notion.com/v1/databases/${db}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `Notion query failed ${res.status}: ${JSON.stringify(err)}`,
    );
  }

  return res.json();
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
  const db = getDatabaseId();
  const map = new Map<string, string>();
  let cursor: string | undefined;

  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await notionQuery(db, body);

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
  const db = getDatabaseId();
  const items: ContentCalendarItem[] = [];
  let cursor: string | undefined;

  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await notionQuery(db, body);

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

// ---------------------------------------------------------------------------
// Piggy (Content Writer) — Draft workflow helpers
//
// Requires these additional Notion database properties:
//   Status       — Select  (options: Draft, Blog Pending Review,
//                           Newsletter Pending Review, X Thread Pending Review,
//                           LinkedIn Pending Review, Done)
//   Content link — URL
// ---------------------------------------------------------------------------

/**
 * Returns all calendar items whose Status property equals "Draft".
 * Each item includes its Notion page ID so Piggy can update it later.
 */
export async function fetchDraftCalendarItems(): Promise<
  ContentCalendarItemWithId[]
> {
  const db = getDatabaseId();
  const items: ContentCalendarItemWithId[] = [];
  let cursor: string | undefined;

  do {
    const body: Record<string, unknown> = {
      page_size: 100,
      filter: { property: "Draft", checkbox: { equals: true } },
    };
    if (cursor) body.start_cursor = cursor;
    const res = await notionQuery(db, body);

    for (const page of res.results) {
      if (page.object !== "page") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const props = (page as any).properties;

      const title = (
        (props?.Name?.title ?? []) as { plain_text: string }[]
      )
        .map((t) => t.plain_text)
        .join("")
        .trim();

      if (!title) continue;

      items.push({
        notionPageId: page.id,
        notionStatus: props?.Draft?.checkbox ? "Draft" : undefined,
        week: props?.Week?.number ?? 0,
        date: props?.Date?.date?.start ?? "",
        title,
        type: props?.Type?.select?.name ?? "other",
        description: (
          (props?.Description?.rich_text ?? []) as { plain_text: string }[]
        )
          .map((t) => t.plain_text)
          .join("")
          .trim(),
        channels: props?.Channels?.select?.name ?? "All channels",
        fromLinear: props?.Source?.select?.name === "Linear",
      });
    }

    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return items;
}

/**
 * Updates the Status select property on a Notion page.
 * Valid values: "Draft" | "Blog Pending Review" | "Newsletter Pending Review"
 *             | "X Thread Pending Review" | "LinkedIn Pending Review" | "Done"
 */
/**
 * Marks a calendar item as fully done by unchecking its Draft checkbox.
 * Sub-stage transitions (Blog → Newsletter → …) are tracked in Slack only
 * because the database uses a simple Draft checkbox rather than a Status select.
 */
export async function updateCalendarItemStatus(
  pageId: string,
  status: string,
): Promise<void> {
  // Only touch Notion when the full pipeline is complete
  if (status !== "Done") return;
  const client = getClient();
  await client.pages.update({
    page_id: pageId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: { Draft: { checkbox: false } } as any,
  });
}

/**
 * Sets the "Content link" URL property on a Notion page to the Google Doc URL.
 */
export async function updateCalendarItemContentLink(
  pageId: string,
  url: string,
): Promise<void> {
  const client = getClient();
  await client.pages.update({
    page_id: pageId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: { "Content Link": { rich_text: [{ text: { content: url } }] } } as any,
  });
}
