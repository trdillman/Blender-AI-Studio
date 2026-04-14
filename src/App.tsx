import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Box, 
  Code, 
  Image as ImageIcon, 
  Terminal, 
  Settings, 
  Layers, 
  Play, 
  Cpu,
  Activity,
  ChevronRight,
  Plus,
  Search,
  User,
  Sparkles,
  Monitor,
  Download,
  Copy,
  Check,
  Eye,
  EyeOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ai, BLENDER_TOOLS, SYSTEM_INSTRUCTION } from './services/geminiService';
import Markdown from 'react-markdown';
import { ProviderId, PROVIDER_DEFINITIONS } from './services/providerConfig';
import { hydrateProviderSettings, persistProviderSettings, validateProviderSettings } from './services/providerSettingsService';

interface Message {
  role: 'user' | 'model' | 'function';
  content?: string;
  parts?: any[];
}

type ProviderErrors = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};

type ToastState = {
  type: 'success' | 'error';
  message: string;
} | null;

export default function App() {
  const [provider, setProvider] = useState<ProviderId>(() => hydrateProviderSettings().provider);
  const [model, setModel] = useState(() => hydrateProviderSettings().model);
  const [baseUrl, setBaseUrl] = useState(() => hydrateProviderSettings().baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [providerErrors, setProviderErrors] = useState<ProviderErrors>({});
  const [isTestingProvider, setIsTestingProvider] = useState(false);
  const [providerStatus, setProviderStatus] = useState<string | null>(null);
  const [providerStatusType, setProviderStatusType] = useState<'success' | 'error' | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', content: 'Welcome to Blender AI Studio. I have direct access to your Blender 5.1 instance via Firebase. How can I help you build today?' }
  ]);
  const [input, setInput] = useState('');
  const [isBlenderConnected, setIsBlenderConnected] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [activeTab, setActiveTab] = useState<'viewport' | 'code' | 'logs' | 'setup'>('setup');
  const [lastScreenshot, setLastScreenshot] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [pythonCode, setPythonCode] = useState<string>('# Python output will appear here');
  const [sessionId] = useState(() => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15));
  const [copied, setCopied] = useState(false);
  
  const chatEndRef = useRef<HTMLDivElement>(null);

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
                            # Send to main thread
                            command_queue.put((doc_name, tool, args_str, timestamp))
                            
                            # Wait for main thread to finish executing
                            result = result_queue.get()
                            
                            # Update Firebase
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
                            
        except Exception as e:
            pass
            
        time.sleep(1.0)

def process_commands():
    try:
        # Non-blocking check
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
        
    return 0.1  # Run this fast on the main thread

# Start the background thread if not already running
if "_firebase_thread" not in bpy.app.driver_namespace or not bpy.app.driver_namespace["_firebase_thread"].is_alive():
    thread = threading.Thread(target=firebase_worker, daemon=True)
    thread.start()
    bpy.app.driver_namespace["_firebase_thread"] = thread

if not bpy.app.timers.is_registered(process_commands):
    bpy.app.timers.register(process_commands)

