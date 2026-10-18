import type { MotionValue } from 'framer-motion'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { HOPS, hopAt } from './fragment'

/*
 * Chapter 02 artwork: an illustrative, procedurally generated wallet network that splits into colour-coded
 * branches as the visitor scrolls. Deterministic (seeded), never read from an investigation — the caption
 * beside it says so. Rendering sleeps while the canvas is off screen.
 */

const BRANCH = [0x5ef2c2, 0xa99bff, 0xff7a3d]

interface N { id: number; hop: number; parent: number; branch: number; pos: THREE.Vector3; size: number }

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function buildTree() {
  const r = rng(20220323)
  const nodes: N[] = [{ id: 0, hop: 0, parent: -1, branch: -1, pos: new THREE.Vector3(-58, 0, 0), size: 7 }]
  const angle = new Map<number, number>([[0, 0]])
  let prev = [0]
  for (let h = 1; h < HOPS.length; h++) {
    const next: number[] = []
    for (let i = 0; i < HOPS[h]; i++) {
      const parent = prev[Math.min(prev.length - 1, Math.floor((i / HOPS[h]) * prev.length))]
      const pn = nodes[parent]
      const branch = h === 1 ? i : pn.branch
      const base = h === 1 ? (i / HOPS[1]) * Math.PI * 2 + 0.4 : angle.get(parent)!
      const a = base + (r() - 0.5) * (1.5 / h)
      const rad = 6 + h * 8.5 + r() * 5
      const id = nodes.length
      nodes.push({ id, hop: h, parent, branch, size: Math.max(2.4, 4.6 - h * 0.55) + r() * 0.7,
        pos: new THREE.Vector3(-58 + h * 29 + (r() - 0.5) * 8, Math.sin(a) * rad, Math.cos(a) * rad) })
      angle.set(id, a)
      next.push(id)
    }
    prev = next
  }
  return nodes
}

