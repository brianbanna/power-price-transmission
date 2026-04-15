#!/usr/bin/env node

/**
 * Capture milestone 2 screenshots from the live prototype
 * Requires: npm install playwright
 * Run: node scripts/capture_screenshots.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = 'https://com-480-data-visualization.github.io/HSquareB/';
const FIGURES_DIR = path.join(__dirname, '..', 'milestone_2', 'figures');

// Ensure figures directory exists
if (!fs.existsSync(FIGURES_DIR)) {
  fs.mkdirSync(FIGURES_DIR, { recursive: true });
}

async function captureScreenshots() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    console.log('Loading prototype at', URL);
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForLoadState('load');

    // Wait for map to render
    await page.waitForSelector('svg', { timeout: 5000 });

    // Screenshot 1: Step 3 - Scroll to the peak moment
    console.log('📸 Capturing Step 3 (peak moment)...');
    try {
      const step3 = await page.locator('[data-step="2"]').first();
      await step3.scrollIntoViewIfNeeded({ timeout: 5000 });
    } catch (e) {
      // If selector not found, scroll down manually
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    }
    await page.waitForTimeout(800); // Let animations settle
    await page.screenshot({
      path: path.join(FIGURES_DIR, 'fig_02_step3_peak.png'),
      fullPage: false
    });

    // Screenshot 2: Step 4 - Calendar heatmap
    console.log('📸 Capturing Step 4 (heatmap)...');
    try {
      const step4 = await page.locator('[data-step="3"]').first();
      await step4.scrollIntoViewIfNeeded({ timeout: 5000 });
    } catch (e) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    }
    await page.waitForTimeout(800);
    await page.screenshot({
      path: path.join(FIGURES_DIR, 'fig_03_heatmap.png'),
      fullPage: false
    });

    // Screenshot 3: Step 7 - Small multiples
    console.log('📸 Capturing Step 7 (small multiples)...');
    try {
      const step7 = await page.locator('[data-step="6"]').first();
      await step7.scrollIntoViewIfNeeded({ timeout: 5000 });
    } catch (e) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    }
    await page.waitForTimeout(800);
    await page.screenshot({
      path: path.join(FIGURES_DIR, 'fig_05_smallmults.png'),
      fullPage: false
    });

    // Screenshot 4: Explorer - Scroll to explorer section
    console.log('📸 Capturing Explorer...');
    try {
      const explorer = await page.locator('section:nth-of-type(2)').first(); // Try finding explorer section
      await explorer.scrollIntoViewIfNeeded({ timeout: 5000 });
    } catch (e) {
      // Just scroll far down to reach explorer
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 3));
    }
    await page.waitForTimeout(800);
    await page.screenshot({
      path: path.join(FIGURES_DIR, 'fig_06_explorer.png'),
      fullPage: false
    });

    console.log('\n✅ All screenshots captured successfully!');
    console.log('Saved to:', FIGURES_DIR);

  } catch (error) {
    console.error('❌ Error capturing screenshots:', error.message);
    process.exit(1);
  } finally {
    await page.close();
    await browser.close();
  }
}

captureScreenshots();
