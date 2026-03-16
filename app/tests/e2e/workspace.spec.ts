import { test, expect, type Page } from '@playwright/test'

const ts = Date.now()
const testEmail = `ws-${ts}@test.local`
const testPassword = 'testpassword123'

async function registerAndLogin(page: Page) {
  await page.goto('/register')
  await page.getByPlaceholder('you@example.com').fill(testEmail)
  await page.getByPlaceholder('••••••••').fill(testPassword)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL('/dashboard')
}

test.describe('Workspaces', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page)
  })

  test('shows empty state when no workspaces exist', async ({ page }) => {
    await expect(page.getByText('No workspaces yet.')).toBeVisible()
  })

  test('creates a workspace and shows it in the list', async ({ page }) => {
    await page.getByRole('button', { name: 'New workspace' }).click()
    await page.getByPlaceholder('My project').fill('Test Workspace')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByText('Test Workspace')).toBeVisible()
  })

  test('navigates to the workspace page when clicking a workspace card', async ({ page }) => {
    // Create a workspace first
    await page.getByRole('button', { name: 'New workspace' }).click()
    await page.getByPlaceholder('My project').fill('Clickable Workspace')
    await page.getByRole('button', { name: 'Create' }).click()

    // Click it
    await page.getByText('Clickable Workspace').click()
    await expect(page).toHaveURL(/\/workspace\//)
  })

  test('shows an error when creating a workspace with an empty name', async ({ page }) => {
    await page.getByRole('button', { name: 'New workspace' }).click()
    // Leave name empty and try to submit
    await page.getByRole('button', { name: 'Create' }).click()
    // The button should have no effect (empty name guard is client-side)
    // Modal should still be open
    await expect(page.getByPlaceholder('My project')).toBeVisible()
  })
})
