import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { fmtTime, short } from '../../../lib/format'
import type { Selection } from '../state'
import type { ViewHandle } from './FlowGraph2D'
import { HoverCard, type Hover } from './HoverCard'
import { KIND_LABEL, type FlowEdge, type FlowModel, type FlowNode, type NodeKind, type TracedPath } from './model'

interface Props {
  model: FlowModel
  selection: Selection
  onSelect: (s: Selection) => void
  onExpandColumn: (col: number) => void
  onExpandDownstream: (id: string) => void
  path: TracedPath | null
  isolate: boolean
  labels: boolean
  particles: boolean
  visibleUntil: number | null
  reduced: boolean
  onUnavailable: (reason: string) => void
}

// Scene palette: fixed (the 3D room is always dark), matched to the workspace's signal colours.
const C = {
  teal: 0x5ef2c2, cyan: 0x3fd0ff, amber: 0xffb03a, ember: 0xff7a3d, violet: 0xa99bff, steel: 0x6b7072, wallet: 0xc9c6bc,
  bg: 0x0e0f10, grid: 0x1c2120, gridMain: 0x2b3532,
}

type SceneState = {
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls
    graph: THREE.Group; tubes: THREE.Group; fx: THREE.Group; glow: THREE.Texture; grid: THREE.Texture
    nodes: Map<string, NodeObj>; edges: Map<string, EdgeObj>; pick: THREE.Mesh[]
    points: THREE.Points | null; flows: { pts: THREE.Vector3[]; t: number; speed: number }[]
    pulses: { s: THREE.Sprite; t0: number }[]
    tween: { p0: THREE.Vector3; p1: THREE.Vector3; t0v: THREE.Vector3; t1: THREE.Vector3; start: number; dur: number } | null
    home: { pos: THREE.Vector3; target: THREE.Vector3 } | null
    mouse: THREE.Vector2 | null; hovered: string | null; down: { x: number; y: number } | null; visible: boolean
  }

interface EdgeObj { e: FlowEdge; line: THREE.Line; arrow: THREE.Mesh | null; pts: THREE.Vector3[] }
interface NodeObj { n: FlowNode; mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; halo: THREE.Sprite | null; r: number }

