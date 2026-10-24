# ==========================================
# Etapa 1: Construcción (Build con Node + Vite + TypeScript)
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Instalar dependencias aprovechando la caché de capas de Docker
COPY package.json package-lock.json ./
RUN npm ci

# Copiar código fuente, configuración y assets
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY sports-pack ./sports-pack
COPY ui ./ui
COPY backgrounds ./backgrounds
COPY sounds ./sounds
COPY src ./src

# Compilar TypeScript y generar el bundle de producción en /app/dist
RUN npm run build

# Asegurar que las carpetas estáticas de assets estén presentes dentro de /app/dist
RUN cp -r sports-pack ui backgrounds sounds /app/dist/

# ==========================================
# Etapa 2: Servidor de Producción (Nginx Alpine)
# ==========================================
FROM nginx:stable-alpine AS production

# Configuración optimizada de Nginx con soporte para assets estáticos y compresión Gzip
RUN printf 'server {\n\
    listen 80;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
\n\
    gzip on;\n\
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;\n\
\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
\n\
    location ~* \\.(png|jpg|jpeg|gif|ico|svg|ogg|mp3|wav|ttf|woff|woff2)$ {\n\
        expires 7d;\n\
        add_header Cache-Control "public, no-transform";\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

# Copiar el bundle compilado y todos los recursos del juego desde la etapa builder
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
