import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Conteudo em duas camadas:
// - content/<tipo>/  -> o que vem do repositorio (licoes e musicas "de fabrica")
// - data/<tipo>/     -> o que o painel cria ou edita. data/ e o volume do Docker,
//                       entao sobrevive a cada `update-vps.sh` (que reconstroi o
//                       container a partir do GitHub e apagava o que o painel salvava
//                       direto em content/).
// Um arquivo em data/ com o mesmo id substitui o de fabrica; { deleted: true }
// esconde um item de fabrica sem apagar o arquivo do repositorio.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function readDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).flatMap((f) => {
    try { return [JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"))]; } catch { return []; }
  });
}

export function contentStore(type) {
  const builtinDir = path.join(ROOT, "content", type);
  const customDir = path.join(ROOT, "data", type);
  const fileFor = (dir, id) => {
    if (!/^[a-z0-9-]+$/.test(String(id))) throw new Error("id invalido");
    return path.join(dir, `${id}.json`);
  };

  return {
    list() {
      const byId = new Map();
      for (const item of readDir(builtinDir)) byId.set(item.id, { ...item, builtin: true });
      for (const item of readDir(customDir)) byId.set(item.id, { ...(byId.get(item.id) ?? {}), ...item, builtin: byId.has(item.id) });
      return [...byId.values()].filter((item) => !item.deleted);
    },
    save(item) {
      fs.mkdirSync(customDir, { recursive: true });
      const { builtin, ...clean } = item;
      const file = fileFor(customDir, clean.id);
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(clean, null, 2) + "\n");
      fs.renameSync(tmp, file);
      return clean;
    },
    remove(id) {
      const isBuiltin = fs.existsSync(fileFor(builtinDir, id));
      if (isBuiltin) return this.save({ id, deleted: true });
      const custom = fileFor(customDir, id);
      if (!fs.existsSync(custom)) throw new Error("nao encontrado");
      fs.unlinkSync(custom);
    },
  };
}
