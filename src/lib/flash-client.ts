import { loadConfig } from "./config.js";

/** HTTP client for the starkbot.cloud (flash) API */
export class FlashClient {
  private baseUrl: string;
  private jwt: string;

  constructor(jwt: string) {
    this.baseUrl = loadConfig().flash_base_url;
    this.jwt = jwt;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.jwt}`,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}/api${path}`;
    const resp = await fetch(url, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      let msg: string;
      try {
        const json = JSON.parse(text);
        msg = json.error || text;
      } catch {
        msg = text || `HTTP ${resp.status}`;
      }
      throw new Error(msg);
    }

    return resp.json() as Promise<T>;
  }

  // ==================== Auth ====================

  /** Get X OAuth authorization URL (for CLI flow) */
  async getAuthUrl(cliRedirect: string): Promise<{ url: string }> {
    const url = `${this.baseUrl}/api/auth/x?cli_redirect=${encodeURIComponent(cliRedirect)}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Failed to get auth URL: ${text}`);
    }
    return resp.json() as Promise<{ url: string }>;
  }

  // ==================== User Info ====================

  async getMe(): Promise<MeResponse> {
    return this.request<MeResponse>("GET", "/me");
  }

  // ==================== Tenant ====================

  async getTenantStatus(): Promise<TenantStatusResponse> {
    return this.request<TenantStatusResponse>("GET", "/tenant/status");
  }

  async provision(): Promise<ProvisionResponse> {
    return this.request<ProvisionResponse>("POST", "/provision", {});
  }

  async getDeploymentStatus(): Promise<DeploymentStatusResponse> {
    return this.request<DeploymentStatusResponse>(
      "GET",
      "/tenant/deployment-status"
    );
  }

  // ==================== Gateway Token ====================

  async getGatewayToken(): Promise<GatewayTokenResponse> {
    return this.request<GatewayTokenResponse>("GET", "/tenant/gateway-token");
  }

  // ==================== Subscription ====================

  async activateSubscription(txHash: string): Promise<{ success: boolean }> {
    return this.request("POST", "/subscription/activate", { tx_hash: txHash });
  }

  // ==================== Instances (Multi-Tenant) ====================

  async listInstances(): Promise<InstanceSummary[]> {
    return this.request<InstanceSummary[]>("GET", "/instances");
  }

  async createInstance(displayName?: string): Promise<MeResponse> {
    return this.request<MeResponse>("POST", "/instances", {
      display_name: displayName ?? null,
    });
  }

  async switchInstance(tenantId: string): Promise<MeResponse> {
    return this.request<MeResponse>("POST", "/instances/switch", {
      tenant_id: tenantId,
    });
  }

  async deleteInstance(): Promise<{ success: boolean }> {
    return this.request("POST", "/tenant/delete");
  }

  // ==================== Vouchers ====================

  async redeemVoucher(code: string): Promise<VoucherRedeemResponse> {
    return this.request("POST", "/voucher/redeem", { code });
  }

  async claimTrial(): Promise<VoucherRedeemResponse> {
    return this.request("POST", "/voucher/claim-trial");
  }
}

// ==================== Response Types ====================

export interface TenantSummary {
  id: string;
  display_name: string | null;
  status: string;
  domain: string | null;
  wallet_address: string;
}

export interface InstanceSummary {
  id: string;
  display_name: string | null;
  status: string;
  domain: string | null;
  wallet_address: string;
  auto_update_enabled: boolean;
  subscription: {
    status: string;
    expires_at: string;
    days_remaining: number;
    is_expiring_soon: boolean;
  } | null;
  credits: {
    balance: number;
    last_active_at: string | null;
  } | null;
}

export interface MeResponse {
  jwt: string;
  user: {
    id: string;
    username: string;
    display_name: string;
    profile_image_url: string | null;
    wallet_address: string;
  };
  tenant: {
    id: string;
    status: string;
    domain: string | null;
    auto_update_enabled: boolean;
    updating: boolean;
  };
  tenants?: TenantSummary[];
  subscription: {
    status: string;
    expires_at: string;
    days_remaining: number;
    is_expiring_soon: boolean;
  } | null;
  premium: {
    status: string;
    expires_at: string | null;
    days_remaining: number | null;
    domain_type: string;
    custom_subdomain: string | null;
    custom_domain: string | null;
  } | null;
  is_new_user: boolean;
  is_admin: boolean;
}

export interface TenantStatusResponse {
  status: string;
  domain: string | null;
  deployment_status?: string;
  needs_reprovision?: boolean;
}

export interface ProvisionResponse {
  success: boolean;
  domain: string;
  status: string;
}

export interface DeploymentStatusResponse {
  status: string;
  ready: boolean;
  domain?: string;
  needs_reprovision?: boolean;
}

export interface GatewayTokenResponse {
  token: string;
  domain: string;
}

export interface VoucherRedeemResponse {
  success: boolean;
  subscription_expires_at?: string;
  message?: string;
}
