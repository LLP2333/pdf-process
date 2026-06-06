FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
# 模板放到 templates/,nginx 镜像的 /docker-entrypoint.d/20-envsubst-on-templates.sh
# 会在启动时用 envsubst 把 ${CLIENT_MAX_BODY_SIZE} 等变量渲染到 /etc/nginx/conf.d/。
COPY default.conf.template /etc/nginx/templates/default.conf.template
# 兜底默认值,直接 `docker run -p 8080:80 <img>` 时也能起来
ENV CLIENT_MAX_BODY_SIZE=80m
EXPOSE 80
