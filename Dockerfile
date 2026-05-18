FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run server:build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV API_PORT=8787

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist-server ./dist-server

EXPOSE 8787

CMD ["node", "dist-server/server/index.js"]
