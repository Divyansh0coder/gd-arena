import { describe, expect, it } from "vitest";
import { TurnManager } from "./turnManager";
import { DefaultLLMAdapter } from "../ai/llm";
import { SessionStateMachine } from "./stateMachine";

describe("TurnManager", () => {
  it("initializes with active personas based on panel size", () => {
    const tm3 = new TurnManager(3);
    expect(tm3.activePersonas).toEqual(["arjun", "meera", "kabir"]);

    const tm4 = new TurnManager(4);
    expect(tm4.activePersonas.length).toBe(3); // available persona pool
  });

  it("selects moderator during opening and closing", () => {
    const tm = new TurnManager(3);
    expect(tm.selectNextSpeaker("opening")).toBe("moderator");
    expect(tm.selectNextSpeaker("closing")).toBe("moderator");
  });

  it("selects AI personas based on PRD scored turn selection", () => {
    const tm = new TurnManager(3);
    const s1 = tm.selectNextSpeaker("discussion");
    tm.recordTurn(s1!, "first AI point", 1000, 3000);
    expect(s1).toBe("arjun"); // Base 3 vs Meera 2 vs Kabir 1

    const s2 = tm.selectNextSpeaker("discussion");
    tm.recordTurn(s2!, "second AI point", 3000, 5000);
    expect(s2).toBe("meera"); // Meera 2 vs Kabir 1 vs Arjun -4
  });

  describe("PRD Scored Turn Selection (CHANGE 2)", () => {
    it("selects an addressed persona when mentioned by first name in the last turn", () => {
      const tm = new TurnManager(3);
      tm.recordTurn("student", "Meera, what is your view on this?", 1000, 3000);
      const next = tm.selectNextSpeaker("discussion");
      expect(next).toBe("meera");
    });

    it("ensures the last speaker is penalized (-5) and not chosen immediately again", () => {
      const tm = new TurnManager(3);
      tm.recordTurn("arjun", "I believe market forces dictate the outcome.", 1000, 3000);
      const next = tm.selectNextSpeaker("discussion");
      expect(next).not.toBe("arjun");
      expect(next).toBe("meera"); // Meera base 2 > Kabir base 1
    });

    it("yields to student when cap of 2 consecutive AI turns is reached", () => {
      const tm = new TurnManager(3);
      tm.recordTurn("arjun", "Point A", 1000, 2000);
      tm.recordTurn("meera", "Point B", 2000, 3000);
      expect(tm.getConsecutiveAiTurns()).toBe(2);
      expect(tm.selectNextSpeaker("discussion")).toBeNull();
    });

    it("favours Kabir (+2) after a claim marker (should, will, always, never, number)", () => {
      const tm = new TurnManager(3);
      // Arjun speaks a claim marker turn
      tm.recordTurn("arjun", "We should definitely adopt 100 new policies.", 1000, 3000);
      // Arjun (spoke last -5, base 3 = -2)
      // Meera (base 2)
      // Kabir (base 1 + 2 claim bonus = 3)
      const next = tm.selectNextSpeaker("discussion");
      expect(next).toBe("kabir");
    });

    it("resolves ties using a seeded random function", () => {
      const tm1 = new TurnManager(3);
      const tm2 = new TurnManager(3);

      tm1.setRandomFn(() => 0.0);
      tm2.setRandomFn(() => 0.99);

      const choice1 = tm1.selectNextSpeaker("discussion");
      const choice2 = tm2.selectNextSpeaker("discussion");
      expect(choice1).toBeDefined();
      expect(choice2).toBeDefined();
    });
  });

  it("enforces a maximum of 2 consecutive AI-to-AI turns without student participation", () => {
    const tm = new TurnManager(3);

    // AI turn 1
    const s1 = tm.selectNextSpeaker("discussion");
    expect(s1).toBe("arjun");
    tm.recordTurn(s1!, "First AI point", 1000, 3000);
    expect(tm.getConsecutiveAiTurns()).toBe(1);

    // AI turn 2
    const s2 = tm.selectNextSpeaker("discussion");
    expect(s2).toBe("meera");
    tm.recordTurn(s2!, "Second AI point", 3000, 5000);
    expect(tm.getConsecutiveAiTurns()).toBe(2);

    // AI turn 3 attempt: should return null to pause for candidate turn
    const s3 = tm.selectNextSpeaker("discussion");
    expect(s3).toBeNull();

    // Student speaks: resets consecutive counter
    tm.recordTurn("student", "Student contribution", 5000, 7000, "typed");
    expect(tm.getConsecutiveAiTurns()).toBe(0);

    // AI can now speak again
    const s4 = tm.selectNextSpeaker("discussion");
    expect(["arjun", "kabir"]).toContain(s4);
  });

  it("acquires and releases turn lock correctly", () => {
    const tm = new TurnManager(3);
    expect(tm.isLocked()).toBe(false);

    expect(tm.acquireTurnLock()).toBe(true);
    expect(tm.isLocked()).toBe(true);

    // Duplicate acquire while locked returns false
    expect(tm.acquireTurnLock()).toBe(false);

    tm.releaseTurnLock();
    expect(tm.isLocked()).toBe(false);
  });

  it("resets consecutive AI turns and rejects empty transcripts", () => {
    const tm = new TurnManager(3);
    tm.recordTurn("arjun", "Point 1", 1000, 2000);
    expect(tm.getConsecutiveAiTurns()).toBe(1);

    tm.resetConsecutiveAiTurns();
    expect(tm.getConsecutiveAiTurns()).toBe(0);

    expect(() => tm.recordTurn("student", "   ", 2000, 3000)).toThrow();
  });
});

