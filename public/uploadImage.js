// uploadImage.js
// Upload centralizado de imagens para Ariana Móveis
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-storage.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";

function sanitizeSegment(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function safeContentType(file) {
  const type = String(file?.type || "").trim();
  if (type) return type;
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function buildFileName(file) {
  const original = sanitizeSegment(file?.name || "imagem.jpg") || "imagem.jpg";
  return `${Date.now()}_${original}`;
}

export function createUploadService(app) {
  const storage = getStorage(app);
  const auth = getAuth(app);

  function resolveFolderSellerUid(forcedSellerUid = null) {
    if (forcedSellerUid) return sanitizeSegment(forcedSellerUid);
    const uid = auth?.currentUser?.uid;
    if (!uid) throw new Error("Usuário não autenticado para upload.");
    return sanitizeSegment(uid);
  }

  async function uploadSingleImage(file, options = {}) {
    if (!file) throw new Error("Arquivo não informado.");
    const sellerUid = resolveFolderSellerUid(options.sellerUid || null);
    const fileName = buildFileName(file);
    const path = `products/${sellerUid}/${fileName}`;
    const storageRef = ref(storage, path);
    const snap = await uploadBytes(storageRef, file, {
      contentType: safeContentType(file),
      customMetadata: {
        sellerUid,
        originalName: String(file?.name || fileName),
        uploadedAt: new Date().toISOString()
      }
    });
    const url = await getDownloadURL(snap.ref);
    return {
      url,
      path: snap.ref.fullPath,
      name: fileName,
      originalName: String(file?.name || fileName),
      isMain: false
    };
  }

  async function uploadMultipleImages(files, options = {}) {
    const list = Array.from(files || []);
    const results = [];
    for (let i = 0; i < list.length; i++) {
      const uploaded = await uploadSingleImage(list[i], options);
      uploaded.isMain = i === 0;
      results.push(uploaded);
    }
    return results;
  }

  async function removeImageByPath(path) {
    if (!path) return false;
    const imageRef = ref(storage, path);
    await deleteObject(imageRef);
    return true;
  }

  return { auth, storage, uploadSingleImage, uploadMultipleImages, removeImageByPath };
}
