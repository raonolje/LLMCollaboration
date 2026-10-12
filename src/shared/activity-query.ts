/** Timing out the UI query never cancels the model or its CLI process. */
export async function queryActivity<T>(read: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('CLI 상태 조회 응답 대기 시간 초과')), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
