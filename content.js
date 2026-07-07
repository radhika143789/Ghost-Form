let currentStatus = "safe";
const ignoredSessionKey = `ghost-form-ignore-${window.location.hostname}`;

// Ask background script for status
chrome.runtime.sendMessage(
  { action: "checkStatus", url: window.location.href },
  (response) => {
    if (response && response.status) {
      currentStatus = response.status;
    }
  }
);

// --- Utilities ---
function isIgnored() {
  return sessionStorage.getItem(ignoredSessionKey) === "true";
}

function setIgnored() {
  sessionStorage.setItem(ignoredSessionKey, "true");
  // Remove all active warnings on screen
  document.querySelectorAll(".ghost-form-unsafe-input").forEach(removeWarning);
}

// Luhn Algorithm validation for Credit Cards
function isValidCreditCard(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let isEven = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    isEven = !isEven;
  }
  return sum % 10 === 0;
}

// Debounce function to prevent UI lag on keypress
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// ---------------------------------------------------------------------------
// DOM Sanitizer — safe text extraction for ML model input
// ---------------------------------------------------------------------------

/**
 * Extracts clean, sanitized visible text from the page for ML analysis.
 *
 * Security properties:
 *  - Clones the body to avoid mutating the live DOM.
 *  - Strips <script>, <style>, <noscript>, and <svg> tags entirely.
 *  - Skips elements that are hidden (display:none, visibility:hidden, opacity:0).
 *  - Collapses whitespace to prevent padding attacks.
 *  - HARD CAP: Truncates to 2,000 characters to prevent Memory Exhaustion
 *    DoS attacks where an attacker injects massive amounts of text to
 *    overwhelm the local ONNX embedding model.
 *
 * @param {Element} [root=document.body] - The root element to extract from.
 * @returns {string} Sanitized, truncated plain text.
 */
function safeExtractText(root = document.body) {
  const MAX_CHARS = 2000;

  if (!root) return '';

  // 1. Clone so we can safely mutate without touching the live page
  const clone = root.cloneNode(true);

  // 2. Remove all tags that never contain user-visible text
  const STRIP_TAGS = ['script', 'style', 'noscript', 'svg', 'iframe', 'canvas', 'video', 'audio'];
  STRIP_TAGS.forEach(tag => {
    clone.querySelectorAll(tag).forEach(el => el.remove());
  });

  // 3. Remove visually hidden elements to exclude honeypots and cloaked content
  clone.querySelectorAll('*').forEach(el => {
    try {
      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0' ||
        el.getAttribute('aria-hidden') === 'true' ||
        el.hasAttribute('hidden')
      ) {
        el.remove();
      }
    } catch (_) {
      // Ignore cross-origin or detached element errors
    }
  });

  // 4. Extract raw text and collapse whitespace
  const rawText = (clone.innerText || clone.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();

  // 5. HARD CAP — truncate to prevent ML model memory exhaustion
  return rawText.slice(0, MAX_CHARS);
}

// ---------------------------------------------------------------------------
// ML Page Analysis — fires once on page load (not on every keystroke)
// ---------------------------------------------------------------------------

/**
 * Sends sanitized page text to the background service worker for ML analysis.
 * Uses a one-shot flag to ensure we only run this once per page load,
 * regardless of how many times the content script initializes.
 */
(function triggerMLAnalysis() {
  // Avoid re-running on the same page (e.g., after SPA route changes without full reload)
  if (sessionStorage.getItem(`ghost-form-ml-analyzed-${window.location.hostname}`)) return;
  sessionStorage.setItem(`ghost-form-ml-analyzed-${window.location.hostname}`, '1');

  // Wait for the DOM to be fully painted before extracting text
  const run = () => {
    const sanitizedText = safeExtractText(document.body);
    if (!sanitizedText || sanitizedText.length < 20) return; // Not enough text to be meaningful

    chrome.runtime.sendMessage(
      {
        action: 'ANALYZE_PAGE',
        text: sanitizedText,
        hostname: window.location.hostname,
      },
      (response) => {
        if (chrome.runtime.lastError) return; // Service worker may not be ready yet
        if (response && response.status) {
          currentStatus = response.status;
        }
      }
    );
  };

  // Defer slightly to let the page render its visible content first
  if (document.readyState === 'complete') {
    setTimeout(run, 500);
  } else {
    window.addEventListener('load', () => setTimeout(run, 500), { once: true });
  }
})();

