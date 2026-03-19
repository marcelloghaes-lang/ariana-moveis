// uploadImage.js
// Upload centralizado de imagens para o Firebase Storage
// Padrão de salvamento: products/{sellerUid}/{timestamp}-{nome-arquivo}

import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-storage.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";

function sanitizeFileName(name = "arquivo") {
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function extFromName(name = "") {
  const clean = String(name || "");
  const i = clean.lastIndexOf(".");
  return i >= 0 ? clean.slice(i) : "";
}

function contentTypeFallback(file) {
  const t = String(file?.type || "").trim();
  if (t) return t;
  const ext = extFromName(file?.name || "").toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function buildFileName(file) {
  const original = sanitizeFileName(file?.name || "imagem.jpg");
  return `${Date.now()}-${original}`;
}

function resolveSellerUid({ auth, forcedSellerUid = null, allowAdminAlias = true } = {}) {
  const currentUser = auth?.currentUser || null;
  if (!currentUser && !forcedSellerUid) {
    throw new Error("Usuário não autenticado para upload.");
  }
  if (forcedSellerUid) return String(forcedSellerUid);
  const uid = String(currentUser.uid || "");
  if (!uid) throw new Error("UID do usuário não encontrado.");
  if (allowAdminAlias && uid.toLowerCase() === "admin") return "ArianaMoveis";
  return uid;
}

export function createUploadService(app) {
  const storage = getStorage(app);
  const auth = getAuth(app);

  async function uploadSingleImage(file, options = {}) {
    if (!file) throw new Error("Arquivo não informado para upload.");
    const sellerUid = resolveSellerUid({
      auth,
      forcedSellerUid: options.sellerUid || null,
      allowAdminAlias: options.allowAdminAlias !== false,
    });

    const fileName = buildFileName(file);
    const path = `products/${sellerUid}/${fileName}`;
    const storageRef = ref(storage, path);

    await uploadBytes(storageRef, file, {
      contentType: contentTypeFallback(file),
      customMetadata: {
        sellerUid,
        originalName: String(file?.name || ""),
        uploadedAt: new Date().toISOString(),
      },
    });

    const url = await getDownloadURL(storageRef);
    return {
      url,
      path,
      sellerUid,
      fileName,
      originalName: String(file?.name || ""),
      contentType: contentTypeFallback(file),
      size: Number(file?.size || 0),
    };
  }

  async function uploadMultipleImages(files, options = {}) {
    const list = Array.from(files || []);
    const results = [];
    for (let i = 0; i < list.length; i++) {
      const uploaded = await uploadSingleImage(list[i], options);
      results.push({ ...uploaded, isMain: i === 0 });
    }
    return results;
  }

  async function removeImageByPath(path) {
    if (!path) return false;
    const imageRef = ref(storage, path);
    await deleteObject(imageRef);
    return true;
  }

  return {
    auth,
    storage,
    uploadSingleImage,
    uploadMultipleImages,
    removeImageByPath,
  };
}
