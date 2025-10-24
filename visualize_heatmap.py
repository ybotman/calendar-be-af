#!/usr/bin/env python3
"""
Visitor/Login Traffic Heatmap Visualization

Fetches heatmap data from Analytics_VisitorHeatmap endpoint and creates
a visual heatmap showing Time of Day vs Day of Week traffic patterns.

Usage:
    python visualize_heatmap.py                    # Use production
    python visualize_heatmap.py --local            # Use local dev server
    python visualize_heatmap.py --test             # Use TEST environment
    python visualize_heatmap.py --url <custom-url> # Custom endpoint
"""

import requests
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np
import argparse
from datetime import datetime

# Environment URLs
URLS = {
    'local': 'http://localhost:7071/api/analytics/visitor-heatmap',
    'test': 'https://calendarbeaf-test.azurewebsites.net/api/analytics/visitor-heatmap',
    'prod': 'https://calendarbeaf-prod.azurewebsites.net/api/analytics/visitor-heatmap'
}

DAYS_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

def fetch_heatmap_data(url, time_type='local', include_logins=True, include_visitors=True):
    """Fetch heatmap data from API endpoint."""
    params = {
        'timeType': time_type,
        'includeLogins': str(include_logins).lower(),
        'includeVisitors': str(include_visitors).lower()
    }

    print(f"Fetching data from: {url}")
    print(f"Parameters: {params}")

    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        if not data.get('success'):
            raise Exception(f"API returned error: {data.get('error', 'Unknown error')}")

        return data['data']
    except requests.exceptions.RequestException as e:
        print(f"Error fetching data: {e}")
        raise

def create_heatmap_matrix(heatmap_data):
    """Convert heatmap data to numpy matrix for visualization."""
    matrix = np.zeros((7, 24))

    for day_idx, day in enumerate(DAYS_ORDER):
        if day in heatmap_data:
            matrix[day_idx] = heatmap_data[day]

    return matrix

def visualize_heatmap(data, save_path='heatmap.png', show=True):
    """Create and display/save heatmap visualization."""
    heatmap = data['heatmap']
    totals = data['totals']
    peak = data['peak']
    sources = data['sources']
    metadata = data['metadata']

    # Create matrix
    matrix = create_heatmap_matrix(heatmap)

    # Setup figure
    fig, (ax_main, ax_bar_day, ax_bar_hour) = plt.subplots(
        1, 3,
        figsize=(20, 8),
        gridspec_kw={'width_ratios': [3, 0.3, 0.3]}
    )

    # Main heatmap
    sns.heatmap(
        matrix,
        ax=ax_main,
        cmap='YlOrRd',
        annot=True,
        fmt='.0f',
        cbar_kws={'label': 'Traffic Count'},
        xticklabels=[f'{h}:00' if h % 3 == 0 else '' for h in range(24)],
        yticklabels=DAYS_ORDER,
        linewidths=0.5
    )

    ax_main.set_title(
        f'Visitor/Login Traffic Heatmap - {metadata["timeType"].upper()} Time\n'
        f'Total: {totals["overall"]:,} events | '
        f'Peak: {peak["timestamp"]} ({peak["count"]} events)',
        fontsize=14,
        fontweight='bold'
    )
    ax_main.set_xlabel('Hour of Day', fontsize=12)
    ax_main.set_ylabel('Day of Week', fontsize=12)

    # Day totals bar
    day_totals = [totals['byDay'].get(day, 0) for day in DAYS_ORDER]
    ax_bar_day.barh(range(7), day_totals, color='steelblue')
    ax_bar_day.set_yticks(range(7))
    ax_bar_day.set_yticklabels([])
    ax_bar_day.set_xlabel('Total\nby Day', fontsize=10)
    ax_bar_day.invert_xaxis()

    # Add values on bars
    for i, v in enumerate(day_totals):
        ax_bar_day.text(v/2, i, str(int(v)), ha='center', va='center', fontweight='bold')

    # Hour totals bar
    # Handle both dict and list formats for byHour
    if isinstance(totals['byHour'], dict):
        hour_totals = [totals['byHour'].get(str(h), 0) for h in range(24)]
    else:
        hour_totals = totals['byHour']
    ax_bar_hour.bar(range(24), hour_totals, color='coral')
    ax_bar_hour.set_xticks([])
    ax_bar_hour.set_ylabel('Total by Hour', fontsize=10)
    ax_bar_hour.set_xticklabels([])

    # Rotate for vertical layout
    ax_bar_hour.set_xlim(-0.5, 23.5)

    # Add source information
    info_text = (
        f'Data Sources:\n'
        f'  User Logins: {sources["userLogins"]:,}\n'
        f'  Anonymous Visitors: {sources["anonymousVisitors"]:,}\n'
        f'  Total Events: {sources["total"]:,}\n'
        f'\n'
        f'Generated: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}'
    )

    fig.text(
        0.98, 0.02,
        info_text,
        ha='right',
        va='bottom',
        fontsize=9,
        bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5)
    )

    plt.tight_layout()

    # Save
    plt.savefig(save_path, dpi=300, bbox_inches='tight')
    print(f"\nHeatmap saved to: {save_path}")

    # Show
    if show:
        plt.show()

    plt.close()

