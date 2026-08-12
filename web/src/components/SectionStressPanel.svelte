<script lang="ts">

  /**
   * `docked` renders this panel inside the right-hand panel instead of floating
   * over the canvas.
   *
   * Floating was the old shell's answer to "where does an analysis put its
   * output": a box pinned to a corner of the drawing area. With several
   * analyses open it stopped being an answer — Kinematic sat over the left of
   * the model, Explore over the right, and the structure they describe was
   * behind them. The new shell already has one place for anything that needs
   * area and outlives a single click, so that is where this goes; the floating
   * form is kept for mobile, which has no right panel to dock into.
   */
  let { docked = false }: { docked?: boolean } = $props();
  import { modelStore, resultsStore, uiStore, tourStore } from '../lib/store';
  import { t } from '../lib/i18n';
  import { propertyDeviation } from '../lib/section/state';
  import { canonicalStressState } from '../lib/section/stress-state';
  import { supportsDetailedAnalysis } from '../lib/section/drawing';
  import { canonicalPanelResult, stationForces2D, stationForces3D } from '../lib/section/panel';
  import {
    analyzeSectionStress,
    suggestCriticalSections,
    computeShearFlowPaths,
    isMassiveSection,
    computeCentralCore,
    type SectionStressResult,
    type ShearFlowSegment,
    type CentralCore,
  } from '../lib/engine/section-stress';
  import {
    analyzeSectionStress3D,
    analyzeSectionStressFromForces,
    suggestCriticalSections3D,
    computePerpNADistribution,
    computeNeutralAxisMomentsOnly,
    type SectionStressResult3D,
    type PerpNAPoint,
  } from '../lib/engine/section-stress-3d';
  import { computeDiagramValueAt } from '../lib/engine/diagrams';
  import { fmtForce, isPointInConvexPolygon } from './stress/fmt';
  import CrossSectionDrawing from './stress/CrossSectionDrawing.svelte';
  import StressStateDetails from './stress/StressStateDetails.svelte';
  import MohrCircleDisplay from './stress/MohrCircleDisplay.svelte';
  import CentralCoreDetails from './stress/CentralCoreDetails.svelte';
  import StressTensorDetails from './stress/StressTensorDetails.svelte';
  import { resolveEccentric } from '../lib/section/eccentric';

  // Fiber position sliders: 0 = bottom/left, 1 = top/right
  let fiberRatioY = $state(1.0); // default to top fiber (extreme)
  let fiberRatioZ = $state(0.5); // default to center (z=0)

  // Collapsible sections (only cross-section open by default — issue #13)
  let showCrossSection = $state(true);
  let showTensional = $state(false);
  let showMohr = $state(false);
  let showCritical = $state(false);

  // SVG overlay toggles
  let showSigma = $state(true);               // Master σ toggle (ON by default — controls all sigma visuals)
  let showShearOnDrawing = $state(false);     // τ diagram on section SVG (OFF by default)
  let showTotalSigma = $state(false); // false = solo momento (default), true = σ total (N/A + biaxial M/I)
  let showPerpNA = $state(false);              // σ perpendicular to neutral axis (3D biaxial, OFF)
  let showCentralCore = $state(false);          // NC: núcleo central overlay
  let showPressureCenter = $state(false);      // CP: centro de presiones overlay
  let showCentralCoreInfo = $state(false);     // NC details section (closed by default)
  let useGlobalScale = $state(true);           // Local/global stress scaling toggle (global by default)
  let showTensors = $state(false);             // Stress/strain tensor section (closed by default)
  let showStressMap = $state(false);           // MAP: paint sigma over the section instead of at a point
  let showEccentric = $state(false);           // CE: eccentric application point
  /**
   * Where the eccentric load is applied, canonical `[y, z]` in metres.
   *
   * Starts at the centroid rather than at some corner: that is the position
   * whose effect is nil, so the first drag reads as "moving it away from the
   * reference does this", which is the relationship worth showing.
   */
  let eccentricPoint = $state<[number, number] | null>([0, 0]);
  /**
   * Where the eccentric load comes from.
   *
   * `model` relocates the forces the member ALREADY carries at this station to
   * the chosen point — "what if this same load acted here instead of on the
   * axis". `custom` adds a load of your own on top of everything the model
   * produces. Both are legitimate questions and they are not the same one, so
   * the panel asks which rather than guessing.
   */
  let eccSource = $state<'model' | 'custom'>('model');
  /** User-defined load components, kN. Only used when `eccSource` is 'custom'. */
  let eccCustom = $state({ n: 0, vy: 0, vz: 0 });

  const is3D = $derived(uiStore.analysisMode === '3d' || uiStore.analysisMode === 'pro');
  const query = $derived(resultsStore.stressQuery);
  const querySec = $derived.by(() => {
    if (!query) return null;
    const elem = modelStore.elements.get(query.elementId);
    if (!elem) return null;
    return modelStore.sections.get(elem.sectionId) ?? null;
  });
  /** 2D section with rotation → show biaxial decomposition (quasi-3D visualization) */
  const isRotated2D = $derived(!is3D && (querySec?.rotation ?? 0) !== 0);

  // ── Detailed geometry availability ──────────────────────────────
  //
  // A detailed stress field requires an exact outline. Previously this asked
  // only whether the section had a `shape` string, which let a rolled profile
  // through on the strength of its NAME while its true dimensions were
  // reconstructed by guesswork. It now asks the canonical layer, so a section
  // qualifies only if its geometry is actually known. The existing warning
  // surface below is reused unchanged — the answer got stricter, not the UI.
  const isAmorphous = $derived.by((): boolean => {
    if (!query) return false;
    const elem = modelStore.elements.get(query.elementId);
    if (!elem) return false;
    const sec = modelStore.sections.get(elem.sectionId);
    if (!sec) return false;
    return !supportsDetailedAnalysis(sec);
  });

  /**
   * Why detailed analysis is unavailable, and for which profile.
   *
   * A rolled IPN or UPN is NOT an amorphous section — it is a precisely
   * defined profile whose fillet radii and flange taper we do not yet hold.
   * Calling it "amorfa (sin forma geométrica definida)" told the user
   * something false about their model and read as a bug. The two cases now
   * get different wording: genuinely shapeless sections keep the original
   * message, known profiles get one that names the actual limitation.
   */
  /**
   * How far the analysed geometry sits from the catalogue's published numbers.
   *
   * Null for nine of the ten families. It exists for W, whose source table
   * marks its dimensions nominal and derives area from nominal mass, so the
   * table is internally inconsistent and no outline reproduces both. The
   * analysis stays consistent with the geometry it draws, and the gap against
   * the table is stated here rather than left for the user to discover while
   * reconciling against CIRSOC.
   */
  const deviation = $derived.by(() => {
    if (!query) return null;
    const elem = modelStore.elements.get(query.elementId);
    if (!elem) return null;
    const sec = modelStore.sections.get(elem.sectionId);
    return sec ? propertyDeviation(sec) : null;
  });

  const unavailableReason = $derived.by((): { kind: 'amorphous' | 'noGeometryData'; name: string } | null => {
    if (!query) return null;
    const elem = modelStore.elements.get(query.elementId);
    if (!elem) return null;
    const sec = modelStore.sections.get(elem.sectionId);
    if (!sec || supportsDetailedAnalysis(sec)) return null;
    const st = sec.canonical;
    const dataGap =
      st?.kind === 'properties-only' &&
      st.reason.kind !== 'noGeometry';
    return { kind: dataGap ? 'noGeometryData' : 'amorphous', name: sec.name || '—' };
  });

  /**
   * Canonical axial + bending for the selected element and station.
   *
   * The numbers here and the outline `CrossSectionDrawing` renders come from
   * one geometry, and `canonicalPanelResult` refuses if their digests or
   * schema versions disagree rather than letting the two describe different
   * sections.
   */
  const canonical = $derived.by(() => {
    if (!query) return null;
    const elem = modelStore.elements.get(query.elementId);
    if (!elem) return null;
    const sec = modelStore.sections.get(elem.sectionId);
    if (!sec || !supportsDetailedAnalysis(sec)) return null;

    if (is3D) {
      const ef = resultsStore.getElementForces3D(query.elementId);
      if (!ef) return null;
      return canonicalPanelResult(sec, stationForces3D(ef as never, query.t));
    }
    const ef = resultsStore.getElementForces(query.elementId);
    if (!ef) return null;
    return canonicalPanelResult(sec, stationForces2D(ef, query.t));
  });

  /** Canonical drawing geometry, or null when the section is refused. */
  const canonicalGeometry = $derived(canonical?.ok ? canonical.geometry : null);

  // ── 2D analysis (skip if section is rotated → uses biaxial path instead) ──
  const analysis2D = $derived.by((): SectionStressResult | null => {
    // An eccentric load is biaxial in general — moving an axial force sideways
    // produces Mz, which a plane-frame result cannot represent — so that case
    // is handed to the biaxial path below, exactly as a rotated section is.
    if (eccentricActive) return null;
    if (is3D || isRotated2D || !query || !resultsStore.results || isAmorphous) return null;
    const elem = modelStore.elements.get(query.elementId);
    if (!elem) return null;
    const sec = modelStore.sections.get(elem.sectionId);
    const mat = modelStore.materials.get(elem.materialId);
    if (!sec || !mat) return null;
    const ef = resultsStore.getElementForces(query.elementId);
    if (!ef) return null;

    const resolved = analyzeSectionStress(ef, sec, mat.fy, query.t);
    const rs = resolved.resolved;
    const yFiber = rs.yMin + fiberRatioY * (rs.yMax - rs.yMin);
    return analyzeSectionStress(ef, sec, mat.fy, query.t, yFiber);
  });

  // ── 3D analysis (also handles rotated 2D sections via force decomposition) ──
  const analysis3D = $derived.by((): SectionStressResult3D | null => {
    if (isAmorphous || !query) return null;

    // ── Eccentric load: plot the RESOLVED forces ─────────────────
    //
    // This is what makes the eccentricity visible in the diagrams instead of
    // only in the readout. It also has to run through the biaxial path even
    // for a plane frame: an axial force moved off the vertical axis produces
    // Mz, and bending about the weak axis simply does not exist in a 2D result.
    //
    // The two paths disagree on sign. `stationForces2D` reports `my = M`, while
    // this function wants the opposite sign to place tension on the same fibre
    // — the same inversion the rotated-2D branch below applies. The axes also
    // swap names: `yFiber` here is the DEPTH, which is the canonical z, and
    // `zFiber` is the width, which is the canonical y. Both were established by
    // measurement, and `eccentric-diagrams.test.ts` pins them.
    if (eccentricActive && eccentric && stateInputs) {
      const elem = modelStore.elements.get(query.elementId);
      const sec = elem ? modelStore.sections.get(elem.sectionId) : null;
      const mat = elem ? modelStore.materials.get(elem.materialId) : null;
      if (!sec || !mat) return null;
      const f = eccentric.forces;
      const [py, pz] = stateInputs.point;
      return analyzeSectionStressFromForces(
        f.n, f.vy, f.vz, f.t,
        -f.my, -f.mz,
        sec, mat.fy,
        pz, py,
      );
    }

    // ── True 3D mode ──
    if (is3D) {
      if (!resultsStore.results3D) return null;
      const elem = modelStore.elements.get(query.elementId);
      if (!elem) return null;
      const sec = modelStore.sections.get(elem.sectionId);
      const mat = modelStore.materials.get(elem.materialId);
      if (!sec || !mat) return null;
      const ef = resultsStore.getElementForces3D(query.elementId);
      if (!ef) return null;

      const halfH = ef.length > 0 ? (sec.h ?? Math.sqrt(12 * (sec.iy ?? sec.iz) / sec.a)) / 2 : 0.1;
      const halfB = (sec.b ?? sec.h ?? Math.sqrt(12 * sec.iz / sec.a)) / 2;
      const yFiber = -halfH + fiberRatioY * halfH * 2;
      const zFiber = -halfB + fiberRatioZ * halfB * 2;
      return analyzeSectionStress3D(ef, sec, mat.fy, query.t, yFiber, zFiber);
    }

    // ── Rotated 2D: decompose M, V into biaxial components ──
    if (!isRotated2D || !resultsStore.results) return null;
    const elem = modelStore.elements.get(query.elementId);
    if (!elem) return null;
    const sec = modelStore.sections.get(elem.sectionId);
    const mat = modelStore.materials.get(elem.materialId);
    if (!sec || !mat) return null;
    const ef = resultsStore.getElementForces(query.elementId);
    if (!ef) return null;

    // Get raw 2D forces at position t
    const M_2d = computeDiagramValueAt('moment', query.t, ef);
    const V_2d = computeDiagramValueAt('shear', query.t, ef);
    const N_2d = computeDiagramValueAt('axial', query.t, ef);

    // Decompose 2D bending into the section's rotated local axes (PR [12] convention).
    // At α = 0° the 2D bending is the strong-axis / DEPTH bending → My (uses Iy), and the
    // 2D shear is the vertical shear → Vz. At α = 90° they rotate to the width / weak axis:
    // Mz (uses Iz) and the lateral shear Vy.
    const alpha = (sec.rotation ?? 0) * Math.PI / 180;
    const cosA = Math.cos(alpha);
    const sinA = Math.sin(alpha);
    const My = -M_2d * cosA;  // depth bending (sign chosen so σ = +M·y/Iy at α=0, matching 2D)
    const Mz =  M_2d * sinA;  // width bending
    const Vz =  V_2d * cosA;  // vertical shear (pairs with My / depth)
    const Vy =  V_2d * sinA;  // lateral shear (pairs with Mz / width)

    const halfH = (sec.h ?? Math.sqrt(12 * (sec.iy ?? sec.iz) / sec.a)) / 2;
    const halfB = (sec.b ?? sec.h ?? Math.sqrt(12 * sec.iz / sec.a)) / 2;
    const yFiber = -halfH + fiberRatioY * halfH * 2;
    const zFiber = -halfB + fiberRatioZ * halfB * 2;

    return analyzeSectionStressFromForces(N_2d, Vy, Vz, 0, My, Mz, sec, mat.fy, yFiber, zFiber);
  });

  // Unified accessors (panel uses these)
  // When isRotated2D, analysis3D is populated (from decomposed forces), analysis2D is null
  const uses3DPath = $derived(is3D || isRotated2D || eccentricActive);
  const hasAnalysis = $derived(uses3DPath ? analysis3D !== null : analysis2D !== null);
  const resolved = $derived(uses3DPath ? analysis3D?.resolved : analysis2D?.resolved);

  // Shear flow (2D only)
  const shearFlow = $derived<ShearFlowSegment[]>(
    analysis2D ? computeShearFlowPaths(analysis2D.V, analysis2D.resolved) : []
  );

  const isMassive = $derived(resolved ? isMassiveSection(resolved.shape) : false);

  // Bending detection — enables EN button
  const hasBending3D = $derived(
    uses3DPath && analysis3D !== null &&
    (Math.abs(analysis3D.My) > 0.01 || Math.abs(analysis3D.Mz) > 0.01)
  );
  const hasBending2D = $derived(
    !uses3DPath && analysis2D !== null && Math.abs(analysis2D.M) > 0.01
  );

  // Neutral axis for ⊥ distribution: moments-only or full (with N) depending on showTotalSigma
  // When showTotalSigma is off: NA passes through centroid (N=0), classic moment-only view
  // When showTotalSigma is on: NA shifts by axial eccentricity, shows combined effect
  const perpNA = $derived.by(() => {
    if (!showPerpNA || !uses3DPath || !analysis3D) return null;
    if (Math.abs(analysis3D.My) < 0.01 && Math.abs(analysis3D.Mz) < 0.01) return null;
    if (showTotalSigma) {
      // Full NA including N (doesn't pass through centroid if N≠0)
      return analysis3D.neutralAxis;
    }
    // Moments-only NA (passes through centroid)
    return computeNeutralAxisMomentsOnly(
      analysis3D.Mz, analysis3D.My,
      analysis3D.Iz, analysis3D.resolved.iy,
    );
  });

  // Perpendicular-to-NA stress distribution (PR [12] convention)
  // When showTotalSigma: σ = N/A − My·y/Iy + Mz·z/Iz (full, with axial)
  // Otherwise: σ = −My·y/Iy + Mz·z/Iz (moments only, N=0)
  const perpNADist = $derived.by((): PerpNAPoint[] => {
    if (!perpNA || !perpNA.exists || !analysis3D) return [];
    return computePerpNADistribution(
      showTotalSigma ? analysis3D.N : 0,
      analysis3D.Mz, analysis3D.My,
      analysis3D.resolved.a, analysis3D.Iz, analysis3D.resolved.iy,
      perpNA, analysis3D.resolved,
    );
  });

  // Central core (núcleo central) — always computed for CP-inside-core check
  const centralCore = $derived.by((): CentralCore | null => {
    if (!resolved) return null;
    return computeCentralCore(resolved);
  });

  // Pressure center (centro de presiones):
  // From σ = N/A − My·y/Iy + Mz·z/Iz, matching the eccentric-N formula
  // σ = N/A + N·ey·y/Iy + N·ez·z/Iz:
  //   −My = N·ey → ey = −My/N   (y_CP = −My/N, depth)
  //    Mz = N·ez → ez =  Mz/N   (z_CP =  Mz/N, width)
  // Only exists when N ≠ 0 (if N=0, CP is at infinity)
  const pressureCenter = $derived.by((): { y: number; z: number; insideCore: boolean } | null => {
    if (!showPressureCenter) return null;
    if (uses3DPath && analysis3D) {
      if (Math.abs(analysis3D.N) < 0.01) return null; // N ≈ 0 → CP at infinity
      const yCP = -analysis3D.My / analysis3D.N;  // meters — ey = −My/N (depth)
      const zCP = analysis3D.Mz / analysis3D.N;   // meters — ez = Mz/N (width)
      const insideCore = centralCore
        ? isPointInConvexPolygon(zCP, yCP, centralCore.vertices)
        : false;
      return { y: yCP, z: zCP, insideCore };
    }
    if (!is3D && analysis2D) {
      if (Math.abs(analysis2D.N) < 0.01) return null;
      const yCP = analysis2D.M / analysis2D.N; // meters — ey = M/N
      const insideCore = centralCore
        ? isPointInConvexPolygon(0, yCP, centralCore.vertices)
        : false;
      return { y: yCP, z: 0, insideCore };
    }
    return null;
  });

  /**
   * The stress state at the selected fibre, from canonical geometry.
   *
   * The panel used to draw a canonical outline, plot canonical bending on it,
   * and then build its Mohr circle and failure checks from the LEGACY path —
   * which infers a section's shape from its name and invents thicknesses when
   * they are missing. One picture, two different sections, no way for a reader
   * to tell which number came from which. This is the same geometry
   * throughout; the legacy result stays only as the fallback for sections that
   * have no geometry at all.
   */
  /** The member's own section, material and canonical query point. */
  const stateInputs = $derived.by(() => {
    if (!query || !canonical?.ok) return null;
    const elem = modelStore.elements.get(query.elementId);
    const sec = elem ? modelStore.sections.get(elem.sectionId) : null;
    const mat = elem ? modelStore.materials.get(elem.materialId) : null;
    if (!sec) return null;

    // The fibre the user picked, in the drawing's own frame. That frame IS the
    // canonical one — centroid-relative, in metres — because the drawing is
    // canonical, so the point needs no translation to be meaningful here.
    const [yMin, zMin, yMax, zMax] = canonical.geometry.bbox;
    const py = yMin + fiberRatioZ * (yMax - yMin);
    const pz = zMin + fiberRatioY * (zMax - zMin);

    const f = canonical.forces as { n: number; my: number; mz: number; vy?: number; vz?: number; tx?: number };
    return {
      sec,
      fy: mat?.fy,
      // Only pass elastic constants when the material actually carries them:
      // the strain tensor is omitted rather than computed from a guess.
      elastic: mat && mat.e > 0 ? { e: mat.e, nu: mat.nu ?? 0.3 } : undefined,
      point: [py, pz] as [number, number],
      forces: { n: f.n, my: f.my, mz: f.mz, vy: f.vy, vz: f.vz, t: f.tx },
    };
  });

  /**
   * The stress state as the MODEL loads it — no eccentricity applied.
   *
   * Deliberately independent of `eccentricPoint`, so dragging the marker does
   * not re-run this solve. It also carries the shear centre, which depends only
   * on the geometry and so is the same regardless of where the load is put.
   */
  const canonicalState = $derived.by(() => {
    if (!stateInputs) return null;
    const r = canonicalStressState(
      stateInputs.sec,
      stateInputs.forces,
      stateInputs.point,
      stateInputs.fy,
      stateInputs.elastic,
    );
    return r.ok ? r.state : null;
  });

  /**
   * Whether the application point keeps the whole section in one sign.
   *
   * Tested against the SAME polygon the drawing paints, not against
   * `kernLimits`. The two agree analytically, but they are different code, and
   * a marker that turns green while sitting outside the orange region reads as
   * a bug whichever of the two is right. One source, one answer.
   */
  const eccentricInsideKern = $derived.by(() => {
    if (!eccentricPoint) return true;
    if (!centralCore || centralCore.vertices.length < 3) return true;
    // The core polygon is stored (ez, ey) — horizontal, vertical — which is the
    // canonical point's (y, z) in that order.
    return isPointInConvexPolygon(eccentricPoint[0], eccentricPoint[1], centralCore.vertices);
  });

  /**
   * What moving the load off the reference points adds.
   *
   * The shear centre comes from the base solve, so this is arithmetic: no
   * meshing happens while the marker is dragged.
   */
  const eccentric = $derived.by(() => {
    if (!showEccentric || !eccentricPoint || !stateInputs) return null;
    const m = stateInputs.forces;
    const sc = canonicalState?.shearCentre ?? [0, 0] as [number, number];

    if (eccSource === 'model') {
      // The member's own resultants, moved off the axis. The bending the model
      // reports stays — it is the consequence of the external loads and does
      // not go away — and the eccentricity adds to it.
      return resolveEccentric(
        { n: m.n, vy: m.vy, vz: m.vz, my: m.my, mz: m.mz, t: m.t, at: eccentricPoint },
        sc,
      );
    }

    // A load of the user's own, applied at the point, ON TOP of everything the
    // model already produces. Resolved alone first so `effect` reports what
    // THIS load contributes rather than burying it in the model's totals.
    const r = resolveEccentric(
      { n: eccCustom.n, vy: eccCustom.vy, vz: eccCustom.vz, at: eccentricPoint },
      sc,
    );
    return {
      forces: {
        n: m.n + r.forces.n,
        my: m.my + r.forces.my,
        mz: m.mz + r.forces.mz,
        vy: (m.vy ?? 0) + r.forces.vy,
        vz: (m.vz ?? 0) + r.forces.vz,
        t: (m.t ?? 0) + r.forces.t,
      },
      effect: r.effect,
    };
  });

  /**
   * Whether the eccentric case is actually driving the panel.
   *
   * Every diagram below keys off this. Without it the eccentricity reached
   * Mohr's circle, the tensors and the stress map but NOT the stress diagrams,
   * which kept plotting the model's own forces — so the panel showed two
   * different load cases at once and only the small print said which.
   */
  const eccentricActive = $derived(showEccentric && eccentric !== null);

  /**
   * The load components on display, whichever source is active.
   *
   * Read by the editor so the model's own forces are visible (and not
   * editable) under `model`, and the user's own under `custom`.
   */
  const eccentricComponents = $derived.by(() => {
    if (eccSource === 'custom') return eccCustom;
    const m = stateInputs?.forces;
    return { n: m?.n ?? 0, vy: m?.vy ?? 0, vz: m?.vz ?? 0 };
  });

  /**
   * Nothing at this station to relocate.
   *
   * Mid-span of a simply supported beam is exactly this case: the shear is zero
   * and there is no axial force, so the only resultant is a bending moment —
   * and a moment is a free vector, unchanged by where you apply it. Dragging
   * the point then does nothing at all, which reads as a broken feature rather
   * than as the correct answer it is. Saying so is the difference.
   */
  const eccentricNothingToMove = $derived(
    eccSource === 'model' &&
    Math.abs(eccentricComponents.n) < 1e-9 &&
    Math.abs(eccentricComponents.vy) < 1e-9 &&
    Math.abs(eccentricComponents.vz) < 1e-9,
  );

  /**
   * The state under the eccentric forces — what the panel shows while the
   * overlay is on, so the drawing, the tensors and Mohr's circle all describe
   * the same load case rather than disagreeing with each other.
   */
  const eccentricState = $derived.by(() => {
    if (!eccentric || !stateInputs) return null;
    const r = canonicalStressState(
      stateInputs.sec,
      eccentric.forces,
      stateInputs.point,
      stateInputs.fy,
      stateInputs.elastic,
    );
    return r.ok ? r.state : null;
  });

  /** The state every downstream display reads. */
  const activeState = $derived(showEccentric ? (eccentricState ?? canonicalState) : canonicalState);

  // Mohr circle data. Canonical where the section has geometry; the legacy
  // result only where it does not.
  const mohrData = $derived(
    activeState?.mohr ?? (uses3DPath ? analysis3D?.mohr ?? null : analysis2D?.mohr ?? null),
  );
  const mohrSigma = $derived(
    activeState?.sigma ?? (uses3DPath ? (analysis3D?.sigmaAtFiber ?? 0) : (analysis2D?.sigmaAtY ?? 0)),
  );
  const mohrTau = $derived(
    activeState?.tau ?? (uses3DPath ? (analysis3D?.tauTotal ?? 0) : (analysis2D?.tauAtY ?? 0)),
  );

  const criticalSections = $derived.by(() => {
    if (!query) return [];
    if (is3D && resultsStore.results3D) {
      const ef = resultsStore.getElementForces3D(query.elementId);
      if (!ef) return [];
      return suggestCriticalSections3D(ef).map(s => ({ t: s.t, reason: s.reason }));
    }
    if (!is3D && resultsStore.results) {
      const ef = resultsStore.getElementForces(query.elementId);
      if (!ef) return [];
      return suggestCriticalSections(ef);
    }
    return [];
  });

  // Global stress scales: max σ and τ across all critical sections of the element (MPa)
  // Used when useGlobalScale is true so stress diagrams scale relative to element-wide max
  const globalScales = $derived.by((): { maxSigmaY: number; maxSigmaZ: number; maxTauY: number } | null => {
    if (!useGlobalScale || !query) return null;
    const elem = modelStore.elements.get(query.elementId);
    if (!elem) return null;
    const sec = modelStore.sections.get(elem.sectionId);
    const mat = modelStore.materials.get(elem.materialId);
    if (!sec || !mat) return null;

    let maxSY = 1e-6, maxSZ = 1e-6, maxTY = 1e-6;

    if (is3D) {
      const ef = resultsStore.getElementForces3D(query.elementId);
      if (!ef) return null;
      const crits = suggestCriticalSections3D(ef);
      for (const cs of crits) {
        const a = analyzeSectionStress3D(ef, sec, mat.fy, cs.t);
        for (const pt of a.distributionY) {
          if (Math.abs(pt.sigma) > maxSY) maxSY = Math.abs(pt.sigma);
          if (Math.abs(pt.tauVz) > maxTY) maxTY = Math.abs(pt.tauVz);
        }
        for (const pt of a.distributionZ) {
          if (Math.abs(pt.sigma) > maxSZ) maxSZ = Math.abs(pt.sigma);
        }
      }
    } else if (isRotated2D) {
      // Rotated 2D: compute biaxial scales at critical sections
      const ef = resultsStore.getElementForces(query.elementId);
      if (!ef) return null;
      const crits = suggestCriticalSections(ef);
      const alpha = (sec.rotation ?? 0) * Math.PI / 180;
      const cosA = Math.cos(alpha), sinA = Math.sin(alpha);
      for (const cs of crits) {
        const M = computeDiagramValueAt('moment', cs.t, ef);
        const V = computeDiagramValueAt('shear', cs.t, ef);
        const N = computeDiagramValueAt('axial', cs.t, ef);
        const a = analyzeSectionStressFromForces(N, V*sinA, V*cosA, 0, -M*cosA, M*sinA, sec, mat.fy);
        for (const pt of a.distributionY) {
          if (Math.abs(pt.sigma) > maxSY) maxSY = Math.abs(pt.sigma);
          if (Math.abs(pt.tauVz) > maxTY) maxTY = Math.abs(pt.tauVz);
        }
        for (const pt of a.distributionZ) {
          if (Math.abs(pt.sigma) > maxSZ) maxSZ = Math.abs(pt.sigma);
        }
      }
    } else {
      const ef = resultsStore.getElementForces(query.elementId);
      if (!ef) return null;
      const crits = suggestCriticalSections(ef);
      for (const cs of crits) {
        const a = analyzeSectionStress(ef, sec, mat.fy, cs.t);
        for (const pt of a.distribution) {
          if (Math.abs(pt.sigma) > maxSY) maxSY = Math.abs(pt.sigma);
          if (Math.abs(pt.tau) > maxTY) maxTY = Math.abs(pt.tau);
        }
        // Also check thin-walled shear flow max tau
        if (!isMassiveSection(a.resolved.shape)) {
          const sf = computeShearFlowPaths(a.V, a.resolved);
          for (const seg of sf) {
            for (const p of seg.points) {
              if (p.tau > maxTY) maxTY = p.tau;
            }
          }
        }
      }
    }

    return { maxSigmaY: maxSY, maxSigmaZ: maxSZ, maxTauY: maxTY };
  });

  /**
   * Close the panel AND leave the pointer usable.
   *
   * Opening this analysis switches the viewport into `selectMode = 'stress'`,
   * where a click means "inspect the section at this station". Closing used to
   * clear only the query, so the pointer stayed in a mode whose one gesture no
   * longer had a panel to answer in: clicks selected nothing, dragging panned
   * nothing, and the canvas read as frozen. There is no visible control for
   * that mode either, so the state was unreachable as well as useless.
   *
   * Restoring 'elements' is what the user means by closing: back to selecting
   * and panning.
   */
  function close() {
    resultsStore.stressQuery = null;
    if (uiStore.selectMode === 'stress') uiStore.selectMode = 'elements';
  }

  /** Update stressQuery to a new t position, recalculating world coordinates */
  function goToT(elementId: number, t: number) {
    const elem = modelStore.elements.get(elementId);
    if (!elem) return;
    const ni = modelStore.getNode(elem.nodeI);
    const nj = modelStore.getNode(elem.nodeJ);
    if (!ni || !nj) return;
    const niz = ni.z ?? 0;
    const njz = nj.z ?? 0;
    const wx = ni.x + t * (nj.x - ni.x);
    const wy = ni.y + t * (nj.y - ni.y);
    const wz = niz + t * (njz - niz);
    resultsStore.stressQuery = { elementId, t, worldX: wx, worldY: wy, worldZ: is3D ? wz : undefined };
  }

  function goToCritical(cs: { t: number; reason: string }) {
    if (!query) return;
    goToT(query.elementId, cs.t);
  }

  function onSliderInput(e: Event) {
    if (!query) return;
    const val = +(e.target as HTMLInputElement).value;
    goToT(query.elementId, val);
  }
