import type { ToolApproval } from './types';
export const toolQuestions = (approval: ToolApproval): string[] => {
  if (approval.toolName !== 'AskUserQuestion') return [];
  try { const value = JSON.parse(approval.parameters); return Array.isArray(value.questions)
    ? value.questions.filter((item: unknown) => item && typeof item === 'object' && typeof (item as { question?: unknown }).question === 'string').map((item: { question: string }) => item.question) : []; }
  catch { return []; }
};
