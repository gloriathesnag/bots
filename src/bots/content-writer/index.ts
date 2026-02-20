/**
 * Piggy — Content Writer Bot
 *
 * Triggered manually from Mission Control (Run button) or by Dino.
 * Scans Notion for calendar items with Status = "Draft", then drives each
 * one through a multi-stage content pipeline:
 *
 *   Draft → Blog Pending Review → Newsletter Pending Review
 *         → X Thread Pending Review → LinkedIn Pending Review → Done
 *
 * Each stage:
 *   1. Generates content via Claude (in Snag's exact voice)
 *   2. Creates a Google Doc in the configured drafts folder
 *   3. Updates the Notion page (Status + Content link)
 *   4. Posts to #bot_communication with the doc link and a machine-readable
 *      piggy:draft:{...} prefix so the Slack events handler can route approvals
 *
 * Approvals happen in #bot_communication. The Slack events handler calls
 * advancePiggyToNextStage() when it detects an approval reply.
 */

import {
  generateBlogPost,
  generateNewsletter,
  generateXThread,
  generateLinkedInPost,
  type ContentBrief,
} from "@/lib/anthropic";
import {
  createDraftDoc,
  getDocContent,
  isGoogleDocsConfigured,
} from "@/lib/google-docs";
import {
  isNotionConfigured,
  fetchDraftCalendarItems,
  updateCalendarItemStatus,
  updateCalendarItemContentLink,
  type ContentCalendarItemWithId,
} from "@/lib/notion";
import { getSlackClient, findChannelId } from "@/lib/slack";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export type PiggyStage =
  | "blog"
  | "newsletter"
  | "x-thread"
  | "linkedin";

export interface PiggyDraftPayload {
  notionPageId: string;
  stage: PiggyStage;
  title: string;
  /** URL of the approved blog doc — populated for newsletter/x-thread/linkedin stages */
  blogDocUrl?: string;
}

export const PIGGY_DRAFT_PREFIX = "piggy:draft:";

const STAGE_STATUS: Record<PiggyStage, string> = {
  blog: "Blog Pending Review",
  newsletter: "Newsletter Pending Review",
  "x-thread": "X Thread Pending Review",
  linkedin: "LinkedIn Pending Review",
};

const STAGE_LABEL: Record<PiggyStage, string> = {
  blog: "Blog Post",
  newsletter: "Newsletter",
  "x-thread": "X Thread",
  linkedin: "LinkedIn Post",
};

const STAGE_ORDER: PiggyStage[] = [
  "blog",
  "newsletter",
  "x-thread",
  "linkedin",
];

function nextStage(current: PiggyStage): PiggyStage | "done" {
  const idx = STAGE_ORDER.indexOf(current);
  return idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : "done";
}

function reviewerName(): string {
  return process.env.REVIEWER_NAME ?? "Team";
}

// ---------------------------------------------------------------------------
// runContentWriter — entry point from Mission Control "Run" button
// ---------------------------------------------------------------------------

/**
 * Scans Notion for items with Status = "Draft", generates a blog post for
 * each, posts to Slack, and transitions Notion status to "Blog Pending Review".
 *
 * Returns a summary string for the Mission Control logs.
 */
