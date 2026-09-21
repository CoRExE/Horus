export function setupImmersiveNavigation(
  listen: (event: 'change' | 'focus', callback: (state?: string) => void) => () => void,
  hide: () => void,
) {
  hide();
  const removeChange = listen('change', state => { if (state === 'active') hide(); });
  const removeFocus = listen('focus', hide);
  return () => { removeChange(); removeFocus(); };
}
