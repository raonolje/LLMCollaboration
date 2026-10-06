import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { AppUpdateDraft } from '../shared/types';
import { writeJson } from './services/repository';

const draftFile = (directory: string): string => path.join(directory, 'update-draft.json');
export const validateUpdateDraft = (value: unknown): AppUpdateDraft => {
  if (!value || typeof value !== 'object') throw new Error('업데이트 초안 형식이 올바르지 않습니다.');
  const draft = value as AppUpdateDraft;
  if (draft.version !== 1 || typeof draft.text !== 'string' || draft.text.length > 20_000
    || !['both', 'codex', 'claude'].includes(draft.target) || !Array.isArray(draft.files) || draft.files.length > 5
    || typeof draft.discussion !== 'boolean' || typeof draft.composerOpen !== 'boolean'
    || !Number.isInteger(draft.discussionRounds) || (draft.discussionRounds !== -1 && (draft.discussionRounds < 1 || draft.discussionRounds > 8))
    || !draft.models || typeof draft.models !== 'object' || Array.isArray(draft.models)
    || (draft.projectPath !== undefined && (typeof draft.projectPath !== 'string' || draft.projectPath.length > 1_000))) {
    throw new Error('업데이트 초안 형식이 올바르지 않습니다.');
  }
  let bytes = 0;
  for (const model of Object.values(draft.models)) {
    if (!model || typeof model.model !== 'string' || typeof model.effort !== 'string' || model.model.length > 200 || model.effort.length > 200) throw new Error('모델 초안 형식이 올바르지 않습니다.');
  }
  for (const file of draft.files) {
    if (typeof file === 'string') { if (file.length > 4_096) throw new Error('첨부 경로가 너무 깁니다.'); continue; }
    if (!file || typeof file.name !== 'string' || typeof file.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/u.test(file.data)) throw new Error('첨부 초안 형식이 올바르지 않습니다.');
    const size = Buffer.byteLength(file.data, 'base64');
    if (size > 25 * 1024 * 1024) throw new Error('첨부 초안 크기 제한을 초과했습니다.');
    bytes += size;
  }
  if (bytes > 50 * 1024 * 1024 || JSON.stringify(draft).length > 75 * 1024 * 1024) throw new Error('초안 크기 제한을 초과했습니다.');
  return draft;
};
export const saveUpdateDraft = async (directory: string, value: unknown): Promise<void> => writeJson(draftFile(directory), validateUpdateDraft(value));
export const readUpdateDraft = async (directory: string): Promise<AppUpdateDraft | null> => {
  try { return validateUpdateDraft(JSON.parse(await readFile(draftFile(directory), 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
};
export const clearUpdateDraft = (directory: string): Promise<void> => rm(draftFile(directory), { force: true });
