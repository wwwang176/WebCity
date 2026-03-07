export type GameSpeed = 0 | 1 | 2 | 3;

export class GameClock {
  tick = 0;
  speed: GameSpeed = 1;
  paused = false;

  private ticksPerDay = 4;

  advance(): boolean {
    if (this.paused || this.speed === 0) return false;
    this.tick++;
    return true;
  }

  getDay(): number {
    return Math.floor(this.tick / this.ticksPerDay);
  }

  getMonth(): number {
    return Math.floor(this.getDay() / 30);
  }

  getYear(): number {
    return Math.floor(this.getMonth() / 12);
  }

  getSeason(): 'spring' | 'summer' | 'autumn' | 'winter' {
    const month = this.getMonth() % 12;
    if (month < 3) return 'spring';
    if (month < 6) return 'summer';
    if (month < 9) return 'autumn';
    return 'winter';
  }

  getTickInterval(): number {
    switch (this.speed) {
      case 0: return Infinity;
      case 1: return 250;
      case 2: return 125;
      case 3: return 83;
    }
  }

  setSpeed(speed: GameSpeed): void {
    this.speed = speed;
    this.paused = speed === 0;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }
}
