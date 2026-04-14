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
  Upload,
  Star,
  Eye,
  EyeOff,
  Activity,
  Wrench
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import {
  BLENDER_TOOLS,
  SYSTEM_INSTRUCTION,
  MODEL_PRESETS,
  ProviderConfig,
  generateLlmContent,
  streamLlmContent,
  discoverLmStudio
} from './services/llmService';
import { sanitizeToolPayload } from './components/chat/adapters';
import { PROVIDER_DEFINITIONS } from './services/providerConfig';
import { persistProviderSettings, validateProviderSettings, ProviderValidationErrors } from './services/providerSettingsService';
import type { Conversation, Message } from './types/conversation';
import { loadConversations, saveConversations } from './services/conversationStorage';
import {
  conversationToJSON,
  conversationToMarkdown,
  downloadTextFile,
  parseConversationJSON
} from './services/conversationExport';
import { PROMPT_TEMPLATES } from './data/promptTemplates';

// Types
interface ToolCall { name: string; args: any; }
type ToolStatus = 'running' | 'completed' | 'failed';
interface ToolTimelineEvent {
  id: string; messageId: string; toolName: string; args: any; argsPreview: string;
  status: ToolStatus; startTimestamp: number; endTimestamp?: number; result?: any; error?: string;
}
interface Toast { type: 'success' | 'error'; message: string; }

// Helpers
function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
function createWelcomeMessage(): Message {
  return {
    id: createId(), role: 'model',
    content: 'Welcome to Blender AI Studio. I have direct access to your Blender 5.1 instance via Firebase. How can I help you build today?',
    createdAt: new Date().toISOString()
  };
}
function createConversation(title = 'New Conversation', baseConfig?: ProviderConfig): Conversation {
  const now = new Date().toISOString();
  return {
    id: createId(), title, createdAt: now, updatedAt: now,
    messages: [createWelcomeMessage()],
    providerConfig: baseConfig ?? { provider: 'gemini', model: 'gemini-2.5-pro', apiKey: '', baseUrl: '' },
    archived: false
  };
}

