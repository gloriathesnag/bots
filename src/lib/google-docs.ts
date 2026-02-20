/**
 * Google Docs / Drive integration for Piggy (Content Writer bot)
 *
 * Creates draft documents in the configured Drive folder and returns their
 * public edit URL. Uses a service account — no OAuth redirect required.
 *
 * Required environment variables:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL   — from the downloaded service account JSON
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY — the private_key field (with real \n)
 *
 * Setup: see GOOGLE_SETUP.md for step-by-step instructions.
 *
 * The target folder ID is hard-coded to the Snag content drafts folder.
 * Share that folder with the service account email to grant write access.
 */

import { google } from "googleapis";

// Snag content drafts folder
// https://drive.google.com/drive/folders/1WFqg4vMdzcOFYRlxzfB2ncI0Tdpk43vN
const DRAFTS_FOLDER_ID = "1WFqg4vMdzcOFYRlxzfB2ncI0Tdpk43vN";

export function isGoogleDocsConfigured(): boolean {
  return !!(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  );
}

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      // Vercel stores newlines as literal \n — restore them
      private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(
        /\\n/g,
        "\n",
      ),
    },
    scopes: [
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive",
    ],
  });
}

export interface CreateDraftDocOpts {
  /** Calendar item title, e.g. "ApeChain TGE Launch" */
  title: string;
  /** ISO date string YYYY-MM-DD */
  date: string;
  /** "blog" | "newsletter" | "x-thread" | "linkedin" */
  stage: string;
  /** Full draft content as plain text */
  content: string;
  /** Name of the person who should review */
  reviewerName: string;
}

/**
 * Creates a new Google Doc with the draft content and moves it into the
 * configured Drive folder. Returns the doc's edit URL.
 */
export async function createDraftDoc(
  opts: CreateDraftDocOpts,
): Promise<string> {
  const auth = getAuth();
  const docs = google.docs({ version: "v1", auth });
  const drive = google.drive({ version: "v3", auth });

  const stageLabel =
    {
      blog: "Blog",
      newsletter: "Newsletter",
      "x-thread": "X Thread",
      linkedin: "LinkedIn",
    }[opts.stage] ?? opts.stage;

  const docTitle = `${opts.title} | ${opts.date} | ${stageLabel}`;

  // Create the empty document
  const created = await docs.documents.create({
    requestBody: { title: docTitle },
  });
  const docId = created.data.documentId!;

  // Build the full document text
  const header = `DRAFT — Pending Review by ${opts.reviewerName}. Do not publish.\n\n`;
  const body = opts.content;
  const fullText = header + body;

  // Insert content via batchUpdate
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text: fullText,
          },
        },
      ],
    },
  });

  // Move the file into the drafts folder
  // First get the current parents so we can remove them
  const fileMeta = await drive.files.get({
    fileId: docId,
    fields: "parents",
  });
  const currentParents = (fileMeta.data.parents ?? []).join(",");

  await drive.files.update({
    fileId: docId,
    addParents: DRAFTS_FOLDER_ID,
    removeParents: currentParents,
    requestBody: {},
    fields: "id, parents",
  });

  return `https://docs.google.com/document/d/${docId}/edit`;
}

/**
 * Reads the plain text content of an existing Google Doc by its URL.
 * Used to fetch the approved blog post when adapting it for other channels.
 */
export async function getDocContent(docUrl: string): Promise<string> {
  const match = docUrl.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error(`Cannot parse doc ID from URL: ${docUrl}`);
  const docId = match[1];

  const auth = getAuth();
  const docs = google.docs({ version: "v1", auth });
  const doc = await docs.documents.get({ documentId: docId });

  // Extract plain text from the document body
  const text: string[] = [];
  for (const el of doc.data.body?.content ?? []) {
    for (const pEl of el.paragraph?.elements ?? []) {
      if (pEl.textRun?.content) {
        text.push(pEl.textRun.content);
      }
    }
  }
  return text.join("");
}
