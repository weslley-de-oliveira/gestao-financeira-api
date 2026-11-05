-- Remove acentos em consultas, usado na busca de transações por descrição e observações
-- ("alimentacao" encontra "Alimentação"). O drizzle-kit não gerencia extensões, por isso esta
-- migração é escrita à mão.
CREATE EXTENSION IF NOT EXISTS unaccent;
