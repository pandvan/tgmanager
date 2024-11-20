import logging
import mimetypes
from configuration import Config
from constants import ROOT_ID
import time
from pyrogram import filters
from services.telegram import TelegramApi
from pyrogram.types import Message
from pyrogram.handlers import MessageHandler
from services.telegram import TelegramApi
from services.tgclients import TGClients
from services.database import TGPart, TGFile, get_file_by_message_id_and_channel, get_folders_by_channel, create_file

Log = logging.getLogger("BOT")

client = None

class Bot():

  def __init__(self):
    pass

  @staticmethod
  async def start():
    Log.debug("starting..")

    current = TGClients.next_client()

    Log.info(f"Loading main bot associated to {current.username}")

    client = TelegramApi('bot', current.api_id, current.api_hash, Config.telegram.bot_token)

    await client.start()
    await client.get_me()

    Log.info(f"Main bot is: {client.username}")

    _filters = (
        filters.document
        | filters.video
        | filters.audio
        | filters.voice
        | filters.video_note
        | filters.photo
    )

    client.api.add_handler( MessageHandler(on_message, _filters ) )

    Log.info("Started")
  

async def on_message(_, message: Message):
  # wait for 2 seconds
  # database is updating data
  media = TelegramApi.get_media_from_message(message)
  if media is None:
    Log.info("message is not a file")
    return
  
  time.sleep(2)


  channel_id = message.chat.id

  Log.info(f"got a file in channel {channel_id}")

  dbFile = get_file_by_message_id_and_channel(message.id, channel_id)

  if dbFile is not None:
    Log.info(f"file '{media.file_name}' already saved in DB")
  else:

    Log.debug(f"file '{media.file_name}' will be stored in DB")

    folders = get_folders_by_channel(channel_id)
    if len(folders) > 0:
      parentFolder = folders[0]
      Log.info(f"file '{media.file_name}' will be stored in '{parentFolder.filename}'")
      parentFolder = parentFolder.id
    else:
      Log.info(f"file '{media.file_name}' will be stored in root folder")
      parentFolder = ROOT_ID
    
    # use user account in order to retrieve correct file_ID
    client = TGClients.next_client(False)

    msg = await client.get_message(channel_id, message.id)

    dbFile = create_file( TGFile(
      filename = media.file_name,
      parts = [ TGPart(
        messageid = msg.id,
        originalfilename = media.file_name,
        hash = '',
        fileid = media.filedata.media_id,
        size = media.file_size,
        index = 0
      )],
      parentfolder = parentFolder,
      type = media.mime_type or mimetypes.guess_type(media.file_name)[0] or 'application/octet-stream',
      content = None,
      channel = channel_id
    ), parentFolder)
    Log.info(f"'{media.file_name}' has been correctly saved into DB: {dbFile.id}'")


