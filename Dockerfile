# --- build ---------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

# --- runtime -------------------------------------------------------------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Never run as root.
USER node

# Default to the HTTP transport in a container; stdio needs an attached client.
ENV UMAMI_MCP_TRANSPORT=http \
    UMAMI_MCP_HOST=0.0.0.0 \
    UMAMI_MCP_PORT=3334
EXPOSE 3334

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.UMAMI_MCP_PORT||3334)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
