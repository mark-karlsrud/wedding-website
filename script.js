import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ── Constants ─────────────────────────────────────────────── */
const SCALE = 0.01;          // 1 foot = 0.01 units
const CURVE_R = 120;         // globe curvature radius (aesthetic, smaller = more curve)

// Approximate conversion at latitude ~40.71
const FT_PER_DEG_LAT = 364000;
const FT_PER_DEG_LNG = 278500;

/* ── Special venues ───────────────────────────────────────── */
const VENUES = {
  1001028: 'Trinity Church',
  1002921: 'Maxwell Tribeca',
  1088221: 'The Roxy Hotel',
};

/* ── Seeded random from integer ──────────────────────────── */
function seededRand(n) {
  let s = (n * 2654435761) >>> 0;
  s = ((s >>> 16) ^ s) * 0x45d9f3b;
  s = ((s >>> 16) ^ s) * 0x45d9f3b;
  s = (s >>> 16) ^ s;
  return (s & 0xffff) / 0xffff;
}

/* ── CSV parsing ─────────────────────────────────────────── */
async function loadCSV(url) {
  const text = await (await fetch(url)).text();
  const lines = text.trim().split(/\r?\n/);
  const header = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    if (vals.length < header.length) continue;
    const obj = {};
    header.forEach((h, j) => obj[h] = vals[j]);
    rows.push(obj);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let val = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { val += line[i]; i++; }
      }
      if (line[i] === ',') i++;
      result.push(val);
    } else {
      let val = '';
      while (i < line.length && line[i] !== ',') { val += line[i]; i++; }
      if (line[i] === ',') i++;
      result.push(val);
    }
  }
  return result;
}

