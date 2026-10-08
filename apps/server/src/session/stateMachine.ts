import type { WebSocket } from "ws";
import { ClientEvent, PersonaKey, Report, RetryAttempt, ServerEvent, SessionConfig, SessionStatus, TranscriptSegment } from "@gd-arena/contracts";
import { TurnManager } from "./turnManager";
import { DefaultLLMAdapter, LLMAdapter } from "../ai/llm";
import { generateReport } from "../report/generator";

export class SessionStateMachine {
  public readonly id: string;
  public readonly config: SessionConfig;
  public status: SessionStatus;
  public tMs: number;
  public remainingSec: number;

  public readonly turnManager: TurnManager;
  public readonly llmAdapter: LLMAdapter;

  private intervalId: NodeJS.Timeout | null = null;
  private subscribers: Set<WebSocket> = new Set();
  private endReason: "timer" | "user" | "error" = "timer";

  private openingSpoken: boolean = false;
  private closingSpoken: boolean = false;
  private lastAiTurnMs: number = 0;
  private cachedReport: Report | null = null;
  private retryAttempts: Map<string, RetryAttempt> = new Map();

  constructor(id: string, config: SessionConfig, llmAdapter?: LLMAdapter) {
    this.id = id;
    this.config = config;
    this.status = "lobby";
    this.tMs = 0;
    this.remainingSec = config.durationSec;

    this.turnManager = new TurnManager(config.panelSize);
    this.llmAdapter = llmAdapter ?? new DefaultLLMAdapter();
  }

  public addSubscriber(ws: WebSocket): void {
    this.subscribers.add(ws);

    // Send immediate initial sync events to the newly connected client
    this.sendToSocket(ws, {
      type: "session_started",
      tMs: this.tMs,
      data: { sessionId: this.id, status: this.status },
    });

    this.sendToSocket(ws, {
      type: "timer_update",
      tMs: this.tMs,
      data: { remainingSec: this.remainingSec, status: this.status },
    });

    // Send existing transcript history
    for (const segment of this.turnManager.getTranscript()) {
      this.sendToSocket(ws, {
        type: "transcript_final",
        tMs: segment.startMs,
        data: { segmentId: segment.id, speaker: segment.speaker, text: segment.text },
      });
    }

    // Auto-start session state machine on first socket connection if in lobby
    if (this.status === "lobby") {
      this.transitionTo("opening");
      this.startTicker();
    }
  }

  public removeSubscriber(ws: WebSocket): void {
    this.subscribers.delete(ws);
    if (this.subscribers.size === 0) {
      this.turnManager.releaseTurnLock();
    }
  }