export async function runContentWriter(): Promise<string> {
  if (!isNotionConfigured()) {
    return "⚠️ Notion is not configured — add NOTION_API_KEY and NOTION_DATABASE_ID.";
  }

  let drafts: ContentCalendarItemWithId[] = [];
  try {
    drafts = await fetchDraftCalendarItems();
  } catch (err) {
    console.error("[Piggy] Failed to fetch draft items from Notion:", err);
    return "⚠️ Could not read Notion calendar. Check NOTION_API_KEY and NOTION_DATABASE_ID.";
  }

  if (drafts.length === 0) {
    return "📋 No items with Status = \"Draft\" found in Notion. Mark a calendar item as Draft to queue it for Piggy.";
  }

  const results: string[] = [];

  for (const item of drafts) {
    try {
      await generateAndPostDraft(item, "blog");
      results.push(`✅ Blog draft started for: "${item.title}"`);
    } catch (err) {
      console.error(`[Piggy] Error drafting "${item.title}":`, err);
      results.push(`❌ Error on "${item.title}": ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  return results.join("\n");
}

// ---------------------------------------------------------------------------
// advancePiggyToNextStage — called from Slack approval handler
// ---------------------------------------------------------------------------

/**
 * Called when the user approves a Piggy draft in #bot_communication.
 * Advances to the next stage (or marks Done if all stages are complete).
 */
export async function advancePiggyToNextStage(
  payload: PiggyDraftPayload,
): Promise<void> {
  const next = nextStage(payload.stage);

  if (next === "done") {
    // All stages approved — mark Done in Notion and celebrate
    await updateCalendarItemStatus(payload.notionPageId, "Done");
    await postToSlack(
      `✨ *"${payload.title}"* is done! All formats approved — blog, newsletter, X thread, and LinkedIn are ready to publish.`,
    );
    return;
  }

  // Fetch the item from Notion to get the brief
  let item: ContentCalendarItemWithId | undefined;
  try {
    const { fetchDraftCalendarItems: fetchAll } = await import("@/lib/notion");
    // Can't filter by pageId cheaply — fetch by status and find our page
    // Instead, re-read Notion for the specific page via pages.retrieve
    const { Client } = await import("@notionhq/client");
    const client = new Client({ auth: process.env.NOTION_API_KEY });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = await (client.pages.retrieve as any)({ page_id: payload.notionPageId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props = (page as any).properties;
    item = {
      notionPageId: payload.notionPageId,
      notionStatus: props?.Status?.select?.name,
      week: props?.Week?.number ?? 0,
      date: props?.Date?.date?.start ?? "",
      title: ((props?.Name?.title ?? []) as { plain_text: string }[])
        .map((t: { plain_text: string }) => t.plain_text).join("").trim(),
      type: props?.Type?.select?.name ?? "other",
      description: ((props?.Description?.rich_text ?? []) as { plain_text: string }[])
        .map((t: { plain_text: string }) => t.plain_text).join("").trim(),
      channels: props?.Channels?.select?.name ?? "All channels",
      fromLinear: props?.Source?.select?.name === "Linear",
    };
    void fetchAll; // imported but used differently above
  } catch (err) {
    console.error("[Piggy] Could not re-fetch Notion page:", err);
    await postToSlack(
      `⚠️ Piggy couldn't read the Notion page for "${payload.title}" — please check NOTION_API_KEY.`,
    );
    return;
  }

  // For non-blog stages, get the approved blog content to adapt from
  let blogContent = "";
  if (next !== "blog" && payload.blogDocUrl) {
    try {
      if (isGoogleDocsConfigured()) {
        blogContent = await getDocContent(payload.blogDocUrl);
      }
    } catch (err) {
      console.warn("[Piggy] Could not fetch blog doc content:", err);
      // Fall through — Claude will generate from brief alone
    }
  }

  await generateAndPostDraft(item, next, payload.blogDocUrl, blogContent || undefined);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function generateAndPostDraft(
  item: ContentCalendarItemWithId,
  stage: PiggyStage,
  existingBlogDocUrl?: string,
  blogContent?: string,
): Promise<void> {
  const brief: ContentBrief = {
    title: item.title,
    type: item.type,
    description: item.description,
    channels: item.channels,
    date: item.date,
  };

  // Generate content
  let content: string;
  if (stage === "blog") {
    content = await generateBlogPost(brief);
  } else if (stage === "newsletter") {
    content = await generateNewsletter(blogContent ?? `Brief: ${item.description}`, brief);
  } else if (stage === "x-thread") {
    content = await generateXThread(blogContent ?? `Brief: ${item.description}`, brief);
  } else {
    content = await generateLinkedInPost(blogContent ?? `Brief: ${item.description}`, brief);
  }

  // Create Google Doc (or fall back to Slack-only if not configured)
  let docUrl: string | undefined;
  if (isGoogleDocsConfigured()) {
    try {
      docUrl = await createDraftDoc({
        title: item.title,
        date: item.date || new Date().toISOString().slice(0, 10),
        stage,
        content,
        reviewerName: reviewerName(),
      });
    } catch (err) {
      console.error("[Piggy] Google Docs creation failed:", err);
      // Continue without a doc — content goes into Slack message
    }
  }

  // Update Notion
  await updateCalendarItemStatus(item.notionPageId, STAGE_STATUS[stage]);
  if (docUrl) {
    await updateCalendarItemContentLink(item.notionPageId, docUrl);
  }

  // Determine the blogDocUrl to carry through subsequent stages
  const blogDocUrl =
    stage === "blog" ? docUrl : existingBlogDocUrl;

  // Build the machine-readable payload (stored in Slack message text)
  const payload: PiggyDraftPayload = {
    notionPageId: item.notionPageId,
    stage,
    title: item.title,
    blogDocUrl,
  };

  // Post to #bot_communication
  const slack = getSlackClient();
  const channelId = await findChannelId("bot_communication");
  if (!channelId) {
    console.warn("[Piggy] #bot_communication channel not found.");
    return;
  }

  const stageLabel = STAGE_LABEL[stage];
  const nextLabel = nextStage(stage) === "done"
    ? "all done"
    : STAGE_LABEL[nextStage(stage) as PiggyStage];

  // Content preview for Slack (truncated)
  const preview = content.slice(0, 300).replace(/\n+/g, " ").trim() + "…";

  const blocks = [
    {
      type: "section" as const,
      text: {
        type: "mrkdwn" as const,
        text: `✍️ *Piggy — ${stageLabel} Draft Ready*\n\n*"${item.title}"*`,
      },
    },
    ...(docUrl
      ? [
          {
            type: "section" as const,
            text: {
              type: "mrkdwn" as const,
              text: `📄 <${docUrl}|Open in Google Docs>`,
            },
          },
        ]
      : [
          {
            type: "section" as const,
            text: {
              type: "mrkdwn" as const,
              text: `_Google Docs not configured — preview below:_\n\`\`\`${preview}\`\`\``,
            },
          },
        ]),
    {
      type: "context" as const,
      elements: [
        {
          type: "mrkdwn" as const,
          text: `Reply *approved* (or ✅) in this thread to advance to ${nextLabel}.`,
        },
      ],
    },
  ];

  await slack.chat.postMessage({
    channel: channelId,
    // Machine-readable prefix used by the Slack events handler to detect approvals
    text: `${PIGGY_DRAFT_PREFIX}${JSON.stringify(payload)}`,
    blocks,
  });
}

async function postToSlack(message: string): Promise<void> {
  try {
    const slack = getSlackClient();
    const channelId = await findChannelId("bot_communication");
    if (channelId) {
      await slack.chat.postMessage({ channel: channelId, text: message });
    }
  } catch (err) {
    console.warn("[Piggy] Could not post to Slack:", err);
  }
}
