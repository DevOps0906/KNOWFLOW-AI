# 디자인 토큰 (자동 생성 파일 — 직접 고치지 말 것. tokens.css 수정 → design-preview --md 재실행. 브리프·설명은 DESIGN.md에)

## 색
| 토큰 | 라이트 | 다크 |
|---|---|---|
| `--color-background` | `#f9f8f4` | `#121518` |
| `--color-foreground` | `#1c1e15` | `#e9ecee` |
| `--color-card` | `#fdfdfa` | `#1a1e22` |
| `--color-card-foreground` | `#1c1e15` | `#e9ecee` |
| `--color-popover` | `#fdfdfa` | `#1a1e22` |
| `--color-popover-foreground` | `#1c1e15` | `#e9ecee` |
| `--color-primary` | `#1c1e15` | `#6cc4cc` |
| `--color-primary-foreground` | `#ffffff` | `#0b1417` |
| `--color-secondary` | `#eeede5` | `#22272c` |
| `--color-secondary-foreground` | `#1c1e15` | `#e9ecee` |
| `--color-muted` | `#eeede5` | `#22272c` |
| `--color-muted-foreground` | `#434739` | `#a1aab3` |
| `--color-accent` | `#eeede5` | `#1e3438` |
| `--color-accent-foreground` | `#0c0d08` | `#bfe6ea` |
| `--color-destructive` | `#b42318` | `#f0857b` |
| `--color-destructive-foreground` | `#ffffff` | `#230b08` |
| `--color-border` | `#e7e8e3` | `#2e343a` |
| `--color-input` | `#8a8d7a` | `#6e7882` |
| `--color-ring` | `#1c1e15` | `#6cc4cc` |
| `--color-sidebar` | `#f5f4ed` | `#171b1e` |
| `--color-sidebar-foreground` | `#1c1e15` | `#e9ecee` |
| `--color-heading` | `#0c0d08` | `#f4f6f7` |
| `--color-faint` | `#9fa28e` | `#8a939c` |
| `--color-lime` | `#d4f04c` | `#b9d63a` |
| `--color-lime-fg` | `#1c1e15` | `#11140a` |
| `--color-bg` | `#f9f8f4` | `#121518` |
| `--color-surface` | `#fdfdfa` | `#1a1e22` |
| `--color-text` | `#1c1e15` | `#e9ecee` |
| `--color-text-muted` | `#434739` | `#a1aab3` |
| `--color-primary-fg` | `#ffffff` | `#0b1417` |
| `--color-danger` | `#b42318` | `#f0857b` |
| `--color-danger-fg` | `#ffffff` | `#230b08` |
| `--color-danger-soft` | `#fbe9e7` | `#3c1d1a` |
| `--color-success` | `#1e6b3c` | `#6fcb8e` |
| `--color-success-fg` | `#ffffff` | `#08170d` |
| `--color-success-soft` | `#e7f3ea` | `#17301f` |
| `--color-warning` | `#8a5a00` | `#e5b54d` |
| `--color-warning-fg` | `#ffffff` | `#1f1503` |
| `--color-warning-soft` | `#fbf1dc` | `#3a2e12` |
| `--color-highlight` | `#ffe45c` | `#6b5a12` |
| `--color-highlight-fg` | `#1c1e15` | `#fff3b8` |
| `--color-highlight-soft` | `#fff4b8` | `#4a3f12` |
| `--color-scrim` | `rgb(0 0 0 / 0.4)` | `rgb(0 0 0 / 0.6)` |

## 글자 크기 (반응형 3구간)
| 토큰 | 모바일 ~767 | 태블릿 768~1199 | 데스크톱 1200~ |
|---|---|---|---|
| `--text-display` | 1.75rem | 2.25rem | 3rem |
| `--text-h1` | 1.5rem | 1.75rem | 2.125rem |
| `--text-h2` | 1.25rem | 1.375rem | 1.625rem |
| `--text-body` | 0.9375rem | 1rem | 1rem |
| `--text-caption` | 0.75rem | 0.8125rem | 0.8125rem |
| `--text-reading` | 1.0625rem | 1.125rem | 1.125rem |
| `--text-hero` | 1.75rem | 2rem | 2.25rem |
| `--text-nav` | 0.875rem | 0.875rem | 0.875rem |
| `--text-label` | 0.75rem | 0.75rem | 0.75rem |

## 서체 · 반경 · 그림자 · 기타
| 토큰 | 값 |
|---|---|
| `--font-sans` | `var(--font-inter, Inter), "Pretendard Variable", Pretendard, system-ui, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif` |
| `--font-serif` | `"Noto Serif KR", "Nanum Myeongjo", "Batang", serif` |
| `--font-mono` | `ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace` |
| `--radius` | `0.75rem` |
| `--radius-control` | `999px` |
| `--radius-row` | `0.625rem` |
| `--radius-panel` | `1rem` |
| `--shadow-panel` | `0 1px 2px rgb(27 31 35 / 0.05), 0 8px 24px -6px rgb(27 31 35 / 0.1)` |
| `--shadow-sheet` | `0 -4px 40px rgb(27 31 35 / 0.18)` |
| `--size-touch` | `2.75rem` |
| `--size-chat` | `22.5rem` |
| `--size-sheet` | `min(24rem, 88vw)` |
| `--size-sidebar` | `15.3125rem` |
| `--size-import-card` | `7.9375rem` |
| `--container-import` | `43.75rem` |
| `--size-sheet-max-h` | `85dvh` |
| `--grid-workspace-tablet` | `minmax(0, 1fr) var(--size-chat)` |
| `--grid-workspace-desk` | `minmax(0, 6fr) minmax(0, 9fr) minmax(0, 5fr)` |
| `--container-reading` | `40rem` |
| `--leading-reading` | `1.95` |
| `--breakpoint-desk` | `75rem` |
| `--text-body--line-height` | `1.5` |
| `--text-hero--line-height` | `1.5` |
| `--text-nav--line-height` | `1.25rem` |
| `--text-label--line-height` | `1.125rem` |
