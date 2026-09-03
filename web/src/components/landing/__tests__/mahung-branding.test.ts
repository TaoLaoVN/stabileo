import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), 'src');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Mahung.Space public-tool navigation', () => {
  it('keeps the primary navigation focused on usable product information', () => {
    const nav = read('components/landing/LandingNav.svelte');
    expect(nav).toContain("{ id: 'basic', key: 'landing.navBasic' }");
    expect(nav).toContain("{ id: 'codes', key: 'landing.navCodes' }");
    expect(nav).toContain("{ id: 'status', key: 'landing.navStatus' }");
    expect(nav).not.toContain("{ id: 'education'");
    expect(nav).not.toContain("{ id: 'pro'");
    expect(nav).not.toContain("{ id: 'blog'");
  });

  it('shows Mahung.Space ownership and links back to the ecosystem', () => {
    const nav = read('components/landing/LandingNav.svelte');
    const footer = read('components/landing/LandingFooter.svelte');
    expect(nav).toContain("t('landing.ownerLine')");
    expect(nav).toContain('MAHUNG_HOME_URL');
    expect(footer).toContain('MAHUNG_TOOLS_URL');
  });

  it('does not surface duplicate docs, blog, source or third-party chat exits', () => {
    const page = read('components/LandingPage.svelte');
    const cta = read('components/landing/LandingCTA.svelte');
    const validation = read('components/landing/LandingValidation.svelte');
    expect(page).not.toContain('LandingDocs');
    expect(page).not.toContain('LandingBlog');
    expect(page).not.toContain('WhatsappButton');
    expect(cta).not.toContain('REPO_URL');
    expect(validation).not.toContain('fetchGithubStars');
  });
});
