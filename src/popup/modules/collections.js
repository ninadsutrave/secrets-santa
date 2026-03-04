/* Collections module: listing, loading, and deleting saved collections for a host.
   Exposes COLLECTIONS.setup and COLLECTIONS.renderList, COLLECTIONS.deleteById, COLLECTIONS.getAll.
*/
globalThis.SECRETS_SANTA = globalThis.SECRETS_SANTA || {};

(() => {
  let cfg = null;

  /**
   * Initializes the collections module with required dependencies and callbacks.
   * options:
   * - savedList: UL element to render saved collections
   * - table: main table element (used to hide/show)
   * - STORAGE: shared storage facade
   * - setStatus(text): function to set status text
   * - setPostLoadVisible(bool): toggle post-load controls
   * - setCompareVisible(visible, enabled): toggle compare button
   * - showSearch(): show search box
   * - TABLE: table module (to render key/value table)
   * - onLoadCollection(collection): callback when a collection is selected
   */
  function setup(options) {
    cfg = {
      savedList: options.savedList,
      table: options.table,
      STORAGE: options.STORAGE,
      setStatus: options.setStatus,
      setPostLoadVisible: options.setPostLoadVisible,
      setCompareVisible: options.setCompareVisible,
      showSearch: options.showSearch,
      TABLE: options.TABLE,
      onLoadCollection: options.onLoadCollection
    };
  }

  /**
   * Fetches all saved collections from storage.
   */
  function getAll(callback) {
    cfg.STORAGE.getCollections(callback);
  }

  /**
   * Deletes a collection by id and re-renders the list.
   */
  function deleteById(id, afterRenderHost) {
    getAll((collections) => {
      const next = (collections || []).filter((item) => (item.id || "") !== (id || ""));
      cfg.STORAGE.setCollections(next, () => {
        if (next.length === 0) {
          cfg.savedList.innerHTML = "";
          cfg.setStatus("No collections remaining.");
          return;
        }
        const scoped = afterRenderHost ? next.filter((c) => (c.host || "") === afterRenderHost) : next;
        renderList(scoped);
        cfg.setStatus("Collection deleted.");
      });
    });
  }

  /**
   * Renders a list of collections and wires item interactions.
   * Selecting an item loads the collection via onLoadCollection.
   */
  function renderList(collections, groupedMode = false) {
    const { savedList, table } = cfg;
    if (!savedList) return;
    savedList.innerHTML = "";
    if (table) table.classList.add("hidden");
    savedList.classList.remove("hidden");

    const fragment = document.createDocumentFragment();

    // Sort logic
    const sortFn = (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);

    let listToRender = collections || [];
    if (!groupedMode) {
      listToRender.sort(sortFn);
      renderItems(listToRender, fragment, false);
    } else {
      // Group by host
      const grouped = {};
      listToRender.forEach(c => {
        const h = c.host || "Unknown Host";
        if (!grouped[h]) grouped[h] = [];
        grouped[h].push(c);
      });

      const hosts = Object.keys(grouped).sort();
      hosts.forEach(host => {
        const header = document.createElement("li");
        header.className = "saved-host-header";
        header.textContent = host;
        fragment.appendChild(header);

        const hostItems = grouped[host].sort(sortFn);
        renderItems(hostItems, fragment, true);
      });
    }

    savedList.appendChild(fragment);
  }

  function renderItems(items, fragment, groupedMode) {
    const { onLoadCollection } = cfg;
    items.forEach((collection) => {
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

      const del = document.createElement("span");
      del.className = "saved-delete";
      del.textContent = "🗑";
      del.title = "Delete";
      del.setAttribute("data-tip", "Delete collection");
      del.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteById(collection.id, groupedMode ? null : collection.host);
        // If grouped mode, we reload all. If not, we reload scoped.
        // Actually deleteById currently reloads ALL from storage and then filters if afterRenderHost is set.
        // We should fix deleteById to handle the refresh logic better or pass a callback.
        // For now let's just let it re-render.
      });

      actions.appendChild(del);

      item.appendChild(textWrap);
      item.appendChild(actions);

      item.addEventListener("click", () => {
        if (!collection.keys || Object.keys(collection.keys).length === 0) {
          cfg.setStatus("This collection is empty.");
          return;
        }
        onLoadCollection(collection);
      });

      fragment.appendChild(item);
    });
  }

  globalThis.SECRETS_SANTA.COLLECTIONS = { setup, renderList, deleteById, getAll };
})();
