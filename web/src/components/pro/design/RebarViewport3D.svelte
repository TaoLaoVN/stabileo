<script lang="ts">
  /**
   * The WebGL surface for the reinforcement scene.
   *
   * Deliberately thin. It owns a renderer, a camera, controls and a light rig, and it knows
   * how to turn a `SceneModel` into meshes and a click into a bar id. It knows nothing about
   * documents, filters, stores or exports — those live in the panel above it, so this file
   * can be reasoned about as "does the picture appear and can you click it".
   *
   * ── Rendering is on demand ─────────────────────────────────────────
   *
   * No permanent animation loop. A cage does not move on its own, and a `requestAnimationFrame`
   * spinning at 60 Hz over a static scene is a laptop fan running for nothing — this panel sits
   * inside a workflow a user leaves open for hours. Frames are drawn when something changes:
   * the scene, an option, an orbit, a resize. `OrbitControls` damping needs a short tail of
   * frames after the pointer leaves, and that tail is counted rather than guessed at.
   */
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
  import { createRebarScene, frameBounds, type RebarScene }
    from '../../../lib/three/rebar-scene';
  import type { SceneModel } from '../../../lib/engine/detailing/scene-model';
  import { t } from '../../../lib/i18n';

  interface Props {
    scene: SceneModel;
    diameterScale?: number;
    showConcrete?: boolean;
    showConflicts?: boolean;
    selectedBarId?: string | null;
    onselect?: (barId: string | null) => void;
    height?: string;
  }

  const {
    scene, diameterScale = 1, showConcrete = true, showConflicts = true,
    selectedBarId = null, onselect, height = '460px',
  }: Props = $props();

  let host = $state<HTMLDivElement | null>(null);
  let failed = $state(false);

  let renderer: THREE.WebGLRenderer | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let controls: OrbitControls | null = null;
  let root: THREE.Scene | null = null;
  let built: RebarScene | null = null;
  let highlight: THREE.Mesh | null = null;

  /** Frames still owed to damping. Counted, so the tail ends rather than running forever. */
  let pending = 0;
  let running = false;

  function invalidate(frames = 1) {
    pending = Math.max(pending, frames);
    if (running || !renderer) return;
    running = true;
    requestAnimationFrame(tick);
  }

  function tick() {
    if (!renderer || !camera || !root) { running = false; return; }
    controls?.update();
    renderer.render(root, camera);
    pending -= 1;
    if (pending > 0) requestAnimationFrame(tick);
    else running = false;
  }

  function fit() {
    if (!camera || !controls) return;
    const f = frameBounds(scene, camera.fov, camera.aspect);
    if (!f) return;
    controls.target.copy(f.centre);
    // Down the long diagonal: a cage read straight down an axis hides every bar behind the
    // one in front of it.
    camera.position.set(
      f.centre.x + f.distance * 0.7,
      f.centre.y - f.distance * 0.7,
      f.centre.z + f.distance * 0.55,
    );
    camera.near = Math.max(0.01, f.distance / 500);
    camera.far = f.distance * 40;
    camera.updateProjectionMatrix();
    controls.update();
    invalidate(20);
  }

  export function fitView() { fit(); }

  function rebuild() {
    if (!root) return;
    if (built) { root.remove(built.group); built.dispose(); built = null; }
    built = createRebarScene(scene, { diameterScale, showConcrete, showConflicts });
    root.add(built.group);
    invalidate(2);
  }

  function pick(ev: PointerEvent) {
    if (!renderer || !camera || !built || !onselect) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const meshes = built.bars.map((b) => b.mesh);
    const hits = ray.intersectObjects(meshes, false);
    if (hits.length === 0) { onselect(null); return; }
    // `faceIndex` is nullable on an intersection with a non-indexed or point geometry; the
    // picking map treats absent as "no bar" rather than as face zero.
    onselect(built.barIdAt(hits[0].object, hits[0].faceIndex ?? undefined));
  }

  /**
   * Mark the selected bar with a ring rather than by recolouring it.
   *
   * Recolouring would mean splitting the merged mesh, which is the batching this view exists
   * to keep. A ring at the bar's midpoint is cheap, survives the merge, and stays visible
   * when the bar itself is behind concrete.
   */
  function syncHighlight() {
    if (!root) return;
    if (highlight) {
      root.remove(highlight);
      highlight.geometry.dispose();
      (highlight.material as THREE.Material).dispose();
      highlight = null;
    }
    const bar = selectedBarId ? scene.bars.find((b) => b.barId === selectedBarId) : null;
    if (bar && bar.polyline.length > 0) {
      const p = bar.polyline[Math.floor(bar.polyline.length / 2)];
      const r = Math.max(0.05, (bar.diameterMm / 2000) * 6);
      highlight = new THREE.Mesh(
        new THREE.SphereGeometry(r, 16, 12),
        new THREE.MeshBasicMaterial({
          color: 0xffd400, transparent: true, opacity: 0.55, depthTest: false,
        }),
      );
      highlight.position.set(p.x, p.y, p.z);
      highlight.renderOrder = 3;
      root.add(highlight);
    }
    invalidate(2);
  }

  onMount(() => {
    if (!host) return;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      // A machine with no WebGL gets a sentence, not a blank rectangle.
      failed = true;
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    root = new THREE.Scene();
    // Z up, to match the structural model rather than Three's default Y up. Every coordinate
    // in the scene model is the analysis model's own.
    root.up.set(0, 0, 1);

    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.up.set(0, 0, 1);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.addEventListener('change', () => invalidate(2));

    root.add(new THREE.AmbientLight(0xffffff, 0.72));
    const key = new THREE.DirectionalLight(0xffffff, 0.75);
    key.position.set(1, -1, 1.4);
    root.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-1, 1, 0.6);
    root.add(fill);

    /**
     * The first measurement refits.
     *
     * `onMount` runs before the element has been laid out, so the camera's aspect is still
     * the constructor's 1 and its size is 0×0. Framing there and never again computed the
     * distance for a square viewport and applied it to this panel's wide, short one — the
     * scene fitted vertically and ran off both sides. Every LATER resize keeps the user's
     * camera where they put it; only the first one, which is really "the canvas now exists",
     * is allowed to move it.
     */
    let measured = false;
    const resize = new ResizeObserver(() => {
      if (!renderer || !camera || !host) return;
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (!measured && host.clientWidth > 0) { measured = true; fit(); }
      invalidate(2);
    });
    resize.observe(host);

    rebuild();
    fit();

    return () => {
      resize.disconnect();
      controls?.dispose();
      built?.dispose();
      renderer?.dispose();
      renderer?.domElement.remove();
      renderer = null;
      camera = null;
      root = null;
      built = null;
    };
  });

  // Rebuilding on a scene or option change, and refitting only when the SCENE changed —
  // refitting on a checkbox would yank the camera away from wherever the user had put it.
  let lastScene: SceneModel | null = null;
  $effect(() => {
    // Touch the options so the effect re-runs when any of them changes.
    void diameterScale; void showConcrete; void showConflicts;
    if (!root) return;
    const changed = lastScene !== scene;
    lastScene = scene;
    rebuild();
    if (changed) fit();
  });

  $effect(() => {
    void selectedBarId;
    syncHighlight();
  });
</script>

<div class="rebar-viewport" style:height>
  {#if failed}
    <p class="fallback">{t('detailing.scene.noWebgl')}</p>
  {:else}
    <div
      class="host"
      data-testid="rebar-canvas"
      bind:this={host}
      onpointerdown={(e) => { if (e.button === 0) pick(e); }}
    ></div>
  {/if}
</div>

<style>
  .rebar-viewport {
    position: relative;
    width: 100%;
    border: 1px solid var(--border, #2a2f3a);
    border-radius: 6px;
    overflow: hidden;
    background: linear-gradient(160deg, #12161d 0%, #1a2029 100%);
  }
  .host { width: 100%; height: 100%; }
  .fallback {
    margin: 0;
    padding: 1.5rem;
    text-align: center;
    color: var(--text-muted, #8b93a3);
    font-size: 0.85rem;
  }
</style>
