FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# nginx sans droits root, port 8080.
FROM nginxinc/nginx-unprivileged:1.31-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY securite.conf /etc/nginx/snippets/securite.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 8080
