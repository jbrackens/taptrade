import React from "react";
import { brand } from "../../../../lib/brand";

type LogoProps = {
  source?: string;
  width?: number;
  height?: number;
  unit?: string;
};

type ComponentProps = {
  theme: LogoProps | string | undefined;
};

const TapTradeOfficeLogo = () => (
  <div className="mr-16 inline-flex items-center gap-2 text-[var(--focus-ring,#0e7a53)]">
    <span className="whitespace-nowrap text-[20px] font-black leading-none tracking-normal">
      {brand.name}
    </span>
    <svg
      aria-hidden="true"
      className="h-4 w-8 overflow-visible"
      viewBox="0 0 40 20"
      fill="none"
    >
      <path
        d="M4 13 L17 8 L27 12 L36 4"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {[4, 17, 27, 36].map((cx, index) => (
        <circle
          key={cx}
          cx={cx}
          cy={[13, 8, 12, 4][index]}
          r="3"
          fill="var(--surface-1,#ffffff)"
          stroke="currentColor"
          strokeWidth="3"
        />
      ))}
    </svg>
  </div>
);

const Logo: React.FC<ComponentProps> = ({ theme }: ComponentProps) => {
  const logoTheme =
    typeof theme === "object" && theme !== null ? theme : undefined;
  const { source, width, height, unit = "px" } = logoTheme || {};
  if (source) {
    const logoStyle = {
      "--office-logo-width": width ? `${width}${unit}` : "100%",
      "--office-logo-height": height ? `${height}${unit}` : "auto",
      "--office-logo-image-max-height": width ? `${width * 0.75}px` : "none",
    } as React.CSSProperties;

    return (
      <div
        className="mr-16 flex h-[var(--office-logo-height)] max-h-full w-[var(--office-logo-width)] items-center justify-center [&_img]:max-h-[var(--office-logo-image-max-height)]"
        style={logoStyle}
      >
        <img src={source} />
      </div>
    );
  }
  return <TapTradeOfficeLogo />;
};

export { Logo };
