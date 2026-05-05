import { useQuery } from "@tanstack/react-query";
import {
  type AssetClassOut,
  type AssetListParams,
  type AssetListResponse,
  type AssetOut,
  getAsset,
  listAssetClasses,
  listAssets,
} from "./api";

export function useAssetClasses() {
  return useQuery<AssetClassOut[], Error>({
    queryKey: ["asset-classes"],
    queryFn: listAssetClasses,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAssets(params: AssetListParams) {
  return useQuery<AssetListResponse, Error>({
    queryKey: ["assets", params],
    queryFn: () => listAssets(params),
    placeholderData: (prev) => prev,
  });
}

export function useAsset(asset_uid: string | undefined) {
  return useQuery<AssetOut, Error>({
    queryKey: ["asset", asset_uid],
    queryFn: () => getAsset(asset_uid!),
    enabled: !!asset_uid,
  });
}
