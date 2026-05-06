import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ExportButton } from "./ExportButton";

function renderButton(initialUrl: string = "/acme/assets") {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <ExportButton />
    </MemoryRouter>,
  );
}

describe("ExportButton", () => {
  it("opens the menu and links to the right URLs with current filters", async () => {
    renderButton("/acme/assets?class=WAT_HYD&status=active");

    await userEvent.click(screen.getByRole("button", { name: /export/i }));
    const csv = screen.getByRole("menuitem", { name: /csv/i }) as HTMLAnchorElement;
    const geo = screen.getByRole("menuitem", { name: /geojson/i }) as HTMLAnchorElement;

    expect(csv.getAttribute("href")).toContain("format=csv");
    expect(csv.getAttribute("href")).toContain("class=WAT_HYD");
    expect(csv.getAttribute("href")).toContain("status=active");
    expect(geo.getAttribute("href")).toContain("format=geojson");
  });

  it("strips filter params when the toggle is off", async () => {
    renderButton("/acme/assets?class=WAT_HYD");
    await userEvent.click(screen.getByRole("button", { name: /export/i }));

    await userEvent.click(screen.getByLabelText(/apply current filters/i));
    const csv = screen.getByRole("menuitem", { name: /csv/i }) as HTMLAnchorElement;
    expect(csv.getAttribute("href")).toContain("format=csv");
    expect(csv.getAttribute("href")).not.toContain("class=");
  });
});
