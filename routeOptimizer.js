/**
 * ========================================
 * ROUTE OPTIMIZER MODULE
 * ========================================
 * 
 * This module handles all routing logic, POI searching, and map interactions.
 * It's built with a functional, promise-based approach to keep async operations clean.
 * We use debouncing and rate limiting to avoid hammering the HERE API unnecessarily.
 */

/**
 * Initialize the HERE Maps platform and services
 * These are the core services we'll use throughout the app for:
 * - Routing calculations (finding paths between two points)
 * - Geocoding (converting addresses to coordinates)
 * - POI searching (finding restaurants, gas stations, etc.)
 */
const platform = new H.service.Platform({
  apikey: 'YOUR_HERE_API_KEY'
});

// Create map layers (we use the default HERE vector layers for clean, modern look)
const maptypes = platform.createDefaultLayers();

// Initialize the map at a default location
// Using a standard map size that fills its container, with Bangalore as the starting point
const map = new H.Map(
  document.getElementById('mapContainer'),
  maptypes.vector.normal.map,
  {
    zoom: 13,
    center: { lat: 12.9716, lng: 77.5946 },
    pixelRatio: window.devicePixelRatio || 1
  }
);

// Enable user interactions: panning, zooming, etc.
// The Behavior object handles touch/mouse events automatically
const behavior = new H.mapevents.Behavior(new H.mapevents.MapEvents(map));

// Add default UI controls (zoom buttons, copyright info, etc.)
const ui = H.ui.UI.createDefault(map, maptypes);

// Get routing and search services
const router = platform.getRoutingService(null, 8);
const searchService = platform.getSearchService();

/**
 * State management for the current route
 * We keep track of the active route so we can update it,
 * display waypoints, and calculate distances
 */
let currentRoute = null;
let routePolyline = null;
let waypointMarkers = [];

/**
 * Debouncing wrapper - prevents spamming API calls
 * Use case: When user is dragging the map or typing quickly,
 * we don't want to fire off 50 API requests. This waits until
 * they've stopped for a moment before executing.
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Convert a location name (like "VIT Vellore") into coordinates
 * This is essential because we need lat/lng for everything the API does
 * We return the first result since users typically search for well-known places
 */
export async function geocodeLocation(query) {
  return new Promise((resolve, reject) => {
    // Using HERE's geocoding service to find the location
    searchService.geocode({ q: query }, (result) => {
      if (result.items && result.items.length > 0) {
        // Extract lat/lng from the first result
        const position = result.items[0].position;
        resolve({ lat: position.lat, lng: position.lng });
      } else {
        // Resolve with null instead of rejecting - cleaner error handling upstream
        resolve(null);
      }
    }, (error) => {
      console.error('Geocoding error:', error);
      reject(error);
    });
  });
}

/**
 * Draw a route between two points on the map
 * This calculates the optimal driving route and visualizes it with a polyline
 */
export async function drawRoute(start, end) {
  return new Promise((resolve, reject) => {
    // Remove the old route if one exists (clean slate for new route)
    if (routePolyline) {
      map.removeObject(routePolyline);
    }

    // Configure the routing request
    // We use "fast" mode to prioritize speed over scenic routes
    // "car" is the transport mode - could be walk, bike, etc.
    const routeParams = {
      routingMode: 'fast',
      transportMode: 'car',
      origin: `${start.lat},${start.lng}`,
      destination: `${end.lat},${end.lng}`,
      return: 'polyline,summary'
    };

    // Call the routing service
    router.calculateRoute(routeParams, (result) => {
      if (result.routes && result.routes.length > 0) {
        const route = result.routes[0];

        // Convert the flexible polyline (compact format) into lat/lng points
        // This is used both for visualization and for finding nearby POIs
        const linestring = H.geo.LineString.fromFlexiblePolyline(route.sections[0].polyline);

        // Create a visual line on the map to show the route
        // Grey color (#555555) with clean thickness
        routePolyline = new H.map.Polyline(linestring, {
          style: {
            strokeColor: '#555555',
            lineWidth: 5,
            lineDash: [0]
          }
        });

        map.addObject(routePolyline);

        // Zoom the map to show the entire route
        // getBoundingBox() automatically calculates the area needed to show all points
        map.getViewModel().setLookAtData({ 
          bounds: routePolyline.getBoundingBox(),
          padding: { top: 100, left: 100, bottom: 100, right: 100 }
        });

        // Store the route for later use (waypoint searching, distance calc, etc.)
        currentRoute = route;
        resolve(route);
      } else {
        reject(new Error('No route found between these locations'));
      }
    }, reject);
  });
}

