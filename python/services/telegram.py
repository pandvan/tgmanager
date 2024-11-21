from pyrogram import Client, raw
from pyrogram.file_id import FileId
from pyrogram.session import Session, Auth
from pyrogram.errors import AuthBytesInvalid
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

  def __init__(self, name, api_id, api_hash, bot_token = None, session = None):
    self._name = name

    self.api_id = api_id
    self.api_hash = api_hash
    self.bot_token = bot_token

    self.api = Client(
      name = name,
      api_id = api_id,
      api_hash = api_hash,
      session_string = session,
      bot_token = bot_token,
      no_updates = not bot_token,
      in_memory = True,
      max_concurrent_transmissions = 5
    )

  async def start(self):
    try:
      await self.api.start()

    except Exception as E:
      Log.warning(E)
      if E.CODE == 401:
        Log.warning('session has been expired!')
        self.api = Client(
          name = self.api.name,
          api_id = self.api.api_id,
          api_hash = self.api.api_hash,
          bot_token = self.api.bot_token,
          no_updates = not self.api.bot_token,
          in_memory = True,
          max_concurrent_transmissions = 5
        )
        await self.api.start()
  
  async def get_session(self):
    return await self.api.export_session_string()
    

  async def get_me(self):
    me = await self.api.get_me()
    
    # TODO: check bot
    
    self.is_premium = me.is_premium is True
    self.username = me.username
    self.is_bot = me.is_bot

    if not self.is_bot:
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
    # fix: use 18 digits and add '1' in order to avoid "int too big to convert" exception
    numbers = string.digits
    num = int( ''.join( random.choices(numbers, k=18) ) )
    return int( f"1{num}")

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
  
    return None


  async def get_message(self, channel_id: int, mesgId: int):
    channel_id = int(channel_id)
    
    message = await self.api.get_messages(channel_id, mesgId)
    if message.empty:
      return None
  
    return message


  async def get_media_session(self, dc):
    ms = self.api.media_sessions.get(dc, None)

    if ms is None:
      if dc != await self.api.storage.dc_id():
        Log.debug(f"creating and switch new media_session for {dc}")
        ms = Session(
          self.api,
          dc,
          await Auth(
              self.api, dc, await self.api.storage.test_mode()
          ).create(),
          await self.api.storage.test_mode(),
          is_media=True,
        )
        await ms.start()

        for _ in range(6):
          exported_auth = await self.api.invoke(
            raw.functions.auth.ExportAuthorization(dc_id=dc)
          )

          try:
            await ms.invoke(
              raw.functions.auth.ImportAuthorization(
                id=exported_auth.id, bytes=exported_auth.bytes
              )
            )
            break
          except AuthBytesInvalid:
            Log.debug(
              f"Invalid authorization bytes for DC {dc}"
            )
            continue
        else:
          await ms.stop()
          raise AuthBytesInvalid
      else:
        Log.debug(f"creating a new media_session for {dc}")
        ms = Session(
          self.api,
          dc,
          await self.api.storage.auth_key(),
          await self.api.storage.test_mode(),
          is_media=True,
        )
        await ms.start()
      # Log.debug(f"Created media session for DC {dc}")
      self.api.media_sessions[dc] = ms
    
    return ms


  async def get_file(self, id, hash, reference, offset = 0, dc = None, limit = UPLOAD_CHUNK * 2):

    _api = self.api

    if dc is not None:
      _api = await self.get_media_session(dc)

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
    return await _api.invoke(file_call)
  
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

    rand_id = TelegramApi.generate_id()
    Log.debug(f"Generated ID for message: {rand_id} ")
    fn_call = raw.functions.messages.SendMedia(
      peer = peer,
      media = media,
      random_id = int( rand_id ),
      silent = True,
      message = ''
    )

    return await self.api.invoke(fn_call)
  
  async def forward_message(self, channel_id_from, channel_id_to, msg_id):
    Log.info(f"forward message between channel: {channel_id_from} -> {channel_id_to}")

    channel_id_from = int(channel_id_from)
  
    channel_id_to = int(channel_id_to)

    channel_from = await self.api.resolve_peer( channel_id_from )
    channel_to = await self.api.resolve_peer( channel_id_to )

    rand_id = TelegramApi.generate_id()
    Log.debug(f"Generated ID  for ForwardMessages: {rand_id}")

    fn_call = raw.functions.messages.ForwardMessages(
      silent = True,
      drop_author = True,
      from_peer = channel_from,
      to_peer = channel_to,
      id = [msg_id],
      random_id = [ int( TelegramApi.generate_id() ) ]
    )

    return await self.api.invoke( fn_call )
  
  async def delete_message(self, channel_id, msg_id):

    channel_id = int(channel_id)

    channel = await self.api.resolve_peer( channel_id )

    fn_call = raw.functions.channels.DeleteMessages(
      channel = channel,
      id = [msg_id]
    )
    return await self.api.invoke( fn_call )