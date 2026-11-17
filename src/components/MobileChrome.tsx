import type { CSSProperties, ReactNode } from 'react';
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

export function MobileTabBar({
  current,
  onNavigate,
  onAI,
}: {
  current: string;
  onNavigate: (page: Destination) => void;
  onAI?: () => void;
}) {
  const tabs = destinations.flatMap((tab, index) =>
    onAI && index === 2
      ? [{ value: 'ai', label: 'AI 搭配', Icon: Sparkles }, tab]
      : [tab],
  );
  const activeIndex = tabs.findIndex((tab) => tab.value === current);
  return (
    <div className="muse-tabbar-dock">
      <nav
        className="muse-tabbar"
        aria-label="主导航"
        style={{ '--tab-count': tabs.length, '--tab-index': Math.max(0, activeIndex) } as CSSProperties}
      >
        <span className="muse-tab-highlight" aria-hidden="true" hidden={activeIndex < 0} />
        {tabs.map(({ value, label, Icon }) => (
          <a
            key={value}
            href={`?screen=${value}`}
            data-tab-bar-item=""
            data-current={current === value ? '' : undefined}
            aria-current={current === value ? 'page' : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              if (value === current) return;
              if (value === 'ai') onAI?.();
              else onNavigate(value as Destination);
            }}
          >
            <Icon size={22} strokeWidth={current === value ? 2 : 1.7} />
            <span>{label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}

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
