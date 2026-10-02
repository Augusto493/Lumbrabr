// Idiomas que a Mel ensina. Tudo que muda por idioma (nome, exemplos de bronca,
// avisos de pronuncia) mora aqui; o resto do sistema so passa o codigo ("en"/"es").

export const LANGUAGES = {
  en: {
    code: "en",
    name: "ingles",
    label: "Inglês",
    flag: "🇺🇸",
    // exemplos do registro da Mel no modo braba, ja no idioma-alvo
    scoldExamples: "'errou de novo, porra. para de chutar e copia: I have been working here for two years.' / 'terceira vez na mesma palavra, caralho. olha bem pra ela: intend. de novo.' / 'pelo amor de deus, have nao e there is. repete comigo: there is a problem with my order.' / 'seu preguicoso, tava indo tao bem. de novo.'",
    calmExample: "'quase. tenta de novo que eu fico aqui: There is a problem with my order.'",
    traps: "Erros classicos de brasileiro em ingles: 'have' no lugar de 'there is', falsos amigos (pretend, actually, push), esquecer o -s da terceira pessoa, o som do 'th', vogais longas vs curtas (ship/sheep).",
  },
  es: {
    code: "es",
    name: "espanhol",
    label: "Espanhol",
    flag: "🇪🇸",
    scoldExamples: "'errou de novo, porra. em espanhol nao e \"eu gosto de\", e me gusta. repete: me gusta el café.' / 'pelo amor de deus, embarazada e GRAVIDA, cacete. voce quis dizer avergonzada. de novo: estoy avergonzada.' / 'o leite e la leche, caralho, feminino. de novo: la leche está fría.' / 'seu preguicoso, isso e portunhol. fala direito: tengo que trabajar.'",
    calmExample: "'quase. lembra que em espanhol e me gusta, nao yo gusto. tenta de novo: Me gusta viajar.'",
    traps: "Erros classicos de brasileiro em espanhol (portunhol): 'yo gusto' em vez de 'me gusta', falsos cognatos (embarazada, exquisito, polvo, oficina, borrar, rato, apellido, largo), heterogenericos (la leche, el puente, la sal, el viaje), 'muy' vs 'mucho', esquecer o 'que' em 'tengo que', e pronuncia: jota aspirado (trabajo), 'll'/'y', 'rr' vibrante, nunca nasalizar vogais, 'z'/'c' (seseo e aceito).",
  },
};

export const DEFAULT_LANGUAGE = "en";

export function languageOf(code) {
  return LANGUAGES[code] ? code : DEFAULT_LANGUAGE;
}

export function lang(code) {
  return LANGUAGES[languageOf(code)];
}

// frase no idioma-alvo de um exemplo de licao: { en } nas de ingles, { es } nas de espanhol
export function targetOf(example) {
  return example?.target ?? example?.es ?? example?.en ?? "";
}
