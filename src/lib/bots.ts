import { Bot, BotId } from "@/types/bot";

export const BOT_REGISTRY: Record<BotId, Bot> = {
  "content-strategist": {
    id: "content-strategist",
    name: "Nova",
    role: "Content Strategist",
    description:
      "Analyzes market trends and Web3 loyalty data to generate content briefs and campaign strategies for Snag Solutions.",
    status: "idle",
    lastRun: null,
    logs: [],
  },
  "content-writer": {
    id: "content-writer",
    name: "Content Writer",
    description:
      "Transforms strategy briefs into polished blog posts, social copy, and email narratives aligned with Snag's brand voice.",
    status: "idle",
    lastRun: null,
    logs: [],
  },
  "hubspot-publisher": {
    id: "hubspot-publisher",
    name: "HubSpot Publisher",
    description:
      "Publishes approved content directly to HubSpot CMS, sets metadata, schedules posts, and manages workflow states.",
    status: "idle",
    lastRun: null,
    logs: [],
  },
  "performance-analyst": {
    id: "performance-analyst",
    name: "Performance Analyst",
    description:
      "Pulls HubSpot analytics and on-chain engagement metrics to score content performance and surface optimisation insights.",
    status: "idle",
    lastRun: null,
    logs: [],
  },
};

export const BOT_ORDER: BotId[] = [
  "content-strategist",
  "content-writer",
  "hubspot-publisher",
  "performance-analyst",
];
