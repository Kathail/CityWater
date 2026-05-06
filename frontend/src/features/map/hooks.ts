import { useQuery } from "@tanstack/react-query";
import { listTileLayers, type TileLayerDescriptor } from "./api";

export function useTileLayers() {
  return useQuery<TileLayerDescriptor[], Error>({
    queryKey: ["tile-layers"],
    queryFn: listTileLayers,
    staleTime: 5 * 60 * 1000,
  });
}