  public startTicker(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      void this.tick();
    }, 1000);
  }

  public stopTicker(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  public async tick(): Promise<void> {
    if (this.status === "ended") {
      this.stopTicker();
      return;
    }

    this.tMs += 1000;
    this.remainingSec = Math.max(0, this.remainingSec - 1);

    // Deterministic state transition boundaries
    if (this.status === "opening" && this.tMs >= 6000) {
      this.transitionTo("discussion");
    } else if (this.status === "discussion" && this.remainingSec <= 15 && this.remainingSec > 0) {
      this.transitionTo("closing");
    } else if (this.remainingSec <= 0) {
      this.endSession("timer");
      return;
    }

    // Broadcast timer update to all connected clients
    this.broadcast({
      type: "timer_update",
      tMs: this.tMs,
      data: { remainingSec: this.remainingSec, status: this.status },
    });

    // Check AI conversation turns
    await this.processAiTurns();
  }

  private async processAiTurns(): Promise<void> {
    if (this.status === "ended") return;

    if (this.status === "opening" && !this.openingSpoken) {
      if (this.turnManager.acquireTurnLock()) {
        try {
          this.openingSpoken = true;
          await this.executeSpeakerTurn("moderator");
        } finally {
          this.turnManager.releaseTurnLock();
        }
      }
      return;
    }

    if (this.status === "closing" && !this.closingSpoken) {
      if (this.turnManager.acquireTurnLock()) {
        try {
          this.closingSpoken = true;
          await this.executeSpeakerTurn("moderator");
        } finally {
          this.turnManager.releaseTurnLock();
        }
      }
      return;
    }

    if (this.status === "discussion") {
      const paceMs = Math.max(200, this.config.patienceMs);
      if (this.tMs - this.lastAiTurnMs >= paceMs) {
        if (this.turnManager.acquireTurnLock()) {
          try {
            const nextSpeaker = this.turnManager.selectNextSpeaker("discussion");
            if (nextSpeaker) {
              this.lastAiTurnMs = this.tMs;
              await this.executeSpeakerTurn(nextSpeaker);
            }
          } finally {
            this.turnManager.releaseTurnLock();
          }
        }
      }
    }
  }

  private async executeSpeakerTurn(speaker: PersonaKey): Promise<void> {
    if (this.status === "ended") return;
    const startMs = this.tMs;
    
    this.broadcast({
      type: "participant_selected",
      tMs: this.tMs,
      data: { speaker },
    });

    let text = "";
    try {
      text = await this.llmAdapter.generateResponse({
        topic: this.config.topic,
        status: this.status,
        persona: speaker,
        recentTranscript: this.turnManager.getTranscript(),
        lastSpeaker: this.turnManager.getLastSpeaker(),
      });
    } catch (err) {
      text = `Regarding "${this.config.topic}", let's consider key perspectives as we proceed.`;
    }

    if (!text || !text.trim()) return;

    const endMs = this.tMs + 2000;
    const segment = this.turnManager.recordTurn(speaker, text, startMs, endMs, "llm");

    this.broadcast({
      type: "ai_started_speaking",
      tMs: startMs,
      data: { speaker, segmentId: segment.id },
    });

    this.broadcast({
      type: "transcript_final",
      tMs: startMs,
      data: { segmentId: segment.id, speaker, text: segment.text },
    });

    this.broadcast({
      type: "ai_stopped_speaking",
      tMs: endMs,
      data: { speaker, interrupted: false },
    });
  }

  public handleClientMessage(raw: unknown): void {
    if (this.status === "ended") return;

    const parsed = ClientEvent.safeParse(raw);
    if (!parsed.success) {
      console.warn("[WS] rejected client message, invalid schema:", parsed.error);
      return;
    }

    const clientEv = parsed.data;
    if (clientEv.type === "user_interrupted_ai") {
      const { speaker } = clientEv.data;
      console.log(`[WS] user interrupted AI speaker ${speaker}`);
      this.turnManager.recordInterruption("student");
      this.turnManager.releaseTurnLock();
      this.turnManager.resetConsecutiveAiTurns();
      this.broadcast({
        type: "ai_stopped_speaking",
        tMs: this.tMs,
        data: { speaker, interrupted: true },
      });
    } else if (clientEv.type === "speaker_started") {
      this.turnManager.releaseTurnLock();
      this.turnManager.resetConsecutiveAiTurns();
    } else if (clientEv.type === "transcript_partial") {
      const { text } = clientEv.data;
      this.broadcast({
        type: "transcript_partial",
        tMs: this.tMs,
        data: { speaker: "student", text },
      });
    } else if (clientEv.type === "transcript_final") {
      const { text, startMs, endMs } = clientEv.data;
      const trimmed = (text || "").trim();
      if (!trimmed) {
        console.log("[WS] ignoring empty candidate transcript");
        return;
      }
      console.log("[WS] candidate transcript:", trimmed);
      
      this.turnManager.releaseTurnLock();
      const segment = this.turnManager.recordTurn("student", trimmed, startMs, endMs, "stt");
      console.log("[WS] candidate transcript stored:", segment.id);
      this.lastAiTurnMs = this.tMs;

      this.broadcast({
        type: "transcript_final",
        tMs: this.tMs,
        data: { segmentId: segment.id, speaker: "student", text: segment.text },
      });
    }
  }

  public transitionTo(newStatus: SessionStatus): void {
    if (this.status === "ended") return;
    this.status = newStatus;
  }

  public endSession(reason: "timer" | "user" | "error" = "user"): void {
    if (this.status === "ended") return;

    this.endReason = reason;
    this.status = "ended";
    this.stopTicker();
    this.turnManager.releaseTurnLock();

    this.broadcast({
      type: "session_ended",
      tMs: this.tMs,
      data: { reason: this.endReason },
    });
  }

  public async getOrGenerateReport(): Promise<Report> {
    if (this.cachedReport) {
      return this.cachedReport;
    }

    const transcript = this.turnManager.getTranscript();
    const interruptionsCount = this.turnManager.getCandidateInterruptionCount();

    this.cachedReport = await generateReport(this.id, this.config.topic, transcript, {
      sessionDurationMs: this.tMs,
      candidateInterruptionCount: interruptionsCount,
      llmAdapter: this.llmAdapter,
    });

    return this.cachedReport;
  }

  public addRetryAttempt(attempt: RetryAttempt): void {
    this.retryAttempts.set(attempt.id, attempt);
  }

  public getRetryAttempt(retryId: string): RetryAttempt | undefined {
    return this.retryAttempts.get(retryId);
  }

  public getRetryAttempts(): RetryAttempt[] {
    return Array.from(this.retryAttempts.values());
  }

  public broadcast(event: ServerEvent): void {
    const payload = JSON.stringify(event);
    for (const ws of this.subscribers) {
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(payload);
      }
    }
  }

  private sendToSocket(ws: WebSocket, event: ServerEvent): void {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify(event));
    }
  }
}
