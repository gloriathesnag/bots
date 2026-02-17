/**
 * Nova — Content Strategist Bot
 *
 * Responsibilities:
 * - Read recent product and partner announcements from Slack #announcements
 * - Generate a 12-week content calendar that prioritises real launch signals
 * - Fill remaining weeks with evergreen thought-leadership and campaign content
 * - Output briefs consumable by the Content Writer bot
 */

import { ContentCalendarItem, Channel } from "@/types/bot";
import { fetchAnnouncementSignals, SlackSignal } from "@/lib/slack";

function addWeeks(baseDate: Date, weeks: number): string {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

/** Trim Slack message text to a usable headline (first sentence / 80 chars). */
function toHeadline(text: string): string {
  const first = text.split(/[\n.!?]/)[0].trim();
  return first.length > 80 ? first.slice(0, 77) + "…" : first;
}

function channelForType(type: SlackSignal["type"]): Channel {
  return type === "partner-launch" ? "All channels" : "Email + X";
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

export async function runContentStrategist(): Promise<ContentCalendarItem[]> {
  const today = new Date();
  const calendar: ContentCalendarItem[] = [];

  // --- 1. Pull real signals from Slack #announcements ---
  let signals: SlackSignal[] = [];
  try {
    signals = await fetchAnnouncementSignals();
    // Most recent first; cap at 4 so Slack signals don't crowd out planned content
    signals = signals.slice(0, 4);
  } catch {
    // If Slack is unreachable (e.g. missing env vars in dev), continue with evergreen content
    signals = [];
  }

  // --- 2. Slot Slack-derived items into the first available weeks ---
  for (const signal of signals) {
    const week = calendar.length + 1;
    calendar.push({
      week,
      date: addWeeks(today, week - 1),
      title: toHeadline(signal.text),
      type: signal.type,
      description: `Content inspired by the ${signal.date} announcement in #announcements. Expand with product context and customer angle.`,
      channels: channelForType(signal.type),
      fromSlack: true,
    });
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
