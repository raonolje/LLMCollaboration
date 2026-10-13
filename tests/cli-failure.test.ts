import { expect, it } from 'vitest';
import { cliFailure } from '../src/shared/cli-failure';

it('reports expired OAuth from a synthetic assistant error rather than a successful answer', () => {
  expect(cliFailure({ type: 'assistant', error: 'authentication_failed', is_api_error_message: true,
    message: { content: [{ type: 'text', text: 'Failed to authenticate: OAuth session expired and could not be refreshed' }] } })).toContain('로그인 세션이 만료');
});
it('preserves actual API and result errors while ignoring ordinary messages and permission denials', () => {
  expect(cliFailure({ type: 'assistant', is_api_error_message: true, message: { content: [{ type: 'text', text: 'Overloaded' }] } })).toBe('Overloaded');
  expect(cliFailure({ type: 'result', is_error: true, errors: ['Request failed'] })).toBe('Request failed');
  expect(cliFailure({ type: 'result', is_error: false, permission_denials: [{}] })).toBeUndefined();
  expect(cliFailure({ type: 'assistant', message: { content: [{ type: 'text', text: 'All done' }] } })).toBeUndefined();
});
