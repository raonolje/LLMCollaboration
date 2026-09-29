import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crossSpawn from 'cross-spawn';
import type { ModelCatalog, ModelOption, Provider } from '../../shared/types';
import { cliStatus, resolveCliExecutable } from './cli';

type CodexModel = Readonly<{
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string }[];
}>;

const codexModels = async (executable: string): Promise<CodexModel[]> => new Promise((resolve, reject) => {
  const child = process.platform === 'win32' && /\.cmd$/iu.test(executable) ? crossSpawn(executable, ['app-server', '--stdio'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    : spawn(executable, ['app-server', '--stdio'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let pending = '';
  let settled = false;
  const finish = (error?: Error, models?: CodexModel[]): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    child.kill();
    if (error) reject(error);
    else resolve(models ?? []);
  };
  const write = (value: unknown): void => { child.stdin?.write(`${JSON.stringify(value)}\n`); };
  const timeout = setTimeout(() => finish(new Error('Codex 모델 목록 조회 시간이 초과됐습니다.')), 15_000);
  child.once('error', (error) => finish(error));
  child.once('close', () => finish(new Error('Codex 모델 목록 연결이 종료됐습니다.')));
  child.stdout?.on('data', (chunk: Buffer) => {
    pending += chunk.toString('utf8');
    if (pending.length > 4_000_000) return finish(new Error('Codex 모델 목록 응답이 너무 큽니다.'));
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    lines.filter(Boolean).map((line) => {
      try { return JSON.parse(line) as { id?: number; result?: { data?: CodexModel[] }; error?: { message?: string } }; }
      catch { return null; }
    }).filter((value) => value !== null).forEach((value) => {
      if (value.id === 1 && value.error) finish(new Error(value.error.message || 'Codex 연결 실패'));
      if (value.id === 1 && value.result) {
        write({ jsonrpc: '2.0', method: 'initialized' });
        write({ jsonrpc: '2.0', id: 2, method: 'model/list', params: { includeHidden: false, limit: 100 } });
      }
      if (value.id === 2) value.error
        ? finish(new Error(value.error.message || 'Codex 모델 목록 실패'))
        : finish(undefined, value.result?.data ?? []);
    });
  });
  write({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    clientInfo: { name: 'llm-collaboration', title: 'LLM Collaboration', version: '0.2.2' }, capabilities: null,
  } });
});

const codexCache = async (): Promise<CodexModel[]> => {
  const root = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const cache = JSON.parse(await readFile(path.join(root, 'models_cache.json'), 'utf8')) as {
    models?: { slug: string; display_name: string; description: string; visibility: string;
      default_reasoning_level: string; supported_reasoning_levels: { effort: string }[] }[];
  };
  return (cache.models ?? []).filter((item) => item.visibility === 'list').map((item) => ({
    model: item.slug, displayName: item.display_name, description: item.description, hidden: false,
    defaultReasoningEffort: item.default_reasoning_level,
    supportedReasoningEfforts: item.supported_reasoning_levels.map(({ effort }) => ({ reasoningEffort: effort })),
  }));
};

const codexCatalog = async (executable: string, cliVersion: string): Promise<ModelCatalog> => {
  const live = await codexModels(executable).then((models) => ({ models, source: 'Codex CLI', warning: undefined }))
    .catch(async (error: unknown) => ({ models: await codexCache().catch(() => []), source: 'Codex 로컬 캐시',
      warning: `실시간 조회 실패: ${error instanceof Error ? error.message : String(error)}` }));
  return {
    provider: 'codex', source: live.source, cliVersion, refreshedAt: new Date().toISOString(), warning: live.warning,
    models: live.models.filter((item) => !item.hidden).map((item): ModelOption => ({
      id: item.model, label: item.displayName || item.model, description: item.description || '',
      efforts: item.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
      defaultEffort: item.defaultReasoningEffort,
    })),
  };
};

export const parseClaudeAliases = (markdown: string): ModelOption[] => {
  const section = markdown.split('### Model aliases')[1]?.split('\n### ')[0] ?? '';
  return [...section.matchAll(/^\| \*\*`([^`]+)`\*\* \| ([^|]+) \|/gmu)]
    .map((match): ModelOption => ({
      id: match[1], label: match[1], description: match[2].replace(/\[[^\]]+\]\([^)]*\)/gu, '').replaceAll('*', '').trim(),
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      requiresCredits: /^(?:best|fable)/u.test(match[1]),
    }))
    .filter((model) => model.id !== 'default' && model.id !== 'opusplan');
};

const claudeCatalog = async (cliVersion: string): Promise<ModelCatalog> => {
  const url = 'https://code.claude.com/docs/en/model-config.md';
  const result = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    .then(async (response) => response.ok ? parseClaudeAliases(await response.text()) : [])
    .catch(() => []);
  const fallback = ['sonnet', 'opus', 'haiku'].map((id): ModelOption => ({
    id, label: id, description: 'Claude Code 모델 별칭', efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  }));
  const settingsRoot = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const settings = await readFile(path.join(settingsRoot, 'settings.json'), 'utf8')
    .then((raw) => JSON.parse(raw) as { availableModels?: string[] }).catch(() => ({} as { availableModels?: string[] }));
  const available = Array.isArray(settings.availableModels) ? new Set(settings.availableModels) : null;
  const options = available
    ? [...available].map((id) => (result.length ? result : fallback).find((item) => item.id === id)
      ?? { id, label: id, description: 'Claude Code 로컬 허용 모델', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], requiresCredits: /fable|best/iu.test(id) })
    : result.length ? result : fallback;
  return {
    provider: 'claude', source: result.length ? 'Claude Code 공식 모델 별칭' : 'Claude Code 기본 별칭',
    cliVersion, refreshedAt: new Date().toISOString(), models: options,
    warning: 'Claude Code CLI는 계정별 모델 목록 조회 명령을 제공하지 않습니다. 별칭은 최신 모델을 가리킵니다. 계정 사용 가능 여부는 실행 시 확인되며, 지원하지 않는 추론 수준은 Claude가 자동으로 낮출 수 있습니다.',
  };
};

export const discoverModelCatalog = async (provider: Provider, configuredPath?: string): Promise<ModelCatalog> => {
  const status = await cliStatus(provider, process.cwd(), configuredPath);
  if (!status.executable || !status.version) return {
    provider, source: 'CLI 없음', cliVersion: '', refreshedAt: new Date().toISOString(), models: [],
    warning: status.authentication || 'CLI 실행 파일을 찾을 수 없습니다.',
  };
  return provider === 'codex' ? codexCatalog(status.executable, status.version) : claudeCatalog(status.version);
};
