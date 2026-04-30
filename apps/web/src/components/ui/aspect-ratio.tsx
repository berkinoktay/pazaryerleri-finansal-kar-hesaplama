'use client';

import * as AspectRatioPrimitive from '@radix-ui/react-aspect-ratio';

/**
 * Wraps a child in a box that maintains a fixed width:height ratio
 * regardless of the container width — product images, marketplace
 * photos, video embeds, hero images. Prevents layout shift when the
 * inner content (e.g. an `<img>`) hasn't loaded yet.
 *
 * @useWhen reserving a fixed width:height box for image, video, or media content to prevent layout shift on load
 */

export const AspectRatio = AspectRatioPrimitive.Root;
