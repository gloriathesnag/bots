import { NextResponse } from "next/server";

/**
 * GET /api/debug/notion
 *
 * Quick connection test — returns what the Notion API actually says.
 * Only used for debugging; safe to delete once Notion is confirmed working.
 */
export async function GET() {
  const apiKey = process.env.NOTION_API_KEY;
  const dbId = process.env.NOTION_DATABASE_ID;

  if (!apiKey || !dbId) {
    return NextResponse.json({
      ok: false,
      error: "Missing env vars",
      hasApiKey: !!apiKey,
      hasDatabaseId: !!dbId,
    });
  }

  try {
    const res = await fetch(
      `https://api.notion.com/v1/databases/${dbId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page_size: 1 }),
      },
    );

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        httpStatus: res.status,
        notionError: data,
        databaseIdUsed: dbId,
      });
    }

    return NextResponse.json({
      ok: true,
      totalResults: (data.results as unknown[]).length,
      hasMore: data.has_more,
      databaseIdUsed: dbId,
      firstPageId: data.results[0]?.id ?? null,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