describe("LLMAdapter Fallbacks", () => {
  it("provides deterministic fallback mock responses when API key is missing", async () => {
    const adapter = new DefaultLLMAdapter();
    const response = await adapter.generateResponse({
      topic: "Will AI create more jobs than it destroys?",
      status: "discussion",
      persona: "arjun",
      recentTranscript: [],
    });

    expect(response).toBeDefined();
    expect(response.length).toBeGreaterThan(10);
    expect(response).toContain("AI");
  });

  it("provides moderator opening and closing fallbacks", async () => {
    const adapter = new DefaultLLMAdapter();
    const opening = await adapter.generateResponse({
      topic: "Will AI create more jobs than it destroys?",
      status: "opening",
      persona: "moderator",
      recentTranscript: [],
    });
    expect(opening).toContain("moderator");

    const closing = await adapter.generateResponse({
      topic: "Will AI create more jobs than it destroys?",
      status: "closing",
      persona: "moderator",
      recentTranscript: [],
    });
    expect(closing).toContain("concluding thoughts");
  });
});

describe("SessionStateMachine Natural Turn-Taking & Interruption", () => {
  it("stores and sequences transcript segments correctly", async () => {
    const session = new SessionStateMachine("test-session", {
      topic: "Should unpaid internships be banned?",
      panelSize: 3,
      durationSec: 300,
      patienceMs: 1200,
    });

    session.status = "opening";
    await (session as any).executeSpeakerTurn("moderator");

    const transcript = session.turnManager.getTranscript();
    expect(transcript.length).toBeGreaterThanOrEqual(1);
    expect(transcript[0]!.speaker).toBe("moderator");
    expect(transcript[0]!.source).toBe("llm");
  });

  it("handles user_interrupted_ai client event by releasing lock and resetting consecutive AI count", () => {
    const session = new SessionStateMachine("test-interruption", {
      topic: "Remote work vs Office work",
      panelSize: 3,
      durationSec: 300,
      patienceMs: 1000,
    });

    session.turnManager.acquireTurnLock();
    session.turnManager.recordTurn("arjun", "Working remotely is...", 1000, 2000);
    expect(session.turnManager.getConsecutiveAiTurns()).toBe(1);
    expect(session.turnManager.isLocked()).toBe(true);

    session.handleClientMessage({
      type: "user_interrupted_ai",
      tMs: 1500,
      data: { speaker: "arjun", playedMs: 500 },
    });

    expect(session.turnManager.isLocked()).toBe(false);
    expect(session.turnManager.getConsecutiveAiTurns()).toBe(0);
  });

  it("ignores empty student transcripts gracefully", () => {
    const session = new SessionStateMachine("test-empty-transcript", {
      topic: "Remote work vs Office work",
      panelSize: 3,
      durationSec: 300,
      patienceMs: 1000,
    });

    const initialLength = session.turnManager.getTranscript().length;

    session.handleClientMessage({
      type: "transcript_final",
      tMs: 2000,
      data: { text: "   ", startMs: 1000, endMs: 2000 },
    });

    expect(session.turnManager.getTranscript().length).toBe(initialLength);
  });

  it("releases turn lock when subscriber disconnects", () => {
    const session = new SessionStateMachine("test-disconnect", {
      topic: "Climate change policies",
      panelSize: 3,
      durationSec: 300,
      patienceMs: 1000,
    });

    const mockWs = { send: () => {}, readyState: 1 } as any;
    session.addSubscriber(mockWs);
    session.turnManager.acquireTurnLock();
    expect(session.turnManager.isLocked()).toBe(true);

    session.removeSubscriber(mockWs);
    expect(session.turnManager.isLocked()).toBe(false);
  });
});
