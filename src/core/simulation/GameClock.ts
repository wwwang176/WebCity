export type GameSpeed = 0 | 1 | 2 | 3;

export type TimeOfDay = 'night' | 'morning_rush' | 'midday' | 'evening_rush';

/** Hour boundaries for time-of-day periods (24-hour cycle based on ticksPerDay) */
export const TIME_PERIOD = {
  NIGHT_START: 22,
  NIGHT_END: 5,
  MORNING_RUSH_START: 6,
  MORNING_RUSH_END: 9,
  MIDDAY_START: 10,
  MIDDAY_END: 16,
  // EVENING_RUSH: 17-21 (implicit default)
} as const;

/** Milliseconds between ticks for each game speed */
export const SPEED_INTERVALS: Record<GameSpeed, number> = {
  0: Infinity,
  1: 250,
  2: 125,
  3: 83,
};

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
    if (hour >= TIME_PERIOD.NIGHT_START || hour <= TIME_PERIOD.NIGHT_END) return 'night';
    if (hour >= TIME_PERIOD.MORNING_RUSH_START && hour <= TIME_PERIOD.MORNING_RUSH_END) return 'morning_rush';
    if (hour >= TIME_PERIOD.MIDDAY_START && hour <= TIME_PERIOD.MIDDAY_END) return 'midday';
    return 'evening_rush';
  }

  getSeason(): 'spring' | 'summer' | 'autumn' | 'winter' {
    const month = this.getMonth() % 12;
    if (month < 3) return 'spring';
    if (month < 6) return 'summer';
    if (month < 9) return 'autumn';
    return 'winter';
  }

  getTickInterval(): number {
    return SPEED_INTERVALS[this.speed];
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
