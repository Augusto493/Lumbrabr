# Mel — MVP de conversação em inglês com IA

App de prática de inglês por voz com uma tutora de IA mal-humorada (a Mel),
inspirado na estrutura do Oddi, feito pra rodar gastando quase nada: uma VPS
simples e a API do Gemini.

## Como funciona

- **Backend**: Node.js + Express + WebSocket puro. Sem banco de dados de
  verdade — usuários e progresso ficam em arquivos JSON em `data/`. Dá pra
  trocar por Postgres/SQLite depois.
- **IA de voz**: [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api)
  (`@google/genai`). O navegador manda o microfone em tempo real pro backend,
  que repassa pro Gemini; áudio + transcrição voltam pelo mesmo caminho. Um
  único modelo faz reconhecimento de fala + conversa + voz.
- **Frontend**: HTML/CSS/JS puro, sem build step. Layout mobile-first (coluna
  de 390px centralizada no desktop), tema escuro, fontes Bricolage Grotesque /
  DM Sans / DM Mono (Google Fonts) e ícones [Phosphor](https://phosphoricons.com)
  (MIT).
- **Mascote**: a Mel é feita só com CSS/SVG (`public/mascot.js`): esfera com
  gradiente, anel de barras girando, rosto que pisca e muda de humor
  (`grumpy`, `neutral`, `happy`, `talking`, `listening`). A cor dela são 4
  variáveis no topo de `public/style.css` (`--mascot*`).
- **Conteúdo**: lições em JSON em `content/lessons/` (aquecimento → conversa
  livre → revisão). Lição nova = arquivo novo, sem tocar em código.

## Voz da Mel nas telas de entrada

As telas de intro, perguntas, plano e login tocam clipes pré-gerados na voz
da Mel (`public/audio/*.wav`), com botão de som no topo (a escolha fica
salva). A Mel tenta falar assim que a tela abre; Chrome e Safari bloqueiam
som antes do primeiro gesto do usuário na página, então quando isso
acontece a fala fica pendente e dispara no primeiro toque/clique/tecla em
qualquer lugar — a partir daí todas as telas tocam sozinhas. Tocar na Mel
repete a fala.

Pra regenerar os clipes (ou mudar as falas em `LINES`):

```bash
node scripts/gerar-audio.mjs            # todos
node scripts/gerar-audio.mjs intro1 login   # só alguns
```

Usa a mesma Gemini Live API do app, então gasta o mesmo free tier — o
script espera 7 s entre clipes por causa do limite por minuto.

## Painel admin

`/admin` — duas formas de entrar: (1) coloque seu e-mail em `ADMIN_EMAIL`
no `.env` e crie/entre na conta com esse e-mail no app — aparece um botão
"painel" na home e o `/admin` abre direto; (2) a senha única
`ADMIN_PASSWORD`, pra entrar sem conta. Mostra usuários
(nível, tom, o que trava, lições, minutos, último acesso), minutos de
conversa por lição, últimas sessões e o custo estimado de IA (R$ 0,07/min
no tier pago). Os dados vêm de `data/users.json`, `data/progress.json` e
`data/sessions.json` (cada conversa de voz é registrada ao terminar).

O painel tem seis abas, numa barra lateral com ícones (empilha no topo em
telas estreitas): **visão geral** (KPIs, receita, custo de IA),
**usuários** (editar nome, papel, nível/tom/trava, plano manual com data,
nova senha, bloquear, excluir), **lições** (gerar com IA, publicar,
esconder, excluir), **planos** (criar/editar/desativar), **pagamentos**
(status do Pix e pedidos) e **configurações** (ver abaixo).

## Configurações pelo painel (sem editar o `.env`)

A aba **Configurações** expõe e edita, em grupos, tudo que hoje vive no
`.env` — Gemini (chave, modelo de voz, modelo de texto, modelos reserva),
acesso ao painel (e-mails admin, senha única), limite de minutos grátis,
Pix/PagBank (token, ambiente, URL pública) e o segredo de sessão (JWT).
Campos de segredo (chave do Gemini, senha do painel, token do PagBank,
JWT) nunca voltam em texto puro pro navegador — só mostram se estão
configurados e os últimos 4 caracteres; deixar em branco mantém o valor
atual.

Os valores ficam em `data/settings.json` (nunca versionado) e têm
prioridade sobre o `.env`, então a maioria das trocas vale **na hora**,
sem reiniciar o servidor. As duas exceções são `JWT_SECRET` e
`GEMINI_API_KEY`, que precisam existir no `.env` só na primeira vez que o
servidor sobe (pra existir algo com que assinar o primeiro login) — depois
disso também podem ser trocadas pelo painel. Trocar o `JWT_SECRET` desloga
todo mundo, você incluso; o painel te dá um token novo automaticamente
pra não te jogar pra fora no meio da troca.

## Planos, limite diário e Pix

- Cada plano define **minutos por dia** com a Mel, preço e duração em dias
  (`data/plans.json`, editável no painel). Quem não assinou tem
  `FREE_MINUTES_PER_DAY` (padrão 3). O servidor corta a sessão de voz
  quando a cota do dia acaba e o app mostra os planos.
- Pagamento por **Pix via PagBank (PagSeguro)**: o app pede nome, CPF e
  celular (exigência da API), cria o pedido (`POST /orders` com
  `charges[].payment_method.type = "PIX"`), mostra QR code + copia e cola
  e consulta o status a cada 4 s. Com `PUBLIC_URL` https configurada, o
  PagBank também avisa por webhook (`/api/pay/webhook`, assinatura SHA-256
  conferida no header `x-authenticity-token`); em todo caso o status é
  reconfirmado em `GET /orders/{id}` antes de liberar o plano.
- Configuração no `.env`: `PAGBANK_TOKEN` (crie em PagBank → Vender online
  → Integrações; use o token de **sandbox** pra testar) e `PAGBANK_ENV`
  (`sandbox` ou `production`). Sem token, o app mostra os planos mas avisa
  que o Pix ainda não está liberado.

## Gerar lições com IA

Na aba **lições** do painel: escolha o nível (A0–C1), um tema opcional e
clique em *gerar lição*. O servidor pede ao Gemini (`GEMINI_TEXT_MODEL`,
padrão `gemini-3.6-flash`) uma lição no formato exato das existentes, com
um erro típico de brasileiro pra Mel caçar. Você vê a prévia e só
**publica** se gostar — aí vira um arquivo em `content/lessons/` e
aparece pros alunos. Lições podem ser escondidas (botão *visível*) ou
excluídas.

## Currículo

15 lições em `content/lessons/`, de A0 a C1, agrupadas na home por nível:

- **Iniciante (A0–A1)**: primeira conversa guiada, se apresentar, small
  talk, pedir comida
- **Básico (A2)**: there is/have, preposições de tempo, perguntas com do,
  contar o que aconteceu
- **Intermediário (B1)**: present perfect, falsos amigos, dar opinião
- **Avançado (B2–C1)**: entrevista de emprego, hipóteses (e se…), contar
  uma história, negociar e convencer

Cada lição é um JSON com `focus`, `warmup` (instrução + frases-alvo com
tradução), `freeConversation` e `review` — a Mel recebe isso como roteiro.

## Fluxo do app

1. **Intro** (3 slides) → **prova social** → **3 perguntas** (como prefere
   ouvir, nível de inglês, o que te trava) → **plano** (rotina diária + "em N
   semanas você vai…") → **criar conta / entrar**.
2. As respostas do onboarding viram o `profile` do usuário e entram no prompt
   da Mel: nível ajusta o ritmo e a quantidade de inglês; o "bloqueio"
   (vergonha, congelo, não sei por onde começar, falta gente) ajusta como ela
   corrige.
3. **Home**: a Mel recebe o aluno com uma frase ranzinza e mostra a
   **trilha de cenários** — bolinhas com ícone ligadas por linha tracejada,
   a lição da vez com anel branco e etiqueta "HOJE", as concluídas marcadas,
   as próximas apagadas, o nome de cada cenário embaixo da bolinha,
   divisórias por nível. Tocar numa bolinha já entra na aula.
4. **Conversa**: é uma ligação contínua numa tela limpa — só a Mel no
   centro e, quando ela dita algo, a frase em inglês (grande) com a
   tradução embaixo. Sem botão de microfone, sem transcrição, sem status:
   o microfone abre sozinho quando a sessão fica pronta e a Mel cresce um
   pouco quando ouve a voz do aluno. O Gemini detecta os turnos e, se o
   aluno falar por cima, a Mel para na hora (o áudio pendente é
   descartado). A frase fica na tela até a Mel ditar outra (só esmaece
   quando ela fala sem ditar). A seta no topo sai da aula; uma conversa de
   90 s ou mais conta como lição concluída. O prompt manda a Mel obedecer
   pedidos de ritmo ("fala mais devagar", "repete", "não entendi") na hora
   e manter o ritmo lento até o aluno liberar.

   Latência: a sessão do Gemini Live é aberta com `thinkingBudget: 0`
   (sem "pensar" antes de falar — com o padrão a primeira palavra levava
   5–7 s; agora ~1 s) e com detecção de fim de fala em sensibilidade alta
   (`silenceDurationMs: 500`), então a Mel responde ~1 s depois que o
   aluno para de falar. A abertura da aula é limitada a duas frases mais a
   primeira frase pra repetir.

   Detalhe técnico que já deu dor de cabeça: os dois `AudioContext`
   (captura e playback) são criados **dentro do clique** que abre a aula.
   Criados depois, fora de um gesto do usuário, o Chrome os deixa
   suspensos e o microfone "ouve" em silêncio — a Mel fala, mas nada do
   aluno chega ao Gemini.

> Os depoimentos da tela de prova social são **exemplos** (estão marcados na
> própria tela). Troque por alunos reais em `TESTIMONIALS` no `public/app.js`
> antes de divulgar — depoimento inventado apresentado como real é propaganda
> enganosa.

## Persona da Mel

Definida em `buildSystemInstruction` (`server/lessons.js`): ensina
principalmente em português e usa inglês só nas frases-alvo. O aluno
escolhe o modo no onboarding (pergunta "como você quer que eu fale com
você?"), salvo em `profile.tone`:

- **braba** (padrão): quando o aluno erra, ela xinga e debocha (porra,
  caralho, seu preguiçoso…) e *imediatamente* repete a frase certa em inglês
  e manda repetir; cobra quando ele foge pro português ou responde uma
  palavra só; elogia de má vontade quando acerta.
- **de boa**: mesma cara de poucos amigos, humor seco, sem palavrão.

O prompt tem limite explícito nos dois modos: nunca ataca aparência, corpo,
inteligência de verdade, gênero, raça, orientação, religião, sotaque ou
deficiência, e baixa o tom se o aluno mostrar que está mal. Esse limite é o
que mantém o app engraçado sem virar caso de banimento na loja.

Quando a Mel dita uma frase, ela usa o formato `Diz: <inglês>. Em
português: <tradução>.` — o app detecta isso na transcrição e mostra o card
"o que responder" na tela de conversa.

## Rodando local

```bash
cd ingles-ai
npm install
cp .env.example .env
# edite o .env: GEMINI_API_KEY e um JWT_SECRET aleatorio
npm start
```

Abra `http://localhost:3000`. O navegador libera microfone em `localhost`
sem HTTPS.

> **Modelo do Gemini Live**: o nome muda com frequência (preview → GA). Se
> `GEMINI_LIVE_MODEL` do `.env.example` parar de funcionar, veja o nome
> atual em [ai.google.dev/gemini-api/docs/live-api](https://ai.google.dev/gemini-api/docs/live-api)
> e troque no `.env`.

## Limite do plano grátis do Gemini

A API grátis tem limite de requisições por minuto/dia (e o Live API/áudio
costuma ser mais restrito). Serve pra validar com poucos usuários, mas
**vai bloquear se crescer** — aí é migrar pro tier pago (por uso, sem
mensalidade) ou limitar minutos de conversa por dia por usuário. Limites
atuais: [ai.google.dev/gemini-api/docs/rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits).

## Deploy na VPS com Docker + Traefik (jeito usado em produção)

É como o app roda hoje em `https://mel.179.197.235.4.sslip.io`, numa VPS
que já tinha Traefik v3 (`network_mode: host`, Let's Encrypt) servindo
outros containers. Nada fora da pasta do app foi alterado.

```bash
mkdir -p /docker/mel && cd /docker/mel
# copie o conteúdo de ingles-ai/ pra cá (git clone ou scp)
cp .env.example .env            # preencha GEMINI_API_KEY, JWT_SECRET, ADMIN_EMAIL, PUBLIC_URL
cp docker-compose.example.yml docker-compose.yml   # ajuste o Host(...) e a subnet
docker compose up -d --build
docker logs -f mel-app          # deve mostrar "Mel ouvindo em http://0.0.0.0:3000"
```

- Os dados (`users.json`, `progress.json`, `sessions.json`, `plans.json`,
  `orders.json`, `settings.json`) ficam no volume `mel_mel_data`, então
  `docker compose up -d --build` atualiza o código sem perder nada.
- Pra atualizar: `bash /docker/mel/update-vps.sh` (baixa o branch do
  GitHub, copia por cima e reconstrói; aceita o nome do branch como
  argumento). Se o repositório for privado, o `git clone` vai pedir
  usuário e token.
- Pra usar um domínio próprio: aponte um registro A pro IP da VPS, troque o
  `Host(...)` nas labels e o `PUBLIC_URL` no `.env` (ou no painel), e suba
  de novo — o Traefik pega o certificado sozinho.
- Se o `docker compose up` reclamar de "address pools have been fully
  subnetted" ou "Pool overlaps", mude a `subnet` no final do compose pra
  uma faixa livre (`ip route` mostra as usadas).

## Deploy na VPS (sem Docker)

Pressupõe Ubuntu/Debian com Node.js 18+.

1. Clone o repositório e configure o `.env` como acima.
2. Mantenha o processo vivo com PM2:
   ```bash
   npm install -g pm2
   pm2 start server/index.js --name mel
   pm2 save && pm2 startup
   ```
3. Nginx como proxy reverso (`/etc/nginx/sites-available/mel`):
   ```nginx
   server {
     listen 80;
     server_name seu-dominio.com.br;
     location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_read_timeout 90s;
     }
   }
   ```
   ```bash
   ln -s /etc/nginx/sites-available/mel /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   ```
4. HTTPS grátis (obrigatório: o navegador só libera microfone em HTTPS fora
   do localhost):
   ```bash
   apt install certbot python3-certbot-nginx
   certbot --nginx -d seu-dominio.com.br
   ```

## O que ainda não tem

- Cartão de crédito (só Pix), streak, notificações, analytics.
- Banco de dados de verdade (JSON em arquivo aguenta poucos usuários
  simultâneos).
- Recuperação de senha.
