// limpar_categorias.js
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json"); 
// esse arquivo é a chave do projeto ariana-moveis-final

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function limparCategorias() {
  const snap = await db.collection("categories").get();

  if (snap.empty) {
    console.log("Nenhuma categoria encontrada.");
    process.exit(0);
  }

  const batch = db.batch();
  snap.docs.forEach(doc => batch.delete(doc.ref));

  await batch.commit();
  console.log(`🔥 ${snap.size} categorias apagadas com sucesso.`);
  process.exit(0);
}

limparCategorias();
