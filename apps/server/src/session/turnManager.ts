import type { PersonaKey, SessionStatus, TranscriptSegment } from "@gd-arena/contracts";

export function scorePersona(
  persona: Exclude<PersonaKey, "moderator">,
  lastTurnText: string | null,
  lastSpeaker: PersonaKey | "student" | null,
  recentSpeakersInLast3: (PersonaKey | "student")[]
): number {
  // 1. Base talkativeness (arjun 3, meera 2, kabir 1)
  const baseTalkativeness: Record<Exclude<PersonaKey, "moderator">, number> = {
    arjun: 3,
    meera: 2,
    kabir: 1,
  };

  let score = baseTalkativeness[persona] ?? 1;

  if (lastTurnText) {
    const normText = lastTurnText.toLowerCase();

    // 2. +3 if the persona's first name appears in the last turn's text
    if (normText.includes(persona.toLowerCase())) {
      score += 3;
    }

    // 3. +2 for kabir if last turn contains a claim marker (should, will, always, never, a number)
    if (persona === "kabir") {
      const claimPattern = /(?:\b(?:should|will|always|never)\b|\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)/i;
      if (claimPattern.test(lastTurnText)) {
        score += 2;
      }
    }
  }

  // 4. -2 for each turn the persona took in the last 3 turns
  const turnsInLast3 = recentSpeakersInLast3.filter((s) => s === persona).length;
  score -= 2 * turnsInLast3;

  // 5. -5 if the persona spoke last
  if (lastSpeaker === persona) {
    score -= 5;
  }

  return score;
}

export class TurnManager {
  public readonly panelSize: number;
  public readonly activePersonas: PersonaKey[];
  
  private currentSpeaker: PersonaKey | "student" | null = null;
  private consecutiveAiTurns: number = 0;
  private isTurnLocked: boolean = false;
  private transcriptSegments: TranscriptSegment[] = [];
  private nextSeq: number = 1;
  private candidateInterruptionCount: number = 0;
  private randomFn: () => number = Math.random;

  constructor(panelSize: number = 3) {
    this.panelSize = Math.max(3, Math.min(5, panelSize));
    
    // Available AI participant personas (excluding moderator)
    const availablePersonas: PersonaKey[] = ["arjun", "meera", "kabir"];
    this.activePersonas = availablePersonas.slice(0, this.panelSize);
  }

  public setRandomFn(fn: () => number): void {
    this.randomFn = fn;
  }

  public recordInterruption(speaker: PersonaKey | "student"): void {
    if (speaker === "student") {
      this.candidateInterruptionCount += 1;
    }
  }

  public getCandidateInterruptionCount(): number {
    return this.candidateInterruptionCount;
  }

  public getCurrentSpeaker(): PersonaKey | "student" | null {
    return this.currentSpeaker;
  }

  public getConsecutiveAiTurns(): number {
    return this.consecutiveAiTurns;
  }

  public isLocked(): boolean {
    return this.isTurnLocked;
  }

  public acquireTurnLock(): boolean {
    if (this.isTurnLocked) return false;
    this.isTurnLocked = true;
    return true;
  }

  public releaseTurnLock(): void {
    this.isTurnLocked = false;
  }

  /**
   * Selects the next AI speaker using PRD scored selection:
   * score = base talkativeness (arjun 3, meera 2, kabir 1)
   *       + 3 if addressed by first name in last turn
   *       + 2 for kabir if last turn contains a claim marker (should, will, always, never, number)
   *       - 2 per turn taken in last 3 turns
   *       - 5 if spoke last.
   *
   * Highest score wins; ties broken with seedable random function.
   * Opening/closing stages return "moderator".
   * Cap of 2 consecutive AI turns yields to candidate (returns null).
   */
  public selectNextSpeaker(status: SessionStatus): PersonaKey | null {
    if (status === "opening" || status === "closing") {
      return "moderator";
    }

    if (status !== "discussion") {
      return null;
    }

    if (this.consecutiveAiTurns >= 2) {
      return null;
    }

    const lastTurn = this.transcriptSegments.length > 0
      ? this.transcriptSegments[this.transcriptSegments.length - 1]
      : null;

    const lastTurnText = lastTurn ? lastTurn.text : null;
    const lastSpeaker = lastTurn ? lastTurn.speaker : null;
    const recent3 = this.transcriptSegments.slice(-3).map((s) => s.speaker);

    const candidates = this.activePersonas.filter((p) => p !== "moderator");
    if (candidates.length === 0) return null;

    const scored = candidates.map((persona) => ({
      persona,
      score: scorePersona(persona as Exclude<PersonaKey, "moderator">, lastTurnText, lastSpeaker, recent3),
    }));

    let maxScore = -Infinity;
    for (const item of scored) {
      if (item.score > maxScore) {
        maxScore = item.score;
      }
    }

    const topCandidates = scored.filter((item) => item.score === maxScore);
    if (topCandidates.length === 1) {
      return topCandidates[0]!.persona;
    }

    const randIdx = Math.floor(this.randomFn() * topCandidates.length);
    return topCandidates[randIdx]!.persona;
  }

  public resetConsecutiveAiTurns(): void {
    this.consecutiveAiTurns = 0;
  }

  /**
   * Records a completed turn segment into session transcript state.
   */
  public recordTurn(
    speaker: PersonaKey | "student",
    text: string,
    startMs: number,
    endMs: number,
    source: "stt" | "llm" | "typed" = "llm"
  ): TranscriptSegment {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("Cannot record empty transcript segment");
    }

    const segment: TranscriptSegment = {
      id: this.nextSeq,
      seq: this.nextSeq,
      speaker,
      startMs,
      endMs,
      text: trimmed,
      interrupted: false,
      source,
    };

    this.nextSeq += 1;
    this.transcriptSegments.push(segment);
    this.currentSpeaker = speaker;

    if (speaker === "student") {
      // Human spoke: reset consecutive AI turn counter
      this.consecutiveAiTurns = 0;
    } else if (speaker !== "moderator") {
      // AI participant spoke: increment consecutive AI turn counter
      this.consecutiveAiTurns += 1;
    }

    return segment;
  }

  public getTranscript(): TranscriptSegment[] {
    return [...this.transcriptSegments];
  }

  public getLastSpeaker(): PersonaKey | "student" | null {
    if (this.transcriptSegments.length === 0) return null;
    return this.transcriptSegments[this.transcriptSegments.length - 1]!.speaker;
  }
}
