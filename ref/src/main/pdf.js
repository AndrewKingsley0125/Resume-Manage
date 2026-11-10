// HTML resume → PDF in a hidden window (same print settings as Resume Manager).
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

async function htmlToPdf(html) {
  const tmp = path.join(app.getPath('temp'), `aa-resume-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`);
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    fs.writeFileSync(tmp, html, 'utf8');
    await pdfWin.loadFile(tmp);
    return await pdfWin.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  } finally {
    if (!pdfWin.isDestroyed()) pdfWin.close();
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  }
}

module.exports = { htmlToPdf };
