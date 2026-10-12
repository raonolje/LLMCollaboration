import { progressFromLine, type CliProgress, type ProgressDetail, type ToolCategory } from './model-activity';
import type { Provider } from './types';

export const MAX_PREVIEW_LENGTH = 1600;
export const MAX_PREVIEW_MESSAGES = 3;
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const eventId = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[\w:.-]{1,160}$/u.test(value) ? value : undefined;
export const publicPreview = (value: string): string => {
  // Strip terminal controls; render this as escaped text, never as HTML or tool output.
  const clean = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/gu, '').trim();
  const points = Array.from(clean.slice(0, MAX_PREVIEW_LENGTH * 2 + 2));
  return points.slice(0, MAX_PREVIEW_LENGTH).join('') + (points.length > MAX_PREVIEW_LENGTH ? '…' : '');
};

/** Allowlisted public messages and tool lifecycle metadata only. No reasoning, inputs or outputs. */
export function cliProgressFromLine(line: string, provider: Provider): CliProgress {
  const kind = progressFromLine(line);
  const details: ProgressDetail[] = [];
  const message = (text: unknown, id?: unknown): void => {
    if (typeof text !== 'string') return;
    const preview = publicPreview(text);
    if (preview) details.push({ type: 'message', id: eventId(id), text: preview });
  };
  try {
    const record = object(JSON.parse(line));
    if (provider === 'codex' && ['item.started', 'item.updated', 'item.completed'].includes(String(record.type))) {
      const item = object(record.item);
      if (item.type === 'agent_message') {
        message(item.text, item.id);
      } else {
        const categories: Record<string, ToolCategory> = {
          command_execution: 'command', web_search: 'search', file_change: 'file',
          mcp_tool_call: 'other', collab_tool_call: 'other', dynamic_tool_call: 'other',
        };
        const category = typeof item.type === 'string' && Object.hasOwn(categories, item.type) ? categories[item.type] : undefined;
        const id = eventId(item.id);
        if (category && id) details.push({ type: 'tool', id, category,
          state: record.type !== 'item.completed' ? 'running'
            : item.status === 'failed' || item.status === 'declined' || typeof item.exit_code === 'number' && item.exit_code !== 0 ? 'failed' : 'completed' });
      }
    } else if (provider === 'claude') {
      const envelope = object(record.message);
      const content = Array.isArray(envelope.content) ? envelope.content : [];
      if (record.type === 'assistant') {
        // Claude's verbose stream emits complete assistant blocks without requesting private thinking.
        const texts: string[] = [];
        for (const raw of content) {
          const part = object(raw), id = eventId(part.id);
          if (part.type === 'text' && typeof part.text === 'string') texts.push(part.text);
          if (part.type === 'tool_use' && id) {
            const category: ToolCategory = part.name === 'Bash' ? 'command'
              : part.name === 'WebSearch' || part.name === 'WebFetch' ? 'search'
              : ['Read', 'Glob', 'Grep', 'Edit', 'Write'].includes(String(part.name)) ? 'file' : 'other';
            details.push({ type: 'tool', id, category, state: 'running' });
          }
        }
        message(texts.join('\n'), record.uuid ?? envelope.id);
      } else if (record.type === 'user') {
        for (const raw of content) {
          const part = object(raw), id = eventId(part.tool_use_id);
          if (part.type === 'tool_result' && id) details.push({ type: 'tool', id, state: part.is_error === true ? 'failed' : 'completed' });
        }
      }
    }
  } catch { /* Unknown or malformed output remains a heartbeat, never a public preview. */ }
  return details.length ? { kind: details.some((detail) => detail.type === 'tool') ? 'tool' : kind, details } : { kind };
}
