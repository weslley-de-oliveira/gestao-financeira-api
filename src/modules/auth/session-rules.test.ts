import { describe, expect, it } from 'vitest';
import {
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_MAX_LIFETIME_MS,
  SESSION_TOUCH_INTERVAL_MS,
  exceedsMaxLifetime,
  shouldTouch,
  slidingExpiry,
} from './session-rules.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const createdAt = new Date('2026-11-01T12:00:00Z');
const after = (ms: number) => new Date(createdAt.getTime() + ms);

describe('slidingExpiry', () => {
  it('estende para 7 dias depois do uso', () => {
    const now = after(3 * DAY_MS);

    expect(slidingExpiry(createdAt, now)).toEqual(after(3 * DAY_MS + SESSION_IDLE_TIMEOUT_MS));
  });

  it('não passa de 30 dias depois do login', () => {
    expect(slidingExpiry(createdAt, after(25 * DAY_MS))).toEqual(after(SESSION_MAX_LIFETIME_MS));
    expect(slidingExpiry(createdAt, after(29 * DAY_MS))).toEqual(after(SESSION_MAX_LIFETIME_MS));
  });

  it('no login, vale 7 dias', () => {
    expect(slidingExpiry(createdAt, createdAt)).toEqual(after(SESSION_IDLE_TIMEOUT_MS));
  });
});

describe('exceedsMaxLifetime', () => {
  it('vale até o instante dos 30 dias, exclusive', () => {
    expect(exceedsMaxLifetime(createdAt, after(SESSION_MAX_LIFETIME_MS - 1))).toBe(false);
    expect(exceedsMaxLifetime(createdAt, after(SESSION_MAX_LIFETIME_MS))).toBe(true);
  });
});

describe('shouldTouch', () => {
  it('renova só depois do intervalo mínimo desde o último uso', () => {
    expect(shouldTouch(createdAt, after(SESSION_TOUCH_INTERVAL_MS - 1))).toBe(false);
    expect(shouldTouch(createdAt, after(SESSION_TOUCH_INTERVAL_MS))).toBe(true);
  });
});
