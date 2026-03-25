import React, { useState } from 'react';
import { Send, Loader2, LinkIcon, CheckCircle } from 'lucide-react'; // Ícones lucide-react

// Use a URL da função que você acabou de implantar
const API_URL = process.env.API_BASE_URL;

// Componente principal
const App = () => {
  const [inputText, setInputText] = useState('Teste de Conexão com Firebase Function');
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Função utilitária para copiar texto para a área de transferência
  const copyToClipboard = (text) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      alert('URL copiada para a área de transferência!'); // Usando alert, mas idealmente seria um modal customizado.
    } catch (err) {
      console.error('Erro ao copiar: ', err);
    }
    document.body.removeChild(textarea);
  };

  const handleTestApi = async () => {
    setLoading(true);
    setResponse(null);
    setError(null);

    try {
      const payload = { 
        message: inputText, 
        timestamp: new Date().toISOString() 
      };

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        // Envia os dados como JSON no corpo da requisição
        body: JSON.stringify(payload),
      });

      // Se a resposta não for OK (status 200-299), lança um erro
      if (!res.ok) {
        throw new Error(`HTTP Error! Status: ${res.status} - ${res.statusText}`);
      }

      // Tenta analisar a resposta como JSON
      const data = await res.json();
      setResponse(data);

    } catch (err) {
      console.error("Erro na chamada da API:", err);
      setError(`Falha ao conectar ou erro retornado pela função: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-8 flex items-start justify-center font-sans">
      <div className="w-full max-w-lg bg-white shadow-xl rounded-xl p-6 md:p-8">
        <h1 className="text-2xl font-bold text-gray-800 mb-6 flex items-center">
          <CheckCircle className="w-6 h-6 mr-2 text-green-500" />
          Teste de Deploy Concluído
        </h1>
        
        {/* URL da Função */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            URL da Função `apiV2` (southamerica-east1)
          </label>
          <div className="flex items-center space-x-2 bg-gray-50 p-3 rounded-lg border border-gray-200">
            <LinkIcon className="w-5 h-5 text-blue-500" />
            <input
              type="text"
              readOnly
              value={API_URL}
              className="flex-grow text-xs sm:text-sm bg-transparent border-none focus:ring-0 p-0 text-gray-600 truncate"
            />
            <button
              onClick={() => copyToClipboard(API_URL)}
              className="text-xs font-semibold text-white bg-blue-500 hover:bg-blue-600 p-1.5 rounded-md transition duration-150"
              title="Copiar URL"
            >
              Copiar
            </button>
          </div>
        </div>

        {/* Input de Teste */}
        <div className="mb-6">
          <label htmlFor="input" className="block text-sm font-medium text-gray-700 mb-1">
            Dados de Teste (JSON Body)
          </label>
          <textarea
            id="input"
            rows="3"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-sm font-mono resize-none"
            placeholder="Insira o texto que será enviado para a sua função..."
          />
        </div>

        {/* Botão de Envio */}
        <button
          onClick={handleTestApi}
          disabled={loading}
          className={`w-full flex items-center justify-center px-4 py-2 border border-transparent rounded-lg text-sm font-medium text-white shadow-sm transition duration-150 ease-in-out 
            ${loading 
              ? 'bg-indigo-400 cursor-not-allowed' 
              : 'bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500'
            }`}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Testando Conexão...
            </>
          ) : (
            <>
              <Send className="w-4 h-4 mr-2" />
              Enviar Requisição POST
            </>
          )}
        </button>

        {/* Exibição de Erro */}
        {error && (
          <div className="mt-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
            <p className="font-bold mb-1">Erro na Chamada:</p>
            <p className="text-sm break-words whitespace-pre-wrap">{error}</p>
            <p className="mt-2 text-xs">Verifique os logs no Firebase Console para mais detalhes.</p>
          </div>
        )}

        {/* Exibição de Resposta */}
        {response && (
          <div className="mt-6 p-4 bg-green-100 border border-green-400 text-green-800 rounded-lg">
            <p className="font-bold mb-2 flex items-center">
              <CheckCircle className="w-5 h-5 mr-1 text-green-600" />
              Resposta da Função API
            </p>
            <pre className="text-sm bg-green-50 p-3 rounded-md overflow-x-auto border border-green-300">
              {/* Garante que a saída JSON seja formatada e legível */}
              {JSON.stringify(response, null, 2)}
            </pre>
          </div>
        )}

      </div>
    </div>
  );
};

export default App;
