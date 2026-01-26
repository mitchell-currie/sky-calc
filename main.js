// Swiss Ephemeris for accurate astronomical calculations
import SwissEph from 'https://cdn.jsdelivr.net/gh/prolaxu/swisseph-wasm@main/src/swisseph.js';
import { CELESTIAL_EVENTS } from './eclipse-data.js';

let swe = null;
let sweInitialized = false;

// Initialize Swiss Ephemeris (called before app starts)
async function initSwissEph() {
    try {
        swe = new SwissEph();
        await swe.initSwissEph();
        sweInitialized = true;
        console.log('Swiss Ephemeris initialized successfully');
    } catch (error) {
        console.error('Failed to initialize Swiss Ephemeris:', error);
    }
}

// Constants
const EARTH_RADIUS = 6000;  // Large radius for realistic horizon scale

// Other celestial objects
const STAR_DISTANCE = EARTH_RADIUS * 100;  // Stars on celestial sphere

// Moon constants (relative to Earth)
const MOON_RADIUS_RATIO = 1737.4 / 6371;  // Moon radius / Earth radius = 0.2727
const MOON_RADIUS = EARTH_RADIUS * MOON_RADIUS_RATIO;  // ~1636 scene units
const AU_TO_EARTH_RADII = 149597870.7 / 6371;  // AU to Earth radii conversion
const OBLIQUITY_RAD = 23.439 * Math.PI / 180;  // Earth's axial tilt

// Sun constants (visual representation - not real distance)
const SUN_VISUAL_DISTANCE = EARTH_RADIUS * 1000;  // Place sun at fixed distance (far beyond moon orbit)
const SUN_ANGULAR_DIAMETER_RAD = 0.53 * Math.PI / 180;  // Sun's angular diameter in radians
const SUN_VISUAL_RADIUS = SUN_VISUAL_DISTANCE * Math.tan(SUN_ANGULAR_DIAMETER_RAD / 2);  // ~462 scene units

// Real astronomical values for eclipse calculations (in km)
const SUN_RADIUS_KM = 696000;
const MOON_RADIUS_KM = 1737.4;
const EARTH_RADIUS_KM = 6371;
const AU_KM = 149597870.7;

// Eclipse cone meshes
let umbraCone = null;
let penumbraCone = null;
let antumbraCone = null;

// Scene, camera, renderer
let scene, camera, renderer;
let earth;
let moonMesh = null;  // Moon sphere mesh
let moonDebugLine = null;  // Red debug line from moon to Earth center
let lastMoonUpdateTime = 0;  // Cache moon position updates
let sunMesh = null;  // Sun sphere mesh
let sunDebugLine = null;  // Green debug line from sun to Earth center
let lastSunUpdateTime = 0;  // Cache sun position updates
let mapMaterial;  // Reference to map shader material for updating focus highlight
let earthMaterial;  // Reference to Earth material for updating sunDirection uniform
let earthFillMaterial;  // Solid fill sphere material (controlled by ocean color/opacity)
let starField; // Background stars
let constellationLines;  // Constellation line drawings
let sunLight;  // Directional light from sun
let focusMarker;  // Marker at camera focus point
let referenceCube;  // Debug cube at Earth center

// View zoom button state
let toggleViewZoomBtn = null;
let isZoomedOut = false;

// Grid lines (equator, meridian, polar axis)
let equatorLine = null;
let primeMeridianLine = null;
let northAxisMesh = null;
let southAxisMesh = null;

// City visibility toggles
let cityLabelsVisible = true;
let citySpheresVisible = true;

// City colors (matched to beam colors)
let sunCityColor = '#ffdd44';   // Default sun beam color
let moonCityColor = '#8899ff';  // Default moon beam color

// Time control - offset in minutes from current time
let timeOffsetMinutes = 0;
let isLiveMode = true;
let selectedDate = null; // null = today, otherwise Date object for selected day
let calendarViewDate = new Date(); // Month being viewed in calendar

// Simulation control
let isSimulating = false;
let isPaused = false; // Time is paused
let isSliderDragging = false; // User is dragging the time slider
let simulationDirection = 1; // 1 for forward, -1 for reverse
let simulationSpeed = 30; // Speed multiplier
// Speeds in minutes per second: 1/60 = real-time (1m/m), then faster options
const SIMULATION_SPEEDS = [1/60, 1, 2, 5, 10, 30, 60, 120, 300, 1440, 2880, 10080, 43200];
let simulationSpeedIndex = 0; // Start at real-time (1m/m)
let lastSimulationTime = 0;

// Scroll wheel picker system
const scrollWheels = {};
const WHEEL_ITEM_HEIGHT = 26; // pixels per item

/**
 * Initialize a scroll wheel for time/date picking
 */
function initScrollWheel(wheelId, config) {
    const element = document.getElementById(wheelId);
    if (!element) return null;

    const viewport = element.querySelector('.wheel-viewport');
    const track = element.querySelector('.wheel-track');
    const items = track.querySelectorAll('.wheel-item');

    const wheel = {
        element,
        viewport,
        track,
        items: Array.from(items),
        target: element.dataset.target,
        config,
        currentIndex: 0,
        scrollOffset: 0,
        isDragging: false,
        dragStartY: 0,
        dragStartOffset: 0,
        velocity: 0,
        lastDragY: 0,
        lastDragTime: 0,
        animationId: null
    };

    // Render initial state
    updateWheelDisplay(wheel);

    // Mouse wheel scrolling
    viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const delta = Math.sign(e.deltaY);
        changeWheelValue(wheel, delta);
    }, { passive: false });

    // Mouse drag
    viewport.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startDrag(wheel, e.clientY);
    });

    // Touch drag
    viewport.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            startDrag(wheel, e.touches[0].clientY);
        }
    }, { passive: true });

    // Click on peek items
    items.forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const offset = parseInt(item.dataset.offset);
            if (offset !== 0) {
                changeWheelValue(wheel, offset);
            }
        });
    });

    scrollWheels[wheelId] = wheel;
    return wheel;
}

function startDrag(wheel, clientY) {
    wheel.isDragging = true;
    wheel.dragStartY = clientY;
    wheel.dragStartOffset = wheel.scrollOffset;
    wheel.lastDragY = clientY;
    wheel.lastDragTime = performance.now();
    wheel.velocity = 0;
    wheel.element.classList.add('dragging');

    if (wheel.animationId) {
        cancelAnimationFrame(wheel.animationId);
        wheel.animationId = null;
    }

    const onMove = (e) => {
        if (!wheel.isDragging) return;
        const y = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
        const delta = wheel.dragStartY - y;
        const now = performance.now();
        const dt = now - wheel.lastDragTime;

        if (dt > 0) {
            wheel.velocity = (wheel.lastDragY - y) / dt;
        }
        wheel.lastDragY = y;
        wheel.lastDragTime = now;

        wheel.scrollOffset = wheel.dragStartOffset + delta / WHEEL_ITEM_HEIGHT;
        updateWheelVisual(wheel);
    };

    const onEnd = () => {
        if (!wheel.isDragging) return;
        wheel.isDragging = false;
        wheel.element.classList.remove('dragging');

        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);

        // Snap to nearest value with momentum
        snapWheel(wheel);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd);
}

function snapWheel(wheel) {
    // Convert velocity from pixels/ms to items/ms, then scale for momentum
    const momentumVelocity = wheel.velocity / WHEEL_ITEM_HEIGHT * 15;

    // If velocity is significant, do momentum scrolling
    if (Math.abs(momentumVelocity) > 0.5) {
        animateWheelMomentum(wheel, momentumVelocity);
    } else {
        // Just snap to nearest
        finalizeWheelSnap(wheel);
    }
}

function animateWheelMomentum(wheel, velocity) {
    const friction = 0.92; // Deceleration factor per frame
    const minVelocity = 0.08; // Stop threshold
    let lastTime = performance.now();
    let currentVelocity = velocity;

    const animate = () => {
        const now = performance.now();
        const dt = Math.min(now - lastTime, 32); // Cap delta time
        lastTime = now;

        // Apply velocity
        wheel.scrollOffset += currentVelocity * dt / 16;

        // Check if we've crossed an integer boundary and need to apply change
        while (wheel.scrollOffset >= 1) {
            wheel.scrollOffset -= 1;
            applyWheelChange(wheel, 1);
        }
        while (wheel.scrollOffset <= -1) {
            wheel.scrollOffset += 1;
            applyWheelChange(wheel, -1);
        }

        updateWheelVisual(wheel);

        // Apply friction
        currentVelocity *= friction;

        // Continue or finalize
        if (Math.abs(currentVelocity) > minVelocity) {
            wheel.animationId = requestAnimationFrame(animate);
        } else {
            finalizeWheelSnap(wheel);
        }
    };

    wheel.animationId = requestAnimationFrame(animate);
}

function finalizeWheelSnap(wheel) {
    // Snap to nearest integer position
    const targetOffset = Math.round(wheel.scrollOffset);

    if (targetOffset !== 0) {
        applyWheelChange(wheel, targetOffset);
        wheel.scrollOffset -= targetOffset;
    }

    // Animate remaining fractional offset to 0
    animateWheelToZero(wheel);
}

function animateWheelToZero(wheel) {
    const duration = 120;
    const startTime = performance.now();
    const from = wheel.scrollOffset;

    const animate = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // ease out cubic

        wheel.scrollOffset = from * (1 - eased);
        updateWheelVisual(wheel);

        if (progress < 1) {
            wheel.animationId = requestAnimationFrame(animate);
        } else {
            wheel.scrollOffset = 0;
            wheel.animationId = null;
        }
    };

    wheel.animationId = requestAnimationFrame(animate);
}

function changeWheelValue(wheel, delta) {
    applyWheelChange(wheel, delta);
    // Display is updated via the applyDateTimeFromWheels -> updatePositionDisplay -> updateWheelsFromTime chain
}

function applyWheelChange(wheel, delta) {
    const config = wheel.config;
    let newIndex = wheel.currentIndex + delta;

    // Wrap around for cyclic values
    if (config.cyclic) {
        // Use dynamicMax if set, otherwise use full values length
        const len = (config.dynamicMax !== undefined) ? config.dynamicMax + 1 : config.values.length;
        newIndex = ((newIndex % len) + len) % len;
    } else {
        // Clamp for non-cyclic (year)
        newIndex = Math.max(config.min || 0, Math.min(config.max || config.values.length - 1, newIndex));
    }

    wheel.currentIndex = newIndex;

    // Trigger time update
    applyDateTimeFromWheels();
}

function updateWheelDisplay(wheel) {
    const config = wheel.config;
    const current = wheel.currentIndex;
    const values = config.values;
    // Use dynamicMax for cyclic wheels if set, otherwise full length
    const len = (config.cyclic && config.dynamicMax !== undefined) ? config.dynamicMax + 1 : values.length;

    wheel.items.forEach(item => {
        const offset = parseInt(item.dataset.offset);
        let index;

        if (config.cyclic) {
            index = ((current + offset) % len + len) % len;
        } else {
            index = current + offset;
        }

        if (config.cyclic || (index >= 0 && index < len)) {
            item.textContent = config.format ? config.format(values[index]) : values[index];
            item.style.visibility = 'visible';
        } else {
            item.textContent = '';
            item.style.visibility = 'hidden';
        }
    });

    wheel.scrollOffset = 0;
    updateWheelVisual(wheel);
}

function updateWheelVisual(wheel) {
    const offset = -wheel.scrollOffset * WHEEL_ITEM_HEIGHT;
    wheel.track.style.transform = `translateY(${offset}px)`;
}

function setWheelValue(wheel, value) {
    const config = wheel.config;
    const index = config.values.indexOf(value);
    if (index !== -1) {
        wheel.currentIndex = index;
        updateWheelDisplay(wheel);
    } else if (config.findIndex) {
        const idx = config.findIndex(value);
        if (idx !== -1) {
            wheel.currentIndex = idx;
            updateWheelDisplay(wheel);
        }
    }
}

function getWheelValue(wheel) {
    return wheel.config.values[wheel.currentIndex];
}

/**
 * Apply datetime changes from all wheels to the simulation
 */
function applyDateTimeFromWheels() {
    const hourWheel = scrollWheels['wheel-hour'];
    const minuteWheel = scrollWheels['wheel-minute'];
    const ampmWheel = scrollWheels['wheel-ampm'];
    const monthWheel = scrollWheels['wheel-month'];
    const dayWheel = scrollWheels['wheel-day'];
    const yearWheel = scrollWheels['wheel-year'];

    if (!hourWheel || !minuteWheel || !ampmWheel || !monthWheel || !dayWheel || !yearWheel) return;

    let hours = getWheelValue(hourWheel);
    const mins = getWheelValue(minuteWheel);
    const ampm = getWheelValue(ampmWheel);
    const month = getWheelValue(monthWheel);
    let day = getWheelValue(dayWheel);
    const year = getWheelValue(yearWheel);

    // Convert 12-hour to 24-hour
    if (ampm === 'AM') {
        hours = hours === 12 ? 0 : hours;
    } else {
        hours = hours === 12 ? 12 : hours + 12;
    }

    // Update day wheel dynamic max based on current month/year
    const maxDay = new Date(year, month + 1, 0).getDate();
    dayWheel.config.dynamicMax = maxDay - 1;  // 0-indexed

    // Clamp day to max days in month
    if (day > maxDay) {
        day = maxDay;
        dayWheel.currentIndex = day - 1;
        updateWheelDisplay(dayWheel);
    }

    // Create new date
    const newCityTime = new Date(year, month, day, hours, mins);

    // Update global state
    selectedDate = new Date(newCityTime.getFullYear(), newCityTime.getMonth(), newCityTime.getDate());
    timeOffsetMinutes = newCityTime.getHours() * 60 + newCityTime.getMinutes();

    const slider = document.getElementById('time-slider');
    if (slider) slider.value = timeOffsetMinutes;

    isLiveMode = false;

    // Reset simulation timing to prevent jumps after wheel change
    if (isSimulating) {
        lastSimulationTime = performance.now();
    }

    updateTimeDisplay();
    updateCelestialPositions();
    updateEventMarkers();
    updateDayNavButtons();
    updatePositionDisplay();

    // Sync calendar if open
    calendarViewDate = new Date(selectedDate);
    renderCalendar();
}

/**
 * Update all wheel displays from current time state (called externally)
 */
function updateWheelsFromTime(hours, mins, month, day, year) {
    const displayHours = hours % 12 || 12;
    const ampm = hours >= 12 ? 'PM' : 'AM';

    const hourWheel = scrollWheels['wheel-hour'];
    const minuteWheel = scrollWheels['wheel-minute'];
    const ampmWheel = scrollWheels['wheel-ampm'];
    const monthWheel = scrollWheels['wheel-month'];
    const dayWheel = scrollWheels['wheel-day'];
    const yearWheel = scrollWheels['wheel-year'];

    // Update day wheel dynamic max based on current month/year
    if (dayWheel) {
        const maxDay = new Date(year, month + 1, 0).getDate();
        dayWheel.config.dynamicMax = maxDay - 1;
    }

    if (hourWheel) setWheelValue(hourWheel, displayHours);
    if (minuteWheel) setWheelValue(minuteWheel, mins);
    if (ampmWheel) setWheelValue(ampmWheel, ampm);
    if (monthWheel) setWheelValue(monthWheel, month);
    if (dayWheel) setWheelValue(dayWheel, day);
    if (yearWheel) setWheelValue(yearWheel, year);
}

/**
 * Initialize all datetime scroll wheels
 */
function initDateTimeWheels() {
    // Hours (1-12)
    initScrollWheel('wheel-hour', {
        values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        cyclic: true
    });

    // Minutes (0-59)
    initScrollWheel('wheel-minute', {
        values: Array.from({length: 60}, (_, i) => i),
        cyclic: true,
        format: (v) => v.toString().padStart(2, '0')
    });

    // AM/PM
    initScrollWheel('wheel-ampm', {
        values: ['AM', 'PM'],
        cyclic: true
    });

    // Months (0-11, display as names)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    initScrollWheel('wheel-month', {
        values: Array.from({length: 12}, (_, i) => i),
        cyclic: true,
        format: (v) => monthNames[v]
    });

    // Days (1-31) - cyclic with dynamic max based on month
    initScrollWheel('wheel-day', {
        values: Array.from({length: 31}, (_, i) => i + 1),
        cyclic: true,
        dynamicMax: 30  // Will be updated dynamically based on month (0-indexed)
    });

    // Years (1900-2100)
    const yearStart = 1900;
    const yearEnd = 2100;
    initScrollWheel('wheel-year', {
        values: Array.from({length: yearEnd - yearStart + 1}, (_, i) => yearStart + i),
        cyclic: false,
        min: 0,
        max: yearEnd - yearStart,
        findIndex: (year) => year - yearStart
    });
}

// Major world cities for nearest city lookup (tz = UTC offset in hours)
const CITIES = [
    // Mega cities
    { name: 'Tokyo', lat: 35.68, lon: 139.69, tz: 9 },
    { name: 'Delhi', lat: 28.61, lon: 77.21, tz: 5.5 },
    { name: 'Shanghai', lat: 31.23, lon: 121.47, tz: 8 },
    { name: 'São Paulo', lat: -23.55, lon: -46.63, tz: -3 },
    { name: 'Mexico City', lat: 19.43, lon: -99.13, tz: -6 },
    { name: 'Cairo', lat: 30.04, lon: 31.24, tz: 2 },
    { name: 'Mumbai', lat: 19.08, lon: 72.88, tz: 5.5 },
    { name: 'Beijing', lat: 39.90, lon: 116.41, tz: 8 },
    { name: 'Dhaka', lat: 23.81, lon: 90.41, tz: 6 },
    { name: 'Osaka', lat: 34.69, lon: 135.50, tz: 9 },
    { name: 'New York', lat: 40.71, lon: -74.01, tz: -5 },
    { name: 'Karachi', lat: 24.86, lon: 67.01, tz: 5 },
    { name: 'Buenos Aires', lat: -34.60, lon: -58.38, tz: -3 },
    { name: 'Istanbul', lat: 41.01, lon: 28.98, tz: 3 },
    { name: 'Kolkata', lat: 22.57, lon: 88.36, tz: 5.5 },
    { name: 'Lagos', lat: 6.52, lon: 3.38, tz: 1 },
    { name: 'Manila', lat: 14.60, lon: 120.98, tz: 8 },
    { name: 'Rio de Janeiro', lat: -22.91, lon: -43.17, tz: -3 },
    { name: 'Guangzhou', lat: 23.13, lon: 113.26, tz: 8 },
    { name: 'Los Angeles', lat: 34.05, lon: -118.24, tz: -8 },
    { name: 'Moscow', lat: 55.76, lon: 37.62, tz: 3 },
    { name: 'Shenzhen', lat: 22.54, lon: 114.06, tz: 8 },
    { name: 'Paris', lat: 48.86, lon: 2.35, tz: 1 },
    { name: 'London', lat: 51.51, lon: -0.13, tz: 0 },
    { name: 'Lima', lat: -12.05, lon: -77.04, tz: -5 },
    { name: 'Bangkok', lat: 13.76, lon: 100.50, tz: 7 },
    { name: 'Chennai', lat: 13.08, lon: 80.27, tz: 5.5 },
    { name: 'Bogotá', lat: 4.71, lon: -74.07, tz: -5 },
    { name: 'Johannesburg', lat: -26.20, lon: 28.04, tz: 2 },
    { name: 'Tehran', lat: 35.69, lon: 51.39, tz: 3.5 },
    { name: 'Hong Kong', lat: 22.32, lon: 114.17, tz: 8 },
    { name: 'Singapore', lat: 1.35, lon: 103.82, tz: 8 },
    // North America - USA
    { name: 'Chicago', lat: 41.88, lon: -87.63, tz: -6 },
    { name: 'Houston', lat: 29.76, lon: -95.37, tz: -6 },
    { name: 'Phoenix', lat: 33.45, lon: -112.07, tz: -7 },
    { name: 'Philadelphia', lat: 39.95, lon: -75.17, tz: -5 },
    { name: 'San Antonio', lat: 29.42, lon: -98.49, tz: -6 },
    { name: 'San Diego', lat: 32.72, lon: -117.16, tz: -8 },
    { name: 'Dallas', lat: 32.78, lon: -96.80, tz: -6 },
    { name: 'San Jose', lat: 37.34, lon: -121.89, tz: -8 },
    { name: 'Austin', lat: 30.27, lon: -97.74, tz: -6 },
    { name: 'Jacksonville', lat: 30.33, lon: -81.66, tz: -5 },
    { name: 'Fort Worth', lat: 32.75, lon: -97.33, tz: -6 },
    { name: 'Columbus', lat: 39.96, lon: -83.00, tz: -5 },
    { name: 'Charlotte', lat: 35.23, lon: -80.84, tz: -5 },
    { name: 'San Francisco', lat: 37.77, lon: -122.42, tz: -8 },
    { name: 'Indianapolis', lat: 39.77, lon: -86.16, tz: -5 },
    { name: 'Seattle', lat: 47.61, lon: -122.33, tz: -8 },
    { name: 'Denver', lat: 39.74, lon: -104.99, tz: -7 },
    { name: 'Washington DC', lat: 38.91, lon: -77.04, tz: -5 },
    { name: 'Boston', lat: 42.36, lon: -71.06, tz: -5 },
    { name: 'Nashville', lat: 36.16, lon: -86.78, tz: -6 },
    { name: 'Detroit', lat: 42.33, lon: -83.05, tz: -5 },
    { name: 'Oklahoma City', lat: 35.47, lon: -97.52, tz: -6 },
    { name: 'Portland', lat: 45.52, lon: -122.68, tz: -8 },
    { name: 'Las Vegas', lat: 36.17, lon: -115.14, tz: -8 },
    { name: 'Memphis', lat: 35.15, lon: -90.05, tz: -6 },
    { name: 'Louisville', lat: 38.25, lon: -85.76, tz: -5 },
    { name: 'Baltimore', lat: 39.29, lon: -76.61, tz: -5 },
    { name: 'Milwaukee', lat: 43.04, lon: -87.91, tz: -6 },
    { name: 'Albuquerque', lat: 35.08, lon: -106.65, tz: -7 },
    { name: 'Tucson', lat: 32.22, lon: -110.93, tz: -7 },
    { name: 'Fresno', lat: 36.74, lon: -119.79, tz: -8 },
    { name: 'Sacramento', lat: 38.58, lon: -121.49, tz: -8 },
    { name: 'Mesa', lat: 33.42, lon: -111.83, tz: -7 },
    { name: 'Kansas City', lat: 39.10, lon: -94.58, tz: -6 },
    { name: 'Atlanta', lat: 33.75, lon: -84.39, tz: -5 },
    { name: 'Miami', lat: 25.76, lon: -80.19, tz: -5 },
    { name: 'Omaha', lat: 41.26, lon: -95.94, tz: -6 },
    { name: 'Raleigh', lat: 35.78, lon: -78.64, tz: -5 },
    { name: 'Cleveland', lat: 41.50, lon: -81.69, tz: -5 },
    { name: 'Tampa', lat: 27.95, lon: -82.46, tz: -5 },
    { name: 'Minneapolis', lat: 44.98, lon: -93.27, tz: -6 },
    { name: 'New Orleans', lat: 29.95, lon: -90.07, tz: -6 },
    { name: 'Honolulu', lat: 21.31, lon: -157.86, tz: -10 },
    { name: 'Anchorage', lat: 61.22, lon: -149.90, tz: -9 },
    { name: 'St Louis', lat: 38.63, lon: -90.20, tz: -6 },
    { name: 'Pittsburgh', lat: 40.44, lon: -80.00, tz: -5 },
    { name: 'Cincinnati', lat: 39.10, lon: -84.51, tz: -5 },
    { name: 'Orlando', lat: 28.54, lon: -81.38, tz: -5 },
    { name: 'Salt Lake City', lat: 40.76, lon: -111.89, tz: -7 },
    { name: 'Boise', lat: 43.62, lon: -116.20, tz: -7 },
    { name: 'Richmond', lat: 37.54, lon: -77.44, tz: -5 },
    { name: 'Buffalo', lat: 42.89, lon: -78.88, tz: -5 },
    { name: 'Hartford', lat: 41.76, lon: -72.69, tz: -5 },
    { name: 'Providence', lat: 41.82, lon: -71.41, tz: -5 },
    { name: 'Birmingham', lat: 33.52, lon: -86.80, tz: -6 },
    // North America - Canada
    { name: 'Toronto', lat: 43.65, lon: -79.38, tz: -5 },
    { name: 'Montreal', lat: 45.50, lon: -73.57, tz: -5 },
    { name: 'Vancouver', lat: 49.28, lon: -123.12, tz: -8 },
    { name: 'Calgary', lat: 51.04, lon: -114.07, tz: -7 },
    { name: 'Edmonton', lat: 53.55, lon: -113.49, tz: -7 },
    { name: 'Ottawa', lat: 45.42, lon: -75.70, tz: -5 },
    { name: 'Winnipeg', lat: 49.90, lon: -97.14, tz: -6 },
    { name: 'Quebec City', lat: 46.81, lon: -71.21, tz: -5 },
    { name: 'Hamilton', lat: 43.26, lon: -79.87, tz: -5 },
    { name: 'Victoria', lat: 48.43, lon: -123.37, tz: -8 },
    { name: 'Halifax', lat: 44.65, lon: -63.58, tz: -4 },
    { name: 'Saskatoon', lat: 52.13, lon: -106.67, tz: -6 },
    { name: 'Regina', lat: 50.45, lon: -104.62, tz: -6 },
    { name: 'St Johns', lat: 47.56, lon: -52.71, tz: -3.5 },
    { name: 'Kelowna', lat: 49.89, lon: -119.50, tz: -8 },
    { name: 'London ON', lat: 42.98, lon: -81.25, tz: -5 },
    { name: 'Kitchener', lat: 43.45, lon: -80.49, tz: -5 },
    // Mexico & Central America
    { name: 'Guadalajara', lat: 20.66, lon: -103.35, tz: -6 },
    { name: 'Monterrey', lat: 25.69, lon: -100.32, tz: -6 },
    { name: 'Puebla', lat: 19.04, lon: -98.21, tz: -6 },
    { name: 'Tijuana', lat: 32.53, lon: -117.02, tz: -8 },
    { name: 'León', lat: 21.13, lon: -101.69, tz: -6 },
    { name: 'Cancún', lat: 21.16, lon: -86.85, tz: -5 },
    { name: 'Mérida', lat: 20.97, lon: -89.62, tz: -6 },
    { name: 'Guatemala City', lat: 14.63, lon: -90.51, tz: -6 },
    { name: 'San Salvador', lat: 13.69, lon: -89.22, tz: -6 },
    { name: 'Tegucigalpa', lat: 14.07, lon: -87.21, tz: -6 },
    { name: 'Managua', lat: 12.11, lon: -86.27, tz: -6 },
    { name: 'San José CR', lat: 9.93, lon: -84.08, tz: -6 },
    { name: 'Panama City', lat: 8.98, lon: -79.52, tz: -5 },
    { name: 'Havana', lat: 23.11, lon: -82.37, tz: -5 },
    { name: 'Santo Domingo', lat: 18.49, lon: -69.90, tz: -4 },
    { name: 'San Juan', lat: 18.47, lon: -66.11, tz: -4 },
    { name: 'Kingston', lat: 18.00, lon: -76.79, tz: -5 },
    { name: 'Port-au-Prince', lat: 18.54, lon: -72.34, tz: -5 },
    // South America
    { name: 'Medellín', lat: 6.25, lon: -75.56, tz: -5 },
    { name: 'Cali', lat: 3.44, lon: -76.52, tz: -5 },
    { name: 'Barranquilla', lat: 10.96, lon: -74.80, tz: -5 },
    { name: 'Cartagena', lat: 10.39, lon: -75.51, tz: -5 },
    { name: 'Caracas', lat: 10.49, lon: -66.88, tz: -4 },
    { name: 'Maracaibo', lat: 10.63, lon: -71.64, tz: -4 },
    { name: 'Valencia VE', lat: 10.18, lon: -67.99, tz: -4 },
    { name: 'Quito', lat: -0.18, lon: -78.47, tz: -5 },
    { name: 'Guayaquil', lat: -2.17, lon: -79.90, tz: -5 },
    { name: 'Cuenca', lat: -2.90, lon: -79.00, tz: -5 },
    { name: 'Belo Horizonte', lat: -19.92, lon: -43.94, tz: -3 },
    { name: 'Brasília', lat: -15.79, lon: -47.88, tz: -3 },
    { name: 'Salvador', lat: -12.97, lon: -38.51, tz: -3 },
    { name: 'Fortaleza', lat: -3.72, lon: -38.54, tz: -3 },
    { name: 'Recife', lat: -8.05, lon: -34.88, tz: -3 },
    { name: 'Porto Alegre', lat: -30.03, lon: -51.23, tz: -3 },
    { name: 'Curitiba', lat: -25.43, lon: -49.27, tz: -3 },
    { name: 'Manaus', lat: -3.12, lon: -60.02, tz: -4 },
    { name: 'Belém', lat: -1.46, lon: -48.50, tz: -3 },
    { name: 'Córdoba AR', lat: -31.42, lon: -64.18, tz: -3 },
    { name: 'Rosario', lat: -32.95, lon: -60.65, tz: -3 },
    { name: 'Mendoza', lat: -32.89, lon: -68.83, tz: -3 },
    { name: 'Santiago', lat: -33.45, lon: -70.67, tz: -4 },
    { name: 'Valparaíso', lat: -33.05, lon: -71.62, tz: -4 },
    { name: 'Concepción', lat: -36.83, lon: -73.05, tz: -4 },
    { name: 'Montevideo', lat: -34.90, lon: -56.19, tz: -3 },
    { name: 'Asunción', lat: -25.26, lon: -57.58, tz: -4 },
    { name: 'La Paz', lat: -16.50, lon: -68.15, tz: -4 },
    { name: 'Santa Cruz BO', lat: -17.79, lon: -63.18, tz: -4 },
    { name: 'Sucre', lat: -19.04, lon: -65.26, tz: -4 },
    { name: 'Ushuaia', lat: -54.80, lon: -68.30, tz: -3 },
    // Europe - UK & Ireland
    { name: 'Manchester', lat: 53.48, lon: -2.24, tz: 0 },
    { name: 'Birmingham UK', lat: 52.49, lon: -1.90, tz: 0 },
    { name: 'Glasgow', lat: 55.86, lon: -4.25, tz: 0 },
    { name: 'Liverpool', lat: 53.41, lon: -2.98, tz: 0 },
    { name: 'Edinburgh', lat: 55.95, lon: -3.19, tz: 0 },
    { name: 'Leeds', lat: 53.80, lon: -1.55, tz: 0 },
    { name: 'Bristol', lat: 51.45, lon: -2.59, tz: 0 },
    { name: 'Sheffield', lat: 53.38, lon: -1.47, tz: 0 },
    { name: 'Cardiff', lat: 51.48, lon: -3.18, tz: 0 },
    { name: 'Belfast', lat: 54.60, lon: -5.93, tz: 0 },
    { name: 'Dublin', lat: 53.35, lon: -6.26, tz: 0 },
    { name: 'Cork', lat: 51.90, lon: -8.47, tz: 0 },
    { name: 'Galway', lat: 53.27, lon: -9.06, tz: 0 },
    // Europe - France
    { name: 'Lyon', lat: 45.76, lon: 4.84, tz: 1 },
    { name: 'Marseille', lat: 43.30, lon: 5.37, tz: 1 },
    { name: 'Toulouse', lat: 43.60, lon: 1.44, tz: 1 },
    { name: 'Nice', lat: 43.71, lon: 7.26, tz: 1 },
    { name: 'Nantes', lat: 47.22, lon: -1.55, tz: 1 },
    { name: 'Strasbourg', lat: 48.57, lon: 7.75, tz: 1 },
    { name: 'Bordeaux', lat: 44.84, lon: -0.58, tz: 1 },
    { name: 'Lille', lat: 50.63, lon: 3.06, tz: 1 },
    { name: 'Montpellier', lat: 43.61, lon: 3.87, tz: 1 },
    // Europe - Germany
    { name: 'Berlin', lat: 52.52, lon: 13.41, tz: 1 },
    { name: 'Hamburg', lat: 53.55, lon: 9.99, tz: 1 },
    { name: 'Munich', lat: 48.14, lon: 11.58, tz: 1 },
    { name: 'Cologne', lat: 50.94, lon: 6.96, tz: 1 },
    { name: 'Frankfurt', lat: 50.11, lon: 8.68, tz: 1 },
    { name: 'Stuttgart', lat: 48.78, lon: 9.18, tz: 1 },
    { name: 'Düsseldorf', lat: 51.23, lon: 6.78, tz: 1 },
    { name: 'Leipzig', lat: 51.34, lon: 12.37, tz: 1 },
    { name: 'Dortmund', lat: 51.51, lon: 7.47, tz: 1 },
    { name: 'Dresden', lat: 51.05, lon: 13.74, tz: 1 },
    { name: 'Hannover', lat: 52.37, lon: 9.74, tz: 1 },
    { name: 'Nuremberg', lat: 49.45, lon: 11.08, tz: 1 },
    // Europe - Italy
    { name: 'Rome', lat: 41.90, lon: 12.50, tz: 1 },
    { name: 'Milan', lat: 45.46, lon: 9.19, tz: 1 },
    { name: 'Naples', lat: 40.85, lon: 14.27, tz: 1 },
    { name: 'Turin', lat: 45.07, lon: 7.69, tz: 1 },
    { name: 'Palermo', lat: 38.12, lon: 13.36, tz: 1 },
    { name: 'Genoa', lat: 44.41, lon: 8.93, tz: 1 },
    { name: 'Bologna', lat: 44.49, lon: 11.34, tz: 1 },
    { name: 'Florence', lat: 43.77, lon: 11.25, tz: 1 },
    { name: 'Venice', lat: 45.44, lon: 12.32, tz: 1 },
    { name: 'Verona', lat: 45.44, lon: 10.99, tz: 1 },
    // Europe - Spain & Portugal
    { name: 'Madrid', lat: 40.42, lon: -3.70, tz: 1 },
    { name: 'Barcelona', lat: 41.39, lon: 2.17, tz: 1 },
    { name: 'Valencia', lat: 39.47, lon: -0.38, tz: 1 },
    { name: 'Seville', lat: 37.39, lon: -5.99, tz: 1 },
    { name: 'Zaragoza', lat: 41.65, lon: -0.88, tz: 1 },
    { name: 'Málaga', lat: 36.72, lon: -4.42, tz: 1 },
    { name: 'Bilbao', lat: 43.26, lon: -2.93, tz: 1 },
    { name: 'Lisbon', lat: 38.72, lon: -9.14, tz: 0 },
    { name: 'Porto', lat: 41.16, lon: -8.63, tz: 0 },
    // Europe - Netherlands, Belgium, Switzerland
    { name: 'Amsterdam', lat: 52.37, lon: 4.90, tz: 1 },
    { name: 'Rotterdam', lat: 51.92, lon: 4.48, tz: 1 },
    { name: 'The Hague', lat: 52.08, lon: 4.30, tz: 1 },
    { name: 'Utrecht', lat: 52.09, lon: 5.12, tz: 1 },
    { name: 'Brussels', lat: 50.85, lon: 4.35, tz: 1 },
    { name: 'Antwerp', lat: 51.22, lon: 4.40, tz: 1 },
    { name: 'Zurich', lat: 47.38, lon: 8.54, tz: 1 },
    { name: 'Geneva', lat: 46.20, lon: 6.14, tz: 1 },
    { name: 'Basel', lat: 47.56, lon: 7.59, tz: 1 },
    { name: 'Bern', lat: 46.95, lon: 7.45, tz: 1 },
    { name: 'Luxembourg', lat: 49.61, lon: 6.13, tz: 1 },
    // Europe - Nordic
    { name: 'Stockholm', lat: 59.33, lon: 18.07, tz: 1 },
    { name: 'Gothenburg', lat: 57.71, lon: 11.97, tz: 1 },
    { name: 'Malmö', lat: 55.60, lon: 13.00, tz: 1 },
    { name: 'Oslo', lat: 59.91, lon: 10.75, tz: 1 },
    { name: 'Bergen', lat: 60.39, lon: 5.32, tz: 1 },
    { name: 'Trondheim', lat: 63.43, lon: 10.40, tz: 1 },
    { name: 'Copenhagen', lat: 55.68, lon: 12.57, tz: 1 },
    { name: 'Aarhus', lat: 56.16, lon: 10.20, tz: 1 },
    { name: 'Helsinki', lat: 60.17, lon: 24.94, tz: 2 },
    { name: 'Tampere', lat: 61.50, lon: 23.79, tz: 2 },
    { name: 'Turku', lat: 60.45, lon: 22.27, tz: 2 },
    { name: 'Reykjavik', lat: 64.15, lon: -21.94, tz: 0 },
    // Europe - Central & Eastern
    { name: 'Vienna', lat: 48.21, lon: 16.37, tz: 1 },
    { name: 'Graz', lat: 47.07, lon: 15.44, tz: 1 },
    { name: 'Warsaw', lat: 52.23, lon: 21.01, tz: 1 },
    { name: 'Kraków', lat: 50.06, lon: 19.94, tz: 1 },
    { name: 'Wrocław', lat: 51.11, lon: 17.04, tz: 1 },
    { name: 'Gdańsk', lat: 54.35, lon: 18.65, tz: 1 },
    { name: 'Prague', lat: 50.08, lon: 14.44, tz: 1 },
    { name: 'Brno', lat: 49.20, lon: 16.61, tz: 1 },
    { name: 'Budapest', lat: 47.50, lon: 19.04, tz: 1 },
    { name: 'Bucharest', lat: 44.43, lon: 26.10, tz: 2 },
    { name: 'Cluj-Napoca', lat: 46.77, lon: 23.60, tz: 2 },
    { name: 'Sofia', lat: 42.70, lon: 23.32, tz: 2 },
    { name: 'Belgrade', lat: 44.79, lon: 20.45, tz: 1 },
    { name: 'Zagreb', lat: 45.81, lon: 15.98, tz: 1 },
    { name: 'Ljubljana', lat: 46.05, lon: 14.51, tz: 1 },
    { name: 'Bratislava', lat: 48.15, lon: 17.11, tz: 1 },
    // Europe - Greece & Turkey
    { name: 'Athens', lat: 37.98, lon: 23.73, tz: 2 },
    { name: 'Thessaloniki', lat: 40.64, lon: 22.94, tz: 2 },
    { name: 'Ankara', lat: 39.93, lon: 32.85, tz: 3 },
    { name: 'Izmir', lat: 38.42, lon: 27.13, tz: 3 },
    { name: 'Antalya', lat: 36.90, lon: 30.69, tz: 3 },
    { name: 'Bursa', lat: 40.19, lon: 29.06, tz: 3 },
    // Europe - Ukraine & Belarus
    { name: 'Kyiv', lat: 50.45, lon: 30.52, tz: 2 },
    { name: 'Kharkiv', lat: 49.99, lon: 36.23, tz: 2 },
    { name: 'Odesa', lat: 46.47, lon: 30.73, tz: 2 },
    { name: 'Dnipro', lat: 48.46, lon: 35.04, tz: 2 },
    { name: 'Lviv', lat: 49.84, lon: 24.03, tz: 2 },
    { name: 'Minsk', lat: 53.90, lon: 27.57, tz: 3 },
    // Russia
    { name: 'St Petersburg', lat: 59.93, lon: 30.34, tz: 3 },
    { name: 'Novosibirsk', lat: 55.01, lon: 82.93, tz: 7 },
    { name: 'Yekaterinburg', lat: 56.84, lon: 60.60, tz: 5 },
    { name: 'Kazan', lat: 55.80, lon: 49.11, tz: 3 },
    { name: 'Nizhny Novgorod', lat: 56.33, lon: 44.00, tz: 3 },
    { name: 'Samara', lat: 53.20, lon: 50.15, tz: 4 },
    { name: 'Chelyabinsk', lat: 55.16, lon: 61.40, tz: 5 },
    { name: 'Omsk', lat: 54.99, lon: 73.37, tz: 6 },
    { name: 'Rostov-on-Don', lat: 47.24, lon: 39.71, tz: 3 },
    { name: 'Ufa', lat: 54.74, lon: 55.97, tz: 5 },
    { name: 'Krasnoyarsk', lat: 56.01, lon: 92.87, tz: 7 },
    { name: 'Perm', lat: 58.01, lon: 56.25, tz: 5 },
    { name: 'Voronezh', lat: 51.67, lon: 39.18, tz: 3 },
    { name: 'Volgograd', lat: 48.71, lon: 44.50, tz: 3 },
    { name: 'Vladivostok', lat: 43.12, lon: 131.87, tz: 10 },
    { name: 'Irkutsk', lat: 52.29, lon: 104.28, tz: 8 },
    { name: 'Khabarovsk', lat: 48.48, lon: 135.08, tz: 10 },
    { name: 'Sochi', lat: 43.59, lon: 39.73, tz: 3 },
    // Middle East
    { name: 'Riyadh', lat: 24.69, lon: 46.72, tz: 3 },
    { name: 'Jeddah', lat: 21.49, lon: 39.19, tz: 3 },
    { name: 'Mecca', lat: 21.39, lon: 39.86, tz: 3 },
    { name: 'Medina', lat: 24.52, lon: 39.57, tz: 3 },
    { name: 'Dubai', lat: 25.20, lon: 55.27, tz: 4 },
    { name: 'Abu Dhabi', lat: 24.45, lon: 54.38, tz: 4 },
    { name: 'Sharjah', lat: 25.36, lon: 55.39, tz: 4 },
    { name: 'Kuwait City', lat: 29.38, lon: 47.99, tz: 3 },
    { name: 'Doha', lat: 25.29, lon: 51.53, tz: 3 },
    { name: 'Manama', lat: 26.23, lon: 50.59, tz: 3 },
    { name: 'Muscat', lat: 23.59, lon: 58.38, tz: 4 },
    { name: 'Amman', lat: 31.96, lon: 35.95, tz: 2 },
    { name: 'Beirut', lat: 33.89, lon: 35.50, tz: 2 },
    { name: 'Damascus', lat: 33.51, lon: 36.29, tz: 2 },
    { name: 'Aleppo', lat: 36.20, lon: 37.16, tz: 2 },
    { name: 'Baghdad', lat: 33.31, lon: 44.37, tz: 3 },
    { name: 'Basra', lat: 30.51, lon: 47.82, tz: 3 },
    { name: 'Jerusalem', lat: 31.77, lon: 35.23, tz: 2 },
    { name: 'Tel Aviv', lat: 32.09, lon: 34.78, tz: 2 },
    { name: 'Haifa', lat: 32.79, lon: 34.99, tz: 2 },
    { name: 'Tabriz', lat: 38.08, lon: 46.29, tz: 3.5 },
    { name: 'Isfahan', lat: 32.65, lon: 51.68, tz: 3.5 },
    { name: 'Mashhad', lat: 36.30, lon: 59.60, tz: 3.5 },
    { name: 'Shiraz', lat: 29.59, lon: 52.58, tz: 3.5 },
    { name: 'Kabul', lat: 34.53, lon: 69.17, tz: 4.5 },
    { name: 'Sanaa', lat: 15.37, lon: 44.21, tz: 3 },
    // South Asia
    { name: 'Bangalore', lat: 12.97, lon: 77.59, tz: 5.5 },
    { name: 'Hyderabad', lat: 17.39, lon: 78.49, tz: 5.5 },
    { name: 'Ahmedabad', lat: 23.02, lon: 72.57, tz: 5.5 },
    { name: 'Pune', lat: 18.52, lon: 73.86, tz: 5.5 },
    { name: 'Surat', lat: 21.17, lon: 72.83, tz: 5.5 },
    { name: 'Jaipur', lat: 26.92, lon: 75.79, tz: 5.5 },
    { name: 'Lucknow', lat: 26.85, lon: 80.95, tz: 5.5 },
    { name: 'Kanpur', lat: 26.45, lon: 80.35, tz: 5.5 },
    { name: 'Nagpur', lat: 21.15, lon: 79.09, tz: 5.5 },
    { name: 'Indore', lat: 22.72, lon: 75.86, tz: 5.5 },
    { name: 'Thane', lat: 19.20, lon: 72.96, tz: 5.5 },
    { name: 'Bhopal', lat: 23.26, lon: 77.41, tz: 5.5 },
    { name: 'Visakhapatnam', lat: 17.69, lon: 83.22, tz: 5.5 },
    { name: 'Patna', lat: 25.61, lon: 85.14, tz: 5.5 },
    { name: 'Vadodara', lat: 22.31, lon: 73.18, tz: 5.5 },
    { name: 'Ghaziabad', lat: 28.67, lon: 77.42, tz: 5.5 },
    { name: 'Coimbatore', lat: 11.02, lon: 76.96, tz: 5.5 },
    { name: 'Kochi', lat: 9.93, lon: 76.27, tz: 5.5 },
    { name: 'Lahore', lat: 31.55, lon: 74.34, tz: 5 },
    { name: 'Faisalabad', lat: 31.42, lon: 73.09, tz: 5 },
    { name: 'Rawalpindi', lat: 33.60, lon: 73.04, tz: 5 },
    { name: 'Islamabad', lat: 33.68, lon: 73.05, tz: 5 },
    { name: 'Multan', lat: 30.20, lon: 71.46, tz: 5 },
    { name: 'Peshawar', lat: 34.01, lon: 71.58, tz: 5 },
    { name: 'Chittagong', lat: 22.36, lon: 91.78, tz: 6 },
    { name: 'Khulna', lat: 22.82, lon: 89.55, tz: 6 },
    { name: 'Kathmandu', lat: 27.72, lon: 85.32, tz: 5.75 },
    { name: 'Colombo', lat: 6.93, lon: 79.85, tz: 5.5 },
    { name: 'Kandy', lat: 7.29, lon: 80.64, tz: 5.5 },
    // East Asia
    { name: 'Yokohama', lat: 35.44, lon: 139.64, tz: 9 },
    { name: 'Nagoya', lat: 35.18, lon: 136.91, tz: 9 },
    { name: 'Sapporo', lat: 43.06, lon: 141.35, tz: 9 },
    { name: 'Kobe', lat: 34.69, lon: 135.20, tz: 9 },
    { name: 'Kyoto', lat: 35.01, lon: 135.77, tz: 9 },
    { name: 'Fukuoka', lat: 33.59, lon: 130.40, tz: 9 },
    { name: 'Hiroshima', lat: 34.39, lon: 132.46, tz: 9 },
    { name: 'Sendai', lat: 38.27, lon: 140.87, tz: 9 },
    { name: 'Busan', lat: 35.18, lon: 129.08, tz: 9 },
    { name: 'Incheon', lat: 37.46, lon: 126.71, tz: 9 },
    { name: 'Daegu', lat: 35.87, lon: 128.60, tz: 9 },
    { name: 'Daejeon', lat: 36.35, lon: 127.38, tz: 9 },
    { name: 'Gwangju', lat: 35.16, lon: 126.85, tz: 9 },
    { name: 'Chengdu', lat: 30.57, lon: 104.07, tz: 8 },
    { name: 'Wuhan', lat: 30.59, lon: 114.31, tz: 8 },
    { name: 'Nanjing', lat: 32.06, lon: 118.78, tz: 8 },
    { name: 'Tianjin', lat: 39.13, lon: 117.20, tz: 8 },
    { name: 'Xian', lat: 34.27, lon: 108.95, tz: 8 },
    { name: 'Hangzhou', lat: 30.27, lon: 120.15, tz: 8 },
    { name: 'Suzhou', lat: 31.30, lon: 120.59, tz: 8 },
    { name: 'Chongqing', lat: 29.56, lon: 106.55, tz: 8 },
    { name: 'Shenyang', lat: 41.80, lon: 123.43, tz: 8 },
    { name: 'Qingdao', lat: 36.07, lon: 120.38, tz: 8 },
    { name: 'Dalian', lat: 38.91, lon: 121.60, tz: 8 },
    { name: 'Harbin', lat: 45.80, lon: 126.53, tz: 8 },
    { name: 'Changsha', lat: 28.23, lon: 112.94, tz: 8 },
    { name: 'Zhengzhou', lat: 34.75, lon: 113.63, tz: 8 },
    { name: 'Kunming', lat: 25.04, lon: 102.71, tz: 8 },
    { name: 'Xiamen', lat: 24.48, lon: 118.09, tz: 8 },
    { name: 'Fuzhou', lat: 26.07, lon: 119.30, tz: 8 },
    { name: 'Taipei', lat: 25.03, lon: 121.57, tz: 8 },
    { name: 'Kaohsiung', lat: 22.62, lon: 120.31, tz: 8 },
    { name: 'Taichung', lat: 24.15, lon: 120.67, tz: 8 },
    { name: 'Macau', lat: 22.20, lon: 113.55, tz: 8 },
    { name: 'Ulaanbaatar', lat: 47.92, lon: 106.92, tz: 8 },
    // Southeast Asia
    { name: 'Hanoi', lat: 21.03, lon: 105.85, tz: 7 },
    { name: 'Ho Chi Minh', lat: 10.82, lon: 106.63, tz: 7 },
    { name: 'Da Nang', lat: 16.07, lon: 108.22, tz: 7 },
    { name: 'Hai Phong', lat: 20.86, lon: 106.68, tz: 7 },
    { name: 'Kuala Lumpur', lat: 3.14, lon: 101.69, tz: 8 },
    { name: 'Johor Bahru', lat: 1.49, lon: 103.74, tz: 8 },
    { name: 'Penang', lat: 5.42, lon: 100.31, tz: 8 },
    { name: 'Surabaya', lat: -7.25, lon: 112.75, tz: 7 },
    { name: 'Bandung', lat: -6.91, lon: 107.61, tz: 7 },
    { name: 'Medan', lat: 3.59, lon: 98.67, tz: 7 },
    { name: 'Semarang', lat: -6.97, lon: 110.42, tz: 7 },
    { name: 'Makassar', lat: -5.14, lon: 119.42, tz: 8 },
    { name: 'Bali', lat: -8.34, lon: 115.09, tz: 8 },
    { name: 'Cebu', lat: 10.31, lon: 123.89, tz: 8 },
    { name: 'Davao', lat: 7.07, lon: 125.61, tz: 8 },
    { name: 'Quezon City', lat: 14.68, lon: 121.04, tz: 8 },
    { name: 'Yangon', lat: 16.87, lon: 96.20, tz: 6.5 },
    { name: 'Mandalay', lat: 21.97, lon: 96.08, tz: 6.5 },
    { name: 'Phnom Penh', lat: 11.56, lon: 104.92, tz: 7 },
    { name: 'Vientiane', lat: 17.98, lon: 102.63, tz: 7 },
    { name: 'Phuket', lat: 7.88, lon: 98.39, tz: 7 },
    { name: 'Chiang Mai', lat: 18.79, lon: 98.98, tz: 7 },
    { name: 'Pattaya', lat: 12.93, lon: 100.88, tz: 7 },
    // Africa - North
    { name: 'Alexandria', lat: 31.20, lon: 29.92, tz: 2 },
    { name: 'Giza', lat: 30.01, lon: 31.21, tz: 2 },
    { name: 'Port Said', lat: 31.27, lon: 32.30, tz: 2 },
    { name: 'Luxor', lat: 25.69, lon: 32.64, tz: 2 },
    { name: 'Casablanca', lat: 33.57, lon: -7.59, tz: 1 },
    { name: 'Rabat', lat: 34.01, lon: -6.83, tz: 1 },
    { name: 'Fes', lat: 34.03, lon: -5.00, tz: 1 },
    { name: 'Marrakech', lat: 31.63, lon: -7.98, tz: 1 },
    { name: 'Tangier', lat: 35.78, lon: -5.81, tz: 1 },
    { name: 'Algiers', lat: 36.74, lon: 3.09, tz: 1 },
    { name: 'Oran', lat: 35.70, lon: -0.64, tz: 1 },
    { name: 'Constantine', lat: 36.37, lon: 6.61, tz: 1 },
    { name: 'Tunis', lat: 36.81, lon: 10.18, tz: 1 },
    { name: 'Tripoli', lat: 32.89, lon: 13.19, tz: 2 },
    { name: 'Benghazi', lat: 32.12, lon: 20.07, tz: 2 },
    { name: 'Khartoum', lat: 15.50, lon: 32.56, tz: 2 },
    // Africa - West
    { name: 'Abuja', lat: 9.06, lon: 7.50, tz: 1 },
    { name: 'Kano', lat: 12.00, lon: 8.52, tz: 1 },
    { name: 'Ibadan', lat: 7.38, lon: 3.90, tz: 1 },
    { name: 'Port Harcourt', lat: 4.78, lon: 7.01, tz: 1 },
    { name: 'Accra', lat: 5.56, lon: -0.19, tz: 0 },
    { name: 'Kumasi', lat: 6.69, lon: -1.62, tz: 0 },
    { name: 'Dakar', lat: 14.69, lon: -17.44, tz: 0 },
    { name: 'Abidjan', lat: 5.35, lon: -4.01, tz: 0 },
    { name: 'Bamako', lat: 12.64, lon: -8.00, tz: 0 },
    { name: 'Ouagadougou', lat: 12.37, lon: -1.52, tz: 0 },
    { name: 'Conakry', lat: 9.64, lon: -13.58, tz: 0 },
    { name: 'Freetown', lat: 8.48, lon: -13.23, tz: 0 },
    { name: 'Monrovia', lat: 6.29, lon: -10.76, tz: 0 },
    { name: 'Lomé', lat: 6.17, lon: 1.23, tz: 0 },
    { name: 'Cotonou', lat: 6.37, lon: 2.39, tz: 1 },
    { name: 'Niamey', lat: 13.51, lon: 2.13, tz: 1 },
    { name: 'Nouakchott', lat: 18.09, lon: -15.98, tz: 0 },
    // Africa - East
    { name: 'Nairobi', lat: -1.29, lon: 36.82, tz: 3 },
    { name: 'Mombasa', lat: -4.04, lon: 39.67, tz: 3 },
    { name: 'Addis Ababa', lat: 9.03, lon: 38.70, tz: 3 },
    { name: 'Dar es Salaam', lat: -6.79, lon: 39.21, tz: 3 },
    { name: 'Zanzibar', lat: -6.16, lon: 39.19, tz: 3 },
    { name: 'Kampala', lat: 0.32, lon: 32.58, tz: 3 },
    { name: 'Kigali', lat: -1.94, lon: 30.06, tz: 2 },
    { name: 'Bujumbura', lat: -3.38, lon: 29.36, tz: 2 },
    { name: 'Mogadishu', lat: 2.04, lon: 45.34, tz: 3 },
    { name: 'Djibouti', lat: 11.59, lon: 43.15, tz: 3 },
    { name: 'Asmara', lat: 15.34, lon: 38.93, tz: 3 },
    // Africa - Central
    { name: 'Kinshasa', lat: -4.44, lon: 15.27, tz: 1 },
    { name: 'Lubumbashi', lat: -11.66, lon: 27.48, tz: 2 },
    { name: 'Brazzaville', lat: -4.27, lon: 15.28, tz: 1 },
    { name: 'Douala', lat: 4.05, lon: 9.70, tz: 1 },
    { name: 'Yaoundé', lat: 3.87, lon: 11.52, tz: 1 },
    { name: 'Libreville', lat: 0.39, lon: 9.45, tz: 1 },
    { name: 'Luanda', lat: -8.84, lon: 13.23, tz: 1 },
    { name: 'Bangui', lat: 4.36, lon: 18.56, tz: 1 },
    { name: 'NDjamena', lat: 12.11, lon: 15.04, tz: 1 },
    // Africa - Southern
    { name: 'Cape Town', lat: -33.93, lon: 18.42, tz: 2 },
    { name: 'Durban', lat: -29.86, lon: 31.02, tz: 2 },
    { name: 'Pretoria', lat: -25.75, lon: 28.19, tz: 2 },
    { name: 'Port Elizabeth', lat: -33.96, lon: 25.60, tz: 2 },
    { name: 'Bloemfontein', lat: -29.12, lon: 26.21, tz: 2 },
    { name: 'Lusaka', lat: -15.39, lon: 28.32, tz: 2 },
    { name: 'Harare', lat: -17.83, lon: 31.05, tz: 2 },
    { name: 'Bulawayo', lat: -20.15, lon: 28.58, tz: 2 },
    { name: 'Maputo', lat: -25.97, lon: 32.57, tz: 2 },
    { name: 'Lilongwe', lat: -13.97, lon: 33.79, tz: 2 },
    { name: 'Gaborone', lat: -24.65, lon: 25.91, tz: 2 },
    { name: 'Windhoek', lat: -22.56, lon: 17.08, tz: 2 },
    { name: 'Antananarivo', lat: -18.91, lon: 47.54, tz: 3 },
    { name: 'Port Louis', lat: -20.16, lon: 57.50, tz: 4 },
    // Oceania
    { name: 'Sydney', lat: -33.87, lon: 151.21, tz: 10 },
    { name: 'Melbourne', lat: -37.81, lon: 144.96, tz: 10 },
    { name: 'Brisbane', lat: -27.47, lon: 153.03, tz: 10 },
    { name: 'Perth', lat: -31.95, lon: 115.86, tz: 8 },
    { name: 'Adelaide', lat: -34.93, lon: 138.60, tz: 9.5 },
    { name: 'Gold Coast', lat: -28.00, lon: 153.43, tz: 10 },
    { name: 'Newcastle', lat: -32.93, lon: 151.78, tz: 10 },
    { name: 'Canberra', lat: -35.28, lon: 149.13, tz: 10 },
    { name: 'Hobart', lat: -42.88, lon: 147.33, tz: 10 },
    { name: 'Darwin', lat: -12.46, lon: 130.84, tz: 9.5 },
    { name: 'Cairns', lat: -16.92, lon: 145.77, tz: 10 },
    { name: 'Townsville', lat: -19.26, lon: 146.82, tz: 10 },
    { name: 'Auckland', lat: -36.85, lon: 174.76, tz: 12 },
    { name: 'Wellington', lat: -41.29, lon: 174.78, tz: 12 },
    { name: 'Christchurch', lat: -43.53, lon: 172.64, tz: 12 },
    { name: 'Hamilton NZ', lat: -37.79, lon: 175.28, tz: 12 },
    { name: 'Dunedin', lat: -45.87, lon: 170.50, tz: 12 },
    { name: 'Suva', lat: -18.14, lon: 178.44, tz: 12 },
    { name: 'Port Moresby', lat: -9.44, lon: 147.18, tz: 10 },
    { name: 'Noumea', lat: -22.28, lon: 166.46, tz: 11 },
    { name: 'Papeete', lat: -17.54, lon: -149.57, tz: -10 },
    { name: 'Apia', lat: -13.83, lon: -171.76, tz: 13 },
    { name: 'Nuku\'alofa', lat: -21.21, lon: -175.20, tz: 13 },
    // Arctic & Remote
    { name: 'Longyearbyen', lat: 78.22, lon: 15.64, tz: 1 },
    { name: 'Nuuk', lat: 64.18, lon: -51.72, tz: -3 },
    { name: 'Fairbanks', lat: 64.84, lon: -147.72, tz: -9 },
    { name: 'Tromsø', lat: 69.65, lon: 18.96, tz: 1 },
    { name: 'Murmansk', lat: 68.97, lon: 33.09, tz: 3 },
    { name: 'Yellowknife', lat: 62.45, lon: -114.37, tz: -7 },
    { name: 'Whitehorse', lat: 60.72, lon: -135.05, tz: -8 },
    { name: 'McMurdo', lat: -77.85, lon: 166.67, tz: 12 },
];

/**
 * Calculate great-circle distance using Haversine formula
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * Math.asin(Math.sqrt(a)); // Returns radians (angular distance)
}

/**
 * Find closest city to given coordinates
 */
function findClosestCity(lat, lon) {
    let closest = null;
    let minDist = Infinity;
    for (const city of CITIES) {
        const dist = haversineDistance(lat, lon, city.lat, city.lon);
        if (dist < minDist) {
            minDist = dist;
            closest = city;
        }
    }
    return closest;
}

/**
 * Sort cities in eastward chain using longitude bands with latitude sorting
 * Creates a serpentine path going eastward around the globe
 */
function sortCitiesEastwardChain(cities) {
    const bandWidth = 12; // degrees of longitude per band
    const bands = new Map();

    // Group cities into longitude bands
    for (const city of cities) {
        // Normalize longitude to 0-360 range, then find band
        const normLon = ((city.lon + 180) % 360 + 360) % 360;
        const bandIndex = Math.floor(normLon / bandWidth);
        if (!bands.has(bandIndex)) bands.set(bandIndex);
        if (!bands.get(bandIndex)) bands.set(bandIndex, []);
        bands.get(bandIndex).push(city);
    }

    // Sort band indices
    const sortedBandIndices = [...bands.keys()].sort((a, b) => a - b);

    // Build result: alternate latitude sort direction for serpentine effect
    const sorted = [];
    let ascending = true;
    for (const bandIndex of sortedBandIndices) {
        const bandCities = bands.get(bandIndex);
        // Sort by latitude within band
        bandCities.sort((a, b) => ascending ? a.lat - b.lat : b.lat - a.lat);
        sorted.push(...bandCities);
        ascending = !ascending; // Flip for next band
    }

    return sorted;
}

// City navigation animation state
let cityNavAnimationId = null;
let pointerNavAnimationId = null;

/**
 * Animate pointer to target coordinates (camera stays stationary)
 * In unpinned mode, pointer follows camera, so this animates the camera instead
 */
function animatePointerToCity(targetLat, targetLon, duration = 500) {
    // In unpinned mode, pointer follows camera, so animate camera instead
    if (!focusLocked) {
        animateCameraToCity(targetLat, targetLon, duration);
        return;
    }

    // Cancel any existing pointer animation
    if (pointerNavAnimationId) {
        cancelAnimationFrame(pointerNavAnimationId);
        pointerNavAnimationId = null;
    }

    // Pinned mode: animate pointer position smoothly
    const startLat = focusPointLat;
    const startLon = focusPointLon;
    const startTime = performance.now();

    function step(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease out expo for snappy feel
        const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);

        // Interpolate lat/lon
        focusPointLat = startLat + (targetLat - startLat) * eased;
        focusPointLon = startLon + (targetLon - startLon) * eased;

        // In horizon mode, camera follows pointer regardless of pin mode
        syncCameraToFocusInHorizonMode();

        // Reset momentum
        focusVelocityLat = 0;
        focusVelocityLon = 0;

        if (progress < 1) {
            pointerNavAnimationId = requestAnimationFrame(step);
        } else {
            pointerNavAnimationId = null;
            // Update display immediately after animation completes
            updatePositionDisplay();
        }
    }

    pointerNavAnimationId = requestAnimationFrame(step);
}

/**
 * Animate camera smoothly to target coordinates
 */
function animateCameraToCity(targetLat, targetLon, duration = 500) {
    // Cancel any existing animation
    if (cityNavAnimationId) {
        cancelAnimationFrame(cityNavAnimationId);
        cityNavAnimationId = null;
    }

    // Get current position (need to wait for these globals to be defined)
    if (typeof cameraRefLat === 'undefined' || typeof cameraRefLon === 'undefined') {
        return;
    }

    const startLat = cameraRefLat + (typeof dragOffsetLat !== 'undefined' ? dragOffsetLat : 0);
    const startLon = cameraRefLon + (typeof dragOffsetLon !== 'undefined' ? dragOffsetLon : 0);
    const startTime = performance.now();

    // Handle longitude wrapping for shortest path
    let deltaLon = targetLon - startLon;
    if (deltaLon > 180) deltaLon -= 360;
    if (deltaLon < -180) deltaLon += 360;

    function step(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease out expo for snappy feel
        const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);

        const newLat = startLat + (targetLat - startLat) * eased;
        let newLon = startLon + deltaLon * eased;

        // Normalize longitude
        while (newLon > 180) newLon -= 360;
        while (newLon < -180) newLon += 360;

        // Update global camera state
        cameraRefLat = newLat;
        cameraRefLon = newLon;
        dragOffsetLat = 0;
        dragOffsetLon = 0;

        // Also update focus point to the city
        focusPointLat = newLat;
        focusPointLon = newLon;
        focusVelocityLat = 0;
        focusVelocityLon = 0;

        if (progress < 1) {
            cityNavAnimationId = requestAnimationFrame(step);
        } else {
            cityNavAnimationId = null;
            // Update display immediately after animation completes
            updatePositionDisplay();
        }
    }

    cityNavAnimationId = requestAnimationFrame(step);
}

/**
 * Get absolute simulated time - returns Date object for celestial calculations
 * timeOffsetMinutes represents LOCAL time at pointer position (0-1440 minutes from midnight)
 */
function getAbsoluteSimulatedTime() {
    const now = new Date();
    // In live mode, always return actual current time - sun/moon follow real time
    if (isLiveMode) {
        return now;
    }

    // Use lastPointerTz for consistency - this value is always updated atomically
    // with timeOffsetMinutes to prevent sun/moon jumping when pointer moves
    const cityTzHours = lastPointerTz !== null ? lastPointerTz : 0;

    // Get the date we're viewing
    let baseDate;
    if (selectedDate) {
        baseDate = new Date(selectedDate);
    } else {
        baseDate = new Date(now);
    }

    // timeOffsetMinutes is local time (0-1440 minutes from midnight)
    // Convert to UTC: UTC = localTime - tzOffset
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const day = baseDate.getDate();

    // Create date at midnight UTC for this day
    const midnightUtc = Date.UTC(year, month, day, 0, 0, 0, 0);

    // Subtract timezone offset to convert local time to UTC
    const utcMs = midnightUtc + (timeOffsetMinutes - cityTzHours * 60) * 60 * 1000;

    return new Date(utcMs);
}

/**
 * Get simulated time - same as getAbsoluteSimulatedTime
 */
function getSimulatedTime() {
    return getAbsoluteSimulatedTime();
}

/**
 * Calculate what to point at when entering horizon mode
 * Based on zoomTargetMode: 0 = sun, 1 = moon, 2 = free (keep current yaw, pitch 0)
 * Returns { yaw, pitch } in radians
 */
function getHorizonEntryTarget() {
    // Free mode - face north, look at horizon
    if (zoomTargetMode === 2) {
        return { yaw: 0, pitch: 0 };
    }

    const simTime = getAbsoluteSimulatedTime();
    const sunPos = getSunPosition(simTime);
    const moonPos = getMoonPosition(simTime);

    const focusLatRad = focusPointLat * Math.PI / 180;
    const focusLonRad = focusPointLon * Math.PI / 180;

    // Helper to calculate bearing and altitude to a celestial body
    function calcBearingAltitude(bodyLat, bodyLon) {
        const bodyLatRad = bodyLat * Math.PI / 180;
        const bodyLonRad = bodyLon * Math.PI / 180;

        const dLon = bodyLonRad - focusLonRad;
        const y = Math.sin(dLon) * Math.cos(bodyLatRad);
        const x = Math.cos(focusLatRad) * Math.sin(bodyLatRad) -
                 Math.sin(focusLatRad) * Math.cos(bodyLatRad) * Math.cos(dLon);
        const bearing = Math.atan2(y, x);

        const sinLat1 = Math.sin(focusLatRad);
        const cosLat1 = Math.cos(focusLatRad);
        const sinLat2 = Math.sin(bodyLatRad);
        const cosLat2 = Math.cos(bodyLatRad);
        const cosDLon = Math.cos(dLon);

        const altitude = Math.asin(sinLat1 * sinLat2 + cosLat1 * cosLat2 * cosDLon);

        return { bearing, altitude };
    }

    // Sun mode
    if (zoomTargetMode === 0) {
        const sun = calcBearingAltitude(sunPos.lat, sunPos.lon);
        return {
            yaw: sun.bearing,
            pitch: THREE.MathUtils.clamp(sun.altitude, -Math.PI / 2 + 0.1, Math.PI / 2 - 0.1)
        };
    }

    // Moon mode
    if (zoomTargetMode === 1) {
        const moon = calcBearingAltitude(moonPos.lat, moonPos.lon);
        return {
            yaw: moon.bearing,
            pitch: THREE.MathUtils.clamp(moon.altitude, -Math.PI / 2 + 0.1, Math.PI / 2 - 0.1)
        };
    }

    // Fallback
    return { yaw: 0, pitch: 0 };
}

/**
 * Get current local time at pointer position as minutes since midnight (0-1440)
 */
function getLocalTimeMinutes() {
    const closestCity = findClosestCity(focusPointLat, focusPointLon);
    const cityTzHours = closestCity ? closestCity.tz : 0;

    const simTime = getAbsoluteSimulatedTime();
    const utcHours = simTime.getUTCHours();
    const utcMinutes = simTime.getUTCMinutes();
    const utcTotalMinutes = utcHours * 60 + utcMinutes;

    // Local time = UTC + timezone offset
    let localMinutes = utcTotalMinutes + cityTzHours * 60;

    // Wrap around for day boundaries
    while (localMinutes < 0) localMinutes += 1440;
    while (localMinutes >= 1440) localMinutes -= 1440;

    return localMinutes;
}

/**
 * Update slider position when pointer moves to different timezone
 * Keeps the same moment in time, but shifts the slider to show new local time
 * In live mode, only updates lastPointerTz (slider is handled by periodic update)
 */
let lastPointerTz = null;
function updateSliderForTimezone() {
    const closestCity = findClosestCity(focusPointLat, focusPointLon);
    const cityTzHours = closestCity ? closestCity.tz : 0;

    // Only update if timezone actually changed
    if (lastPointerTz !== null && lastPointerTz !== cityTzHours) {
        if (isLiveMode) {
            // In live mode, check if day changed at new timezone
            const now = new Date();
            const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
            const cityMs = utcMs + cityTzHours * 60 * 60 * 1000;
            const cityTime = new Date(cityMs);
            const todayAtPointer = new Date(cityTime.getFullYear(), cityTime.getMonth(), cityTime.getDate());
            if (selectedDate && selectedDate.toDateString() !== todayAtPointer.toDateString()) {
                selectedDate = todayAtPointer;
                calendarViewDate = new Date(todayAtPointer);
                renderCalendar();
                updateEventMarkers();
                updateDayNavButtons();
            }
        } else {
            // In non-live mode, shift the slider to maintain the same moment in time
            const tzDiffMinutes = (cityTzHours - lastPointerTz) * 60;
            timeOffsetMinutes = timeOffsetMinutes + tzDiffMinutes;

            // Handle day boundary crossing - update selectedDate accordingly
            if (timeOffsetMinutes >= 1440) {
                if (selectedDate) {
                    selectedDate = new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000);
                }
                timeOffsetMinutes -= 1440;
            } else if (timeOffsetMinutes < 0) {
                if (selectedDate) {
                    selectedDate = new Date(selectedDate.getTime() - 24 * 60 * 60 * 1000);
                }
                timeOffsetMinutes += 1440;
            }

            const slider = document.getElementById('time-slider');
            if (slider) slider.value = timeOffsetMinutes;
        }
    }

    // Always update lastPointerTz to keep getAbsoluteSimulatedTime() consistent
    lastPointerTz = cityTzHours;
}

/**
 * Format time for display (with seconds for live mode)
 */
function formatTimeDisplay(date, includeSeconds = false) {
    const options = {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    };
    if (includeSeconds) {
        options.second = '2-digit';
    }
    const timeStr = date.toLocaleString(undefined, options);

    // Add user's local UTC offset in brackets
    const offsetMinutes = -date.getTimezoneOffset();
    const offsetHours = offsetMinutes / 60;
    const sign = offsetHours >= 0 ? '+' : '';
    return `${timeStr} <span class="utc-offset">(UTC${sign}${offsetHours})</span>`;
}

/**
 * Calculate rise/set time for a celestial body
 * @param {number} lat - Observer latitude
 * @param {number} lon - Observer longitude
 * @param {function} getPosition - Function that returns {lat, lon} for the body at a given Date
 * @returns {{rise: object|null, set: object|null}}
 */
function calculateRiseSetTimes(lat, lon, getPosition, cityTzHours = 0, horizonThreshold) {
    // Use base date (noon in city's timezone) without slider offset for consistent marker positions
    let now;
    if (selectedDate) {
        now = new Date(selectedDate);
        now.setHours(12, 0, 0, 0);
    } else {
        now = new Date();
    }

    // Adjust base time to represent noon in the city's timezone
    const userTzMinutes = -now.getTimezoneOffset();
    const cityTzMinutes = cityTzHours * 60;
    const tzDiffMinutes = cityTzMinutes - userTzMinutes;
    now = new Date(now.getTime() - tzDiffMinutes * 60 * 1000);

    const latRad = lat * Math.PI / 180;

    // Search for rise/set times by checking altitude every 10 minutes over 24 hours
    const checkPoints = [];
    for (let i = -720; i <= 720; i += 10) {
        const checkTime = new Date(now.getTime() + i * 60 * 1000);
        const bodyPos = getPosition(checkTime);

        // Calculate hour angle
        const bodyLonRad = bodyPos.lon * Math.PI / 180;
        const bodyLatRad = bodyPos.lat * Math.PI / 180;
        const lonRad = lon * Math.PI / 180;

        // Local hour angle
        const ha = lonRad - bodyLonRad;

        // Altitude calculation
        const sinAlt = Math.sin(latRad) * Math.sin(bodyLatRad) +
                       Math.cos(latRad) * Math.cos(bodyLatRad) * Math.cos(ha);
        const altitude = Math.asin(sinAlt) * 180 / Math.PI;

        checkPoints.push({ offset: i, altitude });
    }

    // Atmospheric refraction + upper limb correction
    // Sun: -0.833° (34' refraction + 16' radius)
    // Moon: ~+0.125° (refraction minus parallax, varies)
    const HORIZON_THRESHOLD = horizonThreshold;

    // Find crossings of corrected horizon
    let rise = null, set = null;
    for (let i = 1; i < checkPoints.length; i++) {
        const prev = checkPoints[i - 1];
        const curr = checkPoints[i];

        if (prev.altitude < HORIZON_THRESHOLD && curr.altitude >= HORIZON_THRESHOLD && !rise) {
            // Rising - interpolate
            const t = (HORIZON_THRESHOLD - prev.altitude) / (curr.altitude - prev.altitude);
            const offset = prev.offset + t * 10;
            const riseTime = new Date(now.getTime() + offset * 60 * 1000);
            rise = { offset, label: formatShortTime(riseTime), time: riseTime };
        }
        if (prev.altitude >= HORIZON_THRESHOLD && curr.altitude < HORIZON_THRESHOLD && !set) {
            // Setting - interpolate
            const t = (prev.altitude - HORIZON_THRESHOLD) / (prev.altitude - curr.altitude);
            const offset = prev.offset + t * 10;
            const setTime = new Date(now.getTime() + offset * 60 * 1000);
            set = { offset, label: formatShortTime(setTime), time: setTime };
        }
    }

    return { rise, set };
}

/**
 * Find the next rise or set event from a given time, searching up to maxDays
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {Function} getPosition - Position function (getSunPosition or getMoonPosition)
 * @param {Date} fromTime - Start time to search from
 * @param {number} horizonThreshold - Altitude threshold for horizon
 * @param {number} maxDays - Maximum days to search (default 60)
 * @returns {{type: string, time: Date, msUntil: number}|null}
 */
function findNextRiseSet(lat, lon, getPosition, fromTime, horizonThreshold, maxDays = 60) {
    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;

    // Get current altitude to know if we're above or below horizon
    const currentPos = getPosition(fromTime);
    const currentLonRad = currentPos.lon * Math.PI / 180;
    const currentLatRad = currentPos.lat * Math.PI / 180;
    const currentHa = lonRad - currentLonRad;
    const currentSinAlt = Math.sin(latRad) * Math.sin(currentLatRad) +
                          Math.cos(latRad) * Math.cos(currentLatRad) * Math.cos(currentHa);
    const currentAlt = Math.asin(currentSinAlt) * 180 / Math.PI;
    const currentlyAbove = currentAlt >= horizonThreshold;

    // Search with 15-minute resolution for up to maxDays
    const maxMinutes = maxDays * 24 * 60;
    let prevAlt = currentAlt;

    for (let mins = 15; mins <= maxMinutes; mins += 15) {
        const checkTime = new Date(fromTime.getTime() + mins * 60 * 1000);
        const pos = getPosition(checkTime);
        const bodyLonRad = pos.lon * Math.PI / 180;
        const bodyLatRad = pos.lat * Math.PI / 180;
        const ha = lonRad - bodyLonRad;
        const sinAlt = Math.sin(latRad) * Math.sin(bodyLatRad) +
                       Math.cos(latRad) * Math.cos(bodyLatRad) * Math.cos(ha);
        const alt = Math.asin(sinAlt) * 180 / Math.PI;

        // Check for crossing
        if (prevAlt < horizonThreshold && alt >= horizonThreshold) {
            // Rising - interpolate for more accuracy
            const t = (horizonThreshold - prevAlt) / (alt - prevAlt);
            const exactMins = (mins - 15) + t * 15;
            const exactTime = new Date(fromTime.getTime() + exactMins * 60 * 1000);
            return { type: 'rise', time: exactTime, msUntil: exactMins * 60 * 1000 };
        }
        if (prevAlt >= horizonThreshold && alt < horizonThreshold) {
            // Setting - interpolate
            const t = (prevAlt - horizonThreshold) / (prevAlt - alt);
            const exactMins = (mins - 15) + t * 15;
            const exactTime = new Date(fromTime.getTime() + exactMins * 60 * 1000);
            return { type: 'set', time: exactTime, msUntil: exactMins * 60 * 1000 };
        }

        prevAlt = alt;
    }

    return null; // No event found within maxDays
}

/**
 * Get Moon's distance in km using Swiss Ephemeris
 * @param {Date} date - Current date/time
 * @returns {number} Distance in km
 */
function getMoonDistance(date) {
    if (sweInitialized && swe) {
        const jd = dateToJulianDay(date);
        // calc_ut returns [lon, lat, distance, lonSpeed, latSpeed, distSpeed]
        // distance is in AU
        const result = swe.calc_ut(jd, swe.SE_MOON, swe.SEFLG_SWIEPH);
        const distanceAU = result[2];
        const AU_TO_KM = 149597870.7;
        return distanceAU * AU_TO_KM;
    }
    // Fallback: average Moon distance
    return 384400;
}

/**
 * Get Sun's distance in millions of km using Swiss Ephemeris
 * @param {Date} date - Current date/time
 * @returns {number} Distance in millions of km
 */
function getSunDistance(date) {
    if (sweInitialized && swe) {
        const jd = dateToJulianDay(date);
        // calc_ut returns [lon, lat, distance, lonSpeed, latSpeed, distSpeed]
        // distance is in AU
        const result = swe.calc_ut(jd, swe.SE_SUN, swe.SEFLG_SWIEPH);
        const distanceAU = result[2];
        const AU_TO_KM = 149597870.7;
        // Return in millions of km
        return (distanceAU * AU_TO_KM) / 1000000;
    }
    // Fallback: average Earth-Sun distance (1 AU) in millions of km
    return 149.6;
}

/**
 * Calculate Moon's horizon threshold based on distance
 * Accounts for: atmospheric refraction, Moon's angular radius, and parallax
 * @param {number} distanceKm - Moon's distance in km
 * @returns {number} Horizon threshold in degrees
 */
function getMoonHorizonThreshold(distanceKm) {
    const MOON_RADIUS_KM = 1737.4;
    const EARTH_RADIUS_KM = 6378.137;
    const REFRACTION_DEG = -0.566;  // 34 arcminutes atmospheric refraction

    // Moon's angular semi-diameter (in degrees)
    const semiDiameter = Math.atan(MOON_RADIUS_KM / distanceKm) * 180 / Math.PI;

    // Horizontal parallax (in degrees)
    const parallax = Math.atan(EARTH_RADIUS_KM / distanceKm) * 180 / Math.PI;

    // Moonrise/set occurs when upper limb touches horizon
    // h0 = refraction - semi_diameter + parallax
    return REFRACTION_DEG - semiDiameter + parallax;
}

/**
 * Convert ecliptic coordinates to scene position
 * SwissEph returns ecliptic coordinates which need rotation by obliquity
 * to align with Earth's equatorial frame (Earth's pole is Z-up in scene)
 * @param {number} lonDeg - Ecliptic longitude in degrees
 * @param {number} latDeg - Ecliptic latitude in degrees
 * @param {number} distanceEarthRadii - Distance in Earth radii
 * @returns {{x: number, y: number, z: number}} Scene position
 */
function eclipticToScenePosition(lonDeg, latDeg, distanceEarthRadii) {
    const lon = lonDeg * Math.PI / 180;
    const lat = latDeg * Math.PI / 180;

    // Convert to ecliptic cartesian
    const xEcl = distanceEarthRadii * Math.cos(lat) * Math.cos(lon);
    const yEcl = distanceEarthRadii * Math.cos(lat) * Math.sin(lon);
    const zEcl = distanceEarthRadii * Math.sin(lat);

    // Rotate by obliquity around X-axis to convert to equatorial
    const xEq = xEcl;
    const yEq = yEcl * Math.cos(OBLIQUITY_RAD) - zEcl * Math.sin(OBLIQUITY_RAD);
    const zEq = yEcl * Math.sin(OBLIQUITY_RAD) + zEcl * Math.cos(OBLIQUITY_RAD);

    // Map to scene coordinates (Z-up, Y is toward viewer at lon=0)
    // Scene convention: X = toward lon=0, Y = toward lon=90, Z = north pole
    return { x: xEq, y: yEq, z: zEq };
}

/**
 * Get Moon's ecliptic position from Swiss Ephemeris
 * @param {Date} date - Date/time to calculate for
 * @returns {{lon: number, lat: number, distanceAU: number}} Ecliptic coordinates
 */
function getMoonEclipticPosition(date) {
    if (sweInitialized && swe) {
        const jd = dateToJulianDay(date);
        // swe.calc_ut returns [longitude, latitude, distance, lonSpeed, latSpeed, distSpeed]
        // Using default flags (0) for ecliptic coordinates
        const result = swe.calc_ut(jd, swe.SE_MOON, swe.SEFLG_SWIEPH);
        return {
            lon: result[0],  // Ecliptic longitude in degrees
            lat: result[1],  // Ecliptic latitude in degrees
            distanceAU: result[2]  // Distance in AU
        };
    }
    // Fallback: use simple approximation (less accurate)
    const moonPos = getMoonPosition(date);
    return {
        lon: moonPos.lon,
        lat: moonPos.lat,
        distanceAU: 384400 / 149597870.7  // Average moon distance in AU
    };
}

/**
 * Get Moon's position in scene coordinates
 * Uses sublunar point (accounts for Earth's rotation) with accurate distance
 * @param {Date} date - Date/time to calculate for
 * @returns {{x: number, y: number, z: number, distanceSceneUnits: number}}
 */
function getMoonScenePosition(date) {
    // Get sublunar point (lat/lon on Earth under moon, accounts for Earth rotation)
    const moonPos = getMoonPosition(date);

    // Get accurate distance from Swiss Ephemeris
    const distanceKm = getMoonDistance(date);
    const distanceEarthRadii = distanceKm / 6371;
    const distanceSceneUnits = distanceEarthRadii * EARTH_RADIUS;

    // Convert sublunar lat/lon to 3D position at moon's distance
    // Same coordinate system as latLonToCartesian
    const latRad = moonPos.lat * Math.PI / 180;
    const lonRad = moonPos.lon * Math.PI / 180;

    const x = distanceSceneUnits * Math.cos(latRad) * Math.cos(lonRad);
    const y = distanceSceneUnits * Math.cos(latRad) * Math.sin(lonRad);
    const z = distanceSceneUnits * Math.sin(latRad);

    return {
        x: x,
        y: y,
        z: z,
        distanceSceneUnits: distanceSceneUnits
    };
}

/**
 * Update moon mesh position based on current simulation time
 * Only updates if time has changed significantly (every 100ms minimum)
 */
function updateMoonPosition() {
    if (!moonMesh || !scene) return;

    const now = performance.now();
    // Throttle updates to every 100ms for performance
    if (now - lastMoonUpdateTime < 100) return;
    lastMoonUpdateTime = now;

    const simTime = getSimulatedTime();
    const moonPos = getMoonScenePosition(simTime);

    // Update moon mesh position
    moonMesh.position.set(moonPos.x, moonPos.y, moonPos.z);

    // Update debug line from moon to Earth center
    if (false && moonDebugLine) {
        const positions = moonDebugLine.geometry.attributes.position.array;
        // Start point: Earth center (0, 0, 0)
        positions[0] = 0;
        positions[1] = 0;
        positions[2] = 0;
        // End point: Moon position
        positions[3] = moonPos.x;
        positions[4] = moonPos.y;
        positions[5] = moonPos.z;
        moonDebugLine.geometry.attributes.position.needsUpdate = true;
    }
}

/**
 * Create moon mesh and debug line
 */
function createMoon() {
    // Create moon sphere with material that responds to light and shadows
    const moonGeometry = new THREE.SphereGeometry(MOON_RADIUS, 32, 32);
    const moonMaterial = new THREE.MeshStandardMaterial({
        color: 0xaaaaaa,
        roughness: 0.9,
        metalness: 0.0
    });
    moonMesh = new THREE.Mesh(moonGeometry, moonMaterial);
    moonMesh.castShadow = false;    // Casts shadow onto Earth (solar eclipse)
    moonMesh.receiveShadow = true; // Receives shadow from Earth (lunar eclipse)
    scene.add(moonMesh);

    // Create debug line from Earth center to Moon
    const lineGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(6);  // 2 points * 3 coordinates
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const lineMaterial = new THREE.LineBasicMaterial({
        color: 0xff0000,
        linewidth: 2
    });
    moonDebugLine = new THREE.Line(lineGeometry, lineMaterial);
    scene.add(moonDebugLine);

    // Initial position update
    updateMoonPosition();

    console.log('Moon created with radius:', MOON_RADIUS, 'scene units');
}

/**
 * Get Sun's position in scene coordinates for 3D visualization
 * Uses subsolar point (accounts for Earth's rotation) at fixed visual distance
 * @param {Date} date - Date/time to calculate for
 * @returns {{x: number, y: number, z: number}}
 */
function getSunScenePosition(date) {
    // Get subsolar point (lat/lon on Earth under sun, accounts for Earth rotation)
    const sunPos = getSunPosition(date);

    // Convert subsolar lat/lon to 3D direction, then scale to visual distance
    const latRad = sunPos.lat * Math.PI / 180;
    const lonRad = sunPos.lon * Math.PI / 180;

    const x = SUN_VISUAL_DISTANCE * Math.cos(latRad) * Math.cos(lonRad);
    const y = SUN_VISUAL_DISTANCE * Math.cos(latRad) * Math.sin(lonRad);
    const z = SUN_VISUAL_DISTANCE * Math.sin(latRad);

    return { x: x, y: y, z: z };
}

/**
 * Update sun mesh position based on current simulation time
 * Only updates if time has changed significantly (every 100ms minimum)
 */
function updateSunPosition() {
    if (!sunMesh || !scene) return;

    const now = performance.now();
    // Throttle updates to every 100ms for performance
    if (now - lastSunUpdateTime < 100) return;
    lastSunUpdateTime = now;

    const simTime = getSimulatedTime();
    const sunPos = getSunScenePosition(simTime);

    // Update sun mesh position
    sunMesh.position.set(sunPos.x, sunPos.y, sunPos.z);

    // Update debug line from sun to Earth center
    if (false && sunDebugLine) {
        const positions = sunDebugLine.geometry.attributes.position.array;
        // Start point: Earth center (0, 0, 0)
        positions[0] = 0;
        positions[1] = 0;
        positions[2] = 0;
        // End point: Sun position
        positions[3] = sunPos.x;
        positions[4] = sunPos.y;
        positions[5] = sunPos.z;
        sunDebugLine.geometry.attributes.position.needsUpdate = true;
    }

    // Update directional light to point from sun direction
    if (sunLight) {
        sunLight.position.set(sunPos.x, sunPos.y, sunPos.z);
    }

    // Update Earth material sunDirection uniform for day/night blending
    if (earthMaterial && earthMaterial.userData.sunDirection) {
        // Normalize sun position to get direction
        const sunDir = new THREE.Vector3(sunPos.x, sunPos.y, sunPos.z).normalize();
        earthMaterial.userData.sunDirection.value.copy(sunDir);
    }
}

/**
 * Create sun mesh and debug line
 */
function createSun() {
    // Create sun sphere with emissive material (glowing)
    const sunGeometry = new THREE.SphereGeometry(SUN_VISUAL_RADIUS, 32, 32);
    const sunMaterial = new THREE.MeshBasicMaterial({
        color: 0xffff00,
        transparent: false
    });
    sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
    scene.add(sunMesh);

    // Create debug line from Earth center to Sun (green)
    const lineGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(6);  // 2 points * 3 coordinates
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const lineMaterial = new THREE.LineBasicMaterial({
        color: 0x00ff00,
        linewidth: 2
    });
    sunDebugLine = new THREE.Line(lineGeometry, lineMaterial);
    scene.add(sunDebugLine);

    // Initial position update
    updateSunPosition();

    console.log('Sun created with visual radius:', SUN_VISUAL_RADIUS, 'scene units at distance:', SUN_VISUAL_DISTANCE);
}

/**
 * Calculate eclipse cone geometry based on real astronomical values
 * @param {number} moonDistanceKm - Moon's distance from Earth in km
 * @param {number} sunDistanceKm - Sun's distance from Earth in km
 * @returns {Object} Cone geometry parameters
 */
function calculateEclipseConeGeometry(moonDistanceKm, sunDistanceKm) {
    // Distance from Moon to Sun
    const moonSunDistKm = sunDistanceKm - moonDistanceKm;

    // Umbra: internal tangent lines converge toward Earth
    // Half-angle where Sun's edge and Moon's edge meet
    const umbraHalfAngle = Math.atan((SUN_RADIUS_KM - MOON_RADIUS_KM) / moonSunDistKm);

    // Length of umbra cone from Moon's center to apex
    const umbraLengthKm = MOON_RADIUS_KM / Math.tan(umbraHalfAngle);

    // Penumbra: external tangent lines diverge from apex behind Moon
    const penumbraHalfAngle = Math.atan((SUN_RADIUS_KM + MOON_RADIUS_KM) / moonSunDistKm);

    // Distance from Moon's center to penumbra apex (toward Sun)
    const penumbraApexDistKm = MOON_RADIUS_KM / Math.tan(penumbraHalfAngle);

    // Convert to scene units (Earth radii * EARTH_RADIUS)
    const kmToScene = EARTH_RADIUS / EARTH_RADIUS_KM;

    // Penumbra radius at Earth's distance
    const penumbraRadiusAtEarthKm = MOON_RADIUS_KM + moonDistanceKm * Math.tan(penumbraHalfAngle);

    // Check if umbra reaches Earth (total eclipse possible)
    const umbraReachesEarth = umbraLengthKm > moonDistanceKm;

    // If umbra doesn't reach Earth, calculate antumbra
    let antumbraHalfAngle = 0;
    if (!umbraReachesEarth) {
        // Antumbra starts at umbra apex and diverges
        antumbraHalfAngle = umbraHalfAngle; // Same angle, opposite direction
    }

    return {
        // Umbra parameters
        umbraHalfAngle: umbraHalfAngle,
        umbraLengthScene: umbraLengthKm * kmToScene,
        umbraBaseRadiusScene: MOON_RADIUS_KM * kmToScene,

        // Penumbra parameters
        penumbraHalfAngle: penumbraHalfAngle,
        penumbraApexDistScene: penumbraApexDistKm * kmToScene,
        penumbraLengthScene: (moonDistanceKm + penumbraApexDistKm) * kmToScene,
        penumbraRadiusAtEarthScene: penumbraRadiusAtEarthKm * kmToScene,

        // Antumbra parameters (only valid if umbra doesn't reach Earth)
        umbraReachesEarth: umbraReachesEarth,
        antumbraHalfAngle: antumbraHalfAngle,
        antumbraStartDistScene: umbraLengthKm * kmToScene,  // Distance from Moon where antumbra starts

        // For calculations
        moonDistanceScene: moonDistanceKm * kmToScene
    };
}

/**
 * Create eclipse shadow cones
 */
function createEclipseCones() {
    // Umbra cone - dark shadow, apex toward Earth
    const umbraGeometry = new THREE.ConeGeometry(1, 1, 32, 1, true);
    const umbraMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    umbraCone = new THREE.Mesh(umbraGeometry, umbraMaterial);
    umbraCone.visible = true;
    scene.add(umbraCone);

    // Penumbra cone - light gray shadow, apex toward Sun
    const penumbraGeometry = new THREE.ConeGeometry(1, 1, 32, 1, true);
    const penumbraMaterial = new THREE.MeshBasicMaterial({
        color: 0x444444,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    penumbraCone = new THREE.Mesh(penumbraGeometry, penumbraMaterial);
    penumbraCone.visible = true;
    scene.add(penumbraCone);

    // Antumbra cone - red shadow, extends from umbra apex toward Earth
    const antumbraGeometry = new THREE.ConeGeometry(1, 1, 32, 1, true);
    const antumbraMaterial = new THREE.MeshBasicMaterial({
        color: 0x880000,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    antumbraCone = new THREE.Mesh(antumbraGeometry, antumbraMaterial);
    antumbraCone.visible = false;  // Only visible for annular eclipses
    scene.add(antumbraCone);

    console.log('Eclipse cones created');
}

/**
 * Update eclipse cone positions and sizes based on current sun/moon positions
 */
function updateEclipseCones() {
    if (!umbraCone || !penumbraCone || !antumbraCone) return;

    const simTime = getSimulatedTime();

    // Calculate moon position directly (not from mesh which may be throttled)
    const moonScenePos = getMoonScenePosition(simTime);
    const moonPos = new THREE.Vector3(moonScenePos.x, moonScenePos.y, moonScenePos.z);

    // Update moon mesh position in sync with uniforms (bypass throttling)
    if (moonMesh) {
        moonMesh.position.copy(moonPos);
    }

    // Update Earth material moonPosition uniform for eclipse darkening shader
    if (earthMaterial && earthMaterial.userData.moonPosition) {
        earthMaterial.userData.moonPosition.value.copy(moonPos);
    }

    // Calculate sun direction directly (not from mesh which may be throttled)
    const sunScenePos = getSunScenePosition(simTime);
    const sunDir = new THREE.Vector3(sunScenePos.x, sunScenePos.y, sunScenePos.z).normalize();

    // Update sun mesh position in sync with uniforms (bypass throttling)
    if (sunMesh) {
        sunMesh.position.set(sunScenePos.x, sunScenePos.y, sunScenePos.z);
    }

    // Update Earth material sunDirection uniform for eclipse darkening shader (non-throttled)
    if (earthMaterial && earthMaterial.userData.sunDirection) {
        earthMaterial.userData.sunDirection.value.copy(sunDir);
    }

    // Check angular separation between moon and sun - only show cones near eclipse
    const moonDir = moonPos.clone().normalize();
    const angularSepRad = Math.acos(Math.max(-1, Math.min(1, moonDir.dot(sunDir))));
    const angularSepDeg = angularSepRad * 180 / Math.PI;
    const ECLIPSE_THRESHOLD_DEG = 5;  // Show cones within 5 degrees of alignment

    if (angularSepDeg > ECLIPSE_THRESHOLD_DEG) {
        umbraCone.visible = false;
        penumbraCone.visible = false;
        antumbraCone.visible = false;
        return;
    }

    // Within eclipse threshold - show umbra and penumbra (antumbra controlled separately)
    umbraCone.visible = true;
    penumbraCone.visible = true;

    // Get real distances in km
    const moonDistanceKm = getMoonDistance(simTime);
    const sunDistanceKm = AU_KM;  // Sun distance is approximately 1 AU

    // Calculate cone geometry
    const coneParams = calculateEclipseConeGeometry(moonDistanceKm, sunDistanceKm);

    // Shadow direction: opposite to sun direction (shadow travels away from Sun)
    // This is parallel rays from Sun, so shadow direction is same everywhere
    const shadowDir = sunDir.clone().negate();

    // Direction toward Sun
    const towardSun = sunDir;

    // === UMBRA CONE ===
    // Dark inner shadow - base at Moon, apex points away from Sun (toward Earth)
    // Three.js ConeGeometry: apex at +Y, base at -Y
    const umbraLength = Math.min(coneParams.umbraLengthScene, coneParams.moonDistanceScene * 1.5);
    const umbraBaseRadius = coneParams.umbraBaseRadiusScene;

    umbraCone.scale.set(umbraBaseRadius, umbraLength, umbraBaseRadius);

    // Position: cone center is at Moon + half length along shadow direction
    const umbraCenter = new THREE.Vector3().copy(moonPos).addScaledVector(shadowDir, umbraLength / 2);
    umbraCone.position.copy(umbraCenter);

    // Orient: +Y (apex) points along shadow direction (away from Sun)
    const umbraQuaternion = new THREE.Quaternion();
    umbraQuaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), shadowDir);
    umbraCone.quaternion.copy(umbraQuaternion);

    // === PENUMBRA CONE ===
    // Outer partial shadow - apex is between Moon and Sun, expands toward Earth
    // Apex is at Moon + penumbraApexDist in the direction TOWARD Sun
    const penumbraApexPos = new THREE.Vector3().copy(moonPos).addScaledVector(towardSun, coneParams.penumbraApexDistScene);

    // Penumbra extends from apex toward Earth
    // Length from apex to Earth = penumbraApexDist + moonDistance
    const penumbraLength = coneParams.penumbraApexDistScene + coneParams.moonDistanceScene;
    const penumbraBaseRadius = coneParams.penumbraRadiusAtEarthScene;

    penumbraCone.scale.set(penumbraBaseRadius, penumbraLength, penumbraBaseRadius);

    // Position: center is at apex + half length along shadow direction
    const penumbraCenter = new THREE.Vector3().copy(penumbraApexPos).addScaledVector(shadowDir, penumbraLength / 2);
    penumbraCone.position.copy(penumbraCenter);

    // Orient: +Y (apex) points toward Sun (opposite of shadow direction)
    // This means base (wide end) points toward Earth
    const penumbraQuaternion = new THREE.Quaternion();
    penumbraQuaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), towardSun);
    penumbraCone.quaternion.copy(penumbraQuaternion);

    // === ANTUMBRA CONE ===
    // Only visible when umbra doesn't reach Earth (annular eclipse)
    // Antumbra diverges from umbra apex toward Earth
    if (!coneParams.umbraReachesEarth) {
        antumbraCone.visible = true;

        // Umbra apex position (tip of umbra cone)
        const umbraApexPos = new THREE.Vector3().copy(moonPos).addScaledVector(shadowDir, coneParams.umbraLengthScene);

        // Distance from umbra apex to Earth center
        const apexToEarthDist = coneParams.moonDistanceScene - coneParams.umbraLengthScene;

        // Antumbra extends from apex toward Earth and slightly beyond
        const antumbraLength = apexToEarthDist + EARTH_RADIUS * 0.5;

        // Radius at Earth's distance from apex
        const antumbraRadiusAtEarth = apexToEarthDist * Math.tan(coneParams.antumbraHalfAngle);

        antumbraCone.scale.set(antumbraRadiusAtEarth, antumbraLength, antumbraRadiusAtEarth);

        // Position: center is at apex + half length along shadow direction
        const antumbraCenter = new THREE.Vector3().copy(umbraApexPos).addScaledVector(shadowDir, antumbraLength / 2);
        antumbraCone.position.copy(antumbraCenter);

        // Orient: +Y (apex) points back toward Moon (opposite shadow direction)
        // This means base (wide end) points toward Earth
        const antumbraQuaternion = new THREE.Quaternion();
        antumbraQuaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), towardSun);
        antumbraCone.quaternion.copy(antumbraQuaternion);
    } else {
        antumbraCone.visible = false;
    }
}

/**
 * Calculate accurate moonrise/moonset times using Swiss Ephemeris
 * Uses Moon's actual distance to compute parallax and angular radius corrections
 * @param {number} lat - Observer latitude
 * @param {number} lon - Observer longitude
 * @param {number} cityTzHours - City timezone offset in hours
 * @returns {{rise: object|null, set: object|null}}
 */
function calculateMoonRiseSetTimes(lat, lon, cityTzHours = 0) {
    // Use base date (noon in city's timezone)
    let now;
    if (selectedDate) {
        now = new Date(selectedDate);
        now.setHours(12, 0, 0, 0);
    } else {
        now = new Date();
    }

    // Adjust base time to represent noon in the city's timezone
    const userTzMinutes = -now.getTimezoneOffset();
    const cityTzMinutes = cityTzHours * 60;
    const tzDiffMinutes = cityTzMinutes - userTzMinutes;
    now = new Date(now.getTime() - tzDiffMinutes * 60 * 1000);

    const latRad = lat * Math.PI / 180;

    // Search for rise/set times with 5-minute resolution for better accuracy
    const checkPoints = [];
    for (let i = -720; i <= 720; i += 5) {
        const checkTime = new Date(now.getTime() + i * 60 * 1000);
        const moonPos = getMoonPosition(checkTime);
        const moonDistance = getMoonDistance(checkTime);
        const horizonThreshold = getMoonHorizonThreshold(moonDistance);

        // Calculate hour angle
        const bodyLonRad = moonPos.lon * Math.PI / 180;
        const bodyLatRad = moonPos.lat * Math.PI / 180;
        const lonRad = lon * Math.PI / 180;

        // Local hour angle
        const ha = lonRad - bodyLonRad;

        // Altitude calculation (geocentric)
        const sinAlt = Math.sin(latRad) * Math.sin(bodyLatRad) +
                       Math.cos(latRad) * Math.cos(bodyLatRad) * Math.cos(ha);
        const altitude = Math.asin(sinAlt) * 180 / Math.PI;

        // Store altitude relative to the dynamic horizon threshold
        checkPoints.push({
            offset: i,
            altitude: altitude,
            threshold: horizonThreshold,
            correctedAlt: altitude - horizonThreshold  // Positive = above horizon
        });
    }

    // Find crossings of corrected horizon (where correctedAlt crosses 0)
    let rise = null, set = null;
    for (let i = 1; i < checkPoints.length; i++) {
        const prev = checkPoints[i - 1];
        const curr = checkPoints[i];

        if (prev.correctedAlt < 0 && curr.correctedAlt >= 0 && !rise) {
            // Rising - interpolate
            const t = -prev.correctedAlt / (curr.correctedAlt - prev.correctedAlt);
            const offset = prev.offset + t * 5;
            const riseTime = new Date(now.getTime() + offset * 60 * 1000);
            rise = { offset, label: formatShortTime(riseTime), time: riseTime };
        }
        if (prev.correctedAlt >= 0 && curr.correctedAlt < 0 && !set) {
            // Setting - interpolate
            const t = prev.correctedAlt / (prev.correctedAlt - curr.correctedAlt);
            const offset = prev.offset + t * 5;
            const setTime = new Date(now.getTime() + offset * 60 * 1000);
            set = { offset, label: formatShortTime(setTime), time: setTime };
        }
    }

    return { rise, set };
}

/**
 * Format time as short string
 */
function formatShortTime(date) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * Get the lat/lon position directly below the camera
 */
function getCameraGroundPosition() {
    if (!camera) return { lat: 0, lon: 0 };
    const camPos = camera.position.clone().normalize();
    const lat = Math.asin(camPos.z) * 180 / Math.PI;
    const lon = Math.atan2(camPos.y, camPos.x) * 180 / Math.PI;
    return { lat, lon };
}

/**
 * Get moon phase name from phase value (0-1)
 */
function getMoonPhaseName(phase) {
    // Normalize phase to 0-1
    phase = ((phase % 1) + 1) % 1;

    if (phase < 0.03 || phase >= 0.97) return 'New Moon';
    if (phase < 0.22) return 'Waxing Crescent';
    if (phase < 0.28) return 'First Quarter';
    if (phase < 0.47) return 'Waxing Gibbous';
    if (phase < 0.53) return 'Full Moon';
    if (phase < 0.72) return 'Waning Gibbous';
    if (phase < 0.78) return 'Last Quarter';
    return 'Waning Crescent';
}

/**
 * Calculate moon illumination percentage from phase
 */
function getMoonIllumination(phase) {
    // Illumination follows a cosine curve: 0 at new, 100 at full
    phase = ((phase % 1) + 1) % 1;
    return Math.round((1 - Math.cos(phase * 2 * Math.PI)) / 2 * 100);
}

/**
 * Update position display
 */
function updatePositionDisplay() {
    const latEl = document.getElementById('lat-value');
    const lonEl = document.getElementById('lon-value');
    const utcEl = document.getElementById('utc-value');
    const datetimeOdometer = document.querySelector('.datetime-odometer');

    // New celestial box elements - naval style
    const sunIcon = document.getElementById('sun-icon');
    const sunAltEl = document.getElementById('sun-altitude-value');
    const sunAzEl = document.getElementById('sun-azimuth');
    const sunDaylightEl = document.getElementById('sun-daylight-info');
    const sunNextEventEl = document.getElementById('sun-next-event');
    const sunDistEl = document.getElementById('sun-distance');

    const moonIcon = document.getElementById('moon-icon');
    const moonAltEl = document.getElementById('moon-altitude-value');
    const moonAzEl = document.getElementById('moon-azimuth');
    const moonPhaseEl = document.getElementById('moon-phase-name');
    const moonIllumEl = document.getElementById('moon-illumination');
    const moonShadow = document.querySelector('.moon-shadow');
    const moonAgeEl = document.getElementById('moon-age');
    const moonDistEl = document.getElementById('moon-distance');
    const moonNextEventEl = document.getElementById('moon-next-event');

    if (!latEl || !lonEl) return;

    // Update timezone tracking when pointer moves (keeps sun/moon stable)
    updateSliderForTimezone();

    // Use focus point position (not camera position)
    const lat = focusPointLat;
    const lon = focusPointLon;
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';

    latEl.textContent = `${Math.abs(lat).toFixed(2)}°${latDir}`;
    lonEl.textContent = `${Math.abs(lon).toFixed(2)}°${lonDir}`;

    // Find closest city for timezone and display
    const closestCity = findClosestCity(lat, lon);
    const simTime = getAbsoluteSimulatedTime();  // Use absolute time, not timezone-adjusted
    const cityTz = closestCity ? closestCity.tz : 0;

    // Helper to convert UTC time to city local time string (short format)
    const formatCityTimeShort = (date) => {
        if (!date) return '--:--';
        const utcTime = date.getTime() + date.getTimezoneOffset() * 60 * 1000;
        const cityTime = new Date(utcTime + cityTz * 60 * 60 * 1000);
        const hours = cityTime.getHours();
        const mins = cityTime.getMinutes();
        const displayHours = hours % 12 || 12;
        const ampm = hours >= 12 ? 'p' : 'a';
        return `${displayHours}:${mins.toString().padStart(2, '0')}${ampm}`;
    };

    // Update carousel highlight
    if (window.updateCarouselHighlight) {
        window.updateCarouselHighlight();
    }

    // Display city's UTC offset
    if (utcEl && closestCity) {
        const tz = closestCity.tz;
        const sign = tz >= 0 ? '+' : '';
        const hours = Math.floor(Math.abs(tz));
        const mins = Math.round((Math.abs(tz) - hours) * 60);
        if (mins === 0) {
            utcEl.textContent = `${sign}${tz}`;
        } else {
            utcEl.textContent = `${sign}${hours}:${mins.toString().padStart(2, '0')}`;
        }
    }

    // Display local datetime for the city with live/simulated state
    const timeIndicator = document.getElementById('time-indicator');
    const isFullyLive = isLiveMode;

    const cityUtcOffsetEl = document.getElementById('city-utc-offset');

    const dayNamesShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    if (datetimeOdometer && closestCity) {
        const utcTime = simTime.getTime() + simTime.getTimezoneOffset() * 60 * 1000;
        const cityTime = new Date(utcTime + closestCity.tz * 60 * 60 * 1000);
        const hours = cityTime.getHours();
        const mins = cityTime.getMinutes();

        // Update scroll wheel displays
        updateWheelsFromTime(hours, mins, cityTime.getMonth(), cityTime.getDate(), cityTime.getFullYear());

        // Apply live/simulated/paused classes
        datetimeOdometer.classList.toggle('live', isFullyLive && !isPaused);
        datetimeOdometer.classList.toggle('simulated', !isFullyLive && !isPaused);
        datetimeOdometer.classList.toggle('paused', isPaused);

        // Update city UTC offset
        if (cityUtcOffsetEl) {
            const tz = closestCity.tz;
            const sign = tz >= 0 ? '+' : '';
            const tzHours = Math.floor(Math.abs(tz));
            const tzMins = Math.round((Math.abs(tz) - tzHours) * 60);

            if (tzMins === 0) {
                cityUtcOffsetEl.textContent = `UTC${sign}${Math.floor(tz)}`;
            } else {
                cityUtcOffsetEl.textContent = `UTC${sign}${tzHours}:${tzMins.toString().padStart(2, '0')}`;
            }
        }
    }

    if (timeIndicator) {
        timeIndicator.classList.toggle('live', isFullyLive && !isPaused);
        timeIndicator.classList.toggle('simulated', !isFullyLive && !isPaused);
        timeIndicator.classList.toggle('paused', isPaused);
        // Remove pulse animation when paused
        timeIndicator.classList.toggle('pulse', !isPaused);
    }

    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;

    // Get sun rise/set times and calculate visibility duration
    const sunTimes = calculateRiseSetTimes(lat, lon, getSunPosition, cityTz, -0.833);

    // Helper to format duration as hours:minutes
    const formatDuration = (minutes) => {
        if (minutes <= 0) return '0h';
        const h = Math.floor(minutes / 60);
        const m = Math.round(minutes % 60);
        if (h === 0) return `${m}m`;
        if (m === 0) return `${h}h`;
        return `${h}h ${m}m`;
    };

    // Helper to convert azimuth to compass direction
    const getCompassDir = (az) => {
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const index = Math.round(az / 45) % 8;
        return dirs[index];
    };

    // Calculate sun altitude and azimuth
    const sunPos = getSunPosition(simTime);
    const sunLatRad = sunPos.lat * Math.PI / 180;
    const sunLonRad = sunPos.lon * Math.PI / 180;
    const sunHa = lonRad - sunLonRad;
    const sunSinAlt = Math.sin(latRad) * Math.sin(sunLatRad) +
                      Math.cos(latRad) * Math.cos(sunLatRad) * Math.cos(sunHa);
    const sunAltitude = Math.asin(sunSinAlt) * 180 / Math.PI;

    // Azimuth calculation
    const sunCosAz = (Math.sin(sunLatRad) - Math.sin(latRad) * sunSinAlt) /
                     (Math.cos(latRad) * Math.cos(Math.asin(sunSinAlt)));
    let sunAzimuth = Math.acos(Math.max(-1, Math.min(1, sunCosAz))) * 180 / Math.PI;
    if (Math.sin(sunHa) > 0) sunAzimuth = 360 - sunAzimuth;

    const sunAboveHorizon = sunAltitude >= 0;

    // Update sun altitude display
    if (sunAltEl) {
        sunAltEl.textContent = `${sunAboveHorizon ? '+' : ''}${sunAltitude.toFixed(0)}°`;
        sunAltEl.classList.toggle('above', sunAboveHorizon);
        sunAltEl.classList.toggle('below', !sunAboveHorizon);
    }

    // Update sun azimuth display
    if (sunAzEl) {
        sunAzEl.textContent = `${Math.round(sunAzimuth).toString().padStart(3, '0')}°`;
    }

    // Update sun icon state
    if (sunIcon) {
        sunIcon.classList.toggle('below', !sunAboveHorizon);
    }

    // Update daylight info
    if (sunDaylightEl) {
        if (sunTimes.rise && sunTimes.set) {
            const visMins = sunTimes.set.offset - sunTimes.rise.offset;
            const daylight = visMins > 0 ? visMins : 1440 + visMins;
            sunDaylightEl.textContent = `${formatDuration(daylight)} daylight`;
        } else if (!sunTimes.rise && !sunTimes.set) {
            sunDaylightEl.textContent = sunSinAlt > 0 ? 'Polar day' : 'Polar night';
        } else {
            sunDaylightEl.textContent = '--';
        }
    }

    // Update next sunrise/sunset countdown
    if (sunNextEventEl) {
        const nextSunEvent = findNextRiseSet(lat, lon, getSunPosition, simTime, -0.833);
        if (nextSunEvent) {
            const totalMins = Math.floor(nextSunEvent.msUntil / (60 * 1000));
            const days = Math.floor(totalMins / (24 * 60));
            const hours = Math.floor((totalMins % (24 * 60)) / 60);
            const mins = totalMins % 60;

            if (days > 0) {
                sunNextEventEl.textContent = `${nextSunEvent.type} in ${days}d ${hours}h`;
            } else if (hours > 0) {
                sunNextEventEl.textContent = `${nextSunEvent.type} in ${hours}h ${mins}m`;
            } else {
                sunNextEventEl.textContent = `${nextSunEvent.type} in ${mins}m`;
            }
        } else {
            sunNextEventEl.textContent = '';
        }
    }

    // Update sun distance
    if (sunDistEl) {
        const sunDist = getSunDistance(simTime);
        sunDistEl.textContent = `${sunDist.toFixed(1)}M km`;
    }

    // Calculate moon altitude and azimuth
    const moonPos = getMoonPosition(simTime);
    const moonLatRad = moonPos.lat * Math.PI / 180;
    const moonLonRad = moonPos.lon * Math.PI / 180;
    const moonHa = lonRad - moonLonRad;
    const moonSinAlt = Math.sin(latRad) * Math.sin(moonLatRad) +
                       Math.cos(latRad) * Math.cos(moonLatRad) * Math.cos(moonHa);
    const moonAltitude = Math.asin(moonSinAlt) * 180 / Math.PI;

    // Moon azimuth calculation
    const moonCosAz = (Math.sin(moonLatRad) - Math.sin(latRad) * moonSinAlt) /
                      (Math.cos(latRad) * Math.cos(Math.asin(moonSinAlt)));
    let moonAzimuth = Math.acos(Math.max(-1, Math.min(1, moonCosAz))) * 180 / Math.PI;
    if (Math.sin(moonHa) > 0) moonAzimuth = 360 - moonAzimuth;

    const moonAboveHorizon = moonAltitude >= 0;

    // Update moon altitude display
    if (moonAltEl) {
        moonAltEl.textContent = `${moonAboveHorizon ? '+' : ''}${moonAltitude.toFixed(0)}°`;
        moonAltEl.classList.toggle('above', moonAboveHorizon);
        moonAltEl.classList.toggle('below', !moonAboveHorizon);
    }

    // Update moon azimuth display
    if (moonAzEl) {
        moonAzEl.textContent = `${Math.round(moonAzimuth).toString().padStart(3, '0')}°`;
    }

    // Update moon icon state
    if (moonIcon) {
        moonIcon.classList.toggle('below', !moonAboveHorizon);
    }

    // Update moon phase display
    const moonPhase = moonPos.phase;
    if (moonPhaseEl) {
        moonPhaseEl.textContent = getMoonPhaseName(moonPhase);
    }

    // Update moon illumination
    const moonIllum = getMoonIllumination(moonPhase);
    if (moonIllumEl) {
        moonIllumEl.textContent = `${moonIllum}%`;
    }

    // Update moon shadow to show phase visually
    if (moonShadow) {
        // Phase 0 = new moon (fully shadowed from right)
        // Phase 0.5 = full moon (no shadow)
        // Phase 1 = new moon again
        const normalizedPhase = ((moonPhase % 1) + 1) % 1;

        if (normalizedPhase < 0.5) {
            // Waxing: shadow moves from right to left
            const shadowPercent = (1 - normalizedPhase * 2) * 100;
            moonShadow.style.background = `linear-gradient(to right, transparent ${100 - shadowPercent}%, rgba(0, 0, 20, 0.85) ${100 - shadowPercent}%)`;
        } else {
            // Waning: shadow moves from left to right
            const shadowPercent = (normalizedPhase - 0.5) * 2 * 100;
            moonShadow.style.background = `linear-gradient(to left, transparent ${100 - shadowPercent}%, rgba(0, 0, 20, 0.85) ${100 - shadowPercent}%)`;
        }
    }

    // Get moon distance for display
    const moonDistance = getMoonDistance(simTime);

    // Calculate and display moon age (days since new moon)
    if (moonAgeEl) {
        // Moon phase 0 = new moon, so age = phase * synodic month (29.53 days)
        const synodicMonth = 29.53059;
        const moonAge = moonPhase * synodicMonth;
        moonAgeEl.textContent = `${moonAge.toFixed(1)}d old`;
    }

    // Display moon distance
    if (moonDistEl) {
        // Format distance in thousands of km
        const distK = Math.round(moonDistance / 1000);
        moonDistEl.textContent = `${distK.toLocaleString()}k km`;
    }

    // Update next moonrise/moonset countdown
    if (moonNextEventEl) {
        try {
            // Moon horizon threshold ~+0.125° (refraction minus parallax, approximate)
            const nextMoonEvent = findNextRiseSet(lat, lon, getMoonPosition, simTime, 0.125);
            if (nextMoonEvent) {
                const totalMins = Math.floor(nextMoonEvent.msUntil / (60 * 1000));
                const days = Math.floor(totalMins / (24 * 60));
                const hours = Math.floor((totalMins % (24 * 60)) / 60);
                const mins = totalMins % 60;

                if (days > 0) {
                    moonNextEventEl.textContent = `${nextMoonEvent.type} in ${days}d ${hours}h`;
                } else if (hours > 0) {
                    moonNextEventEl.textContent = `${nextMoonEvent.type} in ${hours}h ${mins}m`;
                } else {
                    moonNextEventEl.textContent = `${nextMoonEvent.type} in ${mins}m`;
                }
            } else {
                moonNextEventEl.textContent = '';
            }
        } catch (e) {
            moonNextEventEl.textContent = '';
        }
    }
}

/**
 * Update all event markers on slider (sunrise, sunset, moonrise, moonset)
 */
function updateEventMarkers() {
    if (!camera) return;

    // Use focus point position (not camera position)
    const groundPos = { lat: focusPointLat, lon: focusPointLon };
    // Slider now uses 0-1440 (midnight to midnight in local time)
    const minOffset = 0;
    const maxOffset = 1440;

    // Get closest city for timezone
    const closestCity = findClosestCity(groundPos.lat, groundPos.lon);
    const cityTz = closestCity ? closestCity.tz : 0;

    // Helper to format time in city local timezone
    const formatCityTimeShort = (date) => {
        if (!date) return '';
        const utcTime = date.getTime() + date.getTimezoneOffset() * 60 * 1000;
        const cityTime = new Date(utcTime + cityTz * 60 * 60 * 1000);
        const hours = cityTime.getHours();
        const mins = cityTime.getMinutes();
        const displayHours = hours % 12 || 12;
        const ampm = hours >= 12 ? 'p' : 'a';
        return `${displayHours}:${mins.toString().padStart(2, '0')}${ampm}`;
    };

    // Calculate sun times (pass city timezone)
    const sunTimes = calculateRiseSetTimes(groundPos.lat, groundPos.lon, getSunPosition, cityTz, -0.833);

    // Calculate moon times with accurate parallax/angular radius correction
    const moonTimes = calculateMoonRiseSetTimes(groundPos.lat, groundPos.lon, cityTz);

    // Helper to position marker using percentage for proper alignment
    // Note: data.offset from calculateRiseSetTimes is relative to noon (-720 to 720)
    // Convert to new scale (0-1440 from midnight): newOffset = oldOffset + 720
    const positionMarker = (id, data) => {
        const marker = document.getElementById(id);
        if (!marker) return;

        if (data && data.offset !== undefined) {
            // Convert from noon-based offset to midnight-based offset
            const adjustedOffset = data.offset + 720;
            if (adjustedOffset >= minOffset && adjustedOffset <= maxOffset) {
                const percent = (adjustedOffset - minOffset) / (maxOffset - minOffset) * 100;
                marker.style.left = `${percent}%`;
                marker.style.display = 'block';
                // Use city local time for label
                marker.setAttribute('data-label', formatCityTimeShort(data.time));
            } else {
                marker.style.display = 'none';
            }
        } else {
            marker.style.display = 'none';
        }
    };

    positionMarker('sunrise-marker', sunTimes.rise);
    positionMarker('sunset-marker', sunTimes.set);
    positionMarker('moonrise-marker', moonTimes.rise);
    positionMarker('moonset-marker', moonTimes.set);

    // NOW marker always at center (current time = offset 0)
    const nowMarker = document.getElementById('now-marker');
    if (nowMarker) {
        nowMarker.style.left = '50%';
    }

    // Update sun visibility bars
    const sunBar = document.getElementById('sun-visibility-bar');
    const sunBar2 = document.getElementById('sun-visibility-bar-2');
    if (sunBar && sunBar2) {
        const sunRiseOffset = sunTimes.rise ? sunTimes.rise.offset + 720 : null;
        const sunSetOffset = sunTimes.set ? sunTimes.set.offset + 720 : null;

        // Check if sun is currently above horizon (for polar day/night)
        const simTime = getAbsoluteSimulatedTime();
        const sunPos = getSunPosition(simTime);
        const latRad = groundPos.lat * Math.PI / 180;
        const lonRad = groundPos.lon * Math.PI / 180;
        const sunLatRad = sunPos.lat * Math.PI / 180;
        const sunLonRad = sunPos.lon * Math.PI / 180;
        const sunHa = lonRad - sunLonRad;
        const sunSinAlt = Math.sin(latRad) * Math.sin(sunLatRad) +
                          Math.cos(latRad) * Math.cos(sunLatRad) * Math.cos(sunHa);
        const sunIsUp = sunSinAlt > 0;

        // Helper to set bar position with edge extension for border-radius compensation
        const setBarPosition = (bar, startOffset, endOffset) => {
            const startPct = (startOffset / 1440) * 100;
            const endPct = (endOffset / 1440) * 100;
            const atStart = startOffset === 0;
            const atEnd = endOffset === 1440;

            // Extend by 6px at edges to align with tick marks
            if (atStart && atEnd) {
                bar.style.left = 'calc(0% - 6px)';
                bar.style.width = 'calc(100% + 12px)';
            } else if (atStart) {
                bar.style.left = 'calc(0% - 6px)';
                bar.style.width = `calc(${endPct}% + 6px)`;
            } else if (atEnd) {
                bar.style.left = `${startPct}%`;
                bar.style.width = `calc(${endPct - startPct}% + 6px)`;
            } else {
                bar.style.left = `${startPct}%`;
                bar.style.width = `${endPct - startPct}%`;
            }
            bar.classList.add('visible');
        };

        // Reset both bars
        sunBar.classList.remove('visible');
        sunBar2.classList.remove('visible');

        if (sunRiseOffset !== null && sunSetOffset !== null) {
            if (sunSetOffset < sunRiseOffset) {
                // Sun sets before it rises - two bars with gap in middle
                setBarPosition(sunBar, 0, sunSetOffset);
                setBarPosition(sunBar2, sunRiseOffset, 1440);
            } else {
                // Normal day: sunrise to sunset - single bar
                setBarPosition(sunBar, sunRiseOffset, sunSetOffset);
            }
        } else if (sunRiseOffset === null && sunSetOffset === null) {
            // Polar day or polar night
            if (sunIsUp) {
                setBarPosition(sunBar, 0, 1440);
            }
        } else if (sunRiseOffset !== null && sunSetOffset === null) {
            // Sun rises but doesn't set
            setBarPosition(sunBar, sunRiseOffset, 1440);
        } else if (sunRiseOffset === null && sunSetOffset !== null) {
            // Sun sets but doesn't rise
            setBarPosition(sunBar, 0, sunSetOffset);
        }
    }

    // Update moon visibility bars
    const moonBar = document.getElementById('moon-visibility-bar');
    const moonBar2 = document.getElementById('moon-visibility-bar-2');
    if (moonBar && moonBar2) {
        const moonRiseOffset = moonTimes.rise ? moonTimes.rise.offset + 720 : null;
        const moonSetOffset = moonTimes.set ? moonTimes.set.offset + 720 : null;

        // Check if moon is currently above horizon
        const simTime = getAbsoluteSimulatedTime();
        const moonPos = getMoonPosition(simTime);
        const latRad = groundPos.lat * Math.PI / 180;
        const lonRad = groundPos.lon * Math.PI / 180;
        const moonLatRad = moonPos.lat * Math.PI / 180;
        const moonLonRad = moonPos.lon * Math.PI / 180;
        const moonHa = lonRad - moonLonRad;
        const moonSinAlt = Math.sin(latRad) * Math.sin(moonLatRad) +
                           Math.cos(latRad) * Math.cos(moonLatRad) * Math.cos(moonHa);
        const moonIsUp = moonSinAlt > 0;

        // Helper to set bar position with edge extension for border-radius compensation
        const setMoonBarPosition = (bar, startOffset, endOffset) => {
            const startPct = (startOffset / 1440) * 100;
            const endPct = (endOffset / 1440) * 100;
            const atStart = startOffset === 0;
            const atEnd = endOffset === 1440;

            // Extend by 6px at edges to align with tick marks
            if (atStart && atEnd) {
                bar.style.left = 'calc(0% - 6px)';
                bar.style.width = 'calc(100% + 12px)';
            } else if (atStart) {
                bar.style.left = 'calc(0% - 6px)';
                bar.style.width = `calc(${endPct}% + 6px)`;
            } else if (atEnd) {
                bar.style.left = `${startPct}%`;
                bar.style.width = `calc(${endPct - startPct}% + 6px)`;
            } else {
                bar.style.left = `${startPct}%`;
                bar.style.width = `${endPct - startPct}%`;
            }
            bar.classList.add('visible');
        };

        // Reset both bars
        moonBar.classList.remove('visible');
        moonBar2.classList.remove('visible');

        if (moonRiseOffset !== null && moonSetOffset !== null) {
            if (moonSetOffset < moonRiseOffset) {
                // Moon sets before it rises - two bars with gap in middle
                setMoonBarPosition(moonBar, 0, moonSetOffset);
                setMoonBarPosition(moonBar2, moonRiseOffset, 1440);
            } else {
                // Normal: moonrise to moonset - single bar
                setMoonBarPosition(moonBar, moonRiseOffset, moonSetOffset);
            }
        } else if (moonRiseOffset === null && moonSetOffset === null) {
            // Moon always up or always down
            if (moonIsUp) {
                setMoonBarPosition(moonBar, 0, 1440);
            }
        } else if (moonRiseOffset !== null && moonSetOffset === null) {
            // Moon rises but doesn't set
            setMoonBarPosition(moonBar, moonRiseOffset, 1440);
        } else if (moonRiseOffset === null && moonSetOffset !== null) {
            // Moon sets but doesn't rise
            setMoonBarPosition(moonBar, 0, moonSetOffset);
        }
    }
}

/**
 * Update day nav button labels (no-op, buttons removed)
 */
function updateDayNavButtons() {
    // Day nav buttons removed - function kept as no-op for compatibility
}

/**
 * Update the time display UI
 */
function updateTimeDisplay() {
    const liveBtn = document.getElementById('live-btn');
    const slider = document.getElementById('time-slider');
    const calendarBtn = document.getElementById('calendar-btn');

    const isFullyLive = isLiveMode && !isPaused;

    const liveBtnWrapper = document.getElementById('live-btn-wrapper');

    if (isFullyLive) {
        if (liveBtn) {
            liveBtn.classList.add('active');
            liveBtn.disabled = true;
        }
        if (liveBtnWrapper) liveBtnWrapper.title = 'Already live';
        if (slider) slider.classList.add('live');
        if (calendarBtn) calendarBtn.classList.remove('date-selected');
    } else {
        if (liveBtn) {
            liveBtn.classList.remove('active');
            liveBtn.disabled = false;
        }
        if (liveBtnWrapper) liveBtnWrapper.title = isPaused ? 'Unpause and reset to live' : 'Reset to live';
        if (slider) slider.classList.remove('live');

        if (selectedDate) {
            if (calendarBtn) calendarBtn.classList.add('date-selected');
        } else {
            if (calendarBtn) calendarBtn.classList.remove('date-selected');
        }
    }
}

// New moon dates (2024-2026)
const NEW_MOONS = [
    // 2024
    '2024-01-11', '2024-02-09', '2024-03-10', '2024-04-08', '2024-05-08', '2024-06-06',
    '2024-07-05', '2024-08-04', '2024-09-03', '2024-10-02', '2024-11-01', '2024-12-01', '2024-12-30',
    // 2025
    '2025-01-29', '2025-02-28', '2025-03-29', '2025-04-27', '2025-05-27', '2025-06-25',
    '2025-07-24', '2025-08-23', '2025-09-21', '2025-10-21', '2025-11-20', '2025-12-20',
    // 2026
    '2026-01-18', '2026-02-17', '2026-03-19', '2026-04-17', '2026-05-16', '2026-06-15',
    '2026-07-14', '2026-08-12', '2026-09-11', '2026-10-10', '2026-11-09', '2026-12-09',
];

// Eclipse filter state - hierarchical (must have at least one primary enabled)
let eclipseFilters = {
    // Primary type filters - start with solar only
    solar: true,
    lunar: false,
    // Subtypes (shared names where applicable)
    total: true,
    annular: true,
    partial: true,
    hybrid: true,
    penumbral: true
};

/**
 * Get eclipse icon HTML based on type and subtype
 */
function getEclipseIcon(type, subtype) {
    if (type === 'solar') {
        switch (subtype) {
            case 'total':
                return `<div class="eclipse-icon solar-total"><div class="corona"></div><div class="moon-disk"></div></div>`;
            case 'annular':
                return `<div class="eclipse-icon solar-annular"><div class="sun-ring"></div><div class="moon-disk"></div></div>`;
            case 'partial':
                return `<div class="eclipse-icon solar-partial"><div class="sun-disk"></div><div class="moon-bite"></div></div>`;
            case 'hybrid':
                return `<div class="eclipse-icon solar-hybrid"><div class="corona"></div><div class="moon-disk"></div><div class="hybrid-ring"></div></div>`;
        }
    } else {
        switch (subtype) {
            case 'total':
                return `<div class="eclipse-icon lunar-total"><div class="blood-moon"></div></div>`;
            case 'partial':
                return `<div class="eclipse-icon lunar-partial"><div class="moon-lit"></div><div class="shadow-bite"></div></div>`;
            case 'penumbral':
                return `<div class="eclipse-icon lunar-penumbral"><div class="moon-dim"></div></div>`;
        }
    }
    return `<div class="eclipse-icon"></div>`;
}

/**
 * Populate eclipse list with current filters
 */
function populateEclipseList(eventsList) {
    eventsList.innerHTML = '';

    // Use selected date or current date for positioning
    const targetDate = selectedDate || new Date();
    let closestIndex = -1;
    let closestDiff = Infinity;
    let visibleIndex = 0;
    let lastYear = null;

    CELESTIAL_EVENTS.forEach((event, i) => {
        // Apply hierarchical filters: check primary type AND subtype
        if (!eclipseFilters[event.type]) return;  // Primary filter (solar/lunar)
        if (!eclipseFilters[event.subtype]) return;  // Subtype filter

        const eventYear = event.date.substring(0, 4);

        // Add year divider when year changes
        if (eventYear !== lastYear) {
            const divider = document.createElement('div');
            divider.className = 'year-divider';
            divider.dataset.year = eventYear;
            eventsList.appendChild(divider);
            lastYear = eventYear;
        }

        const eventEl = document.createElement('div');
        eventEl.className = `event-item ${event.type} ${event.subtype}`;
        eventEl.dataset.date = event.date;
        eventEl.dataset.timeutc = event.timeUTC;
        const date = new Date(event.date + 'T12:00:00');
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const dateStr = `${monthNames[date.getMonth()]} ${date.getDate().toString().padStart(2, '0')}, ${date.getFullYear()}`;
        // Format UTC time for display
        const utcHours = Math.floor(event.timeUTC / 60);
        const utcMins = event.timeUTC % 60;
        const timeStr = `${utcHours.toString().padStart(2, '0')}:${utcMins.toString().padStart(2, '0')} UTC`;

        // Display name with type
        const subtypeName = event.subtype.charAt(0).toUpperCase() + event.subtype.slice(1);
        const typeName = event.type.charAt(0).toUpperCase() + event.type.slice(1);

        eventEl.innerHTML = `
            ${getEclipseIcon(event.type, event.subtype)}
            <div class="event-info">
                <span class="event-name">${subtypeName} ${typeName}</span>
                <span class="event-datetime"><span class="event-time">${timeStr}</span><span class="event-date">${dateStr}</span></span>
            </div>
        `;
        eventsList.appendChild(eventEl);

        // Track closest to target date
        const diff = Math.abs(date - targetDate);
        if (diff < closestDiff) {
            closestDiff = diff;
            closestIndex = visibleIndex;
        }
        visibleIndex++;
    });

    return closestIndex;
}

/**
 * Setup eclipse list scrolling with custom year scrollbar
 */
function setupEclipseListScrolling(popup) {
    const eventsList = popup.querySelector('#celestial-events-list');
    const scrollbar = popup.querySelector('.year-scrollbar');
    const thumb = popup.querySelector('.year-scrollbar-thumb');
    const track = popup.querySelector('.year-scrollbar-track');
    const yearIndicator = popup.querySelector('.year-indicator');

    if (!eventsList || !scrollbar || !thumb) return;

    // Get year from visible items
    function getVisibleYear() {
        const listRect = eventsList.getBoundingClientRect();
        const centerY = listRect.top + listRect.height / 2;

        for (const item of eventsList.children) {
            const itemRect = item.getBoundingClientRect();
            if (itemRect.top <= centerY && itemRect.bottom >= centerY) {
                const dateStr = item.dataset.date;
                if (dateStr) return dateStr.substring(0, 4);
            }
        }
        // Fallback: first visible item
        for (const item of eventsList.children) {
            const itemRect = item.getBoundingClientRect();
            if (itemRect.bottom > listRect.top) {
                const dateStr = item.dataset.date;
                if (dateStr) return dateStr.substring(0, 4);
            }
        }
        return '----';
    }

    // Update thumb position and year indicator
    function updateScrollbar() {
        if (eventsList.scrollHeight <= eventsList.clientHeight) {
            scrollbar.style.display = 'none';
            return;
        }
        scrollbar.style.display = 'flex';

        const scrollRatio = eventsList.scrollTop / (eventsList.scrollHeight - eventsList.clientHeight);
        const trackHeight = track.clientHeight;
        const thumbHeight = thumb.clientHeight;
        const maxTop = trackHeight - thumbHeight;

        thumb.style.top = (scrollRatio * maxTop) + 'px';
        const visibleYear = getVisibleYear();
        yearIndicator.textContent = visibleYear;

        // Highlight the year divider matching the scroller year
        eventsList.querySelectorAll('.year-divider').forEach(divider => {
            divider.classList.toggle('active', divider.dataset.year === visibleYear);
        });
    }

    // Scroll list when thumb is dragged
    let isDraggingThumb = false;
    let thumbStartY = 0;
    let scrollStartTop = 0;

    thumb.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDraggingThumb = true;
        thumbStartY = e.clientY;
        scrollStartTop = eventsList.scrollTop;
        thumb.classList.add('dragging');
        document.body.style.cursor = 'grabbing';
    });

    thumb.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isDraggingThumb = true;
        thumbStartY = e.touches[0].clientY;
        scrollStartTop = eventsList.scrollTop;
        thumb.classList.add('dragging');
    }, { passive: false });

    // Click on track to jump
    track.addEventListener('click', (e) => {
        if (isDraggingThumb) return;
        const trackRect = track.getBoundingClientRect();
        const clickY = e.clientY - trackRect.top;
        const ratio = clickY / trackRect.height;
        eventsList.scrollTop = ratio * (eventsList.scrollHeight - eventsList.clientHeight);
    });

    // Drag-to-scroll on list items
    let isDraggingList = false;
    let listStartY = 0;
    let listScrollStart = 0;
    let hasDragged = false;

    eventsList.addEventListener('mousedown', (e) => {
        // Only start drag if not clicking directly on a link
        isDraggingList = true;
        listStartY = e.clientY;
        listScrollStart = eventsList.scrollTop;
        hasDragged = false;
        eventsList.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
        if (isDraggingThumb) {
            const deltaY = e.clientY - thumbStartY;
            const trackHeight = track.clientHeight - thumb.clientHeight;
            const scrollRange = eventsList.scrollHeight - eventsList.clientHeight;
            const scrollDelta = (deltaY / trackHeight) * scrollRange;
            eventsList.scrollTop = scrollStartTop + scrollDelta;
        }
        if (isDraggingList) {
            const deltaY = e.clientY - listStartY;
            if (Math.abs(deltaY) > 3) hasDragged = true;
            eventsList.scrollTop = listScrollStart - deltaY;
        }
    });

    document.addEventListener('touchmove', (e) => {
        if (isDraggingThumb) {
            const deltaY = e.touches[0].clientY - thumbStartY;
            const trackHeight = track.clientHeight - thumb.clientHeight;
            const scrollRange = eventsList.scrollHeight - eventsList.clientHeight;
            const scrollDelta = (deltaY / trackHeight) * scrollRange;
            eventsList.scrollTop = scrollStartTop + scrollDelta;
        }
    }, { passive: true });

    document.addEventListener('mouseup', () => {
        if (isDraggingThumb) {
            isDraggingThumb = false;
            thumb.classList.remove('dragging');
            document.body.style.cursor = '';
        }
        if (isDraggingList) {
            isDraggingList = false;
            eventsList.style.cursor = '';
            // Prevent click if we dragged
            if (hasDragged) {
                eventsList.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                }, { once: true, capture: true });
            }
        }
    });

    document.addEventListener('touchend', () => {
        if (isDraggingThumb) {
            isDraggingThumb = false;
            thumb.classList.remove('dragging');
        }
    });

    // Update on scroll
    eventsList.addEventListener('scroll', updateScrollbar);

    // Initial update
    setTimeout(updateScrollbar, 100);
}

/**
 * Create calendar popup HTML
 */
function createCalendarPopup() {
    const popup = document.createElement('div');
    popup.id = 'calendar-popup';

    popup.innerHTML = `
        <div class="eclipse-panel-content">
            <div class="eclipse-filters">
                <div class="filter-toggle-group">
                    <button class="filter-toggle solar active" data-filter="solar" title="Solar Eclipses">
                        <span class="icon">☀️</span><span class="suffix">SOLAR ECLIPSES</span>
                    </button>
                    <button class="filter-toggle lunar" data-filter="lunar" title="Lunar Eclipses">
                        <span class="icon">🌙</span><span class="suffix">LUNAR ECLIPSES</span>
                    </button>
                </div>
            </div>
            <div class="events-list-container">
                <div class="events-list" id="celestial-events-list"></div>
                <div class="year-scrollbar">
                    <div class="year-scrollbar-track"></div>
                    <div class="year-scrollbar-thumb">
                        <span class="year-indicator">2026</span>
                    </div>
                </div>
            </div>
        </div>
    `;

    const eventsList = popup.querySelector('#celestial-events-list');
    const solarBtn = popup.querySelector('.filter-toggle.solar');
    const lunarBtn = popup.querySelector('.filter-toggle.lunar');
    const yearScrollbar = popup.querySelector('.year-scrollbar');

    // Update scrollbar theme based on active filter
    function updateScrollbarTheme() {
        if (yearScrollbar) {
            yearScrollbar.classList.toggle('solar', eclipseFilters.solar);
            yearScrollbar.classList.toggle('lunar', eclipseFilters.lunar);
        }
    }

    // Toggle filter buttons - exclusive toggle (one or the other)
    popup.querySelectorAll('.filter-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const filter = btn.dataset.filter;
            const other = filter === 'solar' ? 'lunar' : 'solar';
            const otherBtn = filter === 'solar' ? lunarBtn : solarBtn;

            // If already active, do nothing
            if (eclipseFilters[filter]) {
                return;
            }

            // Switch: enable this one, disable the other
            eclipseFilters[filter] = true;
            eclipseFilters[other] = false;
            btn.classList.add('active');
            otherBtn.classList.remove('active');

            updateScrollbarTheme();
            populateEclipseList(eventsList);
            attachEclipseClickHandlers(eventsList);
            setupEclipseListScrolling(popup);
        });
    });

    // Populate initial list
    const closestIndex = populateEclipseList(eventsList);

    // Setup scrolling functionality and initial theme
    updateScrollbarTheme();
    setupEclipseListScrolling(popup);

    // Scroll to closest eclipse after render
    setTimeout(() => {
        const eventItems = eventsList.querySelectorAll('.event-item');
        if (closestIndex >= 0 && eventItems[closestIndex]) {
            eventItems[closestIndex].scrollIntoView({ block: 'center' });
        }
    }, 50);

    return popup;
}

/**
 * Attach click handlers to eclipse items
 */
function attachEclipseClickHandlers(eventsList) {
    eventsList.querySelectorAll('.event-item').forEach(item => {
        item.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Ignore clicks on right 30px (scrollbar area)
            const rect = item.getBoundingClientRect();
            if (e.clientX > rect.right - 30) return;

            const dateStr = item.dataset.date;
            const timeUTC = parseInt(item.dataset.timeutc);
            const [y, m, d] = dateStr.split('-').map(Number);

            // Convert UTC time to local time at pointer position
            const closestCity = findClosestCity(focusPointLat, focusPointLon);
            const cityTzHours = closestCity ? closestCity.tz : 0;
            let localTime = timeUTC + cityTzHours * 60;

            // Handle day overflow/underflow
            let dayOffset = 0;
            if (localTime >= 1440) {
                localTime -= 1440;
                dayOffset = 1;
            } else if (localTime < 0) {
                localTime += 1440;
                dayOffset = -1;
            }

            selectedDate = new Date(y, m - 1, d + dayOffset);
            isLiveMode = false;
            timeOffsetMinutes = localTime;
            document.getElementById('time-slider').value = timeOffsetMinutes;
            calendarViewDate = new Date(selectedDate);
            renderCalendar();
            updateTimeDisplay();
            updateCelestialPositions();
            updateEventMarkers();
            updateDayNavButtons();
        };
    });
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Render calendar days for current view month
 */
function renderCalendar() {
    const daysContainer = document.getElementById('cal-days');
    if (!daysContainer) return;

    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();

    // Update header with month/year
    const header = document.getElementById('cal-header');
    if (header) {
        header.textContent = `${MONTH_NAMES[month]} ${year}`;
    }

    // Get first day of month and total days
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    const selectedStr = selectedDate ? `${selectedDate.getFullYear()}-${selectedDate.getMonth()}-${selectedDate.getDate()}` : null;

    let html = '';

    // Previous month days
    for (let i = firstDay - 1; i >= 0; i--) {
        const day = daysInPrevMonth - i;
        html += `<button class="calendar-day other-month" data-date="${year}-${month - 1}-${day}">${day}</button>`;
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${month}-${day}`;
        const isToday = dateStr === todayStr;
        const isSelected = dateStr === selectedStr;
        let classes = 'calendar-day';
        if (isToday) classes += ' today';
        if (isSelected) classes += ' selected';

        // Check for eclipse or new moon on this date
        const isoDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const eclipse = CELESTIAL_EVENTS.find(e => e.date === isoDate);
        const isNewMoon = NEW_MOONS.includes(isoDate);
        let content = `<span class="day-num">${day}</span>`;
        if (eclipse) {
            classes += ` eclipse ${eclipse.type} ${eclipse.subtype}`;
            content += getEclipseIcon(eclipse.type, eclipse.subtype).replace('eclipse-icon', 'eclipse-icon cal-icon');
        } else if (isNewMoon) {
            classes += ' new-moon';
            content += '<span class="new-moon-dot"></span>';
        }

        html += `<button class="${classes}" data-date="${dateStr}">${content}</button>`;
    }

    // Next month days to fill grid (always 6 rows = 42 cells for consistent height)
    const totalCells = 42;
    const nextDays = totalCells - firstDay - daysInMonth;
    for (let day = 1; day <= nextDays; day++) {
        html += `<button class="calendar-day other-month" data-date="${year}-${month + 1}-${day}">${day}</button>`;
    }

    daysContainer.innerHTML = html;

    // Add click/touch handlers for day selection
    daysContainer.querySelectorAll('.calendar-day').forEach(btn => {
        const selectDay = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const [y, m, d] = btn.dataset.date.split('-').map(Number);
            selectedDate = new Date(y, m, d);
            isLiveMode = false;
            // Keep current timeOffsetMinutes - don't change the time
            document.getElementById('time-slider').classList.remove('live');
            renderCalendar();
            updateTimeDisplay();
            updateCelestialPositions();
            updateEventMarkers();
            updateDayNavButtons();
        };
        btn.addEventListener('click', selectDay);
        btn.addEventListener('touchend', selectDay);
    });
}

/**
 * Update simulation speed display
 */
function updateSimulationSpeedDisplay() {
    const speedDisplay = document.getElementById('speed-display');
    const speedDecreaseBtn = document.getElementById('speed-decrease-btn');
    const speedIncreaseBtn = document.getElementById('speed-increase-btn');

    const speed = SIMULATION_SPEEDS[simulationSpeedIndex];
    if (speed < 1) {
        // Sub-realtime speeds: show as m/m (minutes per minute)
        const mpm = Math.round(speed * 60);
        speedDisplay.textContent = `${mpm}m/m`;
    } else if (speed >= 1440) {
        speedDisplay.textContent = `${speed / 1440}d/s`;
    } else if (speed >= 60) {
        speedDisplay.textContent = `${speed / 60}h/s`;
    } else {
        // Show as minutes per second
        speedDisplay.textContent = `${speed}m/s`;
    }

    // Update button disabled states
    speedDecreaseBtn.disabled = simulationSpeedIndex <= 0;
    speedIncreaseBtn.disabled = simulationSpeedIndex >= SIMULATION_SPEEDS.length - 1;
}

/**
 * Start simulation mode
 */
function startSimulation() {
    const slider = document.getElementById('time-slider');
    const playPauseBtn = document.getElementById('play-pause-btn');

    if (!isSimulating) {
        // Sync date and time to pointer's timezone when starting simulation
        if (isLiveMode) {
            const now = new Date();
            const closestCity = findClosestCity(focusPointLat, focusPointLon);
            const cityTzHours = closestCity ? closestCity.tz : 0;
            // Use same approach as periodic update - shifted Date object
            const pointerLocalTime = new Date(now.getTime() + cityTzHours * 3600000);
            selectedDate = pointerLocalTime;
            lastPointerTz = cityTzHours;

            // Also sync timeOffsetMinutes to current local time
            const utcHours = now.getUTCHours();
            const utcMinutes = now.getUTCMinutes();
            const utcSeconds = now.getUTCSeconds();
            let localMinutes = utcHours * 60 + utcMinutes + utcSeconds / 60 + cityTzHours * 60;
            while (localMinutes < 0) localMinutes += 1440;
            while (localMinutes >= 1440) localMinutes -= 1440;
            timeOffsetMinutes = localMinutes;
        }

        // Clamp timeOffsetMinutes to valid range
        timeOffsetMinutes = Math.max(0, Math.min(1440, timeOffsetMinutes));
        slider.value = timeOffsetMinutes;

        updateEventMarkers();

        isLiveMode = false;
        lastSimulationTime = performance.now();
        isSimulating = true;
    }

    // Unpause if paused
    if (isPaused) {
        isPaused = false;
        // Reset lastSimulationTime so we don't jump forward by the paused duration
        lastSimulationTime = performance.now();
        if (playPauseBtn) {
            playPauseBtn.classList.remove('paused');
        }
    }

    updatePositionDisplay();
}

/**
 * Stop simulation (used by NOW button)
 */
function stopSimulation() {
    if (isSimulating) {
        isSimulating = false;
    }
}

/**
 * Toggle direction between forward (1) and reverse (-1)
 */
function toggleDirection() {
    simulationDirection = simulationDirection === 1 ? -1 : 1;
    const directionBtn = document.getElementById('direction-toggle-btn');
    if (directionBtn) {
        directionBtn.classList.toggle('reverse', simulationDirection === -1);
    }
}

/**
 * Toggle play/pause state
 */
function togglePlayPause() {
    const playPauseBtn = document.getElementById('play-pause-btn');

    if (isPaused) {
        // Resume playing - use startSimulation helper
        startSimulation();
    } else {
        // Pause
        isPaused = true;
        if (playPauseBtn) {
            playPauseBtn.classList.add('paused');
        }
        updatePositionDisplay();
    }
    updateTimeDisplay();
}

/**
 * Update simulation (called from animation loop)
 */
function updateSimulation(currentTime) {
    if (!isSimulating || isPaused) return;

    let deltaTime = (currentTime - lastSimulationTime) / 1000; // Convert to seconds
    lastSimulationTime = currentTime;

    // Cap deltaTime to prevent massive jumps (e.g., after tab switch or drag)
    if (deltaTime > 0.5) deltaTime = 0.5;

    // Calculate minutes to advance based on speed and direction
    const minutesPerSecond = SIMULATION_SPEEDS[simulationSpeedIndex];
    const deltaMinutes = minutesPerSecond * deltaTime * simulationDirection;

    timeOffsetMinutes += deltaMinutes;

    // Safety: ensure timeOffsetMinutes is a valid number
    if (isNaN(timeOffsetMinutes)) timeOffsetMinutes = 720;

    // Check if we've reached the end of the day and need to switch days
    // Slider range is 0-1440 (midnight to midnight)
    // Use while loops to handle large time jumps that could span multiple days
    let dayChanged = false;

    while (timeOffsetMinutes >= 1440) {
        if (!selectedDate) {
            selectedDate = new Date();
            selectedDate.setHours(0, 0, 0, 0);
        }
        selectedDate.setDate(selectedDate.getDate() + 1);
        timeOffsetMinutes -= 1440;
        dayChanged = true;
    }

    while (timeOffsetMinutes < 0) {
        if (!selectedDate) {
            selectedDate = new Date();
            selectedDate.setHours(0, 0, 0, 0);
        }
        selectedDate.setDate(selectedDate.getDate() - 1);
        timeOffsetMinutes += 1440;
        dayChanged = true;
    }

    if (dayChanged) {
        updateEventMarkers();
        updateDayNavButtons();
    }

    // Update slider position (but not while user is dragging it)
    if (!isSliderDragging) {
        const slider = document.getElementById('time-slider');
        slider.value = Math.round(timeOffsetMinutes);
    }

    // Update displays
    updateTimeDisplay();
    updateCelestialPositions();
    updatePositionDisplay();
}

/**
 * Setup time control event listeners
 */
function setupTimeControl() {
    const slider = document.getElementById('time-slider');
    const liveBtn = document.getElementById('live-btn');
    const positionDisplay = document.getElementById('position-display');

    // Simulation controls
    const directionToggleBtn = document.getElementById('direction-toggle-btn');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const speedDecreaseBtn = document.getElementById('speed-decrease-btn');
    const speedIncreaseBtn = document.getElementById('speed-increase-btn');

    // Track slider drag state to prevent simulation from fighting with user drag
    slider.addEventListener('mousedown', () => { isSliderDragging = true; });
    slider.addEventListener('touchstart', () => { isSliderDragging = true; });
    document.addEventListener('mouseup', () => { isSliderDragging = false; });
    document.addEventListener('touchend', () => { isSliderDragging = false; });

    // Prevent context menu on slider area and reset drag state if it appears
    slider.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        isSliderDragging = false;
    });

    // Also prevent context menu on entire slider container (background area)
    const sliderContainer = slider.closest('.slider-container');
    if (sliderContainer) {
        sliderContainer.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            isSliderDragging = false;
        });
        // Prevent drag events that could trigger browser behaviors
        sliderContainer.addEventListener('dragstart', (e) => e.preventDefault());
        sliderContainer.addEventListener('selectstart', (e) => e.preventDefault());
    }

    // Also prevent on playback controls area
    const playbackControls = document.querySelector('.playback-controls');
    if (playbackControls) {
        playbackControls.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            isSliderDragging = false;
        });
        playbackControls.addEventListener('selectstart', (e) => e.preventDefault());
    }

    // Reset drag state when window loses focus (e.g., context menu appears elsewhere)
    window.addEventListener('blur', () => { isSliderDragging = false; });

    slider.addEventListener('input', (e) => {
        // Ensure drag state is set even if mousedown was outside slider
        isSliderDragging = true;

        // When leaving live mode, sync selectedDate and start simulation
        const wasLiveMode = isLiveMode;
        if (isLiveMode) {
            syncDateForLiveModeExit();
        }
        const newValue = parseInt(e.target.value);
        if (!isNaN(newValue)) {
            // Clamp to 1439 to prevent day rollover when dragging to end
            timeOffsetMinutes = Math.min(newValue, 1439);
        }
        isLiveMode = false; // Exit live mode when user manually adjusts slider

        // Reset simulation timing to prevent jumps after dragging
        lastSimulationTime = performance.now();

        // Auto-start simulation when exiting live mode via slider
        if (wasLiveMode && !isSimulating) {
            isSimulating = true;
            const playPauseBtn = document.getElementById('play-pause-btn');
            if (playPauseBtn) playPauseBtn.classList.add('playing');
        }

        updateTimeDisplay();
        updateCelestialPositions();
        updatePositionDisplay();
        updateEventMarkers();
    });

    liveBtn.addEventListener('click', () => {
        // Stop simulation if running
        stopSimulation();

        // Unpause if paused
        if (isPaused) {
            isPaused = false;
            const playPauseBtn = document.getElementById('play-pause-btn');
            if (playPauseBtn) {
                playPauseBtn.classList.remove('paused');
            }
        }

        // Reset speed to real-time (1m/m)
        simulationSpeedIndex = 0;
        updateSimulationSpeedDisplay();

        // Reset direction to forward
        simulationDirection = 1;
        const directionBtn = document.getElementById('direction-toggle-btn');
        if (directionBtn) {
            directionBtn.classList.remove('reverse');
        }

        // Reset to current real time
        const now = new Date();

        // Get local time at pointer position
        const closestCity = findClosestCity(focusPointLat, focusPointLon);
        const cityTzHours = closestCity ? closestCity.tz : 0;

        // Calculate current date and time at pointer's timezone
        const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
        const cityMs = utcMs + cityTzHours * 60 * 60 * 1000;
        const cityTime = new Date(cityMs);

        // Set selectedDate to the date at the pointer's timezone (midnight local)
        const pointerDate = new Date(cityTime.getFullYear(), cityTime.getMonth(), cityTime.getDate());

        // Calculate local minutes from midnight at pointer's timezone
        const localMinutes = cityTime.getHours() * 60 + cityTime.getMinutes();

        selectedDate = pointerDate;
        timeOffsetMinutes = Math.max(0, Math.min(1440, localMinutes));
        isLiveMode = true;
        lastPointerTz = cityTzHours;  // Initialize timezone tracking
        slider.value = timeOffsetMinutes;

        // Reset calendar to current month at pointer's timezone
        calendarViewDate = new Date(pointerDate);
        renderCalendar();

        updateTimeDisplay();
        updateCelestialPositions();
        updateEventMarkers();
        updateDayNavButtons();
    });

    // Direction toggle button
    directionToggleBtn.addEventListener('click', () => {
        toggleDirection();
        // If switching to reverse, start simulation (exits live mode)
        if (simulationDirection === -1) {
            startSimulation();
        }
    });

    // Play/Pause button
    playPauseBtn.addEventListener('click', () => {
        togglePlayPause();
    });

    speedDecreaseBtn.addEventListener('click', () => {
        if (simulationSpeedIndex > 0) {
            simulationSpeedIndex--;
            updateSimulationSpeedDisplay();
            startSimulation();
        }
    });

    speedIncreaseBtn.addEventListener('click', () => {
        if (simulationSpeedIndex < SIMULATION_SPEEDS.length - 1) {
            simulationSpeedIndex++;
            updateSimulationSpeedDisplay();
            startSimulation();
        }
    });

    // Helper to sync selectedDate when leaving live mode
    function syncDateForLiveModeExit() {
        const now = new Date();
        const closestCity = findClosestCity(focusPointLat, focusPointLon);
        const cityTzHours = closestCity ? closestCity.tz : 0;

        // Calculate current date and time at pointer's timezone (same as live button handler)
        const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
        const cityMs = utcMs + cityTzHours * 60 * 60 * 1000;
        const cityTime = new Date(cityMs);

        // Set selectedDate to the date at the pointer's timezone (midnight local)
        const pointerDate = new Date(cityTime.getFullYear(), cityTime.getMonth(), cityTime.getDate());

        selectedDate = pointerDate;
        lastPointerTz = cityTzHours;
    }

    // Calendar button
    const calendarBtn = document.getElementById('calendar-btn');
    if (calendarBtn) {
        let calendarPopup = null;

        const toggleCalendar = (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Create popup if it doesn't exist
            if (!calendarPopup) {
                calendarPopup = createCalendarPopup();
                document.getElementById('position-display').appendChild(calendarPopup);

                // Attach eclipse click handlers
                const eventsList = calendarPopup.querySelector('#celestial-events-list');
                attachEclipseClickHandlers(eventsList);
            }

            // Toggle visibility
            const isVisible = calendarPopup.classList.contains('visible');
            if (isVisible) {
                calendarPopup.classList.remove('visible');
                calendarBtn.classList.remove('active');
            } else {
                // Sync calendar view to current selected date
                calendarViewDate = selectedDate ? new Date(selectedDate) : new Date();
                renderCalendar();

                // Refresh eclipse list and scroll to current date
                const eventsList = calendarPopup.querySelector('#celestial-events-list');
                const closestIndex = populateEclipseList(eventsList);
                attachEclipseClickHandlers(eventsList);
                setTimeout(() => {
                    const eventItems = eventsList.querySelectorAll('.event-item');
                    if (closestIndex >= 0 && eventItems[closestIndex]) {
                        eventItems[closestIndex].scrollIntoView({ block: 'center' });
                    }
                }, 50);

                calendarPopup.classList.add('visible');
                calendarBtn.classList.add('active');
            }
        };

        calendarBtn.addEventListener('click', toggleCalendar);
    }

    // Initial state - set to current local time at pointer position
    const now = new Date();

    // Get timezone at pointer position
    const closestCity = findClosestCity(focusPointLat, focusPointLon);
    const cityTzHours = closestCity ? closestCity.tz : 0;

    // Calculate current date and time at pointer's timezone
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
    const cityMs = utcMs + cityTzHours * 60 * 60 * 1000;
    const cityTime = new Date(cityMs);

    // Set selectedDate to the date at the pointer's timezone
    const pointerDate = new Date(cityTime.getFullYear(), cityTime.getMonth(), cityTime.getDate());

    // Calculate local minutes from midnight at pointer's timezone
    const initialLocalMinutes = cityTime.getHours() * 60 + cityTime.getMinutes();

    selectedDate = pointerDate;
    timeOffsetMinutes = Math.max(0, Math.min(1440, initialLocalMinutes));
    lastPointerTz = cityTzHours;  // Initialize timezone tracking
    slider.value = timeOffsetMinutes;
    calendarViewDate = new Date(pointerDate);

    updateTimeDisplay();
    updatePositionDisplay();
    updateEventMarkers();
    updateSimulationSpeedDisplay();
    updateDayNavButtons();

    // Update displays periodically
    setInterval(() => {
        // In live mode, update slider to track real time (unless paused)
        if (isLiveMode && !isSimulating && !isPaused) {
            const now = new Date();

            // Get timezone at pointer position
            const closestCity = findClosestCity(focusPointLat, focusPointLon);
            const cityTzHours = closestCity ? closestCity.tz : 0;

            // Calculate current local time at pointer position (minutes from midnight)
            const utcHours = now.getUTCHours();
            const utcMinutes = now.getUTCMinutes();
            const utcTotalMinutes = utcHours * 60 + utcMinutes;
            let localMinutes = utcTotalMinutes + cityTzHours * 60;

            // Wrap around midnight
            while (localMinutes < 0) localMinutes += 1440;
            while (localMinutes >= 1440) localMinutes -= 1440;

            // Update if day changed (crossed midnight)
            const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
            const cityMs = utcMs + cityTzHours * 60 * 60 * 1000;
            const cityTime = new Date(cityMs);
            const todayAtPointer = new Date(cityTime.getFullYear(), cityTime.getMonth(), cityTime.getDate());
            if (selectedDate && selectedDate.toDateString() !== todayAtPointer.toDateString()) {
                selectedDate = todayAtPointer;
                updateEventMarkers();
                updateDayNavButtons();
            }

            timeOffsetMinutes = localMinutes;
            lastPointerTz = cityTzHours;  // Keep in sync for getAbsoluteSimulatedTime()
            slider.value = timeOffsetMinutes;
        }
        // Don't update position display while user is actively dragging
        // to prevent jumping when focus point is locked to camera
        if (!isDragging && !isTouching) {
            updatePositionDisplay();
            updateEventMarkers();
        }
    }, 250);
}

/**
 * Update view zoom button display based on current state
 */
function updateViewZoomButton() {
    if (!toggleViewZoomBtn) return;

    if (isZoomedOut) {
        toggleViewZoomBtn.textContent = '🌍';
        toggleViewZoomBtn.title = 'Switch to horizon view';
    } else {
        toggleViewZoomBtn.textContent = '🌅';
        toggleViewZoomBtn.title = 'Switch to zoomed out view';
    }
}

/**
 * Setup left side controls
 */
function setupLeftControls() {
    toggleViewZoomBtn = document.getElementById('toggle-view-zoom');

    // Toggle view zoom button
    if (toggleViewZoomBtn) {
        toggleViewZoomBtn.addEventListener('click', () => {
            isZoomedOut = !isZoomedOut;
            if (isZoomedOut) {
                // Zoom out to max
                cameraRadius = CAMERA_MAX_RADIUS;
            } else {
                // Zoom in to horizon view
                cameraRadius = CAMERA_MIN_RADIUS + 100;
            }
            updateViewZoomButton();
            updateZoomSlider();
        });
    }

    // Toggle focus lock button
    const toggleFocusLockBtn = document.getElementById('toggle-focus-lock');
    if (toggleFocusLockBtn) {
        toggleFocusLockBtn.addEventListener('click', toggleFocusLock);
        // Initialize button state and icon
        updateFocusLockButton();
    }

    // Compass sun/moon click handlers for target lock
    const compassSun = document.getElementById('compass-sun');
    const compassMoon = document.getElementById('compass-moon');
    if (compassSun) {
        compassSun.addEventListener('click', (e) => {
            e.stopPropagation();
            // Toggle sun lock: if already sun, switch to free; otherwise switch to sun
            zoomTargetMode = (zoomTargetMode === 0) ? 2 : 0;
            updateCompassTargetState();
        });
    }
    if (compassMoon) {
        compassMoon.addEventListener('click', (e) => {
            e.stopPropagation();
            // Toggle moon lock: if already moon, switch to free; otherwise switch to moon
            zoomTargetMode = (zoomTargetMode === 1) ? 2 : 1;
            updateCompassTargetState();
        });
    }

    // Toggle grid lines (equator + prime meridian) - now in earth settings panel
    const toggleGridLinesBtn = document.getElementById('toggle-grid-lines');
    let gridLinesVisible = false;
    if (toggleGridLinesBtn) {
        toggleGridLinesBtn.addEventListener('click', () => {
            gridLinesVisible = !gridLinesVisible;
            if (equatorLine) equatorLine.visible = gridLinesVisible;
            if (primeMeridianLine) primeMeridianLine.visible = gridLinesVisible;
            toggleGridLinesBtn.classList.toggle('active', gridLinesVisible);
            toggleGridLinesBtn.textContent = gridLinesVisible ? 'ON' : 'OFF';
        });
    }

    // Toggle polar axis - now in earth settings panel
    const togglePolarAxisBtn = document.getElementById('toggle-polar-axis');
    let polarAxisVisible = false;
    if (togglePolarAxisBtn) {
        togglePolarAxisBtn.addEventListener('click', () => {
            polarAxisVisible = !polarAxisVisible;
            if (northAxisMesh) northAxisMesh.visible = polarAxisVisible;
            if (southAxisMesh) southAxisMesh.visible = polarAxisVisible;
            togglePolarAxisBtn.classList.toggle('active', polarAxisVisible);
            togglePolarAxisBtn.textContent = polarAxisVisible ? 'ON' : 'OFF';
        });
    }

    // Toggle backface rendering of earth surfaces - in earth settings panel
    const toggleBackfacesBtn = document.getElementById('toggle-backfaces');
    let backfacesEnabled = true;  // Starts ON (DoubleSide)
    if (toggleBackfacesBtn) {
        toggleBackfacesBtn.addEventListener('click', () => {
            backfacesEnabled = !backfacesEnabled;
            const side = backfacesEnabled ? THREE.DoubleSide : THREE.FrontSide;
            if (mapMaterial) {
                mapMaterial.side = side;
                mapMaterial.needsUpdate = true;
            }
            if (earthFillMaterial) {
                earthFillMaterial.side = side;
                earthFillMaterial.needsUpdate = true;
            }
            toggleBackfacesBtn.classList.toggle('active', backfacesEnabled);
            toggleBackfacesBtn.textContent = backfacesEnabled ? 'ON' : 'OFF';
        });
    }

    // ==================== EARTH SETTINGS PANEL ====================
    const earthSettingsBtn = document.getElementById('toggle-earth-settings');
    const earthSettingsPanel = document.getElementById('earth-settings-panel');
    const closeEarthSettingsBtn = document.getElementById('close-earth-settings');

    if (earthSettingsBtn && earthSettingsPanel) {
        earthSettingsBtn.addEventListener('click', () => {
            earthSettingsPanel.classList.toggle('hidden');
            earthSettingsBtn.classList.toggle('active', !earthSettingsPanel.classList.contains('hidden'));
        });

        if (closeEarthSettingsBtn) {
            closeEarthSettingsBtn.addEventListener('click', () => {
                earthSettingsPanel.classList.add('hidden');
                earthSettingsBtn.classList.remove('active');
            });
        }

        // Land color (also updates back color to match)
        document.getElementById('land-color')?.addEventListener('input', (e) => {
            if (mapMaterial) {
                const c = new THREE.Color(e.target.value);
                mapMaterial.uniforms.landColor.value.set(c.r, c.g, c.b);
                mapMaterial.uniforms.landBackColor.value.set(c.r, c.g, c.b);
            }
        });

        // Land opacity
        document.getElementById('land-opacity')?.addEventListener('input', (e) => {
            if (mapMaterial) mapMaterial.uniforms.landOpacity.value = e.target.value / 100;
        });

        // Ocean color - controls fill sphere color (ocean texture is transparent)
        document.getElementById('ocean-color')?.addEventListener('input', (e) => {
            if (earthFillMaterial) {
                earthFillMaterial.color.set(e.target.value);
            }
        });

        // Ocean opacity - controls fill sphere opacity and backside surface visibility
        document.getElementById('ocean-opacity')?.addEventListener('input', (e) => {
            const opacity = e.target.value / 100;
            if (earthFillMaterial) {
                earthFillMaterial.opacity = opacity;
                // Enable depth write when fully opaque to occlude backside surfaces
                earthFillMaterial.depthWrite = opacity >= 1.0;
            }
            // Scale backside land opacity inversely with fill sphere opacity
            if (mapMaterial) {
                const baseLandBackOpacity = 0.6;
                mapMaterial.uniforms.landBackOpacity.value = baseLandBackOpacity * (1 - opacity);
            }
        });

        // Sun light color (directional light from sun)
        document.getElementById('sun-light-color')?.addEventListener('input', (e) => {
            if (sunLight) {
                sunLight.color.set(e.target.value);
            }
        });

        // Day cities color (used for city markers in sun visibility)
        document.getElementById('sun-beam-color')?.addEventListener('input', (e) => {
            sunCityColor = e.target.value;
        });

        // Night cities color (used for city markers in moon visibility)
        document.getElementById('moon-beam-color')?.addEventListener('input', (e) => {
            moonCityColor = e.target.value;
        });

        // City labels toggle
        document.getElementById('toggle-city-labels')?.addEventListener('click', (e) => {
            cityLabelsVisible = !cityLabelsVisible;
            e.currentTarget.classList.toggle('active', cityLabelsVisible);
        });

        // City spheres toggle
        document.getElementById('toggle-city-spheres')?.addEventListener('click', (e) => {
            citySpheresVisible = !citySpheresVisible;
            e.currentTarget.classList.toggle('active', citySpheresVisible);
            // Immediately update visibility
            cityMarkers.forEach(marker => {
                if (!citySpheresVisible) marker.visible = false;
            });
        });

    }

    // ==================== CITY CAROUSEL ====================
    const cityCarousel = document.getElementById('city-carousel');
    const carouselScroll = cityCarousel?.querySelector('.carousel-scroll');
    let carouselDragging = false;
    let carouselStartX = 0;
    let carouselScrollLeft = 0;
    let currentPathCities = [];
    let loopWidth = 0;
    let carouselVelocity = 0;
    let carouselLastX = 0;
    let carouselLastTime = 0;
    let momentumAnimationId = null;
    // Cities sorted in eastward chain - each city connects to nearest neighbor
    // Sort once at startup - no rebuilding needed
    const sortedCities = sortCitiesEastwardChain(CITIES);
    let carouselInitialized = false;
    let carouselClickLock = false;  // Prevent highlight updates right after click
    let lastHighlightedCity = null;  // Track last city to prevent jitter
    let scrollDebounceTimer = null;  // Debounce scroll-to-city

    // Handle city bubble click - navigate to city
    function onBubbleClick(e) {
        // Don't trigger click if we were dragging
        if (carouselDragging) return;

        e.stopPropagation();
        const bubble = e.currentTarget;
        const lat = parseFloat(bubble.dataset.lat);
        const lon = parseFloat(bubble.dataset.lon);
        const cityName = bubble.dataset.name;

        // Lock highlight updates until animation completes
        carouselClickLock = true;
        setTimeout(() => { carouselClickLock = false; }, 500);

        // Remove all highlights first
        const allBubbles = carouselScroll.querySelectorAll('.city-bubble');
        allBubbles.forEach(b => b.classList.remove('current'));

        // Center carousel on clicked city
        const city = sortedCities.find(c => c.name === cityName);
        if (city) {
            scrollToCity(city);
        }

        // Add highlight to new city after scroll
        allBubbles.forEach(b => {
            if (b.dataset.name === cityName) b.classList.add('current');
        });

        // Pinned mode: move pointer only. Unpinned mode: move camera (pointer follows)
        if (focusLocked) {
            animatePointerToCity(lat, lon, 200);
        } else {
            animateCameraToCity(lat, lon, 200);
        }
    }

    // Find and select the city bubble closest to center of carousel
    function selectCenteredCity() {
        if (!carouselScroll) return;

        const scrollRect = carouselScroll.getBoundingClientRect();
        const centerX = scrollRect.left + scrollRect.width / 2;

        const bubbles = carouselScroll.querySelectorAll('.city-bubble');
        let closestBubble = null;
        let closestDist = Infinity;

        bubbles.forEach(bubble => {
            const rect = bubble.getBoundingClientRect();
            const bubbleCenter = rect.left + rect.width / 2;
            const dist = Math.abs(bubbleCenter - centerX);
            if (dist < closestDist) {
                closestDist = dist;
                closestBubble = bubble;
            }
        });

        if (closestBubble) {
            // Update current highlight
            bubbles.forEach(b => b.classList.remove('current'));
            closestBubble.classList.add('current');

            // Navigate to this city
            const lat = parseFloat(closestBubble.dataset.lat);
            const lon = parseFloat(closestBubble.dataset.lon);
            if (focusLocked) {
                animatePointerToCity(lat, lon, 200);
            } else {
                animateCameraToCity(lat, lon, 200);
            }
        }
    }

    // Handle infinite loop scrolling
    function handleLoopScroll() {
        if (!carouselScroll || loopWidth === 0) return;

        const scrollPos = carouselScroll.scrollLeft;
        const oneSetWidth = loopWidth / 3;

        // If scrolled too far left, jump to middle set
        if (scrollPos < oneSetWidth * 0.3) {
            carouselScroll.scrollLeft = scrollPos + oneSetWidth;
        }
        // If scrolled too far right, jump to middle set
        else if (scrollPos > oneSetWidth * 1.7) {
            carouselScroll.scrollLeft = scrollPos - oneSetWidth;
        }
    }

    // Initialize city carousel ONCE with all cities sorted by longitude
    // Never rebuilds - just scrolls and highlights
    function initCityCarousel() {
        if (!carouselScroll || carouselInitialized) return;
        carouselInitialized = true;

        currentPathCities = sortedCities;
        const currentCity = findClosestCity(focusPointLat, focusPointLon);

        // Build HTML - triple the cities for infinite loop effect
        let html = '';
        for (let repeat = 0; repeat < 3; repeat++) {
            for (let i = 0; i < sortedCities.length; i++) {
                const city = sortedCities[i];
                const isCurrent = currentCity && city.name === currentCity.name;
                html += `<div class="city-bubble${isCurrent ? ' current' : ''}" data-lat="${city.lat}" data-lon="${city.lon}" data-name="${city.name}" data-repeat="${repeat}" data-index="${i}">`;
                html += `<span class="city-name">${city.name}</span>`;
                html += `</div>`;
            }
        }
        carouselScroll.innerHTML = html;

        // Add click handlers to bubbles
        const bubbles = carouselScroll.querySelectorAll('.city-bubble');
        bubbles.forEach(bubble => {
            bubble.addEventListener('click', onBubbleClick);
        });

        // Calculate loop width and scroll to current city
        setTimeout(() => {
            loopWidth = carouselScroll.scrollWidth;
            scrollToCity(currentCity);
        }, 50);

        // Setup search functionality
        const searchInput = document.getElementById('city-search');
        if (searchInput) {
            // Find best matching city and scroll to it
            const scrollToBestMatch = (query) => {
                if (!query) return null;
                query = query.toLowerCase();

                // Find best match - prefer starts with, then includes
                let bestMatch = null;
                let bestScore = -1;

                for (const city of sortedCities) {
                    const name = city.name.toLowerCase();
                    let score = 0;
                    if (name === query) score = 100;
                    else if (name.startsWith(query)) score = 50 + (query.length / name.length) * 40;
                    else if (name.includes(query)) score = 10 + (query.length / name.length) * 20;

                    if (score > bestScore) {
                        bestScore = score;
                        bestMatch = city;
                    }
                }

                if (bestMatch) {
                    scrollToCity(bestMatch);
                }
                return bestMatch;
            };

            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.trim();
                if (query) {
                    scrollToBestMatch(query);
                }
            });

            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    searchInput.value = '';
                    searchInput.blur();
                } else if (e.key === 'Enter') {
                    const query = searchInput.value.trim();
                    const match = scrollToBestMatch(query);
                    if (match) {
                        // Select the matched city
                        const bubble = carouselScroll.querySelector(`.city-bubble[data-repeat="1"][data-name="${match.name}"]`);
                        if (bubble) bubble.click();
                    }
                    searchInput.value = '';
                    searchInput.blur();
                }
            });
        }
    }

    // Scroll carousel to center on a city (always instant for responsiveness)
    function scrollToCity(city) {
        if (!carouselScroll || !city) return;

        const middleBubble = carouselScroll.querySelector(`.city-bubble[data-repeat="1"][data-name="${city.name}"]`);
        if (middleBubble) {
            const scrollRect = carouselScroll.getBoundingClientRect();
            const bubbleRect = middleBubble.getBoundingClientRect();
            const offset = bubbleRect.left - scrollRect.left - (scrollRect.width / 2) + (bubbleRect.width / 2);
            carouselScroll.scrollLeft += offset;
        }
    }

    // Update carousel highlight when pointer moves (called from updatePositionDisplay)
    function updateCarouselHighlight() {
        if (!carouselScroll) return;

        // Initialize carousel if not done yet
        if (!carouselInitialized) {
            initCityCarousel();
            return;
        }

        // Skip if click just happened (prevents flash)
        if (carouselClickLock) return;

        // Skip if pointer is being dragged (check global isDragging state)
        const pointerBeingDragged = (typeof isDragging !== 'undefined' && isDragging) ||
                                    (focusMarker && focusMarker.userData && focusMarker.userData.isDragging);

        const currentCity = findClosestCity(focusPointLat, focusPointLon);
        if (!currentCity) return;

        // Only update highlight if city actually changed (prevents jitter)
        if (lastHighlightedCity !== currentCity.name) {
            lastHighlightedCity = currentCity.name;

            // Update highlight on all matching bubbles
            const bubbles = carouselScroll.querySelectorAll('.city-bubble');
            bubbles.forEach(bubble => {
                const isMatch = bubble.dataset.name === currentCity.name;
                bubble.classList.toggle('current', isMatch);
            });

            // Debounced scroll to keep current city visible
            // Skip during pointer drag or carousel interactions
            if (!pointerBeingDragged && !carouselDragging && !momentumAnimationId) {
                // Clear existing debounce timer
                if (scrollDebounceTimer) {
                    clearTimeout(scrollDebounceTimer);
                }

                // Debounce the scroll by 150ms to prevent jitter
                scrollDebounceTimer = setTimeout(() => {
                    const currentBubble = carouselScroll.querySelector('.city-bubble[data-repeat="1"].current');
                    if (currentBubble) {
                        const scrollRect = carouselScroll.getBoundingClientRect();
                        const bubbleRect = currentBubble.getBoundingClientRect();
                        const bubbleCenter = bubbleRect.left + bubbleRect.width / 2;
                        const scrollCenter = scrollRect.left + scrollRect.width / 2;

                        // Only scroll if bubble is way off-center (outside visible area)
                        if (Math.abs(bubbleCenter - scrollCenter) > scrollRect.width * 0.8) {
                            scrollToCity(currentCity);
                        }
                    }
                    scrollDebounceTimer = null;
                }, 150);
            }
        }
    }

    // Expose updateCarouselHighlight globally for updatePositionDisplay
    window.updateCarouselHighlight = updateCarouselHighlight;

    const MAX_VELOCITY = 25; // Speed limit

    // Momentum animation for carousel
    function animateMomentum() {
        if (Math.abs(carouselVelocity) < 0.5) {
            momentumAnimationId = null;
            handleLoopScroll();
            selectCenteredCity();
            return;
        }

        carouselScroll.scrollLeft += carouselVelocity;
        carouselVelocity *= 0.94; // Friction

        handleLoopScroll();
        selectCenteredCity(); // Select city as it scrolls by
        momentumAnimationId = requestAnimationFrame(animateMomentum);
    }

    function startMomentum() {
        if (!momentumAnimationId && Math.abs(carouselVelocity) > 0.5) {
            animateMomentum();
        }
    }

    function stopMomentum() {
        if (momentumAnimationId) {
            cancelAnimationFrame(momentumAnimationId);
            momentumAnimationId = null;
        }
        carouselVelocity = 0;
    }

    // Mouse wheel scrolling - adds to velocity for momentum
    if (carouselScroll) {
        carouselScroll.addEventListener('wheel', (e) => {
            e.preventDefault();

            // Add wheel delta to velocity
            carouselVelocity -= e.deltaY * 0.3;

            // Clamp velocity
            carouselVelocity = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, carouselVelocity));

            // Start momentum animation if not running
            startMomentum();
        }, { passive: false });

        // Drag scrolling
        carouselScroll.addEventListener('mousedown', (e) => {
            stopMomentum();
            carouselDragging = true;
            carouselStartX = e.pageX - carouselScroll.offsetLeft;
            carouselScrollLeft = carouselScroll.scrollLeft;
            carouselLastX = e.pageX;
            carouselLastTime = Date.now();
            carouselVelocity = 0;
            carouselScroll.style.cursor = 'grabbing';
        });

        function endDrag() {
            if (carouselDragging) {
                carouselDragging = false;
                carouselScroll.style.cursor = 'grab';

                // Start momentum if there's velocity
                if (Math.abs(carouselVelocity) > 1) {
                    animateMomentum();
                } else {
                    handleLoopScroll();
                    selectCenteredCity();
                }
            }
        }

        carouselScroll.addEventListener('mouseleave', endDrag);
        carouselScroll.addEventListener('mouseup', endDrag);

        carouselScroll.addEventListener('mousemove', (e) => {
            if (!carouselDragging) return;
            e.preventDefault();

            const x = e.pageX - carouselScroll.offsetLeft;
            const walk = (x - carouselStartX) * 1.5;
            carouselScroll.scrollLeft = carouselScrollLeft - walk;

            // Track velocity
            const now = Date.now();
            const dt = now - carouselLastTime;
            if (dt > 0) {
                carouselVelocity = (carouselLastX - e.pageX) * 1.5 / Math.max(dt, 8) * 16;
                // Clamp velocity
                carouselVelocity = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, carouselVelocity));
            }
            carouselLastX = e.pageX;
            carouselLastTime = now;
        });

        // Touch support for carousel
        carouselScroll.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            stopMomentum();
            carouselDragging = true;
            const touch = e.touches[0];
            carouselStartX = touch.pageX - carouselScroll.offsetLeft;
            carouselScrollLeft = carouselScroll.scrollLeft;
            carouselLastX = touch.pageX;
            carouselLastTime = Date.now();
            carouselVelocity = 0;
        }, { passive: true });

        carouselScroll.addEventListener('touchmove', (e) => {
            if (!carouselDragging || e.touches.length !== 1) return;

            const touch = e.touches[0];
            const x = touch.pageX - carouselScroll.offsetLeft;
            const walk = (x - carouselStartX) * 1.5;
            carouselScroll.scrollLeft = carouselScrollLeft - walk;

            // Track velocity
            const now = Date.now();
            const dt = now - carouselLastTime;
            if (dt > 0) {
                carouselVelocity = (carouselLastX - touch.pageX) * 1.5 / Math.max(dt, 8) * 16;
                carouselVelocity = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, carouselVelocity));
            }
            carouselLastX = touch.pageX;
            carouselLastTime = now;
        }, { passive: true });

        carouselScroll.addEventListener('touchend', (e) => {
            if (!carouselDragging) return;
            carouselDragging = false;

            // Start momentum if there's velocity
            if (Math.abs(carouselVelocity) > 1) {
                animateMomentum();
            } else {
                handleLoopScroll();
                selectCenteredCity();
            }
        });

        carouselScroll.addEventListener('touchcancel', () => {
            carouselDragging = false;
            carouselVelocity = 0;
        });

        // Handle scroll end for loop reset
        let scrollTimeout;
        carouselScroll.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                if (!momentumAnimationId) {
                    handleLoopScroll();
                }
            }, 100);
        });
    }

    // Initialize carousel on load
    initCityCarousel();

    updateViewZoomButton();
}

/**
 * Setup zoom slider on right side
 */
let zoomSliderElement = null;

const DEFAULT_FOV = 75;
const MIN_FOV = 15;  // Zoomed in

function updateZoomSlider() {
    if (!zoomSliderElement) return;
    // Map zoom state to slider value (0-100)
    // 0 = max zoom out (CAMERA_MAX_RADIUS) - bottom of slider
    // 50 = horizon view (CAMERA_MIN_RADIUS, FOV = default) - middle of slider
    // 100 = sky view (CAMERA_MIN_RADIUS, FOV = min/zoomed) - top of slider

    if (cameraRadius > CAMERA_MIN_RADIUS + 10) {
        // In orbital view: map cameraRadius to 0-50
        const range = CAMERA_MAX_RADIUS - CAMERA_MIN_RADIUS;
        const value = 50 - ((cameraRadius - CAMERA_MIN_RADIUS) / range) * 50;
        zoomSliderElement.value = Math.max(0, value);
    } else {
        // In horizon/sky view: map camera FOV to 50-100
        // FOV: DEFAULT_FOV = horizon (50), MIN_FOV = zoomed in (100)
        const fovRange = DEFAULT_FOV - MIN_FOV;
        const currentFov = camera ? camera.fov : DEFAULT_FOV;
        const fovRatio = (DEFAULT_FOV - currentFov) / fovRange;
        const value = 50 + fovRatio * 50;
        zoomSliderElement.value = Math.min(100, value);
    }
}

function setupZoomSlider() {
    zoomSliderElement = document.getElementById('zoom-slider');
    if (!zoomSliderElement) return;

    // Track previous horizon mode state for detecting transitions
    let wasInHorizonMode = cameraRadius < HORIZON_THRESHOLD;

    let prevSliderRadius = cameraRadius;

    // Handle slider input
    zoomSliderElement.addEventListener('input', (e) => {
        const sliderValue = parseFloat(e.target.value);

        // 0-50: orbital to horizon (cameraRadius MAX to MIN)
        // 50-100: horizon to sky view (horizonPitch 0 to max up)

        if (sliderValue <= 50) {
            // Orbital view: map slider 0-50 to cameraRadius MAX to MIN
            const range = CAMERA_MAX_RADIUS - CAMERA_MIN_RADIUS;
            const t = sliderValue / 50; // 0 to 1
            cameraRadius = CAMERA_MAX_RADIUS - t * range;

            // Reset FOV to default when in orbital view
            if (camera.fov !== DEFAULT_FOV) {
                camera.fov = DEFAULT_FOV;
                camera.updateProjectionMatrix();
            }

            // Track active zooming in for pointer alignment
            if (cameraRadius < prevSliderRadius && cameraRadius > HORIZON_THRESHOLD) {
                isZoomingIn = true;
                clearTimeout(zoomingInTimeout);
                zoomingInTimeout = setTimeout(() => { isZoomingIn = false; }, 150);
            }
            prevSliderRadius = cameraRadius;

            // Check if we just entered horizon mode (crossed the threshold)
            const nowInHorizonMode = cameraRadius < HORIZON_THRESHOLD;

            // When entering horizon view, point at horizon in target direction (no pitch up)
            if (nowInHorizonMode && !wasInHorizonMode) {
                // Failsafe: snap camera to be centered on pointer
                if (focusLocked) {
                    cameraRefLat = focusPointLat - dragOffsetLat;
                    cameraRefLon = focusPointLon - dragOffsetLon;
                }

                const target = getHorizonEntryTarget();
                // Start at horizon level facing target direction
                horizonYaw = target.yaw;
                horizonPitch = 0;
            }

            wasInHorizonMode = nowInHorizonMode;
        } else {
            // Sky view: map slider 50-100 to camera FOV (zoom in optically)
            // Keep camera at min radius
            cameraRadius = CAMERA_MIN_RADIUS;

            // When first entering sky view (slider crosses 50), start looking up animation
            if (!wasInHorizonMode || camera.fov >= DEFAULT_FOV - 1) {
                const target = getHorizonEntryTarget();
                pendingHorizonAnimation = true;
                pendingTargetYaw = target.yaw;
                pendingTargetPitch = target.pitch;
            }

            const t = (sliderValue - 50) / 50; // 0 to 1
            const fovRange = DEFAULT_FOV - MIN_FOV;
            camera.fov = DEFAULT_FOV - t * fovRange;
            camera.updateProjectionMatrix();

            wasInHorizonMode = true;
        }
    });

    // Track active/sliding state for cyan highlight
    zoomSliderElement.addEventListener('mousedown', () => {
        zoomSliderElement.classList.add('active');
    });
    zoomSliderElement.addEventListener('touchstart', () => {
        zoomSliderElement.classList.add('active');
    });
    document.addEventListener('mouseup', () => {
        zoomSliderElement.classList.remove('active');
    });
    document.addEventListener('touchend', () => {
        zoomSliderElement.classList.remove('active');
    });

    // Prevent context menu on slider
    zoomSliderElement.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    // Initialize slider value
    updateZoomSlider();
}

// Update zoom slider thumb color based on pinned mode
function updateZoomSliderMode() {
    if (!zoomSliderElement) return;
    if (focusLocked) {
        zoomSliderElement.classList.remove('unpinned');
        zoomSliderElement.classList.add('pinned');
    } else {
        zoomSliderElement.classList.remove('pinned');
        zoomSliderElement.classList.add('unpinned');
    }
}

// ==================== ASTRONOMICAL CALCULATIONS (Swiss Ephemeris) ====================

/**
 * Convert JavaScript Date to Julian Day
 */
function dateToJulianDay(date) {
    if (sweInitialized && swe) {
        const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
        return swe.julday(
            date.getUTCFullYear(),
            date.getUTCMonth() + 1,  // JS months are 0-indexed
            date.getUTCDate(),
            hours
        );
    }
    // Fallback calculation
    return date.getTime() / 86400000 + 2440587.5;
}

/**
 * Calculate Greenwich Mean Sidereal Time in degrees
 */
function getGMST(jd) {
    if (sweInitialized && swe) {
        // Swiss Ephemeris returns sidereal time in hours
        const sidtime = swe.sidtime(jd);
        return (sidtime * 15) % 360;  // Convert hours to degrees
    }
    // Fallback calculation
    const D = jd - 2451545.0;
    const T = D / 36525;
    return (280.46061837 + 360.98564736629 * D + 0.000387933 * T * T) % 360;
}

/**
 * Calculate the sun's subsolar point using Swiss Ephemeris
 * @param {Date} date - Current date/time
 * @returns {{lat: number, lon: number}} Subsolar point in degrees
 */
function getSunPosition(date) {
    const jd = dateToJulianDay(date);

    if (sweInitialized && swe) {
        // Use Swiss Ephemeris with equatorial coordinates flag
        // SEFLG_EQUATORIAL = 2048 returns RA/Dec instead of ecliptic
        const flags = swe.SEFLG_SWIEPH | 2048;  // SEFLG_EQUATORIAL
        const result = swe.calc_ut(jd, swe.SE_SUN, flags);

        // result[0] = Right Ascension in degrees
        // result[1] = Declination in degrees
        const ra = result[0];
        const dec = result[1];

        // Calculate subsolar longitude from RA and GMST
        const gmst = getGMST(jd);
        let lon = ra - gmst;
        lon = ((lon + 180) % 360) - 180;  // Normalize to -180 to 180

        return { lat: dec, lon: lon };
    }

    // Fallback to simplified calculation if Swiss Ephemeris not ready
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date - start;
    const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
    const declination = 23.44 * Math.sin((2 * Math.PI / 365) * (dayOfYear - 81));
    const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
    const sunLon = -((hours - 12) * 15);
    return {
        lat: declination,
        lon: ((sunLon + 180) % 360) - 180
    };
}

/**
 * Calculate the moon's sublunar point using Swiss Ephemeris
 * @param {Date} date - Current date/time
 * @returns {{lat: number, lon: number, phase: number}} Sublunar point and phase (0-1)
 */
function getMoonPosition(date) {
    const jd = dateToJulianDay(date);

    if (sweInitialized && swe) {
        // Get Moon position with equatorial coordinates
        const flags = swe.SEFLG_SWIEPH | 2048;  // SEFLG_EQUATORIAL
        const moonResult = swe.calc_ut(jd, swe.SE_MOON, flags);

        // moonResult[0] = Right Ascension in degrees
        // moonResult[1] = Declination in degrees
        const ra = moonResult[0];
        const dec = moonResult[1];

        // Calculate sublunar longitude from RA and GMST
        const gmst = getGMST(jd);
        let lon = ra - gmst;
        lon = ((lon + 180) % 360) - 180;  // Normalize to -180 to 180

        // Calculate moon phase using ecliptic longitudes
        const sunEcl = swe.calc_ut(jd, swe.SE_SUN, swe.SEFLG_SWIEPH);
        const moonEcl = swe.calc_ut(jd, swe.SE_MOON, swe.SEFLG_SWIEPH);
        let elongation = moonEcl[0] - sunEcl[0];
        elongation = ((elongation % 360) + 360) % 360;
        const phase = elongation / 360;

        return { lat: dec, lon: lon, phase: phase };
    }

    // Fallback to simplified calculation if Swiss Ephemeris not ready
    const D = jd - 2451545.0;
    const L = (218.316 + 13.176396 * D) % 360;
    const M = (134.963 + 13.064993 * D) % 360;
    const F = (93.272 + 13.229350 * D) % 360;
    const lonEcl = L + 6.289 * Math.sin(M * Math.PI / 180);
    const latEcl = 5.128 * Math.sin(F * Math.PI / 180);
    const obliquity = 23.44;
    const oblRad = obliquity * Math.PI / 180;
    const lonRad = lonEcl * Math.PI / 180;
    const latRad = latEcl * Math.PI / 180;
    const sinDec = Math.sin(latRad) * Math.cos(oblRad) +
                   Math.cos(latRad) * Math.sin(oblRad) * Math.sin(lonRad);
    const declination = Math.asin(sinDec) * 180 / Math.PI;
    const y = Math.sin(lonRad) * Math.cos(oblRad) - Math.tan(latRad) * Math.sin(oblRad);
    const x = Math.cos(lonRad);
    const rightAscension = Math.atan2(y, x) * 180 / Math.PI;
    const T = D / 36525;
    const GST = (280.46061837 + 360.98564736629 * D + 0.000387933 * T * T) % 360;
    const moonLon = ((rightAscension - GST) % 360 + 540) % 360 - 180;
    const sunPos = getSunPosition(date);
    let elongation = lonEcl - (sunPos.lon + ((date.getUTCHours() - 12) * 15));
    elongation = ((elongation % 360) + 360) % 360;
    const phase = elongation / 360;
    return { lat: declination, lon: moonLon, phase: phase };
}

/**
 * Convert lat/lon to 3D direction vector (unit sphere)
 */
function latLonToDirection(lat, lon) {
    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;
    return new THREE.Vector3(
        Math.cos(latRad) * Math.cos(lonRad),
        Math.cos(latRad) * Math.sin(lonRad),
        Math.sin(latRad)
    );
}

/**
 * Convert Right Ascension (hours) and Declination (degrees) to 3D position
 */
function raDecToPosition(raHours, decDeg, distance) {
    const ra = raHours * 15 * Math.PI / 180;  // Convert hours to degrees to radians
    const dec = decDeg * Math.PI / 180;
    return new THREE.Vector3(
        distance * Math.cos(dec) * Math.cos(ra),
        distance * Math.cos(dec) * Math.sin(ra),
        distance * Math.sin(dec)
    );
}

// Major constellations - [name, [[ra1, dec1], [ra2, dec2], ...]] in hours and degrees
const CONSTELLATIONS = {
    'Orion': [
        [[5.92, 7.41], [5.53, -1.20]],   // Betelgeuse to Bellatrix region
        [[5.53, -1.20], [5.42, -2.60]],  // Belt
        [[5.42, -2.60], [5.24, -8.20]],  // To Rigel area
        [[5.92, 7.41], [5.59, -1.94]],   // Shoulder to belt
        [[5.59, -1.94], [5.68, -1.94]],  // Belt stars
        [[5.68, -1.94], [5.79, -9.67]],  // Belt to Saiph
    ],
    'BigDipper': [
        [[11.06, 61.75], [11.03, 56.38]],  // Dubhe to Merak
        [[11.03, 56.38], [11.90, 53.69]],  // Merak to Phecda
        [[11.90, 53.69], [12.26, 57.03]],  // Phecda to Megrez
        [[12.26, 57.03], [12.90, 55.96]],  // Megrez to Alioth
        [[12.90, 55.96], [13.40, 54.93]],  // Alioth to Mizar
        [[13.40, 54.93], [13.79, 49.31]],  // Mizar to Alkaid
    ],
    'Cassiopeia': [
        [[0.15, 59.15], [0.68, 56.54]],   // Schedar to Caph
        [[0.68, 56.54], [0.95, 60.72]],   // W shape
        [[0.95, 60.72], [1.43, 60.24]],
        [[1.43, 60.24], [1.91, 63.67]],
    ],
    'Crux': [  // Southern Cross
        [[12.44, -63.10], [12.52, -57.11]],  // Vertical
        [[12.35, -58.75], [12.79, -59.69]],  // Horizontal
    ],
    'Scorpius': [
        [[16.49, -26.43], [16.00, -22.62]],  // Antares region
        [[16.00, -22.62], [15.98, -26.11]],
        [[16.49, -26.43], [16.87, -34.29]],
        [[16.87, -34.29], [17.20, -37.10]],
        [[17.20, -37.10], [17.62, -42.99]],  // Tail
    ]
};

// Polaris (North Star) - RA: 2h 31m, Dec: +89° 15'
const POLARIS = { ra: 2.52, dec: 89.26 };

// Default fallback location: 45°N, 0°E (near Bordeaux, France)
let userLat = 45;
let userLon = 0;

// Camera orbit state
let cameraRefLat, cameraRefLon;  // Reference position (user's location)
let cameraRadius = EARTH_RADIUS + 5000;  // Distance from Earth center
const CAMERA_MIN_RADIUS = EARTH_RADIUS + 4;  // Very close to surface for horizon view
const CAMERA_MAX_RADIUS = EARTH_RADIUS * 6;

// Horizon view state - discrete states with smooth snap transition
const HORIZON_THRESHOLD = EARTH_RADIUS + 700;  // Snap threshold
const HORIZON_CAMERA_HEIGHT = EARTH_RADIUS + 16;  // Fixed height when in horizon mode (flat against surface)
let isHorizonMode = false;           // Current mode: false = orbital, true = horizon
let horizonBlendValue = 0;           // Animated blend value (0 = orbital, 1 = horizon)
const VIEW_SNAP_SPEED = 8;           // Speed of snap transition
let horizonZoomAccumulator = 0;      // Accumulated zoom input in horizon mode
const HORIZON_DEAD_ZONE = 8;         // Number of scroll events before FOV zoom starts

// Drag state
let isDragging = false;        // Left-click: move focus point
let isTouching = false;        // Touch: dragging on mobile
let dragStartX = 0, dragStartY = 0;
let dragOffsetLat = 0, dragOffsetLon = 0;

// Focus point state (separate from camera - the pink marker location)
let focusPointLat = 0;
let focusPointLon = 0;
let focusVelocityLat = 0;      // Momentum for rolling
let focusVelocityLon = 0;
let focusLocked = false;       // When true, pointer is PINNED to Earth surface (fixed lat/lon). When false, UNPINNED (follows camera center)
// Note: focusLockedLocalPos removed - unpinned mode now keeps pointer under camera
const FOCUS_FRICTION = 0.97;   // Friction for rolling (lower = more friction)
const FOCUS_MIN_VELOCITY = 0.01;  // Stop rolling below this speed

// Horizon view look-around state (yaw/pitch when zoomed in)
let horizonYaw = 0;    // Horizontal rotation (radians)
let horizonPitch = 0;  // Vertical rotation (radians)

// Celestial body targeting (for zoom-past-horizon feature)
let celestialTargetIndex = 0;  // 0 = sun, 1 = moon
let zoomTargetMode = 2;  // 0 = sun, 1 = moon, 2 = free (start free/north)
let isAnimatingToTarget = false;
let pendingHorizonAnimation = false;  // Delay animation until blend threshold
let pendingTargetYaw = 0, pendingTargetPitch = 0;
const HORIZON_ANIMATION_THRESHOLD = 0.8;  // Start animation when blend reaches this
let targetYaw = 0, targetPitch = 0;
let animationStartYaw = 0, animationStartPitch = 0;
let animationProgress = 0;
const CELESTIAL_ANIMATION_SPEED = 4;  // Speed of animation (per second)

// Snap-back state
let isSnappingBack = false;
let snapFromLat = 0, snapFromLon = 0;
let snapProgress = 0;
const SNAP_SPEED = 5; // Snap-back speed (per second)

// Zoom-to-pointer state (tracks active zooming in)
let isZoomingIn = false;
let zoomingInTimeout = null;
let zoomAlignRampUp = 0;  // Ramps from 0 to 1 for smooth start

const SPOT_POS_RAISE = 8;

/**
 * Load an image and downsample it to reduce memory usage
 * Returns a Three.js texture from the downsampled canvas
 */
function loadAndDownsampleTexture(url, targetWidth) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            // Calculate target height maintaining aspect ratio
            const aspectRatio = img.height / img.width;
            const targetHeight = Math.round(targetWidth * aspectRatio);

            // Create canvas and downsample
            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

            // Create Three.js texture from canvas
            const texture = new THREE.CanvasTexture(canvas);
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;

            resolve(texture);
        };

        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = url;
    });
}

// City data now unified with CITIES array at top of file

/**
 * Timezone to approximate coordinates mapping
 */
const TIMEZONE_COORDS = {
    'America/New_York': { lat: 40.7128, lon: -74.0060 },
    'America/Chicago': { lat: 41.8781, lon: -87.6298 },
    'America/Denver': { lat: 39.7392, lon: -104.9903 },
    'America/Phoenix': { lat: 33.4484, lon: -112.0740 },
    'America/Los_Angeles': { lat: 34.0522, lon: -118.2437 },
    'America/Vancouver': { lat: 49.2827, lon: -123.1207 },
    'America/Toronto': { lat: 43.6532, lon: -79.3832 },
    'America/Edmonton': { lat: 53.5461, lon: -113.4938 },
    'America/Winnipeg': { lat: 49.8951, lon: -97.1384 },
    'America/Halifax': { lat: 44.6488, lon: -63.5752 },
    'America/Mexico_City': { lat: 19.4326, lon: -99.1332 },
    'America/Sao_Paulo': { lat: -23.5505, lon: -46.6333 },
    'America/Buenos_Aires': { lat: -34.6037, lon: -58.3816 },
    'Europe/London': { lat: 51.5074, lon: -0.1278 },
    'Europe/Paris': { lat: 48.8566, lon: 2.3522 },
    'Europe/Berlin': { lat: 52.5200, lon: 13.4050 },
    'Europe/Moscow': { lat: 55.7558, lon: 37.6173 },
    'Asia/Dubai': { lat: 25.2048, lon: 55.2708 },
    'Asia/Kolkata': { lat: 19.0760, lon: 72.8777 },
    'Asia/Shanghai': { lat: 31.2304, lon: 121.4737 },
    'Asia/Tokyo': { lat: 35.6762, lon: 139.6503 },
    'Asia/Seoul': { lat: 37.5665, lon: 126.9780 },
    'Asia/Hong_Kong': { lat: 22.3193, lon: 114.1694 },
    'Asia/Singapore': { lat: 1.3521, lon: 103.8198 },
    'Australia/Sydney': { lat: -33.8688, lon: 151.2093 },
    'Africa/Cairo': { lat: 30.0444, lon: 31.2357 },
    'Africa/Lagos': { lat: 6.5244, lon: 3.3792 }
};

/**
 * Get user's location using timezone fallback
 * @returns {Promise<{lat: number, lon: number}>}
 */
async function getUserLocation() {
    // Use timezone-based location
    try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        console.log(`Detected timezone: ${timezone}`);

        if (TIMEZONE_COORDS[timezone]) {
            return TIMEZONE_COORDS[timezone];
        }

        // Try to match timezone prefix (e.g., "America/Phoenix" -> "America/Denver")
        const timezonePrefix = timezone.split('/')[0];
        for (const [tz, coords] of Object.entries(TIMEZONE_COORDS)) {
            if (tz.startsWith(timezonePrefix)) {
                console.log(`Using approximate match: ${tz}`);
                return coords;
            }
        }
    } catch (error) {
        console.log('Timezone detection failed');
    }

    console.log('Using default location');
    return { lat: userLat, lon: userLon };
}

async function init() {
    // Initialize Swiss Ephemeris for accurate astronomical calculations
    await initSwissEph();

    // Get user location
    const location = await getUserLocation();
    userLat = location.lat;
    userLon = location.lon;
    console.log(`User location: ${userLat.toFixed(2)}°, ${userLon.toFixed(2)}°`);

    // Set camera reference to user location
    cameraRefLat = userLat;
    cameraRefLon = userLon;

    // Initialize focus point at user location
    focusPointLat = userLat;
    focusPointLon = userLon;

    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    // Create camera
    camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        1,
        10000000  // Far plane for sun at 6M units
    );

    // Create renderer with logarithmic depth buffer for cosmic-scale precision
    renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('container').appendChild(renderer.domElement);

    // Create Earth (wireframe sphere)
    createEarth();

    // Create Moon at accurate distance and scale
    createMoon();

    // Create Sun at fixed visual distance with correct angular size
    createSun();

    // Create eclipse shadow cones (umbra, penumbra, antumbra)
    createEclipseCones();

    // Lighting - dim ambient so dark sides aren't pure black
    const ambientLight = new THREE.AmbientLight(0xb8b8b8, 0.2);
    scene.add(ambientLight);

    // Sun directional light - illuminates Earth and Moon, casts shadows for eclipses
    sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
    sunLight.castShadow = true;

    // Shadow camera frustum - must cover Moon's orbit (~65 Earth radii = ~390,000 scene units)
    const shadowFrustumSize = EARTH_RADIUS * 70;  // Slightly larger than moon orbit
    sunLight.shadow.camera.left = -shadowFrustumSize;
    sunLight.shadow.camera.right = shadowFrustumSize;
    sunLight.shadow.camera.top = shadowFrustumSize;
    sunLight.shadow.camera.bottom = -shadowFrustumSize;
    sunLight.shadow.camera.near = SUN_VISUAL_DISTANCE - shadowFrustumSize;
    sunLight.shadow.camera.far = SUN_VISUAL_DISTANCE + shadowFrustumSize;

    // High resolution shadow map for eclipse detail
    sunLight.shadow.mapSize.width = 4096;
    sunLight.shadow.mapSize.height = 4096;
    sunLight.shadow.bias = -0.0001;

    scene.add(sunLight);

    // Initial camera position (looking at Earth with north up)
    setCameraFromSpherical(cameraRefLat, cameraRefLon, cameraRadius);

    // Setup orbit controls
    setupOrbitControls();

    // Setup time control slider
    setupTimeControl();

    // Initialize datetime scroll wheels
    initDateTimeWheels();

    // Setup left side controls
    setupLeftControls();

    // Setup zoom slider
    setupZoomSlider();
    updateZoomSliderMode();

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // Check initial celestial container position
    updateCelestialContainerPosition();

    // Setup UI visibility toggle
    setupUIVisibilityToggle();

    // Start animation loop
    animate();
}

function createEarth() {
    const earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS, 512, 512);

    // Create material with day/night texture blending via onBeforeCompile
    earthMaterial = new THREE.MeshStandardMaterial({
        roughness: 0.8,
        metalness: 0.0
    });

    // Store custom uniforms for shader injection
    earthMaterial.userData.sunDirection = { value: new THREE.Vector3(1, 0, 0) };
    earthMaterial.userData.moonPosition = { value: new THREE.Vector3(0, 0, 0) };
    earthMaterial.userData.moonRadius = { value: MOON_RADIUS };
    earthMaterial.userData.sunAngularRadius = { value: SUN_ANGULAR_DIAMETER_RAD / 2 };

    // Inject custom shader code for eclipse darkening
    earthMaterial.onBeforeCompile = (shader) => {
        // Add custom uniforms
        shader.uniforms.sunDirection = earthMaterial.userData.sunDirection;
        shader.uniforms.moonPosition = earthMaterial.userData.moonPosition;
        shader.uniforms.moonRadius = earthMaterial.userData.moonRadius;
        shader.uniforms.sunAngularRadius = earthMaterial.userData.sunAngularRadius;

        // Add uniform declarations to fragment shader
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            uniform vec3 sunDirection;
            uniform vec3 moonPosition;
            uniform float moonRadius;
            uniform float sunAngularRadius;
            varying vec3 vWorldNormal;
            varying vec3 vWorldPosition;

            // Calculate eclipse coverage (0 = no eclipse, 1 = total eclipse)
            float calculateEclipseCoverage(vec3 worldPos, vec3 moonPos, vec3 sunDir, float moonRad) {
                // Vector from surface point to moon
                vec3 toMoon = moonPos - worldPos;
                float distToMoon = length(toMoon);
                vec3 moonDir = toMoon / distToMoon;

                // Angular radius of moon as seen from this point
                float moonAngularRadius = atan(moonRad / distToMoon);

                // Angular separation between sun and moon centers
                // sunDir points FROM origin TO sun, moonDir points FROM surface TO moon
                // For eclipse, both should point roughly the same direction
                float angularSep = acos(clamp(dot(moonDir, sunDir), -1.0, 1.0));

                // Check if moon is toward the sun (not behind Earth)
                if (dot(moonDir, sunDir) < 0.0) return 0.0;

                // Calculate overlap
                float sumRadii = sunAngularRadius + moonAngularRadius;
                float diffRadii = abs(sunAngularRadius - moonAngularRadius);

                if (angularSep >= sumRadii) {
                    // No overlap
                    return 0.0;
                } else if (angularSep <= diffRadii) {
                    // One completely inside the other
                    float smallerArea = 3.14159 * min(sunAngularRadius, moonAngularRadius) * min(sunAngularRadius, moonAngularRadius);
                    float sunArea = 3.14159 * sunAngularRadius * sunAngularRadius;
                    return smallerArea / sunArea;
                } else {
                    // Partial overlap - lens-shaped intersection
                    float r1 = sunAngularRadius;
                    float r2 = moonAngularRadius;
                    float d = angularSep;

                    float part1 = r1 * r1 * acos((d * d + r1 * r1 - r2 * r2) / (2.0 * d * r1));
                    float part2 = r2 * r2 * acos((d * d + r2 * r2 - r1 * r1) / (2.0 * d * r2));
                    float part3 = 0.5 * sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));

                    float overlapArea = part1 + part2 - part3;
                    float sunArea = 3.14159 * r1 * r1;

                    return clamp(overlapArea / sunArea, 0.0, 1.0);
                }
            }
            `
        );

        // Add world normal and position calculation to vertex shader
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            varying vec3 vWorldNormal;
            varying vec3 vWorldPosition;
            `
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <worldpos_vertex>',
            `#include <worldpos_vertex>
            vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
            `
        );

        // Apply eclipse darkening
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            // Calculate sun illumination factor for eclipse darkening
            float sunDot = dot(vWorldNormal, normalize(sunDirection));
            float dayFactor = smoothstep(-0.1, 0.2, sunDot);

            // Calculate eclipse coverage and apply darkening to dayside only
            float eclipseCoverage = calculateEclipseCoverage(vWorldPosition, moonPosition, normalize(sunDirection), moonRadius);
            // eclipseCoverage: 0 = no eclipse, 1 = total eclipse (100% sun blocked)
            // Apply darkening only to the illuminated (day) side
            float eclipseDarkening = 1.0 - eclipseCoverage * 0.95;
            // Darken the color based on how much sun is blocked, only on day side
            diffuseColor.rgb *= mix(1.0, eclipseDarkening, dayFactor);
            `
        );

        // Store shader reference for uniform updates
        earthMaterial.userData.shader = shader;
    };

    const earthSphere = new THREE.Mesh(earthGeometry, earthMaterial);
    earthSphere.rotation.x = Math.PI / 2;  // Fix for +Z up coordinate system
    earthSphere.castShadow = true;
    earthSphere.receiveShadow = true;
    scene.add(earthSphere);

    // Load day texture
    const loader = new THREE.TextureLoader();
    loader.load('natural-earth-no-ice-clouds.jpeg', (texture) => {
        earthMaterial.map = texture;
        earthMaterial.color = new THREE.Color(0xBDCCDB); // Green tint
        earthMaterial.needsUpdate = true;
        console.log('Day texture loaded');
    }, undefined, (err) => {
        console.error('Failed to load day texture:', err);
    });

    // Load elevation/displacement map
    loader.load('earth-elevation.jpg', (texture) => {
        earthMaterial.displacementMap = texture;
        earthMaterial.displacementScale = 5;  // Exaggerated for visibility (real would be ~8 units)
        earthMaterial.needsUpdate = true;
        console.log('Elevation map loaded');
    }, undefined, (err) => {
        console.error('Failed to load elevation map:', err);
    });

    // Create shadow-casting sphere for Earth (for solar/lunar eclipses)
    // Uses a fully transparent material but still casts shadows
    const shadowGeometry = new THREE.SphereGeometry(EARTH_RADIUS, 64, 64);
    const shadowMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false
    });
    const earthShadowCaster = new THREE.Mesh(shadowGeometry, shadowMaterial);
    earthShadowCaster.castShadow = true;    // Casts shadow onto Moon (lunar eclipse)
    scene.add(earthShadowCaster);

    // Plot major cities
    plotCities();

    // Create focus marker (ring at camera focus point)
    createFocusMarker();

    // Create sun and moon
    createCelestialBodies();

    // Create reference cube at center (for debugging)
    createReferenceCube();
}

/**
 * Create the focus marker - big bouncy hot pink arrow pointing at Earth
 */
function createFocusMarker() {
    focusMarker = new THREE.Group();
    focusMarker.renderOrder = 998;

    const brightRed = 0xff3333;
    const darkRed = 0x000000;
    const hotPink = 0xff1493;
    const darkPink = 0x000000;
    const hoverCyan = 0x00dddd;
    const hoverDarkCyan = 0x000000;

    // Hollow frustum (tapered ring) pointer design
    const frustumHeight = 50;
    const bottomOuterRadius = 90;
    const topOuterRadius = 85;
    const wallThickness = 5;  // Same as compass outer ring thickness
    const bottomInnerRadius = bottomOuterRadius - wallThickness;
    const topInnerRadius = topOuterRadius - wallThickness;
    const segments = 32;

    // Create frustum geometry using LatheGeometry with cross-section profile
    const frustumProfile = new THREE.Shape();
    // Start at bottom outer edge, go clockwise
    frustumProfile.moveTo(bottomOuterRadius, 0);
    frustumProfile.lineTo(topOuterRadius, frustumHeight);
    frustumProfile.lineTo(topInnerRadius, frustumHeight);
    frustumProfile.lineTo(bottomInnerRadius, 0);
    frustumProfile.lineTo(bottomOuterRadius, 0);

    // Create points for LatheGeometry (profile as array of Vector2)
    const lathePoints = [
        new THREE.Vector2(bottomOuterRadius, 0),
        new THREE.Vector2(topOuterRadius, frustumHeight),
        new THREE.Vector2(topInnerRadius, frustumHeight),
        new THREE.Vector2(bottomInnerRadius, 0),
    ];

    // Main fill material (starts unpinned = red)
    const fillMaterial = new THREE.MeshBasicMaterial({
        color: brightRed,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide
    });

    // Dark outline material (black outline)
    const outlineMaterial = new THREE.MeshBasicMaterial({
        color: darkRed,
        transparent: true,
        opacity: 1.0,
        side: THREE.BackSide
    });

    // Create the frustum mesh using LatheGeometry
    const frustumGeometry = new THREE.LatheGeometry(lathePoints, segments);
    const cone = new THREE.Mesh(frustumGeometry, fillMaterial);
    cone.position.y = -frustumHeight / 2;  // Center vertically
    cone.renderOrder = 999;

    // Create outline version (slightly larger)
    const outlineScale = 1.05;
    const outlinePoints = [
        new THREE.Vector2(bottomOuterRadius * outlineScale, -2),
        new THREE.Vector2(topOuterRadius * outlineScale, frustumHeight + 2),
        new THREE.Vector2(topInnerRadius / outlineScale, frustumHeight + 2),
        new THREE.Vector2(bottomInnerRadius / outlineScale, -2),
    ];
    const outlineGeometry = new THREE.LatheGeometry(outlinePoints, segments);
    const coneOutline = new THREE.Mesh(outlineGeometry, outlineMaterial);
    coneOutline.position.y = -frustumHeight / 2;
    coneOutline.renderOrder = 998;

    // Top cap ring for clean edge (bottom/camera-facing is covered by compass)
    const topCapGeometry = new THREE.RingGeometry(topInnerRadius, topOuterRadius, segments);
    const topCap = new THREE.Mesh(topCapGeometry, fillMaterial.clone());
    topCap.rotation.x = -Math.PI / 2;
    topCap.position.y = frustumHeight / 2;
    topCap.renderOrder = 999;

    // Name the clickable parts for raycasting
    cone.name = 'pointerCone';
    topCap.name = 'pointerCone';

    // Create pointer compass inside the hollow center (fits within the frustum opening)
    const pointerCompassGroup = new THREE.Group();
    pointerCompassGroup.renderOrder = 1001;  // Render after cone
    const pRingOuterRadius = bottomInnerRadius;  // Match frustum bottom INNER edge (hollow opening)
    const pRingInnerRadius = bottomInnerRadius * 0.75;

    // Compass ring outline (lighter for visibility)
    const pRingGeometry = new THREE.RingGeometry(pRingInnerRadius, pRingOuterRadius, 32);
    const pRingMaterial = new THREE.MeshBasicMaterial({
        color: 0x555555,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: true
    });
    const pRing = new THREE.Mesh(pRingGeometry, pRingMaterial);
    pRing.renderOrder = 1001;
    pRing.name = 'pointerCone';  // Make clickable/hoverable
    pointerCompassGroup.add(pRing);

    // Degree ticks on outer ring
    for (let deg = 0; deg < 360; deg += 10) {
        if (deg % 90 === 0) continue;
        const angle = deg * Math.PI / 180;
        const isThirty = deg % 30 === 0;
        const tickLength = isThirty ? 5 : 2.5;
        const tickWidth = isThirty ? 1.5 : 0.8;

        const tickGeometry = new THREE.PlaneGeometry(tickWidth, tickLength);
        const tickMaterial = new THREE.MeshBasicMaterial({
            color: 0x444444,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const tick = new THREE.Mesh(tickGeometry, tickMaterial);
        tick.position.x = Math.sin(angle) * (pRingOuterRadius - tickLength / 2 - 1);
        tick.position.y = Math.cos(angle) * (pRingOuterRadius - tickLength / 2 - 1);
        tick.position.z = 0.1;
        tick.rotation.z = -angle;
        pointerCompassGroup.add(tick);
    }

    // Inner fill (slightly transparent gray)
    const pInnerFillGeometry = new THREE.CircleGeometry(pRingInnerRadius, 32);
    const pInnerFillMaterial = new THREE.MeshBasicMaterial({
        color: 0x555555,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: true
    });
    const pInnerFill = new THREE.Mesh(pInnerFillGeometry, pInnerFillMaterial);
    pInnerFill.position.z = -0.1;
    pInnerFill.renderOrder = 1000;
    pInnerFill.name = 'pointerCone';  // Make clickable/hoverable
    pointerCompassGroup.add(pInnerFill);

    // Sun direction line for pointer compass (extends to inner radius)
    const pSunLineGeometry = new THREE.PlaneGeometry(8, pRingInnerRadius);
    const pSunLineMaterial = new THREE.MeshBasicMaterial({
        color: 0xffdd00,
        side: THREE.DoubleSide,
        depthWrite: true
    });
    const pSunLine = new THREE.Mesh(pSunLineGeometry, pSunLineMaterial);
    pSunLine.position.y = pRingInnerRadius / 2;  // Center from origin to inner radius
    pSunLine.position.z = 0.5;
    pSunLine.renderOrder = 1002;
    const pSunLineGroup = new THREE.Group();
    pSunLineGroup.add(pSunLine);
    pointerCompassGroup.add(pSunLineGroup);

    // Moon direction line for pointer compass (extends to inner radius)
    const pMoonLineGeometry = new THREE.PlaneGeometry(6, pRingInnerRadius);
    const pMoonLineMaterial = new THREE.MeshBasicMaterial({
        color: 0x88aaff,
        side: THREE.DoubleSide,
        depthWrite: true
    });
    const pMoonLine = new THREE.Mesh(pMoonLineGeometry, pMoonLineMaterial);
    pMoonLine.position.y = pRingInnerRadius / 2;  // Center from origin to inner radius
    pMoonLine.position.z = 0.4;
    pMoonLine.renderOrder = 1002;
    const pMoonLineGroup = new THREE.Group();
    pMoonLineGroup.add(pMoonLine);
    pointerCompassGroup.add(pMoonLineGroup);

    // Cardinal direction markers (bright, high contrast)
    const pDirections = [
        { angle: 0, color: 0xff0000, size: 1.8 },      // N - bright red, largest
        { angle: Math.PI / 2, color: 0xffffff, size: 1.3 },   // E - white
        { angle: Math.PI, color: 0xffffff, size: 1.3 },       // S - white
        { angle: -Math.PI / 2, color: 0xffffff, size: 1.3 }   // W - white
    ];

    pDirections.forEach(dir => {
        const tickWidth = 8 * dir.size;
        const tickShape = new THREE.Shape();
        // Keep within the ring bounds - tip at outer edge, base at inner edge
        tickShape.moveTo(0, pRingOuterRadius - 2);  // Tip just inside outer edge
        tickShape.lineTo(-tickWidth / 2, pRingInnerRadius + 2);  // Base just outside inner edge
        tickShape.lineTo(tickWidth / 2, pRingInnerRadius + 2);
        tickShape.closePath();

        const tickGeometry = new THREE.ShapeGeometry(tickShape);
        const tickMaterial = new THREE.MeshBasicMaterial({
            color: dir.color,
            side: THREE.DoubleSide,
            depthWrite: true
        });
        const tick = new THREE.Mesh(tickGeometry, tickMaterial);
        tick.rotation.z = dir.angle;
        tick.position.z = 0.5;
        tick.renderOrder = 1003;
        pointerCompassGroup.add(tick);
    });

    // Position compass flush on bottom face (camera-facing after marker orientation)
    pointerCompassGroup.position.y = -frustumHeight / 2;
    pointerCompassGroup.rotation.x = -Math.PI / 2;  // Face outward (toward camera after orientation)

    // Group for the arrow
    const arrow = new THREE.Group();
    arrow.add(coneOutline);
    arrow.add(cone);
    arrow.add(topCap);
    arrow.add(pointerCompassGroup);
    arrow.name = 'arrow';

    focusMarker.add(arrow);

    // Store pointer compass elements for updates
    focusMarker.userData.arrow = arrow;
    focusMarker.userData.pointerCompassGroup = pointerCompassGroup;
    focusMarker.userData.pSunLineGroup = pSunLineGroup;
    focusMarker.userData.pMoonLineGroup = pMoonLineGroup;

    // Store state and materials for hover effects
    focusMarker.userData.bounceTime = 0;
    focusMarker.userData.baseHeight = 500;
    focusMarker.userData.fillMaterial = fillMaterial;
    focusMarker.userData.outlineMaterial = outlineMaterial;
    focusMarker.userData.colors = {
        unpinned: { fill: brightRed, outline: darkRed, hoverFill: hoverCyan, hoverOutline: hoverDarkCyan },
        pinned: { fill: hotPink, outline: darkPink, hoverFill: hoverCyan, hoverOutline: hoverDarkCyan },
        dragging: { fill: hoverCyan, outline: hoverDarkCyan }
    };
    focusMarker.userData.isHovered = false;
    focusMarker.userData.isDragging = false;

    scene.add(focusMarker);

    // Create target spot on Earth's surface (matches pointer style)
    const spotRadius = 40;
    const spotSegments = 32;

    // Spot outline (black, slightly larger)
    const spotOutlineGeometry = new THREE.CircleGeometry(spotRadius * 1.15, spotSegments);
    const spotOutlineMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 1.0,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1
    });
    const spotOutline = new THREE.Mesh(spotOutlineGeometry, spotOutlineMaterial);
    scene.add(spotOutline);

    // Spot fill (matches pointer color)
    const spotFillGeometry = new THREE.CircleGeometry(spotRadius, spotSegments);
    const spotFillMaterial = new THREE.MeshBasicMaterial({
        color: brightRed,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
    });
    const spotFill = new THREE.Mesh(spotFillGeometry, spotFillMaterial);
    scene.add(spotFill);

    // Create compass rose for horizon view (same size as spot)
    const compassGroup = new THREE.Group();
    compassGroup.renderOrder = 102;
    compassGroup.visible = false;  // Hidden until horizon view

    // Compass ring outline (dark)
    const ringOuterRadius = spotRadius * 1.1;
    const ringInnerRadius = spotRadius * 0.85;
    const ringGeometry = new THREE.RingGeometry(ringInnerRadius, ringOuterRadius, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0x222222,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    compassGroup.add(ring);

    // Degree ticks on outer ring
    for (let deg = 0; deg < 360; deg += 10) {
        // Skip cardinal directions (they have their own markers)
        if (deg % 90 === 0) continue;

        const angle = deg * Math.PI / 180;
        const isThirty = deg % 30 === 0;
        const tickLength = isThirty ? 6 : 3;
        const tickWidth = isThirty ? 2 : 1;

        const tickGeometry = new THREE.PlaneGeometry(tickWidth, tickLength);
        const tickMaterial = new THREE.MeshBasicMaterial({
            color: 0x444444,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const tick = new THREE.Mesh(tickGeometry, tickMaterial);
        tick.position.x = Math.sin(angle) * (ringOuterRadius - tickLength / 2 - 1);
        tick.position.y = Math.cos(angle) * (ringOuterRadius - tickLength / 2 - 1);
        tick.position.z = 0.15;
        tick.rotation.z = -angle;
        compassGroup.add(tick);
    }

    // Inner fill (slightly transparent gray)
    const innerFillGeometry = new THREE.CircleGeometry(ringInnerRadius, 32);
    const compassFillMaterial = new THREE.MeshBasicMaterial({
        color: 0x888888,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide
    });
    const innerFill = new THREE.Mesh(innerFillGeometry, compassFillMaterial);
    innerFill.position.z = -0.1;
    compassGroup.add(innerFill);

    // Sun direction line - added to scene directly for proper renderOrder
    const sunLineGeometry = new THREE.PlaneGeometry(4, ringInnerRadius * 0.9);
    const sunLineMaterial = new THREE.MeshBasicMaterial({
        color: 0xffdd44,
        side: THREE.DoubleSide
    });
    const sunLine = new THREE.Mesh(sunLineGeometry, sunLineMaterial);
    sunLine.position.y = ringInnerRadius * 0.45;  // Offset to start from center
    sunLine.position.z = 1;  // Small offset toward camera to be in front of spot
    const sunLineGroup = new THREE.Group();
    sunLineGroup.visible = false;
    sunLineGroup.add(sunLine);
    scene.add(sunLineGroup);

    // Moon direction line - added to scene directly for proper renderOrder
    const moonLineGeometry = new THREE.PlaneGeometry(3, ringInnerRadius * 0.9);
    const moonLineMaterial = new THREE.MeshBasicMaterial({
        color: 0x8899ff,
        side: THREE.DoubleSide
    });
    const moonLine = new THREE.Mesh(moonLineGeometry, moonLineMaterial);
    moonLine.position.y = ringInnerRadius * 0.45;
    moonLine.position.z = 0.5;  // Small offset toward camera
    const moonLineGroup = new THREE.Group();
    moonLineGroup.visible = false;
    moonLineGroup.add(moonLine);
    scene.add(moonLineGroup);

    // Cardinal direction markers (triangular ticks)
    const directions = [
        { angle: 0, color: 0xcc2222, size: 1.4 },      // N - red, larger
        { angle: Math.PI / 2, color: 0x333333, size: 1 },   // E
        { angle: Math.PI, color: 0x333333, size: 1 },       // S
        { angle: -Math.PI / 2, color: 0x333333, size: 1 }   // W
    ];

    directions.forEach(dir => {
        // Tick mark (triangle within ring, pointing outward)
        const tickLength = (ringOuterRadius - ringInnerRadius) * 0.9;
        const tickWidth = 6 * dir.size;
        const tickShape = new THREE.Shape();
        tickShape.moveTo(0, ringOuterRadius - 1);
        tickShape.lineTo(-tickWidth / 2, ringInnerRadius + 1);
        tickShape.lineTo(tickWidth / 2, ringInnerRadius + 1);
        tickShape.closePath();

        const tickGeometry = new THREE.ShapeGeometry(tickShape);
        const tickMaterial = new THREE.MeshBasicMaterial({
            color: dir.color,
            transparent: true,
            opacity: 0.95,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const tick = new THREE.Mesh(tickGeometry, tickMaterial);
        tick.rotation.z = dir.angle;
        tick.position.z = 0.2;
        tick.renderOrder = 103;
        compassGroup.add(tick);
    });

    scene.add(compassGroup);

    // Store compass groups for updates
    focusMarker.userData.sunLineGroup = sunLineGroup;
    focusMarker.userData.moonLineGroup = moonLineGroup;

    // Store spot meshes and materials for updates
    focusMarker.userData.spotOutline = spotOutline;
    focusMarker.userData.spotFill = spotFill;
    focusMarker.userData.spotFillMaterial = spotFillMaterial;
    focusMarker.userData.compassGroup = compassGroup;
}

/**
 * Update pointer color based on pinned state, hover, and drag state
 */
function updatePointerColor() {
    if (!focusMarker) return;
    const { fillMaterial, outlineMaterial, spotFillMaterial, colors, isHovered, isDragging } = focusMarker.userData;

    let fillColor, outlineColor;

    // Dragging state takes priority
    if (isDragging) {
        fillColor = colors.dragging.fill;
        outlineColor = colors.dragging.outline;
    } else {
        // Otherwise use pinned/unpinned colors with hover
        const colorSet = focusLocked ? colors.pinned : colors.unpinned;
        fillColor = isHovered ? colorSet.hoverFill : colorSet.fill;
        outlineColor = isHovered ? colorSet.hoverOutline : colorSet.outline;
    }

    fillMaterial.color.setHex(fillColor);
    outlineMaterial.color.setHex(outlineColor);

    // Match spot fill color to pointer fill color
    if (spotFillMaterial) spotFillMaterial.color.setHex(fillColor);
}

/**
 * Toggle focus lock between pinned (fixed to Earth surface) and unpinned (follows camera)
 */
function toggleFocusLock() {
    focusLocked = !focusLocked;
    updateFocusLockButton();
    updatePointerColor();
    updateZoomSliderMode();
}

function updateFocusLockButton() {
    const toggleFocusLockBtn = document.getElementById('toggle-focus-lock');
    if (toggleFocusLockBtn) {
        // Toggle mode classes for styling
        toggleFocusLockBtn.classList.toggle('pinned', focusLocked);
        toggleFocusLockBtn.classList.toggle('unpinned', !focusLocked);
        // Pinned = earth+pin, Unpinned = eyes+pin
        const modeIcon = focusLocked ? '🌍' : '👀';
        toggleFocusLockBtn.innerHTML = `<span class="mode-icon">${modeIcon}</span><span class="pin-overlay">📌</span>`;
    }
}

function updateCompassTargetState() {
    const compassSun = document.getElementById('compass-sun');
    const compassMoon = document.getElementById('compass-moon');
    if (compassSun) {
        compassSun.classList.toggle('locked', zoomTargetMode === 0);
    }
    if (compassMoon) {
        compassMoon.classList.toggle('locked', zoomTargetMode === 1);
    }

    // If in horizon mode and locking to sun/moon, animate to target
    if (horizonBlendValue > 0.5 && zoomTargetMode !== 2) {
        startHorizonTargetAnimation();
    }
}

function startHorizonTargetAnimation() {
    const target = getHorizonEntryTarget();
    animationStartYaw = horizonYaw;
    animationStartPitch = horizonPitch;
    targetYaw = target.yaw;
    targetPitch = target.pitch;
    animationProgress = 0;
    isAnimatingToTarget = true;
}

/**
 * Sync camera position to focus point when in horizon mode
 * In horizon mode, both pin modes should behave the same - camera follows pointer
 */
function syncCameraToFocusInHorizonMode() {
    if (horizonBlendValue > 0.5) {
        cameraRefLat = focusPointLat - dragOffsetLat;
        cameraRefLon = focusPointLon - dragOffsetLon;
    }
}

/**
 * Create celestial bodies (stars, constellations)
 * Note: Sun and moon meshes removed for geometry overhaul - will use accurate orbital mechanics
 */
function createCelestialBodies() {
    // ===== POLARIS (North Star) =====
    const polarisGeometry = new THREE.SphereGeometry(100, 16, 16);
    const polarisMaterial = new THREE.MeshBasicMaterial({ color: 0xffffcc });
    const polarisMesh = new THREE.Mesh(polarisGeometry, polarisMaterial);
    // Polaris is at celestial north pole - fixed position
    // Convert RA/Dec to position on celestial sphere
    const polarisPos = raDecToPosition(POLARIS.ra, POLARIS.dec, STAR_DISTANCE);
    polarisMesh.position.copy(polarisPos);
    scene.add(polarisMesh);

    // Polaris glow
    const polarisGlowCanvas = document.createElement('canvas');
    polarisGlowCanvas.width = 64;
    polarisGlowCanvas.height = 64;
    const pCtx = polarisGlowCanvas.getContext('2d');
    const pGradient = pCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
    pGradient.addColorStop(0, 'rgba(255, 255, 220, 0.8)');
    pGradient.addColorStop(0.5, 'rgba(255, 255, 200, 0.2)');
    pGradient.addColorStop(1, 'rgba(255, 255, 180, 0)');
    pCtx.fillStyle = pGradient;
    pCtx.fillRect(0, 0, 64, 64);
    const polarisGlowTexture = new THREE.CanvasTexture(polarisGlowCanvas);
    const polarisGlowMaterial = new THREE.SpriteMaterial({
        map: polarisGlowTexture,
        transparent: true,
        blending: THREE.AdditiveBlending
    });
    const polarisGlow = new THREE.Sprite(polarisGlowMaterial);
    polarisGlow.scale.set(800, 800, 1);
    polarisMesh.add(polarisGlow);

    // ===== CONSTELLATIONS =====
    const constellationMaterial = new THREE.LineBasicMaterial({
        color: 0x334466,
        transparent: true,
        opacity: 0.4
    });

    Object.entries(CONSTELLATIONS).forEach(([name, lines]) => {
        lines.forEach(line => {
            const points = line.map(([ra, dec]) => raDecToPosition(ra, dec, STAR_DISTANCE * 0.99));
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const lineMesh = new THREE.Line(geometry, constellationMaterial);
            scene.add(lineMesh);
        });

        // Add star points at vertices
        const starMaterial = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 150,
            transparent: true,
            opacity: 0.8
        });
        const starPositions = [];
        const uniqueStars = new Set();
        lines.forEach(line => {
            line.forEach(([ra, dec]) => {
                const key = `${ra},${dec}`;
                if (!uniqueStars.has(key)) {
                    uniqueStars.add(key);
                    const pos = raDecToPosition(ra, dec, STAR_DISTANCE);
                    starPositions.push(pos.x, pos.y, pos.z);
                }
            });
        });
        const starsGeometry = new THREE.BufferGeometry();
        starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
        const stars = new THREE.Points(starsGeometry, starMaterial);
        scene.add(stars);
    });

    // ===== STARFIELD BACKGROUND =====
    createStarfield();

    // Initial position update
    updateCelestialPositions();
}

/**
 * Create a reference cube at Earth's center - fixed in world space, ignores all rotations
 */
function createReferenceCube() {
    const size = EARTH_RADIUS * 0.05;
    const geometry = new THREE.BoxGeometry(size, size, size);

    // Different color for each face to show orientation
    const materials = [
        new THREE.MeshBasicMaterial({ color: 0xff0000 }), // +X red
        new THREE.MeshBasicMaterial({ color: 0x880000 }), // -X dark red
        new THREE.MeshBasicMaterial({ color: 0x00ff00 }), // +Y green
        new THREE.MeshBasicMaterial({ color: 0x008800 }), // -Y dark green
        new THREE.MeshBasicMaterial({ color: 0x0000ff }), // +Z blue
        new THREE.MeshBasicMaterial({ color: 0x000088 }), // -Z dark blue
    ];

    referenceCube = new THREE.Mesh(geometry, materials);
    referenceCube.position.set(0, 0, 0);
    referenceCube.name = 'referenceCube';
    referenceCube.visible = false;  // Hide debug cubes
    scene.add(referenceCube);

    // Child cube at Earth radius distance from center cube
    const childCube = new THREE.Mesh(geometry, materials);
    childCube.position.set(0, 0, EARTH_RADIUS);  // Offset along +X
    childCube.name = 'referenceChildCube';
    referenceCube.add(childCube);
}

/**
 * Create a dense starfield background with milky way
 */
function createStarfield() {
    const starDistance = STAR_DISTANCE * 1.5;

    // Create thousands of background stars
    const starCount = 8000;
    const starPositions = [];
    const starColors = [];
    const starSizes = [];

    for (let i = 0; i < starCount; i++) {
        // Random position on sphere
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        // Galactic plane runs roughly through Sagittarius (RA ~18h, Dec ~-29°)
        // Add more stars near galactic plane for milky way effect
        const galacticConcentration = Math.random() < 0.3;
        let adjustedPhi = phi;
        if (galacticConcentration) {
            // Concentrate toward a band (galactic plane approximation)
            adjustedPhi = Math.PI / 2 + (Math.random() - 0.5) * 0.5;
        }

        const x = starDistance * Math.sin(adjustedPhi) * Math.cos(theta);
        const y = starDistance * Math.sin(adjustedPhi) * Math.sin(theta);
        const z = starDistance * Math.cos(adjustedPhi);

        starPositions.push(x, y, z);

        // Star colors - mostly white/blue-white, some yellow/orange
        const colorRand = Math.random();
        let r, g, b;
        if (colorRand < 0.6) {
            // White/blue-white
            r = 0.9 + Math.random() * 0.1;
            g = 0.9 + Math.random() * 0.1;
            b = 1.0;
        } else if (colorRand < 0.8) {
            // Yellow
            r = 1.0;
            g = 0.9 + Math.random() * 0.1;
            b = 0.7 + Math.random() * 0.2;
        } else if (colorRand < 0.95) {
            // Orange/red
            r = 1.0;
            g = 0.6 + Math.random() * 0.3;
            b = 0.4 + Math.random() * 0.2;
        } else {
            // Blue
            r = 0.7 + Math.random() * 0.2;
            g = 0.8 + Math.random() * 0.2;
            b = 1.0;
        }
        starColors.push(r, g, b);

        // Vary star sizes - most small, few bright
        const sizeRand = Math.random();
        if (sizeRand < 0.7) {
            starSizes.push(50 + Math.random() * 50);
        } else if (sizeRand < 0.95) {
            starSizes.push(100 + Math.random() * 100);
        } else {
            starSizes.push(200 + Math.random() * 150);  // Bright stars
        }
    }

    const starsGeometry = new THREE.BufferGeometry();
    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    starsGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
    starsGeometry.setAttribute('size', new THREE.Float32BufferAttribute(starSizes, 1));

    // Custom shader for varied star sizes and colors
    const starsMaterial = new THREE.ShaderMaterial({
        uniforms: {},
        vertexShader: `
            attribute float size;
            attribute vec3 color;
            varying vec3 vColor;
            void main() {
                vColor = color;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = size * (300.0 / -mvPosition.z);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            void main() {
                float dist = length(gl_PointCoord - vec2(0.5));
                if (dist > 0.5) discard;
                // Soft glow falloff
                float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
                gl_FragColor = vec4(vColor, alpha * 0.9);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const stars = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(stars);
}

// Direction vectors for sun and moon (calculated from orbital functions for compass UI)
let currentSunDir = new THREE.Vector3(1, 0, 0);
let currentMoonDir = new THREE.Vector3(-1, 0, 0);

/**
 * Update sun/moon directions for compass UI
 */
function updateCelestialPositions() {
    // Calculate sun/moon directions from orbital functions (for compass UI only)
    const simTime = getAbsoluteSimulatedTime();
    const sunPos = getSunPosition(simTime);
    const moonPos = getMoonPosition(simTime);
    currentSunDir = latLonToDirection(sunPos.lat, sunPos.lon);
    currentMoonDir = latLonToDirection(moonPos.lat, moonPos.lon);
}

// City marker system - uses CITIES array from top
const cityMarkers = [];  // THREE.js sphere meshes
let hoveredCity = null;  // Currently hovered city marker (both marker and label highlight together)
let proximityExpandedLabel = null;  // Label closest to mouse cursor (expands)
let cursorNearestMarker = null;  // City marker nearest to mouse cursor (always shown)

// Major world capitals - always show labels when visible
const MAJOR_CAPITALS = new Set([
    'Tokyo', 'Beijing', 'New York', 'London', 'Paris', 'Moscow',
    'Sydney', 'Cairo', 'Rio de Janeiro', 'Mumbai', 'Lagos', 'Mexico City',
    'Los Angeles', 'Chicago', 'Toronto', 'Vancouver', 'Miami', 'Houston'
]);

/**
 * Create a 3D text sprite for city labels
 */
function createCityLabelSprite(text) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    // High-res canvas for crisp text
    const fontSize = 64;
    const padding = 20;
    context.font = `Bold ${fontSize}px Arial`;
    const textWidth = context.measureText(text).width;

    canvas.width = textWidth + padding * 2;
    canvas.height = fontSize + padding * 2;

    // Redraw after resize
    context.font = `Bold ${fontSize}px Arial`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    // Black outline/stroke
    context.strokeStyle = '#000000';
    context.lineWidth = 8;
    context.strokeText(text, canvas.width / 2, canvas.height / 2);

    // White fill
    context.fillStyle = '#ffffff';
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const spriteMaterial = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0.8,
        depthTest: true,
        depthWrite: false
    });

    const sprite = new THREE.Sprite(spriteMaterial);

    // Scale based on canvas aspect ratio
    const aspect = canvas.width / canvas.height;
    sprite.userData.baseScale = { x: aspect * 50, y: 50 };
    sprite.scale.set(aspect * 50, 50, 1);

    return sprite;
}

/**
 * Create city markers on the globe - white spheres for all cities
 */
function plotCities() {
    // Larger bright spheres for city lights effect
    const cityMarkerGeometry = new THREE.SphereGeometry(8, 12, 12);

    CITIES.forEach((city) => {
        // Place marker on Earth surface
        const position = latLonToCartesian(city.lat, city.lon, EARTH_RADIUS + 3);
        const markerMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const marker = new THREE.Mesh(cityMarkerGeometry, markerMaterial);
        marker.position.copy(position);
        marker.userData.city = city;  // Store city data for hover/click
        marker.renderOrder = 150;  // Above spot (100-101), below labels (200)
        scene.add(marker);
        cityMarkers.push(marker);

        // Create 3D sprite label for this city
        const labelSprite = createCityLabelSprite(city.name);
        labelSprite.visible = false;  // Start hidden
        labelSprite.renderOrder = 200;  // Above spot (100-101), below pointer (998+)
        labelSprite.userData.city = city;  // Store city data for hover/click
        scene.add(labelSprite);
        marker.userData.labelSprite = labelSprite;

        // Create signpost pole (3D cylinder) connecting marker to label
        const poleGeometry = new THREE.CylinderGeometry(0.3, 0.3, 1, 6);  // Thin pole, will be scaled
        const poleMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8
        });
        const signpostPole = new THREE.Mesh(poleGeometry, poleMaterial);
        signpostPole.visible = false;
        scene.add(signpostPole);
        marker.userData.signpostPole = signpostPole;
    });

    // Set up mouse event listeners for city interaction
    setupCityInteraction();
}

/**
 * Set up city label interaction - hover effect and click to navigate
 */
function setupCityInteraction() {
    const canvas = renderer.domElement;
    const hoverColor = 0x00dddd;  // Cyan - matches pointer hover state
    let mouseDownX = 0, mouseDownY = 0;
    const CLICK_THRESHOLD = 5;  // Max pixels moved to count as click

    // Set hover state on a city (both marker and label)
    function setHoverState(marker, hovered) {
        if (!marker) return;
        const label = marker.userData.labelSprite;

        if (hovered) {
            // Store original colors and set hover color
            if (!marker.userData.originalColor) {
                marker.userData.originalColor = marker.material.color.clone();
            }
            marker.material.color.setHex(hoverColor);

            if (label) {
                if (!label.userData.originalColor) {
                    label.userData.originalColor = label.material.color.clone();
                }
                label.material.color.setHex(hoverColor);
            }
        } else {
            // Restore original colors
            if (marker.userData.originalColor) {
                marker.material.color.copy(marker.userData.originalColor);
            }
            if (label && label.userData.originalColor) {
                label.material.color.copy(label.userData.originalColor);
            }
        }
    }

    // Handle mouse move for hover effect and proximity expansion
    function onMouseMove(e) {
        if (!camera) return;

        // Check if any dragging is happening
        const pointerDragging = focusMarker && focusMarker.userData.isDragging;
        const isAnyDragging = isDragging || pointerDragging;

        // Skip hover effects while dragging
        if (isAnyDragging) {
            if (hoveredCity) {
                setHoverState(hoveredCity, false);
                hoveredCity = null;
            }
            cursorNearestMarker = null;
            return;
        }

        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2(
            (e.clientX / window.innerWidth) * 2 - 1,
            -(e.clientY / window.innerHeight) * 2 + 1
        );
        raycaster.setFromCamera(mouse, camera);

        // Check both labels and markers together
        const visibleMarkers = cityMarkers.filter(m => m.visible);
        const visibleLabels = visibleMarkers.map(m => m.userData.labelSprite).filter(l => l && l.visible);

        const allTargets = [...visibleLabels, ...visibleMarkers];
        const intersects = raycaster.intersectObjects(allTargets, false);

        // Find which city was hit (if any)
        let hitCity = null;
        if (intersects.length > 0) {
            const hitObject = intersects[0].object;
            // If hit a label, find its marker
            if (hitObject.isSprite) {
                hitCity = visibleMarkers.find(m => m.userData.labelSprite === hitObject);
            } else {
                hitCity = hitObject;
            }
        }

        // Handle hover state change
        if (hitCity !== hoveredCity) {
            setHoverState(hoveredCity, false);
            setHoverState(hitCity, true);
            hoveredCity = hitCity;

            if (hitCity) {
                canvas.style.cursor = 'pointer';
            } else if (focusMarker && !focusMarker.userData.isHovered) {
                canvas.style.cursor = '';
            }
        }

        // Find closest city marker to cursor (for always-visible label)
        let closestMarker = null;
        let closestMarkerDist = Infinity;

        cityMarkers.forEach(marker => {
            const markerScreenPos = marker.position.clone().project(camera);
            // Skip markers behind camera
            if (markerScreenPos.z > 1) return;
            const dx = markerScreenPos.x - mouse.x;
            const dy = markerScreenPos.y - mouse.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < closestMarkerDist) {
                closestMarkerDist = dist;
                closestMarker = marker;
            }
        });

        // Update cursor nearest marker (its label will always be shown)
        if (closestMarker !== cursorNearestMarker) {
            cursorNearestMarker = closestMarker;
        }

        // Also track proximity expansion for visible labels (for scale effect)
        if (visibleLabels.length > 0) {
            let closestLabel = null;
            let closestDist = Infinity;

            visibleLabels.forEach(label => {
                const labelScreenPos = label.position.clone().project(camera);
                const dx = labelScreenPos.x - mouse.x;
                const dy = labelScreenPos.y - mouse.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < closestDist) {
                    closestDist = dist;
                    closestLabel = label;
                }
            });

            if (closestLabel !== proximityExpandedLabel) {
                if (proximityExpandedLabel) {
                    proximityExpandedLabel.userData.isProximityExpanded = false;
                }
                if (closestLabel) {
                    closestLabel.userData.isProximityExpanded = true;
                }
                proximityExpandedLabel = closestLabel;
            }
        }
    }

    // Track mousedown position to distinguish clicks from drags
    function onMouseDown(e) {
        mouseDownX = e.clientX;
        mouseDownY = e.clientY;
    }

    // Handle click to navigate to city or Earth surface (only if not dragged)
    function onClick(e) {
        // Ignore if mouse moved too far (was a drag, not a click)
        const dx = e.clientX - mouseDownX;
        const dy = e.clientY - mouseDownY;
        if (Math.sqrt(dx * dx + dy * dy) > CLICK_THRESHOLD) return;

        // If clicked on a city, navigate to it
        if (hoveredCity && hoveredCity.userData.city) {
            const city = hoveredCity.userData.city;
            if (focusLocked) {
                animatePointerToCity(city.lat, city.lon, 500);
            } else {
                animateCameraToCity(city.lat, city.lon, 500);
            }
            return;
        }

        // Otherwise, check if clicked on Earth surface and move pointer there
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2(
            (e.clientX / window.innerWidth) * 2 - 1,
            -(e.clientY / window.innerHeight) * 2 + 1
        );
        raycaster.setFromCamera(mouse, camera);

        const earthSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), EARTH_RADIUS);
        const hitPoint = new THREE.Vector3();

        if (raycaster.ray.intersectSphere(earthSphere, hitPoint)) {
            const normalized = hitPoint.clone().normalize();
            const hitLat = Math.asin(normalized.z) * 180 / Math.PI;
            const hitLon = Math.atan2(normalized.y, normalized.x) * 180 / Math.PI;

            // Move pointer to clicked location
            animatePointerToCity(hitLat, hitLon, 300);
        }
    }

    // Handle touch start - check if touching a label or marker
    function onTouchStart(e) {
        if (!camera || e.touches.length !== 1) return;

        const touch = e.touches[0];
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2(
            (touch.clientX / window.innerWidth) * 2 - 1,
            -(touch.clientY / window.innerHeight) * 2 + 1
        );
        raycaster.setFromCamera(mouse, camera);

        // Check both labels and markers
        const visibleMarkers = cityMarkers.filter(m => m.visible);
        const visibleLabels = visibleMarkers.map(m => m.userData.labelSprite).filter(l => l && l.visible);
        const allTargets = [...visibleLabels, ...visibleMarkers];
        const intersects = raycaster.intersectObjects(allTargets, false);

        if (intersects.length > 0) {
            const hitObject = intersects[0].object;
            const hitCity = hitObject.isSprite
                ? visibleMarkers.find(m => m.userData.labelSprite === hitObject)
                : hitObject;

            if (hitCity && hitCity.userData.city) {
                setHoverState(hitCity, true);
                hoveredCity = hitCity;

                const city = hitCity.userData.city;
                if (focusLocked) {
                    animatePointerToCity(city.lat, city.lon, 500);
                } else {
                    animateCameraToCity(city.lat, city.lon, 500);
                }

                // Restore color after a delay
                setTimeout(() => {
                    setHoverState(hitCity, false);
                    if (hoveredCity === hitCity) {
                        hoveredCity = null;
                    }
                }, 500);
            }
        }
    }

    // Add event listeners
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
}

/**
 * Update city markers and labels based on camera position
 * - Only closest city is highlighted pink (matching pink box)
 * - Labels appear on hover or for nearby cities when zoomed in
 * - Handles horizon visibility
 */
function updateLabelScales() {
    if (!camera || cityMarkers.length === 0) return;

    // Ensure camera matrices are up-to-date before projecting labels
    camera.updateMatrixWorld();

    const cameraDistance = camera.position.length();
    const cameraPos = camera.position.clone().normalize();

    // Get sun and moon directions for visibility check
    const sunDir = currentSunDir;
    const moonDir = currentMoonDir;

    // Get focus point position (independent of camera)
    const focusLat = focusPointLat;
    const focusLon = focusPointLon;
    const focusPos = latLonToCartesian(focusLat, focusLon, EARTH_RADIUS);

    // Calculate marker scale based on camera distance
    const markerScale = Math.max(0.5, cameraDistance * 0.00015);

    // Calculate label scale based on camera distance
    const labelScale = Math.max(0.3, Math.min(1.5, cameraDistance * 0.0003));

    // Determine how many labels to show based on zoom level
    // Closer = more labels, further = fewer labels
    const zoomFactor = Math.max(0, 1 - (cameraDistance - EARTH_RADIUS) / (EARTH_RADIUS * 4));
    const maxVisibleLabels = Math.floor(1 + zoomFactor * 15);  // 1-16 labels based on zoom

    // Find the closest city (same as pink box uses)
    const closestCity = findClosestCity(focusLat, focusLon);

    // Calculate distances and visibility for all markers
    const markerData = cityMarkers.map(marker => {
        const city = marker.userData.city;
        const markerNormal = marker.position.clone().normalize();

        // Check if marker is visible from camera (not behind Earth)
        const dotProduct = markerNormal.dot(cameraPos);
        const horizonThreshold = -0.15;  // Slightly below horizon for smooth transition
        const isOnVisibleSide = dotProduct > horizonThreshold;

        // Distance from focus point
        const distFromFocus = marker.position.distanceTo(focusPos);

        return {
            marker,
            city,
            distFromFocus,
            isOnVisibleSide,
            dotProduct
        };
    });

    // Sort by distance from focus
    markerData.sort((a, b) => a.distFromFocus - b.distFromFocus);

    // Get the set of cities to show labels for
    const labelsToShow = new Set();
    let labelCount = 0;

    for (const data of markerData) {
        if (!data.isOnVisibleSide) continue;
        if (labelCount >= maxVisibleLabels) break;
        labelsToShow.add(data.city.name);
        labelCount++;
    }

    // Update each marker and its 3D sprite label
    markerData.forEach(({ marker, city, isOnVisibleSide, dotProduct }) => {
        const isClosest = city === closestCity;
        const isMajor = MAJOR_CAPITALS.has(city.name);
        const isCursorNearest = marker === cursorNearestMarker;
        const showLabel = labelsToShow.has(city.name) || isMajor || isCursorNearest;

        // Check if city is in sunlight or moonlight
        const cityNormal = marker.position.clone().normalize();
        const inSunlight = sunDir ? cityNormal.dot(sunDir) > 0 : false;
        const inMoonlight = moonDir ? cityNormal.dot(moonDir) > 0 : false;

        // Fade markers near horizon
        const horizonFade = Math.max(0, Math.min(1, (dotProduct + 0.15) / 0.3));

        // Set marker visibility (respecting toggle)
        marker.visible = citySpheresVisible && isOnVisibleSide;

        // Smaller markers in horizon view for signpost effect
        const horizonFactor = Math.min(1, horizonBlendValue * 2);
        const adjustedMarkerScale = markerScale * (1 - horizonFactor * 0.6);  // Up to 60% smaller
        marker.scale.setScalar(adjustedMarkerScale);

        // All city markers respect depth testing
        marker.renderOrder = isClosest ? 250 : 150;
        marker.material.depthTest = true;

        // Use beam colors for city spheres - skip if hovered
        if (marker !== hoveredCity) {
            if (inSunlight) {
                marker.material.color.set(sunCityColor);
            } else {
                marker.material.color.set(moonCityColor);
            }
            marker.userData.originalColor = marker.material.color.clone();
        }

        // Apply horizon fade to opacity, but keep minimum brightness
        marker.material.opacity = Math.max(0.6, horizonFade);
        marker.material.transparent = true;

        // Update 3D sprite label
        const labelSprite = marker.userData.labelSprite;
        if (labelSprite) {
            const shouldShow = cityLabelsVisible && showLabel && isOnVisibleSide && horizonFade > 0.3;
            labelSprite.visible = shouldShow;

            // Hide pole if label is hidden
            const signpostPole = marker.userData.signpostPole;
            if (signpostPole && !shouldShow) {
                signpostPole.visible = false;
            }

            // Labels draw on top of earth but respect pointer depth
            labelSprite.renderOrder = 200;
            labelSprite.material.depthTest = true;

            if (shouldShow) {
                // In horizon view, labels become signposts - poles with smaller text
                const inHorizonView = horizonBlendValue > 0.3;
                const horizonFactor = Math.min(1, horizonBlendValue * 2);  // 0-1 as we enter horizon

                const markerPos = marker.position.clone();
                const distToCamera = markerPos.distanceTo(cameraPos);

                // Calculate proximity factor for horizon view - closer cities are smaller signposts
                // Horizon distance is roughly camera altitude, cities within that range scale down
                const horizonDist = Math.max(50, cameraPos.length() - EARTH_RADIUS) * 1.5;
                const proximityFactor = inHorizonView ? Math.min(1, distToCamera / horizonDist) : 1;

                // Position label above the city marker
                // In horizon view: close cities have short poles, far cities have taller poles
                const baseHeight = 30 + markerScale * 20;
                const minSignpostHeight = 15;  // Very close cities
                const maxSignpostHeight = 100;  // Far cities at horizon
                const signpostHeight = inHorizonView
                    ? minSignpostHeight + proximityFactor * (maxSignpostHeight - minSignpostHeight)
                    : baseHeight;
                const labelPos = markerPos.clone().normalize().multiplyScalar(EARTH_RADIUS + signpostHeight);
                labelSprite.position.copy(labelPos);

                // Scale based on distance from camera - smaller in horizon view, even smaller when close
                const baseScale = labelSprite.userData.baseScale;
                const distToCameraLabel = labelPos.distanceTo(cameraPos);
                const orbitalScale = distToCameraLabel * 0.0004;  // Constant screen size in orbital
                // Close cities get smaller labels (0.00008), far cities normal horizon size (0.00015)
                const minHorizonScale = 0.00008;
                const maxHorizonScale = 0.00015;
                const horizonScale = distToCameraLabel * (minHorizonScale + proximityFactor * (maxHorizonScale - minHorizonScale));
                const scaleMultiplier = orbitalScale * (1 - horizonFactor) + horizonScale * horizonFactor;
                // Cap maximum label size in horizon view to prevent huge nearby labels
                const maxLabelScale = inHorizonView ? 0.4 : 2;
                const clampedScale = Math.min(scaleMultiplier, maxLabelScale);
                labelSprite.scale.set(baseScale.x * clampedScale, baseScale.y * clampedScale, 1);

                // Update signpost pole connecting marker to label
                const signpostPole = marker.userData.signpostPole;
                if (signpostPole) {
                    signpostPole.visible = inHorizonView && horizonFactor > 0.2;
                    if (signpostPole.visible) {
                        // Position at midpoint between marker and label
                        const midpoint = markerPos.clone().add(labelPos).multiplyScalar(0.5);
                        signpostPole.position.copy(midpoint);

                        // Orient to point radially outward (along normal from earth center)
                        signpostPole.quaternion.setFromUnitVectors(
                            new THREE.Vector3(0, 1, 0),  // Cylinder's default up
                            markerPos.clone().normalize()  // Radial direction
                        );

                        // Scale height to match distance, keep thin width
                        const poleHeight = labelPos.distanceTo(markerPos);
                        signpostPole.scale.set(1, poleHeight, 1);

                        // Match color to marker
                        signpostPole.material.color.copy(marker.material.color);
                        signpostPole.material.opacity = horizonFade * 0.6;
                    }
                }

                // Set opacity based on horizon fade
                labelSprite.material.opacity = horizonFade * 0.8;

                // Tint based on lighting (update sprite color) - skip if hovered
                if (marker !== hoveredCity) {
                    if (inSunlight) {
                        labelSprite.material.color.set(sunCityColor);
                    } else {
                        labelSprite.material.color.set(moonCityColor);
                    }
                    // Store as original color for hover restore
                    labelSprite.userData.originalColor = labelSprite.material.color.clone();
                }
            }
        }
    });
}

function createLabel(text, x, y, z, color) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 128;

    context.fillStyle = '#' + color.toString(16).padStart(6, '0');
    context.font = 'Bold 48px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 128, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.set(x, y, z);
    sprite.scale.set(100, 50, 1);
    scene.add(sprite);
}

/**
 * Update the system time display with simulated time in UTC
 */
function updateSystemTime() {
    const systemTimeEl = document.getElementById('system-time-display');
    const systemDateEl = document.getElementById('system-date-display');
    const userUtcOffsetEl = document.getElementById('user-utc-offset');
    const liveOffsetEl = document.getElementById('live-offset');
    if (!systemTimeEl) return;

    // Get simulated time (use absolute for UTC display)
    const simTime = getAbsoluteSimulatedTime();
    const now = new Date();

    // Convert to UTC
    const utcHours = simTime.getUTCHours();
    const utcMins = simTime.getUTCMinutes();
    const utcSecs = simTime.getUTCSeconds();

    systemTimeEl.textContent = `${utcHours.toString().padStart(2, '0')}:${utcMins.toString().padStart(2, '0')}:${utcSecs.toString().padStart(2, '0')}`;

    // Update UTC date (YYYY-MM-DD)
    if (systemDateEl) {
        const utcYear = simTime.getUTCFullYear();
        const utcMonth = (simTime.getUTCMonth() + 1).toString().padStart(2, '0');
        const utcDay = simTime.getUTCDate().toString().padStart(2, '0');
        systemDateEl.textContent = `${utcYear}-${utcMonth}-${utcDay}`;
    }

    // Update label to just say UTC
    if (userUtcOffsetEl) {
        userUtcOffsetEl.textContent = 'UTC';
    }

    // Show offset from live time when not in live mode
    if (liveOffsetEl) {
        if (isLiveMode) {
            liveOffsetEl.textContent = '';
        } else {
            const diffMs = simTime.getTime() - now.getTime();
            const diffMins = Math.round(diffMs / 60000);

            if (Math.abs(diffMins) < 1) {
                liveOffsetEl.textContent = '';
            } else {
                const sign = diffMins > 0 ? '+' : '-';
                const absMins = Math.abs(diffMins);

                let offsetStr = '';
                if (absMins < 60) {
                    offsetStr = `${sign}${absMins}m`;
                } else if (absMins < 1440) {
                    const hours = Math.floor(absMins / 60);
                    const mins = absMins % 60;
                    offsetStr = mins === 0 ? `${sign}${hours}h` : `${sign}${hours}h ${mins}m`;
                } else if (absMins < 525600) { // Less than 1 year (365 days)
                    const days = Math.floor(absMins / 1440);
                    const hours = Math.floor((absMins % 1440) / 60);
                    offsetStr = hours === 0 ? `${sign}${days}d` : `${sign}${days}d ${hours}h`;
                } else {
                    const years = Math.floor(absMins / 525600);
                    const days = Math.floor((absMins % 525600) / 1440);
                    offsetStr = days === 0 ? `${sign}${years}y` : `${sign}${years}y ${days}d`;
                }

                liveOffsetEl.innerHTML = `(${offsetStr}<span class="from-present"> from present</span>)`;
            }
        }
    }
}

/**
 * Convert latitude/longitude to Cartesian coordinates
 * Coordinate system: +Z = North pole, +X = 0° lon, +Y = 90°E lon
 *
 * @param {number} lat - Latitude in degrees (-90 to 90)
 * @param {number} lon - Longitude in degrees (-180 to 180)
 * @param {number} radius - Radius of sphere
 * @returns {THREE.Vector3} Cartesian position
 */
function latLonToCartesian(lat, lon, radius) {
    const latRad = THREE.MathUtils.degToRad(lat);
    const lonRad = THREE.MathUtils.degToRad(lon);

    const x = radius * Math.cos(latRad) * Math.cos(lonRad);
    const y = radius * Math.cos(latRad) * Math.sin(lonRad);
    const z = radius * Math.sin(latRad);

    return new THREE.Vector3(x, y, z);
}

/**
 * Get the current horizon blend factor - returns the animated blend value
 * Used for drag behavior switching
 */
function getHorizonBlend() {
    return horizonBlendValue;
}

/**
 * Update the focus highlight on the sphere to show where camera is pointing
 */
function updateFocusHighlight() {
    const focusLat = focusPointLat;
    const focusLon = focusPointLon;

    // Update focus marker - bouncy arrow
    if (focusMarker) {
        // Bounce animation - only when PINNED (earth mode)
        const bounce = focusLocked
            ? (focusMarker.userData.bounceTime += 0.06,
               Math.sin(focusMarker.userData.bounceTime * 2.5) * 50 +
               Math.sin(focusMarker.userData.bounceTime * 1.3) * 25)
            : 0;

        const inHorizonMode = horizonBlendValue > 0.5;

        let markerPos;
        if (!focusLocked) {
            // UNPINNED mode: keep pointer directly below camera on Earth surface
            // The point on Earth below the camera is the camera position normalized to Earth radius
            const normalized = camera.position.clone().normalize();
            focusPointLat = Math.asin(normalized.z) * 180 / Math.PI;
            focusPointLon = Math.atan2(normalized.y, normalized.x) * 180 / Math.PI;

            // Update timezone tracking to prevent sun/moon jumping
            updateSliderForTimezone();

            // Position pointer above this point (static in unpinned mode)
            const height = focusMarker.userData.baseHeight || 500;
            markerPos = normalized.clone().multiplyScalar(EARTH_RADIUS + height);
        } else {
            // PINNED mode: position based on lat/lon with bounce
            const height = inHorizonMode
                ? focusMarker.userData.baseHeight + 300
                : focusMarker.userData.baseHeight;
            markerPos = latLonToCartesian(focusLat, focusLon, EARTH_RADIUS + height + bounce);
        }
        focusMarker.position.copy(markerPos);

        // Point arrow tip toward Earth (cone tip is +Y, so +Y should point toward center)
        const outward = markerPos.clone().normalize();
        focusMarker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward.negate());

        // Hide arrow (frustum) when in horizon mode
        const arrow = focusMarker.userData.arrow;
        if (arrow) {
            arrow.visible = horizonBlendValue < 0.5;
        }

        // Fade slightly when partially in horizon mode (skip pointer compass materials)
        const opacity = inHorizonMode ? 0.5 : 0.9;
        const pointerCompass = focusMarker.userData.pointerCompassGroup;
        focusMarker.traverse(obj => {
            // Skip pointer compass and its children
            if (pointerCompass && (obj === pointerCompass || obj.parent === pointerCompass ||
                (obj.parent && obj.parent.parent === pointerCompass))) {
                return;
            }
            if (obj.material && obj.material.opacity !== undefined) {
                obj.material.opacity = obj.material.side === THREE.BackSide ? 1.0 : opacity;
            }
        });

        // Update target spot position on Earth's surface
        const { spotOutline, spotFill, compassGroup } = focusMarker.userData;
        if (spotOutline && spotFill) {
            // Position on Earth's surface below the pointer
            const spotPos = latLonToCartesian(focusPointLat, focusPointLon, EARTH_RADIUS + SPOT_POS_RAISE);
            spotOutline.position.copy(spotPos);
            spotFill.position.copy(spotPos);

            // Orient to face outward from Earth
            spotOutline.lookAt(0, 0, 0);
            spotOutline.rotateX(Math.PI);
            spotFill.lookAt(0, 0, 0);
            spotFill.rotateX(Math.PI);

            // Compute compass orientation data (used by both ground and pointer compass)
            const radialUp = spotPos.clone().normalize();
            const globalNorth = new THREE.Vector3(0, 0, 1);
            const horizonNorth = globalNorth.clone()
                .sub(radialUp.clone().multiplyScalar(globalNorth.dot(radialUp)));
            if (horizonNorth.length() < 0.001) {
                horizonNorth.set(1, 0, 0);
            }
            horizonNorth.normalize();
            const horizonEast = new THREE.Vector3().crossVectors(horizonNorth, radialUp).normalize();

            // Build rotation matrix for compass: +X=east, +Y=north, +Z=up
            const compassMatrix = new THREE.Matrix4();
            compassMatrix.makeBasis(horizonEast, horizonNorth, radialUp);

            // Calculate sun azimuth (sun direction is essentially constant from any point on Earth)
            let sunAzimuth = 0;
            {
                const toSun = currentSunDir.clone();
                const sunHoriz = toSun.clone().sub(radialUp.clone().multiplyScalar(toSun.dot(radialUp)));
                if (sunHoriz.length() > 0.001) {
                    sunHoriz.normalize();
                    sunAzimuth = Math.atan2(sunHoriz.dot(horizonEast), sunHoriz.dot(horizonNorth));
                }
            }

            // Calculate moon azimuth (moon direction is essentially constant from any point on Earth)
            let moonAzimuth = 0;
            {
                const toMoon = currentMoonDir.clone();
                const moonHoriz = toMoon.clone().sub(radialUp.clone().multiplyScalar(toMoon.dot(radialUp)));
                if (moonHoriz.length() > 0.001) {
                    moonHoriz.normalize();
                    moonAzimuth = Math.atan2(moonHoriz.dot(horizonEast), moonHoriz.dot(horizonNorth));
                }
            }

            // Show compass in horizon view, hide regular spot
            const inHorizon = horizonBlendValue > 0.3;
            if (compassGroup) {
                compassGroup.visible = inHorizon;

                // Update sun/moon direction lines (now separate from compassGroup)
                const { sunLineGroup, moonLineGroup } = focusMarker.userData;
                if (sunLineGroup) {
                    sunLineGroup.visible = inHorizon;
                    if (inHorizon) {
                        sunLineGroup.position.copy(spotPos);
                        sunLineGroup.setRotationFromMatrix(compassMatrix);
                        sunLineGroup.rotateZ(-sunAzimuth);
                    }
                }
                if (moonLineGroup) {
                    moonLineGroup.visible = inHorizon;
                    if (inHorizon) {
                        moonLineGroup.position.copy(spotPos);
                        moonLineGroup.setRotationFromMatrix(compassMatrix);
                        moonLineGroup.rotateZ(-moonAzimuth);
                    }
                }

                if (inHorizon) {
                    compassGroup.position.copy(spotPos);
                    compassGroup.setRotationFromMatrix(compassMatrix);
                }

                // Fade spot out in horizon view
                const spotOpacity = inHorizon ? Math.max(0, 1 - horizonBlendValue * 2) : 0.9;
                spotFill.material.opacity = spotOpacity;
                spotOutline.material.opacity = spotOpacity;
                spotFill.visible = spotOpacity > 0.01;
                spotOutline.visible = spotOpacity > 0.01;
            }

            // Update pointer compass (on cone base) - show when not in horizon view
            const { pointerCompassGroup, pSunLineGroup, pMoonLineGroup } = focusMarker.userData;
            if (pointerCompassGroup) {
                pointerCompassGroup.visible = horizonBlendValue < 0.7;

                if (pointerCompassGroup.visible) {
                    // Transform compass orientation into focusMarker's local space
                    const invQuaternion = focusMarker.quaternion.clone().invert();
                    const localNorth = horizonNorth.clone().applyQuaternion(invQuaternion);
                    const localEast = horizonEast.clone().applyQuaternion(invQuaternion);
                    const localUp = radialUp.clone().applyQuaternion(invQuaternion);

                    // Compass: +X = east, +Y = north, +Z = up (face visible from above cone)
                    const localMatrix = new THREE.Matrix4();
                    localMatrix.makeBasis(localEast, localNorth, localUp);
                    pointerCompassGroup.setRotationFromMatrix(localMatrix);

                    // Use same sun/moon azimuths
                    if (pSunLineGroup) pSunLineGroup.rotation.z = -sunAzimuth;
                    if (pMoonLineGroup) pMoonLineGroup.rotation.z = -moonAzimuth;
                }
            }
        }
    }
}

/**
 * Update the compass HUD in horizon view
 */
function updateCompass() {
    const compass = document.getElementById('compass');
    if (!compass) return;

    // Show/hide based on horizon mode
    if (horizonBlendValue > 0.5) {
        compass.classList.add('visible');
        document.body.classList.add('horizon-mode');
    } else {
        compass.classList.remove('visible');
        document.body.classList.remove('horizon-mode');
        return;
    }

    // Calculate heading from yaw
    // horizonYaw: 0 = north, positive = east
    let heading = horizonYaw * (180 / Math.PI);
    heading = ((heading % 360) + 360) % 360;

    const track = compass.querySelector('.compass-track');
    if (!track) return;

    // Track layout: each item is 30px wide + 30px gap = 60px per direction
    // 8 directions = 480px for full rotation
    const itemWidth = 60;  // 30px min-width + 30px gap
    const pixelsPerDegree = (itemWidth * 8) / 360;
    const offset = heading * pixelsPerDegree;

    // Start offset: track starts at W (270°), we need N (0°) centered at heading 0
    // N is at index 2, so offset by 2 items, then center in 350px container
    const startOffset = 175 - (2 * itemWidth) - 15;  // half container - 2 items - half item
    track.style.transform = `translateX(${startOffset - offset}px)`;

    // Highlight closest direction
    const dirs = track.querySelectorAll('.dir');
    dirs.forEach(dir => {
        const angle = parseInt(dir.dataset.angle);
        let diff = Math.abs(heading - angle);
        if (diff > 180) diff = 360 - diff;
        if (diff < 22.5) {
            dir.classList.add('active');
        } else {
            dir.classList.remove('active');
        }
    });

    // Update degrees display
    const degreesEl = document.getElementById('compass-degrees');
    if (degreesEl) {
        degreesEl.textContent = `${Math.round(heading)}°`;
    }

    // Update sun/moon positions on compass
    const compassWidth = 350;
    const compassCenter = compassWidth / 2;

    // Get focus point on Earth's surface for local coordinate system
    const focusLat = focusPointLat;
    const focusLon = focusPointLon;
    const focusPos = latLonToCartesian(focusLat, focusLon, EARTH_RADIUS);
    const radialUp = focusPos.clone().normalize();
    const globalNorth = new THREE.Vector3(0, 0, 1);
    const horizonNorth = globalNorth.clone()
        .sub(radialUp.clone().multiplyScalar(globalNorth.dot(radialUp)))
        .normalize();
    const horizonEast = new THREE.Vector3().crossVectors(horizonNorth, radialUp).normalize();

    // Position sun emoji
    const sunEl = document.getElementById('compass-sun');
    if (sunEl) {
        const toSun = currentSunDir.clone();
        const sunVertical = toSun.dot(radialUp);
        const sunHoriz = toSun.clone().sub(radialUp.clone().multiplyScalar(sunVertical));
        const sunHorizLen = sunHoriz.length();

        if (sunHorizLen > 0.001) {
            sunHoriz.normalize();
            const sunNorth = sunHoriz.dot(horizonNorth);
            const sunEast = sunHoriz.dot(horizonEast);
            let sunAzimuth = Math.atan2(sunEast, sunNorth) * (180 / Math.PI);
            sunAzimuth = ((sunAzimuth % 360) + 360) % 360;

            // Calculate position relative to current heading
            let sunOffset = sunAzimuth - heading;
            if (sunOffset > 180) sunOffset -= 360;
            if (sunOffset < -180) sunOffset += 360;

            const sunX = compassCenter + sunOffset * pixelsPerDegree;
            sunEl.style.transform = `translateX(${sunX}px) translateX(-50%)`;
            sunEl.classList.toggle('visible', sunX > -20 && sunX < compassWidth + 20);
            sunEl.classList.toggle('below-horizon', sunVertical < 0);
        }
    }

    // Position moon emoji
    const moonEl = document.getElementById('compass-moon');
    if (moonEl) {
        const toMoon = currentMoonDir.clone();
        const moonVertical = toMoon.dot(radialUp);
        const moonHoriz = toMoon.clone().sub(radialUp.clone().multiplyScalar(moonVertical));
        const moonHorizLen = moonHoriz.length();

        if (moonHorizLen > 0.001) {
            moonHoriz.normalize();
            const moonNorth = moonHoriz.dot(horizonNorth);
            const moonEast = moonHoriz.dot(horizonEast);
            let moonAzimuth = Math.atan2(moonEast, moonNorth) * (180 / Math.PI);
            moonAzimuth = ((moonAzimuth % 360) + 360) % 360;

            // Calculate position relative to current heading
            let moonOffset = moonAzimuth - heading;
            if (moonOffset > 180) moonOffset -= 360;
            if (moonOffset < -180) moonOffset += 360;

            const moonX = compassCenter + moonOffset * pixelsPerDegree;
            moonEl.style.transform = `translateX(${moonX}px) translateX(-50%)`;
            moonEl.classList.toggle('visible', moonX > -20 && moonX < compassWidth + 20);
            moonEl.classList.toggle('below-horizon', moonVertical < 0);
        }
    }
}

/**
 * Update the view mode based on zoom level and animate the transition
 * Called every frame from animate()
 */
function updateViewMode(delta) {
    // Check if we should switch modes based on threshold
    const shouldBeHorizon = cameraRadius < HORIZON_THRESHOLD;

    if (shouldBeHorizon !== isHorizonMode) {
        isHorizonMode = shouldBeHorizon;
        // When entering horizon mode, look at horizon in target direction
        if (isHorizonMode) {
            const target = getHorizonEntryTarget();
            if (zoomTargetMode === 2) {
                // Free mode - snap to north
                horizonYaw = target.yaw;
                horizonPitch = 0;
            } else {
                // Locked to sun/moon - start facing north, then animate to target
                horizonYaw = 0;
                horizonPitch = 0;
                // Queue animation to start after blend settles
                pendingHorizonAnimation = true;
                pendingTargetYaw = target.yaw;
                pendingTargetPitch = target.pitch;
            }
        }
        // Cancel any pending animation if leaving horizon mode
        if (!isHorizonMode) pendingHorizonAnimation = false;
        // Update button to reflect manual zoom change
        isZoomedOut = !shouldBeHorizon;
        updateViewZoomButton();
    }

    // Animate blend value toward target (0 or 1)
    const targetBlend = isHorizonMode ? 1 : 0;
    const blendSpeed = VIEW_SNAP_SPEED * delta;

    if (horizonBlendValue < targetBlend) {
        horizonBlendValue = Math.min(horizonBlendValue + blendSpeed, targetBlend);
    } else if (horizonBlendValue > targetBlend) {
        horizonBlendValue = Math.max(horizonBlendValue - blendSpeed, targetBlend);
    }

    // Start the pitch animation when blend reaches threshold (only if queued by further zoom-in)
    if (pendingHorizonAnimation && horizonBlendValue >= HORIZON_ANIMATION_THRESHOLD) {
        pendingHorizonAnimation = false;
        animationStartYaw = horizonYaw;
        animationStartPitch = horizonPitch;
        targetYaw = pendingTargetYaw;
        targetPitch = pendingTargetPitch;
        animationProgress = 0;
        isAnimatingToTarget = true;
    }
}

/**
 * Set camera position from spherical coordinates (lat, lon, radius)
 * Uses discrete orbital/horizon modes with smooth snap transition
 */
function setCameraFromSpherical(lat, lon, radius) {
    const latRad = THREE.MathUtils.degToRad(lat);
    const lonRad = THREE.MathUtils.degToRad(lon);

    // Use the animated blend value for smooth transitions
    const blend = horizonBlendValue;

    // Blend radius between orbital (user-controlled) and horizon (fixed surface height)
    const easedBlend = blend * blend * (3 - 2 * blend);  // Smoothstep
    const effectiveRadius = radius * (1 - easedBlend) + HORIZON_CAMERA_HEIGHT * easedBlend;

    // Calculate camera position using the effective (possibly blended) radius
    const camPos = new THREE.Vector3(
        effectiveRadius * Math.cos(latRad) * Math.cos(lonRad),
        effectiveRadius * Math.cos(latRad) * Math.sin(lonRad),
        effectiveRadius * Math.sin(latRad)
    );
    camera.position.copy(camPos);

    if (blend < 0.001) {
        // Pure orbital view - look at point below Earth center to shift Earth up in viewport
        // (accounts for bottom UI taking up screen space)
        camera.up.set(0, 0, 1);
        camera.lookAt(0, 0, -600);
    } else if (blend > 0.999) {
        // Pure horizon view - look along horizon with yaw/pitch
        const radialUp = camPos.clone().normalize();
        const globalNorth = new THREE.Vector3(0, 0, 1);
        const horizonNorth = globalNorth.clone()
            .sub(radialUp.clone().multiplyScalar(globalNorth.dot(radialUp)))
            .normalize();
        const horizonEast = new THREE.Vector3().crossVectors(horizonNorth, radialUp).normalize();

        const lookDir = horizonNorth.clone()
            .multiplyScalar(Math.cos(horizonYaw) * Math.cos(horizonPitch))
            .add(horizonEast.clone().multiplyScalar(Math.sin(horizonYaw) * Math.cos(horizonPitch)))
            .add(radialUp.clone().multiplyScalar(Math.sin(horizonPitch)));

        const horizonLookAt = camPos.clone().add(lookDir.multiplyScalar(1000));

        camera.up.copy(radialUp);
        camera.lookAt(horizonLookAt);
    } else {
        // Transitioning - blend between orbital and horizon
        const radialUp = camPos.clone().normalize();
        const globalNorth = new THREE.Vector3(0, 0, 1);
        const horizonNorth = globalNorth.clone()
            .sub(radialUp.clone().multiplyScalar(globalNorth.dot(radialUp)))
            .normalize();
        const horizonEast = new THREE.Vector3().crossVectors(horizonNorth, radialUp).normalize();

        const lookDir = horizonNorth.clone()
            .multiplyScalar(Math.cos(horizonYaw) * Math.cos(horizonPitch))
            .add(horizonEast.clone().multiplyScalar(Math.sin(horizonYaw) * Math.cos(horizonPitch)))
            .add(radialUp.clone().multiplyScalar(Math.sin(horizonPitch)));

        const horizonLookAt = camPos.clone().add(lookDir.multiplyScalar(1000));
        const orbitalLookAt = new THREE.Vector3(0, 0, -600);

        // Use the already-calculated easedBlend for smooth interpolation
        const blendedLookAt = orbitalLookAt.clone().lerp(horizonLookAt, easedBlend);
        const blendedUp = new THREE.Vector3(0, 0, 1).lerp(radialUp, easedBlend).normalize();

        camera.up.copy(blendedUp);
        camera.lookAt(blendedLookAt);
    }
}

/**
 * Calculate yaw/pitch to look at a celestial body from current camera position
 * Returns { yaw, pitch } in radians for the horizon view system
 */
function calculateCelestialYawPitch(bodyPosition) {
    // Get camera position and local coordinate system
    const focusLat = cameraRefLat + dragOffsetLat;
    const focusLon = cameraRefLon + dragOffsetLon;
    const camPos = latLonToCartesian(focusLat, focusLon, cameraRadius);

    const radialUp = camPos.clone().normalize();
    const globalNorth = new THREE.Vector3(0, 0, 1);
    const horizonNorth = globalNorth.clone()
        .sub(radialUp.clone().multiplyScalar(globalNorth.dot(radialUp)))
        .normalize();
    const horizonEast = new THREE.Vector3().crossVectors(horizonNorth, radialUp).normalize();

    // Direction to the celestial body
    const toBody = bodyPosition.clone().sub(camPos).normalize();

    // Project onto horizon plane and vertical
    const verticalComponent = toBody.dot(radialUp);
    const horizontalProjection = toBody.clone().sub(radialUp.clone().multiplyScalar(verticalComponent));
    const horizontalLength = horizontalProjection.length();

    // Calculate pitch (vertical angle)
    const pitch = Math.atan2(verticalComponent, horizontalLength);

    // Calculate yaw (horizontal angle from north)
    let yaw = 0;
    if (horizontalLength > 0.001) {
        horizontalProjection.normalize();
        const northComponent = horizontalProjection.dot(horizonNorth);
        const eastComponent = horizontalProjection.dot(horizonEast);
        yaw = Math.atan2(eastComponent, northComponent);
    }

    return { yaw, pitch };
}

/**
 * Start animation to look at the next celestial body (sun or moon)
 */
function startCelestialTargetAnimation() {
    // Get the target body direction (sun/moon are effectively at infinity)
    const bodyDir = celestialTargetIndex === 0 ? currentSunDir : currentMoonDir;
    // Create a position far in that direction for the calculation
    const bodyPos = bodyDir.clone().multiplyScalar(STAR_DISTANCE);

    // Calculate target yaw/pitch
    const target = calculateCelestialYawPitch(bodyPos);
    targetYaw = target.yaw;
    targetPitch = target.pitch;

    // Clamp pitch to valid range
    targetPitch = THREE.MathUtils.clamp(targetPitch, -Math.PI / 2 + 0.1, Math.PI / 2 - 0.1);

    // Store starting position
    animationStartYaw = horizonYaw;
    animationStartPitch = horizonPitch;
    animationProgress = 0;
    isAnimatingToTarget = true;

    // Cycle to next body for next zoom
    celestialTargetIndex = (celestialTargetIndex + 1) % 2;
}

/**
 * Setup orbit controls for dragging around Earth
 * Left-click: Rotate camera/Earth sphere
 * Right-click: Move focus point across Earth (with momentum)
 */
function setupOrbitControls() {
    const canvas = renderer.domElement;

    // Prevent context menu on right-click
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    canvas.addEventListener('mousedown', (e) => {
        dragStartX = e.clientX;
        dragStartY = e.clientY;

        // Check if clicking on pointer (any mouse button)
        if (checkTouchOnPointer(e.clientX, e.clientY)) {
            isPointerDragging = true;
            isMousePointerDrag = true;

            // Calculate offset between mouse hit on Earth and current pointer position
            // so pointer doesn't jump when dragging starts
            const raycaster = new THREE.Raycaster();
            const mouse = new THREE.Vector2(
                (e.clientX / window.innerWidth) * 2 - 1,
                -(e.clientY / window.innerHeight) * 2 + 1
            );
            raycaster.setFromCamera(mouse, camera);
            const earthSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), EARTH_RADIUS);
            const hitPoint = new THREE.Vector3();
            if (raycaster.ray.intersectSphere(earthSphere, hitPoint) && focusMarker) {
                // Store offset from hit point to pointer's Earth-surface projection
                const pointerDir = focusMarker.position.clone().normalize();
                const pointerOnEarth = pointerDir.multiplyScalar(EARTH_RADIUS);
                pointerDragOffset.copy(pointerOnEarth).sub(hitPoint);
            } else {
                pointerDragOffset.set(0, 0, 0);
            }

            // Show drag color
            if (focusMarker) {
                focusMarker.userData.isDragging = true;
                updatePointerColor();
            }

            return; // Don't do camera drag
        }

        // Left-click: rotate camera/Earth
        isDragging = true;
        isSnappingBack = false;
        // Stop focus point momentum when rotating camera
        focusVelocityLat = 0;
        focusVelocityLon = 0;
    });

    canvas.addEventListener('mousemove', (e) => {
        const deltaX = e.clientX - dragStartX;
        const deltaY = e.clientY - dragStartY;

        // Handle pointer dragging
        if (isPointerDragging) {
            updatePointerDragPosition(e.clientX, e.clientY);
            return;
        }

        if (isDragging) {
            // Left-drag: rotate camera around Earth
            const horizonBlend = getHorizonBlend(cameraRadius);

            if (horizonBlend > 0.5) {
                // Horizon view mode - rotate view direction (yaw/pitch)
                // Dragging unlocks from sun/moon tracking
                if (zoomTargetMode !== 2) {
                    zoomTargetMode = 2;
                    updateCompassTargetState();
                }
                const sensitivity = 0.003;
                horizonYaw += deltaX * sensitivity;
                horizonPitch -= deltaY * sensitivity;
                horizonPitch = THREE.MathUtils.clamp(horizonPitch, -Math.PI / 2 + 0.1, Math.PI / 2 - 0.1);
                dragStartX = e.clientX;
                dragStartY = e.clientY;
            } else {
                // Orbital view mode - rotate camera around Earth
                const zoomFactor = Math.max(0.3, Math.min(1, (cameraRadius - EARTH_RADIUS) / (CAMERA_MAX_RADIUS - EARTH_RADIUS)));
                const sensitivity = 0.05 + 0.15 * zoomFactor;
                dragOffsetLon = -deltaX * sensitivity;
                dragOffsetLat = deltaY * sensitivity;

                const totalLat = cameraRefLat + dragOffsetLat;
                if (totalLat > 89) dragOffsetLat = 89 - cameraRefLat;
                if (totalLat < -89) dragOffsetLat = -89 - cameraRefLat;
            }
            return;
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        // Clean up pointer drag state - momentum continues in animate loop
        if (isPointerDragging) {
            isPointerDragging = false;
            isMousePointerDrag = false;

            // Restore normal color
            if (focusMarker) {
                focusMarker.userData.isDragging = false;
                updatePointerColor();
            }

            // Only keep momentum if pointer was moving recently
            const timeSinceMove = performance.now() - lastPointerMoveTime;
            if (timeSinceMove > MOMENTUM_TIMEOUT_MS) {
                focusVelocityLat = 0;
                focusVelocityLon = 0;
            }
        }

        if (isDragging) {
            isDragging = false;
            cameraRefLat += dragOffsetLat;
            cameraRefLon += dragOffsetLon;
            dragOffsetLat = 0;
            dragOffsetLon = 0;
        }

        // Immediately update display after any drag ends
        updatePositionDisplay();
    });

    // Single-click on pointer to toggle focus lock
    let clickStartX = 0;
    let clickStartY = 0;
    canvas.addEventListener('mousedown', (e) => {
        clickStartX = e.clientX;
        clickStartY = e.clientY;
    }, true);

    canvas.addEventListener('click', (e) => {
        // Only treat as click if mouse didn't move much (not a drag)
        const dx = e.clientX - clickStartX;
        const dy = e.clientY - clickStartY;
        if (Math.sqrt(dx * dx + dy * dy) > 5) return;

        // Raycast to check if pointer was clicked
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2(
            (e.clientX / window.innerWidth) * 2 - 1,
            -(e.clientY / window.innerHeight) * 2 + 1
        );
        raycaster.setFromCamera(mouse, camera);

        // Get all meshes from the focusMarker
        const pointerMeshes = [];
        if (focusMarker) {
            focusMarker.traverse(obj => {
                if (obj.isMesh && (obj.name === 'pointerCone' || obj.name === 'pointerShaft')) {
                    pointerMeshes.push(obj);
                }
            });
        }

        const intersects = raycaster.intersectObjects(pointerMeshes, false);
        if (intersects.length > 0) {
            toggleFocusLock();
        }
    });

    // Hover detection for pointer
    canvas.addEventListener('mousemove', (e) => {
        if (!focusMarker) return;

        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2(
            (e.clientX / window.innerWidth) * 2 - 1,
            -(e.clientY / window.innerHeight) * 2 + 1
        );
        raycaster.setFromCamera(mouse, camera);

        const pointerMeshes = [];
        focusMarker.traverse(obj => {
            if (obj.isMesh && (obj.name === 'pointerCone' || obj.name === 'pointerShaft')) {
                pointerMeshes.push(obj);
            }
        });

        const intersects = raycaster.intersectObjects(pointerMeshes, false);
        const isHovered = intersects.length > 0;

        if (isHovered !== focusMarker.userData.isHovered) {
            focusMarker.userData.isHovered = isHovered;
            updatePointerColor();
            canvas.style.cursor = isHovered ? 'pointer' : '';
        }
    });

    // L key to toggle pinned state
    document.addEventListener('keydown', (e) => {
        if (e.key === 'l' || e.key === 'L') {
            toggleFocusLock();
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (isDragging) {
            isDragging = false;
            cameraRefLat += dragOffsetLat;
            cameraRefLon += dragOffsetLon;
            dragOffsetLat = 0;
            dragOffsetLon = 0;
        }
    });

    // Zoom with mouse wheel
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomSpeed = 500;  // Scaled for larger Earth
        const wasAtMin = cameraRadius <= CAMERA_MIN_RADIUS + 10;
        const wasInHorizonMode = cameraRadius < HORIZON_THRESHOLD;
        const zoomingIn = e.deltaY < 0;

        // If already in horizon mode, control FOV instead of radius
        if (wasAtMin && wasInHorizonMode) {
            const fovSpeed = 3;
            if (zoomingIn) {
                // Dead zone - accumulate zoom input before starting FOV zoom
                if (horizonZoomAccumulator < HORIZON_DEAD_ZONE) {
                    horizonZoomAccumulator++;
                } else {
                    // Zoom in - decrease FOV and trigger look-up animation
                    const prevFov = camera.fov;
                    camera.fov = Math.max(MIN_FOV, camera.fov - fovSpeed);

                    // Start looking up at sun/moon when zooming in past horizon (only if locked)
                    if (prevFov >= DEFAULT_FOV - 1 && !isAnimatingToTarget && zoomTargetMode !== 2) {
                        const target = getHorizonEntryTarget();
                        pendingHorizonAnimation = true;
                        pendingTargetYaw = target.yaw;
                        pendingTargetPitch = target.pitch;
                    }
                }
            } else {
                // Zoom out - decrease accumulator first, then FOV, then exit
                if (horizonZoomAccumulator > 0 && camera.fov >= DEFAULT_FOV) {
                    horizonZoomAccumulator--;
                } else if (camera.fov < DEFAULT_FOV) {
                    camera.fov = Math.min(DEFAULT_FOV, camera.fov + fovSpeed);
                } else {
                    // FOV is back to default and accumulator is 0, now allow radius to increase
                    cameraRadius += zoomSpeed;
                }
            }
            camera.updateProjectionMatrix();
        } else {
            cameraRadius += zoomingIn ? -zoomSpeed : zoomSpeed;
        }
        cameraRadius = THREE.MathUtils.clamp(cameraRadius, CAMERA_MIN_RADIUS, CAMERA_MAX_RADIUS);

        // Reset FOV when leaving horizon mode
        if (cameraRadius > HORIZON_THRESHOLD && camera.fov !== DEFAULT_FOV) {
            camera.fov = DEFAULT_FOV;
            camera.updateProjectionMatrix();
        }

        // Track active zooming in for pointer alignment
        if (zoomingIn && cameraRadius > HORIZON_THRESHOLD) {
            isZoomingIn = true;
            clearTimeout(zoomingInTimeout);
            zoomingInTimeout = setTimeout(() => { isZoomingIn = false; }, 150);
        }

        // Check if we just entered horizon mode
        const nowInHorizonMode = cameraRadius < HORIZON_THRESHOLD;
        if (nowInHorizonMode && !wasInHorizonMode && zoomingIn) {
            // Reset dead zone accumulator
            horizonZoomAccumulator = 0;

            // Failsafe: snap camera to be centered on pointer
            if (focusLocked) {
                cameraRefLat = focusPointLat - dragOffsetLat;
                cameraRefLon = focusPointLon - dragOffsetLon;
            }

            // Point at horizon in target direction (no pitch up yet)
            const target = getHorizonEntryTarget();
            horizonYaw = target.yaw;
            horizonPitch = 0;
        }

        updateZoomSlider();
    }, { passive: false });

    // ===== TOUCH POINTER GRAB AND DRAG =====
    let isPointerDragging = false;
    let isMousePointerDrag = false; // True if drag initiated by mouse (not touch)
    let pointerDragOffset = new THREE.Vector3(); // Offset from mouse hit to pointer position
    let pointerDragHoldTimer = null;
    let pointerDragStartX = 0;
    let pointerDragStartY = 0;
    let pointerDragTouchId = null;
    let lastPointerMoveTime = 0; // Track when pointer last moved for momentum
    const HOLD_DELAY_MS = 300; // Delay before drag activates
    const HOLD_MOVE_THRESHOLD = 10; // Max movement during hold (pixels)
    const MOMENTUM_TIMEOUT_MS = 20; // If no movement for this long, no momentum on release

    function checkTouchOnPointer(clientX, clientY) {
        if (!focusMarker) return false;

        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2(
            (clientX / window.innerWidth) * 2 - 1,
            -(clientY / window.innerHeight) * 2 + 1
        );
        raycaster.setFromCamera(mouse, camera);

        const pointerMeshes = [];
        focusMarker.traverse(obj => {
            if (obj.isMesh && (obj.name === 'pointerCone' || obj.name === 'pointerShaft')) {
                pointerMeshes.push(obj);
            }
        });

        const intersects = raycaster.intersectObjects(pointerMeshes, false);
        return intersects.length > 0;
    }

    function updatePointerDragPosition(clientX, clientY) {
        // Raycast to find where on Earth the cursor/touch is pointing
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2(
            (clientX / window.innerWidth) * 2 - 1,
            -(clientY / window.innerHeight) * 2 + 1
        );
        raycaster.setFromCamera(mouse, camera);

        // Use sphere intersection for more reliable hit detection
        const earthSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), EARTH_RADIUS);
        const hitPoint = new THREE.Vector3();

        if (!raycaster.ray.intersectSphere(earthSphere, hitPoint)) {
            // Mouse is off the earth - find closest point on earth to the ray
            const closestPoint = new THREE.Vector3();
            raycaster.ray.closestPointToPoint(new THREE.Vector3(0, 0, 0), closestPoint);
            hitPoint.copy(closestPoint.normalize().multiplyScalar(EARTH_RADIUS));
        }

        // For mouse drag, apply offset so pointer doesn't jump
        if (isMousePointerDrag) {
            hitPoint.add(pointerDragOffset);
            // Re-normalize to Earth surface after adding offset
            hitPoint.normalize().multiplyScalar(EARTH_RADIUS);
        }

        // Update lat/lon directly (in unpinned mode, pointer follows camera which centers on this point)
        const normalized = hitPoint.clone().normalize();
        const hitLat = Math.asin(normalized.z) * 180 / Math.PI;
        const hitLon = Math.atan2(normalized.y, normalized.x) * 180 / Math.PI;

        // Calculate velocity for momentum on release (in pinned mode)
        if (focusLocked) {
            let deltaLat = hitLat - focusPointLat;
            let deltaLon = hitLon - focusPointLon;
            // Handle longitude wrap
            if (deltaLon > 180) deltaLon -= 360;
            if (deltaLon < -180) deltaLon += 360;
            // Only track velocity if there's actual movement
            if (Math.abs(deltaLat) > 0.01 || Math.abs(deltaLon) > 0.01) {
                focusVelocityLat = deltaLat;
                focusVelocityLon = deltaLon;
                lastPointerMoveTime = performance.now();
            }
        }

        focusPointLat = hitLat;
        focusPointLon = hitLon;

        // In horizon mode, camera follows pointer regardless of pin mode
        syncCameraToFocusInHorizonMode();

        // Update timezone tracking
        updateSliderForTimezone();
    }

    // ===== TOUCH SUPPORT =====
    let touchStartX = 0, touchStartY = 0;
    let lastTouchDistance = 0;
    let tapOriginX = 0, tapOriginY = 0; // Track original position for tap detection

    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();

        // Check if single touch is on the pointer
        if (e.touches.length === 1) {
            // Record tap origin for tap-on-Earth detection
            tapOriginX = e.touches[0].clientX;
            tapOriginY = e.touches[0].clientY;
            const touch = e.touches[0];
            const touchedPointer = checkTouchOnPointer(touch.clientX, touch.clientY);

            if (touchedPointer) {
                // User touched the pointer - start hold timer
                pointerDragStartX = touch.clientX;
                pointerDragStartY = touch.clientY;
                pointerDragTouchId = touch.identifier;

                // Show drag color immediately on touch
                if (focusMarker) {
                    focusMarker.userData.isDragging = true;
                    updatePointerColor();
                }

                pointerDragHoldTimer = setTimeout(() => {
                    // Hold completed - activate pointer dragging
                    isPointerDragging = true;
                    pointerDragHoldTimer = null; // Clear timer reference

                    // Provide haptic feedback if available
                    if (navigator.vibrate) {
                        navigator.vibrate(50);
                    }
                }, HOLD_DELAY_MS);

                return; // Don't start normal camera drag
            }

            // Normal single finger - start camera drag
            isTouching = true;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            // Stop focus point momentum when rotating camera
            focusVelocityLat = 0;
            focusVelocityLon = 0;
        } else if (e.touches.length === 2) {
            // Two fingers - start pinch zoom
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            lastTouchDistance = Math.sqrt(dx * dx + dy * dy);
        } else if (e.touches.length === 3) {
            // Three fingers - start focus point drag
            isTouching = true;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            focusVelocityLat = 0;
            focusVelocityLon = 0;
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();

        // Handle pointer drag hold timer and dragging
        if (e.touches.length === 1) {
            const touch = Array.from(e.touches).find(t => t.identifier === pointerDragTouchId);

            if (touch) {
                // Check if we're waiting for hold to complete
                if (pointerDragHoldTimer !== null) {
                    const dx = touch.clientX - pointerDragStartX;
                    const dy = touch.clientY - pointerDragStartY;
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    if (distance > HOLD_MOVE_THRESHOLD) {
                        // Moved too much - cancel hold timer
                        clearTimeout(pointerDragHoldTimer);
                        pointerDragHoldTimer = null;
                        pointerDragTouchId = null;
                        // Restore normal color
                        if (focusMarker) {
                            focusMarker.userData.isDragging = false;
                            updatePointerColor();
                        }
                        // Fall through to normal camera drag
                        isTouching = true;
                        touchStartX = touch.clientX;
                        touchStartY = touch.clientY;
                        focusVelocityLat = 0;
                        focusVelocityLon = 0;
                    } else {
                        // Still within threshold, waiting for hold
                        return;
                    }
                }
                // Handle active pointer dragging
                else if (isPointerDragging) {
                    updatePointerDragPosition(touch.clientX, touch.clientY);
                    return; // Don't do normal camera drag
                }
            }
        }

        if (e.touches.length === 1 && isTouching) {
            // Single finger drag - same as mouse drag
            const deltaX = e.touches[0].clientX - touchStartX;
            const deltaY = e.touches[0].clientY - touchStartY;

            const horizonBlend = getHorizonBlend(cameraRadius);

            if (horizonBlend > 0.5) {
                // Horizon view mode - rotate view direction
                // Dragging unlocks from sun/moon tracking
                if (zoomTargetMode !== 2) {
                    zoomTargetMode = 2;
                    updateCompassTargetState();
                }
                const sensitivity = 0.003;
                horizonYaw += deltaX * sensitivity;
                horizonPitch -= deltaY * sensitivity;
                horizonPitch = THREE.MathUtils.clamp(horizonPitch, -Math.PI / 2 + 0.1, Math.PI / 2 - 0.1);
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
            } else {
                // Orbital view mode - slower when zoomed in
                const zoomFactor = Math.max(0.3, Math.min(1, (cameraRadius - EARTH_RADIUS) / (CAMERA_MAX_RADIUS - EARTH_RADIUS)));
                const sensitivity = 0.05 + 0.15 * zoomFactor;
                dragOffsetLon = -deltaX * sensitivity;
                dragOffsetLat = deltaY * sensitivity;
                const totalLat = cameraRefLat + dragOffsetLat;
                if (totalLat > 89) dragOffsetLat = 89 - cameraRefLat;
                if (totalLat < -89) dragOffsetLat = -89 - cameraRefLat;
            }
        } else if (e.touches.length === 2) {
            // Two finger pinch - zoom
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (lastTouchDistance > 0) {
                const zoomSpeed = 20;  // Scaled for larger Earth
                const delta = (lastTouchDistance - distance) * zoomSpeed;
                const zoomingIn = delta < 0;
                const wasAtMin = cameraRadius <= CAMERA_MIN_RADIUS + 10;
                const wasInHorizonMode = cameraRadius < HORIZON_THRESHOLD;

                // If already in horizon mode, control FOV instead of radius
                if (wasAtMin && wasInHorizonMode) {
                    const fovSpeed = Math.abs(delta) * 0.1;
                    if (zoomingIn) {
                        // Dead zone - accumulate zoom input before starting FOV zoom
                        if (horizonZoomAccumulator < HORIZON_DEAD_ZONE) {
                            horizonZoomAccumulator += 0.5;  // Touch pinch accumulates slower
                        } else {
                            const prevFov = camera.fov;
                            camera.fov = Math.max(MIN_FOV, camera.fov - fovSpeed);

                            // Start looking up at sun/moon when zooming in past horizon (only if locked)
                            if (prevFov >= DEFAULT_FOV - 1 && !isAnimatingToTarget && zoomTargetMode !== 2) {
                                const target = getHorizonEntryTarget();
                                pendingHorizonAnimation = true;
                                pendingTargetYaw = target.yaw;
                                pendingTargetPitch = target.pitch;
                            }
                        }
                    } else {
                        // Zoom out - decrease accumulator first, then FOV, then exit
                        if (horizonZoomAccumulator > 0 && camera.fov >= DEFAULT_FOV) {
                            horizonZoomAccumulator -= 0.5;
                        } else if (camera.fov < DEFAULT_FOV) {
                            camera.fov = Math.min(DEFAULT_FOV, camera.fov + fovSpeed);
                        } else {
                            cameraRadius += Math.abs(delta);
                        }
                    }
                    camera.updateProjectionMatrix();
                } else {
                    cameraRadius += delta;
                }
                cameraRadius = THREE.MathUtils.clamp(cameraRadius, CAMERA_MIN_RADIUS, CAMERA_MAX_RADIUS);

                // Reset FOV when leaving horizon mode
                if (cameraRadius > HORIZON_THRESHOLD && camera.fov !== DEFAULT_FOV) {
                    camera.fov = DEFAULT_FOV;
                    camera.updateProjectionMatrix();
                }

                // Track active zooming in for pointer alignment
                if (zoomingIn && cameraRadius > HORIZON_THRESHOLD) {
                    isZoomingIn = true;
                    clearTimeout(zoomingInTimeout);
                    zoomingInTimeout = setTimeout(() => { isZoomingIn = false; }, 150);
                }

                // Check if we just entered horizon mode
                const nowInHorizonMode = cameraRadius < HORIZON_THRESHOLD;
                if (nowInHorizonMode && !wasInHorizonMode && zoomingIn) {
                    // Reset dead zone accumulator
                    horizonZoomAccumulator = 0;

                    // Failsafe: snap camera to be centered on pointer
                    if (focusLocked) {
                        cameraRefLat = focusPointLat - dragOffsetLat;
                        cameraRefLon = focusPointLon - dragOffsetLon;
                    }

                    // Point at horizon in target direction (no pitch up yet)
                    const target = getHorizonEntryTarget();
                    horizonYaw = target.yaw;
                    horizonPitch = 0;
                }

                updateZoomSlider();
            }
            lastTouchDistance = distance;
        } else if (e.touches.length === 3) {
            // Three finger drag - move focus point across Earth surface
            const deltaX = e.touches[0].clientX - touchStartX;
            const deltaY = e.touches[0].clientY - touchStartY;

            const sensitivity = 0.15;
            const deltaLat = -deltaY * sensitivity;  // Drag up = north
            const deltaLon = deltaX * sensitivity;   // Drag right = east

            focusPointLat += deltaLat;
            focusPointLon += deltaLon;

            // Handle pole crossing - wrap over the top/bottom
            while (focusPointLat > 90) {
                focusPointLat = 180 - focusPointLat;
                focusPointLon += 180;
            }
            while (focusPointLat < -90) {
                focusPointLat = -180 - focusPointLat;
                focusPointLon += 180;
            }

            // Wrap longitude
            while (focusPointLon > 180) focusPointLon -= 360;
            while (focusPointLon < -180) focusPointLon += 360;

            // In horizon mode, camera follows pointer regardless of pin mode
            syncCameraToFocusInHorizonMode();

            // Update timezone tracking
            updateSliderForTimezone();

            // Store velocity for momentum on release
            focusVelocityLat = deltaLat;
            focusVelocityLon = deltaLon;

            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        // Clean up pointer drag state
        let wasPointerTouch = false;
        if (pointerDragTouchId !== null) {
            // Check if the pointer drag touch ended
            const touchStillActive = Array.from(e.touches).some(t => t.identifier === pointerDragTouchId);

            if (!touchStillActive) {
                wasPointerTouch = true;
                // The pointer drag touch ended
                if (pointerDragHoldTimer !== null) {
                    // Hold timer was still active - this was a tap, toggle focus lock
                    clearTimeout(pointerDragHoldTimer);
                    pointerDragHoldTimer = null;
                    toggleFocusLock();
                }

                // Restore normal color
                if (focusMarker) {
                    focusMarker.userData.isDragging = false;
                    updatePointerColor();
                }

                // Only keep momentum if pointer was moving recently
                const timeSinceMove = performance.now() - lastPointerMoveTime;
                if (timeSinceMove > MOMENTUM_TIMEOUT_MS) {
                    focusVelocityLat = 0;
                    focusVelocityLon = 0;
                }

                // Clean up pointer drag state
                isPointerDragging = false;
                pointerDragTouchId = null;
                pointerDragStartX = 0;
                pointerDragStartY = 0;
            }
        }

        if (e.touches.length === 0) {
            // All fingers lifted
            isTouching = false;
            cameraRefLat += dragOffsetLat;
            cameraRefLon += dragOffsetLon;
            dragOffsetLat = 0;
            dragOffsetLon = 0;
            lastTouchDistance = 0;

            // Check if this was a tap (not a drag) on Earth surface
            // Skip if the touch started on the pointer (already handled above)
            if (e.changedTouches.length === 1 && !wasPointerTouch) {
                const touch = e.changedTouches[0];
                const dx = touch.clientX - tapOriginX;
                const dy = touch.clientY - tapOriginY;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < 5) { // Max pixels moved to count as tap
                    // This was a tap - check if it hit Earth
                    const raycaster = new THREE.Raycaster();
                    const mouse = new THREE.Vector2(
                        (touch.clientX / window.innerWidth) * 2 - 1,
                        -(touch.clientY / window.innerHeight) * 2 + 1
                    );
                    raycaster.setFromCamera(mouse, camera);

                    // Check if tapped on a city first
                    const visibleMarkers = cityMarkers.filter(m => m.visible);
                    const visibleLabels = visibleMarkers.map(m => m.userData.labelSprite).filter(l => l && l.visible);
                    const allTargets = [...visibleLabels, ...visibleMarkers];
                    const cityIntersects = raycaster.intersectObjects(allTargets, false);

                    if (cityIntersects.length > 0) {
                        // Tapped on a city - handled by existing onTouchStart
                    } else {
                        // Tapped on Earth surface - move pointer there
                        const earthSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), EARTH_RADIUS);
                        const hitPoint = new THREE.Vector3();

                        if (raycaster.ray.intersectSphere(earthSphere, hitPoint)) {
                            const normalized = hitPoint.clone().normalize();
                            const hitLat = Math.asin(normalized.z) * 180 / Math.PI;
                            const hitLon = Math.atan2(normalized.y, normalized.x) * 180 / Math.PI;

                            animatePointerToCity(hitLat, hitLon, 300);
                        }
                    }
                }
            }

            // Immediately update display after touch drag ends
            updatePositionDisplay();
        } else if (e.touches.length === 1) {
            // Switched from pinch to single finger
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            lastTouchDistance = 0;
        }
    }, { passive: false });

    canvas.addEventListener('touchcancel', (e) => {
        // Clean up pointer drag state on touch cancel
        if (pointerDragHoldTimer !== null) {
            clearTimeout(pointerDragHoldTimer);
            pointerDragHoldTimer = null;
        }
        isPointerDragging = false;
        pointerDragTouchId = null;

        // Restore normal color
        if (focusMarker) {
            focusMarker.userData.isDragging = false;
            updatePointerColor();
        }

        // Clean up normal touch state
        isTouching = false;
        cameraRefLat += dragOffsetLat;
        cameraRefLon += dragOffsetLon;
        dragOffsetLat = 0;
        dragOffsetLon = 0;
        lastTouchDistance = 0;

        // Immediately update display after touch cancel
        updatePositionDisplay();
    }, { passive: false });

    // Prevent context menu
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

let lastTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    // Calculate delta time
    const now = performance.now();
    const delta = (now - lastTime) / 1000;  // Convert to seconds
    lastTime = now;

    // Update simulation
    updateSimulation(now);

    // Update moon position based on sim time
    updateMoonPosition();

    // Update sun position based on sim time
    updateSunPosition();

    // Update eclipse shadow cones
    updateEclipseCones();

    // Handle snap-back animation
    if (isSnappingBack) {
        snapProgress += delta * SNAP_SPEED;
        if (snapProgress >= 1) {
            snapProgress = 1;
            isSnappingBack = false;
            dragOffsetLat = 0;
            dragOffsetLon = 0;
        } else {
            // Ease-out cubic interpolation
            const t = 1 - Math.pow(1 - snapProgress, 3);
            dragOffsetLat = snapFromLat * (1 - t);
            dragOffsetLon = snapFromLon * (1 - t);
        }
    }

    // In pinned mode, smoothly align camera over pointer WHILE zooming in toward horizon
    if (isZoomingIn && focusLocked && !isSnappingBack && !isDragging) {
        // Ramp up smoothly to avoid jarring first frame
        zoomAlignRampUp = Math.min(1, zoomAlignRampUp + delta * 5);

        const currentCamLat = cameraRefLat + dragOffsetLat;
        const currentCamLon = cameraRefLon + dragOffsetLon;

        let latDiff = focusPointLat - currentCamLat;
        let lonDiff = focusPointLon - currentCamLon;
        while (lonDiff > 180) lonDiff -= 360;
        while (lonDiff < -180) lonDiff += 360;

        // Calculate how much zoom range is left before horizon
        const zoomRangeLeft = cameraRadius - HORIZON_THRESHOLD;
        const totalZoomRange = CAMERA_MAX_RADIUS - HORIZON_THRESHOLD;
        const zoomProgress = 1 - (zoomRangeLeft / totalZoomRange);  // 0 at max, 1 at horizon

        // Calculate angular distance to focus point
        const angularDist = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);

        // Align speed scales up dramatically as we approach horizon
        // Must complete alignment before reaching horizon threshold
        const baseSpeed = 3;
        const urgencyMultiplier = 1 + zoomProgress * 8;  // Gets up to 9x faster near horizon
        const distanceBoost = Math.min(3, angularDist / 30);  // Boost for large distances
        const alignSpeed = (baseSpeed + distanceBoost) * urgencyMultiplier * zoomAlignRampUp * delta;

        cameraRefLat += latDiff * alignSpeed;
        cameraRefLon += lonDiff * alignSpeed;
    } else {
        // Reset ramp when not zooming
        zoomAlignRampUp = 0;
    }

    // Handle focus point momentum (rolling across Earth) - only when not actively dragging pointer
    const isPointerBeingDragged = focusMarker && focusMarker.userData.isDragging;
    if (!isPointerBeingDragged && (Math.abs(focusVelocityLat) > FOCUS_MIN_VELOCITY || Math.abs(focusVelocityLon) > FOCUS_MIN_VELOCITY)) {
        // Apply velocity
        focusPointLat += focusVelocityLat;
        focusPointLon += focusVelocityLon;

        // Handle pole crossing - wrap over the top/bottom
        while (focusPointLat > 90) {
            focusPointLat = 180 - focusPointLat;
            focusPointLon += 180;
            focusVelocityLat = -focusVelocityLat;  // Reverse lat velocity when crossing pole
        }
        while (focusPointLat < -90) {
            focusPointLat = -180 - focusPointLat;
            focusPointLon += 180;
            focusVelocityLat = -focusVelocityLat;  // Reverse lat velocity when crossing pole
        }

        // Wrap longitude
        while (focusPointLon > 180) focusPointLon -= 360;
        while (focusPointLon < -180) focusPointLon += 360;

        // In horizon mode, camera follows pointer regardless of pin mode
        syncCameraToFocusInHorizonMode();

        // Apply friction
        focusVelocityLat *= FOCUS_FRICTION;
        focusVelocityLon *= FOCUS_FRICTION;

        // Stop if below threshold
        if (Math.abs(focusVelocityLat) < FOCUS_MIN_VELOCITY) focusVelocityLat = 0;
        if (Math.abs(focusVelocityLon) < FOCUS_MIN_VELOCITY) focusVelocityLon = 0;
    }

    // Handle celestial body targeting animation
    if (isAnimatingToTarget) {
        animationProgress += delta * CELESTIAL_ANIMATION_SPEED;
        if (animationProgress >= 1) {
            animationProgress = 1;
            isAnimatingToTarget = false;
            horizonYaw = targetYaw;
            horizonPitch = targetPitch;
        } else {
            // Ease-in-out interpolation
            const t = animationProgress < 0.5
                ? 2 * animationProgress * animationProgress
                : 1 - Math.pow(-2 * animationProgress + 2, 2) / 2;

            // Handle yaw wrapping (take shortest path)
            let yawDiff = targetYaw - animationStartYaw;
            if (yawDiff > Math.PI) yawDiff -= 2 * Math.PI;
            if (yawDiff < -Math.PI) yawDiff += 2 * Math.PI;

            horizonYaw = animationStartYaw + yawDiff * t;
            horizonPitch = animationStartPitch + (targetPitch - animationStartPitch) * t;
        }
    }

    // Continuously track sun/moon when locked in horizon mode
    if (isHorizonMode && zoomTargetMode !== 2 && !isAnimatingToTarget) {
        const target = getHorizonEntryTarget();
        horizonYaw = target.yaw;
        horizonPitch = target.pitch;
    }

    // Update view mode state (handles smooth snap transition between orbital/horizon)
    updateViewMode(delta);

    // Update camera position from current state
    const currentLat = cameraRefLat + dragOffsetLat;
    const currentLon = cameraRefLon + dragOffsetLon;
    setCameraFromSpherical(currentLat, currentLon, cameraRadius);

    // Counter-rotate reference cube to always show same face to camera
    // (must happen before updateFocusHighlight so locked pointer uses current frame's rotation)
    if (referenceCube) {
        const latRad = THREE.MathUtils.degToRad(currentLat);
        const lonRad = THREE.MathUtils.degToRad(currentLon);
        const qLon = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), lonRad);
        const qLat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -latRad);
        referenceCube.quaternion.copy(qLon).multiply(qLat);
    }

    // Update sun and moon positions (real-time)
    updateCelestialPositions();

    // Update focus highlight position on sphere
    updateFocusHighlight();

    // Update compass HUD in horizon view
    updateCompass();

    // Update label sizes based on proximity and hover
    updateLabelScales();

    // Update system time display
    updateSystemTime();

    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    updateCelestialContainerPosition();
}

// Handle moving celestial container between top and bottom based on screen width
// Note: On portrait/narrow screens, celestial stays at bottom but splits into two boxes via CSS
const CELESTIAL_BREAKPOINT = 620;
let celestialAtTop = false;

function updateCelestialContainerPosition() {
    // Celestial container now stays at bottom on all screen sizes
    // Portrait mode styling is handled via CSS media queries
    // This function is kept for potential future use but currently does nothing
}

// UI visibility toggle
let uiHidden = false;

function setupUIVisibilityToggle() {
    const toggleBtn = document.getElementById('ui-visibility-toggle');
    const positionDisplay = document.getElementById('position-display');
    const celestialTopDisplay = document.getElementById('celestial-top-display');

    if (!toggleBtn) return;

    toggleBtn.addEventListener('click', () => {
        uiHidden = !uiHidden;

        if (uiHidden) {
            toggleBtn.classList.add('hidden');
            positionDisplay.classList.add('ui-hidden');
            celestialTopDisplay.classList.add('ui-hidden');
        } else {
            toggleBtn.classList.remove('hidden');
            positionDisplay.classList.remove('ui-hidden');
            celestialTopDisplay.classList.remove('ui-hidden');
        }
    });
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
} else {
    init();
}
