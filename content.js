// Focus Mode - Content Script
// Runs on all web pages

(function() {
  'use strict';

  // ============================================================================
  // CONFIGURATION CONSTANTS
  // ============================================================================

  const CONFIG = {
    // Development mode - set to false for production
    DEBUG_MODE: false, // Toggle this to enable/disable logging

    // Selector validation
    MAX_SELECTOR_LENGTH: 1000,

    // Performance tuning
    MUTATION_DEBOUNCE_MS: 500,
    SELECTOR_APPLY_DELAY_MS: 100,
    PAGE_LOAD_DELAY_MS: 500,

    // Logging limits
    MAX_DETAILED_LOGS: 10,

    // Error handling
    MAX_OBSERVER_ERRORS: 5,

    // Dangerous patterns for selector sanitization
    DANGEROUS_PATTERNS: ['{', '}', ';', '/*', '*/', '@import', '@charset', 'javascript:', '<script']
  };

  // ============================================================================
  // LOGGING UTILITY
  // ============================================================================

  const logger = {
    log: (...args) => {
      if (CONFIG.DEBUG_MODE) {
        console.log('[Focus Mode]', ...args);
      }
    },
    warn: (...args) => {
      if (CONFIG.DEBUG_MODE) {
        console.warn('[Focus Mode]', ...args);
      }
    },
    error: (...args) => {
      // Always log errors, even in production
      console.error('[Focus Mode]', ...args);
    },
    debug: (...args) => {
      if (CONFIG.DEBUG_MODE) {
        console.debug('[Focus Mode]', ...args);
      }
    }
  };

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  let isSelectionModeActive = false;
  let currentHighlightedElement = null;
  let overlayElement = null;
  let extensionInvalidated = false;
  let selectionModeController = null;

  // Performance optimization: Cache validated selectors
  const validatedSelectorsCache = new Map();

  // Observer state
  let observerTimeout = null;
  let observerErrorCount = 0;
  let isObserving = false;

  // Style injection
  let styleElement = null;
  let applyQueue = Promise.resolve();

  // ============================================================================
  // EXTENSION LIFECYCLE MANAGEMENT
  // ============================================================================

  /**
   * Checks if the extension context is still valid
   * @returns {boolean} True if extension is valid, false if invalidated
   */
  function isExtensionValid() {
    if (extensionInvalidated) return false;

    try {
      // Check if chrome.runtime is accessible
      if (!chrome.runtime || !chrome.runtime.id) {
        extensionInvalidated = true;
        handleInvalidExtension();
        return false;
      }
      return true;
    } catch (error) {
      extensionInvalidated = true;
      handleInvalidExtension();
      return false;
    }
  }

  /**
   * Handles extension context invalidation (e.g., after extension reload)
   * Cleans up all resources and notifies user
   */
  function handleInvalidExtension() {
    logger.warn('Extension context invalidated. Please reload the page to reactivate Focus Mode.');

    // Stop the observer
    if (observer) {
      observer.disconnect();
      isObserving = false;
    }

    // Clear all timers
    clearTimeout(observerTimeout);

    // Stop selection mode if active
    if (isSelectionModeActive) {
      stopSelectionMode();
    }

    // Clear cache to free memory
    validatedSelectorsCache.clear();

    // Clear DOM references
    currentHighlightedElement = null;
    overlayElement = null;
    styleElement = null;
  }

  /**
   * Initializes the content script
   */
  function initialize() {
    if (!isExtensionValid()) return;
    logger.log('Content script loaded on:', window.location.hostname);
  }

  // ============================================================================
  // MESSAGE PASSING
  // ============================================================================

  /**
   * Listens for messages from popup or background script
   */
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'startSelection') {
      startSelectionMode();
      sendResponse({ success: true, action: 'selectionStarted' });
    }
    return true;
  });

  // ============================================================================
  // SELECTION MODE
  // ============================================================================

  /**
   * Starts selection mode, allowing user to click elements to hide them
   */
  function startSelectionMode() {
  if (isSelectionModeActive) return;

  isSelectionModeActive = true;
  logger.log('Selection mode activated');

  // Create AbortController for clean event listener management
  selectionModeController = new AbortController();
  const { signal } = selectionModeController;

  // Change cursor to crosshair
  document.body.style.cursor = 'crosshair';

  // Create instruction overlay
  createInstructionOverlay();

  // Add event listeners with AbortSignal for automatic cleanup
  document.addEventListener('mouseover', handleMouseOver, { capture: true, signal });
  document.addEventListener('mouseout', handleMouseOut, { capture: true, signal });
  document.addEventListener('click', handleClick, { capture: true, signal });
  document.addEventListener('keydown', handleKeyDown, { capture: true, signal });
}

  /**
   * Stops selection mode and cleans up all related resources
   */
  function stopSelectionMode() {
  if (!isSelectionModeActive) return;

  isSelectionModeActive = false;
  logger.log('Selection mode deactivated');

  // Abort all event listeners at once using AbortController
  if (selectionModeController) {
    selectionModeController.abort();
    selectionModeController = null;
  }

  // Reset cursor
  if (document.body) {
    document.body.style.cursor = '';
  }

  // Remove highlight
  removeHighlight();

  // Remove overlay and clear reference
  if (overlayElement) {
    try {
      if (overlayElement.parentNode) {
        overlayElement.remove();
      }
    } catch (error) {
      logger.debug('Error removing overlay:', error);
    }
    overlayElement = null;
  }

  // Clear highlighted element reference
  currentHighlightedElement = null;
}

  /**
   * Creates the instruction overlay shown during selection mode
   */
  function createInstructionOverlay() {
  overlayElement = document.createElement('div');
  overlayElement.id = 'focus-mode-overlay';

  // Create header element safely
  const header = document.createElement('div');
  header.className = 'focus-mode-header';
  header.textContent = '🎯 Selection Mode Active';

  // Create instructions element safely
  const instructions = document.createElement('div');
  instructions.className = 'focus-mode-instructions';
  // Use textContent for safety, \n for line breaks
  instructions.textContent = '• Hover over elements to highlight\n• Click to hide element\n• Press ESC to exit';
  // Apply white-space: pre-line to preserve line breaks
  instructions.style.whiteSpace = 'pre-line';

  overlayElement.appendChild(header);
  overlayElement.appendChild(instructions);
  document.body.appendChild(overlayElement);
}

  /**
   * Handles mouseover events during selection mode
   * @param {MouseEvent} event - The mouseover event
   */
  function handleMouseOver(event) {
  if (!isSelectionModeActive) return;

  // Ignore our own overlay
  if (event.target.closest('#focus-mode-overlay')) return;

  event.stopPropagation();

  // Remove previous highlight
  removeHighlight();

  // Highlight current element (use WeakRef to prevent memory leaks)
  const element = event.target;
  currentHighlightedElement = element;
  element.classList.add('focus-mode-highlight');
}

  /**
   * Handles mouseout events during selection mode
   * @param {MouseEvent} event - The mouseout event
   */
  function handleMouseOut(event) {
  if (!isSelectionModeActive) return;

  // Don't remove highlight if we're just moving to a child element
  if (event.target !== currentHighlightedElement) return;
}

  /**
   * Handles click events during selection mode to hide elements
   * @param {MouseEvent} event - The click event
   */
  async function handleClick(event) {
  if (!isSelectionModeActive) return;
  if (event.target.closest('#focus-mode-overlay')) return;

  event.preventDefault();
  event.stopPropagation();

  const element = event.target;

  try {
    // Remove the highlight class temporarily to generate clean selector
    const hadHighlight = element.classList.contains('focus-mode-highlight');
    if (hadHighlight) {
      element.classList.remove('focus-mode-highlight');
    }

    // Generate selector for the element (without highlight class)
    const selector = generateSelector(element);

    // Generate human-readable label for the element
    const label = generateElementLabel(element);

    // Restore highlight if needed (though we're about to hide it anyway)
    if (hadHighlight) {
      element.classList.add('focus-mode-highlight');
    }

    if (selector) {
      // Hide the element immediately (temporary inline style for instant feedback)
      element.style.display = 'none';

      // Save the selector with label
      const saved = await saveHiddenSelector(selector, label);

      if (saved) {
        // Notify popup about the hidden element
        if (isExtensionValid()) {
          try {
            chrome.runtime.sendMessage({
              action: 'elementHidden',
              selector: selector,
              label: label,
              domain: getDomain()
            });
          } catch (error) {
            // Popup might be closed, that's okay
            logger.debug('Could not notify popup:', error.message);
          }
        }

        // Re-apply all selectors using the robust method (style tag with !important)
        // This ensures persistence even if page JavaScript tries to show the element
        setTimeout(() => {
          applyHiddenSelectors();
        }, 100);

        logger.log('✓ Element hidden:', label, '| Selector:', selector);
      } else {
        logger.warn('✗ Failed to save selector');
        // Restore element visibility on save failure
        element.style.display = '';
      }
    } else {
      logger.error('✗ Could not generate selector for element');
    }
  } catch (error) {
    logger.error('✗ Error hiding element:', error);
    // Restore element visibility on error
    element.style.display = '';
  } finally {
    // Remove highlight
    removeHighlight();
  }
}

  /**
   * Handles keyboard events during selection mode (ESC to exit)
   * @param {KeyboardEvent} event - The keydown event
   */
  function handleKeyDown(event) {
  if (!isSelectionModeActive) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    stopSelectionMode();
  }
}

  /**
   * Removes highlight from currently highlighted element
   */
  function removeHighlight() {
  if (currentHighlightedElement) {
    // Check if element still exists in DOM before accessing
    try {
      if (document.contains(currentHighlightedElement)) {
        currentHighlightedElement.classList.remove('focus-mode-highlight');
      }
    } catch (error) {
      // Element was removed from DOM, ignore
      logger.debug('Highlighted element no longer in DOM');
    }
    // Always clear reference to allow garbage collection
    currentHighlightedElement = null;
  }
}

  // ============================================================================
  // SELECTOR GENERATION
  // ============================================================================

  /**
   * Generates a unique CSS selector for the given element
   * Tries multiple strategies in order of reliability
   * @param {HTMLElement} element - The DOM element
   * @returns {string|null} CSS selector or null if generation fails
   */
  function generateSelector(element) {
  // Strategy 1: Check for ID
  if (element.id) {
    const selector = `#${CSS.escape(element.id)}`;
    if (isUnique(selector)) return selector;
  }

  // Strategy 2: Check for data attributes
  const dataTestId = element.getAttribute('data-testid');
  if (dataTestId) {
    const selector = `[data-testid="${dataTestId}"]`;
    if (isUnique(selector)) return selector;
  }

  const dataCy = element.getAttribute('data-cy');
  if (dataCy) {
    const selector = `[data-cy="${dataCy}"]`;
    if (isUnique(selector)) return selector;
  }

  // Strategy 3: Custom element tags (web components)
  if (element.tagName.includes('-')) {
    const selector = element.tagName.toLowerCase();
    if (isUnique(selector)) return selector;
  }

  // Strategy 4: Unique class combination
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(' ').filter(c => c.trim());
    if (classes.length > 0) {
      const selector = classes.map(c => `.${CSS.escape(c)}`).join('');
      if (isUnique(selector)) return selector;
    }
  }

  // Strategy 5: Tag with role or aria-label
  if (element.getAttribute('role')) {
    const selector = `${element.tagName.toLowerCase()}[role="${element.getAttribute('role')}"]`;
    if (isUnique(selector)) return selector;
  }

  if (element.getAttribute('aria-label')) {
    const selector = `${element.tagName.toLowerCase()}[aria-label="${element.getAttribute('aria-label')}"]`;
    if (isUnique(selector)) return selector;
  }

  // Strategy 6: Path from root (last resort)
  return generatePathSelector(element);
}

  /**
   * Checks if a CSS selector matches exactly one element
   * @param {string} selector - The CSS selector to test
   * @returns {boolean} True if selector is unique
   */
  function isUnique(selector) {
  try {
    const elements = document.querySelectorAll(selector);
    return elements.length === 1;
  } catch (error) {
    logger.warn('Invalid selector:', selector);
    return false;
  }
}

  /**
   * Generates a path-based selector from element to body
   * Used as fallback when other strategies fail
   * @param {HTMLElement} element - The DOM element
   * @returns {string} Path-based CSS selector
   */
  function generatePathSelector(element) {
  const path = [];
  let current = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children);
      const sameTagSiblings = siblings.filter(s => s.tagName === current.tagName);

      if (sameTagSiblings.length > 1) {
        const index = sameTagSiblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;
  }

  return 'body > ' + path.join(' > ');
}

  /**
   * Generates a human-readable label for an element
   * Helps users understand what they've hidden in storage
   * @param {HTMLElement} element - The DOM element
   * @returns {string} Human-readable description
   */
  function generateElementLabel(element) {
    // Strategy 1: Use aria-label if available
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) {
      return ariaLabel.trim().substring(0, 100); // Limit length
    }

    // Strategy 2: Use text content if meaningful
    const textContent = element.textContent?.trim();
    if (textContent && textContent.length > 0 && textContent.length < 150) {
      // Clean up whitespace and limit length
      return textContent.replace(/\s+/g, ' ').substring(0, 100);
    }

    // Strategy 3: Use alt text for images
    if (element.tagName === 'IMG') {
      const alt = element.getAttribute('alt');
      if (alt && alt.trim()) {
        return `Image: ${alt.trim().substring(0, 90)}`;
      }
      const src = element.getAttribute('src');
      if (src) {
        const filename = src.split('/').pop()?.split('?')[0];
        if (filename) {
          return `Image: ${filename.substring(0, 90)}`;
        }
      }
      return 'Image';
    }

    // Strategy 4: Use role attribute
    const role = element.getAttribute('role');
    if (role) {
      return `Element with role: ${role}`;
    }

    // Strategy 5: Use placeholder for inputs
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      const placeholder = element.getAttribute('placeholder');
      if (placeholder && placeholder.trim()) {
        return `${element.tagName.toLowerCase()}: ${placeholder.trim().substring(0, 90)}`;
      }
      const type = element.getAttribute('type') || 'text';
      return `${element.tagName.toLowerCase()} (${type})`;
    }

    // Strategy 6: Use title attribute
    const title = element.getAttribute('title');
    if (title && title.trim()) {
      return title.trim().substring(0, 100);
    }

    // Strategy 7: Use ID or class name if somewhat meaningful
    if (element.id && !element.id.match(/^[a-f0-9-]{20,}$/i)) { // Avoid hash-like IDs
      return `#${element.id}`;
    }

    if (element.className && typeof element.className === 'string') {
      const classes = element.className.split(' ').filter(c => c.trim() && !c.match(/^[a-f0-9_-]{15,}$/i));
      if (classes.length > 0 && classes.length <= 3) {
        return classes.slice(0, 2).join(', ');
      }
    }

    // Strategy 8: Fallback to tag name with context
    const tag = element.tagName.toLowerCase();

    // Try to get parent context for better description
    if (element.parentElement) {
      const parentTag = element.parentElement.tagName.toLowerCase();
      const parentId = element.parentElement.id;
      const parentClass = element.parentElement.className;

      if (parentId) {
        return `<${tag}> in #${parentId}`;
      } else if (parentClass && typeof parentClass === 'string') {
        const classes = parentClass.split(' ').filter(c => c.trim());
        if (classes.length > 0) {
          return `<${tag}> in .${classes[0]}`;
        }
      }
      return `<${tag}> in <${parentTag}>`;
    }

    return `<${tag}> element`;
  }

  // ============================================================================
  // STORAGE UTILITIES
  // ============================================================================

  /**
   * Gets the current domain from the page URL
   * @returns {string|null} The hostname or null if invalid
   */
  function getDomain() {
  try {
    const url = new URL(window.location.href);
    return url.hostname;
  } catch (error) {
    logger.error('Error getting domain:', error);
    return null;
  }
}

  /**
   * Sanitizes a CSS selector to prevent injection attacks
   * Uses caching to avoid repeated validation of the same selector
   * @param {string} selector - The CSS selector to sanitize
   * @returns {string|null} Sanitized selector or null if dangerous
   */
  function sanitizeSelector(selector) {
    // Check cache first for performance
    if (validatedSelectorsCache.has(selector)) {
      return validatedSelectorsCache.get(selector);
    }

    // Type check
    if (typeof selector !== 'string' || !selector) {
      validatedSelectorsCache.set(selector, null);
      return null;
    }

    // Length check (reasonable limit)
    if (selector.length > CONFIG.MAX_SELECTOR_LENGTH) {
      logger.warn('Selector too long:', selector.length);
      validatedSelectorsCache.set(selector, null);
      return null;
    }

    // Check for CSS injection patterns
    for (const pattern of CONFIG.DANGEROUS_PATTERNS) {
      if (selector.includes(pattern)) {
        logger.warn('Dangerous pattern detected:', pattern);
        validatedSelectorsCache.set(selector, null);
        return null;
      }
    }

    // Validate it's a valid CSS selector by testing it
    try {
      // Use querySelector instead of querySelectorAll for better performance
      document.querySelector(selector);
      // Cache the valid selector
      validatedSelectorsCache.set(selector, selector);
      return selector;
    } catch (error) {
      logger.warn('Invalid CSS selector:', selector);
      validatedSelectorsCache.set(selector, null);
      return null;
    }
  }

  /**
   * Saves a CSS selector with label to storage for the current domain
   * @param {string} selector - The CSS selector to save
   * @param {string} label - Human-readable description of the element
   * @returns {Promise<boolean>} True if saved successfully, false otherwise
   */
  async function saveHiddenSelector(selector, label = '') {
  if (!isExtensionValid()) {
    logger.warn('Cannot save - extension context invalid');
    return false;
  }

  const domain = getDomain();
  if (!domain) {
    logger.warn('Cannot save - invalid domain');
    return false;
  }

  try {
    const result = await chrome.storage.local.get(['hiddenSelectors']);
    const hiddenSelectors = result.hiddenSelectors || {};

    // Initialize array for this domain if it doesn't exist
    if (!hiddenSelectors[domain]) {
      hiddenSelectors[domain] = [];
    }

    // Create selector entry object
    const selectorEntry = {
      selector: selector,
      label: label || selector,
      timestamp: Date.now()
    };

    // Check if selector already exists
    const exists = hiddenSelectors[domain].some(item => item.selector === selector);

    if (!exists) {
      hiddenSelectors[domain].push(selectorEntry);

      // Save back to storage
      await chrome.storage.local.set({ hiddenSelectors });
      logger.log('✓ Selector saved successfully for', domain);
      return true;
    }

    logger.log('Selector already exists, skipped');
    return false;
  } catch (error) {
    logger.error('✗ Error saving selector:', error);
    if (error.message && error.message.includes('Extension context invalidated')) {
      handleInvalidExtension();
    }
    return false;
  }
}

  /**
   * Loads all CSS selectors for the current domain from storage
   * @returns {Promise<string[]>} Array of CSS selectors
   */
  async function loadHiddenSelectors() {
  if (!isExtensionValid()) {
    return [];
  }

  const domain = getDomain();
  if (!domain) {
    return [];
  }

  try {
    const result = await chrome.storage.local.get(['hiddenSelectors']);
    const hiddenSelectors = result.hiddenSelectors || {};
    const selectorsForDomain = hiddenSelectors[domain] || [];

    // Extract just the selector strings from objects
    return selectorsForDomain.map(item => item.selector);
  } catch (error) {
    logger.error('✗ Error loading selectors:', error);
    if (error.message && error.message.includes('Extension context invalidated')) {
      handleInvalidExtension();
    }
    return [];
  }
}

  /**
   * Clears all selectors for the current domain (unused, kept for API compatibility)
   */
  function clearDomain() {
  const domain = getDomain();
  if (!domain) return;

  chrome.storage.local.get(['hiddenSelectors'], (result) => {
    const hiddenSelectors = result.hiddenSelectors || {};
    delete hiddenSelectors[domain];

    chrome.storage.local.set({ hiddenSelectors }, () => {
      logger.log('Cleared selectors for', domain);
    });
  });
}

  /**
   * Clears all selectors for all domains (unused, kept for API compatibility)
   */
  function clearAll() {
  chrome.storage.local.set({ hiddenSelectors: {} }, () => {
    logger.log('Cleared all selectors');
  });
}

  // ============================================================================
  // SELECTOR APPLICATION
  // ============================================================================

  /**
   * Applies hidden selectors by injecting CSS rules into the page
   * Uses a queue to prevent race conditions from concurrent calls
   * @returns {Promise<void>}
   */
  async function applyHiddenSelectors() {
  if (!isExtensionValid()) return;

  // Queue applications to prevent race conditions
  applyQueue = applyQueue.then(async () => {
    try {
      const selectors = await loadHiddenSelectors();

      if (selectors.length === 0) {
        return;
      }

      logger.log(`Applying ${selectors.length} selector(s) on ${getDomain()}`);

      // Disconnect observer to prevent triggering on our own changes
      if (isObserving) {
        observer.disconnect();
        isObserving = false;
      }

      // Build CSS rules with !important
      let css = '';
      let validCount = 0;

      for (const selector of selectors) {
        try {
          // Sanitize selector before use (cached for performance)
          const sanitized = sanitizeSelector(selector);
          if (!sanitized) {
            logger.warn(`✗ Dangerous selector blocked: ${selector}`);
            continue;
          }

          // Add to CSS with !important to ensure it overrides everything
          css += `${sanitized} { display: none !important; }\n`;
          validCount++;

          // Only count elements for logging (avoid expensive querySelectorAll in production)
          if (validCount <= CONFIG.MAX_DETAILED_LOGS) { // Limit logging for performance
            const elements = document.querySelectorAll(sanitized);
            if (elements.length > 0) {
              logger.log(`✓ Selector "${sanitized}" hiding ${elements.length} element(s)`);
            } else {
              logger.log(`⏳ Selector "${sanitized}" - waiting for elements to load`);
            }
          }
        } catch (error) {
          logger.warn(`✗ Invalid selector: ${selector}`, error);
        }
      }

      if (validCount > CONFIG.MAX_DETAILED_LOGS) {
        logger.log(`✓ Applied ${validCount - CONFIG.MAX_DETAILED_LOGS} additional selector(s)`);
      }

      logger.log(`Applied ${validCount} CSS rules`);

      // If style element exists, just update its content (more efficient)
      if (styleElement && styleElement.parentNode) {
        styleElement.textContent = css;
      } else {
        // Create new style element
        styleElement = document.createElement('style');
        styleElement.id = 'focus-mode-hidden-elements';
        styleElement.setAttribute('data-focus-mode', 'true');
        styleElement.textContent = css;

        // Inject into page (prefer head, fallback to documentElement)
        const target = document.head || document.documentElement;
        if (target) {
          target.appendChild(styleElement);
          logger.log('✓ Style element injected');
        } else {
          logger.error('✗ Could not inject style element');
        }
      }

      // Reconnect observer after a short delay (only if we have selectors to watch for)
      await new Promise(resolve => setTimeout(resolve, CONFIG.SELECTOR_APPLY_DELAY_MS));
      if (selectors.length > 0) {
        startObserver();
      }
    } catch (error) {
      logger.error('✗ Error applying selectors:', error);
      // Continue queue even on error
    }
  });

    return applyQueue;
  }

  // ============================================================================
  // DOM MUTATION OBSERVER
  // ============================================================================

  /**
   * MutationObserver callback for detecting DOM changes
   * Reapplies selectors when new content is added to the page
   */
  const observer = new MutationObserver((mutations) => {
  try {
    // Check if extension is still valid
    if (!isExtensionValid()) {
      observer.disconnect();
      isObserving = false;
      return;
    }

    // Ignore mutations from our own style element
    const isOurChange = mutations.some(mutation => {
      return mutation.target.id === 'focus-mode-hidden-elements' ||
             mutation.target.closest('#focus-mode-hidden-elements') ||
             mutation.target.id === 'focus-mode-overlay' ||
             mutation.target.closest('#focus-mode-overlay');
    });

    if (isOurChange) {
      return; // Don't trigger on our own changes
    }

    // Only trigger if actual nodes were added (not just attribute changes)
    const hasNodeAdditions = mutations.some(mutation => mutation.addedNodes.length > 0);
    if (!hasNodeAdditions) {
      return; // Ignore if no new nodes added
    }

    // Reset error count on successful execution
    observerErrorCount = 0;

    // Debounce the re-application of selectors
    clearTimeout(observerTimeout);
    observerTimeout = setTimeout(() => {
      if (isExtensionValid()) {
        logger.log('DOM changed, reapplying selectors...');
        applyHiddenSelectors();
      }
    }, CONFIG.MUTATION_DEBOUNCE_MS);
  } catch (error) {
    logger.error('✗ Observer error:', error);
    observerErrorCount++;

    // Disconnect on repeated errors to prevent resource drain
    if (observerErrorCount > CONFIG.MAX_OBSERVER_ERRORS) {
      logger.error('✗ Observer disabled due to repeated errors');
      observer.disconnect();
      isObserving = false;
    }
    }
  });

  /**
   * Starts the MutationObserver to watch for DOM changes
   */
  function startObserver() {
  if (isObserving || !document.body) return;

  try {
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    isObserving = true;
    logger.log('✓ MutationObserver started');
  } catch (error) {
    logger.error('✗ Error starting observer:', error);
    }
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Apply hidden selectors when page loads
   */
  function initializeAutoHide() {
    if (!isExtensionValid()) return;

    logger.log('Initializing auto-hide...');

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', async () => {
        if (isExtensionValid()) {
          await applyHiddenSelectors();
          startObserver();
        }
      });
    } else {
      applyHiddenSelectors().then(() => startObserver());
    }

    // Also try to apply on full page load as a safety measure for dynamic sites
    window.addEventListener('load', () => {
      if (isExtensionValid()) {
        // Small delay to let page scripts run first
        setTimeout(() => {
          applyHiddenSelectors();
        }, CONFIG.PAGE_LOAD_DELAY_MS);
      }
    });
  }

  // ============================================================================
  // START EXTENSION
  // ============================================================================

  // Initialize content script
  initialize();

  // Initialize auto-hide functionality
  initializeAutoHide();

})(); // End of IIFE
