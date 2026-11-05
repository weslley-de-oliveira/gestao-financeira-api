-- Texto que compara sem diferenciar maiúsculas, usado no e-mail dos usuários (users.email).
-- O drizzle-kit não gerencia extensões, por isso esta migração é escrita à mão.
CREATE EXTENSION IF NOT EXISTS citext;
