import React from 'react';
import { RecoilRoot } from 'recoil';
import '@testing-library/jest-dom/extend-expect';
import { MessagesSquare } from 'lucide-react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MutableSnapshot } from 'recoil';
import { ActivePanelProvider, DEFAULT_PANEL } from '~/Providers/ActivePanelContext';

const mockNewConversation = jest.fn();
const mockClearMessagesCache = jest.fn();

jest.mock('~/store', () => {
  const { atom } = jest.requireActual('recoil');
  let counter = 0;
  const switchAtom = atom({
    key: 'mock-newChatSwitchToHistory',
    default: true,
  });
  const customShortcutsAtom = atom({
    key: 'mock-customShortcuts',
    default: {},
  });
  return {
    __esModule: true,
    default: {
      conversationByIndex: () =>
        atom({ key: `mock-conversationByIndex-${counter++}`, default: null }),
      newChatSwitchToHistory: switchAtom,
      customShortcuts: customShortcutsAtom,
    },
  };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useNewConvo: () => ({ newConversation: mockNewConversation }),
}));

jest.mock('~/hooks/useKeyboardShortcuts', () => ({
  useShortcutAriaKey: () => undefined,
  useShortcutHint: (_id: string, description: string) => description,
}));

jest.mock('~/Providers', () => jest.requireActual('~/Providers/ActivePanelContext'));

jest.mock('~/utils', () => ({
  clearMessagesCache: (...args: unknown[]) => mockClearMessagesCache(...args),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({
  CLOSE_SIDEBAR_ID: 'close-sidebar',
}));

jest.mock('~/components/SidePanel/Nav', () => ({
  __esModule: true,
  default: ({ links }: { links: Array<{ id: string }> }) => (
    <div data-testid="sidebar-content">{links.map((link) => link.id).join(',')}</div>
  ),
}));

jest.mock('~/components/Nav/AccountSettings', () => ({
  __esModule: true,
  default: ({ collapsed = false }: { collapsed?: boolean }) => (
    <div data-collapsed={String(collapsed)} data-testid="account-settings" />
  ),
}));

import ExpandedPanel from '../ExpandedPanel';
import store from '~/store';

const links = [
  {
    title: 'com_ui_chat_history' as const,
    label: '',
    icon: MessagesSquare,
    id: DEFAULT_PANEL,
  },
];

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderPanel({
  onCollapse = jest.fn(),
  initialPanel = DEFAULT_PANEL,
  initializeState,
}: {
  onCollapse?: jest.Mock;
  initialPanel?: string;
  initializeState?: (snapshot: MutableSnapshot) => void;
} = {}) {
  if (initialPanel !== DEFAULT_PANEL) {
    localStorage.setItem('side:active-panel', initialPanel);
  }

  const result = render(
    <QueryClientProvider client={createQueryClient()}>
      <RecoilRoot initializeState={initializeState}>
        <ActivePanelProvider>
          <ExpandedPanel links={links} onCollapse={onCollapse} />
        </ActivePanelProvider>
      </RecoilRoot>
    </QueryClientProvider>,
  );

  return { ...result, onCollapse };
}

async function renderReady(options?: Parameters<typeof renderPanel>[0]) {
  const result = renderPanel(options);
  await screen.findByTestId('account-settings');
  return result;
}

describe('ExpandedPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it('renders conversation content without the icon strip', async () => {
    await renderReady();

    expect(screen.getByTestId('sidebar-content')).toHaveTextContent(DEFAULT_PANEL);
    expect(screen.queryByTestId(`nav-panel-${DEFAULT_PANEL}`)).not.toBeInTheDocument();
  });

  it('closes the sidebar from its header', async () => {
    const { onCollapse } = await renderReady();

    fireEvent.click(screen.getByTestId('close-sidebar-button'));

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('renders the LikeChat name without a brand logo in the sidebar header', async () => {
    await renderReady();

    expect(screen.queryByTestId('sidebar-brand-logo')).not.toBeInTheDocument();
    expect(screen.getByTestId('sidebar-brand-name')).toHaveTextContent('LikeChat');
  });

  it('places the expanded account menu after the conversation area', async () => {
    await renderReady();

    const content = screen.getByTestId('sidebar-content');
    const account = screen.getByTestId('account-settings');
    expect(account).toHaveAttribute('data-collapsed', 'false');
    expect(
      content.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps new chat available and switches back to conversation history', async () => {
    await renderReady({ initialPanel: 'prompts' });

    fireEvent.click(screen.getByTestId('new-chat-button'));

    expect(mockNewConversation).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('side:active-panel')).toBe(DEFAULT_PANEL);
  });

  it('respects the setting that keeps the current panel on new chat', async () => {
    await renderReady({
      initialPanel: 'prompts',
      initializeState: ({ set }: MutableSnapshot) => {
        set(store.newChatSwitchToHistory, false);
      },
    });

    fireEvent.click(screen.getByTestId('new-chat-button'));

    expect(mockNewConversation).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('side:active-panel')).toBe('prompts');
  });
});
