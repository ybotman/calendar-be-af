#!/bin/bash
# Setup environment for visitor analytics visualizer

echo "🔧 Visitor Analytics Visualizer - Environment Setup"
echo "=================================================="

# Check if MongoDB URI is already set
if [ -n "$MONGODB_URI_PROD" ]; then
    echo "✅ MONGODB_URI_PROD is already set"
    echo ""
    echo "Connection string preview:"
    echo "$MONGODB_URI_PROD" | sed 's/\(.*:\/\/[^:]*:\)[^@]*\(@.*\)/\1***HIDDEN***\2/'
else
    echo "⚠️  MONGODB_URI_PROD is not set"
    echo ""
    echo "Options:"
    echo "1. Get from Azure Function App Settings:"
    echo "   az functionapp config appsettings list --name CalendarBEAF-PROD --resource-group CalendarBEAF --query \"[?name=='MONGODB_URI'].value\" --output tsv"
    echo ""
    echo "2. Set manually:"
    echo "   export MONGODB_URI_PROD='mongodb+srv://TangoTiempoBE:PASSWORD@cluster.mongodb.net/TangoTiempoProd?retryWrites=true&w=majority'"
    echo ""
    echo "3. Add to ~/.zshrc for persistence:"
    echo "   echo 'export MONGODB_URI_PROD=\"mongodb+srv://...\"' >> ~/.zshrc"
    echo "   source ~/.zshrc"
fi

echo ""
echo "=================================================="
echo "Next steps:"
echo "1. pip install -r requirements.txt"
echo "2. python visitor_analytics_visualizer.py"
echo "3. Open http://127.0.0.1:8050"
echo "=================================================="
