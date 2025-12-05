#!/bin/bash
# Quick launcher for visitor analytics visualizer

cd "$(dirname "$0")"

echo "🎨 Visitor Analytics Visualizer"
echo "================================"
echo ""

# Check if venv exists
if [ ! -d "venv" ]; then
    echo "⚠️  Virtual environment not found. Creating..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -q -r requirements.txt
    echo "✅ Virtual environment created"
else
    source venv/bin/activate
fi

# Check if MongoDB URI is set
if [ -z "$MONGODB_URI_PROD" ]; then
    echo "⚠️  MONGODB_URI_PROD not set. Using default from config..."
    export MONGODB_URI_PROD='mongodb+srv://TangoTiempoBE:FdyY153reBqXPHIL@tangotiempoprimary.qisq8.mongodb.net/TangoTiempoProd?retryWrites=true&w=majority&appName=TangoTiempoPrimary'
fi

echo ""
echo "Choose visualization mode:"
echo "1) Quick preview (static HTML files)"
echo "2) Full dashboard (interactive, runs on http://127.0.0.1:8050)"
echo ""
read -p "Enter choice [1-2]: " choice

case $choice in
    1)
        echo ""
        echo "🚀 Generating static HTML files..."
        python test_visualization.py
        ;;
    2)
        echo ""
        echo "🚀 Starting interactive dashboard..."
        echo "📍 Open browser to: http://127.0.0.1:8050"
        echo "   Press Ctrl+C to stop"
        python visitor_analytics_visualizer.py
        ;;
    *)
        echo "Invalid choice. Exiting."
        exit 1
        ;;
esac
