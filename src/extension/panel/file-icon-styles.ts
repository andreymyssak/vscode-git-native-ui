interface StyleFiles {
  write(this: void, name: string, css: string): Promise<void>;
  remove(this: void, name: string): Promise<void>;
}

export class FileIconStyles {
  private generation = 0;
  private closed = false;
  private readonly owned = new Map<string, number>();
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly files: StyleFiles) {}

  begin(): number {
    return ++this.generation;
  }

  async save(
    generation: number,
    prefix: string,
    css: string,
  ): Promise<string | null> {
    if (
      this.closed ||
      generation !== this.generation ||
      !/^git-file-theme-[a-z0-9-]+$/.test(prefix)
    )
      return null;
    const name = prefix + '.css';
    const write = this.files.write(name, css);

    this.pending.add(write);
    try {
      await write;
    } finally {
      this.pending.delete(write);
    }

    this.owned.set(name, generation);
    if (this.closed || generation !== this.generation) {
      await this.remove(name);

      return null;
    }

    await this.prune();

    return name;
  }

  async prune(): Promise<void> {
    const obsolete = [...this.owned]
      .sort((left, right) => right[1] - left[1])
      .slice(2);

    await Promise.all(obsolete.map(([file]) => this.remove(file)));
  }

  async dispose(): Promise<void> {
    this.closed = true;
    this.generation++;
    await Promise.allSettled([...this.pending]);
    await Promise.all([...this.owned.keys()].map((name) => this.remove(name)));
  }

  private async remove(name: string): Promise<void> {
    try {
      await this.files.remove(name);
      this.owned.delete(name);
    } catch {
      // Retry retained files on the next publication or directory cleanup.
    }
  }
}
