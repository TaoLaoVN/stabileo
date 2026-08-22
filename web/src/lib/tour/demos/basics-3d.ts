/**
 * "Primeros pasos en 3D" — the same three acts, in three dimensions.
 *
 * Deliberately parallel to `basics-2d`: same shape, same order, so a reader
 * who did one recognises the other and only has to absorb what actually
 * differs. What differs is worth its own walkthrough — the camera orbits
 * instead of panning, and a 3D frame bends about two axes, so "the moment" is
 * a choice rather than a diagram.
 */

import type { TourStep } from '../../store/tour.svelte';
import { t } from '../../i18n';
import { ANCHORS, loadExample, solve, hasResults, setDimension } from '../demo-helpers';
import { resultsStore } from '../../store';

export function buildBasics3D(): TourStep[] {
  return [
    {
      id: 'welcome',
      target: 'none',
      title: t('demo.basics3d.welcomeTitle'),
      description: t('demo.basics3d.welcomeDesc'),
      position: 'center',
      onEnter: () => {
        setDimension('3d');
        void loadExample('3d-portal-frame');
      },
    },
    {
      id: 'orbit',
      target: ANCHORS.viewport,
      title: t('demo.basics3d.orbitTitle'),
      description: t('demo.basics3d.orbitDesc'),
      position: 'right',
      highlightPadding: 0,
      overlayOpacity: 0.45,
      allowInteraction: true,
    },
    {
      id: 'solve',
      target: ANCHORS.ribbonCommand('solve'),
      title: t('demo.basics3d.solveTitle'),
      description: t('demo.basics3d.solveDesc'),
      position: 'bottom',
      allowInteraction: true,
      waitFor: hasResults,
      autoAdvance: true,
      actionButton: { label: t('demo.action.solve'), action: solve },
    },
    {
      id: 'deformed',
      target: ANCHORS.ribbonCommand('deformed'),
      title: t('demo.basics3d.deformedTitle'),
      description: t('demo.basics3d.deformedDesc'),
      position: 'bottom',
      allowInteraction: true,
      onEnter: () => { resultsStore.diagramType = 'deformed'; },
    },
    /*
     * My, and why the ribbon offers more diagrams here than in 2D: a 3D member
     * bends about both of its local axes, so naming one is a choice the 2D
     * model never had to make.
     */
    {
      id: 'moment',
      target: ANCHORS.ribbonCommand('momentY'),
      title: t('demo.basics3d.momentTitle'),
      description: t('demo.basics3d.momentDesc'),
      position: 'bottom',
      allowInteraction: true,
      onEnter: () => { resultsStore.diagramType = 'momentY' as never; },
    },
    {
      id: 'done',
      target: 'none',
      title: t('demo.basics3d.doneTitle'),
      description: t('demo.basics3d.doneDesc'),
      position: 'center',
    },
  ];
}
