'use strict';

/*
 * tooltip.js and render.js stay classic scripts and publish themselves on window. Classic
 * scripts run during parse and module scripts are deferred until after it, so both are always
 * defined by the time anything here evaluates.
 */

export const M = window.TooltipModel;
export const R = window.TooltipRenderer;
