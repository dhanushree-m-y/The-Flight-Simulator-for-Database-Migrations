// Stroke icons lifted from the design file (16×16 grid, 1.3 stroke).
import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 17,
  height: 17,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  "aria-hidden": true,
  ...p,
});

export const IconOverview = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="2" y="2" width="5" height="5" rx="1.2" />
    <rect x="9" y="2" width="5" height="5" rx="1.2" />
    <rect x="2" y="9" width="5" height="5" rx="1.2" />
    <rect x="9" y="9" width="5" height="5" rx="1.2" />
  </svg>
);
export const IconRehearsals = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M1 8h3l2-5 3 10 2-5h4" />
  </svg>
);
export const IconApprovals = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 8.5l3 3 7-7" />
  </svg>
);
export const IconDatabases = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <ellipse cx="8" cy="4" rx="5" ry="2" />
    <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
  </svg>
);
export const IconPolicies = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M8 1.5l5 2.5v4c0 3.2-2.4 5.3-5 6.5-2.6-1.2-5-3.3-5-6.5V4z" />
  </svg>
);
export const IconAudit = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 1.5h8v13H4zM6.5 5h3M6.5 8h3M6.5 11h2" />
  </svg>
);
export const IconIntegrations = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M6 1.5v4M10 1.5v4M4 5.5h8v3a4 4 0 01-8 0zM8 12.5v2" />
  </svg>
);
export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
  </svg>
);
export const IconBell = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 16, height: 16, strokeWidth: 1.4, ...p })}>
    <path d="M4 11V7a4 4 0 018 0v4l1.5 1.5h-11zM6.5 14h3" />
  </svg>
);
export const IconMoon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 16, height: 16, strokeWidth: 1.4, ...p })}>
    <path d="M12.5 10A5.5 5.5 0 016 3.5a5.5 5.5 0 106.5 6.5z" />
  </svg>
);
export const IconSun = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 16, height: 16, strokeWidth: 1.4, ...p })}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" />
  </svg>
);
export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 16, height: 16, strokeWidth: 1.5, ...p })}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </svg>
);

export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="13" cy="13" r="11" fill="none" stroke="#D94F87" strokeWidth="1.4" />
      <circle cx="13" cy="13" r="6" fill="none" stroke="#7758C8" strokeWidth="1.4" strokeDasharray="2 2.5" />
      <circle cx="13" cy="13" r="2" fill="#261F29" />
    </svg>
  );
}

/** The five-petal bloom used in hero bands. */
export function Bloom({ x = 0, y = 0, scale = 1 }: { x?: number; y?: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g fill="#FFFFFF">
        {[0, 72, 144, 216, 288].map((r) => (
          <ellipse key={r} cx="0" cy="-10" rx="7.5" ry="10.5" transform={`rotate(${r})`} />
        ))}
      </g>
      <circle r="6" fill="#FFD7E5" />
      <circle r="3" fill="#F0507A" />
    </g>
  );
}
