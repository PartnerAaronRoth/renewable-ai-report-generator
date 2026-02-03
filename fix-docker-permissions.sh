#!/bin/bash
# Fix Docker permission issues

set -e

echo "Adding current user to docker group..."
sudo usermod -aG docker $USER

echo ""
echo "✓ User added to docker group"
echo "Activating docker group for current shell..."
echo ""

# Start new shell with docker group active
exec newgrp docker
