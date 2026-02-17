/**
 * Content Strategist Bot
 *
 * Responsibilities:
 * - Analyse Web3 / crypto market trends
 * - Review Snag Solutions product updates and community activity
 * - Generate structured content briefs (topic, angle, target audience, keywords)
 * - Output briefs consumable by the Content Writer bot
 */

import { ContentCalendarItem } from "@/types/bot";

function weekDate(weeksFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + weeksFromNow * 7);
  return d.toISOString().slice(0, 10);
}

export async function runContentStrategist(): Promise<ContentCalendarItem[]> {
  return [
    {
      week: 1,
      date: weekDate(0),
      title: "Snag Solutions Q2 Roadmap: What's Coming in Web3 Loyalty",
      type: "thought-leadership",
      description:
        "High-level look at upcoming product milestones and how they fit the evolving loyalty landscape.",
      channels: "Email + LinkedIn",
    },
    {
      week: 2,
      date: weekDate(1),
      title: "Introducing Snag Rewards 2.0: Deeper Token Utility for Your Community",
      type: "product-launch",
      description:
        "Announce the new rewards engine with embedded token-gating and tiered benefit tiers.",
      channels: "All channels",
    },
    {
      week: 3,
      date: weekDate(2),
      title: "Partner Spotlight: How Pudgy Penguins Grew Engagement 3× with Snag",
      type: "partner-launch",
      description:
        "Case study on NFT collection using Snag to drive secondary-market activity and Discord retention.",
      channels: "X + LinkedIn",
    },
    {
      week: 4,
      date: weekDate(3),
      title: "The State of NFT Loyalty Programs in 2026",
      type: "thought-leadership",
      description:
        "Data-driven report on what separates high-performing loyalty campaigns from the rest.",
      channels: "Email + LinkedIn",
    },
    {
      week: 5,
      date: weekDate(4),
      title: "New Integration: Snag + Shopify Brings Web3 Rewards to E-Commerce",
      type: "partner-launch",
      description:
        "Announce the Shopify connector that lets brands reward on-chain holders with real-world discounts.",
      channels: "All channels",
    },
    {
      week: 6,
      date: weekDate(5),
      title: "Snag Analytics Dashboard: Understand Your On-Chain Loyalty Metrics",
      type: "product-launch",
      description:
        "Feature deep-dive on the new analytics suite — retention curves, wallet cohort analysis, and churn signals.",
      channels: "Email + X",
    },
    {
      week: 7,
      date: weekDate(6),
      title: "Q1 Community Recap: Top-Performing Loyalty Campaigns of the Quarter",
      type: "other",
      description:
        "Celebrate partner wins and surface the tactics that drove the highest engagement scores.",
      channels: "All channels",
    },
    {
      week: 8,
      date: weekDate(7),
      title: "Why Token-Gating Is the Future of Brand Loyalty",
      type: "thought-leadership",
      description:
        "Opinion piece positioning Snag at the intersection of DeFi utility and mainstream CRM.",
      channels: "LinkedIn only",
    },
    {
      week: 9,
      date: weekDate(8),
      title: "Partner Launch: Magic Eden Stores Now Support Snag Reward Quests",
      type: "partner-launch",
      description:
        "Co-announcement with Magic Eden enabling quest-based rewards directly in the marketplace.",
      channels: "All channels",
    },
    {
      week: 10,
      date: weekDate(9),
      title: "Snag Mobile App 2.1: Claim Rewards Anywhere, Any Chain",
      type: "product-launch",
      description:
        "Announce multi-chain support (Ethereum, Solana, Base) and the new push-notification reward alerts.",
      channels: "All channels",
    },
    {
      week: 11,
      date: weekDate(10),
      title: "Customer Story: How [Brand] Generated $500K in Revenue via NFT Loyalty",
      type: "partner-launch",
      description:
        "Long-form case study with ROI data, quotes, and step-by-step implementation breakdown.",
      channels: "Email + LinkedIn",
    },
    {
      week: 12,
      date: weekDate(11),
      title: "Mid-Year Web3 Loyalty Trends: What's Working in 2026",
      type: "thought-leadership",
      description:
        "Trend report synthesising platform data and industry signals to guide H2 planning.",
      channels: "Email + LinkedIn",
    },
  ];
}
