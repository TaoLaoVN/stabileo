/**
 * "Dibujar una viga" — build one specific structure, start to finish.
 *
 * # Why it does not let you draw anything you like
 *
 * A free-form modelling tutorial cannot check its own work. Left to place
 * nodes anywhere, a reader arrives at Solve with a mechanism, gets a red
 * error, and the walkthrough ends in a failure it caused. With one target —
 * a simply supported beam under a distributed load — every step has a
 * condition that either holds or does not, and the last step is guaranteed to
 * produce a result.
 *
 * # Why sections and materials come after solving
 *
 * They were going to come before, in the order the ribbon lists them. But
 * changing a section BEFORE there is a result is an abstraction: a name
 * changes in a panel. Changing it after, with the deflection on screen, is
 * cause and effect — and it sets up the one comparison that teaches the most
 * here: on a statically determinate beam the moment does not change and the
 * deflection does.
 */

import type { TourStep } from '../../store/tour.svelte';
import { t } from '../../i18n';
import { ANCHORS, clearModel, solve, hasResults, setDimension, armTool, count } from '../demo-helpers';
import { resultsStore } from '../../store';

export function buildModelling2D(): TourStep[] {
  return [
    {
      id: 'welcome',
      target: 'none',
      title: t('demo.modelling.welcomeTitle'),
      description: t('demo.modelling.welcomeDesc'),
      position: 'center',
      onEnter: () => {
        setDimension('2d');
        clearModel();
      },
    },

    {
      id: 'nodes',
      target: ANCHORS.ribbonCommand('node'),
      title: t('demo.modelling.nodesTitle'),
      description: t('demo.modelling.nodesDesc'),
      position: 'bottom',
      allowInteraction: true,
      onEnter: () => armTool('node'),
      // Two is all a single-span beam needs, and asking for exactly what is
      // needed keeps the check honest.
      waitFor: () => count.nodes() >= 2,
      autoAdvance: true,
    },

    {
      id: 'member',
      target: ANCHORS.ribbonCommand('element'),
      title: t('demo.modelling.memberTitle'),
      description: t('demo.modelling.memberDesc'),
      position: 'bottom',
      allowInteraction: true,
      onEnter: () => armTool('element'),
      waitFor: () => count.elements() >= 1,
      autoAdvance: true,
    },

    {
      id: 'supports',
      target: ANCHORS.ribbonCommand('support'),
      title: t('demo.modelling.supportsTitle'),
      description: t('demo.modelling.supportsDesc'),
      position: 'bottom',
      allowInteraction: true,
      onEnter: () => armTool('support'),
      waitFor: () => count.supports() >= 2,
      autoAdvance: true,
    },

    {
      id: 'load',
      target: ANCHORS.ribbonCommand('load'),
      title: t('demo.modelling.loadTitle'),
      description: t('demo.modelling.loadDesc'),
      position: 'bottom',
      allowInteraction: true,
      onEnter: () => armTool('load'),
      waitFor: () => count.loads() >= 1,
      autoAdvance: true,
    },

    {
      id: 'solve',
      target: ANCHORS.ribbonCommand('solve'),
      title: t('demo.modelling.solveTitle'),
      description: t('demo.modelling.solveDesc'),
      position: 'bottom',
      allowInteraction: true,
      waitFor: hasResults,
      autoAdvance: true,
      actionButton: { label: t('demo.action.solve'), action: solve },
      onExit: () => { resultsStore.diagramType = 'deformed'; },
    },

    /*
     * Now that a result exists, the defaults are worth naming — and worth
     * changing, because the effect is visible on screen rather than described.
     */
    {
      id: 'sections',
      target: ANCHORS.ribbonCommand('sections'),
      title: t('demo.modelling.sectionsTitle'),
      description: t('demo.modelling.sectionsDesc'),
      position: 'bottom',
      allowInteraction: true,
    },

    {
      id: 'materials',
      target: ANCHORS.ribbonCommand('materials'),
      title: t('demo.modelling.materialsTitle'),
      description: t('demo.modelling.materialsDesc'),
      position: 'bottom',
      allowInteraction: true,
    },

    {
      id: 'done',
      target: 'none',
      title: t('demo.modelling.doneTitle'),
      description: t('demo.modelling.doneDesc'),
      position: 'center',
    },
  ];
}