/* ── Point-in-polygon (ray casting) ──────────────────────── */
function pointInPolygon(lat, lng, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if (((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/* ── Parse polygon geometry to get centroid & bounding box ─ */
function parseGeom(geomStr) {
  // Extract all coordinate pairs from MULTIPOLYGON
  const coordMatch = geomStr.match(/\(\(\(([\s\S]+?)\)\)\)/);
  if (!coordMatch) return null;
  const pairs = coordMatch[1].split(',').map(p => {
    const parts = p.trim().split(/\s+/);
    return [parseFloat(parts[0]), parseFloat(parts[1])]; // [lng, lat]
  });
  if (pairs.length === 0) return null;

  let minLng = Infinity, maxLng = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  let sumLng = 0, sumLat = 0;
  for (const [lng, lat] of pairs) {
    if (isNaN(lng) || isNaN(lat)) continue;
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    sumLng += lng; sumLat += lat;
  }
  return {
    centroidLng: sumLng / pairs.length,
    centroidLat: sumLat / pairs.length,
    widthFt: (maxLng - minLng) * FT_PER_DEG_LNG,
    depthFt: (maxLat - minLat) * FT_PER_DEG_LAT,
  };
}

/* ── Manhattan shoreline (loaded from OSM data at runtime) ── */
let SHORELINE_LATLNG = [];  // populated in main()

/* ── Shader injection (curvature + building details) ────── */
const sharedUniforms = {
  uCamPos: { value: new THREE.Vector3() },
  uTime:   { value: 0 },
};

function injectCurvature(material, addWindows = false) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCamPos = sharedUniforms.uCamPos;
    shader.uniforms.uTime   = sharedUniforms.uTime;

    /* ── Vertex shader ─────────────────────────────────── */
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       uniform vec3 uCamPos;
       uniform float uTime;
       const float R = ${CURVE_R.toFixed(1)};
       varying vec3 vWorldPos;
       varying vec3 vObjPos;
       varying vec3 vNorm;`
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
       vec4 mvPosition = vec4(transformed, 1.0);
       #ifdef USE_BATCHING
         mvPosition = batchingMatrix * mvPosition;
       #endif
       #ifdef USE_INSTANCING
         mvPosition = instanceMatrix * mvPosition;
       #endif
       vObjPos = transformed;
       vec4 worldPos = modelMatrix * mvPosition;
       vWorldPos = worldPos.xyz;
       vNorm = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
       float dx = worldPos.x - uCamPos.x;
       float dz = worldPos.z - uCamPos.z;
       float d2 = dx * dx + dz * dz;
       float drop = d2 / (2.0 * R);
       worldPos.y -= drop;
       mvPosition = viewMatrix * worldPos;
       gl_Position = projectionMatrix * mvPosition;
      `
    );

    if (!addWindows) return;

    /* ── Fragment shader: procedural windows on walls ─── */
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uTime;
       varying vec3 vWorldPos;
       varying vec3 vObjPos;
       varying vec3 vNorm;

       // hash for per-window randomness
       float hash21(vec2 p) {
         p = fract(p * vec2(233.34, 851.73));
         p += dot(p, p + 23.45);
         return fract(p.x * p.y);
       }

       vec3 windowPattern(vec3 baseColor) {
         // Only apply to vertical (wall) faces
         float wallness = 1.0 - abs(dot(normalize(vNorm), vec3(0.0, 1.0, 0.0)));
         if (wallness < 0.5) return baseColor;

         // World-space UV for consistent window size
         float floorH = 0.35;   // floor height in scene units (~35 ft)
         float winW   = 0.15;   // window spacing width

         // Use world X/Z projected based on face normal
         float absNx = abs(vNorm.x);
         float absNz = abs(vNorm.z);
         float u = (absNx > absNz) ? vWorldPos.z : vWorldPos.x;
         float v = vWorldPos.y;

         // Grid coordinates
         float gx = u / winW;
         float gy = v / floorH;

         // Fractional position within cell
         float fx = fract(gx);
         float fy = fract(gy);

         // Window rectangle within cell (with margins)
         float marginX = 0.25;
         float marginYbot = 0.30;
         float marginYtop = 0.15;
         bool inWindow = fx > marginX && fx < (1.0 - marginX)
                      && fy > marginYbot && fy < (1.0 - marginYtop);

         if (!inWindow) return baseColor;

         // Per-window random: some lit, some dark
         vec2 cellId = vec2(floor(gx), floor(gy));
         float r = hash21(cellId);

         // Slight slow flicker for lit windows
         float flicker = 0.95 + 0.05 * sin(uTime * 0.5 + r * 6.28);

         if (r < 0.35) {
           // Dark / unlit window
           return baseColor * 0.25;
         } else if (r < 0.7) {
           // Warm lit window
           vec3 warmLight = vec3(1.0, 0.9, 0.6) * (0.6 + r * 0.5) * flicker;
           return mix(baseColor, warmLight, 0.7);
         } else {
           // Cool fluorescent
           vec3 coolLight = vec3(0.7, 0.85, 1.0) * (0.5 + r * 0.4) * flicker;
           return mix(baseColor, coolLight, 0.6);
         }
       }`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       gl_FragColor.rgb = windowPattern(gl_FragColor.rgb);`
    );
  };
}

