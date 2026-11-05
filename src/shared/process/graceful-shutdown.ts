import closeWithGrace from 'close-with-grace';
import type { FastifyInstance } from 'fastify';

/** Tempo para concluir o encerramento; abaixo dos 30 s que o Render espera antes do SIGKILL. */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

export interface GracefulShutdown {
  /** Encerra como se tivesse recebido um sinal (usado nos testes). */
  close: () => void;
  /** Remove os listeners do processo. */
  uninstall: () => void;
}

/**
 * Encerra a aplicação com calma em SIGTERM/SIGINT (deploy, Ctrl+C) e em erro não tratado:
 * `app.close()` para de aceitar conexões (novas requisições recebem 503), espera as em andamento e
 * dispara os hooks `onClose` (o plugin `db` fecha o pool). Se passar do prazo, sai à força.
 * Sai com código 0 após um sinal e 1 após erro ou prazo esgotado.
 */
export function registerGracefulShutdown(
  app: FastifyInstance,
  delay: number = SHUTDOWN_TIMEOUT_MS,
): GracefulShutdown {
  return closeWithGrace({ delay, logger: app.log }, async ({ signal, err }) => {
    if (err) {
      app.log.error({ err }, 'erro não tratado; encerrando a API');
    } else {
      app.log.info({ signal }, 'encerrando a API');
    }
    await app.close();
  });
}
