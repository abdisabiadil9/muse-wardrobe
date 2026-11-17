import {
  memo,
  startTransition,
  useCallback,
  useLayoutEffect,
  useOptimistic,
  useRef,
  type ReactNode,
} from 'react';
import { TabBar } from '@lenso/ui/tab-bar';
import { Sheet } from '@lenso/ui/sheet';
import { Button } from '@lenso/ui/button';
import * as stylex from '@stylexjs/stylex';
import { Compass, House, Shirt, Sparkles, UserRound, X } from 'lucide-react';

type Destination = 'today' | 'closet' | 'discover' | 'mine';
const destinations = [
  { value: 'today', label: '今日', Icon: House },
  { value: 'closet', label: '衣橱', Icon: Shirt },
  { value: 'discover', label: '灵感', Icon: Compass },
  { value: 'mine', label: '我的', Icon: UserRound },
] as const;
const styles = stylex.create({
  navigation: { width: '100%' },
  sheet: {
    width: { default: '100%', '@media (min-width: 761px)': '420px' },
    height: {
      default: 'calc(100dvh - max(48px, env(safe-area-inset-top)))',
      '@media (min-width: 761px)': 'min(750px, calc(100dvh - 70px))',
    },
    marginBottom: { default: 0, '@media (min-width: 761px)': 24 },
  },
  surface: { backgroundColor: '#fff', borderRadius: '28px 28px 0 0' },
  header: {
    padding: '0 22px 16px',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: { fontSize: 22, fontWeight: 650, letterSpacing: '-.5px', margin: 0 },
  body: { padding: '0 22px', minHeight: 0 },
  close: {
    width: 36,
    height: 36,
    minHeight: 36,
    borderRadius: '50%',
    color: '#636366',
    backgroundColor: '#f2f2f7',
  },
});

type NavigationProps = {
  current: string;
  onNavigate: (page: Destination) => void;
  onAI?: () => void;
};

export function MobileTabBar({ current, onNavigate, onAI }: NavigationProps) {
  // Keep the glass subtree independent of draft saves and conversation updates.
  const actions = useRef({ onNavigate, onAI });
  useLayoutEffect(() => {
    actions.current = { onNavigate, onAI };
  }, [onNavigate, onAI]);
  const [selection, select] = useOptimistic(current);
  const navigate = useCallback(
    (page: Destination | 'ai') => {
      startTransition(() => {
        // Give the existing Lenso spring urgent feedback; render the page as a transition.
        // React reconciles this selection with current for external navigation as well.
        select(page);
        if (page === 'ai') actions.current.onAI?.();
        else actions.current.onNavigate(page);
      });
    },
    [select],
  );
  return (
    <TabBarSurface current={selection} hasAI={!!onAI} onNavigate={navigate} />
  );
}

const TabBarSurface = memo(function TabBarSurface({
  current,
  hasAI,
  onNavigate,
}: {
  current: string;
  hasAI: boolean;
  onNavigate: (page: Destination | 'ai') => void;
}) {
  return (
    <div className={`muse-tabbar-dock${hasAI ? ' has-ai' : ''}`}>
      <TabBar
        aria-label="主导航"
        layout="phone"
        lift={8}
        xstyle={styles.navigation}
      >
        <TabBar.Group>
          {destinations.map(({ value, label, Icon }, index) => (
            <span
              className="muse-tab-entry"
              style={{ display: 'contents' }}
              key={value}
            >
              {hasAI && index === 2 && (
                <TabBar.Link
                  href="?screen=ai"
                  isCurrent={current === 'ai'}
                  icon={
                    <Sparkles
                      className="muse-ai-tab-icon"
                      size={22}
                      strokeWidth={current === 'ai' ? 2 : 1.7}
                    />
                  }
                  onClick={(event) => {
                    event.preventDefault();
                    onNavigate('ai');
                  }}
                >
                  AI 搭配
                </TabBar.Link>
              )}
              <TabBar.Link
                key={value}
                href={`?screen=${value}`}
                isCurrent={current === value}
                icon={
                  <Icon size={22} strokeWidth={current === value ? 2 : 1.7} />
                }
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(value);
                }}
              >
                {label}
              </TabBar.Link>
            </span>
          ))}
        </TabBar.Group>
      </TabBar>
    </div>
  );
});

export function WardrobeSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
      snapPoints={[0.72, 1]}
      defaultSnapPoint={1}
    >
      <Sheet.Backdrop />
      <Sheet.Content
        xstyle={styles.sheet}
        surfaceXstyle={styles.surface}
        initialFocus="content"
        data-muse-sheet="wardrobe"
      >
        <Sheet.Handle />
        <Sheet.Header xstyle={styles.header}>
          <Sheet.Title xstyle={styles.title}>{title}</Sheet.Title>
          <Sheet.Close
            render={
              <Button
                xstyle={styles.close}
                isIconOnly
                aria-label="关闭选衣"
                icon={<X size={18} />}
              />
            }
          />
        </Sheet.Header>
        <Sheet.Body xstyle={styles.body}>{children}</Sheet.Body>
      </Sheet.Content>
    </Sheet>
  );
}
