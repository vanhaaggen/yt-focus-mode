// Focus Mode - Popup Script

// Get current tab and domain
let currentTab = null;
let currentDomain = null;
let isListVisible = false;
let undoStack = [];

// Initialize popup
document.addEventListener("DOMContentLoaded", async () => {
  await initializePopup();
  setupEventListeners();
  loadUndoStack();
});

async function initializePopup() {
  // Get current tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs[0];

  if (!currentTab) {
    document.getElementById("currentDomain").textContent = "No active tab";
    disableUI();
    return;
  }

  // Check if this is a valid tab for content scripts
  if (!isValidTab(currentTab)) {
    document.getElementById("currentDomain").textContent =
      "Not available on this page";
    disableUI();
    return;
  }

  // Extract domain from URL
  try {
    const url = new URL(currentTab.url);
    currentDomain = url.hostname;
    document.getElementById("currentDomain").textContent = currentDomain;
  } catch (error) {
    document.getElementById("currentDomain").textContent = "Invalid URL";
    console.error("Error parsing URL:", error);
    disableUI();
    return;
  }

  // Load and display hidden count
  updateHiddenCount();
}

// Check if tab supports content scripts
function isValidTab(tab) {
  if (!tab.url) return false;

  const url = tab.url.toLowerCase();

  // Chrome internal pages
  if (url.startsWith("chrome://")) return false;
  if (url.startsWith("chrome-extension://")) return false;
  if (url.startsWith("edge://")) return false;
  if (url.startsWith("about:")) return false;

  // Chrome Web Store
  if (url.includes("chrome.google.com/webstore")) return false;

  // New tab pages
  if (url === "chrome://newtab/") return false;

  return true;
}

// Disable UI for invalid tabs
function disableUI() {
  document.getElementById("startSelectionBtn").disabled = true;
  document.getElementById("viewListBtn").disabled = true;
  document.getElementById("resetSiteBtn").disabled = true;
  document.getElementById("undoBtn").disabled = true;
}

function setupEventListeners() {
  // Clean up any bad selectors that contain 'focus-mode-highlight'
  cleanupBadSelectors();

  // Start Selection Mode
  document
    .getElementById("startSelectionBtn")
    .addEventListener("click", async () => {
      if (!currentTab) {
        showToast("No active tab found", "error");
        return;
      }

      if (!isValidTab(currentTab)) {
        showToast("Cannot use on this page", "warning");
        return;
      }

      try {
        // Send message to content script
        const response = await chrome.tabs.sendMessage(currentTab.id, {
          action: "startSelection",
          timestamp: Date.now(),
        });

        if (response && response.success) {
          console.log("Selection mode started");
          // Close popup so user can interact with page
          window.close();
        }
      } catch (error) {
        console.error("Error starting selection mode:", error);

        // Check if it's a connection error
        if (error.message.includes("Could not establish connection")) {
          showToast("Please reload the page first", "warning");
        } else if (error.message.includes("context invalidated")) {
          showToast("Extension reloaded - refresh page", "warning");
        } else {
          showToast("Error activating selection mode", "error");
        }
      }
    });

  // View List (toggle)
  document.getElementById("viewListBtn").addEventListener("click", () => {
    toggleSelectorsList();
  });

  // Undo Last Hide
  document.getElementById("undoBtn").addEventListener("click", () => {
    undoLastHide();
  });

  // Reset Site
  document.getElementById("resetSiteBtn").addEventListener("click", () => {
    if (confirm(`Reset all hidden elements for ${currentDomain}?`)) {
      resetCurrentSite();
    }
  });

  // Export Settings
  document.getElementById("exportBtn").addEventListener("click", () => {
    exportSettings();
  });

  // Import Settings
  document.getElementById("importBtn").addEventListener("click", () => {
    importSettings();
  });

  // Clear All
  document.getElementById("clearAllBtn").addEventListener("click", () => {
    if (
      confirm(
        "Clear all hidden elements for ALL websites?\n\nThis cannot be undone."
      )
    ) {
      if (
        confirm(
          "Are you absolutely sure? This will clear all your Focus Mode data."
        )
      ) {
        clearAllSites();
      }
    }
  });
}

