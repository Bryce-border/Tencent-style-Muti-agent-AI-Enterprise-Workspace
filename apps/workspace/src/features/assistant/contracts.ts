export interface OutputDraft {
  goal: string;
  title: string;
  output_type: string;
  length: string;
  style: string;
  format: "Markdown";
  generation_mode?: "single" | "chapters";
  sections: string[];
  notes: string;
  revision?: number;
}
export interface Conversation {
  id: string;
  title: string;
  employee_id: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
  output_draft?: string | null;
  draft_revision: number;
  approved_task_id?: string | null;
}
export const conversationsChanged = () =>
  window.dispatchEvent(new Event("conversations-changed"));
export const taskStatus: Record<string, string> = {
  PENDING: "等待执行",
  RUNNING: "执行中",
  SUCCESS: "已完成",
  FAILED: "执行失败",
  CANCELLED: "已取消",
  PENDING_CONFIRMATION: "待确认",
};
