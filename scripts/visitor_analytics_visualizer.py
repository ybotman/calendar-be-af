#!/usr/bin/env python3
"""
Visitor Analytics Visualizer
Visualizes geolocation and temporal patterns from MongoDB VisitorTrackingAnalytics

Requirements:
    pip install pymongo pandas plotly dash

Usage:
    python visitor_analytics_visualizer.py

Environment Variables:
    MONGODB_URI_PROD - MongoDB connection string (TangoTiempoProd database)
"""

import os
import sys
from pymongo import MongoClient
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px
from dash import Dash, dcc, html, Input, Output
import dash_bootstrap_components as dbc

# Configuration
MONGODB_URI = os.getenv('MONGODB_URI_PROD')
DATABASE_NAME = 'TangoTiempoProd'
COLLECTION_NAME = 'VisitorTrackingAnalytics'

# Color scheme
COLORS = {
    'GoogleGeolocation': '#4285F4',  # Google Blue
    'IPInfoIO': '#EA4335',           # Google Red
    'GoogleBrowser': '#34A853',      # Google Green
    'Unknown': '#FBBC04'             # Google Yellow
}

def connect_to_mongodb():
    """Connect to MongoDB and return database instance"""
    if not MONGODB_URI:
        print("ERROR: MONGODB_URI_PROD environment variable not set")
        print("\nPlease set it with:")
        print('  export MONGODB_URI_PROD="mongodb+srv://..."')
        sys.exit(1)

    try:
        client = MongoClient(MONGODB_URI)
        # Test connection
        client.server_info()
        print(f"✅ Connected to MongoDB: {DATABASE_NAME}")
        return client[DATABASE_NAME]
    except Exception as e:
        print(f"❌ MongoDB connection failed: {e}")
        sys.exit(1)

def fetch_visitor_data(db):
    """Fetch all visitor analytics from MongoDB"""
    collection = db[COLLECTION_NAME]

    # Get all documents
    cursor = collection.find({})
    data = list(cursor)

    print(f"✅ Fetched {len(data)} visitor records")
    return data

def prepare_map_data(data):
    """Prepare data for map visualization"""
    map_points = []

    for record in data:
        # Extract Google API geolocation
        if record.get('google_api_lat') and record.get('google_api_long'):
            map_points.append({
                'lat': record['google_api_lat'],
                'long': record['google_api_long'],
                'source': 'GoogleGeolocation',
                'ip': record.get('ip', 'unknown'),
                'visitor_id': record.get('visitor_id', 'N/A'),
                'city': record.get('ipinfo_city', 'Unknown'),
                'region': record.get('ipinfo_region', 'Unknown'),
                'country': record.get('ipinfo_country', 'Unknown'),
                'total_visits': record.get('totalVisits', 0)
            })

        # Extract IPInfo geolocation
        if record.get('ipinfo_lat') and record.get('ipinfo_long'):
            map_points.append({
                'lat': record['ipinfo_lat'],
                'long': record['ipinfo_long'],
                'source': 'IPInfoIO',
                'ip': record.get('ip', 'unknown'),
                'visitor_id': record.get('visitor_id', 'N/A'),
                'city': record.get('ipinfo_city', 'Unknown'),
                'region': record.get('ipinfo_region', 'Unknown'),
                'country': record.get('ipinfo_country', 'Unknown'),
                'total_visits': record.get('totalVisits', 0)
            })

    df = pd.DataFrame(map_points)
    print(f"✅ Prepared {len(df)} map points")
    print(f"   - Google API points: {len(df[df['source'] == 'GoogleGeolocation'])}")
    print(f"   - IPInfo points: {len(df[df['source'] == 'IPInfoIO'])}")

    return df

def prepare_heatmap_data(data):
    """Prepare data for time-of-day vs day-of-week heatmap"""
    # Days of week in correct order
    days_order = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    hours = list(range(24))

    # Initialize heatmap matrix (24 hours x 7 days)
    heatmap_matrix = pd.DataFrame(0, index=hours, columns=days_order)

    # Aggregate visit counts from all records
    for record in data:
        # Use Local time if available, otherwise fall back to Zulu time
        visits_by_day = record.get('visitsByDayOfWeekLocal') or record.get('visitsByDayOfWeekZulu', {})
        visits_by_hour = record.get('visitsByHourLocal') or record.get('visitsByHourZulu', {})

        # For simplicity, we'll use the aggregated hour/day counts
        # Note: This is a simplified approach - each record represents a unique visitor's aggregated stats
        for day_name, count in visits_by_day.items():
            if day_name in days_order:
                # Distribute visits evenly across hours (simplified for now)
                # In a real scenario, you'd need to correlate hour and day from raw history
                total_visits = record.get('totalVisits', 0)
                if total_visits > 0:
                    for hour, hour_count in visits_by_hour.items():
                        try:
                            hour_int = int(hour)
                            if 0 <= hour_int < 24:
                                # Proportional distribution
                                proportion = hour_count / total_visits
                                heatmap_matrix.loc[hour_int, day_name] += count * proportion
                        except (ValueError, KeyError):
                            continue

    print(f"✅ Prepared heatmap data")
    print(f"   Total visits in heatmap: {heatmap_matrix.sum().sum():.0f}")

    return heatmap_matrix

