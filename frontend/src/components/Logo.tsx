/**
 * Inline SVG of the CityWater favicon. Identical art to
 * `frontend/public/favicon.svg` so the browser tab and the in-app
 * branding match. Inline so it scales cleanly at any size and can be
 * recoloured if needed.
 */
export function Logo({
  size = 24,
  className,
  showBackground = true,
}: {
  size?: number;
  className?: string;
  showBackground?: boolean;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      {showBackground && <rect width="64" height="64" rx="12" fill="#0f172a" />}
      <path
        d="M32 14c-7 9-12 15-12 22a12 12 0 0 0 24 0c0-7-5-13-12-22z"
        fill="#38bdf8"
      />
    </svg>
  );
}
