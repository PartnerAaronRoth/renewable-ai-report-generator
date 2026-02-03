#!/bin/bash
# Quick start script for Docker deployment

set -e

echo "🚀 Renewable AI Report Generator - Docker Setup"
echo "================================================"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    echo "   Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

# Check if env.example exists
if [ ! -f "env.example" ]; then
    echo "❌ env.example file not found!"
    exit 1
fi

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    echo "⚠️  .env.local not found. Creating from template..."
    cp env.example .env.local
    echo "✅ Created .env.local"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env.local and add your GEMINI_API_KEY before running!"
    echo ""
    read -p "Press Enter after you've added your API key to .env.local..."
fi

# Load environment variables
if [ -f ".env.local" ]; then
    export $(grep -v '^#' .env.local | xargs)
fi

# Check if GEMINI_API_KEY is set
if [ -z "$GEMINI_API_KEY" ] || [ "$GEMINI_API_KEY" = "your_gemini_api_key_here" ]; then
    echo "❌ GEMINI_API_KEY is not set or still has default value!"
    echo "   Please edit .env.local and set a valid API key."
    exit 1
fi

# Ask user for mode
echo "Select mode:"
echo "1) Development (hot reload, port 3000)"
echo "2) Production (optimized build, port 4173)"
echo ""
read -p "Enter choice [1-2]: " mode

case $mode in
    1)
        echo ""
        echo "🔧 Starting in DEVELOPMENT mode..."
        echo "   Access at: http://localhost:3000"
        echo ""
        docker-compose -f docker-compose.dev.yml up --build
        ;;
    2)
        echo ""
        echo "🏭 Starting in PRODUCTION mode..."
        echo "   Access at: http://localhost:4173"
        echo ""
        docker-compose up --build -d
        echo ""
        echo "✅ Container started!"
        echo "   View logs: docker-compose logs -f frontend"
        echo "   Stop: docker-compose down"
        ;;
    *)
        echo "❌ Invalid choice. Exiting."
        exit 1
        ;;
esac