function glowTexture() {
  const s = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const g = cv.getContext('2d')!
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.25, 'rgba(255,255,255,0.45)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, s, s)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function gridTexture() {
  const s = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const g = cv.getContext('2d')!
  g.fillStyle = '#123a30'
  g.fillRect(0, 0, s, s)
  g.strokeStyle = '#9ffbe0'
  g.lineWidth = 3
  for (let i = 0; i <= 6; i++) {
    const v = (i / 6) * s
    g.beginPath(); g.moveTo(v, 0); g.lineTo(v, s); g.stroke()
    g.beginPath(); g.moveTo(0, v); g.lineTo(s, v); g.stroke()
  }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const GEOS: Partial<Record<NodeKind, THREE.BufferGeometry>> = {}
function geometry(kind: NodeKind): THREE.BufferGeometry {
  if (GEOS[kind]) return GEOS[kind]!
  const g = kind === 'seed' ? new RoundedBoxGeometry(6.4, 6.4, 6.4, 3, 0.7)
    : kind === 'mixer' ? new THREE.OctahedronGeometry(3.2)
    : kind === 'bridge' ? new THREE.OctahedronGeometry(2.8).scale(1, 1.5, 1)
    : kind === 'exchange' ? new THREE.CylinderGeometry(2.6, 2.6, 1.8, 6)
    : kind === 'contract' ? new THREE.BoxGeometry(2.6, 2.6, 2.6)
    : kind === 'more' ? new THREE.TorusGeometry(2.6, 0.35, 8, 24)
    : kind === 'flagged' ? new THREE.SphereGeometry(2.4, 20, 14)
    : new THREE.SphereGeometry(1.6, 16, 12)
  GEOS[kind] = g
  return g
}
const radius = (k: NodeKind) => (k === 'seed' ? 4.4 : k === 'wallet' ? 1.8 : 3.2)

function nodeColor(n: FlowNode) {
  if (n.kind === 'seed') return C.teal
  if (n.kind === 'mixer') return C.ember
  if (n.flagged) return C.amber
  if (n.kind === 'bridge' || n.kind === 'exchange') return C.cyan
  if (n.kind === 'more') return C.steel
  return C.wallet
}

/** Interactive 3D model of the same fund-flow graph: hop columns along x, branches fanned around the axis. */
export const Network3D = forwardRef<ViewHandle, Props>(function Network3D(p, ref) {
  const box = useRef<HTMLDivElement>(null)
  const labelLayer = useRef<HTMLDivElement>(null)
  const latest = useRef(p)
  useLayoutEffect(() => {
    latest.current = p
  })
  const [hover, setHover] = useState<Hover | null>(null)
  const [failed] = useState<string | null>(() => (webglAvailable() ? null : NO_WEBGL))

  // everything the render loop needs, kept outside React state
  const S = useRef<SceneState | null>(null)

  // ---- mount: renderer, camera, controls, loop ---------------------------------------------------
  useEffect(() => {
    const el = box.current
    if (!el) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch {
      latest.current.onUnavailable(NO_WEBGL) // the workbench falls back to the 2D fund flow
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(C.bg, 0)
    el.prepend(renderer.domElement)
    renderer.domElement.style.display = 'block'
    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(C.bg, 0.0019)
    const camera = new THREE.PerspectiveCamera(42, 1, 1, 6000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.09
    controls.screenSpacePanning = true
    controls.minDistance = 12
    controls.maxDistance = 2200
    controls.zoomSpeed = 0.9
    scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x16110a, 0.75))
    const key = new THREE.DirectionalLight(0xffffff, 1.1)
    key.position.set(-1, 2, 1.5)
    scene.add(key)
    const rim = new THREE.PointLight(C.teal, 2.2, 420, 1.2)
    rim.position.set(0, 30, 40)
    scene.add(rim)
    const graph = new THREE.Group()
    const tubes = new THREE.Group()
    const fx = new THREE.Group()
    scene.add(graph, tubes, fx)
    const state: SceneState = {
      renderer, scene, camera, controls, graph, tubes, fx, glow: glowTexture(), grid: gridTexture(),
      nodes: new Map(), edges: new Map(), pick: [], points: null, flows: [], pulses: [], tween: null, home: null,
      mouse: null, hovered: null, down: null, visible: true,
    }
    S.current = state

    const resize = () => {
      const w = el.clientWidth || 1
      const h = el.clientHeight || 1
      renderer.setSize(w, h, false)
      renderer.domElement.style.width = `${w}px`
      renderer.domElement.style.height = `${h}px`
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    const io = new IntersectionObserver(([e]) => { state.visible = e.isIntersecting })
    io.observe(el)

    const ray = new THREE.Raycaster()
    const pickAt = (mx: number, my: number): string | null => {
      const r = renderer.domElement.getBoundingClientRect()
      const v = new THREE.Vector2(((mx - r.left) / r.width) * 2 - 1, -((my - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(v, camera)
      const hit = ray.intersectObjects(state.pick, false)[0]
      return hit ? (hit.object.userData.id as string) : null
    }
    const onMove = (ev: PointerEvent) => { state.mouse = new THREE.Vector2(ev.clientX, ev.clientY) }
    const onLeave = () => { state.mouse = null; state.hovered = null; setHover(null) }
    const onDown = (ev: PointerEvent) => { state.down = { x: ev.clientX, y: ev.clientY } }
    const onUp = (ev: PointerEvent) => {
      const d = state.down
      state.down = null
      if (!d || ev.button !== 0 || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 5) return
      const id = pickAt(ev.clientX, ev.clientY)
      const n = id ? state.nodes.get(id)?.n : null
      if (n?.kind === 'more') latest.current.onExpandColumn(n.col)
      else latest.current.onSelect(id ? { kind: 'node', address: id } : null)
    }
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerleave', onLeave)
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)

    let raf = 0
    let last = performance.now()
    const v = new THREE.Vector3()
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (!state.visible) return
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000))
      last = now
      // camera tween (focus / reset)
      if (state.tween) {
        const tw = state.tween
        const k = Math.min(1, (now - tw.start) / tw.dur)
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
        camera.position.lerpVectors(tw.p0, tw.p1, e)
        controls.target.lerpVectors(tw.t0v, tw.t1, e)
        if (k >= 1) state.tween = null
      }
      controls.update()
      if (!latest.current.reduced) for (const o of graph.children) if (o.userData.spin) o.rotation.z += dt * 0.35
      // transaction particles travel along the real edge curves
      if (state.points && state.flows.length) {
        const pos = state.points.geometry.getAttribute('position') as THREE.BufferAttribute
        state.flows.forEach((f, i) => {
          f.t = (((f.t + dt * f.speed) % 1) + 1) % 1
          const s = f.t * (f.pts.length - 1)
          const a = Math.floor(s)
          v.lerpVectors(f.pts[a], f.pts[Math.min(a + 1, f.pts.length - 1)], s - a)
          pos.setXYZ(i, v.x, v.y, v.z)
        })
        pos.needsUpdate = true
      }
      // reveal pulses
      for (let i = state.pulses.length - 1; i >= 0; i--) {
        const pl = state.pulses[i]
        const k = (now - pl.t0) / 900
        if (k >= 1) {
          fx.remove(pl.s)
          ;(pl.s.material as THREE.SpriteMaterial).dispose()
          state.pulses.splice(i, 1)
        } else {
          pl.s.scale.setScalar(4 + k * 22)
          ;(pl.s.material as THREE.SpriteMaterial).opacity = 0.8 * (1 - k)
        }
      }
      // hover picking, at most once per frame
      if (state.mouse) {
        const id = pickAt(state.mouse.x, state.mouse.y)
        if (id !== state.hovered) {
          state.hovered = id
          renderer.domElement.style.cursor = id ? 'pointer' : 'grab'
        }
      }
      renderer.render(scene, camera)
      placeLabels()
    }

    // HTML labels follow their nodes; only a handful are ever visible
    const proj = new THREE.Vector3()
    const placeLabels = () => {
      const layer = labelLayer.current
      if (!layer) return
      const w = el.clientWidth
      const h = el.clientHeight
      for (const child of Array.from(layer.children) as HTMLElement[]) {
        const id = child.dataset.id!
        const kind = child.dataset.kind
        let pos: THREE.Vector3 | null = null
        if (kind === 'col') {
          const x = Number(child.dataset.x)
          pos = proj.set(x, Number(child.dataset.y), 0)
        } else {
          const o = state.nodes.get(id)
          if (o) pos = proj.copy(o.mesh.position).add(new THREE.Vector3(0, o.r + 2.2, 0))
        }
        if (!pos) continue
        pos.project(camera)
        const off = pos.z > 1 || Math.abs(pos.x) > 1.2 || Math.abs(pos.y) > 1.2
        child.style.visibility = off ? 'hidden' : 'visible'
        child.style.transform = `translate(${((pos.x + 1) / 2) * w}px, ${((1 - pos.y) / 2) * h}px) translate(-50%, -100%)`
      }
      if (state.hovered !== (hoverRef.current?.nodeId ?? null)) {
        const o = state.hovered ? state.nodes.get(state.hovered) : null
        if (o) {
          proj.copy(o.mesh.position).project(camera)
          const hv = { x: ((proj.x + 1) / 2) * w, y: ((1 - proj.y) / 2) * h, nodeId: o.n.id }
          hoverRef.current = hv
          setHover(hv)
        } else {
          hoverRef.current = null
          setHover(null)
        }
      }
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerleave', onLeave)
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      controls.dispose()
      disposeGroup(graph)
      disposeGroup(tubes)
      disposeGroup(fx)
      state.points?.geometry.dispose()
      state.glow.dispose()
      state.grid.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      S.current = null
    }
  }, [])
  const hoverRef = useRef<Hover | null>(null)

  // ---- structure: rebuild meshes when the model changes (never on replay ticks) -----------------------
  useEffect(() => {
    const st = S.current
    if (!st) return
    disposeGroup(st.graph)
    st.nodes.clear()
    st.edges.clear()
    st.pick = []
    const m = p.model
    for (const n of m.nodes) {
      const color = nodeColor(n)
      const mat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: n.kind === 'seed' ? 0.9 : n.kind === 'wallet' ? 0.12 : 0.45,
        roughness: 0.35, metalness: n.kind === 'wallet' ? 0.35 : 0.15, transparent: true, opacity: n.kind === 'more' ? 0.55 : 1,
        ...(n.kind === 'seed' ? { map: st.grid, emissiveMap: st.grid } : {}),
      })
      const mesh = new THREE.Mesh(geometry(n.kind), mat)
      mesh.position.set(...n.p3)
      mesh.userData.id = n.id
      if (n.kind === 'more') mesh.rotation.y = Math.PI / 2
      if (n.kind === 'seed') {
        mesh.rotation.set(0.5, 0.7, 0)
        const ring = new THREE.Mesh(new THREE.TorusGeometry(9, 0.18, 6, 72), new THREE.MeshBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.6 }))
        ring.position.copy(mesh.position)
        ring.rotation.set(Math.PI / 2.4, 0.3, 0)
        ring.userData.spin = true
        st.graph.add(ring)
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(6.6, 6.6, 6.6)), new THREE.LineBasicMaterial({ color: C.teal })))
      }
      st.graph.add(mesh)
      st.pick.push(mesh)
      let halo: THREE.Sprite | null = null
      if (n.kind === 'seed' || n.flagged || n.kind === 'mixer') {
        halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: st.glow, color, transparent: true, opacity: n.kind === 'seed' ? 0.7 : 0.35, blending: THREE.AdditiveBlending, depthWrite: false }))
        halo.scale.setScalar(n.kind === 'seed' ? 30 : 12)
        halo.position.copy(mesh.position)
        st.graph.add(halo)
      }
      st.nodes.set(n.id, { n, mesh, mat, halo, r: radius(n.kind) })
    }
    const up = new THREE.Vector3(0, 1, 0)
    const arrowGeo = new THREE.ConeGeometry(0.75, 2.4, 8)
    for (const e of m.edges) {
      const a = st.nodes.get(e.source)
      const b = st.nodes.get(e.target)
      if (!a || !b) continue
      const pa = a.mesh.position
      const pb = b.mesh.position
      const mid = pa.clone().add(pb).multiplyScalar(0.5)
      const radial = new THREE.Vector3(0, mid.y, mid.z)
      const bend = radial.lengthSq() > 1 ? radial.normalize() : new THREE.Vector3(0, 1, 0)
      mid.addScaledVector(bend, e.back || e.kind === 'inferred' ? 14 : 3 + pa.distanceTo(pb) * 0.04)
      const curve = new THREE.QuadraticBezierCurve3(pa.clone(), mid, pb.clone())
      const pts = curve.getPoints(28)
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const dashed = e.kind !== 'transfer'
      const color = e.kind === 'inferred' ? C.amber : e.kind === 'transfer' ? C.teal : C.steel
      const mat = dashed
        ? new THREE.LineDashedMaterial({ color, transparent: true, opacity: 0.55, dashSize: e.kind === 'inferred' ? 0.8 : 2.2, gapSize: 1.6 })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.42 })
      const line = new THREE.Line(geo, mat)
      if (dashed) line.computeLineDistances()
      st.graph.add(line)
      let arrow: THREE.Mesh | null = null
      if (e.kind !== 'inferred') {
        const tEnd = 1 - Math.min(0.3, (b.r + 1.6) / Math.max(curve.getLength(), 1))
        arrow = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }))
        arrow.position.copy(curve.getPoint(tEnd))
        arrow.quaternion.setFromUnitVectors(up, curve.getTangent(tEnd).normalize())
        st.graph.add(arrow)
      }
      st.edges.set(e.id, { e, line, arrow, pts })
    }
    // a quiet technical floor and column markers
    const ys = m.nodes.map((n) => n.p3[1])
    const xs = m.nodes.map((n) => n.p3[0])
    const floorY = Math.min(...ys, 0) - 26
    const span = Math.max(240, (Math.max(...xs, 0) - Math.min(...xs, 0)) * 1.6)
    const grid = new THREE.GridHelper(span, Math.round(span / 16), C.gridMain, C.grid)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.35
    grid.position.set((Math.max(...xs, 0) + Math.min(...xs, 0)) / 2, floorY, 0)
    st.graph.add(grid)
    for (const c of m.columns) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(c.x3, floorY, -span / 2.4), new THREE.Vector3(c.x3, floorY, span / 2.4)])
      st.graph.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: c.col === 0 ? C.teal : C.gridMain, transparent: true, opacity: c.col === 0 ? 0.5 : 0.6 })))
      // each hop is a translucent disc around the flow axis: branches keep their angle from disc to disc
      if (c.col === 0) continue
      const rs = m.nodes.filter((n) => n.col === c.col && n.kind !== 'more').map((n) => Math.hypot(n.p3[1], n.p3[2]))
      const R = Math.max(10, ...rs) + 6
      const disc = new THREE.Mesh(new THREE.RingGeometry(R - 0.35, R, 96), new THREE.MeshBasicMaterial({ color: c.col > 0 ? C.teal : C.violet, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }))
      disc.position.set(c.x3, 0, 0)
      disc.rotation.y = Math.PI / 2
      st.graph.add(disc)
      const fill = new THREE.Mesh(new THREE.CircleGeometry(R, 64), new THREE.MeshBasicMaterial({ color: c.col > 0 ? C.teal : C.violet, transparent: true, opacity: 0.025, side: THREE.DoubleSide, depthWrite: false }))
      fill.position.copy(disc.position)
      fill.rotation.y = Math.PI / 2
      st.graph.add(fill)
    }
    // frame the whole model once; later rebuilds (expanding) keep the analyst's camera
    const box3 = new THREE.Box3().setFromPoints(m.nodes.map((n) => new THREE.Vector3(...n.p3)))
    const sphere = box3.getBoundingSphere(new THREE.Sphere())
    const R = Math.max(40, sphere.radius)
    const home = {
      target: sphere.center.clone(),
      pos: sphere.center.clone().add(new THREE.Vector3(-R * 0.3, R * 0.45, R * 1.8)),
    }
    if (!st.home) {
      st.camera.position.copy(home.pos)
      st.controls.target.copy(home.target)
      st.controls.update()
    }
    st.home = home
    box.current?.setAttribute('data-layout-version', String(Number(box.current.getAttribute('data-layout-version') ?? 0) + 1))
    box.current?.setAttribute('data-nodes', String(m.nodes.length))
  }, [p.model])

  // ---- appearance: selection, path, isolation, replay, particles --------------------------------------
  const prevAt = useRef<number | null>(null)
  useEffect(() => {
    const st = S.current
    if (!st) return
    const sel = p.selection?.kind === 'node' ? p.selection.address : null
    const pathN = new Set(p.path?.nodes ?? [])
    const pathE = new Set(p.path?.edges ?? [])
    const at = p.visibleUntil
    const prev = prevAt.current
    prevAt.current = at
    const nbr = new Set<string>()
    if (sel) for (const e of p.model.edges) {
      if (e.source === sel) nbr.add(e.target)
      if (e.target === sel) nbr.add(e.source)
    }
    const focusSet = pathN.size ? pathN : sel ? new Set([sel, ...nbr]) : null
    const dimOthers = p.isolate && !!focusSet

    const liveNodes = new Set<string>()
    const fresh: string[] = []
    for (const [id, o] of st.edges) {
      const future = at !== null && o.e.first !== null && o.e.first > at && o.e.kind !== 'more'
      const on = pathE.has(id) || (!pathE.size && sel !== null && (o.e.source === sel || o.e.target === sel))
      const dim = dimOthers && !(pathE.size ? pathE.has(id) : focusSet!.has(o.e.source) && focusSet!.has(o.e.target))
      styleEdge(o, future, dim, on)
      if (!future) { liveNodes.add(o.e.source); liveNodes.add(o.e.target) }
      if (at !== null && prev !== null && at > prev && o.e.first !== null && o.e.first > prev && o.e.first <= at) fresh.push(o.e.target)
    }
    for (const [id, o] of st.nodes) {
      const future = at !== null && o.n.kind !== 'seed' && o.n.kind !== 'more' && !liveNodes.has(id)
      const dim = dimOthers && !focusSet!.has(id)
      styleNode(o, future, dim, id === sel, pathN.has(id))
    }
    // glowing tubes for the traced route / selected wallet's transfers (lines are 1px in WebGL)
    disposeGroup(st.tubes)
    const tubeIds = pathE.size ? [...pathE] : sel ? [...st.edges.keys()].filter((k) => { const e = st.edges.get(k)!.e; return e.kind !== 'more' && (e.source === sel || e.target === sel) }) : []
    for (const id of tubeIds.slice(0, 80)) {
      const o = st.edges.get(id)
      if (!o) continue
      const curve = new THREE.CatmullRomCurve3(o.pts)
      st.tubes.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, pathE.size ? 0.55 : 0.32, 8, false),
        new THREE.MeshBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })))
    }
    if (sel) {
      const o = st.nodes.get(sel)
      if (o) {
        const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: st.glow, color: C.cyan, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }))
        ring.scale.setScalar(o.r * 7)
        ring.position.copy(o.mesh.position)
        st.tubes.add(ring)
      }
    }
    // particles: only on drawn, already-revealed transfers (and only the focused ones when isolating)
    if (st.points) {
      st.fx.remove(st.points)
      st.points.geometry.dispose()
      ;(st.points.material as THREE.Material).dispose()
      st.points = null
    }
    st.flows = []
    if (p.particles && !p.reduced) {
      for (const [id, o] of st.edges) {
        if (o.e.kind !== 'transfer') continue
        if (at !== null && o.e.first !== null && o.e.first > at) continue
        if (dimOthers && !(pathE.size ? pathE.has(id) : focusSet!.has(o.e.source) && focusSet!.has(o.e.target))) continue
        const k = 1 + Math.min(2, Math.floor(Math.log10((o.e.edge?.count ?? 1) + 1)))
        const len = o.pts[0].distanceTo(o.pts[o.pts.length - 1])
        for (let j = 0; j < k; j++) st.flows.push({ pts: o.pts, t: (j / k + hash(id)) % 1, speed: Math.min(0.6, 18 / Math.max(len, 10)) })
      }
      if (st.flows.length) {
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(st.flows.length * 3), 3))
        st.points = new THREE.Points(geo, new THREE.PointsMaterial({
          map: st.glow, color: C.cyan, size: 2.6, sizeAttenuation: true, transparent: true, opacity: 0.95,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }))
        st.fx.add(st.points)
      }
    }
    if (fresh.length && !p.reduced) {
      for (const id of fresh.slice(0, 12)) {
        const o = st.nodes.get(id)
        if (!o) continue
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: st.glow, color: C.cyan, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }))
        s.position.copy(o.mesh.position)
        st.fx.add(s)
        st.pulses.push({ s, t0: performance.now() })
      }
    }
  }, [p.selection, p.path, p.isolate, p.particles, p.visibleUntil, p.model, p.reduced])

  // ---- camera moves -------------------------------------------------------------------------------
  const moveCamera = (pos: THREE.Vector3, target: THREE.Vector3) => {
    const st = S.current
    if (!st) return
    if (latest.current.reduced) {
      st.camera.position.copy(pos)
      st.controls.target.copy(target)
      st.controls.update()
      return
    }
    st.tween = { p0: st.camera.position.clone(), p1: pos, t0v: st.controls.target.clone(), t1: target, start: performance.now(), dur: 900 }
  }
  const focusNode = (id: string) => {
    const st = S.current
    const o = st?.nodes.get(id)
    if (!st || !o) return
    const target = o.mesh.position.clone()
    const dir = st.camera.position.clone().sub(st.controls.target).normalize()
    moveCamera(target.clone().add(dir.multiplyScalar(120)), target)
  }
  useImperativeHandle(ref, () => ({
    fit: () => { const h = S.current?.home; if (h) moveCamera(h.pos.clone(), h.target.clone()) },
    reset: () => { const h = S.current?.home; if (h) moveCamera(h.pos.clone(), h.target.clone()) },
    zoom: (f) => {
      const st = S.current
      if (!st) return
      const dir = st.camera.position.clone().sub(st.controls.target)
      moveCamera(st.controls.target.clone().add(dir.multiplyScalar(1 / f)), st.controls.target.clone())
    },
    focus: focusNode,
  }))

  // which labels exist (positions are updated by the render loop)
  const sel = p.selection?.kind === 'node' ? p.selection.address : null
  const labelIds = new Set<string>()
  for (const n of p.model.nodes) {
    // labels stay sparse in 3D: the start, services, the selection and the traced route; the rest on hover
    if (n.kind === 'seed' || n.kind === 'more' || n.id === sel || p.path?.nodes.includes(n.id)) labelIds.add(n.id)
    else if (p.labels && (n.kind === 'bridge' || n.kind === 'exchange' || n.kind === 'mixer')) labelIds.add(n.id)
  }
  const floorY = Math.min(...p.model.nodes.map((n) => n.p3[1]), 0) - 26
  const selNode = sel ? p.model.byId.get(sel) : undefined
  const hoverNode = hover?.nodeId ? p.model.byId.get(hover.nodeId) : undefined

  if (failed) {
    return <div className="flex h-full min-h-[460px] items-center justify-center p-6 text-center text-sm text-dim">{failed}</div>
  }
  return (
    <div className="tf-scene relative h-full min-h-[460px] w-full overflow-hidden">
      <div ref={box} className="absolute inset-0" data-testid="flow-3d" role="img"
        aria-label={`3D fund-flow network: ${p.model.shownWallets} wallets in hop layers around the starting wallet. Drag to orbit, right-drag to pan, scroll to zoom. Use the wallet list for keyboard access.`} />
      <div ref={labelLayer} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {p.model.columns.map((c) => (
          <span key={`col${c.col}`} data-id={`col:${c.col}`} data-kind="col" data-x={c.x3} data-y={floorY}
            className="absolute top-0 left-0 font-mono text-[10px] font-medium whitespace-nowrap tracking-[0.14em] text-[#8f8d86] uppercase">{c.label}</span>
        ))}
        {[...labelIds].map((id) => {
          const n = p.model.byId.get(id)!
          return (
            <span key={id} data-id={id} className={`absolute top-0 left-0 whitespace-nowrap border px-1.5 py-0.5 text-[11px] ${
              id === sel ? 'border-[#3fd0ff] bg-[#0b2f3a]/90 text-white' : n.kind === 'seed' ? 'border-[#5ef2c2]/60 bg-[#0e0f10]/85 font-semibold text-[#5ef2c2]' : 'border-[#3b3e42] bg-[#0e0f10]/80 text-[#d9d6cc]'}`}>
              {n.title}
            </span>
          )
        })}
      </div>
      {hover && hoverNode && hover.nodeId !== sel && (
        <HoverCard x={hover.x} y={hover.y} node={hoverNode} model={p.model} />
      )}
      {selNode && selNode.node && (
        <div className="absolute top-3 left-3 w-[260px] border border-[#3b3e42] border-t-2 border-t-[#3fd0ff] bg-[#0e0f10]/88 p-3 text-xs text-[#d9d6cc] backdrop-blur-sm" data-testid="hud-selected">
          <p className="font-mono text-[10px] tracking-[0.14em] text-[#3fd0ff] uppercase">Selected wallet</p>
          <p className="mt-1 font-display text-base leading-tight font-black text-white uppercase">{selNode.title}</p>
          <p className="mono text-[#a8a59c]">{short(selNode.id, 8)}</p>
          <p className="mt-1">{KIND_LABEL[selNode.kind]}{selNode.flagged && selNode.kind !== 'flagged' ? ' · flagged by a public source' : ''}</p>
          <p className="text-[#a8a59c]">{p.model.columns.find((c) => c.col === selNode.col)?.label} · {selNode.node.in_count} in / {selNode.node.out_count} out</p>
          {p.path && p.path.nodes.at(-1) === selNode.id && p.path.edges.length > 0 && (
            <p className="mt-1 text-[#3fd0ff]">Route: {p.path.edges.length} transfer{p.path.edges.length === 1 ? '' : 's'} {p.path.direction === 'upstream' ? 'into' : 'from'} the starting wallet</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" className="tf-btn py-0.5 text-[11px]" onClick={() => focusNode(selNode.id)}>Focus wallet</button>
            <button type="button" className="tf-btn py-0.5 text-[11px]" onClick={() => p.onExpandDownstream(selNode.id)}>Expand downstream</button>
          </div>
        </div>
      )}
      <p className="pointer-events-none absolute bottom-2 left-3 font-mono text-[10.5px] text-[#8f8d86]">
        Drag to orbit · right-drag or shift-drag to pan · scroll to zoom · click a wallet to inspect
        {p.visibleUntil !== null && <> · replay at {fmtTime(p.visibleUntil)}</>}
      </p>
    </div>
  )
})

