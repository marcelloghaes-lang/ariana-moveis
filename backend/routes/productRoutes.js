import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
    // Nome do produto (Ex: Sofá Modular Luna)
    name: {
        type: String,
        required: [true, 'O nome do produto é obrigatório.'],
        trim: true,
        unique: true
    },
    // Breve descrição ou resumo
    description: {
        type: String,
        required: [true, 'A descrição é obrigatória.']
    },
    // Preço do produto
    price: {
        type: Number,
        required: [true, 'O preço é obrigatório.'],
        default: 0
    },
    // Quantidade em estoque
    stock: {
        type: Number,
        required: true,
        default: 0
    },
    // Categoria do produto (Ex: "Sofás", "Cadeiras", "Mesas")
    category: {
        type: String,
        required: [true, 'A categoria é obrigatória.']
    },
    // URL principal da imagem (usando um placeholder como sugestão)
    imageUrl: {
        type: String,
        default: 'https://placehold.co/600x400/CCCCCC/000000?text=Imagem+do+Produto' 
    },
    // Data de criação do registro
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// O modelo 'Product' é usado para interagir com a coleção 'products' no MongoDB
const Product = mongoose.model('Product', productSchema);

export default Product;
