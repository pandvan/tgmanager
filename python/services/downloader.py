from services.telegram import TelegramApi
from services.database import TGFile
from configuration import UPLOAD_CHUNK
import logging

Log = logging.getLogger('Downloader')

PART_TO_LOG_DEBUG = 100 * 1024 * 1024
PART_TO_LOG_INFO = 500 * 1024 * 1024

class Downloader():
  
  aborted = False

  client = None
  channel_id = None
  parts = None
  range_start = 0
  range_end = -1
  totalsize = 0
  file = None

  def __init__(self, client: TelegramApi, file: TGFile, start: int, end: int):
    self.client = client
    self.channel_id = file.channel
    self.file = file
    self.parts = file.parts
    self.range_start = start
    self.range_end = end

    self.totalsize = 0

    for part in file.parts:
      self.totalsize += part.size
    
  
  def stop(self):
    self.aborted = True
  

  async def execute(self, destination, awaited = True):

    files = []

    currentSizePosition = 0
    currentIndex = 0

    if self.file and self.file.content is not None and self.file.content_length():
      if awaited:
        await destination.write( file.content )
      else:
        destination.write( file.content )
      
      try:
        if awaited:
          await destination.write_eof()
        else:
          destination.write_eof()
      except Exception:
        Log.warn(f"cannot write_eof")
      
      return

    # Calculate the full range stack to be downloaded
    while( True ):

      file = self.parts[currentIndex]
      fileToAdd = None

      if ( self.range_start < (currentSizePosition + file.size) ):
        # found first chunk of file part to add to download queue
        fileToAdd = {
          'index': currentIndex,
          'file': file,
          'start': self.range_start - currentSizePosition if len(files) == 0 else 0
        }

        if ( self.range_end <= (currentSizePosition + file.size) ):
          
          fileToAdd['end'] = file.size - ( (currentSizePosition + file.size) - self.range_end ) + 1
          files.append(fileToAdd)
          break

        else:
          fileToAdd['end'] = file.size
          files.append(fileToAdd)
      
      currentSizePosition += file.size
      currentIndex += 1
    
    
    for item in files:

      start = item['start']
      end = item['end']
      file = item['file']
      msg = file.messageid
      
      Log.debug(f"getting message {msg}")
      message = await self.client.get_message(self.channel_id, msg)
      media = TelegramApi.get_media_from_message( message )
  
      Log.debug(f"ready for download, range: {start}-${end}")

      await self.perform_stream(media.filedata.media_id, media.filedata.access_hash, media.filedata.file_reference, media.filedata.dc_id, start, end, destination, awaited)

      if ( self.aborted ):
        break
    
    try:
      await destination.write_eof()    
    except Exception:
      Log.warn(f"cannot write_eof")

  
  async def perform_stream(self, id, hash, reference, dc, start, end, destination, awaited = True):
    # telegram chunk (1MB)
    CHUNK = UPLOAD_CHUNK * 2 # 1 Mb
  
    # calculate the start offset of download
    offset = start - (start % CHUNK)
    first = True
  
    needStop = False

    total_file_downloaded = 0

    offset = int(offset)

    Log.debug(f"stream from {start} to {end}, starting from {offset}")

    while (True):
      tgFile = await self.client.get_file(id, hash, reference, offset=offset, limit=CHUNK, dc=dc)
  
      firstByte = 0
      lastByte = CHUNK
  
      if ( first ):
        firstByte = start - offset
        first = False
  
      if ( offset + len(tgFile.bytes) >= end ):
        lastByte = end - offset
        needStop = True
      
      firstByte = int(firstByte)
      lastByte = int(lastByte)
  
      buf = tgFile.bytes[firstByte : lastByte]
      # Log.debug(f"send buffer: from {offset} ({len(buf)} bytes)")
      if awaited:
        resp = await destination.write( buf )
      else:
        resp = destination.write( buf )
      
      total_file_downloaded += len(buf)

      if total_file_downloaded % PART_TO_LOG_DEBUG == 0:
        Log.debug(f"downloaded {total_file_downloaded} bytes of '{self.file.filename}'")
      if total_file_downloaded % PART_TO_LOG_INFO == 0:
        Log.info(f"downloaded {total_file_downloaded} bytes of '{self.file.filename}'")

      #Log.debug(f"wrote {len(buf) == resp}, {len(buf)} bytes")

      offset += CHUNK
  
      if ( needStop or self.aborted ):
        break