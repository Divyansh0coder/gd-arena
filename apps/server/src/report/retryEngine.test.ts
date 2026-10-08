import { describe, expect, it } from "vitest";
import type { MissedOpportunity, TranscriptSegment } from "@gd-arena/contracts";
import { evaluateRetryAttempt } from "./retryEngine";

describe("Retry Engine", () => {
  const opportunity: MissedOpportunity = {
    id: "opp-1",
    sessionId: "session-123",
    segmentId: 3,
    contextSegmentIds: [2],
    tMs: 13000,
    dimension: "building_on_others",
    whatHappened: "You agreed with Meera's point but did not develop the argument further.",
    whyItMatters: "Building on other speakers demonstrates active listening.",
    candidateQuote: "Yes, I agree.",
    contextQuote: "MEERA: AI may increase inequality if lower-income workers lack digital access.",
    suggestedResponse: "While I agree that inequality is a concern, AI could also improve access to education if digital training is subsidized.",
  };

  const originalSegment: TranscriptSegment = {
    id: 3,
    seq: 3,
    speaker: "student",
    startMs: 13000,
    endMs: 16000,
    text: "Yes, I agree.",
    interrupted: false,
    source: "stt",
  };

  it("creates a valid retry attempt on the SAME rubric dimension", async () => {
    const retryText = "While I agree that inequality is a concern, AI could also improve access to education because subsidized digital training creates new opportunities for marginalized communities.";

    const result = await evaluateRetryAttempt({
      sessionId: "session-123",
      opportunity,
      originalSegment,
      retryResponse: retryText,
    });

    // 1. Retry creation
    expect(result.id).toBeTruthy();
    expect(result.sessionId).toBe("session-123");
    expect(result.opportunityId).toBe("opp-1");

    // 2. Original response remains unchanged
    expect(result.originalResponse).toBe("Yes, I agree.");
    expect(originalSegment.text).toBe("Yes, I agree.");

    // 3. Retry response stored separately
    expect(result.retryResponse).toBe(retryText);

    // 4. Same rubric used
    expect(result.dimension).toBe("building_on_others");

    // 5. Score comparison
    expect(result.originalScore).toBeLessThan(result.retryScore);
    expect(result.scoreDiff).toBe(result.retryScore - result.originalScore);
    expect(result.improvements.length).toBeGreaterThan(0);
  });

  it("rejects empty retry response", async () => {
    await expect(
      evaluateRetryAttempt({
        sessionId: "session-123",
        opportunity,
        originalSegment,
        retryResponse: "   ",
      })
    ).rejects.toThrow("Retry response cannot be empty");
  });
});
