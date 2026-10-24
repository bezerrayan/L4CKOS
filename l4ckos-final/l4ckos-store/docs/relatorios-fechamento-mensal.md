# Fechamento mensal de relatórios

## Estado atual

O módulo calcula consultas a partir dos registros atuais e permite baixar CSV/PDF. Os arquivos são baixados pelo navegador e não ficam arquivados pelo serviço. Um mês passado é uma consulta histórica recalculada, não um fechamento imutável ou definitivo.

## Evolução persistente proposta

Quando houver autorização, backup/restore atualizado e migration revisada, introduzir um registro de fechamento com:

- Identificador, ano/mês, início/fim em UTC e fuso de apresentação (`America/Sao_Paulo`).
- Estado `provisional`, `closed` ou `rectified`, autor, datas de criação e fechamento.
- Versão dos critérios e da aplicação que produziram o documento.
- Snapshot agregado JSON validado por schema e hash SHA-256 do conteúdo canônico.
- Referência privada ao PDF gerado e seu checksum; sem dados pessoais de consumidores.
- `supersedesId` para retificações. Fechamentos anteriores são somente leitura e nunca são sobrescritos.
- Índices únicos para impedir mais de uma versão inicial definitiva do mesmo mês; versões retificadas usam identificador/versionamento explícito.

O armazenamento do PDF deve ser privado, criptografado pelo serviço de storage, com política de retenção e leitura somente para administradores autorizados. A geração e cada retificação devem gerar auditoria com autor, período, versão dos critérios e checksum, sem registrar dados pessoais nem valores completos desnecessários nos logs.

Antes do fechamento definitivo, o operador deve revisar o período encerrado, critérios financeiros, cobertura de eventos, agregados e PDF. O fechamento deve guardar exatamente os agregados e o documento revisados; consultas futuras apresentam o snapshot original. Uma correção cria nova versão relacionada, preservando o documento anterior e a justificativa auditável.

Esta documentação não cria tabela, migration, bucket ou arquivo remoto. A implantação persistente exige autorização específica e backup recuperável atualizado.
