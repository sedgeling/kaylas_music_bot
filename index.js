require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const ytpl = require('ytpl');
const fs = require('fs');


const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ]
});

let player;
let connection;
let queue = [];

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    const generalChannel = client.channels.cache.get(process.env.PLAYLIST_ROOM);
    if (generalChannel) {
        await generalChannel.send('Bot has started!');
    } else {
        console.error('General channel not found');
    }
    if (fs.existsSync('queue.json')) {
        const fileContents = fs.readFileSync('queue.json', 'utf-8');
        queue = JSON.parse(fileContents);
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const prefix = '!';
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    if (!message.content.startsWith(prefix)) return;

    switch (command) {
        case 'play':
            if (args.length === 0) {
                sendMessage(message, 'You need to provide a URL!');
                break;
            }
            const channel = message.member.voice.channel;
            if (!channel) {
                sendMessage(message, 'Join a voice channel first!');
                fs.writeFileSync('queue.json', JSON.stringify(queue));
                break;
            }
            let validUrlCount = 0;
            args.forEach(arg => {
                const urls = arg.split(/\s+/);  // Split on spaces
                urls.forEach(url => {
                    if (ytdl.validateURL(url)) {
                        queue.push(url);
                        validUrlCount++;
                    } else {
                        sendMessage(message, `${url} is not a valid YouTube URL!`);
                    }
                });
            });
            console.log(queue);

            sendMessage(message, `${validUrlCount} song(s) added to queue. Total now: ${queue.length} song(s) in queue.`);
            if (!player || player.state.status !== 'playing') {
                playSong(channel);
            }
            break;

            if (!args[0] && queue.length > 0) {
                playSong(channel);
            }
            break;


        case 'stop':
            if (player) {
                player.stop();
                connection.destroy();  // This disconnects the bot from the voice channel
                sendMessage(message, 'Stopped playback!');
            } else {
                sendMessage(message, 'No audio is playing!');
            }
            break;

        case 'pause':
            if (player) {
                player.pause();
                sendMessage(message, 'Paused playback!');
            } else {
                sendMessage(message, 'No audio is playing!');
            }
            break;

        case 'resume':
            if (!player || player.state.status !== 'playing') {
                playSong(channel);
            } else {
                sendMessage(message, 'Audio is already playing!');
            }
            break;

        case 'skip':
            if (queue.length > 0) {
                sendMessage(message, 'Skipped to the next track!');
                playSong(message.member.voice.channel);
            } else {
                sendMessage(message, 'No more tracks in the queue!');
            }
            fs.writeFileSync('queue.json', JSON.stringify(queue));
            break;

        case 'queue':
            if (queue.length === 0) {
                sendMessage(message, 'The queue is empty.');
            } else {
                let queueMessage = 'Queue:\n';
                queue.forEach((trackUrl, index) => {
                    queueMessage += `${index + 1}. ${trackUrl}\n`;
                });
                sendMessage(message, queueMessage);
            }
            break;

        case 'shuffle':
            shuffleQueue();
            sendMessage(message, 'Queue shuffled!');
            fs.writeFileSync('queue.json', JSON.stringify(queue));
            break;

        case 'clear':
            if (args.length > 0) {
                args.sort((a, b) => b - a);  // Sort in descending order for accurate splicing
                args.forEach(index => {
                    index = parseInt(index);
                    if (index > 0 && index <= queue.length) {
                        queue.splice(index - 1, 1);  // Adjust index as arrays are 0-based
                    } else {
                        message.reply(`${index} is not a valid position in the queue.`);
                    }
                });
                message.reply('Selected songs removed from the queue.');
            } else {
                queue = [];
                message.reply('Queue cleared.');
            }
            fs.writeFileSync('queue.json', JSON.stringify(queue));
            break;

        default:
            sendMessage(message, 'Unknown command!');
            break;
    }

});

function playSong(channel) {
    const url = queue.shift();
    if (url) {
        connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
        });
        try {
            const stream = ytdl(url, {
                filter: 'audioonly',
                fmt: "mp3",
                highWaterMark: 1 << 62,
                liveBuffer: 1 << 62,
                dlChunkSize: 0, //disabling chunking is recommended in discord bot
                bitrate: 128,
                quality: "lowestaudio",
                itag: 95
            });
            stream.on('error', error => console.error('Error in YTDL stream:', error));
            const resource = createAudioResource(stream);
            player = createAudioPlayer();
            player.play(resource);
            connection.subscribe(player);

            player.on('error', error => {
                console.error('Error in audio player:', error);
                connection.destroy();
                if (queue.length > 0) {
                    playSong(channel);
                }
            });

            connection.on('error', error => console.error('Error in voice connection:', error));
            connection.on('disconnected', () => {
                console.error('Voice connection disconnected');
                connection.destroy();
            });
            player.on('idle', () => {
                if (queue.length > 0) {
                    playSong(channel);
                } else {
                    connection.destroy();
                }
            });
        } catch (error) {
            console.error('Error in YTDL stream:', error);
            sendMessage(message, 'Unable to play the requested video, skipping...');
            if (queue.length > 0) {
                playSong(channel);
            } else {
                connection.destroy();
            }
        }
    }
}
fs.writeFileSync('queue.json', JSON.stringify(queue));


let disableEmbeds = true;  // Set this to false if you want to enable embeds

function sendMessage(message, content) {
    let modifiedContent = content;

    if (disableEmbeds) {
        // Replace URLs to prevent embedding
        modifiedContent = content.replace(/(https?:\/\/[^\s]+)/g, '<$1>');
    }

    message.channel.send(modifiedContent, { disableMentions: 'everyone', allowedMentions: { parse: [] } });
}

function shuffleQueue() {
    for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
    }
}

client.login(process.env.BOT_TOKEN);
