import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { SessionConfig, Topic } from "@gd-arena/contracts";
import { PRESET_TOPICS } from "./data/topics";
import { SessionStateMachine } from "./session/stateMachine";
import { randomUUID } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function buildApp(opts: { allowedOrigin?: string; serveStatic?: boolean } = {}) {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: opts.allowedOrigin ?? true });
  await app.register(fastifyWebsocket);

  // Serve apps/web/dist as static files with SPA fallback in production
  if (process.env.NODE_ENV === "production" || opts.serveStatic) {
    const webDistPath = path.resolve(__dirname, "../../web/dist");
    if (fs.existsSync(webDistPath)) {
      await app.register(fastifyStatic, {
        root: webDistPath,
        prefix: "/",
        wildcard: false,
      });

      app.setNotFoundHandler((req, reply) => {
        if (req.raw.url?.startsWith("/api/") || req.raw.url?.startsWith("/ws/")) {
          return reply.status(404).send({ error: "Not Found" });
        }
        return reply.sendFile("index.html");
      });
    }
  }

  const sessions = new Map<string, SessionStateMachine>();

  app.get("/health", async () => ({
    status: "ok",
    ok: true,
    timestamp: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
  }));

  // PRD §15: GET /api/topics
  app.get("/api/topics", async () => PRESET_TOPICS.map((t) => Topic.parse(t)));

  // PRD §15: POST /api/sessions. Create a new GD session configuration.
  app.post("/api/sessions", async (req, reply) => {
    const parseResult = SessionConfig.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid session configuration",
        details: parseResult.error.flatten(),
      });
    }

    const config = parseResult.data;
    const sessionId = randomUUID();
    const session = new SessionStateMachine(sessionId, config);
    sessions.set(sessionId, session);

    return reply.status(201).send({
      id: session.id,
      status: session.status,
      config: session.config,
    });
  });

  // GET /api/sessions/:sessionId
  app.get("/api/sessions/:sessionId", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = sessions.get(sessionId);
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }
    return {
      id: session.id,
      status: session.status,
      config: session.config,
      remainingSec: session.remainingSec,
      tMs: session.tMs,
    };
  });

  // POST /api/sessions/:sessionId/end. Manually end session.
  app.post("/api/sessions/:sessionId/end", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = sessions.get(sessionId);
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }
    session.endSession("user");
    return { ok: true, status: session.status };
  });

  // GET /api/sessions/:sessionId/report
  app.get("/api/sessions/:sessionId/report", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = sessions.get(sessionId);
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    if (session.status !== "ended") {
      return reply.status(400).send({
        error: "Session has not ended yet",
        status: session.status,
      });
    }

    try {
      const report = await session.getOrGenerateReport();
      return report;
    } catch (err) {
      console.error(`[App] Failed to generate report for session ${sessionId}:`, err);
      return reply.status(500).send({
        error: err instanceof Error ? err.message : "Failed to generate performance report",
      });
    }
  });

  // GET /api/sessions/:sessionId/missed-opportunities
  app.get("/api/sessions/:sessionId/missed-opportunities", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = sessions.get(sessionId);
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    if (session.status !== "ended") {
      return reply.status(400).send({
        error: "Session has not ended yet",
        status: session.status,
      });
    }

    const report = await session.getOrGenerateReport();
    return report.missedOpportunities || [];
  });

  // POST /api/sessions/:sessionId/retry
  app.post("/api/sessions/:sessionId/retry", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = sessions.get(sessionId);
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    const body = req.body as { opportunityId?: string; retryResponse?: string };
    const opportunityId = body?.opportunityId;
    const retryResponse = (body?.retryResponse || "").trim();

    if (!opportunityId || !retryResponse) {
      return reply.status(400).send({ error: "opportunityId and non-empty retryResponse are required" });
    }

    const report = await session.getOrGenerateReport();
    const opportunity = (report.missedOpportunities || []).find((o) => o.id === opportunityId);

    if (!opportunity) {
      return reply.status(404).send({ error: "Missed opportunity not found" });
    }

    const originalSegment = session.turnManager.getTranscript().find((s) => s.id === opportunity.segmentId);

    const { evaluateRetryAttempt } = await import("./report/retryEngine");
    const retryAttempt = await evaluateRetryAttempt({
      sessionId: session.id,
      opportunity,
      originalSegment,
      retryResponse,
    });

    session.addRetryAttempt(retryAttempt);
    return reply.status(201).send(retryAttempt);
  });

  // GET /api/retries/:retryId
  app.get("/api/retries/:retryId", async (req, reply) => {
    const { retryId } = req.params as { retryId: string };
    for (const session of sessions.values()) {
      const attempt = session.getRetryAttempt(retryId);
      if (attempt) {
        return attempt;
      }
    }
    return reply.status(404).send({ error: "Retry attempt not found" });
  });

  // PRD §15 WebSocket live session endpoint
  app.get("/ws/session/:sessionId", { websocket: true }, (socket, req) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = sessions.get(sessionId);

    if (!session) {
      socket.send(
        JSON.stringify({
          type: "error",
          tMs: 0,
          data: { code: "SESSION_NOT_FOUND", message: "Session does not exist", recoverable: false },
        })
      );
      socket.close();
      return;
    }

    // Subscribe client socket to session events
    session.addSubscriber(socket);

    socket.on("message", (raw) => {
      try {
        const parsed = JSON.parse(raw.toString());
        console.log("[WS] received:", parsed);
        session.handleClientMessage(parsed);
      } catch (e) {
        console.error("[WS] invalid json frame:", e);
      }
    });

    socket.on("close", () => {
      session.removeSubscriber(socket);
    });

    socket.on("error", () => {
      session.removeSubscriber(socket);
    });
  });

  return app;
}


