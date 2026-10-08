import { describe, expect, it } from "vitest";
import { Topic } from "@gd-arena/contracts";
import { buildApp } from "./app";

describe("server shell", () => {
  it("GET /health returns ok and health status", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("ok");
    expect(body.uptimeSec).toBeGreaterThanOrEqual(0);
  });
  it("GET /api/topics returns valid preset topics", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/topics" });
    expect(res.statusCode).toBe(200);
    const topics = res.json();
    expect(topics.length).toBeGreaterThanOrEqual(5);
    for (const t of topics) expect(Topic.safeParse(t).success).toBe(true);
  });

  it("POST /api/sessions creates a session with valid configuration", async () => {
    const app = await buildApp();
    const payload = {
      topic: "Will AI create more jobs than it destroys?",
      panelSize: 3,
      durationSec: 480,
      patienceMs: 1200,
    };
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("lobby");
    expect(body.config).toEqual(payload);
  });

  it("POST /api/sessions rejects invalid configuration", async () => {
    const app = await buildApp();
    const invalidPayload = {
      topic: "AI", // too short (min 5 chars)
      panelSize: 10, // invalid panel size (max 5)
      durationSec: 60, // too short (min 180s)
    };
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: invalidPayload,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("Invalid session configuration");
    expect(body.details).toBeDefined();
  });

  it("POST /api/sessions/:id/end transitions session to ended", async () => {
    const app = await buildApp();
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        topic: "Remote work: the future of work?",
        panelSize: 4,
        durationSec: 300,
        patienceMs: 1200,
      },
    });
    const { id } = createRes.json();

    const getRes = await app.inject({ method: "GET", url: `/api/sessions/${id}` });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().id).toBe(id);

    const endRes = await app.inject({ method: "POST", url: `/api/sessions/${id}/end` });
    expect(endRes.statusCode).toBe(200);
    expect(endRes.json()).toEqual({ ok: true, status: "ended" });

    const getEndedRes = await app.inject({ method: "GET", url: `/api/sessions/${id}` });
    expect(getEndedRes.json().status).toBe("ended");
  });

  it("GET /api/sessions/:id/report handles active vs ended sessions", async () => {
    const app = await buildApp();
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        topic: "Impact of Artificial Intelligence on Future Jobs",
        panelSize: 3,
        durationSec: 300,
        patienceMs: 1200,
      },
    });
    const { id } = createRes.json();

    // 1. Report request when session has not ended
    const activeReportRes = await app.inject({ method: "GET", url: `/api/sessions/${id}/report` });
    expect(activeReportRes.statusCode).toBe(400);
    expect(activeReportRes.json().error).toBe("Session has not ended yet");

    // 2. End session
    await app.inject({ method: "POST", url: `/api/sessions/${id}/end` });

    // 3. Report request when session is ended
    const endedReportRes = await app.inject({ method: "GET", url: `/api/sessions/${id}/report` });
    expect(endedReportRes.statusCode).toBe(200);
    const report = endedReportRes.json();
    expect(report.sessionId).toBe(id);
    expect(report.scores.length).toBe(8);
    expect(report.metrics).toBeDefined();

    // 4. Repeated request returns cached report
    const cachedReportRes = await app.inject({ method: "GET", url: `/api/sessions/${id}/report` });
    expect(cachedReportRes.statusCode).toBe(200);
    expect(cachedReportRes.json()).toEqual(report);
  });
});


