import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const plugins = [remarkGfm];
const components: Components = {
  a: ({ children, href }) => <span className="markdown-link" title={href}>{children} {href && <small>({href})</small>}</span>,
  table: ({ children }) => <div className="markdown-table-scroll" tabIndex={0} role="region" aria-label="표 · 좌우 스크롤"><table>{children}</table></div>,
  img: ({ alt }) => <span className="markdown-image">🖼 {alt || '이미지'}</span>,
};

export const MarkdownText = memo(function MarkdownText({ text }: { text: string }) {
  return <div className="markdown-body"><ReactMarkdown remarkPlugins={plugins} components={components}>{text}</ReactMarkdown></div>;
});
