FROM node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68
WORKDIR /app
COPY egress-lib.mjs proxy.mjs ./
USER node
EXPOSE 8888
CMD ["node", "proxy.mjs"]
