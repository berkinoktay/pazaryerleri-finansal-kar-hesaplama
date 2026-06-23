// design-sync stub for next/link — aliased via tsconfig.ds.json paths so both
// the main bundle and the preview compile resolve `next/link` to this instead
// of the real Next component (which needs a Next router/runtime to render).
// Renders a plain anchor; that's all the design previews need.
import * as React from 'react';

type LinkLikeProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href?: string | { pathname?: string };
};

const Link = React.forwardRef<HTMLAnchorElement, LinkLikeProps>(function Link(
  { href, children, ...props },
  ref,
) {
  const resolved =
    typeof href === 'string' ? href : typeof href?.pathname === 'string' ? href.pathname : '#';
  return (
    <a ref={ref} href={resolved} {...props}>
      {children}
    </a>
  );
});

export default Link;
