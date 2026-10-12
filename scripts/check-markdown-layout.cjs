// Isolated hidden renderer fixture: does not load the product or user data.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { mkdirSync } = require('node:fs');
const directory = path.resolve(__dirname, '../work/fix-verification-20261002');
mkdirSync(path.join(directory, 'renderer-profile'), { recursive: true });
app.setPath('userData', path.join(directory, 'renderer-profile'));
app.setPath('sessionData', path.join(directory, 'renderer-profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const results = [];
  for (const width of [320, 375, 430]) {
    const window = new BrowserWindow({ width, height: 900, show: false, useContentSize: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await window.loadFile(path.join(directory, 'mobile-markdown.html'));
    for (const zoom of [1, 1.25, 1.5, 2]) {
      window.webContents.setZoomFactor(zoom);
      await new Promise((resolve) => setTimeout(resolve, 80));
      const result = await window.webContents.executeJavaScript(`(() => {
        const table = document.querySelector('[aria-label="표 · 좌우 스크롤"]');
        const viewport = document.documentElement.clientWidth;
        const bodyWidth = document.documentElement.scrollWidth;
        return { viewport, bodyWidth, tableWidth: table.getBoundingClientRect().width,
          tableScrollWidth: table.scrollWidth, tableClientWidth: table.clientWidth,
          localScroll: getComputedStyle(table).overflowX === 'auto',
          fullContent: document.body.innerText.includes('마지막 표') && document.body.innerText.includes('여섯 번째도 보존') };
      })()`);
      results.push({ width, zoom, ...result });
      if (result.bodyWidth > result.viewport + 1 || !result.localScroll || !result.fullContent
        || result.tableWidth > result.viewport + 1) throw new Error(`Layout overflow: ${JSON.stringify(results.at(-1))}`);
      if (zoom === 1) await fs.writeFile(path.join(directory, `mobile-${width}.png`), (await window.webContents.capturePage()).toPNG());
    }
    window.destroy();
  }
  await fs.writeFile(path.join(directory, 'layout-evidence.json'), JSON.stringify(results, null, 2));
  console.log(`PASS: ${results.length} isolated renderer viewport/zoom cases`);
  app.quit();
}).catch(async (error) => {
  await fs.writeFile(path.join(directory, 'layout-failure.json'), JSON.stringify({ status: 'unverified', error: String(error) }, null, 2));
  console.error(error); app.exit(1);
});
