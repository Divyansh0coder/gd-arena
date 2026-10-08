import type { PersonaKey, SessionStatus, TranscriptSegment } from "@gd-arena/contracts";
import { getPersonaPrompt } from "./personas";
import { cleanLlmReply } from "./llmCleanup";

export interface LLMGenerateParams {
  topic: string;
  status: SessionStatus;
  persona: PersonaKey;
  recentTranscript: TranscriptSegment[];
  lastSpeaker?: PersonaKey | "student" | null;
}

export interface LLMAdapter {
  generateResponse(params: LLMGenerateParams): Promise<string>;
}

export class DefaultLLMAdapter implements LLMAdapter {
  private fallbackCounts: Record<PersonaKey, number> = {
    moderator: 0,
    arjun: 0,
    meera: 0,
    kabir: 0,
  };

  public async generateResponse(params: LLMGenerateParams): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY;

    if (apiKey && process.env.PRIMARY_LLM === "gemini" && process.env.GEMINI_API_KEY) {
      try {
        const rawResponse = await this.callGeminiApi(params, process.env.GEMINI_API_KEY);
        const cleaned = cleanLlmReply(rawResponse);
        if (cleaned && cleaned.trim().length > 0) {
          return cleaned;
        }
      } catch (err) {
        // Fallback gracefully on API error
      }
    }

    return this.getFallbackResponse(params);
  }

  private async callGeminiApi(params: LLMGenerateParams, apiKey: string): Promise<string> {
    const prompt = this.buildPrompt(params);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 150,
          temperature: 0.7,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Gemini API error ${res.status}`);
    }

    const data = await res.json();
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return candidateText ?? "";
  }

  private buildPrompt(params: LLMGenerateParams): string {
    const transcriptText = params.recentTranscript
      .slice(-6)
      .map((s) => `${s.speaker === "student" ? "Student (you)" : s.speaker}: "${s.text}"`)
      .join("\n");

    const personaPrompt = getPersonaPrompt(params.persona, params.status);

    return `
System Instruction: ${personaPrompt}
Topic: "${params.topic}"
Session Stage: ${params.status}

Recent Discussion Transcript:
${transcriptText || "(No previous messages yet)"}

Task: Provide your next spoken turn (at most 2 sentences, about 40 words). Speak naturally out loud as if in a live discussion. Do not include stage directions, bullet lists, or surrounding quotes.
    `.trim();
  }

  public getFallbackResponse(params: LLMGenerateParams): string {
    const { persona, topic, status } = params;

    if (persona === "moderator") {
      if (status === "opening") {
        return `Welcome to today's group discussion on "${topic}". I am your moderator. Please present structured arguments, listen actively, and build on each other's points. Let's begin!`;
      }
      if (status === "closing") {
        return `We are reaching the end of our discussion on "${topic}". Please share your final concluding thoughts before we wrap up.`;
      }
      return `Let's keep our discussion focused on "${topic}" and ensure everyone has a chance to speak.`;
    }

    const fallbackOptions: Record<Exclude<PersonaKey, "moderator">, string[]> = {
      arjun: [
        `Looking at "${topic}" from an analytical perspective, the data shows that structured adaptation is far more effective than resisting market change.`,
        `I'd like to emphasize a key metrics-driven point regarding "${topic}": efficiency gains usually offset initial transition costs.`,
        `Analyzing the structural factors of "${topic}", we need clear measurable benchmarks to assess real impact.`,
      ],
      meera: [
        `Building on that point about "${topic}", we must also consider the human impact and ensure fair access for everyone affected.`,
        `I resonate with what was just shared. In "${topic}", empathetic collaboration yields far more sustainable results long-term.`,
        `That is a valid point. Adding to it, supporting communities through the changes brought by "${topic}" is essential.`,
      ],
      kabir: [
        `While that sounds promising for "${topic}", aren't we overlooking the underlying risk factors and unintended consequences?`,
        `Let's challenge the primary assumption here: is "${topic}" really as straightforward as we are framing it?`,
        `That is an interesting view, but what happens when external variables disrupt our strategy on "${topic}"?`,
      ],
    };

    const options = fallbackOptions[persona as Exclude<PersonaKey, "moderator">];
    const index = this.fallbackCounts[persona] % options.length;
    this.fallbackCounts[persona] += 1;

    return options[index] ?? `Regarding "${topic}", we should evaluate both short-term trade-offs and long-term implications.`;
  }
}
