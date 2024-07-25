import logging
from configuration import Config
from pyrogram import filters
from pyrogram.types import Message
from pyrogram.handlers import MessageHandler
from services.telegram import TelegramApi
from services.tgclients import TGClients

logger = logging.getLogger("BOT")

client = None

class Bot():

  def __init__(self):
    pass

  @staticmethod
  async def start():
    logger.debug("starting..")

    current = TGClients.next_client()

    client = TelegramApi('bot', current.api_id, current.api_hash, Config.telegram.bot_token)

    await client.start()

    _filters = filters.private & (
        filters.document
        | filters.video
        | filters.audio
        | filters.animation
        | filters.voice
        | filters.video_note
        | filters.photo
        | filters.sticker
    )

    client.api.add_handler( MessageHandler(on_message, _filters ) )

    logger.info("Started")
  

def on_message(_, m: Message):
  pass