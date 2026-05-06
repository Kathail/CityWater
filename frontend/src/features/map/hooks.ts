import { useQuery } from "@tanstack/react-query";
import {
  getMapOverlays,
  listTileLayers,
  type MapOverlays,
  type TileLayerDescriptor,
} from "./api";

export function useTileLayers() {
  return useQuery<TileLayerDescriptor[], Error>({
    queryKey: ["tile-layers"],
    queryFn: listTileLayers,
    staleTime: 5 * 60 * 1000,
  });
}

export function useMapOverlays() {
  return useQuery<MapOverlays, Error>({
    queryKey: ["map-overlays"],
    queryFn: getMapOverlays,
    refetchInterval: 60_000,
  });
}
