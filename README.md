# Sky Calc — 3D Sun, Moon & Eclipse Simulator

### [**https://mitchell-currie.github.io/sky-calc/**](https://mitchell-currie.github.io/sky-calc/)

An intuitive tool for understanding the movement of celestial bodies and tracking celestial events. Figure out exactly where to look in the sky for tonight's moonrise, plan a date night under the stars, or explore 800 years of eclipses. Drop into first-person horizon view from any location on Earth and see exactly what the sky looks like — past, present, or future.

Built with Three.js and Swiss Ephemeris for sub-arcsecond accuracy. Real star catalogs, vector coastlines, planets from Mercury to Pluto, meteor shower radiants, and full eclipse visualization — all running in the browser with zero backend.

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
- **Orbital view** — zoom from beyond geostationary orbit down to 50 km altitude, rotate freely around the globe
- **Horizon view** — first-person perspective from ~1 km above the ground, look around the sky like a planetarium
- Cinematic animated transitions between views; zoom and drag sensitivity scale with altitude

### HD Satellite Imagery & 3D Terrain
- **Streamed Sentinel-2 imagery** (EOX s2cloudless) at up to 10 m/pixel — native satellite resolution underfoot in horizon view, via a clipmap ring system with priority loading centered on your position
- **Real 3D terrain** — AWS Terrain Tiles elevation applied to the same rings at true vertical scale; the camera and compass ride the local terrain height
- Imagery + terrain fade in automatically below 600 km altitude in orbital view
- The whole-globe base texture is a **baked Sentinel-2 cloudless 2025 mosaic** (16200 x 8100, assembled from 16,384 tiles), so orbital and horizon views match seamlessly
- Both toggleable — switch back to the classic globe any time

### Stars, Constellations & Planets
- **2,852 real stars** from the HYG v4.1 catalog with accurate color (B-V index) and magnitude
- **30 constellations** with line data from Stellarium
- **48 named stars** with labels
- **7 planets + Vesta, Ceres, Pluto** positioned via Swiss Ephemeris
- **Meteor shower radiants** — 12 showers from the IMO calendar with radiant drift, precessing activity windows, and historical gating (the Geminids switch on in 1862; the Andromedids die with comet Biela in 1899)
- **The Milky Way** — real Gaia DR2 imagery (NASA Deep Star Maps) accurately placed on the celestial sphere, dust lanes and Magellanic Clouds included

### Time Simulation
- **Live mode** synced to real time, or **manual control** at 13 speed levels (1 second per minute up to 30 days per second)
- Forward and reverse playback
- Timeline slider with sunrise/sunset and moonrise/moonset markers
- Date/time odometer for precise selection — any date from 1600 to 2400

### Interactive Globe
- **486 cities** with click-to-navigate — fly to any city and see local sun/moon data
- **Draggable focus pointer** with momentum physics — slide it across the globe
- **Vector coastlines, lakes, and rivers** from Natural Earth (1:10m resolution, 830K line segments); they hand off to satellite imagery as you descend
- **Water-only sun glint** — the ocean carries a soft specular reflection at the subsolar point (as satellites actually see it) while land stays matte; sunlight gates off past the local terminator with a brief alpenglow margin on mountain slopes

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
- **Custom GLSL shaders** for eclipse surface darkening, terminator lighting, water-only specular, star rendering, coastline back-face culling, and trail effects
- **Web Mercator tile streaming** — clipmap imagery rings with a priority fetch queue, prefetching, retry, and seam-morphed elevation
- **GPU optimized** — InstancedMesh batching, merged geometries, event/render decoupling, Page Visibility API, 60fps frame cap
- Runs entirely client-side as static files — no server, no API keys, no accounts

### Data Sources
| Data | Source |
|------|--------|
| Star positions & magnitudes | [HYG Star Database v4.1](https://github.com/astronexus/HYG-Database) |
| Constellation lines | [Stellarium](https://stellarium.org/) |
| Planetary ephemerides | [Swiss Ephemeris](https://www.astro.com/swisseph/) — incl. self-hosted 1200-1799 data files (`se*_12.se1`, AGPL/dual-licensed by Astrodienst) |
| Eclipse events (1600–2400) | [NASA Eclipse Website](https://eclipse.gsfc.nasa.gov/) |
| Coastlines, lakes, rivers | [Natural Earth](https://www.naturalearthdata.com/) (public domain) |
| Satellite imagery (globe + streamed tiles) | [Sentinel-2 cloudless](https://s2maps.eu) by [EOX IT Services GmbH](https://eox.at) — contains modified Copernicus Sentinel data, CC-BY-NC-SA, free for non-commercial use |
| Milky Way | [NASA/GSFC Scientific Visualization Studio — Deep Star Maps 2020](https://svs.gsfc.nasa.gov/4851); Gaia DR2: ESA/Gaia/DPAC |
| Terrain elevation | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen terrarium, open data) |

