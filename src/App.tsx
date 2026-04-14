import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Send,
  Box,
  Code,
  Terminal,
  Settings,
  Play,
  Cpu,
  ChevronRight,
  Plus,
  Search,
  User,
  Sparkles,
  Monitor,
  Download,
  Copy,
  Check,
  Pencil,
  Archive,
  GitBranch,
  RotateCcw,
  Upload
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ai, BLENDER_TOOLS, SYSTEM_INSTRUCTION } from './services/geminiService';
import Markdown from 'react-markdown';
import type { Conversation, Message } from './types/conversation';
import { loadConversations, saveConversations } from './services/conversationStorage';
import {
  conversationToJSON,
  conversationToMarkdown,
  downloadTextFile,
  parseConversationJSON
} from './services/conversationExport';

const DEFAULT_MODEL = 'gemini-2.5-pro';

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function createWelcomeMessage(): Message {
  return {
    id: createId(),
    role: 'model',
    content: 'Welcome to Blender AI Studio. I have direct access to your Blender 5.1 instance via Firebase. How can I help you build today?',
    createdAt: new Date().toISOString()
  };
}

function createConversation(title = 'New Conversation'): Conversation {
  const now = new Date().toISOString();
  return {
    id: createId(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [createWelcomeMessage()],
    providerConfig: {
      model: DEFAULT_MODEL,
      systemInstruction: SYSTEM_INSTRUCTION
    },
    archived: false
  };
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const stored = loadConversations();
    return stored.length ? stored : [createConversation('Untitled Scene')];
  });
  const [activeConversationId, setActiveConversationId] = useState<string>(() => {
    const stored = loadConversations();
    return stored[0]?.id ?? createConversation('Untitled Scene').id;
  });
  const [conversationSearch, setConversationSearch] = useState('');
  const [input, setInput] = useState('');
  const [isBlenderConnected, setIsBlenderConnected] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [activeTab, setActiveTab] = useState<'viewport' | 'code' | 'logs' | 'setup'>('setup');
  const [lastScreenshot, setLastScreenshot] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [pythonCode, setPythonCode] = useState<string>('# Python output will appear here');
  const [sessionId] = useState(() => createId());
  const [copied, setCopied] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId),
    [activeConversationId, conversations]
  );

  const filteredConversations = useMemo(() => {
    const search = conversationSearch.toLowerCase().trim();
    return conversations
      .filter((conversation) => !conversation.archived)
      .filter((conversation) => (search ? conversation.title.toLowerCase().includes(search) : true))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [conversationSearch, conversations]);

  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    if (activeConversation && activeConversation.archived) {
      const fallback = conversations.find((conversation) => !conversation.archived);
      if (fallback) {
        setActiveConversationId(fallback.id);
      }
    }
  }, [activeConversation, conversations]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversation?.messages, isTyping]);

  const updateConversation = (conversationId: string, updater: (conversation: Conversation) => Conversation) => {
    setConversations((previous) =>
      previous.map((conversation) =>
        conversation.id === conversationId ? updater(conversation) : conversation
      )
    );
  };

  const setMessagesForActive = (messages: Message[]) => {
    if (!activeConversation) return;
    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      messages,
      updatedAt: new Date().toISOString()
    }));
  };

  const agentScript = `import bpy
import json
import time
import os
import tempfile
import base64
import urllib.request
import urllib.error
from io import StringIO
from contextlib import redirect_stdout, redirect_stderr
import threading
import queue

PROJECT_ID = "gen-lang-client-0334351412"
DATABASE_ID = "ai-studio-51bfcdd8-6bd6-4c4d-88f5-2583c2165596"
SESSION_ID = "${sessionId}"

command_queue = queue.Queue()
result_queue = queue.Queue()

def execute_python(code):
    out = StringIO()
    err = StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        try:
            exec(code, globals())
            success = True
        except Exception as e:
            import traceback
            traceback.print_exc(file=err)
            success = False
    return {"output": out.getvalue(), "error": err.getvalue(), "success": success}

def get_scene_data(query):
    try:
        data = {
            "objects": [{"name": obj.name, "type": obj.type, "location": list(obj.location)} for obj in bpy.context.scene.objects],
            "active_object": bpy.context.active_object.name if bpy.context.active_object else None,
            "collections": [c.name for c in bpy.data.collections],
            "materials": [m.name for m in bpy.data.materials]
        }
        return data
    except Exception as e:
        return {"error": str(e)}

def take_screenshot(mode):
    filepath = os.path.join(tempfile.gettempdir(), "blender_screenshot.png")
    try:
        if mode == "WINDOW":
            bpy.ops.screen.screenshot(filepath=filepath, full=True)
        else:
            old_filepath = bpy.context.scene.render.filepath
            bpy.context.scene.render.filepath = filepath

            old_persp = None
            target_area = None
            if mode == "CAMERA":
                for area in bpy.context.screen.areas:
                    if area.type == 'VIEW_3D':
                        target_area = area
                        old_persp = area.spaces.active.region_3d.view_perspective
                        area.spaces.active.region_3d.view_perspective = 'CAMERA'
                        break

            bpy.ops.wm.redraw_timer(type='DRAW_WIN_SWAP', iterations=1)
            bpy.ops.render.opengl(write_still=True)

            if target_area and old_persp:
                target_area.spaces.active.region_3d.view_perspective = old_persp

            bpy.context.scene.render.filepath = old_filepath
    except Exception as e:
        return {"error": str(e)}

    if os.path.exists(filepath):
        with open(filepath, "rb") as f:
            encoded = base64.b64encode(f.read()).decode('utf-8')
        return {"image": f"data:image/png;base64,{encoded}"}
    return {"error": "Failed to capture screenshot"}

def firebase_worker():
    while True:
        try:
            query = {
                "structuredQuery": {
                    "from": [{"collectionId": "commands"}],
                    "where": {
                        "fieldFilter": {
                            "field": {"fieldPath": "status"},
                            "op": "EQUAL",
                            "value": {"stringValue": "pending"}
                        }
                    },
                    "orderBy": [{"field": {"fieldPath": "timestamp"}, "direction": "ASCENDING"}],
                    "limit": 1
                }
            }

            req = urllib.request.Request(
                f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/{DATABASE_ID}/documents/blender_sessions/{SESSION_ID}:runQuery",
                data=json.dumps(query).encode('utf-8'),
                headers={'Content-Type': 'application/json'}
            )

            with urllib.request.urlopen(req, timeout=5) as response:
                res_data = json.loads(response.read().decode('utf-8'))

                for doc_wrapper in res_data:
                    if 'document' in doc_wrapper:
                        doc = doc_wrapper['document']
                        doc_name = doc['name']
                        fields = doc.get('fields', {})

                        tool = fields.get('tool', {}).get('stringValue')
                        args_str = fields.get('args', {}).get('stringValue', '{}')
                        timestamp = fields.get('timestamp')

                        if tool:
                            command_queue.put((doc_name, tool, args_str, timestamp))
                            result = result_queue.get()

                            update_data = {
                                "fields": {
                                    "tool": {"stringValue": tool},
                                    "args": {"stringValue": args_str},
                                    "status": {"stringValue": "completed"},
                                    "result": {"stringValue": json.dumps(result)},
                                    "timestamp": timestamp
                                }
                            }

                            update_req = urllib.request.Request(
                                f"https://firestore.googleapis.com/v1/{doc_name}",
                                data=json.dumps(update_data).encode('utf-8'),
                                headers={'Content-Type': 'application/json'},
                                method='PATCH'
                            )
                            urllib.request.urlopen(update_req)

        except Exception:
            pass

        time.sleep(1.0)

def process_commands():
    try:
        doc_name, tool, args_str, timestamp = command_queue.get_nowait()

        args = json.loads(args_str)
        print(f"Executing tool: {tool}")

        result = None
        if tool == "execute_python":
            result = execute_python(args.get("code", ""))
        elif tool == "get_scene_data":
            result = get_scene_data(args.get("query", ""))
        elif tool == "take_screenshot":
            result = take_screenshot(args.get("mode", "VIEWPORT"))
        else:
            result = {"error": f"Unknown tool: {tool}"}

        result_queue.put(result)
    except queue.Empty:
        pass

    return 0.1

if "_firebase_thread" not in bpy.app.driver_namespace or not bpy.app.driver_namespace["_firebase_thread"].is_alive():
    thread = threading.Thread(target=firebase_worker, daemon=True)
    thread.start()
    bpy.app.driver_namespace["_firebase_thread"] = thread

if not bpy.app.timers.is_registered(process_commands):
    bpy.app.timers.register(process_commands)

print("Blender AI Agent started. Connected to Firebase Bridge (Non-blocking).")
`;

  useEffect(() => {
    import('./firebase').then(({ db }) => {
      import('firebase/firestore').then(({ collection, query, orderBy, onSnapshot }) => {
        const commandsRef = collection(db, 'blender_sessions', sessionId, 'commands');
        const q = query(commandsRef, orderBy('timestamp', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
          if (!snapshot.empty) {
            setIsBlenderConnected(true);
            if (activeTab === 'setup') setActiveTab('viewport');
          }
        });

        return () => unsubscribe();
      });
    });
  }, [sessionId, activeTab]);

  const handleCopyScript = () => {
    navigator.clipboard.writeText(agentScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const executeToolInBlender = async (tool: string, args: any) => {
    return new Promise(async (resolve) => {
      try {
        const { db } = await import('./firebase');
        const { doc, setDoc, onSnapshot } = await import('firebase/firestore');

        const commandId = Math.random().toString(36).substring(2, 15);
        const commandRef = doc(db, 'blender_sessions', sessionId, 'commands', commandId);

        await setDoc(commandRef, {
          tool,
          args: JSON.stringify(args),
          status: 'pending',
          timestamp: Date.now()
        });

        const unsubscribe = onSnapshot(commandRef, (docSnap) => {
          const data = docSnap.data();
          if (data && data.status === 'completed') {
            unsubscribe();
            resolve(JSON.parse(data.result));
          } else if (data && data.status === 'error') {
            unsubscribe();
            resolve({ error: 'Command failed in Blender' });
          }
        });

        setTimeout(() => {
          unsubscribe();
          resolve({ error: 'Command timed out. Is Blender running?' });
        }, 30000);
      } catch (e) {
        console.error('Failed to execute tool via Firebase:', e);
        resolve({ error: 'Failed to connect to Firebase Bridge.' });
      }
    });
  };

  const generateAssistantReply = async (historyMessages: Message[]) => {
    let currentHistory: any[] = historyMessages
      .filter((message) => message.content || message.parts)
      .map((message) => {
        if (message.parts) return { role: message.role, parts: message.parts };
        return { role: message.role, parts: [{ text: message.content }] };
      });

    let response = await ai.models.generateContent({
      model: activeConversation?.providerConfig.model || DEFAULT_MODEL,
      contents: currentHistory,
      config: {
        systemInstruction: activeConversation?.providerConfig.systemInstruction || SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations: BLENDER_TOOLS }]
      }
    });

    while (response.functionCalls && response.functionCalls.length > 0) {
      const functionResponses = [];

      currentHistory.push({
        role: 'model',
        parts: response.functionCalls.map((call) => ({ functionCall: call }))
      });

      for (const call of response.functionCalls) {
        if (call.name === 'execute_python') {
          setPythonCode((call.args as any).code);
          setActiveTab('code');
        }

        const result = await executeToolInBlender(call.name, call.args);

        if (call.name === 'take_screenshot' && (result as any)?.image) {
          setLastScreenshot((result as any).image);
          setActiveTab('viewport');
        }
        if (call.name === 'execute_python' && (result as any)?.output) {
          setLogs((previous) => [...previous, (result as any).output].slice(-50));
        }

        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: result
          }
        });
      }

      currentHistory.push({
        role: 'function',
        parts: functionResponses
      });

      response = await ai.models.generateContent({
        model: activeConversation?.providerConfig.model || DEFAULT_MODEL,
        contents: currentHistory,
        config: {
          systemInstruction: activeConversation?.providerConfig.systemInstruction || SYSTEM_INSTRUCTION,
          tools: [{ functionDeclarations: BLENDER_TOOLS }]
        }
      });
    }

    if (!response.text) {
      return {
        id: createId(),
        role: 'model',
        content: 'No response text was generated.',
        createdAt: new Date().toISOString()
      } satisfies Message;
    }

    return {
      id: createId(),
      role: 'model',
      content: response.text,
      createdAt: new Date().toISOString()
    } satisfies Message;
  };

  const handleSend = async () => {
    if (!input.trim() || isTyping || !activeConversation) return;

    const userMessage: Message = {
      id: createId(),
      role: 'user',
      content: input,
      createdAt: new Date().toISOString()
    };

    const nextMessages = [...activeConversation.messages, userMessage];
    setMessagesForActive(nextMessages);
    setInput('');
    setIsTyping(true);

    try {
      const assistantMessage = await generateAssistantReply(nextMessages);
      setMessagesForActive([...nextMessages, assistantMessage]);
    } catch (error) {
      console.error(error);
      setMessagesForActive([
        ...nextMessages,
        {
          id: createId(),
          role: 'model',
          content: 'Error connecting to Gemini or Blender.',
          createdAt: new Date().toISOString()
        }
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleCreateConversation = () => {
    const newConversation = createConversation(`Conversation ${conversations.length + 1}`);
    setConversations((previous) => [newConversation, ...previous]);
    setActiveConversationId(newConversation.id);
  };

  const handleRenameConversation = (conversationId: string) => {
    const current = conversations.find((conversation) => conversation.id === conversationId);
    const title = prompt('Rename conversation', current?.title || '');
    if (!title?.trim()) return;

    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      title: title.trim(),
      updatedAt: new Date().toISOString()
    }));
  };

  const handleArchiveConversation = (conversationId: string) => {
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      archived: true,
      updatedAt: new Date().toISOString()
    }));
  };

  const branchFromMessage = (messageIndex: number) => {
    if (!activeConversation) return;
    const branchMessages = activeConversation.messages.slice(0, messageIndex + 1);
    const now = new Date().toISOString();
    const branchedConversation: Conversation = {
      ...activeConversation,
      id: createId(),
      title: `${activeConversation.title} (branch)`,
      createdAt: now,
      updatedAt: now,
      messages: branchMessages.map((message) => ({ ...message, id: createId() })),
      archived: false
    };
    setConversations((previous) => [branchedConversation, ...previous]);
    setActiveConversationId(branchedConversation.id);
  };

  const rewindAndRegenerateFromMessage = async (messageIndex: number) => {
    if (!activeConversation || isTyping) return;

    const targetMessage = activeConversation.messages[messageIndex];
    if (!targetMessage) return;

    let baseMessages = activeConversation.messages.slice(0, messageIndex + 1);

    if (targetMessage.role === 'model') {
      baseMessages = activeConversation.messages.slice(0, messageIndex);
    }

    const lastMessage = baseMessages[baseMessages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
      setMessagesForActive(baseMessages);
      return;
    }

    setMessagesForActive(baseMessages);
    setIsTyping(true);

    try {
      const assistantMessage = await generateAssistantReply(baseMessages);
      setMessagesForActive([...baseMessages, assistantMessage]);
    } catch (error) {
      console.error(error);
      setMessagesForActive([
        ...baseMessages,
        {
          id: createId(),
          role: 'model',
          content: 'Regeneration failed.',
          createdAt: new Date().toISOString()
        }
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleExportJSON = () => {
    if (!activeConversation) return;
    downloadTextFile(`${activeConversation.title}.json`, conversationToJSON(activeConversation), 'application/json');
  };

  const handleExportMarkdown = () => {
    if (!activeConversation) return;
    downloadTextFile(`${activeConversation.title}.md`, conversationToMarkdown(activeConversation), 'text/markdown');
  };

  const handleImportConversation = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const imported = parseConversationJSON(text);
    const normalized: Conversation = {
      ...imported,
      id: createId(),
      title: imported.title || 'Imported Conversation',
      createdAt: imported.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: (imported.messages || []).map((message) => ({
        ...message,
        id: message.id || createId(),
        createdAt: message.createdAt || new Date().toISOString()
      })),
      providerConfig: imported.providerConfig || {
        model: DEFAULT_MODEL,
        systemInstruction: SYSTEM_INSTRUCTION
      },
      archived: false
    };

    setConversations((previous) => [normalized, ...previous]);
    setActiveConversationId(normalized.id);
    event.target.value = '';
  };

  const activeMessages = activeConversation?.messages || [];

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-[#e0e0e0] font-sans overflow-hidden">
      <div className="w-80 border-r border-[#222] flex flex-col bg-[#0f0f0f]">
        <div className="p-4 flex items-center gap-2 border-b border-[#222]">
          <div className="w-8 h-8 bg-[#3b82f6] rounded flex items-center justify-center">
            <Box className="text-white w-5 h-5" />
          </div>
          <span className="font-semibold tracking-tight">Blender AI Studio</span>
        </div>

        <div className="p-4 border-b border-[#222] space-y-3">
          <button
            onClick={handleCreateConversation}
            className="w-full py-2 px-4 bg-[#1a1a1a] hover:bg-[#252525] border border-[#333] rounded-md flex items-center gap-2 text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Conversation
          </button>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#666]" />
            <input
              value={conversationSearch}
              onChange={(event) => setConversationSearch(event.target.value)}
              placeholder="Quick switch / search"
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-md pl-9 pr-3 py-2 text-sm outline-none focus:border-[#3b82f6]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
          {filteredConversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`group rounded-md border px-2 py-2 ${
                conversation.id === activeConversationId
                  ? 'bg-[#1a1a1a] border-[#3b82f6]/50'
                  : 'bg-transparent border-transparent hover:bg-[#161616]'
              }`}
            >
              <button className="w-full text-left" onClick={() => setActiveConversationId(conversation.id)}>
                <div className="text-sm font-medium truncate">{conversation.title}</div>
                <div className="text-[11px] text-[#666]">{new Date(conversation.updatedAt).toLocaleString()}</div>
              </button>
              <div className="hidden group-hover:flex items-center gap-1 mt-2">
                <button className="p-1 hover:bg-[#222] rounded" onClick={() => handleRenameConversation(conversation.id)}>
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button className="p-1 hover:bg-[#222] rounded" onClick={() => handleArchiveConversation(conversation.id)}>
                  <Archive className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-[#222] space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <button onClick={handleExportJSON} className="p-2 rounded bg-[#1a1a1a] hover:bg-[#222] flex items-center gap-2 justify-center">
              <Download className="w-3.5 h-3.5" /> JSON
            </button>
            <button onClick={handleExportMarkdown} className="p-2 rounded bg-[#1a1a1a] hover:bg-[#222] flex items-center gap-2 justify-center">
              <Download className="w-3.5 h-3.5" /> Markdown
            </button>
            <button
              onClick={() => importInputRef.current?.click()}
              className="col-span-2 p-2 rounded bg-[#1a1a1a] hover:bg-[#222] flex items-center gap-2 justify-center"
            >
              <Upload className="w-3.5 h-3.5" /> Import Conversation
            </button>
            <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={handleImportConversation} />
          </div>
          <div className="flex items-center justify-between text-xs text-[#888]">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isBlenderConnected ? 'bg-green-500' : 'bg-red-500'}`} />
              {isBlenderConnected ? 'Blender Connected' : 'Blender Offline'}
            </div>
            <Cpu className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#222] flex items-center justify-center">
              <User className="w-4 h-4" />
            </div>
            <div className="text-sm">
              <div className="font-medium">tdillman97</div>
              <div className="text-xs text-[#666]">Pro Plan</div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-[#222] flex items-center justify-between px-6 bg-[#0f0f0f]">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-[#888]">
              <span>Conversations</span>
              <ChevronRight className="w-4 h-4" />
              <span className="text-[#e0e0e0] font-medium">{activeConversation?.title || 'Untitled Scene'}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="bg-[#3b82f6] hover:bg-[#2563eb] text-white px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2">
              <Play className="w-4 h-4" />
              Render
            </button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <div className="w-[500px] flex flex-col border-r border-[#222] bg-[#0a0a0a]">
            <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
              {activeMessages.map((message, index) => {
                if (!message.content) return null;
                return (
                  <div key={message.id} className={`group flex gap-4 ${message.role === 'user' ? 'justify-end' : ''}`}>
                    {message.role === 'model' && (
                      <div className="w-8 h-8 rounded-full bg-[#3b82f6]/10 flex items-center justify-center flex-shrink-0">
                        <Sparkles className="w-4 h-4 text-[#3b82f6]" />
                      </div>
                    )}
                    <div className="max-w-[90%] space-y-2">
                      <div
                        className={`rounded-2xl p-4 text-sm leading-relaxed ${
                          message.role === 'user'
                            ? 'bg-[#3b82f6] text-white'
                            : 'bg-[#1a1a1a] border border-[#333] text-[#e0e0e0]'
                        }`}
                      >
                        <div className="prose prose-invert prose-sm max-w-none">
                          <Markdown>{message.content}</Markdown>
                        </div>
                      </div>
                      <div className="hidden group-hover:flex gap-2 justify-end text-xs">
                        <button
                          onClick={() => branchFromMessage(index)}
                          className="px-2 py-1 rounded bg-[#151515] hover:bg-[#222] border border-[#2b2b2b] flex items-center gap-1"
                        >
                          <GitBranch className="w-3 h-3" /> Branch from here
                        </button>
                        <button
                          onClick={() => rewindAndRegenerateFromMessage(index)}
                          className="px-2 py-1 rounded bg-[#151515] hover:bg-[#222] border border-[#2b2b2b] flex items-center gap-1"
                        >
                          <RotateCcw className="w-3 h-3" /> Rewind / regenerate
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {isTyping && (
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-[#3b82f6]/10 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-[#3b82f6] animate-pulse" />
                  </div>
                  <div className="bg-[#1a1a1a] border border-[#333] rounded-2xl p-4 flex gap-1">
                    <div className="w-1.5 h-1.5 bg-[#444] rounded-full animate-bounce" />
                    <div className="w-1.5 h-1.5 bg-[#444] rounded-full animate-bounce [animation-delay:0.2s]" />
                    <div className="w-1.5 h-1.5 bg-[#444] rounded-full animate-bounce [animation-delay:0.4s]" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="p-4 border-t border-[#222]">
              <div className="relative">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && !event.shiftKey && (event.preventDefault(), handleSend())}
                  placeholder="Ask Gemini to build in Blender..."
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:border-[#3b82f6] transition-colors resize-none min-h-[100px]"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isTyping}
                  className="absolute right-3 bottom-3 p-2 bg-[#3b82f6] disabled:bg-[#222] text-white rounded-lg transition-all hover:scale-105 active:scale-95"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-2 text-[10px] text-[#555] text-center">
                Gemini can control Blender 5.1 via Python. Results may vary based on scene complexity.
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col bg-[#050505]">
            <div className="flex items-center gap-1 p-2 border-b border-[#222] bg-[#0f0f0f]">
              <TabButton active={activeTab === 'viewport'} onClick={() => setActiveTab('viewport')} icon={<Monitor className="w-3.5 h-3.5" />} label="Viewport" />
              <TabButton active={activeTab === 'code'} onClick={() => setActiveTab('code')} icon={<Code className="w-3.5 h-3.5" />} label="Script" />
              <TabButton active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} icon={<Terminal className="w-3.5 h-3.5" />} label="Console" />
              <TabButton active={activeTab === 'setup'} onClick={() => setActiveTab('setup')} icon={<Settings className="w-3.5 h-3.5" />} label="Setup" />
            </div>

            <div className="flex-1 relative overflow-hidden">
              <AnimatePresence mode="wait">
                {activeTab === 'viewport' && (
                  <motion.div key="viewport" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex items-center justify-center p-8">
                    {lastScreenshot ? (
                      <img src={lastScreenshot} alt="Blender Viewport" className="max-w-full max-h-full rounded-lg border border-[#333] shadow-2xl" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="text-center space-y-4">
                        <div className="w-20 h-20 bg-[#111] rounded-full flex items-center justify-center mx-auto border border-[#222]">
                          <Box className="w-10 h-10 text-[#333]" />
                        </div>
                        <div className="text-[#444] text-sm">No viewport data. Ask Gemini to take a screenshot.</div>
                      </div>
                    )}
                  </motion.div>
                )}

                {activeTab === 'code' && (
                  <motion.div key="code" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 p-6 font-mono text-sm overflow-auto bg-[#0a0a0a]">
                    <pre className="text-[#3b82f6]">
                      <code>{pythonCode}</code>
                    </pre>
                  </motion.div>
                )}

                {activeTab === 'logs' && (
                  <motion.div key="logs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 p-6 font-mono text-xs overflow-auto bg-[#0a0a0a]">
                    {logs.length > 0 ? (
                      logs.map((log, index) => (
                        <div key={`${log}-${index}`} className="mb-1 text-[#888]">
                          <span className="text-[#444] mr-2">[{new Date().toLocaleTimeString()}]</span>
                          {log}
                        </div>
                      ))
                    ) : (
                      <div className="text-[#444]">Waiting for logs from Blender...</div>
                    )}
                  </motion.div>
                )}

                {activeTab === 'setup' && (
                  <motion.div key="setup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 p-8 overflow-auto bg-[#0a0a0a]">
                    <div className="max-w-2xl mx-auto space-y-6">
                      <div className="flex items-center gap-4 border-b border-[#222] pb-6">
                        <div className="w-12 h-12 bg-[#3b82f6]/10 rounded-xl flex items-center justify-center">
                          <Box className="w-6 h-6 text-[#3b82f6]" />
                        </div>
                        <div>
                          <h2 className="text-xl font-semibold">Connect Blender 5.1</h2>
                          <p className="text-[#888] text-sm">Run this script in Blender to connect to AI Studio.</p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center gap-3 text-sm">
                          <div className="w-6 h-6 rounded-full bg-[#222] flex items-center justify-center font-medium">1</div>
                          <p>Open Blender 5.1 and go to the <strong>Scripting</strong> workspace.</p>
                        </div>
                        <div className="flex items-center gap-3 text-sm">
                          <div className="w-6 h-6 rounded-full bg-[#222] flex items-center justify-center font-medium">2</div>
                          <p>Create a new text block and paste the following code.</p>
                        </div>
                        <div className="flex items-center gap-3 text-sm">
                          <div className="w-6 h-6 rounded-full bg-[#222] flex items-center justify-center font-medium">3</div>
                          <p>Click <strong>Run Script</strong> (Play icon).</p>
                        </div>
                      </div>

                      <div className="relative">
                        <div className="absolute top-4 right-4 flex gap-2">
                          <button onClick={handleCopyScript} className="p-2 bg-[#222] hover:bg-[#333] rounded-md transition-colors text-[#e0e0e0] flex items-center gap-2" title="Copy Script">
                            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                            <span className="text-xs font-medium">{copied ? 'Copied!' : 'Copy'}</span>
                          </button>
                          <a href="/api/agent-script" download="blender_agent.py" className="p-2 bg-[#222] hover:bg-[#333] rounded-md transition-colors text-[#e0e0e0]" title="Download Script">
                            <Download className="w-4 h-4" />
                          </a>
                        </div>
                        <pre className="bg-[#111] border border-[#222] rounded-xl p-6 overflow-x-auto text-xs font-mono text-[#a8b2c1] max-h-[400px] overflow-y-auto">{agentScript}</pre>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
        active ? 'bg-[#1a1a1a] text-[#e0e0e0] border border-[#333]' : 'text-[#666] hover:text-[#888]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
