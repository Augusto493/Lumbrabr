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

O painel tem sete abas, numa barra lateral com ícones. No celular (≤ 760
px) ele vira coluna única: a nav fica fixa no topo rolando de lado, as
tabelas viram cartões (cada célula ganha o título da coluna via
`data-label`, preenchido por `labelTables()` em `admin.js`), o modal de
edição vira uma folha que sobe de baixo e os botões de ação ocupam a
largura toda. As abas: **visão geral** (KPIs, receita, custo de IA),
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

## Lançamento: os primeiros N ganham grátis

Com `LAUNCH_PROMO_ENABLED=sim` (padrão), os primeiros `LAUNCH_PROMO_SLOTS`
cadastros (100) ganham automaticamente `LAUNCH_PROMO_MINUTES` (3) por dia
durante `LAUNCH_PROMO_DAYS` (30). A tela inicial mostra "**N vagas**
restantes", a conta nova cai numa tela "você entrou no lançamento — vaga
nº X" e o chip da home mostra "Lançamento · 3 min/dia · até dd/mm". Tudo
ajustável em **/admin → Configurações → Promoção de lançamento**; o admin
também dá/tira a promoção de uma conta específica na edição do usuário.
Quando a promoção acaba (ou as vagas), a conta volta pra cota
`FREE_MINUTES_PER_DAY` normal.

Prioridade do direito de uso (`entitlement`): plano pago → promoção →
grátis. Por cima disso existe um **saldo de minutos bônus** (indicações e
missões) que só é consumido quando a cota do dia acaba.

## Indique e ganhe + missões (motor viral)

- Cada conta tem um código (`refCode`) e um link `PUBLIC_URL/?ref=CODE`.
  Quem entra pelo link ganha `REF_WELCOME_MINUTES` (5) na hora; quem
  indicou ganha `REF_REWARD_MINUTES` (10) **quando o indicado faz a
  primeira aula** (≥ 90 s) — assim conta fake não gera bônus.
- Tela **Indique e ganhe** (faixa na home e no menu): link, botão do
  WhatsApp, compartilhar nativo, contadores (convidados, fizeram aula,
  minutos ganhos, bônus atual) e as **missões**: *story marcando a Mel*
  (+15 min, a cada 7 dias) e *post/vídeo* (+30 min, a cada 30 dias). O
  aluno manda o print (comprimido no navegador a 1280 px, JPEG) e opcional
  o link; o print fica em `data/uploads/` e entra na fila.
