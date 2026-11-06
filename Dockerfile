# syntax=docker/dockerfile:1
# Imagem de produção da API. Uso: docker build -t gestao-financeira-api .

ARG NODE_VERSION=26

# Compila o TypeScript para dist/ (precisa das dependências de desenvolvimento).
FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Sem scripts: o `prepare` instala os hooks do Husky, que não existem na imagem.
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Só as dependências de produção.
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Runtime: sem compilador nem dependências de desenvolvimento, com o usuário `node` (não root).
FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3333
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# O código compilado importa a versão do package.json (referência da API).
COPY --chown=node:node package.json ./
USER node
EXPOSE 3333
# Vivo = o processo responde; a conexão com o banco fica no /ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/server.js"]
