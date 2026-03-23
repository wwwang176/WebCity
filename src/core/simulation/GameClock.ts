import { Season } from '../climate/Climate';

export type GameSpeed = 0 | 1 | 3 | 5 | 10;

export enum TimeOfDay {
  NIGHT = 'night',
  MORNING_RUSH = 'morning_rush',
  MIDDAY = 'midday',
  EVENING_RUSH = 'evening_rush',
}

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
  3: 83,
  5: 50,
  10: 25,
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

  getWeek(): number {
    return Math.floor(this.getDay() / 7);
  }

  getHourOfDay(): number {
    return this.tick % this.ticksPerDay;
  }

  getTimeOfDay(): TimeOfDay {
    const hour = this.getHourOfDay();
    if (hour >= TIME_PERIOD.NIGHT_START || hour <= TIME_PERIOD.NIGHT_END) return TimeOfDay.NIGHT;
    if (hour >= TIME_PERIOD.MORNING_RUSH_START && hour <= TIME_PERIOD.MORNING_RUSH_END) return TimeOfDay.MORNING_RUSH;
    if (hour >= TIME_PERIOD.MIDDAY_START && hour <= TIME_PERIOD.MIDDAY_END) return TimeOfDay.MIDDAY;
    return TimeOfDay.EVENING_RUSH;
  }

  getSeason(): Season {
    const month = this.getMonth() % 12;
    if (month < 3) return Season.SPRING;
    if (month < 6) return Season.SUMMER;
    if (month < 9) return Season.AUTUMN;
    return Season.WINTER;
  }

  getTickInterval(): number {
    return SPEED_INTERVALS[this.speed];
  }

  /** All valid non-zero speeds in order, for changeSpeed cycling. */
  static readonly SPEEDS: readonly GameSpeed[] = [1, 3, 5, 10];

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
