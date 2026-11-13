# Atestação local do runtime financeiro

**Preparação local apenas.** Nenhuma publicação, consulta remota ou alteração de variável foi feita. A atestação não cria endpoint e não altera flags, defaults, autenticação, rotas, checkout, banco, workers ou provider.

## Identidade, origem e emissão

Railway documenta `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID` e `RAILWAY_SERVICE_ID`, além de `RAILWAY_DEPLOYMENT_ID` e `RAILWAY_REPLICA_ID`, como variáveis de sistema fornecidas aos deployments. `RAILWAY_GIT_COMMIT_SHA` é fornecida quando o deployment se origina de um trigger GitHub. A atestação lê os valores efetivos do `process.env`; não busca variáveis pela CLI nem consulta o control plane.

O evento só é emitido quando a tupla efetiva do processo coincide exatamente com a homologação isolada:

- project `66faf690-a068-40d1-b85c-cb5d8595560a`;
- environment `5335340d-311c-47e9-9713-6e5a86969c88`;
- API service `d66762a4-422a-4656-94a1-502215a27aa2`.

Production, staging legado, processos locais e identidade incompleta/divergente não emitem o evento. Um evento emitido traz deployment ID, replica ID e PID. SHA Git válido é incluído quando Railway o fornece; sua ausência não invalida a correlação deployment/instância, pois deployments por imagem/CLI podem não ter SHA Git. O deployment ID precisa ser comparado com metadados Railway read-only antes de aceitar a evidência. A variável de processo é um identificador de correlação, não uma assinatura criptográfica; a revisão remota também deve confirmar a origem do deployment e descartar configuração manual que pudesse sombrear as variáveis de sistema.

Referência primária da plataforma: [Railway Variables Reference](https://docs.railway.com/variables/reference). A documentação identifica as variáveis como fornecidas pela plataforma, mas não é prova do valor efetivo de um deployment específico.

## Veredito observacional

O relatório usa `PASS`, `FAIL` ou `NOT_VERIFIED` e códigos de issue fechados, sem copiar valores desconhecidos do ambiente.

- `PASS` exige identidade exata, deployment/replica/PID correlacionáveis, flags financeiras fechadas, seleção Sandbox consistente e configuração Asaas configurada.
- `FAIL` representa identidade completa mas divergente, recurso financeiro aberto, flag inválida, Asaas Production ou configuração Asaas inválida/inconsistente.
- `NOT_VERIFIED` cobre identidade incompleta, deployment/replica/PID ausentes, source SHA fornecido em formato inválido ou Asaas sem endpoint configurado.

Somente `PASS` é elegível para aprovação. `FAIL` e `NOT_VERIFIED` bloqueiam o avanço do Gate. O código não encerra a API nem altera comportamento operacional: os gates de runtime existentes continuam responsáveis por negar operações. A atestação é evidência observacional, não um controle de autorização.

## Dados emitidos

O evento contém apenas IDs Railway não secretos, PID, SHA Git opcional validado, enums, booleanos efetivos e códigos de issue. Nunca serializa token, API key, URL/host, connection string, payload, SQL, dados pessoais ou valores brutos de configuração. Presença de credencial é booleana.

## Limites

O evento descreve os valores resolvidos durante aquele startup. Não comprova saúde dos workers, disponibilidade do banco/provider, nem mudanças posteriores de configuração em memória. Não confirma sozinho o estado remoto: a coleta precisa ser feita nos logs privados do deployment identificado e confrontada com metadados Railway read-only. Não usar apenas timestamp ou nome do projeto como correlação.
