import { test, expect } from '@playwright/test'

// Use timestamp in emails to avoid conflicts across runs
const ts = Date.now()
const testEmail = `e2e-${ts}@test.local`
const testPassword = 'testpassword123'

test.describe('Authentication', () => {
  test('registers a new account and lands on dashboard', async ({ page }) => {
    await page.goto('/register')
    await page.getByPlaceholder('you@example.com').fill(testEmail)
    await page.getByPlaceholder('••••••••').fill(testPassword)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).toHaveURL('/dashboard')
    await expect(page.getByText('Workspaces')).toBeVisible()
  })

  test('shows an error when registering with an already-taken email', async ({ page }) => {
    await page.goto('/register')
    await page.getByPlaceholder('you@example.com').fill(testEmail)
    await page.getByPlaceholder('••••••••').fill(testPassword)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText(/already registered/i)).toBeVisible()
  })

  test('logs in with valid credentials and lands on dashboard', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder('you@example.com').fill(testEmail)
    await page.getByPlaceholder('••••••••').fill(testPassword)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL('/dashboard')
  })

  test('shows an error when login credentials are wrong', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder('you@example.com').fill(testEmail)
    await page.getByPlaceholder('••••••••').fill('wrongpassword')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText(/invalid/i)).toBeVisible()
  })

  test('logs out and redirects to the home page', async ({ page }) => {
    // Log in first
    await page.goto('/login')
    await page.getByPlaceholder('you@example.com').fill(testEmail)
    await page.getByPlaceholder('••••••••').fill(testPassword)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL('/dashboard')

    // Log out
    await page.getByRole('button', { name: 'Logout' }).click()
    await expect(page).toHaveURL('/')
  })

  test('redirects unauthenticated users from /dashboard to /login', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })
})
