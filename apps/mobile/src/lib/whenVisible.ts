/**
 * Run an entrance animation only when the page can actually paint it.
 * Hidden browser tabs suspend requestAnimationFrame, which would leave
 * animation-driven styles frozen at their initial (often invisible) state —
 * so when the document is hidden we invoke the fallback (jump to the final
 * state) and re-run the animation callback once the page becomes visible.
 *
 * Returns a cleanup function.
 */
export function whenVisible(animate: () => void, settle: () => void): () => void {
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
    animate();
    return () => undefined;
  }
  settle();
  const onChange = () => {
    if (document.visibilityState === 'visible') {
      document.removeEventListener('visibilitychange', onChange);
      animate();
    }
  };
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}
