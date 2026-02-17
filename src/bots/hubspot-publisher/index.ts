/**
 * HubSpot Publisher Bot
 *
 * Responsibilities:
 * - Receive approved DraftContent from the Content Writer bot
 * - Create or update HubSpot blog posts via the HubSpot CMS API
 * - Set SEO metadata, featured images, and publish schedule
 * - Transition posts through HubSpot workflow states (draft → scheduled → published)
 *
 * TODO: implement using the @hubspot/api-client SDK with HUBSPOT_API_KEY env var
 */

import { DraftContent } from "@/bots/content-writer";

export interface PublishResult {
  hubspotPostId: string;
  url: string;
  publishedAt: string;
  status: "draft" | "scheduled" | "published";
}

export async function runHubSpotPublisher(
  content: DraftContent,
): Promise<PublishResult> {
  void content; // consumed by future implementation
  throw new Error("HubSpot Publisher bot not yet implemented.");
}
