export function createSigePessoaService(context = {}) {
  const {
    toJSON,
    arianaSigeFirstValue,
    arianaSigeOnlyDigits,
    arianaSigeUfCodigo,
    sigeRequest
  } = context;

function arianaSigePickCustomerName(orderObj = {}, payload = {}, body = {}) {
  return String(arianaSigeFirstValue(
    body.customerName,
    body.nomeFantasia,
    payload.Cliente,
    orderObj.customerName,
    orderObj.user?.name,
    orderObj.customerEmail,
    'Cliente Ariana'
  )).trim();
}

function arianaSigeBuildPessoaPayloadFromOrder(order = {}, vendaPayload = {}, body = {}) {
  const orderObj = toJSON(order) || order || {};
  const shippingAddress = orderObj.shippingAddress || orderObj.shipping?.address || body.shippingAddress || {};
  const nome = arianaSigePickCustomerName(orderObj, vendaPayload, body);
  const documento = arianaSigeOnlyDigits(arianaSigeFirstValue(
    body.customerDocument,
    body.cpfCnpj,
    body.cnpjCpf,
    vendaPayload.ClienteCNPJ,
    orderObj.customerDocument,
    orderObj.customerCpf,
    orderObj.customerCnpj,
    orderObj.cpf,
    orderObj.cnpj,
    orderObj.user?.cpf,
    shippingAddress.cpf,
    shippingAddress.cnpj
  ));
  const email = String(arianaSigeFirstValue(body.customerEmail, vendaPayload.ClienteEmail, orderObj.customerEmail, orderObj.user?.email)).trim();
  const telefone = arianaSigeOnlyDigits(arianaSigeFirstValue(body.customerPhone, vendaPayload.ClienteTelefone, orderObj.customerPhone, orderObj.phone, orderObj.user?.phone));
  const cidade = String(arianaSigeFirstValue(vendaPayload.Municipio, shippingAddress.cidade, shippingAddress.city, shippingAddress.municipio)).trim();
  const uf = String(arianaSigeFirstValue(vendaPayload.UF, shippingAddress.uf, shippingAddress.state, shippingAddress.estado)).trim().toUpperCase();
  const cep = arianaSigeOnlyDigits(arianaSigeFirstValue(vendaPayload.CEP, shippingAddress.cep, shippingAddress.zipCode, shippingAddress.zip, shippingAddress.postalCode));
  const logradouro = String(arianaSigeFirstValue(vendaPayload.Logradouro, shippingAddress.logradouro, shippingAddress.rua, shippingAddress.street, shippingAddress.endereco, shippingAddress.address)).trim();
  const numero = String(arianaSigeFirstValue(vendaPayload.LogradouroNumero, shippingAddress.numero, shippingAddress.number, shippingAddress.logradouroNumero, 'S/N')).trim();
  const complemento = String(arianaSigeFirstValue(vendaPayload.LogradouroComplemento, shippingAddress.complemento, shippingAddress.complement, shippingAddress.logradouroComplemento)).trim();
  const bairro = String(arianaSigeFirstValue(vendaPayload.Bairro, shippingAddress.bairro, shippingAddress.neighborhood)).trim();
  const codigoMunicipio = String(arianaSigeFirstValue(vendaPayload.CodigoMunicipio, shippingAddress.codigoMunicipio, shippingAddress.ibge, shippingAddress.cityCode)).trim();
  const codigoUf = String(arianaSigeFirstValue(vendaPayload.UFCodigo, shippingAddress.ufCodigo, shippingAddress.codigoUf, arianaSigeUfCodigo(uf))).trim();

  const enderecoPadrao = {
    Exterior: false,
    CEP: cep,
    Logradouro: logradouro,
    Uf: uf,
    CodigoUF: codigoUf,
    Cidade: cidade,
    Numero: numero,
    Complemento: complemento,
    Bairro: bairro,
    CodigoCidade: codigoMunicipio,
    Pais: 'Brasil',
    CodigoPais: '1058'
  };

  const pessoa = {
    PessoaFisica: documento.length !== 14,
    NomeFantasia: nome,
    RazaoSocial: nome,
    CNPJ_CPF: documento,
    RG: '',
    IE: '',
    Logradouro: logradouro,
    LogradouroNumero: numero,
    Complemento: complemento,
    Bairro: bairro,
    Cidade: cidade,
    CodigoMunicipio: codigoMunicipio,
    Pais: 'Brasil',
    CodigoPais: '1058',
    CEP: cep,
    UF: uf,
    CodigoUF: codigoUf,
    Telefone: telefone,
    Celular: telefone,
    Email: email,
    Cliente: true,
    Tecnico: false,
    Vendedor: false,
    Transportadora: false,
    Fonecedor: false,
    Representada: false,
    Colaborador: false,
    Fabricante: false,
    Credenciadora: false,
    EnteGovernamental: false,
    Bloqueado: false,
    EstaInadimplente: false,
    EnderecoCobranca: enderecoPadrao,
    EnderecoPadrao: enderecoPadrao,
    EnderecosEntrega: [{
      EnderecoId: '',
      Exterior: false,
      Logradouro: logradouro,
      LogradouroNumero: numero,
      Complemento: complemento,
      Bairro: bairro,
      Cidade: cidade,
      CodigoMunicipio: codigoMunicipio,
      Pais: 'Brasil',
      CodigoPais: '1058',
      CEP: cep,
      UF: uf,
      CodigoUF: codigoUf,
      EnderecoPadrao: true,
      EntregaIE: ''
    }],
    Grupo: String(process.env.SIGE_PESSOA_GRUPO || '').trim()
  };

  // Evita enviar campos vazios que algumas contas SIGE rejeitam sem necessidade.
  for (const [key, value] of Object.entries({ ...pessoa })) {
    if (value === '' || value === undefined || value === null) delete pessoa[key];
  }

  return pessoa;
}

function arianaSigeNormalizePessoaList(raw = {}) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.Dados)) return raw.Dados;
  if (Array.isArray(raw?.pessoas)) return raw.pessoas;
  if (Array.isArray(raw?.Pessoas)) return raw.Pessoas;
  if (raw && typeof raw === 'object' && Object.keys(raw).length) return [raw];
  return [];
}

