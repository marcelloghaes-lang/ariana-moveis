(function () {
  const API_BASE = window.API_BASE || "http://localhost:3000/api";
  const PRODUCTS_API = `${API_BASE}/products`;

  const form = document.getElementById("productForm");
  const productList = document.getElementById("productList");
  const submitButton = document.getElementById("submitButton");
  const productNameInput = document.getElementById("productName");
  const productPriceInput = document.getElementById("productPrice");
  const productQuantityInput = document.getElementById("productQuantity");

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(Number(value || 0));
  }

  function showMessage(message, type = "success") {
    const toast = document.getElementById("toast-notification");
    const toastMessage = document.getElementById("toast-message");

    if (!toast || !toastMessage) {
      console.log(`[${type}] ${message}`);
      return;
    }

    toastMessage.textContent = message;
    toast.classList.remove("bg-green-500", "bg-red-500", "bg-blue-500", "bg-success-green", "bg-danger-red", "bg-secondary-gold");

    if (type === "success") {
      toast.classList.add("bg-success-green");
    } else if (type === "error") {
      toast.classList.add("bg-danger-red");
    } else {
      toast.classList.add("bg-secondary-gold");
    }

    toast.classList.add("show");

    setTimeout(() => {
      toast.classList.remove("show");
    }, 3000);
  }

  async function apiFetch(url, options = {}) {
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });

    let data = null;
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      const text = await response.text();
      data = text ? { message: text } : null;
    }

    if (!response.ok) {
      throw new Error(data?.message || `Erro HTTP ${response.status}`);
    }

    return data;
  }

  function normalizeProduct(item) {
    return {
      id: item.id || item._id || "",
      name: item.name || item.nome || "",
      price: Number(item.price ?? item.preco ?? 0),
      quantity: Number(item.quantity ?? item.estoque ?? 0)
    };
  }

  function setLoadingRow(message = "Carregando produtos...") {
    if (!productList) return;
    productList.innerHTML = `
      <tr>
        <td colspan="4" class="px-4 py-4 text-center text-gray-500">
          ${escapeHtml(message)}
        </td>
      </tr>
    `;
  }

  function renderProductList(products) {
    if (!productList) return;

    productList.innerHTML = "";

    if (!products.length) {
      setLoadingRow("Nenhum produto cadastrado.");
      return;
    }

    products.forEach((item, index) => {
      const row = document.createElement("tr");
      row.className = "border-b border-gray-200 " + (index % 2 === 0 ? "bg-white" : "bg-gray-50");

      row.innerHTML = `
        <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-800">${escapeHtml(item.name || "Sem Nome")}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${escapeHtml(formatCurrency(item.price))}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${escapeHtml(String(item.quantity ?? 0))}</td>
        <td class="px-4 py-3 whitespace-nowrap text-right text-sm font-medium space-x-2">
          <button
            type="button"
            class="text-sky-600 hover:text-sky-800 font-semibold p-2 rounded-lg hover:bg-sky-100 transition duration-150"
            data-action="edit"
            data-id="${escapeHtml(item.id)}"
          >
            Editar
          </button>
          <button
            type="button"
            class="text-red-600 hover:text-red-800 font-semibold p-2 rounded-lg hover:bg-red-100 transition duration-150"
            data-action="delete"
            data-id="${escapeHtml(item.id)}"
            data-name="${escapeHtml(item.name || "Sem Nome")}"
          >
            Deletar
          </button>
        </td>
      `;

      productList.appendChild(row);
    });
  }

  async function loadProducts() {
    try {
      setLoadingRow();

      const data = await apiFetch(PRODUCTS_API, { method: "GET" });
      const items = Array.isArray(data) ? data : (data.items || data.products || []);
      const normalized = items.map(normalizeProduct).sort((a, b) =>
        String(a.name).localeCompare(String(b.name), "pt-BR")
      );

      renderProductList(normalized);
    } catch (error) {
      console.error("Erro ao carregar produtos:", error);
      setLoadingRow("Erro ao carregar produtos.");
      showMessage(`Erro ao carregar lista: ${error.message}`, "error");
    }
  }

  function resetForm() {
    if (!form) return;
    form.reset();
    form.dataset.productId = "";
    if (submitButton) submitButton.textContent = "Adicionar Produto";
  }

  function loadProductForEdit(id, name, price, quantity) {
    if (!form) return;

    form.dataset.productId = id || "";
    if (productNameInput) productNameInput.value = name ?? "";
    if (productPriceInput) productPriceInput.value = Number(price ?? 0);
    if (productQuantityInput) productQuantityInput.value = Number(quantity ?? 0);

    if (submitButton) {
      const shortName = String(name || "produto").slice(0, 15);
      submitButton.textContent = `Salvar Edição de ${shortName}${String(name || "").length > 15 ? "..." : ""}`;
    }

    showMessage(`Editando produto: ${name}`, "info");
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleSaveProduct(event) {
    event.preventDefault();
    if (!form) return;

    const productId = form.dataset.productId || "";
    const name = String(productNameInput?.value || "").trim();
    const price = Number(productPriceInput?.value || 0);
    const quantity = Number(productQuantityInput?.value || 0);

    if (!name) {
      showMessage("O nome do produto é obrigatório.", "error");
      return;
    }

    const payload = {
      name,
      price: Number.isFinite(price) ? price : 0,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      updatedAt: new Date().toISOString()
    };

    try {
      if (productId) {
        await apiFetch(`${PRODUCTS_API}/${encodeURIComponent(productId)}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        showMessage(`Produto "${name}" atualizado com sucesso!`, "success");
      } else {
        await apiFetch(PRODUCTS_API, {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            createdAt: new Date().toISOString()
          })
        });
        showMessage(`Produto "${name}" adicionado com sucesso!`, "success");
      }

      resetForm();
      await loadProducts();
    } catch (error) {
      console.error("Erro ao salvar produto:", error);
      showMessage(`Erro ao salvar: ${error.message}`, "error");
    }
  }

  async function deleteProduct(id, name) {
    try {
      await apiFetch(`${PRODUCTS_API}/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      showMessage(`Produto "${name}" deletado com sucesso.`, "success");
      await loadProducts();
    } catch (error) {
      console.error("Erro ao deletar produto:", error);
      showMessage(`Erro ao deletar: ${error.message}`, "error");
    }
  }

  function handleDeleteProduct(id, name) {
    if (!id) return;

    const ok = window.confirm(`Tem certeza que deseja EXCLUIR o produto: ${name}? Esta ação é irreversível.`);
    if (!ok) return;

    deleteProduct(id, name);
  }

  function bindTableActions() {
    if (!productList) return;

    productList.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const action = button.dataset.action;
      const id = button.dataset.id;

      if (action === "delete") {
        const name = button.dataset.name || "Sem Nome";
        handleDeleteProduct(id, name);
        return;
      }

      if (action === "edit") {
        const row = button.closest("tr");
        if (!row) return;

        const cells = row.querySelectorAll("td");
        const name = cells[0]?.textContent?.trim() || "";
        const priceText = cells[1]?.textContent?.trim() || "0";
        const quantityText = cells[2]?.textContent?.trim() || "0";

        const normalizedPrice = Number(
          String(priceText)
            .replace(/[R$\s]/g, "")
            .replace(/\./g, "")
            .replace(",", ".")
        ) || 0;

        const quantity = Number(quantityText) || 0;

        loadProductForEdit(id, name, normalizedPrice, quantity);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (form) {
      form.addEventListener("submit", handleSaveProduct);
    }

    bindTableActions();
    loadProducts();
  });

  window.showMessage = showMessage;
  window.productManager = {
    handleSaveProduct,
    loadProductForEdit,
    handleDeleteProduct,
    loadProducts,
    resetForm
  };
})();