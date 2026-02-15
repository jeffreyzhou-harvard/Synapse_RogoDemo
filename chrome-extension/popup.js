const SYNAPSE_URL = 'https://www.usesynapse.org';

document.getElementById('verifyBtn').addEventListener('click', () => {
  const url = document.getElementById('urlInput').value.trim();
  if (url) {
    window.open(`${SYNAPSE_URL}?url=${encodeURIComponent(url)}`, '_blank');
  }
});

document.getElementById('currentPageBtn').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.url) {
      window.open(`${SYNAPSE_URL}?url=${encodeURIComponent(tabs[0].url)}`, '_blank');
    }
  });
});

// Auto-fill if on a tweet page
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const url = tabs[0]?.url || '';
  if (url.match(/https?:\/\/(x\.com|twitter\.com)\/\w+\/status\/\d+/)) {
    document.getElementById('urlInput').value = url;
  }
});
