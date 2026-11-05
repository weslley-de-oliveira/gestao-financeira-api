import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply } from 'fastify';

/**
 * O prefixo `__Host-` obriga o navegador a aceitar o cookie só com `Secure`, `Path=/` e sem
 * `Domain`: ele fica preso a esta origem. Navegadores tratam `localhost` como seguro, então
 * funciona em desenvolvimento sem HTTPS.
 */
export const SESSION_COOKIE = '__Host-session';

const BASE_OPTIONS = {
  httpOnly: true, // inacessível a JavaScript (protege contra roubo por XSS)
  secure: true,
  sameSite: 'lax', // não vai em POST vindo de outro site (CSRF)
  path: '/',
} as const satisfies CookieSerializeOptions;

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, { ...BASE_OPTIONS, expires: expiresAt });
}
