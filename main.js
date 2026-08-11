// Swiss Ephemeris for accurate astronomical calculations
import SwissEph from 'https://cdn.jsdelivr.net/gh/prolaxu/swisseph-wasm@main/src/swisseph.js';
import { CELESTIAL_EVENTS } from './eclipse-data.js';
import { STAR_CATALOG, STAR_NAMES, CONSTELLATION_DATA } from './star-data.js';
import { COASTLINE_10M, LAKES_10M, RIVERS_10M } from './coastline-data.js?v=3';

let swe = null;
let sweInitialized = false;

// Initialize Swiss Ephemeris (called before app starts)
async function initSwissEph() {
    try {
        swe = new SwissEph();
        await swe.initSwissEph();
        sweInitialized = true;
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

// Ghost celestial objects (see-through-earth indicators)
let ghostSunSprite = null;
let ghostMoonSprite = null;

// Scene, camera, renderer
let scene, camera, renderer;
let earth;
let moonMesh = null;  // Moon sphere mesh
let lastMoonUpdateTime = 0;  // Cache moon position updates
let sunMesh = null;  // Sun sphere mesh
let lastSunUpdateTime = 0;  // Cache sun position updates
let mapMaterial;  // Reference to map shader material for updating focus highlight
let earthMaterial;  // Reference to Earth material for updating sunDirection uniform
let earthFillMaterial;  // Solid fill sphere material (controlled by ocean color/opacity)
let celestialSphereGroup;  // Group for all stars/constellations (rotated by GMST)
let starLabelSprites = []; // Star name label sprites (toggled by horizon blend)
let constellationLinesMesh; // THREE.LineSegments for constellation lines
let constellationLinesVisible = true;
let starLabelsEnabled = true;
let planetLabelsEnabled = true;
let coastlineMesh;  // Coastline lines (10m)
let lakesMesh;      // Lake outline lines (10m)
let riversMesh;     // River lines (10m)
let coastlinesVisible = true;
let waterLinesVisible = true;

// Planets (naked-eye visible)
const PLANETS = [
    { id: 2, name: 'Mercury', color: [0.73, 0.73, 0.73], size: 3.0 },
    { id: 3, name: 'Venus',   color: [1.0, 1.0, 0.8],    size: 4.5 },
    { id: 4, name: 'Mars',    color: [1.0, 0.4, 0.27],    size: 3.5 },
    { id: 5, name: 'Jupiter', color: [1.0, 0.87, 0.67],   size: 4.0 },
    { id: 6, name: 'Saturn',  color: [1.0, 0.93, 0.8],    size: 3.0 },
];
let planetSprites = []; // { dot, label, planetId }
let sunLight;  // Directional light from sun
let focusMarker;  // Marker at camera focus point
let referenceCube;  // Debug cube at Earth center

// Texture loading promise (resolved when Earth textures finish loading)
let texturesReadyPromise = Promise.resolve();

// View zoom button state
let toggleViewZoomBtn = null;

// Grid lines (equator, meridian, polar axis)
let equatorLine = null;
let primeMeridianLine = null;
let northAxisMesh = null;
let southAxisMesh = null;

// Page visibility (stop rendering when tab is hidden)
let isTabVisible = true;

// Reusable temp objects — avoids per-frame GC allocations in update functions
const _tv1 = new THREE.Vector3();
const _tv2 = new THREE.Vector3();
const _tv3 = new THREE.Vector3();
const _tv4 = new THREE.Vector3();
const _tv5 = new THREE.Vector3();
const _tv6 = new THREE.Vector3();
const _tv7 = new THREE.Vector3();
const _tv8 = new THREE.Vector3();
const _tv9 = new THREE.Vector3();
const _tm1 = new THREE.Matrix4();
const _tq1 = new THREE.Quaternion();
const _tq2 = new THREE.Quaternion();
const _tc1 = new THREE.Color();
const _raycaster = new THREE.Raycaster();
const _mouse = new THREE.Vector2();
const _earthSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 6000); // EARTH_RADIUS
const _hitPoint = new THREE.Vector3();

// City visibility toggles
let cityLabelsVisible = true;
let citySpheresVisible = true;
let ghostViewEnabled = true;
let celestialTrailsEnabled = true;

// Celestial trail constants
const TRAIL_POINT_COUNT = 48;           // one every 30 min for 24h

// Celestial trail sprite arrays
let sunTrailPoints = null;   // THREE.Points for sun trail
let moonTrailPoints = null;  // THREE.Points for moon trail

// City colors (matched to beam colors)
let sunCityColor = '#ffdd44';   // Default sun beam color
let moonCityColor = '#8899ff';  // Default moon beam color
let currentSunAltDeg = 0;       // Sun altitude in degrees (-90 to +90)
let currentMoonAltDeg = 0;      // Moon altitude in degrees (-90 to +90)

// Time control - offset in minutes from current time
let timeOffsetMinutes = 0;
let isLiveMode = true;
let selectedDate = null; // null = today, otherwise Date object for selected day
let calendarViewDate = new Date(); // Month being viewed in calendar

// Simulation control
let isSimulating = false;
let isPaused = false; // Time is paused
let isSliderDragging = false; // User is dragging the time slider
let timeUiDirty = false;      // Time scrub happened: refresh time UI once next frame
let simulationDirection = 1; // 1 for forward, -1 for reverse
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

    // Years (1600-2400)
    const yearStart = 1600;
    const yearEnd = 2400;
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
    { name: 'Tokyo', lat: 35.68, lon: 139.69, tz: 9, tzId: 'Asia/Tokyo' },
    { name: 'Delhi', lat: 28.61, lon: 77.21, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Shanghai', lat: 31.23, lon: 121.47, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'São Paulo', lat: -23.55, lon: -46.63, tz: -3, tzId: 'America/Sao_Paulo' },
    { name: 'Mexico City', lat: 19.43, lon: -99.13, tz: -6, tzId: 'America/Mexico_City' },
    { name: 'Cairo', lat: 30.04, lon: 31.24, tz: 2, tzId: 'Africa/Cairo' },
    { name: 'Mumbai', lat: 19.08, lon: 72.88, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Beijing', lat: 39.90, lon: 116.41, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Dhaka', lat: 23.81, lon: 90.41, tz: 6, tzId: 'Asia/Dhaka' },
    { name: 'Osaka', lat: 34.69, lon: 135.50, tz: 9, tzId: 'Asia/Tokyo' },
    { name: 'New York', lat: 40.71, lon: -74.01, tz: -5, tzId: 'America/New_York' },
    { name: 'Karachi', lat: 24.86, lon: 67.01, tz: 5, tzId: 'Asia/Karachi' },
    { name: 'Buenos Aires', lat: -34.60, lon: -58.38, tz: -3, tzId: 'America/Argentina/Buenos_Aires' },
    { name: 'Istanbul', lat: 41.01, lon: 28.98, tz: 3, tzId: 'Europe/Istanbul' },
    { name: 'Kolkata', lat: 22.57, lon: 88.36, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Lagos', lat: 6.52, lon: 3.38, tz: 1, tzId: 'Africa/Lagos' },
    { name: 'Manila', lat: 14.60, lon: 120.98, tz: 8, tzId: 'Asia/Manila' },
    { name: 'Rio de Janeiro', lat: -22.91, lon: -43.17, tz: -3, tzId: 'America/Sao_Paulo' },
    { name: 'Guangzhou', lat: 23.13, lon: 113.26, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Los Angeles', lat: 34.05, lon: -118.24, tz: -8, tzId: 'America/Los_Angeles' },
    { name: 'Moscow', lat: 55.76, lon: 37.62, tz: 3, tzId: 'Europe/Moscow' },
    { name: 'Shenzhen', lat: 22.54, lon: 114.06, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Paris', lat: 48.86, lon: 2.35, tz: 1, tzId: 'Europe/Paris' },
    { name: 'London', lat: 51.51, lon: -0.13, tz: 0, tzId: 'Europe/London' },
    { name: 'Lima', lat: -12.05, lon: -77.04, tz: -5, tzId: 'America/Lima' },
    { name: 'Bangkok', lat: 13.76, lon: 100.50, tz: 7, tzId: 'Asia/Bangkok' },
    { name: 'Chennai', lat: 13.08, lon: 80.27, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Bogotá', lat: 4.71, lon: -74.07, tz: -5, tzId: 'America/Bogota' },
    { name: 'Johannesburg', lat: -26.20, lon: 28.04, tz: 2, tzId: 'Africa/Johannesburg' },
    { name: 'Tehran', lat: 35.69, lon: 51.39, tz: 3.5, tzId: 'Asia/Tehran' },
    { name: 'Hong Kong', lat: 22.32, lon: 114.17, tz: 8, tzId: 'Asia/Hong_Kong' },
    { name: 'Singapore', lat: 1.35, lon: 103.82, tz: 8, tzId: 'Asia/Singapore' },
    // North America - USA
    { name: 'Chicago', lat: 41.88, lon: -87.63, tz: -6, tzId: 'America/Chicago' },
    { name: 'Houston', lat: 29.76, lon: -95.37, tz: -6, tzId: 'America/Chicago' },
    { name: 'Phoenix', lat: 33.45, lon: -112.07, tz: -7, tzId: 'America/Phoenix' },
    { name: 'Philadelphia', lat: 39.95, lon: -75.17, tz: -5, tzId: 'America/New_York' },
    { name: 'San Antonio', lat: 29.42, lon: -98.49, tz: -6, tzId: 'America/Chicago' },
    { name: 'San Diego', lat: 32.72, lon: -117.16, tz: -8, tzId: 'America/Los_Angeles' },
    { name: 'Dallas', lat: 32.78, lon: -96.80, tz: -6, tzId: 'America/Chicago' },
    { name: 'San Jose', lat: 37.34, lon: -121.89, tz: -8, tzId: 'America/Los_Angeles' },
    { name: 'Austin', lat: 30.27, lon: -97.74, tz: -6, tzId: 'America/Chicago' },
    { name: 'Jacksonville', lat: 30.33, lon: -81.66, tz: -5, tzId: 'America/New_York' },
    { name: 'Fort Worth', lat: 32.75, lon: -97.33, tz: -6, tzId: 'America/Chicago' },
    { name: 'Columbus', lat: 39.96, lon: -83.00, tz: -5, tzId: 'America/New_York' },
    { name: 'Charlotte', lat: 35.23, lon: -80.84, tz: -5, tzId: 'America/New_York' },
    { name: 'San Francisco', lat: 37.77, lon: -122.42, tz: -8, tzId: 'America/Los_Angeles' },
    { name: 'Indianapolis', lat: 39.77, lon: -86.16, tz: -5, tzId: 'America/Indiana/Indianapolis' },
    { name: 'Seattle', lat: 47.61, lon: -122.33, tz: -8, tzId: 'America/Los_Angeles' },
    { name: 'Denver', lat: 39.74, lon: -104.99, tz: -7, tzId: 'America/Denver' },
    { name: 'Washington DC', lat: 38.91, lon: -77.04, tz: -5, tzId: 'America/New_York' },
    { name: 'Boston', lat: 42.36, lon: -71.06, tz: -5, tzId: 'America/New_York' },
    { name: 'Nashville', lat: 36.16, lon: -86.78, tz: -6, tzId: 'America/Chicago' },
    { name: 'Detroit', lat: 42.33, lon: -83.05, tz: -5, tzId: 'America/Detroit' },
    { name: 'Oklahoma City', lat: 35.47, lon: -97.52, tz: -6, tzId: 'America/Chicago' },
    { name: 'Portland', lat: 45.52, lon: -122.68, tz: -8, tzId: 'America/Los_Angeles' },
    { name: 'Las Vegas', lat: 36.17, lon: -115.14, tz: -8, tzId: 'America/Los_Angeles' },
    { name: 'Memphis', lat: 35.15, lon: -90.05, tz: -6, tzId: 'America/Chicago' },
    { name: 'Louisville', lat: 38.25, lon: -85.76, tz: -5, tzId: 'America/Kentucky/Louisville' },
    { name: 'Baltimore', lat: 39.29, lon: -76.61, tz: -5, tzId: 'America/New_York' },
    { name: 'Milwaukee', lat: 43.04, lon: -87.91, tz: -6, tzId: 'America/Chicago' },
    { name: 'Albuquerque', lat: 35.08, lon: -106.65, tz: -7, tzId: 'America/Denver' },
    { name: 'Tucson', lat: 32.22, lon: -110.93, tz: -7, tzId: 'America/Phoenix' },
    { name: 'Fresno', lat: 36.74, lon: -119.79, tz: -8, tzId: 'America/Los_Angeles' },
    { name: 'Sacramento', lat: 38.58, lon: -121.49, tz: -8, tzId: 'America/Los_Angeles' },
    { name: 'Mesa', lat: 33.42, lon: -111.83, tz: -7, tzId: 'America/Phoenix' },
    { name: 'Kansas City', lat: 39.10, lon: -94.58, tz: -6, tzId: 'America/Chicago' },
    { name: 'Atlanta', lat: 33.75, lon: -84.39, tz: -5, tzId: 'America/New_York' },
    { name: 'Miami', lat: 25.76, lon: -80.19, tz: -5, tzId: 'America/New_York' },
    { name: 'Omaha', lat: 41.26, lon: -95.94, tz: -6, tzId: 'America/Chicago' },
    { name: 'Raleigh', lat: 35.78, lon: -78.64, tz: -5, tzId: 'America/New_York' },
    { name: 'Cleveland', lat: 41.50, lon: -81.69, tz: -5, tzId: 'America/New_York' },
    { name: 'Tampa', lat: 27.95, lon: -82.46, tz: -5, tzId: 'America/New_York' },
    { name: 'Minneapolis', lat: 44.98, lon: -93.27, tz: -6, tzId: 'America/Chicago' },
    { name: 'New Orleans', lat: 29.95, lon: -90.07, tz: -6, tzId: 'America/Chicago' },
    { name: 'Honolulu', lat: 21.31, lon: -157.86, tz: -10, tzId: 'Pacific/Honolulu' },
    { name: 'Anchorage', lat: 61.22, lon: -149.90, tz: -9, tzId: 'America/Anchorage' },
    { name: 'St Louis', lat: 38.63, lon: -90.20, tz: -6, tzId: 'America/Chicago' },
    { name: 'Pittsburgh', lat: 40.44, lon: -80.00, tz: -5, tzId: 'America/New_York' },
    { name: 'Cincinnati', lat: 39.10, lon: -84.51, tz: -5, tzId: 'America/New_York' },
    { name: 'Orlando', lat: 28.54, lon: -81.38, tz: -5, tzId: 'America/New_York' },
    { name: 'Salt Lake City', lat: 40.76, lon: -111.89, tz: -7, tzId: 'America/Denver' },
    { name: 'Boise', lat: 43.62, lon: -116.20, tz: -7, tzId: 'America/Boise' },
    { name: 'Richmond', lat: 37.54, lon: -77.44, tz: -5, tzId: 'America/New_York' },
    { name: 'Buffalo', lat: 42.89, lon: -78.88, tz: -5, tzId: 'America/New_York' },
    { name: 'Hartford', lat: 41.76, lon: -72.69, tz: -5, tzId: 'America/New_York' },
    { name: 'Providence', lat: 41.82, lon: -71.41, tz: -5, tzId: 'America/New_York' },
    { name: 'Birmingham', lat: 33.52, lon: -86.80, tz: -6, tzId: 'America/Chicago' },
    // North America - Canada
    { name: 'Toronto', lat: 43.65, lon: -79.38, tz: -5, tzId: 'America/Toronto' },
    { name: 'Montreal', lat: 45.50, lon: -73.57, tz: -5, tzId: 'America/Toronto' },
    { name: 'Vancouver', lat: 49.28, lon: -123.12, tz: -8, tzId: 'America/Vancouver' },
    { name: 'Calgary', lat: 51.04, lon: -114.07, tz: -7, tzId: 'America/Edmonton' },
    { name: 'Edmonton', lat: 53.55, lon: -113.49, tz: -7, tzId: 'America/Edmonton' },
    { name: 'Ottawa', lat: 45.42, lon: -75.70, tz: -5, tzId: 'America/Toronto' },
    { name: 'Winnipeg', lat: 49.90, lon: -97.14, tz: -6, tzId: 'America/Winnipeg' },
    { name: 'Quebec City', lat: 46.81, lon: -71.21, tz: -5, tzId: 'America/Toronto' },
    { name: 'Hamilton', lat: 43.26, lon: -79.87, tz: -5, tzId: 'America/Toronto' },
    { name: 'Victoria', lat: 48.43, lon: -123.37, tz: -8, tzId: 'America/Vancouver' },
    { name: 'Halifax', lat: 44.65, lon: -63.58, tz: -4, tzId: 'America/Halifax' },
    { name: 'Saskatoon', lat: 52.13, lon: -106.67, tz: -6, tzId: 'America/Regina' },
    { name: 'Regina', lat: 50.45, lon: -104.62, tz: -6, tzId: 'America/Regina' },
    { name: 'St Johns', lat: 47.56, lon: -52.71, tz: -3.5, tzId: 'America/St_Johns' },
    { name: 'Kelowna', lat: 49.89, lon: -119.50, tz: -8, tzId: 'America/Vancouver' },
    { name: 'London ON', lat: 42.98, lon: -81.25, tz: -5, tzId: 'America/Toronto' },
    { name: 'Kitchener', lat: 43.45, lon: -80.49, tz: -5, tzId: 'America/Toronto' },
    // Mexico & Central America
    { name: 'Guadalajara', lat: 20.66, lon: -103.35, tz: -6, tzId: 'America/Mexico_City' },
    { name: 'Monterrey', lat: 25.69, lon: -100.32, tz: -6, tzId: 'America/Monterrey' },
    { name: 'Puebla', lat: 19.04, lon: -98.21, tz: -6, tzId: 'America/Mexico_City' },
    { name: 'Tijuana', lat: 32.53, lon: -117.02, tz: -8, tzId: 'America/Tijuana' },
    { name: 'León', lat: 21.13, lon: -101.69, tz: -6, tzId: 'America/Mexico_City' },
    { name: 'Cancún', lat: 21.16, lon: -86.85, tz: -5, tzId: 'America/Cancun' },
    { name: 'Mérida', lat: 20.97, lon: -89.62, tz: -6, tzId: 'America/Merida' },
    { name: 'Guatemala City', lat: 14.63, lon: -90.51, tz: -6, tzId: 'America/Guatemala' },
    { name: 'San Salvador', lat: 13.69, lon: -89.22, tz: -6, tzId: 'America/El_Salvador' },
    { name: 'Tegucigalpa', lat: 14.07, lon: -87.21, tz: -6, tzId: 'America/Tegucigalpa' },
    { name: 'Managua', lat: 12.11, lon: -86.27, tz: -6, tzId: 'America/Managua' },
    { name: 'San José CR', lat: 9.93, lon: -84.08, tz: -6, tzId: 'America/Costa_Rica' },
    { name: 'Panama City', lat: 8.98, lon: -79.52, tz: -5, tzId: 'America/Panama' },
    { name: 'Havana', lat: 23.11, lon: -82.37, tz: -5, tzId: 'America/Havana' },
    { name: 'Santo Domingo', lat: 18.49, lon: -69.90, tz: -4, tzId: 'America/Santo_Domingo' },
    { name: 'San Juan', lat: 18.47, lon: -66.11, tz: -4, tzId: 'America/Puerto_Rico' },
    { name: 'Kingston', lat: 18.00, lon: -76.79, tz: -5, tzId: 'America/Jamaica' },
    { name: 'Port-au-Prince', lat: 18.54, lon: -72.34, tz: -5, tzId: 'America/Port-au-Prince' },
    // South America
    { name: 'Medellín', lat: 6.25, lon: -75.56, tz: -5, tzId: 'America/Bogota' },
    { name: 'Cali', lat: 3.44, lon: -76.52, tz: -5, tzId: 'America/Bogota' },
    { name: 'Barranquilla', lat: 10.96, lon: -74.80, tz: -5, tzId: 'America/Bogota' },
    { name: 'Cartagena', lat: 10.39, lon: -75.51, tz: -5, tzId: 'America/Bogota' },
    { name: 'Caracas', lat: 10.49, lon: -66.88, tz: -4, tzId: 'America/Caracas' },
    { name: 'Maracaibo', lat: 10.63, lon: -71.64, tz: -4, tzId: 'America/Caracas' },
    { name: 'Valencia VE', lat: 10.18, lon: -67.99, tz: -4, tzId: 'America/Caracas' },
    { name: 'Quito', lat: -0.18, lon: -78.47, tz: -5, tzId: 'America/Guayaquil' },
    { name: 'Guayaquil', lat: -2.17, lon: -79.90, tz: -5, tzId: 'America/Guayaquil' },
    { name: 'Cuenca', lat: -2.90, lon: -79.00, tz: -5, tzId: 'America/Guayaquil' },
    { name: 'Belo Horizonte', lat: -19.92, lon: -43.94, tz: -3, tzId: 'America/Sao_Paulo' },
    { name: 'Brasília', lat: -15.79, lon: -47.88, tz: -3, tzId: 'America/Sao_Paulo' },
    { name: 'Salvador', lat: -12.97, lon: -38.51, tz: -3, tzId: 'America/Bahia' },
    { name: 'Fortaleza', lat: -3.72, lon: -38.54, tz: -3, tzId: 'America/Fortaleza' },
    { name: 'Recife', lat: -8.05, lon: -34.88, tz: -3, tzId: 'America/Recife' },
    { name: 'Porto Alegre', lat: -30.03, lon: -51.23, tz: -3, tzId: 'America/Sao_Paulo' },
    { name: 'Curitiba', lat: -25.43, lon: -49.27, tz: -3, tzId: 'America/Sao_Paulo' },
    { name: 'Manaus', lat: -3.12, lon: -60.02, tz: -4, tzId: 'America/Manaus' },
    { name: 'Belém', lat: -1.46, lon: -48.50, tz: -3, tzId: 'America/Belem' },
    { name: 'Córdoba AR', lat: -31.42, lon: -64.18, tz: -3, tzId: 'America/Argentina/Cordoba' },
    { name: 'Rosario', lat: -32.95, lon: -60.65, tz: -3, tzId: 'America/Argentina/Buenos_Aires' },
    { name: 'Mendoza', lat: -32.89, lon: -68.83, tz: -3, tzId: 'America/Argentina/Mendoza' },
    { name: 'Santiago', lat: -33.45, lon: -70.67, tz: -4, tzId: 'America/Santiago' },
    { name: 'Valparaíso', lat: -33.05, lon: -71.62, tz: -4, tzId: 'America/Santiago' },
    { name: 'Concepción', lat: -36.83, lon: -73.05, tz: -4, tzId: 'America/Santiago' },
    { name: 'Montevideo', lat: -34.90, lon: -56.19, tz: -3, tzId: 'America/Montevideo' },
    { name: 'Asunción', lat: -25.26, lon: -57.58, tz: -4, tzId: 'America/Asuncion' },
    { name: 'La Paz', lat: -16.50, lon: -68.15, tz: -4, tzId: 'America/La_Paz' },
    { name: 'Santa Cruz BO', lat: -17.79, lon: -63.18, tz: -4, tzId: 'America/La_Paz' },
    { name: 'Sucre', lat: -19.04, lon: -65.26, tz: -4, tzId: 'America/La_Paz' },
    { name: 'Ushuaia', lat: -54.80, lon: -68.30, tz: -3, tzId: 'America/Argentina/Ushuaia' },
    // Europe - UK & Ireland
    { name: 'Manchester', lat: 53.48, lon: -2.24, tz: 0, tzId: 'Europe/London' },
    { name: 'Birmingham UK', lat: 52.49, lon: -1.90, tz: 0, tzId: 'Europe/London' },
    { name: 'Glasgow', lat: 55.86, lon: -4.25, tz: 0, tzId: 'Europe/London' },
    { name: 'Liverpool', lat: 53.41, lon: -2.98, tz: 0, tzId: 'Europe/London' },
    { name: 'Edinburgh', lat: 55.95, lon: -3.19, tz: 0, tzId: 'Europe/London' },
    { name: 'Leeds', lat: 53.80, lon: -1.55, tz: 0, tzId: 'Europe/London' },
    { name: 'Bristol', lat: 51.45, lon: -2.59, tz: 0, tzId: 'Europe/London' },
    { name: 'Sheffield', lat: 53.38, lon: -1.47, tz: 0, tzId: 'Europe/London' },
    { name: 'Cardiff', lat: 51.48, lon: -3.18, tz: 0, tzId: 'Europe/London' },
    { name: 'Belfast', lat: 54.60, lon: -5.93, tz: 0, tzId: 'Europe/London' },
    { name: 'Dublin', lat: 53.35, lon: -6.26, tz: 0, tzId: 'Europe/Dublin' },
    { name: 'Cork', lat: 51.90, lon: -8.47, tz: 0, tzId: 'Europe/Dublin' },
    { name: 'Galway', lat: 53.27, lon: -9.06, tz: 0, tzId: 'Europe/Dublin' },
    // Europe - France
    { name: 'Lyon', lat: 45.76, lon: 4.84, tz: 1, tzId: 'Europe/Paris' },
    { name: 'Marseille', lat: 43.30, lon: 5.37, tz: 1, tzId: 'Europe/Paris' },
    { name: 'Toulouse', lat: 43.60, lon: 1.44, tz: 1, tzId: 'Europe/Paris' },
    { name: 'Nice', lat: 43.71, lon: 7.26, tz: 1, tzId: 'Europe/Paris' },
    { name: 'Nantes', lat: 47.22, lon: -1.55, tz: 1, tzId: 'Europe/Paris' },
    { name: 'Strasbourg', lat: 48.57, lon: 7.75, tz: 1, tzId: 'Europe/Paris' },
    { name: 'Bordeaux', lat: 44.84, lon: -0.58, tz: 1, tzId: 'Europe/Paris' },
    { name: 'Lille', lat: 50.63, lon: 3.06, tz: 1, tzId: 'Europe/Paris' },
    { name: 'Montpellier', lat: 43.61, lon: 3.87, tz: 1, tzId: 'Europe/Paris' },
    // Europe - Germany
    { name: 'Berlin', lat: 52.52, lon: 13.41, tz: 1, tzId: 'Europe/Berlin' },
    { name: 'Hamburg', lat: 53.55, lon: 9.99, tz: 1, tzId: 'Europe/Berlin' },
    { name: 'Munich', lat: 48.14, lon: 11.58, tz: 1, tzId: 'Europe/Berlin' },
    { name: 'Cologne', lat: 50.94, lon: 6.96, tz: 1, tzId: 'Europe/Berlin' },
    { name: 'Frankfurt', lat: 50.11, lon: 8.68, tz: 1, tzId: 'Europe/Berlin' },
    { name: 'Stuttgart', lat: 48.78, lon: 9.18, tz: 1, tzId: 'Europe/Berlin' },
    { name: 'Düsseldorf', lat: 51.23, lon: 6.78, tz: 1, tzId: 'Europe/Berlin' },
    { name: 'Leipzig', lat: 51.34, lon: 12.37, tz: 1, tzId: 'Europe/Berlin' },
    { name: 'Dortmund', lat: 51.51, lon: 7.47, tz: 1, tzId: 'Europe/Berlin' },
    { name: 'Dresden', lat: 51.05, lon: 13.74, tz: 1, tzId: 'Europe/Berlin' },
    { name: 'Hannover', lat: 52.37, lon: 9.74, tz: 1, tzId: 'Europe/Berlin' },
    { name: 'Nuremberg', lat: 49.45, lon: 11.08, tz: 1, tzId: 'Europe/Berlin' },
    // Europe - Italy
    { name: 'Rome', lat: 41.90, lon: 12.50, tz: 1, tzId: 'Europe/Rome' },
    { name: 'Milan', lat: 45.46, lon: 9.19, tz: 1, tzId: 'Europe/Rome' },
    { name: 'Naples', lat: 40.85, lon: 14.27, tz: 1, tzId: 'Europe/Rome' },
    { name: 'Turin', lat: 45.07, lon: 7.69, tz: 1, tzId: 'Europe/Rome' },
    { name: 'Palermo', lat: 38.12, lon: 13.36, tz: 1, tzId: 'Europe/Rome' },
    { name: 'Genoa', lat: 44.41, lon: 8.93, tz: 1, tzId: 'Europe/Rome' },
    { name: 'Bologna', lat: 44.49, lon: 11.34, tz: 1, tzId: 'Europe/Rome' },
    { name: 'Florence', lat: 43.77, lon: 11.25, tz: 1, tzId: 'Europe/Rome' },
    { name: 'Venice', lat: 45.44, lon: 12.32, tz: 1, tzId: 'Europe/Rome' },
    { name: 'Verona', lat: 45.44, lon: 10.99, tz: 1, tzId: 'Europe/Rome' },
    // Europe - Spain & Portugal
    { name: 'Madrid', lat: 40.42, lon: -3.70, tz: 1, tzId: 'Europe/Madrid' },
    { name: 'Barcelona', lat: 41.39, lon: 2.17, tz: 1, tzId: 'Europe/Madrid' },
    { name: 'Valencia', lat: 39.47, lon: -0.38, tz: 1, tzId: 'Europe/Madrid' },
    { name: 'Seville', lat: 37.39, lon: -5.99, tz: 1, tzId: 'Europe/Madrid' },
    { name: 'Zaragoza', lat: 41.65, lon: -0.88, tz: 1, tzId: 'Europe/Madrid' },
    { name: 'Málaga', lat: 36.72, lon: -4.42, tz: 1, tzId: 'Europe/Madrid' },
    { name: 'Bilbao', lat: 43.26, lon: -2.93, tz: 1, tzId: 'Europe/Madrid' },
    { name: 'Lisbon', lat: 38.72, lon: -9.14, tz: 0, tzId: 'Europe/Lisbon' },
    { name: 'Porto', lat: 41.16, lon: -8.63, tz: 0, tzId: 'Europe/Lisbon' },
    // Europe - Netherlands, Belgium, Switzerland
    { name: 'Amsterdam', lat: 52.37, lon: 4.90, tz: 1, tzId: 'Europe/Amsterdam' },
    { name: 'Rotterdam', lat: 51.92, lon: 4.48, tz: 1, tzId: 'Europe/Amsterdam' },
    { name: 'The Hague', lat: 52.08, lon: 4.30, tz: 1, tzId: 'Europe/Amsterdam' },
    { name: 'Utrecht', lat: 52.09, lon: 5.12, tz: 1, tzId: 'Europe/Amsterdam' },
    { name: 'Brussels', lat: 50.85, lon: 4.35, tz: 1, tzId: 'Europe/Brussels' },
    { name: 'Antwerp', lat: 51.22, lon: 4.40, tz: 1, tzId: 'Europe/Brussels' },
    { name: 'Zurich', lat: 47.38, lon: 8.54, tz: 1, tzId: 'Europe/Zurich' },
    { name: 'Geneva', lat: 46.20, lon: 6.14, tz: 1, tzId: 'Europe/Zurich' },
    { name: 'Basel', lat: 47.56, lon: 7.59, tz: 1, tzId: 'Europe/Zurich' },
    { name: 'Bern', lat: 46.95, lon: 7.45, tz: 1, tzId: 'Europe/Zurich' },
    { name: 'Luxembourg', lat: 49.61, lon: 6.13, tz: 1, tzId: 'Europe/Luxembourg' },
    // Europe - Nordic
    { name: 'Stockholm', lat: 59.33, lon: 18.07, tz: 1, tzId: 'Europe/Stockholm' },
    { name: 'Gothenburg', lat: 57.71, lon: 11.97, tz: 1, tzId: 'Europe/Stockholm' },
    { name: 'Malmö', lat: 55.60, lon: 13.00, tz: 1, tzId: 'Europe/Stockholm' },
    { name: 'Oslo', lat: 59.91, lon: 10.75, tz: 1, tzId: 'Europe/Oslo' },
    { name: 'Bergen', lat: 60.39, lon: 5.32, tz: 1, tzId: 'Europe/Oslo' },
    { name: 'Trondheim', lat: 63.43, lon: 10.40, tz: 1, tzId: 'Europe/Oslo' },
    { name: 'Copenhagen', lat: 55.68, lon: 12.57, tz: 1, tzId: 'Europe/Copenhagen' },
    { name: 'Aarhus', lat: 56.16, lon: 10.20, tz: 1, tzId: 'Europe/Copenhagen' },
    { name: 'Helsinki', lat: 60.17, lon: 24.94, tz: 2, tzId: 'Europe/Helsinki' },
    { name: 'Tampere', lat: 61.50, lon: 23.79, tz: 2, tzId: 'Europe/Helsinki' },
    { name: 'Turku', lat: 60.45, lon: 22.27, tz: 2, tzId: 'Europe/Helsinki' },
    { name: 'Reykjavik', lat: 64.15, lon: -21.94, tz: 0, tzId: 'Atlantic/Reykjavik' },
    // Europe - Central & Eastern
    { name: 'Vienna', lat: 48.21, lon: 16.37, tz: 1, tzId: 'Europe/Vienna' },
    { name: 'Graz', lat: 47.07, lon: 15.44, tz: 1, tzId: 'Europe/Vienna' },
    { name: 'Warsaw', lat: 52.23, lon: 21.01, tz: 1, tzId: 'Europe/Warsaw' },
    { name: 'Kraków', lat: 50.06, lon: 19.94, tz: 1, tzId: 'Europe/Warsaw' },
    { name: 'Wrocław', lat: 51.11, lon: 17.04, tz: 1, tzId: 'Europe/Warsaw' },
    { name: 'Gdańsk', lat: 54.35, lon: 18.65, tz: 1, tzId: 'Europe/Warsaw' },
    { name: 'Prague', lat: 50.08, lon: 14.44, tz: 1, tzId: 'Europe/Prague' },
    { name: 'Brno', lat: 49.20, lon: 16.61, tz: 1, tzId: 'Europe/Prague' },
    { name: 'Budapest', lat: 47.50, lon: 19.04, tz: 1, tzId: 'Europe/Budapest' },
    { name: 'Bucharest', lat: 44.43, lon: 26.10, tz: 2, tzId: 'Europe/Bucharest' },
    { name: 'Cluj-Napoca', lat: 46.77, lon: 23.60, tz: 2, tzId: 'Europe/Bucharest' },
    { name: 'Sofia', lat: 42.70, lon: 23.32, tz: 2, tzId: 'Europe/Sofia' },
    { name: 'Belgrade', lat: 44.79, lon: 20.45, tz: 1, tzId: 'Europe/Belgrade' },
    { name: 'Zagreb', lat: 45.81, lon: 15.98, tz: 1, tzId: 'Europe/Zagreb' },
    { name: 'Ljubljana', lat: 46.05, lon: 14.51, tz: 1, tzId: 'Europe/Ljubljana' },
    { name: 'Bratislava', lat: 48.15, lon: 17.11, tz: 1, tzId: 'Europe/Bratislava' },
    // Europe - Greece & Turkey
    { name: 'Athens', lat: 37.98, lon: 23.73, tz: 2, tzId: 'Europe/Athens' },
    { name: 'Thessaloniki', lat: 40.64, lon: 22.94, tz: 2, tzId: 'Europe/Athens' },
    { name: 'Ankara', lat: 39.93, lon: 32.85, tz: 3, tzId: 'Europe/Istanbul' },
    { name: 'Izmir', lat: 38.42, lon: 27.13, tz: 3, tzId: 'Europe/Istanbul' },
    { name: 'Antalya', lat: 36.90, lon: 30.69, tz: 3, tzId: 'Europe/Istanbul' },
    { name: 'Bursa', lat: 40.19, lon: 29.06, tz: 3, tzId: 'Europe/Istanbul' },
    // Europe - Ukraine & Belarus
    { name: 'Kyiv', lat: 50.45, lon: 30.52, tz: 2, tzId: 'Europe/Kyiv' },
    { name: 'Kharkiv', lat: 49.99, lon: 36.23, tz: 2, tzId: 'Europe/Kyiv' },
    { name: 'Odesa', lat: 46.47, lon: 30.73, tz: 2, tzId: 'Europe/Kyiv' },
    { name: 'Dnipro', lat: 48.46, lon: 35.04, tz: 2, tzId: 'Europe/Kyiv' },
    { name: 'Lviv', lat: 49.84, lon: 24.03, tz: 2, tzId: 'Europe/Kyiv' },
    { name: 'Minsk', lat: 53.90, lon: 27.57, tz: 3, tzId: 'Europe/Minsk' },
    // Russia
    { name: 'St Petersburg', lat: 59.93, lon: 30.34, tz: 3, tzId: 'Europe/Moscow' },
    { name: 'Novosibirsk', lat: 55.01, lon: 82.93, tz: 7, tzId: 'Asia/Novosibirsk' },
    { name: 'Yekaterinburg', lat: 56.84, lon: 60.60, tz: 5, tzId: 'Asia/Yekaterinburg' },
    { name: 'Kazan', lat: 55.80, lon: 49.11, tz: 3, tzId: 'Europe/Moscow' },
    { name: 'Nizhny Novgorod', lat: 56.33, lon: 44.00, tz: 3, tzId: 'Europe/Moscow' },
    { name: 'Samara', lat: 53.20, lon: 50.15, tz: 4, tzId: 'Europe/Samara' },
    { name: 'Chelyabinsk', lat: 55.16, lon: 61.40, tz: 5, tzId: 'Asia/Yekaterinburg' },
    { name: 'Omsk', lat: 54.99, lon: 73.37, tz: 6, tzId: 'Asia/Omsk' },
    { name: 'Rostov-on-Don', lat: 47.24, lon: 39.71, tz: 3, tzId: 'Europe/Moscow' },
    { name: 'Ufa', lat: 54.74, lon: 55.97, tz: 5, tzId: 'Asia/Yekaterinburg' },
    { name: 'Krasnoyarsk', lat: 56.01, lon: 92.87, tz: 7, tzId: 'Asia/Krasnoyarsk' },
    { name: 'Perm', lat: 58.01, lon: 56.25, tz: 5, tzId: 'Asia/Yekaterinburg' },
    { name: 'Voronezh', lat: 51.67, lon: 39.18, tz: 3, tzId: 'Europe/Moscow' },
    { name: 'Volgograd', lat: 48.71, lon: 44.50, tz: 3, tzId: 'Europe/Volgograd' },
    { name: 'Vladivostok', lat: 43.12, lon: 131.87, tz: 10, tzId: 'Asia/Vladivostok' },
    { name: 'Irkutsk', lat: 52.29, lon: 104.28, tz: 8, tzId: 'Asia/Irkutsk' },
    { name: 'Khabarovsk', lat: 48.48, lon: 135.08, tz: 10, tzId: 'Asia/Vladivostok' },
    { name: 'Sochi', lat: 43.59, lon: 39.73, tz: 3, tzId: 'Europe/Moscow' },
    // Middle East
    { name: 'Riyadh', lat: 24.69, lon: 46.72, tz: 3, tzId: 'Asia/Riyadh' },
    { name: 'Jeddah', lat: 21.49, lon: 39.19, tz: 3, tzId: 'Asia/Riyadh' },
    { name: 'Mecca', lat: 21.39, lon: 39.86, tz: 3, tzId: 'Asia/Riyadh' },
    { name: 'Medina', lat: 24.52, lon: 39.57, tz: 3, tzId: 'Asia/Riyadh' },
    { name: 'Dubai', lat: 25.20, lon: 55.27, tz: 4, tzId: 'Asia/Dubai' },
    { name: 'Abu Dhabi', lat: 24.45, lon: 54.38, tz: 4, tzId: 'Asia/Dubai' },
    { name: 'Sharjah', lat: 25.36, lon: 55.39, tz: 4, tzId: 'Asia/Dubai' },
    { name: 'Kuwait City', lat: 29.38, lon: 47.99, tz: 3, tzId: 'Asia/Kuwait' },
    { name: 'Doha', lat: 25.29, lon: 51.53, tz: 3, tzId: 'Asia/Qatar' },
    { name: 'Manama', lat: 26.23, lon: 50.59, tz: 3, tzId: 'Asia/Bahrain' },
    { name: 'Muscat', lat: 23.59, lon: 58.38, tz: 4, tzId: 'Asia/Muscat' },
    { name: 'Amman', lat: 31.96, lon: 35.95, tz: 2, tzId: 'Asia/Amman' },
    { name: 'Beirut', lat: 33.89, lon: 35.50, tz: 2, tzId: 'Asia/Beirut' },
    { name: 'Damascus', lat: 33.51, lon: 36.29, tz: 2, tzId: 'Asia/Damascus' },
    { name: 'Aleppo', lat: 36.20, lon: 37.16, tz: 2, tzId: 'Asia/Damascus' },
    { name: 'Baghdad', lat: 33.31, lon: 44.37, tz: 3, tzId: 'Asia/Baghdad' },
    { name: 'Basra', lat: 30.51, lon: 47.82, tz: 3, tzId: 'Asia/Baghdad' },
    { name: 'Jerusalem', lat: 31.77, lon: 35.23, tz: 2, tzId: 'Asia/Jerusalem' },
    { name: 'Tel Aviv', lat: 32.09, lon: 34.78, tz: 2, tzId: 'Asia/Jerusalem' },
    { name: 'Haifa', lat: 32.79, lon: 34.99, tz: 2, tzId: 'Asia/Jerusalem' },
    { name: 'Tabriz', lat: 38.08, lon: 46.29, tz: 3.5, tzId: 'Asia/Tehran' },
    { name: 'Isfahan', lat: 32.65, lon: 51.68, tz: 3.5, tzId: 'Asia/Tehran' },
    { name: 'Mashhad', lat: 36.30, lon: 59.60, tz: 3.5, tzId: 'Asia/Tehran' },
    { name: 'Shiraz', lat: 29.59, lon: 52.58, tz: 3.5, tzId: 'Asia/Tehran' },
    { name: 'Kabul', lat: 34.53, lon: 69.17, tz: 4.5, tzId: 'Asia/Kabul' },
    { name: 'Sanaa', lat: 15.37, lon: 44.21, tz: 3, tzId: 'Asia/Aden' },
    // South Asia
    { name: 'Bangalore', lat: 12.97, lon: 77.59, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Hyderabad', lat: 17.39, lon: 78.49, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Ahmedabad', lat: 23.02, lon: 72.57, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Pune', lat: 18.52, lon: 73.86, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Surat', lat: 21.17, lon: 72.83, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Jaipur', lat: 26.92, lon: 75.79, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Lucknow', lat: 26.85, lon: 80.95, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Kanpur', lat: 26.45, lon: 80.35, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Nagpur', lat: 21.15, lon: 79.09, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Indore', lat: 22.72, lon: 75.86, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Thane', lat: 19.20, lon: 72.96, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Bhopal', lat: 23.26, lon: 77.41, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Visakhapatnam', lat: 17.69, lon: 83.22, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Patna', lat: 25.61, lon: 85.14, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Vadodara', lat: 22.31, lon: 73.18, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Ghaziabad', lat: 28.67, lon: 77.42, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Coimbatore', lat: 11.02, lon: 76.96, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Kochi', lat: 9.93, lon: 76.27, tz: 5.5, tzId: 'Asia/Kolkata' },
    { name: 'Lahore', lat: 31.55, lon: 74.34, tz: 5, tzId: 'Asia/Karachi' },
    { name: 'Faisalabad', lat: 31.42, lon: 73.09, tz: 5, tzId: 'Asia/Karachi' },
    { name: 'Rawalpindi', lat: 33.60, lon: 73.04, tz: 5, tzId: 'Asia/Karachi' },
    { name: 'Islamabad', lat: 33.68, lon: 73.05, tz: 5, tzId: 'Asia/Karachi' },
    { name: 'Multan', lat: 30.20, lon: 71.46, tz: 5, tzId: 'Asia/Karachi' },
    { name: 'Peshawar', lat: 34.01, lon: 71.58, tz: 5, tzId: 'Asia/Karachi' },
    { name: 'Chittagong', lat: 22.36, lon: 91.78, tz: 6, tzId: 'Asia/Dhaka' },
    { name: 'Khulna', lat: 22.82, lon: 89.55, tz: 6, tzId: 'Asia/Dhaka' },
    { name: 'Kathmandu', lat: 27.72, lon: 85.32, tz: 5.75, tzId: 'Asia/Kathmandu' },
    { name: 'Colombo', lat: 6.93, lon: 79.85, tz: 5.5, tzId: 'Asia/Colombo' },
    { name: 'Kandy', lat: 7.29, lon: 80.64, tz: 5.5, tzId: 'Asia/Colombo' },
    // East Asia
    { name: 'Yokohama', lat: 35.44, lon: 139.64, tz: 9, tzId: 'Asia/Tokyo' },
    { name: 'Nagoya', lat: 35.18, lon: 136.91, tz: 9, tzId: 'Asia/Tokyo' },
    { name: 'Sapporo', lat: 43.06, lon: 141.35, tz: 9, tzId: 'Asia/Tokyo' },
    { name: 'Kobe', lat: 34.69, lon: 135.20, tz: 9, tzId: 'Asia/Tokyo' },
    { name: 'Kyoto', lat: 35.01, lon: 135.77, tz: 9, tzId: 'Asia/Tokyo' },
    { name: 'Fukuoka', lat: 33.59, lon: 130.40, tz: 9, tzId: 'Asia/Tokyo' },
    { name: 'Hiroshima', lat: 34.39, lon: 132.46, tz: 9, tzId: 'Asia/Tokyo' },
    { name: 'Sendai', lat: 38.27, lon: 140.87, tz: 9, tzId: 'Asia/Tokyo' },
    { name: 'Busan', lat: 35.18, lon: 129.08, tz: 9, tzId: 'Asia/Seoul' },
    { name: 'Incheon', lat: 37.46, lon: 126.71, tz: 9, tzId: 'Asia/Seoul' },
    { name: 'Daegu', lat: 35.87, lon: 128.60, tz: 9, tzId: 'Asia/Seoul' },
    { name: 'Daejeon', lat: 36.35, lon: 127.38, tz: 9, tzId: 'Asia/Seoul' },
    { name: 'Gwangju', lat: 35.16, lon: 126.85, tz: 9, tzId: 'Asia/Seoul' },
    { name: 'Chengdu', lat: 30.57, lon: 104.07, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Wuhan', lat: 30.59, lon: 114.31, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Nanjing', lat: 32.06, lon: 118.78, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Tianjin', lat: 39.13, lon: 117.20, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Xian', lat: 34.27, lon: 108.95, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Hangzhou', lat: 30.27, lon: 120.15, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Suzhou', lat: 31.30, lon: 120.59, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Chongqing', lat: 29.56, lon: 106.55, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Shenyang', lat: 41.80, lon: 123.43, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Qingdao', lat: 36.07, lon: 120.38, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Dalian', lat: 38.91, lon: 121.60, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Harbin', lat: 45.80, lon: 126.53, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Changsha', lat: 28.23, lon: 112.94, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Zhengzhou', lat: 34.75, lon: 113.63, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Kunming', lat: 25.04, lon: 102.71, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Xiamen', lat: 24.48, lon: 118.09, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Fuzhou', lat: 26.07, lon: 119.30, tz: 8, tzId: 'Asia/Shanghai' },
    { name: 'Taipei', lat: 25.03, lon: 121.57, tz: 8, tzId: 'Asia/Taipei' },
    { name: 'Kaohsiung', lat: 22.62, lon: 120.31, tz: 8, tzId: 'Asia/Taipei' },
    { name: 'Taichung', lat: 24.15, lon: 120.67, tz: 8, tzId: 'Asia/Taipei' },
    { name: 'Macau', lat: 22.20, lon: 113.55, tz: 8, tzId: 'Asia/Macau' },
    { name: 'Ulaanbaatar', lat: 47.92, lon: 106.92, tz: 8, tzId: 'Asia/Ulaanbaatar' },
    // Southeast Asia
    { name: 'Hanoi', lat: 21.03, lon: 105.85, tz: 7, tzId: 'Asia/Ho_Chi_Minh' },
    { name: 'Ho Chi Minh', lat: 10.82, lon: 106.63, tz: 7, tzId: 'Asia/Ho_Chi_Minh' },
    { name: 'Da Nang', lat: 16.07, lon: 108.22, tz: 7, tzId: 'Asia/Ho_Chi_Minh' },
    { name: 'Hai Phong', lat: 20.86, lon: 106.68, tz: 7, tzId: 'Asia/Ho_Chi_Minh' },
    { name: 'Kuala Lumpur', lat: 3.14, lon: 101.69, tz: 8, tzId: 'Asia/Kuala_Lumpur' },
    { name: 'Johor Bahru', lat: 1.49, lon: 103.74, tz: 8, tzId: 'Asia/Kuala_Lumpur' },
    { name: 'Penang', lat: 5.42, lon: 100.31, tz: 8, tzId: 'Asia/Kuala_Lumpur' },
    { name: 'Surabaya', lat: -7.25, lon: 112.75, tz: 7, tzId: 'Asia/Jakarta' },
    { name: 'Bandung', lat: -6.91, lon: 107.61, tz: 7, tzId: 'Asia/Jakarta' },
    { name: 'Medan', lat: 3.59, lon: 98.67, tz: 7, tzId: 'Asia/Jakarta' },
    { name: 'Semarang', lat: -6.97, lon: 110.42, tz: 7, tzId: 'Asia/Jakarta' },
    { name: 'Makassar', lat: -5.14, lon: 119.42, tz: 8, tzId: 'Asia/Makassar' },
    { name: 'Bali', lat: -8.34, lon: 115.09, tz: 8, tzId: 'Asia/Makassar' },
    { name: 'Cebu', lat: 10.31, lon: 123.89, tz: 8, tzId: 'Asia/Manila' },
    { name: 'Davao', lat: 7.07, lon: 125.61, tz: 8, tzId: 'Asia/Manila' },
    { name: 'Quezon City', lat: 14.68, lon: 121.04, tz: 8, tzId: 'Asia/Manila' },
    { name: 'Yangon', lat: 16.87, lon: 96.20, tz: 6.5, tzId: 'Asia/Yangon' },
    { name: 'Mandalay', lat: 21.97, lon: 96.08, tz: 6.5, tzId: 'Asia/Yangon' },
    { name: 'Phnom Penh', lat: 11.56, lon: 104.92, tz: 7, tzId: 'Asia/Phnom_Penh' },
    { name: 'Vientiane', lat: 17.98, lon: 102.63, tz: 7, tzId: 'Asia/Vientiane' },
    { name: 'Phuket', lat: 7.88, lon: 98.39, tz: 7, tzId: 'Asia/Bangkok' },
    { name: 'Chiang Mai', lat: 18.79, lon: 98.98, tz: 7, tzId: 'Asia/Bangkok' },
    { name: 'Pattaya', lat: 12.93, lon: 100.88, tz: 7, tzId: 'Asia/Bangkok' },
    // Africa - North
    { name: 'Alexandria', lat: 31.20, lon: 29.92, tz: 2, tzId: 'Africa/Cairo' },
    { name: 'Giza', lat: 30.01, lon: 31.21, tz: 2, tzId: 'Africa/Cairo' },
    { name: 'Port Said', lat: 31.27, lon: 32.30, tz: 2, tzId: 'Africa/Cairo' },
    { name: 'Luxor', lat: 25.69, lon: 32.64, tz: 2, tzId: 'Africa/Cairo' },
    { name: 'Casablanca', lat: 33.57, lon: -7.59, tz: 1, tzId: 'Africa/Casablanca' },
    { name: 'Rabat', lat: 34.01, lon: -6.83, tz: 1, tzId: 'Africa/Casablanca' },
    { name: 'Fes', lat: 34.03, lon: -5.00, tz: 1, tzId: 'Africa/Casablanca' },
    { name: 'Marrakech', lat: 31.63, lon: -7.98, tz: 1, tzId: 'Africa/Casablanca' },
    { name: 'Tangier', lat: 35.78, lon: -5.81, tz: 1, tzId: 'Africa/Casablanca' },
    { name: 'Algiers', lat: 36.74, lon: 3.09, tz: 1, tzId: 'Africa/Algiers' },
    { name: 'Oran', lat: 35.70, lon: -0.64, tz: 1, tzId: 'Africa/Algiers' },
    { name: 'Constantine', lat: 36.37, lon: 6.61, tz: 1, tzId: 'Africa/Algiers' },
    { name: 'Tunis', lat: 36.81, lon: 10.18, tz: 1, tzId: 'Africa/Tunis' },
    { name: 'Tripoli', lat: 32.89, lon: 13.19, tz: 2, tzId: 'Africa/Tripoli' },
    { name: 'Benghazi', lat: 32.12, lon: 20.07, tz: 2, tzId: 'Africa/Tripoli' },
    { name: 'Khartoum', lat: 15.50, lon: 32.56, tz: 2, tzId: 'Africa/Khartoum' },
    // Africa - West
    { name: 'Abuja', lat: 9.06, lon: 7.50, tz: 1, tzId: 'Africa/Lagos' },
    { name: 'Kano', lat: 12.00, lon: 8.52, tz: 1, tzId: 'Africa/Lagos' },
    { name: 'Ibadan', lat: 7.38, lon: 3.90, tz: 1, tzId: 'Africa/Lagos' },
    { name: 'Port Harcourt', lat: 4.78, lon: 7.01, tz: 1, tzId: 'Africa/Lagos' },
    { name: 'Accra', lat: 5.56, lon: -0.19, tz: 0, tzId: 'Africa/Accra' },
    { name: 'Kumasi', lat: 6.69, lon: -1.62, tz: 0, tzId: 'Africa/Accra' },
    { name: 'Dakar', lat: 14.69, lon: -17.44, tz: 0, tzId: 'Africa/Dakar' },
    { name: 'Abidjan', lat: 5.35, lon: -4.01, tz: 0, tzId: 'Africa/Abidjan' },
    { name: 'Bamako', lat: 12.64, lon: -8.00, tz: 0, tzId: 'Africa/Bamako' },
    { name: 'Ouagadougou', lat: 12.37, lon: -1.52, tz: 0, tzId: 'Africa/Ouagadougou' },
    { name: 'Conakry', lat: 9.64, lon: -13.58, tz: 0, tzId: 'Africa/Conakry' },
    { name: 'Freetown', lat: 8.48, lon: -13.23, tz: 0, tzId: 'Africa/Freetown' },
    { name: 'Monrovia', lat: 6.29, lon: -10.76, tz: 0, tzId: 'Africa/Monrovia' },
    { name: 'Lomé', lat: 6.17, lon: 1.23, tz: 0, tzId: 'Africa/Lome' },
    { name: 'Cotonou', lat: 6.37, lon: 2.39, tz: 1, tzId: 'Africa/Porto-Novo' },
    { name: 'Niamey', lat: 13.51, lon: 2.13, tz: 1, tzId: 'Africa/Niamey' },
    { name: 'Nouakchott', lat: 18.09, lon: -15.98, tz: 0, tzId: 'Africa/Nouakchott' },
    // Africa - East
    { name: 'Nairobi', lat: -1.29, lon: 36.82, tz: 3, tzId: 'Africa/Nairobi' },
    { name: 'Mombasa', lat: -4.04, lon: 39.67, tz: 3, tzId: 'Africa/Nairobi' },
    { name: 'Addis Ababa', lat: 9.03, lon: 38.70, tz: 3, tzId: 'Africa/Addis_Ababa' },
    { name: 'Dar es Salaam', lat: -6.79, lon: 39.21, tz: 3, tzId: 'Africa/Dar_es_Salaam' },
    { name: 'Zanzibar', lat: -6.16, lon: 39.19, tz: 3, tzId: 'Africa/Dar_es_Salaam' },
    { name: 'Kampala', lat: 0.32, lon: 32.58, tz: 3, tzId: 'Africa/Kampala' },
    { name: 'Kigali', lat: -1.94, lon: 30.06, tz: 2, tzId: 'Africa/Kigali' },
    { name: 'Bujumbura', lat: -3.38, lon: 29.36, tz: 2, tzId: 'Africa/Bujumbura' },
    { name: 'Mogadishu', lat: 2.04, lon: 45.34, tz: 3, tzId: 'Africa/Mogadishu' },
    { name: 'Djibouti', lat: 11.59, lon: 43.15, tz: 3, tzId: 'Africa/Djibouti' },
    { name: 'Asmara', lat: 15.34, lon: 38.93, tz: 3, tzId: 'Africa/Asmara' },
    // Africa - Central
    { name: 'Kinshasa', lat: -4.44, lon: 15.27, tz: 1, tzId: 'Africa/Kinshasa' },
    { name: 'Lubumbashi', lat: -11.66, lon: 27.48, tz: 2, tzId: 'Africa/Lubumbashi' },
    { name: 'Brazzaville', lat: -4.27, lon: 15.28, tz: 1, tzId: 'Africa/Brazzaville' },
    { name: 'Douala', lat: 4.05, lon: 9.70, tz: 1, tzId: 'Africa/Douala' },
    { name: 'Yaoundé', lat: 3.87, lon: 11.52, tz: 1, tzId: 'Africa/Douala' },
    { name: 'Libreville', lat: 0.39, lon: 9.45, tz: 1, tzId: 'Africa/Libreville' },
    { name: 'Luanda', lat: -8.84, lon: 13.23, tz: 1, tzId: 'Africa/Luanda' },
    { name: 'Bangui', lat: 4.36, lon: 18.56, tz: 1, tzId: 'Africa/Bangui' },
    { name: 'NDjamena', lat: 12.11, lon: 15.04, tz: 1, tzId: 'Africa/Ndjamena' },
    // Africa - Southern
    { name: 'Cape Town', lat: -33.93, lon: 18.42, tz: 2, tzId: 'Africa/Johannesburg' },
    { name: 'Durban', lat: -29.86, lon: 31.02, tz: 2, tzId: 'Africa/Johannesburg' },
    { name: 'Pretoria', lat: -25.75, lon: 28.19, tz: 2, tzId: 'Africa/Johannesburg' },
    { name: 'Port Elizabeth', lat: -33.96, lon: 25.60, tz: 2, tzId: 'Africa/Johannesburg' },
    { name: 'Bloemfontein', lat: -29.12, lon: 26.21, tz: 2, tzId: 'Africa/Johannesburg' },
    { name: 'Lusaka', lat: -15.39, lon: 28.32, tz: 2, tzId: 'Africa/Lusaka' },
    { name: 'Harare', lat: -17.83, lon: 31.05, tz: 2, tzId: 'Africa/Harare' },
    { name: 'Bulawayo', lat: -20.15, lon: 28.58, tz: 2, tzId: 'Africa/Harare' },
    { name: 'Maputo', lat: -25.97, lon: 32.57, tz: 2, tzId: 'Africa/Maputo' },
    { name: 'Lilongwe', lat: -13.97, lon: 33.79, tz: 2, tzId: 'Africa/Blantyre' },
    { name: 'Gaborone', lat: -24.65, lon: 25.91, tz: 2, tzId: 'Africa/Gaborone' },
    { name: 'Windhoek', lat: -22.56, lon: 17.08, tz: 2, tzId: 'Africa/Windhoek' },
    { name: 'Antananarivo', lat: -18.91, lon: 47.54, tz: 3, tzId: 'Indian/Antananarivo' },
    { name: 'Port Louis', lat: -20.16, lon: 57.50, tz: 4, tzId: 'Indian/Mauritius' },
    // Oceania
    { name: 'Sydney', lat: -33.87, lon: 151.21, tz: 10, tzId: 'Australia/Sydney' },
    { name: 'Melbourne', lat: -37.81, lon: 144.96, tz: 10, tzId: 'Australia/Melbourne' },
    { name: 'Brisbane', lat: -27.47, lon: 153.03, tz: 10, tzId: 'Australia/Brisbane' },
    { name: 'Perth', lat: -31.95, lon: 115.86, tz: 8, tzId: 'Australia/Perth' },
    { name: 'Adelaide', lat: -34.93, lon: 138.60, tz: 9.5, tzId: 'Australia/Adelaide' },
    { name: 'Gold Coast', lat: -28.00, lon: 153.43, tz: 10, tzId: 'Australia/Brisbane' },
    { name: 'Newcastle', lat: -32.93, lon: 151.78, tz: 10, tzId: 'Australia/Sydney' },
    { name: 'Canberra', lat: -35.28, lon: 149.13, tz: 10, tzId: 'Australia/Sydney' },
    { name: 'Hobart', lat: -42.88, lon: 147.33, tz: 10, tzId: 'Australia/Hobart' },
    { name: 'Darwin', lat: -12.46, lon: 130.84, tz: 9.5, tzId: 'Australia/Darwin' },
    { name: 'Cairns', lat: -16.92, lon: 145.77, tz: 10, tzId: 'Australia/Brisbane' },
    { name: 'Townsville', lat: -19.26, lon: 146.82, tz: 10, tzId: 'Australia/Brisbane' },
    { name: 'Auckland', lat: -36.85, lon: 174.76, tz: 12, tzId: 'Pacific/Auckland' },
    { name: 'Wellington', lat: -41.29, lon: 174.78, tz: 12, tzId: 'Pacific/Auckland' },
    { name: 'Christchurch', lat: -43.53, lon: 172.64, tz: 12, tzId: 'Pacific/Auckland' },
    { name: 'Hamilton NZ', lat: -37.79, lon: 175.28, tz: 12, tzId: 'Pacific/Auckland' },
    { name: 'Dunedin', lat: -45.87, lon: 170.50, tz: 12, tzId: 'Pacific/Auckland' },
    { name: 'Suva', lat: -18.14, lon: 178.44, tz: 12, tzId: 'Pacific/Fiji' },
    { name: 'Port Moresby', lat: -9.44, lon: 147.18, tz: 10, tzId: 'Pacific/Port_Moresby' },
    { name: 'Noumea', lat: -22.28, lon: 166.46, tz: 11, tzId: 'Pacific/Noumea' },
    { name: 'Papeete', lat: -17.54, lon: -149.57, tz: -10, tzId: 'Pacific/Tahiti' },
    { name: 'Apia', lat: -13.83, lon: -171.76, tz: 13, tzId: 'Pacific/Apia' },
    { name: 'Nuku\'alofa', lat: -21.21, lon: -175.20, tz: 13, tzId: 'Pacific/Tongatapu' },
    // Arctic & Remote
    { name: 'Longyearbyen', lat: 78.22, lon: 15.64, tz: 1, tzId: 'Arctic/Longyearbyen' },
    { name: 'Nuuk', lat: 64.18, lon: -51.72, tz: -3, tzId: 'America/Nuuk' },
    { name: 'Fairbanks', lat: 64.84, lon: -147.72, tz: -9, tzId: 'America/Anchorage' },
    { name: 'Tromsø', lat: 69.65, lon: 18.96, tz: 1, tzId: 'Europe/Oslo' },
    { name: 'Murmansk', lat: 68.97, lon: 33.09, tz: 3, tzId: 'Europe/Moscow' },
    { name: 'Yellowknife', lat: 62.45, lon: -114.37, tz: -7, tzId: 'America/Yellowknife' },
    { name: 'Whitehorse', lat: 60.72, lon: -135.05, tz: -8, tzId: 'America/Whitehorse' },
    { name: 'McMurdo', lat: -77.85, lon: 166.67, tz: 12, tzId: 'Antarctica/McMurdo' },
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
 * Get DST-aware UTC offset for a city at a given date.
 * Uses the IANA tzId to compute the real offset via Intl API.
 * Falls back to the static tz field if tzId is not available.
 */
const _tzOffsetCache = new Map();
function getCityTz(city, date) {
    if (!city) return 0;
    if (!city.tzId) return city.tz;

    // Cache key: tzId + hour (DST transitions are always on hour boundaries)
    const hourKey = Math.floor(date.getTime() / 3600000);
    const cacheKey = city.tzId + hourKey;

    const cached = _tzOffsetCache.get(cacheKey);
    if (cached !== undefined) return cached;

    // Compute offset: compare UTC vs local time at target timezone
    const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
    const localStr = date.toLocaleString('en-US', { timeZone: city.tzId });
    const offset = (new Date(localStr) - new Date(utcStr)) / 3600000;

    // Keep cache bounded
    if (_tzOffsetCache.size > 500) _tzOffsetCache.clear();
    _tzOffsetCache.set(cacheKey, offset);

    return offset;
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
    const cityTzHours = getCityTz(closestCity, getAbsoluteSimulatedTime());

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
    const cityTzHours = getCityTz(closestCity, getAbsoluteSimulatedTime());

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

// Cached "next rise/set" per body: a findNextRiseSet search costs ~50-100
// ephemeris calls, and updatePositionDisplay runs EVERY FRAME while the
// simulation plays (plus per pointer event while the time slider drags).
// A cached answer stays valid until sim time passes the event or the
// pointer moves; backward scrubs re-search at most 4x/s.
const nextRiseSetCache = {
    sun: { event: null, fromMs: 0, lat: null, lon: null, realMs: 0 },
    moon: { event: null, fromMs: 0, lat: null, lon: null, realMs: 0 }
};

function getNextRiseSetCached(key, lat, lon, getPosition, simTime, horizonThreshold) {
    const c = nextRiseSetCache[key];
    const t = simTime.getTime();
    const locOk = c.lat !== null && Math.abs(lat - c.lat) < 0.01 && Math.abs(lon - c.lon) < 0.01;
    if (locOk) {
        // No-event answers (polar day/night) revalidate after an hour of sim time
        const endMs = c.event ? c.event.time.getTime() : c.fromMs + 3600 * 1000;
        if (t >= c.fromMs && t < endMs) return c.event;
        // Scrubbing backward invalidates on every event; serve the slightly
        // stale answer (the event is still in the future) between searches
        if (t < c.fromMs && performance.now() - c.realMs < 250) return c.event;
    }
    c.event = findNextRiseSet(lat, lon, getPosition, simTime, horizonThreshold);
    c.fromMs = t;
    c.lat = lat;
    c.lon = lon;
    c.realMs = performance.now();
    return c.event;
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

    // Moon glow sprite (purely visual, additive blending — no lighting/shadow effect)
    const moonGlowCanvas = document.createElement('canvas');
    moonGlowCanvas.width = 128;
    moonGlowCanvas.height = 128;
    const mgCtx = moonGlowCanvas.getContext('2d');
    const mgGrad = mgCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
    mgGrad.addColorStop(0, 'rgba(200, 220, 255, 0.7)');
    mgGrad.addColorStop(0.2, 'rgba(180, 200, 255, 0.35)');
    mgGrad.addColorStop(0.5, 'rgba(150, 180, 255, 0.1)');
    mgGrad.addColorStop(1, 'rgba(120, 150, 255, 0)');
    mgCtx.fillStyle = mgGrad;
    mgCtx.fillRect(0, 0, 128, 128);
    const moonGlowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(moonGlowCanvas),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    }));
    moonGlowSprite.scale.set(MOON_RADIUS * 6, MOON_RADIUS * 6, 1);
    moonMesh.add(moonGlowSprite);

    // Initial position update
    updateMoonPosition();
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

    // Update directional light to point from sun direction
    if (sunLight) {
        sunLight.position.set(sunPos.x, sunPos.y, sunPos.z);
    }

    // Update Earth material sunDirection uniform for eclipse darkening
    if (earthMaterial && earthMaterial.userData.sunDirection) {
        earthMaterial.userData.sunDirection.value.set(sunPos.x, sunPos.y, sunPos.z).normalize();
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

    // Sun glow sprite (purely visual, additive blending — no lighting/shadow effect)
    const sunGlowCanvas = document.createElement('canvas');
    sunGlowCanvas.width = 128;
    sunGlowCanvas.height = 128;
    const sgCtx = sunGlowCanvas.getContext('2d');
    const sgGrad = sgCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
    sgGrad.addColorStop(0, 'rgba(255, 255, 230, 0.9)');
    sgGrad.addColorStop(0.2, 'rgba(255, 245, 200, 0.5)');
    sgGrad.addColorStop(0.5, 'rgba(255, 230, 150, 0.15)');
    sgGrad.addColorStop(1, 'rgba(255, 220, 100, 0)');
    sgCtx.fillStyle = sgGrad;
    sgCtx.fillRect(0, 0, 128, 128);
    const sunGlowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(sunGlowCanvas),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    }));
    sunGlowSprite.scale.set(SUN_VISUAL_RADIUS * 6, SUN_VISUAL_RADIUS * 6, 1);
    sunMesh.add(sunGlowSprite);

    // Initial position update
    updateSunPosition();
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

    // Check if umbra reaches Earth's SURFACE (total eclipse possible) — the
    // sub-lunar surface is ~1 Earth radius closer than the center; testing
    // against center misclassifies near-limit totals as annular
    const umbraReachesEarth = umbraLengthKm > moonDistanceKm - EARTH_RADIUS_KM;

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
 * Create ghost celestial sprites, arc lines, and horizon glow indicators
 */
function createGhostCelestials() {
    // --- Ghost Sun Sprite ---
    const sunGlowCanvas = document.createElement('canvas');
    sunGlowCanvas.width = 64;
    sunGlowCanvas.height = 64;
    const sunCtx = sunGlowCanvas.getContext('2d');
    const sunGrad = sunCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
    sunGrad.addColorStop(0, 'rgba(255, 240, 120, 0.9)');
    sunGrad.addColorStop(0.3, 'rgba(255, 220, 80, 0.5)');
    sunGrad.addColorStop(0.6, 'rgba(255, 200, 50, 0.15)');
    sunGrad.addColorStop(1, 'rgba(255, 180, 0, 0)');
    sunCtx.fillStyle = sunGrad;
    sunCtx.fillRect(0, 0, 64, 64);
    const sunGlowTexture = new THREE.CanvasTexture(sunGlowCanvas);
    const sunGlowMaterial = new THREE.SpriteMaterial({
        map: sunGlowTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    ghostSunSprite = new THREE.Sprite(sunGlowMaterial);
    ghostSunSprite.scale.set(SUN_VISUAL_RADIUS * 7, SUN_VISUAL_RADIUS * 7, 1);
    ghostSunSprite.visible = false;
    ghostSunSprite.renderOrder = 999;
    scene.add(ghostSunSprite);

    // --- Ghost Moon Sprite ---
    const moonGlowCanvas = document.createElement('canvas');
    moonGlowCanvas.width = 64;
    moonGlowCanvas.height = 64;
    const moonCtx = moonGlowCanvas.getContext('2d');
    const moonGrad = moonCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
    moonGrad.addColorStop(0, 'rgba(240, 242, 255, 1.0)');
    moonGrad.addColorStop(0.25, 'rgba(225, 228, 245, 0.6)');
    moonGrad.addColorStop(0.5, 'rgba(210, 215, 235, 0.25)');
    moonGrad.addColorStop(1, 'rgba(190, 195, 215, 0)');
    moonCtx.fillStyle = moonGrad;
    moonCtx.fillRect(0, 0, 64, 64);
    const moonGlowTexture = new THREE.CanvasTexture(moonGlowCanvas);
    const moonGlowMaterial = new THREE.SpriteMaterial({
        map: moonGlowTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    ghostMoonSprite = new THREE.Sprite(moonGlowMaterial);
    ghostMoonSprite.scale.set(MOON_RADIUS * 7, MOON_RADIUS * 7, 1);
    ghostMoonSprite.visible = false;
    ghostMoonSprite.renderOrder = 999;
    scene.add(ghostMoonSprite);

}

/**
 * Create celestial trail Points meshes (24h path of sun and moon)
 * Uses 2 THREE.Points objects instead of 96 individual sprites.
 */
function createCelestialTrails() {
    // Trail point shader — replicates sprite appearance with per-point opacity
    const trailVertexShader = `
        attribute float trailOpacity;
        varying float vOpacity;
        uniform float pointSize;
        void main() {
            vOpacity = trailOpacity;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = pointSize * (600.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
        }
    `;
    const trailFragmentShader = `
        uniform sampler2D map;
        varying float vOpacity;
        void main() {
            vec4 texColor = texture2D(map, gl_PointCoord);
            gl_FragColor = vec4(texColor.rgb, texColor.a * vOpacity);
        }
    `;

    // Sun trail texture — warm yellow (matches ghost sun)
    const sunCanvas = document.createElement('canvas');
    sunCanvas.width = 64;
    sunCanvas.height = 64;
    const sCtx = sunCanvas.getContext('2d');
    const sGrad = sCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
    sGrad.addColorStop(0, 'rgba(255, 220, 80, 0.6)');
    sGrad.addColorStop(0.4, 'rgba(255, 200, 50, 0.25)');
    sGrad.addColorStop(1, 'rgba(255, 180, 0, 0)');
    sCtx.fillStyle = sGrad;
    sCtx.fillRect(0, 0, 64, 64);
    const sunTrailTexture = new THREE.CanvasTexture(sunCanvas);

    // Moon trail texture — soft grey/white (matches ghost moon)
    const moonCanvas = document.createElement('canvas');
    moonCanvas.width = 64;
    moonCanvas.height = 64;
    const mCtx = moonCanvas.getContext('2d');
    const mGrad = mCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
    mGrad.addColorStop(0, 'rgba(200, 205, 220, 0.55)');
    mGrad.addColorStop(0.4, 'rgba(180, 185, 200, 0.2)');
    mGrad.addColorStop(1, 'rgba(160, 165, 180, 0)');
    mCtx.fillStyle = mGrad;
    mCtx.fillRect(0, 0, 64, 64);
    const moonTrailTexture = new THREE.CanvasTexture(moonCanvas);

    // Sun trail — single Points mesh
    const sunPositions = new Float32Array(TRAIL_POINT_COUNT * 3);
    const sunOpacities = new Float32Array(TRAIL_POINT_COUNT);
    const sunGeom = new THREE.BufferGeometry();
    sunGeom.setAttribute('position', new THREE.BufferAttribute(sunPositions, 3));
    sunGeom.setAttribute('trailOpacity', new THREE.BufferAttribute(sunOpacities, 1));
    sunTrailPoints = new THREE.Points(sunGeom, new THREE.ShaderMaterial({
        uniforms: { map: { value: sunTrailTexture }, pointSize: { value: SUN_VISUAL_RADIUS * 4 } },
        vertexShader: trailVertexShader,
        fragmentShader: trailFragmentShader,
        transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.AdditiveBlending
    }));
    sunTrailPoints.visible = false;
    sunTrailPoints.frustumCulled = false;
    scene.add(sunTrailPoints);

    // Moon trail — single Points mesh
    const moonPositions = new Float32Array(TRAIL_POINT_COUNT * 3);
    const moonOpacities = new Float32Array(TRAIL_POINT_COUNT);
    const moonGeom = new THREE.BufferGeometry();
    moonGeom.setAttribute('position', new THREE.BufferAttribute(moonPositions, 3));
    moonGeom.setAttribute('trailOpacity', new THREE.BufferAttribute(moonOpacities, 1));
    moonTrailPoints = new THREE.Points(moonGeom, new THREE.ShaderMaterial({
        uniforms: { map: { value: moonTrailTexture }, pointSize: { value: MOON_RADIUS * 4 } },
        vertexShader: trailVertexShader,
        fragmentShader: trailFragmentShader,
        transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.AdditiveBlending
    }));
    moonTrailPoints.visible = false;
    moonTrailPoints.frustumCulled = false;
    scene.add(moonTrailPoints);
}

/**
 * Update celestial trail positions and opacity.
 * Uses rotation math instead of Swiss Ephemeris — the sun/moon trace
 * predictable arcs so we rotate the current mesh position backward in time.
 * Sun: 15°/hr westward (Earth rotation).
 * Moon: ~14.49°/hr westward (Earth rotation minus orbital motion).
 * Runs every frame with no throttle since it's just trig, no ephemeris calls.
 */
function updateCelestialTrails() {
    if (!celestialTrailsEnabled || !sunMesh || !moonMesh) {
        if (sunTrailPoints) sunTrailPoints.visible = false;
        if (moonTrailPoints) moonTrailPoints.visible = false;
        return;
    }

    const sx = sunMesh.position.x, sy = sunMesh.position.y, sz = sunMesh.position.z;
    const mx = moonMesh.position.x, my = moonMesh.position.y, mz = moonMesh.position.z;

    const sunPos = sunTrailPoints.geometry.attributes.position;
    const sunOp = sunTrailPoints.geometry.attributes.trailOpacity;
    const moonPos = moonTrailPoints.geometry.attributes.position;
    const moonOp = moonTrailPoints.geometry.attributes.trailOpacity;

    for (let i = 0; i < TRAIL_POINT_COUNT; i++) {
        const hoursAgo = (i + 1) * 0.5;
        const opacity = 1.0 * (1 - (i + 1) / TRAIL_POINT_COUNT);

        // Sun: rotate current position eastward (back in time) around Z axis at 15°/hr
        const sa = hoursAgo * 15 * Math.PI / 180;
        const sc = Math.cos(sa), ss = Math.sin(sa);
        sunPos.setXYZ(i, sx * sc - sy * ss, sx * ss + sy * sc, sz);
        sunOp.setX(i, opacity);

        // Moon: ~14.49°/hr (15° Earth rotation - 0.51° orbital motion)
        const ma = hoursAgo * 14.49 * Math.PI / 180;
        const mc = Math.cos(ma), ms = Math.sin(ma);
        moonPos.setXYZ(i, mx * mc - my * ms, mx * ms + my * mc, mz);
        moonOp.setX(i, opacity);
    }

    sunPos.needsUpdate = true;
    sunOp.needsUpdate = true;
    moonPos.needsUpdate = true;
    moonOp.needsUpdate = true;

    // Trail sees through Earth only when ghost celestials are enabled
    const seeThrough = ghostViewEnabled;
    sunTrailPoints.material.depthTest = !seeThrough;
    moonTrailPoints.material.depthTest = !seeThrough;

    sunTrailPoints.visible = true;
    moonTrailPoints.visible = true;
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

}

/**
 * Update eclipse cone positions and sizes based on current sun/moon positions
 */
function updateEclipseCones() {
    if (!umbraCone || !penumbraCone || !antumbraCone) return;

    const simTime = getSimulatedTime();

    // Calculate moon position directly (not from mesh which may be throttled)
    const moonScenePos = getMoonScenePosition(simTime);
    const moonPos = _tv1.set(moonScenePos.x, moonScenePos.y, moonScenePos.z);

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
    const sunDir = _tv2.set(sunScenePos.x, sunScenePos.y, sunScenePos.z).normalize();

    // Update sun mesh position in sync with uniforms (bypass throttling)
    if (sunMesh) {
        sunMesh.position.set(sunScenePos.x, sunScenePos.y, sunScenePos.z);
    }

    // Update Earth material sunDirection uniform for eclipse darkening shader (non-throttled)
    if (earthMaterial && earthMaterial.userData.sunDirection) {
        earthMaterial.userData.sunDirection.value.copy(sunDir);
    }

    // Check angular separation between moon and sun - only show cones near eclipse
    const moonDir = _tv3.copy(moonPos).normalize();
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

    // Get real distances in km. Sun distance matters: ±1.7% over the year
    // shifts the umbra length ~±6400 km — the margin that decides hybrid
    // (total-vs-annular) eclipses.
    const moonDistanceKm = getMoonDistance(simTime);
    const sunDistanceKm = getSunDistance(simTime) * 1e6;  // returned in millions of km

    // Calculate cone geometry
    const coneParams = calculateEclipseConeGeometry(moonDistanceKm, sunDistanceKm);

    // Shadow direction: opposite to sun direction (shadow travels away from Sun)
    // This is parallel rays from Sun, so shadow direction is same everywhere
    const shadowDir = _tv3.copy(sunDir).negate();

    // Direction toward Sun
    const towardSun = sunDir;

    // === UMBRA CONE ===
    // Dark inner shadow - base at Moon, apex points away from Sun (toward Earth)
    // Three.js ConeGeometry: apex at +Y, base at -Y
    const umbraLength = Math.min(coneParams.umbraLengthScene, coneParams.moonDistanceScene * 1.5);
    const umbraBaseRadius = coneParams.umbraBaseRadiusScene;

    umbraCone.scale.set(umbraBaseRadius, umbraLength, umbraBaseRadius);

    // Position: cone center is at Moon + half length along shadow direction
    umbraCone.position.copy(_tv4.copy(moonPos).addScaledVector(shadowDir, umbraLength / 2));

    // Orient: +Y (apex) points along shadow direction (away from Sun)
    _tq1.setFromUnitVectors(_tv5.set(0, 1, 0), shadowDir);
    umbraCone.quaternion.copy(_tq1);

    // === PENUMBRA CONE ===
    // Outer partial shadow - apex is between Moon and Sun, expands toward Earth
    // Apex is at Moon + penumbraApexDist in the direction TOWARD Sun
    const penumbraApexPos = _tv4.copy(moonPos).addScaledVector(towardSun, coneParams.penumbraApexDistScene);

    // Penumbra extends from apex toward Earth
    // Length from apex to Earth = penumbraApexDist + moonDistance
    const penumbraLength = coneParams.penumbraApexDistScene + coneParams.moonDistanceScene;
    const penumbraBaseRadius = coneParams.penumbraRadiusAtEarthScene;

    penumbraCone.scale.set(penumbraBaseRadius, penumbraLength, penumbraBaseRadius);

    // Position: center is at apex + half length along shadow direction
    penumbraCone.position.copy(_tv5.copy(penumbraApexPos).addScaledVector(shadowDir, penumbraLength / 2));

    // Orient: +Y (apex) points toward Sun (opposite of shadow direction)
    // This means base (wide end) points toward Earth
    _tq1.setFromUnitVectors(_tv5.set(0, 1, 0), towardSun);
    penumbraCone.quaternion.copy(_tq1);

    // === ANTUMBRA CONE ===
    // Only visible when umbra doesn't reach Earth (annular eclipse)
    // Antumbra diverges from umbra apex toward Earth
    if (!coneParams.umbraReachesEarth) {
        antumbraCone.visible = true;

        // Umbra apex position (tip of umbra cone)
        const umbraApexPos = _tv4.copy(moonPos).addScaledVector(shadowDir, coneParams.umbraLengthScene);

        // Distance from umbra apex to Earth center
        const apexToEarthDist = coneParams.moonDistanceScene - coneParams.umbraLengthScene;

        // Antumbra extends from apex toward Earth and slightly beyond
        const antumbraLength = apexToEarthDist + EARTH_RADIUS * 0.5;

        // Radius at Earth's distance from apex
        const antumbraRadiusAtEarth = apexToEarthDist * Math.tan(coneParams.antumbraHalfAngle);

        antumbraCone.scale.set(antumbraRadiusAtEarth, antumbraLength, antumbraRadiusAtEarth);

        // Position: center is at apex + half length along shadow direction
        antumbraCone.position.copy(_tv5.copy(umbraApexPos).addScaledVector(shadowDir, antumbraLength / 2));

        // Orient: +Y (apex) points back toward Moon (opposite shadow direction)
        // This means base (wide end) points toward Earth
        _tq1.setFromUnitVectors(_tv5.set(0, 1, 0), towardSun);
        antumbraCone.quaternion.copy(_tq1);
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
    const cityTz = getCityTz(closestCity, simTime);

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
        const tz = cityTz;
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
        const cityTime = new Date(utcTime + cityTz * 60 * 60 * 1000);
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
            const tz = cityTz;
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
    currentSunAltDeg = sunAltitude;

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
        const nextSunEvent = getNextRiseSetCached('sun', lat, lon, getSunPosition, simTime, -0.833);
        if (nextSunEvent) {
            const totalMins = Math.max(0, Math.floor((nextSunEvent.time.getTime() - simTime.getTime()) / (60 * 1000)));
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
    currentMoonAltDeg = moonAltitude;

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
            const nextMoonEvent = getNextRiseSetCached('moon', lat, lon, getMoonPosition, simTime, 0.125);
            if (nextMoonEvent) {
                const totalMins = Math.max(0, Math.floor((nextMoonEvent.time.getTime() - simTime.getTime()) / (60 * 1000)));
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

let eventMarkersCacheKey = '';

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
    const cityTz = getCityTz(closestCity, getAbsoluteSimulatedTime());

    // Rise/set times depend on (date, location, timezone) — NOT time of day.
    // The slider input handler calls this on every pointer event, and the two
    // searches below cost ~700 ephemeris calls; bail out when nothing changed.
    const dateKey = selectedDate ? selectedDate.toDateString() : new Date().toDateString();
    const markersKey = dateKey + '|' + groundPos.lat.toFixed(2) + '|' + groundPos.lon.toFixed(2) + '|' + cityTz;
    if (markersKey === eventMarkersCacheKey) return;
    eventMarkersCacheKey = markersKey;

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
            const cityTzHours = getCityTz(closestCity, new Date(y, m - 1, d));
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
            timeUiDirty = true;  // refreshed once on the next frame
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
            timeUiDirty = true;  // refreshed once on the next frame
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
            const cityTzHours = getCityTz(closestCity, now);
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

    // Update displays (also satisfies any pending scrub refresh this frame)
    timeUiDirty = false;
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

        // Defer all UI/scene refresh to the next animation frame — input
        // events can outpace frames 2-3x, and the frame loop already moves
        // the sun/moon/lighting every frame (smooth scrubbing)
        timeUiDirty = true;
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
        const cityTzHours = getCityTz(closestCity, now);

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
        const cityTzHours = getCityTz(closestCity, now);

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
    // (skip if URL state already configured time)
    if (lastPointerTz === null) {
        const now = new Date();

        // Get timezone at pointer position
        const closestCity = findClosestCity(focusPointLat, focusPointLon);
        const cityTzHours = getCityTz(closestCity, now);

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
        calendarViewDate = new Date(pointerDate);
    } else {
        if (selectedDate) calendarViewDate = new Date(selectedDate);
    }
    slider.value = timeOffsetMinutes;

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
            const cityTzHours = getCityTz(closestCity, now);

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

    if (!isHorizonMode) {
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
            if (isViewTransitioning) return;
            if (isHorizonMode) {
                // Horizon → liftoff to orbital
                if (camera.fov !== DEFAULT_FOV) {
                    camera.fov = DEFAULT_FOV;
                    camera.updateProjectionMatrix();
                }
                startViewTransition(-1);
            } else {
                // Orbital → fall to horizon
                cameraRadius = TRANSITION_RADIUS;
                startViewTransition(1);
            }
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

    // ==================== FLYOUT PANEL SYSTEM ====================
    const flyoutPanels = {
        'category-earth': document.getElementById('earth-layers-panel'),
        'category-sky': document.getElementById('sky-layers-panel'),
        'category-appearance': document.getElementById('earth-settings-panel'),
    };

    // Position a flyout panel: right of toolbox, bottom-aligned
    function positionFlyoutPanel(panel) {
        const toolbox = document.getElementById('left-controls');
        if (!toolbox || !panel) return;
        const rect = toolbox.getBoundingClientRect();
        panel.style.left = (rect.right + 6) + 'px';
        panel.style.bottom = (window.innerHeight - rect.bottom) + 'px';
        panel.style.top = 'auto';
    }

    // Open/close flyout panels — only one at a time
    function toggleFlyoutPanel(categoryId) {
        const targetPanel = flyoutPanels[categoryId];
        const btn = document.getElementById(categoryId);
        const isOpening = targetPanel && targetPanel.classList.contains('hidden');

        // Close all panels and remove open class from all category buttons
        Object.entries(flyoutPanels).forEach(([id, panel]) => {
            if (panel) panel.classList.add('hidden');
            const b = document.getElementById(id);
            if (b) b.classList.remove('open');
        });

        // Open the target if it was closed
        if (isOpening && targetPanel) {
            targetPanel.classList.remove('hidden');
            positionFlyoutPanel(targetPanel);
            if (btn) btn.classList.add('open');
        }
    }

    document.getElementById('category-earth')?.addEventListener('click', () => toggleFlyoutPanel('category-earth'));
    document.getElementById('category-sky')?.addEventListener('click', () => toggleFlyoutPanel('category-sky'));
    document.getElementById('category-appearance')?.addEventListener('click', () => toggleFlyoutPanel('category-appearance'));

    // ==================== PILL TOGGLE HANDLERS ====================
    // Map data-toggle values to their actions
    const pillToggleActions = {
        'imagery': {
            get: () => imageryEnabled,
            set: (v) => { imageryEnabled = v; }  // updateImagery handles visibility + displacement
        },
        'elevation': {
            get: () => elevationEnabled,
            set: (v) => {
                elevationEnabled = v;
                if (imageryRings) {
                    for (const ring of imageryRings) {
                        ring.elevDirty = true;               // re-apply (or flatten) heights
                        if (v) ensureRingElevationTiles(ring);
                    }
                }
            }
        },
        'coastlines': {
            get: () => coastlinesVisible,
            set: (v) => {
                coastlinesVisible = v;
                if (coastlineMesh) coastlineMesh.visible = v;
            }
        },
        'water': {
            get: () => waterLinesVisible,
            set: (v) => {
                waterLinesVisible = v;
                if (lakesMesh) lakesMesh.visible = v;
                if (riversMesh) riversMesh.visible = v;
            }
        },
        'city-labels': {
            get: () => cityLabelsVisible,
            set: (v) => { cityLabelsVisible = v; }
        },
        'city-spheres': {
            get: () => citySpheresVisible,
            set: (v) => {
                citySpheresVisible = v;
                if (cityInstancedMesh) cityInstancedMesh.visible = v;
            }
        },
        'constellations': {
            get: () => constellationLinesVisible,
            set: (v) => {
                constellationLinesVisible = v;
                if (constellationLinesMesh) constellationLinesMesh.visible = v;
            }
        },
        'star-labels': {
            get: () => starLabelsEnabled,
            set: (v) => { starLabelsEnabled = v; }
        },
        'planet-labels': {
            get: () => planetLabelsEnabled,
            set: (v) => { planetLabelsEnabled = v; }
        },
        'ghost-view': {
            get: () => ghostViewEnabled,
            set: (v) => {
                ghostViewEnabled = v;
                updateGhostVisibility();
            }
        },
        'celestial-trails': {
            get: () => celestialTrailsEnabled,
            set: (v) => { celestialTrailsEnabled = v; }
        }
    };

    // Attach click handlers to all pill toggles
    document.querySelectorAll('.pill-toggle[data-toggle]').forEach(pill => {
        pill.addEventListener('click', () => {
            const key = pill.dataset.toggle;
            const action = pillToggleActions[key];
            if (!action) return;
            const newVal = !action.get();
            action.set(newVal);
            pill.classList.toggle('active', newVal);
            updateCategoryButtonStates();
        });
    });

    // Update category button active state based on child toggles
    function updateCategoryButtonStates() {
        const earthBtn = document.getElementById('category-earth');
        const skyBtn = document.getElementById('category-sky');
        if (earthBtn) {
            const anyEarthOn = imageryEnabled || elevationEnabled || coastlinesVisible || waterLinesVisible || cityLabelsVisible || citySpheresVisible;
            earthBtn.classList.toggle('active', anyEarthOn);
        }
        if (skyBtn) {
            const anySkyOn = constellationLinesVisible || starLabelsEnabled || planetLabelsEnabled || ghostViewEnabled || celestialTrailsEnabled;
            skyBtn.classList.toggle('active', anySkyOn);
        }
    }

    // ==================== APPEARANCE PANEL HANDLERS ====================
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
            earthFillMaterial.depthWrite = opacity >= 1.0;
        }
        if (mapMaterial) {
            const baseLandBackOpacity = 0.6;
            mapMaterial.uniforms.landBackOpacity.value = baseLandBackOpacity * (1 - opacity);
        }
    });

    // Sun light color
    document.getElementById('sun-light-color')?.addEventListener('input', (e) => {
        if (sunLight) sunLight.color.set(e.target.value);
    });

    // Day cities color
    document.getElementById('sun-beam-color')?.addEventListener('input', (e) => {
        sunCityColor = e.target.value;
    });

    // Night cities color
    document.getElementById('moon-beam-color')?.addEventListener('input', (e) => {
        moonCityColor = e.target.value;
    });

    // Map lines color
    document.getElementById('map-lines-color')?.addEventListener('input', (e) => {
        const color = new THREE.Color(e.target.value);
        [coastlineMesh, lakesMesh, riversMesh].forEach(m => {
            if (m && m.material.uniforms) {
                m.material.uniforms.lineColor.value.set(color.r, color.g, color.b, m.material.uniforms.lineColor.value.w);
            }
        });
    });

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
let sliderThumbElement = null;
let sliderBridgeElement = null;

const DEFAULT_FOV = 75;
const MIN_FOV = 15;  // Zoomed in

function setThumbY(y) {
    if (!sliderThumbElement) return;
    sliderThumbElement.style.top = Math.round(y) + 'px';
}

function getCurrentThumbY() {
    if (!sliderThumbElement) return SLIDER_TOTAL_HEIGHT;
    return parseFloat(sliderThumbElement.style.top) || SLIDER_TOTAL_HEIGHT;
}

function updateZoomSlider() {
    if (!sliderThumbElement) return;

    if (isViewTransitioning) {
        const bridgeProgress = horizonBlendValue;
        const bridgeY = SLIDER_SKY_HEIGHT + SLIDER_BRIDGE_HEIGHT * (1 - bridgeProgress);
        setThumbY(bridgeY);
        updateSliderReadout();
        return;
    }

    if (isHorizonMode) {
        // Position on sky track based on FOV
        const fovRange = DEFAULT_FOV - MIN_FOV;
        const currentFov = camera ? camera.fov : DEFAULT_FOV;
        const t = (currentFov - MIN_FOV) / fovRange; // 0 = MIN_FOV (top), 1 = DEFAULT_FOV (bottom)
        setThumbY(t * SLIDER_SKY_HEIGHT);
    } else {
        // Position on orbital track based on radius (log-scale)
        const orbitalTop = SLIDER_SKY_HEIGHT + SLIDER_BRIDGE_HEIGHT;
        const t = Math.log(Math.max(cameraRadius, TRANSITION_RADIUS) / TRANSITION_RADIUS) / ORBITAL_LOG_RATIO;
        setThumbY(orbitalTop + Math.max(0, Math.min(1, t)) * SLIDER_ORBITAL_HEIGHT);
    }
    updateSliderReadout();
}

function updateSliderReadout() {
    const el = document.getElementById('slider-readout');
    if (!el) return;

    if (isViewTransitioning) {
        el.textContent = '';
        return;
    }

    if (isHorizonMode) {
        const fov = camera ? camera.fov : DEFAULT_FOV;
        const mag = DEFAULT_FOV / fov;
        el.textContent = mag > 1.05 ? `${mag.toFixed(1)}x` : '';
    } else {
        const altKm = (cameraRadius - EARTH_RADIUS) * (EARTH_RADIUS_KM / EARTH_RADIUS);
        if (altKm >= 10000) {
            el.textContent = `${(altKm / 1000).toFixed(0)}k km`;
        } else if (altKm >= 1000) {
            el.textContent = `${(altKm / 1000).toFixed(1)}k km`;
        } else {
            el.textContent = `${Math.round(altKm)} km`;
        }
    }
}

function createTrackMarkers() {
    const orbitalTrack = document.getElementById('slider-orbital-track');
    const skyTrack = document.getElementById('slider-sky-track');
    if (!orbitalTrack || !skyTrack) return;

    // Orbital track: altitude ticks (km) - log-spaced
    const orbitalTicks = [
        { alt: 1000, label: '1k' },
        { alt: 2000, label: '2k' },
        { alt: 5000, label: '5k' },
        { alt: 10000, label: '10k' },
        { alt: 20000, label: '20k' },
    ];
    orbitalTicks.forEach(tick => {
        const radius = EARTH_RADIUS + tick.alt * (EARTH_RADIUS / EARTH_RADIUS_KM);
        const t = Math.log(radius / TRANSITION_RADIUS) / ORBITAL_LOG_RATIO;
        if (t < 0.02 || t > 0.98) return;
        const el = document.createElement('div');
        el.className = 'track-marker';
        el.textContent = tick.label;
        el.style.top = (t * 100) + '%';
        orbitalTrack.appendChild(el);
    });

    // Sky track: magnification ticks
    const fovRange = DEFAULT_FOV - MIN_FOV;
    const skyTicks = [2, 3, 4, 5];
    skyTicks.forEach(mag => {
        const fov = DEFAULT_FOV / mag;
        if (fov < MIN_FOV || fov > DEFAULT_FOV) return;
        const t = (fov - MIN_FOV) / fovRange; // 0 = top (min FOV / max zoom), 1 = bottom (default FOV)
        if (t < 0.02 || t > 0.98) return;
        const el = document.createElement('div');
        el.className = 'track-marker sky-marker';
        el.textContent = mag + 'x';
        el.style.top = (t * 100) + '%';
        skyTrack.appendChild(el);
    });
}

// Instantly enter horizon mode (for cross-segment clicks/jumps)
function instantEnterHorizon() {
    if (focusLocked) {
        cameraRefLat = focusPointLat - dragOffsetLat;
        cameraRefLon = focusPointLon - dragOffsetLon;
    }
    const target = getHorizonEntryTarget();
    horizonYaw = target.yaw;
    horizonPitch = 0;
    isHorizonMode = true;
    horizonBlendValue = 1;
    cameraRadius = CAMERA_MIN_RADIUS;
    updateViewZoomButton();
    updateBridgeState();
}

// Instantly exit horizon mode (for cross-segment clicks/jumps)
function instantExitHorizon() {
    isHorizonMode = false;
    horizonBlendValue = 0;
    if (camera.fov !== DEFAULT_FOV) {
        camera.fov = DEFAULT_FOV;
        camera.updateProjectionMatrix();
    }
    updateViewZoomButton();
    updateBridgeState();
}

// Update bridge color/class based on current mode (labels styled via CSS)
function updateBridgeState() {
    if (!sliderBridgeElement) return;
    if (isHorizonMode) {
        sliderBridgeElement.classList.remove('orbital');
        sliderBridgeElement.classList.add('horizon');
    } else {
        sliderBridgeElement.classList.remove('horizon');
        sliderBridgeElement.classList.add('orbital');
    }
}

// Apply zoom state from a thumb Y position within a segment
function applyThumbPosition(y) {
    const orbitalTop = SLIDER_SKY_HEIGHT + SLIDER_BRIDGE_HEIGHT;

    if (y <= SLIDER_SKY_HEIGHT) {
        // Sky segment: map y to FOV
        const t = Math.max(0, y) / SLIDER_SKY_HEIGHT; // 0 (top/zoomed in) to 1 (bottom/default)
        camera.fov = MIN_FOV + t * (DEFAULT_FOV - MIN_FOV);
        camera.updateProjectionMatrix();
        cameraRadius = CAMERA_MIN_RADIUS;

        // Ensure horizon mode is active
        if (!isHorizonMode) {
            instantEnterHorizon();
        }

        // When near bottom of sky track (entering sky view), trigger look-up animation
        if (camera.fov >= DEFAULT_FOV - 1) {
            const target = getHorizonEntryTarget();
            pendingHorizonAnimation = true;
            pendingTargetYaw = target.yaw;
            pendingTargetPitch = target.pitch;
        }

    } else if (y >= orbitalTop) {
        // Orbital segment: map y to cameraRadius
        const segY = Math.min(y - orbitalTop, SLIDER_ORBITAL_HEIGHT);
        const t = segY / SLIDER_ORBITAL_HEIGHT; // 0 (top/close) to 1 (bottom/far)
        // Log-scale: t=0 → TRANSITION_RADIUS, t=1 → ORBITAL_MAX_RADIUS
        cameraRadius = TRANSITION_RADIUS * Math.pow(ORBITAL_MAX_RADIUS / TRANSITION_RADIUS, t);

        if (camera.fov !== DEFAULT_FOV) {
            camera.fov = DEFAULT_FOV;
            camera.updateProjectionMatrix();
        }

        // Ensure orbital mode
        if (isHorizonMode) {
            instantExitHorizon();
        }

        // Track active zooming in for pointer alignment
        if (cameraRadius > TRANSITION_RADIUS) {
            isZoomingIn = true;
            clearTimeout(zoomingInTimeout);
            zoomingInTimeout = setTimeout(() => { isZoomingIn = false; }, 150);
        }
    }
    // Bridge zone: no user input — only animated during transitions

    setThumbY(y);
    updateSliderReadout();
}

// Clamp thumb Y to valid drag range within current segment, triggers transition at boundary.
// Requires dragging PAST the edge by a buffer to prevent accidental triggers when grabbing near edge.
const BRIDGE_TRIGGER_BUFFER = 8; // px past boundary before transition fires

function clampThumbY(y) {
    const orbitalTop = SLIDER_SKY_HEIGHT + SLIDER_BRIDGE_HEIGHT;

    if (isHorizonMode) {
        // In horizon/sky mode: clamp to sky track
        if (y >= SLIDER_SKY_HEIGHT) {
            // Only trigger after dragging well past the edge
            if (y >= SLIDER_SKY_HEIGHT + BRIDGE_TRIGGER_BUFFER) {
                if (camera.fov !== DEFAULT_FOV) {
                    camera.fov = DEFAULT_FOV;
                    camera.updateProjectionMatrix();
                }
                startViewTransition(-1);
            }
            return SLIDER_SKY_HEIGHT; // park at edge
        }
        return Math.max(0, y);
    } else {
        // In orbital mode: clamp to orbital track
        if (y <= orbitalTop) {
            // Only trigger after dragging well past the edge
            if (y <= orbitalTop - BRIDGE_TRIGGER_BUFFER) {
                cameraRadius = TRANSITION_RADIUS;
                startViewTransition(1);
            }
            return orbitalTop; // park at edge
        }
        return Math.min(SLIDER_TOTAL_HEIGHT, y);
    }
}

// Handle click on a track segment (jump to position)
function onTrackClick(e, segment) {
    if (isViewTransitioning) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const localY = e.clientY - rect.top;

    if (segment === 'sky') {
        const y = Math.max(0, Math.min(SLIDER_SKY_HEIGHT, localY));
        if (!isHorizonMode) {
            instantEnterHorizon();
        }
        applyThumbPosition(y);
    } else {
        const y = SLIDER_SKY_HEIGHT + SLIDER_BRIDGE_HEIGHT + Math.max(0, Math.min(SLIDER_ORBITAL_HEIGHT, localY));
        if (isHorizonMode) {
            instantExitHorizon();
        }
        applyThumbPosition(y);
    }
}

function setupZoomSlider() {
    const slider = document.getElementById('custom-zoom-slider');
    const thumb = document.getElementById('slider-thumb');
    const skyTrack = document.getElementById('slider-sky-track');
    const bridge = document.getElementById('slider-bridge');
    const orbitalTrack = document.getElementById('slider-orbital-track');
    if (!slider || !thumb) return;

    // Cache element refs globally
    sliderThumbElement = thumb;
    sliderBridgeElement = bridge;

    let isSliderDragging = false;
    let sliderDragStartY = 0;
    let thumbStartY = 0;

    // --- Thumb drag ---
    function onDragStart(e) {
        if (isViewTransitioning) return;
        isSliderDragging = true;
        thumb.classList.add('active');
        sliderDragStartY = (e.touches ? e.touches[0].clientY : e.clientY);
        thumbStartY = getCurrentThumbY();
        e.preventDefault();
        e.stopPropagation();
    }

    function onDragMove(e) {
        if (!isSliderDragging) return;
        if (isViewTransitioning) {
            isSliderDragging = false;
            thumb.classList.remove('active');
            return;
        }
        const clientY = (e.touches ? e.touches[0].clientY : e.clientY);
        const deltaY = clientY - sliderDragStartY;
        const newY = clampThumbY(thumbStartY + deltaY);
        applyThumbPosition(newY);
    }

    function onDragEnd() {
        if (!isSliderDragging) return;
        isSliderDragging = false;
        thumb.classList.remove('active');
    }

    // Attach thumb drag events
    thumb.addEventListener('mousedown', onDragStart);
    thumb.addEventListener('touchstart', onDragStart, { passive: false });
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('mouseup', onDragEnd);
    document.addEventListener('touchend', onDragEnd);

    // --- Track click (jump to position) ---
    skyTrack.addEventListener('click', (e) => onTrackClick(e, 'sky'));
    orbitalTrack.addEventListener('click', (e) => onTrackClick(e, 'orbital'));

    // --- Bridge click (trigger transition) ---
    bridge.addEventListener('click', () => {
        if (isViewTransitioning || performance.now() < transitionCooldownUntil) return;
        if (isHorizonMode) {
            if (camera.fov !== DEFAULT_FOV) {
                camera.fov = DEFAULT_FOV;
                camera.updateProjectionMatrix();
            }
            startViewTransition(-1); // liftoff
        } else {
            cameraRadius = TRANSITION_RADIUS;
            startViewTransition(1);  // fall
        }
    });

    // Prevent context menu on slider
    slider.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    // Initialize bridge state, markers, and thumb position
    updateBridgeState();
    createTrackMarkers();
    updateZoomSlider();
}

// Update zoom slider thumb color based on pinned mode
function updateZoomSliderMode() {
    if (!sliderThumbElement) return;
    if (focusLocked) {
        sliderThumbElement.classList.remove('unpinned');
    } else {
        sliderThumbElement.classList.add('unpinned');
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
function getPlanetRADec(date, planetId) {
    if (!sweInitialized || !swe) return null;
    const jd = dateToJulianDay(date);
    const flags = swe.SEFLG_SWIEPH | 2048; // SEFLG_EQUATORIAL
    const result = swe.calc_ut(jd, planetId, flags);
    // result[0] = RA in degrees, result[1] = Dec in degrees
    return { ra: result[0], dec: result[1] };
}

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
function latLonToDirection(lat, lon, out) {
    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;
    const x = Math.cos(latRad) * Math.cos(lonRad);
    const y = Math.cos(latRad) * Math.sin(lonRad);
    const z = Math.sin(latRad);
    if (out) return out.set(x, y, z);
    return new THREE.Vector3(x, y, z);
}

/**
 * Convert Right Ascension (hours) and Declination (degrees) to 3D position
 */
function raDecToPosition(raHours, decDeg, distance, out) {
    const ra = raHours * 15 * Math.PI / 180;  // Convert hours to degrees to radians
    const dec = decDeg * Math.PI / 180;
    const x = distance * Math.cos(dec) * Math.cos(ra);
    const y = distance * Math.cos(dec) * Math.sin(ra);
    const z = distance * Math.sin(dec);
    if (out) return out.set(x, y, z);
    return new THREE.Vector3(x, y, z);
}


// Default fallback location: 45°N, 0°E (near Bordeaux, France)
let userLat = 45;
let userLon = 0;

// === ZOOM CONFIGURATION (tweak these to adjust transition behavior) ===
const KM_TO_SCENE = EARTH_RADIUS / EARTH_RADIUS_KM;
const TRANSITION_ALT_KM = 50;                                      // Transition altitude in real km (orbital mode ends here; was 100/Kármán)
const TRANSITION_RADIUS = EARTH_RADIUS + TRANSITION_ALT_KM * KM_TO_SCENE; // Where orbital↔horizon cinematic triggers
const ORBITAL_ZOOM_STEP = 1.15;                                    // Wheel zoom: altitude multiplier per tick (proportional — gentle near the planet, fast far out)
const ORBITAL_MAX_RADIUS = EARTH_RADIUS * 6;                      // Farthest orbital zoom
const CAMERA_MIN_RADIUS = EARTH_RADIUS + 4;                       // Near-surface (horizon mode)
const HORIZON_CAMERA_HEIGHT = EARTH_RADIUS + 1;                    // Horizon camera: ~1.1 km up, ~750 m above the imagery ground plane
const GROUND_UI_RAISE = 0.35;                                      // Ground compass height: just above the imagery rings (0.3)
const GROUND_COMPASS_DEPRESSION_DEG = 22;                          // Compass ring sits this far below level from the standing eye (bigger = smaller ring)

// Camera orbit state
let cameraRefLat, cameraRefLon;
let cameraRadius = EARTH_RADIUS + 5000;
let isHorizonMode = false;
let horizonBlendValue = 0;
const VIEW_SNAP_SPEED = 8;

// Cinematic view transition state
let isViewTransitioning = false;
let viewTransitionProgress = 0;
let viewTransitionDirection = 0;
let transitionStartRadius = 0;
const FALL_DURATION = 1.0;
const LIFTOFF_DURATION = 0.7;

// Custom 3-segment slider layout
const SLIDER_SKY_HEIGHT = 70;
const SLIDER_BRIDGE_HEIGHT = 50;
const SLIDER_ORBITAL_HEIGHT = 70;
const SLIDER_TOTAL_HEIGHT = SLIDER_SKY_HEIGHT + SLIDER_BRIDGE_HEIGHT + SLIDER_ORBITAL_HEIGHT;
// Log-scale ratio for orbital track mapping
const ORBITAL_LOG_RATIO = Math.log(ORBITAL_MAX_RADIUS / TRANSITION_RADIUS);
let transitionCooldownUntil = 0;

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
const POINTER_SHRINK_START_ALT = 2000;  // pointer/spot begin shrinking below this altitude (~2100 km)

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

        if (TIMEZONE_COORDS[timezone]) {
            return TIMEZONE_COORDS[timezone];
        }

        // Try to match timezone prefix (e.g., "America/Phoenix" -> "America/Denver")
        const timezonePrefix = timezone.split('/')[0];
        for (const [tz, coords] of Object.entries(TIMEZONE_COORDS)) {
            if (tz.startsWith(timezonePrefix)) {
                return coords;
            }
        }
    } catch (error) {
    }

    return { lat: userLat, lon: userLon };
}

// === URL STATE (shareable links) ===

function parseUrlState() {
    const hash = window.location.hash.slice(1); // remove '#'
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    const state = {};
    if (params.has('lat') && params.has('lon')) {
        const lat = parseFloat(params.get('lat'));
        const lon = parseFloat(params.get('lon'));
        if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
            state.lat = lat;
            state.lon = lon;
        }
    }
    if (params.has('date')) {
        const d = new Date(params.get('date') + 'T00:00:00');
        if (!isNaN(d.getTime())) state.date = d;
    }
    if (params.has('time')) {
        const t = parseInt(params.get('time'));
        if (!isNaN(t) && t >= 0 && t <= 1439) state.time = t;
    }
    if (params.has('z')) {
        const z = parseFloat(params.get('z'));
        if (!isNaN(z) && z >= CAMERA_MIN_RADIUS && z <= ORBITAL_MAX_RADIUS) state.z = z;
    }
    if (params.has('m')) {
        const m = params.get('m');
        if (m === 'h' || m === 'o') state.m = m;
    }
    if (params.has('yaw')) {
        const yaw = parseFloat(params.get('yaw'));
        if (!isNaN(yaw)) state.yaw = yaw;
    }
    if (params.has('pitch')) {
        const pitch = parseFloat(params.get('pitch'));
        if (!isNaN(pitch)) state.pitch = pitch;
    }
    return Object.keys(state).length > 0 ? state : null;
}

let lastUrlHash = '';
let urlUpdateTimer = 0;
const URL_UPDATE_INTERVAL = 500; // ms

function updateUrlHash() {
    const params = new URLSearchParams();
    params.set('lat', focusPointLat.toFixed(2));
    params.set('lon', focusPointLon.toFixed(2));
    if (!isLiveMode && selectedDate) {
        const y = selectedDate.getFullYear();
        const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
        const d = String(selectedDate.getDate()).padStart(2, '0');
        params.set('date', `${y}-${m}-${d}`);
        params.set('time', Math.round(timeOffsetMinutes).toString());
    }
    if (isHorizonMode) {
        params.set('m', 'h');
        params.set('yaw', horizonYaw.toFixed(3));
        params.set('pitch', horizonPitch.toFixed(3));
    }
    const newHash = '#' + params.toString();
    if (newHash !== lastUrlHash) {
        lastUrlHash = newHash;
        history.replaceState(null, '', newHash);
    }
}

function throttledUrlUpdate(now) {
    if (isSliderDragging || isDragging || isTouching) return;
    if (now - urlUpdateTimer > URL_UPDATE_INTERVAL) {
        urlUpdateTimer = now;
        updateUrlHash();
    }
}

async function init() {
    // Initialize Swiss Ephemeris for accurate astronomical calculations
    await initSwissEph();

    // Get user location
    const location = await getUserLocation();
    userLat = location.lat;
    userLon = location.lon;

    // Set camera reference to user location
    cameraRefLat = userLat;
    cameraRefLon = userLon;

    // Initialize focus point at user location
    focusPointLat = userLat;
    focusPointLon = userLon;

    // Apply URL state if present (overrides defaults)
    const urlState = parseUrlState();
    if (urlState) {
        if (urlState.lat !== undefined) {
            focusPointLat = urlState.lat;
            focusPointLon = urlState.lon;
            cameraRefLat = urlState.lat;
            cameraRefLon = urlState.lon;
            focusLocked = false;
        }
        // Initialize timezone from pointer location for correct time interpretation
        const closestCity = findClosestCity(focusPointLat, focusPointLon);
        lastPointerTz = getCityTz(closestCity, new Date());
        if (urlState.date) {
            selectedDate = urlState.date;
            timeOffsetMinutes = urlState.time !== undefined ? urlState.time : 720;
            isLiveMode = false;
            isPaused = true;
        } else if (urlState.time !== undefined) {
            selectedDate = new Date();
            timeOffsetMinutes = urlState.time;
            isLiveMode = false;
            isPaused = true;
        }
        if (urlState.z) cameraRadius = urlState.z;
        if (urlState.m === 'h') {
            isHorizonMode = true;
            horizonBlendValue = 1;
            cameraRadius = CAMERA_MIN_RADIUS;
            if (urlState.yaw !== undefined) horizonYaw = urlState.yaw;
            if (urlState.pitch !== undefined) horizonPitch = urlState.pitch;
        }
    }

    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    // Create camera
    camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.05,     // Near plane: ground is <1 unit below the horizon camera (log depth keeps precision)
        10000000  // Far plane for sun at 6M units
    );

    // Create renderer with logarithmic depth buffer for cosmic-scale precision
    renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('container').appendChild(renderer.domElement);

    // Page Visibility API — stop rendering when tab is hidden
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            isTabVisible = false;
        } else {
            isTabVisible = true;
            lastTime = performance.now();
            lastSimulationTime = performance.now();
            // Force renderer to re-engage GPU pipeline after background
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.setSize(window.innerWidth, window.innerHeight);
            // Clear stale perf data from background period
            if (window._pm) {
                window._pm.times.length = 0;
                window._pm.lastFrame = performance.now();
                window._pm.fpsHistory.length = 0;
            }
            animate();
        }
    });

    // Create Earth (wireframe sphere)
    createEarth();

    // Create Moon at accurate distance and scale
    createMoon();

    // Create Sun at fixed visual distance with correct angular size
    createSun();

    // Create eclipse shadow cones (umbra, penumbra, antumbra)
    createEclipseCones();

    // Create ghost celestial sprites, arcs, and horizon glow
    createGhostCelestials();

    // Create celestial trail sprites (24h sun/moon path)
    createCelestialTrails();

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
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
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

    // Sync UI to URL state after all setup is complete
    if (urlState) {
        if (urlState.lat !== undefined) {
            updateFocusLockButton();
            updatePointerColor();
        }
        if (urlState.date || urlState.time !== undefined) {
            const slider = document.getElementById('time-slider');
            if (slider) slider.value = timeOffsetMinutes;
            updateTimeDisplay();
            updateEventMarkers();
            updateDayNavButtons();
        }
    }

    // Start animation loop
    animate();

    // Hide loading overlay once textures are ready and min display time elapsed
    await texturesReadyPromise;
    await hideLoadingOverlay();
}

function createEarth() {
    const earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS, 256, 256);

    // Create material with eclipse darkening via onBeforeCompile
    earthMaterial = new THREE.MeshStandardMaterial({
        roughness: 0.8,
        metalness: 0.0
    });

    // Store custom uniforms for shader injection
    earthMaterial.userData.sunDirection = { value: new THREE.Vector3(1, 0, 0) };
    earthMaterial.userData.moonPosition = { value: new THREE.Vector3(0, 0, 0) };
    earthMaterial.userData.moonRadius = { value: MOON_RADIUS };
    earthMaterial.userData.sunAngularRadius = { value: SUN_ANGULAR_DIAMETER_RAD / 2 };

    // Inject custom shader code for eclipse shadow on Earth surface
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
            // Water mask from the raw texel (before tinting): blue-dominant
            // pixels are ocean/lakes. Drives water-only specular below.
            float waterness = smoothstep(0.02, 0.10, diffuseColor.b - max(diffuseColor.r, diffuseColor.g));

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

            // Civil twilight: soft, near-neutral brightness ramp ~7 deg past the
            // terminator (sunset COLOR lives in the direct light, not painted here)
            float twilightGlow = smoothstep(-0.12, 0.0, sunDot) * (1.0 - dayFactor);
            diffuseColor.rgb *= 1.0 + twilightGlow * vec3(0.50, 0.44, 0.36);
            `
        );

        // Water-only specular: land is matte at every scale; ocean sun glint is
        // real (satellites see it). waterness computed in map_fragment above.
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
            roughnessFactor = mix(1.0, 0.45, waterness);
            `
        );

        // Ocean glint: roll off the specular peak (Reinhard) instead of hard-
        // clipping to a flat white disc — a soft bright glow like real sun
        // glitter seen from orbit. Only specular is compressed.
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <aomap_fragment>',
            `#include <aomap_fragment>
            reflectedLight.directSpecular /= (vec3(1.0) + reflectedLight.directSpecular);
            `
        );

        // Earth's own shadow: direct sun gates off just past local sunset
        // (small negative margin = brief alpenglow). No sunset color games —
        // an honest light tint is invisible at grazing angles, and a visible
        // one has to be faked.
        shader.fragmentShader = shader.fragmentShader
            .split('RE_Direct( directLight, geometry, material, reflectedLight );')
            .join(`{
                float gSunDot = dot(normalize(vWorldPosition), normalize(sunDirection));
                directLight.color *= smoothstep(-0.035, 0.01, gSunDot);
                RE_Direct( directLight, geometry, material, reflectedLight );
            }`);

        // Store shader reference for uniform updates
        earthMaterial.userData.shader = shader;
    };

    const earthSphere = new THREE.Mesh(earthGeometry, earthMaterial);
    earthSphere.rotation.x = Math.PI / 2;  // Fix for +Z up coordinate system
    earthSphere.castShadow = true;
    earthSphere.receiveShadow = true;
    scene.add(earthSphere);

    // Load Earth surface texture
    const loader = new THREE.TextureLoader();
    const earthTexturePromise = new Promise((resolve) => {
        // Global base: Sentinel-2 cloudless 2025 (EOX, CC-BY-NC-SA), baked
        // from z7 tiles supersampled to 16200x8100 (~2.5 km/px) — same vintage
        // as the HD ring tiles, so colors match exactly. (2018 layer rejected:
        // orbit-swath striping over the Amazon.) natural-earth-no-ice-clouds
        // .jpeg kept on disk as the revert option.
        loader.load('s2cloudless-2025-16k.jpg', (texture) => {
            // Anisotropic filtering: keeps ground texture sharp at grazing angles (horizon mode)
            texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
            // Repeat wrap: seamless sampling for anything reading unwrapped longitudes
            texture.wrapS = THREE.RepeatWrapping;
            earthMaterial.map = texture;
            earthMaterial.color = new THREE.Color(0xBDCCDB);
            earthMaterial.needsUpdate = true;
            resolve();
        }, undefined, (err) => {
            console.error('Failed to load Earth texture:', err);
            resolve(); // resolve anyway so overlay still hides
        });
    });

    // Load elevation/displacement map
    const elevTexturePromise = new Promise((resolve) => {
        loader.load('earth-elevation.jpg', (texture) => {
            earthMaterial.displacementMap = texture;
            earthMaterial.displacementScale = 5;  // Exaggerated for visibility (real would be ~8 units)
            earthMaterial.needsUpdate = true;
            resolve();
        }, undefined, (err) => {
            console.error('Failed to load elevation map:', err);
            resolve(); // resolve anyway so overlay still hides
        });
    });

    texturesReadyPromise = Promise.all([earthTexturePromise, elevTexturePromise]);

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

    // Create vector coastline overlays (110m + 50m LOD)
    createCoastlines();
}

/**
 * Build THREE.LineSegments from coastline coordinate data.
 * Interpolates long segments to follow sphere curvature.
 */
function buildCoastlineMesh(coastlineData, radius, color, opacity) {
    const positions = [];
    const MAX_SEG_DEG = 2; // Subdivide segments longer than 2 degrees

    for (const polyline of coastlineData) {
        for (let i = 0; i < polyline.length - 1; i++) {
            const [lng1, lat1] = polyline[i];
            const [lng2, lat2] = polyline[i + 1];

            // Calculate angular distance for subdivision
            const dLng = Math.abs(lng2 - lng1);
            const dLat = Math.abs(lat2 - lat1);
            const approxDeg = Math.max(dLng, dLat);

            // Skip antimeridian-crossing segments (>90° longitude jump)
            if (dLng > 90) continue;

            const steps = Math.max(1, Math.ceil(approxDeg / MAX_SEG_DEG));

            for (let s = 0; s < steps; s++) {
                const t1 = s / steps;
                const t2 = (s + 1) / steps;

                const iLng1 = lng1 + (lng2 - lng1) * t1;
                const iLat1 = lat1 + (lat2 - lat1) * t1;
                const iLng2 = lng1 + (lng2 - lng1) * t2;
                const iLat2 = lat1 + (lat2 - lat1) * t2;

                const latR1 = iLat1 * Math.PI / 180;
                const lngR1 = iLng1 * Math.PI / 180;
                const latR2 = iLat2 * Math.PI / 180;
                const lngR2 = iLng2 * Math.PI / 180;

                positions.push(
                    radius * Math.cos(latR1) * Math.cos(lngR1),
                    radius * Math.cos(latR1) * Math.sin(lngR1),
                    radius * Math.sin(latR1),
                    radius * Math.cos(latR2) * Math.cos(lngR2),
                    radius * Math.cos(latR2) * Math.sin(lngR2),
                    radius * Math.sin(latR2)
                );
            }
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    // ShaderMaterial with back-face discard: depthTest off so terrain can't hide lines,
    // but fragments on the far side of Earth are discarded so lines don't show through.
    const col = new THREE.Color(color);
    const material = new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
            lineColor: { value: new THREE.Vector4(col.r, col.g, col.b, opacity) },
            fade: { value: 1.0 }   // driven by updateImagery: lines dissolve as HD rings arrive
        },
        vertexShader: `
            varying vec3 vWorldPosition;
            #include <common>
            #include <logdepthbuf_pars_vertex>
            void main() {
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPos.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPos;
                #include <logdepthbuf_vertex>
            }
        `,
        fragmentShader: `
            uniform vec4 lineColor;
            uniform float fade;
            varying vec3 vWorldPosition;
            #include <common>
            #include <logdepthbuf_pars_fragment>
            void main() {
                // Discard fragments on the far side of Earth
                vec3 surfaceNormal = normalize(vWorldPosition);
                vec3 toCamera = normalize(cameraPosition - vWorldPosition);
                if (dot(surfaceNormal, toCamera) < 0.0) discard;
                gl_FragColor = vec4(lineColor.rgb, lineColor.a * fade);
                #include <logdepthbuf_fragment>
            }
        `
    });

    return new THREE.LineSegments(geometry, material);
}

