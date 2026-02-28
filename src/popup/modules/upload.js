/* Upload module: handles .env/JetBrains uploads with a dry-run summary and apply. */
globalThis.SECRETS_SANTA = globalThis.SECRETS_SANTA || {};

(() => {
  let cfg = null;
  let pending = null;

  /**
   * Initializes the upload module with DOM references and helpers.
   * options:
   * - elements: { uploadModal, uploadModalClose, uploadCancelBtn, uploadConfirmBtn, uploadSummary,
   *               uploadTabEnv, uploadTabJetbrains, uploadPanelEnv, uploadPanelJetbrains,
   *               chooseEnvFileBtn, envFileInput, envFileLabel, jetbrainsPasteInput }
   * - setStatus, showLoader
   * - ENV: utilities for parsing formats
   * - TOKEN: token acquisition helper
   * - CONSTANTS: message types/headers
   * - onApplied(ctx, tabId): callback to reload after apply
   */
  function setup(options) {
    cfg = {
      elements: options.elements,
      setStatus: options.setStatus,
      showLoader: options.showLoader,
      ENV: options.ENV,
      TOKEN: options.TOKEN,
      CONSTANTS: options.CONSTANTS,
      onApplied: options.onApplied
    };
    wire();
  }

  function wire() {
    const el = cfg.elements;
    el.uploadModalClose?.addEventListener("click", close);
    el.uploadCancelBtn?.addEventListener("click", close);
    el.uploadTabEnv?.addEventListener("click", () => setTab("env"));
    el.uploadTabJetbrains?.addEventListener("click", () => setTab("jetbrains"));
    el.chooseEnvFileBtn?.addEventListener("click", () => {
      if (el.envFileInput) el.envFileInput.value = "";
      el.envFileInput?.click();
    });
    el.envFileInput?.addEventListener("change", onFileSelected);
    el.jetbrainsPasteInput?.addEventListener("input", onJetbrainsInput);
    el.uploadConfirmBtn?.addEventListener("click", onConfirm);
  }

  function setOpen(open) {
    const el = cfg.elements;
    if (!el.uploadModal) return;
    el.uploadModal.classList.toggle("hidden", !open);
  }

  function setTab(tab) {
    const el = cfg.elements;
    const isEnv = tab === "env";
    el.uploadTabEnv?.classList.toggle("active", isEnv);
    el.uploadTabEnv?.setAttribute("aria-selected", isEnv ? "true" : "false");
    el.uploadTabJetbrains?.classList.toggle("active", !isEnv);
    el.uploadTabJetbrains?.setAttribute("aria-selected", !isEnv ? "true" : "false");
    el.uploadPanelEnv?.classList.toggle("hidden", !isEnv);
    el.uploadPanelJetbrains?.classList.toggle("hidden", isEnv);
    if (pending) pending.source = isEnv ? "env" : "jetbrains";
  }

  function updateSummary() {
    const el = cfg.elements;
    const ctx = pending?.ctx;
    const count = Number(pending?.entries?.length || 0);
    if (el.uploadConfirmBtn) el.uploadConfirmBtn.disabled = count === 0;
    if (!el.uploadSummary) return;
    if (!ctx) {
      el.uploadSummary.textContent = `${count} keys ready`;
      return;
    }
    el.uploadSummary.textContent = `${count} keys → /${String(ctx.prefix || "").replace(/\/$/, "")}`;
  }

  function onFileSelected() {
    const el = cfg.elements;
    const file = el.envFileInput?.files?.[0];
    if (!file) return;
    if (!pending?.ctx || !pending?.tabId) return;
    file.text().then((text) => {
      const parsed = cfg.ENV.parseDotEnv(text);
      pending.entries = parsed.entries;
      pending.fileName = file.name || "";
      if (el.envFileLabel) {
        const skipped = Number(parsed.skipped || 0);
        const skippedText = skipped ? ` · ${skipped} skipped` : "";
        el.envFileLabel.textContent = `${file.name || "selected"} · ${parsed.entries.length} keys${skippedText}`;
      }
      updateSummary();
    });
  }

  function onJetbrainsInput() {
    const el = cfg.elements;
    if (!pending?.ctx || !pending?.tabId) return;
    const parsed = cfg.ENV.parseJetBrainsPairs(el.jetbrainsPasteInput.value || "");
    pending.entries = parsed.entries;
    updateSummary();
  }

  function onConfirm() {
    const el = cfg.elements;
    const upload = pending;
    const ctx = upload?.ctx;
    const tabId = upload?.tabId;
    const entries = upload?.entries;
    if (!ctx || !tabId || !Array.isArray(entries) || entries.length === 0) return;
    const target = `/${String(ctx.prefix || "").replace(/\/$/, "")}`;
    const ok = confirm(`Upload ${entries.length} keys to ${ctx.host}${target}? This will create/update values.`);
    if (!ok) return;
    cfg.showLoader(true);
    if (el.uploadConfirmBtn) el.uploadConfirmBtn.disabled = true;
    cfg.TOKEN.ensureTokenAvailable(tabId, ctx.host, ctx.dc, ctx.prefix).then(() => {
      chrome.runtime.sendMessage(
        {
          type: cfg.CONSTANTS.MESSAGE_TYPES.APPLY_ENV,
          scheme: ctx.scheme,
          host: ctx.host,
          dc: ctx.dc,
          prefix: ctx.prefix,
          entries
        },
        (res) => {
          cfg.showLoader(false);
          if (el.uploadConfirmBtn) el.uploadConfirmBtn.disabled = false;
          if (chrome.runtime.lastError || !res) {
            cfg.setStatus("Failed to upload key values.");
            return;
          }
          if (!res.ok) {
            cfg.setStatus(String(res.error || "Failed to upload key values."));
            return;
          }
          close();
          cfg.setStatus(`Uploaded ${Number(res.applied || 0)} keys to ${target}`);
          cfg.onApplied(ctx, tabId);
        }
      );
    });
  }

  /**
   * Opens the upload modal for a given context and tab id.
   */
  function open(ctx, tabId) {
    const el = cfg.elements;
    pending = { ctx, tabId, source: "env", entries: [], fileName: "" };
    if (el.envFileInput) el.envFileInput.value = "";
    if (el.envFileLabel) el.envFileLabel.textContent = "No file chosen";
    if (el.jetbrainsPasteInput) el.jetbrainsPasteInput.value = "";
    setTab("env");
    updateSummary();
    setOpen(true);
  }

  /**
   * Closes and clears the modal state.
   */
  function close() {
    pending = null;
    setOpen(false);
  }

  /**
   * Wires the top-level "Upload Key Values" button. Requires:
   * deps: { button, parseConsulContext, hasHostPermission(host) -> Promise<bool>, showHostPermissionPrompt(ctx) }
   */
  function wireOpenButton(button, deps) {
    if (!button) return;
    button.addEventListener("click", async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        cfg.setStatus("Unable to read current tab.");
        return;
      }
      const tabUrl = tab?.url || "";
      const ctx = deps.parseConsulContext(tabUrl);
      if (!ctx) {
        cfg.setStatus("Santa can only help you on a valid Consul page.");
        return;
      }
      const allowed = await deps.hasHostPermission(ctx.host);
      if (!allowed) {
        deps.showHostPermissionPrompt(ctx);
        return;
      }
      open(ctx, tab.id);
    });
  }

  globalThis.SECRETS_SANTA.UPLOAD = { setup, open, close, wireOpenButton };
})();
