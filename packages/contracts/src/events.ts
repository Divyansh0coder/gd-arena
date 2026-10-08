import { z } from "zod";
import { PersonaKey, SessionStatus } from "./session";

const t = z.number().int().nonnegative(); // ms since session start, server clock

/** Server -> client (PRD §15). */
export const ServerEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session_started"), tMs: t, data: z.object({ sessionId: z.string(), status: SessionStatus }) }),
  z.object({ type: z.literal("timer_update"), tMs: t, data: z.object({ remainingSec: z.number().int(), status: SessionStatus }) }),
  z.object({ type: z.literal("participant_selected"), tMs: t, data: z.object({ speaker: PersonaKey }) }),
  z.object({ type: z.literal("ai_started_speaking"), tMs: t, data: z.object({ speaker: PersonaKey, segmentId: z.number().int() }) }),
  z.object({ type: z.literal("ai_stopped_speaking"), tMs: t, data: z.object({ speaker: PersonaKey, interrupted: z.boolean() }) }),
  z.object({ type: z.literal("ai_interrupted_user"), tMs: t, data: z.object({ speaker: PersonaKey }) }),
  z.object({ type: z.literal("transcript_partial"), tMs: t, data: z.object({ speaker: PersonaKey.or(z.literal("student")), text: z.string() }) }),
  z.object({ type: z.literal("transcript_final"), tMs: t, data: z.object({ segmentId: z.number().int(), speaker: PersonaKey.or(z.literal("student")), text: z.string() }) }),
  z.object({ type: z.literal("session_ended"), tMs: t, data: z.object({ reason: z.enum(["timer", "user", "error"]) }) }),
  z.object({ type: z.literal("error"), tMs: t, data: z.object({ code: z.string(), message: z.string(), recoverable: z.boolean() }) }),
]);
export type ServerEvent = z.infer<typeof ServerEvent>;

/** Client -> server (PRD §15). */
export const ClientEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("speaker_started"), tMs: t, data: z.object({}) }),
  z.object({ type: z.literal("speaker_stopped"), tMs: t, data: z.object({}) }),
  z.object({ type: z.literal("transcript_partial"), tMs: t, data: z.object({ text: z.string().max(2000) }) }),
  z.object({ type: z.literal("transcript_final"), tMs: t, data: z.object({ text: z.string().min(1).max(2000), startMs: t, endMs: t }) }),
  z.object({ type: z.literal("user_interrupted_ai"), tMs: t, data: z.object({ speaker: PersonaKey, playedMs: t }) }),
  z.object({ type: z.literal("mic_state"), tMs: t, data: z.object({ state: z.enum(["on", "muted", "lost", "denied"]) }) }),
  z.object({ type: z.literal("resume"), tMs: t, data: z.object({ lastSeq: z.number().int().nonnegative() }) }),
]);
export type ClientEvent = z.infer<typeof ClientEvent>;