function updateHiddenCount() {
  if (!currentDomain) {
    document.getElementById("hiddenCount").textContent = "0";
    return;
  }

  chrome.storage.local.get(["hiddenSelectors"], (result) => {
    const hiddenSelectors = result.hiddenSelectors || {};
    const selectorsForDomain = hiddenSelectors[currentDomain] || [];
    document.getElementById("hiddenCount").textContent =
      selectorsForDomain.length;
  });
}

// Toggle selectors list visibility
function toggleSelectorsList() {
  isListVisible = !isListVisible;
  const listElement = document.getElementById("selectorsList");
  const btnText = document.getElementById("viewListBtn");

  if (isListVisible) {
    listElement.style.display = "block";
    btnText.textContent = "Hide List";
    renderSelectorsList();
  } else {
    listElement.style.display = "none";
    btnText.textContent = "View List";
  }
}

// Render the list of selectors with remove buttons
function renderSelectorsList() {
  if (!currentDomain) return;

  chrome.storage.local.get(["hiddenSelectors"], (result) => {
    const hiddenSelectors = result.hiddenSelectors || {};
    const selectorsForDomain = hiddenSelectors[currentDomain] || [];
    const container = document.getElementById("selectorsContainer");

    // Clear container
    container.innerHTML = "";

    if (selectorsForDomain.length === 0) {
      container.innerHTML =
        '<div style="padding:10px; text-align:center; color:#999; font-size:12px;">No hidden elements yet.</div>';
      return;
    }

    // Render each selector
    selectorsForDomain.forEach((entry) => {
      const item = document.createElement("div");
      item.className = "selector-item";

      const text = document.createElement("span");
      text.className = "selector-text";
      text.textContent = entry.label; // Show human-readable label
      text.title = entry.selector; // Show technical selector on hover

      const removeBtn = document.createElement("button");
      removeBtn.className = "btn-remove";
      removeBtn.textContent = "×";
      removeBtn.title = "Remove element";
      removeBtn.addEventListener("click", () => {
        removeSelector(entry.selector);
      });

      item.appendChild(text);
      item.appendChild(removeBtn);
      container.appendChild(item);
    });
  });
}

// Remove a specific selector
function removeSelector(selectorToRemove) {
  if (!currentDomain) return;

  chrome.storage.local.get(["hiddenSelectors"], (result) => {
    const hiddenSelectors = result.hiddenSelectors || {};
    const selectorsForDomain = hiddenSelectors[currentDomain] || [];

    // Remove the selector
    const filtered = selectorsForDomain.filter((item) => item.selector !== selectorToRemove);
    hiddenSelectors[currentDomain] = filtered;

    // Save back to storage
    chrome.storage.local.set({ hiddenSelectors }, () => {
      showToast("Selector removed", "success");
      updateHiddenCount();
      renderSelectorsList();

      // Reload the tab to show the element again
      chrome.tabs.reload(currentTab.id);
    });
  });
}

function resetCurrentSite() {
  if (!currentDomain) return;

  chrome.storage.local.get(["hiddenSelectors", "undoStack"], (result) => {
    const hiddenSelectors = result.hiddenSelectors || {};
    const allUndoStacks = result.undoStack || {};

    // Remove selectors and undo stack for this domain
    delete hiddenSelectors[currentDomain];
    delete allUndoStacks[currentDomain];

    chrome.storage.local.set(
      { hiddenSelectors, undoStack: allUndoStacks },
      () => {
        console.log("Reset site:", currentDomain);
        showToast("Site reset successfully", "success");
        updateHiddenCount();
        updateUndoButton();

        // Reload the current tab to show elements again
        setTimeout(() => {
          chrome.tabs.reload(currentTab.id);
          window.close();
        }, 1000);
      }
    );
  });
}

function exportSettings() {
  chrome.storage.local.get(["hiddenSelectors"], (result) => {
    const data = result.hiddenSelectors || {};

    if (Object.keys(data).length === 0) {
      showToast("No settings to export", "warning");
      return;
    }

    // Create JSON blob
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    // Create download link
    const a = document.createElement("a");
    a.href = url;
    a.download = `focus-mode-settings-${
      new Date().toISOString().split("T")[0]
    }.json`;
    a.click();

    // Cleanup
    URL.revokeObjectURL(url);

    showToast("Settings exported", "success");
  });
}

