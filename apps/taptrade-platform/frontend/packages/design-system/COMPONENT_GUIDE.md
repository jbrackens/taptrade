# Tap Trade UI Design System - Component Guide

> **Status: sportsbook-era, unused.** No package in this workspace imports
> `@taptrade-ui/design-system`; the player app is forbidden from doing so (it
> uses styled-components and hangs webpack) and only carries a tsconfig path
> alias for it. Several components below — `MatchCard`, `OddsButton`,
> `ScoreDisplay` — are sports-betting UI with decimal odds and match scores,
> which the prediction market has no use for. The colours and type scale here
> are the old dark theme, not the current design system: `DESIGN.md` at the repo
> root governs the player app.
>
> The components and tokens described below do still exist in `src/`, so this
> guide is accurate about the package. It is just not guidance to follow for new
> work.

## Quick Start

```tsx
import { ThemeProvider, Button, Card } from "@taptrade-ui/design-system";

function App() {
  return (
    <ThemeProvider>
      <Button variant="primary" size="md">
        Click me
      </Button>
    </ThemeProvider>
  );
}
```

## Component Reference

### Button

- **Variants:** primary, secondary, ghost, danger
- **Sizes:** sm, md, lg
- **Features:** Full HTML button attributes, disabled state, focus styling
- **Usage:** `<Button variant="primary" size="md">Text</Button>`

### Card

- **Features:** Dark background, border, hover state, padding
- **Usage:** `<Card>Content</Card>`

### Badge

- **Variants:** live (pulsing), finished, upcoming, cancelled
- **Features:** Auto-sizing, color-coded status
- **Usage:** `<Badge variant="live">Live</Badge>`

### Input

- **Features:** Dark theme, focus state, error state, full width
- **Props:** `error?: boolean` for error styling
- **Usage:** `<Input placeholder="Type..." error={hasError} />`

### MatchCard

- **Features:** Sports-focused card with scores, status badge, quick-bet odds
- **Props:** homeTeam, awayTeam, homeScore, awayScore, status, odds values
- **Usage:**
  ```tsx
  <MatchCard
    homeTeam="Lakers"
    awayTeam="Celtics"
    homeScore={102}
    awayScore={98}
    status="live"
    homeOdds={1.8}
    drawOdds={3.5}
    awayOdds={2.2}
  />
  ```

### OddsButton

- **Features:** Displays odds with movement indicators (up/down arrows)
- **Props:** odds (number), selected, suspended, movement ('up'|'down'|null)
- **Usage:** `<OddsButton odds={2.5} selected={true} movement="up" />`

### ScoreDisplay

- **Features:** Large score typography with team names and divider
- **Props:** homeTeam, awayTeam, homeScore, awayScore
- **Usage:**
  `<ScoreDisplay homeTeam="Lakers" awayTeam="Celtics" homeScore={102} awayScore={98} />`

### Modal

- **Features:** Overlay modal with header, body, footer sections
- **Props:** isOpen, title, onClose, children, footer
- **Usage:**
  ```tsx
  <Modal isOpen={open} title="Confirm" onClose={() => setOpen(false)}>
    Modal content here
  </Modal>
  ```

### Toast

- **Variants:** success, error, warning, info
- **Features:** Auto-dismiss (default 5s), icon, close button
- **Props:** variant, message, onClose, duration
- **Usage:** `<Toast variant="success" message="Saved!" />`

### Skeleton

- **Features:** Shimmer loading animation
- **Props:** width, height, borderRadius
- **Usage:** `<Skeleton width={200} height={20} />`

### Table

- **Features:** Sortable columns, striped rows, hover state, generic typing
- **Props:** columns, data, striped, onSort, pagination
- **Usage:**
  ```tsx
  <Table
    columns={[
      { key: "name", label: "Name", sortable: true },
      { key: "score", label: "Score", render: (v) => v.toFixed(2) },
    ]}
    data={items}
    striped={true}
  />
  ```

### Tabs

