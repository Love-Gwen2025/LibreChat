import { renderHook } from '@testing-library/react';

const mockHasAccess = jest.fn();
let mockMarketplaceEnabled = false;

jest.mock('~/hooks', () => {
  const React = jest.requireActual('react');
  return {
    AuthContext: React.createContext({ isAuthenticated: true, user: { id: 'user-1' } }),
    useHasAccess: (...args: unknown[]) => mockHasAccess(...args),
  };
});

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({
    data: { interface: { marketplace: { use: mockMarketplaceEnabled } } },
  }),
}));

import useShowMarketplace from './useShowMarketplace';

describe('useShowMarketplace', () => {
  beforeEach(() => {
    mockHasAccess.mockReturnValue(true);
    mockMarketplaceEnabled = false;
  });

  it('hides the marketplace when interface configuration disables it', () => {
    const { result } = renderHook(() => useShowMarketplace());

    expect(result.current).toBe(false);
  });

  it('shows the marketplace only when config and permissions both allow it', () => {
    mockMarketplaceEnabled = true;

    const { result } = renderHook(() => useShowMarketplace());

    expect(result.current).toBe(true);
  });

  it('keeps the marketplace hidden when a required permission is denied', () => {
    mockMarketplaceEnabled = true;
    mockHasAccess.mockReturnValueOnce(true).mockReturnValueOnce(false);

    const { result } = renderHook(() => useShowMarketplace());

    expect(result.current).toBe(false);
  });
});
