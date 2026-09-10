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
    getAppPath: () => path.join(process.cwd(), 'test', 'tmp', 'appPath'),
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
  BrowserWindow: function BrowserWindow() {},
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