function createCoastlines() {
    const GEO_RADIUS = EARTH_RADIUS; // Barely above surface — back-face shader handles visibility

    coastlineMesh = buildCoastlineMesh(COASTLINE_10M, GEO_RADIUS, 0x7a8590, 0.4);
    lakesMesh = buildCoastlineMesh(LAKES_10M, GEO_RADIUS, 0x7a8590, 0.3);
    riversMesh = buildCoastlineMesh(RIVERS_10M, GEO_RADIUS, 0x7a8590, 0.2);

    scene.add(coastlineMesh);
    scene.add(lakesMesh);
    scene.add(riversMesh);
}

// ==================== HD IMAGERY (horizon mode) ====================
// High-resolution satellite imagery streamed as Web Mercator tiles from
// EOX "Sentinel-2 cloudless" (https://s2maps.eu — free for non-commercial
// use, attribution required; see #imagery-attribution in index.html).
// Concentric clipmap rings centered on the focus point: each ring is a
// 4x4-tile square at one zoom level with a hole where the next finer ring
// sits — sharpest imagery underfoot, halving each ring outward, outermost
// ring past the horizon. All rings share one radius (no overlap, so no
// z-fighting); unloaded areas alpha-discard so the globe texture shows
// through until tiles arrive. Same z/x/y tiling scheme as AWS terrain
// tiles, so real elevation can later be added to these exact rings.