def print_summary(data):
    """Print summary statistics."""
    totals = data['totals']
    peak = data['peak']
    sources = data['sources']
    metadata = data['metadata']

    print("\n" + "="*60)
    print("HEATMAP SUMMARY")
    print("="*60)

    print(f"\nTime Type: {metadata['timeType'].upper()}")
    print(f"Data Points: {metadata['dataPoints']:,}")

    print(f"\nSources:")
    print(f"  User Logins:        {sources['userLogins']:>8,}")
    print(f"  Anonymous Visitors: {sources['anonymousVisitors']:>8,}")
    print(f"  Total:              {sources['total']:>8,}")

    print(f"\nPeak Traffic:")
    print(f"  {peak['timestamp']}")
    print(f"  Count: {peak['count']} events")

    print(f"\nBusiest Days:")
    sorted_days = sorted(totals['byDay'].items(), key=lambda x: x[1], reverse=True)
    for day, count in sorted_days[:3]:
        print(f"  {day:12} {count:>6,} events")

    print(f"\nBusiest Hours:")
    # Handle both dict and list formats for byHour
    if isinstance(totals['byHour'], dict):
        sorted_hours = sorted(
            [(int(h), count) for h, count in totals['byHour'].items()],
            key=lambda x: x[1],
            reverse=True
        )
    else:
        # byHour is an array where index = hour
        sorted_hours = sorted(
            [(hour, count) for hour, count in enumerate(totals['byHour'])],
            key=lambda x: x[1],
            reverse=True
        )
    for hour, count in sorted_hours[:5]:
        time_str = f"{hour:02d}:00" if hour < 10 else f"{hour}:00"
        print(f"  {time_str:12} {count:>6,} events")

    print("="*60 + "\n")

def main():
    parser = argparse.ArgumentParser(description='Visualize visitor/login traffic heatmap')
    parser.add_argument('--local', action='store_true', help='Use local dev server')
    parser.add_argument('--test', action='store_true', help='Use TEST environment')
    parser.add_argument('--prod', action='store_true', help='Use PROD environment (default)')
    parser.add_argument('--url', type=str, help='Custom endpoint URL')
    parser.add_argument('--time-type', choices=['local', 'zulu'], default='local', help='Time type')
    parser.add_argument('--no-logins', action='store_true', help='Exclude user logins')
    parser.add_argument('--no-visitors', action='store_true', help='Exclude anonymous visitors')
    parser.add_argument('--output', type=str, default='heatmap.png', help='Output file path')
    parser.add_argument('--no-show', action='store_true', help='Do not display heatmap')

    args = parser.parse_args()

    # Determine URL
    if args.url:
        url = args.url
    elif args.local:
        url = URLS['local']
    elif args.test:
        url = URLS['test']
    else:
        url = URLS['prod']  # Default to production

    # Fetch data
    try:
        data = fetch_heatmap_data(
            url,
            time_type=args.time_type,
            include_logins=not args.no_logins,
            include_visitors=not args.no_visitors
        )
    except Exception as e:
        print(f"\nFailed to fetch data: {e}")
        return 1

    # Print summary
    print_summary(data)

    # Create visualization
    try:
        visualize_heatmap(data, save_path=args.output, show=not args.no_show)
    except Exception as e:
        print(f"\nFailed to create visualization: {e}")
        return 1

    print("Done!")
    return 0

if __name__ == '__main__':
    exit(main())
