'use client';

import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';

/**
 * Single show/hide toggle region — a standalone expandable detail
 * block, optional subform, or "Show advanced" disclosure. For multiple
 * related collapsible sections (FAQ list, settings groups), use
 * Accordion instead so the sibling-coordination behavior comes built in.
 *
 * @useWhen toggling a single show/hide region with no sibling sections (use Accordion for related multiple collapsibles)
 */

export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger;
export const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent;
