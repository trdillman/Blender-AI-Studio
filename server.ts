import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import fs from "fs";

type ProviderName = "openai" | "anthropic" | "gemini" | "lmstudio";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

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

  app.post("/api/providers/test", async (req, res) => {
    const { provider, apiKey, baseUrl, model } = req.body as {
      provider?: ProviderName;
      apiKey?: string;
      baseUrl?: string;
      model?: string;
    };

    if (!provider || !["openai", "anthropic", "gemini", "lmstudio"].includes(provider)) {
      return res.status(400).json({ ok: false, error: "Invalid provider." });
    }

    if (!model || !String(model).trim()) {
      return res.status(400).json({ ok: false, error: "Model is required." });
    }

    if (!baseUrl || !isValidHttpUrl(baseUrl)) {
      return res.status(400).json({ ok: false, error: "A valid base URL is required." });
    }

    if (["openai", "anthropic", "gemini"].includes(provider) && !String(apiKey || "").trim()) {
      return res.status(400).json({ ok: false, error: `${provider} API key is required.` });
    }

    try {
      const normalizedBaseUrl = trimTrailingSlash(baseUrl);
      let response: Response;

      if (provider === "openai" || provider === "lmstudio") {
        const headers: Record<string, string> = {};
        if (apiKey?.trim()) {
          headers.Authorization = `Bearer ${apiKey.trim()}`;
        }
        response = await fetch(`${normalizedBaseUrl}/models`, { method: "GET", headers });
      } else if (provider === "anthropic") {
        response = await fetch(normalizedBaseUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": String(apiKey).trim(),
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: String(model).trim(),
            max_tokens: 1,
            messages: [{ role: "user", content: "ping" }]
          })
        });
      } else {
        const endpoint = `${normalizedBaseUrl}/models/${encodeURIComponent(String(model).trim())}:generateContent?key=${encodeURIComponent(String(apiKey).trim())}`;
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] })
        });
      }

      if (!response.ok) {
        const text = await response.text();
        return res.status(response.status).json({
          ok: false,
          error: text.slice(0, 300) || `Provider test failed with status ${response.status}.`
        });
      }

      return res.json({ ok: true, message: "Connection successful." });
    } catch (error) {
      console.error("Provider connection test failed:", error);
      return res.status(502).json({ ok: false, error: "Unable to reach the provider endpoint." });
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
