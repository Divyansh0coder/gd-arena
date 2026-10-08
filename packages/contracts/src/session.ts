import { z } from "zod";

/** PRD §10: moderator + up to 3 AI personas for the MVP (4th/5th are P1/P2). */
export const PersonaKey = z.enum(["moderator", "arjun", "meera", "kabir"]);
export type PersonaKey = z.infer<typeof PersonaKey>;

/** PRD §11 state machine. */
export const SessionStatus = z.enum(["lobby", "opening", "discussion", "closing", "ended"]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const Topic = z.object({
  id: z.string().min(1),
  title: z.string().min(5).max(200),
  category: z.string().min(1),
});
export type Topic = z.infer<typeof Topic>;

/** PRD §15 POST /api/sessions. panelSize = number of AI participants (moderator extra). */
export const SessionConfig = z.object({
  topic: z.string().trim().min(5).max(200),
  panelSize: z.number().int().min(3).max(5),
  durationSec: z.number().int().min(180).max(600),
  patienceMs: z.number().int().min(600).max(2500).default(1200),
});
export type SessionConfig = z.infer<typeof SessionConfig>;

/** A finalised unit of speech. The root of the evidence chain (PRD §14). */
export const TranscriptSegment = z.object({
  id: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  speaker: PersonaKey.or(z.literal("student")),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string().min(1),
  interrupted: z.boolean().default(false),
  source: z.enum(["stt", "llm", "typed"]),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegment>;
