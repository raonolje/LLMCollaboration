import { describe, expect, it } from 'vitest';
import { cliArguments, type CliRequest } from '../src/main/services/cli';
import { parseClaudeAliases } from '../src/main/services/model-catalog';
import { newerVersion } from '../src/main/updater';

const request = (provider: 'codex' | 'claude', effort: string): CliRequest => ({
  projectPath: '/project', cwd: '/project', choice: { provider, model: provider === 'codex' ? 'gpt-6-sol' : 'sonnet' },
  prompt: 'Review the plan', phase: 'project-chat', readOnly: true, sessionId: 'session-1',
  signal: new AbortController().signal, effort,
});

describe('current model selection', () => {
  it('passes the chosen model and reasoning level to each CLI, including resumed sessions', () => {
    expect(cliArguments(request('codex', 'xhigh'))).toEqual(expect.arrayContaining([
      '--model', 'gpt-6-sol', '--config', 'model_reasoning_effort="xhigh"', 'resume', 'session-1',
    ]));
    expect(cliArguments(request('claude', 'medium'))).toEqual(expect.arrayContaining([
      '--model', 'sonnet', '--effort', 'medium', '--resume', 'session-1',
    ]));
  });

  it('reads Claude aliases from the current documentation table without pinning model versions', () => {
    const aliases = parseClaudeAliases('### Model aliases\n| Model alias | Behavior |\n| - | - |\n| **`sonnet`** | Latest Sonnet |\n| **`fable`** | Credit model |\n### Work with models');
    expect(aliases.map((item) => item.id)).toEqual(['sonnet', 'fable']);
    expect(aliases.find((item) => item.id === 'fable')?.requiresCredits).toBe(true);
  });
});

describe('application update versions', () => {
  it('detects a newer stable version only', () => {
    expect(newerVersion('v0.2.1', '0.2.0')).toBe(true);
    expect(newerVersion('v0.2.0', '0.2.0')).toBe(false);
    expect(newerVersion('v0.1.9', '0.2.0')).toBe(false);
    expect(newerVersion('unknown', '0.2.0')).toBe(false);
  });
});
