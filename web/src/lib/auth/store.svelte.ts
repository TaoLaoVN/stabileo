export interface AuthUser {
  id: number;
  email: string;
  displayName: string | null;
  provider?: string;
}

export function getAuthApiBaseUrl(): string {
  if (typeof window === 'undefined') return 'https://mahung.space';
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:3000';
  }
  return 'https://mahung.space';
}

export function getLoginUrl(): string {
  const base = getAuthApiBaseUrl();
  const currentUrl = typeof window !== 'undefined' ? window.location.href : 'https://stabileo.mahung.space/';
  return `${base}/login?return_to=${encodeURIComponent(currentUrl)}`;
}

export function getLogoutUrl(): string {
  const base = getAuthApiBaseUrl();
  const currentUrl = typeof window !== 'undefined' ? window.location.href : 'https://stabileo.mahung.space/';
  return `${base}/api/auth/logout?return_to=${encodeURIComponent(currentUrl)}`;
}

export function getProfileUrl(): string {
  const base = getAuthApiBaseUrl();
  return `${base}/vault`;
}

class AuthStore {
  user = $state<AuthUser | null>(null);
  loading = $state<boolean>(true);
  error = $state<string | null>(null);

  get isAuthenticated(): boolean {
    return this.user !== null;
  }

  async checkAuth(): Promise<AuthUser | null> {
    if (typeof window === 'undefined') {
      this.loading = false;
      return null;
    }

    try {
      this.loading = true;
      this.error = null;
      const apiBase = getAuthApiBaseUrl();
      const res = await fetch(`${apiBase}/api/me`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        credentials: 'include',
      });

      if (!res.ok) {
        this.user = null;
        return null;
      }

      const data = await res.json();
      this.user = data?.user ?? null;
      return this.user;
    } catch (err: any) {
      this.user = null;
      this.error = err?.message || 'Failed to check session';
      return null;
    } finally {
      this.loading = false;
    }
  }

  async logout(): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      const apiBase = getAuthApiBaseUrl();
      await fetch(`${apiBase}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignore network failure on logout
    }
    this.user = null;
    window.location.href = getLogoutUrl();
  }
}

export const authStore = new AuthStore();
