export class RecordIdAllocator {
  private last = 0;

  next(): number {
    const nowMicros = Date.now() * 1000;
    const next = nowMicros > this.last ? nowMicros : this.last + 1;
    this.last = next;
    return next;
  }
}

export function recordKey(id: number): string {
  return id.toString().padStart(16, "0");
}