const IMAGERY_URL = (z, y, x) =>
    `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/${z}/${y}/${x}.jpg`;
const IMAGERY_ZOOM_MAX = 14;       // innermost ring (~10 m/px — native Sentinel-2 resolution)
const IMAGERY_ZOOM_MIN = 6;        // outermost ring (~±1000 km: covers the view in low-orbital preview)
const IMAGERY_ORBITAL_SHOW = EARTH_RADIUS + 600 * KM_TO_SCENE;   // rings visible in orbital below 600 km altitude
const IMAGERY_ORBITAL_FADE = EARTH_RADIUS + 1200 * KM_TO_SCENE;  // fake displacement melts between 1200 and 600 km on approach
const IMAGERY_ORBITAL_MAX_ZOOM = 11;  // ceiling of the altitude-matched display cap in orbital preview
const IMAGERY_RING_TILES = 4;      // tiles per ring side (4x4)
const IMAGERY_SUBDIV = 8;          // mesh cells per tile side (follows sphere curvature)
const IMAGERY_LIFT = 0.3;          // scene units above sphere (log depth resolves this)
const IMAGERY_CANVAS_PX = IMAGERY_RING_TILES * 256;
const IMAGERY_CACHE_MAX = 240;     // decoded 256px tiles (~63MB)
const IMAGERY_REBUILD_FRAC = 0.6;  // recenter when pointer strays this many finest-zoom tiles
const IMAGERY_FETCH_MAX = 16;      // concurrent tile fetches — a full 128-tile burst trips server rate limits
const IMAGERY_FETCH_TIMEOUT = 15000; // abort hung fetches (they'd otherwise stay 'pending' forever)
const IMAGERY_RETRY_MS = 15000;    // failed tiles become eligible to refetch after this
const IMAGERY_PREFETCH_RADIUS = EARTH_RADIUS + 3000;  // warm the tile cache when the orbital camera is this low
const IMAGERY_PREFETCH_MAX_ZOOM = 10; // prefetch only coarse rings — fine-ring windows churn while panning
// 4x4 slot traversal order, center-first: the tiles under the pointer are
// requested before the edges (the fetch queue preserves request order)
const IMAGERY_SLOT_ORDER = (() => {
    const c = (IMAGERY_RING_TILES - 1) / 2;
    const slots = [];
    for (let dy = 0; dy < IMAGERY_RING_TILES; dy++) {
        for (let dx = 0; dx < IMAGERY_RING_TILES; dx++) {
            slots.push({ dx, dy, d: (dx - c) * (dx - c) + (dy - c) * (dy - c) });
        }
    }
    slots.sort((a, b) => a.d - b.d);
    return slots;
})();

