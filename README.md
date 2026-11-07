# ⚔️ Aethelgard Online — protótipo de MMORPG 2D

Protótipo de MMORPG 2D top-down (visão de cima, tiles), jogável no navegador, inspirado no estilo
*grind de monstros + troca de estilo de combate + PvP opcional* dos MMOs mobile clássicos.
Nome, mundo, monstros, balanceamento e código são **originais**.

## Como rodar no VS Code

1. Instale o [Node.js](https://nodejs.org) (versão 18 ou superior).
2. Abra esta pasta no VS Code (`File > Open Folder`).
3. Abra o terminal (`Ctrl + '`) e rode:
   ```bash
   npm install
   npm start
   ```
4. Abra **http://localhost:3000** no navegador. Abra uma segunda aba (ou outro navegador) com outra conta
   para testar o multiplayer.
5. Para depurar: aperte **F5** (já existe `.vscode/launch.json`). Para recarregar o servidor ao salvar: `npm run dev`.

Para jogar com amigos na mesma rede Wi-Fi, use `http://SEU_IP_LOCAL:3000`.

## Controles

| Ação | PC | Celular |
|---|---|---|
| Andar | `WASD` / setas | direcional na tela |
| Atacar | clique no monstro (ataque automático ao alcance) | toque no monstro |
| Trocar estilo | `1` Espada · `2` Arco · `3` Cajado | botões na barra |
| Habilidade especial | `Espaço` | botão ✨ |
| Poção de vida / mana | `Q` / `E` | botões ❤️ 💧 |
| Chat | `Enter` | — |

## Mecânicas do protótipo

- **3 estilos de combate** (troque a qualquer hora): Espada (corpo a corpo), Arco (distância), Cajado (magia, gasta mana).
- **Treino por uso**: cada estilo tem sua habilidade (Espada, Arco, Magia) que sobe ao atacar; **Defesa** sobe ao apanhar.
- **Nível do personagem** por XP (aumenta vida e mana).
- **Habilidade especial** por estilo: Giro, Chuva de Flechas, Nova Arcana.
- **Mundo por anéis de dificuldade**: Vila segura → Planícies → Deserto → Terras Sombrias (8 tipos de monstros, 1 mini-boss).
- **Loja** na vila: armas (4 níveis por estilo), armaduras e poções.
- **PvP opcional** (botão ☠): atacar quem não está marcado deixa você **marcado** (nome vermelho) por 1 min; matar um marcado não tem penalidade.
- **Morte**: perde 5% do ouro e volta para a vila.
- **Contas e progresso salvos** em `data/players.json`.
- **Chat global**, minimapa, números de dano e efeitos visuais.

## Estrutura

```
server/data.js    → mapa, monstros, armas, armaduras (balanceamento)
server/game.js    → regras do jogo: movimento, combate, IA, loot, progressão
server/index.js   → HTTP + WebSocket + login + salvamento
public/client.js  → renderização no canvas, entrada, interface
public/index.html, style.css
```

O servidor é **autoritativo**: o cliente só envia intenções (andar, alvo, estilo) e o servidor calcula tudo,
o que dificulta trapaças.

## Ideias para evoluir

- Trocar sprites desenhados por código por **spritesheets** (ex.: pacotes gratuitos do itch.io / Kenney.nl).
- Inventário com itens dropados e equipamentos com raridade.
- Missões, NPCs com diálogo, guildas, troca entre jogadores.
- Substituir o JSON por **SQLite** ou **PostgreSQL**.
- Dividir o mundo em mapas/salas, adicionar cavernas e dungeons.
- Pathfinding (A*) para tocar no chão e o personagem andar até lá.
- Sons e música; animações de sprite por direção.
- Hospedar em uma VPS / Railway / Render (o servidor lê a porta de `PORT`).
