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

## Fluxo do app

1. **Intro** (3 slides) → **prova social** → **3 perguntas** (como prefere
   ouvir, nível de inglês, o que te trava) → **plano** (rotina diária + "em N
   semanas você vai…") → **criar conta / entrar**.
2. As respostas do onboarding viram o `profile` do usuário e entram no prompt
   da Mel: nível ajusta o ritmo e a quantidade de inglês; o "bloqueio"
   (vergonha, congelo, não sei por onde começar, falta gente) ajusta como ela
   corrige.
3. **Home**: a Mel recebe o aluno com uma frase ranzinza e lista as lições.
4. **Conversa**: a Mel abre a aula sozinha em português; o aluno aperta
   *Falar* e pode deixar o microfone aberto — o Gemini detecta os turnos.

> Os depoimentos da tela de prova social são **exemplos** (estão marcados na
> própria tela). Troque por alunos reais em `TESTIMONIALS` no `public/app.js`
> antes de divulgar — depoimento inventado apresentado como real é propaganda
> enganosa.

## Persona da Mel

Definida em `buildSystemInstruction` (`server/lessons.js`): ensina
principalmente em português, usa inglês só nas frases-alvo, é impaciente e
debochada, solta palavrão leve quando o aluno erra ou trava — e tem limite
explícito no prompt: nunca ataca aparência, inteligência, gênero, raça ou
qualquer característica pessoal, e sempre entrega a frase certa depois da
piada. Esse limite é o que mantém o app engraçado sem virar caso de
banimento na loja.

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

- Pagamento/assinatura (Pix, cartão), streak, notificações, analytics.
- Banco de dados de verdade (JSON em arquivo aguenta poucos usuários
  simultâneos).
- Recuperação de senha.
