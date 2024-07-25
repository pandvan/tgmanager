from pyrogram import Client, raw
from pyrogram.file_id import FileId
from configuration import Config
from constants import UPLOAD_CHUNK
import random
import logging
import string

Log = logging.getLogger("TGApi")

# try to make pyrogram faster :)
try:
  import uvloop
  uvloop.install()
except:
  Log.info("no uvloop found")


class TelegramApi:

  is_bot = False
  username = None
  is_premium = False
  max_upload_parts = 0

  def __init__(self, name, api_id, api_hash, bot_token = None):
    self._name = name

    self.api_id = api_id
    self.api_hash = api_hash
    self.bot_token = bot_token

    self.api = Client(
      name = name,
      api_id = api_id,
      api_hash = api_hash,
      workdir = Config.data,
      bot_token = bot_token,
      no_updates = True,
      max_concurrent_transmissions = 5
    )

  async def start(self):
    await self.api.start()
    

  async def get_me(self):
    me = await self.api.get_me()
    
    # TODO: check bot
    
    self.is_premium = me.is_premium is True
    self.username = me.username
    self.is_bot = me.is_bot

    fn_call = raw.functions.help.GetAppConfig(
      hash = 0
    )

    user_config = await self.api.invoke( fn_call )
    config = user_config.config
    value = config.value
    for obj in value:
      if self.is_premium:
        if obj.key == 'upload_max_fileparts_premium':
          self.max_upload_parts = int(obj.value.value )
          break
      else:
        if obj.key == 'upload_max_fileparts_default':
          self.max_upload_parts = int(obj.value.value )
          break

  @staticmethod
  def generate_id():
    numbers = string.digits
    return int( ''.join( random.choices(numbers, k=19) ) )

  @staticmethod
  def get_media_from_message(message):
    media_types = (
        "audio",
        "document",
        "photo",
        "sticker",
        "animation",
        "video",
        "voice",
        "video_note",
    )
    for attr in media_types:
        media = getattr(message, attr, None)
        if media:
          file_data =  FileId.decode(media.file_id)
          setattr(media, "filedata", file_data)
          return media


  async def get_message(self, channel_id: int, mesgId: int):
    if not str(channel_id).startswith('-100'):
      channel_id = int(f"-100{channel_id}")
      
    channel_id = int(channel_id)
    
    message = await self.api.get_messages(channel_id, mesgId)
    if message.empty:
      raise Exception(f"cannot find message {mesgId} in channel {channel_id}")
  
    return message


  async def get_file(self, id, hash, reference, offset = 0, limit = UPLOAD_CHUNK * 2):
    location = raw.types.InputDocumentFileLocation(
      id=id,
      access_hash=hash,
      file_reference=reference,
      thumb_size=""
    )

    file_call = raw.functions.upload.GetFile(
      location = location,
      offset = offset,
      limit = limit,
      precise = False
    )
    return await self.api.invoke(file_call)
  
  async def send_file_parts(self, id, num_part, total_parts, file_bytes):
    file = raw.functions.upload.SaveBigFilePart(
      file_id = id,
      file_part = num_part,
      file_total_parts = total_parts,
      bytes = file_bytes
    )
    return await self.api.invoke(file)

  async def move_file_to_chat(self, channel_id, file_id, total_parts, filename, mime):
    Log.info(f"send file to chat {channel_id}")

    if not str(channel_id).startswith('-100'):
      channel_id = int(f"-100{channel_id}")
      
    channel_id = int(channel_id)

    peer = await self.api.resolve_peer( channel_id )

    media = raw.types.InputMediaUploadedDocument(
      file = raw.types.InputFileBig(
        id = file_id,
        parts = total_parts,
        name = filename
      ),
      mime_type = mime,
      attributes = [raw.types.DocumentAttributeFilename(
        file_name = filename
      )],
      force_file = True
    )

    fn_call = raw.functions.messages.SendMedia(
      peer = peer,
      media = media,
      random_id = int( TelegramApi.generate_id() ),
      silent = True,
      message = ''
    )

    return await self.api.invoke(fn_call)
  
  async def forward_message(self, channel_id_from, channel_id_to, msg_id):

    if not str(channel_id_from).startswith('-100'):
      channel_id_from = int(f"-100{channel_id_from}")
      
    channel_id_from = int(channel_id_from)
  
    if not str(channel_id_to).startswith('-100'):
      channel_id_to = int(f"-100{channel_id_to}")
      
    channel_id_to = int(channel_id_to)

    channel_from = await self.api.resolve_peer( channel_id_from )
    channel_to = await self.api.resolve_peer( channel_id_to )

    fn_call = raw.functions.messages.ForwardMessages(
      silent = True,
      drop_author = True,
      from_peer = channel_from,
      to_peer = channel_to,
      id = [msg_id],
      random_id = [ TelegramApi.generate_id() ]
    )

    return self.api.invoke( fn_call )
  
  async def delete_message(self, channel_id, msg_id):

    if not str(channel_id).startswith('-100'):
      channel_id = int(f"-100{channel_id}")
      
    channel_id = int(channel_id)

    channel = await self.api.resolve_peer( channel_id )

    fn_call = raw.functions.channels.DeleteMessages(
      channel = channel,
      id = [msg_id]
    )
    return self.api.invoke( fn_call )