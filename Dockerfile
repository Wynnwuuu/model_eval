FROM node:22.23.2-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
ARG VITE_USE_API_BACKEND=true
ARG VITE_API_BASE_URL=
ARG VITE_AUTH_MODE=local
ENV VITE_USE_API_BACKEND=$VITE_USE_API_BACKEND
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_AUTH_MODE=$VITE_AUTH_MODE
RUN npm run lint
RUN npm run build
RUN npm run server:build

FROM node:22.23.2-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV API_PORT=8787
ENV STATIC_DIST_PATH=/app/dist

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

EXPOSE 8787

CMD ["node", "dist-server/server/index.js"]
