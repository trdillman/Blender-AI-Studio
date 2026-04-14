export interface ChatMessage {
  role: 'user' | 'model' | 'function';
  content?: string;
  parts?: any[];
}

export interface TimelineMessage {
  id: string;
  from: 'user' | 'assistant' | 'tool';
  text: string;
}

const stringifySafe = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export function sanitizeToolPayload(payload: unknown) {
  if (payload && typeof payload === 'object' && 'image' in (payload as Record<string, unknown>)) {
    return {
      ...(payload as Record<string, unknown>),
      image: '[base64 image omitted]'
    };
  }

  return payload;
}

export function adaptMessagesToTimeline(messages: ChatMessage[]): TimelineMessage[] {
  return messages
    .map((message, index) => {
      if (message.role === 'user') {
        return {
          id: `user-${index}`,
          from: 'user' as const,
          text: message.content ?? ''
        };
      }

      if (message.role === 'function') {
        const functionPart = message.parts?.find((part) => part.functionCall || part.functionResponse);
        const call = functionPart?.functionCall;
        const response = functionPart?.functionResponse;

        const fallbackText = message.content ?? '';
        const text = call
          ? `Tool call: ${call.name}\n${stringifySafe(call.args)}`
          : response
            ? `Tool response: ${response.name}\n${stringifySafe(sanitizeToolPayload(response.response))}`
            : fallbackText;

        return {
          id: `tool-${index}`,
          from: 'tool' as const,
          text
        };
      }

      return {
        id: `assistant-${index}`,
        from: 'assistant' as const,
        text: message.content ?? ''
      };
    })
    .filter((item) => item.text.trim().length > 0);
}
