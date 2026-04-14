import React, { useMemo, useRef, useState, useEffect } from 'react';
import Markdown from 'react-markdown';
import { Activity, Sparkles, Wrench, Send } from 'lucide-react';
import { adaptMessagesToTimeline, type ChatMessage } from './adapters';

interface ChatSurfaceProps {
  messages: ChatMessage[];
  isTyping: boolean;
  onSend: (message: string) => void;
}

function Conversation({ children }: { children: React.ReactNode }) {
  return <div className="chat-elements-conversation">{children}</div>;
}

function ConversationContent({ children }: { children: React.ReactNode }) {
  return <div className="chat-elements-content">{children}</div>;
}

function Message({ from, children }: { from: 'user' | 'assistant' | 'tool'; children: React.ReactNode }) {
  return <div className={`chat-elements-message chat-elements-message-${from}`}>{children}</div>;
}

function MessageContent({ children }: { children: React.ReactNode }) {
  return <div className="chat-elements-message-content">{children}</div>;
}

function MessageResponse({ children }: { children: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <Markdown>{children}</Markdown>
    </div>
  );
}

export function ChatSurface({ messages, isTyping, onSend }: ChatSurfaceProps) {
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const timeline = useMemo(() => adaptMessagesToTimeline(messages), [messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timeline, isTyping]);

  const submit = () => {
    const next = draft.trim();
    if (!next || isTyping) return;
    onSend(next);
    setDraft('');
  };

  return (
    <div className="w-[450px] flex flex-col border-r border-[#222] bg-[#0a0a0a]">
      <Conversation>
        <ConversationContent>
          {timeline.map((message) => (
            <Message from={message.from} key={message.id}>
              {message.from === 'assistant' && (
                <div className="w-8 h-8 rounded-full bg-[#3b82f6]/10 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-[#3b82f6]" />
                </div>
              )}
              {message.from === 'tool' && (
                <div className="w-8 h-8 rounded-full bg-[#22c55e]/10 flex items-center justify-center flex-shrink-0">
                  <Wrench className="w-4 h-4 text-[#22c55e]" />
                </div>
              )}
              <MessageContent>
                {message.from === 'assistant' ? (
                  <MessageResponse>{message.text}</MessageResponse>
                ) : (
                  <pre className="text-xs whitespace-pre-wrap leading-relaxed">{message.text}</pre>
                )}
              </MessageContent>
            </Message>
          ))}

          {isTyping && (
            <Message from="assistant">
              <div className="w-8 h-8 rounded-full bg-[#3b82f6]/10 flex items-center justify-center flex-shrink-0">
                <Activity className="w-4 h-4 text-[#3b82f6] animate-pulse" />
              </div>
              <MessageContent>
                <div className="chat-elements-streaming-dots">
                  <span />
                  <span />
                  <span />
                </div>
              </MessageContent>
            </Message>
          )}
          <div ref={endRef} />
        </ConversationContent>
      </Conversation>

      <div className="p-4 border-t border-[#222]">
        <div className="relative">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), submit())}
            placeholder="Ask Gemini to build in Blender..."
            className="w-full bg-[#1a1a1a] border border-[#333] rounded-xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:border-[#3b82f6] transition-colors resize-none min-h-[100px]"
          />
          <button
            onClick={submit}
            disabled={!draft.trim() || isTyping}
            className="absolute right-3 bottom-3 p-2 bg-[#3b82f6] disabled:bg-[#222] text-white rounded-lg transition-all hover:scale-105 active:scale-95"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
