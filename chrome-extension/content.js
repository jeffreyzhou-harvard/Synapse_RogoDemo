// Synapse — Verify Claims Chrome Extension
// Injects a "Verify" button on every tweet in the X/Twitter feed

const SYNAPSE_URL = 'https://tree-hacks-2026.vercel.app'; // Update to your Vercel URL

function createVerifyButton(tweetUrl) {
  const btn = document.createElement('button');
  btn.className = 'synapse-verify-btn';
  btn.innerHTML = `
    <span class="synapse-pulse"></span>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 12l2 2 4-4"/>
      <circle cx="12" cy="12" r="10"/>
    </svg>
    Verify
  `;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Open Synapse with the tweet URL pre-filled
    window.open(`${SYNAPSE_URL}?url=${encodeURIComponent(tweetUrl)}`, '_blank');
  });
  return btn;
}

function getTweetUrl(tweetEl) {
  // Find the tweet's permalink (timestamp link)
  const timeLink = tweetEl.querySelector('a[href*="/status/"] time');
  if (timeLink) {
    const anchor = timeLink.closest('a');
    if (anchor) {
      const href = anchor.getAttribute('href');
      if (href) return `https://x.com${href}`;
    }
  }
  return null;
}

function injectButtons() {
  // Find all tweet articles that don't already have a Synapse button
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');

  tweets.forEach(tweet => {
    if (tweet.querySelector('.synapse-verify-btn')) return; // Already injected

    const tweetUrl = getTweetUrl(tweet);
    if (!tweetUrl) return;

    // Find the action bar (like, retweet, reply, share row)
    const actionBar = tweet.querySelector('[role="group"]');
    if (!actionBar) return;

    const btn = createVerifyButton(tweetUrl);
    actionBar.appendChild(btn);
  });
}

// Run on page load and observe for new tweets (infinite scroll)
const observer = new MutationObserver(() => {
  injectButtons();
});

// Start observing
function init() {
  injectButtons();
  const timeline = document.querySelector('main') || document.body;
  observer.observe(timeline, { childList: true, subtree: true });
}

// Wait for page to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
