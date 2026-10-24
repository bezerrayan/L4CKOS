# Provisionamento externo de administradores

O painel e a API da aplicação não concedem, removem, promovem nem rebaixam papel administrativo. A antiga mutation `admin.userSetRole` foi removida. Cadastro por senha, login local e OAuth também não escrevem o campo `users.role`.

## Fonte de autorização

O papel persistido em `users.role` é a fonte do estado do usuário. Para cada requisição administrativa, a aplicação exige simultaneamente `role = admin` e uma identidade aprovada: e-mail presente em `ADMIN_EMAILS` ou `openId` igual ao `OWNER_OPEN_ID` configurado. A allowlist sozinha não transforma uma conta em administradora.

## Concessão controlada

1. Obter aprovação explícita do proprietário fora da aplicação e registrar a mudança em chamado operacional auditável.
2. Verificar a identidade pela conta autenticada no provedor (Google `sub`/`openId` e e-mail verificado). Não confiar apenas em nome ou e-mail informado em formulário.
3. Confirmar que a conta correta já existe e que seu `openId` corresponde à identidade verificada.
4. Pelo procedimento externo de operações com acesso privilegiado ao banco e à configuração do ambiente, conceder `users.role = admin` àquela conta e assegurar que sua identidade também corresponda a `ADMIN_EMAILS` (ou ao `OWNER_OPEN_ID` proprietário). A alteração não deve passar por endpoint da aplicação.
5. Registrar no chamado o aprovador, identidade verificada, ID interno da conta, ambiente, data, operador e evidência externa da alteração. O fluxo da aplicação não cria um `auditLogs` de concessão, pois não existe mutation para isso; usar o registro auditável do procedimento externo.
6. Solicitar que a pessoa encerre a sessão e entre novamente para atualizar a interface. A API busca o usuário no banco em cada autenticação e revalida papel e allowlist em cada chamada administrativa, portanto não depende do papel codificado no cookie.

Não pré-criar `local:<email>` para uma pessoa que ainda não autenticou. O cadastro público local de endereços presentes em `ADMIN_EMAILS` é recusado para impedir que alguém reivindique uma identidade administrativa por senha sem verificação externa.

## Revogação

Com aprovação do proprietário e chamado operacional, remover o papel `admin` da conta pelo mesmo procedimento externo e remover sua identidade de `ADMIN_EMAILS`, quando aplicável. Para o proprietário identificado por `OWNER_OPEN_ID`, a revogação exige alterar essa configuração por procedimento de infraestrutura controlado. Preservar a conta e seus registros; não apagar dados. Registrar operador, aprovador, identidade, ambiente, horário e evidência. As chamadas administrativas passam a falhar na próxima validação do servidor; a pessoa deve encerrar a sessão para atualizar a interface.

Nenhum procedimento de concessão ou revogação foi executado nesta mudança. Nenhuma credencial ou alteração de usuário foi usada.
