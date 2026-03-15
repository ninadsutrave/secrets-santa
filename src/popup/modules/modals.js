globalThis.SECRETS_SANTA = globalThis.SECRETS_SANTA || {};

(() => {
  const jsonModal = document.getElementById("jsonModal");
  const jsonModalClose = document.getElementById("jsonModalClose");
  const jsonModalDone = document.getElementById("jsonModalDone");
  const jsonModalCopy = document.getElementById("jsonModalCopy");
  const jsonModalTitle = document.getElementById("jsonModalTitle");
  const jsonModalBody = document.getElementById("jsonModalBody");
  const jsonModalMeta = document.getElementById("jsonModalMeta");

  function setJsonModalOpen(open) {
    if (!jsonModal) return;
    jsonModal.classList.toggle("hidden", !open);
  }

  function openJsonModal(title, value) {
    if (jsonModalTitle) jsonModalTitle.textContent = title || "JSON";
    if (jsonModalBody) jsonModalBody.textContent = String(value || "");
    if (jsonModalMeta) jsonModalMeta.textContent = title ? `Key: ${title}` : "";
    setJsonModalOpen(true);
  }

  function closeJsonModal() {
    setJsonModalOpen(false);
  }

  jsonModalClose?.addEventListener("click", closeJsonModal);
  jsonModalDone?.addEventListener("click", closeJsonModal);
  // Click the backdrop (the overlay itself, not the card) to dismiss.
  jsonModal?.addEventListener("click", (e) => { if (e.target === jsonModal) closeJsonModal(); });
  // Escape key dismisses from anywhere.
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeJsonModal(); });
  jsonModalCopy?.addEventListener("click", () => {
    if (!jsonModalBody) return;
    navigator.clipboard.writeText(jsonModalBody.textContent || "");
    const status = document.getElementById("status");
    if (status) status.textContent = "Santa copied the JSON to your clipboard.";
  });

  globalThis.SECRETS_SANTA.MODALS = { openJsonModal };
})();