- **Features:** Underline style tabs with accent blue active indicator
- **Props:** tabs (array of {label, content}), defaultTab, onChange
- **Usage:**
  ```tsx
  <Tabs
    tabs={[
      { label: "Tab 1", content: <div>Content 1</div> },
      { label: "Tab 2", content: <div>Content 2</div> },
    ]}
  />
  ```

### Sidebar

- **Features:** Collapsible navigation, active states, icon support
- **Props:** items (array of nav items), onItemClick
- **Usage:**
  ```tsx
  <Sidebar
    items={[
      { id: "sports", label: "Sports", icon: "⚽", active: true },
      { id: "account", label: "Account", icon: "👤" },
    ]}
    onItemClick={(id) => console.log(id)}
  />
  ```

### Header

- **Features:** Logo, navigation menu, search bar, user dropdown menu
- **Props:** logo, logoIcon, navItems, onSearch, onUserMenuClick, userName
- **Usage:**
  ```tsx
  <Header
    logo="Tap Trade"
    logoIcon="🏀"
    navItems={[{ label: "Home", active: true }, { label: "Sports" }]}
    onSearch={(q) => console.log(q)}
  />
  ```

## Design Tokens

### Colors

```typescript
import { colors } from "@taptrade-ui/design-system";

colors.background; // #1a1a2e
colors.surface; // #2d2d44
colors.card; // #4a4a5e
colors.border; // #3d3d5c
colors.text.primary; // #ffffff
colors.text.secondary; // #9a9aad
colors.status.live; // #f5c842
colors.status.finished; // #4cd964
colors.status.error; // #e85a71
colors.accent.green; // #4caf50
colors.accent.blue; // #2196f3
```

### Typography

```typescript
import { typography } from "@taptrade-ui/design-system";

typography.fontFamily; // Barlow
typography.sizes.xlarge; // 56px/64px, bold
typography.sizes.large; // 28px/36px, semibold
typography.sizes.medium; // 18px/24px, medium
typography.sizes.base; // 14px/20px, regular
typography.sizes.small; // 12px/16px, regular
typography.weights.regular; // 400
typography.weights.semibold; // 600
typography.weights.bold; // 700
```

### Spacing

```typescript
import { spacing } from "@taptrade-ui/design-system";

spacing.xs; // 4px
spacing.sm; // 8px
spacing.md; // 16px
spacing.lg; // 24px
spacing.xl; // 32px
```

### Breakpoints

```typescript
import { breakpoints, media } from "@taptrade-ui/design-system";

breakpoints.sm; // 640px
breakpoints.md; // 900px
breakpoints.lg; // 1200px

// Media queries
media.sm; // @media (min-width: 640px)
media.md; // @media (min-width: 900px)
media.lg; // @media (min-width: 1200px)
media.smDown; // @media (max-width: 639px)
```

### Motion

```typescript
import { motion } from "@taptrade-ui/design-system";

motion.fast; // 0.2s ease
motion.pulse; // 2s ease-in-out infinite
```

### Radius

```typescript
import { radius } from "@taptrade-ui/design-system";

radius.sm; // 8px
radius.md; // 12px
radius.lg; // 16px
radius.full; // 9999px
```

## Tailwind Composition

```typescript
import { Card } from '@taptrade-ui/design-system';

<Card className="bg-[#2d2d44] p-6 max-[899px]:p-4">
  Custom content
</Card>
```

## TypeScript Support

All components are fully typed with TypeScript. Import types for prop
interfaces:

```typescript
import { Button } from '@taptrade-ui/design-system';

// Component accepts ButtonHTMLAttributes plus variant/size props
<Button variant="primary" size="lg" disabled={false} />
```

## Dark Theme

The design system includes a pre-configured dark theme based on the
MG-live-score-app design specification. The theme is automatically applied via
the `ThemeProvider` component.

## Contributing

When adding new components:

1. Create the component in `src/components/`
2. Use Tailwind utility classes through `className`
3. Export from `src/components/index.ts`
4. Re-export from `src/index.ts`
5. Add TypeScript types for all props
6. Use forwardRef for components that need ref access
