# Production image with Node.js, Python, and yt-dlp
FROM node:20-alpine

# Install Python and yt-dlp
RUN apk add --no-cache python3 py3-pip ffmpeg

# Install yt-dlp
RUN pip3 install --no-cache-dir yt-dlp

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install Node.js dependencies
RUN npm ci --production

# Copy application files
COPY src ./src
COPY public ./public

# Create temp directory for downloads
RUN mkdir -p temp

# Set environment variables
ENV PORT=3000
ENV NODE_ENV=production
ENV PYTHON_PATH=python3

EXPOSE 3000

CMD ["node", "src/server.js"]
