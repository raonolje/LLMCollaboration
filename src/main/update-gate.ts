// Freeze new service calls while allowing all accepted work to finish normally.
export class UpdateGate {
  private frozen = false;
  private pending = new Set<Promise<unknown>>();

  run<T>(action: () => Promise<T>): Promise<T> {
    if (this.frozen) return Promise.reject(new Error('업데이트 준비 중입니다. 토론과 업무가 끝난 뒤 자동 재시작합니다.'));
    const result = Promise.resolve().then(action);
    this.pending.add(result);
    void result.finally(() => this.pending.delete(result)).catch(() => undefined);
    return result;
  }

  async freeze(): Promise<() => void> {
    if (this.frozen) throw new Error('업데이트가 이미 진행 중입니다.');
    this.frozen = true;
    await Promise.allSettled([...this.pending]);
    return () => { this.frozen = false; };
  }
}
