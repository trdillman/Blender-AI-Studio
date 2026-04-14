import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";

type LlmProvider = "openai" | "anthropic" | "gemini";

type ChatMessage = {
  role: string;
  content?: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
};

type LlmChatRequest = {
  provider?: LlmProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  messages: ChatMessage[];
  tools?: any[];
  systemInstruction?: string;
  stream?: boolean;
};

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' })); // Allow large screenshots
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      console.error("JSON parse error:", err);
      return res.status(400).json({ error: "Invalid JSON" });
    }
    next(err);
  });

  // Store connected Web Clients
  const webClients = new Set<WebSocket>();
  
  // Store pending messages for Blender
  let pendingMessagesForBlender: any[] = [];
  let lastBlenderSeen = 0;
  let isBlenderConnected = false;

  // Check Blender connection status
  setInterval(() => {
    const now = Date.now();
    const wasConnected = isBlenderConnected;
    isBlenderConnected = (now - lastBlenderSeen) < 5000; // 5 seconds timeout
    
    if (wasConnected !== isBlenderConnected) {
      broadcastToWeb({ type: "BLENDER_STATUS", connected: isBlenderConnected });
    }
  }, 2000);

  wss.on("connection", (ws) => {
    webClients.add(ws);
    ws.send(JSON.stringify({ type: "BLENDER_STATUS", connected: isBlenderConnected }));
    
    ws.on("close", () => webClients.delete(ws));

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        // Forward from Web Client to Blender via polling queue
        pendingMessagesForBlender.push(message);
      } catch (e) {
        console.error("Failed to parse message", e);
      }
    });
  });

  function broadcastToWeb(message: any) {
    const payload = JSON.stringify(message);
    webClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  // HTTP Polling endpoint for Blender
  app.use("/api/blender/poll", (req, res) => {
    lastBlenderSeen = Date.now();
    
    // Process incoming messages from Blender
    const messages = req.body?.messages || [];
    for (const msg of messages) {
      broadcastToWeb(msg);
    }
    
    // Send pending messages to Blender
    res.json({ messages: pendingMessagesForBlender });
    pendingMessagesForBlender = []; // Clear queue
  });

  // API Routes
  const writeSse = (res: express.Response, event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const setupSse = (res: express.Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
  };

  const parseSseStream = async (
    response: Response,
    onEvent: (eventName: string, payload: any) => void
  ) => {
    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "message";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";

      for (const chunk of chunks) {
        const lines = chunk.split("\n");
        let data = "";
        currentEvent = "message";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            data += line.slice(5).trim();
          }
        }

        if (!data || data === "[DONE]") continue;
        try {
          onEvent(currentEvent, JSON.parse(data));
        } catch {
          // Best-effort stream parsing
        }
      }
    }
  };

  app.post("/api/llm/chat", async (req, res) => {
    const body = req.body as LlmChatRequest;
    const provider: LlmProvider = body.provider || "gemini";
    const stream = !!body.stream;

    const emitFallbackResponse = async (reason: string) => {
      const result = await runNonStreamingChat(body);
      writeSse(res, "fallback", { reason });
      writeSse(res, "result", result);
      writeSse(res, "done", {});
      res.end();
    };

    const runNonStreamingChat = async (request: LlmChatRequest) => {
      if (provider === "gemini") {
        const ai = new GoogleGenAI({ apiKey: request.apiKey || process.env.GEMINI_API_KEY || "" });
        const result = await ai.models.generateContent({
          model: request.model,
          contents: request.messages.map((m) => ({
            role: m.role === "assistant" ? "model" : m.role,
            parts: [{ text: m.content || "" }]
          })),
          config: {
            systemInstruction: request.systemInstruction,
            tools: request.tools
          }
        });
        return {
          text: result.text || "",
          toolCalls: result.functionCalls || []
        };
      }

      if (provider === "anthropic") {
        const baseUrl = request.baseUrl || "https://api.anthropic.com";
        const response = await fetch(`${baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": request.apiKey || process.env.ANTHROPIC_API_KEY || "",
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: request.model,
            messages: request.messages
              .filter((m) => m.role === "user" || m.role === "assistant")
              .map((m) => ({ role: m.role, content: m.content || "" })),
            system: request.systemInstruction,
            tools: request.tools
          })
        });
        const payload = await response.json();
        const text = (payload.content || [])
          .filter((item: any) => item.type === "text")
          .map((item: any) => item.text)
          .join("");
        const toolCalls = (payload.content || [])
          .filter((item: any) => item.type === "tool_use")
          .map((item: any) => ({ id: item.id, name: item.name, args: item.input }));
        return { text, toolCalls };
      }

      const baseUrl = body.baseUrl || "https://api.openai.com";
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${body.apiKey || process.env.OPENAI_API_KEY || ""}`
        },
        body: JSON.stringify({
          model: body.model,
          messages: body.messages.map((m) => ({
            role: m.role === "model" ? "assistant" : m.role,
            content: m.content || ""
          })),
          tools: body.tools
        })
      });
      const payload = await response.json();
      const message = payload.choices?.[0]?.message || {};
      return { text: message.content || "", toolCalls: message.tool_calls || [] };
    };

    try {
      if (!stream) {
        const result = await runNonStreamingChat(body);
        return res.json(result);
      }

      setupSse(res);

      if (provider === "gemini") {
        try {
          const ai = new GoogleGenAI({ apiKey: body.apiKey || process.env.GEMINI_API_KEY || "" });
          const geminiStream = await ai.models.generateContentStream({
            model: body.model,
            contents: body.messages.map((m) => ({
              role: m.role === "assistant" ? "model" : m.role,
              parts: [{ text: m.content || "" }]
            })),
            config: {
              systemInstruction: body.systemInstruction,
              tools: body.tools
            }
          });

          let emittedText = "";
          for await (const chunk of geminiStream) {
            const text = chunk.text || "";
            if (text) {
              emittedText += text;
              writeSse(res, "text-delta", { textDelta: text, text: emittedText });
            }
            const calls = chunk.functionCalls || [];
            if (calls.length > 0) {
              writeSse(res, "tool-call", { toolCalls: calls });
            }
          }
          writeSse(res, "done", {});
          return res.end();
        } catch {
          return emitFallbackResponse("Gemini streaming unavailable");
        }
      }

      if (provider === "openai") {
        const baseUrl = body.baseUrl || "https://api.openai.com";
        try {
          const response = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${body.apiKey || process.env.OPENAI_API_KEY || ""}`
            },
            body: JSON.stringify({
              model: body.model,
              stream: true,
              messages: body.messages.map((m) => ({
                role: m.role === "model" ? "assistant" : m.role,
                content: m.content || ""
              })),
              tools: body.tools
            })
          });

          let accumulatedText = "";
          const toolCallMap = new Map<number, any>();
          await parseSseStream(response, (_event, payload) => {
            const delta = payload.choices?.[0]?.delta;
            if (!delta) return;
            if (delta.content) {
              accumulatedText += delta.content;
              writeSse(res, "text-delta", { textDelta: delta.content, text: accumulatedText });
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const existing = toolCallMap.get(tc.index) || { id: tc.id, function: { name: "", arguments: "" } };
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.function.name = tc.function.name;
                if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
                toolCallMap.set(tc.index, existing);
              }
              writeSse(res, "tool-call", { toolCalls: Array.from(toolCallMap.values()) });
            }
          });
          writeSse(res, "done", {});
          return res.end();
        } catch {
          return emitFallbackResponse("OpenAI-compatible streaming unavailable");
        }
      }

      if (provider === "anthropic") {
        const baseUrl = body.baseUrl || "https://api.anthropic.com";
        try {
          const response = await fetch(`${baseUrl}/v1/messages`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": body.apiKey || process.env.ANTHROPIC_API_KEY || "",
              "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
              model: body.model,
              system: body.systemInstruction,
              stream: true,
              messages: body.messages
                .filter((m) => m.role === "user" || m.role === "assistant")
                .map((m) => ({ role: m.role, content: m.content || "" })),
              tools: body.tools
            })
          });

          const toolUses = new Map<string, any>();
          await parseSseStream(response, (event, payload) => {
            if (event === "content_block_delta" && payload.delta?.type === "text_delta") {
              writeSse(res, "text-delta", { textDelta: payload.delta.text });
            }
            if (event === "content_block_start" && payload.content_block?.type === "tool_use") {
              toolUses.set(payload.index, {
                id: payload.content_block.id,
                name: payload.content_block.name,
                args: {}
              });
              writeSse(res, "tool-call", { toolCalls: Array.from(toolUses.values()) });
            }
            if (event === "content_block_delta" && payload.delta?.type === "input_json_delta") {
              const existing = toolUses.get(payload.index);
              if (existing) {
                existing.argsRaw = (existing.argsRaw || "") + (payload.delta.partial_json || "");
                writeSse(res, "tool-call", { toolCalls: Array.from(toolUses.values()) });
              }
            }
          });
          writeSse(res, "done", {});
          return res.end();
        } catch {
          return emitFallbackResponse("Anthropic-compatible streaming unavailable");
        }
      }

      writeSse(res, "error", { message: `Unsupported provider: ${provider}` });
      writeSse(res, "done", {});
      res.end();
    } catch (error) {
      if (stream) {
        writeSse(res, "error", { message: String(error) });
        writeSse(res, "done", {});
        return res.end();
      }
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/status", (req, res) => {
    res.json({ blenderConnected: isBlenderConnected });
  });

  // Serve the python agent script for easy downloading
  app.get("/api/agent-script", (req, res) => {
    try {
      let script = fs.readFileSync(path.join(process.cwd(), "blender_agent.py"), "utf-8");
      
      // Dynamically inject the correct URL based on the request host
      const host = req.headers["x-forwarded-host"] || req.headers.host || "";
      const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1");
      const protocol = isLocalhost ? "http:" : "https:";
      
      // Use APP_URL if available, otherwise fallback to constructed URL
      let baseUrl = process.env.APP_URL;
      if (!baseUrl) {
        baseUrl = `${protocol}//${host}`;
      }
      
      // Ensure no trailing slash
      baseUrl = baseUrl.replace(/\/$/, "");
      const url = `${baseUrl}/api/blender`;
      
      script = script.replace(
        /SERVER_URL = .*/,
        `SERVER_URL = os.environ.get("BLENDER_AI_URL", "${url}")`
      );
      
      res.type("text/plain").send(script);
    } catch (e) {
      console.error("Error serving agent script:", e);
      res.status(500).send(String(e));
    }
  });

  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
