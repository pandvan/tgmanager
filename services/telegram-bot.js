const {Telegraf} = require('telegraf')
const { message: Filter } = require('telegraf/filters');
const {Config} = require('../config');
const Logger = require('../logger');
const DB = require('./databases');
const Mime = require('mime-types');
const TelegramClients = require('./clients');


const Log = new Logger('Bot');

let Bot = null;

async function start() {
  Log.info('starting bot');

  Bot = new Telegraf(Config.telegram.bot_token);

  async function processMessage(ctx, keyMessage) {
    // Using context shortcut
    const message = ctx['keyMessage'];
    Log.debug('got', keyMessage, JSON.stringify(message));

    if ( message.document && message.document.file_name ) {
      const {document} = message;
      const {file_name} = document;
      // got a new file
      Log.info('got new file:', file_name);

      let dbFile = await DB.byQuery('type != $0 && parts.@count > 0 && parts.messageid == $1 && state != $2', ['folder', message.message_id, 'TEMP']);

      if ( dbFile && dbFile.length > 0 ) {
        Log.info('file', file_name, 'already saved in DB');
      } else {

        let channelId = String(message.chat.id);
        if ( channelId.length > 10 ) {
          channelId = String(Math.abs(channelId)).substring(3);
        }

        let folders = await DB.byQuery('type == $0 && channel == $1', ['folder', channelId]);
        let parentFolder = folders[0];
        if ( parentFolder ) {
          Log.info('file', file_name, `will be stored in '${parentFolder.filename}'`);
          parentFolder = parentFolder.id;
        } else {
          Log.info('file', file_name, 'will be stored in root folder');
          parentFolder = DB.ROOT_ID;
        }

        TelegramClients.nextClient();
        const client = TelegramClients.Client;

        const channel = await client.getChannel(channelId);
        const message = await client.getMessage({id: channel.id, hash: channel.access_hash}, message.message_id);

        dbFile = await DB.createFile({
          filename: file_name,
          parts: [{
            messageid: message.id,
            originalfilename: file_name,
            hash: '',
            fileid: message.media.document.id,
            size: document.file_size
          }],
          parentfolder: parentFolder,
          type: document.mime_type || Mime.lookup(file_name) || 'application/octet-stream',
          content: null,
          channel: channelId
        }, parentFolder);
        Log.info(file_name, 'correctly saved into DB:', dbFile.id);
      }

    }
  }


  Bot.on( 'channel_post', (ctx) => {
    setTimeout( () => processMessage(ctx, 'channel_post'), 2000 );
  });


  Bot.launch().catch((e) => {
    Log.error('cannot start bot', e);
  });
  Log.info('started');
}

function close() {
  if ( Bot ) {
    Bot.stop('SIGTERM');
  }
}

module.exports = {start, close}