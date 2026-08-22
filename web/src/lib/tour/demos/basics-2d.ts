/**
 * "Primeros pasos" — load, solve, read.
 *
 * The shortest useful path through Basic, and the one `/demo` opens with. It
 * exists to answer one question: what does this app do? Three acts — there is
 * a model, you press one button, and the answers appear — and it deliberately
 * teaches nothing about drawing, because someone who has not yet seen a result
 * has no reason to care how a node is placed.
 *
 * Every step that changes the model does it through the same code the buttons
 * use, so the demo cannot drift from the app: `loadExample` is what the
 * examples menu calls, and `solve` dispatches the event the Solve command
 * dispatches.
 */

import type { TourStep } from '../../store/tour.svelte';
import { t } from '../../i18n';
import { ANCHORS, loadExample, solve, hasResults, setDimension, asideCard } from '../demo-helpers';
import { resultsStore } from '../../store';

export function buildBasics2D(): TourStep[] {
  return [
    {
      id: 'welcome',
      target: 'none',
      title: t('demo.basics2d.welcomeTitle'),
      description: t('demo.basics2d.welcomeDesc'),
      position: 'center',
      onEnter: () => {
        setDimension('2d');
        void loadExample('portal-frame');
      },
    },

    /*
     * The model first, and named. A reader who has just been dropped into a
     * drawing needs to know what they are looking at before being asked to do
     * anything to it.
     */
    {
      id: 'the-model',
      target: ANCHORS.viewport,
      title: t('demo.basics2d.modelTitle'),
      description: t('demo.basics2d.modelDesc'),
      position: 'right',
      highlightPadding: 0,
      overlayOpacity: 0.45,
    },

    {
      id: 'solve',
      target: ANCHORS.ribbonCommand('solve'),
      title: t('demo.basics2d.solveTitle'),
      description: t('demo.basics2d.solveDesc'),
      position: 'bottom',
      allowInteraction: true,
      waitFor: hasResults,
      autoAdvance: true,
      // Offered as a button as well as a target: on a narrow screen the ribbon
      // may be scrolled away from the command the spotlight is pointing at.
      actionButton: { label: t('demo.action.solve'), action: solve },
    },

    {
      id: 'deformed',
      cardPosition: asideCard(),
      target: ANCHORS.ribbonCommand('deformed'),
      title: t('demo.basics2d.deformedTitle'),
      description: t('demo.basics2d.deformedDesc'),
      position: 'bottom',
      allowInteraction: true,
      onEnter: () => { resultsStore.diagramType = 'deformed'; },
    },

    {
      id: 'moment',
      cardPosition: asideCard(),
      target: ANCHORS.ribbonCommand('momentY'),
      title: t('demo.basics2d.momentTitle'),
      description: t('demo.basics2d.momentDesc'),
      position: 'bottom',
      allowInteraction: true,
      onEnter: () => { resultsStore.diagramType = 'moment'; },
    },

    /*
     * The panel, last and briefly. It is where the rest of the app lives, so
     * ending here is the handover: the demo stops and the reader is already
     * looking at what they would use next.
     */
    {
      id: 'panel',
      target: ANCHORS.rightPanel,
      title: t('demo.basics2d.panelTitle'),
      description: t('demo.basics2d.panelDesc'),
      position: 'left',
    },

    {
      id: 'done',
      target: 'none',
      title: t('demo.basics2d.doneTitle'),
      description: t('demo.basics2d.doneDesc'),
      position: 'center',
    },
  ];
}
