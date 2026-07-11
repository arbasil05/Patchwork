FROM node:22-bookworm-slim

# Prevent npm update notifications and reduce noise
ENV NODE_ENV=development
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# Create an unprivileged user
RUN useradd --create-home --shell /bin/bash runner

WORKDIR /workspace

# Copy and install locked dependencies
COPY package.json package-lock.json ./

RUN npm ci --omit=optional && \
    npm cache clean --force

USER runner

CMD ["tail", "-f", "/dev/null"]