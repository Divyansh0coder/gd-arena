import { z } from "zod";

/** Scoring dimensions. */
export const Dimension = z.enum([
  "content", "communication", "listening", "initiation",
  "relevance", "counterarguments", "time_management", "conclusion",
  "starting_strong", "idea_quality", "building_on_others", "interruptions",
  "speaking_balance", "closing_strong", "overall_performance",
]);
export type Dimension = z.infer<typeof Dimension>;

/** What produced a score: code (measured), the LLM (ai), or both (mixed). */
export const ScoreBasis = z.enum(["measured", "ai", "mixed"]);

export const SkillScore = z.object({
  dimension: Dimension,
  label: z.string().optional(),
  score: z.number().int().min(0).max(100),
  basis: ScoreBasis,
});
export type SkillScore = z.infer<typeof SkillScore>;

/**
 * Evidence-based Feedback Item:
 * Linked to an actual transcript segment ID and quote.
 */
export const FeedbackItem = z.object({
  dimension: Dimension,
  severity: z.enum(["good", "warn", "bad"]),
  text: z.string().min(1).max(1000),
  whatHappened: z.string().optional(),
  whyItMatters: z.string().optional(),
  howToImprove: z.string().optional(),
  segmentId: z.number().int().nonnegative(),
  quote: z.string().min(1).max(500),
  tMs: z.number().int().nonnegative(),
  speaker: z.string().optional(),
});
export type FeedbackItem = z.infer<typeof FeedbackItem>;

export const Metrics = z.object({
  durationSec: z.number().int().nonnegative().optional(),
  studentSpeakingMs: z.number().int().nonnegative().optional(),
  speakingShare: z.number().min(0).max(1),
  speakingRatioPercent: z.number().min(0).max(100).optional(),
  words: z.number().int().nonnegative(),
  turns: z.number().int().nonnegative(),
  aiTurnCount: z.number().int().nonnegative().optional(),
  firstSpeakMs: z.number().int().nonnegative().nullable(),
  interruptionsMade: z.number().int().nonnegative(),
  responseCount: z.number().int().nonnegative().optional(),
  longestSilenceMs: z.number().int().nonnegative(),
  avgResponseGapMs: z.number().int().nonnegative().optional(),
  participatedInClosing: z.boolean().optional(),
});
export type Metrics = z.infer<typeof Metrics>;

export const MissedOpportunity = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  segmentId: z.number().int().nonnegative(),
  contextSegmentIds: z.array(z.number().int().nonnegative()).default([]),
  tMs: z.number().int().nonnegative(),
  dimension: Dimension,
  whatHappened: z.string().min(1),
  whyItMatters: z.string().min(1),
  candidateQuote: z.string().min(1),
  contextQuote: z.string().optional(),
  suggestedResponse: z.string().min(1),
  howToImprove: z.string().optional(),
});
export type MissedOpportunity = z.infer<typeof MissedOpportunity>;

export const RetryAttempt = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  opportunityId: z.string().min(1),
  originalSegmentId: z.number().int().nonnegative(),
  originalResponse: z.string().min(1),
  originalScore: z.number().int().min(0).max(100),
  retryResponse: z.string().min(1),
  retryTimestamp: z.number().int().nonnegative(),
  retryScore: z.number().int().min(0).max(100),
  scoreDiff: z.number().int(),
  improvements: z.array(z.string()),
  dimension: Dimension,
});
export type RetryAttempt = z.infer<typeof RetryAttempt>;

export const Report = z.object({
  sessionId: z.string(),
  topic: z.string().optional(),
  metrics: Metrics,
  scores: z.array(SkillScore),
  items: z.array(FeedbackItem),
  missedOpportunities: z.array(MissedOpportunity).optional().default([]),
  droppedItems: z.number().int().nonnegative(),
});
export type Report = z.infer<typeof Report>;


