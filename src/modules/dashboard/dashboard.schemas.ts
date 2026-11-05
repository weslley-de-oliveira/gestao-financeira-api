import { z } from 'zod';

/** Maior período aceito: um ano (o gráfico de saldo tem um ponto por dia). */
export const MAX_DASHBOARD_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

export const dashboardQuerySchema = z
  .object({
    from: z.iso
      .date('Informe uma data válida no formato aaaa-mm-dd.')
      .optional()
      .meta({ description: 'Início do período, inclusivo; padrão: o primeiro dia do mês atual.' }),
    to: z.iso
      .date('Informe uma data válida no formato aaaa-mm-dd.')
      .optional()
      .meta({ description: 'Fim do período, inclusivo; padrão: o último dia do mês atual.' }),
  })
  .superRefine(({ from, to }, context) => {
    if ((from === undefined) !== (to === undefined)) {
      context.addIssue({
        code: 'custom',
        path: [from === undefined ? 'from' : 'to'],
        message: 'Informe as duas datas do período, ou nenhuma (mês atual).',
      });
    } else if (from && to && from > to) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'A data final deve ser igual ou posterior à data inicial.',
      });
    } else if (
      from &&
      to &&
      (Date.parse(to) - Date.parse(from)) / DAY_MS + 1 > MAX_DASHBOARD_DAYS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'O período deve ter no máximo um ano.',
      });
    }
  });

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export const dashboardSchema = z
  .object({
    from: z.iso.date().meta({ description: 'Início do período considerado.' }),
    to: z.iso.date().meta({ description: 'Fim do período considerado.' }),
    summary: z
      .object({
        income: z.int().meta({ description: 'Receitas realizadas do período, em centavos.' }),
        expense: z.int().meta({
          description: 'Despesas realizadas do período (com compras no cartão), em centavos.',
        }),
        net: z.int().meta({ description: 'Receitas − despesas.' }),
        pendingCount: z
          .int()
          .meta({ description: 'Transações pendentes do período, contadas à parte.' }),
      })
      .meta({
        description:
          'Só realizadas entram nos totais; transferências e pagamentos de fatura não são receita nem despesa.',
      }),
    balance: z.object({
      total: z.int().meta({ description: 'Saldo atual somado das contas ativas, em centavos.' }),
      activeAccounts: z.int().meta({ description: 'Quantidade de contas ativas.' }),
    }),
  })
  .meta({ id: 'Dashboard' });

export type DashboardDto = z.infer<typeof dashboardSchema>;
