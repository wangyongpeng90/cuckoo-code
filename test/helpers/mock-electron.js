'use strict';
const Module = require('module');
const path = require('path');

const fakeElectron = {
  app: {
    getPath: (name) => {
      if (name === 'userData') return path.join(process.cwd(), 'test', 'tmp', 'userData');
      if (name === 'appData') return path.join(process.cwd(), 'test', 'tmp');
      return path.join(process.cwd(), 'test', 'tmp');
    },
    setPath: () => {},
    isPackaged: false,
    whenReady: () => Promise.resolve(),
    on: () => {},
    quit: () => {},
  },
  dialog: {
    showOpenDialogSync: () => null,
    showMessageBox: async () => ({ response: 1 }),
  },
  ipcMain: { handle: () => {}, on: () => {} },
  BrowserWindow: Object.assign(function BrowserWindow() {}, {
    // 测试用：注册 windowId -> fake window，供 AttachFileTool 等通过 fromId 查找
    _registry: new Map(),
    fromId(id) {
      return fakeElectron.BrowserWindow._registry.get(id) || null;
    },
  }),
  Notification: {
    isSupported: () => false,
  },
};

function installElectronMock() {
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return fakeElectron;
    return orig.apply(this, arguments);
  };
  return () => { Module._load = orig; };
}

module.exports = { fakeElectron, installElectronMock };
