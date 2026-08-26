<script lang="ts">
  import { authStore, getAuthApiBaseUrl, getLoginUrl, getProfileUrl } from '../../lib/auth/store.svelte';
  import { t } from '../../lib/i18n';
  import { modelStore } from '../../lib/store';
  import { buildProjectFile, deserializeProject, type DedalFile } from '../../lib/store/file';

  type CloudProject = {
    id: number;
    title: string;
    description: string;
    visibility: 'private' | 'shared' | 'public';
    currentSnapshot: DedalFile;
    createdAt: string;
    updatedAt: string;
  };

  const ACTIVE_PROJECT_KEY = 'mahung-stabileo-active-project-id';

  let menuOpen = $state(false);
  let menuEl: HTMLDivElement | undefined = $state();
  let cloudStatus = $state('');
  let cloudBusy = $state(false);
  let cloudOpen = $state(false);
  let cloudProjects = $state<CloudProject[]>([]);

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

  function activeProjectId(): number | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = Number(localStorage.getItem(ACTIVE_PROJECT_KEY));
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }

  function setActiveProjectId(id: number) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(ACTIVE_PROJECT_KEY, String(id));
  }

  async function cloudFetch(path: string, init: RequestInit = {}) {
    const res = await fetch(`${getAuthApiBaseUrl()}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Không thể kết nối Mahung.Space.');
    return data;
  }

  async function saveProject(forceNew = false) {
    try {
      cloudBusy = true;
      cloudStatus = forceNew ? 'Đang lưu bản mới...' : 'Đang lưu project...';
      const file = buildProjectFile();
      const existingId = forceNew ? null : activeProjectId();
      const payload = {
        title: file.name || modelStore.model.name || 'Project Stabileo',
        description: '',
        visibility: 'private',
        snapshot: file,
      };
      const data = existingId
        ? await cloudFetch(`/api/stabileo/projects/${existingId}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await cloudFetch('/api/stabileo/projects', { method: 'POST', body: JSON.stringify(payload) });
      if (data?.project?.id) setActiveProjectId(data.project.id);
      cloudStatus = existingId ? 'Đã lưu.' : 'Đã tạo project mới.';
    } catch (error: any) {
      cloudStatus = error?.message || 'Lưu thất bại.';
    } finally {
      cloudBusy = false;
    }
  }

  async function loadProjectList() {
    try {
      cloudBusy = true;
      cloudStatus = 'Đang tải danh sách project...';
      const data = await cloudFetch('/api/stabileo/projects');
      cloudProjects = Array.isArray(data?.projects) ? data.projects : [];
      cloudOpen = true;
      cloudStatus = cloudProjects.length ? '' : 'Chưa có project nào được lưu.';
    } catch (error: any) {
      cloudStatus = error?.message || 'Không thể tải project.';
    } finally {
      cloudBusy = false;
    }
  }

  async function openProject(project: CloudProject) {
    try {
      const ok = deserializeProject(JSON.stringify(project.currentSnapshot));
      if (!ok) {
        cloudStatus = 'Snapshot project không hợp lệ.';
        return;
      }
      setActiveProjectId(project.id);
      modelStore.model.name = project.title;
      cloudStatus = `Đã mở ${project.title}.`;
      cloudOpen = false;
    } catch {
      cloudStatus = 'Không thể mở project này.';
    }
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

        <div class="cloud-section" aria-label="Project Stabileo trên Mahung.Space">
          <div class="cloud-title">Project Stabileo</div>
          <div class="cloud-actions">
            <button class="cloud-btn primary" onclick={() => saveProject(false)} disabled={cloudBusy}>Lưu</button>
            <button class="cloud-btn" onclick={() => saveProject(true)} disabled={cloudBusy}>Lưu bản mới</button>
            <button class="cloud-btn" onclick={loadProjectList} disabled={cloudBusy}>Open</button>
          </div>
          {#if cloudStatus}
            <div class="cloud-status">{cloudStatus}</div>
          {/if}
          {#if cloudOpen}
            <div class="cloud-list">
              {#each cloudProjects as project (project.id)}
                <button class="cloud-project" onclick={() => openProject(project)} title={project.title}>
                  <span>{project.title}</span>
                  <small>{new Date(project.updatedAt).toLocaleString('vi-VN')}</small>
                </button>
              {/each}
            </div>
          {/if}
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
    width: 280px;
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

  .cloud-section {
    padding: 0.35rem 0.35rem 0.45rem;
  }

  .cloud-title {
    color: var(--st-text);
    font-size: 0.76rem;
    font-weight: 700;
    margin-bottom: 0.4rem;
  }

  .cloud-actions {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.3rem;
  }

  .cloud-btn {
    border: 1px solid var(--st-hair-strong);
    border-radius: var(--st-radius);
    background: var(--st-surface-2);
    color: var(--st-text-2);
    cursor: pointer;
    font-size: 0.68rem;
    font-weight: 600;
    padding: 0.34rem 0.2rem;
  }

  .cloud-btn.primary {
    border-color: var(--st-accent);
    color: var(--st-value);
  }

  .cloud-btn:hover:not(:disabled) {
    background: var(--st-surface-3);
    color: var(--st-text);
  }

  .cloud-btn:disabled {
    cursor: progress;
    opacity: 0.55;
  }

  .cloud-status {
    color: var(--st-text-3);
    font-size: 0.68rem;
    line-height: 1.35;
    margin-top: 0.45rem;
  }

  .cloud-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.45rem;
    max-height: 190px;
    overflow: auto;
  }

  .cloud-project {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.12rem;
    border: 1px solid var(--st-hair);
    border-radius: var(--st-radius);
    background: transparent;
    color: var(--st-text-2);
    cursor: pointer;
    padding: 0.4rem 0.5rem;
    text-align: left;
  }

  .cloud-project:hover {
    background: var(--st-surface-3);
    color: var(--st-text);
  }

  .cloud-project span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cloud-project small {
    color: var(--st-text-3);
    font-size: 0.62rem;
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