function importSettings() {
  // Create file input
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";

  input.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);

        // Comprehensive validation
        const validated = validateImportData(imported);
        if (!validated) {
          throw new Error("Import validation failed");
        }

        // Merge with existing settings
        chrome.storage.local.get(["hiddenSelectors"], (result) => {
          const existing = result.hiddenSelectors || {};
          const merged = { ...existing, ...validated };

          chrome.storage.local.set({ hiddenSelectors: merged }, () => {
            const domainCount = Object.keys(validated).length;
            showToast(`Imported ${domainCount} domain(s)`, "success");
            updateHiddenCount();
            if (isListVisible) {
              renderSelectorsList();
            }
          });
        });
      } catch (error) {
        showToast("Import failed: " + error.message, "error");
        console.error("Import error:", error);
      }
    };

    reader.readAsText(file);
  });

  input.click();
}

function clearAllSites() {
  chrome.storage.local.set({ hiddenSelectors: {} }, () => {
    console.log("Cleared all sites");
    updateHiddenCount();
    showToast("All data cleared", "success");

    // Also clear undo stack
    chrome.storage.local.set({ undoStack: {} });
    updateUndoButton();
  });
}

// Toast notification system
function showToast(message, type = "info") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = "toast show";

  if (type) {
    toast.classList.add(type);
  }

  // Auto-hide after 3 seconds
  setTimeout(() => {
    toast.className = "toast";
  }, 3000);
}

// Undo functionality
function loadUndoStack() {
  if (!currentDomain) return;

  chrome.storage.local.get(["undoStack"], (result) => {
    const allUndoStacks = result.undoStack || {};
    undoStack = allUndoStacks[currentDomain] || [];
    updateUndoButton();
  });
}

function saveUndoStack() {
  if (!currentDomain) return;

  chrome.storage.local.get(["undoStack"], (result) => {
    const allUndoStacks = result.undoStack || {};
    allUndoStacks[currentDomain] = undoStack;
    chrome.storage.local.set({ undoStack: allUndoStacks });
  });
}

function addToUndoStack(selector) {
  undoStack.push({
    selector: selector,
    timestamp: Date.now(),
  });

  // Keep only last 10 actions
  if (undoStack.length > 10) {
    undoStack.shift();
  }

  saveUndoStack();
  updateUndoButton();
}

function undoLastHide() {
  if (undoStack.length === 0) return;

  const lastAction = undoStack.pop();
  const selectorToRestore = lastAction.selector;

  // Remove from hidden selectors
  chrome.storage.local.get(["hiddenSelectors"], (result) => {
    const hiddenSelectors = result.hiddenSelectors || {};
    const selectorsForDomain = hiddenSelectors[currentDomain] || [];

    // Remove the selector
    const filtered = selectorsForDomain.filter((item) => item.selector !== selectorToRestore);
    hiddenSelectors[currentDomain] = filtered;

    // Save back to storage
    chrome.storage.local.set({ hiddenSelectors }, () => {
      showToast("Undo successful", "success");
      updateHiddenCount();
      renderSelectorsList();
      saveUndoStack();
      updateUndoButton();

      // Reload the tab to show the element again
      chrome.tabs.reload(currentTab.id);
    });
  });
}

function updateUndoButton() {
  const undoBtn = document.getElementById("undoBtn");
  if (undoStack.length > 0) {
    undoBtn.style.display = "block";
  } else {
    undoBtn.style.display = "none";
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "elementHidden") {
    // Update UI when element is hidden
    updateHiddenCount();
    if (isListVisible) {
      renderSelectorsList();
    }

    // Add to undo stack
    if (message.selector) {
      addToUndoStack(message.selector);
    }

    // Show toast with label if available
    const displayText = message.label || "Element hidden";
    showToast(`Hidden: ${displayText}`, "success");
  }
});

/**
 * Validates imported settings data to prevent malicious content
 * @param {any} data - The imported data to validate
 * @returns {Object|null} Validated data object or null if invalid
 */
