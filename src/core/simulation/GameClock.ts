export type GameSpeed = 0 | 1 | 2 | 3;

export type TimeOfDay = 'night' | 'morning_rush' | 'midday' | 'evening_rush';

export class GameClock {
  tick = 0;
  speed: GameSpeed = 1;
  paused = false;

  readonly ticksPerDay = 24;

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

  getHourOfDay(): number {
    return this.tick % this.ticksPerDay;
  }

  getTimeOfDay(): TimeOfDay {
    const hour = this.getHourOfDay();
    if (hour >= 22 || hour <= 5) return 'night';
    if (hour >= 6 && hour <= 9) return 'morning_rush';
    if (hour >= 10 && hour <= 16) return 'midday';
    return 'evening_rush'; // 17-21
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
