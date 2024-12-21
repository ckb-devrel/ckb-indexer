FROM node:20-alpine AS prod
WORKDIR /app

RUN npm install -g pnpm@9.8.0

RUN --mount=type=bind,source=package.json,target=package.json \
  --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
  pnpm install --prod --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm@9.8.0

RUN --mount=type=bind,source=package.json,target=package.json \
  --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
  pnpm install

COPY . .
RUN pnpm run build

FROM node:20-alpine

COPY --link --from=builder /app/dist /app/dist
COPY --link --from=prod /app/node_modules /app/node_modules

WORKDIR /app

CMD [ "node", "./dist/main.js" ]

