import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LayerPanel } from "./LayerPanel";
import type { TileLayerDescriptor } from "./api";

const FAKE_LAYERS: TileLayerDescriptor[] = [
  {
    id: "assets-wat-hyd",
    class_code: "WAT_HYD",
    domain: "water",
    name: "Hydrant",
    geometry_type: "Point",
    color: "#1e88e5",
    icon: null,
    source: "assets",
    source_layer: "assets",
    filter: ["==", ["get", "class_code"], "WAT_HYD"],
  },
  {
    id: "assets-san-mh",
    class_code: "SAN_MH",
    domain: "sewer",
    name: "Sanitary manhole",
    geometry_type: "Point",
    color: "#6d4c41",
    icon: null,
    source: "assets",
    source_layer: "assets",
    filter: ["==", ["get", "class_code"], "SAN_MH"],
  },
];

describe("LayerPanel", () => {
  it("groups by domain and shows the active classes as checked", () => {
    render(
      <LayerPanel
        layers={FAKE_LAYERS}
        visibleClasses={new Set(["WAT_HYD"])}
        onToggle={() => undefined}
        basemap="osm"
        onBasemapChange={() => undefined}
      />,
    );
    expect(screen.getByRole("region", { name: /water/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /sewer/i })).toBeInTheDocument();
    const hydToggle = screen.getByRole("checkbox", { name: /toggle hydrant/i });
    expect(hydToggle).toBeChecked();
    const mhToggle = screen.getByRole("checkbox", { name: /toggle sanitary manhole/i });
    expect(mhToggle).not.toBeChecked();
  });

  it("calls onToggle with the class_code and new state", async () => {
    const onToggle = vi.fn();
    render(
      <LayerPanel
        layers={FAKE_LAYERS}
        visibleClasses={new Set(["WAT_HYD"])}
        onToggle={onToggle}
        basemap="osm"
        onBasemapChange={() => undefined}
      />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /toggle hydrant/i }));
    expect(onToggle).toHaveBeenCalledWith("WAT_HYD", false);

    await userEvent.click(screen.getByRole("checkbox", { name: /toggle sanitary manhole/i }));
    expect(onToggle).toHaveBeenCalledWith("SAN_MH", true);
  });

  it("changes basemap when select changes", async () => {
    const onBasemapChange = vi.fn();
    render(
      <LayerPanel
        layers={FAKE_LAYERS}
        visibleClasses={new Set()}
        onToggle={() => undefined}
        basemap="osm"
        onBasemapChange={onBasemapChange}
      />,
    );
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /basemap/i }), "blank");
    expect(onBasemapChange).toHaveBeenCalledWith("blank");
  });
});
