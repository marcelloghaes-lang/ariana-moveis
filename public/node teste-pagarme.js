import axios from "axios";

async function testarPagamento() {
  try {
    const body = {
      items: [
        {
          amount: 10000,
          description: "Teste Ariana Móveis",
          quantity: 1
        }
      ],
      customer: {
        name: "Cliente Teste",
        email: "teste@teste.com",
        type: "individual",
        document: "12345678909"
      },
      payments: [
        {
          payment_method: "pix",
          pix: {
            expires_in: 3600
          }
        }
      ]
    };

    const r = await axios.post(
      "http://localhost:3000/api/payments/create",
      body
    );

    console.log("RESPOSTA:", r.data);
  } catch (e) {
    console.log("ERRO:", e.response?.data || e.message);
  }
}

testarPagamento();