- **Card de compartilhamento pós-aula**: ao sair de uma aula com 1 min ou
  mais, o app gera um card 1080×1920 no canvas ("Sobrevivi a N min com a
  Mel", frase da Mel, vagas restantes e o link de indicação) com botão de
  compartilhar (Web Share com arquivo, no celular) ou salvar.
- **Painel → Viral**: vagas da promoção, fila de prints com miniatura e
  botões aprovar/recusar (aprovar credita na hora; recusar pede motivo que
  o aluno vê), ranking de quem mais indica, histórico. Prêmios em
  **Configurações → Indique e ganhe / missões**.

## Velocidade e robustez (pré-lançamento)

- Gravação dos JSON é atômica (temp + rename); e-mails normalizados em
  minúsculas; erro de rota vira 500 em JSON (não derruba o processo);
  `uncaughtException` sai com código 1 e o Docker reinicia.
- gzip nas respostas de texto, ETag + revalidação em JS/CSS, 1 dia de
  cache em áudio/imagens, cabeçalhos de segurança, `trust proxy` (IP real
  atrás do Traefik), keep-alive de 65 s.
- Limite de tentativas por IP em login/cadastro (40 por 10 min), no login
  do painel (10) e no envio de prints (60/h).
- Voz: teto de conversas simultâneas (`MAX_CONCURRENT_VOICE`, padrão 20)
  com aviso "a Mel está com muita gente" em vez de erro da API; ping no
  WebSocket a cada 25 s; se a ligação cair no meio da aula o app reconecta
  sozinho uma vez, e tocar na Mel tenta de novo; erro 429 do Gemini vira a
  mesma mensagem amigável. O log do container mostra sessões simultâneas.
- **Tier do Gemini**: o plano grátis limita sessões simultâneas e
  requisições por dia. Com dezenas de pessoas ao mesmo tempo vai dar 429.
  Antes de abrir pro público, ative faturamento no projeto do AI Studio
  (o custo continua ≈ R$ 0,07 por minuto de conversa) e suba
  `MAX_CONCURRENT_VOICE` no painel.

## Planos, limite diário e Pix

- Cada plano define **minutos por dia** com a Mel, preço e duração em dias
  (`data/plans.json`, editável no painel). Quem não assinou tem
  `FREE_MINUTES_PER_DAY` (padrão 3). O servidor corta a sessão de voz
  quando a cota do dia acaba e o app mostra os planos.
- Pagamento por **Pix via AbacatePay** (`server/abacatepay.js`): sem
  formulário — escolheu o plano, o app cria a cobrança
  (`POST /v2/transparents/create`, `method: "PIX"`, valor em centavos,
  `expiresIn` 30 min, `externalId` = referência do pedido), mostra o QR
  (`brCodeBase64`) + copia e cola (`brCode`) e consulta
  `GET /v2/transparents/check?id=` a cada 4 s. Status `PAID` libera o
  plano; `EXPIRED/CANCELLED/FAILED` encerram o pedido.
- Webhook (opcional, deixa a liberação instantânea): em AbacatePay →
  Integração → Webhooks, cadastre `<PUBLIC_URL>/api/pay/webhook` com o
  evento `transparent.completed` e um segredo; cole o mesmo segredo em
  `ABACATEPAY_WEBHOOK_SECRET`. A AbacatePay manda o segredo em
  `?webhookSecret=`; o app confere e, em todo caso, **reconfirma o status
  na API** antes de liberar — o corpo do evento só serve pra achar o
  pedido.
- Chave: `ABACATEPAY_API_KEY` (abacatepay.com → Integração → Chaves de
  API). A mesma URL serve pra teste e produção — quem define é a chave:
  chave criada em **Dev mode** gera Pix simulado (`devMode: true`) e o app
  mostra o botão "simular pagamento", que chama
  `POST /v2/transparents/simulate-payment`; chave de produção cobra de
  verdade. Sem chave, o app mostra os planos mas avisa que o Pix ainda não
  está liberado.

## Gerar lições com IA

Na aba **lições** do painel: escolha o nível (A0–C1), um tema opcional e
clique em *gerar lição*. O servidor pede ao Gemini (`GEMINI_TEXT_MODEL`,
padrão `gemini-3.6-flash`) uma lição no formato exato das existentes, com
um erro típico de brasileiro pra Mel caçar. Você vê a prévia e só
**publica** se gostar — aí vira um arquivo em `content/lessons/` e
aparece pros alunos. Lições podem ser escondidas (botão *visível*) ou
excluídas.

> **Nomes de modelo mudam sem aviso.** A família `gemini-2.5-*` (incluindo
> `-lite`) já não está disponível pra chaves de API novas — só continua
> funcionando pra quem já usava antes. Se `GEMINI_TEXT_MODEL` ou algum
> nome em `GEMINI_TEXT_FALLBACKS` sumir, a lição volta com "o Gemini não
> respondeu" citando o erro (404 = nome não existe mais; 503 = sobrecarga
> temporária, o próprio retry resolve). Troque em Configurações → IA sem
> reiniciar; confira os nomes atuais pra sua chave em
> [ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models)
> ou chamando `GET /v1beta/models?key=SUACHAVE`.

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

   Porta de voz: o navegador **só envia áudio quando detecta voz** (piso de
   ruído adaptativo, ~340 ms de pré-rolo pra não cortar a primeira sílaba,
   700 ms de folga depois da última voz e então `audioStreamEnd`). Mandar
   silêncio contínuo parecia inofensivo, mas numa VPS com rota lenta até o
   Google a fila servidor → Gemini enchia e a fala do aluno chegava tarde
   ou nunca (medido: local respondia em 2 s, VPS não respondia em 20 s;
   sem o fluxo de silêncio, a VPS respondeu em 0,6–2,6 s). Enquanto a Mel
   fala, o limiar sobe 60% pra o eco das caixas não interromper ela à toa.
   O servidor loga um resumo por sessão (`[voz] … audio aluno N chunks`)
   pra dar pra ver no `docker logs` se o áudio do aluno está chegando.

   Latência: a sessão do Gemini Live é aberta com `thinkingBudget: 0`
   (sem "pensar" antes de falar — com o padrão a primeira palavra levava
   5–7 s) e com detecção de fim de fala em sensibilidade alta
   (`silenceDurationMs: 400`; a porta de voz do navegador fecha em 550 ms,
   depois do detector). A abertura da aula é limitada a duas frases mais a
   primeira frase pra repetir. Se o primeiro turno terminar sem áudio
   (alguns modelos respondem ao empurrão de abertura só em texto), o
   servidor dá um segundo empurrão por `sendRealtimeInput`.

   Modelos medidos pelo caminho real (fala do aluno → primeira palavra da
   resposta), setembro/2026: `gemini-2.5-flash-native-audio-preview-12-2025`
   ≈ 1,0–1,2 s; `gemini-3.1-flash-live-preview` ≈ 0,7 s (e abertura em
   0,6–1,1 s). `gemini-3.8-live` ficou instável (turnos sem áudio, sem
   resposta ao aluno). O modelo é trocado em Painel → Configurações →
   Gemini → "Modelo de voz", sem reiniciar. Script de medição:
   `scripts/` não tem — foi feito ad hoc; o método está descrito acima.

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
- Domínio próprio (`heymel.online`): crie registros **A** pra `@` e `www`
  apontando pro IP da VPS, espere resolver (`nslookup heymel.online`),
  troque o `Host(...)` nas labels pelo do `docker-compose.example.yml` (já
  vem com apex + www + sslip, e redirect de www → apex), ajuste
  `PUBLIC_URL=https://heymel.online` no `.env` e `docker compose up -d`.
  O Traefik emite o certificado sozinho — só depois do DNS resolver, senão
  o Let's Encrypt falha pros três nomes.
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
