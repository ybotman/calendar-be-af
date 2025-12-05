#!/usr/bin/env python3
"""
Test script to verify data and generate sample visualizations
Outputs: test_map.html and test_heatmap.html
"""

import os
import sys
from pymongo import MongoClient
import pandas as pd
import plotly.graph_objects as go

# Configuration
MONGODB_URI = os.getenv('MONGODB_URI_PROD')
DATABASE_NAME = 'TangoTiempoProd'
COLLECTION_NAME = 'VisitorTrackingAnalytics'

# Color scheme
COLORS = {
    'GoogleGeolocation': '#4285F4',  # Google Blue
    'IPInfoIO': '#EA4335',           # Google Red
    'GoogleBrowser': '#34A853',      # Google Green
}

def connect_to_mongodb():
    """Connect to MongoDB and return database instance"""
    if not MONGODB_URI:
        print("ERROR: MONGODB_URI_PROD environment variable not set")
        sys.exit(1)

    try:
        client = MongoClient(MONGODB_URI)
        client.server_info()
        print(f"✅ Connected to MongoDB: {DATABASE_NAME}")
        return client[DATABASE_NAME]
    except Exception as e:
        print(f"❌ MongoDB connection failed: {e}")
        sys.exit(1)

def fetch_visitor_data(db):
    """Fetch all visitor analytics from MongoDB"""
    collection = db[COLLECTION_NAME]
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
    days_order = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    hours = list(range(24))

    heatmap_matrix = pd.DataFrame(0, index=hours, columns=days_order)

    for record in data:
        visits_by_day = record.get('visitsByDayOfWeekLocal') or record.get('visitsByDayOfWeekZulu', {})
        visits_by_hour = record.get('visitsByHourLocal') or record.get('visitsByHourZulu', {})

        total_visits = record.get('totalVisits', 0)
        if total_visits > 0:
            for day_name, count in visits_by_day.items():
                if day_name in days_order:
                    for hour, hour_count in visits_by_hour.items():
                        try:
                            hour_int = int(hour)
                            if 0 <= hour_int < 24:
                                proportion = hour_count / total_visits
                                heatmap_matrix.loc[hour_int, day_name] += count * proportion
                        except (ValueError, KeyError):
                            continue

    print(f"✅ Prepared heatmap data")
    print(f"   Total visits in heatmap: {heatmap_matrix.sum().sum():.0f}")

    return heatmap_matrix

def create_map_figure(df):
    """Create interactive map with geolocation points"""
    fig = go.Figure()

    for source, color in COLORS.items():
        source_df = df[df['source'] == source]
        if not source_df.empty:
            fig.add_trace(go.Scattermapbox(
                lat=source_df['lat'],
                lon=source_df['long'],
                mode='markers',
                marker=dict(size=10, color=color, opacity=0.7),
                name=source,
                text=source_df.apply(lambda row:
                    f"<b>{row['source']}</b><br>" +
                    f"IP: {row['ip']}<br>" +
                    f"Location: {row['city']}, {row['region']}, {row['country']}<br>" +
                    f"Total Visits: {row['total_visits']}",
                    axis=1
                ),
                hoverinfo='text'
            ))

    center_lat = df['lat'].mean()
    center_lon = df['long'].mean()

    fig.update_layout(
        mapbox=dict(
            style='open-street-map',
            center=dict(lat=center_lat, lon=center_lon),
            zoom=3
        ),
        title='Visitor Geolocation Map<br><sub>🔵 Google API | 🔴 IPInfo.io</sub>',
        showlegend=True,
        height=700
    )

    return fig

def create_heatmap_figure(heatmap_df):
    """Create time-of-day vs day-of-week heatmap"""
    heatmap_values = heatmap_df.round(0).astype(int)

    fig = go.Figure(data=go.Heatmap(
        z=heatmap_values.values,
        x=heatmap_df.columns,
        y=heatmap_df.index,
        colorscale='YlOrRd',
        text=heatmap_values.values,
        texttemplate='%{text}',
        textfont={"size": 10},
        hovertemplate='<b>%{x}</b><br>Hour: %{y}:00<br>Visits: %{z}<extra></extra>',
        colorbar=dict(title="Visits")
    ))

    fig.update_layout(
        title='Visitor Traffic Heatmap<br><sub>Time of Day vs Day of Week</sub>',
        xaxis=dict(title='Day of Week', side='bottom'),
        yaxis=dict(
            title='Hour of Day',
            autorange='reversed',
            tickmode='linear',
            tick0=0,
            dtick=1
        ),
        height=700
    )

    return fig

def main():
    print("=" * 60)
    print("Visitor Analytics Test")
    print("=" * 60)

    # Connect to MongoDB
    db = connect_to_mongodb()

    # Fetch data
    visitor_data = fetch_visitor_data(db)

    if not visitor_data:
        print("⚠️  No visitor data found")
        sys.exit(1)

    # Prepare visualizations
    print("\n📊 Preparing visualizations...")
    map_df = prepare_map_data(visitor_data)
    heatmap_df = prepare_heatmap_data(visitor_data)

    # Create figures
    map_fig = create_map_figure(map_df)
    heatmap_fig = create_heatmap_figure(heatmap_df)

    # Save to HTML
    map_fig.write_html('test_map.html')
    heatmap_fig.write_html('test_heatmap.html')

    print("\n✅ HTML files generated:")
    print(f"   - test_map.html ({len(map_df)} points)")
    print(f"   - test_heatmap.html")
    print("\n🌐 Open these files in your browser to view!")
    print("=" * 60)

if __name__ == '__main__':
    main()
