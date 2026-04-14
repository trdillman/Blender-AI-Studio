export type LlmProvider = 'gemini' | 'openai' | 'anthropic';

export interface LlmToolCall {
  id?: string;
  name?: string;
  args?: any;
  function?: {
    name?: string;
    arguments?: string;
  };
  argsRaw?: string;
}

export interface LlmChatRequest {
  provider?: LlmProvider;
  model: string;
  messages: Array<{ role: string; content?: string }>;
  tools?: any[];
  systemInstruction?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface LlmChatResponse {
  text: string;
  toolCalls: LlmToolCall[];
}

export interface StreamHandlers {
  onTextDelta?: (delta: string, fullText: string) => void;
  onToolCalls?: (toolCalls: LlmToolCall[]) => void;
  onFallback?: (reason: string) => void;
  onError?: (message: string) => void;
}

export async function chatLlmContent(request: LlmChatRequest): Promise<LlmChatResponse> {
  const response = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, stream: false })
  });

  if (!response.ok) {
    throw new Error(`LLM chat failed: ${response.status}`);
  }

  const payload = await response.json();
  return {
    text: payload.text || '',
    toolCalls: payload.toolCalls || []
  };
}

export async function streamLlmContent(
  request: LlmChatRequest,
  handlers: StreamHandlers = {}
): Promise<LlmChatResponse> {
  const response = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, stream: true })
  });

  if (!response.ok || !response.body) {
    return chatLlmContent(request);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = 'message';
  let fullText = '';
  let toolCalls: LlmToolCall[] = [];
  let finalResult: LlmChatResponse | null = null;

  const processChunk = (chunk: string) => {
    const lines = chunk.split('\n');
    let data = '';
    currentEvent = 'message';

    for (const line of lines) {
      if (line.startsWith('event:')) currentEvent = line.slice(6).trim();
      if (line.startsWith('data:')) data += line.slice(5).trim();
    }

    if (!data) return;

    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    if (currentEvent === 'text-delta') {
      const delta = parsed.textDelta || '';
      if (delta) {
        fullText = parsed.text || `${fullText}${delta}`;
        handlers.onTextDelta?.(delta, fullText);
      }
    } else if (currentEvent === 'tool-call') {
      toolCalls = parsed.toolCalls || [];
      handlers.onToolCalls?.(toolCalls);
    } else if (currentEvent === 'fallback') {
      handlers.onFallback?.(parsed.reason || 'Streaming unavailable');
    } else if (currentEvent === 'result') {
      finalResult = {
        text: parsed.text || '',
        toolCalls: parsed.toolCalls || []
      };
    } else if (currentEvent === 'error') {
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
  return { text: fullText, toolCalls };
}
