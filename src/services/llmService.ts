import { Type, FunctionDeclaration } from "@google/genai";

export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'lmstudio';

export interface ModelPreset {
  label: string;
  model: string;
  provider: ProviderId;
  baseUrl?: string;
}

export interface ProviderConfig {
  provider: ProviderId;
  apiKey?: string;
  baseUrl?: string;
  model: string;
}

export interface LlmMessage {
  role: 'user' | 'model' | 'function';
  parts: any[];
}

export interface LlmFunctionCall {
  name: string;
  args: Record<string, any>;
}

export interface LlmResponse {
  text?: string;
  functionCalls?: LlmFunctionCall[];
}

export const BLENDER_TOOLS: FunctionDeclaration[] = [
  {
    name: "execute_python",
    description: "Execute Python code directly in Blender 5.1. Use this for modeling, animation, rendering, and scene manipulation.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        code: {
          type: Type.STRING,
          description: "The Python script to execute. Must use the 'bpy' module."
        }
      },
      required: ["code"]
    }
  },
  {
    name: "get_scene_data",
    description: "Retrieve information about the current Blender scene, including objects, materials, and collections.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "Specific data to query (e.g., 'objects', 'materials', 'active_object')."
        }
      }
    }
  },
  {
    name: "take_screenshot",
    description: "Capture a screenshot of Blender. Can capture the entire window, the 3D viewport, or the camera view.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        mode: {
          type: Type.STRING,
          enum: ["WINDOW", "VIEWPORT", "CAMERA"],
          description: "The type of screenshot to take: 'WINDOW' (entire UI), 'VIEWPORT' (current 3D view), or 'CAMERA' (3D view from camera perspective)."
        }
      },
      required: ["mode"]
    }
  }
];

export const SYSTEM_INSTRUCTION = `You are an expert Blender 5.1 assistant integrated into a multi-provider AI Studio-like environment.
You have direct access to Blender's Python API (bpy).
When the user asks to create, modify, or analyze something in Blender, use the provided tools.
Always provide clear explanations of the Python code you are running.`;

export const MODEL_PRESETS: ModelPreset[] = [
  { label: 'GPT-5.4', provider: 'openai', model: 'gpt-5.4', baseUrl: 'https://api.openai.com/v1' },
  { label: 'GLM-5.1 (Anthropic-compatible)', provider: 'anthropic', model: 'glm-5.1', baseUrl: 'https://open.bigmodel.cn/api/anthropic' },
  { label: 'Gemini 3.1 Pro Preview', provider: 'gemini', model: 'gemini-3.1-pro-preview' },
  { label: 'LM Studio (Auto)', provider: 'lmstudio', model: 'auto', baseUrl: 'http://127.0.0.1:1234/v1' }
];

export async function generateLlmContent(params: {
  config: ProviderConfig;
  contents: LlmMessage[];
  systemInstruction: string;
  tools: FunctionDeclaration[];
}): Promise<LlmResponse> {
  const res = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `LLM call failed: ${res.status}`);
  }

  return res.json();
}

export interface StreamHandlers {
  onTextDelta?: (delta: string, fullText: string) => void;
  onToolCalls?: (toolCalls: LlmFunctionCall[]) => void;
  onFallback?: (reason: string) => void;
  onError?: (message: string) => void;
}

export async function streamLlmContent(
  params: {
    config: ProviderConfig;
    contents: LlmMessage[];
    systemInstruction: string;
    tools: FunctionDeclaration[];
  },
  handlers: StreamHandlers = {}
): Promise<LlmResponse> {
  const streamConfig = { ...params.config, stream: true };
  let response: Response;
  try {
    response = await fetch('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, config: streamConfig })
    });
  } catch {
    handlers.onFallback?.('Network error, falling back to non-streaming.');
    return generateLlmContent(params);
  }

  if (!response.ok || !response.body) {
    handlers.onFallback?.('Streaming unavailable, falling back to non-streaming.');
    return generateLlmContent(params);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let toolCalls: LlmFunctionCall[] = [];
  let finalResult: LlmResponse | null = null;

  const processChunk = (chunk: string) => {
    const lines = chunk.split('\n');
    let eventName = 'message';
    let data = '';

    for (const line of lines) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      if (line.startsWith('data:')) data += line.slice(5).trim();
    }

    if (!data) return;

    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    if (eventName === 'text-delta') {
      const delta = parsed.textDelta || '';
      if (delta) {
        fullText = parsed.text || fullText + delta;
        handlers.onTextDelta?.(delta, fullText);
      }
    } else if (eventName === 'tool-call') {
      toolCalls = parsed.toolCalls || [];
      handlers.onToolCalls?.(toolCalls);
    } else if (eventName === 'fallback') {
      handlers.onFallback?.(parsed.reason || 'Streaming unavailable');
    } else if (eventName === 'result') {
      finalResult = {
        text: parsed.text || '',
        functionCalls: parsed.functionCalls || parsed.toolCalls || []
      };
    } else if (eventName === 'error') {
      handlers.onError?.(parsed.message || 'Unknown streaming error');
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    for (const chunk of chunks) processChunk(chunk);
  }

  if (finalResult) return finalResult;
  return { text: fullText, functionCalls: toolCalls };
}

export async function discoverLmStudio(): Promise<{installations: string[]; models: string[]; endpoint: string}> {
  const res = await fetch('/api/lmstudio/discover');
  if (!res.ok) throw new Error(`LM Studio discover failed: ${res.status}`);
  return res.json();
}
