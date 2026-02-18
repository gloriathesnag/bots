/**
 * Nova — Content Strategist Bot
 *
 * Responsibilities:
 * - Read upcoming and completed tickets/epics from Linear
 * - Generate a 12-week content calendar that prioritises real launch signals
 * - Fill remaining weeks with evergreen thought-leadership and campaign content
 * - Output briefs consumable by the Content Writer bot
 */

import { ContentCalendarItem, Channel } from "@/types/bot";
import { fetchLinearSignals, LinearSignal } from "@/lib/linear";
import { findChannelId, fetchApprovedAnnouncements } from "@/lib/slack";

function addWeeks(baseDate: Date, weeks: number): string {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

function channelForType(type: LinearSignal["type"]): Channel {
  return type === "partner-launch" ? "All channels" : "Email + X";
}

function linearItemToCalendarEntry(
  signal: LinearSignal,
  week: number,
  date: string,
): ContentCalendarItem {
  const isCompleted = signal.state === "Done" || signal.completedAt != null;
  const prefix = isCompleted ? "Launch Recap: " : "Coming Soon: ";
  return {
    week,
    date,
    title: `${prefix}${signal.title}`,
    type: signal.type === "other" ? "product-launch" : signal.type,
    description: `Sourced from Linear (${signal.state}). ${
      signal.description
        ? signal.description.slice(0, 120).trimEnd() + "…"
        : "Expand with product context and customer angle."
    }`,
    channels: channelForType(signal.type),
    fromLinear: true,
  };
}

const EVERGREEN_ITEMS: Omit<ContentCalendarItem, "week" | "date">[] = [
  {
    title: "Snag Solutions Q2 Roadmap: What's Coming in Web3 Loyalty",
    type: "thought-leadership",
    description:
      "High-level look at upcoming product milestones and how they fit the evolving loyalty landscape.",
    channels: "Email + LinkedIn",
  },
  {
    title: "The State of NFT Loyalty Programs in 2026",
    type: "thought-leadership",
    description:
      "Data-driven report on what separates high-performing loyalty campaigns from the rest.",
    channels: "Email + LinkedIn",
  },
  {
    title: "Snag Analytics Dashboard: Understand Your On-Chain Loyalty Metrics",
    type: "product-launch",
    description:
      "Feature deep-dive on the new analytics suite — retention curves, wallet cohort analysis, and churn signals.",
    channels: "Email + X",
  },
  {
    title: "Q1 Community Recap: Top-Performing Loyalty Campaigns of the Quarter",
    type: "other",
    description:
      "Celebrate partner wins and surface the tactics that drove the highest engagement scores.",
    channels: "All channels",
  },
  {
    title: "Why Token-Gating Is the Future of Brand Loyalty",
    type: "thought-leadership",
    description:
      "Opinion piece positioning Snag at the intersection of DeFi utility and mainstream CRM.",
    channels: "LinkedIn only",
  },
  {
    title: "Snag Mobile App 2.1: Claim Rewards Anywhere, Any Chain",
    type: "product-launch",
    description:
      "Announce multi-chain support (Ethereum, Solana, Base) and new push-notification reward alerts.",
    channels: "All channels",
  },
  {
    title: "Customer Story: How [Brand] Generated $500K in Revenue via NFT Loyalty",
    type: "partner-launch",
    description:
      "Long-form case study with ROI data, quotes, and step-by-step implementation breakdown.",
    channels: "Email + LinkedIn",
  },
  {
    title: "Mid-Year Web3 Loyalty Trends: What's Working in 2026",
    type: "thought-leadership",
    description:
      "Trend report synthesising platform data and industry signals to guide H2 planning.",
    channels: "Email + LinkedIn",
  },
  {
    title: "New Integration: Snag + Shopify Brings Web3 Rewards to E-Commerce",
    type: "partner-launch",
    description:
      "Announce the Shopify connector that lets brands reward on-chain holders with real-world discounts.",
    channels: "All channels",
  },
  {
    title: "Introducing Snag Rewards 2.0: Deeper Token Utility for Your Community",
    type: "product-launch",
    description:
      "Announce the new rewards engine with embedded token-gating and tiered benefit tiers.",
    channels: "All channels",
  },
  {
    title: "Partner Spotlight: How Pudgy Penguins Grew Engagement 3× with Snag",
    type: "partner-launch",
    description:
      "Case study on NFT collection using Snag to drive secondary-market activity and Discord retention.",
    channels: "X + LinkedIn",
  },
  {
    title: "Partner Launch: Magic Eden Stores Now Support Snag Reward Quests",
    type: "partner-launch",
    description:
      "Co-announcement with Magic Eden enabling quest-based rewards directly in the marketplace.",
    channels: "All channels",
  },
];

/** A single content brief passed from Nova to the Content Writer bot. */
export type ContentBrief = ContentCalendarItem;

export async function runContentStrategist(): Promise<ContentCalendarItem[]> {
  const today = new Date();
  const calendar: ContentCalendarItem[] = [];

  // --- 0. Pull Nova-approved partner announcements from #bot_announcements ---
  // These are queued by Nova's Slack workflow and take priority in the calendar.
  try {
    const channelId = await findChannelId("bot_announcements");
    if (channelId) {
      const approved = await fetchApprovedAnnouncements(channelId);
      // Slot approved announcements first (up to 3, newest last in Slack = first in slice)
      for (const item of approved.slice(0, 3)) {
        const week = calendar.length + 1;
        calendar.push({ ...item, week, date: addWeeks(today, week - 1) });
      }
    }
  } catch {
    // Slack unreachable or not configured — continue without
  }

  // --- 1. Pull tickets and epics from Linear ---
  let linearSignals: LinearSignal[] = [];
  try {
    const all = await fetchLinearSignals();
    // Prefer product-launch / partner-launch tickets; cap at 3 slots
    linearSignals = all
      .filter((s) => s.type !== "other")
      .slice(0, 3);
  } catch {
    // If Linear is unreachable (e.g. missing API key in dev), continue without
    linearSignals = [];
  }

  // --- 2. Slot Linear tickets into the first available weeks ---
  for (const signal of linearSignals) {
    const week = calendar.length + 1;
    calendar.push(linearItemToCalendarEntry(signal, week, addWeeks(today, week - 1)));
  }

  // --- 3. Fill remaining weeks (up to 12) with evergreen planned content ---
  const evergreenQueue = [...EVERGREEN_ITEMS];
  while (calendar.length < 12 && evergreenQueue.length > 0) {
    const item = evergreenQueue.shift()!;
    const week = calendar.length + 1;
    calendar.push({ week, date: addWeeks(today, week - 1), ...item });
  }

  return calendar;
}
