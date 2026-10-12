import { describe, expect, it } from 'vitest';
import { assignedWriter } from '../src/shared/chat-execution';
import { cliArguments, type CliRequest } from '../src/main/services/cli';

describe('direct CLI work', () => {
  it('recognizes the actual failed writer/reviewer instruction without treating a reference to Codex as another assignment', () => {
    expect(assignedWriter('코덱스는 토론 최종 결과 내용을 반영해서 검토 폴더를 만들어서 새로운 파일을 생성해. 클로드는 코덱스가 수정한 파일이 제대로 수정되었는지 체크해')).toBe('codex');
    expect(assignedWriter('클로드는 파일을 작성해. 코덱스는 검수해')).toBe('claude');
    expect(assignedWriter('코덱스와 클로드가 각각 콘셉트를 제안해')).toBeUndefined();
  });
  it('preserves native configured permissions for direct work and exposes all Claude built-in tools', () => {
    const request: CliRequest = { projectPath: 'project', cwd: 'project', choice: { provider: 'codex', model: 'default' }, prompt: 'work', phase: 'direct', readOnly: false, useConfiguredPermissions: true, signal: new AbortController().signal };
    expect(cliArguments(request)).not.toContain('--sandbox');
    expect(cliArguments({ ...request, readOnly: true })).toContain('read-only');
    const args = cliArguments({ ...request, choice: { provider: 'claude', model: 'default' }, onPermissionRequest: async () => ({ behavior: 'deny' }) });
    expect(args[args.indexOf('--tools') + 1]).toBe('default');
    expect(args).toContain('host'); expect(args[args.indexOf('--permission-mode') + 1]).toBe('manual');
    expect(args).toContain('--permission-prompt-tool'); expect(args).toContain('stdio');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });
});
