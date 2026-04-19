/**
 * ========================================
 * MAIN APPLICATION MODULE
 * ========================================
 * 
 * This is the heart of the app - it orchestrates user interactions,
 * manages the UI state, and coordinates between the user interface
 * and the routing engine. It's organized around user flows:
 * 1. User enters start/end location
 * 2. User selects preferences (what to stop for)
 * 3. App plans the route with POIs
 * 4. Results are displayed to user
 */

import { 
  geocodeLocation, 
  drawRoute, 
  getPOIsAlongRoute, 
  getRouteStats,
  clearRoute
} from './routeOptimizer.js';

/**
 * ========== UI ELEMENT REFERENCES ==========
 * We grab all the DOM elements we'll interact with upfront
 * This is faster than document.getElementById every time and cleaner
 */
const elements = {
  // Input fields
  startInput: document.getElementById('startInput'),
  endInput: document.getElementById('endInput'),
  openPreferencesBtn: document.getElementById('openPreferencesBtn'),
  
  // Modal for preferences
  preferencesModal: document.getElementById('preferencesModal'),
  closeModalBtn: document.getElementById('closeModalBtn'),
  confirmPreferencesBtn: document.getElementById('confirmPreferencesBtn'),
  preferenceCheckboxes: document.querySelectorAll('input[name="preferences"]'),
  
  // Route display
  routeSummary: document.getElementById('routeSummary'),
  totalDistance: document.getElementById('totalDistance'),
  estimatedTime: document.getElementById('estimatedTime'),
  waypointCount: document.getElementById('waypointCount'),
  clearRouteBtn: document.getElementById('clearRouteBtn'),
  
  // Waypoints list
  waypointsList: document.getElementById('waypointsList'),
  waypointsContainer: document.getElementById('waypointsContainer'),
  
  // Loading overlay
  loadingOverlay: document.getElementById('loadingOverlay'),
  
  // Map info
  mapInfoOverlay: document.getElementById('mapInfoOverlay'),
  currentDistance: document.getElementById('currentDistance'),
  waypointsInfo: document.getElementById('waypointsInfo'),
  
  // Toast notifications
  toastContainer: document.getElementById('toastContainer')
};

/**
 * ========== APP STATE ==========
 * Keep track of what's happening in the app
 * This helps us know when to show/hide elements, what's being processed, etc.
 */
const appState = {
  selectedPreferences: [],
  currentRoute: null,
  currentWaypoints: [],
  isLoading: false
};

/**
 * ========== EVENT LISTENERS ==========
 * These set up the main user interaction flows
 */
elements.openPreferencesBtn.addEventListener('click', openPreferencesModal);
elements.closeModalBtn.addEventListener('click', closePreferencesModal);
elements.confirmPreferencesBtn.addEventListener('click', handleConfirmPreferences);
elements.clearRouteBtn.addEventListener('click', handleClearRoute);

// Listen for Enter key in input fields to quickly plan routes
elements.startInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') elements.endInput.focus();
});

elements.endInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') elements.openPreferencesBtn.click();
});

/**
 * ========== PREFERENCE MODAL FLOW ==========
 * Users click "Select Your Preferences" → modal opens → they check boxes → confirm
 * This replaces the old dropdown with a more visual, flexible interface
 */

function openPreferencesModal() {
  // Validate that user entered both locations before asking for preferences
  if (!elements.startInput.value.trim() || !elements.endInput.value.trim()) {
    showToast('Please enter both start and end locations', 'error');
    return;
  }

  // Show the modal with a nice animation
  elements.preferencesModal.classList.remove('hidden');
}

function closePreferencesModal() {
  // Hide the modal - animation handles the visual effect
  elements.preferencesModal.classList.add('hidden');
}

/**
 * Handle when user clicks "Confirm & Plan Route"
 * This is where the magic happens - we gather inputs and kick off the routing process
 */
async function handleConfirmPreferences() {
  // Collect which preferences the user selected
  const selectedPrefs = Array.from(elements.preferenceCheckboxes)
    .filter(checkbox => checkbox.checked)
    .map(checkbox => checkbox.value);

  // Store them in state so we can reference later if needed
  appState.selectedPreferences = selectedPrefs;

  // Close the modal before we start heavy processing
  closePreferencesModal();

  // Now kick off the route planning!
  await planRoute(
    elements.startInput.value.trim(),
    elements.endInput.value.trim(),
    selectedPrefs
  );
}

/**
 * ========== MAIN ROUTING FLOW ==========
 * This orchestrates the entire "plan a route" process:
 * 1. Show loading state
 * 2. Geocode start and end locations
 * 3. Calculate route
 * 4. Find POIs along the route
 * 5. Display results
 * 6. Handle any errors gracefully
 */

