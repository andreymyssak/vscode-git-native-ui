interface Options<T> {
  load(this: void): Promise<T | null>;
  publish(this: void, value: T | null): Promise<void>;
}

export class FileIconSession<T> {
  private epoch = 0;
  private closed = false;
  private active = false;
  private current: T | null | undefined;

  constructor(private readonly options: Options<T>) {}

  async refresh(): Promise<void> {
    if (this.closed) return;
    const epoch = ++this.epoch;
    let result: T | null;

    try {
      result = await this.options.load();
    } catch {
      result = null;
    }

    if (this.closed || epoch !== this.epoch) return;
    this.current = result;
    if (this.active) await this.options.publish(result);
  }

  ready(): void {
    if (this.closed) return;
    this.active = true;
    if (this.current !== undefined) void this.options.publish(this.current);
  }

  dispose(): void {
    this.closed = true;
    this.epoch++;
  }
}