</script>

{#if query && hasAnalysis}
  <div class="ssp-panel" class:docked={docked}
    style="{uiStore.isMobile && tourStore.isActive ? `bottom:auto; top:${uiStore.floatingToolsTopOffset}px; max-height:calc(100vh - ${uiStore.floatingToolsTopOffset}px - 45vh - 16px)` : ''}"
  >
    <div class="ssp-header">
      <span class="ssp-title">{t('stress.panelTitle')} {is3D ? '3D ' : ''}{isRotated2D ? `(rot ${querySec?.rotation}°) ` : ''}</span>
      <button class="ssp-close" onclick={close} title={t('stress.close')}>&#x2715;</button>
    </div>

    <div class="ssp-body">
      {#if canonicalState?.shearCentre && (Math.abs(canonicalState.shearCentre[0]) > 1e-4 || Math.abs(canonicalState.shearCentre[1]) > 1e-4)}
        <!-- Only shown when it is NOT at the centroid, which is exactly when it
             matters: a load anywhere else twists the member, and for a channel
             this point falls outside the section entirely. -->
        <div class="ssp-shearcentre">
          <span class="ssp-sc-icon">⊗</span>
          <div>
            <div class="ssp-sc-head">{t('stress.shearCentre')}</div>
            <div class="ssp-sc-body">
              {t('stress.shearCentreMsg')}
              <span class="ssp-sc-nums">
                y = {(canonicalState.shearCentre[0] * 1000).toFixed(1)} mm ·
                z = {(canonicalState.shearCentre[1] * 1000).toFixed(1)} mm
              </span>
            </div>
          </div>
        </div>
      {/if}
      {#if deviation}
        <!-- Stated, not hidden: the source table's own dimensions and
             properties disagree, so the analysed geometry cannot match both. -->
        <div class="ssp-deviation">
          <span class="ssp-dev-icon">≠</span>
          <div>
            <div class="ssp-dev-head">{t('stress.devTitle')}</div>
            <div class="ssp-dev-body">
              {t('stress.devBody')}
              <span class="ssp-dev-nums">
                A {(deviation.a * 100).toFixed(1)}% ·
                Iy {(deviation.iy * 100).toFixed(1)}% ·
                Iz {(deviation.iz * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      {/if}
      <!-- Element info + position slider (issue #12) -->
      <div class="ssp-info">
        <span class="ssp-elem">Elem #{query.elementId}</span>
        <span class="ssp-pos">x/L = {(query.t * 100).toFixed(1)}%</span>
      </div>
      <div class="ssp-slider-row">
        <span class="ssp-slider-label">I</span>
        <input
          type="range" class="ssp-slider-xl" min="0" max="1" step="0.005"
          value={query.t}
          oninput={onSliderInput}
          title={t('stress.moveAlongElem')}
        />
        <span class="ssp-slider-label">J</span>
      </div>

      <!-- Internal forces -->
      {#if is3D && analysis3D}
        <!-- 3D: 6 internal forces in 2 rows -->
        <div class="ssp-forces">
          <div class="ssp-force">
            <span class="ssp-force-label">N</span>
            <span class="ssp-force-value">{fmtForce(analysis3D.N)} kN</span>
          </div>
          <div class="ssp-force">
            <span class="ssp-force-label">V<sub>y</sub></span>
            <span class="ssp-force-value">{fmtForce(analysis3D.Vy)} kN</span>
          </div>
          <div class="ssp-force">
            <span class="ssp-force-label">V<sub>z</sub></span>
            <span class="ssp-force-value">{fmtForce(analysis3D.Vz)} kN</span>
          </div>
          <span class="ssp-help" title={t('stress.forces3dHelp')}>?</span>
        </div>
        <div class="ssp-forces ssp-forces-moments">
          <div class="ssp-force">
            <span class="ssp-force-label">M<sub>x</sub></span>
            <span class="ssp-force-value">{fmtForce(-analysis3D.Mx)} kN·m</span>
          </div>
          <div class="ssp-force">
            <span class="ssp-force-label">M<sub>y</sub></span>
            <span class="ssp-force-value">{fmtForce(-analysis3D.My)} kN·m</span>
          </div>
          <div class="ssp-force">
            <span class="ssp-force-label">M<sub>z</sub></span>
            <span class="ssp-force-value">{fmtForce(-analysis3D.Mz)} kN·m</span>
          </div>
          <span class="ssp-help" title={t('stress.moments3dHelp')}>?</span>
        </div>
      {:else if isRotated2D && analysis3D}
        <!-- Rotated 2D: show decomposed biaxial forces -->
        <div class="ssp-forces">
          <div class="ssp-force">
            <span class="ssp-force-label">N</span>
            <span class="ssp-force-value">{fmtForce(analysis3D.N)} kN</span>
          </div>
          <div class="ssp-force">
            <span class="ssp-force-label">V<sub>y</sub></span>
            <span class="ssp-force-value">{fmtForce(analysis3D.Vy)} kN</span>
          </div>
          <div class="ssp-force">
            <span class="ssp-force-label">V<sub>z</sub></span>
            <span class="ssp-force-value">{fmtForce(analysis3D.Vz)} kN</span>
          </div>
          <span class="ssp-help" title={t('stress.rotDecompHelp').replace('{angle}', String(querySec?.rotation ?? 0))}>?</span>
        </div>
        <div class="ssp-forces ssp-forces-moments">
          <div class="ssp-force">
            <span class="ssp-force-label">M<sub>y</sub></span>
            <span class="ssp-force-value">{fmtForce(-analysis3D.My)} kN·m</span>
          </div>
          <div class="ssp-force">
            <span class="ssp-force-label">M<sub>z</sub></span>
            <span class="ssp-force-value">{fmtForce(-analysis3D.Mz)} kN·m</span>
          </div>
          <span class="ssp-help" title={t('stress.rotMomentHelp').replace('{angle}', String(querySec?.rotation ?? 0))}>?</span>
        </div>
      {:else if analysis2D}
        <div class="ssp-forces">
          <div class="ssp-force">
            <span class="ssp-force-label">N</span>
            <span class="ssp-force-value">{fmtForce(analysis2D.N)} kN</span>
          </div>
          <div class="ssp-force">
            <span class="ssp-force-label">V</span>
            <span class="ssp-force-value">{fmtForce(analysis2D.V)} kN</span>
          </div>
          <div class="ssp-force">
            <span class="ssp-force-label">M</span>
            <span class="ssp-force-value">{fmtForce(-analysis2D.M)} kN·m</span>
          </div>
          <span class="ssp-help" title={t('stress.forces2dHelp')}>?</span>
        </div>
      {/if}

      <!-- Cross section drawing -->
      <CrossSectionDrawing
        {canonicalGeometry}
        bind:showCrossSection
        bind:showSigma
        bind:showShearOnDrawing
        bind:showTotalSigma
        bind:showPerpNA
        bind:showCentralCore
        bind:showPressureCenter
        bind:useGlobalScale
        bind:fiberRatioY
        bind:fiberRatioZ
        is3D={uses3DPath}
        {hasBending3D}
        {hasBending2D}
        {analysis2D}
        {analysis3D}
        {resolved}
        {shearFlow}
        {isMassive}
        {centralCore}
        {perpNADist}
        {perpNA}
        {pressureCenter}
        {globalScales}
        sectionRotation={is3D ? 0 : (querySec?.rotation ?? 0)}
        bind:showStressMap
        bind:showEccentric
        bind:eccentricPoint
        stressField={activeState?.field ?? null}
        shearCentre={canonicalState?.shearCentre ?? null}
        {eccentricInsideKern}
      />

      <!-- What the eccentricity produced. Shown next to the drawing rather
           than folded into a collapsed section: it is the readout for a live
           gesture, and a number that appears only after opening a panel cannot
           be read while dragging. -->
      {#if showEccentric && eccentric && eccentricPoint}
        <div class="ssp-ecc">
          <div class="ssp-ecc-head">
            <span>{t('stress.eccentricTitle')}</span>
            <button
              class="ssp-ecc-reset"
              onclick={() => eccentricPoint = [0, 0]}
              title={t('stress.eccentricResetHelp')}
            >{t('stress.eccentricReset')}</button>
          </div>

          <!-- Where the load comes from. Without this the panel showed forces
               with no stated origin — on a simply supported beam with no axial
               load, an "eccentric load" appeared from nowhere. -->
          <div class="ssp-ecc-src">
            <button
              class="ssp-ecc-tab" class:active={eccSource === 'model'}
              onclick={() => eccSource = 'model'}
              title={t('stress.eccentricFromModelHelp')}
            >{t('stress.eccentricFromModel')}</button>
            <button
              class="ssp-ecc-tab" class:active={eccSource === 'custom'}
              onclick={() => eccSource = 'custom'}
              title={t('stress.eccentricCustomHelp')}
            >{t('stress.eccentricCustom')}</button>
          </div>

          <!-- The components, named by their direction relative to the section
               rather than by axis letters alone: which one twists the member
               and which one bends it is the whole point. -->
          <div class="ssp-ecc-fields">
            <div class="ssp-ecc-field">
              <span class="ssp-ecc-flabel">N <em>{t('stress.eccentricPerp')}</em></span>
              {#if eccSource === 'custom'}
                <input type="number" step="1" bind:value={eccCustom.n} />
              {:else}
                <span class="ssp-ecc-fixed">{fmtForce(eccentricComponents.n)}</span>
              {/if}
              <span class="ssp-ecc-unit">kN</span>
            </div>
            <div class="ssp-ecc-field">
              <span class="ssp-ecc-flabel">V<sub>y</sub> <em>{t('stress.eccentricParH')}</em></span>
              {#if eccSource === 'custom'}
                <input type="number" step="1" bind:value={eccCustom.vy} />
              {:else}
                <span class="ssp-ecc-fixed">{fmtForce(eccentricComponents.vy)}</span>
              {/if}
              <span class="ssp-ecc-unit">kN</span>
            </div>
            <div class="ssp-ecc-field">
              <span class="ssp-ecc-flabel">V<sub>z</sub> <em>{t('stress.eccentricParV')}</em></span>
              {#if eccSource === 'custom'}
                <input type="number" step="1" bind:value={eccCustom.vz} />
              {:else}
                <span class="ssp-ecc-fixed">{fmtForce(eccentricComponents.vz)}</span>
              {/if}
              <span class="ssp-ecc-unit">kN</span>
            </div>
          </div>

          <div class="ssp-ecc-row">
            <span class="ssp-ecc-label">{t('stress.eccentricAt')}</span>
            <span class="ssp-ecc-val">
              y {fmtForce(eccentricPoint[0] * 1000)} · z {fmtForce(eccentricPoint[1] * 1000)} mm
            </span>
          </div>

          {#if eccentricNothingToMove}
            <p class="ssp-ecc-note ssp-ecc-flag">{t('stress.eccentricNothingToMove')}</p>
          {/if}

          <div class="ssp-ecc-sep">{t('stress.eccentricProduces')}</div>
          <div class="ssp-ecc-row">
            <span class="ssp-ecc-label">&Delta;M<sub>y</sub> / &Delta;M<sub>z</sub></span>
            <span class="ssp-ecc-val">
              {fmtForce(eccentric.effect.myFromN)} / {fmtForce(eccentric.effect.mzFromN)} kN·m
            </span>
          </div>
          <div class="ssp-ecc-row" class:ssp-ecc-warn={Math.abs(eccentric.effect.tFromShear) > 1e-6}>
            <span class="ssp-ecc-label">&Delta;T</span>
            <span class="ssp-ecc-val">{fmtForce(eccentric.effect.tFromShear)} kN·m</span>
          </div>

          <!-- Weak-axis bending on a plane frame is worth calling out: it is a
               stress the 2D model cannot produce on its own, and seeing it
               appear is the point of moving the load sideways. -->
          {#if !is3D && Math.abs(eccentric.forces.mz) > 1e-9}
            <p class="ssp-ecc-note ssp-ecc-flag">{t('stress.eccentricBiaxialNote')}</p>
          {/if}
          <p class="ssp-ecc-note">
            {eccentricInsideKern ? t('stress.eccentricInKern') : t('stress.eccentricOutKern')}
          </p>
          {#if canonicalState?.shearCentre && Math.hypot(...canonicalState.shearCentre) > 1e-6}
            <p class="ssp-ecc-note">{t('stress.eccentricShearCentreNote')}</p>
          {/if}
        </div>
      {/if}

      <!-- Stress state details -->
      <StressStateDetails
        bind:showTensional
        is3D={uses3DPath}
        {isMassive}
        {analysis2D}
        {analysis3D}
      />

      <!-- Stress and strain tensors. Above Mohr on purpose: the circle is a
           construction on this state, so the state comes first. -->
      <StressTensorDetails
        bind:showTensors
        tensors={activeState?.tensors ?? null}
        fy={stateInputs?.fy}
      />

      <!-- Mohr's circle -->
      <MohrCircleDisplay
        bind:showMohr
        {mohrData}
        {mohrSigma}
        {mohrTau}
      />

      <!-- Central core details -->
      <CentralCoreDetails
        bind:showCentralCoreInfo
        {centralCore}
        {resolved}
      />

      <!-- Critical sections -->
      <button class="ssp-section-toggle" onclick={() => showCritical = !showCritical}>
        <span class="ssp-chevron">{showCritical ? '▾' : '▸'}</span>
        {t('stress.criticalSections')}
        <span class="ssp-help ssp-help-inline" title={t('stress.criticalSectionsHelp')}>?</span>
      </button>
      {#if showCritical && criticalSections.length > 0}
        <div class="ssp-critical">
          {#each criticalSections as cs}
            <button
              class="ssp-critical-chip"
              class:active={Math.abs(cs.t - query.t) < 0.02}
              onclick={() => goToCritical(cs)}
            >
              {cs.reason}
              <span class="ssp-critical-t">({(cs.t * 100).toFixed(0)}%)</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{:else if query && isAmorphous}
  <div class="ssp-panel ssp-amorphous-warning" class:docked={docked}
    style="{uiStore.isMobile && tourStore.isActive ? `bottom:auto; top:${uiStore.floatingToolsTopOffset}px` : ''}"
  >
    <div class="ssp-header">
      <span class="ssp-title">{t('stress.panelTitle')}</span>
      <!-- Same `close()` as the main header: closing from the warning variant
           left the pointer stuck in stress mode exactly as the other one did. -->
      <button class="ssp-close" onclick={close}>&#x2715;</button>
    </div>
    <div class="ssp-amorph-msg">
      <span class="ssp-amorph-icon">⚠</span>
      {#if unavailableReason?.kind === 'noGeometryData'}
        <p>{@html t('stress.noGeomMsg1').replace('{name}', unavailableReason.name)}</p>
        <p>{t('stress.noGeomMsg2')}</p>
        <p>{t('stress.noGeomMsg3')}</p>
      {:else}
        <p>{@html t('stress.amorphMsg1')}</p>
        <p>{t('stress.amorphMsg2')}</p>
        <p>{t('stress.amorphMsg3')}</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  /*
     Docked, this panel's header is a section heading inside the right panel,
     not the title bar of a window: the rule above separates it from the
     analysis list it belongs to, and the type matches every other heading in
     the panel so the eye reads one column, not a widget dropped into one.
  */
  .ssp-panel.docked .ssp-header {
    background: none;
    padding: 0.5rem 0 0.35rem;
    margin-top: 0.5rem;
    border-top: 1px solid var(--st-hair);
    border-bottom: none;
  }

  .ssp-panel.docked .ssp-title {
    font-family: var(--st-mono);
    font-size: 0.68rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--st-text-2);
    font-weight: 400;
  }

  /* Docked: no chrome of its own — the right panel already supplies the frame. */
  .ssp-panel.docked {
    position: static;
    width: auto;
    max-height: none;
    border: none;
    border-radius: 0;
    box-shadow: none;
    backdrop-filter: none;
    background: transparent;
    z-index: auto;
  }

  .ssp-panel {
    position: absolute;
    bottom: 8px;
    left: 8px;
    z-index: 105;
    width: 280px;
    background: rgba(19, 33, 45, 0.96);
    border: 1px solid var(--st-hair-strong);
    border-radius: 8px;
    backdrop-filter: blur(8px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    max-height: calc(100% - 90px);
    font-size: 0.75rem;
  }

  .ssp-shearcentre {
    display: flex; gap: 8px; align-items: flex-start;
    margin: 0 0 8px; padding: 7px 9px;
    background: rgba(78, 205, 196, 0.07);
    border-left: 2px solid #4ecdc4; border-radius: 3px;
  }
  .ssp-sc-icon { color: #4ecdc4; font-size: 0.95rem; line-height: 1; }
  .ssp-sc-head { color: #4ecdc4; font-size: 0.7rem; font-weight: 600; margin-bottom: 2px; }
  .ssp-sc-body { color: #9fbfbc; font-size: 0.66rem; line-height: 1.4; }
  .ssp-sc-nums { display: block; margin-top: 3px; font-family: monospace; color: #4ecdc4; }

  .ssp-deviation {
    display: flex; gap: 8px; align-items: flex-start;
    margin: 0 0 8px; padding: 7px 9px;
    background: rgba(217, 164, 65, 0.08);
    border-left: 2px solid #d9a441; border-radius: 3px;
  }
  .ssp-dev-icon { color: #d9a441; font-size: 0.95rem; line-height: 1; font-weight: 700; }
  .ssp-dev-head { color: #d9a441; font-size: 0.7rem; font-weight: 600; margin-bottom: 2px; }
  .ssp-dev-body { color: #b8a97f; font-size: 0.66rem; line-height: 1.4; }
  .ssp-dev-nums { display: block; margin-top: 3px; font-family: monospace; color: #d9a441; }

  .ssp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border-bottom: 1px solid var(--st-hair-strong);
  }

  .ssp-title {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--st-value);
  }

  .ssp-close {
    width: 20px;
    height: 20px;
    background: transparent;
    border: none;
    border-radius: 3px;
    color: var(--st-text-3);
    cursor: pointer;
    font-size: 0.7rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .ssp-close:hover {
    background: var(--st-accent);
    color: white;
  }

  .ssp-body {
    overflow-y: auto;
    padding: 6px 10px 10px;
  }

  .ssp-info {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
    color: var(--st-text-2);
    font-size: 0.7rem;
  }

  .ssp-elem {
    color: var(--st-text);
    font-weight: 600;
  }

  .ssp-pos {
    font-family: 'Courier New', monospace;
    color: var(--st-text-3);
  }

  .ssp-slider-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 6px;
  }

  .ssp-slider-label {
    font-size: 0.6rem;
    color: var(--st-text-3);
    font-weight: 600;
    flex-shrink: 0;
    width: 10px;
    text-align: center;
  }

  .ssp-slider-xl {
    flex: 1;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--st-bg);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }

  .ssp-slider-xl::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--st-accent);
    cursor: pointer;
    border: none;
  }

  .ssp-slider-xl::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--st-accent);
    cursor: pointer;
    border: none;
  }

  .ssp-forces {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
    padding: 4px 0;
    border-bottom: 1px solid rgba(26, 74, 122, 0.4);
    align-items: center;
    flex-wrap: wrap;
  }

  .ssp-forces-moments {
    margin-top: -4px;
  }

  .ssp-force {
    flex: 1;
    text-align: center;
    min-width: 55px;
  }

  .ssp-force-label {
    display: block;
    font-size: 0.65rem;
    color: var(--st-text-3);
    text-transform: uppercase;
  }

  .ssp-force-value {
    display: block;
    font-family: 'Courier New', monospace;
    font-size: 0.72rem;
    color: var(--st-text);
  }

  .ssp-section-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 3px 0;
    background: none;
    border: none;
    color: var(--st-text-3);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    cursor: pointer;
    border-bottom: 1px solid rgba(26, 74, 122, 0.3);
  }

  .ssp-section-toggle:hover {
    color: var(--st-text);
  }

  .ssp-chevron {
    font-size: 0.6rem;
    width: 10px;
  }

  .ssp-critical {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px 0;
  }

  /* Eccentric-load readout. Sits under the drawing, always expanded while the
     overlay is on, because it is the feedback for a live drag. */
  .ssp-ecc {
    margin: 2px 0 8px;
    padding: 6px 8px;
    border-radius: 4px;
    background: rgba(255, 140, 0, 0.06);
    border: 1px solid rgba(255, 140, 0, 0.22);
  }
  .ssp-ecc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-bottom: 4px;
    font-size: 0.63rem;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--st-warn);
  }
  .ssp-ecc-reset {
    padding: 1px 6px;
    border-radius: 3px;
    border: 1px solid rgba(255, 140, 0, 0.35);
    background: none;
    color: var(--st-warn);
    font-size: 0.58rem;
    cursor: pointer;
    text-transform: none;
    letter-spacing: 0;
  }
  .ssp-ecc-reset:hover { background: rgba(255, 140, 0, 0.15); }
  .ssp-ecc-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
    font-size: 0.67rem;
    color: var(--st-text-2);
  }
  .ssp-ecc-label { color: var(--st-text-3); flex: none; }
  .ssp-ecc-val { font-family: 'Courier New', monospace; text-align: right; }
  /* Torsion that the eccentricity created is the finding worth colouring:
     it appears without anyone having applied a torque. */
  .ssp-ecc-warn .ssp-ecc-val { color: var(--st-warn); font-weight: 600; }
  .ssp-ecc-note {
    margin: 4px 0 0;
    font-size: 0.58rem;
    line-height: 1.4;
    color: var(--st-text-3);
  }
  .ssp-ecc-flag { color: var(--st-warn); opacity: 0.95; }

  .ssp-ecc-src {
    display: flex;
    gap: 3px;
    margin: 5px 0 6px;
  }
  .ssp-ecc-tab {
    flex: 1;
    padding: 3px 4px;
    border-radius: 3px;
    border: 1px solid rgba(255, 140, 0, 0.25);
    background: none;
    color: var(--st-text-3);
    font-size: 0.6rem;
    cursor: pointer;
  }
  .ssp-ecc-tab:hover { color: var(--st-text-2); }
  .ssp-ecc-tab.active {
    background: rgba(255, 140, 0, 0.16);
    border-color: var(--st-warn);
    color: var(--st-warn);
  }

  .ssp-ecc-fields {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-bottom: 5px;
  }
  .ssp-ecc-field {
    display: flex;
    align-items: baseline;
    gap: 5px;
    font-size: 0.65rem;
  }
  .ssp-ecc-flabel { flex: 1; color: var(--st-text-3); min-width: 0; }
  /* The direction reminder, subordinate to the symbol it qualifies. */
  .ssp-ecc-flabel em {
    font-style: normal;
    opacity: 0.7;
    font-size: 0.9em;
  }
  .ssp-ecc-field input {
    width: 62px;
    padding: 1px 4px;
    border-radius: 3px;
    border: 1px solid rgba(255, 140, 0, 0.3);
    background: rgba(0, 0, 0, 0.25);
    color: var(--st-text);
    font-family: 'Courier New', monospace;
    font-size: 0.65rem;
    text-align: right;
  }
  /* Model forces are shown in the same column as the inputs but visibly not
     editable: they are a reading of the member, not a setting. */
  .ssp-ecc-fixed {
    width: 62px;
    text-align: right;
    font-family: 'Courier New', monospace;
    color: var(--st-text-2);
  }
  .ssp-ecc-unit { color: var(--st-text-3); opacity: 0.7; width: 22px; }

  .ssp-ecc-sep {
    margin: 6px 0 3px;
    padding-top: 5px;
    border-top: 1px solid rgba(255, 140, 0, 0.2);
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--st-text-3);
  }

  .ssp-critical-chip {
    padding: 3px 8px;
    background: var(--st-surface-2);
    border: 1px solid var(--st-hair-strong);
    border-radius: 10px;
    color: var(--st-text-2);
    font-size: 0.65rem;
    cursor: pointer;
    transition: all 0.15s;
  }

  .ssp-critical-chip:hover {
    background: var(--st-surface-3);
    color: var(--st-text);
  }

  .ssp-critical-chip.active {
    background: var(--st-surface-3);
    border-color: var(--st-interactive);
    color: var(--st-value);
  }

  .ssp-critical-t {
    font-family: 'Courier New', monospace;
    opacity: 0.7;
  }

  /* ── Help tooltips ── */
  .ssp-help {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: rgba(127, 212, 204, 0.12);
    color: var(--st-value);
    font-size: 0.5rem;
    font-weight: 700;
    cursor: help;
    flex-shrink: 0;
    border: 1px solid rgba(127, 212, 204, 0.25);
    opacity: 0.6;
    transition: opacity 0.15s;
    font-style: normal;
    line-height: 1;
    vertical-align: middle;
  }

  .ssp-help:hover {
    opacity: 1;
    background: rgba(127, 212, 204, 0.25);
  }

  .ssp-help-inline {
    margin-left: auto;
  }

  /* During tour on mobile: positioning is handled by inline style (uses floatingToolsTopOffset) */

  .ssp-amorphous-warning {
    max-height: none;
  }

  .ssp-amorph-msg {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .ssp-amorph-msg p {
    font-size: 0.78rem;
    color: var(--st-text-2);
    margin: 0;
    line-height: 1.4;
  }

  .ssp-amorph-icon {
    font-size: 1.5rem;
    text-align: center;
  }
</style>