function arianaSigePessoaMatches(pessoa = {}, search = {}) {
  const doc = arianaSigeOnlyDigits(search.documento || '');
  const nome = String(search.nome || '').trim().toLowerCase();
  const email = String(search.email || '').trim().toLowerCase();

  const pessoaDoc = arianaSigeOnlyDigits(pessoa.CNPJ_CPF || pessoa.cnpj_cpf || pessoa.cpfCnpj || pessoa.CpfCnpj || '');
  const pessoaNome = String(pessoa.NomeFantasia || pessoa.nomeFantasia || pessoa.RazaoSocial || pessoa.razaoSocial || '').trim().toLowerCase();
  const pessoaEmail = String(pessoa.Email || pessoa.email || '').trim().toLowerCase();

  if (doc && pessoaDoc && doc === pessoaDoc) return true;
  if (email && pessoaEmail && email === pessoaEmail) return true;
  if (nome && pessoaNome && nome === pessoaNome) return true;
  return false;
}

async function arianaSigePesquisarPessoa({ nome = '', documento = '', email = '' } = {}) {
  const attempts = [];
  const cleanDoc = arianaSigeOnlyDigits(documento);
  const cleanNome = String(nome || '').trim();

  if (cleanDoc) attempts.push({ cpfCnpj: cleanDoc });
  if (cleanNome) attempts.push({ nomeFantasia: cleanNome });
  if (email) attempts.push({ nomeFantasia: String(email).trim() });

  for (const params of attempts) {
    try {
      const raw = await sigeRequest('GET', 'Pessoas/Pesquisar', { params });
      const list = arianaSigeNormalizePessoaList(raw);
      const found = list.find((pessoa) => arianaSigePessoaMatches(pessoa, { nome: cleanNome, documento: cleanDoc, email }));
      if (found) return { found: true, pessoa: found, raw, params };
      if (list.length && !cleanDoc) return { found: true, pessoa: list[0], raw, params };
    } catch (error) {
      // Pesquisa sem resultado pode variar por conta SIGE. O cadastro serÃ¡ tentado em seguida.
    }
  }

  return { found: false, pessoa: null, raw: null, params: attempts[0] || {} };
}

async function arianaSigeEnsurePessoaForOrder(order, vendaPayload = {}, body = {}) {
  const pessoaPayload = arianaSigeBuildPessoaPayloadFromOrder(order, vendaPayload, body);
  const nome = pessoaPayload.NomeFantasia || pessoaPayload.RazaoSocial || vendaPayload.Cliente || '';
  const documento = pessoaPayload.CNPJ_CPF || '';
  const email = pessoaPayload.Email || '';

  if (!nome) {
    const err = new Error('NÃ£o foi possÃ­vel cadastrar cliente no SIGE: nome do cliente ausente.');
    err.statusCode = 400;
    throw err;
  }

  const search = await arianaSigePesquisarPessoa({ nome, documento, email });
  if (search.found) {
    return {
      action: 'found',
      pessoa: search.pessoa,
      payload: pessoaPayload,
      search
    };
  }

  try {
    const raw = await sigeRequest('POST', 'Pessoas/Salvar', { data: pessoaPayload });
    return {
      action: 'created',
      pessoa: raw,
      payload: pessoaPayload,
      raw,
      search
    };
  } catch (error) {
    error.message = `NÃ£o foi possÃ­vel cadastrar o cliente no SIGE antes da venda: ${error.message || String(error)}`;
    throw error;
  }
}

  return {
    arianaSigePickCustomerName,
    arianaSigeBuildPessoaPayloadFromOrder,
    arianaSigeNormalizePessoaList,
    arianaSigePessoaMatches,
    arianaSigePesquisarPessoa,
    arianaSigeEnsurePessoaForOrder
  };
}
