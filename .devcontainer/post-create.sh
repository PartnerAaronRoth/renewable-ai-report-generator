#!/bin/bash

echo "════════════════════════════════════════════════════════════════"
echo "  🚀 Renewable AI Report Generator - Codespace Ready!"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. Create your .env file with required secrets:"
echo "   cp env.example .env"
echo "   # Then edit .env with your actual values"
echo ""
echo "2. Build and run with Docker Compose:"
echo "   docker-compose up --build -d"
echo ""
echo "3. Or use VS Code tasks (Ctrl+Shift+P → 'Tasks: Run Task'):"
echo "   - Dev: Compose Up"
echo "   - Dev: Compose Down"
echo "   - Dev: Logs"
echo ""
echo "4. Access the application:"
echo "   - Production: http://localhost:8000"
echo "   - Health check: http://localhost:8000/health"
echo ""
echo "5. View logs:"
echo "   docker-compose logs -f"
echo ""
echo "📚 Documentation:"
echo "   - README.md - Project overview"
echo "   - DOCKER.md - Docker deployment guide"
echo "   - GEMINI_BACKEND_MIGRATION_PLAN.md - Backend migration plan"
echo ""
echo "⚠️  Remember: NEVER commit secrets to git!"
echo "════════════════════════════════════════════════════════════════"

# Make sure docker is accessible
sudo chmod 666 /var/run/docker.sock 2>/dev/null || true

# Install npm dependencies (for local development if needed)
if [ -f "package.json" ]; then
    echo ""
    echo "📦 Installing npm dependencies..."
    npm install
fi

echo ""
echo "✅ Setup complete!"