def create_map_figure(df):
    """Create interactive map with geolocation points"""
    if df.empty:
        # Return empty figure
        return go.Figure().add_annotation(
            text="No geolocation data available",
            xref="paper", yref="paper",
            x=0.5, y=0.5, showarrow=False,
            font=dict(size=20)
        )

    fig = go.Figure()

    # Add points for each geolocation source
    for source, color in COLORS.items():
        source_df = df[df['source'] == source]
        if not source_df.empty:
            fig.add_trace(go.Scattermapbox(
                lat=source_df['lat'],
                lon=source_df['long'],
                mode='markers',
                marker=dict(
                    size=10,
                    color=color,
                    opacity=0.7
                ),
                name=source,
                text=source_df.apply(lambda row:
                    f"<b>{row['source']}</b><br>" +
                    f"IP: {row['ip']}<br>" +
                    f"Visitor: {row['visitor_id'][:8] if row['visitor_id'] != 'N/A' else 'N/A'}...<br>" +
                    f"Location: {row['city']}, {row['region']}, {row['country']}<br>" +
                    f"Total Visits: {row['total_visits']}",
                    axis=1
                ),
                hoverinfo='text'
            ))

    # Calculate map center (average of all points)
    center_lat = df['lat'].mean()
    center_lon = df['long'].mean()

    fig.update_layout(
        mapbox=dict(
            style='open-street-map',
            center=dict(lat=center_lat, lon=center_lon),
            zoom=3
        ),
        title=dict(
            text='Visitor Geolocation Map<br><sub>Color by Data Source</sub>',
            x=0.5,
            xanchor='center'
        ),
        showlegend=True,
        height=700,
        margin=dict(l=0, r=0, t=60, b=0)
    )

    return fig

def create_heatmap_figure(heatmap_df):
    """Create time-of-day vs day-of-week heatmap"""
    if heatmap_df.empty or heatmap_df.sum().sum() == 0:
        # Return empty figure
        return go.Figure().add_annotation(
            text="No temporal data available",
            xref="paper", yref="paper",
            x=0.5, y=0.5, showarrow=False,
            font=dict(size=20)
        )

    # Convert to integers for display
    heatmap_values = heatmap_df.round(0).astype(int)

    fig = go.Figure(data=go.Heatmap(
        z=heatmap_values.values,
        x=heatmap_df.columns,  # Days of week
        y=heatmap_df.index,     # Hours of day (0-23)
        colorscale='YlOrRd',
        text=heatmap_values.values,
        texttemplate='%{text}',
        textfont={"size": 10},
        hovertemplate='<b>%{x}</b><br>Hour: %{y}:00<br>Visits: %{z}<extra></extra>',
        colorbar=dict(title="Visits")
    ))

    fig.update_layout(
        title=dict(
            text='Visitor Traffic Heatmap<br><sub>Time of Day vs Day of Week</sub>',
            x=0.5,
            xanchor='center'
        ),
        xaxis=dict(title='Day of Week', side='bottom'),
        yaxis=dict(
            title='Hour of Day',
            autorange='reversed',  # 0 at top, 23 at bottom
            tickmode='linear',
            tick0=0,
            dtick=1
        ),
        height=700,
        margin=dict(l=100, r=50, t=100, b=50)
    )

    return fig

def create_dash_app(map_fig, heatmap_fig):
    """Create Dash application with tabs"""
    app = Dash(__name__, external_stylesheets=[dbc.themes.BOOTSTRAP])

    app.layout = dbc.Container([
        html.H1("Visitor Analytics Dashboard", className="text-center my-4"),
        html.Hr(),

        dbc.Tabs([
            dbc.Tab(
                dcc.Graph(id='map', figure=map_fig),
                label='📍 Geolocation Map',
                tab_id='map-tab'
            ),
            dbc.Tab(
                dcc.Graph(id='heatmap', figure=heatmap_fig),
                label='🔥 Time Heatmap',
                tab_id='heatmap-tab'
            ),
        ], id='tabs', active_tab='map-tab'),

        html.Hr(),
        html.Div([
            html.P("Data Source: TangoTiempoProd.VisitorTrackingAnalytics", className="text-muted text-center"),
            html.P("🔵 Google API  🔴 IPInfo.io", className="text-center")
        ])
    ], fluid=True)

    return app

def main():
    """Main execution"""
    print("=" * 60)
    print("Visitor Analytics Visualizer")
    print("=" * 60)

    # Connect to MongoDB
    db = connect_to_mongodb()

    # Fetch data
    visitor_data = fetch_visitor_data(db)

    if not visitor_data:
        print("⚠️  No visitor data found in collection")
        sys.exit(1)

    # Prepare visualizations
    print("\n📊 Preparing visualizations...")
    map_df = prepare_map_data(visitor_data)
    heatmap_df = prepare_heatmap_data(visitor_data)

    # Create figures
    map_fig = create_map_figure(map_df)
    heatmap_fig = create_heatmap_figure(heatmap_df)

    # Create Dash app
    print("\n🚀 Starting Dash application...")
    print("📍 Open browser to: http://127.0.0.1:8050")
    print("   Press Ctrl+C to stop")
    print("=" * 60)

    app = create_dash_app(map_fig, heatmap_fig)
    app.run_server(debug=True, host='127.0.0.1', port=8050)

if __name__ == '__main__':
    main()
