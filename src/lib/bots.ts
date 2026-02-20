import { Bot, BotId } from "@/types/bot";

export const BOT_REGISTRY: Record<BotId, Bot> = {
  "bot-leader": {
    id: "bot-leader",
    name: "Dino",
    role: "Bot Leader",
    description:
      "Orchestrates the entire bot team. Has full visibility across all bots, the content calendar, Linear, and Slack. Assigns tasks to the right bot, surfaces gaps, and posts team-wide status updates in #bot_communication.",
    status: "idle",
    lastRun: null,
    logs: [],
  },
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
    name: "Piggy",
    role: "Content Writer",
    description:
      "Conversational Web3 content writer for Snag Solutions. Triggered when a Notion calendar item is marked Draft. Writes the blog post first, then adapts to newsletter → X thread → LinkedIn — each waiting for explicit approval in #bot_communication before moving on.",
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
  "bot-leader",
  "content-strategist",
  "content-writer",
  "hubspot-publisher",
  "performance-analyst",
];
