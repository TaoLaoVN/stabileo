/**
 * "Análisis de sección" — what the internal forces do to the material.
 *
 * The densest tool in Basic, so the explanation is split rather than piled
 * into one card: what the sliders move, then what surrounds the section, then
 * the stress state below it. Three cards of one idea each beat one card of
 * eight that a reader skims.
 *
 * It needs a solved model to have anything to show, so the walkthrough solves
 * first rather than arming the tool and letting the reader hit "calculate the
 * model first".
 */

import type { TourStep } from '../../store/tour.svelte';
import { t } from '../../i18n';
import { ANCHORS, loadExample, solve, hasResults, setDimension, openPanel } from '../demo-helpers';
import { uiStore } from '../../store';

export function buildSectionAnalysis(): TourStep[] {
  return [
    {
      id: 'welcome',
      target: 'none',
      title: t('demo.section.welcomeTitle'),
      description: t('demo.section.welcomeDesc'),
      position: 'center',
      onEnter: () => {
        setDimension('2d');
        void loadExample('simply-supported');
      },
    },

    {
      id: 'solve',
      target: ANCHORS.ribbonCommand('solve'),
      title: t('demo.section.solveTitle'),
      description: t('demo.section.solveDesc'),
      position: 'bottom',
      allowInteraction: true,
      waitFor: hasResults,
      autoAdvance: true,
      actionButton: { label: t('demo.action.solve'), action: solve },
      // The next step points inside the Advanced panel, so it has to be open.
      onExit: () => openPanel('advanced'),
    },

    {
      id: 'arm',
      // Same as the kinematic walkthrough: arming the analysis takes its own
      // button off the screen, so the step points at the panel instead.
      target: ANCHORS.rightPanel,
      title: t('demo.section.armTitle'),
      description: t('demo.section.armDesc'),
      position: 'left',
      allowInteraction: true,
      onEnter: () => {
        uiStore.currentTool = 'select';
        uiStore.selectMode = 'stress';
      },
    },

    /*
     * The click on the member is the reader's, not the demo's: where along the
     * span you ask is the whole point of the tool, and a demo that picks the
     * point for you has answered the only question it was meant to pose.
     */
    {
      id: 'pick',
      target: ANCHORS.viewport,
      title: t('demo.section.pickTitle'),
      description: t('demo.section.pickDesc'),
      position: 'right',
      highlightPadding: 0,
      overlayOpacity: 0.35,
      allowInteraction: true,
      waitFor: () => document.querySelector('.ssp-panel') !== null,
      autoAdvance: true,
    },

    {
      id: 'sliders',
      target: '.ssp-panel',
      title: t('demo.section.slidersTitle'),
      description: t('demo.section.slidersDesc'),
      position: 'left',
      allowInteraction: true,
    },

    {
      id: 'around',
      target: '.ssp-panel',
      title: t('demo.section.aroundTitle'),
      description: t('demo.section.aroundDesc'),
      position: 'left',
      allowInteraction: true,
    },

    {
      id: 'state',
      target: '.ssp-panel',
      title: t('demo.section.stateTitle'),
      description: t('demo.section.stateDesc'),
      position: 'left',
      allowInteraction: true,
    },

    {
      id: 'done',
      target: 'none',
      title: t('demo.section.doneTitle'),
      description: t('demo.section.doneDesc'),
      position: 'center',
      onEnter: () => { uiStore.selectMode = 'elements'; },
    },
  ];
}
