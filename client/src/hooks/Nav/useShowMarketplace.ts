import { useContext, useMemo } from 'react';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import { useGetStartupConfig } from '~/data-provider';
import { useHasAccess, AuthContext } from '~/hooks';

/**
 * Hook to determine if the Agent Marketplace should be shown.
 * Consolidates the logic for checking:
 * - Auth readiness (avoid race conditions)
 * - Access to Agents permission
 * - Access to Marketplace permission
 *
 * @returns Whether the Agent Marketplace should be displayed
 */
export default function useShowMarketplace(): boolean {
  const authContext = useContext(AuthContext);
  const { data: startupConfig } = useGetStartupConfig();

  const hasAccessToAgents = useHasAccess({
    permissionType: PermissionTypes.AGENTS,
    permission: Permissions.USE,
  });

  const hasAccessToMarketplace = useHasAccess({
    permissionType: PermissionTypes.MARKETPLACE,
    permission: Permissions.USE,
  });

  // Check if auth is ready (avoid race conditions)
  const authReady = useMemo(
    () =>
      authContext?.isAuthenticated !== undefined &&
      (authContext?.isAuthenticated === false || authContext?.user !== undefined),
    [authContext?.isAuthenticated, authContext?.user],
  );

  const marketplaceEnabled = startupConfig?.interface?.marketplace?.use === true;

  // Keep the route out of the UI even if role permissions have not synchronized yet.
  return marketplaceEnabled && authReady && hasAccessToAgents && hasAccessToMarketplace;
}
