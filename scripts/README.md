# Visitor Analytics Visualizer

Interactive dashboard for visualizing visitor geolocation and temporal patterns from MongoDB.

## Features

### Tab 1: 📍 Geolocation Map
- **Google API locations** (Blue dots 🔵)
- **IPInfo.io locations** (Red dots 🔴)
- Interactive markers with visitor details (IP, city, visit count)
- Auto-centered on data points

### Tab 2: 🔥 Time Heatmap
- **X-axis:** Day of week (Sunday - Saturday)
- **Y-axis:** Hour of day (0-23)
- **Color intensity:** Number of visits
- Shows visitor traffic patterns by time and day

## Quick Start

### 1. Create Virtual Environment (One-time setup)
```bash
cd scripts
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Set MongoDB Connection
```bash
# Option A: Export environment variable (temporary)
export MONGODB_URI_PROD="mongodb+srv://TangoTiempoBE:PASSWORD@cluster.mongodb.net/TangoTiempoProd?retryWrites=true&w=majority&appName=TangoTiempoPrimary"

# Option B: Add to your shell profile (~/.zshrc or ~/.bashrc) (permanent)
echo 'export MONGODB_URI_PROD="mongodb+srv://..."' >> ~/.zshrc
source ~/.zshrc
```

### 3. Run the Visualizer

**Option A: Static HTML files (quick preview)**
```bash
source venv/bin/activate
export MONGODB_URI_PROD="your-connection-string"
python test_visualization.py
# Opens test_map.html and test_heatmap.html in your browser
```

**Option B: Interactive Dashboard (full features)**
```bash
source venv/bin/activate
export MONGODB_URI_PROD="your-connection-string"
python visitor_analytics_visualizer.py
# Navigate to: http://127.0.0.1:8050
# Press Ctrl+C to stop the server
```

## Data Source

**Collection:** `TangoTiempoProd.VisitorTrackingAnalytics`

### Geolocation Sources
1. **Google Geolocation API** (`google_api_lat`, `google_api_long`)
2. **IPInfo.io** (`ipinfo_lat`, `ipinfo_long`)

### Temporal Data
- **UTC/Zulu time:** `visitsByHourZulu`, `visitsByDayOfWeekZulu`
- **Local time:** `visitsByHourLocal`, `visitsByDayOfWeekLocal`

## Troubleshooting

### "MONGODB_URI_PROD environment variable not set"
Make sure you've exported the connection string:
```bash
echo $MONGODB_URI_PROD  # Should print your connection string
```

### "No module named 'pymongo'"
Install dependencies:
```bash
pip install -r requirements.txt
```

### "Connection refused" or "Server selection timeout"
Check your MongoDB connection string and network access.

## Future Enhancements

- [ ] Add UserLoginHistory data (Tab 3)
- [ ] Add UserLoginAnalytics data (Tab 4)
- [ ] Add VisitorTrackingHistory data with filters
- [ ] Convert dot maps to heat maps for high-density areas
- [ ] Add color coding by brands/types
- [ ] Add date range filters
- [ ] Export data to CSV

## Technical Details

- **Framework:** Dash (Plotly)
- **Map Library:** Plotly Scattermapbox (OpenStreetMap)
- **Database:** MongoDB via pymongo
- **Data Processing:** pandas

## Test Results (2025-11-01)

✅ **Successfully tested with PROD data:**
- **226 visitor records** from `TangoTiempoProd.VisitorTrackingAnalytics`
- **361 map points** generated (144 Google API + 217 IPInfo)
- **297 total visits** in time heatmap
- Both visualizations render correctly in browser

---

**Created:** 2025-11-01
**Author:** Fulton (YBOTBOT AI-GUILD)
**Status:** ✅ Tested and Working
