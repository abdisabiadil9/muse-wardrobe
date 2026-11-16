import type { ReactNode } from 'react';
import { TabBar } from '@lenso/ui/tab-bar';
import { Sheet } from '@lenso/ui/sheet';
import { Button } from '@lenso/ui/button';
import * as stylex from '@stylexjs/stylex';
import { Compass, House, Shirt, UserRound, X } from 'lucide-react';

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
    height: { default: 'calc(100dvh - max(48px, env(safe-area-inset-top)))', '@media (min-width: 761px)': 'min(750px, calc(100dvh - 70px))' },
    marginBottom: { default: 0, '@media (min-width: 761px)': 24 },
  },
  surface: { backgroundColor: '#fff', borderRadius: '28px 28px 0 0' },
  header: { padding: '0 22px 16px', display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 22, fontWeight: 650, letterSpacing: '-.5px', margin: 0 },
  body: { padding: '0 22px', minHeight: 0 },
  close: { width: 36, height: 36, minHeight: 36, borderRadius: '50%', color: '#636366', backgroundColor: '#f2f2f7' },
});

export function MobileTabBar({ current, onNavigate }: { current: string; onNavigate: (page: Destination) => void }) {
  return <div className="muse-tabbar-dock">
    <TabBar aria-label="主导航" layout="phone" lift={8} xstyle={styles.navigation}>
      <TabBar.Group>
        {destinations.map(({ value, label, Icon }) => <TabBar.Link key={value} href={`?screen=${value}`} isCurrent={current === value} icon={<Icon size={22} strokeWidth={current === value ? 2 : 1.7}/>} onClick={event => {event.preventDefault(); onNavigate(value)}}>{label}</TabBar.Link>)}
      </TabBar.Group>
    </TabBar>
  </div>;
}

export function WardrobeSheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return <Sheet open={open} onOpenChange={value => { if (!value) onClose() }} snapPoints={[0.72, 1]} defaultSnapPoint={1}>
    <Sheet.Backdrop/>
    <Sheet.Content xstyle={styles.sheet} surfaceXstyle={styles.surface} initialFocus="content" data-muse-sheet="wardrobe">
      <Sheet.Handle/>
      <Sheet.Header xstyle={styles.header}>
        <Sheet.Title xstyle={styles.title}>{title}</Sheet.Title>
        <Sheet.Close render={<Button xstyle={styles.close} isIconOnly aria-label="关闭选衣" icon={<X size={18}/>}/>}/>
      </Sheet.Header>
      <Sheet.Body xstyle={styles.body}>{children}</Sheet.Body>
    </Sheet.Content>
  </Sheet>;
}