/**
 * Find Points of Interest (restaurants, gas stations, etc.) along the route
 * Strategy: Sample the route at regular intervals and search around each point
 * This gives us good coverage without being too computationally expensive
 */
export async function getPOIsAlongRoute(route, categories) {
  // If no categories selected, nothing to search for
  if (!categories || categories.length === 0) {
    return [];
  }

  // Clear existing waypoint markers
  waypointMarkers.forEach(marker => map.removeObject(marker));
  waypointMarkers = [];

  // Extract all lat/lng points from the route polyline
  const linestring = H.geo.LineString.fromFlexiblePolyline(route.sections[0].polyline);
  const points = linestring.getLatLngAltArray();

  const foundPOIs = [];
  const searchInterval = 10; // Sample every 10th point to space out searches

  /**
   * Create search promises for each point along the route
   * We use Promise.all so all searches happen in parallel (faster)
   * instead of waiting for each one to complete before starting the next
   */
  const searchPromises = [];

  for (let i = 0; i < points.length; i += searchInterval) {
    const lat = points[i];
    const lng = points[i + 1];

    // For each category the user wants, search at this location
    // This will find restaurants, gas stations, etc. near this point
    for (const category of categories) {
      const promise = new Promise((resolve) => {
        searchService.browse({
          at: `${lat},${lng}`,
          categories: [category],
          limit: 2 // Only get 2 results per location to avoid clutter
        }, (result) => {
          if (result.items) {
            result.items.forEach((item) => {
              // Store this POI for later reference
              foundPOIs.push({
                name: item.title,
                position: item.position,
                distance: item.distance || 0,
                category: category
              });

              // Add a visual marker to the map
              // Using different marker styles would be nice, but HERE has limited options
              const marker = new H.map.Marker(item.position, {
                icon: createMarkerIcon(category)
              });
              
              map.addObject(marker);
              waypointMarkers.push(marker);
            });
          }
          resolve();
        }, () => resolve()); // Silently fail if search doesn't find results
      });

      searchPromises.push(promise);
    }
  }

  // Wait for all searches to complete, then return the results
  await Promise.all(searchPromises);
  return foundPOIs;
}

/**
 * Create a simple marker for different POI types
 * Uses a clean, minimal design with subtle styling
 */
function createMarkerIcon(category) {
  // Simple SVG circle marker for all categories
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="15" fill="#555555" stroke="#f5f5f5" stroke-width="2"/>
      <circle cx="16" cy="16" r="7" fill="#f5f5f5"/>
    </svg>
  `;

  return new H.map.Icon(svg);
}

/**
 * Calculate useful statistics about the route
 * Returns distance in km and estimated travel time in hours
 */
export function getRouteStats(route) {
  if (!route || !route.sections) {
    return { distance: 0, time: 0 };
  }

  // HERE's API returns distance in meters and time in seconds
  // Convert to more readable units
  const distance = route.sections.reduce((sum, section) => sum + section.summary.distance, 0) / 1000;
  const time = route.sections.reduce((sum, section) => sum + section.summary.duration, 0) / 3600;

  return { 
    distance: distance.toFixed(1), 
    time: time.toFixed(1) 
  };
}

/**
 * Clear all route visualization from the map
 * Useful for starting fresh or letting users change their route
 */
export function clearRoute() {
  if (routePolyline) {
    map.removeObject(routePolyline);
    routePolyline = null;
  }

  waypointMarkers.forEach(marker => map.removeObject(marker));
  waypointMarkers = [];

  currentRoute = null;
}