/* ── Main ────────────────────────────────────────────────── */
async function main() {
  const canvas = document.getElementById('canvas');
  const tooltip = document.getElementById('tooltip');
  const loading = document.getElementById('loading');

  // Renderer
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x87CEEB);

  // Scene
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x87CEEB, 120, 400);

  // Camera
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1000);
  camera.position.set(0, 120, 0.1);

  // Controls
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 2;
  controls.maxDistance = 200;
  controls.target.set(0, 0, 0);
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.touches = {
    ONE: THREE.TOUCH.PAN,
    TWO: THREE.TOUCH.DOLLY_ROTATE,
  };

  // Lights
  const hemi = new THREE.HemisphereLight(0x87CEEB, 0x444422, 0.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(30, 60, 20);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.15));

  /* ── Load shoreline + building data ───────────────────── */
  SHORELINE_LATLNG = await (await fetch('shoreline.json')).json();
  const rows = await loadCSV('BUILDING_20260214.csv');

  // Parse buildings from geometry, heights, and ground elevation
  const buildings = [];
  let sumLat = 0, sumLng = 0, count = 0;

  for (const r of rows) {
    const geom = parseGeom(r.the_geom);
    if (!geom) continue;

    const heightRoof = parseFloat((r['Height Roof'] || '').replace(/,/g, ''));
    if (!heightRoof || heightRoof <= 0) continue;

    // Only include buildings inside Manhattan bounding box
    if (geom.centroidLat < 40.700 || geom.centroidLat > 40.883 ||
        geom.centroidLng < -74.020 || geom.centroidLng > -73.907) continue;

    const bin = parseInt(r.BIN) || 0;
    const name = r.NAME || VENUES[bin] || '';

    // Enforce minimum footprint of 10ft
    const wFt = Math.max(geom.widthFt, 10);
    const dFt = Math.max(geom.depthFt, 10);

    buildings.push({
      bin,
      name,
      lat: geom.centroidLat,
      lng: geom.centroidLng,
      heightFt: heightRoof,
      wFt,
      dFt,
    });

    sumLat += geom.centroidLat;
    sumLng += geom.centroidLng;
    count++;
  }

  const cLat = count > 0 ? sumLat / count : 40.71;
  const cLng = count > 0 ? sumLng / count : -74.01;

  // Convert to scene coordinates
  for (const b of buildings) {
    b.x = (b.lng - cLng) * FT_PER_DEG_LNG * SCALE;
    b.z = -(b.lat - cLat) * FT_PER_DEG_LAT * SCALE;
    b.h = b.heightFt * SCALE;
    b.w = b.wFt * SCALE;
    b.d = b.dFt * SCALE;
  }

  /* ── Compute per-building rotation from nearest street ── */
  const streetsData = await (await fetch('streets.json')).json();

  // Pre-compute all street segments in scene coordinates
  const allSegs = [];  // { x1, z1, x2, z2, angle }
  for (const street of streetsData) {
    const pts = street.coords.map(([lng, lat]) => [
      (lng - cLng) * FT_PER_DEG_LNG * SCALE,
      -(lat - cLat) * FT_PER_DEG_LAT * SCALE,
    ]);
    for (let i = 1; i < pts.length; i++) {
      const [x1, z1] = pts[i - 1];
      const [x2, z2] = pts[i];
      const dx = x2 - x1, dz = z2 - z1;
      if (dx * dx + dz * dz < 0.001) continue;  // skip tiny segments
      allSegs.push({ x1, z1, x2, z2, angle: Math.atan2(dx, dz) });
    }
  }

  // Build spatial grid for fast nearest-segment lookup
  const GRID_CELL = 3.0;  // cell size in scene units (~300ft)
  const segGrid = new Map();

  function cellKey(cx, cz) { return (cx * 10000 + cz); }

  for (let si = 0; si < allSegs.length; si++) {
    const s = allSegs[si];
    const minX = Math.min(s.x1, s.x2), maxX = Math.max(s.x1, s.x2);
    const minZ = Math.min(s.z1, s.z2), maxZ = Math.max(s.z1, s.z2);
    const cx0 = Math.floor(minX / GRID_CELL), cx1 = Math.floor(maxX / GRID_CELL);
    const cz0 = Math.floor(minZ / GRID_CELL), cz1 = Math.floor(maxZ / GRID_CELL);
    for (let gx = cx0; gx <= cx1; gx++) {
      for (let gz = cz0; gz <= cz1; gz++) {
        const key = cellKey(gx, gz);
        if (!segGrid.has(key)) segGrid.set(key, []);
        segGrid.get(key).push(si);
      }
    }
  }

  // Point-to-segment squared distance
  function ptSegDist2(px, pz, s) {
    const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
    const lenSq = dx * dx + dz * dz;
    let t = ((px - s.x1) * dx + (pz - s.z1) * dz) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const nx = s.x1 + t * dx - px, nz = s.z1 + t * dz - pz;
    return nx * nx + nz * nz;
  }

  // Find nearest street angle for each building
  for (const b of buildings) {
    const gcx = Math.floor(b.x / GRID_CELL);
    const gcz = Math.floor(b.z / GRID_CELL);
    let bestDist = Infinity, bestAngle = 0;
    // Search 3x3 neighborhood
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const segs = segGrid.get(cellKey(gcx + dx, gcz + dz));
        if (!segs) continue;
        for (const si of segs) {
          const d2 = ptSegDist2(b.x, b.z, allSegs[si]);
          if (d2 < bestDist) {
            bestDist = d2;
            bestAngle = allSegs[si].angle;
          }
        }
      }
    }
    b.angle = bestAngle;
  }

  /* ── InstancedMesh for buildings ───────────────────────── */
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1 });
  injectCurvature(mat, true);
  const mesh = new THREE.InstancedMesh(geom, mat, buildings.length);

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    // Hide Trinity Church from instanced mesh (rendered separately)
    if (b.bin === 1001028) {
      dummy.position.set(0, -1000, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0, 0, 0);
    } else {
      dummy.position.set(b.x, b.h / 2, b.z);
      dummy.rotation.set(0, b.angle, 0);
      dummy.scale.set(b.w, b.h, b.d);
    }
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    // Color variation
    const isVenue = VENUES.hasOwnProperty(b.bin);
    const rv = seededRand(b.bin + 1);
    if (isVenue) {
      color.setRGB(0.85, 0.35, 0.25);  // warm red-orange for venues
    } else if (b.name) {
      color.setHSL(0.0, 0.0, 0.55 + rv * 0.15);
    } else if (rv < 0.4) {
      color.setHSL(0.08, 0.15 + rv * 0.1, 0.45 + seededRand(b.bin + 2) * 0.2);
    } else if (rv < 0.7) {
      color.setHSL(0.6, 0.05, 0.4 + seededRand(b.bin + 2) * 0.2);
    } else {
      color.setHSL(0.0, 0.0, 0.4 + seededRand(b.bin + 2) * 0.2);
    }
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);

  /* ── Building rooftop details ────────────────────────────── */
  const detailMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.9, metalness: 0.2 });
  injectCurvature(detailMat);

  // Count how many rooftop items we'll need
  let rooftopCount = 0;
  for (const b of buildings) {
    if (b.heightFt > 60) rooftopCount += 1 + Math.floor(seededRand(b.bin + 10) * 3);
  }

  // Instanced small boxes for HVAC / mechanical penthouses
  const hvacGeo = new THREE.BoxGeometry(1, 1, 1);
  const hvacMesh = new THREE.InstancedMesh(hvacGeo, detailMat, rooftopCount);
  const hvacDummy = new THREE.Object3D();
  let hvacIdx = 0;

  for (const b of buildings) {
    if (b.heightFt <= 60) continue;
    const numDetails = 1 + Math.floor(seededRand(b.bin + 10) * 3);
    for (let j = 0; j < numDetails; j++) {
      const r1 = seededRand(b.bin * 7 + j * 13 + 1);
      const r2 = seededRand(b.bin * 7 + j * 13 + 2);
      const r3 = seededRand(b.bin * 7 + j * 13 + 3);
      const bw = b.w * 0.15 + r1 * b.w * 0.2;
      const bh = b.h * 0.03 + r3 * b.h * 0.06;
      const bd = b.d * 0.15 + r2 * b.d * 0.2;
      const ox = (r1 - 0.5) * b.w * 0.5;
      const oz = (r2 - 0.5) * b.d * 0.5;
      // Rotate offset by building angle
      const cosA = Math.cos(b.angle), sinA = Math.sin(b.angle);
      const rx = ox * cosA - oz * sinA;
      const rz = ox * sinA + oz * cosA;
      hvacDummy.position.set(b.x + rx, b.h + bh / 2, b.z + rz);
      hvacDummy.rotation.set(0, b.angle, 0);
      hvacDummy.scale.set(bw, bh, bd);
      hvacDummy.updateMatrix();
      hvacMesh.setMatrixAt(hvacIdx++, hvacDummy.matrix);
    }
  }
  hvacMesh.instanceMatrix.needsUpdate = true;
  scene.add(hvacMesh);

  // Instanced antennas (thin cylinders) on tall buildings
  const antennaBldgs = buildings.filter(b => b.heightFt > 200 && seededRand(b.bin + 50) > 0.5);
  if (antennaBldgs.length > 0) {
    const antennaGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 4);
    const antennaMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.6 });
    injectCurvature(antennaMat);
    const antennaMesh = new THREE.InstancedMesh(antennaGeo, antennaMat, antennaBldgs.length);
    const antDummy = new THREE.Object3D();
    for (let i = 0; i < antennaBldgs.length; i++) {
      const b = antennaBldgs[i];
      const ah = b.h * (0.08 + seededRand(b.bin + 51) * 0.12);
      antDummy.position.set(b.x, b.h + ah / 2, b.z);
      antDummy.scale.set(1, ah, 1);
      antDummy.updateMatrix();
      antennaMesh.setMatrixAt(i, antDummy.matrix);
    }
    antennaMesh.instanceMatrix.needsUpdate = true;
    scene.add(antennaMesh);
  }

  /* ── 1 WTC Spire ────────────────────────────────────────── */
  const wtc1 = buildings.find(b => b.bin === 1088469);
  if (wtc1) {
    // The actual spire is ~408 ft tall, building roof is ~1368 ft, total 1776 ft
    const spireH = wtc1.h * 0.72;  // spire is ~72% of roof height
    const spireBaseR = Math.min(wtc1.w, wtc1.d) * 0.08;
    const spireGeo = new THREE.ConeGeometry(spireBaseR, spireH, 8);
    const spireMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.7 });
    injectCurvature(spireMat);
    const spireMesh = new THREE.Mesh(spireGeo, spireMat);
    spireMesh.position.set(wtc1.x, wtc1.h + spireH / 2, wtc1.z);
    scene.add(spireMesh);
  }

  /* ── Venue markers (floating pins + pulsing rings) ──────── */
  const venueMarkers = [];  // store for animation
  const venuePinMat = new THREE.MeshStandardMaterial({ color: 0xdd4433, roughness: 0.3, metalness: 0.4, emissive: 0xdd4433, emissiveIntensity: 0.3 });
  injectCurvature(venuePinMat);
  const venueRingMat = new THREE.MeshBasicMaterial({ color: 0xdd4433, transparent: true, opacity: 0.6, side: THREE.DoubleSide });

  for (const b of buildings) {
    if (!VENUES.hasOwnProperty(b.bin)) continue;

    const markerGroup = new THREE.Group();
    markerGroup.position.set(b.x, 0, b.z);

    // Pin: sphere + cone pointing down
    const pinY = b.h + 2.5;
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8), venuePinMat);
    sphere.position.y = pinY;
    markerGroup.add(sphere);

    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.8, 8), venuePinMat);
    cone.position.y = pinY - 0.6;
    cone.rotation.x = Math.PI;  // point downward
    markerGroup.add(cone);

    // Thin line from building top to pin
    const stickGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, b.h, 0),
      new THREE.Vector3(0, pinY - 1.0, 0),
    ]);
    const stickMat = new THREE.LineBasicMaterial({ color: 0xdd4433, transparent: true, opacity: 0.6 });
    markerGroup.add(new THREE.Line(stickGeo, stickMat));

    // Pulsing ring at base of pin
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.6, 24), venueRingMat.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = pinY - 1.0;
    markerGroup.add(ring);

    scene.add(markerGroup);
    venueMarkers.push({ group: markerGroup, ring, baseY: pinY });
  }

  /* ── Trinity Church ──────────────────────────────────────── */
  const trinity = buildings.find(b => b.bin === 1001028);
  let churchGroup = null;
  if (trinity) {
    churchGroup = new THREE.Group();
    churchGroup.position.set(trinity.x, 0, trinity.z);

    // Main nave body
    const naveW = trinity.w;
    const naveH = trinity.h;
    const naveD = trinity.d;
    const naveGeo = new THREE.BoxGeometry(naveW, naveH, naveD);
    const naveMat = new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 0.85 });
    injectCurvature(naveMat);
    const nave = new THREE.Mesh(naveGeo, naveMat);
    nave.position.set(0, naveH / 2, 0);
    nave.rotation.set(0, trinity.angle, 0);
    churchGroup.add(nave);

    // Peaked roof using ExtrudeGeometry
    const roofShape = new THREE.Shape();
    roofShape.moveTo(-naveW / 2, 0);
    roofShape.lineTo(0, naveH * 0.4);
    roofShape.lineTo(naveW / 2, 0);
    roofShape.lineTo(-naveW / 2, 0);
    const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: naveD, bevelEnabled: false });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.85 });
    injectCurvature(roofMat);
    const roofMesh = new THREE.Mesh(roofGeo, roofMat);
    roofMesh.rotation.set(Math.PI / 2, 0, 0);
    roofMesh.position.set(0, naveH, naveD / 2);
    roofMesh.rotation.set(-Math.PI / 2, trinity.angle, 0);
    churchGroup.add(roofMesh);

    // Steeple (tall square tower + pointed spire)
    const steepleW = naveW * 0.3;
    const steepleH = naveH * 0.6;
    const towerGeo = new THREE.BoxGeometry(steepleW, steepleH, steepleW);
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 0.8 });
    injectCurvature(towerMat);
    const tower = new THREE.Mesh(towerGeo, towerMat);
    // Position at front of church
    const frontOffset = naveD * 0.45;
    const cosG = Math.cos(trinity.angle), sinG = Math.sin(trinity.angle);
    tower.position.set(
      -frontOffset * sinG,
      naveH + steepleH / 2,
      -frontOffset * cosG
    );
    tower.rotation.set(0, trinity.angle, 0);
    churchGroup.add(tower);

    // Pointed spire on top of steeple
    const spireH = naveH * 0.8;
    const spireGeo = new THREE.ConeGeometry(steepleW * 0.45, spireH, 4);
    const spireMat = new THREE.MeshStandardMaterial({ color: 0x6a5a4a, roughness: 0.7 });
    injectCurvature(spireMat);
    const spire = new THREE.Mesh(spireGeo, spireMat);
    spire.position.set(
      tower.position.x,
      naveH + steepleH + spireH / 2,
      tower.position.z
    );
    spire.rotation.set(0, Math.PI / 4, 0);
    churchGroup.add(spire);

    // Cross on top
    const crossMat = new THREE.MeshStandardMaterial({ color: 0xddcc88, roughness: 0.4, metalness: 0.5 });
    injectCurvature(crossMat);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.02, naveH * 0.15, 0.02), crossMat);
    crossV.position.set(
      spire.position.x,
      naveH + steepleH + spireH + naveH * 0.075,
      spire.position.z
    );
    churchGroup.add(crossV);
    const crossHGeo = new THREE.BoxGeometry(naveH * 0.08, 0.02, 0.02);
    const crossH = new THREE.Mesh(crossHGeo, crossMat);
    crossH.position.set(
      crossV.position.x,
      crossV.position.y + naveH * 0.03,
      crossV.position.z
    );
    churchGroup.add(crossH);

    scene.add(churchGroup);
  }

  /* ── Streets ──────────────────────────────────────────── */
  const streetLineMat = new THREE.LineBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.5 });
  const majorStreetMat = new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7 });
  const majorTypes = new Set(['primary', 'secondary', 'trunk', 'motorway']);

  // Helper: apply globe curvature to a point (matches shader formula)
  function curveY(x, z, camX, camZ) {
    const dx = x - camX;
    const dz = z - camZ;
    return -(dx * dx + dz * dz) / (2 * CURVE_R);
  }

  // Subdivide line segments so curvature is smooth
  function subdivideLine(coords, maxSegLen) {
    const result = [coords[0]];
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1], b = coords[i];
      const dist = Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
      const segs = Math.max(1, Math.ceil(dist / maxSegLen));
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return result;
  }

  // Store street meshes for curvature update in render loop + hover
  const streetHighlightMat = new THREE.LineBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 1.0 });
  const streetLines = [];
  // Map street name -> array of line indices (for highlighting all segments of a street)
  const streetNameMap = new Map();

  for (const street of streetsData) {
    const rawCoords = street.coords.map(([lng, lat]) => [
      (lng - cLng) * FT_PER_DEG_LNG * SCALE,
      -(lat - cLat) * FT_PER_DEG_LAT * SCALE,
    ]);
    const subCoords = subdivideLine(rawCoords, 2.0);
    const points = subCoords.map(([x, z]) => new THREE.Vector3(x, 0.01, z));
    if (points.length < 2) continue;
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const isMajor = majorTypes.has(street.type);
    const baseMat = isMajor ? majorStreetMat : streetLineMat;
    const line = new THREE.Line(lineGeo, baseMat);
    scene.add(line);
    const idx = streetLines.length;
    streetLines.push({ line, coords: subCoords, name: street.name, baseMat });

    if (street.name) {
      if (!streetNameMap.has(street.name)) streetNameMap.set(street.name, []);
      streetNameMap.get(street.name).push(idx);
    }
  }

  // Build spatial grid for street hover (reuse same cell size)
  // Store segment index + streetLine index for ground-plane proximity check
  const streetHoverGrid = new Map();
  const streetSegments = [];  // { x1, z1, x2, z2, streetIdx }
  for (let si = 0; si < streetLines.length; si++) {
    const coords = streetLines[si].coords;
    for (let i = 1; i < coords.length; i++) {
      const [x1, z1] = coords[i - 1];
      const [x2, z2] = coords[i];
      const segIdx = streetSegments.length;
      streetSegments.push({ x1, z1, x2, z2, streetIdx: si });
      const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
      const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);
      const cx0 = Math.floor(minX / GRID_CELL), cx1 = Math.floor(maxX / GRID_CELL);
      const cz0 = Math.floor(minZ / GRID_CELL), cz1 = Math.floor(maxZ / GRID_CELL);
      for (let gx = cx0; gx <= cx1; gx++) {
        for (let gz = cz0; gz <= cz1; gz++) {
          const key = cellKey(gx, gz);
          if (!streetHoverGrid.has(key)) streetHoverGrid.set(key, []);
          streetHoverGrid.get(key).push(segIdx);
        }
      }
    }
  }

  function findNearestStreet(groundX, groundZ, maxDist) {
    const gcx = Math.floor(groundX / GRID_CELL);
    const gcz = Math.floor(groundZ / GRID_CELL);
    let bestDist = maxDist * maxDist, bestIdx = -1;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const segs = streetHoverGrid.get(cellKey(gcx + dx, gcz + dz));
        if (!segs) continue;
        for (const segIdx of segs) {
          const s = streetSegments[segIdx];
          const sdx = s.x2 - s.x1, sdz = s.z2 - s.z1;
          const lenSq = sdx * sdx + sdz * sdz;
          let t = lenSq > 0 ? ((groundX - s.x1) * sdx + (groundZ - s.z1) * sdz) / lenSq : 0;
          t = Math.max(0, Math.min(1, t));
          const nx = s.x1 + t * sdx - groundX, nz = s.z1 + t * sdz - groundZ;
          const d2 = nx * nx + nz * nz;
          if (d2 < bestDist) {
            bestDist = d2;
            bestIdx = s.streetIdx;
          }
        }
      }
    }
    return bestIdx;
  }

  /* ── Shoreline land mass ───────────────────────────────── */
  const shorePoints = SHORELINE_LATLNG.map(([lat, lng]) => {
    const sx = (lng - cLng) * FT_PER_DEG_LNG * SCALE;
    const sz = -(lat - cLat) * FT_PER_DEG_LAT * SCALE;
    return new THREE.Vector2(sx, -sz);
  }).filter(v => isFinite(v.x) && isFinite(v.y));
  const shoreShape = new THREE.Shape(shorePoints);
  const shoreGeo = new THREE.ShapeGeometry(shoreShape);
  const shoreMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.9, side: THREE.DoubleSide });
  injectCurvature(shoreMat);
  const shoreMesh = new THREE.Mesh(shoreGeo, shoreMat);
  shoreMesh.rotation.x = -Math.PI / 2;
  shoreMesh.position.y = -0.01;  // just below building base at y=0
  scene.add(shoreMesh);

  /* ── Water plane ───────────────────────────────────────── */
  const waterGeo = new THREE.PlaneGeometry(500, 500, 80, 80);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x1a6b8a,
    transparent: true,
    opacity: 0.7,
    roughness: 0.3,
    metalness: 0.2,
  });
  injectCurvature(waterMat);
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.05;
  scene.add(water);

  const waterPosAttr = waterGeo.getAttribute('position');
  const waterBaseZ = new Float32Array(waterPosAttr.count);
  for (let i = 0; i < waterPosAttr.count; i++) {
    waterBaseZ[i] = waterPosAttr.getZ(i);
  }

  /* ── Raycaster for hover ───────────────────────────────── */
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let hoveredIdx = -1;
  const origColor = new THREE.Color();
  const highlightColor = new THREE.Color(0xffdd44);
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const groundIntersect = new THREE.Vector3();

  // Track highlighted street lines to restore them
  let highlightedStreetName = null;

  function clearStreetHighlight() {
    if (highlightedStreetName) {
      const indices = streetNameMap.get(highlightedStreetName);
      if (indices) {
        for (const idx of indices) {
          streetLines[idx].line.material = streetLines[idx].baseMat;
        }
      }
      highlightedStreetName = null;
    }
  }

  canvas.addEventListener('mousemove', (e) => {
    mouse.x = (e.clientX / innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(mesh);

    // Reset previous building highlight
    if (hoveredIdx >= 0) {
      mesh.setColorAt(hoveredIdx, origColor);
      mesh.instanceColor.needsUpdate = true;
    }

    // Reset previous street highlight
    clearStreetHighlight();

    // Check church group
    let churchHit = false;
    if (trinity && churchGroup) {
      const churchHits = raycaster.intersectObjects(churchGroup.children);
      if (churchHits.length > 0) {
        churchHit = true;
        hoveredIdx = -1;
        const label = trinity.name || 'Trinity Church';
        const htLabel = `${Math.round(trinity.heightFt)} ft`;
        tooltip.textContent = `${label}  •  ${htLabel}`;
        tooltip.style.display = 'block';
        tooltip.style.left = e.clientX + 14 + 'px';
        tooltip.style.top = e.clientY + 14 + 'px';
        return;
      }
    }

    // Check buildings
    if (hits.length > 0) {
      const idx = hits[0].instanceId;
      hoveredIdx = idx;
      mesh.getColorAt(idx, origColor);
      mesh.setColorAt(idx, highlightColor);
      mesh.instanceColor.needsUpdate = true;

      const b = buildings[idx];
      const label = b.name || `BIN ${b.bin}`;
      const htLabel = `${Math.round(b.heightFt)} ft`;
      tooltip.textContent = `${label}  •  ${htLabel}`;
      tooltip.style.display = 'block';
      tooltip.style.left = e.clientX + 14 + 'px';
      tooltip.style.top = e.clientY + 14 + 'px';
      return;
    }

    hoveredIdx = -1;

    // Check streets via ground-plane projection
    raycaster.ray.intersectPlane(groundPlane, groundIntersect);
    if (groundIntersect) {
      const nearestIdx = findNearestStreet(groundIntersect.x, groundIntersect.z, 0.5);
      if (nearestIdx >= 0) {
        const st = streetLines[nearestIdx];
        if (st.name) {
          // Highlight all segments with the same name
          highlightedStreetName = st.name;
          const indices = streetNameMap.get(st.name);
          if (indices) {
            for (const idx of indices) {
              streetLines[idx].line.material = streetHighlightMat;
            }
          }
          tooltip.textContent = st.name;
          tooltip.style.display = 'block';
          tooltip.style.left = e.clientX + 14 + 'px';
          tooltip.style.top = e.clientY + 14 + 'px';
          return;
        }
      }
    }

    tooltip.style.display = 'none';
  });

  /* ── Hide loading ──────────────────────────────────────── */
  loading.classList.add('done');

  /* ── Resize ────────────────────────────────────────────── */
  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  /* ── Render loop ───────────────────────────────────────── */
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    for (let i = 0; i < waterPosAttr.count; i++) {
      const px = waterPosAttr.getX(i);
      const py = waterPosAttr.getY(i);
      waterPosAttr.setZ(i, waterBaseZ[i] + Math.sin(px * 0.5 + t) * 0.04 + Math.cos(py * 0.3 + t * 0.7) * 0.03);
    }
    waterPosAttr.needsUpdate = true;

    sharedUniforms.uCamPos.value.copy(camera.position);
    sharedUniforms.uTime.value = t;

    // Animate venue markers (bob + pulse)
    for (const vm of venueMarkers) {
      const bob = Math.sin(t * 1.5) * 0.15;
      vm.group.position.y = bob;
      const pulse = 0.3 + 0.3 * Math.abs(Math.sin(t * 2.0));
      vm.ring.material.opacity = pulse;
      const ringScale = 1.0 + 0.3 * Math.sin(t * 2.0);
      vm.ring.scale.set(ringScale, ringScale, 1);
    }

    // Apply globe curvature to street lines
    const cx = camera.position.x, cz = camera.position.z;
    for (const { line, coords } of streetLines) {
      const posAttr = line.geometry.getAttribute('position');
      for (let i = 0; i < coords.length; i++) {
        const [x, z] = coords[i];
        posAttr.setY(i, 0.01 + curveY(x, z, cx, cz));
      }
      posAttr.needsUpdate = true;
    }

    controls.update();
    renderer.render(scene, camera);
  }

  animate();
}

main();