let imageryEnabled = true;
let imageryRings = null;           // built lazily; finest (highest zoom) ring first
let imageryCenterLat = null;       // center of the current ring layout
let imageryCenterLon = null;
let imageryWasActive = false;
let imageryMaxVisibleZoom = IMAGERY_ZOOM_MAX;  // display cap (z11 in orbital preview, all in horizon)
let imageryFetchActive = 0;        // in-flight fetches; the rest wait in the queue
let imageryLastSweep = 0;          // last missing-tile retry sweep (ms)
let imageryQueueDirty = false;     // queue needs a purge + priority re-sort before draining
let imageryPrefetchSampleMs = 0;   // pointer settle detection for orbital prefetch
let imageryPrefetchSampleLat = 0;
let imageryPrefetchSampleLon = 0;
const imageryFetchQueue = [];      // priority queue: highest score fetched first
const imageryTileCache = new Map(); // "z/x/y" -> ImageBitmap | 'pending' | {errorAt}

function lonToTileX(lon, z) {
    return (lon + 180) / 360 * (1 << z);
}

function latToTileY(lat, z) {
    const rad = THREE.MathUtils.degToRad(Math.max(-85.05, Math.min(85.05, lat)));
    return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * (1 << z);
}

function tileXToLon(x, z) {
    return x / (1 << z) * 360 - 180;
}

