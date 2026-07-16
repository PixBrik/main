import { createContext, useContext } from 'react';

import type { DemoScreen } from '../types/navigation';

/**
 * App-level navigation, exposed via context so global chrome (the top menu)
 * can navigate without every screen threading a callback through its props.
 */
export const NavigationContext = createContext<(screen: DemoScreen) => void>(() => undefined);

export function useAppNavigation(): (screen: DemoScreen) => void {
  return useContext(NavigationContext);
}
