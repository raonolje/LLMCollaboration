import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

type Node = { type: string; value?: string; depth?: number; ordered?: boolean; start?: number; url?: string; alt?: string; children?: Node[] };
const parser = unified().use(remarkParse).use(remarkGfm);
export const parseMarkdown = (text: string): Node => parser.parse(text) as Node;

/** Native and web use the same GFM tree; no HTML execution or remote image fetch. */
export function MarkdownText({ text }: { text: string }) {
  const tree = React.useMemo(() => parseMarkdown(text), [text]);
  const inline = (node: Node, key: string): React.ReactNode => {
    const children = node.children?.map((child, index) => inline(child, `${key}-${index}`));
    switch (node.type) {
      case 'strong': return <Text key={key} style={s.strong}>{children}</Text>;
      case 'emphasis': return <Text key={key} style={s.emphasis}>{children}</Text>;
      case 'delete': return <Text key={key} style={s.deleted}>{children}</Text>;
      case 'inlineCode': return <Text key={key} style={s.code}>{node.value}</Text>;
      case 'break': return '\n';
      case 'link': return <Text key={key} style={s.link}>{children}{node.url ? ` (${node.url})` : ''}</Text>;
      case 'image': return <Text key={key}>🖼 {node.alt || '이미지'}</Text>;
      default: return node.value ?? children;
    }
  };
  const block = (node: Node, key: string): React.ReactNode => {
    if (node.type === 'table') return <ScrollView key={key} horizontal style={s.tableScroll} accessibilityLabel="표 · 좌우 스크롤">
      <View>{node.children?.map((row, rowIndex) => <View key={rowIndex} style={s.tableRow}>{row.children?.map((cell, column) =>
        <View key={column} style={[s.cell, rowIndex === 0 && s.header]}><Text selectable style={[s.text, rowIndex === 0 && s.strong]}>{cell.children?.map((child, index) => inline(child, `${key}-${rowIndex}-${column}-${index}`))}</Text></View>)}</View>)}</View>
    </ScrollView>;
    if (node.type === 'list') return <View key={key} style={s.list}>{node.children?.map((item, index) => <View key={index} style={s.listItem}>
      <Text style={s.text}>{node.ordered ? `${(node.start ?? 1) + index}.` : '•'}</Text><View style={s.listBody}>{item.children?.map((child, position) => block(child, `${key}-${index}-${position}`))}</View>
    </View>)}</View>;
    if (node.type === 'blockquote') return <View key={key} style={s.quote}>{node.children?.map((child, index) => block(child, `${key}-${index}`))}</View>;
    if (node.type === 'code') return <ScrollView key={key} horizontal style={s.tableScroll}><Text selectable style={[s.text, s.codeBlock]}>{node.value}</Text></ScrollView>;
    if (node.type === 'thematicBreak') return <View key={key} style={s.rule} />;
    return <Text key={key} selectable style={[s.text, node.type === 'heading' && s.heading, node.depth === 1 && s.title]}>{node.children?.map((child, index) => inline(child, `${key}-${index}`)) ?? node.value}</Text>;
  };
  return <View style={s.root}>{tree.children?.map((node, index) => block(node, String(index)))}</View>;
}

const s = StyleSheet.create({
  root: { minWidth: 0, maxWidth: '100%', alignSelf: 'stretch', gap: 10 },
  text: { fontSize: 15, lineHeight: 24, color: '#172644', flexShrink: 1 },
  strong: { fontWeight: '700' }, emphasis: { fontStyle: 'italic' }, deleted: { textDecorationLine: 'line-through' },
  heading: { fontSize: 18, fontWeight: '700', marginTop: 6 }, title: { fontSize: 21 },
  link: { color: '#4054b8' }, code: { backgroundColor: '#edf1fa', fontFamily: 'monospace' },
  codeBlock: { fontFamily: 'monospace', padding: 12, backgroundColor: '#edf1fa' },
  tableScroll: { maxWidth: '100%', minWidth: 0, flexGrow: 0 },
  tableRow: { flexDirection: 'row' }, cell: { width: 170, padding: 10, borderWidth: 0.5, borderColor: '#cdd5e4' },
  header: { backgroundColor: '#edf1fa' }, list: { gap: 6 }, listItem: { flexDirection: 'row', gap: 8 },
  listBody: { flex: 1, minWidth: 0, gap: 6 }, quote: { borderLeftWidth: 3, borderLeftColor: '#8090c0', paddingLeft: 12, gap: 8 },
  rule: { borderTopWidth: 1, borderColor: '#dfe5f0', marginVertical: 5 },
});
