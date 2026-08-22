/**
 * "Análisis cinemático" — is this structure even solvable?
 *
 * The one advanced tool that answers a question you have BEFORE solving, and
 * the reason it is first: a mechanism does not produce a wrong answer, it
 * produces no answer, and the error the solver returns is about matrices
 * rather than about the beam.
 *
 * The walkthrough removes a support on purpose. Reading the panel on a
 * structure that is already fine teaches the layout; watching the verdict flip
 * from isostatic to a mechanism, and reading what it says to add, teaches what
 * the panel is FOR.
 */

import type { TourStep } from '../../store/tour.svelte';
import { t } from '../../i18n';
import { ANCHORS, loadExample, setDimension } from '../demo-helpers';
import { modelStore, uiStore } from '../../store';

/** The support this demo removes, remembered so the exit can put it back. */
let removed: { nodeId: number; type: string } | null = null;

export function buildKinematics(): TourStep[] {
  return [
    {
      id: 'welcome',
      target: 'none',
      title: t('demo.kinematics.welcomeTitle'),
      description: t('demo.kinematics.welcomeDesc'),
      position: 'center',
      onEnter: () => {
        setDimension('2d');
        removed = null;
        void loadExample('simply-supported');
      },
    },

    {
      id: 'open',
      target: ANCHORS.ribbonCommand('advanced'),
      title: t('demo.kinematics.openTitle'),
      description: t('demo.kinematics.openDesc'),
      position: 'bottom',
      allowInteraction: true,
    },

    {
      id: 'panel',
      target: '[data-testid="adv-kinematic"]',
      title: t('demo.kinematics.panelTitle'),
      description: t('demo.kinematics.panelDesc'),
      position: 'left',
      allowInteraction: true,
      onEnter: () => { uiStore.showKinematicPanel = true; },
    },

    {
      id: 'reading',
      target: ANCHORS.viewport,
      title: t('demo.kinematics.readingTitle'),
      description: t('demo.kinematics.readingDesc'),
      position: 'right',
      highlightPadding: 0,
      overlayOpacity: 0.4,
    },

    /*
     * The demonstration. Removing a support is done through the store rather
     * than by asking the reader to find and delete one: the point is the
     * verdict changing, not the deletion, and a reader hunting for a support
     * to click has stopped watching the panel.
     */
    {
      id: 'break-it',
      target: ANCHORS.viewport,
      title: t('demo.kinematics.breakTitle'),
      description: t('demo.kinematics.breakDesc'),
      position: 'right',
      highlightPadding: 0,
      overlayOpacity: 0.4,
      onEnter: () => {
        const sup = [...modelStore.supports.values()][0];
        if (!sup || removed) return;
        removed = { nodeId: sup.nodeId, type: sup.type };
        modelStore.removeSupport(sup.id);
      },
    },

    {
      id: 'verdict',
      target: ANCHORS.rightPanel,
      title: t('demo.kinematics.verdictTitle'),
      description: t('demo.kinematics.verdictDesc'),
      position: 'left',
      allowInteraction: true,
    },

    {
      id: 'done',
      target: 'none',
      title: t('demo.kinematics.doneTitle'),
      description: t('demo.kinematics.doneDesc'),
      position: 'center',
      // Put the beam back. A walkthrough that leaves the model broken has
      // handed the reader a mechanism to wonder about.
      onEnter: () => {
        if (!removed) return;
        modelStore.addSupport(removed.nodeId, removed.type as never);
        removed = null;
      },
    },
  ];
}
