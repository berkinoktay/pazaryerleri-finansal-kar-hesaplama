// design-sync stub for next/image — aliased via tsconfig.ds.json paths. Renders
// a plain <img> (no Next image optimization/loader, which needs the Next
// runtime). Note: components that point next/image at a runtime public path
// (e.g. /brands/x.svg) still won't show the asset in the DS bundle — that's a
// component limitation, not this stub's.
import * as React from 'react';

type ImageLikeProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string | { src?: string };
  fill?: boolean;
};

const Image = React.forwardRef<HTMLImageElement, ImageLikeProps>(function Image(
  { src, alt, fill, style, ...props },
  ref,
) {
  const resolved = typeof src === 'string' ? src : (src?.src ?? '');
  const fillStyle = fill
    ? { position: 'absolute' as const, inset: 0, width: '100%', height: '100%' }
    : undefined;
  return (
    <img ref={ref} src={resolved} alt={alt ?? ''} style={{ ...fillStyle, ...style }} {...props} />
  );
});

export default Image;
