import bpy
import json
import threading
import time
import os
import tempfile
import base64
from io import StringIO
from contextlib import redirect_stdout, redirect_stderr
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 28000

def execute_python(code):
    out = StringIO()
    err = StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        try:
            # Execute in the global namespace so variables persist
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

def take_viewport_screenshot(view):
    filepath = os.path.join(tempfile.gettempdir(), "blender_screenshot.png")
    old_filepath = bpy.context.scene.render.filepath
    bpy.context.scene.render.filepath = filepath
    
    # Force a UI update to ensure viewport is fresh
    bpy.ops.wm.redraw_timer(type='DRAW_WIN_SWAP', iterations=1)
    
    try:
        # Use OpenGL render for quick viewport capture
        bpy.ops.render.opengl(write_still=True)
    except Exception as e:
        bpy.context.scene.render.filepath = old_filepath
        return {"error": str(e)}
        
    bpy.context.scene.render.filepath = old_filepath
    
    if os.path.exists(filepath):
        with open(filepath, "rb") as f:
            encoded = base64.b64encode(f.read()).decode('utf-8')
        return {"image": f"data:image/png;base64,{encoded}"}
    return {"error": "Failed to capture screenshot"}

class BlenderRequestHandler(BaseHTTPRequestHandler):
    def _set_cors_headers(self):
        origin = self.headers.get('Origin', '*')
        self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Access-Control-Request-Private-Network')
        self.send_header('Access-Control-Allow-Private-Network', 'true')

    def do_OPTIONS(self):
        self.send_response(204)
        self._set_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path == '/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "version": bpy.app.version_string}).encode('utf-8'))
        else:
            self.send_response(404)
            self._set_cors_headers()
            self.end_headers()

    def do_POST(self):
        if self.path == '/execute':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length) if content_length > 0 else b'{}'
            
            try:
                req = json.loads(post_data.decode('utf-8'))
                tool = req.get("tool")
                args = req.get("args", {})
                
                print(f"Executing tool: {tool}")
                
                result = None
                if tool == "execute_python":
                    result = execute_python(args.get("code", ""))
                elif tool == "get_scene_data":
                    result = get_scene_data(args.get("query", ""))
                elif tool == "take_viewport_screenshot":
                    result = take_viewport_screenshot(args.get("view", "CAMERA"))
                else:
                    result = {"error": f"Unknown tool: {tool}"}
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"result": result}).encode('utf-8'))
                
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        else:
            self.send_response(404)
            self._set_cors_headers()
            self.end_headers()

    def log_message(self, format, *args):
        # Suppress default HTTP logging to keep console clean
        pass

def start_server():
    server_address = ('127.0.0.1', PORT)
    httpd = HTTPServer(server_address, BlenderRequestHandler)
    print(f"Blender AI Agent listening on http://127.0.0.1:{PORT}")
    httpd.serve_forever()

# Start the local server in a background thread
thread = threading.Thread(target=start_server, daemon=True)
thread.start()
print("Blender AI Agent started. Ready for commands from AI Studio.")