export default function App() {
  // --- Conversations (PR #5) ---
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const stored = loadConversations();
    return stored.length ? stored : [createConversation('Untitled Scene')];
  });
  const [activeConversationId, setActiveConversationId] = useState<string>(() => {
    const stored = loadConversations();
    return stored[0]?.id ?? createConversation('Untitled Scene').id;
  });
  const [conversationSearch, setConversationSearch] = useState('');

  // --- Provider config (PR #6) ---
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>({
    provider: 'gemini', model: 'gemini-2.5-pro', apiKey: '', baseUrl: ''
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [providerErrors, setProviderErrors] = useState<ProviderValidationErrors>({});
  const [isTestingProvider, setIsTestingProvider] = useState(false);
  const [providerStatus, setProviderStatus] = useState<string | null>(null);
  const [providerStatusType, setProviderStatusType] = useState<'success' | 'error' | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [lmStudioInfo, setLmStudioInfo] = useState<{ installations: string[]; models: string[]; endpoint: string } | null>(null);

  // --- Core UI state ---
  const [isBlenderConnected, setIsBlenderConnected] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [activeTab, setActiveTab] = useState<'viewport' | 'code' | 'logs' | 'setup'>('setup');
  const [lastScreenshot, setLastScreenshot] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [pythonCode, setPythonCode] = useState<string>('# Python output will appear here');
  const [sessionId] = useState(() => createId());
  const [copied, setCopied] = useState(false);

  // --- Tool timeline (PR #4) ---
  const [toolTimeline, setToolTimeline] = useState<ToolTimelineEvent[]>([]);

  // --- Composer (PR #3) ---
  const [input, setInput] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [lastToolSequence, setLastToolSequence] = useState<ToolCall[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsState, setSettingsState] = useState({
    autoScroll: true, compactMode: false, markdownDensity: 'comfortable' as 'comfortable' | 'compact'
  });

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // --- Derived ---
  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId),
    [activeConversationId, conversations]
  );
  const filteredConversations = useMemo(() => {
    const search = conversationSearch.toLowerCase().trim();
    return conversations
      .filter((c) => !c.archived)
      .filter((c) => (search ? c.title.toLowerCase().includes(search) : true))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [conversationSearch, conversations]);
  const activeMessages = activeConversation?.messages ?? [];

  // --- Effects ---
  useEffect(() => { saveConversations(conversations); }, [conversations]);
  useEffect(() => {
    if (activeConversation?.archived) {
      const fallback = conversations.find((c) => !c.archived);
      if (fallback) setActiveConversationId(fallback.id);
    }
  }, [activeConversation, conversations]);
  useEffect(() => {
    if (settingsState.autoScroll) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages, isTyping, settingsState.autoScroll]);
  useEffect(() => {
    persistProviderSettings({ provider: providerConfig.provider, model: providerConfig.model, baseUrl: providerConfig.baseUrl || '' });
  }, [providerConfig.provider, providerConfig.model, providerConfig.baseUrl]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    import('./firebase').then(({ db }) => {
      import('firebase/firestore').then(({ collection, query, orderBy, onSnapshot }) => {
        const commandsRef = collection(db, 'blender_sessions', sessionId, 'commands');
        const q = query(commandsRef, orderBy('timestamp', 'desc'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
          if (!snapshot.empty) { setIsBlenderConnected(true); if (activeTab === 'setup') setActiveTab('viewport'); }
        });
        return () => unsubscribe();
      });
    });
  }, [sessionId, activeTab]);
  // Keyboard shortcuts (PR #3)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isCmd = event.metaKey || event.ctrlKey;
      if (!isCmd) return;
      if (event.key === 'Enter') { event.preventDefault(); (document.getElementById('composer-send-btn') as HTMLButtonElement | null)?.click(); }
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); setSettingsOpen((prev) => !prev); }
      if (event.key === '/') { event.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Blender agent script (template literal using sessionId at runtime)
  const agentScript = [
    'import bpy',
    'import json',
    'import time',
    'import os',
    'import tempfile',
    'import base64',
    'import urllib.request',
    'import urllib.error',
    'from io import StringIO',
    'from contextlib import redirect_stdout, redirect_stderr',
    'import threading',
    'import queue',
    '',
    'PROJECT_ID = "gen-lang-client-0334351412"',
    'DATABASE_ID = "ai-studio-51bfcdd8-6bd6-4c4d-88f5-2583c2165596"',
    `SESSION_ID = "${sessionId}"`,
    '',
    'command_queue = queue.Queue()',
    'result_queue = queue.Queue()',
    '',
    'def execute_python(code):',
    '    out = StringIO()',
    '    err = StringIO()',
    '    with redirect_stdout(out), redirect_stderr(err):',
    '        try:',
    '            exec(code, globals())',
    '            success = True',
    '        except Exception as e:',
    '            import traceback',
    '            traceback.print_exc(file=err)',
    '            success = False',
    '    return {"output": out.getvalue(), "error": err.getvalue(), "success": success}',
    '',
    'def get_scene_data(query):',
    '    try:',
    '        data = {',
    '            "objects": [{"name": obj.name, "type": obj.type, "location": list(obj.location)} for obj in bpy.context.scene.objects],',
    '            "active_object": bpy.context.active_object.name if bpy.context.active_object else None,',
    '            "collections": [c.name for c in bpy.data.collections],',
    '            "materials": [m.name for m in bpy.data.materials]',
    '        }',
    '        return data',
    '    except Exception as e:',
    '        return {"error": str(e)}',
    '',
    'def take_screenshot(mode):',
    '    filepath = os.path.join(tempfile.gettempdir(), "blender_screenshot.png")',
    '    try:',
    '        if mode == "WINDOW":',
    '            bpy.ops.screen.screenshot(filepath=filepath, full=True)',
    '        else:',
    '            old_filepath = bpy.context.scene.render.filepath',
    '            bpy.context.scene.render.filepath = filepath',
    '            old_persp = None',
    '            target_area = None',
    '            if mode == "CAMERA":',
    '                for area in bpy.context.screen.areas:',
    '                    if area.type == "VIEW_3D":',
    '                        target_area = area',
    '                        old_persp = area.spaces.active.region_3d.view_perspective',
    '                        area.spaces.active.region_3d.view_perspective = "CAMERA"',
    '                        break',
    '            bpy.ops.wm.redraw_timer(type="DRAW_WIN_SWAP", iterations=1)',
    '            bpy.ops.render.opengl(write_still=True)',
    '            if target_area and old_persp:',
    '                target_area.spaces.active.region_3d.view_perspective = old_persp',
    '            bpy.context.scene.render.filepath = old_filepath',
    '    except Exception as e:',
    '        return {"error": str(e)}',
    '    if os.path.exists(filepath):',
    '        with open(filepath, "rb") as f:',
    '            encoded = base64.b64encode(f.read()).decode("utf-8")',
    '        return {"image": f"data:image/png;base64,{encoded}"}',
    '    return {"error": "Failed to capture screenshot"}',
    '',
    'def firebase_worker():',
    '    while True:',
    '        try:',
    '            query_body = {"structuredQuery": {"from": [{"collectionId": "commands"}], "where": {"fieldFilter": {"field": {"fieldPath": "status"}, "op": "EQUAL", "value": {"stringValue": "pending"}}}, "orderBy": [{"field": {"fieldPath": "timestamp"}, "direction": "ASCENDING"}], "limit": 1}}',
    '            req = urllib.request.Request(',
    `                f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/{DATABASE_ID}/documents/blender_sessions/{SESSION_ID}:runQuery",`,
    '                data=json.dumps(query_body).encode("utf-8"),',
    '                headers={"Content-Type": "application/json"}',
    '            )',
    '            with urllib.request.urlopen(req, timeout=5) as response:',
    '                res_data = json.loads(response.read().decode("utf-8"))',
    '                for doc_wrapper in res_data:',
    '                    if "document" in doc_wrapper:',
    '                        doc = doc_wrapper["document"]',
    '                        doc_name = doc["name"]',
    '                        fields = doc.get("fields", {})',
    '                        tool = fields.get("tool", {}).get("stringValue")',
    '                        args_str = fields.get("args", {}).get("stringValue", "{}")',
    '                        timestamp = fields.get("timestamp")',
    '                        if tool:',
    '                            command_queue.put((doc_name, tool, args_str, timestamp))',
    '                            result = result_queue.get()',
    '                            update_data = {"fields": {"tool": {"stringValue": tool}, "args": {"stringValue": args_str}, "status": {"stringValue": "completed"}, "result": {"stringValue": json.dumps(result)}, "timestamp": timestamp}}',
    `                            update_req = urllib.request.Request(f"https://firestore.googleapis.com/v1/{doc_name}", data=json.dumps(update_data).encode("utf-8"), headers={"Content-Type": "application/json"}, method="PATCH")`,
    '                            urllib.request.urlopen(update_req)',
    '        except Exception:',
    '            pass',
    '        time.sleep(1.0)',
    '',
    'def process_commands():',
    '    try:',
    '        doc_name, tool, args_str, timestamp = command_queue.get_nowait()',
    '        args = json.loads(args_str)',
    '        print(f"Executing tool: {tool}")',
    '        result = None',
    '        if tool == "execute_python": result = execute_python(args.get("code", ""))',
    '        elif tool == "get_scene_data": result = get_scene_data(args.get("query", ""))',
    '        elif tool == "take_screenshot": result = take_screenshot(args.get("mode", "VIEWPORT"))',
    '        else: result = {"error": f"Unknown tool: {tool}"}',
    '        result_queue.put(result)',
    '    except Exception: pass',
    '    return 0.1',
    '',
    'if "_firebase_thread" not in bpy.app.driver_namespace or not bpy.app.driver_namespace["_firebase_thread"].is_alive():',
    '    thread = threading.Thread(target=firebase_worker, daemon=True)',
    '    thread.start()',
    '    bpy.app.driver_namespace["_firebase_thread"] = thread',
    '',
    'if not bpy.app.timers.is_registered(process_commands):',
    '    bpy.app.timers.register(process_commands)',
    '',
    'print("Blender AI Agent started. Connected to Firebase Bridge (Non-blocking).")',
  ].join('\n');

  // --- Conversation helpers ---
  const setMessagesForActive = (messages: Message[]) => {
    setConversations((prev) => prev.map((c) => c.id === activeConversationId ? { ...c, messages, updatedAt: new Date().toISOString() } : c));
  };
  const updateConversation = (id: string, updater: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? updater(c) : c)));
  };

  // --- Provider helpers (PR #6) ---
  const pushStatus = (type: 'success' | 'error', message: string) => {
    setProviderStatusType(type); setProviderStatus(message); setToast({ type, message });
  };
  const handleProviderChange = (nextProvider: ProviderConfig['provider']) => {
    const defaults = PROVIDER_DEFINITIONS[nextProvider];
    setProviderConfig((prev) => ({ ...prev, provider: nextProvider, model: defaults.defaultModel, baseUrl: defaults.defaultBaseUrl }));
    setProviderErrors({}); setProviderStatus(null); setProviderStatusType(null);
  };
  const handleTestConnection = async () => {
    const nextErrors = validateProviderSettings(
      { provider: providerConfig.provider, model: providerConfig.model, baseUrl: providerConfig.baseUrl || '' },
      providerConfig.apiKey || ''
    );
    setProviderErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) { pushStatus('error', 'Fix validation errors before testing.'); return; }
    setIsTestingProvider(true);
    try {
      const response = await fetch('/api/providers/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerConfig.provider, model: providerConfig.model, baseUrl: providerConfig.baseUrl, apiKey: providerConfig.apiKey })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) { pushStatus('error', data?.error || 'Connection test failed.'); return; }
      pushStatus('success', data?.message || 'Connection successful.');
    } catch (error) { pushStatus('error', 'Unable to reach the backend test endpoint.'); }
    finally { setIsTestingProvider(false); }
  };
  const applyPreset = (presetLabel: string) => {
    const preset = MODEL_PRESETS.find((p) => p.label === presetLabel);
    if (!preset) return;
    setProviderConfig((prev) => ({ ...prev, provider: preset.provider, model: preset.model, baseUrl: preset.baseUrl ?? prev.baseUrl }));
  };
  const refreshLmStudio = async () => {
    try {
      const info = await discoverLmStudio();
      setLmStudioInfo(info);
      if (info.models.length > 0) setProviderConfig((prev) => ({ ...prev, provider: 'lmstudio', baseUrl: info.endpoint, model: info.models[0] }));
    } catch (e) { console.error(e); }
  };

  const handleCopyScript = () => { navigator.clipboard.writeText(agentScript); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  // --- Blender tool execution ---
  const executeToolInBlender = async (tool: string, args: any): Promise<any> => {
    return new Promise<any>(async (resolve) => {
      try {
        const { db } = await import('./firebase');
        const { doc, setDoc, onSnapshot } = await import('firebase/firestore');
        const commandId = createId();
        const commandRef = doc(db, 'blender_sessions', sessionId, 'commands', commandId);
        await setDoc(commandRef, { tool, args: JSON.stringify(args), status: 'pending', timestamp: Date.now() });
        const unsubscribe = onSnapshot(commandRef, (docSnap) => {
          const data = docSnap.data();
          if (data?.status === 'completed') { unsubscribe(); resolve(JSON.parse(data.result)); }
          else if (data?.status === 'error') { unsubscribe(); resolve({ error: 'Command failed in Blender' }); }
        });
        setTimeout(() => { unsubscribe(); resolve({ error: 'Command timed out. Is Blender running?' }); }, 30000);
      } catch (e) { resolve({ error: 'Failed to connect to Firebase Bridge.' }); }
    });
  };

  // --- Composer helpers (PR #3) ---
  const appendModelMessage = (content: string) => {
    const newMsg: Message = { id: createId(), role: 'model', content, createdAt: new Date().toISOString() };
    setConversations((prev) => prev.map((c) => c.id === activeConversationId ? { ...c, messages: [...c.messages, newMsg], updatedAt: new Date().toISOString() } : c));
  };
  const runToolSequence = async (sequence: ToolCall[]) => {
    const results: Array<{ name: string; result: any }> = [];
    for (const call of sequence) {
      if (call.name === 'execute_python') { setPythonCode(call.args?.code ?? ''); setActiveTab('code'); }
      const result: any = await executeToolInBlender(call.name, call.args);
      if (call.name === 'take_screenshot' && result?.image) { setLastScreenshot(result.image); setActiveTab('viewport'); }
      if (call.name === 'execute_python' && result?.output) { setLogs((prev) => [...prev, result.output].slice(-50)); }
      results.push({ name: call.name, result });
    }
    return results;
  };
  const runSlashCommand = async (rawInput: string): Promise<boolean> => {
    if (!rawInput.startsWith('/')) return false;
    const [command, ...rest] = rawInput.trim().split(' ');
    const payload = rest.join(' ').trim();
    if (command === '/screenshot') {
      const mode = ['WINDOW', 'CAMERA', 'VIEWPORT'].includes(payload.toUpperCase()) ? payload.toUpperCase() : 'VIEWPORT';
      const seq = [{ name: 'take_screenshot', args: { mode } }];
      setLastToolSequence(seq);
      const [first] = await runToolSequence(seq);
      appendModelMessage(first.result?.error ? `Screenshot failed: ${first.result.error}` : `Captured ${mode.toLowerCase()} screenshot.`);
      return true;
    }
    if (command === '/scene') {
      const seq = [{ name: 'get_scene_data', args: { query: payload || 'summary' } }];
      setLastToolSequence(seq);
      const [first] = await runToolSequence(seq);
      appendModelMessage('Scene data:\n```json\n' + JSON.stringify(first.result, null, 2) + '\n```');
      return true;
    }
    if (command === '/python') {
      if (!payload) { appendModelMessage('Usage: `/python <code>`'); return true; }
      const seq = [{ name: 'execute_python', args: { code: payload } }];
      setLastToolSequence(seq);
      const [first] = await runToolSequence(seq);
      appendModelMessage('Python result:\n```json\n' + JSON.stringify(first.result, null, 2) + '\n```');
      return true;
    }
    return false;
  };
  const copyLastCodeBlock = async () => {
    const modelText = [...activeMessages].reverse().find((m) => m.role === 'model' && m.content)?.content ?? '';
    const matches = [...modelText.matchAll(/```(?:\w+)?\n([\s\S]*?)```/g)];
    const lastBlock = matches.length > 0 ? matches[matches.length - 1][1].trim() : '';
    if (!lastBlock) { appendModelMessage('No code block found in the last assistant response.'); return; }
    await navigator.clipboard.writeText(lastBlock);
    appendModelMessage('Copied latest code block to clipboard.');
  };
  const rerunLastToolSequence = async () => {
    if (lastToolSequence.length === 0 || isTyping) return;
    setIsTyping(true);
    appendModelMessage('Rerunning last tool sequence\u2026');
    try {
      const results = await runToolSequence(lastToolSequence);
      appendModelMessage(`Reran ${lastToolSequence.length} tool call(s):\n` + '```json\n' + JSON.stringify(results, null, 2) + '\n```');
    } finally { setIsTyping(false); }
  };
  const insertTemplate = (templatePrompt: string) => {
    setInput((prev) => (prev ? `${prev}\n${templatePrompt}` : templatePrompt));
    inputRef.current?.focus();
  };
  const toggleFavorite = (templateId: string) => {
    setFavorites((prev) => (prev.includes(templateId) ? prev.filter((id) => id !== templateId) : [...prev, templateId]));
  };

  // --- Core LLM reply: streaming (PR #7) + timeline (PR #4) ---
  const generateAssistantReply = async (baseMessages: Message[]) => {
    let currentHistory: any[] = baseMessages
      .filter((m) => m.content || m.parts)
      .map((m) => (m.parts ? { role: m.role, parts: m.parts } : { role: m.role, parts: [{ text: m.content }] }));

    const assistantMsgId = createId();
    let streamingStarted = false;

    const upsertStreamingMsg = (content: string) => {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== activeConversationId) return c;
          const exists = c.messages.some((m) => m.id === assistantMsgId);
          const newMsg: Message = { id: assistantMsgId, role: 'model', content, createdAt: new Date().toISOString() };
          return {
            ...c,
            messages: exists ? c.messages.map((m) => (m.id === assistantMsgId ? { ...m, content } : m)) : [...c.messages, newMsg],
            updatedAt: new Date().toISOString()
          };
        })
      );
    };

    let response = await streamLlmContent(
      { config: providerConfig, contents: currentHistory, systemInstruction: SYSTEM_INSTRUCTION, tools: BLENDER_TOOLS },
      { onTextDelta: (_delta, fullText) => { streamingStarted = true; upsertStreamingMsg(fullText); } }
    );

    // Remove partial streaming message if tool calls follow
    if (response.functionCalls && response.functionCalls.length > 0 && streamingStarted) {
      setConversations((prev) =>
        prev.map((c) => c.id !== activeConversationId ? c : {
          ...c, messages: c.messages.filter((m) => m.id !== assistantMsgId), updatedAt: new Date().toISOString()
        })
      );
      streamingStarted = false;
    }

    // Tool-call loop with timeline events
    while (response.functionCalls && response.functionCalls.length > 0) {
      const functionResponses: any[] = [];
      const toolGroupMsgId = createId();
      currentHistory.push({ role: 'model', parts: response.functionCalls.map((call) => ({ functionCall: call })) });
      setLastToolSequence(response.functionCalls.map((c) => ({ name: c.name, args: c.args })));

      for (const call of response.functionCalls) {
        const eventId = createId();
        const start = Date.now();
        setToolTimeline((prev) => [...prev, {
          id: eventId, messageId: toolGroupMsgId, toolName: call.name, args: call.args,
          argsPreview: JSON.stringify(call.args ?? {}).slice(0, 140), status: 'running', startTimestamp: start
        }]);

        if (call.name === 'execute_python') { setPythonCode((call.args as any).code); setActiveTab('code'); }
        const result: any = await executeToolInBlender(call.name, call.args);
        const isError = Boolean(result?.error);
        setToolTimeline((prev) =>
          prev.map((e) => e.id === eventId ? { ...e, status: isError ? 'failed' : 'completed', endTimestamp: Date.now(), result, error: isError ? result.error : undefined } : e)
        );

        if (call.name === 'take_screenshot' && result?.image) { setLastScreenshot(result.image); setActiveTab('viewport'); }
        if (call.name === 'execute_python' && result?.output) { setLogs((prev) => [...prev, result.output].slice(-50)); }

        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== activeConversationId) return c;
            const toolCallMsg: Message = {
              id: createId(), role: 'function',
              parts: [{ functionCall: call }, { functionResponse: { name: call.name, response: sanitizeToolPayload(result) } }],
              content: `Tool: ${call.name}`, createdAt: new Date().toISOString()
            };
            return { ...c, messages: [...c.messages, toolCallMsg], updatedAt: new Date().toISOString() };
          })
        );
        functionResponses.push({ functionResponse: { name: call.name, response: result } });
      }

      currentHistory.push({ role: 'function', parts: functionResponses });
      response = await generateLlmContent({ config: providerConfig, contents: currentHistory, systemInstruction: SYSTEM_INSTRUCTION, tools: BLENDER_TOOLS });
    }

    const finalText = response.text || 'No response generated.';
    if (streamingStarted) {
      setConversations((prev) =>
        prev.map((c) => c.id !== activeConversationId ? c : {
          ...c, messages: c.messages.map((m) => (m.id === assistantMsgId ? { ...m, content: finalText } : m)), updatedAt: new Date().toISOString()
        })
      );
    }
    return { id: assistantMsgId, role: 'model' as const, content: finalText, createdAt: new Date().toISOString() };
  };

  // --- Send handler ---
  const handleSend = async () => {
    if (!input.trim() || isTyping || !activeConversation) return;
    const cleanInput = input.trim();
    const userMsg: Message = { id: createId(), role: 'user', content: cleanInput, createdAt: new Date().toISOString() };
    const nextMessages = [...activeConversation.messages, userMsg];
    setMessagesForActive(nextMessages);
    setInput('');
    setIsTyping(true);
    try {
      const slashHandled = await runSlashCommand(cleanInput);
      if (slashHandled) return;
      const assistantMsg = await generateAssistantReply(nextMessages);
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== activeConversationId) return c;
          if (c.messages.some((m) => m.id === assistantMsg.id)) return c;
          return { ...c, messages: [...c.messages, assistantMsg], updatedAt: new Date().toISOString() };
        })
      );
    } catch (error) {
      console.error(error);
      setConversations((prev) =>
        prev.map((c) => c.id !== activeConversationId ? c : {
          ...c, messages: [...nextMessages, { id: createId(), role: 'model', content: `Error: ${String(error)}`, createdAt: new Date().toISOString() }],
          updatedAt: new Date().toISOString()
        })
      );
    } finally { setIsTyping(false); }
  };

  // --- Conversation management (PR #5) ---
  const handleCreateConversation = () => {
    const newConv = createConversation(`Conversation ${conversations.length + 1}`, providerConfig);
    setConversations((prev) => [newConv, ...prev]);
    setActiveConversationId(newConv.id);
    setToolTimeline([]);
  };
  const handleRenameConversation = (id: string) => {
    const current = conversations.find((c) => c.id === id);
    const title = prompt('Rename conversation', current?.title || '');
    if (!title?.trim()) return;
    updateConversation(id, (c) => ({ ...c, title: title.trim(), updatedAt: new Date().toISOString() }));
  };
  const handleArchiveConversation = (id: string) => {
    updateConversation(id, (c) => ({ ...c, archived: true, updatedAt: new Date().toISOString() }));
  };
  const branchFromMessage = (messageIndex: number) => {
    if (!activeConversation) return;
    const branchMessages = activeConversation.messages.slice(0, messageIndex + 1);
    const now = new Date().toISOString();
    const branched: Conversation = {
      ...activeConversation, id: createId(), title: `${activeConversation.title} (branch)`,
      createdAt: now, updatedAt: now, messages: branchMessages.map((m) => ({ ...m, id: createId() })), archived: false
    };
    setConversations((prev) => [branched, ...prev]);
    setActiveConversationId(branched.id);
    setToolTimeline([]);
  };
  const rewindAndRegenerateFromMessage = async (messageIndex: number) => {
    if (!activeConversation || isTyping) return;
    const targetMessage = activeConversation.messages[messageIndex];
    if (!targetMessage) return;
    let baseMessages = activeConversation.messages.slice(0, messageIndex + 1);
    if (targetMessage.role === 'model') baseMessages = activeConversation.messages.slice(0, messageIndex);
    const lastMsg = baseMessages[baseMessages.length - 1];
    if (!lastMsg || lastMsg.role !== 'user') { setMessagesForActive(baseMessages); return; }
    setMessagesForActive(baseMessages);
    setIsTyping(true);
    try {
      const assistantMsg = await generateAssistantReply(baseMessages);
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== activeConversationId) return c;
          if (c.messages.some((m) => m.id === assistantMsg.id)) return c;
          return { ...c, messages: [...baseMessages, assistantMsg], updatedAt: new Date().toISOString() };
        })
      );
    } catch (error) {
      console.error(error);
      setConversations((prev) =>
        prev.map((c) => c.id !== activeConversationId ? c : {
          ...c, messages: [...baseMessages, { id: createId(), role: 'model', content: 'Regeneration failed.', createdAt: new Date().toISOString() }],
          updatedAt: new Date().toISOString()
        })
      );
    } finally { setIsTyping(false); }
  };

  // --- Export/import (PR #5) ---
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
      ...imported, id: createId(), title: imported.title || 'Imported Conversation',
      createdAt: imported.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
      messages: (imported.messages || []).map((m) => ({ ...m, id: m.id || createId(), createdAt: m.createdAt || new Date().toISOString() })),
      providerConfig: imported.providerConfig || providerConfig, archived: false
    };
    setConversations((prev) => [normalized, ...prev]);
    setActiveConversationId(normalized.id);
    event.target.value = '';
  };

  return (
    <div className={`flex h-screen bg-[#0a0a0a] text-[#e0e0e0] font-sans overflow-hidden ${settingsState.compactMode ? 'text-[13px]' : ''}`}>
      <AnimatePresence>
        {toast && (
          <motion.div key="toast" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm shadow-xl ${toast.type === 'success' ? 'bg-green-800 text-green-100' : 'bg-red-900 text-red-100'}`}>
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <div className="w-72 border-r border-[#222] flex flex-col bg-[#0f0f0f] flex-shrink-0">
        <div className="p-4 flex items-center gap-2 border-b border-[#222]">
          <div className="w-8 h-8 bg-[#3b82f6] rounded flex items-center justify-center"><Box className="text-white w-5 h-5" /></div>
          <span className="font-semibold tracking-tight">Blender AI Studio</span>
        </div>
        <div className="p-3 border-b border-[#222] space-y-2">
          <button onClick={handleCreateConversation} className="w-full py-2 px-4 bg-[#1a1a1a] hover:bg-[#252525] border border-[#333] rounded-md flex items-center gap-2 text-sm transition-colors">
            <Plus className="w-4 h-4" /> New Conversation
          </button>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#666]" />
            <input value={conversationSearch} onChange={(e) => setConversationSearch(e.target.value)} placeholder="Search conversations..."
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-md pl-9 pr-3 py-2 text-sm outline-none focus:border-[#3b82f6]" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
          {filteredConversations.map((conv) => (
            <div key={conv.id} className={`group rounded-md border px-2 py-2 ${conv.id === activeConversationId ? 'bg-[#1a1a1a] border-[#3b82f6]/50' : 'bg-transparent border-transparent hover:bg-[#161616]'}`}>
              <button className="w-full text-left" onClick={() => { setActiveConversationId(conv.id); setToolTimeline([]); }}>
                <div className="text-sm font-medium truncate">{conv.title}</div>
                <div className="text-[11px] text-[#666]">{new Date(conv.updatedAt).toLocaleString()}</div>
              </button>
              <div className="hidden group-hover:flex items-center gap-1 mt-1">
                <button className="p-1 hover:bg-[#222] rounded" onClick={() => handleRenameConversation(conv.id)} title="Rename"><Pencil className="w-3.5 h-3.5" /></button>
                <button className="p-1 hover:bg-[#222] rounded" onClick={() => handleArchiveConversation(conv.id)} title="Archive"><Archive className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-[#222] space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <button onClick={handleExportJSON} className="p-2 rounded bg-[#1a1a1a] hover:bg-[#222] flex items-center gap-2 justify-center"><Download className="w-3.5 h-3.5" /> JSON</button>
            <button onClick={handleExportMarkdown} className="p-2 rounded bg-[#1a1a1a] hover:bg-[#222] flex items-center gap-2 justify-center"><Download className="w-3.5 h-3.5" /> Markdown</button>
            <button onClick={() => importInputRef.current?.click()} className="col-span-2 p-2 rounded bg-[#1a1a1a] hover:bg-[#222] flex items-center gap-2 justify-center"><Upload className="w-3.5 h-3.5" /> Import</button>
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
            <div className="w-8 h-8 rounded-full bg-[#222] flex items-center justify-center"><User className="w-4 h-4" /></div>
            <div className="text-sm"><div className="font-medium">tdillman97</div><div className="text-xs text-[#666]">Pro Plan</div></div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <header className="h-14 border-b border-[#222] flex items-center justify-between px-6 bg-[#0f0f0f]">
          <div className="flex items-center gap-2 text-sm text-[#888]">
            <span>Conversations</span><ChevronRight className="w-4 h-4" />
            <span className="text-[#e0e0e0] font-medium">{activeConversation?.title || 'Untitled Scene'}</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setSettingsOpen((prev) => !prev)} className="px-3 py-1.5 text-xs rounded-md border border-[#333] hover:bg-[#1a1a1a] transition-colors" title="Cmd/Ctrl+K">
              {providerConfig.provider} &middot; {providerConfig.model}
            </button>
            <button onClick={() => setSettingsOpen((prev) => !prev)} className="p-2 hover:bg-[#222] rounded-md transition-colors" title="Interface settings"><Settings className="w-4 h-4" /></button>
            <button className="bg-[#3b82f6] hover:bg-[#2563eb] text-white px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2"><Play className="w-4 h-4" /> Render</button>
          </div>
        </header>

        {settingsOpen && (
          <div className="absolute top-16 right-6 w-72 bg-[#111] border border-[#333] rounded-xl p-4 space-y-4 shadow-2xl z-20">
            <h3 className="text-sm font-semibold">Interface Settings</h3>
            <label className="flex items-center justify-between text-xs">Auto-scroll chat<input type="checkbox" checked={settingsState.autoScroll} onChange={(e) => setSettingsState((prev) => ({ ...prev, autoScroll: e.target.checked }))} /></label>
            <label className="flex items-center justify-between text-xs">Compact mode<input type="checkbox" checked={settingsState.compactMode} onChange={(e) => setSettingsState((prev) => ({ ...prev, compactMode: e.target.checked }))} /></label>
            <label className="flex items-center justify-between text-xs">Markdown density
              <select value={settingsState.markdownDensity} onChange={(e) => setSettingsState((prev) => ({ ...prev, markdownDensity: e.target.value as 'comfortable' | 'compact' }))} className="bg-[#1a1a1a] border border-[#333] rounded px-2 py-1">
                <option value="comfortable">Comfortable</option><option value="compact">Compact</option>
              </select>
            </label>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">
          {/* Chat panel */}
          <div className="w-[500px] flex flex-col border-r border-[#222] bg-[#0a0a0a] flex-shrink-0">
            <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
              {activeMessages.map((message, index) => {
                if (!message.content) return null;
                const timelineEvents = toolTimeline.filter((e) => e.messageId === message.id);
                return (
                  <div key={message.id} className={`group flex gap-4 ${message.role === 'user' ? 'justify-end' : ''}`}>
                    {message.role === 'model' && <div className="w-8 h-8 rounded-full bg-[#3b82f6]/10 flex items-center justify-center flex-shrink-0"><Sparkles className="w-4 h-4 text-[#3b82f6]" /></div>}
                    {message.role === 'function' && <div className="w-8 h-8 rounded-full bg-[#22c55e]/10 flex items-center justify-center flex-shrink-0"><Wrench className="w-4 h-4 text-[#22c55e]" /></div>}
                    <div className="max-w-[90%] space-y-2 flex-1 min-w-0">
                      <div className={`rounded-2xl ${settingsState.compactMode ? 'p-3 text-xs' : 'p-4 text-sm'} leading-relaxed ${
                        message.role === 'user' ? 'bg-[#3b82f6] text-white' :
                        message.role === 'function' ? 'bg-[#0f2010] border border-[#22c55e]/20 text-[#a3e0a3] font-mono text-xs' :
                        'bg-[#1a1a1a] border border-[#333] text-[#e0e0e0]'
                      }`}>
                        {message.role !== 'function' ? (
                          <div className={`prose prose-invert ${settingsState.markdownDensity === 'compact' ? 'prose-sm' : 'prose-base'} max-w-none`}><Markdown>{message.content}</Markdown></div>
                        ) : (
                          <pre className="whitespace-pre-wrap">{message.content}</pre>
                        )}
                      </div>
                      {timelineEvents.length > 0 && (
                        <div className="space-y-1 pl-2">
                          {timelineEvents.map((event) => <ToolTimelineCard key={event.id} event={event} />)}
                        </div>
                      )}
                      {message.role !== 'function' && (
                        <div className="hidden group-hover:flex gap-2 justify-end text-xs">
                          <button onClick={() => branchFromMessage(index)} className="px-2 py-1 rounded bg-[#151515] hover:bg-[#222] border border-[#2b2b2b] flex items-center gap-1"><GitBranch className="w-3 h-3" /> Branch</button>
                          <button onClick={() => rewindAndRegenerateFromMessage(index)} className="px-2 py-1 rounded bg-[#151515] hover:bg-[#222] border border-[#2b2b2b] flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Rewind</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {isTyping && (
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-[#3b82f6]/10 flex items-center justify-center"><Activity className="w-4 h-4 text-[#3b82f6] animate-pulse" /></div>
                  <div className="bg-[#1a1a1a] border border-[#333] rounded-2xl p-4 flex gap-1">
                    <div className="w-1.5 h-1.5 bg-[#444] rounded-full animate-bounce" />
                    <div className="w-1.5 h-1.5 bg-[#444] rounded-full animate-bounce [animation-delay:0.2s]" />
                    <div className="w-1.5 h-1.5 bg-[#444] rounded-full animate-bounce [animation-delay:0.4s]" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Composer */}
            <div className="p-4 border-t border-[#222]">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {PROMPT_TEMPLATES.map((template) => (
                  <div key={template.id} className="flex items-center rounded-md border border-[#333] bg-[#111]">
                    <button onClick={() => insertTemplate(template.prompt)} className="px-2 py-1 text-[11px] hover:bg-[#1a1a1a] rounded-l-md" title={template.description}>{template.title}</button>
                    <button onClick={() => toggleFavorite(template.id)} className="px-1.5 py-1 border-l border-[#333] hover:bg-[#1a1a1a] rounded-r-md" title="Favourite">
                      <Star className={`w-3 h-3 ${favorites.includes(template.id) ? 'fill-yellow-400 text-yellow-400' : 'text-[#666]'}`} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mb-2 flex items-center gap-2 text-[11px] text-[#777]">
                <button onClick={copyLastCodeBlock} className="px-2 py-1 border border-[#333] rounded-md hover:bg-[#1a1a1a]">Copy last code block</button>
                <button onClick={rerunLastToolSequence} className="px-2 py-1 border border-[#333] rounded-md hover:bg-[#1a1a1a] flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Rerun tools</button>
                <span className="ml-auto opacity-60">Slash: /screenshot /scene /python</span>
              </div>
              <div className="relative">
                <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                  placeholder="Ask the AI to build in Blender... (/screenshot, /scene, /python)"
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:border-[#3b82f6] transition-colors resize-none min-h-[100px]" />
                <button id="composer-send-btn" onClick={handleSend} disabled={!input.trim() || isTyping}
                  className="absolute right-3 bottom-3 p-2 bg-[#3b82f6] disabled:bg-[#222] text-white rounded-lg transition-all hover:scale-105 active:scale-95">
                  <Send className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-2 text-[10px] text-[#555] text-center">AI controls Blender 5.1 via Python. Results may vary based on scene complexity.</div>
            </div>
          </div>

          {/* Preview panel */}
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
                        <div className="w-20 h-20 bg-[#111] rounded-full flex items-center justify-center mx-auto border border-[#222]"><Box className="w-10 h-10 text-[#333]" /></div>
                        <div className="text-[#444] text-sm">No viewport data. Ask the AI to take a screenshot.</div>
                      </div>
                    )}
                  </motion.div>
                )}
                {activeTab === 'code' && (
                  <motion.div key="code" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 p-6 font-mono text-sm overflow-auto bg-[#0a0a0a]">
                    <pre className="text-[#3b82f6]"><code>{pythonCode}</code></pre>
                  </motion.div>
                )}
                {activeTab === 'logs' && (
                  <motion.div key="logs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 p-6 font-mono text-xs overflow-auto bg-[#0a0a0a]">
                    {logs.length > 0 ? logs.map((log, i) => (
                      <div key={i} className="mb-1 text-[#888]"><span className="text-[#444] mr-2">[{new Date().toLocaleTimeString()}]</span>{log}</div>
                    )) : <div className="text-[#444]">Waiting for logs from Blender...</div>}
                  </motion.div>
                )}
                {activeTab === 'setup' && (
                  <motion.div key="setup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 p-8 overflow-auto bg-[#0a0a0a]">
                    <div className="max-w-2xl mx-auto space-y-6">
                      {/* AI Provider Setup (PR #6) */}
                      <div className="border border-[#222] rounded-xl p-5 bg-[#0f0f0f] space-y-4">
                        <h3 className="text-sm font-semibold text-[#e0e0e0]">AI Provider Setup</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <label className="text-xs space-y-1">
                            <span className="text-[#888]">Provider</span>
                            <select value={providerConfig.provider} onChange={(e) => handleProviderChange(e.target.value as ProviderConfig['provider'])} className="w-full bg-[#111] border border-[#333] rounded-md p-2 text-sm focus:outline-none focus:border-[#3b82f6]">
                              {Object.values(PROVIDER_DEFINITIONS).map((def) => <option key={def.id} value={def.id}>{def.label}</option>)}
                            </select>
                          </label>
                          <label className="text-xs space-y-1">
                            <span className="text-[#888]">Model</span>
                            <input value={providerConfig.model} onChange={(e) => setProviderConfig((prev) => ({ ...prev, model: e.target.value }))} placeholder="Model name"
                              className={`w-full bg-[#111] border rounded-md p-2 text-sm focus:outline-none ${providerErrors.model ? 'border-red-500' : 'border-[#333] focus:border-[#3b82f6]'}`} />
                            {providerErrors.model && <span className="text-red-400">{providerErrors.model}</span>}
                          </label>
                        </div>
                        <label className="text-xs space-y-1 block">
                          <span className="text-[#888]">Base URL</span>
                          <input value={providerConfig.baseUrl || ''} onChange={(e) => setProviderConfig((prev) => ({ ...prev, baseUrl: e.target.value }))} placeholder="https://..."
                            className={`w-full bg-[#111] border rounded-md p-2 text-sm focus:outline-none ${providerErrors.baseUrl ? 'border-red-500' : 'border-[#333] focus:border-[#3b82f6]'}`} />
                          {providerErrors.baseUrl && <span className="text-red-400">{providerErrors.baseUrl}</span>}
                        </label>
                        <label className="text-xs space-y-1 block">
                          <span className="text-[#888]">API Key</span>
                          <div className="relative">
                            <input type={showApiKey ? 'text' : 'password'} value={providerConfig.apiKey || ''} onChange={(e) => setProviderConfig((prev) => ({ ...prev, apiKey: e.target.value }))}
                              placeholder={providerConfig.provider === 'lmstudio' ? 'Optional for local servers' : 'Paste API key'}
                              className={`w-full bg-[#111] border rounded-md p-2 pr-10 text-sm focus:outline-none ${providerErrors.apiKey ? 'border-red-500' : 'border-[#333] focus:border-[#3b82f6]'}`} />
                            <button type="button" onClick={() => setShowApiKey((prev) => !prev)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#777] hover:text-[#ddd]">
                              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                          {providerErrors.apiKey && <span className="text-red-400">{providerErrors.apiKey}</span>}
                        </label>
                        <div className="text-xs text-[#888] border border-[#222] rounded-md p-3 bg-[#0c0c0c]">
                          {PROVIDER_DEFINITIONS[providerConfig.provider].helperText}
                        </div>
                        <div className="flex flex-wrap gap-2 items-center">
                          <button type="button" onClick={handleTestConnection} disabled={isTestingProvider} className="px-3 py-2 rounded-md text-xs font-medium bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-[#1f2937] text-white">
                            {isTestingProvider ? 'Testing...' : 'Test connection'}
                          </button>
                          {MODEL_PRESETS.map((p) => (
                            <button key={p.label} onClick={() => applyPreset(p.label)} className="px-3 py-1 text-xs rounded-md bg-[#1a1a1a] border border-[#333] hover:bg-[#222]">{p.label}</button>
                          ))}
                          <button onClick={refreshLmStudio} className="px-3 py-1 text-xs rounded-md bg-[#1a1a1a] border border-[#333] hover:bg-[#222]">Discover LM Studio</button>
                          {providerStatus && <span className={`text-xs ${providerStatusType === 'success' ? 'text-green-400' : 'text-red-400'}`}>{providerStatus}</span>}
                        </div>
                        {lmStudioInfo && (
                          <div className="text-xs text-[#888] space-y-1">
                            <div>Endpoint: {lmStudioInfo.endpoint}</div>
                            <div>Models: {lmStudioInfo.models.length ? lmStudioInfo.models.join(', ') : 'none reported'}</div>
                          </div>
                        )}
                      </div>

                      {/* Blender connection */}
                      <div className="flex items-center gap-4 border-b border-[#222] pb-6">
                        <div className="w-12 h-12 bg-[#3b82f6]/10 rounded-xl flex items-center justify-center"><Box className="w-6 h-6 text-[#3b82f6]" /></div>
                        <div><h2 className="text-xl font-semibold">Connect Blender 5.1</h2><p className="text-[#888] text-sm">Run this script in Blender to connect to AI Studio.</p></div>
                      </div>
                      <div className="space-y-4">
                        {[
                          'Open Blender 5.1 and go to the <strong>Scripting</strong> workspace.',
                          'Create a new text block and paste the code below.',
                          'Click <strong>Run Script</strong> (Play icon).'
                        ].map((text, i) => (
                          <div key={i} className="flex items-center gap-3 text-sm">
                            <div className="w-6 h-6 rounded-full bg-[#222] flex items-center justify-center font-medium">{i + 1}</div>
                            <p dangerouslySetInnerHTML={{ __html: text }} />
                          </div>
                        ))}
                      </div>
                      <div className="relative">
                        <div className="absolute top-4 right-4 flex gap-2">
                          <button onClick={handleCopyScript} className="p-2 bg-[#222] hover:bg-[#333] rounded-md transition-colors text-[#e0e0e0] flex items-center gap-2" title="Copy Script">
                            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                            <span className="text-xs font-medium">{copied ? 'Copied!' : 'Copy'}</span>
                          </button>
                          <a href="/api/agent-script" download="blender_agent.py" className="p-2 bg-[#222] hover:bg-[#333] rounded-md transition-colors text-[#e0e0e0]" title="Download Script"><Download className="w-4 h-4" /></a>
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
    <button onClick={onClick} className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-medium transition-all ${active ? 'bg-[#1a1a1a] text-[#e0e0e0] border border-[#333]' : 'text-[#666] hover:text-[#888]'}`}>
      {icon}{label}
    </button>
  );
}

// PR #4 - Tool timeline card
interface ToolTimelineCardProps {
  event: {
    id: string; toolName: string; argsPreview: string;
    status: 'running' | 'completed' | 'failed';
    startTimestamp: number; endTimestamp?: number; error?: string;
  };
}
function ToolTimelineCard({ event }: ToolTimelineCardProps) {
  const durationMs = event.endTimestamp ? event.endTimestamp - event.startTimestamp : null;
  const statusColour = event.status === 'completed' ? 'text-green-400' : event.status === 'failed' ? 'text-red-400' : 'text-yellow-400';
  const statusLabel = event.status === 'running' ? 'Running...' : event.status === 'completed' ? 'Done' : 'Failed';
  return (
    <div className="rounded-lg border border-[#333] bg-[#111] p-2 text-xs space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[#7dd3fc]">{event.toolName}</span>
        <span className={`${statusColour} font-medium`}>{statusLabel}{durationMs !== null ? ` \u00b7 ${durationMs}ms` : ''}</span>
      </div>
      <div className="text-[#666] truncate">{event.argsPreview}</div>
      {event.status === 'failed' && event.error && <div className="text-red-400 truncate">{event.error}</div>}
    </div>
  );
}
