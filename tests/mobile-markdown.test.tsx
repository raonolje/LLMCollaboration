import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
vi.mock('../mobile/node_modules/react-native/index.js', async () => import('../mobile/node_modules/react-native-web/dist/index.js'));
import React from '../mobile/node_modules/react/index.js';
import { renderToStaticMarkup } from '../mobile/node_modules/react-dom/server.node.js';
import { StyleSheet } from '../mobile/node_modules/react-native-web/dist/index.js';
import { MarkdownText, parseMarkdown } from '../mobile/MarkdownText';

describe('mobile GFM rendering', () => {
  const message = '## 최종 결과\n\n**합의된 외형**\n\n- 첫 항목\n- 여섯 번째도 보존\n\n| 컷 | 지시 |\n|---|---|\n| 200 | **마지막 표**와 한국어 |\n\n<script>alert(1)</script>\n\n![참조](https://example.invalid/private.png)';
  it('renders headings, emphasis, lists and complete final tables in a local scroll region', () => {
    const html = renderToStaticMarkup(React.createElement(MarkdownText, { text: message }));
    expect(html).toContain('최종 결과');
    expect(html).toContain('여섯 번째도 보존');
    expect(html).toContain('마지막 표');
    expect(html).toContain('표 · 좌우 스크롤');
    // React Native Web extracts styles into its stylesheet rather than inline attributes.
    const css = StyleSheet.getSheet().textContent;
    expect(css).toContain('max-width:100%');
    expect(css).toContain('overflow-x:auto');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    mkdirSync('work/fix-verification-20261002', { recursive: true });
    writeFileSync('work/fix-verification-20261002/mobile-markdown.html', `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\nbody{margin:0;padding:14px;box-sizing:border-box}#fixture{width:100%;min-width:0}</style></head><body><main id="fixture">${html}</main></body></html>`);
  });
  it('parses escaped pipes and fenced code without inventing extra table columns', () => {
    const tree = parseMarkdown('| A | B |\n|---|---|\n| x\\|y | z |\n\n```txt\n| raw | table |\n```');
    expect(tree.children?.[0].children?.[1].children).toHaveLength(2);
    expect(tree.children?.[1].type).toBe('code');
  });
});