const NO_WEBGL = 'This browser could not start WebGL, so the 3D network is unavailable here. The 2D fund flow shows the same data.'

function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'))
  } catch {
    return false
  }
}

function styleNode(o: NodeObj, future: boolean, dim: boolean, isSel: boolean, onPath: boolean) {
  o.mat.opacity = future ? 0.22 : dim ? 0.08 : o.n.kind === 'more' ? 0.55 : 1
  o.mat.emissiveIntensity = isSel ? 1.4 : onPath ? 1 : o.n.kind === 'seed' ? 0.9 : o.n.kind === 'wallet' ? 0.18 : 0.45
  o.mesh.scale.setScalar(isSel ? 1.6 : onPath ? 1.25 : 1)
  if (o.halo) (o.halo.material as THREE.SpriteMaterial).opacity = future || dim ? 0.05 : o.n.kind === 'seed' ? 0.7 : 0.35
}

function styleEdge(o: EdgeObj, future: boolean, dim: boolean, on: boolean) {
  const mat = o.line.material as THREE.LineBasicMaterial
  mat.opacity = future ? 0.08 : dim ? 0.04 : on ? 0.95 : o.e.kind === 'transfer' ? 0.42 : 0.55
  mat.color.setHex(on ? C.cyan : o.e.kind === 'inferred' ? C.amber : o.e.kind === 'transfer' ? C.teal : C.steel)
  if (o.arrow) {
    o.arrow.visible = !future && !dim
    ;(o.arrow.material as THREE.MeshBasicMaterial).color.setHex(on ? C.cyan : o.e.kind === 'transfer' ? C.teal : C.steel)
  }
}

function disposeGroup(g: THREE.Group) {
  for (const child of [...g.children]) {
    g.remove(child)
    const o = child as THREE.Mesh
    if (o.geometry && !Object.values(GEOS).includes(o.geometry)) o.geometry.dispose()
    const m = o.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(m)) m.forEach((x) => x.dispose())
    else m?.dispose()
  }
}

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return ((h >>> 0) % 1000) / 1000
}
