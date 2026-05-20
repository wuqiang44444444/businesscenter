import { useEffect, useState } from 'react';

// 简单 matchMedia 钩子：返回布尔，监听屏幕变化
// 同时返回静态值在 SSR / 初始化时不闪烁（Vite 是纯 CSR 无所谓但保持一致）
export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== 'undefined' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState<boolean>(get);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    onChange();
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

// 与 antd 断点对齐：< 768px 视为手机
export const useIsMobile = () => useMediaQuery('(max-width: 767px)');
