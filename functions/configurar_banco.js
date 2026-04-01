require('dotenv').config();
const { MongoClient } = require('mongodb');

async function ajustarConfig() {
    const uri = process.env.MONGODB_URI;
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db('ariana_moveis');
        const collection = db.collection('administracao');

        console.log("🚀 Ajustando as configurações de contatos...");

        // Criando o documento exatamente como o painel procura
        await collection.updateOne(
            { tipo: "configuracoes" }, // Procura se já existe
            { 
                $set: { 
                    tipo: "configuracoes",
                    subtipo: "contatos",
                    telefones: ["(11) 99999-9999"],
                    email: "contato@arianamoveis.com.br",
                    whatsapp: "(11) 99999-9999"
                } 
            },
            { upsert: true } // Se não existir, ele cria!
        );

        console.log("✅ CONFIGURAÇÃO CRIADA! O erro 404 deve sumir agora.");
    } catch (err) {
        console.error("❌ Erro:", err);
    } finally {
        await client.close();
        process.exit();
    }
}

ajustarConfig();