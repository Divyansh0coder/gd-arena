import { describe, expect, it } from "vitest";
import type { TranscriptSegment } from "@gd-arena/contracts";
import { generateReport } from "./generator";

describe("Report Generator Pipeline", () => {
  const sampleSegments: TranscriptSegment[] = [
    { id: 1, seq: 1, speaker: "moderator", startMs: 0, endMs: 5000, text: "Welcome to our discussion on Renewable Energy.", interrupted: false, source: "llm" },
    { id: 2, seq: 2, speaker: "student", startMs: 6000, endMs: 12000, text: "Renewable energy is essential to achieve long-term sustainability.", interrupted: false, source: "stt" },
    { id: 3, seq: 3, speaker: "arjun", startMs: 13000, endMs: 18000, text: "However, grid stability remains a challenge.", interrupted: false, source: "llm" },
    { id: 4, seq: 4, speaker: "student", startMs: 19000, endMs: 25000, text: "Battery storage technology can resolve grid fluctuations.", interrupted: false, source: "stt" },
    { id: 5, seq: 5, speaker: "student", startMs: 28000, endMs: 30000, text: "In conclusion, clean energy and battery storage are key.", interrupted: false, source: "stt" },
  ];

  it("generates a valid report for active candidate session", async () => {
    const report = await generateReport("test-session-1", "Renewable Energy", sampleSegments, {
      sessionDurationMs: 30000,
      candidateInterruptionCount: 0,
    });

    expect(report.sessionId).toBe("test-session-1");
    expect(report.topic).toBe("Renewable Energy");
    expect(report.metrics.turns).toBe(3);
    expect(report.metrics.words).toBeGreaterThan(0);
    expect(report.scores.length).toBe(8); // 8 dimensions
    
    // Check evidence feedback items
    expect(report.items.length).toBeGreaterThan(0);
    for (const item of report.items) {
      expect(item.speaker).toBe("student");
      expect(item.quote).toBeTruthy();
      
      // Verify quote exists in transcript
      const seg = sampleSegments.find((s) => s.id === item.segmentId);
      expect(seg).toBeDefined();
      expect(seg!.text.toLowerCase()).toContain(item.quote.toLowerCase());
    }
  });

  it("handles empty candidate participation gracefully", async () => {
    const emptyCandidateSegments: TranscriptSegment[] = [
      { id: 1, seq: 1, speaker: "moderator", startMs: 0, endMs: 5000, text: "Welcome to our discussion.", interrupted: false, source: "llm" },
      { id: 2, seq: 2, speaker: "arjun", startMs: 6000, endMs: 10000, text: "I will start.", interrupted: false, source: "llm" },
    ];

    const report = await generateReport("empty-session", "Topic", emptyCandidateSegments, {
      sessionDurationMs: 20000,
    });

    expect(report.sessionId).toBe("empty-session");
    expect(report.metrics.turns).toBe(0);
    expect(report.metrics.words).toBe(0);
    expect(report.scores.length).toBe(8);
    expect(report.items).toEqual([]);
    expect(report.droppedItems).toBe(0);
  });

  it("falls back seamlessly when LLM is unavailable", async () => {
    // LLM mock that fails/throws
    const failingLlmAdapter = {
      generateResponse: async () => {
        throw new Error("LLM Unavailable");
      },
    };

    const report = await generateReport("fallback-session", "Renewable Energy", sampleSegments, {
      sessionDurationMs: 30000,
      llmAdapter: failingLlmAdapter,
    });

    expect(report.sessionId).toBe("fallback-session");
    expect(report.scores.length).toBe(8);
    expect(report.items.length).toBeGreaterThan(0);
    
    // All items must pass evidence validation
    for (const item of report.items) {
      const seg = sampleSegments.find((s) => s.id === item.segmentId);
      expect(seg).toBeDefined();
      expect(seg!.speaker).toBe("student");
      expect(seg!.text.toLowerCase()).toContain(item.quote.toLowerCase());
    }
  });
});