function tileYToLat(y, z) {
    const n = Math.PI * (1 - 2 * y / (1 << z));
    return THREE.MathUtils.radToDeg(Math.atan(Math.sinh(n)));
}

/**
 * Queue one imagery tile for download. A small concurrency cap keeps the
 * initial ~128-tile burst from tripping server rate limits; failures are
 * remembered briefly and the periodic sweep in updateImagery retries them.
 */
function requestImageryTile(z, x, y, key) {
    const cached = imageryTileCache.get(key);
    if (cached === 'pending') return;
    if (cached && cached.width) return;  // already decoded
    if (cached && cached.errorAt !== undefined &&
        performance.now() - cached.errorAt < IMAGERY_RETRY_MS) return;

    imageryTileCache.set(key, 'pending');
    imageryFetchQueue.push({ z, x, y, key, score: 0 });  // scored at drain time
    imageryQueueDirty = true;
    // Defer the drain one microtask: a rebuild enqueues up to 128 tiles
    // synchronously, and the sort must see the whole batch before dispatching
    queueMicrotask(drainImageryFetchQueue);
}

/** Is this tile inside its zoom ring's current 4x4 window? (x wrap-aware) */
function tileInRingWindow(ring, x, y) {
    if (ring.ox === null) return false;
    if (y < ring.oy || y >= ring.oy + IMAGERY_RING_TILES) return false;
    const n = 1 << ring.zoom;
    let dxw = x - (((ring.ox % n) + n) % n);
    if (dxw < 0) dxw += n;
    return dxw < IMAGERY_RING_TILES;
}

function drainImageryFetchQueue() {
    if (imageryQueueDirty && imageryFetchQueue.length > 0) {
        // Purge tiles whose ring window has moved away since they were queued
        // (the pointer traveled) — un-mark them so a later redraw can re-request
        // — and score survivors by apparent angular size from the CURRENT focus
        // point: the tiles you're standing in first, then outward toward the
        // horizon. All zoom levels compete in one queue (no ring-by-ring FIFO).
        const px = lonToTileX(focusPointLon, IMAGERY_ZOOM_MAX);
        const py = latToTileY(focusPointLat, IMAGERY_ZOOM_MAX);
        const nf = 1 << IMAGERY_ZOOM_MAX;
        let w = 0;
        for (const t of imageryFetchQueue) {
            const ring = imageryRings ? imageryRings[IMAGERY_ZOOM_MAX - t.z] : null;
            if (!ring || !tileInRingWindow(ring, t.x, t.y)) {
                if (imageryTileCache.get(t.key) === 'pending') imageryTileCache.delete(t.key);
                continue;
            }
            const scale = 1 << (IMAGERY_ZOOM_MAX - t.z);   // tile size in finest-tile units
            let ddx = (t.x + 0.5) * scale - px;
            ddx -= Math.round(ddx / nf) * nf;              // shortest way around the antimeridian
            const ddy = (t.y + 0.5) * scale - py;
            t.score = scale / (Math.sqrt(ddx * ddx + ddy * ddy) + scale);
            imageryFetchQueue[w++] = t;
        }
        imageryFetchQueue.length = w;
        // Highest priority first; coarse zoom wins ties (a tile you're inside
        // covers the whole screen and feeds the placeholder ancestors)
        imageryFetchQueue.sort((a, b) => (b.score - a.score) || (a.z - b.z));
    }
    imageryQueueDirty = false;
    while (imageryFetchActive < IMAGERY_FETCH_MAX && imageryFetchQueue.length > 0) {
        fetchImageryTile(imageryFetchQueue.shift());
    }
}

function fetchImageryTile(t) {
    imageryFetchActive++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), IMAGERY_FETCH_TIMEOUT);
    fetch(IMAGERY_URL(t.z, t.y, t.x), { signal: ctrl.signal })
        .then(r => { if (!r.ok) throw new Error('tile ' + r.status); return r.blob(); })
        .then(blob => createImageBitmap(blob))
        .then(bmp => {
            imageryTileCache.delete(t.key);      // re-insert at the end (freshest)
            imageryTileCache.set(t.key, bmp);
            // FIFO eviction of decoded/errored entries (skip in-flight fetches)
            while (imageryTileCache.size > IMAGERY_CACHE_MAX) {
                let evicted = false;
                for (const [k, v] of imageryTileCache) {
                    if (v === 'pending') continue;
                    imageryTileCache.delete(k);
                    if (v && v.close) v.close();
                    evicted = true;
                    break;
                }
                if (!evicted) break;
            }
            drawTileIntoRings(t.z, t.x, t.y, bmp);
        })
        .catch(() => imageryTileCache.set(t.key, { errorAt: performance.now() }))
        .finally(() => {
            clearTimeout(timer);
            imageryFetchActive--;
            drainImageryFetchQueue();
        });
}

/** Paint an arrived tile into the matching-zoom ring, if it's still in view. */
function drawTileIntoRings(z, x, y, bmp) {
    if (!imageryRings) return;
    const n = 1 << z;
    for (const ring of imageryRings) {
        if (ring.zoom !== z) continue;
        for (let dy = 0; dy < IMAGERY_RING_TILES; dy++) {
            if (ring.oy + dy !== y) continue;
            for (let dx = 0; dx < IMAGERY_RING_TILES; dx++) {
                const tx = (((ring.ox + dx) % n) + n) % n;
                if (tx !== x) continue;
                ring.ctx.drawImage(bmp, dx * 256, dy * 256);
                ring.dirtyTex = true;
                ring.missing = Math.max(0, ring.missing - 1);
            }
        }
    }
}

// -------------------- Real elevation (terrarium tiles) --------------------
// AWS Terrain Tiles (open data, no key): same Web Mercator z/x/y scheme as
// the imagery. Each ring samples heights at (ring.zoom - 2), so one 256px
// elevation tile spans a 4x4 block of imagery tiles — a ring needs at most 4.

