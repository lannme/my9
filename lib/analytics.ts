export function trackEvent(name: string, params: Record<string, any>) {
  if (typeof window === 'undefined') return;
  const gtag = (window as any).gtag;
  if (!gtag) return;
  try {
    gtag('event', name, params);
  } catch {
    // ignore analytics errors
  }
}

