/**
 * Linear API integration for Nova (Content Strategist).
 *
 * Reads project tickets and epics via Linear's GraphQL API and surfaces
 * upcoming / recently completed feature launches as content opportunities.
 *
 * Required env var:
 *   LINEAR_API_KEY — a personal or workspace API key from Linear settings.
 */

const LINEAR_API = "https://api.linear.app/graphql";

export interface LinearSignal {
  id: string;
  title: string;
  description: string | null;
  state: string; // e.g. "In Progress", "Done"
  completedAt: string | null; // ISO date string
  type: "product-launch" | "partner-launch" | "other";
  source: "linear";
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

const PARTNER_KEYWORDS = [
  "partner",
  "partnership",
  "integration",
  "collaboration",
  "co-",
  "third-party",
  "api connector",
  "marketplace",
];

const PRODUCT_KEYWORDS = [
  "launch",
  "release",
  "ship",
  "feature",
  "v2",
  "v3",
  "new",
  "redesign",
  "revamp",
  "rollout",
  "milestone",
  "epic",
];

function classify(title: string, description: string | null): LinearSignal["type"] {
  const haystack = `${title} ${description ?? ""}`.toLowerCase();
  if (PARTNER_KEYWORDS.some((kw) => haystack.includes(kw))) return "partner-launch";
  if (PRODUCT_KEYWORDS.some((kw) => haystack.includes(kw))) return "product-launch";
  return "other";
}

// ---------------------------------------------------------------------------
// GraphQL query — fetch in-progress + recently completed issues
// ---------------------------------------------------------------------------

const ISSUES_QUERY = `
  query ContentSignals($completedAfter: DateTime) {
    issues(
      filter: {
        or: [
          { state: { type: { in: ["started"] } } }
          {
            state: { type: { in: ["completed"] } }
            completedAt: { gt: $completedAfter }
          }
        ]
      }
      first: 50
      orderBy: updatedAt
    ) {
      nodes {
        id
        title
        description
        completedAt
        state {
          name
        }
      }
    }
  }
`;

async function graphql<T>(query: string, variables: Record<string, unknown>, apiKey: string): Promise<T> {
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Linear API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };

  if (json.errors?.length) {
    throw new Error(`Linear GraphQL error: ${json.errors.map((e) => e.message).join(", ")}`);
  }

  return json.data as T;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch in-progress tickets and recently completed epics/features from Linear.
 * Returns them classified as content signals Nova can slot into the calendar.
 */
export async function fetchLinearSignals(): Promise<LinearSignal[]> {
  const apiKey = process.env.LINEAR_API_KEY;

  if (!apiKey) {
    throw new Error("Missing LINEAR_API_KEY environment variable.");
  }

  // Look back 60 days for completed work
  const completedAfter = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  const data = await graphql<{
    issues: { nodes: { id: string; title: string; description: string | null; completedAt: string | null; state: { name: string } }[] };
  }>(ISSUES_QUERY, { completedAfter }, apiKey);

  return data.issues.nodes.map((issue) => ({
    id: issue.id,
    title: issue.title,
    description: issue.description,
    state: issue.state.name,
    completedAt: issue.completedAt,
    type: classify(issue.title, issue.description),
    source: "linear" as const,
  }));
}