// --- Warning Logic ---
function showWarning(inputElement) {
  if (isIgnored() || inputElement.hasAttribute("data-ghost-form-active")) return;
  
  inputElement.setAttribute("data-ghost-form-active", "true");
  inputElement.classList.add("ghost-form-unsafe-input");

  const warningMsg = document.createElement("div");
  warningMsg.className = "ghost-form-warning-overlay";
  
  const textNode = document.createElement("div");
  textNode.innerText = "Ghost Form: Unverified domain. High risk form detected.";
  warningMsg.appendChild(textNode);

  const ignoreBtn = document.createElement("button");
  ignoreBtn.className = "ghost-form-ignore-btn";
  ignoreBtn.innerText = "Ignore for this session";
  ignoreBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIgnored();
  };
  warningMsg.appendChild(ignoreBtn);
  
  const rect = inputElement.getBoundingClientRect();
  warningMsg.style.top = `${window.scrollY + rect.bottom + 8}px`;
  warningMsg.style.left = `${window.scrollX + rect.left}px`;
  
  document.body.appendChild(warningMsg);
  inputElement.ghostFormWarningElement = warningMsg;
}

function removeWarning(inputElement) {
  inputElement.removeAttribute("data-ghost-form-active");
  inputElement.classList.remove("ghost-form-unsafe-input");
  
  if (inputElement.ghostFormWarningElement) {
    inputElement.ghostFormWarningElement.remove();
    inputElement.ghostFormWarningElement = null;
  }
}

// --- Event Handlers ---
function handleFocus(event) {
  if (isIgnored() || currentStatus === "safe") return;
  
  const target = event.target;
  if (isTargetInput(target)) {
    // Red state: Warn instantly on focus
    if (currentStatus === "unsafe") {
      showWarning(target);
    }
  }
}

function handleBlur(event) {
  const target = event.target;
  if (target && target.hasAttribute && target.hasAttribute("data-ghost-form-active")) {
    removeWarning(target);
  }
}

const debouncedInputCheck = debounce((event) => {
  if (isIgnored() || currentStatus === "safe") return;
  
  const target = event.target;
  if (isTargetInput(target)) {
    const val = target.value || target.innerText || "";
    
    // Check if Password or valid CC
    const isPassword = target.tagName === "INPUT" && target.type.toLowerCase() === "password";
    const isCC = isValidCreditCard(val);
    
    // Yellow state: Trigger warning if high-risk data is typed
    if (isPassword || isCC) {
      showWarning(target);
    }
  }
}, 300);

function isTargetInput(target) {
  if (!target) return false;
  if (target.tagName === "INPUT") {
    const type = target.type.toLowerCase();
    return type === "password" || type === "email" || type === "text" || type === "number" || type === "tel";
  }
  // Support contenteditable forms (Rich Text)
  if (target.getAttribute && target.getAttribute("contenteditable") === "true") {
    return true;
  }
  return false;
}

// Attach listeners to a root element (document or shadow root)
function attachListeners(root) {
  root.addEventListener("focus", handleFocus, true);
  root.addEventListener("blur", handleBlur, true);
  root.addEventListener("input", debouncedInputCheck, true);
}

// --- Initialization & Observers ---

attachListeners(document);

// MutationObserver for dynamically injected forms and shadow DOMs
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.shadowRoot) {
          attachListeners(node.shadowRoot);
        }
        
        // Scan children for shadow DOMs
        const shadowHosts = node.querySelectorAll ? node.querySelectorAll('*') : [];
        shadowHosts.forEach(host => {
          if (host.shadowRoot) {
            attachListeners(host.shadowRoot);
          }
        });
      }
    });
  });
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

// Scan existing DOM for shadow roots on initial load
document.querySelectorAll('*').forEach(node => {
  if (node.shadowRoot) {
    attachListeners(node.shadowRoot);
  }
});