function gridTexture(color: string) {
  const s = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const g = cv.getContext('2d')!
  g.fillStyle = '#16181a'
  g.fillRect(0, 0, s, s)
  g.strokeStyle = color
  g.globalAlpha = 0.85
  g.lineWidth = 2
  for (let i = 0; i <= 8; i++) {
    const v = (i / 8) * s
    g.beginPath(); g.moveTo(v, 0); g.lineTo(v, s); g.stroke()
    g.beginPath(); g.moveTo(0, v); g.lineTo(s, v); g.stroke()
  }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function glowTexture() {
  const s = 64
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const g = cv.getContext('2d')!
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.3, 'rgba(255,255,255,.35)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, s, s)
  return new THREE.CanvasTexture(cv)
}

export default function FragmentScene({ progress, reduced, onFail }: { progress: MotionValue<number>; reduced: boolean; onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch {
      onFail()
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x0e0f10, 190, 420)
    const camera = new THREE.PerspectiveCamera(36, 1, 1, 1000)

    scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x1a1208, 0.9))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(-40, 80, 60)
    scene.add(key)
    const mintLight = new THREE.PointLight(0x5ef2c2, 900, 160, 2)
    mintLight.position.set(-58, 10, 20)
    scene.add(mintLight)
    const emberLight = new THREE.PointLight(0xff7a3d, 500, 200, 2)
    emberLight.position.set(60, -30, -40)
    scene.add(emberLight)

    const nodes = buildTree()
    const grid = gridTexture('#5ef2c2')
    const glow = glowTexture()
    const group = new THREE.Group()
    scene.add(group)

    const meshes: { n: N; mesh: THREE.Mesh; edges: THREE.LineSegments; halo: THREE.Sprite | null; spin: number }[] = []
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1f22, metalness: 0.55, roughness: 0.32 })
    for (const n of nodes) {
      const geo = new RoundedBoxGeometry(n.size, n.size, n.size, 2, n.size * 0.12)
      const color = n.branch < 0 ? 0x5ef2c2 : BRANCH[n.branch]
      const faceMat = n.hop === 0
        ? new THREE.MeshStandardMaterial({ map: grid, emissive: 0x5ef2c2, emissiveMap: grid, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.4 })
        : n.hop >= 3 && n.id % 3 === 0
          ? darkMat
          : new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: n.hop >= 3 ? 0.3 : 0.18, metalness: 0.2, roughness: 0.45 })
      const mesh = new THREE.Mesh(geo, faceMat)
      mesh.position.copy(n.pos)
      mesh.rotation.set(0.5 + n.id * 0.37, 0.3 + n.id * 0.61, 0)
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(n.size * 1.02, n.size * 1.02, n.size * 1.02)),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }))
      mesh.add(edges)
      let halo: THREE.Sprite | null = null
      if (n.hop <= 1) {
        halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity: n.hop === 0 ? 0.55 : 0.3, blending: THREE.AdditiveBlending, depthWrite: false }))
        halo.scale.setScalar(n.size * (n.hop === 0 ? 7 : 5))
        halo.position.copy(n.pos)
        group.add(halo)
      }
      mesh.scale.setScalar(0.0001)
      group.add(mesh)
      meshes.push({ n, mesh, edges, halo, spin: (n.id % 2 ? 1 : -1) * (0.15 + (n.id % 5) * 0.04) })
    }

    // branches: tubes that grow from parent to child
    const tubes: { n: N; mesh: THREE.Mesh; count: number; pts: THREE.Vector3[] }[] = []
    for (const n of nodes) {
      if (n.parent < 0) continue
      const a = nodes[n.parent].pos
      const b = n.pos
      const mid = a.clone().lerp(b, 0.5)
      mid.x = a.x + (b.x - a.x) * 0.35
      const curve = new THREE.CubicBezierCurve3(a.clone(), new THREE.Vector3(mid.x, a.y, a.z), new THREE.Vector3(mid.x, b.y, b.z), b.clone())
      const geo = new THREE.TubeGeometry(curve, 32, n.hop === 1 ? 0.42 : 0.26, 6, false)
      const color = BRANCH[n.branch]
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 }))
      const count = geo.index!.count
      geo.setDrawRange(0, 0)
      group.add(mesh)
      tubes.push({ n, mesh, count, pts: curve.getPoints(40) })
    }

    // value particles travelling along revealed branches
    const flows = tubes.flatMap((t, i) => [0, 0.5].map((o) => ({ t: t, k: (o + (i * 0.137) % 1) % 1 })))
    const pgeo = new THREE.BufferGeometry()
    pgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flows.length * 3), 3))
    const points = new THREE.Points(pgeo, new THREE.PointsMaterial({ map: glow, color: 0x3fd0ff, size: 2.4, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }))
    if (!reduced) group.add(points)

    // a technical floor and some drifting dust for depth
    const floor = new THREE.GridHelper(420, 42, 0x2f3a36, 0x1b2120)
    ;(floor.material as THREE.Material).transparent = true
    ;(floor.material as THREE.Material).opacity = 0.5
    floor.position.set(0, -58, 0)
    scene.add(floor)
    const dustN = 160
    const dust = new Float32Array(dustN * 3)
    const dr = rng(7)
    for (let i = 0; i < dustN; i++) dust.set([(dr() - 0.5) * 300, (dr() - 0.5) * 160, (dr() - 0.5) * 200], i * 3)
    const dgeo = new THREE.BufferGeometry()
    dgeo.setAttribute('position', new THREE.BufferAttribute(dust, 3))
    const dustPts = new THREE.Points(dgeo, new THREE.PointsMaterial({ map: glow, color: 0xf1efe7, size: 1.1, transparent: true, opacity: 0.35, depthWrite: false }))
    scene.add(dustPts)

    const resize = () => {
      const w = el.clientWidth || 1
      const h = el.clientHeight || 1
      renderer.setSize(w, h, false)
      renderer.domElement.style.width = `${w}px`
      renderer.domElement.style.height = `${h}px`
      camera.aspect = w / h
      // keep the whole sculpture in frame on tall/narrow screens
      camera.fov = w / h < 1 ? 52 : 36
      // wide screens: shift the frame right so the sculpture sits beside the chapter copy
      if (w > 1000) camera.setViewOffset(w, h, -w * 0.18, 0, w, h)
      else camera.clearViewOffset()
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(() => { resize(); wake() })
    ro.observe(el)
    let visible = true
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake() })
    io.observe(el)

    let shown = reduced ? 1 : progress.get()
    let raf = 0
    let last = performance.now()
    const v = new THREE.Vector3()
    const smooth = (x: number) => x * x * (3 - 2 * x)
    const clamp = (x: number) => Math.min(1, Math.max(0, x))
    const frame = (now: number) => {
      raf = 0
      if (!visible) return
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000))
      last = now
      const target = reduced ? 1 : progress.get()
      shown += (target - shown) * (reduced ? 1 : 0.08)
      if (Math.abs(target - shown) < 0.0005) shown = target
      const t = now / 1000

      for (const m of meshes) {
        const k = smooth(clamp((shown - hopAt(m.n.hop) + 0.02) / 0.07))
        m.mesh.scale.setScalar(Math.max(0.0001, k))
        if (!reduced) { m.mesh.rotation.y += dt * m.spin; m.mesh.rotation.x += dt * m.spin * 0.4 }
        if (m.halo) (m.halo.material as THREE.SpriteMaterial).opacity = (m.n.hop === 0 ? 0.55 : 0.3) * k
      }
      for (const tb of tubes) {
        const k = clamp((shown - hopAt(tb.n.hop) + 0.06) / 0.07)
        ;(tb.mesh.geometry as THREE.BufferGeometry).setDrawRange(0, Math.floor((tb.count / 3) * k) * 3)
      }
      if (!reduced) {
        const pos = pgeo.getAttribute('position') as THREE.BufferAttribute
        flows.forEach((f, i) => {
          const on = shown >= hopAt(f.t.n.hop) + 0.01
          f.k = (f.k + dt * 0.35) % 1
          const s = f.k * (f.t.pts.length - 1)
          const a = Math.floor(s)
          v.lerpVectors(f.t.pts[a], f.t.pts[Math.min(a + 1, f.t.pts.length - 1)], s - a)
          if (!on) v.set(0, -999, 0)
          pos.setXYZ(i, v.x, v.y, v.z)
        })
        pos.needsUpdate = true
        dustPts.rotation.y = t * 0.01
      }
      // camera: a slow orbit that widens as the network grows; a slight idle sway when motion is allowed
      const az = -0.95 + shown * 1.25 + (reduced ? 0 : Math.sin(t * 0.25) * 0.04)
      const dist = 112 + shown * 92
      const cx = -30 + shown * 34
      camera.position.set(cx + Math.sin(az) * dist, 30 + shown * 26, Math.cos(az) * dist)
      camera.lookAt(cx, -6, 0)
      renderer.render(scene, camera)
      if (!reduced || shown !== target) raf = requestAnimationFrame(frame)
    }
    const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame) } }
    const unsub = progress.on('change', wake)
    wake()

    return () => {
      cancelAnimationFrame(raf)
      unsub()
      ro.disconnect()
      io.disconnect()
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        m.geometry?.dispose()
        const mat = m.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
        else mat?.dispose()
      })
      grid.dispose()
      glow.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [progress, reduced, onFail])

  return <div ref={box} className="tfl-scene3d" data-testid="fragment-scene" />
}
