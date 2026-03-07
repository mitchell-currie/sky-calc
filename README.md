# Sky Calc — 3D Sun, Moon & Eclipse Simulator

### [**https://mitchell-currie.github.io/sky-calc/**](https://mitchell-currie.github.io/sky-calc/)

An intuitive tool for understanding the movement of celestial bodies and tracking celestial events. Figure out exactly where to look in the sky for tonight's moonrise, plan a date night under the stars, or explore 800 years of eclipses. Drop into first-person horizon view from any location on Earth and see exactly what the sky looks like — past, present, or future.

Built with Three.js and Swiss Ephemeris for sub-arcsecond accuracy. Real star catalogs, vector coastlines, 5 planets, and full eclipse visualization — all running in the browser with zero backend.

![Three.js](https://img.shields.io/badge/Three.js-r128-black?logo=three.js)
![Vanilla JS](https://img.shields.io/badge/Vanilla%20JS-No%20Framework-f7df1e?logo=javascript)
![Swiss Ephemeris](https://img.shields.io/badge/Swiss%20Ephemeris-WASM-blue)

---

## Features

### Sun & Moon Tracking
- **Sunrise, sunset, moonrise, moonset** times for any location — updated in real time
- **Altitude and azimuth** readouts for both sun and moon
- **Daylight duration** and countdown to next rise/set event
- **Moon phase**, illumination percentage, age, and distance
- Timezone-aware — automatically detects local time from 486 built-in cities

### Eclipse Visualization
- **Solar and lunar eclipse** simulation with physically accurate geometry
- 3D **umbra, penumbra, and antumbra** cone visualization
- Real-time **Earth surface darkening** via custom GLSL shader that computes moon-sun angular overlap per fragment
- **800 years of eclipse data** (1600–2400) sourced from NASA — jump to any eclipse instantly

### Two View Modes
- **Orbital view** — zoom from geostationary orbit down to treetop level, rotate freely around the globe
- **Horizon view** — first-person perspective from the ground, look around the sky like a planetarium
- Cinematic animated transitions between views

### Stars, Constellations & Planets
- **2,852 real stars** from the HYG v4.1 catalog with accurate color (B-V index) and magnitude
- **30 constellations** with line data from Stellarium
- **48 named stars** with labels
- **5 naked-eye planets** (Mercury, Venus, Mars, Jupiter, Saturn) positioned via Swiss Ephemeris

### Time Simulation
- **Live mode** synced to real time, or **manual control** at 13 speed levels (1 second per minute up to 30 days per second)
- Forward and reverse playback
- Timeline slider with sunrise/sunset and moonrise/moonset markers
- Date/time odometer for precise selection — any date from 1600 to 2400

### Interactive Globe
- **486 cities** with click-to-navigate — fly to any city and see local sun/moon data
- **Draggable focus pointer** with momentum physics — slide it across the globe
- **Vector coastlines, lakes, and rivers** from Natural Earth (1:10m resolution, 830K line segments)
- High-resolution Earth texture (16200 x 8100) with elevation displacement mapping

### Compass System
- **Orbital compass** at focus pointer base showing sun/moon bearing
- **Ground compass** in horizon view — full compass rose with cardinal markers
- Sun and moon direction indicators with altitude fill bars

### Celestial Trails & X-Ray View
- **24-hour sun/moon trail** paths showing orbital arcs
- **X-ray sun/moon** — see their positions even when behind Earth
- Toggle on/off independently

### Customization
- Color pickers for coastlines, ocean, land tint, sunlight, and city markers
- Toggle layers: coastlines, lakes, rivers, cities, labels, constellations, star names, grid, polar axis
- Shareable URLs — lat/lon, time, view state encoded in the URL hash

---

## Technical Details

- **Vanilla JavaScript** — no build tools, no framework, no bundler
- **Three.js r128** for 3D rendering with logarithmic depth buffer
- **Swiss Ephemeris (WASM)** for sub-arcsecond planetary positions
- **Custom GLSL shaders** for eclipse surface darkening, star rendering, coastline back-face culling, and trail effects
- **GPU optimized** — InstancedMesh batching, merged geometries, idle frame throttling, Page Visibility API
- Runs entirely client-side as static files — no server, no API calls, no accounts

### Data Sources
| Data | Source |
|------|--------|
| Star positions & magnitudes | [HYG Star Database v4.1](https://github.com/astronexus/HYG-Database) |
| Constellation lines | [Stellarium](https://stellarium.org/) |
| Planetary ephemerides | [Swiss Ephemeris](https://www.astro.com/swisseph/) |
| Eclipse events (1600–2400) | [NASA Eclipse Website](https://eclipse.gsfc.nasa.gov/) |
| Coastlines, lakes, rivers, Earth texture | [Natural Earth](https://www.naturalearthdata.com/) (public domain) |

