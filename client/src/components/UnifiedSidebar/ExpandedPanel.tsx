import { lazy, memo, Suspense, useCallback } from 'react';
import { useRecoilValue } from 'recoil';
import { SquarePen } from 'lucide-react';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { Skeleton, Sidebar, Button, TooltipAnchor } from '@librechat/client';
import type { NavLink } from '~/common';
import { useShortcutAriaKey, useShortcutHint } from '~/hooks/useKeyboardShortcuts';
import { CLOSE_SIDEBAR_ID } from '~/components/Chat/Menus/OpenSidebar';
import { DEFAULT_PANEL, useActivePanel } from '~/Providers';
import SidePanelNav from '~/components/SidePanel/Nav';
import { useLocalize, useNewConvo } from '~/hooks';
import { clearMessagesCache } from '~/utils';
import store from '~/store';

const AccountSettings = lazy(() => import('~/components/Nav/AccountSettings'));
const APP_NAME = 'LikeChat';

const NewChatButton = memo(function NewChatButton({
  setActive,
}: {
  setActive: (id: string) => void;
}) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { newConversation } = useNewConvo();
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const switchToHistory = useRecoilValue(store.newChatSwitchToHistory);
  const tooltipDescription = useShortcutHint('newChat', localize('com_ui_new_chat'));
  const ariaKey = useShortcutAriaKey('newChat');

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (e.button === 0 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        clearMessagesCache(queryClient, conversation?.conversationId);
        queryClient.invalidateQueries([QueryKeys.messages]);
        newConversation();
        if (switchToHistory) {
          setActive(DEFAULT_PANEL);
        }
      }
    },
    [queryClient, conversation?.conversationId, newConversation, switchToHistory, setActive],
  );

  return (
    <TooltipAnchor
      side="right"
      description={tooltipDescription}
      render={
        <a
          href="/c/new"
          data-testid="new-chat-button"
          aria-label={localize('com_ui_new_chat')}
          aria-keyshortcuts={ariaKey}
          className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-hover"
          onClick={handleClick}
        >
          <SquarePen className="h-5 w-5 text-text-primary" />
        </a>
      }
    />
  );
});

function ExpandedPanel({ links, onCollapse }: { links: NavLink[]; onCollapse: () => void }) {
  const localize = useLocalize();
  const { setActive } = useActivePanel();
  const toggleSidebarHint = useShortcutHint('toggleSidebar', localize('com_nav_close_sidebar'));
  const toggleSidebarAriaKey = useShortcutAriaKey('toggleSidebar');

  return (
    <div
      className="flex h-full w-full min-w-0 flex-col bg-surface-primary-alt"
      data-testid="conversation-sidebar"
    >
      <div className="grid h-[52px] flex-shrink-0 grid-cols-[36px_minmax(0,1fr)_36px] items-center border-b border-border-light px-3">
        <TooltipAnchor
          side="right"
          description={toggleSidebarHint}
          render={
            <Button
              id={CLOSE_SIDEBAR_ID}
              data-testid="close-sidebar-button"
              size="icon"
              variant="ghost"
              aria-label={localize('com_nav_close_sidebar')}
              aria-expanded={true}
              aria-keyshortcuts={toggleSidebarAriaKey}
              className="h-9 w-9 rounded-lg"
              onClick={onCollapse}
            >
              <Sidebar aria-hidden="true" className="h-5 w-5 text-text-primary" />
            </Button>
          }
        />
        <span
          className="truncate px-3 text-center text-base font-semibold text-text-primary"
          data-testid="sidebar-brand-name"
        >
          {APP_NAME}
        </span>
        <NewChatButton setActive={setActive} />
      </div>
      <nav id="chat-history-nav" className="min-h-0 flex-1 overflow-hidden">
        <SidePanelNav links={links} />
      </nav>
      <div className="flex-shrink-0 border-t border-border-light px-2 py-2">
        <Suspense fallback={<Skeleton className="h-12 w-full rounded-lg" />}>
          <AccountSettings />
        </Suspense>
      </div>
    </div>
  );
}

export default memo(ExpandedPanel);
