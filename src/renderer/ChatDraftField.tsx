import { useImperativeHandle, useState, type ClipboardEvent, type Ref, type RefObject } from 'react';

export type ChatDraftHandle = { setValue: (value: string) => void };

// Keep every keystroke local. The parent only needs to know whether sending is enabled.
export function ChatDraftField({ draft, onHasDraft, onPaste, ref }: {
  draft: RefObject<string>;
  onHasDraft: (hasDraft: boolean) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  ref: Ref<ChatDraftHandle>;
}) {
  const [value, setValue] = useState(draft.current);
  const update = (next: string): void => {
    draft.current = next;
    setValue(next);
    onHasDraft(Boolean(next.trim()));
  };
  useImperativeHandle(ref, () => ({ setValue: update }));
  return <div className="field"><label htmlFor="project-chat-input">메시지</label>
    <textarea id="project-chat-input" value={value} maxLength={20_000} rows={2}
      onChange={(event) => update(event.target.value)} onPaste={onPaste}
      placeholder="모든 탭에서 지시 입력 · 이미지 드래그 또는 Ctrl+V 붙여넣기" />
  </div>;
}
