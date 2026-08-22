/**
 * demos.ts — the catalogue of guided walkthroughs.
 *
 * # Why a catalogue instead of one tour
 *
 * `/demo` used to be a single fourteen-step walk that tried to cover the whole
 * of Basic at once: load, draw, solve, read results, and the advanced panels.
 * It pointed at eight anchors, six of which live inside the left toolbar — and
 * desktop Basic stopped mounting that toolbar when the ribbon replaced it. Half
 * the tour was aiming at elements that are not on the screen.
 *
 * Rebuilding it as one long walk would repeat the mistake in a different way:
 * a person who wants to know how selection works should not have to sit
 * through drawing a beam to get there. So there are several short ones, each
 * answering a single question, and a menu to pick from.
 *
 * # What belongs in one
 *
 * One question, and short enough that a reader finishes it. The estimate in
 * `seconds` is shown in the menu for exactly that reason — nobody should start
 * a ninety-second walkthrough thinking it is a tooltip.
 */

import type { TourStep } from '../store/tour.svelte';
import { tourStore } from '../store/tour.svelte';

export type DemoGroup = 'basics' | 'advanced';

export interface Demo {
  id: string;
  /** Menu label and one-line description. */
  titleKey: string;
  descKey: string;
  group: DemoGroup;
  /** Roughly how long it takes, shown in the menu. */
  seconds: number;
  build: () => TourStep[];
}

/*
 * Built lazily, one import per demo file.
 *
 * The step lists reference the stores and i18n at build time, so evaluating
 * all seven at module load would run every `t()` call before the language is
 * settled and would hold every demo's closure alive for the one that runs.
 */
import { buildBasics2D } from './demos/basics-2d';
import { buildBasics3D } from './demos/basics-3d';
import { buildModelling2D } from './demos/modelling-2d';
import { buildNavigation } from './demos/navigation';
import { buildResults } from './demos/results';
import { buildKinematics } from './demos/kinematics';
import { buildSectionAnalysis } from './demos/section-analysis';

export const DEMOS: Demo[] = [
  {
    id: 'basics-2d',
    titleKey: 'demo.basics2d.title',
    descKey: 'demo.basics2d.desc',
    group: 'basics',
    seconds: 40,
    build: buildBasics2D,
  },
  {
    id: 'basics-3d',
    titleKey: 'demo.basics3d.title',
    descKey: 'demo.basics3d.desc',
    group: 'basics',
    seconds: 45,
    build: buildBasics3D,
  },
  {
    id: 'modelling-2d',
    titleKey: 'demo.modelling.title',
    descKey: 'demo.modelling.desc',
    group: 'basics',
    seconds: 100,
    build: buildModelling2D,
  },
  {
    id: 'navigation',
    titleKey: 'demo.navigation.title',
    descKey: 'demo.navigation.desc',
    group: 'basics',
    seconds: 75,
    build: buildNavigation,
  },
  {
    id: 'results',
    titleKey: 'demo.results.title',
    descKey: 'demo.results.desc',
    group: 'basics',
    seconds: 90,
    build: buildResults,
  },
  {
    id: 'kinematics',
    titleKey: 'demo.kinematics.title',
    descKey: 'demo.kinematics.desc',
    group: 'advanced',
    seconds: 70,
    build: buildKinematics,
  },
  {
    id: 'section-analysis',
    titleKey: 'demo.section.title',
    descKey: 'demo.section.desc',
    group: 'advanced',
    seconds: 100,
    build: buildSectionAnalysis,
  },
];

export function demoById(id: string): Demo | undefined {
  return DEMOS.find((d) => d.id === id);
}

/** Start a walkthrough by id. Unknown ids are ignored rather than throwing. */
export function startDemo(id: string): void {
  const demo = demoById(id);
  if (!demo) return;
  tourStore.start(demo.build());
}

/** The demo `/demo` opens with, and the one the menu lists first. */
export const DEFAULT_DEMO = 'basics-2d';
