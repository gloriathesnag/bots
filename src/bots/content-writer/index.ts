/**
 * Content Writer Bot
 *
 * Responsibilities:
 * - Accept a ContentBrief from the Content Strategist bot
 * - Draft blog posts, social captions, and email copy in Snag's brand voice
 * - Return structured content ready for review / publishing
 *
 * TODO: implement with an LLM call using the brief as a system prompt context
 */

import { ContentBrief } from "@/bots/content-strategist";

export interface DraftContent {
  briefTitle: string;
  blogPost: string;
  socialCaption: string;
  emailSnippet: string;
}

export async function runContentWriter(
  brief: ContentBrief,
): Promise<DraftContent> {
  void brief; // consumed by future implementation
  throw new Error("Content Writer bot not yet implemented.");
}
