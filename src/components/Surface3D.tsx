import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Dataset } from "@/data/engine";
import { RAMPS, rampColor, type LayerKey } from "@/data/colors";
import { BOUNDS, LANDMARKS, ZONES } from "@/data/nagpur";

const PW = 14; // plane width (world units)
const PH = 12; // plane height
const MAX_H = 3.2;

function norm(layer: LayerKey, v: number) {
  const [lo, hi] = RAMPS[layer].domain;
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}

/** local plane coords (before rotation): x right, y up(north) */
function toLocal(lat: number, lon: number): [number, number] {
  const x = ((lon - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * PW - PW / 2;
  const y = PH / 2 - ((BOUNDS.north - lat) / (BOUNDS.north - BOUNDS.south)) * PH;
  return [x, y];
}

function Surface({ ds, values, layer, exag, showZones }: { ds: Dataset; values: Float32Array | Uint8Array; layer: LayerKey; exag: number; showZones: boolean }) {
  const geometry = useMemo(() => new THREE.PlaneGeometry(PW, PH, ds.w - 1, ds.h - 1), [ds.w, ds.h]);
  const current = useRef<Float32Array>(new Float32Array(ds.n));
  const target = useRef<Float32Array>(new Float32Array(ds.n));
  const dirty = useRef(true);
  const layerRef = useRef(layer);
  const exagRef = useRef(exag);

  useEffect(() => {
    const colors = new Float32Array(ds.n * 3);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }, [geometry, ds.n]);

  useEffect(() => {
    // when the layer changes jump immediately, when only values change animate
    const jump = layerRef.current !== layer;
    for (let i = 0; i < ds.n; i++) {
      target.current[i] = ds.water[i] && layer !== "hotspot" ? RAMPS[layer].domain[0] : values[i];
      if (jump) current.current[i] = target.current[i];
    }
    layerRef.current = layer;
    exagRef.current = exag;
    dirty.current = true;
  }, [values, layer, exag, ds]);

  useFrame(() => {
    if (!dirty.current) return;
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const col = geometry.attributes.color as THREE.BufferAttribute;
    let maxDiff = 0;
    const cur = current.current, tgt = target.current;
    const lyr = layerRef.current;
    for (let i = 0; i < ds.n; i++) {
      const d = tgt[i] - cur[i];
      if (Math.abs(d) > maxDiff) maxDiff = Math.abs(d);
      cur[i] += d * 0.18;
      const t = norm(lyr, cur[i]);
      pos.setZ(i, t * MAX_H * exagRef.current);
      const c = ds.water[i] && lyr !== "hotspot" && !lyr.startsWith("d") ? [12, 42, 74] : rampColor(lyr, cur[i]);
      col.setXYZ(i, c[0] / 255, c[1] / 255, c[2] / 255);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geometry.computeVertexNormals();
    const span = RAMPS[lyr].domain[1] - RAMPS[lyr].domain[0];
    if (maxDiff < span * 0.002) dirty.current = false;
  });

  const heightAt = (lat: number, lon: number) => {
    const col = Math.min(ds.w - 1, Math.max(0, Math.floor(((lon - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * ds.w)));
    const row = Math.min(ds.h - 1, Math.max(0, Math.floor(((BOUNDS.north - lat) / (BOUNDS.north - BOUNDS.south)) * ds.h)));
    const i = row * ds.w + col;
    const v = ds.water[i] && layer !== "hotspot" ? RAMPS[layer].domain[0] : values[i];
    return norm(layer, v) * MAX_H * exag;
  };

  const zoneLines = useMemo(() => {
    if (!showZones) return [];
    return ZONES.map((z) => {
      const pts: [number, number, number][] = [];
      const poly = [...z.poly, z.poly[0]];
      for (let k = 0; k < poly.length - 1; k++) {
        for (let s = 0; s <= 12; s++) {
          const f = s / 12;
          const lat = poly[k][0] + (poly[k + 1][0] - poly[k][0]) * f;
          const lon = poly[k][1] + (poly[k + 1][1] - poly[k][1]) * f;
          const [x, y] = toLocal(lat, lon);
          pts.push([x, heightAt(lat, lon) + 0.06, -y]);
        }
      }
      return { id: z.id, pts };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showZones, values, layer, exag]);

  return (
    <group>
      <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.9} metalness={0.05} flatShading={false} />
      </mesh>
      {/* base slab */}
      <mesh position={[0, -0.16, 0]}>
        <boxGeometry args={[PW + 0.3, 0.3, PH + 0.3]} />
        <meshStandardMaterial color="#0b1220" roughness={1} />
      </mesh>
      {zoneLines.map((l) => (
        <Line key={l.id} points={l.pts} color="#ffffff" lineWidth={1} transparent opacity={0.55} />
      ))}
      {LANDMARKS.filter((l) => ["city", "water", "forest", "industry", "transport"].includes(l.kind)).map((lm) => {
        const [x, y] = toLocal(lm.lat, lm.lon);
        const h = heightAt(lm.lat, lm.lon);
        return (
          <group key={lm.name} position={[x, h, -y]}>
            <Line points={[[0, 0, 0], [0, 0.7, 0]]} color="#ffffff" lineWidth={1} transparent opacity={0.6} />
            <Html position={[0, 0.8, 0]} center distanceFactor={14} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
              <div className="whitespace-nowrap rounded-md bg-slate-950/80 px-1.5 py-0.5 text-[10px] font-medium text-white shadow">{lm.name}</div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

export default function Surface3D({ ds, values, layer, exag = 1, showZones = true }: { ds: Dataset; values: Float32Array | Uint8Array; layer: LayerKey; exag?: number; showZones?: boolean }) {
  return (
    <Canvas camera={{ position: [0, 11, 13], fov: 42, near: 0.1, far: 200 }} dpr={[1, 1.75]} gl={{ antialias: true }}>
      <color attach="background" args={["#020617"]} />
      <fog attach="fog" args={["#020617", 24, 48]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[10, 14, 6]} intensity={1.4} />
      <directionalLight position={[-8, 6, -6]} intensity={0.35} color="#93c5fd" />
      <Surface ds={ds} values={values} layer={layer} exag={exag} showZones={showZones} />
      <gridHelper args={[40, 40, "#1e293b", "#0f172a"]} position={[0, -0.32, 0]} />
      <OrbitControls enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2.15} minDistance={5} maxDistance={34} target={[0, 0.6, 0]} />
    </Canvas>
  );
}
