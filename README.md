# Marine Drive Explorer

Walk and fly through South Mumbai: Marine Drive and the Back Bay curve, the promenade and its tetrapods, the Art Deco sea face, Girgaon Chowpatty, Malabar Hill, the Oval Maidan with the Rajabai Clock Tower, Churchgate and Nariman Point. Watch the sun set over the Arabian Sea and the Queen's Necklace light up.

Everything you see is drawn by code: no photos, textures, 3D models or sound files. The whole thing is one `index.html` of about 0.9 MB.

## Run it

- Double-click `index.html`. It opens straight from disk in Chrome, Edge, Safari or Firefox.
- Or run `start.command`, which serves it on http://localhost:8795.

## Controls

| | Computer | Phone / tablet |
|---|---|---|
| Look around | Drag with the mouse | Drag on the screen |
| Move | W A S D or arrow keys (Shift = faster) | Joystick, bottom left |
| Turn | Q / E | Drag |
| Fly / walk | **Fly** button or F | **Fly** button |
| Up / down while flying | Space / C, or mouse wheel | ▲ ▼ buttons |
| Sunset | ▶ button or P; slide the time bar | ▶ button, time bar |
| Jump to a place | **Places**, or keys 1 to 0 | **Places** |
| Sound | Speaker button or M | Speaker button |
| Performance numbers | H | |

**Detail** (top right on a computer) switches between Low, Medium and High and remembers your choice. Phones start on Medium or Low.

## What is real, and what is made up

- **Real (from OpenStreetMap):** the coastline, every road with its lane count, all ~6,000 building footprints, parks, the beach, maidans, stadiums, the railway tracks, the Malabar Hill forest walkway and ~1,500 mapped trees.
- **Estimated:** most building heights. Only about 600 buildings have a floor count in the map; the rest get a height that fits their neighbourhood (5–6 storey Art Deco along Marine Drive, towers on Malabar Hill and at Nariman Point, 3–5 storey chawls in Girgaon, Gothic stone buildings around the Oval). The shape of Malabar Hill follows the line of Ridge Road at about 50 m.
- **Made up by code:** facade styles and colours, extra street and park trees, the traffic, the trains and the moored boats. The city beyond the mapped area is generic filler so the horizon is not empty.
- The sun follows its real path over Mumbai on 21 November (sunset about 6 pm).

## Rebuild

Needs Node.js 18 or newer.

```bash
npm install
node tools/bake.mjs   # only if _raw/osm.json changed: map data -> src/data.js
node build.mjs        # src/ -> index.html
```

| File | What's inside |
|---|---|
| `src/data.js` | The baked map layout (generated) |
| `src/geo.js` | Coast distance field, Malabar Hill terrain, lookups |
| `src/sky.js` | Sun path for Mumbai, sky colours over the day, clouds, stars |
| `src/buildings.js` | Heights and styles by neighbourhood, the facade shader |
| `src/props.js` | Tetrapods, promenade wall, Queen's Necklace lamps, roof tanks, Art Deco balconies, stadiums, Rajabai Tower |
| `src/trees.js` | Rain trees, false ashoka, coconut palms, banyans, Indian almonds, shrubs |
| `src/water.js` | The sea: waves, reflections, sunset glitter, foam |
| `src/traffic.js` | Cars, black-and-yellow taxis, red BEST buses, scooters, local trains, boats |
| `src/main.js` | Renderer, shadows, controls, time of day, quality |

Map data © OpenStreetMap contributors, available under the Open Database Licence (ODbL).