const ELEVATION_URL = (z, x, y) =>
    `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const ELEVATION_ZOOM_DELTA = 2;
const ELEVATION_CACHE_MAX = 96;       // Float32 tiles (256KB each, ~25MB)
const ELEVATION_EXAGGERATION = 1.0;   // true vertical scale
const ELEVATION_MORPH_START = 0.7;    // outer band blends to coarser data (ring seam matching)
const METERS_PER_SCENE_UNIT = EARTH_RADIUS_KM * 1000 / EARTH_RADIUS;  // ~1061.8

let elevationEnabled = true;
let elevationCamLift = 0;             // smoothed terrain height under the camera (scene units)
let elevationDecodeCanvas = null;
const elevationTileCache = new Map(); // "z/x/y" -> Float32Array(65536) meters | 'pending' | {errorAt}

/**
 * Fetch + decode one terrarium tile. These PNGs are DATA: color management
 * must stay disabled or the red channel shifts, and 1 unit of red = 256 m.
 */
function fetchElevationTile(ze, x, y) {
    const n = 1 << ze;
    x = ((x % n) + n) % n;
    if (y < 0 || y >= n) return;
    const key = ze + '/' + x + '/' + y;
    const cached = elevationTileCache.get(key);
    if (cached instanceof Float32Array || cached === 'pending') return;
    if (cached && cached.errorAt !== undefined &&
        performance.now() - cached.errorAt < IMAGERY_RETRY_MS) return;

    elevationTileCache.set(key, 'pending');
    fetch(ELEVATION_URL(ze, x, y))
        .then(r => { if (!r.ok) throw new Error('tile ' + r.status); return r.blob(); })
        .then(blob => createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
        .then(bmp => {
            if (!elevationDecodeCanvas) {
                elevationDecodeCanvas = document.createElement('canvas');
                elevationDecodeCanvas.width = 256;
                elevationDecodeCanvas.height = 256;
            }
            const ctx = elevationDecodeCanvas.getContext('2d', { willReadFrequently: true });
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(bmp, 0, 0);
            bmp.close();
            const data = ctx.getImageData(0, 0, 256, 256).data;
            const heights = new Float32Array(256 * 256);
            for (let i = 0, p = 0; i < heights.length; i++, p += 4) {
                heights[i] = data[p] * 256 + data[p + 1] + data[p + 2] / 256 - 32768;
            }
            elevationTileCache.delete(key);
            elevationTileCache.set(key, heights);
            while (elevationTileCache.size > ELEVATION_CACHE_MAX) {
                let evicted = false;
                for (const [k, v] of elevationTileCache) {
                    if (v === 'pending') continue;
                    elevationTileCache.delete(k);
                    evicted = true;
                    break;
                }
                if (!evicted) break;
            }
            // Heights re-applied next frame (spread across frames in updateImagery)
            if (imageryRings) {
                for (const ring of imageryRings) ring.elevDirty = true;
            }
        })
        .catch(() => elevationTileCache.set(key, { errorAt: performance.now() }));
}

/** Queue the elevation tiles covering a ring's window (plus the morph level). */
function ensureRingElevationTiles(ring) {
    if (!elevationEnabled || ring.ox === null) return;
    const span = 1 << ELEVATION_ZOOM_DELTA;   // imagery tiles per elevation tile
    const ze = ring.zoom - ELEVATION_ZOOM_DELTA;
    for (let ty = Math.floor(ring.oy / span); ty <= Math.floor((ring.oy + IMAGERY_RING_TILES - 1) / span); ty++) {
        for (let tx = Math.floor(ring.ox / span); tx <= Math.floor((ring.ox + IMAGERY_RING_TILES - 1) / span); tx++) {
            fetchElevationTile(ze, tx, ty);
        }
    }
    // The outer morph band samples the next-coarser level too
    if (ring.zoom > IMAGERY_ZOOM_MIN) {
        const span2 = span * 2;
        for (let ty = Math.floor(ring.oy / span2); ty <= Math.floor((ring.oy + IMAGERY_RING_TILES - 1) / span2); ty++) {
            for (let tx = Math.floor(ring.ox / span2); tx <= Math.floor((ring.ox + IMAGERY_RING_TILES - 1) / span2); tx++) {
                fetchElevationTile(ze - 1, tx, ty);
            }
        }
    }
}

/**
 * Best-effort height: sample the finest CACHED zoom at or below zeMax.
 * Returns null when no level is cached (caller should hold its last value
 * rather than assume sea level).
 */
function sampleElevationBestEffort(lat, lon, zeMax, zeMin) {
    for (let ze = zeMax; ze >= zeMin; ze--) {
        const n = 1 << ze;
        let ty = Math.floor(latToTileY(lat, ze));
        if (ty < 0) ty = 0;
        if (ty > n - 1) ty = n - 1;
        const wx = ((Math.floor(lonToTileX(lon, ze)) % n) + n) % n;
        if (elevationTileCache.get(ze + '/' + wx + '/' + ty) instanceof Float32Array) {
            return sampleElevationMeters(lat, lon, ze);
        }
    }
    return null;
}

/**
 * Bilinear height sample (meters) from cached tiles at a given zoom.
 * Returns 0 where data hasn't arrived yet (rebuilt when it lands).
 */
function sampleElevationMeters(lat, lon, ze) {
    const n = 1 << ze;
    const xf = lonToTileX(lon, ze);
    const yf = latToTileY(lat, ze);
    const tx = Math.floor(xf);
    let ty = Math.floor(yf);
    if (ty < 0) ty = 0;
    if (ty > n - 1) ty = n - 1;
    const wx = ((tx % n) + n) % n;
    const tile = elevationTileCache.get(ze + '/' + wx + '/' + ty);
    if (!(tile instanceof Float32Array)) return 0;

    // Sample at pixel centers, clamped to tile edges (1px seam error is negligible)
    let u = (xf - tx) * 256 - 0.5;
    let v = (yf - ty) * 256 - 0.5;
    u = Math.max(0, Math.min(254.999, u));
    v = Math.max(0, Math.min(254.999, v));
    const i0 = Math.floor(u), j0 = Math.floor(v);
    const fu = u - i0, fv = v - j0;
    const r0 = j0 * 256 + i0;
    const h00 = tile[r0], h10 = tile[r0 + 1];
    const h01 = tile[r0 + 256], h11 = tile[r0 + 257];
    return (h00 * (1 - fu) + h10 * fu) * (1 - fv) + (h01 * (1 - fu) + h11 * fu) * fv;
}

/**
 * Apply the same eclipse-darkening shader injection the Earth material uses
 * (GLSL kept in sync with createEarth). Shares its uniform objects, so
 * per-frame sun/moon updates propagate automatically.
 */
function applyEclipseDarkeningToMaterial(material) {
    material.onBeforeCompile = (shader) => {
        shader.uniforms.sunDirection = earthMaterial.userData.sunDirection;
        shader.uniforms.moonPosition = earthMaterial.userData.moonPosition;
        shader.uniforms.moonRadius = earthMaterial.userData.moonRadius;
        shader.uniforms.sunAngularRadius = earthMaterial.userData.sunAngularRadius;

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            uniform vec3 sunDirection;
            uniform vec3 moonPosition;
            uniform float moonRadius;
            uniform float sunAngularRadius;
            varying vec3 vWorldNormal;
            varying vec3 vWorldPosition;

            float calculateEclipseCoverage(vec3 worldPos, vec3 moonPos, vec3 sunDir, float moonRad) {
                vec3 toMoon = moonPos - worldPos;
                float distToMoon = length(toMoon);
                vec3 moonDir = toMoon / distToMoon;
                float moonAngularRadius = atan(moonRad / distToMoon);
                float angularSep = acos(clamp(dot(moonDir, sunDir), -1.0, 1.0));
                if (dot(moonDir, sunDir) < 0.0) return 0.0;
                float sumRadii = sunAngularRadius + moonAngularRadius;
                float diffRadii = abs(sunAngularRadius - moonAngularRadius);
                if (angularSep >= sumRadii) {
                    return 0.0;
                } else if (angularSep <= diffRadii) {
                    float smallerArea = 3.14159 * min(sunAngularRadius, moonAngularRadius) * min(sunAngularRadius, moonAngularRadius);
                    float sunArea = 3.14159 * sunAngularRadius * sunAngularRadius;
                    return smallerArea / sunArea;
                } else {
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

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            float waterness = smoothstep(0.02, 0.10, diffuseColor.b - max(diffuseColor.r, diffuseColor.g));
            float sunDot = dot(vWorldNormal, normalize(sunDirection));
            float dayFactor = smoothstep(-0.1, 0.2, sunDot);
            // Ground-relative sun altitude: sunset effects follow the LOCATION's
            // sunset, not the slope orientation (terrain normals tilt sunward)
            float groundDot = dot(normalize(vWorldPosition), normalize(sunDirection));
            float groundDay = smoothstep(-0.1, 0.2, groundDot);
            float eclipseCoverage = calculateEclipseCoverage(vWorldPosition, moonPosition, normalize(sunDirection), moonRadius);
            float eclipseDarkening = 1.0 - eclipseCoverage * 0.95;
            diffuseColor.rgb *= mix(1.0, eclipseDarkening, dayFactor);
            // Civil twilight: soft, near-neutral brightness ramp past the local
            // terminator (sunset COLOR lives in the direct light, not here)
            float twilightGlow = smoothstep(-0.12, 0.0, groundDot) * (1.0 - groundDay);
            diffuseColor.rgb *= 1.0 + twilightGlow * vec3(0.50, 0.44, 0.36);
            `
        );

        // Water-only specular (kept in sync with the Earth material injection)
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
            roughnessFactor = mix(1.0, 0.45, waterness);
            `
        );

        // Ocean glint specular rolloff (kept in sync with the Earth injection)
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <aomap_fragment>',
            `#include <aomap_fragment>
            reflectedLight.directSpecular /= (vec3(1.0) + reflectedLight.directSpecular);
            `
        );

        // Earth's own shadow (kept in sync with the Earth injection): direct
        // sun gates off just past local sunset — critical here because sunward
        // terrain slopes would otherwise stay lambert-lit with the sun far
        // below the horizon. Small negative margin = alpenglow on peaks.
        shader.fragmentShader = shader.fragmentShader
            .split('RE_Direct( directLight, geometry, material, reflectedLight );')
            .join(`{
                float gSunDot = dot(normalize(vWorldPosition), normalize(sunDirection));
                directLight.color *= smoothstep(-0.035, 0.01, gSunDot);
                RE_Direct( directLight, geometry, material, reflectedLight );
            }`);
    };
}

/**
 * Create the ring meshes once: fixed-capacity grid geometry per zoom level,
 * a 1024px composited canvas texture each, radial (spherical) normals so
 * lighting matches the globe exactly, and the eclipse shader injection.
 */
function ensureImageryRings() {
    if (imageryRings) return;
    imageryRings = [];

    const cells = IMAGERY_RING_TILES * IMAGERY_SUBDIV;   // 32 per side
    const verts = cells + 1;                             // 33 per side

    for (let z = IMAGERY_ZOOM_MAX; z >= IMAGERY_ZOOM_MIN; z--) {
        const canvas = document.createElement('canvas');
        canvas.width = IMAGERY_CANVAS_PX;
        canvas.height = IMAGERY_CANVAS_PX;
        const ctx = canvas.getContext('2d');

        const texture = new THREE.CanvasTexture(canvas);
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

        const material = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.8,
            metalness: 0.0,
            alphaTest: 0.5,           // not-yet-loaded areas discard -> globe shows through
            side: THREE.DoubleSide
        });
        applyEclipseDarkeningToMaterial(material);

        const geometry = new THREE.BufferGeometry();
        const posAttr = new THREE.BufferAttribute(new Float32Array(verts * verts * 3), 3);
        const norAttr = new THREE.BufferAttribute(new Float32Array(verts * verts * 3), 3);
        posAttr.setUsage(THREE.DynamicDrawUsage);
        norAttr.setUsage(THREE.DynamicDrawUsage);
        // UVs are static: the grid always spans the whole canvas (row 0 = north)
        const uvArr = new Float32Array(verts * verts * 2);
        let u2 = 0;
        for (let j = 0; j < verts; j++) {
            for (let i = 0; i < verts; i++) {
                uvArr[u2++] = i / cells;
                uvArr[u2++] = 1 - j / cells;
            }
        }
        geometry.setAttribute('position', posAttr);
        geometry.setAttribute('normal', norAttr);
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
        const indexAttr = new THREE.BufferAttribute(new Uint16Array(cells * cells * 6), 1);
        indexAttr.setUsage(THREE.DynamicDrawUsage);
        geometry.setIndex(indexAttr);

        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = false;
        mesh.receiveShadow = false;   // shadow-map texels are ~820 units; eclipse darkening is shader-based
        mesh.visible = false;
        scene.add(mesh);

        imageryRings.push({
            zoom: z, ox: null, oy: null,
            canvas, ctx, texture, mesh, geometry,
            posAttr, norAttr, indexAttr, dirtyTex: false, missing: 0,
            elevDirty: false, holeRect: null
        });
    }
}

/**
 * Re-center the ring stack on a point: snap each ring to its own tile grid,
 * cut each coarser ring's hole exactly where the next finer ring sits, and
 * redraw canvases whose tile window moved (cache first, network for gaps).
 */
function rebuildImageryRings(lat, lon) {
    imageryCenterLat = lat;
    imageryCenterLon = lon;

    let childRect = null;   // finer ring's tile rect, in the finer ring's zoom
    const toRedraw = [];
    for (const ring of imageryRings) {
        const z = ring.zoom;
        const n = 1 << z;
        const half = IMAGERY_RING_TILES / 2;
        const ox = Math.round(lonToTileX(lon, z)) - half;
        let oy = Math.round(latToTileY(lat, z)) - half;
        oy = Math.max(0, Math.min(Math.max(0, n - IMAGERY_RING_TILES), oy));

        const originChanged = ox !== ring.ox || oy !== ring.oy;
        ring.ox = ox;
        ring.oy = oy;
        // Rings above the display cap still track their window and fetch (cache
        // warm for the horizon drop) but get no geometry and punch no hole —
        // the finest DISPLAYED ring renders as a full square
        if (ring.zoom <= imageryMaxVisibleZoom) {
            ring.holeRect = childRect;
            ring.elevDirty = false;
            rebuildRingGeometry(ring, childRect);
            childRect = { x0: ox, y0: oy, x1: ox + IMAGERY_RING_TILES, y1: oy + IMAGERY_RING_TILES };
        }
        if (originChanged) {
            toRedraw.push(ring);
            ensureRingElevationTiles(ring);
        }
    }
    // Redraw coarse-to-fine so the wide-coverage tiles enter the fetch queue
    // first: the whole view fills fast, then sharpens underfoot
    for (let i = toRedraw.length - 1; i >= 0; i--) {
        redrawRingCanvas(toRedraw[i]);
    }
}

/**
 * Rewrite one ring's vertices (grid over its tile window, projected onto the
 * sphere and displaced by real terrain height) and indices (skipping the
 * cells the finer ring covers). Normals come from the terrain surface, which
 * is what makes low sun rake across slopes; a flat ring's computed normals
 * converge to the sphere's radials anyway.
 */
function rebuildRingGeometry(ring, childRect) {
    const z = ring.zoom;
    const cells = IMAGERY_RING_TILES * IMAGERY_SUBDIV;
    const verts = cells + 1;
    const pos = ring.posAttr.array;
    const ze = z - ELEVATION_ZOOM_DELTA;
    const morphable = elevationEnabled && z > IMAGERY_ZOOM_MIN;
    const hScale = ELEVATION_EXAGGERATION / METERS_PER_SCENE_UNIT;

    let p = 0;
    for (let j = 0; j < verts; j++) {
        const lat = tileYToLat(ring.oy + j / IMAGERY_SUBDIV, z);
        const ey = Math.abs(j / cells - 0.5) * 2;
        for (let i = 0; i < verts; i++) {
            const lon = tileXToLon(ring.ox + i / IMAGERY_SUBDIV, z);
            // Real terrain height (sea clamped to 0). The outer band morphs
            // toward the next-coarser data so heights agree where this ring
            // meets the coarser one outside it (no cracks at seams).
            let h = 0;
            if (elevationEnabled) {
                h = Math.max(0, sampleElevationMeters(lat, lon, ze));
                if (morphable) {
                    const ef = Math.max(Math.abs(i / cells - 0.5) * 2, ey);
                    if (ef > ELEVATION_MORPH_START) {
                        const t = (ef - ELEVATION_MORPH_START) / (1 - ELEVATION_MORPH_START);
                        h += (Math.max(0, sampleElevationMeters(lat, lon, ze - 1)) - h) * t;
                    }
                }
            }
            latLonToCartesian(lat, lon, EARTH_RADIUS + IMAGERY_LIFT + h * hScale, _tv1);
            pos[p++] = _tv1.x;
            pos[p++] = _tv1.y;
            pos[p++] = _tv1.z;
        }
    }

    // Hole bounds in this ring's grid cells (half-tile granularity: the child
    // sits on the twice-finer grid, and SUBDIV cells per tile keeps these integral)
    let hx0 = -1, hx1 = -1, hy0 = -1, hy1 = -1;
    if (childRect) {
        hx0 = (childRect.x0 / 2 - ring.ox) * IMAGERY_SUBDIV;
        hx1 = (childRect.x1 / 2 - ring.ox) * IMAGERY_SUBDIV;
        hy0 = (childRect.y0 / 2 - ring.oy) * IMAGERY_SUBDIV;
        hy1 = (childRect.y1 / 2 - ring.oy) * IMAGERY_SUBDIV;
    }
    const idx = ring.indexAttr.array;
    let k = 0;
    for (let j = 0; j < cells; j++) {
        for (let i = 0; i < cells; i++) {
            if (i >= hx0 && i < hx1 && j >= hy0 && j < hy1) continue;
            const a = j * verts + i, b = a + 1, c = a + verts, d = c + 1;
            idx[k++] = a; idx[k++] = c; idx[k++] = b;
            idx[k++] = b; idx[k++] = c; idx[k++] = d;
        }
    }
    // Degenerate tail: computeVertexNormals reads the whole index buffer,
    // not just the draw range
    idx.fill(0, k);
    ring.geometry.setDrawRange(0, k);
    ring.geometry.computeVertexNormals();
    ring.posAttr.needsUpdate = true;
    ring.norAttr.needsUpdate = true;
    ring.indexAttr.needsUpdate = true;
    ring.geometry.computeBoundingSphere();
}

/**
 * Redraw a ring's canvas from the tile cache; request whatever is missing.
 * clearCanvas=false (retry sweeps) repaints/requests without wiping slots that
 * are already showing pixels, and tracks ring.missing for the sweep to watch.
 */
function redrawRingCanvas(ring, clearCanvas = true) {
    const z = ring.zoom;
    const n = 1 << z;
    if (clearCanvas) ring.ctx.clearRect(0, 0, IMAGERY_CANVAS_PX, IMAGERY_CANVAS_PX);
    let drew = false;
    let missing = 0;
    for (const slot of IMAGERY_SLOT_ORDER) {            // center-first request order
        const dx = slot.dx, dy = slot.dy;
        const ty = ring.oy + dy;
        if (ty < 0 || ty >= n) continue;                // beyond the poles: leave transparent
        const tx = (((ring.ox + dx) % n) + n) % n;      // wrap across the antimeridian
        const key = z + '/' + tx + '/' + ty;
        const cached = imageryTileCache.get(key);
        if (cached && cached.width) {
            ring.ctx.drawImage(cached, dx * 256, dy * 256);
            drew = true;
        } else {
            // Placeholder on fresh canvases: upscale the matching quadrant of
            // the nearest cached ancestor tile (coarse rings load/prefetch
            // first) so waiting slots show blurry imagery instead of holes
            if (clearCanvas) {
                for (let k = 1; k <= 4; k++) {
                    const anc = imageryTileCache.get((z - k) + '/' + (tx >> k) + '/' + (ty >> k));
                    if (anc && anc.width) {
                        const s = 256 >> k;
                        ring.ctx.drawImage(anc,
                            (tx & ((1 << k) - 1)) * s, (ty & ((1 << k) - 1)) * s, s, s,
                            dx * 256, dy * 256, 256, 256);
                        drew = true;
                        break;
                    }
                }
            }
            missing++;
            requestImageryTile(z, tx, ty, key);
        }
    }
    ring.missing = missing;
    if (drew || clearCanvas) ring.dirtyTex = true;
}

/**
 * Orbital-mode cache warmer: keep the coarse rings' tile windows centered on
 * the focus point and their fetches flowing before the user ever drops to the
 * surface. Geometry and visibility are untouched (activation does a full
 * rebuild). Fine rings are skipped — their windows shift on every small pan
 * and would churn the network for nothing.
 */
function prefetchImageryTiles(lat, lon) {
    const nowMs = performance.now();
    const sweepDue = nowMs - imageryLastSweep > 1000;
    if (sweepDue) imageryLastSweep = nowMs;
    for (const ring of imageryRings) {
        if (ring.zoom > IMAGERY_PREFETCH_MAX_ZOOM) continue;
        const z = ring.zoom;
        const n = 1 << z;
        const half = IMAGERY_RING_TILES / 2;
        const ox = Math.round(lonToTileX(lon, z)) - half;
        let oy = Math.round(latToTileY(lat, z)) - half;
        oy = Math.max(0, Math.min(Math.max(0, n - IMAGERY_RING_TILES), oy));
        if (ox !== ring.ox || oy !== ring.oy) {
            ring.ox = ox;
            ring.oy = oy;
            redrawRingCanvas(ring);
            ensureRingElevationTiles(ring);
        } else if (sweepDue && ring.missing > 0) {
            redrawRingCanvas(ring, false);
        }
    }
}

/**
 * Per-frame imagery management: fades the globe's fake displacement out under
 * the (flat) rings, shows/hides the rings with view mode, recenters the stack
 * when the focus point moves, and batches canvas->GPU uploads once per frame.
 */
function updateImagery() {
    // Ground-detail blend: 1 in horizon mode, and also ramps in as the orbital
    // camera descends — sharp tiles + real elevation appear well before the
    // horizon transition instead of at it
    const orbitalGround = 1 - THREE.MathUtils.smoothstep(cameraRadius, IMAGERY_ORBITAL_SHOW, IMAGERY_ORBITAL_FADE);
    const groundBlend = Math.max(horizonBlendValue, orbitalGround);
    const active = imageryEnabled && (horizonBlendValue > 0.05 || cameraRadius < IMAGERY_ORBITAL_SHOW);

    // Fake displacement melts away BEFORE the rings appear (they carry real
    // elevation; the phony 5-unit bumps would poke through them) — and it also
    // keeps the low horizon camera from ending up inside the bumps
    if (earthMaterial) {
        earthMaterial.displacementScale = 5 * (1 - groundBlend);
    }

    // Coastline/lake/river lines dissolve on the same ramp: Natural Earth 10m
    // is generalized ~1 km cartography — crisp against the 2.5 km/px globe,
    // visibly misaligned against 10-75 m/px ring imagery (the imagery IS the
    // coastline there). With imagery off they stay, even in horizon view.
    const lineFade = imageryEnabled ? 1 - groundBlend : 1;
    if (coastlineMesh) {
        coastlineMesh.material.uniforms.fade.value = lineFade;
        coastlineMesh.visible = coastlinesVisible && lineFade > 0.01;
    }
    if (lakesMesh) {
        lakesMesh.material.uniforms.fade.value = lineFade;
        lakesMesh.visible = waterLinesVisible && lineFade > 0.01;
    }
    if (riversMesh) {
        riversMesh.material.uniforms.fade.value = lineFade;
        riversMesh.visible = waterLinesVisible && lineFade > 0.01;
    }

    if (!active) {
        if (imageryRings) {
            for (const ring of imageryRings) ring.mesh.visible = false;
        }
        imageryWasActive = false;
        // Warm start: when the orbital camera is low enough that a surface
        // drop is likely, start fetching around the focus point so the fall
        // lands on ground that is already sharp. Only while the pointer is
        // SETTLED — chasing a drag would queue tiles along the whole path.
        if (imageryEnabled && cameraRadius < IMAGERY_PREFETCH_RADIUS) {
            const nowMs = performance.now();
            if (nowMs - imageryPrefetchSampleMs > 400) {
                const dLatMoved = Math.abs(focusPointLat - imageryPrefetchSampleLat);
                let dLonMoved = Math.abs(focusPointLon - imageryPrefetchSampleLon);
                if (dLonMoved > 180) dLonMoved = 360 - dLonMoved;
                imageryPrefetchSampleMs = nowMs;
                imageryPrefetchSampleLat = focusPointLat;
                imageryPrefetchSampleLon = focusPointLon;
                if (dLatMoved + dLonMoved < 0.15) {
                    ensureImageryRings();
                    prefetchImageryTiles(focusPointLat, focusPointLon);
                }
            }
        }
        return;
    }

    ensureImageryRings();

    // Orbital preview: display only as fine a ring as the screen can resolve
    // from this altitude — finer zooms add zero visible sharpness but their
    // deep-zoom ocean tiles are toned differently and read as dark squares at
    // the pointer. Hidden rings still track the pointer and FETCH (cache warm
    // for the horizon drop).
    let maxVisibleZoom = IMAGERY_ZOOM_MAX;
    if (horizonBlendValue <= 0.05) {
        const altKm = Math.max(20, cameraRadius - EARTH_RADIUS) / KM_TO_SCENE;
        maxVisibleZoom = THREE.MathUtils.clamp(
            Math.floor(Math.log2(40075 / (256 * altKm * 0.0015))),   // ~screen px ground size at 75° fov
            IMAGERY_ZOOM_MIN, IMAGERY_ORBITAL_MAX_ZOOM);
    }

    // Recenter when the focus point strays from the layout center
    let needsBuild = !imageryWasActive || imageryCenterLat === null ||
        maxVisibleZoom !== imageryMaxVisibleZoom;
    if (!needsBuild) {
        const zf = IMAGERY_ZOOM_MAX;
        const nf = 1 << zf;
        let dx = lonToTileX(focusPointLon, zf) - lonToTileX(imageryCenterLon, zf);
        dx -= Math.round(dx / nf) * nf;   // shortest way around the antimeridian
        const dy = latToTileY(focusPointLat, zf) - latToTileY(imageryCenterLat, zf);
        needsBuild = Math.abs(dx) > IMAGERY_REBUILD_FRAC || Math.abs(dy) > IMAGERY_REBUILD_FRAC;
    }
    if (needsBuild) {
        imageryMaxVisibleZoom = maxVisibleZoom;
        rebuildImageryRings(focusPointLat, focusPointLon);
    }

    // Retry sweep: once a second, refill rings with holes (failed or timed-out
    // fetches). Errors older than IMAGERY_RETRY_MS become eligible to refetch;
    // clearCanvas=false so slots already showing pixels are never wiped.
    // Elevation tiles ride the same cadence (no-op once cached).
    const nowMs = performance.now();
    if (nowMs - imageryLastSweep > 1000) {
        imageryLastSweep = nowMs;
        for (const ring of imageryRings) {
            if (ring.missing > 0) redrawRingCanvas(ring, false);
            ensureRingElevationTiles(ring);
        }
    }

    // Re-apply heights as elevation tiles arrive — at most 2 rings per frame
    // so a burst of arrivals never causes a visible hitch
    let elevRebuilds = 0;
    for (const ring of imageryRings) {
        if (ring.elevDirty && ring.zoom <= imageryMaxVisibleZoom && elevRebuilds < 2) {
            ring.elevDirty = false;
            elevRebuilds++;
            rebuildRingGeometry(ring, ring.holeRect);
        }
    }

    // Camera and ground UI ride the local terrain height. Sample the finest
    // CACHED elevation (coarse fallback) and hold the last lift while no data
    // exists at all — never dive to sea level and rebound when tiles land.
    // Rise faster than descend so arriving terrain can't swallow the camera.
    if (elevationEnabled) {
        const hM = sampleElevationBestEffort(focusPointLat, focusPointLon,
            IMAGERY_ZOOM_MAX - ELEVATION_ZOOM_DELTA, IMAGERY_ZOOM_MIN - ELEVATION_ZOOM_DELTA);
        if (hM !== null) {
            const liftTarget = Math.max(0, hM) * ELEVATION_EXAGGERATION / METERS_PER_SCENE_UNIT;
            const rate = liftTarget > elevationCamLift ? 0.2 : 0.06;
            elevationCamLift += (liftTarget - elevationCamLift) * rate;
        }
    } else {
        elevationCamLift *= 0.9;
    }

    for (const ring of imageryRings) {
        ring.mesh.visible = ring.zoom <= imageryMaxVisibleZoom;
        if (ring.dirtyTex) {
            ring.texture.needsUpdate = true;
            ring.dirtyTex = false;
        }
    }
    imageryWasActive = true;
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

    // Degree ticks on outer ring — merged into single geometry
    {
        const tv = [], ti = [];
        let vo = 0;
        for (let deg = 0; deg < 360; deg += 10) {
            if (deg % 90 === 0) continue;
            const a = deg * Math.PI / 180;
            const isThirty = deg % 30 === 0;
            const tl = isThirty ? 5 : 2.5, tw = isThirty ? 1.5 : 0.8;
            const hw = tw / 2, hh = tl / 2;
            const cos = Math.cos(-a), sin = Math.sin(-a);
            const cx = Math.sin(a) * (pRingOuterRadius - tl / 2 - 1);
            const cy = Math.cos(a) * (pRingOuterRadius - tl / 2 - 1);
            for (const [lx, ly] of [[-hw,-hh],[hw,-hh],[-hw,hh],[hw,hh]]) {
                tv.push(lx*cos - ly*sin + cx, lx*sin + ly*cos + cy, 0.1);
            }
            ti.push(vo, vo+2, vo+1, vo+2, vo+3, vo+1);
            vo += 4;
        }
        const tg = new THREE.BufferGeometry();
        tg.setAttribute('position', new THREE.Float32BufferAttribute(tv, 3));
        tg.setIndex(ti);
        const tm = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({
            color: 0x444444, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false
        }));
        pointerCompassGroup.add(tm);
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

    // Cardinal direction markers — merged into single geometry with vertex colors
    {
        const cv = [], cc = [], ci = [];
        let vo = 0;
        const pDirs = [
            { angle: 0, color: 0xff0000, size: 1.8 },
            { angle: Math.PI / 2, color: 0xffffff, size: 1.3 },
            { angle: Math.PI, color: 0xffffff, size: 1.3 },
            { angle: -Math.PI / 2, color: 0xffffff, size: 1.3 }
        ];
        const tmpC = new THREE.Color();
        for (const dir of pDirs) {
            const tw = 8 * dir.size;
            const verts = [[0, pRingOuterRadius - 2], [-tw/2, pRingInnerRadius + 2], [tw/2, pRingInnerRadius + 2]];
            const cos = Math.cos(dir.angle), sin = Math.sin(dir.angle);
            tmpC.set(dir.color);
            for (const [lx, ly] of verts) {
                cv.push(lx*cos - ly*sin, lx*sin + ly*cos, 0.5);
                cc.push(tmpC.r, tmpC.g, tmpC.b);
            }
            ci.push(vo, vo+1, vo+2);
            vo += 3;
        }
        const cg = new THREE.BufferGeometry();
        cg.setAttribute('position', new THREE.Float32BufferAttribute(cv, 3));
        cg.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
        cg.setIndex(ci);
        const cm = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({
            vertexColors: true, side: THREE.DoubleSide, depthWrite: true
        }));
        cm.renderOrder = 1003;
        pointerCompassGroup.add(cm);
    }

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
    spotOutline.renderOrder = 100;
    scene.add(spotOutline);

    // Spot fill (matches pointer color)
    const spotFillGeometry = new THREE.CircleGeometry(spotRadius, spotSegments);
    const spotFillMaterial = new THREE.MeshBasicMaterial({
        color: brightRed,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
    });
    const spotFill = new THREE.Mesh(spotFillGeometry, spotFillMaterial);
    spotFill.renderOrder = 101;
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
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.renderOrder = 102;
    compassGroup.add(ring);

    // Degree ticks on outer ring — merged into single geometry
    {
        const tv = [], ti = [];
        let vo = 0;
        for (let deg = 0; deg < 360; deg += 10) {
            if (deg % 90 === 0) continue;
            const a = deg * Math.PI / 180;
            const isThirty = deg % 30 === 0;
            const tl = isThirty ? 6 : 3, tw = isThirty ? 2 : 1;
            const hw = tw / 2, hh = tl / 2;
            const cos = Math.cos(-a), sin = Math.sin(-a);
            const cx = Math.sin(a) * (ringOuterRadius - tl / 2 - 1);
            const cy = Math.cos(a) * (ringOuterRadius - tl / 2 - 1);
            for (const [lx, ly] of [[-hw,-hh],[hw,-hh],[-hw,hh],[hw,hh]]) {
                tv.push(lx*cos - ly*sin + cx, lx*sin + ly*cos + cy, 0.15);
            }
            ti.push(vo, vo+2, vo+1, vo+2, vo+3, vo+1);
            vo += 4;
        }
        const tg = new THREE.BufferGeometry();
        tg.setAttribute('position', new THREE.Float32BufferAttribute(tv, 3));
        tg.setIndex(ti);
        const tm = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({
            color: 0x444444, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false
        }));
        tm.renderOrder = 103;
        compassGroup.add(tm);
    }

    // Inner fill (mostly transparent)
    const innerFillGeometry = new THREE.CircleGeometry(ringInnerRadius, 32);
    const compassFillMaterial = new THREE.MeshBasicMaterial({
        color: 0x888888,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const innerFill = new THREE.Mesh(innerFillGeometry, compassFillMaterial);
    innerFill.position.z = -0.1;
    innerFill.renderOrder = 102;
    compassGroup.add(innerFill);

    // Sun direction line (hollow frame) - added to scene directly for proper renderOrder
    const sunLineW = 2.5, sunLineH = ringInnerRadius * 0.9, sunBorder = 0.5;
    const sunLineShape = new THREE.Shape();
    sunLineShape.moveTo(-sunLineW / 2, -sunLineH / 2);
    sunLineShape.lineTo(sunLineW / 2, -sunLineH / 2);
    sunLineShape.lineTo(sunLineW / 2, sunLineH / 2);
    sunLineShape.lineTo(-sunLineW / 2, sunLineH / 2);
    sunLineShape.closePath();
    const sunLineHole = new THREE.Path();
    sunLineHole.moveTo(-sunLineW / 2 + sunBorder, -sunLineH / 2 + sunBorder);
    sunLineHole.lineTo(sunLineW / 2 - sunBorder, -sunLineH / 2 + sunBorder);
    sunLineHole.lineTo(sunLineW / 2 - sunBorder, sunLineH / 2 - sunBorder);
    sunLineHole.lineTo(-sunLineW / 2 + sunBorder, sunLineH / 2 - sunBorder);
    sunLineHole.closePath();
    sunLineShape.holes.push(sunLineHole);
    const sunLineGeometry = new THREE.ShapeGeometry(sunLineShape);
    const sunLineMaterial = new THREE.MeshBasicMaterial({
        color: 0xffdd44,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const sunLine = new THREE.Mesh(sunLineGeometry, sunLineMaterial);
    sunLine.position.y = ringInnerRadius * 0.45;  // Offset to start from center
    sunLine.position.z = 1;  // Small offset toward camera to be in front of spot
    sunLine.renderOrder = 104;
    const sunLineGroup = new THREE.Group();
    sunLineGroup.visible = false;
    sunLineGroup.add(sunLine);
    // Sun fill bar (grows from center outward based on altitude)
    const sunFillInnerW = sunLineW - 2 * sunBorder;
    const sunFillInnerH = sunLineH - 2 * sunBorder;
    const sunFillGeometry = new THREE.PlaneGeometry(sunFillInnerW, sunFillInnerH);
    const sunFillMaterial = new THREE.MeshBasicMaterial({
        color: 0xffdd44,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const sunFill = new THREE.Mesh(sunFillGeometry, sunFillMaterial);
    sunFill.position.z = 0.9;
    sunFill.renderOrder = 103;
    sunLineGroup.add(sunFill);
    scene.add(sunLineGroup);

    // Moon direction line (hollow frame) - added to scene directly for proper renderOrder
    const moonLineW = 2, moonLineH = ringInnerRadius * 0.9, moonBorder = 0.4;
    const moonLineShape = new THREE.Shape();
    moonLineShape.moveTo(-moonLineW / 2, -moonLineH / 2);
    moonLineShape.lineTo(moonLineW / 2, -moonLineH / 2);
    moonLineShape.lineTo(moonLineW / 2, moonLineH / 2);
    moonLineShape.lineTo(-moonLineW / 2, moonLineH / 2);
    moonLineShape.closePath();
    const moonLineHole = new THREE.Path();
    moonLineHole.moveTo(-moonLineW / 2 + moonBorder, -moonLineH / 2 + moonBorder);
    moonLineHole.lineTo(moonLineW / 2 - moonBorder, -moonLineH / 2 + moonBorder);
    moonLineHole.lineTo(moonLineW / 2 - moonBorder, moonLineH / 2 - moonBorder);
    moonLineHole.lineTo(-moonLineW / 2 + moonBorder, moonLineH / 2 - moonBorder);
    moonLineHole.closePath();
    moonLineShape.holes.push(moonLineHole);
    const moonLineGeometry = new THREE.ShapeGeometry(moonLineShape);
    const moonLineMaterial = new THREE.MeshBasicMaterial({
        color: 0x8899ff,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const moonLine = new THREE.Mesh(moonLineGeometry, moonLineMaterial);
    moonLine.position.y = ringInnerRadius * 0.45;
    moonLine.position.z = 0.5;  // Small offset toward camera
    moonLine.renderOrder = 104;
    const moonLineGroup = new THREE.Group();
    moonLineGroup.visible = false;
    moonLineGroup.add(moonLine);
    // Moon fill bar (grows from center outward based on altitude)
    const moonFillInnerW = moonLineW - 2 * moonBorder;
    const moonFillInnerH = moonLineH - 2 * moonBorder;
    const moonFillGeometry = new THREE.PlaneGeometry(moonFillInnerW, moonFillInnerH);
    const moonFillMaterial = new THREE.MeshBasicMaterial({
        color: 0x8899ff,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const moonFill = new THREE.Mesh(moonFillGeometry, moonFillMaterial);
    moonFill.position.z = 0.4;
    moonFill.renderOrder = 103;
    moonLineGroup.add(moonFill);
    scene.add(moonLineGroup);

    // Cardinal direction markers — merged into single geometry with vertex colors
    {
        const cv = [], cc = [], ci = [];
        let vo = 0;
        const gDirs = [
            { angle: 0, color: 0xcc2222, size: 1.4 },
            { angle: Math.PI / 2, color: 0x333333, size: 1 },
            { angle: Math.PI, color: 0x333333, size: 1 },
            { angle: -Math.PI / 2, color: 0x333333, size: 1 }
        ];
        const tmpC = new THREE.Color();
        for (const dir of gDirs) {
            const tw = 6 * dir.size;
            const verts = [[0, ringOuterRadius - 1], [-tw/2, ringInnerRadius + 1], [tw/2, ringInnerRadius + 1]];
            const cos = Math.cos(dir.angle), sin = Math.sin(dir.angle);
            tmpC.set(dir.color);
            for (const [lx, ly] of verts) {
                cv.push(lx*cos - ly*sin, lx*sin + ly*cos, 0.2);
                cc.push(tmpC.r, tmpC.g, tmpC.b);
            }
            ci.push(vo, vo+1, vo+2);
            vo += 3;
        }
        const cg = new THREE.BufferGeometry();
        cg.setAttribute('position', new THREE.Float32BufferAttribute(cv, 3));
        cg.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
        cg.setIndex(ci);
        const cm = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({
            vertexColors: true, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false
        }));
        cm.renderOrder = 103;
        compassGroup.add(cm);
    }

    scene.add(compassGroup);

    // Scale the ground compass to a modest disc at your feet: its ring lands
    // GROUND_COMPASS_DEPRESSION_DEG below the horizontal seen from the
    // standing eye height (geometry was authored for the old 17 km camera)
    const eyeAboveCompass = HORIZON_CAMERA_HEIGHT - EARTH_RADIUS - GROUND_UI_RAISE;
    const compassScale = eyeAboveCompass /
        (Math.tan(THREE.MathUtils.degToRad(GROUND_COMPASS_DEPRESSION_DEG)) * ringOuterRadius);
    compassGroup.scale.setScalar(compassScale);
    sunLineGroup.scale.setScalar(compassScale);
    moonLineGroup.scale.setScalar(compassScale);

    // Instrument overlay: the compass must stay readable when 3D terrain
    // rises inside its ring — draw it over the ground (no depth test), same
    // approach as the coastline overlay
    for (const grp of [compassGroup, sunLineGroup, moonLineGroup]) {
        grp.traverse(obj => {
            if (obj.material) obj.material.depthTest = false;
        });
    }

    // Store compass groups and fill refs for updates
    focusMarker.userData.sunLineGroup = sunLineGroup;
    focusMarker.userData.moonLineGroup = moonLineGroup;
    focusMarker.userData.sunFill = sunFill;
    focusMarker.userData.moonFill = moonFill;
    focusMarker.userData.sunFillH = sunFillInnerH;
    focusMarker.userData.moonFillH = moonFillInnerH;
    focusMarker.userData.sunBorder = sunBorder;
    focusMarker.userData.moonBorder = moonBorder;
    focusMarker.userData.sunLineH = sunLineH;
    focusMarker.userData.moonLineH = moonLineH;

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
        toggleFocusLockBtn.title = focusLocked ? 'Click to lock pointer under camera' : 'Click to pin pointer to Earth';
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
 * Convert B-V color index to RGB values
 * Based on Mitchell Charity's blackbody color approximation
 */
function bvToRGB(bv) {
    // Clamp B-V to valid range
    bv = Math.max(-0.4, Math.min(2.0, bv));
    // Temperature from B-V (Ballesteros 2012)
    const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
    const x = t / 100; // Tanner Helland uses temp/100
    let r, g, b;
    // Red: cool stars have full red, hot stars lose red
    if (x <= 66) {
        r = 1.0;
    } else {
        r = Math.min(1, Math.max(0, 1.293 * Math.pow(x - 60, -0.1332)));
    }
    // Green: peaks at mid temperatures
    if (x <= 66) {
        g = Math.min(1, Math.max(0, 0.390 * Math.log(x) - 0.632));
    } else {
        g = Math.min(1, Math.max(0, 1.130 * Math.pow(x - 60, -0.0755)));
    }
    // Blue: hot stars have full blue, cool stars lose blue
    if (x >= 66) {
        b = 1.0;
    } else if (x <= 19) {
        b = 0;
    } else {
        b = Math.min(1, Math.max(0, 0.543 * Math.log(x - 10) - 1.196));
    }
    return [r, g, b];
}

/**
 * Create a text label sprite for a planet name (colored)
 */
function createPlanetLabel(name, position, color) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 128;
    ctx.font = 'bold 56px sans-serif';
    const [r, g, b] = color;
    ctx.fillStyle = `rgba(${r*255|0}, ${g*255|0}, ${b*255|0}, 0.95)`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 256, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const sprite = new THREE.Sprite(material);
    const outward = position.clone().normalize().multiplyScalar(STAR_DISTANCE * 0.015);
    const sideways = new THREE.Vector3(-position.y, position.x, 0).normalize().multiplyScalar(STAR_DISTANCE * 0.025);
    sprite.position.copy(position).add(outward).add(sideways);
    sprite.scale.set(STAR_DISTANCE * 0.12, STAR_DISTANCE * 0.03, 1);
    sprite.visible = false;
    return sprite;
}

/**
 * Create a text label sprite for a star name
 */
function createStarLabel(name, position) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 128;
    ctx.font = 'bold 56px sans-serif';
    ctx.fillStyle = 'rgba(200, 220, 255, 0.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 256, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const sprite = new THREE.Sprite(material);
    // Offset label from star position — push outward and sideways
    const outward = position.clone().normalize().multiplyScalar(STAR_DISTANCE * 0.015);
    const sideways = new THREE.Vector3(-position.y, position.x, 0).normalize().multiplyScalar(STAR_DISTANCE * 0.025);
    sprite.position.copy(position).add(outward).add(sideways);
    sprite.scale.set(STAR_DISTANCE * 0.12, STAR_DISTANCE * 0.03, 1);
    sprite.visible = false; // Hidden until horizon mode
    return sprite;
}

/**
 * Create celestial bodies (stars, constellations) from real catalog data
 * All celestial objects are added to celestialSphereGroup which rotates by GMST
 */
function createCelestialBodies() {
    celestialSphereGroup = new THREE.Group();
    scene.add(celestialSphereGroup);

    // ===== BUILD STAR POSITION MAP =====
    const starPositionMap = new Map(); // hipId -> Vector3
    const starPositions = [];
    const starColors = [];
    const starSizes = [];

    for (const [hip, ra, dec, mag, bv] of STAR_CATALOG) {
        const pos = raDecToPosition(ra, dec, STAR_DISTANCE);
        starPositionMap.set(hip, pos);

        starPositions.push(pos.x, pos.y, pos.z);

        // Color from B-V index
        const [r, g, b] = bvToRGB(bv);
        starColors.push(r, g, b);

        // Size in pixels from magnitude: brighter = larger
        // mag -1.5 (Sirius) -> ~5.5px, mag 0 -> ~3.6px, mag 3 -> ~1.5px, mag 5.5 -> 1px
        const size = Math.max(1.0, 5.5 * Math.pow(10, -0.12 * (mag + 1.5)));
        starSizes.push(size);
    }

    // ===== RENDER CATALOG STARS (single draw call) =====
    const catalogGeometry = new THREE.BufferGeometry();
    catalogGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    catalogGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
    catalogGeometry.setAttribute('size', new THREE.Float32BufferAttribute(starSizes, 1));

    const catalogMaterial = new THREE.ShaderMaterial({
        uniforms: {},
        vertexShader: `
            attribute float size;
            attribute vec3 color;
            varying vec3 vColor;
            void main() {
                vColor = color;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                // Fixed pixel size — stars are at infinity, no distance scaling
                // Scale by projection Y to grow when FOV narrows (sky zoom)
                gl_PointSize = size * projectionMatrix[1][1] * 0.6;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            void main() {
                float dist = length(gl_PointCoord - vec2(0.5));
                if (dist > 0.5) discard;
                float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
                gl_FragColor = vec4(vColor, alpha * 0.9);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const catalogStars = new THREE.Points(catalogGeometry, catalogMaterial);
    celestialSphereGroup.add(catalogStars);

    // ===== POLARIS GLOW =====
    const polarisPos = starPositionMap.get(11767); // HIP 11767 = Polaris
    if (polarisPos) {
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
        polarisGlow.position.copy(polarisPos);
        celestialSphereGroup.add(polarisGlow);
    }

    // ===== CONSTELLATION LINES (single draw call) =====
    const conLinePositions = [];
    Object.values(CONSTELLATION_DATA).forEach(({ lines }) => {
        for (const [hip1, hip2] of lines) {
            const p1 = starPositionMap.get(hip1);
            const p2 = starPositionMap.get(hip2);
            if (p1 && p2) {
                // Slightly smaller radius so lines appear behind stars
                const scale = 0.998;
                conLinePositions.push(
                    p1.x * scale, p1.y * scale, p1.z * scale,
                    p2.x * scale, p2.y * scale, p2.z * scale
                );
            }
        }
    });

    const conLineGeometry = new THREE.BufferGeometry();
    conLineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(conLinePositions, 3));
    const conLineMaterial = new THREE.LineBasicMaterial({
        color: 0x334466,
        transparent: true,
        opacity: 0.4
    });
    constellationLinesMesh = new THREE.LineSegments(conLineGeometry, conLineMaterial);
    celestialSphereGroup.add(constellationLinesMesh);

    // ===== NAMED STAR LABELS =====
    starLabelSprites = [];
    for (const [hipStr, name] of Object.entries(STAR_NAMES)) {
        const hip = parseInt(hipStr);
        const pos = starPositionMap.get(hip);
        if (pos) {
            const label = createStarLabel(name, pos);
            celestialSphereGroup.add(label);
            starLabelSprites.push(label);
        }
    }

    // ===== PLANETS =====
    planetSprites = [];
    const simTime = getAbsoluteSimulatedTime();
    for (const planet of PLANETS) {
        const raDec = getPlanetRADec(simTime, planet.id);
        const pos = raDec
            ? raDecToPosition(raDec.ra / 15, raDec.dec, STAR_DISTANCE)
            : new THREE.Vector3(STAR_DISTANCE, 0, 0);

        // Dot: glow sprite
        const dotCanvas = document.createElement('canvas');
        dotCanvas.width = 64;
        dotCanvas.height = 64;
        const dCtx = dotCanvas.getContext('2d');
        const [cr, cg, cb] = planet.color;
        const grad = dCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, `rgba(${cr*255|0}, ${cg*255|0}, ${cb*255|0}, 1.0)`);
        grad.addColorStop(0.3, `rgba(${cr*255|0}, ${cg*255|0}, ${cb*255|0}, 0.5)`);
        grad.addColorStop(1, `rgba(${cr*255|0}, ${cg*255|0}, ${cb*255|0}, 0)`);
        dCtx.fillStyle = grad;
        dCtx.fillRect(0, 0, 64, 64);
        const dotTexture = new THREE.CanvasTexture(dotCanvas);
        const dotMaterial = new THREE.SpriteMaterial({
            map: dotTexture,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const dot = new THREE.Sprite(dotMaterial);
        dot.position.copy(pos);
        const dotScale = STAR_DISTANCE * 0.006 * (planet.size / 3.0);
        dot.scale.set(dotScale, dotScale, 1);
        celestialSphereGroup.add(dot);

        // Label
        const label = createPlanetLabel(planet.name, pos, planet.color);
        celestialSphereGroup.add(label);

        planetSprites.push({ dot, label, planetId: planet.id });
    }

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
    latLonToDirection(sunPos.lat, sunPos.lon, currentSunDir);
    latLonToDirection(moonPos.lat, moonPos.lon, currentMoonDir);
}

let lastPlanetUpdateTime = 0;

/**
 * Update planet positions from Swiss Ephemeris (throttled)
 */
function updatePlanetPositions() {
    const now = performance.now();
    if (now - lastPlanetUpdateTime < 200) return; // Throttle to 5 Hz
    lastPlanetUpdateTime = now;

    const simTime = getAbsoluteSimulatedTime();
    for (const entry of planetSprites) {
        const raDec = getPlanetRADec(simTime, entry.planetId);
        if (!raDec) continue;
        raDecToPosition(raDec.ra / 15, raDec.dec, STAR_DISTANCE, _tv3);
        entry.dot.position.copy(_tv3);
        // Update label position with same offset as createStarLabel
        _tv1.copy(_tv3).normalize().multiplyScalar(STAR_DISTANCE * 0.015);
        _tv2.set(-_tv3.y, _tv3.x, 0).normalize().multiplyScalar(STAR_DISTANCE * 0.025);
        entry.label.position.copy(_tv3).add(_tv1).add(_tv2);
    }
}

// ==================== GHOST CELESTIALS SYSTEM ====================

/**
 * Check if a celestial body is occluded by Earth from the camera's perspective.
 * Returns { occluded: boolean, altitude: number (radians, negative = below horizon) }
 */
// Horizon dip angle: from camera height, the visible horizon is below geometric horizon
const HORIZON_DIP_ANGLE = -Math.acos(EARTH_RADIUS / HORIZON_CAMERA_HEIGHT); // ~-1.05 degrees at 1 unit up

const _ghostResult = { occluded: false, altitude: 0 };
function getGhostOcclusion(bodyWorldPos, bodyLatLon) {
    // Horizon view: altitude-based check, accounting for camera height dip
    if (horizonBlendValue > 0.5) {
        const focusLatRad = focusPointLat * Math.PI / 180;
        const focusLonRad = focusPointLon * Math.PI / 180;
        const bodyLatRad = bodyLatLon.lat * Math.PI / 180;
        const bodyLonRad = bodyLatLon.lon * Math.PI / 180;
        const dLon = bodyLonRad - focusLonRad;
        const sinLat1 = Math.sin(focusLatRad);
        const cosLat1 = Math.cos(focusLatRad);
        const sinLat2 = Math.sin(bodyLatRad);
        const cosLat2 = Math.cos(bodyLatRad);
        const altitude = Math.asin(sinLat1 * sinLat2 + cosLat1 * cosLat2 * Math.cos(dLon));
        _ghostResult.occluded = altitude < HORIZON_DIP_ANGLE;
        _ghostResult.altitude = altitude;
        return _ghostResult;
    }

    // Orbital view: ray-sphere intersection
    const camPos = camera.position;
    const dir = _tv2.subVectors(bodyWorldPos, camPos);
    const bodyDist = dir.length();
    dir.normalize();

    // Ray-sphere intersection: sphere at origin with radius EARTH_RADIUS
    const oc = camPos; // origin - center (center is 0,0,0)
    const b = 2.0 * oc.dot(dir);
    const c = oc.dot(oc) - EARTH_RADIUS * EARTH_RADIUS;
    const discriminant = b * b - 4 * c;

    if (discriminant > 0) {
        const sqrtD = Math.sqrt(discriminant);
        const t1 = (-b - sqrtD) / 2;
        const t2 = (-b + sqrtD) / 2;
        // Occluded if sphere intersection is between camera and body
        if (t1 > 0 && t1 < bodyDist) {
            const bodyDir = _tv1.copy(bodyWorldPos).normalize();
            const focusDir = latLonToDirection(focusPointLat, focusPointLon, _tv3);
            const dotProd = bodyDir.dot(focusDir);
            _ghostResult.occluded = true;
            _ghostResult.altitude = Math.asin(Math.max(-1, Math.min(1, dotProd))) - Math.PI / 2;
            return _ghostResult;
        }
    }
    _ghostResult.occluded = false;
    _ghostResult.altitude = Math.PI / 4;
    return _ghostResult;
}

/**
 * Master ghost visibility toggle (called when button is clicked)
 */
function updateGhostVisibility() {
    if (!ghostViewEnabled) {
        if (ghostSunSprite) ghostSunSprite.visible = false;
        if (ghostMoonSprite) ghostMoonSprite.visible = false;
    }
}

/**
 * Per-frame ghost celestials update — called in animate loop
 */
function updateGhostCelestials() {
    if (!ghostViewEnabled) {
        if (ghostSunSprite) ghostSunSprite.visible = false;
        if (ghostMoonSprite) ghostMoonSprite.visible = false;
        return;
    }
    if (isViewTransitioning) return;

    const simTime = getAbsoluteSimulatedTime();
    const sunPos = getSunPosition(simTime);
    const moonPos = getMoonPosition(simTime);

    // --- Ghost Sun Sprite ---
    if (ghostSunSprite && sunMesh) {
        ghostSunSprite.position.copy(sunMesh.position);
        const sunOcc = getGhostOcclusion(sunMesh.position, sunPos);
        if (sunOcc.occluded) {
            ghostSunSprite.material.opacity = 0.8;
            ghostSunSprite.visible = true;
        } else {
            ghostSunSprite.visible = false;
        }
    }

    // --- Ghost Moon Sprite ---
    if (ghostMoonSprite && moonMesh) {
        ghostMoonSprite.position.copy(moonMesh.position);
        const moonOcc = getGhostOcclusion(moonMesh.position, moonPos);
        if (moonOcc.occluded) {
            ghostMoonSprite.material.opacity = 0.7;
            ghostMoonSprite.visible = true;
        } else {
            ghostMoonSprite.visible = false;
        }
    }

}

// City marker system - uses CITIES array from top
const cityMarkers = [];  // Plain data objects (not THREE.Mesh) — indexed parallel to InstancedMesh
let cityInstancedMesh = null;  // Single InstancedMesh for all city markers
let hoveredCity = null;  // Currently hovered city data object
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
    // Single InstancedMesh for all city markers (1 draw call instead of 486)
    const cityMarkerGeometry = new THREE.SphereGeometry(8, 12, 12);
    const cityMarkerMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    cityInstancedMesh = new THREE.InstancedMesh(cityMarkerGeometry, cityMarkerMaterial, CITIES.length);
    cityInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    cityInstancedMesh.renderOrder = 150;
    scene.add(cityInstancedMesh);

    const tmpMatrix = new THREE.Matrix4();
    const tmpColor = new THREE.Color(0xffffff);

    CITIES.forEach((city, i) => {
        const position = latLonToCartesian(city.lat, city.lon, EARTH_RADIUS + 3);

        // Set instance transform
        tmpMatrix.makeTranslation(position.x, position.y, position.z);
        cityInstancedMesh.setMatrixAt(i, tmpMatrix);
        cityInstancedMesh.setColorAt(i, tmpColor);

        // Create 3D sprite label for this city
        const labelSprite = createCityLabelSprite(city.name);
        labelSprite.visible = false;
        labelSprite.renderOrder = 200;
        labelSprite.userData.city = city;
        labelSprite.userData.instanceIndex = i;
        scene.add(labelSprite);

        // Plain data object (replaces individual THREE.Mesh)
        cityMarkers.push({
            position: position.clone(),
            instanceIndex: i,
            visible: true,
            currentScale: 1,
            currentRaise: 3,
            userData: { city: city, labelSprite: labelSprite, originalColor: null }
        });
    });

    cityInstancedMesh.instanceMatrix.needsUpdate = true;
    if (cityInstancedMesh.instanceColor) cityInstancedMesh.instanceColor.needsUpdate = true;

    // Set up mouse event listeners for city interaction
    setupCityInteraction();
}

