# Use the official Node.js 20 lightweight image
FROM node:20-slim

# Set the working directory inside the container
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy the rest of the application files
COPY . .

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
