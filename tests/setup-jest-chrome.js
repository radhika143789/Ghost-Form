// tests/setup-jest-chrome.js
import { chrome } from 'jest-chrome';

// Add chrome.storage.session mock since it is missing in jest-chrome 0.8.0
if (chrome.storage && !chrome.storage.session) {
  chrome.storage.session = {
    get: jest.fn().mockImplementation(() => Promise.resolve({})),
    set: jest.fn().mockImplementation(() => Promise.resolve()),
    remove: jest.fn().mockImplementation(() => Promise.resolve()),
    clear: jest.fn().mockImplementation(() => Promise.resolve()),
  };
}

Object.defineProperty(global, 'chrome', {
  value: chrome,
  writable: true,
  configurable: true,
});
