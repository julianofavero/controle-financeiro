# Controle Financeiro

Aplicação web para controlar entradas e saídas de dinheiro. A tela inicial é um dashboard com gráficos, avisos e a projeção dos próximos meses, calculada a partir do que você já lançou.

Funciona direto no navegador, sem servidor, sem cadastro e sem instalar nada. Os dados ficam salvos apenas no seu computador.

![Dashboard com dados de exemplo](docs/dashboard.png)

## Sumário

- [Funcionalidades](#funcionalidades)
- [Como usar](#como-usar)
- [Planilhas XLSX](#planilhas-xlsx)
- [Como a projeção funciona](#como-a-projeção-funciona)
- [Privacidade e dados](#privacidade-e-dados)
- [Tecnologias](#tecnologias)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Requisitos](#requisitos)
- [Limitações conhecidas](#limitações-conhecidas)
- [Licença](#licença)

## Funcionalidades

- **Lançamento de valores:** formulário com tipo (entrada ou saída), descrição, valor, data e categoria. Dá para marcar o lançamento como mensal (salário, aluguel, assinaturas) para que ele se repita automaticamente.
- **Dashboard:**
  - saldo de hoje, entradas, saídas e resultado do mês, com comparação ao mês anterior;
  - gráfico de barras de entradas e saídas por mês, com os próximos 6 meses projetados;
  - gráfico de saldo acumulado com projeção tracejada e faixa de incerteza;
  - saídas do mês por categoria, com o limite de orçamento marcado;
  - tendências: saldo previsto em 3 e 6 meses e médias previstas de entradas e saídas.
- **Avisos:** alertas classificados como Crítico, Atenção, Positivo e Info. Exemplos: saldo previsto negativo, saídas maiores que as entradas, saídas em alta, orçamento estourado e categoria fora do seu padrão.
- **Lançamentos:** lista filtrável por mês, tipo e texto, com edição, exclusão e opção de desfazer.
- **Orçamentos:** limite mensal por categoria de saída, com barra de progresso. O aviso aparece ao passar de 80%.
- **Planilhas XLSX:** exporta tudo para uma planilha e importa lançamentos de uma planilha preenchida no Excel.
- **Backup e exportação:** backup em JSON e exportação em CSV.
- **Tema claro e escuro**, automático ou escolhido por você.
- **Layout responsivo**, para computador e celular.
- **Acessibilidade:** os gráficos têm legenda, tooltips e uma visão em tabela, e os avisos usam ícone e texto além da cor.

## Como usar

### Abrir o site

Não há etapa de instalação nem de build. Duas opções:

1. Dê duplo clique em `index.html`.
2. Ou sirva a pasta por HTTP, se preferir:

   ```bash
   python -m http.server 8000
   ```

   Depois acesse <http://localhost:8000>.

### Primeiros passos

1. Clique em **Entrada** ou **Saída** no topo da tela e preencha o formulário.
2. Se o valor se repete todo mês, marque **Repete todo mês**.
3. Em **Ajustes**, informe o **saldo inicial**, isto é, quanto você tinha antes do primeiro lançamento.
4. Em **Orçamentos**, defina limites por categoria, se quiser receber avisos de gasto.
5. Volte ao **Dashboard** para ver gráficos, avisos e tendências.

Para conhecer a aplicação sem digitar nada, clique em **Carregar dados de exemplo** na tela inicial vazia ou em **Ajustes**. Isso substitui os dados atuais.

## Planilhas XLSX

Em **Ajustes** (e na tela **Lançamentos**) há três ações:

- **Gerar planilha com meus dados:** baixa um `.xlsx` com quatro abas:

  | Aba | Conteúdo |
  | --- | --- |
  | Lançamentos | Data, Tipo, Descrição, Categoria, Valor e Mensal |
  | Resumo mensal | Entradas, saídas, resultado e saldo de cada mês, reais e projetados |
  | Orçamentos | Limite mensal por categoria |
  | Configurações | Saldo inicial |

- **Baixar modelo para preencher:** planilha de exemplo com instruções, pronta para você editar no Excel.
- **Importar planilha:** lê o arquivo e mostra um resumo antes de aplicar. Você escolhe entre:
  - **Adicionar aos atuais:** lançamentos idênticos aos que já existem são ignorados, então importar a mesma planilha duas vezes não duplica nada;
  - **Substituir tudo:** apaga os dados atuais e fica só com os da planilha.

Regras da importação:

- A aba de lançamentos precisa ter as colunas **Data** e **Valor**. As colunas são reconhecidas pelo nome do cabeçalho, em qualquer ordem. Tipo, Descrição, Categoria e Mensal são opcionais.
- **Data:** aceita datas do Excel e texto nos formatos `10/11/2026` ou `2026-11-10`.
- **Valor:** aceita número ou texto como `1.234,56` e `R$ 80,00`.
- **Tipo:** `Entrada` ou `Saída`. Sem a coluna Tipo, valores negativos viram saídas.
- **Mensal:** `Sim` ou `Não`.
- Linhas inválidas são ignoradas e listadas no resumo da importação.
- As abas opcionais **Orçamentos** e **Configurações** (saldo inicial) também são lidas, quando existem.
- Limite de 10 MB por arquivo.

## Como a projeção funciona

A projeção cobre os próximos 6 meses e usa três regras simples:

1. **Lançamentos mensais** entram exatamente, mês a mês.
2. **Lançamentos avulsos** seguem a média dos meses completos já registrados, ajustada por uma tendência linear. Essa tendência é limitada a ±10% da média por mês, para evitar extrapolações exageradas.
3. **Lançamentos avulsos já agendados** para meses futuros prevalecem sobre a estimativa quando forem maiores.

A **faixa provável** do gráfico de saldo cresce com a variação histórica do resultado mensal e com a raiz do número de meses à frente. O dashboard informa a confiança da previsão (baixa, média ou alta) conforme a quantidade de meses completos disponíveis. Com menos de 2 meses completos, a projeção é apenas uma estimativa.

A projeção é uma estimativa para apoiar decisões, não uma garantia.

## Privacidade e dados

- Nenhum dado sai do seu navegador: não há servidor, conta nem rastreamento.
- Os lançamentos ficam no `localStorage` do navegador, na chave `controle-financeiro:v1`.
- Limpar os dados do site no navegador apaga tudo. Faça backups em **Ajustes** de vez em quando.
- Dados e backups importados são validados antes de serem usados, e os textos são escapados antes de aparecer na tela.

## Tecnologias

- HTML, CSS e JavaScript puros, sem frameworks, sem dependências e sem etapa de build.
- Gráficos desenhados em SVG por código próprio.
- Leitor e gravador de `.xlsx` próprios, em [js/xlsx.js](js/xlsx.js): um XLSX é um ZIP de arquivos XML. A descompactação usa o `DecompressionStream` nativo do navegador.

## Estrutura do projeto

```text
controle-financeiro/
├── index.html          # estrutura das telas e diálogos
├── css/
│   └── style.css       # tema claro/escuro e layout responsivo
├── js/
│   ├── core.js         # datas, moeda, categorias, armazenamento e dados de exemplo
│   ├── forecast.js     # projeção dos próximos meses e geração dos avisos
│   ├── charts.js       # gráficos em SVG e tooltips
│   ├── xlsx.js         # leitor e gravador de arquivos .xlsx
│   ├── sheetio.js      # conversão entre planilha e dados do app
│   └── app.js          # interface: navegação, dashboard, formulários
├── docs/
│   └── dashboard.png   # imagem usada neste README
└── README.md
```

Os scripts são carregados na ordem em que aparecem no `index.html`, sem módulos ES, para que o site funcione também aberto direto pelo arquivo.

## Requisitos

Navegador atual: Chrome, Edge, Firefox ou Safari em versões recentes. A leitura de planilhas `.xlsx` depende do `DecompressionStream`, com formato `deflate-raw`, disponível a partir do Chrome 103, Firefox 113 e Safari 16.4. Sem ele, o resto do site funciona, mas a importação de planilhas não.

## Limitações conhecidas

- Os dados ficam só em um navegador. Para usar em outro aparelho, exporte um backup e restaure lá.
- Lançamentos mensais se repetem indefinidamente a partir da data inicial. Para encerrar um, apague-o.
- A planilha exportada traz valores calculados, não fórmulas.
- Existe apenas a moeda real (BRL).

## Licença

Nenhuma licença foi definida até o momento. Sem uma licença, todos os direitos permanecem com o autor.
