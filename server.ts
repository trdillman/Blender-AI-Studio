import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import fs from "fs";
import os from "os";
import { GoogleGenAI } from "@google/genai";

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
  app.get("/api/status", (req, res) => {
    res.json({ blenderConnected: isBlenderConnected });
  });

  app.get("/api/lmstudio/discover", async (req, res) => {
    const home = os.homedir();
    const candidates = [
      "C:\\Program Files\\LM Studio\\LM Studio.exe",
      "C:\\Users\\Public\\AppData\\Local\\Programs\\LM Studio\\LM Studio.exe",
      path.join(home, "AppData", "Local", "Programs", "LM Studio", "LM Studio.exe"),
      "/Applications/LM Studio.app",
      path.join(home, "Applications", "LM Studio.app"),
      "/usr/bin/lmstudio",
      "/usr/local/bin/lmstudio",
      path.join(home, ".local", "bin", "lmstudio")
    ];

    const installations = candidates.filter((p) => fs.existsSync(p));
    const endpoint = process.env.LMSTUDIO_BASE_URL || "http://127.0.0.1:1234/v1";
    let models: string[] = [];
    try {
      const r = await fetch(`${endpoint.replace(/\/$/, "")}/models`);
      if (r.ok) {
        const json: any = await r.json();
        models = Array.isArray(json?.data) ? json.data.map((m: any) => m?.id).filter(Boolean) : [];
      }
    } catch (_e) {}

    res.json({ installations, models, endpoint });
  });

  // SSE helpers
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

  app.post("/api/llm/chat", async (req, res) => {
    try {
      const { config, contents, systemInstruction, tools } = req.body || {};
      const provider = config?.provider;
      const model = config?.model;
      const key = config?.apiKey || "";
      const baseUrl = (config?.baseUrl || "").replace(/\/$/, "");
      const stream = !!config?.stream;

      if (!provider || !model) {
        return res.status(400).json({ error: "Missing provider or model" });
      }

      if (provider === "gemini") {
        const apiKey = key || process.env.GEMINI_API_KEY || "";
        const ai = new GoogleGenAI({ apiKey });

        if (stream) {
          setupSse(res);
          try {
            const geminiStream = await ai.models.generateContentStream({
              model,
              contents,
              config: { systemInstruction, tools: [{ functionDeclarations: tools }] }
            });
            let emittedText = "";
            for await (const chunk of geminiStream) {
              if (chunk.text) {
                emittedText += chunk.text;
                writeSse(res, "text-delta", { textDelta: chunk.text, text: emittedText });
              }
              const calls = chunk.functionCalls || [];
              if (calls.length > 0) {
                writeSse(res, "tool-call", { toolCalls: calls });
              }
            }
            writeSse(res, "done", {});
            return res.end();
          } catch {
            const response = await ai.models.generateContent({
              model,
              contents,
              config: { systemInstruction, tools: [{ functionDeclarations: tools }] }
            });
            writeSse(res, "fallback", { reason: "Gemini streaming unavailable" });
            writeSse(res, "result", { text: response.text, functionCalls: response.functionCalls });
            writeSse(res, "done", {});
            return res.end();
          }
        }

        const response = await ai.models.generateContent({
          model,
          contents,
          config: { systemInstruction, tools: [{ functionDeclarations: tools }] }
        });
        return res.json({ text: response.text, functionCalls: response.functionCalls });
      }

      if (provider === "openai" || provider === "lmstudio") {
        const endpoint = baseUrl || (provider === "lmstudio" ? "http://127.0.0.1:1234/v1" : "https://api.openai.com/v1");
        const oaiMessages = [
          { role: "system", content: systemInstruction },
          ...toOpenAiMessages(contents)
        ];
        const oaiTools = (tools || []).map((t: any) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters }
        }));

        if (stream) {
          setupSse(res);
          try {
            const r = await fetch(`${endpoint}/chat/completions`, {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
              body: JSON.stringify({ model, stream: true, messages: oaiMessages, tools: oaiTools })
            });
            const reader = r.body?.getReader();
            const decoder = new TextDecoder();
            let sseBuffer = "";
            let accText = "";
            const toolCallMap = new Map<number, any>();
            while (reader) {
              const { done, value } = await reader.read();
              if (done) break;
              sseBuffer += decoder.decode(value, { stream: true });
              const sseChunks = sseBuffer.split("\n\n");
              sseBuffer = sseChunks.pop() || "";
              for (const sseChunk of sseChunks) {
                for (const line of sseChunk.split("\n")) {
                  if (!line.startsWith("data: ")) continue;
                  const raw = line.slice(6).trim();
                  if (raw === "[DONE]") continue;
                  try {
                    const parsed = JSON.parse(raw);
                    const delta = parsed.choices?.[0]?.delta;
                    if (delta?.content) {
                      accText += delta.content;
                      writeSse(res, "text-delta", { textDelta: delta.content, text: accText });
                    }
                    if (delta?.tool_calls) {
                      for (const tc of delta.tool_calls) {
                        const existing = toolCallMap.get(tc.index) || { id: "", name: "", argsRaw: "" };
                        if (tc.id) existing.id = tc.id;
                        if (tc.function?.name) existing.name = tc.function.name;
                        if (tc.function?.arguments) existing.argsRaw = (existing.argsRaw || "") + tc.function.arguments;
                        toolCallMap.set(tc.index, existing);
                      }
                      writeSse(res, "tool-call", {
                        toolCalls: Array.from(toolCallMap.values()).map((tc) => ({
                          name: tc.name,
                          args: safeJson(tc.argsRaw)
                        }))
                      });
                    }
                  } catch { /* best-effort */ }
                }
              }
            }
            writeSse(res, "done", {});
            return res.end();
          } catch {
            // Fallback to non-streaming
            const r = await fetch(`${endpoint}/chat/completions`, {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
              body: JSON.stringify({ model, messages: oaiMessages, tools: oaiTools })
            });
            const data: any = await r.json();
            const choice = data?.choices?.[0]?.message || {};
            const functionCalls = Array.isArray(choice.tool_calls)
              ? choice.tool_calls.filter((c: any) => c?.type === "function").map((c: any) => ({ name: c.function.name, args: safeJson(c.function.arguments) }))
              : [];
            writeSse(res, "fallback", { reason: "OpenAI streaming unavailable" });
            writeSse(res, "result", { text: choice.content || "", functionCalls });
            writeSse(res, "done", {});
            return res.end();
          }
        }

        const r = await fetch(`${endpoint}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
          body: JSON.stringify({ model, messages: oaiMessages, tools: oaiTools })
        });
        const data: any = await r.json();
        if (!r.ok) return res.status(r.status).json(data);
        const choice = data?.choices?.[0]?.message || {};
        const functionCalls = Array.isArray(choice.tool_calls)
          ? choice.tool_calls.filter((c: any) => c?.type === "function").map((c: any) => ({ name: c.function.name, args: safeJson(c.function.arguments) }))
          : [];
        return res.json({ text: choice.content || "", functionCalls });
      }

      if (provider === "anthropic") {
        const endpoint = baseUrl || "https://api.anthropic.com";
        const anthropicMessages = toAnthropicMessages(contents);
        const anthropicTools = (tools || []).map((t: any) => ({ name: t.name, description: t.description, input_schema: t.parameters }));

        if (stream) {
          setupSse(res);
          try {
            const r = await fetch(`${endpoint}/v1/messages`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
              body: JSON.stringify({ model, system: systemInstruction, max_tokens: 1500, stream: true, messages: anthropicMessages, tools: anthropicTools })
            });
            const reader = r.body?.getReader();
            const decoder = new TextDecoder();
            let sseBuffer = "";
            let accText = "";
            const toolUses = new Map<string | number, any>();
            while (reader) {
              const { done, value } = await reader.read();
              if (done) break;
              sseBuffer += decoder.decode(value, { stream: true });
              const sseChunks = sseBuffer.split("\n\n");
              sseBuffer = sseChunks.pop() || "";
              for (const sseChunk of sseChunks) {
                let eventName = "message";
                let eventData = "";
                for (const line of sseChunk.split("\n")) {
                  if (line.startsWith("event:")) eventName = line.slice(6).trim();
                  if (line.startsWith("data:")) eventData += line.slice(5).trim();
                }
                if (!eventData) continue;
                try {
                  const payload = JSON.parse(eventData);
                  if (eventName === "content_block_delta" && payload.delta?.type === "text_delta") {
                    accText += payload.delta.text || "";
                    writeSse(res, "text-delta", { textDelta: payload.delta.text, text: accText });
                  }
                  if (eventName === "content_block_start" && payload.content_block?.type === "tool_use") {
                    toolUses.set(payload.index, { id: payload.content_block.id, name: payload.content_block.name, args: {} });
                    writeSse(res, "tool-call", { toolCalls: Array.from(toolUses.values()) });
                  }
                  if (eventName === "content_block_delta" && payload.delta?.type === "input_json_delta") {
                    const existing = toolUses.get(payload.index);
                    if (existing) {
                      existing.argsRaw = (existing.argsRaw || "") + (payload.delta.partial_json || "");
                      const updated = { ...existing, args: safeJson(existing.argsRaw) };
                      toolUses.set(payload.index, updated);
                      writeSse(res, "tool-call", { toolCalls: Array.from(toolUses.values()) });
                    }
                  }
                } catch { /* best-effort */ }
              }
            }
            writeSse(res, "done", {});
            return res.end();
          } catch {
            const r = await fetch(`${endpoint}/v1/messages`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
              body: JSON.stringify({ model, system: systemInstruction, max_tokens: 1500, messages: anthropicMessages, tools: anthropicTools })
            });
            const data: any = await r.json();
            const text = Array.isArray(data?.content) ? data.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n") : "";
            const functionCalls = Array.isArray(data?.content)
              ? data.content.filter((c: any) => c.type === "tool_use").map((c: any) => ({ name: c.name, args: c.input || {} }))
              : [];
            writeSse(res, "fallback", { reason: "Anthropic streaming unavailable" });
            writeSse(res, "result", { text, functionCalls });
            writeSse(res, "done", {});
            return res.end();
          }
        }

        const r = await fetch(`${endpoint}/v1/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model, system: systemInstruction, max_tokens: 1500, messages: anthropicMessages, tools: anthropicTools })
        });
        const data: any = await r.json();
        if (!r.ok) return res.status(r.status).json(data);
        const text = Array.isArray(data?.content) ? data.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n") : "";
        const functionCalls = Array.isArray(data?.content)
          ? data.content.filter((c: any) => c.type === "tool_use").map((c: any) => ({ name: c.name, args: c.input || {} }))
          : [];
        return res.json({ text, functionCalls });
      }

      return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    } catch (e: any) {
      console.error("LLM API error", e);
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // PR #6 — provider connection test
  app.post("/api/providers/test", async (req, res) => {
    try {
      const { provider, model, apiKey, baseUrl } = req.body || {};
      if (!provider || !model) {
        return res.status(400).json({ ok: false, error: "Missing provider or model" });
      }

      if (provider === "gemini") {
        const key = apiKey || process.env.GEMINI_API_KEY || "";
        const ai = new GoogleGenAI({ apiKey: key });
        await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: "ping" }] }],
          config: { systemInstruction: "Reply with one word." }
        });
        return res.json({ ok: true, message: "Gemini connection successful." });
      }

      if (provider === "openai" || provider === "lmstudio") {
        const endpoint = (baseUrl || (provider === "lmstudio" ? "http://127.0.0.1:1234/v1" : "https://api.openai.com/v1")).replace(/\/$/, "");
        const r = await fetch(`${endpoint}/models`, {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
        });
        if (!r.ok) return res.status(r.status).json({ ok: false, error: `Provider returned ${r.status}` });
        return res.json({ ok: true, message: `${provider === "lmstudio" ? "LM Studio" : "OpenAI"} connection successful.` });
      }

      if (provider === "anthropic") {
        const endpoint = (baseUrl || "https://api.anthropic.com").replace(/\/$/, "");
        const r = await fetch(`${endpoint}/v1/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey || "", "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: "user", content: "ping" }] })
        });
        if (!r.ok) {
          const err: any = await r.json().catch(() => ({}));
          return res.status(r.status).json({ ok: false, error: err?.error?.message || `Provider returned ${r.status}` });
        }
        return res.json({ ok: true, message: "Anthropic connection successful." });
      }

      return res.status(400).json({ ok: false, error: `Unsupported provider: ${provider}` });
    } catch (e: any) {
      console.error("Provider test error", e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
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

function safeJson(input: string) {
  try {
    return JSON.parse(input || "{}");
  } catch (_e) {
    return {};
  }
}

function toOpenAiMessages(contents: any[]) {
  const msgs: any[] = [];
  for (const entry of contents || []) {
    if (entry.role === "user") {
      const text = (entry.parts || []).map((p: any) => p.text).filter(Boolean).join("\n");
      msgs.push({ role: "user", content: text });
    } else if (entry.role === "model") {
      const functionCalls = (entry.parts || []).filter((p: any) => p.functionCall).map((p: any) => p.functionCall);
      const text = (entry.parts || []).map((p: any) => p.text).filter(Boolean).join("\n");
      if (text) msgs.push({ role: "assistant", content: text });
      if (functionCalls.length) {
        msgs.push({
          role: "assistant",
          content: null,
          tool_calls: functionCalls.map((fc: any, idx: number) => ({
            id: `tool_${Date.now()}_${idx}`,
            type: "function",
            function: { name: fc.name, arguments: JSON.stringify(fc.args || {}) }
          }))
        });
      }
    } else if (entry.role === "function") {
      for (const part of entry.parts || []) {
        if (part.functionResponse) {
          msgs.push({
            role: "tool",
            content: JSON.stringify(part.functionResponse.response || {}),
            tool_call_id: `tool_${part.functionResponse.name}`
          });
        }
      }
    }
  }
  return msgs;
}

function toAnthropicMessages(contents: any[]) {
  const msgs: any[] = [];
  for (const entry of contents || []) {
    if (entry.role === "user") {
      const text = (entry.parts || []).map((p: any) => p.text).filter(Boolean).join("\n");
      msgs.push({ role: "user", content: [{ type: "text", text }] });
    } else if (entry.role === "model") {
      const blocks: any[] = [];
      for (const p of entry.parts || []) {
        if (p.text) blocks.push({ type: "text", text: p.text });
        if (p.functionCall) blocks.push({ type: "tool_use", id: `tool_${p.functionCall.name}`, name: p.functionCall.name, input: p.functionCall.args || {} });
      }
      if (blocks.length) msgs.push({ role: "assistant", content: blocks });
    } else if (entry.role === "function") {
      const blocks = (entry.parts || [])
        .filter((p: any) => p.functionResponse)
        .map((p: any) => ({
          type: "tool_result",
          tool_use_id: `tool_${p.functionResponse.name}`,
          content: JSON.stringify(p.functionResponse.response || {})
        }));
      if (blocks.length) msgs.push({ role: "user", content: blocks });
    }
  }
  return msgs;
}