function validateImportData(data) {
  // Basic structure validation
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    console.error("[Focus Mode] Invalid import format: must be an object");
    return null;
  }

  const validated = {};
  let totalSelectors = 0;
  const MAX_SELECTORS_TOTAL = 10000;
  const MAX_SELECTORS_PER_DOMAIN = 100;
  const MAX_SELECTOR_LENGTH = 1000;

  for (const [domain, selectors] of Object.entries(data)) {
    // Validate domain name
    if (typeof domain !== "string" || !domain) {
      console.warn(`[Focus Mode] Invalid domain skipped: ${domain}`);
      continue;
    }

    // Domain should look like a valid hostname
    if (!domain.match(/^[a-z0-9.-]+$/i) || domain.length > 253) {
      console.warn(`[Focus Mode] Invalid domain format skipped: ${domain}`);
      continue;
    }

    // Validate selectors array
    if (!Array.isArray(selectors)) {
      console.warn(
        `[Focus Mode] Invalid selectors for ${domain}: not an array`
      );
      continue;
    }

    // Filter and validate each selector
    const validSelectors = [];
    for (const selectorItem of selectors.slice(0, MAX_SELECTORS_PER_DOMAIN)) {
      // Type check - expect object with selector property
      if (typeof selectorItem !== "object" || selectorItem === null) {
        console.warn(`[Focus Mode] Invalid selector format, skipped`);
        continue;
      }

      if (!selectorItem.selector || typeof selectorItem.selector !== "string") {
        console.warn(`[Focus Mode] Missing or invalid selector property, skipped`);
        continue;
      }

      // Length check
      if (selectorItem.selector.length > MAX_SELECTOR_LENGTH) {
        console.warn(
          `[Focus Mode] Selector too long (${selectorItem.selector.length} chars), skipped`
        );
        continue;
      }

      // Check for dangerous patterns
      const dangerousPatterns = [
        "{",
        "}",
        ";",
        "/*",
        "*/",
        "@import",
        "@charset",
        "javascript:",
        "<script",
      ];
      let isDangerous = false;
      for (const pattern of dangerousPatterns) {
        if (selectorItem.selector.includes(pattern)) {
          console.warn(`[Focus Mode] Dangerous selector blocked: ${selectorItem.selector}`);
          isDangerous = true;
          break;
        }
      }

      if (!isDangerous) {
        validSelectors.push({
          selector: selectorItem.selector,
          label: selectorItem.label || selectorItem.selector,
          timestamp: selectorItem.timestamp || Date.now()
        });
      }
    }

    // Add to validated object if we have valid selectors
    if (validSelectors.length > 0) {
      validated[domain] = validSelectors;
      totalSelectors += validSelectors.length;
    }

    // Overall limit check
    if (totalSelectors > MAX_SELECTORS_TOTAL) {
      console.error("[Focus Mode] Import too large, truncating");
      break;
    }
  }

  if (Object.keys(validated).length === 0) {
    console.error("[Focus Mode] No valid data found in import");
    return null;
  }

  console.log(
    `[Focus Mode] Validated ${
      Object.keys(validated).length
    } domains, ${totalSelectors} selectors`
  );
  return validated;
}

// Clean up bad selectors that contain 'focus-mode-highlight'
function cleanupBadSelectors() {
  chrome.storage.local.get(["hiddenSelectors"], (result) => {
    const hiddenSelectors = result.hiddenSelectors || {};
    let cleaned = false;

    // Check all domains
    Object.keys(hiddenSelectors).forEach((domain) => {
      const selectors = hiddenSelectors[domain];
      const cleanedSelectors = selectors.filter((item) => {
        // Remove selectors that contain our highlight class
        if (item.selector && item.selector.includes("focus-mode-highlight")) {
          console.log(`[Focus Mode] Removing bad selector: ${item.selector}`);
          cleaned = true;
          return false;
        }
        return true;
      });

      hiddenSelectors[domain] = cleanedSelectors;
    });

    // Save cleaned selectors if any were removed
    if (cleaned) {
      chrome.storage.local.set({ hiddenSelectors }, () => {
        console.log("[Focus Mode] Bad selectors cleaned up");
        updateHiddenCount();
        if (isListVisible) {
          renderSelectorsList();
        }
      });
    }
  });
}
