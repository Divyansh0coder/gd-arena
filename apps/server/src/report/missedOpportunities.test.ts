import { describe, expect, it } from "vitest";
import type { TranscriptSegment } from "@gd-arena/contracts";
import { generateMissedOpportunities, validateMissedOpportunity } from "./missedOpportunities";

describe("Missed Opportunities Detector", () => {
  const sampleSegments: TranscriptSegment[] = [
    { id: 1, seq: 1, speaker: "moderator", startMs: 0, endMs: 5000, text: "Welcome. How does AI impact workplace equality?", interrupted: false, source: "llm" },
    { id: 2, seq: 2, speaker: "meera", startMs: 6000, endMs: 12000, text: "AI may increase inequality if lower-income workers lack digital access.", interrupted: false, source: "llm" },
    { id: 3, seq: 3, speaker: "student", startMs: 13000, endMs: 16000, text: "Yes, I agree.", interrupted: false, source: "stt" }, // Missed opp: short agreement
    { id: 4, seq: 4, speaker: "arjun", startMs: 17000, endMs: 22000, text: "Should governments mandate free digital training programs?", interrupted: false, source: "llm" },
    { id: 5, seq: 5, speaker: "student", startMs: 23000, endMs: 26000, text: "Yeah maybe.", interrupted: false, source: "stt" }, // Missed opp: weak question response
    { id: 6, seq: 6, speaker: "kabir", startMs: 27000, endMs: 32000, text: "Market forces will automatically address the training gap.", interrupted: false, source: "llm" },
    { id: 7, seq: 7, speaker: "student", startMs: 33000, endMs: 35000, text: "I disagree.", interrupted: true, source: "stt" }, // Missed opp: interruption without argument
    { id: 8, seq: 8, speaker: "student", startMs: 36000, endMs: 42000, text: "Government policy is essential because market forces alone fail to support vulnerable workers.", interrupted: false, source: "stt" },
  ];

  it("detects missed opportunities and enforces max 3 limit", async () => {
    const opps = await generateMissedOpportunities("sess-1", "AI Equality", sampleSegments, { maxOpportunities: 3 });

    expect(opps.length).toBeGreaterThan(0);
    expect(opps.length).toBeLessThanOrEqual(3);

    for (const opp of opps) {
      expect(opp.sessionId).toBe("sess-1");
      expect(opp.candidateQuote).toBeTruthy();
      expect(opp.suggestedResponse).toBeTruthy();
      
      // Validate evidence
      const val = validateMissedOpportunity(opp, sampleSegments);
      expect(val.valid).toBe(true);
    }
  });

  it("rejects invalid missed opportunity evidence", () => {
    const invalidOpp = {
      id: "opp-fake",
      sessionId: "sess-1",
      segmentId: 3,
      contextSegmentIds: [],
      tMs: 13000,
      dimension: "building_on_others" as const,
      whatHappened: "Weak agreement.",
      whyItMatters: "Adds depth.",
      candidateQuote: "We should eliminate all technology", // fabricated quote
      suggestedResponse: "A stronger argument...",
    };

    const val = validateMissedOpportunity(invalidOpp, sampleSegments);
    expect(val.valid).toBe(false);
    expect(val.reason).toContain("not contained in segment text");
  });

  it("handles fallback gracefully when candidate has no opportunities or LLM is unavailable", async () => {
    const opps = await generateMissedOpportunities("sess-2", "AI Equality", sampleSegments);
    expect(opps.length).toBeGreaterThan(0);
    expect(opps[0]?.suggestedResponse.toLowerCase()).toContain("ai suggestion");
  });
});
