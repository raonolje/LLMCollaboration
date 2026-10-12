// Hidden fixture renderer only. Never loads the product main process, user data or CLI.
const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { mkdirSync } = require('node:fs');
const directory = path.resolve(__dirname, '../work/live-progress-20261012');
mkdirSync(path.join(directory, 'renderer-profile'), { recursive: true });
app.setPath('userData', path.join(directory, 'renderer-profile'));
app.setPath('sessionData', path.join(directory, 'renderer-profile'));
app.disableHardwareAcceleration();
// Keep the test harness alive between viewport windows; only quit after all assertions.
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/i.test(details.url) }));
  const results = [];
  for (const width of [320, 720, 1440]) {
    const window = new BrowserWindow({ width, height: 820, show: false, useContentSize: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await window.loadFile(path.join(directory, 'desktop.html'));
    for (const zoom of [1, 1.5, 2]) {
      window.webContents.setZoomFactor(zoom);
      const result = await window.webContents.executeJavaScript(`(() => {
        const preview = document.querySelector('.activity-preview-text');
        return { viewport: document.documentElement.clientWidth, width: document.documentElement.scrollWidth,
          previewHeight: preview.getBoundingClientRect().height, previewScroll: getComputedStyle(preview).overflowY,
          intermediateLabel: document.body.innerText.includes('중간 메시지 · 최종 답변 아님'),
          counts: document.body.innerText.includes('명령 완료 53') && document.body.innerText.includes('검색 완료 9'),
          terminalHidden: !document.querySelectorAll('.model-activity')[1].querySelector('.activity-progress') };
      })()`);
      results.push({ windowWidth: width, zoom, ...result });
      if (result.width > result.viewport + 1 || result.previewHeight > 151 || result.previewScroll !== 'auto'
        || !result.intermediateLabel || !result.counts || !result.terminalHidden) throw new Error(JSON.stringify(results.at(-1)));
    }
    window.destroy();
  }
  await fs.writeFile(path.join(directory, 'layout-evidence.json'), JSON.stringify(results, null, 2));
  console.log(`PASS: ${results.length} isolated viewport/zoom cases; product app not loaded`);
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
