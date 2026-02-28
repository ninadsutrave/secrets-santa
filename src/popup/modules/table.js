/* Table rendering and inline edit for Consul KV values.
   Depends on globalThis.SECRETS_SANTA: TOKEN, ENV, MODALS.
*/
globalThis.SECRETS_SANTA = globalThis.SECRETS_SANTA || {};

(() => {
  let cfg = null;

  function ensureConfig() {
    if (!cfg) throw new Error("TABLE not initialized");
  }

  function isSensitiveKey(key) {
    ensureConfig();
    return cfg.sensitiveRegex.test(key);
  }

  function buildValueActions(key, value, valueContainer, actionsContainer) {
    ensureConfig();
    const { ENV, MODALS, TOKEN } = globalThis.SECRETS_SANTA;
    const textSpan = document.createElement("span");
    textSpan.className = "value-text";

    const sensitive = isSensitiveKey(key);
    const isJSON = ENV.isLikelyJSON(value);
    const truncationLimit = 120;

    let formattedJSON = null;
    if (isJSON) {
      formattedJSON = JSON.stringify(JSON.parse(String(value).trim()), null, 2);
    }

    const valueWrap = document.createElement("div");
    valueWrap.className = "value-wrap";

    const initialText = sensitive
      ? ENV.mask(String(value))
      : isJSON
        ? ENV.truncate(formattedJSON, truncationLimit)
        : ENV.truncate(String(value), truncationLimit);

    textSpan.textContent = initialText;
    if (sensitive) textSpan.classList.add("masked");

    valueWrap.appendChild(textSpan);
    valueContainer.appendChild(valueWrap);

    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "⧉";
    copy.className = "icon-btn value-copy";
    copy.title = "Copy";
    copy.setAttribute("data-tip", "Copy value");
    copy.addEventListener("click", (event) => {
      event.stopPropagation();
      navigator.clipboard.writeText(String(value));
      cfg.setStatus(`Copied ${key}`);
    });
    actionsContainer.appendChild(copy);

    const makeEditor = () => {
      const editor = document.createElement("textarea");
      editor.className = "textarea";
      editor.value = String(value ?? "");
      editor.style.marginTop = "8px";
      const editorActions = document.createElement("div");
      editorActions.style.display = "flex";
      editorActions.style.gap = "6px";
      editorActions.style.marginTop = "6px";
      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn primary";
      saveBtn.textContent = "Save";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn";
      cancelBtn.textContent = "Cancel";
      const container = document.createElement("div");
      container.appendChild(editor);
      editorActions.appendChild(cancelBtn);
      editorActions.appendChild(saveBtn);
      container.appendChild(editorActions);
      return { container, editor, saveBtn, cancelBtn };
    };

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "✎";
    editBtn.className = "icon-btn";
    editBtn.title = "Edit";
    editBtn.setAttribute("data-tip", "Edit value");
    actionsContainer.appendChild(editBtn);

    let editorOpen = false;
    let editorBlock = null;
    const rowEl = valueContainer.closest("tr");

    const closeEditor = () => {
      if (editorBlock) {
        editorBlock.remove();
        editorBlock = null;
      }
      editorOpen = false;
      if (rowEl) rowEl.classList.remove("row-editing");
    };

    editBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (editorOpen) return;
      editorOpen = true;
      const { container, editor, saveBtn, cancelBtn } = makeEditor();
      editorBlock = container;
      valueContainer.appendChild(container);
      if (rowEl) rowEl.classList.add("row-editing");

      cancelBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeEditor();
      });

      saveBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const newValue = String(editor.value ?? "");
        if (newValue === String(value ?? "")) {
          closeEditor();
          return;
        }
        cfg.showLoader(true);
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const tabId = tab?.id;
          if (tabId) {
            const ctx = cfg.getContext();
            const prefixRaw = String(ctx.prefix || "").replace(/^\//, "");
            const prefix = prefixRaw.endsWith("/") ? prefixRaw : `${prefixRaw}/`;
            await TOKEN.ensureTokenAvailable(tabId, ctx.host, ctx.dc, prefix);
            await new Promise((resolve) =>
              chrome.runtime.sendMessage(
                {
                  type: globalThis.SECRETS_SANTA.CONSTANTS.MESSAGE_TYPES.APPLY_ENV,
                  scheme: ctx.scheme,
                  host: ctx.host,
                  dc: ctx.dc,
                  prefix,
                  entries: [{ key, value: newValue }]
                },
                (res) => {
                  cfg.showLoader(false);
                  if (chrome.runtime.lastError || !res || !res.ok) {
                    const msg = String(res?.error || "Failed to update key.");
                    cfg.setStatus(msg);
                    resolve();
                    return;
                  }
                  cfg.onValueSaved(key, newValue);
                  value = newValue;
                  const nowSensitive = isSensitiveKey(key);
                  const nowIsJSON = ENV.isLikelyJSON(newValue);
                  let display = "";
                  if (nowSensitive) {
                    display = ENV.mask(String(newValue));
                    textSpan.classList.add("masked");
                  } else if (nowIsJSON) {
                    const pretty = JSON.stringify(JSON.parse(String(newValue).trim()), null, 2);
                    display = ENV.truncate(pretty, truncationLimit);
                    formattedJSON = pretty;
                    textSpan.classList.remove("masked");
                  } else {
                    display = ENV.truncate(String(newValue), truncationLimit);
                    textSpan.classList.remove("masked");
                  }
                  textSpan.textContent = display;
                  const existingJsonBtn = actionsContainer.querySelector(".json-btn");
                  if (nowIsJSON) {
                    if (!existingJsonBtn) {
                      const jsonBtn = document.createElement("button");
                      jsonBtn.type = "button";
                      jsonBtn.textContent = "⟦⟧";
                      jsonBtn.className = "icon-btn json-btn";
                      jsonBtn.title = "Pretty JSON";
                      jsonBtn.setAttribute("data-tip", "Pretty JSON");
                      jsonBtn.addEventListener("click", (event) => {
                        event.stopPropagation();
                        const prettyNow =
                          formattedJSON || JSON.stringify(JSON.parse(String(newValue).trim()), null, 2);
                        MODALS.openJsonModal(key, prettyNow);
                      });
                      actionsContainer.appendChild(jsonBtn);
                    }
                  } else if (existingJsonBtn) {
                    existingJsonBtn.remove();
                  }
                  cfg.setStatus(`Updated ${key}`);
                  resolve();
                }
              )
            );
          } else {
            cfg.showLoader(false);
            cfg.setStatus("Unable to update key: no active tab.");
          }
        } catch {
          cfg.showLoader(false);
          cfg.setStatus("Failed to update key.");
        } finally {
          closeEditor();
        }
      });
    });

    if (!sensitive && !isJSON && typeof value === "string" && value.length > 120) {
      let expanded = false;
      textSpan.style.cursor = "pointer";
      textSpan.addEventListener("click", () => {
        expanded = !expanded;
        textSpan.textContent = expanded ? value : ENV.truncate(value, 120);
      });
    }

    if (sensitive) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.textContent = "🔒";
      toggle.className = "icon-btn eye";
      toggle.title = "Reveal";
      toggle.setAttribute("data-tip", "Reveal value");
      let visible = false;
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        visible = !visible;
        textSpan.classList.remove("json-view");
        textSpan.textContent = visible ? String(value) : ENV.mask(String(value));
        toggle.textContent = visible ? "🔓" : "🔒";
        toggle.title = visible ? "Hide" : "Reveal";
        toggle.setAttribute("data-tip", visible ? "Hide value" : "Reveal value");
        // Attach/detach JSON prettify on reveal/hide
        const existingJsonBtn = actionsContainer.querySelector(".json-btn");
        if (visible && ENV.isLikelyJSON(String(value))) {
          if (!existingJsonBtn) {
            const jsonBtn = document.createElement("button");
            jsonBtn.type = "button";
            jsonBtn.textContent = "⟦⟧";
            jsonBtn.className = "icon-btn json-btn";
            jsonBtn.title = "Pretty JSON";
            jsonBtn.setAttribute("data-tip", "Pretty JSON");
            jsonBtn.addEventListener("click", (ev) => {
              ev.stopPropagation();
              const prettyNow = JSON.stringify(JSON.parse(String(value).trim()), null, 2);
              MODALS.openJsonModal(key, prettyNow);
            });
            actionsContainer.appendChild(jsonBtn);
          }
        } else if (!visible && existingJsonBtn) {
          existingJsonBtn.remove();
        }
      });
      actionsContainer.appendChild(toggle);
      return;
    }

    if (isJSON) {
      const jsonBtn = document.createElement("button");
      jsonBtn.type = "button";
      jsonBtn.textContent = "⟦⟧";
      jsonBtn.className = "icon-btn json-btn";
      jsonBtn.title = "Pretty JSON";
      jsonBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        MODALS.openJsonModal(key, formattedJSON);
      });
      actionsContainer.appendChild(jsonBtn);
    }
  }

  function renderTable(data, isDiff = false) {
    ensureConfig();
    const { table, tbody, savedList, intellijBtn } = cfg;
    tbody.innerHTML = "";
    cfg.setCurrentView("table");
    if (savedList) savedList.classList.add("hidden");
    if (table) table.classList.remove("hidden");
    cfg.setIsDiffView(isDiff);
    if (intellijBtn) {
      intellijBtn.classList.toggle("hidden", false);
      intellijBtn.disabled = isDiff;
    }
    if (table) {
      const headers = table.querySelectorAll("th");
      if (headers.length >= 3) {
        headers[0].textContent = "Key";
        headers[1].textContent = isDiff
          ? `Values\nA: ${cfg.getDiffLeftTitle() || "—"}\nB: ${cfg.getDiffRightTitle() || "—"}`
          : "Value";
        headers[2].textContent = isDiff ? "Type" : "Actions";
      }
    }
    const entries = Object.entries(data);
    const batchSize = 200;
    let index = 0;
    function renderBatch() {
      const fragment = document.createDocumentFragment();
      const slice = entries.slice(index, index + batchSize);
      slice.forEach(([key, raw]) => {
        const diffType = isDiff ? raw.type : null;
        const row = document.createElement("tr");
        if (diffType) row.classList.add(`diff-${diffType}`);
        const keyCell = document.createElement("td");
        keyCell.textContent = key;
        const valueCell = document.createElement("td");
        const actionsCell = document.createElement("td");
        if (isDiff) {
          const wrap = document.createElement("div");
          wrap.className = "diff-values";
          const appendLine = (label, v) => {
            const line = document.createElement("div");
            line.className = "diff-line";
            const labelEl = document.createElement("div");
            labelEl.className = "diff-label";
            labelEl.textContent = label;
            const lineValue = document.createElement("div");
            lineValue.className = "diff-value";
            const lineActions = document.createElement("div");
            lineActions.className = "diff-actions";
            if (v === undefined) {
              const missingWrap = document.createElement("div");
              missingWrap.className = "value-wrap";
              const missingText = document.createElement("span");
              missingText.className = "value-text";
              missingText.textContent = "—";
              missingWrap.appendChild(missingText);
              lineValue.appendChild(missingWrap);
            } else {
              buildValueActions(key, String(v), lineValue, lineActions);
            }
            line.appendChild(labelEl);
            line.appendChild(lineValue);
            line.appendChild(lineActions);
            wrap.appendChild(line);
          };
          appendLine("A", raw.aValue);
          appendLine("B", raw.bValue);
          valueCell.appendChild(wrap);
          const tag = document.createElement("span");
          tag.className = `diff-tag diff-tag-${diffType || "changed"}`;
          tag.textContent = diffType === "added" ? "ADD" : diffType === "removed" ? "DEL" : "CHG";
          actionsCell.appendChild(tag);
        } else {
          buildValueActions(key, raw, valueCell, actionsCell);
        }
        row.appendChild(keyCell);
        row.appendChild(valueCell);
        row.appendChild(actionsCell);
        fragment.appendChild(row);
      });
      tbody.appendChild(fragment);
      index += batchSize;
      if (index < entries.length) requestAnimationFrame(renderBatch);
    }
    renderBatch();
  }

  function setup(options) {
    cfg = {
      table: options.table,
      tbody: options.tbody,
      savedList: options.savedList,
      intellijBtn: options.intellijBtn,
      setStatus: options.setStatus,
      showLoader: options.showLoader,
      getContext: options.getContext,
      onValueSaved: options.onValueSaved,
      sensitiveRegex: options.SENSITIVE_REGEX,
      setCurrentView: options.setCurrentView,
      setIsDiffView: options.setIsDiffView,
      getDiffLeftTitle: options.getDiffLeftTitle,
      getDiffRightTitle: options.getDiffRightTitle
    };
  }

  globalThis.SECRETS_SANTA.TABLE = { setup, renderTable };
})();
