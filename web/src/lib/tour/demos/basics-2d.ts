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
import { ANCHORS, loadExample, solve, hasResults, setDimension } from '../demo-helpers';
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

    /*
     * The whole row, named but not explained.
     *
     * This step used to walk two diagrams — deformed shape, then bending —
     * with a paragraph on each. That is the subject of "Leer los resultados",
     * and teaching it twice makes the first walkthrough long and the fifth
     * redundant. Forty seconds should end with the reader knowing the results
     * are THERE and that one press produced all of them.
     */
    {
      id: 'results-row',
      target: ANCHORS.ribbonGroup('results'),
      title: t('demo.basics2d.resultsTitle'),
      description: t('demo.basics2d.resultsDesc'),
      position: 'bottom',
      allowInteraction: true,
      onEnter: () => { resultsStore.diagramType = 'deformed'; },
    },

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
