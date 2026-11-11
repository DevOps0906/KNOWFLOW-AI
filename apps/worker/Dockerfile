# 빌드 컨텍스트는 저장소 루트다(pnpm 워크스페이스). 비밀은 빌드 인자로 받지 않고 실행 시 환경 변수로만 받는다.
FROM node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68 AS build
WORKDIR /repo
RUN npm install -g pnpm@12.16.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter worker
COPY apps/worker/tsconfig.json apps/worker/tsconfig.build.json apps/worker/
COPY apps/worker/src apps/worker/src
RUN pnpm --filter worker build
RUN pnpm --filter worker deploy --prod --legacy /out

FROM node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/worker/dist ./dist
USER node
CMD ["node", "dist/main.js"]
