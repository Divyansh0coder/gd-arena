import { describe, expect, it } from "vitest";
import { ClientEvent, FeedbackItem, MissedOpportunity, RetryAttempt, ServerEvent, SessionConfig } from "./index";

describe("evidence contract (R6)", () => {
  const ok = { dimension: "listening", severity: "warn", text: "t", segmentId: 7, quote: "q", tMs: 1000 };
  it("accepts a feedback item with a segment and quote", () => {
    expect(FeedbackItem.safeParse(ok).success).toBe(true);
  });
  it("rejects a feedback item without a segment id", () => {
    const { segmentId, ...rest } = ok;
    expect(FeedbackItem.safeParse(rest).success).toBe(false);
  });
  it("rejects a feedback item with an empty quote", () => {
    expect(FeedbackItem.safeParse({ ...ok, quote: "" }).success).toBe(false);
  });
});

describe("session config", () => {
  const base = { topic: "Will AI create more jobs than it destroys?", panelSize: 3, durationSec: 480 };
  it("applies default patience", () => {
    expect(SessionConfig.parse(base).patienceMs).toBe(1200);
  });
  it("rejects out-of-range panel size and duration", () => {
    expect(SessionConfig.safeParse({ ...base, panelSize: 2 }).success).toBe(false);
    expect(SessionConfig.safeParse({ ...base, panelSize: 6 }).success).toBe(false);
    expect(SessionConfig.safeParse({ ...base, durationSec: 60 }).success).toBe(false);
  });
  it("rejects a too-short topic", () => {
    expect(SessionConfig.safeParse({ ...base, topic: "AI" }).success).toBe(false);
  });
});

describe("events", () => {
  it("parses a valid server event and rejects an unknown one", () => {
    expect(ServerEvent.safeParse({ type: "timer_update", tMs: 1, data: { remainingSec: 10, status: "discussion" } }).success).toBe(true);
    expect(ServerEvent.safeParse({ type: "nope", tMs: 1, data: {} }).success).toBe(false);
  });
  it("rejects an empty final transcript from the client", () => {
    expect(ClientEvent.safeParse({ type: "transcript_final", tMs: 1, data: { text: "", startMs: 0, endMs: 1 } }).success).toBe(false);
  });
});

describe("missed opportunity and retry contracts", () => {
  it("validates a valid missed opportunity schema", () => {
    const opp = {
      id: "opp-1",
      sessionId: "sess-1",
      segmentId: 2,
      contextSegmentIds: [1],
      tMs: 6000,
      dimension: "building_on_others",
      whatHappened: "You agreed without developing the argument.",
      whyItMatters: "Building on others adds value.",
      candidateQuote: "Yes, I agree.",
      contextQuote: "AI increases inequality.",
      suggestedResponse: "A stronger response could connect education access...",
    };
    expect(MissedOpportunity.safeParse(opp).success).toBe(true);

    const retry = {
      id: "retry-1",
      sessionId: "sess-1",
      opportunityId: "opp-1",
      originalSegmentId: 2,
      originalResponse: "Yes, I agree.",
      originalScore: 40,
      retryResponse: "While inequality is a concern, AI could also improve access...",
      retryTimestamp: 10000,
      retryScore: 80,
      scoreDiff: 40,
      improvements: ["Added reasoning", "Built on previous speaker"],
      dimension: "building_on_others",
    };
    expect(RetryAttempt.safeParse(retry).success).toBe(true);
  });
});