/**
 * Set up city label interaction - hover effect and click to navigate
 */
function setupCityInteraction() {
    const canvas = renderer.domElement;
    const hoverColor = new THREE.Color(0x00dddd);
    let mouseDownX = 0, mouseDownY = 0;
    const CLICK_THRESHOLD = 5;

    // Resolve a raycaster hit to a cityMarkers data object
    function findCityFromHit() {
        // Check label sprites first (they're on top)
        const visibleLabels = cityMarkers
            .map(m => m.userData.labelSprite).filter(l => l && l.visible);
        const labelHits = _raycaster.intersectObjects(visibleLabels, false);
        if (labelHits.length > 0) {
            const hitLabel = labelHits[0].object;
            return cityMarkers.find(m => m.userData.labelSprite === hitLabel) || null;
        }
        // Check InstancedMesh markers
        if (cityInstancedMesh && cityInstancedMesh.visible) {
            const markerHits = _raycaster.intersectObject(cityInstancedMesh, false);
            if (markerHits.length > 0) {
                const idx = markerHits[0].instanceId;
                if (idx !== undefined && idx < cityMarkers.length && cityMarkers[idx].visible) {
                    return cityMarkers[idx];
                }
            }
        }
        return null;
    }

    // Set hover state on a city (instanced marker color + label color)
    function setHoverState(marker, hovered) {
        if (!marker || !cityInstancedMesh) return;
        const label = marker.userData.labelSprite;
        const i = marker.instanceIndex;

        if (hovered) {
            cityInstancedMesh.getColorAt(i, _tc1);
            if (!marker.userData.originalColor) marker.userData.originalColor = _tc1.clone();
            cityInstancedMesh.setColorAt(i, hoverColor);
            cityInstancedMesh.instanceColor.needsUpdate = true;

            if (label) {
                if (!label.userData.originalColor) label.userData.originalColor = label.material.color.clone();
                label.material.color.copy(hoverColor);
            }
        } else {
            if (marker.userData.originalColor) {
                cityInstancedMesh.setColorAt(i, marker.userData.originalColor);
                cityInstancedMesh.instanceColor.needsUpdate = true;
            }
            if (label && label.userData.originalColor) {
                label.material.color.copy(label.userData.originalColor);
            }
        }
    }

    function onMouseMove(e) {
        if (!camera) return;

        const pointerDragging = focusMarker && focusMarker.userData.isDragging;
        const isAnyDragging = isDragging || pointerDragging;
        if (isAnyDragging) {
            if (hoveredCity) { setHoverState(hoveredCity, false); hoveredCity = null; }
            cursorNearestMarker = null;
            return;
        }

        _mouse.set(
            (e.clientX / window.innerWidth) * 2 - 1,
            -(e.clientY / window.innerHeight) * 2 + 1
        );
        _raycaster.setFromCamera(_mouse, camera);

        const hitCity = findCityFromHit();

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
            if (markerScreenPos.z > 1) return;
            const dx = markerScreenPos.x - mouse.x;
            const dy = markerScreenPos.y - mouse.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < closestMarkerDist) {
                closestMarkerDist = dist;
                closestMarker = marker;
            }
        });
        if (closestMarker !== cursorNearestMarker) cursorNearestMarker = closestMarker;

        // Track proximity expansion for visible labels
        const visibleLabels = cityMarkers
            .map(m => m.userData.labelSprite).filter(l => l && l.visible);
        if (visibleLabels.length > 0) {
            let closestLabel = null;
            let closestDist = Infinity;
            visibleLabels.forEach(label => {
                const labelScreenPos = label.position.clone().project(camera);
                const dx = labelScreenPos.x - mouse.x;
                const dy = labelScreenPos.y - mouse.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < closestDist) { closestDist = dist; closestLabel = label; }
            });
            if (closestLabel !== proximityExpandedLabel) {
                if (proximityExpandedLabel) proximityExpandedLabel.userData.isProximityExpanded = false;
                if (closestLabel) closestLabel.userData.isProximityExpanded = true;
                proximityExpandedLabel = closestLabel;
            }
        }
    }

    function onMouseDown(e) {
        mouseDownX = e.clientX;
        mouseDownY = e.clientY;
    }

    function onClick(e) {
        const dx = e.clientX - mouseDownX;
        const dy = e.clientY - mouseDownY;
        if (Math.sqrt(dx * dx + dy * dy) > CLICK_THRESHOLD) return;
        if (focusMarker && focusMarker.userData.isHovered) return;

        if (hoveredCity && hoveredCity.userData.city) {
            const city = hoveredCity.userData.city;
            if (focusLocked) {
                animatePointerToCity(city.lat, city.lon, 500);
            } else {
                animateCameraToCity(city.lat, city.lon, 500);
            }
            return;
        }

        _mouse.set(
            (e.clientX / window.innerWidth) * 2 - 1,
            -(e.clientY / window.innerHeight) * 2 + 1
        );
        _raycaster.setFromCamera(_mouse, camera);

        if (_raycaster.ray.intersectSphere(_earthSphere, _hitPoint)) {
            const normalized = _hitPoint.normalize();
            const hitLat = Math.asin(normalized.z) * 180 / Math.PI;
            const hitLon = Math.atan2(normalized.y, normalized.x) * 180 / Math.PI;
            animatePointerToCity(hitLat, hitLon, 300);
        }
    }

    function onTouchStart(e) {
        if (!camera || e.touches.length !== 1) return;
        const touch = e.touches[0];
        _mouse.set(
            (touch.clientX / window.innerWidth) * 2 - 1,
            -(touch.clientY / window.innerHeight) * 2 + 1
        );
        _raycaster.setFromCamera(_mouse, camera);

        const hitCity = findCityFromHit();
        if (hitCity && hitCity.userData.city) {
            setHoverState(hitCity, true);
            hoveredCity = hitCity;
            const city = hitCity.userData.city;
            if (focusLocked) {
                animatePointerToCity(city.lat, city.lon, 500);
            } else {
                animateCameraToCity(city.lat, city.lon, 500);
            }
            setTimeout(() => {
                setHoverState(hitCity, false);
                if (hoveredCity === hitCity) hoveredCity = null;
            }, 500);
        }
    }

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
    const cameraPos = _tv1.copy(camera.position).normalize();

    // Get sun and moon directions for visibility check
    const sunDir = currentSunDir;
    const moonDir = currentMoonDir;

    // Get focus point position (independent of camera)
    const focusLat = focusPointLat;
    const focusLon = focusPointLon;
    const focusPos = latLonToCartesian(focusLat, focusLon, EARTH_RADIUS, _tv4);

    // Marker scale: distance-based far out, shrinking toward constant angular
    // size as the camera descends below the old ≥1000 km design altitude;
    // released in horizon mode where the signpost rules below take over
    const groundShrink = THREE.MathUtils.lerp(
        THREE.MathUtils.clamp((cameraDistance - EARTH_RADIUS) / 941, 0.05, 1),
        1,
        Math.min(1, horizonBlendValue * 2)
    );
    const markerScale = Math.max(0.5, cameraDistance * 0.00015) * groundShrink;

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
        const markerNormal = _tv2.copy(marker.position).normalize();

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

    // Reuse module-level temp objects for InstancedMesh updates
    const tmpMatrix = _tm1;
    const tmpColor = _tc1;
    let instanceDirty = false;
    let colorDirty = false;

    // Update each marker and its 3D sprite label
    markerData.forEach(({ marker, city, isOnVisibleSide, dotProduct }) => {
        const isClosest = city === closestCity;
        const isMajor = MAJOR_CAPITALS.has(city.name);
        const isCursorNearest = marker === cursorNearestMarker;
        const showLabel = labelsToShow.has(city.name) || isMajor || isCursorNearest;

        // Check if city is in sunlight or moonlight
        const cityNormal = _tv2.copy(marker.position).normalize();
        const inSunlight = sunDir ? cityNormal.dot(sunDir) > 0 : false;
        const inMoonlight = moonDir ? cityNormal.dot(moonDir) > 0 : false;

        // Fade markers near horizon
        const horizonFade = Math.max(0, Math.min(1, (dotProduct + 0.15) / 0.3));

        // Set marker visibility (hidden during the cinematic fall/liftoff —
        // a fixed-size marker looms as the camera dives past it)
        const isVisible = citySpheresVisible && isOnVisibleSide && !isViewTransitioning;
        marker.visible = isVisible;

        // Horizon mode: per-marker constant angular size (scale ∝ distance,
        // quantized to 0.5% steps to limit instance-matrix churn) — the city
        // you're standing next to stays a dot instead of becoming a moon
        const horizonFactor = Math.min(1, horizonBlendValue * 2);
        const horizonMarkerScale = Math.round(THREE.MathUtils.clamp(
            marker.position.distanceTo(camera.position) * 0.0008, 0.02, 0.5) * 200) / 200;
        const adjustedMarkerScale = markerScale * (1 - horizonFactor) + horizonMarkerScale * horizonFactor;

        // Update instance matrix (scale 0 to hide, adjusted scale to show).
        // In horizon mode the marker re-anchors to local terrain: its creation
        // height (+3, for orbital) floats in the sky when you stand beside it
        const s = isVisible ? adjustedMarkerScale : 0;
        let raise = 3;
        if (horizonFactor > 0 && isVisible) {
            const cityTerrH = elevationEnabled ? Math.max(0,
                (sampleElevationBestEffort(city.lat, city.lon,
                    IMAGERY_ZOOM_MAX - ELEVATION_ZOOM_DELTA,
                    IMAGERY_ZOOM_MIN - ELEVATION_ZOOM_DELTA) || 0)) / METERS_PER_SCENE_UNIT : 0;
            raise = 3 * (1 - horizonFactor) + (cityTerrH + 0.5) * horizonFactor;
            raise = Math.round(raise * 100) / 100;   // quantize: limit matrix churn
        }
        if (s !== marker.currentScale || raise !== marker.currentRaise) {
            marker.currentScale = s;
            marker.currentRaise = raise;
            const p = _tv3.copy(marker.position).normalize().multiplyScalar(EARTH_RADIUS + raise);
            tmpMatrix.makeTranslation(p.x, p.y, p.z);
            if (s !== 1) tmpMatrix.scale(_tv2.set(s, s, s));
            cityInstancedMesh.setMatrixAt(marker.instanceIndex, tmpMatrix);
            instanceDirty = true;
        }

        // Update instance color — skip if hovered (hover manages its own color)
        if (marker !== hoveredCity) {
            tmpColor.set(inSunlight ? sunCityColor : moonCityColor);
            cityInstancedMesh.setColorAt(marker.instanceIndex, tmpColor);
            if (!marker.userData.originalColor) marker.userData.originalColor = new THREE.Color();
            marker.userData.originalColor.copy(tmpColor);
            colorDirty = true;
        }

        // Update 3D sprite label
        const labelSprite = marker.userData.labelSprite;
        if (labelSprite) {
            const shouldShow = cityLabelsVisible && showLabel && isOnVisibleSide && horizonFade > 0.3 && !isViewTransitioning;
            labelSprite.visible = shouldShow;

            labelSprite.renderOrder = 200;
            labelSprite.material.depthTest = true;

            if (shouldShow) {
                const inHorizonView = horizonBlendValue > 0.3;
                const horizonFactor = Math.min(1, horizonBlendValue * 2);

                const markerPos = marker.position;
                // NOTE: cameraPos is the NORMALIZED camera direction (for the
                // visibility dot product) — distances must use camera.position
                const distToCamera = markerPos.distanceTo(camera.position);

                const baseHeight = (30 + markerScale * 20) * groundShrink;
                // Horizon signposts grow aggressively with distance: the
                // quadratic term cancels Earth-curvature drop (d²/2R) and the
                // linear term adds ~1° of skyline clearance — far cities peek
                // just above the horizon line, near ones stay at post height
                const minSignpostHeight = 1.5;
                const signpostHeight = inHorizonView
                    ? Math.min(60, minSignpostHeight + distToCamera * 0.02 +
                        (distToCamera * distToCamera) / (2 * EARTH_RADIUS))
                    : baseHeight;
                const cityTerrainH = elevationEnabled ? Math.max(0,
                    (sampleElevationBestEffort(city.lat, city.lon,
                        IMAGERY_ZOOM_MAX - ELEVATION_ZOOM_DELTA,
                        IMAGERY_ZOOM_MIN - ELEVATION_ZOOM_DELTA) || 0)) / METERS_PER_SCENE_UNIT : 0;
                const labelPos = _tv2.copy(markerPos).normalize().multiplyScalar(EARTH_RADIUS + cityTerrainH + signpostHeight);
                labelSprite.position.copy(labelPos);

                // Screen-constant sizing (world scale proportional to true
                // camera distance); clamps preserve the far-zoom look
                const baseScale = labelSprite.userData.baseScale;
                const distToCameraLabel = labelPos.distanceTo(camera.position);
                const orbitalScale = distToCameraLabel * 0.0008;
                // Flat angular size in horizon too — the old proximity blend
                // shrank the nearest city's text, which read as a glitch
                const horizonScale = distToCameraLabel * 0.0008;
                const scaleMultiplier = orbitalScale * (1 - horizonFactor) + horizonScale * horizonFactor;
                const maxLabelScale = inHorizonView ? 0.4 : 2;
                const clampedScale = Math.min(scaleMultiplier, maxLabelScale);
                labelSprite.scale.set(baseScale.x * clampedScale, baseScale.y * clampedScale, 1);

                labelSprite.material.opacity = horizonFade * 0.8;

                if (marker !== hoveredCity) {
                    if (inSunlight) {
                        labelSprite.material.color.set(sunCityColor);
                    } else {
                        labelSprite.material.color.set(moonCityColor);
                    }
                    if (!labelSprite.userData.originalColor) labelSprite.userData.originalColor = new THREE.Color();
                    labelSprite.userData.originalColor.copy(labelSprite.material.color);
                }
            }
        }
    });

    // Batch-sync InstancedMesh updates
    if (instanceDirty) cityInstancedMesh.instanceMatrix.needsUpdate = true;
    if (colorDirty && cityInstancedMesh.instanceColor) cityInstancedMesh.instanceColor.needsUpdate = true;
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
function latLonToCartesian(lat, lon, radius, out) {
    const latRad = THREE.MathUtils.degToRad(lat);
    const lonRad = THREE.MathUtils.degToRad(lon);

    const x = radius * Math.cos(latRad) * Math.cos(lonRad);
    const y = radius * Math.cos(latRad) * Math.sin(lonRad);
    const z = radius * Math.sin(latRad);

    if (out) return out.set(x, y, z);
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
function updateFocusHighlight(delta) {
    const focusLat = focusPointLat;
    const focusLon = focusPointLon;

    // Update focus marker - bouncy arrow
    if (focusMarker) {
        // Bounce animation - only when PINNED (earth mode), delta-time based
        const bounce = focusLocked
            ? (focusMarker.userData.bounceTime += delta * 3.6,
               Math.sin(focusMarker.userData.bounceTime * 2.5) * 50 +
               Math.sin(focusMarker.userData.bounceTime * 1.3) * 25)
            : 0;

        const inHorizonMode = horizonBlendValue > 0.5;

        // Ground-anchored UI (cone, pointer compass, spot) was sized for the
        // old ≥1000 km viewing range; shrink it and pull it down proportionally
        // as the camera descends so it keeps constant apparent size and the
        // camera never flies past it. Released as horizon mode takes over.
        const uiAlt = camera.position.length() - EARTH_RADIUS;
        const uiShrink = THREE.MathUtils.lerp(
            THREE.MathUtils.clamp(uiAlt / POINTER_SHRINK_START_ALT, 0.05, 1),
            1,
            Math.min(1, horizonBlendValue * 2)
        );
        focusMarker.scale.setScalar(uiShrink);

        let markerPos;
        if (!focusLocked) {
            // UNPINNED mode: keep pointer directly below camera on Earth surface
            // The point on Earth below the camera is the camera position normalized to Earth radius
            const normalized = _tv1.copy(camera.position).normalize();
            focusPointLat = Math.asin(normalized.z) * 180 / Math.PI;
            focusPointLon = Math.atan2(normalized.y, normalized.x) * 180 / Math.PI;

            // Update timezone tracking to prevent sun/moon jumping
            updateSliderForTimezone();

            // Position pointer above this point (static in unpinned mode)
            const height = (focusMarker.userData.baseHeight || 500) * uiShrink;
            markerPos = _tv2.copy(normalized).multiplyScalar(EARTH_RADIUS + height);
        } else {
            // PINNED mode: position based on lat/lon with bounce
            const height = (inHorizonMode
                ? focusMarker.userData.baseHeight + 300
                : focusMarker.userData.baseHeight) * uiShrink;
            markerPos = latLonToCartesian(focusLat, focusLon, EARTH_RADIUS + height + bounce * uiShrink, _tv2);
        }
        focusMarker.position.copy(markerPos);

        // Point arrow tip toward Earth (cone tip is +Y, so +Y should point toward center)
        const outward = _tv3.copy(markerPos).normalize();
        focusMarker.quaternion.setFromUnitVectors(_tv4.set(0, 1, 0), outward.negate());

        // Hide arrow (frustum) when in horizon mode
        const arrow = focusMarker.userData.arrow;
        if (arrow) {
            arrow.visible = !isViewTransitioning && horizonBlendValue < 0.3;
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
            // Position on Earth's surface below the pointer; the spot shrinks
            // and settles with the approach so it stays a "dot", not a region
            const spotRaise = Math.max(1.5, SPOT_POS_RAISE * uiShrink);
            const spotPos = latLonToCartesian(focusPointLat, focusPointLon, EARTH_RADIUS + spotRaise, _tv3);
            spotOutline.position.copy(spotPos);
            spotOutline.scale.setScalar(uiShrink);
            spotFill.position.copy(latLonToCartesian(focusPointLat, focusPointLon, EARTH_RADIUS + spotRaise + 1, _tv4));
            spotFill.scale.setScalar(uiShrink);

            // Orient to face outward from Earth
            spotOutline.lookAt(0, 0, 0);
            spotOutline.rotateX(Math.PI);
            spotFill.lookAt(0, 0, 0);
            spotFill.rotateX(Math.PI);

            // Compute compass orientation data (used by both ground and pointer compass)
            const radialUp = _tv4.copy(spotPos).normalize();
            const globalNorth = _tv5.set(0, 0, 1);
            const gnDotUp = globalNorth.dot(radialUp);
            const horizonNorth = globalNorth.sub(_tv6.copy(radialUp).multiplyScalar(gnDotUp));
            if (horizonNorth.length() < 0.001) {
                horizonNorth.set(1, 0, 0);
            }
            horizonNorth.normalize();
            const horizonEast = _tv6.crossVectors(horizonNorth, radialUp).normalize();

            // Build rotation matrix for compass: +X=east, +Y=north, +Z=up
            _tm1.makeBasis(horizonEast, horizonNorth, radialUp);
            const compassMatrix = _tm1;

            // Calculate sun azimuth (sun direction is essentially constant from any point on Earth)
            let sunAzimuth = 0;
            {
                const sunDotUp = currentSunDir.dot(radialUp);
                const sunHoriz = _tv7.copy(currentSunDir).sub(_tv8.copy(radialUp).multiplyScalar(sunDotUp));
                if (sunHoriz.length() > 0.001) {
                    sunHoriz.normalize();
                    sunAzimuth = Math.atan2(sunHoriz.dot(horizonEast), sunHoriz.dot(horizonNorth));
                }
            }

            // Calculate moon azimuth (moon direction is essentially constant from any point on Earth)
            let moonAzimuth = 0;
            {
                const moonDotUp = currentMoonDir.dot(radialUp);
                const moonHoriz = _tv7.copy(currentMoonDir).sub(_tv8.copy(radialUp).multiplyScalar(moonDotUp));
                if (moonHoriz.length() > 0.001) {
                    moonHoriz.normalize();
                    moonAzimuth = Math.atan2(moonHoriz.dot(horizonEast), moonHoriz.dot(horizonNorth));
                }
            }

            // Show compass in horizon view, hide regular spot
            const inHorizon = isViewTransitioning || horizonBlendValue > 0.3;
            // Ground UI sits just above the imagery rings (riding the local
            // terrain height); while the globe's fake displacement is still
            // fading mid-transition, ride above it instead
            const groundRaise = Math.max(GROUND_UI_RAISE, SPOT_POS_RAISE * (1 - horizonBlendValue)) + elevationCamLift;
            const groundPos = latLonToCartesian(focusPointLat, focusPointLon, EARTH_RADIUS + groundRaise, _tv7);
            if (compassGroup) {
                compassGroup.visible = inHorizon;

                // Update sun/moon direction lines (now separate from compassGroup)
                const { sunLineGroup, moonLineGroup } = focusMarker.userData;
                if (sunLineGroup) {
                    sunLineGroup.visible = inHorizon;
                    if (inHorizon) {
                        sunLineGroup.position.copy(groundPos);
                        sunLineGroup.setRotationFromMatrix(compassMatrix);
                        sunLineGroup.rotateZ(-sunAzimuth);
                    }
                }
                if (moonLineGroup) {
                    moonLineGroup.visible = inHorizon;
                    if (inHorizon) {
                        moonLineGroup.position.copy(groundPos);
                        moonLineGroup.setRotationFromMatrix(compassMatrix);
                        moonLineGroup.rotateZ(-moonAzimuth);
                    }
                }

                // Update sun/moon fill bars based on altitude (degrees)
                // Direct mapping: 0° (horizon) = full, -90° (nadir) = empty, above 0° = full
                const { sunFill, moonFill, sunFillH, moonFillH, sunBorder: sBorder, moonBorder: mBorder } = focusMarker.userData;
                if (sunFill) {
                    const sunLinear = currentSunAltDeg >= 0 ? 1.0 : Math.max(0, 1 + currentSunAltDeg / 90);
                    const sunFrac = sunLinear * sunLinear * sunLinear; // cubic: drains aggressively
                    sunFill.scale.y = Math.max(0.001, sunFrac);
                    sunFill.position.y = sBorder + sunFillH * sunFrac / 2;
                }
                if (moonFill) {
                    const moonLinear = currentMoonAltDeg >= 0 ? 1.0 : Math.max(0, 1 + currentMoonAltDeg / 90);
                    const moonFrac = moonLinear * moonLinear * moonLinear;
                    moonFill.scale.y = Math.max(0.001, moonFrac);
                    moonFill.position.y = mBorder + moonFillH * moonFrac / 2;
                }

                if (inHorizon) {
                    compassGroup.position.copy(groundPos);
                    compassGroup.setRotationFromMatrix(compassMatrix);
                }

                // Fade spot out in horizon view
                const spotOpacity = isViewTransitioning ? 0 : (inHorizon ? Math.max(0, 1 - horizonBlendValue * 3.33) : 0.9);
                spotFill.material.opacity = spotOpacity;
                spotOutline.material.opacity = spotOpacity;
                spotFill.visible = spotOpacity > 0.01;
                spotOutline.visible = spotOpacity > 0.01;
            }

            // Update pointer compass (on cone base) - show when not in horizon view
            const { pointerCompassGroup, pSunLineGroup, pMoonLineGroup } = focusMarker.userData;
            if (pointerCompassGroup) {
                pointerCompassGroup.visible = !isViewTransitioning && horizonBlendValue < 0.3;

                if (pointerCompassGroup.visible) {
                    // Transform compass orientation into focusMarker's local space
                    const invQuaternion = _tq1.copy(focusMarker.quaternion).invert();
                    const localNorth = _tv7.copy(horizonNorth).applyQuaternion(invQuaternion);
                    const localEast = _tv8.copy(horizonEast).applyQuaternion(invQuaternion);
                    const localUp = _tv9.copy(radialUp).applyQuaternion(invQuaternion);

                    // Compass: +X = east, +Y = north, +Z = up (face visible from above cone)
                    _tm1.makeBasis(localEast, localNorth, localUp);
                    pointerCompassGroup.setRotationFromMatrix(_tm1);

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
    if (isViewTransitioning || horizonBlendValue > 0.1) {
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
    latLonToCartesian(focusLat, focusLon, EARTH_RADIUS, _tv1);
    const radialUp = _tv2.copy(_tv1).normalize();
    const globalNorth = _tv3.set(0, 0, 1);
    const gnDotUp = globalNorth.dot(radialUp);
    const horizonNorth = globalNorth.sub(_tv4.copy(radialUp).multiplyScalar(gnDotUp)).normalize();
    const horizonEast = _tv4.crossVectors(horizonNorth, radialUp).normalize();

    // Position sun emoji
    const sunEl = document.getElementById('compass-sun');
    if (sunEl) {
        const sunVertical = currentSunDir.dot(radialUp);
        const sunHoriz = _tv5.copy(currentSunDir).sub(_tv6.copy(radialUp).multiplyScalar(sunVertical));
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
        const moonVertical = currentMoonDir.dot(radialUp);
        const moonHoriz = _tv5.copy(currentMoonDir).sub(_tv6.copy(radialUp).multiplyScalar(moonVertical));
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
 * Start a cinematic view transition (fall to Earth or liftoff to space)
 * @param {number} direction - 1 for falling in, -1 for blasting off
 */
function startViewTransition(direction) {
    if (isViewTransitioning) return;

    isViewTransitioning = true;
    viewTransitionProgress = 0;
    viewTransitionDirection = direction;
    transitionStartRadius = cameraRadius;

    if (direction === 1) {
        // FALLING IN - set up horizon entry
        // Snap camera to be centered on pointer
        if (focusLocked) {
            cameraRefLat = focusPointLat - dragOffsetLat;
            cameraRefLon = focusPointLon - dragOffsetLon;
        }

        // Set horizon entry yaw/pitch
        const target = getHorizonEntryTarget();
        horizonYaw = target.yaw;
        horizonPitch = 0;

        // Set isHorizonMode early so setCameraFromSpherical blend path works
        isHorizonMode = true;
        updateViewZoomButton();
    }

}

/**
 * Update cinematic view transition animation each frame
 * @param {number} delta - Frame delta time in seconds
 */
function updateViewTransition(delta) {
    if (!isViewTransitioning) return;

    const duration = viewTransitionDirection === 1 ? FALL_DURATION : LIFTOFF_DURATION;
    viewTransitionProgress += delta / duration;

    if (viewTransitionProgress >= 1) {
        viewTransitionProgress = 1;
    }

    // Ease-in-out cubic
    const t = viewTransitionProgress;
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    if (viewTransitionDirection === 1) {
        // FALLING IN - horizonBlendValue drives the radius blend in setCameraFromSpherical
        // Keep cameraRadius at start value; the blend lerps effective radius to HORIZON_CAMERA_HEIGHT
        horizonBlendValue = eased;
    } else {
        // BLASTING OFF - animate cameraRadius outward while blend fades
        cameraRadius = CAMERA_MIN_RADIUS + (TRANSITION_RADIUS - CAMERA_MIN_RADIUS) * eased;
        horizonBlendValue = 1 - eased;
    }

    // Update zoom slider to track animated position
    updateZoomSlider();

    // Check if transition is complete
    if (viewTransitionProgress >= 1) {
        if (viewTransitionDirection === 1) {
            // Fall complete
            horizonBlendValue = 1;
            isHorizonMode = true;
            cameraRadius = CAMERA_MIN_RADIUS;

            // If sun/moon lock is active, smoothly animate to look at target
            if (zoomTargetMode !== 2) {
                const target = getHorizonEntryTarget();
                animationStartYaw = horizonYaw;
                animationStartPitch = horizonPitch;
                targetYaw = target.yaw;
                targetPitch = target.pitch;
                animationProgress = 0;
                isAnimatingToTarget = true;
            }
        } else {
            // Liftoff complete
            horizonBlendValue = 0;
            isHorizonMode = false;
            cameraRadius = TRANSITION_RADIUS;
            updateViewZoomButton();
        }

        isViewTransitioning = false;
        transitionCooldownUntil = performance.now() + 400;
        updateBridgeState();
        updateZoomSlider();
    }
}

/**
 * Update the view mode based on zoom level and animate the transition
 * Called every frame from animate()
 */
function updateViewMode(delta) {
    // During cinematic transitions, skip normal mode switching - transition controls everything
    if (isViewTransitioning) return;
    // Check if we should switch modes based on threshold
    const shouldBeHorizon = cameraRadius < TRANSITION_RADIUS;

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
    const effectiveRadius = radius * (1 - easedBlend) + (HORIZON_CAMERA_HEIGHT + elevationCamLift) * easedBlend;

    // Calculate camera position using the effective (possibly blended) radius
    const camPos = _tv1.set(
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
        const radialUp = _tv2.copy(camPos).normalize();
        const globalNorth = _tv3.set(0, 0, 1);
        const gnDotUp = globalNorth.dot(radialUp);
        const horizonNorth = globalNorth.sub(_tv4.copy(radialUp).multiplyScalar(gnDotUp)).normalize();
        const horizonEast = _tv4.crossVectors(horizonNorth, radialUp).normalize();

        const lookDir = _tv5.copy(horizonNorth).multiplyScalar(Math.cos(horizonYaw) * Math.cos(horizonPitch));
        lookDir.add(_tv6.copy(horizonEast).multiplyScalar(Math.sin(horizonYaw) * Math.cos(horizonPitch)));
        lookDir.add(_tv6.copy(radialUp).multiplyScalar(Math.sin(horizonPitch)));

        const horizonLookAt = _tv6.copy(camPos).addScaledVector(lookDir, 1000);

        camera.up.copy(radialUp);
        camera.lookAt(horizonLookAt);
    } else {
        // Transitioning - blend between orbital and horizon
        const radialUp = _tv2.copy(camPos).normalize();
        const globalNorth = _tv3.set(0, 0, 1);
        const gnDotUp = globalNorth.dot(radialUp);
        const horizonNorth = globalNorth.sub(_tv4.copy(radialUp).multiplyScalar(gnDotUp)).normalize();
        const horizonEast = _tv4.crossVectors(horizonNorth, radialUp).normalize();

        const lookDir = _tv5.copy(horizonNorth).multiplyScalar(Math.cos(horizonYaw) * Math.cos(horizonPitch));
        lookDir.add(_tv6.copy(horizonEast).multiplyScalar(Math.sin(horizonYaw) * Math.cos(horizonPitch)));
        lookDir.add(_tv6.copy(radialUp).multiplyScalar(Math.sin(horizonPitch)));

        const horizonLookAt = _tv6.copy(camPos).addScaledVector(lookDir, 1000);
        const blendedLookAt = _tv7.set(0, 0, -600).lerp(horizonLookAt, easedBlend);
        const blendedUp = _tv8.set(0, 0, 1).lerp(radialUp, easedBlend).normalize();

        camera.up.copy(blendedUp);
        camera.lookAt(blendedLookAt);
    }
}

/**
 * Calculate yaw/pitch to look at a celestial body from current camera position
 * Returns { yaw, pitch } in radians for the horizon view system
 */
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
            _mouse.set(
                (e.clientX / window.innerWidth) * 2 - 1,
                -(e.clientY / window.innerHeight) * 2 + 1
            );
            _raycaster.setFromCamera(_mouse, camera);
            if (_raycaster.ray.intersectSphere(_earthSphere, _hitPoint) && focusMarker) {
                // Store offset from hit point to pointer's Earth-surface projection
                const pointerOnEarth = _tv1.copy(focusMarker.position).normalize().multiplyScalar(EARTH_RADIUS);
                pointerDragOffset.copy(pointerOnEarth).sub(_hitPoint);
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
                // Orbital view mode - rotate camera around Earth. Degrees per
                // pixel scale with altitude so dragging feels like grabbing the
                // ground at any zoom (the old 0.095°/px floor was ~10 km/px low)
                const sensitivity = THREE.MathUtils.clamp((cameraRadius - EARTH_RADIUS) * 0.00001, 0.0015, 0.2);
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
        _mouse.set(
            (e.clientX / window.innerWidth) * 2 - 1,
            -(e.clientY / window.innerHeight) * 2 + 1
        );
        _raycaster.setFromCamera(_mouse, camera);

        // Get all meshes from the focusMarker
        const pointerMeshes = [];
        if (focusMarker) {
            focusMarker.traverse(obj => {
                if (obj.isMesh && (obj.name === 'pointerCone' || obj.name === 'pointerShaft')) {
                    pointerMeshes.push(obj);
                }
            });
        }

        const intersects = _raycaster.intersectObjects(pointerMeshes, false);
        if (intersects.length > 0) {
            toggleFocusLock();
        }
    });

    // Hover detection for pointer
    canvas.addEventListener('mousemove', (e) => {
        if (!focusMarker) return;

        _mouse.set(
            (e.clientX / window.innerWidth) * 2 - 1,
            -(e.clientY / window.innerHeight) * 2 + 1
        );
        _raycaster.setFromCamera(_mouse, camera);

        const pointerMeshes = [];
        focusMarker.traverse(obj => {
            if (obj.isMesh && (obj.name === 'pointerCone' || obj.name === 'pointerShaft')) {
                pointerMeshes.push(obj);
            }
        });

        const intersects = _raycaster.intersectObjects(pointerMeshes, false);
        const isHovered = !isViewTransitioning && intersects.length > 0;

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
        if (isViewTransitioning) return;  // Block all zoom during cinematic transition

        const wasAtMin = cameraRadius <= CAMERA_MIN_RADIUS + 10;
        const wasInHorizonMode = cameraRadius < TRANSITION_RADIUS;
        const zoomingIn = e.deltaY < 0;

        // If already in horizon mode, control FOV instead of radius
        if (wasAtMin && wasInHorizonMode) {
            const fovSpeed = 3;
            if (zoomingIn) {
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
            } else {
                // Zoom out - increase FOV first, then trigger liftoff transition
                if (camera.fov < DEFAULT_FOV) {
                    camera.fov = Math.min(DEFAULT_FOV, camera.fov + fovSpeed);
                } else {
                    // FOV is back to default, trigger liftoff transition
                    startViewTransition(-1);
                }
            }
            camera.updateProjectionMatrix();
        } else {
            // Orbital zoom: proportional to altitude — each tick changes height
            // above the surface by a fixed percentage, so steps are gentle near
            // the planet and fast when far out (no flat-step jumps)
            const ticks = THREE.MathUtils.clamp(Math.abs(e.deltaY) / 100, 0.2, 2);
            const factor = Math.pow(ORBITAL_ZOOM_STEP, ticks);
            const altitude = cameraRadius - EARTH_RADIUS;
            const newRadius = EARTH_RADIUS + (zoomingIn ? altitude / factor : altitude * factor);
            if (zoomingIn && cameraRadius >= TRANSITION_RADIUS && newRadius < TRANSITION_RADIUS) {
                // Would cross the boundary - trigger cinematic fall instead
                startViewTransition(1);
                return;
            }
            cameraRadius = newRadius;
        }
        // Clamp orbital zoom to TRANSITION_RADIUS — below that requires cinematic transition
        if (!isHorizonMode) {
            cameraRadius = THREE.MathUtils.clamp(cameraRadius, TRANSITION_RADIUS, ORBITAL_MAX_RADIUS);
        }

        // Reset FOV when leaving horizon mode
        if (cameraRadius > TRANSITION_RADIUS && camera.fov !== DEFAULT_FOV) {
            camera.fov = DEFAULT_FOV;
            camera.updateProjectionMatrix();
        }

        // Track active zooming in for pointer alignment
        if (zoomingIn && cameraRadius > TRANSITION_RADIUS) {
            isZoomingIn = true;
            clearTimeout(zoomingInTimeout);
            zoomingInTimeout = setTimeout(() => { isZoomingIn = false; }, 150);
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

        _mouse.set(
            (clientX / window.innerWidth) * 2 - 1,
            -(clientY / window.innerHeight) * 2 + 1
        );
        _raycaster.setFromCamera(_mouse, camera);

        const pointerMeshes = [];
        focusMarker.traverse(obj => {
            if (obj.isMesh && (obj.name === 'pointerCone' || obj.name === 'pointerShaft')) {
                pointerMeshes.push(obj);
            }
        });

        const intersects = _raycaster.intersectObjects(pointerMeshes, false);
        return intersects.length > 0;
    }

    function updatePointerDragPosition(clientX, clientY) {
        // Raycast to find where on Earth the cursor/touch is pointing
        _mouse.set(
            (clientX / window.innerWidth) * 2 - 1,
            -(clientY / window.innerHeight) * 2 + 1
        );
        _raycaster.setFromCamera(_mouse, camera);

        if (!_raycaster.ray.intersectSphere(_earthSphere, _hitPoint)) {
            // Mouse is off the earth - find closest point on earth to the ray
            _raycaster.ray.closestPointToPoint(_tv1.set(0, 0, 0), _hitPoint);
            _hitPoint.normalize().multiplyScalar(EARTH_RADIUS);
        }

        // For mouse drag, apply offset so pointer doesn't jump
        if (isMousePointerDrag) {
            _hitPoint.add(pointerDragOffset);
            // Re-normalize to Earth surface after adding offset
            _hitPoint.normalize().multiplyScalar(EARTH_RADIUS);
        }

        // Update lat/lon directly (in unpinned mode, pointer follows camera which centers on this point)
        const normalized = _hitPoint.normalize();
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
                // Orbital view mode - degrees per pixel scale with altitude
                // (same grab-the-ground rule as the mouse drag)
                const sensitivity = THREE.MathUtils.clamp((cameraRadius - EARTH_RADIUS) * 0.00001, 0.0015, 0.2);
                dragOffsetLon = -deltaX * sensitivity;
                dragOffsetLat = deltaY * sensitivity;
                const totalLat = cameraRefLat + dragOffsetLat;
                if (totalLat > 89) dragOffsetLat = 89 - cameraRefLat;
                if (totalLat < -89) dragOffsetLat = -89 - cameraRefLat;
            }
        } else if (e.touches.length === 2) {
            // Two finger pinch - zoom
            if (isViewTransitioning) { return; }  // Block during cinematic transition

            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (lastTouchDistance > 0) {
                const zoomingIn = distance > lastTouchDistance;
                const wasAtMin = cameraRadius <= CAMERA_MIN_RADIUS + 10;
                const wasInHorizonMode = cameraRadius < TRANSITION_RADIUS;

                // If already in horizon mode, control FOV instead of radius
                if (wasAtMin && wasInHorizonMode) {
                    const fovSpeed = Math.abs(distance - lastTouchDistance) * 2;
                    if (zoomingIn) {
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
                    } else {
                        // Zoom out - increase FOV first, then trigger liftoff transition
                        if (camera.fov < DEFAULT_FOV) {
                            camera.fov = Math.min(DEFAULT_FOV, camera.fov + fovSpeed);
                        } else {
                            // FOV is back to default, trigger liftoff transition
                            startViewTransition(-1);
                        }
                    }
                    camera.updateProjectionMatrix();
                } else {
                    // Orbital zoom: altitude scales with the pinch ratio, so
                    // steps stay gentle near the planet
                    const altitude = cameraRadius - EARTH_RADIUS;
                    const newRadius = EARTH_RADIUS + altitude * (lastTouchDistance / Math.max(1, distance));
                    if (zoomingIn && cameraRadius >= TRANSITION_RADIUS && newRadius < TRANSITION_RADIUS) {
                        startViewTransition(1);
                        lastTouchDistance = distance;
                        return;
                    }
                    cameraRadius = newRadius;
                }
                if (!isHorizonMode) {
                    cameraRadius = THREE.MathUtils.clamp(cameraRadius, TRANSITION_RADIUS, ORBITAL_MAX_RADIUS);
                }

                // Reset FOV when leaving horizon mode
                if (cameraRadius > TRANSITION_RADIUS && camera.fov !== DEFAULT_FOV) {
                    camera.fov = DEFAULT_FOV;
                    camera.updateProjectionMatrix();
                }

                // Track active zooming in for pointer alignment
                if (zoomingIn && cameraRadius > TRANSITION_RADIUS) {
                    isZoomingIn = true;
                    clearTimeout(zoomingInTimeout);
                    zoomingInTimeout = setTimeout(() => { isZoomingIn = false; }, 150);
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
                    _mouse.set(
                        (touch.clientX / window.innerWidth) * 2 - 1,
                        -(touch.clientY / window.innerHeight) * 2 + 1
                    );
                    _raycaster.setFromCamera(_mouse, camera);

                    // Check if tapped on a city first
                    const visibleLabels = cityMarkers.map(m => m.userData.labelSprite).filter(l => l && l.visible);
                    const labelHits = _raycaster.intersectObjects(visibleLabels, false);
                    const markerHits = cityInstancedMesh && cityInstancedMesh.visible
                        ? _raycaster.intersectObject(cityInstancedMesh, false) : [];
                    const cityIntersects = [...labelHits, ...markerHits];

                    if (cityIntersects.length > 0) {
                        // Tapped on a city - handled by existing onTouchStart
                    } else {
                        // Tapped on Earth surface - move pointer there
                        if (_raycaster.ray.intersectSphere(_earthSphere, _hitPoint)) {
                            const normalized = _hitPoint.normalize();
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
const FRAME_INTERVAL = 1000 / 60; // Cap at 60fps

function animate() {
    if (!isTabVisible) return;
    requestAnimationFrame(animate);

    // Calculate delta time
    const now = performance.now();
    const elapsed = now - lastTime;
    if (elapsed < FRAME_INTERVAL) return; // Skip frame if too soon
    const delta = elapsed / 1000;  // Convert to seconds
    lastTime = now - (elapsed % FRAME_INTERVAL); // Preserve remainder for smooth timing

    // Update simulation
    updateSimulation(now);

    // One coalesced UI refresh per frame for time scrubbing: slider/wheel
    // input events can outpace frames 2-3x, so their handlers only set this
    // flag (updateSimulation clears it when it already refreshed this frame)
    if (timeUiDirty) {
        timeUiDirty = false;
        updateTimeDisplay();
        updatePositionDisplay();
        updateEventMarkers();
    }

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
        const zoomRangeLeft = cameraRadius - TRANSITION_RADIUS;
        const totalZoomRange = ORBITAL_MAX_RADIUS - TRANSITION_RADIUS;
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

    // Continuously track sun/moon when locked in horizon mode (skip during transition)
    if (isHorizonMode && zoomTargetMode !== 2 && !isAnimatingToTarget && !isViewTransitioning) {
        const target = getHorizonEntryTarget();
        horizonYaw = target.yaw;
        horizonPitch = target.pitch;
    }

    // Update cinematic view transition (fall/liftoff animation)
    updateViewTransition(delta);

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
        _tq1.setFromAxisAngle(_tv1.set(0, 0, 1), lonRad);
        _tq2.setFromAxisAngle(_tv1.set(0, 1, 0), -latRad);
        referenceCube.quaternion.copy(_tq1).multiply(_tq2);
    }

    // Update sun and moon positions (real-time)
    updateCelestialPositions();

    // Update planet positions on celestial sphere
    updatePlanetPositions();

    // Rotate celestial sphere by GMST (Earth's sidereal rotation)
    if (celestialSphereGroup) {
        const gmstDeg = getGMST(dateToJulianDay(getAbsoluteSimulatedTime()));
        celestialSphereGroup.rotation.z = -THREE.MathUtils.degToRad(gmstDeg);

        // Toggle star and planet labels independently based on horizon blend + user toggles
        const inHorizon = horizonBlendValue > 0.5;
        const showStarLabels = starLabelsEnabled && inHorizon;
        const showPlanetLabels = planetLabelsEnabled && inHorizon;
        for (let i = 0; i < starLabelSprites.length; i++) {
            starLabelSprites[i].visible = showStarLabels;
        }
        for (let i = 0; i < planetSprites.length; i++) {
            planetSprites[i].label.visible = showPlanetLabels;
        }
    }

    // Update ghost celestial indicators (through-earth visibility)
    updateGhostCelestials();

    // Update celestial trail positions
    updateCelestialTrails();

    // Update HD imagery rings (streams Sentinel-2 tiles, fades globe displacement in horizon mode)
    updateImagery();

    // Update focus highlight position on sphere
    updateFocusHighlight(delta);

    // Update compass HUD in horizon view
    updateCompass();

    // Update label sizes based on proximity and hover
    updateLabelScales();

    // Update system time display
    updateSystemTime();

    // Update URL hash for shareable links
    throttledUrlUpdate(now);

    renderer.render(scene, camera);

    // Performance overlay — toggled with P key
    if (!window._pm) {
        const el = document.createElement('div');
        el.id = 'perf-overlay';
        el.innerHTML = '<canvas width="240" height="64"></canvas><div></div>';
        el.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);border-radius:6px;z-index:99999;pointer-events:none;display:none;padding:8px 10px 6px;font:10px/1.3 "SF Mono",Consolas,monospace;color:#ccc';
        el.lastElementChild.style.cssText = 'margin-top:4px;white-space:pre';
        document.body.appendChild(el);
        const ctx = el.firstElementChild.getContext('2d');
        window._pm = {
            el, ctx,
            visible: false,
            lastFrame: performance.now(),
            lastUpdate: performance.now(),
            times: [],        // rolling frame times
            fpsHistory: [],   // last 120 FPS samples for graph
        };
        document.addEventListener('keydown', (e) => {
            if (e.key === 'p' || e.key === 'P') {
                window._pm.visible = !window._pm.visible;
                window._pm.el.style.display = window._pm.visible ? 'block' : 'none';
            }
        });
    }
    const pm = window._pm;
    const frameNow = performance.now();
    pm.times.push(frameNow - pm.lastFrame);
    pm.lastFrame = frameNow;
    if (pm.times.length > 300) pm.times.shift();

    if (pm.visible && frameNow - pm.lastUpdate > 250) {
        pm.lastUpdate = frameNow;
        const t = pm.times;
        // Instantaneous FPS from last 10 frames
        const recent = t.slice(-10);
        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const fps = Math.round(1000 / recentAvg);
        // Percentiles from full window
        const sorted = [...t].sort((a, b) => a - b);
        const avg = t.reduce((a, b) => a + b, 0) / t.length;
        const p1 = sorted[Math.floor(sorted.length * 0.01)];
        const p99 = sorted[Math.floor(sorted.length * 0.99)];
        const mem = renderer.info.memory;
        const r = renderer.info.render;
        const heap = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) : '?';

        // Push to graph history
        pm.fpsHistory.push(fps);
        if (pm.fpsHistory.length > 120) pm.fpsHistory.shift();

        // Draw FPS graph
        const ctx = pm.ctx;
        const w = 240, h = 64;
        ctx.clearRect(0, 0, w, h);

        // Grid lines at 30 and 60 fps
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        for (const target of [30, 60]) {
            const y = h - (target / 80) * h;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        // FPS bars
        const bars = pm.fpsHistory;
        const barW = w / 120;
        for (let i = 0; i < bars.length; i++) {
            const v = Math.min(bars[i], 80);
            const barH = (v / 80) * h;
            // Color: green > 55, yellow 30-55, red < 30
            if (v >= 55) ctx.fillStyle = 'rgba(80,220,100,0.8)';
            else if (v >= 30) ctx.fillStyle = 'rgba(230,180,50,0.8)';
            else ctx.fillStyle = 'rgba(220,60,60,0.8)';
            ctx.fillRect(i * barW, h - barH, barW - 0.5, barH);
        }

        // 60fps label
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '9px SF Mono,Consolas,monospace';
        ctx.fillText('60', 1, h - (60 / 80) * h - 2);

        // Stats text
        const fpsColor = fps >= 55 ? '#6e6' : fps >= 30 ? '#ec3' : '#e55';
        pm.el.lastElementChild.innerHTML =
            `<span style="color:${fpsColor};font-weight:bold">${fps} FPS</span>` +
            `  <span style="color:#999">${avg.toFixed(1)}ms</span>` +
            `  <span style="color:#666">1%</span> <span style="color:#999">${p1.toFixed(0)}ms</span>` +
            `  <span style="color:#666">99%</span> <span style="color:#999">${p99.toFixed(0)}ms</span>\n` +
            `<span style="color:#888">draw ${r.calls}  tri ${(r.triangles/1000).toFixed(0)}K  geo ${mem.geometries}  tex ${mem.textures}  heap ${heap}MB</span>`;
    }
}


function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    updateCelestialContainerPosition();
}

function updateCelestialContainerPosition() {
    // No-op — portrait mode handled via CSS media queries
}

// UI visibility toggle - 3 states: 0 = full, 1 = bottom hidden, 2 = all hidden
let uiVisibilityState = 0;

function setupUIVisibilityToggle() {
    const toggleBtn = document.getElementById('ui-visibility-toggle');
    const positionDisplay = document.getElementById('position-display');
    const celestialTopDisplay = document.getElementById('celestial-top-display');
    const leftControls = document.getElementById('left-controls');
    const rightControls = document.getElementById('right-controls');

    if (!toggleBtn) return;

    toggleBtn.addEventListener('click', () => {
        uiVisibilityState = (uiVisibilityState + 1) % 3;

        // State 0: Full UI visible
        // State 1: Bottom UI hidden (position-display)
        // State 2: All UI hidden (bottom + left controls + zoom slider)

        toggleBtn.classList.toggle('hidden', uiVisibilityState >= 1);
        positionDisplay.classList.toggle('ui-hidden', uiVisibilityState >= 1);
        celestialTopDisplay.classList.toggle('ui-hidden', uiVisibilityState >= 1);
        leftControls.classList.toggle('ui-hidden', uiVisibilityState >= 2);
        rightControls.classList.toggle('ui-hidden', uiVisibilityState >= 2);
    });
}

// Loading overlay (animation is pure CSS — see style.css)
const loadingStartTime = performance.now();

async function hideLoadingOverlay() {
    // Ensure overlay shows for at least 2s so messages cycle visibly
    const elapsed = performance.now() - loadingStartTime;
    const minDisplayTime = 2000;
    if (elapsed < minDisplayTime) {
        await new Promise(r => setTimeout(r, minDisplayTime - elapsed));
    }
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.add('loading-hidden');
        setTimeout(() => overlay.remove(), 600);
    }
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
} else {
    init();
}