print("Blender AI Agent started. Connected to Firebase Bridge (Non-blocking).")
`;

  // Listen for completed commands to update connection status
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

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    persistProviderSettings({ provider, model, baseUrl });
  }, [provider, model, baseUrl]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleCopyScript = () => {
    navigator.clipboard.writeText(agentScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const pushStatus = (type: 'success' | 'error', message: string) => {
    setProviderStatusType(type);
    setProviderStatus(message);
    setToast({ type, message });
  };

  const handleProviderChange = (nextProvider: ProviderId) => {
    const defaults = PROVIDER_DEFINITIONS[nextProvider];
    setProvider(nextProvider);
    setModel(defaults.defaultModel);
    setBaseUrl(defaults.defaultBaseUrl);
    setProviderErrors({});
    setProviderStatus(null);
    setProviderStatusType(null);
  };

  const handleTestConnection = async () => {
    const nextErrors = validateProviderSettings({ provider, model, baseUrl }, apiKey);
    setProviderErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      pushStatus('error', 'Fix validation errors before testing the connection.');
      return;
    }

    setIsTestingProvider(true);
    try {
      const response = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, baseUrl, apiKey })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        pushStatus('error', data?.error || 'Connection test failed.');
        return;
      }
      pushStatus('success', data?.message || 'Connection successful.');
    } catch (error) {
      console.error('Provider test failed:', error);
      pushStatus('error', 'Unable to reach the backend test endpoint.');
    } finally {
      setIsTestingProvider(false);
    }
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

        // Listen for completion
        const unsubscribe = onSnapshot(commandRef, (docSnap) => {
          const data = docSnap.data();
          if (data && data.status === 'completed') {
            unsubscribe();
            resolve(JSON.parse(data.result));
          } else if (data && data.status === 'error') {
            unsubscribe();
            resolve({ error: "Command failed in Blender" });
          }
        });
        
        // Timeout after 30 seconds
        setTimeout(() => {
          unsubscribe();
          resolve({ error: "Command timed out. Is Blender running?" });
        }, 30000);
        
      } catch (e) {
        console.error("Failed to execute tool via Firebase:", e);
        resolve({ error: "Failed to connect to Firebase Bridge." });
      }
    });
  };

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;

    const userMsg: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      let currentHistory: any[] = messages
        .filter(m => m.content || m.parts)
        .map(m => {
          if (m.parts) return { role: m.role, parts: m.parts };
          return { role: m.role, parts: [{ text: m.content }] };
        });
        
      currentHistory.push({ role: 'user', parts: [{ text: input }] });

      let response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: currentHistory,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{ functionDeclarations: BLENDER_TOOLS }]
        }
      });
      
      while (response.functionCalls && response.functionCalls.length > 0) {
        const functionResponses = [];
        
        // Append the model's function calls to history
        currentHistory.push({
          role: 'model',
          parts: response.functionCalls.map(call => ({ functionCall: call }))
        });
        
        for (const call of response.functionCalls) {
          if (call.name === 'execute_python') {
            setPythonCode((call.args as any).code);
            setActiveTab('code');
          }
          
          const result: any = await executeToolInBlender(call.name, call.args);
          
          if (call.name === 'take_screenshot' && result?.image) {
             setLastScreenshot(result.image);
             setActiveTab('viewport');
          }
          if (call.name === 'execute_python' && result?.output) {
             setLogs(prev => [...prev, result.output].slice(-50));
          }
          
          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: result
            }
          });
        }
        
        // Append the function responses to history
        currentHistory.push({
          role: 'function',
          parts: functionResponses
        });
        
        // Call Gemini again with the results
        response = await ai.models.generateContent({
          model: "gemini-2.5-pro",
          contents: currentHistory,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            tools: [{ functionDeclarations: BLENDER_TOOLS }]
          }
        });
      }

      if (response.text) {
        setMessages(prev => [...prev, { role: 'model', content: response.text }]);
      }
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'model', content: 'Error connecting to Gemini or Blender.' }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-[#e0e0e0] font-sans overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-[#222] flex flex-col bg-[#0f0f0f]">
        <div className="p-4 flex items-center gap-2 border-b border-[#222]">
          <div className="w-8 h-8 bg-[#3b82f6] rounded flex items-center justify-center">
            <Box className="text-white w-5 h-5" />
          </div>
          <span className="font-semibold tracking-tight">Blender AI Studio</span>
        </div>
        
        <div className="flex-1 overflow-y-auto py-4">
          <div className="px-4 mb-6">
            <button className="w-full py-2 px-4 bg-[#1a1a1a] hover:bg-[#252525] border border-[#333] rounded-md flex items-center gap-2 text-sm transition-colors">
              <Plus className="w-4 h-4" />
              New Project
            </button>
          </div>

          <nav className="space-y-1 px-2">
            <SidebarItem icon={<Monitor className="w-4 h-4" />} label="Viewport" active={activeTab === 'viewport'} onClick={() => setActiveTab('viewport')} />
            <SidebarItem icon={<Code className="w-4 h-4" />} label="Scripting" active={activeTab === 'code'} onClick={() => setActiveTab('code')} />
            <SidebarItem icon={<Terminal className="w-4 h-4" />} label="Console" active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} />
            <SidebarItem icon={<Settings className="w-4 h-4" />} label="Setup" active={activeTab === 'setup'} onClick={() => setActiveTab('setup')} />
          </nav>
        </div>

        <div className="p-4 border-t border-[#222] space-y-4">
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

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-[#222] flex items-center justify-between px-6 bg-[#0f0f0f]">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-[#888]">
              <span>Projects</span>
              <ChevronRight className="w-4 h-4" />
              <span className="text-[#e0e0e0] font-medium">Untitled Scene</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="p-2 hover:bg-[#222] rounded-md transition-colors">
              <Search className="w-4 h-4" />
            </button>
            <button className="bg-[#3b82f6] hover:bg-[#2563eb] text-white px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2">
              <Play className="w-4 h-4" />
              Render
            </button>
          </div>
        </header>

        {/* Workspace */}
        <div className="flex-1 flex overflow-hidden">
          {/* Chat Panel */}
          <div className="w-[450px] flex flex-col border-r border-[#222] bg-[#0a0a0a]">
            <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
              {messages.map((msg, i) => {
                if (!msg.content) return null;
                return (
                  <div key={i} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                    {msg.role === 'model' && (
                      <div className="w-8 h-8 rounded-full bg-[#3b82f6]/10 flex items-center justify-center flex-shrink-0">
                        <Sparkles className="w-4 h-4 text-[#3b82f6]" />
                      </div>
                    )}
                    <div className={`max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed ${
                      msg.role === 'user' 
                        ? 'bg-[#3b82f6] text-white' 
                        : 'bg-[#1a1a1a] border border-[#333] text-[#e0e0e0]'
                    }`}>
                      <div className="prose prose-invert prose-sm max-w-none">
                        <Markdown>
                          {msg.content}
                        </Markdown>
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
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
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

          {/* Preview Panel */}
          <div className="flex-1 flex flex-col bg-[#050505]">
            <div className="flex items-center gap-1 p-2 border-b border-[#222] bg-[#0f0f0f]">
              <TabButton 
                active={activeTab === 'viewport'} 
                onClick={() => setActiveTab('viewport')}
                icon={<Monitor className="w-3.5 h-3.5" />}
                label="Viewport"
              />
              <TabButton 
                active={activeTab === 'code'} 
                onClick={() => setActiveTab('code')}
                icon={<Code className="w-3.5 h-3.5" />}
                label="Script"
              />
              <TabButton 
                active={activeTab === 'logs'} 
                onClick={() => setActiveTab('logs')}
                icon={<Terminal className="w-3.5 h-3.5" />}
                label="Console"
              />
              <TabButton 
                active={activeTab === 'setup'} 
                onClick={() => setActiveTab('setup')}
                icon={<Settings className="w-3.5 h-3.5" />}
                label="Setup"
              />
            </div>

            <div className="flex-1 relative overflow-hidden">
              <AnimatePresence mode="wait">
                {activeTab === 'viewport' && (
                  <motion.div 
                    key="viewport"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex items-center justify-center p-8"
                  >
                    {lastScreenshot ? (
                      <img 
                        src={lastScreenshot} 
                        alt="Blender Viewport" 
                        className="max-w-full max-h-full rounded-lg border border-[#333] shadow-2xl"
                        referrerPolicy="no-referrer"
                      />
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
                  <motion.div 
                    key="code"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 p-6 font-mono text-sm overflow-auto bg-[#0a0a0a]"
                  >
                    <pre className="text-[#3b82f6]">
                      <code>{pythonCode}</code>
                    </pre>
                  </motion.div>
                )}

                {activeTab === 'logs' && (
                  <motion.div 
                    key="logs"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 p-6 font-mono text-xs overflow-auto bg-[#0a0a0a]"
                  >
                    {logs.length > 0 ? (
                      logs.map((log, i) => (
                        <div key={i} className="mb-1 text-[#888]">
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
                  <motion.div 
                    key="setup"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 p-8 overflow-auto bg-[#0a0a0a]"
                  >
                    <div className="max-w-2xl mx-auto space-y-6">
                      <div className="border border-[#222] rounded-xl p-5 bg-[#0f0f0f] space-y-4">
                        <h3 className="text-sm font-semibold text-[#e0e0e0]">AI Provider Setup</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <label className="text-xs space-y-1">
                            <span className="text-[#888]">Provider</span>
                            <select
                              value={provider}
                              onChange={(e) => handleProviderChange(e.target.value as ProviderId)}
                              className="w-full bg-[#111] border border-[#333] rounded-md p-2 text-sm focus:outline-none focus:border-[#3b82f6]"
                            >
                              {Object.values(PROVIDER_DEFINITIONS).map((definition) => (
                                <option key={definition.id} value={definition.id}>
                                  {definition.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-xs space-y-1">
                            <span className="text-[#888]">Model</span>
                            <input
                              value={model}
                              onChange={(e) => setModel(e.target.value)}
                              className={`w-full bg-[#111] border rounded-md p-2 text-sm focus:outline-none ${
                                providerErrors.model ? 'border-red-500' : 'border-[#333] focus:border-[#3b82f6]'
                              }`}
                              placeholder="Model name"
                            />
                            {providerErrors.model && <span className="text-red-400">{providerErrors.model}</span>}
                          </label>
                        </div>

                        <label className="text-xs space-y-1 block">
                          <span className="text-[#888]">Base URL</span>
                          <input
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            className={`w-full bg-[#111] border rounded-md p-2 text-sm focus:outline-none ${
                              providerErrors.baseUrl ? 'border-red-500' : 'border-[#333] focus:border-[#3b82f6]'
                            }`}
                            placeholder="https://..."
                          />
                          {providerErrors.baseUrl && <span className="text-red-400">{providerErrors.baseUrl}</span>}
                        </label>

                        <label className="text-xs space-y-1 block">
                          <span className="text-[#888]">API Key</span>
                          <div className="relative">
                            <input
                              type={showApiKey ? 'text' : 'password'}
                              value={apiKey}
                              onChange={(e) => setApiKey(e.target.value)}
                              className={`w-full bg-[#111] border rounded-md p-2 pr-10 text-sm focus:outline-none ${
                                providerErrors.apiKey ? 'border-red-500' : 'border-[#333] focus:border-[#3b82f6]'
                              }`}
                              placeholder={provider === 'lmstudio' ? 'Optional for local servers' : 'Paste API key'}
                            />
                            <button
                              type="button"
                              onClick={() => setShowApiKey(prev => !prev)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#777] hover:text-[#ddd]"
                              title={showApiKey ? 'Hide API key' : 'Reveal API key'}
                            >
                              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                          {providerErrors.apiKey && <span className="text-red-400">{providerErrors.apiKey}</span>}
                        </label>

                        <div className="text-xs text-[#888] border border-[#222] rounded-md p-3 bg-[#0c0c0c]">
                          {PROVIDER_DEFINITIONS[provider].helperText}
                        </div>

                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={handleTestConnection}
                            disabled={isTestingProvider}
                            className="px-3 py-2 rounded-md text-xs font-medium bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-[#1f2937] text-white"
                          >
                            {isTestingProvider ? 'Testing...' : 'Test connection'}
                          </button>
                          {providerStatus && (
                            <span className={`text-xs ${providerStatusType === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                              {providerStatus}
                            </span>
                          )}
                        </div>
                      </div>

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
                          <button 
                            onClick={handleCopyScript}
                            className="p-2 bg-[#222] hover:bg-[#333] rounded-md transition-colors text-[#e0e0e0] flex items-center gap-2"
                            title="Copy Script"
                          >
                            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                            <span className="text-xs font-medium">{copied ? 'Copied!' : 'Copy'}</span>
                          </button>
                          <a 
                            href="/api/agent-script" 
                            download="blender_agent.py"
                            className="p-2 bg-[#222] hover:bg-[#333] rounded-md transition-colors text-[#e0e0e0]"
                            title="Download Script"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        </div>
                        <pre className="bg-[#111] border border-[#222] rounded-xl p-6 overflow-x-auto text-xs font-mono text-[#a8b2c1] max-h-[400px] overflow-y-auto">
{agentScript}
                        </pre>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
      {toast && (
        <div className="fixed top-4 right-4 z-50">
          <div className={`px-4 py-2 rounded-md border text-sm shadow-lg ${
            toast.type === 'success'
              ? 'bg-green-900/60 border-green-500 text-green-200'
              : 'bg-red-900/60 border-red-500 text-red-200'
          }`}>
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
        active ? 'bg-[#3b82f6]/10 text-[#3b82f6]' : 'text-[#888] hover:bg-[#1a1a1a] hover:text-[#e0e0e0]'
      }`}
    >
      {icon}
      <span className="font-medium">{label}</span>
    </button>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
        active 
          ? 'bg-[#1a1a1a] text-[#e0e0e0] border border-[#333]' 
          : 'text-[#666] hover:text-[#888]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
