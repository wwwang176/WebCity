export class AutoSaver {
  private readonly interval: number;
  private lastSaveTick: number;

  constructor(interval: number = 100) {
    this.interval = interval;
    this.lastSaveTick = 0;
  }

  shouldSave(currentTick: number): boolean {
    if (currentTick === 0) return false;
    if (currentTick % this.interval === 0) {
      this.lastSaveTick = currentTick;
      return true;
    }
    return false;
  }

  getLastSaveTick(): number {
    return this.lastSaveTick;
  }
}
