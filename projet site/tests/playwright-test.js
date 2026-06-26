const { test, expect } = require('@playwright/test');
const path = require('path');

test('flux utilisateur: register -> add product -> sale', async ({ page }) => {
  const indexPath = 'file://' + path.resolve(__dirname, '..', 'index.html');
  await page.goto(indexPath);

  // Register
  await page.fill('#reg-username', 'testuser');
  await page.fill('#reg-password', 'Password123!');
  await page.click('#btn-register');
  // Wait a bit for alert and close it
  page.on('dialog', async dialog => { await dialog.accept(); });

  // Login
  await page.fill('#login-username', 'testuser');
  await page.fill('#login-password', 'Password123!');
  await page.click('#btn-login');

  // Wait for dashboard to appear
  await page.waitForSelector('#dashboard', { state: 'visible' });

  // Add a product
  await page.click('nav button[data-tab="products"]');
  await page.fill('#p-name', 'Test Produit');
  await page.fill('#p-sku', 'TP001');
  await page.fill('#p-price', '1000');
  await page.fill('#p-stock', '10');
  await page.click('#product-form button[type="submit"]');

  // Ensure product is listed
  await page.waitForSelector('#products-table tbody tr');
  const text = await page.textContent('#products-table tbody tr td');
  expect(text).toContain('Test Produit');

  // Make a sale
  await page.click('nav button[data-tab="sales"]');
  await page.waitForSelector('#sale-product');
  await page.selectOption('#sale-product', { label: /Test Produit/ });
  await page.fill('#sale-qty', '2');
  await page.click('#sale-form button[type="submit"]');

  // Check sales table has an entry
  await page.waitForSelector('#sales-table tbody tr');
  const saleRow = await page.textContent('#sales-table tbody tr');
  expect(saleRow).toContain('Test Produit');
});
