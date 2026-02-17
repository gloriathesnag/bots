export type BotStatus = "idle" | "running" | "success" | "error";

export interface BotLog {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface Bot {
  id: string;
  name: string;
  description: string;
  status: BotStatus;
  lastRun: string | null;
  logs: BotLog[];
}

export type BotId =
  | "content-strategist"
  | "content-writer"
  | "hubspot-publisher"
  | "performance-analyst";
