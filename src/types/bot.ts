export type BotStatus = "idle" | "running" | "success" | "error";

export interface BotLog {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

export type ContentType =
  | "product-launch"
  | "partner-launch"
  | "thought-leadership"
  | "other";

export type Channel =
  | "Email only"
  | "X only"
  | "LinkedIn only"
  | "X + LinkedIn"
  | "Email + X"
  | "Email + LinkedIn"
  | "All channels";

export interface ContentCalendarItem {
  week: number;
  date: string; // YYYY-MM-DD
  title: string;
  type: ContentType;
  description: string;
  channels: Channel;
  fromLinear?: boolean; // true when derived from a Linear ticket
}

export interface Bot {
  id: string;
  name: string;
  role?: string;
  description: string;
  status: BotStatus;
  lastRun: string | null;
  logs: BotLog[];
  calendarOutput?: ContentCalendarItem[];
}

export type BotId =
  | "content-strategist"
  | "content-writer"
  | "hubspot-publisher"
  | "performance-analyst";
