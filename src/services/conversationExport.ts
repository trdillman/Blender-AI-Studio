import type { Conversation } from '../types/conversation';

export interface ConversationExportPayload {
  version: 1;
  exportedAt: string;
  conversation: Conversation;
}

export function conversationToJSON(conversation: Conversation): string {
  const payload: ConversationExportPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    conversation
  };

  return JSON.stringify(payload, null, 2);
}

export function conversationToMarkdown(conversation: Conversation): string {
  const lines: string[] = [];
  lines.push(`# ${conversation.title}`);
  lines.push('');
  lines.push(`- ID: ${conversation.id}`);
  lines.push(`- Created: ${conversation.createdAt}`);
  lines.push(`- Updated: ${conversation.updatedAt}`);
  lines.push('');

  conversation.messages.forEach((message, index) => {
    const roleTitle = message.role === 'model' ? 'Assistant' : message.role === 'user' ? 'User' : 'Tool';
    lines.push(`## ${index + 1}. ${roleTitle}`);
    lines.push('');
    lines.push(message.content?.trim() || '_No text content_');
    lines.push('');
  });

  return lines.join('\n');
}

export function parseConversationJSON(json: string): Conversation {
  const parsed = JSON.parse(json) as Partial<ConversationExportPayload> | Partial<Conversation>;

  if ('conversation' in parsed && parsed.conversation) {
    return parsed.conversation as Conversation;
  }

  return parsed as Conversation;
}

export function downloadTextFile(filename: string, content: string, contentType: string): void {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
