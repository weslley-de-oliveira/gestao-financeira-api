import fp from 'fastify-plugin';
import type { IsoDate } from '../shared/utils/date.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** Data de hoje (`yyyy-MM-dd`) no fuso configurado em `TIME_ZONE`. */
    today(): IsoDate;
  }
}

export interface ClockOptions {
  timeZone: string;
  /** Momento atual; os testes passam um fixo para controlar o "hoje". */
  now?: () => Date;
}

/** Relógio da API: o "hoje" das regras de calendário (faturas) não depende do fuso do servidor. */
export const clockPlugin = fp<ClockOptions>(
  async (app, { timeZone, now = () => new Date() }) => {
    // `en-CA` formata como `yyyy-MM-dd`.
    const format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    app.decorate('today', () => format.format(now()));
  },
  { name: 'clock' },
);
