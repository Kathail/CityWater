interface Props {
  /** screen pixel position to anchor the menu */
  pixelX: number;
  pixelY: number;
  /** lon/lat the menu represents */
  coords: [number, number];
  onAddAsset: (coords: [number, number]) => void;
  onClose: () => void;
}

export function MapContextMenu({ pixelX, pixelY, coords, onAddAsset, onClose }: Props) {
  return (
    <ul
      role="menu"
      aria-label="Map actions"
      className="absolute z-20 min-w-44 rounded-md border border-slate-200 bg-white shadow-lg py-1 text-sm"
      style={{ left: pixelX, top: pixelY }}
      onMouseLeave={onClose}
    >
      <li
        className="px-3 py-1 text-xs text-slate-400 font-mono border-b border-slate-100"
        aria-hidden="true"
      >
        {coords[0].toFixed(5)}, {coords[1].toFixed(5)}
      </li>
      <li>
        <button
          role="menuitem"
          onClick={() => {
            onAddAsset(coords);
            onClose();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-800"
        >
          Add asset here…
        </button>
      </li>
      <li>
        <button
          role="menuitem"
          disabled
          aria-disabled="true"
          title="Coming in Sprint 5"
          className="w-full text-left px-3 py-1.5 text-slate-400 cursor-not-allowed"
        >
          Create work order here…
        </button>
      </li>
      <li>
        <button
          role="menuitem"
          disabled
          aria-disabled="true"
          title="Coming in Sprint 8"
          className="w-full text-left px-3 py-1.5 text-slate-400 cursor-not-allowed"
        >
          Create service request here…
        </button>
      </li>
    </ul>
  );
}
