import express from "express";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { MeetingStore, publicMeeting } from "./store";
import { MeetingWorker, safeError } from "./worker";
import { activity, newMeeting, meetingMarkdown } from "./domain";
import { advanceDemo } from "./demo";
import { createLiveCall } from "./providers/live";

export function createApp(
  store = new MeetingStore(),
  worker = new MeetingWorker(store),
) {
  const app = express();
  app.disable("x-powered-by");
  // Local prototype: defend the credential-bearing API from cross-origin pages and DNS rebinding.
  app.use("/api", (req, res, next) => {
    const host = req.hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host))
      return void res
        .status(403)
        .json({ error: "Sidekick is available on localhost only." });
    const origin = req.get("origin");
    if (origin && origin !== `${req.protocol}://${req.get("host")}`)
      return void res
        .status(403)
        .json({ error: "Cross-origin API requests are not allowed." });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  app.get("/api/config", (_req, res) =>
    res.json({
      integrations: [
        {
          id: "agents",
          name: "OpenAI Agents",
          configured: Boolean(process.env.OPENAI_API_KEY),
          description: "Reviews the discussion and drafts files",
        },
        {
          id: "live",
          name: "GPT-Live",
          configured: Boolean(process.env.OPENAI_API_KEY),
          description: "Lets your team speak with Sidekick",
        },
        {
          id: "exa",
          name: "Exa",
          configured: Boolean(process.env.EXA_API_KEY),
          description: "Research with source links",
        },
        {
          id: "ambiguous",
          name: "Ambiguous AI",
          configured: Boolean(process.env.AMBIGUOUS_API_KEY),
          description:
            "Saves documents, presentations, spreadsheets, and meeting records",
        },
      ],
      liveReady: Boolean(process.env.OPENAI_API_KEY),
      workspaceUrl: "https://app.ambiguous.ai/",
    }),
  );
  app.get("/api/meetings", (_req, res) => res.json(store.all()));
  app.post("/api/meetings", (req, res) => {
    const { mode } = z
      .object({ mode: z.enum(["live", "demo"]) })
      .parse(req.body);
    const meeting = newMeeting(mode);
    activity(
      meeting,
      "system",
      mode === "demo" ? "Demo workspace opened" : "Meeting started",
      mode === "demo"
        ? "Simulated scenario. No microphone, live research, or workspace writes."
        : "Speak naturally or add a written contribution.",
    );
    store.save(meeting);
    res.status(201).json(publicMeeting(meeting));
  });
  app.get("/api/meetings/:id", (req, res) =>
    res.json(publicMeeting(store.get(req.params.id))),
  );
  app.get("/api/meetings/:id/events", (req, res) => {
    const meeting = store.get(req.params.id);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const send = (data: unknown) =>
      res.write(`event: meeting\ndata: ${JSON.stringify(data)}\n\n`);
    send(publicMeeting(meeting));
    store.events.on(meeting.id, send);
    const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      store.events.off(meeting.id, send);
    });
  });
  app.post("/api/meetings/:id/transcript", (req, res) => {
    const meeting = store.get(req.params.id);
    if (meeting.phase !== "active")
      return void res
        .status(409)
        .json({ error: "This meeting has stopped accepting contributions." });
    const { text, role, eventId, audio } = z
      .object({
        text: z.string().min(1).max(16000),
        role: z.enum(["user", "assistant"]).default("user"),
        eventId: z.string().max(8000).optional(),
        audio: z.boolean().default(false),
      })
      .parse(req.body);
    if (eventId && meeting.receivedEventIds?.includes(eventId))
      return void res.json(publicMeeting(meeting));
    if (meeting.transcript.length >= 3000)
      return void res.status(409).json({
        error:
          "This meeting reached its transcript limit. Close it and start another meeting.",
      });
    const previous = meeting.transcript.at(-1);
    if (
      audio &&
      previous?.audio &&
      previous.role === role &&
      previous.text.length < 16000
    )
      previous.text += text;
    else
      meeting.transcript.push({
        id: randomUUID(),
        text,
        role,
        at: new Date().toISOString(),
        audio,
      });
    if (eventId) {
      meeting.receivedEventIds ??= [];
      meeting.receivedEventIds.push(eventId);
    }
    if (role === "user") meeting.revision++;
    store.save(meeting);
    if (meeting.mode === "live" && role === "user") worker.schedule(meeting.id);
    res.json(publicMeeting(meeting));
  });
  app.post("/api/meetings/:id/voice", async (req, res) => {
    const meeting = store.get(req.params.id);
    if (meeting.phase !== "active" || meeting.mode !== "live")
      return void res
        .status(409)
        .json({ error: "Start an active live meeting to connect audio." });
    const { sdp } = z.object({ sdp: z.string().max(65536) }).parse(req.body);
    res.json(await createLiveCall(sdp));
  });
  app.post("/api/meetings/:id/delegate", async (req, res) => {
    const { delegationId } = z
      .object({ delegationId: z.string().min(1).max(300) })
      .parse(req.body);
    const meeting = store.get(req.params.id);
    if (meeting.mode !== "live" || meeting.phase === "ended")
      return void res
        .status(409)
        .json({ error: "This meeting is not accepting voice delegations." });
    res.json(await worker.delegate(meeting.id, delegationId));
  });
  app.post("/api/meetings/:id/demo", (req, res) => {
    const meeting = store.get(req.params.id);
    if (meeting.mode !== "demo")
      return void res
        .status(409)
        .json({ error: "Demo events are only available in demo meetings." });
    advanceDemo(meeting);
    store.save(meeting);
    res.json(publicMeeting(meeting));
  });
  app.post("/api/meetings/:id/close", (req, res) => {
    const meeting = store.get(req.params.id);
    if (meeting.phase === "active") {
      if (meeting.mode === "demo") {
        meeting.phase = "ended";
        meeting.endedAt = new Date().toISOString();
        for (const doc of meeting.documents)
          if (doc.status === "draft") doc.status = "incomplete";
      } else {
        meeting.phase = "closing";
        meeting.revision++;
        activity(
          meeting,
          "system",
          "Wrapping up",
          "Audio has stopped. Preparing the meeting record, including unfinished tasks and open questions.",
        );
      }
      store.save(meeting);
      if (meeting.mode === "live") worker.schedule(meeting.id, true);
    }
    res.json(publicMeeting(meeting));
  });
  app.post('/api/meetings/:id/workspace/refresh', async (req, res) => {
    const options = z.object({documentId:z.string().min(1).max(100).optional(),force:z.boolean().optional()}).parse(req.body ?? {});
    res.json(publicMeeting(await worker.refreshWorkspace(req.params.id, options)));
  });
  app.post('/api/meetings/:id/workspace/update', (req, res) => {
    res.json(publicMeeting(worker.updateFromWorkspace(req.params.id)));
  });
  app.post('/api/meetings/:id/documents/:documentId/comments', async (req, res) => {
    const input = z.object({content:z.string().trim().min(1).max(10000),parentId:z.string().min(1).max(200).optional()}).parse(req.body);
    res.status(201).json(publicMeeting(await worker.addWorkspaceComment(req.params.id,req.params.documentId,input.content,input.parentId)));
  });
  app.post('/api/meetings/:id/documents/:documentId/resolve', async (req, res) => {
    const input = z.object({action:z.enum(['keep-workspace','apply-draft']),draftId:z.string().min(1).max(100),workspaceVersion:z.string().min(1).max(200)}).parse(req.body);
    res.json(publicMeeting(await worker.resolveWorkspaceDraft(req.params.id,req.params.documentId,input)));
  });
  app.post("/api/meetings/:id/retry", (req, res) => {
    const meeting = store.get(req.params.id);
    if (meeting.mode === "live" && !meeting.working) {
      if (meeting.phase === "ended") meeting.phase = "closing";
      meeting.revision++;
      meeting.error = undefined;
      store.save(meeting);
      worker.schedule(meeting.id, true);
    }
    res.json(publicMeeting(meeting));
  });
  app.get("/api/meetings/:id/export", (req, res) => {
    const meeting = store.get(req.params.id);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="sidekick-${meeting.id.slice(0, 8)}.md"`,
    );
    res.type("text/markdown").send(meetingMarkdown(meeting, true));
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API route not found." }),
  );
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status =
        error instanceof ZodError
          ? 400
          : error &&
              typeof error === "object" &&
              "status" in error &&
              typeof error.status === "number"
            ? error.status
            : 500;
      res.status(status >= 400 && status <= 599 ? status : 500).json({
        error:
          error instanceof ZodError
            ? "Invalid request. Check the supplied fields."
            : safeError(error),
      });
    },
  );
  return app;
}
