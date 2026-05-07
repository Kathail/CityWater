interface Props {
  /** screen pixel position to anchor the menu */
  pixelX: number;
  pixelY: number;
  /** lon/lat the menu represents */
  coords: [number, number];
  onAddAsset: (coords: [number, number]) => void;
  onCreateWorkOrder: (coords: [number, number]) => void;
  onCreateServiceRequest: (coords: [number, number]) => void;
  onClose: () => void;
}

export function MapContextMenu({
  pixelX,
  pixelY,
  coords,
  onAddAsset,
  onCreateWorkOrder,
  onCreateServiceRequest,
  onClose,
}: Props) {
  return (
    <ul
      role="menu"
      aria-label="Map actions"
      className="absolute z-20 min-w-44 rounded-md border border-slate-800 bg-slate-900 shadow-lg py-1 text-sm"
      style={{ left: pixelX, top: pixelY }}
      onMouseLeave={onClose}
    >
      <li
        className="px-3 py-1 text-xs text-slate-400 font-mono border-b border-slate-800"
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
          className="w-full text-left px-3 py-1.5 hover:bg-blue-500/10 text-slate-100"
        >
          Add asset here…
        </button>
      </li>
      <li>
        <button
          role="menuitem"
          onClick={() => {
            onCreateWorkOrder(coords);
            onClose();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-blue-500/10 text-slate-100"
        >
          Create work order here…
        </button>
      </li>
      <li>
        <button
          role="menuitem"
          onClick={() => {
            onCreateServiceRequest(coords);
            onClose();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-blue-500/10 text-slate-100"
        >
          Create service request here…
        </button>
      </li>
    </ul>
  );
}
