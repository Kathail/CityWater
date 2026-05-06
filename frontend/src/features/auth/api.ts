import { apiJson } from "../../lib/apiClient";

export interface RoleOut {
  code: string;
  name: string;
}

export interface UserOut {
  id: number;
  user_uid: string;
  email: string;
  full_name: string;
  phone: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  roles: RoleOut[];
}

export interface TenantOut {
  id: number;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AuthEnvelope {
  user: UserOut;
  tenant: TenantOut;
}

export interface LoginInput {
  tenant_slug: string;
  email: string;
  password: string;
}

export interface RegisterTenantInput {
  tenant_name: string;
  slug: string;
  admin_email: string;
  admin_password: string;
  full_name: string;
  phone?: string;
}

export function login(input: LoginInput): Promise<AuthEnvelope> {
  return apiJson<AuthEnvelope>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function logout(): Promise<void> {
  return apiJson<void>("/api/v1/auth/logout", { method: "POST" });
}

export function fetchMe(): Promise<AuthEnvelope> {
  return apiJson<AuthEnvelope>("/api/v1/auth/me");
}

export function registerTenant(input: RegisterTenantInput): Promise<AuthEnvelope> {
  return apiJson<AuthEnvelope>("/api/v1/auth/register-tenant", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
