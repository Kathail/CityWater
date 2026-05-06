export type BasemapId = "osm" | "blank" | "satellite";

export const BASEMAP_OPTIONS: { id: BasemapId; label: string }[] = [
  { id: "osm", label: "OpenStreetMap" },
  { id: "blank", label: "Blank" },
  { id: "satellite", label: "Satellite" },
];
