import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TenantShell } from "./TenantShell";

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/acme/"]}>
        <Routes>
          <Route path="/:slug" element={<TenantShell />}>
            <Route index element={<div data-testid="home">home content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TenantShell", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            user: {
              user_uid: "u1",
              email: "a@acme.io",
              full_name: "Alice Admin",
              phone: null,
              is_active: true,
              last_login_at: null,
              created_at: "",
              updated_at: "",
              roles: [{ code: "admin", name: "Administrator" }],
            },
            tenant: {
              id: 1,
              name: "Acme Water",
              slug: "acme",
              settings: {},
              created_at: "",
              updated_at: "",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the tenant header, nav, and outlet content", async () => {
    renderShell();
    await waitFor(() => {
      expect(screen.getByText("Acme Water")).toBeInTheDocument();
    });
    expect(screen.getByText(/Assets/)).toBeInTheDocument();
    expect(screen.getByText(/Home/)).toBeInTheDocument();
    expect(screen.getByTestId("home")).toBeInTheDocument();
    expect(screen.getByText("Alice Admin")).toBeInTheDocument();
  });
});
