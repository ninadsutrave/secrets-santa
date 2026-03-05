/* Collections module: listing, loading, and deleting saved collections for a host.
   Exposes COLLECTIONS.setup and COLLECTIONS.renderList, COLLECTIONS.deleteById, COLLECTIONS.getAll.
*/
(globalThis as any).SECRETS_SANTA = (globalThis as any).SECRETS_SANTA || {};

(() => {
  let cfg: any = null;

  function setup(options: any) {
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

  function getAll(callback: (collections: any[]) => void) {
    cfg.STORAGE.getCollections(callback);
  }

  function deleteById(id: string, afterRenderHost: string | null) {
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

  function renderList(collections: any[], groupedMode = false) {
    const { savedList, table } = cfg;
    if (!savedList) return;
    savedList.innerHTML = "";
    if (table) table.classList.add("hidden");
    savedList.classList.remove("hidden");

    const fragment = document.createDocumentFragment();

    const sortFn = (a: any, b: any) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);

    let listToRender = collections || [];
    if (!groupedMode) {
      listToRender.sort(sortFn);
      renderItems(listToRender, fragment, false);
    } else {
      const grouped: Record<string, any[]> = {};
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

  function renderItems(items: any[], fragment: DocumentFragment, groupedMode: boolean) {
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

  (globalThis as any).SECRETS_SANTA.COLLECTIONS = { setup, renderList, deleteById, getAll };
})();
