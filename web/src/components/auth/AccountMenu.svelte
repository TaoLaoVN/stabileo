<script lang="ts">
  import { authStore, getLoginUrl, getProfileUrl } from '../../lib/auth/store.svelte';
  import { t } from '../../lib/i18n';

  let menuOpen = $state(false);
  let menuEl: HTMLDivElement | undefined = $state();

  function toggleMenu() {
    menuOpen = !menuOpen;
  }

  function closeMenu() {
    menuOpen = false;
  }

  function handleWindowClick(e: MouseEvent) {
    if (menuOpen && menuEl && !menuEl.contains(e.target as Node)) closeMenu();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && menuOpen) closeMenu();
  }

  function getInitials(name: string | null | undefined, email: string): string {
    if (name && name.trim()) {
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      return name.slice(0, 2).toUpperCase();
    }
    return email.slice(0, 2).toUpperCase();
  }
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleKeyDown} />

<div class="account-menu" bind:this={menuEl}>
  {#if authStore.loading}
    <div class="auth-loading" title={t('auth.loading')}>
      <span class="auth-spinner"></span>
    </div>
  {:else if !authStore.isAuthenticated}
    <a class="auth-btn login-btn" href={getLoginUrl()} title={t('auth.login')} data-testid="auth-login-btn">
      <span class="auth-mark" aria-hidden="true">ID</span>
      <span class="auth-label">{t('auth.login')}</span>
    </a>
  {:else}
    {@const user = authStore.user!}
    <button
      class="auth-user-btn"
      class:active={menuOpen}
      onclick={toggleMenu}
      aria-expanded={menuOpen}
      aria-haspopup="menu"
      title={user.displayName || user.email}
      data-testid="auth-user-btn"
    >
      <span class="user-avatar">{getInitials(user.displayName, user.email)}</span>
      <span class="user-name">{user.displayName || user.email.split('@')[0]}</span>
      <span class="user-chevron">▾</span>
    </button>

    {#if menuOpen}
      <div class="account-dropdown" role="menu" data-testid="auth-dropdown">
        <div class="dropdown-header">
          <div class="dropdown-avatar">{getInitials(user.displayName, user.email)}</div>
          <div class="dropdown-info">
            <span class="dropdown-name">{user.displayName || user.email.split('@')[0]}</span>
            <span class="dropdown-email">{user.email}</span>
          </div>
        </div>

        <div class="dropdown-divider"></div>

        <a class="dropdown-item" href={getProfileUrl()} target="_blank" rel="noreferrer" role="menuitem">
          <span class="item-code">MS</span>
          <span>{t('auth.vault')}</span>
        </a>

        <div class="dropdown-divider"></div>

        <button class="dropdown-item logout-item" onclick={() => authStore.logout()} role="menuitem">
          <span class="item-code">OUT</span>
          <span>{t('auth.logout')}</span>
        </button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .account-menu {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .auth-loading {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
  }

  .auth-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--st-hair-strong);
    border-top-color: var(--st-accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .auth-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--st-surface-2);
    border: 1px solid var(--st-hair-strong);
    border-radius: var(--st-radius);
    color: var(--st-text);
    font-family: var(--st-sans);
    font-size: 0.78rem;
    font-weight: 500;
    padding: 0.28rem 0.6rem;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    height: 30px;
    box-sizing: border-box;
  }

  .auth-btn:hover {
    background: var(--st-surface-3);
    border-color: var(--st-interactive);
    color: var(--st-value);
  }

  .auth-mark,
  .item-code {
    font-family: var(--st-mono);
    letter-spacing: 0;
    color: var(--st-value);
  }

  .auth-mark {
    font-size: 0.68rem;
    font-weight: 700;
  }

  .auth-user-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--st-surface-2);
    border: 1px solid var(--st-hair-strong);
    border-radius: var(--st-radius);
    color: var(--st-text);
    font-family: var(--st-sans);
    font-size: 0.78rem;
    font-weight: 500;
    padding: 0.2rem 0.5rem;
    cursor: pointer;
    transition: all 0.15s ease;
    height: 30px;
    box-sizing: border-box;
  }

  .auth-user-btn:hover,
  .auth-user-btn.active {
    background: var(--st-surface-3);
    border-color: var(--st-interactive);
  }

  .user-avatar,
  .dropdown-avatar {
    border-radius: 50%;
    background: var(--st-accent);
    color: #fff;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .user-avatar {
    width: 20px;
    height: 20px;
    font-size: 0.65rem;
  }

  .user-name {
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .user-chevron {
    font-size: 0.65rem;
    color: var(--st-text-3);
  }

  .account-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 210;
    width: 220px;
    background: var(--st-surface);
    border: 1px solid var(--st-hair-strong);
    border-radius: var(--st-radius-lg);
    padding: 0.4rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
  }

  .dropdown-header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.4rem;
  }

  .dropdown-avatar {
    width: 32px;
    height: 32px;
    font-size: 0.8rem;
  }

  .dropdown-info {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .dropdown-name {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--st-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dropdown-email {
    font-size: 0.7rem;
    color: var(--st-text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dropdown-divider {
    height: 1px;
    background: var(--st-hair);
    margin: 0.3rem 0;
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.6rem;
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--st-text-2);
    background: transparent;
    border: none;
    border-radius: var(--st-radius);
    text-decoration: none;
    text-align: left;
    cursor: pointer;
    transition: all 0.12s ease;
    width: 100%;
    box-sizing: border-box;
  }

  .dropdown-item:hover {
    background: var(--st-surface-3);
    color: var(--st-text);
  }

  .logout-item:hover {
    background: rgba(233, 69, 96, 0.15);
    color: var(--st-danger);
  }

  .item-code {
    width: 2.1rem;
    font-size: 0.62rem;
    font-weight: 700;
  }

  @media (max-width: 768px) {
    .user-name {
      display: none;
    }
  }
</style>
