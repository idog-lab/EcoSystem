/**
 * SCENE UPLOAD - Google connection (read only).
 *
 * The Scene upload tool (EcoSystem app) reads Google Sheets and the DCX folder
 * through this small web app, the way the economist's other automations do:
 * it runs inside SuperPlay's Google with the permissions of whoever opens it.
 * It only READS - there is no function here that changes a file.
 *
 * Set up once:
 *   1. script.google.com -> New project -> paste this whole file over Code.gs.
 *   2. Deploy -> New deployment -> type "Web app".
 *        Execute as:      User accessing the web app
 *        Who has access:  Anyone within SuperPlay
 *   3. Authorize when asked, copy the Web app URL (ends with /exec) and paste
 *      it in the tool under Links -> "Google connection".
 */

// The pages allowed to ask for data: the app on this computer and the published site.
var ALLOWED_ORIGINS = ['http://localhost:5173', 'https://idog-lab.github.io'];

function doGet(e) {
  // 'frame': hidden inside the tool's page. 'popup': the small window, where Google asks to authorize.
  var mode = e && e.parameter && e.parameter.mode === 'frame' ? 'frame' : 'popup';
  var html =
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'body{font:14px system-ui,sans-serif;color:#334155;margin:16px}b{color:#7c3aed}' +
    '</style></head><body>' +
    '<p><b>Scene upload</b> - Google connection</p>' +
    '<p id="s">Connecting to the tool...</p>' +
    '<p style="font-size:12px;color:#64748b">Read only. Keep this window open while the tool reads; you can close it when you are done.</p>' +
    '<script>' +
    'var ALLOWED=' + JSON.stringify(ALLOWED_ORIGINS) + ';' +
    'var FN={info:"bridgeInfo",values:"bridgeValues",folder:"bridgeFolder"};var calls=0;' +
    'function show(t){document.getElementById("s").textContent=t;}' +
    'window.addEventListener("message",function(e){' +
    '  if(ALLOWED.indexOf(e.origin)<0)return;var m=e.data||{};if(m.type!=="scene-bridge-call"||!FN[m.action])return;' +
    '  calls++;show("Connected - reading ("+calls+")");var src=e.source,origin=e.origin;' +
    '  google.script.run' +
    '    .withSuccessHandler(function(r){src.postMessage({type:"scene-bridge-result",id:m.id,ok:true,result:r},origin);})' +
    '    .withFailureHandler(function(err){src.postMessage({type:"scene-bridge-result",id:m.id,ok:false,error:String(err&&err.message||err)},origin);})' +
    '    [FN[m.action]].apply(null,m.args||[]);' +
    '});' +
    'var MODE=' + JSON.stringify(mode) + ';' +
    'var tool=null;try{tool=MODE==="frame"?window.top:window.top.opener;}catch(e){}' +
    'if(tool){tool.postMessage({type:"scene-bridge-ready",mode:MODE},"*");' +
    '  show("Connected. Keep this window open while the tool reads.");}' +
    'else{show("Authorized. Go back to the Scene upload tool and click Read from Google again.");}' +
    '</script></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('Scene upload - Google connection')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Title and tabs of a spreadsheet. */
function bridgeInfo(id) {
  var ss = SpreadsheetApp.openById(id);
  return {
    title: ss.getName(),
    tabs: ss.getSheets().map(function (s) { return { id: s.getSheetId(), title: s.getName() }; }),
  };
}

/**
 * Values of several ranges, written 'Tab'!A1:H (to the last row of the tab).
 * Numbers stay numbers; dates come back as dd/MM/yyyy.
 */
function bridgeValues(id, ranges) {
  var ss = SpreadsheetApp.openById(id);
  var tz = ss.getSpreadsheetTimeZone();
  return ranges.map(function (a1) {
    var m = /^'((?:[^']|'')*)'!([A-Z]+)(\d+):([A-Z]+)(\d*)$/.exec(a1);
    if (!m) throw new Error('Range not understood: ' + a1);
    var sheet = ss.getSheetByName(m[1].replace(/''/g, "'"));
    if (!sheet) return [];
    var firstRow = Number(m[3]);
    var lastRow = m[5] ? Number(m[5]) : sheet.getLastRow();
    var firstCol = colNumber(m[2]);
    var width = colNumber(m[4]) - firstCol + 1;
    if (lastRow < firstRow) return [];
    var values = sheet.getRange(firstRow, firstCol, lastRow - firstRow + 1, width).getValues();
    for (var r = 0; r < values.length; r++) {
      for (var c = 0; c < values[r].length; c++) {
        var v = values[r][c];
        if (v instanceof Date) values[r][c] = Utilities.formatDate(v, tz, 'dd/MM/yyyy');
      }
    }
    while (values.length && values[values.length - 1].every(function (v) { return v === ''; })) values.pop();
    return values;
  });
}

/** The folders and files directly inside a Drive folder. */
function bridgeFolder(id) {
  var folder = DriveApp.getFolderById(id);
  var out = [];
  var folders = folder.getFolders();
  while (folders.hasNext()) {
    var f = folders.next();
    out.push({ id: f.getId(), name: f.getName(), mimeType: 'application/vnd.google-apps.folder', createdTime: f.getDateCreated().toISOString() });
  }
  var files = folder.getFiles();
  while (files.hasNext()) {
    var g = files.next();
    if (g.isTrashed()) continue;
    out.push({ id: g.getId(), name: g.getName(), mimeType: g.getMimeType(), createdTime: g.getDateCreated().toISOString() });
  }
  return out.sort(function (a, b) { return a.createdTime < b.createdTime ? 1 : -1; });
}

function colNumber(letters) {
  var n = 0;
  for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n;
}
