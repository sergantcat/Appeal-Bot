const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType, RoleSelectMenuBuilder, ChannelSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
require('dotenv').config();

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent] 
});

const read = (f) => JSON.parse(fs.readFileSync(`./${f}`, 'utf-8'));
const save = (f, d) => fs.writeFileSync(`./${f}`, JSON.stringify(d, null, 2));

client.once('ready', async () => {
    console.log(`🚀 Bot Online: ${client.user.tag}`);
    const guild = client.guilds.cache.first();
    await guild.commands.set([
        { name: 'setup', description: 'Deploy appeal buttons' },
        { name: 'config', description: 'Advanced bot configuration' }
    ]);
});

client.on('interactionCreate', async (interaction) => {
    let cfg = read('config.json');
    let db = read('appeals.json');

    // CONFIG COMMAND
    if (interaction.commandName === 'config') {
        const row1 = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('cfg_roles').setPlaceholder('Choose Staff Roles').setMinValues(1).setMaxValues(5));
        const row2 = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg_log').setPlaceholder('Choose Log Channel'));
        await interaction.reply({ content: '⚙️ **Advanced Settings Menu**', components: [row1, row2], ephemeral: true });
    }

    if (interaction.isRoleSelectMenu() && interaction.customId === 'cfg_roles') {
        cfg.adminRoles = interaction.values;
        save('config.json', cfg);
        return interaction.update({ content: '✅ Staff roles updated!', components: [] });
    }

    if (interaction.isChannelSelectMenu() && interaction.customId === 'cfg_log') {
        cfg.logChannel = interaction.values[0];
        save('config.json', cfg);
        return interaction.update({ content: '✅ Log channel updated!', components: [] });
    }

    // SETUP & OPEN APPEAL
    if (interaction.commandName === 'setup') {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('type_ban').setLabel('Ban Appeal').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('type_mute').setLabel('Mute Appeal').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('type_warn').setLabel('Warn Appeal').setStyle(ButtonStyle.Secondary)
        );
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle("Server Appeals").setDescription("Click a button below to appeal a punishment.").setColor(cfg.appealColor)], components: [row] });
    }

    if (interaction.isButton() && interaction.customId.startsWith('type_')) {
        const modal = new ModalBuilder().setCustomId(`modal_${interaction.customId}`).setTitle('Submit Appeal');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel("Your Explanation").setStyle(TextInputStyle.Paragraph).setRequired(true)));
        await interaction.showModal(modal);
    }

    // SUBMISSION HANDLER
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('modal_type_')) {
        const id = Math.random().toString(36).substring(2, 5).toUpperCase() + Math.floor(100 + Math.random() * 900);
        const reason = interaction.fields.getTextInputValue('reason');
        
        const logEmbed = new EmbedBuilder()
            .setTitle(`Appeal ID: ${id}`)
            .addFields({ name: "User", value: `<@${interaction.user.id}> (${interaction.user.id})` }, { name: "Explanation", value: reason })
            .setColor("Yellow").setTimestamp().setFooter({ text: "Status: Pending Review" });

        const btns = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`claim_${id}`).setLabel('Claim').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`decision_app_${id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`decision_den_${id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );

        const logChan = client.channels.cache.get(cfg.logChannel);
        if (logChan) await logChan.send({ embeds: [logEmbed], components: [btns] });

        db[id] = { userId: interaction.user.id, status: 'Pending' };
        save('appeals.json', db);
        await interaction.reply({ content: `✅ Submitted! ID: **${id}**`, ephemeral: true });
    }

    // STAFF ACTIONS (CLAIM/REASON MODAL)
    if (interaction.isButton() && (interaction.customId.startsWith('decision_') || interaction.customId.startsWith('claim_'))) {
        const parts = interaction.customId.split('_');
        const action = parts[1];
        const id = parts[2];

        if (!interaction.member.roles.cache.some(r => cfg.adminRoles.includes(r.id))) return interaction.reply({ content: "❌ Not Staff.", ephemeral: true });

        if (action === 'claim') {
            const claimEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setFooter({ text: `Claimed by ${interaction.user.tag}` });
            return interaction.update({ embeds: [claimEmbed] });
        }

        const modal = new ModalBuilder().setCustomId(`final_${action}_${id}`).setTitle(action === 'app' ? 'Accept Appeal' : 'Deny Appeal');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('staff_reason').setLabel("Staff Reason/Feedback").setStyle(TextInputStyle.Paragraph).setRequired(true)));
        await interaction.showModal(modal);
    }

    // FINAL DECISION (DMs & LOG UPDATE)
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('final_')) {
        const [, action, id] = interaction.customId.split('_');
        const staffReason = interaction.fields.getTextInputValue('staff_reason');
        const appeal = db[id];
        const user = await client.users.fetch(appeal.userId).catch(() => null);
        const statusText = action === 'app' ? 'ACCEPTED' : 'DENIED';

        if (user) {
            await user.send({ embeds: [new EmbedBuilder().setTitle(`Appeal ${statusText}`).setDescription(`**Appeal ID:** ${id}\n**Staff Reason:** ${staffReason}`).setColor(action === 'app' ? "Green" : "Red")] }).catch(() => null);
        }

        const finalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(action === 'app' ? "Green" : "Red")
            .addFields({ name: "Staff Decision", value: staffReason })
            .setFooter({ text: `Final Status: ${statusText} by ${interaction.user.tag}` });
        
        await interaction.update({ embeds: [finalEmbed], components: [] });
    }
});

client.login(process.env.TOKEN);
