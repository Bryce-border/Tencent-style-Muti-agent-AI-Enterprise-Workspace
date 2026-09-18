export type Status =
  | "PENDING"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED"
  | "PENDING_CONFIRMATION";
export interface Citation {
  chunkId?: string;
  title?: string;
  content?: string;
  documentId?: string;
  score?: number;
  metadata?: { file_document_id?: string; version?: number; filename?: string };
}
export interface Step {
  node_id: string;
  employee_id?: string;
  agent?: string;
  objective?: string;
  depends_on: string[];
}
export interface Task {
  task_id: string;
  workspace_id: string;
  employee_id: string;
  prompt: string;
  status: Status;
  plan: Step[];
  created_at: string;
  updated_at: string;
  result: null | {
    data: {
      output?: unknown;
      mode?: string;
      generation_mode?: "single" | "chapters";
      document?: {
        title: string;
        total: number;
        complete: boolean;
        chapters: Array<{ chapter_id: string; title: string; content: string; summary: string }>;
        brief: Record<string, string[]>;
      };
      metrics?: { agent_calls: number; failed_calls: number; reused_chapters: number; reported_tokens: number; usage_reported_calls: number; elapsed_ms: number; model: string };
      node_results?: Array<Step & { output: unknown; citations?: Citation[] }>;
      review?: { decision: string; feedback: string };
    };
    error?: string;
    next_action?: string;
    citations: Citation[];
  };
}
export interface Employee {
  employee_id: string;
  name: string;
  title: string;
  description: string;
  capabilities: string[];
  status: string;
  execution_scope: string;
}
export interface Event {
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}
export interface Message extends Event {
  id: number;
  task_id: string;
  prompt: string;
}
export interface Report {
  task_id: string;
  title: string;
  created_at: string;
  content?: string;
}
export interface Dashboard {
  tasks: {
    total: number;
    active: number;
    success: number;
    failed: number;
    pending_confirmation: number;
  };
  knowledge: { documents: number; chunks: number; available: boolean };
  employee_count: number;
  employees_available: number;
  reports: number;
  runtime: { configured: boolean; model: string };
}
