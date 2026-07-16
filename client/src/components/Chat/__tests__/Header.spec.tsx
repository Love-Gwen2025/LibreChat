import React from 'react';
import { RecoilRoot } from 'recoil';
import '@testing-library/jest-dom/extend-expect';
import { render, screen } from '@testing-library/react';
import type { MutableSnapshot } from 'recoil';

let mockIsSmallScreen = false;
let mockHasAccess = false;

jest.mock('~/store', () => {
  const { atom } = jest.requireActual('recoil');
  return {
    __esModule: true,
    default: {
      sidebarExpanded: atom({ key: 'mock-header-sidebar-expanded', default: true }),
    },
  };
});

jest.mock('@librechat/client', () => ({
  useMediaQuery: () => mockIsSmallScreen,
}));

jest.mock('librechat-data-provider', () => ({
  getConfigDefaults: () => ({ interface: {} }),
  PermissionTypes: { TEMPORARY_CHAT: 'temp' },
  Permissions: { USE: 'use' },
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { interface: {} } }),
}));

jest.mock('~/hooks', () => ({
  useHasAccess: () => mockHasAccess,
}));

jest.mock('~/utils', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

jest.mock('../Menus/Endpoints/ModelSelector', () => ({
  __esModule: true,
  default: () => <div data-testid="model-selector" />,
}));

jest.mock('../ExportAndShareMenu', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../Menus', () => ({
  OpenSidebar: () => <button data-testid="open-sidebar-button" />,
  PresetsMenu: () => null,
}));

jest.mock('../Menus/BookmarkMenu', () => ({
  __esModule: true,
  default: () => <div data-testid="bookmark-menu" />,
}));

jest.mock('../TemporaryChat', () => ({ TemporaryChat: () => null }));
jest.mock('../AddMultiConvo', () => ({
  __esModule: true,
  default: () => <button data-testid="add-multi-convo-button" />,
}));

import Header from '../Header';
import store from '~/store';

function renderHeader(expanded: boolean) {
  return render(
    <RecoilRoot
      initializeState={({ set }: MutableSnapshot) => set(store.sidebarExpanded, expanded)}
    >
      <Header />
    </RecoilRoot>,
  );
}

describe('Header sidebar opener', () => {
  beforeEach(() => {
    mockIsSmallScreen = false;
    mockHasAccess = false;
  });

  it('shows the mobile opener when the sidebar is closed', () => {
    mockIsSmallScreen = true;

    renderHeader(false);

    expect(screen.getByTestId('open-sidebar-button')).toBeInTheDocument();
  });

  it('shows the desktop opener when the sidebar is closed', () => {
    mockIsSmallScreen = false;

    renderHeader(false);

    expect(screen.getByTestId('open-sidebar-button')).toBeInTheDocument();
  });

  it('hides the opener while the sidebar is expanded', () => {
    renderHeader(true);

    expect(screen.queryByTestId('open-sidebar-button')).not.toBeInTheDocument();
  });

  it('does not render bookmark or multi-conversation controls', () => {
    mockHasAccess = true;

    renderHeader(true);

    expect(screen.queryByTestId('bookmark-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('add-multi-convo-button')).not.toBeInTheDocument();
  });
});
