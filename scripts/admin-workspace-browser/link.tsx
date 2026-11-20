import React from 'react';

export default function Link({ children, href, ...props }: React.ComponentProps<'a'>) {
  return <a href={href} {...props}>{children}</a>;
}
