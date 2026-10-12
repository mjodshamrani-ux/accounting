import { createContext, useContext, type ReactNode } from 'react';
import type { ReconciliationDomain } from '@/lib/i18n/reconciliation-directory';

export type WorkspaceActivity = { busy: boolean; hasWork: boolean };
export type ReconciliationNavigation = {
  domain: ReconciliationDomain;
  reportActivity: (
    domain: ReconciliationDomain,
    activity: WorkspaceActivity,
  ) => void;
};

const NavigationContext = createContext<ReconciliationNavigation | null>(null);
const IdentityContext = createContext<ReconciliationDomain | null>(null);

export function ReconciliationNavigationProvider({
  value,
  children,
}: {
  value: ReconciliationNavigation;
  children: ReactNode;
}) {
  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

export function WorkspaceIdentityProvider({
  domain,
  children,
}: {
  domain: ReconciliationDomain;
  children: ReactNode;
}) {
  return (
    <IdentityContext.Provider value={domain}>
      {children}
    </IdentityContext.Provider>
  );
}

export const useReconciliationNavigation = () => useContext(NavigationContext);
export const useWorkspaceIdentity = () => useContext(IdentityContext);