async function planRoute(startLocation, endLocation, preferences) {
  try {
    // Show loading overlay so user knows something is happening
    showLoading(true);

    // Step 1: Convert location names to coordinates
    // This is why we need HERE's geocoding service
    const [startCoords, endCoords] = await Promise.all([
      geocodeLocation(startLocation),
      geocodeLocation(endLocation)
    ]);

    // If either location couldn't be found, tell the user and bail out
    if (!startCoords) {
      showToast(`Could not find location: "${startLocation}"`, 'error');
      showLoading(false);
      return;
    }

    if (!endCoords) {
      showToast(`Could not find location: "${endLocation}"`, 'error');
      showLoading(false);
      return;
    }

    // Step 2: Calculate the best route
    const route = await drawRoute(startCoords, endCoords);
    appState.currentRoute = route;

    // Step 3: Find POIs along the route (restaurants, gas, etc.)
    let waypoints = [];
    if (preferences.length > 0) {
      waypoints = await getPOIsAlongRoute(route, preferences);
      appState.currentWaypoints = waypoints;
    }

    // Step 4: Display the results to the user
    displayRouteResults(route, waypoints);

    // Success! Let the user know
    showToast('Route planned successfully!', 'success');

  } catch (error) {
    console.error('Route planning error:', error);
    showToast('Failed to plan route. Please try again.', 'error');
  } finally {
    // Hide loading overlay whether it succeeded or failed
    showLoading(false);
  }
}

/**
 * Display the results after route is calculated
 * Shows distance, time, waypoints list, and updates map display
 */
function displayRouteResults(route, waypoints) {
  // Get useful statistics from the route
  const stats = getRouteStats(route);

  // Update the summary section with route details
  elements.totalDistance.textContent = `${stats.distance} km`;
  elements.estimatedTime.textContent = `${stats.time} hours`;
  elements.waypointCount.textContent = waypoints.length;

  // Show the summary section (it's hidden by default)
  elements.routeSummary.classList.remove('hidden');

  // Update the map info overlay too
  elements.currentDistance.textContent = `${stats.distance} km`;
  elements.waypointsInfo.textContent = waypoints.length;
  elements.mapInfoOverlay.classList.remove('hidden');

  // Display the waypoints list
  displayWaypoints(waypoints);
}

/**
 * Render the list of waypoints/stops the user can make along the route
 * Organized by category so the user knows what each stop is
 */
function displayWaypoints(waypoints) {
  // Clear existing list
  elements.waypointsContainer.innerHTML = '';

  if (waypoints.length === 0) {
    // If no waypoints, hide the list section entirely
    elements.waypointsList.classList.add('hidden');
    return;
  }

  // Show the waypoints section
  elements.waypointsList.classList.remove('hidden');

  // Create a list item for each waypoint
  waypoints.forEach((waypoint, index) => {
    const listItem = document.createElement('li');
    listItem.className = 'waypoint-item';
    
    // Format the waypoint with category emoji, name, and distance
    const categoryEmoji = getCategoryEmoji(waypoint.category);
    const distanceText = waypoint.distance ? ` (${(waypoint.distance / 1000).toFixed(1)} km)` : '';
    
    listItem.innerHTML = `
      <span class="waypoint-name">${categoryEmoji} ${waypoint.name}</span>
      <span class="waypoint-distance">${waypoint.category}${distanceText}</span>
    `;

    // Add slight delay to each item for a cascading animation effect
    listItem.style.animationDelay = `${index * 0.05}s`;
    
    elements.waypointsContainer.appendChild(listItem);
  });
}

/**
 * Get an emoji to represent each POI category
 * Helps users quickly scan and understand what each stop offers
 */
function getCategoryEmoji(category) {
  const emojiMap = {
    'restaurant': '🍽️',
    'petrol-station': '⛽',
    'hospital': '🏥',
    'atm': '🏦',
    'hotel': '🏨',
    'shopping': '🛍️'
  };
  return emojiMap[category] || '📍';
}

/**
 * Handle when user wants to start over
 */
function handleClearRoute() {
  // Clear everything from state and UI
  clearRoute(); // This clears the map
  appState.currentRoute = null;
  appState.currentWaypoints = [];
  appState.selectedPreferences = [];

  // Uncheck all preference checkboxes
  elements.preferenceCheckboxes.forEach(checkbox => checkbox.checked = false);

  // Hide all the results panels
  elements.routeSummary.classList.add('hidden');
  elements.waypointsList.classList.add('hidden');
  elements.mapInfoOverlay.classList.add('hidden');

  // Clear input fields and focus on start location
  elements.startInput.value = '';
  elements.endInput.value = '';
  elements.startInput.focus();

  showToast('Route cleared. Ready to plan a new trip!', 'info');
}

/**
 * ========== UI HELPER FUNCTIONS ==========
 * These manage loading states, notifications, and other visual feedback
 */

/**
 * Show/hide the loading overlay
 * We use this while geocoding and routing, so the user knows something is happening
 */
function showLoading(show) {
  appState.isLoading = show;
  if (show) {
    elements.loadingOverlay.classList.remove('hidden');
  } else {
    elements.loadingOverlay.classList.add('hidden');
  }
}

/**
 * Show a toast notification to the user
 * These are quick, non-blocking messages like "Route planned!" or error alerts
 * 
 * Strategy: We show toasts in the bottom-right. Multiple toasts stack vertically.
 * Success messages are green, errors are red, info is blue.
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  // Add to the toast container
  elements.toastContainer.appendChild(toast);

  // Remove the toast after 4 seconds
  // The CSS animation handles the visual disappearing effect
  setTimeout(() => {
    toast.style.animation = 'slideInRight 0.3s ease-out reverse';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/**
 * ========== INITIALIZATION ==========
 * Run when the page loads
 */
document.addEventListener('DOMContentLoaded', () => {
  // Focus on start input so user can start typing right away
  elements.startInput.focus();

  // Show a welcome message
  showToast('Welcome to Smart Road Trip Planner! 🚗', 'info');
});

/**
 * Export functions for potential external use or testing
 */
export { planRoute, displayWaypoints, appState };
