const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, PermissionsBitField } = require('discord.js');
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
        { name: 'config', description: 'Advanced bot configuration (Admins Only)' }
    ]);
});

client.on('interactionCreate', async (interaction) => {
    let cfg = read('config.json');
    let db = read('appeals.json');

    // --- ADMIN CONFIG ONLY ---
    if (interaction.commandName === 'config') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
            return interaction.reply({ content: "❌ Only Server Admins can use this!", ephemeral: true });

        const r1 = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('cfg_roles').setPlaceholder('Choose Staff Roles').setMinValues(1).setMaxValues(5));
        const r2 = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg_admin_log').setPlaceholder('Select Staff (Admin) Log Channel'));
        const r3 = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg_pub_log').setPlaceholder('Select Public Log Channel'));

        await interaction.reply({ content: '⚙️ **Advanced Configuration Menu**', components: [r1, r2, r3], ephemeral: true });
    }

    // Handle Select Menu Configs
    if (interaction.isRoleSelectMenu() && interaction.customId === 'cfg_roles') {
        cfg.adminRoles = interaction.values; save('config.json', cfg);
        return interaction.update({ content: '✅ Staff roles saved!', components: [] });
    }
    if (interaction.isChannelSelectMenu()) {
        if (interaction.customId === 'cfg_admin_log') cfg.staffLogChannel = interaction.values[0];
        if (interaction.customId === 'cfg_pub_log') cfg.publicLogChannel = interaction.values[0];
        save('config.json', cfg);
        return interaction.update({ content: `✅ Log channel updated!`, components: [] });
    }

    // --- APPEAL SUBMISSION ---
    if (interaction.commandName === 'setup') {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('type_ban').setLabel('Ban Appeal').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('type_mute').setLabel('Mute Appeal').setStyle(ButtonStyle.Primary)
        );
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle(cfg.embedTitle).setDescription("Click below to start an appeal.").setColor(cfg.embedColor)], components: [row] });
    }

    if (interaction.isButton() && interaction.customId.startsWith('type_')) {
        const modal = new ModalBuilder().setCustomId(`modal_${interaction.customId}`).setTitle('Submit Appeal');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel("Why should we unban/unmute you?").setStyle(TextInputStyle.Paragraph).setRequired(true)));
        await interaction.showModal(modal);
    }

    // MODAL SUBMIT (Log to Admin Channel)
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('modal_type_')) {
        const id = Math.random().toString(36).substring(2, 5).toUpperCase() + Math.floor(100 + Math.random() * 900);
        const reason = interaction.fields.getTextInputValue('reason');
        
        const adminEmbed = new EmbedBuilder()
            .setTitle(`New Appeal | ID: ${id}`)
            .addFields({ name: "User", value: `${interaction.user.tag} (<@${interaction.user.id}>)` }, { name: "Reason", value: reason })
            .setColor("Orange").setFooter({ text: "Status: Unclaimed" });

        const btns = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`claim_${id}`).setLabel('Claim').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`staff_app_${id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`staff_den_${id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );

        const staffLog = client.channels.cache.get(cfg.staffLogChannel);
        if (staffLog) await staffLog.send({ embeds: [adminEmbed], components: [btns] });

        db[id] = { userId: interaction.user.id, status: 'Pending' };
        save('appeals.json', db);
        await interaction.reply({ content: `✅ Appeal sent! Your ID is **${id}**.`, ephemeral: true });
    }

    // --- STAFF ACTIONS (Claim, Accept, Deny) ---
    if (interaction.isButton() && (interaction.customId.startsWith('staff_') || interaction.customId.startsWith('claim_'))) {
        const parts = interaction.customId.split('_');
        const action = parts[0];
        const id = parts[parts.length - 1];

        // Permission Check
        if (!interaction.member.roles.cache.some(r => cfg.adminRoles.includes(r.id))) 
            return interaction.reply({ content: "❌ Only Staff can do this!", ephemeral: true });

        if (action === 'claim') {
            const embed = EmbedBuilder.from(interaction.message.embeds[0]).setFooter({ text: `Claimed by ${interaction.user.tag}` }).setColor("Blue");
            return interaction.update({ embeds: [embed] });
        }

        // Show Modal for Reason
        const modal = new ModalBuilder().setCustomId(`finish_${action}_${id}`).setTitle(action === 'app' ? 'Accept Appeal' : 'Deny Appeal');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('staff_msg').setLabel("Staff Reason").setStyle(TextInputStyle.Paragraph).setRequired(true)));
        await interaction.showModal(modal);
    }

    // FINAL DECISION HANDLER
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('finish_')) {
        const [, action, id] = interaction.customId.split('_');
        const staffMsg = interaction.fields.getTextInputValue('staff_msg');
        const appeal = db[id];
        const user = await client.users.fetch(appeal.userId).catch(() => null);
        const status = action === 'app' ? 'ACCEPTED' : 'DENIED';

        // 1. DM User
        if (user) await user.send({ embeds: [new EmbedBuilder().setTitle(`Appeal Update`).setDescription(`ID: **${id}**\nStatus: **${status}**\nReason: ${staffMsg}`).setColor(action === 'app' ? "Green" : "Red")] }).catch(() => null);

        // 2. Update Admin Log
        const updatedAdmin = EmbedBuilder.from(interaction.message.embeds[0]).setColor(action === 'app' ? "Green" : "Red").addFields({ name: "Staff Decision", value: staffMsg }).setFooter({ text: `Finished by ${interaction.user.tag}` });
        await interaction.update({ embeds: [updatedAdmin], components: [] });

        // 3. Post to Public Log
        const publicLog = client.channels.cache.get(cfg.publicLogChannel);
        if (publicLog) {
            const pubEmbed = new EmbedBuilder().setTitle(`Appeal ${status}`).setDescription(`**Appeal ID:** ${id}\n**User:** <@${appeal.userId}>\n**Staff Reason:** ${staffMsg}`).setColor(action === 'app' ? "Green" : "Red").setTimestamp();
            await publicLog.send({ embeds: [pubEmbed] });
        }
    }
});

client.login(process.env.TOKEN);
