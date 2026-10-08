import { describe, expect, it } from "vitest";
import { getPersonaPrompt, MODERATOR_STAGE_PROMPTS, PERSONA_PROMPTS } from "./personas";
import type { PersonaKey } from "@gd-arena/contracts";

describe("Persona Prompts & Stage Handling (FIX 1 & FIX 2)", () => {
  const keys: PersonaKey[] = ["moderator", "arjun", "meera", "kabir"];

  it("defines a prompt for every persona key and session stage", () => {
    for (const key of keys) {
      const prompt = getPersonaPrompt(key, "discussion");
      expect(prompt).toBeDefined();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(50);
    }
  });

  it("selects moderator prompt by session stage", () => {
    expect(getPersonaPrompt("moderator", "opening")).toContain("opening a campus placement");
    expect(getPersonaPrompt("moderator", "discussion")).toContain("active Group Discussion");
    expect(getPersonaPrompt("moderator", "closing")).toContain("wrapping up the Group Discussion");
  });

  it("instructs every persona that human participant is called 'you'", () => {
    for (const key of keys) {
      const prompt = getPersonaPrompt(key, "discussion");
      expect(prompt).toMatch(/'you'|\"you\"/i);
      expect(prompt).toMatch(/never be given a made-up name/i);
    }
  });

  it("mentions reply length limit in every persona prompt", () => {
    for (const key of keys) {
      const prompt = getPersonaPrompt(key, "discussion");
      expect(prompt).toMatch(/2 sentences/i);
      expect(prompt).toMatch(/40 words/i);
    }
  });

  it("ensures all non-moderator persona prompts are distinct and different", () => {
    const promptSet = new Set(Object.values(PERSONA_PROMPTS));
    expect(promptSet.size).toBe(3);
  });
});
