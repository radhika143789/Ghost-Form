const { checkDomainWithAPI } = require('./background.js');
const { chrome } = require('jest-chrome');

// Mock the global fetch function
global.fetch = jest.fn();

describe('Background Script API & Caching Logic', () => {
  beforeEach(() => {
    // Clear all mock functions before each test
    jest.clearAllMocks();
    chrome.storage.session.get.mockClear();
    chrome.storage.session.set.mockClear();
    chrome.storage.local.get.mockClear();
  });

  test('Test A: It reads from cache before making an API call', async () => {
    const domain = 'example.com';
    
    // Mock the session cache to return a cache hit ('unsafe')
    chrome.storage.session.get.mockImplementation(() => {
      // Manifest V3 storage APIs return promises if no callback is provided
      return Promise.resolve({ [domain]: 'unsafe' });
    });

    const status = await checkDomainWithAPI(domain);

    // Assertions
    expect(chrome.storage.session.get).toHaveBeenCalledWith([domain]);
    expect(global.fetch).not.toHaveBeenCalled(); // Should NOT call API
    expect(status).toBe('unsafe');
  });

  test('Test B: It safely handles an API network failure (500 error) and falls back to "unknown"', async () => {
    const domain = 'broken-api.com';

    // Mock the session cache to return a cache miss (empty object)
    chrome.storage.session.get.mockImplementation(() => {
      return Promise.resolve({});
    });

    // Mock the session set so it resolves successfully
    chrome.storage.session.set.mockImplementation(() => {
      return Promise.resolve();
    });

    // Mock fetch to simulate a 500 Internal Server Error
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500
    });

    const status = await checkDomainWithAPI(domain);

    // Assertions
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(status).toBe('unknown');
    // Ensure that it actively caches the 'unknown' status to prevent hammering the broken API
    expect(chrome.storage.session.set).toHaveBeenCalledWith({ [domain]: 'unknown' });
  });

  test('Test C: It safely handles network timeouts/exceptions and falls back to "unknown"', async () => {
    const domain = 'timeout-api.com';

    chrome.storage.session.get.mockImplementation(() => Promise.resolve({}));
    chrome.storage.session.set.mockImplementation(() => Promise.resolve());

    // Mock fetch to throw a network error/timeout exception
    global.fetch.mockRejectedValueOnce(new Error('Network timeout'));

    const status = await checkDomainWithAPI(domain);

    // Assertions
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(status).toBe('unknown');
    expect(chrome.storage.session.set).toHaveBeenCalledWith({ [domain]: 'unknown' });
  });
});
