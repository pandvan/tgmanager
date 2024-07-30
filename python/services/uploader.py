import logging
from configuration import Config
from constants import UPLOAD_CHUNK
from .telegram import TelegramApi
import mimetypes
import math
import traceback
from utils import EventEmitter

Log = logging.getLogger('Uploader')

PART_TO_LOG_DEBUG = 100 * 1024 * 1024
PART_TO_LOG_INFO = 500 * 1024 * 1024

class Portion():
  def __init__(self, index = -1, file_id = None, current_part = -1, mime = 'application/octet-stream', filename = '', msg_id = 0, size = 0, content = None, ):
    self.index = index
    self.file_id = file_id
    self.current_part = current_part
    self.mime = mime
    self.filename = filename
    self.msg_id = msg_id
    self.size = size
    self.content = content


class Uploader(EventEmitter):

  aborted = False

  current_file_part_index = -1

  total_file_parts = []

  temp_file_bytes = None
  
  client = None
  
  channel_id = None
  
  filename = None

  def __init__(self, client: TelegramApi, filename: str, channel_id: str | int = None):

    # reset fields
    self.aborted = False
    self.current_file_part_index = -1
    self.total_file_parts = []
    self.temp_file_bytes = None

    self.client = client
    self.channel_id = channel_id or Config.telegram.upload.channel
    self.filename = filename


  async def stop(self):
    self.aborted = True
    self.emit('stopped')
  

  def get_total_file_size(self):
    total = 0
    for portion in self.total_file_parts:
      total += portion.size
    return total


  def new_portion_file(self):
    portion = Portion(
      index = len( self.total_file_parts ),
      file_id = TelegramApi.generate_id(),
      current_part = -1,
      mime = mimetypes.guess_type(self.filename)[0] or 'application/octet-stream',
      filename = self.filename,
      msg_id = 0,
      size = 0,
      content = None
    )
    self.total_file_parts.append( portion )
    self.current_file_part_index = len( self.total_file_parts ) - 1
    return portion


  def get_current_portion(self):
    if self.current_file_part_index > -1 and self.current_file_part_index < len( self.total_file_parts ):
      return self.total_file_parts[ self.current_file_part_index ]
    
    return None

  async def execute(self, source):

    self.new_portion_file()

    while True:

      buffer = source.read( UPLOAD_CHUNK )

      if ( len(buffer) < UPLOAD_CHUNK ):
        # stream is finish, this is the last chunk
        current_portion = self.get_current_portion()
        Log.debug(f"stream is ended: {len(buffer)}, part: {current_portion.current_part + 1}")

        if len(buffer) > 0:
          Log.info(f"upload last chunk and then save into channel")
          await self.upload_chunk(buffer, True)
        else:
          await self.send_to_channel(current_portion)

        if not self.aborted:
          self.emit('completeUpload', self.total_file_parts, self.channel_id)
        
        # loop completed
        break
      
      else:

        await self.upload_chunk( buffer, False)
    



  async def upload_chunk(self, buffer: bytes, last_chunk = False):
    max_upload_parts = self.client.max_upload_parts

    current_portion = self.get_current_portion()

    if current_portion is None:
      current_portion = self.new_portion_file()
    
    current_portion.size += len(buffer)

    send_to_channel = False
    should_upload = True

    if self.get_total_file_size() > Config.telegram.upload.min_size:

      if self.temp_file_bytes is not None and len(self.temp_file_bytes) > 0:

        # force pause stream
        Log.debug(f"Force upload the 'in-memory buffer' because it exceeds upload.min_size: {self.get_total_file_size()}")

        while len(self.temp_file_bytes) > 0:

          chunk = self.temp_file_bytes[0 : UPLOAD_CHUNK]
          self.temp_file_bytes = self.temp_file_bytes[ UPLOAD_CHUNK : ]

          current_portion.current_part += 1
          
          res = await self.client.send_file_parts(
            current_portion.file_id,
            current_portion.current_part,
            -1,
            chunk
          )
          # Log.debug(f"upload on telegram '{res}', part: {current_portion.current_part}, total bytes: {(current_portion.current_part + 1) * UPLOAD_CHUNK}")
          if self.get_total_file_size() % PART_TO_LOG_DEBUG == 0:
            Log.debug(f"uploaded {self.get_total_file_size()} bytes of '{self.filename}'")
          if self.get_total_file_size() % PART_TO_LOG_INFO == 0:
            Log.info(f"uploaded {self.get_total_file_size()} bytes of '{self.filename}'")
        # reset the in-memory buffer
        self.temp_file_bytes = None
      
    else:
      # bufefr file in-memory
      if self.temp_file_bytes is not None:
        self.temp_file_bytes = self.temp_file_bytes + buffer
      else:
        self.temp_file_bytes = buffer
      
      should_upload = False
    
      Log.debug(f"Buffer in-memory because of upload.min_size: {len(self.temp_file_bytes)}")

    if should_upload:
      current_portion.current_part += 1
      send_to_channel = current_portion.current_part == max_upload_parts

      if ( send_to_channel ):
        # handle next portion of file
        self.new_portion_file()

      if self.aborted is False:
        try:
          res = await self.client.send_file_parts(
            current_portion.file_id,
            current_portion.current_part,
            math.ceil( current_portion.size / UPLOAD_CHUNK ) if send_to_channel or last_chunk else -1,
            buffer
          )
          # Log.debug(f"upload on telegram '{res}', part: {current_portion.current_part}, total bytes: {(current_portion.current_part + 1) * UPLOAD_CHUNK}")
          if self.get_total_file_size() % PART_TO_LOG_DEBUG == 0:
            Log.debug(f"uploaded {self.get_total_file_size()} bytes of '{self.filename}'")
          if self.get_total_file_size() % PART_TO_LOG_INFO == 0:
            Log.info(f"uploaded {self.get_total_file_size()} bytes of '{self.filename}'")
        except Exception as e:
          Log.error(f"error while upload part: {current_portion} - {e}")
          traceback.print_exc()
          self.emit('error')
          raise e


    if send_to_channel or last_chunk:
      await self.send_to_channel(current_portion)
    



  async def send_to_channel(self, portion):
    filename = portion.filename

    if len(self.total_file_parts) > 1:
      filename = f"{filename}.{ str( str(portion.index + 1) ).zfill(3) }"

    if self.aborted:
      Log.warn(f"cannot finish upload because of aborted")
      return

    if self.temp_file_bytes is not None:
      # file is buffered into memory and needs to be directly inserted into db
      portion.content = self.temp_file_bytes
      Log.info('save content into DB')
    else:

      try:

        Log.debug(f"try to move part into channel {self.channel_id}, total parts: {math.ceil(portion.size / UPLOAD_CHUNK)} for file: '{filename}'")

        resp = await self.client.move_file_to_chat(
          self.channel_id, 
          portion.file_id, 
          math.ceil(portion.size / UPLOAD_CHUNK), 
          filename,
          portion.mime
        )

        found_update = False
        for update in resp.updates:
          if getattr(update, 'message', None) is not None:
            found_update = True
            portion.msg_id = update.message.id
            portion.file_id = update.message.media.document.id
            Log.debug(f"got update for sent file: {portion.msg_id}, {portion.file_id}")

            for attr in update.message.media.document.attributes:
              if attr.QUALNAME == 'types.DocumentAttributeFilename':
                portion.filename = attr.file_name
                Log.debug(f"tg-filename: {portion.filename}")
                break
            
            break
        if not found_update:
          Log.warn(f"Cannot retrieve data from updated-message")
      except Exception as e:
        Log.error(e, exc_info=True)
        traceback.print_exc()
        self.emit('error')
        raise e
      
    self.emit('portionUploaded', portion, self.channel_id)











