// 루트 layout이 html·body를 그린다. 여기서는 다시 그리지 않는다.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh">{children}</div>;
}
