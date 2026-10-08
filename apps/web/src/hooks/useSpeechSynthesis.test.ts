import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERSONA_VOICE_CONFIGS, selectVoiceForPersona } from "./useSpeechSynthesis";

describe("selectVoiceForPersona voice matching logic", () => {
  const mockVoices = [
    { name: "Google US English", lang: "en-US" } as SpeechSynthesisVoice,
    { name: "Google UK English Female", lang: "en-GB" } as SpeechSynthesisVoice,
    { name: "Google Australia Male", lang: "en-AU" } as SpeechSynthesisVoice,
    { name: "Daniel", lang: "en-GB" } as SpeechSynthesisVoice,
  ];

  it("selects appropriate voice for moderator", () => {
    const voice = selectVoiceForPersona(mockVoices, "moderator");
    expect(voice).toBeDefined();
    expect(voice?.name).toBe("Google US English");
  });

  it("selects appropriate voice for meera (female)", () => {
    const voice = selectVoiceForPersona(mockVoices, "meera");
    expect(voice).toBeDefined();
    expect(voice?.name).toBe("Google UK English Female");
  });

  it("handles empty voice list gracefully", () => {
    const voice = selectVoiceForPersona([], "arjun");
    expect(voice).toBeNull();
  });

  it("has distinct pitch and rate settings for each persona", () => {
    expect(PERSONA_VOICE_CONFIGS.moderator.pitch).not.toBe(PERSONA_VOICE_CONFIGS.meera.pitch);
    expect(PERSONA_VOICE_CONFIGS.arjun.rate).toBeGreaterThan(PERSONA_VOICE_CONFIGS.meera.rate);
  });
});

describe("SpeechSynthesis mock functionality & safety rules", () => {
  let spokenList: { text: string; persona: string }[] = [];
  let cancelledCount = 0;

  beforeEach(() => {
    spokenList = [];
    cancelledCount = 0;

    class MockSpeechSynthesisUtterance {
      text: string;
      voice: any = null;
      pitch: number = 1;
      rate: number = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: any) => void) | null = null;

      constructor(text: string) {
        this.text = text;
      }
    }

    const mockSpeechSynthesis = {
      getVoices: () => [
        { name: "Google US English", lang: "en-US" },
        { name: "Google UK English Female", lang: "en-GB" },
      ],
      speak: (ut: MockSpeechSynthesisUtterance) => {
        spokenList.push({ text: ut.text, persona: ut.voice?.name ?? "default" });
        if (ut.onstart) ut.onstart();
        if (ut.onend) ut.onend();
      },
      cancel: () => {
        cancelledCount++;
      },
      onvoiceschanged: null,
    };

    vi.stubGlobal("SpeechSynthesisUtterance", MockSpeechSynthesisUtterance);
    vi.stubGlobal("speechSynthesis", mockSpeechSynthesis);
    (globalThis as any).window = globalThis;
    (globalThis as any).window.speechSynthesis = mockSpeechSynthesis;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cancels previous speech before starting new speech", () => {
    (globalThis as any).window.speechSynthesis.cancel();
    expect(cancelledCount).toBe(1);
  });

  it("never speaks candidate/student messages", () => {
    const processMessage = (speaker: string, text: string) => {
      if (speaker === "student") return false;
      (globalThis as any).window.speechSynthesis.speak(
        new (globalThis as any).SpeechSynthesisUtterance(text)
      );
      return true;
    };

    const spokenCandidate = processMessage("student", "Hello from student");
    expect(spokenCandidate).toBe(false);
    expect(spokenList.length).toBe(0);

    const spokenAi = processMessage("arjun", "Hello from Arjun");
    expect(spokenAi).toBe(true);
    expect(spokenList.length).toBe(1);
  });

  it("prevents duplicate segment speaking", () => {
    const spokenIds = new Set<number>();
    const processSegment = (segmentId: number, text: string) => {
      if (spokenIds.has(segmentId)) return false;
      spokenIds.add(segmentId);
      (globalThis as any).window.speechSynthesis.speak(
        new (globalThis as any).SpeechSynthesisUtterance(text)
      );
      return true;
    };

    expect(processSegment(1, "First utterance")).toBe(true);
    expect(processSegment(1, "First utterance")).toBe(false); // duplicate blocked
    expect(spokenList.length).toBe(1);
  });

  it("honors voice mute state", () => {
    let isMuted = true;
    const processSegment = (text: string) => {
      if (isMuted) return false;
      (globalThis as any).window.speechSynthesis.speak(
        new (globalThis as any).SpeechSynthesisUtterance(text)
      );
      return true;
    };

    expect(processSegment("Muted text")).toBe(false);
    isMuted = false;
    expect(processSegment("Unmuted text")).toBe(true);
    expect(spokenList.length).toBe(1);
  });
});
