const { REST, Routes } = require("discord.js");
const config = require("./config");
const commands = require("./commands");

const rest = new REST({ version: "10" }).setToken(config.discordToken);

async function main() {
  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: commands }
  );
  console.log("Slash commands deployed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
