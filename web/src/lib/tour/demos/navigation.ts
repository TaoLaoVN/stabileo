/**
 * "Moverse y seleccionar" — the two gestures everything else is built on.
 *
 * One walkthrough for both viewports rather than two, because the ideas are
 * identical and only the hand movement differs: in 2D a drag pans, in 3D the
 * same drag orbits and panning needs Shift. Splitting them would teach the
 * same three concepts twice and hide the one comparison worth making, so the
 * demo switches dimension in the middle and points at the difference.
 *
 * It ends on Delete. That is not padding — deleting is the destructive
 * gesture, its meaning depends on which kinds are armed, and a user who has
 * just learned to sweep a rectangle is one keypress away from finding out the
 * hard way.
 */

import type { TourStep } from '../../store/tour.svelte';
import { t } from '../../i18n';
import { ANCHORS, loadExample, setDimension } from '../demo-helpers';
import { uiStore } from '../../store';

export function buildNavigation(): TourStep[] {
  return [
    {
      id: 'welcome',
      target: 'none',
      title: t('demo.navigation.welcomeTitle'),
      description: t('demo.navigation.welcomeDesc'),
      position: 'center',
      onEnter: () => {
        setDimension('2d');
        void loadExample('portal-frame');
        uiStore.currentTool = 'pan';
      },
    },

    {
      id: 'pan-2d',
      target: ANCHORS.pointerMode,
      title: t('demo.navigation.pan2dTitle'),
      description: t('demo.navigation.pan2dDesc'),
      position: 'left',
      allowInteraction: true,
      onEnter: () => { uiStore.currentTool = 'pan'; },
    },

    /*
     * The same button, in 3D, is the comparison this demo exists for. The
     * dimension switches under the reader while the spotlight stays on the
     * control, so the change is in the behaviour and not in where to look.
     */
    {
      id: 'pan-3d',
      target: ANCHORS.pointerMode,
      title: t('demo.navigation.pan3dTitle'),
      description: t('demo.navigation.pan3dDesc'),
      position: 'left',
      allowInteraction: true,
      onEnter: () => {
        setDimension('3d');
        void loadExample('3d-portal-frame');
        uiStore.currentTool = 'pan';
      },
      onExit: () => {
        setDimension('2d');
        void loadExample('portal-frame');
      },
    },

    {
      id: 'select-mode',
      target: ANCHORS.pointerMode,
      title: t('demo.navigation.selectTitle'),
      description: t('demo.navigation.selectDesc'),
      position: 'left',
      allowInteraction: true,
      onEnter: () => { uiStore.currentTool = 'select'; },
    },

    /*
     * Window versus crossing. Every CAD package agrees on the convention and
     * almost nobody is told about it; being told is the difference between a
     * drag that does what you meant and one you undo.
     */
    {
      id: 'window-crossing',
      target: ANCHORS.viewport,
      title: t('demo.navigation.dragTitle'),
      description: t('demo.navigation.dragDesc'),
      position: 'right',
      highlightPadding: 0,
      overlayOpacity: 0.4,
      allowInteraction: true,
    },

    {
      id: 'kinds',
      target: ANCHORS.ribbonCommand('select'),
      title: t('demo.navigation.kindsTitle'),
      description: t('demo.navigation.kindsDesc'),
      position: 'bottom',
      allowInteraction: true,
    },

    {
      id: 'delete',
      target: ANCHORS.rightPanel,
      title: t('demo.navigation.deleteTitle'),
      description: t('demo.navigation.deleteDesc'),
      position: 'left',
      allowInteraction: true,
    },

    {
      id: 'done',
      target: 'none',
      title: t('demo.navigation.doneTitle'),
      description: t('demo.navigation.doneDesc'),
      position: 'center',
    },
  ];
}
