import { describe, expect, it } from 'vitest';
import { parseLaunchUrl } from '../src/main/chat-link';

describe('chat handoff links', () => {
  it('accepts a current Codex or Claude session', () => {
    expect(parseLaunchUrl('llmcollaboration://new-project?provider=codex&sessionId=01a0ebf6-13af-7811-b23c-ef1de781c520'))
      .toEqual({ provider: 'codex', sessionId: '01a0ebf6-13af-7811-b23c-ef1de781c520' });
    expect(parseLaunchUrl('llmcollaboration://new-project?provider=claude&sessionId=1d201da5-17e0-4cf7-bc79-815925b7541d'))
      .toEqual({ provider: 'claude', sessionId: '1d201da5-17e0-4cf7-bc79-815925b7541d' });
  });

  it('rejects unrelated URLs and invalid IDs', () => {
    expect(parseLaunchUrl('https://new-project?provider=codex&sessionId=01a0ebf6-13af-7811-b23c-ef1de781c520')).toBeNull();
    expect(parseLaunchUrl('llmcollaboration://new-project?provider=codex&sessionId=../../bad')).toBeNull();
    expect(parseLaunchUrl('llmcollaboration://delete-project?provider=codex&sessionId=01a0ebf6-13af-7811-b23c-ef1de781c520')).toBeNull();
  });
});
