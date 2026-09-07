/**
 * Tap Trade Player App — Design Tokens
 * ====================================
 * Single source of truth for colors, spacing, typography, and shadows.
 * Import this instead of using inline hex values.
 *
 * Usage:
 *   import { colors, spacing, font, radius, shadow } from '../lib/theme';
 *   style={{ background: colors.surface, padding: spacing.md }}
 */

// ── Brand ──
export const brand = {
  primary: "var(--brand-purple)", // Interactive purple — actions and active states
  primaryHover: "var(--brand-dark)",
  primaryGlow: "var(--accent-glow-color)",
  gradient: "var(--accent-gradient)",
  danger: "var(--no)", // Negative market outcome / NO only
  dangerBg: "var(--no-soft)",
  dangerText: "var(--no-text)",
  success: "var(--yes)", // Positive market outcome / YES only
  successBg: "var(--yes-soft)",
  successBorder: "var(--yes-border)",
  info: "var(--brand-purple)", // Links and interactive information
  warning: "var(--signal-gold)", // Attention, live activity, and priority
} as const;

// ── Surfaces & Backgrounds ──
export const colors = {
  // Legacy names mapped to the cool-neutral interface hierarchy.
  bgDeep: "var(--paper)", // Page canvas
  bgBase: "var(--raised)", // Secondary panels and input wells
  bgSurface: "var(--card)", // Cards and primary content surfaces
  bgElevated: "var(--raised)", // Hover states and table headers
  bgActive: "var(--brand-lavender)", // Selected controls and filters
  bgHover: "var(--raised)", // Generic hover

  // Borders
  border: "var(--hairline)",
  borderHover: "var(--hairline-strong)",

  // Text
  textPrimary: "var(--ink)", // Headings and strong text
  textDefault: "var(--ink-2)", // Body text
  textSecondary: "var(--ink-2)", // Secondary body text
  textMuted: "var(--ink-3)", // Placeholders and captions
  textDim: "var(--inert-label)", // Section labels and disabled text

  // Semantic
  ...brand,
} as const;

// ── Spacing Scale (px) ──
export const spacing = {
  xxs: "2px",
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "20px",
  "2xl": "24px",
  "3xl": "32px",
  "4xl": "40px",
} as const;

// ── Typography ──
export const font = {
  family: "'Switzer', -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "var(--font-mono, ui-monospace, monospace)",

  // Sizes
  xxs: "10px",
  xs: "11px",
  sm: "12px",
  md: "13px",
  base: "14px",
  lg: "16px",
  xl: "18px",
  "2xl": "20px",
  "3xl": "24px",
  "4xl": "28px",
  "5xl": "32px",

  // Weights
  light: "300",
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  extrabold: "800",
  black: "900",
} as const;

// ── Border Radius ──
export const radius = {
  xs: "3px",
  sm: "4px",
  md: "6px",
  lg: "8px",
  xl: "10px",
  "2xl": "12px",
  full: "50%",
  pill: "9999px",
} as const;

// ── Shadows ──
export const shadow = {
  sm: "var(--shadow-card)",
  md: "var(--shadow-card)",
  lg: "var(--shadow-card-hover)",
  glow: "var(--shadow-card)", // Compatibility alias; colored glow is retired
  glowLg: "var(--shadow-card-hover)",
  panel: "var(--shadow-card-hover)",
  panelLg: "var(--shadow-pop)",
} as const;

// ── Transitions ──
export const transition = {
  fast: "all 0.15s ease",
  normal: "all 0.2s ease",
  slow: "all 0.3s ease",
} as const;

// ── Breakpoints ──
export const breakpoint = {
  sm: "640px",
  md: "768px",
  lg: "1024px",
  xl: "1200px",
  "2xl": "1440px",
} as const;

// ── Z-Index Scale ──
export const zIndex = {
  sidebar: 20,
  topbar: 10,
  modal: 50,
  toast: 60,
  overlay: 40,
} as const;

// ── Layout Dimensions ──
export const layout = {
  sidebarWidth: "220px",
  sidebarCollapsed: "60px",
  maxContentWidth: "1440px",
  headerHeight: "56px",
} as const;

// ── Shared Surface Variants ──
export const surface = {
  panel: {
    background: colors.bgSurface,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.xl,
    boxShadow: shadow.panel,
  },
  panelRaised: {
    background: `linear-gradient(180deg, ${colors.bgSurface} 0%, ${colors.bgBase} 100%)`,
    border: `1px solid ${colors.border}`,
    borderRadius: radius["2xl"],
    boxShadow: shadow.panel,
  },
  panelInteractive: {
    background: colors.bgSurface,
    border: `1px solid ${colors.border}`,
    borderRadius: radius["2xl"],
    boxShadow: shadow.md,
    transition: transition.normal,
  },
  heroPanel: {
    background:
      "linear-gradient(135deg, var(--brand-deep) 0%, var(--brand-dark) 58%, var(--brand-purple) 100%)",
    border: "1px solid var(--brand-purple)",
    borderRadius: "18px",
    boxShadow: shadow.panelLg,
  },
  chip: {
    background: "var(--brand-lavender)",
    border: "1px solid var(--brand-purple)",
    borderRadius: "12px",
  },
} as const;

export const text = {
  eyebrow: {
    color: brand.primary,
    fontSize: font.xs,
    fontWeight: font.bold,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: font.xl,
    fontWeight: font.extrabold,
    letterSpacing: "-0.02em",
  },
  sectionBody: {
    color: colors.textSecondary,
    fontSize: font.base,
  },
} as const;

/**
 * Convenience object bundling all tokens for a single import:
 *   import { theme } from '../lib/theme';
 *   style={{ color: theme.colors.textPrimary }}
 */
export const theme = {
  colors,
  brand,
  spacing,
  font,
  radius,
  shadow,
  transition,
  breakpoint,
  zIndex,
  layout,
  surface,
  text,
} as const;

export default theme;
