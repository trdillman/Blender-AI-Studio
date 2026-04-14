export interface PromptTemplate {
  id: string;
  title: string;
  description: string;
  prompt: string;
  category: 'scene' | 'python' | 'render' | 'debug';
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'blocking-scene',
    title: 'Block scene',
    description: 'Create a quick scene layout with primitive placeholders.',
    category: 'scene',
    prompt:
      'Create a blocked scene layout: add a ground plane, three proxy objects (hero, midground, background), and a key/fill/rim light setup. Explain what was created.'
  },
  {
    id: 'material-pass',
    title: 'Material pass',
    description: 'Apply basic materials and organize material slots.',
    category: 'scene',
    prompt:
      'Analyze scene materials and apply a cohesive base material pass with named materials by object type. Keep values physically plausible.'
  },
  {
    id: 'python-operator',
    title: 'Custom operator',
    description: 'Generate reusable Blender Python operator code.',
    category: 'python',
    prompt:
      'Write and run a Blender Python operator that renames selected objects with an incremental suffix and logs each rename.'
  },
  {
    id: 'render-preview',
    title: 'Preview render',
    description: 'Set up viewport + camera snapshot checks.',
    category: 'render',
    prompt:
      'Set render engine and sampling for fast previews, place camera for a medium shot of active objects, and take a camera screenshot.'
  },
  {
    id: 'debug-scene',
    title: 'Scene diagnostics',
    description: 'Inspect and summarize common scene issues.',
    category: 'debug',
    prompt:
      'Inspect scene for missing materials, hidden geometry, unapplied transforms, and non-manifold meshes. Return a concise action list.'
  }
];
