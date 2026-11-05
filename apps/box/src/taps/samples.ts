// A fixed-size ring of the latest numbers (ping round trips, press reports): the bench reads them, nothing waits on
// them, and they never grow.

export class Samples {
  private readonly ring: Float64Array;
  private next = 0;
  private count = 0;

  constructor(size = 512) {
    this.ring = new Float64Array(size);
  }

  push(value: number): void {
    this.ring[this.next] = value;
    this.next = (this.next + 1) % this.ring.length;
    if (this.count < this.ring.length) this.count++;
  }

  /** The kept values, oldest first. */
  values(): number[] {
    const out: number[] = [];
    const start = (this.next - this.count + this.ring.length) % this.ring.length;
    for (let i = 0; i < this.count; i++) out.push(this.ring[(start + i) % this.ring.length]!);
    return out;
  }
}
