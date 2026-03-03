/* Compare module: build diffs and render a picker to choose two collections.
   Also wires the top-level Compare button with provided helpers. */
globalThis.SECRETS_SANTA = globalThis.SECRETS_SANTA || {};

(() => {
  let cfg = null;
  let state = {
    pickerOpen: false,
    selectedIds: []
  };

  /**
   * Initializes compare module.
   * options:
   * - savedList: list element to render the picker
   * - setStatus, setPostLoadVisible, setCompareVisible, showSearch
   * - setCurrentView(view), setIsDiffView(bool)
   * - get/set diff titles: setDiffTitles(a, b), getDiffLeftTitle(), getDiffRightTitle()
   * - TABLE: table module to render diffs
   */
  function setup(options) {
    cfg = {
      savedList: options.savedList,
      table: options.table,
      intellijBtn: options.intellijBtn,
      setStatus: options.setStatus,
      setPostLoadVisible: options.setPostLoadVisible,
      setCompareVisible: options.setCompareVisible,
      showSearch: options.showSearch,
      setCurrentView: options.setCurrentView,
      setIsDiffView: options.setIsDiffView,
      setDiffTitles: options.setDiffTitles,
      getDiffLeftTitle: options.getDiffLeftTitle,
      getDiffRightTitle: options.getDiffRightTitle,
      TABLE: options.TABLE,
      setPickerOpen: options.setPickerOpen
    };
  }

  /**
   * Pure function to build a diff map of keys between A and B.
   */
  function buildDiff(aKeys, bKeys) {
    const a = aKeys || {};
    const b = bKeys || {};
    const diff = {};
    for (const key in b) {
      if (!(key in a)) {
        diff[key] = { aValue: undefined, bValue: b[key], type: "added" };
      } else if (a[key] !== b[key]) {
        diff[key] = { aValue: a[key], bValue: b[key], type: "changed" };
      }
    }
    for (const key in a) {
      if (!(key in b)) {
        diff[key] = { aValue: a[key], bValue: undefined, type: "removed" };
      }
    }
    return diff;
  }

  /**
   * Renders the picker UI to choose two collections (A then B) and shows the diff.
   */
  function renderPicker(collections, getSelectedIds, setSelectedIds) {
    const { savedList, TABLE, table, intellijBtn } = cfg;
    if (!savedList) return;
    savedList.innerHTML = "";
    cfg.setCurrentView("list");
    savedList.classList.remove("hidden");
    if (table) table.classList.add("hidden");
    if (intellijBtn) {
      intellijBtn.classList.remove("hidden");
      intellijBtn.disabled = true;
    }

    const fragment = document.createDocumentFragment();
    const selected = getSelectedIds();

    collections
      .slice()
      .sort((a, b) => ((b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)))
      .forEach((collection) => {
        const item = document.createElement("li");
        item.className = "saved-item";
        item.dataset.key = (collection.title || "").toLowerCase();

        const textWrap = document.createElement("div");
        const titleSpan = document.createElement("div");
        titleSpan.className = "saved-title";
        titleSpan.textContent = collection.title || "Collection";
        const count = Object.keys(collection.keys || {}).length;
        const metaSpan = document.createElement("div");
        metaSpan.className = "saved-meta";
        metaSpan.textContent = `${count} keys`;
        textWrap.appendChild(titleSpan);
        textWrap.appendChild(metaSpan);

        const actions = document.createElement("div");
        actions.className = "saved-actions";
        const checkbox = document.createElement("span");
        checkbox.className = "saved-delete";
        const idx = selected.indexOf(collection.id);
        checkbox.textContent = idx === 0 ? "①" : idx === 1 ? "②" : "☐";
        actions.appendChild(checkbox);

        item.appendChild(textWrap);
        item.appendChild(actions);

        item.addEventListener("click", () => {
          const id = collection.id;
          if (!id) return;
          let next = selected.slice();
          const existingIndex = next.indexOf(id);
          if (existingIndex !== -1) {
            next.splice(existingIndex, 1);
          } else {
            if (next.length >= 2) next = next.slice(1);
            next.push(id);
          }
          setSelectedIds(next);
          if (next.length === 2) {
            const left = collections.find((c) => c.id === next[0]);
            const right = collections.find((c) => c.id === next[1]);
            if (!left || !right) return;
            cfg.setDiffTitles(left.title || "A", right.title || "B");
            const diff = buildDiff(left.keys, right.keys);
            if (Object.keys(diff).length === 0) {
              cfg.setStatus(`No differences found between A (${left.title || "A"}) and B (${right.title || "B"}).`);
              return;
            }
            cfg.setCompareVisible(true, true);
            cfg.setPostLoadVisible(false);
            cfg.setIsDiffView(true);
            TABLE.renderTable(diff, true);
            const counts = { added: 0, changed: 0, removed: 0 };
            Object.values(diff).forEach((item) => {
              if (!item || !item.type) return;
              if (counts[item.type] !== undefined) counts[item.type] += 1;
            });
            cfg.setStatus(
              `Comparing A (${left.title || "A"}) → B (${right.title || "B"}) · ${Object.keys(diff).length} differences (added ${counts.added}, changed ${counts.changed}, removed ${counts.removed})`
            );
            return;
          }
          cfg.setStatus(`Selected ${next.length}/2 collections (A then B)`);
          renderPicker(collections, () => next, setSelectedIds);
        });

        fragment.appendChild(item);
      });

    savedList.appendChild(fragment);
  }

  /**
   * Wires the top-level Compare button, delegating host-scoped list fetching and parsing.
   * deps:
   * - button: the Compare button element
   * - parseConsulContext(url)
   * - getCollections(cb)
   * - renderScopedList(host, collections)
   * - getCurrentView()
   * - getCurrentHost(), setCurrentHost(host)
   * - getCurrentSecrets()
   */
  function wireButton(button, deps) {
    if (!button) return;
    button.addEventListener("click", () => {
      if (state.pickerOpen) {
        state.pickerOpen = false;
        try { cfg.setPickerOpen(false); } catch {}
        state.selectedIds = [];
        cfg.setCompareVisible(true, true);
        cfg.setIsDiffView(false);
        cfg.TABLE.renderTable(deps.getCurrentSecrets(), false);
        cfg.setPostLoadVisible(true);
        cfg.setCompareVisible(true, true);
        cfg.showSearch();
        cfg.setStatus("Compare cancelled.");
        return;
      }

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs?.[0];
        const ctx = tab?.url ? deps.parseConsulContext(tab.url) : null;
        const host = ctx?.host || deps.getCurrentHost() || "";
        if (!host) {
          cfg.setStatus("Open a Consul KV page to compare host-scoped collections.");
          cfg.setCompareVisible(true, false);
          return;
        }
        deps.getCollections((collections) => {
          const scoped = (collections || []).filter((c) => (c.host || "") === host);
          if (scoped.length < 2) {
            cfg.setStatus("Need at least 2 saved collections to compare.");
            cfg.setCompareVisible(true, false);
            return;
          }
          deps.setCurrentHost(host);
          state.pickerOpen = true;
           try { cfg.setPickerOpen(true); } catch {}
          state.selectedIds = [];
          cfg.setPostLoadVisible(false);
          cfg.setCompareVisible(true, true);
          renderPicker(
            scoped,
            () => state.selectedIds.slice(),
            (next) => {
              state.selectedIds = next.slice();
            }
          );
          cfg.showSearch();
          cfg.setStatus("Select two collections (A then B) to compare.");
        });
      });
    });
  }

  globalThis.SECRETS_SANTA.COMPARE = { setup, buildDiff, renderPicker, wireButton };
})();
