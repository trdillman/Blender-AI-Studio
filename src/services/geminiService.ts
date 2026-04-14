import { Type, FunctionDeclaration } from "@google/genai";

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

export const SYSTEM_INSTRUCTION = `You are an expert Blender 5.1 assistant integrated into a Google AI Studio-like environment. 
You have direct access to Blender's Python API (bpy). 
When the user asks to create, modify, or analyze something in Blender, use the provided tools.
Always provide clear explanations of the Python code you are running.
If you need visual feedback, use the take_viewport_screenshot tool.`;
